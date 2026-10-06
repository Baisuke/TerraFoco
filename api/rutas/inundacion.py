# -*- coding: utf-8 -*-
"""
Susceptibilidad a inundación: UC-08.

Expone el índice por comuna que calcula el motor (indicadores.inundacion),
los eventos históricos contra los que se valida (DesInventar) y el resumen
de esa validación. El índice lleva `calibrado`: FALSE mientras la
validación no lo respalde, y la interfaz lo declara así. Un índice no
calibrado se muestra igual; lo que no se hace es presentarlo como si
estuviera validado.
"""
import json
import time
import urllib.parse
import urllib.request

from fastapi import APIRouter, HTTPException, Query

import bd
import config

router = APIRouter(prefix="/inundacion", tags=["indicadores"])

# Última versión de cada comuna. La tabla es histórica: cada recálculo
# inserta, y la más reciente gana.
SQL_LISTA = """
WITH ultima AS (
    SELECT DISTINCT ON (id_comuna)
           id_comuna, susceptibilidad, clase, calibrado,
           pendiente_media, acum_flujo, dist_cauce_m, indice_twi, calculado_en
    FROM   indicadores.susceptibilidad_inundacion
    WHERE  id_region = %s
    ORDER  BY id_comuna, calculado_en DESC
),
eventos AS (
    SELECT id_comuna, count(*) AS n, min(anio) AS desde, max(anio) AS hasta
    FROM   indicadores.evento_inundacion
    WHERE  id_region = %s AND id_comuna IS NOT NULL
    GROUP  BY id_comuna
)
SELECT c.id_comuna, c.nombre, c.provincia, c.superficie_km2,
       u.susceptibilidad, u.clase, u.calibrado,
       u.pendiente_media, u.acum_flujo, u.dist_cauce_m, u.indice_twi,
       COALESCE(e.n, 0), e.desde, e.hasta, u.calculado_en::date
FROM   territorio.comuna c
JOIN   ultima u USING (id_comuna)
LEFT   JOIN eventos e USING (id_comuna)
WHERE  c.id_region = %s
ORDER  BY u.susceptibilidad DESC
"""

SQL_EVENTOS = """
SELECT e.id_evento, e.id_comuna, COALESCE(c.nombre, e.comuna_texto), e.tipo, e.causa,
       e.anio, e.mes, e.dia, e.muertos, e.afectados, e.damnificados, e.evacuados,
       e.viviendas_destruidas, e.viviendas_afectadas, e.fuente_cita, e.lugar
FROM   indicadores.evento_inundacion e
LEFT   JOIN territorio.comuna c USING (id_comuna)
WHERE  e.id_region = %s
ORDER  BY e.anio DESC, e.mes DESC NULLS LAST, e.dia DESC NULLS LAST
"""


def _num(v):
    return float(v) if v is not None else None


def _fila(f):
    return {
        "id_comuna": f[0], "nombre": f[1], "provincia": f[2],
        "superficie_km2": _num(f[3]),
        "susceptibilidad": _num(f[4]), "clase": f[5], "calibrado": bool(f[6]),
        "pendiente_media": _num(f[7]), "acum_flujo": _num(f[8]),
        "dist_cauce_m": _num(f[9]), "indice_twi": _num(f[10]),
        "eventos": f[11], "eventos_desde": f[12], "eventos_hasta": f[13],
        "calculado_en": f[14].isoformat() if f[14] else None,
    }


@router.get("")
def listar(region: int = Query(default=config.ID_REGION_POR_DEFECTO)):
    """Comunas ordenadas por susceptibilidad, con sus eventos históricos."""
    with bd.conexion() as con:
        filas = con.execute(SQL_LISTA, (region, region, region)).fetchall()
    if not filas:
        raise HTTPException(404, {
            "mensaje": "Sin índice de inundación para la región %d" % region,
            "sugerencia": "Calcularlo con: python -m indicadores.inundacion",
        })
    return [_fila(f) for f in filas]


