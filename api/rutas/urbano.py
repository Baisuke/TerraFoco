# -*- coding: utf-8 -*-
"""
Condición térmica urbana: módulo 3.

Expone lo que la ingesta de ECOSTRESS deja en indicadores.urbano. Hoy eso es
la temperatura superficial por comuna —media, máxima y mínima de las escenas
de verano—; el NDVI urbano viene en NULL porque aún no se calcula, y la
respuesta lo dice tal cual en vez de omitir el campo. Quien consuma esto
tiene que poder distinguir "no medido" de "cero".

El área verde por habitante no sale de aquí sino de /urbano/areas-verdes,
que la calcula con el Censo 2024 y OpenStreetMap (migración 014).
"""
from fastapi import APIRouter, HTTPException, Query

import bd
import config

router = APIRouter(prefix="/urbano", tags=["indicadores"])

# Última versión por comuna: la tabla es histórica, cada recálculo inserta.
SQL_LISTA = """
SELECT DISTINCT ON (u.id_comuna)
       c.id_comuna, c.nombre, c.provincia, u.anio,
       u.temp_superficial, u.temp_maxima, u.temp_minima, u.escenas_usadas,
       u.ndvi, u.area_verde_m2, u.area_verde_hab, u.fuente, u.calculado_en::date
FROM   indicadores.urbano u
JOIN   territorio.comuna c USING (id_comuna)
WHERE  c.id_region = %s AND u.id_comuna IS NOT NULL
ORDER  BY u.id_comuna, u.anio DESC, u.calculado_en DESC
"""


def _num(v):
    return float(v) if v is not None else None


def _fila(f):
    return {
        "id_comuna": f[0], "nombre": f[1], "provincia": f[2], "anio": f[3],
        "temp_superficial": _num(f[4]), "temp_maxima": _num(f[5]), "temp_minima": _num(f[6]),
        "escenas": f[7],
        "ndvi": _num(f[8]), "area_verde_m2": _num(f[9]), "area_verde_hab": _num(f[10]),
        "fuente": f[11], "calculado_en": f[12].isoformat() if f[12] else None,
    }


@router.get("")
def listar(region: int = Query(default=config.ID_REGION_POR_DEFECTO)):
    """Temperatura superficial por comuna, de mayor a menor.

    La temperatura es la media de todas las pasadas de ECOSTRESS del verano,
    de día y de noche. Por eso ronda los 20-26 °C y no los 30-35 de una imagen
    diurna: la isla de calor se mide también cuando el hormigón devuelve de
    noche lo que acumuló de día.
    """
    with bd.conexion() as con:
        filas = con.execute(SQL_LISTA, (region,)).fetchall()
    if not filas:
        raise HTTPException(404, {
            "mensaje": "Sin indicadores urbanos para la región %d" % region,
            "sugerencia": "Cargarlos con: python -m ingesta.ecostress --descargar --guardar",
        })
    comunas = sorted((_fila(f) for f in filas),
                     key=lambda c: -(c["temp_superficial"] or 0))
    return {
        "fuente": filas[0][11],
        "anio": filas[0][3],
        "nota": ("Media de pasadas diurnas y nocturnas de verano. NDVI y área verde "
                 "aún sin calcular: llegan en null, no en cero."),
        "comunas": comunas,
    }


# ------------------------------------------------------------ áreas verdes
#
# El déficit de áreas verdes (objetivo 7, HU-19, RF-25) con los estándares
# del SIEDU. Lo calcula motor/indicadores/area_verde.py sobre la población
# urbana del Censo 2024 y las áreas verdes públicas de OpenStreetMap.

ESTANDAR = {"m2_hab": 10, "plaza_m": 400, "parque_m": 3000,
            "plaza_min_m2": 450, "parque_min_m2": 20000,
            "fuente": "SIEDU (INE / CNDU)"}

SQL_AREA_VERDE = """
SELECT DISTINCT ON (a.escala, a.id_comuna, a.id_zona)
       a.escala, a.id_comuna, c.nombre, a.id_zona, z.cod_zona, z.localidad,
       a.personas, a.area_verde_m2, a.m2_hab, a.deficit_m2,
       a.pob_plaza_400, a.pob_parque_3km, a.plazas, a.parques,
       a.anio_poblacion, a.fecha_osm
FROM   indicadores.area_verde a
JOIN   territorio.comuna c USING (id_comuna)
LEFT   JOIN territorio.zona_censal z USING (id_zona)
WHERE  c.id_region = %s
ORDER  BY a.escala, a.id_comuna, a.id_zona, a.calculado_en DESC
"""


