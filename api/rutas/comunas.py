# -*- coding: utf-8 -*-
"""
Comunas de la región activa.

Este endpoint es el hito del Sprint 0: cuando devuelva GeoJSON válido y el
visor lo dibuje, el circuito completo está validado.
"""
from fastapi import APIRouter, HTTPException, Query

import bd
import config

router = APIRouter(prefix="/comunas", tags=["territorio"])

SQL_GEOJSON = """
SELECT json_build_object(
         'type', 'FeatureCollection',
         'features', COALESCE(json_agg(ST_AsGeoJSON(c.*)::json), '[]'::json)
       )
FROM  (SELECT id_comuna, nombre, provincia, superficie_km2, geom
       FROM   territorio.comuna
       WHERE  id_region = %s) c
"""

SQL_LISTA = """
SELECT id_comuna, nombre, provincia, superficie_km2
FROM   territorio.comuna
WHERE  id_region = %s
ORDER  BY nombre
"""

# NDVI y pendiente por comuna, de lo que el motor ya guarda:
#   - NDVI: la mediana de verano que acompaña al factor C. Hay una fila por
#     corrida de la ingesta; se prefiere la de 30 m, que es la resolución de
#     las teselas del visor, y dentro de ella la más reciente.
#   - Pendiente: la media comunal en %, sobre NASADEM (ingesta.zonal).
SQL_TERRENO = """
SELECT c.id_comuna, c.nombre, n.ndvi, n.anio, p.valor
FROM   territorio.comuna c
LEFT   JOIN LATERAL (
         SELECT (f.detalle->>'ndvi_mediana')::float AS ndvi, f.anio
         FROM   indicadores.factor f
         WHERE  f.id_comuna = c.id_comuna AND f.factor = 'C'
           AND  f.detalle->>'ndvi_mediana' IS NOT NULL
         ORDER  BY (f.detalle->>'resolucion_m') = '30' DESC, f.calculado_en DESC
         LIMIT  1
       ) n ON true
LEFT   JOIN LATERAL (
         SELECT v.valor
         FROM   indicadores.variable_inundacion v
         WHERE  v.id_comuna = c.id_comuna AND v.variable = 'pendiente'
         ORDER  BY v.calculado_en DESC
         LIMIT  1
       ) p ON true
WHERE  c.id_region = %s
ORDER  BY c.nombre
"""


@router.get("")
def listar(region: int = Query(default=config.ID_REGION_POR_DEFECTO)):
    """Listado simple, sin geometría. Útil para poblar selectores."""
    with bd.conexion() as con:
        filas = con.execute(SQL_LISTA, (region,)).fetchall()
    return [
        {"id_comuna": f[0], "nombre": f[1], "provincia": f[2],
         "superficie_km2": float(f[3]) if f[3] is not None else None}
        for f in filas
    ]


# Las dos erosiones por comuna, lado a lado. Misma regla que
# indicadores.v_pertinencia para elegir la fila vigente: la del año más
# reciente y, dentro de él, la última calculada.
SQL_EROSION = """
WITH ultima AS (
  SELECT DISTINCT ON (id_comuna, origen)
         id_comuna, origen, perdida_ton_ha, clase, anio, en_dominio
  FROM   indicadores.erosion
  ORDER  BY id_comuna, origen, anio DESC, calculado_en DESC
)
SELECT c.id_comuna, c.nombre,
       ci.perdida_ton_ha, ci.clase, ci.anio,
       tf.perdida_ton_ha, tf.clase, tf.anio, tf.en_dominio
FROM   territorio.comuna c
LEFT   JOIN ultima ci ON ci.id_comuna = c.id_comuna AND ci.origen = 'CIREN'
LEFT   JOIN ultima tf ON tf.id_comuna = c.id_comuna AND tf.origen = 'TerraFoco'
WHERE  c.id_region = %s
ORDER  BY c.nombre
"""


