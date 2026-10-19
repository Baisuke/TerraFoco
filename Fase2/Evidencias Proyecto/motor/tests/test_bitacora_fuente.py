# -*- coding: utf-8 -*-
"""La bitácora y el catálogo de fuentes hablan el mismo idioma.

`Bitacora(fuente="...")` resuelve un código a `id_fuente`. Si el código no
existe, no falla: avisa y deja la ejecución huérfana, porque perder una
ingesta por el catálogo sería peor. Ese silencio es justamente lo que hay
que vigilar, y de ahí el segundo test: un código mal escrito en un módulo
de ingesta no rompe nada visible, simplemente deja de aparecer en /fuentes.
"""
import os
import re

import pytest

from bd import Bitacora

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_INGESTA = os.path.join(RAIZ, "ingesta")
DIR_MIGRACIONES = os.path.normpath(os.path.join(RAIZ, "..", "bd", "migraciones"))


class ConexionFalsa:
    """Lo justo para `_resolver_fuente`: devuelve lo que se le diga."""

    def __init__(self, fila=None):
        self.fila = fila
        self.consultas = []

    def execute(self, sql, parametros=None):
        self.consultas.append((sql, parametros))
        return self

    def fetchone(self):
        return self.fila


def test_el_codigo_se_traduce_a_id():
    con = ConexionFalsa(fila=(7,))
    assert Bitacora("X", fuente="nasadem")._resolver_fuente(con) == 7
    assert con.consultas[0][1] == ("nasadem",)


def test_un_codigo_desconocido_no_rompe_la_ingesta(capsys):
    con = ConexionFalsa(fila=None)
    assert Bitacora("X", fuente="no_existe")._resolver_fuente(con) is None
    assert "no esta en el catalogo" in capsys.readouterr().out


def test_un_id_explicito_manda_sobre_el_codigo():
    """Sin consultar: quien pasa el id ya sabe cuál es."""
    con = ConexionFalsa(fila=(7,))
    assert Bitacora("X", id_fuente=99, fuente="nasadem")._resolver_fuente(con) == 99
    assert con.consultas == []


def test_sin_fuente_la_ejecucion_queda_sin_catalogo():
    con = ConexionFalsa(fila=(7,))
    assert Bitacora("X")._resolver_fuente(con) is None
    assert con.consultas == []


def codigos_del_catalogo():
    """Los códigos de todas las migraciones que siembran el catálogo.

    La 012 lo creó, pero cada módulo nuevo registra ahí sus fuentes (la 014,
    el censo y OpenStreetMap). Leer solo la 012 hacía fallar cualquier fuente
    agregada después aunque estuviera bien registrada.
    """
    codigos = set()
    for nombre in sorted(os.listdir(DIR_MIGRACIONES)):
        if not nombre.endswith(".sql"):
            continue
        with open(os.path.join(DIR_MIGRACIONES, nombre), encoding="utf-8") as f:
            sql = f.read()
        if "INSERT INTO operacion.fuente" in sql:
            # Cada fila del INSERT parte con ('codigo', 'nombre', ...
            codigos |= set(re.findall(r"^\('([a-z0-9_]+)',", sql, re.M))
    return codigos


def codigos_usados_en_ingesta():
    usados = {}
    for nombre in sorted(os.listdir(DIR_INGESTA)):
        if not nombre.endswith(".py"):
            continue
        with open(os.path.join(DIR_INGESTA, nombre), encoding="utf-8") as f:
            for codigo in re.findall(r'fuente=["\']([a-z0-9_]+)["\']', f.read()):
                usados.setdefault(codigo, []).append(nombre)
    return usados


def test_el_catalogo_trae_las_fuentes_que_se_usan():
    assert len(codigos_del_catalogo()) >= 13


@pytest.mark.parametrize("codigo", sorted(codigos_usados_en_ingesta()))
def test_cada_fuente_de_la_ingesta_existe_en_el_catalogo(codigo):
    """Un typo aquí no lanza ninguna excepción: la ejecución se registra
    igual y la fuente se queda sin fecha de carga para siempre."""
    catalogo = codigos_del_catalogo()
    assert codigo in catalogo, (
        "%s usa fuente=%r y ese código no está en ninguna migración del catálogo; "
        "la ejecución quedaría huérfana sin dar error."
        % (", ".join(codigos_usados_en_ingesta()[codigo]), codigo))
