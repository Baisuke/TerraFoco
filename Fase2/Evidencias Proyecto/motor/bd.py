# -*- coding: utf-8 -*-
"""Acceso a la base de datos y bitácora de ejecuciones."""
import contextlib
from datetime import datetime

import psycopg

import config


@contextlib.contextmanager
def conexion():
    """Abre una conexión y la cierra siempre, incluso si algo falla."""
    con = psycopg.connect(config.BD_URL)
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def obtener_region(id_region=None):
    """Lee el área de interés desde la base. Nunca desde el código."""
    id_region = id_region or config.ID_REGION
    sql = """
        SELECT id_region, codigo, nombre, epsg_trabajo, resolucion_m,
               ST_XMin(extension), ST_YMin(extension),
               ST_XMax(extension), ST_YMax(extension)
        FROM   territorio.region
        WHERE  id_region = %s
    """
    with conexion() as con:
        fila = con.execute(sql, (id_region,)).fetchone()
    if fila is None:
        raise ValueError(
            "La región %s no existe en territorio.region. "
            "Agregar una región es insertar una fila, no tocar el código." % id_region
        )
    return config.Region(
        id_region=fila[0], codigo=fila[1], nombre=fila[2],
        epsg_trabajo=fila[3], resolucion_m=fila[4],
        bbox=(fila[5], fila[6], fila[7], fila[8]),
    )


class Bitacora:
    """Registra cada proceso en `operacion.ejecucion_proceso`.

    Se usa como gestor de contexto: si el bloque falla, el estado queda en
    'error' con el mensaje, y la excepción se propaga igual.

        with Bitacora("Ingesta SRTM", fuente="nasadem") as b:
            ...
            b.registros = 48

    `fuente` es el codigo de operacion.fuente. Sin el, la ejecucion queda
    registrada igual pero huerfana: la columna id_fuente existia desde el
    esquema inicial con su llave foranea y nadie la llenaba, asi que el
    catalogo de fuentes no sabia cuando se habia cargado cada una.
    """

    def __init__(self, proceso, id_fuente=None, id_region=None, fuente=None):
        self.proceso = proceso
        self.id_fuente = id_fuente
        self.codigo_fuente = fuente
        self.id_region = id_region or config.ID_REGION
        self.registros = None
        self.id_proceso = None
        # Con --simular no se escribe nada, y la bitácora tampoco debe
        # contarlo como una carga: el catálogo de fuentes mostraba las
        # simulaciones como "Actualizada". Se marca y al salir se borra.
        self.simulada = False

    def _resolver_fuente(self, con):
        """Del codigo al id. Si el codigo no existe, se avisa y se sigue: una
        ejecucion sin fuente vale mas que una ingesta que falla por el
        catalogo."""
        if self.id_fuente is not None or not self.codigo_fuente:
            return self.id_fuente
        fila = con.execute(
            "SELECT id_fuente FROM operacion.fuente WHERE codigo = %s",
            (self.codigo_fuente,)).fetchone()
        if fila is None:
            print("[bitacora] aviso: la fuente %r no esta en el catalogo"
                  % self.codigo_fuente)
            return None
        return fila[0]

    def __enter__(self):
        sql = """
            INSERT INTO operacion.ejecucion_proceso
                   (id_fuente, id_region, proceso, inicio, estado)
            VALUES (%s, %s, %s, %s, 'en curso')
            RETURNING id_proceso
        """
        with conexion() as con:
            self.id_fuente = self._resolver_fuente(con)
            self.id_proceso = con.execute(
                sql, (self.id_fuente, self.id_region, self.proceso, datetime.now())
            ).fetchone()[0]
        print("[bitacora] %s — inicio (id %s)" % (self.proceso, self.id_proceso))
        return self

    def __exit__(self, tipo, valor, traza):
        estado = "ok" if tipo is None else "error"
        mensaje = None if tipo is None else "%s: %s" % (tipo.__name__, valor)
        sql = """
            UPDATE operacion.ejecucion_proceso
            SET    fin = %s, estado = %s, registros = %s, mensaje = %s
            WHERE  id_proceso = %s
        """
        with conexion() as con:
            if self.simulada and tipo is None:
                con.execute("DELETE FROM operacion.ejecucion_proceso WHERE id_proceso = %s",
                            (self.id_proceso,))
                print("[bitacora] %s — simulación, no se registra" % self.proceso)
                return False
            con.execute(sql, (datetime.now(), estado, self.registros,
                              mensaje, self.id_proceso))
        print("[bitacora] %s — %s" % (self.proceso, estado))
        return False   # nunca suprime la excepción