def _area_verde(f):
    personas = f[6] or 0

    def pct(n):
        return round(n / personas, 4) if personas and n is not None else None
    fila = {
        "id_comuna": f[1], "nombre": f[2], "personas": personas,
        "area_verde_m2": _num(f[7]), "m2_hab": _num(f[8]), "deficit_m2": _num(f[9]),
        "pct_plaza_400": pct(f[10]), "pct_parque_3km": pct(f[11]),
        "plazas": f[12], "parques": f[13],
    }
    if f[0] == "zona":
        fila.update({"id_zona": f[3], "cod_zona": f[4], "localidad": f[5]})
    return fila


@router.get("/areas-verdes")
def areas_verdes(region: int = Query(default=config.ID_REGION_POR_DEFECTO),
                 comuna: int | None = Query(default=None, description="filtra las zonas")):
    """Área verde pública por habitante y acceso a plazas y parques.

    Por comuna (su área urbana) y por zona censal urbana, que reemplaza a la
    unidad vecinal: su catastro no es público y la zona censal es la unidad
    oficial más fina con población. El acceso se mide en línea recta desde
    cada manzana, sin contar bandejones de pasto; el SIEDU usa la red vial,
    así que aquí el acceso queda sobreestimado.
    """
    with bd.conexion() as con:
        filas = con.execute(SQL_AREA_VERDE, (region,)).fetchall()
    if not filas:
        raise HTTPException(404, {
            "mensaje": "Sin indicador de áreas verdes para la región %d" % region,
            "sugerencia": ("python -m ingesta.censo && python -m ingesta.areas_verdes "
                           "&& python -m indicadores.area_verde"),
        })
    comunas = [_area_verde(f) for f in filas if f[0] == "comuna"]
    zonas = [_area_verde(f) for f in filas
             if f[0] == "zona" and (comuna is None or f[1] == comuna)]
    return {
        "estandar": ESTANDAR,
        "anio_poblacion": filas[0][14],
        "fecha_osm": filas[0][15].isoformat() if filas[0][15] else None,
        "comunas": sorted(comunas, key=lambda c: -c["personas"]),
        "zonas": sorted(zonas, key=lambda z: (z["id_comuna"], z["cod_zona"] or 0)),
    }


# Para el mapa de la pantalla: las zonas de una comuna con su indicador, y
# las plazas y parques que se dibujan encima. Geometría simplificada a ~2 m:
# a la escala de una ciudad no se nota y el GeoJSON pesa un tercio.
SQL_GEO_ZONAS = """
SELECT json_build_object('type', 'FeatureCollection', 'features', COALESCE(json_agg(
         json_build_object('type', 'Feature',
           'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(z.geom, 0.00002), 6)::json,
           'properties', json_build_object('id_zona', z.id_zona, 'cod_zona', z.cod_zona,
               'localidad', z.localidad, 'personas', a.personas, 'm2_hab', a.m2_hab,
               'pct_plaza_400', CASE WHEN a.personas > 0
                                     THEN round(a.pob_plaza_400::numeric / a.personas, 4) END))), '[]'))
FROM   territorio.zona_censal z
LEFT   JOIN LATERAL (SELECT * FROM indicadores.area_verde x
                     WHERE x.escala = 'zona' AND x.id_zona = z.id_zona
                     ORDER BY x.calculado_en DESC LIMIT 1) a ON true
WHERE  z.id_comuna = %s
"""

SQL_GEO_AREAS = """
SELECT json_build_object('type', 'FeatureCollection', 'features', COALESCE(json_agg(
         json_build_object('type', 'Feature',
           'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(v.geom, 0.00001), 6)::json,
           'properties', json_build_object('tipo', v.tipo, 'nombre', v.nombre,
               'area_m2', v.area_m2, 'solo_pasto', v.solo_pasto))), '[]'))
FROM   territorio.area_verde v
WHERE  v.geom && (SELECT ST_Expand(ST_Extent(geom), 0.01) FROM territorio.zona_censal
                  WHERE id_comuna = %s)
"""


@router.get("/areas-verdes/geojson")
def areas_verdes_geojson(comuna: int = Query(..., description="id INE de la comuna")):
    """Zonas censales de la comuna con su indicador, y las áreas verdes de su entorno."""
    with bd.conexion() as con:
        zonas = con.execute(SQL_GEO_ZONAS, (comuna,)).fetchone()[0]
        areas = con.execute(SQL_GEO_AREAS, (comuna,)).fetchone()[0]
    if not zonas["features"]:
        raise HTTPException(404, "La comuna %d no tiene zonas censales urbanas cargadas" % comuna)
    return {"zonas": zonas, "areas": areas}
