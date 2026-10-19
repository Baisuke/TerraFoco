# -*- coding: utf-8 -*-
"""
Bitácora de ejecuciones: UC-12.

Cada proceso del motor abre una fila al empezar y la cierra al terminar, con
su estado y cuántos registros escribió. Esta ruta la expone para que el panel
de administración muestre qué corrió sin que nadie entre a la base.

Es de solo lectura a propósito. La bitácora la escribe el motor; si la API
pudiera tocarla, el registro dejaría de ser fiable como evidencia de lo que
realmente pasó.
"""
from fastapi import APIRouter, Query

import bd

router = APIRouter(prefix="/ejecuciones", tags=["administración"])

# La duración se calcula aquí y no en el navegador: un proceso sin cerrar
# tiene `fin` nulo, y restar fechas en JavaScript con una de ellas nula da
# NaN, que en pantalla aparece como un hueco sin explicación.
SQL = """
SELECT e.id_proceso,
       e.proceso,
       e.estado,
       e.registros,
       e.inicio,
       e.fin,
       CASE WHEN e.fin IS NULL THEN NULL
            ELSE round(extract(epoch FROM e.fin - e.inicio))::int END AS segundos,
       e.mensaje,
       f.nombre AS fuente
FROM   operacion.ejecucion_proceso e
LEFT   JOIN operacion.fuente f ON f.id_fuente = e.id_fuente
ORDER  BY e.id_proceso DESC
LIMIT  %s
"""


SQL_RESUMEN = """
SELECT count(*)                                       AS total,
       count(*) FILTER (WHERE estado = 'ok')          AS ok,
       count(*) FILTER (WHERE estado = 'error')       AS error,
       count(*) FILTER (WHERE fin IS NULL)            AS en_curso,
       max(inicio)                                    AS ultima,
       coalesce(sum(registros), 0)                    AS registros
FROM   operacion.ejecucion_proceso
"""


@router.get("/resumen")
def resumen():
    """Totales para los indicadores del panel.

    Va aparte de la lista porque el panel necesita el total histórico y la
    lista viene acotada: contar sobre una página de doce filas daría un
    numero que parece el total y no lo es.
    """
    with bd.conexion() as con:
        f = con.execute(SQL_RESUMEN).fetchone()
    return {
        "total": f[0],
        "ok": f[1],
        "error": f[2],
        "en_curso": f[3],
        "ultima": f[4].isoformat() if f[4] else None,
        "registros_escritos": f[5],
    }


@router.get("")
def listar(limite: int = Query(default=20, ge=1, le=200)):
    with bd.conexion() as con:
        filas = con.execute(SQL, (limite,)).fetchall()
    return [{
        "id_proceso": f[0],
        "proceso": f[1],
        "estado": f[2],
        "registros": f[3],
        "inicio": f[4].isoformat() if f[4] else None,
        "fin": f[5].isoformat() if f[5] else None,
        "segundos": f[6],
        "mensaje": f[7],
        "fuente": f[8],
    } for f in filas]
