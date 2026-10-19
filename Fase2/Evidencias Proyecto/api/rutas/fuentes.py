# -*- coding: utf-8 -*-
"""
Catálogo de fuentes de datos: UC-10.

Es la única parte de la API que escribe. El resto del sistema es analítico y
de solo lectura: los indicadores los produce el motor por lotes, no una
petición HTTP.

Aquí sí corresponde escribir, porque el catálogo lo administra una persona.
Registrar una fuente nueva y marcar en qué estado quedó la última carga son
decisiones humanas, no resultados de un cálculo.

El estado se valida contra la misma lista que la restricción CHECK de la
tabla. Duplicar la lista en el código es deliberado: así la API responde 422
con un mensaje claro en vez de dejar que la base rechace el INSERT con un
error de integridad que el visor no sabe interpretar.
"""
from datetime import datetime
from typing import Optional

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field

import bd
from seguridad import requiere_admin

router = APIRouter(prefix="/fuentes", tags=["administración"])

ESTADOS = ("ok", "parcial", "pendiente", "error")

CAMPOS = ("id_fuente, codigo, nombre, organismo, tipo, url_base, estado, "
          "ultima_carga, nota")

# Lo que dice el catalogo y lo que dice la bitacora son dos cosas distintas.
# `estado` es administrativo: lo declara una persona. Cuando se cargo por
# ultima vez y como termino sale de las ejecuciones reales del motor, con un
# LATERAL que toma solo la ultima de cada fuente. Sin esto habria que
# mantener a mano una fecha que envejece sola.
# Se califican con `f.` una por una y no con un reemplazo sobre CAMPOS:
# `estado` existe en las dos tablas del JOIN y la consulta seria ambigua.
SQL_LISTA = """
SELECT f.id_fuente, f.codigo, f.nombre, f.organismo, f.tipo, f.url_base,
       f.estado, f.ultima_carga, f.nota,
       u.inicio, u.estado, u.registros, u.proceso
FROM   operacion.fuente f
LEFT   JOIN LATERAL (
         SELECT e.inicio, e.estado, e.registros, e.proceso
         FROM   operacion.ejecucion_proceso e
         WHERE  e.id_fuente = f.id_fuente
         ORDER  BY e.inicio DESC
         LIMIT  1
       ) u ON true
ORDER  BY f.id_fuente
"""


class FuenteNueva(BaseModel):
    # Obligatorio desde la migracion 012, y no se autogenera: es la llave con
    # la que el motor enlaza sus ejecuciones, via Bitacora(fuente="..."). Un
    # codigo inventado como "fuente-36" no calzaria con ningun modulo de
    # ingesta y la fuente quedaria desconectada de la bitacora para siempre.
    # El formato es el de los codigos que siembra la 012: ciren, cr2met,
    # ide_hidrografia.
    codigo: str = Field(pattern=r"^[a-z][a-z0-9_]{1,29}$")
    nombre: str = Field(min_length=3, max_length=160)
    organismo: str = Field(min_length=2, max_length=80)
    tipo: str = Field(min_length=2, max_length=40)
    url_base: Optional[str] = None
    estado: str = "pendiente"
    nota: Optional[str] = Field(default=None, max_length=250)


class CambioDeFuente(BaseModel):
    """Todo opcional: se actualiza solo lo que venga en el cuerpo."""
    estado: Optional[str] = None
    url_base: Optional[str] = None
    marcar_carga: bool = False


def _fila(f, con_ejecucion=False):
    d = {
        "id_fuente": f[0], "codigo": f[1], "nombre": f[2], "organismo": f[3],
        "tipo": f[4], "url_base": f[5], "estado": f[6],
        "ultima_carga": f[7].isoformat() if f[7] else None,
        "nota": f[8],
    }
    if con_ejecucion:
        # None en los tres cuando la fuente nunca se cargo: el visor tiene que
        # poder distinguir "nunca se ejecuto" de "se ejecuto y dio cero".
        d["ultima_ejecucion"] = f[9].isoformat() if f[9] else None
        d["ultimo_estado"] = f[10]
        d["ultimos_registros"] = f[11]
        d["ultimo_proceso"] = f[12]
    return d


def _validar_estado(estado):
    if estado is not None and estado not in ESTADOS:
        raise HTTPException(
            status_code=422,
            detail="estado debe ser uno de: %s" % ", ".join(ESTADOS))


@router.get("")
def listar():
    """Catálogo completo con la última ejecución real de cada fuente."""
    with bd.conexion() as con:
        filas = con.execute(SQL_LISTA).fetchall()
    return [_fila(f, con_ejecucion=True) for f in filas]


@router.get("/{id_fuente}")
def obtener(id_fuente: int = Path(ge=1)):
    with bd.conexion() as con:
        fila = con.execute(
            "SELECT %s FROM operacion.fuente WHERE id_fuente = %%s" % CAMPOS,
            (id_fuente,)).fetchone()
    if fila is None:
        raise HTTPException(status_code=404, detail="fuente no encontrada")
    return _fila(fila)


# Las dos escrituras piden la clave de administración (RF-31). Las lecturas
# siguen abiertas: el catálogo es información pública del sistema.
@router.post("", status_code=201, dependencies=[Depends(requiere_admin)])
def registrar(fuente: FuenteNueva):
    """Da de alta una fuente. Devuelve la fila tal como quedó almacenada."""
    _validar_estado(fuente.estado)
    sql = """
        INSERT INTO operacion.fuente
               (codigo, nombre, organismo, tipo, url_base, estado, nota)
        VALUES (%%s, %%s, %%s, %%s, %%s, %%s, %%s)
        RETURNING %s
    """ % CAMPOS
    try:
        with bd.transaccion() as con:
            fila = con.execute(sql, (
                fuente.codigo, fuente.nombre, fuente.organismo, fuente.tipo,
                fuente.url_base, fuente.estado, fuente.nota)).fetchone()
    except psycopg.errors.UniqueViolation:
        # Sin esto un codigo repetido llegaba como 500, que dice "fallo el
        # servidor" cuando en realidad el pedido es el que esta mal.
        raise HTTPException(
            status_code=409,
            detail="ya existe una fuente con el codigo '%s'" % fuente.codigo)
    return _fila(fila)


@router.patch("/{id_fuente}", dependencies=[Depends(requiere_admin)])
def actualizar(cambio: CambioDeFuente, id_fuente: int = Path(ge=1)):
    """Cambia el estado de una fuente, su URL, o marca que acaba de cargarse."""
    _validar_estado(cambio.estado)

    asignaciones, valores = [], []
    if cambio.estado is not None:
        asignaciones.append("estado = %s")
        valores.append(cambio.estado)
    if cambio.url_base is not None:
        asignaciones.append("url_base = %s")
        valores.append(cambio.url_base)
    if cambio.marcar_carga:
        asignaciones.append("ultima_carga = %s")
        valores.append(datetime.now())

    if not asignaciones:
        raise HTTPException(status_code=422,
                            detail="no se indicó ningún cambio")

    sql = "UPDATE operacion.fuente SET %s WHERE id_fuente = %%s RETURNING %s" % (
        ", ".join(asignaciones), CAMPOS)
    with bd.transaccion() as con:
        fila = con.execute(sql, tuple(valores) + (id_fuente,)).fetchone()
    if fila is None:
        raise HTTPException(status_code=404, detail="fuente no encontrada")
    return _fila(fila)