@router.get("/eventos")
def eventos(region: int = Query(default=config.ID_REGION_POR_DEFECTO)):
    """Eventos históricos de inundación y aluvión (DesInventar, 1970-2014).

    Vienen de prensa y sobrerrepresentan las comunas pobladas. Sirven para
    validar el índice, no para entrenarlo: eso lo dice también la respuesta.
    """
    with bd.conexion() as con:
        filas = con.execute(SQL_EVENTOS, (region,)).fetchall()
    return {
        "fuente": "DesInventar (UNDRR / ONEMI)",
        "advertencia": ("Registros de prensa 1970-2014 a nivel comunal, sin coordenadas. "
                        "Sobrerrepresentan las comunas pobladas."),
        "total": len(filas),
        "eventos": [{
            "id": f[0], "id_comuna": f[1], "comuna": f[2], "tipo": f[3], "causa": f[4],
            "anio": f[5], "mes": f[6], "dia": f[7],
            "muertos": f[8], "afectados": f[9], "damnificados": f[10], "evacuados": f[11],
            "viviendas_destruidas": f[12], "viviendas_afectadas": f[13],
            "fuente": f[14], "lugar": f[15],
        } for f in filas],
    }


@router.get("/validacion")
def validacion(region: int = Query(default=config.ID_REGION_POR_DEFECTO)):
    """Qué fracción de los eventos cae en comunas Alta o Muy alta, y qué
    daría el azar. La diferencia entre ambas es lo que vale."""
    with bd.conexion() as con:
        filas = con.execute(SQL_LISTA, (region, region, region)).fetchall()
    if not filas:
        raise HTTPException(404, "Sin índice de inundación para la región %d" % region)
    comunas = [_fila(f) for f in filas]
    altas = [c for c in comunas if c["clase"] in ("Alta", "Muy alta")]
    total_ev = sum(c["eventos"] for c in comunas)
    en_alta = sum(c["eventos"] for c in altas)
    frac = (en_alta / total_ev) if total_ev else None
    azar = len(altas) / len(comunas)
    return {
        "comunas": len(comunas), "comunas_alta": len(altas),
        "eventos": total_ev, "eventos_en_alta": en_alta,
        "fraccion_en_alta": round(frac, 3) if frac is not None else None,
        "fraccion_azar": round(azar, 3),
        "mejora_sobre_azar": round(frac - azar, 3) if frac is not None else None,
        "calibrado": all(c["calibrado"] for c in comunas),
        "lectura": ("El criterio de éxito es que la mayoría de los eventos caiga en "
                    "comunas Alta o Muy alta. Pero si la mayoría de las comunas ya es "
                    "Alta, el azar también lo cumple: lo que vale es la mejora."),
    }


# --------------------------------------------------------------------------
# Red hídrica
# --------------------------------------------------------------------------

# Simplificada a ~30 m: es para mirar dónde corre el agua, no para medir. Sin
# simplificar, los 2.400 tramos de orden 4 o más pesaban cinco veces más.
SQL_CAUCES = """
SELECT json_build_object(
         'type', 'FeatureCollection',
         'atribucion', 'IDE Chile, red hídrica 1:25.000 (2021)',
         'features', COALESCE(json_agg(json_build_object(
             'type', 'Feature',
             'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0003), 5)::json,
             'properties', json_build_object('nombre', nombre, 'tipo', tipo,
                                             'strahler', strahler))), '[]'::json)
       )
FROM   territorio.cauce
WHERE  id_region = %s AND strahler >= %s
"""


@router.get("/cauces")
def cauces(region: int = Query(default=config.ID_REGION_POR_DEFECTO),
           orden_minimo: int = Query(default=4, ge=1, le=12,
                                     description="orden de Strahler mínimo")):
    """Ríos y esteros de la región, para leer el mapa de susceptibilidad.

    El índice usa la distancia a cauces de orden 5 o más; el visor muestra
    desde el 4 para que se vean también los esteros que alimentan a esos.
    """
    with bd.conexion() as con:
        return con.execute(SQL_CAUCES, (region, orden_minimo)).fetchone()[0]


# --------------------------------------------------------------------------
# Lluvia pronosticada
# --------------------------------------------------------------------------
#
# El índice es estático: dice dónde, no cuándo. El pronóstico de lluvia es el
# "cuándo" que el módulo no modela, y ponerlo al lado permite mirar primero
# las comunas susceptibles donde además va a llover. NO es un pronóstico de
# inundación y la respuesta lo dice.
#
# Open-Meteo: modelos de pronóstico numérico, gratis para uso no comercial,
# sin clave. Una sola petición con un punto por comuna. Se guarda media hora
# en memoria: el pronóstico cambia cada pocas horas y así el visor no golpea
# el servicio en cada recarga.

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
VIGENCIA_S = 1800
_cache_pronostico = {}

