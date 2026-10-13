# -*- coding: utf-8 -*-
"""Conexión a PostGIS para la API."""
import contextlib

import psycopg

import config


@contextlib.contextmanager
def conexion():
    con = psycopg.connect(config.BD_URL)
    try:
        yield con
    finally:
        con.close()


@contextlib.contextmanager
def transaccion():
    """Conexión para escribir: confirma al salir bien, revierte si algo falla.

    `conexion()` no sirve para escribir. psycopg abre una transacción implícita
    y al cerrar sin confirmar los cambios se pierden, sin error de por medio:
    la petición responde 200 y la fila nunca llegó a la base.
    """
    con = psycopg.connect(config.BD_URL)
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def una_fila(sql, parametros=()):
    with conexion() as con:
        return con.execute(sql, parametros).fetchone()
