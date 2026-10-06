# -*- coding: utf-8 -*-
"""Pertinencia con la serie del SIRSD-S (migración 013) y la serie por comuna."""
import math

import pytest
from fastapi.testclient import TestClient

from main import app
from tests.test_fuentes import hay_base

cliente = TestClient(app)

necesita_base = pytest.mark.skipif(
    not hay_base(), reason="requiere PostgreSQL levantado")


def _pertinencia(origen="CIREN", fuera=False):
    r = cliente.get("/pertinencia?region=6&origen=%s&incluir_fuera_de_dominio=%s"
                    % (origen, "true" if fuera else "false"))
    if r.status_code == 404:
        pytest.skip("origen %s sin cargar" % origen)
    return r.json()


@necesita_base
def test_la_inversion_es_uf_por_hectarea_erosionada():
    """El cociente que se expone es el que se normaliza, y cuadra."""
    for f in _pertinencia():
        if f["inversion_uf_ha"] is None:
            continue
        assert f["inversion_uf_ha"] == pytest.approx(f["incentivo_uf"] / f["ha_erosion_severa"], rel=1e-6)


@necesita_base
def test_normalizaciones_entre_cero_y_uno():
    filas = _pertinencia()
    for campo in ("necesidad_norm", "inversion_norm"):
        valores = [f[campo] for f in filas if f[campo] is not None]
        assert min(valores) == pytest.approx(0) and max(valores) == pytest.approx(1)


@necesita_base
def test_la_normalizacion_de_la_inversion_es_logaritmica():
    """Con escala lineal, 24 de 27 comunas quedaban cerca de cero."""
    filas = [f for f in _pertinencia() if f["inversion_uf_ha"]]
    logs = [math.log(f["inversion_uf_ha"]) for f in filas]
    lo, hi = min(logs), max(logs)
    for f, l in zip(filas, logs):
        assert f["inversion_norm"] == pytest.approx((l - lo) / (hi - lo), abs=1e-6)


@necesita_base
def test_fuera_de_dominio_solo_si_se_pide():
    dentro = _pertinencia()
    todas = _pertinencia(fuera=True)
    assert all(f["en_dominio"] for f in dentro)
    assert len(todas) >= len(dentro)


@necesita_base
def test_serie_por_comuna_ordenada_y_con_uf():
    r = cliente.get("/comunas/6307/sirsd")
    assert r.status_code == 200
    anios = [f["anio"] for f in r.json()]
    assert anios == sorted(anios) and len(anios) == len(set(anios))
    for f in r.json():
        assert f["incentivo"] >= 0
        if f["incentivo_uf"] is not None:
            assert f["incentivo_uf"] < f["incentivo"]


@necesita_base
def test_la_inversion_anomala_no_se_entrega():
    """6307/2017: el incentivo es correcto, la inversión total no."""
    for f in cliente.get("/comunas/6307/sirsd").json():
        if f["inversion_anomala"]:
            assert f["inversion_total"] is None and f["incentivo"] > 0


@necesita_base
def test_comuna_sin_serie_devuelve_lista_vacia():
    r = cliente.get("/comunas/99999/sirsd")
    assert r.status_code == 200 and r.json() == []


@necesita_base
def test_los_anios_con_pocos_planes_van_reservados():
    """Con 1 o 2 planes la celda identifica a un productor: sin cifras."""
    from rutas.comunas import MINIMO_PLANES_PUBLICABLE
    assert MINIMO_PLANES_PUBLICABLE == 3
    vistos = 0
    for id_comuna in (6108, 6112, 6205, 6117):
        for f in cliente.get("/comunas/%d/sirsd" % id_comuna).json():
            if f["reservado"]:
                vistos += 1
                assert f["planes"] is None and f["incentivo"] is None and f["incentivo_uf"] is None
            else:
                assert f["planes"] >= MINIMO_PLANES_PUBLICABLE
    assert vistos > 0, "Machalí y Peumo tienen años con 1 o 2 planes"
