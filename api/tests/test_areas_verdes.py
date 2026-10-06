# -*- coding: utf-8 -*-
"""Déficit de áreas verdes (/urbano/areas-verdes), contra la base cargada."""
import pytest
from fastapi.testclient import TestClient

from main import app
from tests.test_fuentes import hay_base

cliente = TestClient(app)
necesita_base = pytest.mark.skipif(not hay_base(), reason="requiere PostgreSQL levantado")


def _datos(**params):
    r = cliente.get("/urbano/areas-verdes", params=dict({"region": 6}, **params))
    if r.status_code == 404:
        pytest.skip("indicador de áreas verdes sin calcular")
    assert r.status_code == 200
    return r.json()


@necesita_base
def test_el_estandar_es_el_del_siedu():
    e = _datos()["estandar"]
    assert (e["m2_hab"], e["plaza_m"], e["parque_m"]) == (10, 400, 3000)
    assert (e["plaza_min_m2"], e["parque_min_m2"]) == (450, 20000)


@necesita_base
def test_rancagua_reproduce_el_siedu():
    """La regla de etiquetas se eligió para esto: el SIEDU publica entre 8 y 9
    m²/hab para Rancagua con el catastro municipal. Si una descarga nueva de
    OSM o un cambio de etiquetas la saca de ahí, hay que revisarla."""
    rancagua = next(c for c in _datos()["comunas"] if c["nombre"] == "Rancagua")
    assert 7.5 <= rancagua["m2_hab"] <= 9.5


@necesita_base
def test_las_cuentas_cuadran():
    d = _datos()
    for c in d["comunas"] + d["zonas"]:
        assert 0 <= c["pct_plaza_400"] <= 1 and 0 <= c["pct_parque_3km"] <= 1
        if c["personas"]:
            assert c["m2_hab"] == pytest.approx(c["area_verde_m2"] / c["personas"], abs=0.01)
            assert c["deficit_m2"] == pytest.approx(max(0, 10 * c["personas"] - c["area_verde_m2"]), abs=1)


@necesita_base
def test_las_zonas_suman_la_comuna():
    """Las personas de una comuna son las de sus zonas urbanas, sin perder ni repetir."""
    d = _datos()
    for c in d["comunas"]:
        suma = sum(z["personas"] for z in d["zonas"] if z["id_comuna"] == c["id_comuna"])
        assert suma == c["personas"], c["nombre"]


@necesita_base
def test_filtro_por_comuna():
    d = _datos(comuna=6101)
    assert d["zonas"] and all(z["id_comuna"] == 6101 for z in d["zonas"])
    assert len(d["comunas"]) > 1          # el resumen comunal va completo


@necesita_base
def test_geojson_de_una_comuna():
    r = cliente.get("/urbano/areas-verdes/geojson?comuna=6106")
    if r.status_code == 404:
        pytest.skip("sin zonas censales cargadas")
    d = r.json()
    assert d["zonas"]["type"] == "FeatureCollection" and d["zonas"]["features"]
    props = d["zonas"]["features"][0]["properties"]
    assert {"id_zona", "cod_zona", "personas", "m2_hab"} <= set(props)
    assert all(f["properties"]["tipo"] in ("plaza", "parque") for f in d["areas"]["features"])


@necesita_base
def test_comuna_sin_zonas_da_404():
    assert cliente.get("/urbano/areas-verdes/geojson?comuna=999999").status_code == 404
