# -*- coding: utf-8 -*-
"""
Índice de pertinencia territorial: UC-05.

Responde la pregunta que justifica el proyecto: ¿la inversión pública está
llegando a las comunas donde el problema es más grave?

    pertinencia = necesidad_norm - inversion_norm

Positivo significa mucho problema y poca inversión; negativo, lo contrario.

La normalización ocurre en la consulta, no en el almacenamiento: por eso el
parámetro `origen` puede alternar entre la línea base de CIREN y el cálculo
propio sin migrar un solo dato, y comparar ambos es el caso de uso UC-06.
"""
from fastapi import APIRouter, HTTPException, Query

import bd
import config
from focalizacion import brecha_uf, focalizacion

router = APIRouter(prefix="/pertinencia", tags=["indicadores"])

# Desde la migración 013 la inversión es el incentivo del SIRSD-S 2012-2025,
# en UF, por hectárea con erosión Severa o superior del cálculo propio. Los
# campos del final dejan ver cada paso de esa cuenta.
CAMPOS = """
    id_comuna, nombre, provincia, superficie_km2, origen, anio_erosion,
    en_dominio,
    perdida_ton_ha, clase, ha_bonificadas, monto_total, beneficiarios,
    precision_dato, necesidad_norm, inversion_norm, pertinencia,
    planes, incentivo_uf, ha_erosion_severa, inversion_uf_ha,
    anio_desde, anio_hasta
"""

# Por defecto solo el dominio validado. Quien quiera ver la precordillera lo
# pide explicitamente: es dato real, pero el modelo sobreestima ahi.
#
# La mediana regional de UF/ha va en cada fila porque de ella sale la brecha
# en UF (focalizacion.py). Se calcula solo con las comunas del dominio: las
# de la precordillera tienen denominadores inflados (0,003 UF/ha en Machalí)
# y bajarían la meta de todas las demás.
SQL_LISTA = """
WITH m AS (
  SELECT id_region, origen,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY inversion_uf_ha) AS mediana
  FROM   indicadores.v_pertinencia
  WHERE  en_dominio
  GROUP  BY id_region, origen
)
SELECT %s, m.mediana
FROM   indicadores.v_pertinencia p
LEFT   JOIN m USING (id_region, origen)
WHERE  p.id_region = %%s AND origen = %%s
  AND  (%%s OR p.en_dominio)
ORDER  BY p.pertinencia DESC NULLS LAST
""" % CAMPOS

SQL_ORIGENES = """
SELECT origen, count(*) AS comunas, max(anio_erosion) AS anio
FROM   indicadores.v_pertinencia
WHERE  id_region = %s
GROUP  BY origen
ORDER  BY origen
"""


def _fila(f):
    def num(v):
        return float(v) if v is not None else None
    return {
        "id_comuna": f[0], "nombre": f[1], "provincia": f[2],
        "superficie_km2": num(f[3]), "origen": f[4], "anio_erosion": f[5],
        "en_dominio": bool(f[6]),
        "perdida_ton_ha": num(f[7]), "clase": f[8],
        "ha_bonificadas": num(f[9]), "monto_total": num(f[10]),
        "beneficiarios": f[11], "precision_dato": f[12],
        "necesidad_norm": num(f[13]), "inversion_norm": num(f[14]),
        "pertinencia": num(f[15]),
        # monto_total es el incentivo en pesos de cada año (nominal); el
        # índice usa incentivo_uf. beneficiarios suma agricultores por año:
        # quien tuvo planes en dos años cuenta dos veces. planes no repite.
        "planes": f[16], "incentivo_uf": num(f[17]),
        "ha_erosion_severa": num(f[18]), "inversion_uf_ha": num(f[19]),
        "anio_desde": f[20], "anio_hasta": f[21],
        # Cuánto incentivo falta para llegar a la mediana regional. Fuera del
        # dominio no se calcula: el denominador es el que sobreestima.
        "mediana_uf_ha": num(f[22]),
        "brecha_uf": (round(brecha_uf(num(f[19]), num(f[18]), num(f[22])), 1)
                      if f[6] and f[19] is not None and f[22] is not None else None),
    }


@router.get("/origenes")
def origenes(region: int = Query(default=config.ID_REGION_POR_DEFECTO)):
    """Qué orígenes de erosión hay cargados. Sirve para poblar el selector."""
    with bd.conexion() as con:
        filas = con.execute(SQL_ORIGENES, (region,)).fetchall()
    return [{"origen": f[0], "comunas": f[1], "anio": f[2]} for f in filas]


