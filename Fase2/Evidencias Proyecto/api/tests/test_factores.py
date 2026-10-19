# -*- coding: utf-8 -*-
"""Factores RUSLE por comuna (/comunas/factores): los medidos, no derivados."""
import math

import pytest
from fastapi.testclient import TestClient

from main import app
from tests.test_fuentes import hay_base

cliente = TestClient(app)

necesita_base = pytest.mark.skipif(
    not hay_base(), reason="requiere PostgreSQL levantado")


def _factores():
    r = cliente.get("/comunas/factores?region=6")
    assert r.status_code == 200
    datos = r.json()
    con = [c for c in datos["comunas"] if c["factores"]]
    if not con:
        pytest.skip("sin cálculo propio cargado")
    return datos, con


@necesita_base
def test_el_producto_da_la_erosion_que_se_muestra():
    """La ficha escribe A = R x K x LS x C x P; tiene que cuadrar.

    Con los factores derivados del prototipo cuadraba por construcción: K se
    despejaba de la ecuación. Con los medidos cuadra porque son los mismos
    que usó el cálculo, redondeados como se guardaron.
    """
    _, comunas = _factores()
    for c in comunas:
        f = c["factores"]
        producto = f["R"]["valor"] * f["K"]["valor"] * f["LS"]["valor"] * \
            f["C"]["valor"] * f["P"]["valor"]
        assert producto == pytest.approx(c["perdida_ton_ha"], rel=0.01, abs=0.02), c["nombre"]


@necesita_base
def test_cada_factor_trae_su_procedencia():
    _, comunas = _factores()
    for c in comunas:
        for nombre, f in c["factores"].items():
            assert f["valor"] > 0
            assert f["fuente"], "%s de %s sin fuente" % (nombre, c["nombre"])


@necesita_base
def test_el_dominio_es_el_de_la_erosividad():
    """El umbral de la API es el del motor: si alguien cambia uno solo, falla."""
    datos, comunas = _factores()
    for c in comunas:
        assert c["en_dominio"] == (c["factores"]["R"]["valor"] <= datos["r_maximo"]), c["nombre"]


@necesita_base
def test_la_region_viene_completa():
    datos, _ = _factores()
    assert len(datos["comunas"]) == 33
    assert all(isinstance(c["id_comuna"], int) for c in datos["comunas"])
    assert not any(math.isnan(c["perdida_ton_ha"]) for c in datos["comunas"]
                   if c["perdida_ton_ha"] is not None)
