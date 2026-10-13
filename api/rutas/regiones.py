# -*- coding: utf-8 -*-
"""
Regiones disponibles y el período de sus datos.

El selector de región de la barra superior se llena desde aquí, no desde una
lista escrita en el front. Es la contraparte de la regla del proyecto:
agregar una región es insertar una fila en `territorio.region`, no tocar
código. Si el front trae la lista escrita a mano, esa regla se rompe en el
único sitio donde el usuario la ve.

Cada región viene además con los años que realmente tiene cargados, por
módulo. Eso reemplaza al selector de año del prototipo, que ofrecía 2026,
2020, 2015 y 2010 —ninguno con dato— y no filtraba nada. Un período que se
lee de la base no puede prometer lo que no hay.
"""
from fastapi import APIRouter, HTTPException, Path

import bd

router = APIRouter(prefix="/regiones", tags=["territorio"])

CAMPOS = """
       r.id_region, r.codigo, r.nombre, r.epsg_trabajo, r.resolucion_m, r.activa,
       (SELECT count(*) FROM territorio.comuna c WHERE c.id_region = r.id_region)
"""

SQL_REGIONES = "SELECT %s FROM territorio.region r ORDER BY r.id_region" % CAMPOS
SQL_UNA = "SELECT %s FROM territorio.region r WHERE r.id_region = %%s" % CAMPOS

# Los años con dato de cada módulo. La ejecución del programa y el indicador
# urbano no llevan id_region: se alcanzan por la comuna. La inversión sale de
# la serie 2012-2025 (migración 013), que es la que usa el índice; la planilla
# de 2021 en programas.ejecucion ya no entra al cálculo.
# Se devuelve el rango y no solo el ultimo anio: los eventos de inundacion van
# de 1972 a 2007 y mostrar "2007" a secas haria creer que es un dato puntual.
SQL_PERIODOS = """
SELECT 'erosion',    min(anio), max(anio) FROM indicadores.erosion WHERE id_region = %(r)s
UNION ALL
SELECT 'inversion',  min(e.anio), max(e.anio) FROM programas.sirsd_anual e
       JOIN territorio.comuna c USING (id_comuna) WHERE c.id_region = %(r)s
UNION ALL
SELECT 'urbano',     min(u.anio), max(u.anio) FROM indicadores.urbano u
       JOIN territorio.comuna c USING (id_comuna) WHERE c.id_region = %(r)s
UNION ALL
SELECT 'inundacion', min(anio), max(anio) FROM indicadores.evento_inundacion
       WHERE id_region = %(r)s
"""


def _periodos(con, id_region):
    filas = con.execute(SQL_PERIODOS, {"r": id_region}).fetchall()
    return {nombre: {"desde": desde, "hasta": hasta}
            for nombre, desde, hasta in filas if hasta is not None}


def _fila(f, periodos):
    return {
        "id_region": f[0], "codigo": f[1], "nombre": f[2],
        "epsg_trabajo": f[3], "resolucion_m": f[4], "activa": f[5],
        "comunas": f[6],
        # Vacío si la región existe pero aún no tiene nada cargado. El front
        # necesita distinguir "sin datos" de "no preguntamos".
        "periodos": periodos,
    }


@router.get("")
def listar():
    """Todas las regiones, con sus comunas y el año más reciente por módulo."""
    with bd.conexion() as con:
        filas = con.execute(SQL_REGIONES).fetchall()
        return [_fila(f, _periodos(con, f[0])) for f in filas]


@router.get("/{id_region}")
def obtener(id_region: int = Path(ge=1)):
    with bd.conexion() as con:
        fila = con.execute(SQL_UNA, (id_region,)).fetchone()
        if fila is None:
            raise HTTPException(404, "La región %d no existe" % id_region)
        return _fila(fila, _periodos(con, id_region))