# Una fila por comuna del índice, con su incentivo en UF de cada año.
SQL_SERIE_INDICE = """
SELECT p.id_comuna, p.nombre, p.perdida_ton_ha, p.ha_erosion_severa,
       COALESCE((SELECT json_object_agg(s.anio, s.incentivo / u.uf_promedio)
                 FROM   programas.sirsd_anual s
                 JOIN   programas.uf_anual u USING (anio)
                 WHERE  s.id_comuna = p.id_comuna), '{}'::json)
FROM   indicadores.v_pertinencia p
WHERE  p.id_region = %s AND p.origen = %s AND p.en_dominio
  AND  p.ha_erosion_severa > 0
"""

# El programa en toda la región, con las 33 comunas: para ver cuánto había
# que repartir cada año, no solo cómo se repartió.
SQL_TOTAL_REGION = """
SELECT s.anio, sum(s.incentivo / u.uf_promedio), sum(s.planes)
FROM   programas.sirsd_anual s
JOIN   programas.uf_anual u USING (anio)
JOIN   territorio.comuna c USING (id_comuna)
WHERE  c.id_region = %s
GROUP  BY s.anio
ORDER  BY s.anio
"""

SQL_UF_ULTIMA = """
SELECT anio, uf_promedio FROM programas.uf_anual ORDER BY anio DESC LIMIT 1
"""


@router.get("/evolucion")
def evolucion(region: int = Query(default=config.ID_REGION_POR_DEFECTO),
              origen: str = Query(default="CIREN")):
    """Cómo se repartió el incentivo del SIRSD-S cada año, 2012-2025.

    Para las comunas del índice: qué parte del incentivo de cada año fue a
    las más erosionadas (tasa sobre la mediana) frente a la parte de la
    superficie severa que tienen. Ver focalizacion.py.
    """
    with bd.conexion() as con:
        filas = con.execute(SQL_SERIE_INDICE, (region, origen)).fetchall()
        region_anual = con.execute(SQL_TOTAL_REGION, (region,)).fetchall()
        uf = con.execute(SQL_UF_ULTIMA).fetchone()
    if not filas or not region_anual:
        raise HTTPException(404, "Sin serie del SIRSD-S o sin índice para la región "
                                 "%d y el origen %r" % (region, origen))
    comunas = [{"id_comuna": f[0], "nombre": f[1], "erosion": float(f[2]),
                "ha_severa": float(f[3]),
                "uf": {int(a): float(v) for a, v in (f[4] or {}).items()}}
               for f in filas]
    anios = [f[0] for f in region_anual]
    datos = focalizacion(comunas, anios)
    total = {f[0]: (float(f[1]), int(f[2])) for f in region_anual}
    for s in datos["serie"]:
        s["incentivo_uf_region"] = round(total[s["anio"]][0], 1)
        s["planes_region"] = total[s["anio"]][1]
    datos["origen"] = origen
    datos["uf_referencia"] = {"anio": uf[0], "valor": float(uf[1])} if uf else None
    return datos


@router.get("")
def listar(region: int = Query(default=config.ID_REGION_POR_DEFECTO),
           origen: str = Query(default="CIREN"),
           incluir_fuera_de_dominio: bool = Query(default=False),
           limite: int = Query(default=0, ge=0, le=500)):
    """Comunas ordenadas por brecha, de mayor a menor.

    Por defecto se omiten las comunas fuera del dominio de validez del modelo
    -la precordillera-, donde la erosividad sobreestima. Se incluyen con
    `incluir_fuera_de_dominio=true`, y cada fila trae `en_dominio` para que la
    interfaz pueda advertirlo.
    """
    with bd.conexion() as con:
        filas = con.execute(SQL_LISTA,
                            (region, origen, incluir_fuera_de_dominio)).fetchall()

    if not filas:
        # Se distingue "no hay dato" de "el origen no existe": el primer caso
        # se resuelve cargando datos, el segundo es un error de quien consulta.
        with bd.conexion() as con:
            disponibles = [f[0] for f in con.execute(SQL_ORIGENES, (region,)).fetchall()]
        raise HTTPException(404, {
            "mensaje": "Sin datos de pertinencia para la region %d y el origen %r"
                       % (region, origen),
            "origenes_disponibles": disponibles,
            "sugerencia": ("Cargar la linea base con: python -m ingesta.ciren "
                           "y la ejecucion con: python -m ingesta.sirsd"),
        })

    datos = [_fila(f) for f in filas]
    return datos[:limite] if limite else datos


@router.get("/{id_comuna}")
def una(id_comuna: int,
        origen: str = Query(default="CIREN")):
    """Ficha de una comuna: UC-03."""
    sql = SQL_LISTA.replace("p.id_region = %s", "p.id_comuna = %s")
    with bd.conexion() as con:
        fila = con.execute(sql, (id_comuna, origen, True)).fetchone()
    if fila is None:
        raise HTTPException(404, "La comuna %d no tiene pertinencia calculada "
                                 "para el origen %r" % (id_comuna, origen))
    return _fila(fila)