SQL_PUNTOS = """
WITH ultima AS (
    SELECT DISTINCT ON (id_comuna) id_comuna, clase
    FROM   indicadores.susceptibilidad_inundacion
    WHERE  id_region = %s
    ORDER  BY id_comuna, calculado_en DESC
)
SELECT c.id_comuna, c.nombre, u.clase,
       ST_Y(ST_PointOnSurface(c.geom)), ST_X(ST_PointOnSurface(c.geom))
FROM   territorio.comuna c
LEFT   JOIN ultima u USING (id_comuna)
WHERE  c.id_region = %s
ORDER  BY c.nombre
"""


def consultar_open_meteo(latitudes, longitudes, dias=7):
    """Precipitación diaria por punto. Aparte para poder reemplazarla en las pruebas."""
    url = OPEN_METEO + "?" + urllib.parse.urlencode({
        "latitude": ",".join("%.4f" % x for x in latitudes),
        "longitude": ",".join("%.4f" % x for x in longitudes),
        "daily": "precipitation_sum,precipitation_probability_max",
        "timezone": "America/Santiago",
        "forecast_days": dias,
    })
    pedido = urllib.request.Request(url, headers={"User-Agent": "TerraFoco/1.0"})
    with urllib.request.urlopen(pedido, timeout=15) as r:
        datos = json.load(r)
    # Con un solo punto Open-Meteo devuelve un objeto, con varios una lista.
    return datos if isinstance(datos, list) else [datos]


def _suma(xs):
    return round(sum(x or 0 for x in xs), 1)


def armar_pronostico(puntos, respuestas):
    """Une las comunas con su serie diaria y resume lo que el visor ordena."""
    if len(respuestas) != len(puntos):
        raise ValueError("Open-Meteo devolvió %d puntos para %d comunas"
                         % (len(respuestas), len(puntos)))
    dias = respuestas[0]["daily"]["time"] if respuestas else []
    comunas = []
    for (id_comuna, nombre, clase, lat, lon), r in zip(puntos, respuestas):
        diario = r.get("daily") or {}
        lluvia = [round(x or 0, 1) for x in diario.get("precipitation_sum") or []]
        prob = diario.get("precipitation_probability_max") or [None] * len(lluvia)
        comunas.append({
            "id_comuna": id_comuna, "nombre": nombre, "clase": clase,
            "lat": round(lat, 4), "lon": round(lon, 4),
            "precipitacion": lluvia, "probabilidad": prob,
            "total_72h": _suma(lluvia[:3]), "total_7d": _suma(lluvia),
            "max_diaria": max(lluvia) if lluvia else 0,
        })
    comunas.sort(key=lambda c: (-c["total_72h"], c["nombre"]))
    return {"dias": dias, "comunas": comunas}


@router.get("/pronostico")
def pronostico(region: int = Query(default=config.ID_REGION_POR_DEFECTO)):
    """Lluvia pronosticada para los próximos 7 días, por comuna (Open-Meteo)."""
    guardado = _cache_pronostico.get(region)
    if guardado and time.time() - guardado[0] < VIGENCIA_S:
        return guardado[1]
    with bd.conexion() as con:
        puntos = con.execute(SQL_PUNTOS, (region, region)).fetchall()
    if not puntos:
        raise HTTPException(404, "Sin comunas para la región %d" % region)
    try:
        respuestas = consultar_open_meteo([p[3] for p in puntos], [p[4] for p in puntos])
        cuerpo = armar_pronostico(puntos, respuestas)
    except Exception as e:                      # red caída, cuota, formato
        if guardado:                            # mejor uno viejo, y avisado, que nada
            return dict(guardado[1], vencido=True)
        raise HTTPException(503, {"mensaje": "No se pudo consultar el pronóstico",
                                  "detalle": str(e)[:200]})
    cuerpo.update({
        "fuente": "Open-Meteo (modelos numéricos de pronóstico), open-meteo.com · CC BY 4.0",
        "advertencia": ("Lluvia pronosticada en un punto representativo de cada comuna. "
                        "No es un pronóstico de inundación: el índice dice dónde el terreno "
                        "es susceptible, la lluvia dice cuándo mirar."),
        "consultado": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "vencido": False,
    })
    _cache_pronostico[region] = (time.time(), cuerpo)
    return cuerpo
