# -*- coding: utf-8 -*-
"""NDVI y pendiente por comuna (/comunas/terreno), de solo lectura."""
import pytest
from fastapi.testclient import TestClient

from main import app
from tests.test_fuentes import hay_base

cliente = TestClient(app)

necesita_base = pytest.mark.skipif(
    not hay_base(), reason="requiere PostgreSQL levantado")


@necesita_base
def test_una_fila_por_comuna_de_la_region():
    comunas = cliente.get("/comunas?region=6").json()
    r = cliente.get("/comunas/terreno?region=6")
    assert r.status_code == 200
    assert {f["id_comuna"] for f in r.json()} == {c["id_comuna"] for c in comunas}


@necesita_base
def test_valores_en_rango_o_nulos():
    """Nulo es "sin dato" y el visor lo pinta como tal; un cero pasaría por
    suelo desnudo o terreno plano sin serlo."""
    for f in cliente.get("/comunas/terreno?region=6").json():
        if f["ndvi_mediana"] is not None:
            assert -1 <= f["ndvi_mediana"] <= 1
        if f["pendiente_media"] is not None:
            assert 0 <= f["pendiente_media"] < 400


@necesita_base
def test_region_sin_comunas_devuelve_lista_vacia():
    r = cliente.get("/comunas/terreno?region=99")
    assert r.status_code == 200 and r.json() == []


# ------------------------------------------------ /comunas/erosion (UC-06)

@necesita_base
def test_erosion_trae_los_dos_origenes_por_comuna():
    comunas = cliente.get("/comunas?region=6").json()
    filas = cliente.get("/comunas/erosion?region=6").json()
    assert {f["id_comuna"] for f in filas} == {c["id_comuna"] for c in comunas}
    for f in filas:
        for clave in ("erosion_ciren", "erosion_terrafoco", "terrafoco_en_dominio"):
            assert clave in f


@necesita_base
def test_erosion_coincide_con_pertinencia_de_cada_origen():
    """La comparación no puede mostrar otra cifra que la que usa el índice:
    misma fila vigente por comuna y origen."""
    filas = {f["id_comuna"]: f for f in cliente.get("/comunas/erosion?region=6").json()}
    for origen, clave in (("CIREN", "erosion_ciren"), ("TerraFoco", "erosion_terrafoco")):
        r = cliente.get("/pertinencia?region=6&origen=%s&incluir_fuera_de_dominio=true" % origen)
        if r.status_code != 200:
            continue                      # origen sin cargar en este entorno
        for p in r.json():
            assert filas[p["id_comuna"]][clave] == pytest.approx(p["perdida_ton_ha"], abs=0.01)