@router.get("/erosion")
def erosion(region: int = Query(default=config.ID_REGION_POR_DEFECTO)):
    """Erosión del inventario CIREN y del cálculo propio, por comuna.

    /pertinencia entrega UNA erosión, la del origen elegido, porque es la que
    alimenta el índice. El visor y el panel necesitan las dos a la vez para
    compararlas (UC-06): hasta ahora la "línea base CIREN 2010" que se
    comparaba era un valor derivado de la erosión, no un dato. CIREN no tiene
    datos de 2010 cargados: su inventario entra como el año con que se cargó.

    `terrafoco_en_dominio` va aparte porque el cálculo propio sobreestima en
    la precordillera: la interfaz decide si lo muestra, como en /pertinencia.
    """
    def num(v):
        return round(float(v), 2) if v is not None else None
    with bd.conexion() as con:
        filas = con.execute(SQL_EROSION, (region,)).fetchall()
    return [
        {"id_comuna": f[0], "nombre": f[1],
         "erosion_ciren": num(f[2]), "clase_ciren": f[3], "anio_ciren": f[4],
         "erosion_terrafoco": num(f[5]), "clase_terrafoco": f[6], "anio_terrafoco": f[7],
         "terrafoco_en_dominio": f[8]}
        for f in filas
    ]


# Los cinco factores con que se calculó la erosión propia vigente de cada
# comuna. Los valores salen de la fila de indicadores.erosion y no de
# indicadores.factor: la erosión se calculó con ESOS, y así el producto de la
# ficha da exactamente la erosión que muestra. De indicadores.factor se toma
# solo la procedencia —fuente, año, detalle— de la versión que el cálculo
# leyó: la más reciente anterior a él, con la misma regla que
# motor/indicadores/almacen.py.
SQL_FACTORES = """
WITH e AS (
  SELECT DISTINCT ON (id_comuna)
         id_comuna, anio, factor_r, factor_k, factor_ls, factor_c, factor_p,
         perdida_ton_ha, clase, en_dominio, calculado_en
  FROM   indicadores.erosion
  WHERE  origen = 'TerraFoco' AND id_region = %(r)s
  ORDER  BY id_comuna, anio DESC, calculado_en DESC
)
SELECT c.id_comuna, c.nombre, e.anio,
       e.factor_r, e.factor_k, e.factor_ls, e.factor_c, e.factor_p,
       e.perdida_ton_ha, e.clase, e.en_dominio, m.meta
FROM   territorio.comuna c
LEFT   JOIN e USING (id_comuna)
LEFT   JOIN LATERAL (
         SELECT json_object_agg(v.factor, json_build_object(
                  'fuente', v.fuente, 'anio', v.anio, 'detalle', v.detalle)) AS meta
         FROM  (SELECT DISTINCT ON (f.factor) f.factor, f.fuente, f.anio, f.detalle
                FROM   indicadores.factor f
                WHERE  f.id_comuna = c.id_comuna
                  AND  f.calculado_en <= e.calculado_en AND f.anio <= e.anio
                ORDER  BY f.factor, f.anio DESC, f.calculado_en DESC) v
       ) m ON e.id_comuna IS NOT NULL
WHERE  c.id_region = %(r)s
ORDER  BY c.nombre
"""

# Erosividad sobre la cual el cálculo propio queda fuera del dominio de
# validez. Es R_MAXIMO_CONFIABLE de motor/indicadores/rusle.py: la API no
# importa el motor, y test_factores comprueba que en_dominio lo respete.
R_MAXIMO_CONFIABLE = 2000.0


@router.get("/factores")
def factores(region: int = Query(default=config.ID_REGION_POR_DEFECTO)):
    """Factores RUSLE del cálculo propio vigente, por comuna.

    La ficha de comuna mostraba cinco factores derivados de la erosión con
    fórmulas de la fase del prototipo no funcional: K se despejaba de la
    ecuación y todo "cuadraba" por construcción. Estos son los medidos, cada
    uno con su fuente. Solo existen para el cálculo propio: el inventario de
    CIREN es una clasificación del terreno y no se descompone en factores.

    `factores` es null si la comuna aún no tiene cálculo propio.
    """
    claves = ("R", "K", "LS", "C", "P")
    with bd.conexion() as con:
        filas = con.execute(SQL_FACTORES, {"r": region}).fetchall()
    salida = []
    for f in filas:
        fila = {"id_comuna": f[0], "nombre": f[1], "anio": f[2],
                "perdida_ton_ha": float(f[8]) if f[8] is not None else None,
                "clase": f[9], "en_dominio": f[10], "factores": None}
        if f[2] is not None:
            meta = f[11] or {}
            fila["factores"] = {
                k: dict({"valor": float(v)}, **(meta.get(k) or
                        {"fuente": None, "anio": None, "detalle": None}))
                for k, v in zip(claves, f[3:8])
            }
        salida.append(fila)
    return {"r_maximo": R_MAXIMO_CONFIABLE, "comunas": salida}


