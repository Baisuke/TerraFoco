# -*- coding: utf-8 -*-
"""
Qué hay expuesto dentro de una comuna: personas por manzana y equipamiento.

Lo usa el visor de inundaciones para responder "cuánta gente y qué escuelas,
postas y cuarteles quedan sobre el terreno que supera el umbral". El cruce
con la grilla de 30 m se hace en el navegador, igual que el de las
localidades, para que siga al umbral sin volver al servidor.

Las dos capas llevan su atribución en la respuesta: las manzanas son del INE
(copia OCUC, CC BY-NC 4.0) y el equipamiento de OpenStreetMap (ODbL).
"""
from fastapi import APIRouter, Query

import bd
import config

router = APIRouter(prefix="/exposicion", tags=["territorio"])

ATRIBUCION_MANZANAS = "INE, Censo 2017 por manzana · copia del Observatorio de Ciudades UC (CC BY-NC 4.0)"
ATRIBUCION_OSM = "© colaboradores de OpenStreetMap (ODbL)"

# Seis decimales (~10 cm) bastan para una manzana y achican la respuesta a
# la mitad.
SQL_MANZANAS = """
SELECT json_build_object(
         'type', 'FeatureCollection',
         'atribucion', %s::text,
         'cobertura', 'Solo población urbana: la manzana es la unidad censal de ciudades y pueblos.',
         'features', COALESCE(json_agg(json_build_object(
             'type', 'Feature',
             'geometry', ST_AsGeoJSON(m.geom, 6)::json,
             'properties', json_build_object(
                 'id', m.id_manzana, 'categoria', m.categoria,
                 'personas', m.personas, 'viviendas', m.viviendas))), '[]'::json)
       )
FROM   territorio.manzana m
WHERE  m.id_comuna = %s
"""

SQL_EQUIPAMIENTO = """
SELECT json_build_object(
         'type', 'FeatureCollection',
         'atribucion', %s::text,
         'features', COALESCE(json_agg(json_build_object(
             'type', 'Feature',
             'geometry', ST_AsGeoJSON(e.geom, 6)::json,
             'properties', json_build_object(
                 'id', e.id_equipamiento, 'id_comuna', e.id_comuna,
                 'categoria', e.categoria, 'tipo', e.tipo, 'nombre', e.nombre,
                 'osm', e.osm_tipo || '/' || e.osm_id))
             ORDER BY e.categoria, e.nombre), '[]'::json)
       )
FROM   territorio.equipamiento e
JOIN   territorio.comuna c USING (id_comuna)
WHERE  c.id_region = %s
  AND  (%s::int IS NULL OR e.id_comuna = %s::int)
"""


@router.get("/manzanas")
def manzanas(comuna: int = Query(..., description="id_comuna (código CUT)")):
    """Manzanas censales de una comuna con sus personas y viviendas.

    Pide la comuna: la región entera son miles de polígonos y el visor solo
    necesita los de la comuna abierta. Una comuna sin manzanas (sin área
    urbana) devuelve una colección vacía.
    """
    with bd.conexion() as con:
        return con.execute(SQL_MANZANAS, (ATRIBUCION_MANZANAS, comuna)).fetchone()[0]


@router.get("/equipamiento")
def equipamiento(region: int = Query(default=config.ID_REGION_POR_DEFECTO),
                 comuna: int | None = Query(default=None, description="id_comuna; sin él, toda la región")):
    """Escuelas, jardines, centros de salud, bomberos y policía (OpenStreetMap)."""
    with bd.conexion() as con:
        return con.execute(SQL_EQUIPAMIENTO,
                           (ATRIBUCION_OSM, region, comuna, comuna)).fetchone()[0]


# --------------------------------------------------------------------------
# Población del Censo 2024, urbana y rural (migración 019)
# --------------------------------------------------------------------------

ATRIBUCION_CENSO24 = "INE, Censo 2024 por manzana y entidad rural"

# Las entidades rurales son polígonos grandes y de borde detallado: se
# simplifican a ~5 m, que no cambia en qué celdas de 30 m caen.
SQL_POBLACION = """
SELECT json_build_object(
         'type', 'FeatureCollection',
         'atribucion', %s::text,
         'anio', 2024,
         'cobertura', 'Población urbana y rural: manzanas, aldeas y entidades rurales.',
         'features', COALESCE(json_agg(json_build_object(
             'type', 'Feature',
             'geometry', ST_AsGeoJSON(CASE WHEN u.tipo = 'entidad_rural'
                                           THEN ST_SimplifyPreserveTopology(u.geom, 0.00005)
                                           ELSE u.geom END, 6)::json,
             'properties', json_build_object(
                 'id', u.id_unidad, 'tipo', u.tipo, 'categoria', u.categoria,
                 'nombre', u.nombre, 'personas', u.personas, 'viviendas', u.viviendas))), '[]'::json)
       )
FROM   territorio.unidad_censal u
WHERE  u.id_comuna = %s
"""

SQL_AGRICOLA = """
SELECT a.id_comuna, c.nombre, a.fuente, a.anio, a.ha_evaluadas, a.ha_cultivo, a.ha_pradera,
       a.ha_cultivo_susceptible, a.ha_pradera_susceptible, a.corte_susceptible
FROM   indicadores.cobertura_agricola a
JOIN   territorio.comuna c USING (id_comuna)
WHERE  a.id_region = %s
ORDER  BY a.ha_cultivo_susceptible DESC NULLS LAST, c.nombre
"""


def _num(v):
    return float(v) if v is not None else None


@router.get("/poblacion")
def poblacion(comuna: int = Query(..., description="id_comuna (código CUT)")):
    """Unidades censales 2024 de una comuna con personas y viviendas: manzanas
    urbanas, manzanas de aldeas y entidades rurales. Cubre también el campo,
    que es donde viven los usuarios de INDAP."""
    with bd.conexion() as con:
        return con.execute(SQL_POBLACION, (ATRIBUCION_CENSO24, comuna)).fetchone()[0]


@router.get("/agricola")
def agricola(region: int = Query(default=config.ID_REGION_POR_DEFECTO)):
    """Hectáreas de cultivo y pradera por comuna (ESA WorldCover 10 m) y
    cuántas quedan sobre el corte de "Alta" del índice de inundación."""
    with bd.conexion() as con:
        filas = con.execute(SQL_AGRICOLA, (region,)).fetchall()
    return {
        "fuente": "ESA WorldCover 10 m 2021 v200 (CC BY 4.0)",
        "nota": ("Cultivo = clase 40 y pradera = clase 30 de WorldCover. Los frutales densos "
                 "pueden caer en cobertura arbórea y no contarse como cultivo."),
        "comunas": [{
            "id_comuna": f[0], "nombre": f[1], "fuente": f[2], "anio": f[3],
            "ha_evaluadas": _num(f[4]), "ha_cultivo": _num(f[5]), "ha_pradera": _num(f[6]),
            "ha_cultivo_susceptible": _num(f[7]), "ha_pradera_susceptible": _num(f[8]),
            "corte_susceptible": _num(f[9]),
        } for f in filas],
    }
