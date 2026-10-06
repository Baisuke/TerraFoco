# -*- coding: utf-8 -*-
"""
Ciudades y pueblos de la región (Límite Urbano Censal 2017 del INE).

Los usa el visor de inundaciones para marcar las localidades de una comuna y
decir qué sector de cuál corre más riesgo. El cálculo del riesgo por
localidad se hace en el navegador, sobre la misma grilla de 30 m que está
pintada: así responde al umbral que la persona mueve, sin ir al servidor
por cada ajuste.
"""
from fastapi import APIRouter, Query

import bd
import config

router = APIRouter(prefix="/localidades", tags=["territorio"])

SQL_GEOJSON = """
SELECT json_build_object(
         'type', 'FeatureCollection',
         'atribucion', 'INE, Límite Urbano Censal 2017 · copia del Observatorio de Ciudades UC (CC BY-NC 4.0)',
         'features', COALESCE(json_agg(ST_AsGeoJSON(l.*)::json ORDER BY l.id_comuna, l.nombre), '[]'::json)
       )
FROM  (SELECT l.id_ciudad, l.id_comuna, l.nombre, l.categoria, l.tipo,
              round((ST_Area(l.geom::geography) / 10000)::numeric, 1) AS superficie_ha,
              l.geom
       FROM   territorio.ciudad l
       JOIN   territorio.comuna c USING (id_comuna)
       WHERE  c.id_region = %s
         AND  (%s::int IS NULL OR l.id_comuna = %s::int)) l
"""


@router.get("")
def localidades(region: int = Query(default=config.ID_REGION_POR_DEFECTO),
                comuna: int | None = Query(default=None, description="id_comuna; sin él, todas")):
    """GeoJSON de las ciudades y pueblos de la región, o de una comuna."""
    with bd.conexion() as con:
        return con.execute(SQL_GEOJSON, (region, comuna, comuna)).fetchone()[0]
