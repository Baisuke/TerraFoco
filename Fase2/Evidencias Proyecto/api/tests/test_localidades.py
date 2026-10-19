# -*- coding: utf-8 -*-
"""Ciudades y pueblos: el GeoJSON que dibuja el visor de inundaciones."""
import pytest
from fastapi.testclient import TestClient

from main import app
from tests.test_fuentes import hay_base

cliente = TestClient(app)
necesita_base = pytest.mark.skipif(not hay_base(), reason="requiere PostgreSQL levantado")


def _cargadas():
    r = cliente.get("/localidades?region=6")
    return r.status_code == 200 and r.json()["features"]


@necesita_base
def test_devuelve_geojson_con_atribucion():
    r = cliente.get("/localidades?region=6")
    assert r.status_code == 200
    d = r.json()
    assert d["type"] == "FeatureCollection"
    # CC BY-NC exige atribución: viaja con el dato, no solo en la página.
    assert "INE" in d["atribucion"] and "Observatorio de Ciudades UC" in d["atribucion"]


@necesita_base
def test_cada_localidad_trae_lo_que_el_visor_usa():
    if not _cargadas():
        pytest.skip("sin localidades: correr python -m ingesta.localidades")
    f = cliente.get("/localidades?region=6").json()["features"][0]
    assert f["geometry"]["type"] == "MultiPolygon"
    p = f["properties"]
    assert {"id_ciudad", "id_comuna", "nombre", "categoria", "tipo", "superficie_ha"} <= set(p)
    assert p["categoria"] in ("ciudad", "pueblo")
    assert p["superficie_ha"] > 0


@necesita_base
def test_filtra_por_comuna():
    if not _cargadas():
        pytest.skip("sin localidades: correr python -m ingesta.localidades")
    todas = cliente.get("/localidades?region=6").json()["features"]
    una = todas[0]["properties"]["id_comuna"]
    solo = cliente.get("/localidades?region=6&comuna=%d" % una).json()["features"]
    assert solo and all(f["properties"]["id_comuna"] == una for f in solo)
    assert len(solo) < len(todas)


@necesita_base
def test_region_sin_localidades_devuelve_coleccion_vacia():
    """No 404: el visor simplemente no ofrece el botón."""
    r = cliente.get("/localidades?region=99")
    assert r.status_code == 200 and r.json()["features"] == []