SQL_SIRSD = """
SELECT s.anio, s.planes, s.agricultores, s.incentivo,
       s.incentivo / u.uf_promedio, s.ha_reales,
       CASE WHEN s.inversion_anomala THEN NULL ELSE s.inversion_total END,
       s.inversion_anomala
FROM   programas.sirsd_anual s
LEFT   JOIN programas.uf_anual u USING (anio)
WHERE  s.id_comuna = %s
ORDER  BY s.anio
"""


# Reserva estadística: una celda comuna-año con menos planes que esto se
# publica sin cifras. Con 1 o 2 planes el incentivo del año es prácticamente
# el de un productor, identificable por quien conoce la comuna (52 celdas en
# O'Higgins). Los totales 2012-2025 y el índice no cambian: el menor total
# comunal es de 9 planes. Ver docs/17-serie-sirsd.md, §5.
MINIMO_PLANES_PUBLICABLE = 3


def _anio_sirsd(f):
    if f[1] < MINIMO_PLANES_PUBLICABLE:
        return {"anio": f[0], "reservado": True, "planes": None, "agricultores": None,
                "incentivo": None, "incentivo_uf": None, "ha_reales": None,
                "inversion_total": None, "inversion_anomala": None}
    return {"anio": f[0], "reservado": False, "planes": f[1], "agricultores": f[2],
            "incentivo": float(f[3]),
            "incentivo_uf": round(float(f[4]), 1) if f[4] is not None else None,
            "ha_reales": float(f[5]) if f[5] is not None else None,
            "inversion_total": float(f[6]) if f[6] is not None else None,
            "inversion_anomala": f[7]}


@router.get("/{id_comuna}/sirsd")
def sirsd(id_comuna: int):
    """Serie anual del SIRSD-S de una comuna (programas.sirsd_anual).

    La ficha de comuna mostraba una serie inventada: el monto total repartido
    en siete años con una fórmula. Esta es la ejecución por año de la
    declaración jurada. La inversión total se omite (null) en la celda con
    inversión anómala; el incentivo de esa celda es correcto y va.

    Los años con menos de 3 planes van `reservado: true` y sin cifras.
    """
    with bd.conexion() as con:
        filas = con.execute(SQL_SIRSD, (id_comuna,)).fetchall()
    return [_anio_sirsd(f) for f in filas]


@router.get("/terreno")
def terreno(region: int = Query(default=config.ID_REGION_POR_DEFECTO)):
    """NDVI de verano y pendiente media por comuna.

    Las capas "Cobertura vegetal" y "Pendiente" del visor pintaban hasta
    ahora un valor derivado de la erosión, de la fase del prototipo no
    funcional. Con esto pintan el dato medido. `null` donde el motor aún no
    lo calculó: el visor lo muestra como "sin dato", no como cero.
    """
    with bd.conexion() as con:
        filas = con.execute(SQL_TERRENO, (region,)).fetchall()
    return [
        {"id_comuna": f[0], "nombre": f[1],
         "ndvi_mediana": round(f[2], 3) if f[2] is not None else None,
         "ndvi_anio": f[3],
         "pendiente_media": round(float(f[4]), 1) if f[4] is not None else None}
        for f in filas
    ]


@router.get("/geojson")
def geojson(region: int = Query(default=config.ID_REGION_POR_DEFECTO)):
    """Geometrías en GeoJSON, listas para MapLibre."""
    fila = bd.una_fila(SQL_GEOJSON, (region,))
    if fila is None or fila[0] is None:
        raise HTTPException(404, "No hay comunas cargadas para la región %d" % region)
    return fila[0]
