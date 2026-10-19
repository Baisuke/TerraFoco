# -*- coding: utf-8 -*-
"""Exposición (manzanas y equipamiento), red hídrica y lluvia pronosticada."""
import pytest
from fastapi.testclient import TestClient

from main import app
from rutas import inundacion
from tests.test_fuentes import hay_base

cliente = TestClient(app)
necesita_base = pytest.mark.skipif(not hay_base(), reason="requiere PostgreSQL levantado")


# --- Manzanas y equipamiento ---------------------------------------------------

def test_manzanas_exige_la_comuna():
    """Sin comuna serían miles de polígonos: se pide, no se adivina."""
    assert cliente.get("/exposicion/manzanas").status_code == 422


@necesita_base
def test_manzanas_de_una_comuna_con_atribucion():
    r = cliente.get("/exposicion/manzanas?comuna=6101")
    assert r.status_code == 200
    d = r.json()
    assert d["type"] == "FeatureCollection"
    assert "INE" in d["atribucion"] and "urbana" in d["cobertura"]
    if not d["features"]:
        pytest.skip("sin manzanas: correr python -m ingesta.manzanas")
    p = d["features"][0]["properties"]
    assert {"id", "categoria", "personas", "viviendas"} <= set(p)


@necesita_base
def test_comuna_sin_manzanas_devuelve_coleccion_vacia():
    assert cliente.get("/exposicion/manzanas?comuna=999999").json()["features"] == []


@necesita_base
def test_equipamiento_filtra_por_comuna_y_atribuye_a_osm():
    d = cliente.get("/exposicion/equipamiento?region=6").json()
    assert "OpenStreetMap" in d["atribucion"]
    if not d["features"]:
        pytest.skip("sin equipamiento: correr python -m ingesta.equipamiento")
    una = d["features"][0]["properties"]["id_comuna"]
    solo = cliente.get("/exposicion/equipamiento?region=6&comuna=%d" % una).json()["features"]
    assert solo and all(f["properties"]["id_comuna"] == una for f in solo)
    assert {f["properties"]["categoria"] for f in d["features"]} <= {"educacion", "salud", "emergencia"}


def test_las_respuestas_grandes_van_comprimidas():
    r = cliente.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"


# --- Cauces ----------------------------------------------------------------

@necesita_base
def test_cauces_respeta_el_orden_minimo():
    d = cliente.get("/inundacion/cauces?region=6&orden_minimo=6").json()
    if not d["features"]:
        pytest.skip("sin red hídrica: correr python -m ingesta.cauces --cargar")
    assert all(f["properties"]["strahler"] >= 6 for f in d["features"])
    todos = cliente.get("/inundacion/cauces?region=6&orden_minimo=4").json()["features"]
    assert len(todos) > len(d["features"])


# --- Pronóstico --------------------------------------------------------------

PUNTOS = [(6101, "Rancagua", "Alta", -34.17, -70.74), (6305, "Pichidegua", "Media", -34.36, -71.28)]


def _respuesta(lluvia):
    return {"daily": {"time": ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"],
                      "precipitation_sum": lluvia,
                      "precipitation_probability_max": [90, 80, 10, 0]}}


def test_armar_pronostico_ordena_por_lluvia_de_72_horas():
    r = inundacion.armar_pronostico(PUNTOS, [_respuesta([1, 0, 0, 50]), _respuesta([10, 5, None, 0])])
    assert [c["nombre"] for c in r["comunas"]] == ["Pichidegua", "Rancagua"]
    p = r["comunas"][0]
    assert p["total_72h"] == 15 and p["total_7d"] == 15 and p["max_diaria"] == 10
    assert p["precipitacion"][2] == 0                    # None cuenta como sin lluvia
    assert r["dias"][0] == "2026-09-28"


def test_armar_pronostico_rechaza_respuestas_desalineadas():
    with pytest.raises(ValueError):
        inundacion.armar_pronostico(PUNTOS, [_respuesta([1, 0, 0, 0])])


@necesita_base
def test_pronostico_se_guarda_y_se_declara(monkeypatch):
    llamadas = []

    def falso(lats, lons, dias=7):
        llamadas.append(len(lats))
        return [_respuesta([2, 2, 2, 2]) for _ in lats]

    monkeypatch.setattr(inundacion, "consultar_open_meteo", falso)
    monkeypatch.setattr(inundacion, "_cache_pronostico", {})
    d = cliente.get("/inundacion/pronostico?region=6").json()
    assert "No es un pronóstico de inundación" in d["advertencia"]
    assert "Open-Meteo" in d["fuente"] and d["vencido"] is False
    assert len(d["comunas"]) == llamadas[0] and d["comunas"][0]["total_72h"] == 6
    cliente.get("/inundacion/pronostico?region=6")
    assert len(llamadas) == 1                           # la segunda sale de memoria


@necesita_base
def test_sin_servicio_y_sin_copia_responde_503(monkeypatch):
    def caido(*a, **k):
        raise OSError("sin red")

    monkeypatch.setattr(inundacion, "consultar_open_meteo", caido)
    monkeypatch.setattr(inundacion, "_cache_pronostico", {})
    r = cliente.get("/inundacion/pronostico?region=6")
    assert r.status_code == 503


@necesita_base
def test_sin_servicio_con_copia_devuelve_la_copia_vencida(monkeypatch):
    monkeypatch.setattr(inundacion, "consultar_open_meteo",
                        lambda lats, lons, dias=7: [_respuesta([1, 1, 1, 1]) for _ in lats])
    monkeypatch.setattr(inundacion, "_cache_pronostico", {})
    cliente.get("/inundacion/pronostico?region=6")
    # Se vence la copia y se cae el servicio.
    t, cuerpo = inundacion._cache_pronostico[6]
    inundacion._cache_pronostico[6] = (t - 2 * inundacion.VIGENCIA_S, cuerpo)
    monkeypatch.setattr(inundacion, "consultar_open_meteo",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("sin red")))
    d = cliente.get("/inundacion/pronostico?region=6").json()
    assert d["vencido"] is True and d["comunas"]


# --- Población 2024 y superficie agrícola (migración 019) ------------------------

def test_poblacion_exige_la_comuna():
    assert cliente.get("/exposicion/poblacion").status_code == 422


@necesita_base
def test_poblacion_2024_urbana_y_rural():
    d = cliente.get("/exposicion/poblacion?comuna=6113").json()
    assert d["anio"] == 2024 and "Censo 2024" in d["atribucion"]
    if not d["features"]:
        pytest.skip("sin población 2024: correr python -m ingesta.poblacion_censal")
    tipos = {f["properties"]["tipo"] for f in d["features"]}
    assert tipos <= {"manzana_urbana", "aldea", "entidad_rural"}
    # Pichidegua tiene campo: tiene que aparecer población rural.
    assert "entidad_rural" in tipos


@necesita_base
def test_agricola_por_comuna():
    d = cliente.get("/exposicion/agricola?region=6").json()
    assert "WorldCover" in d["fuente"]
    if not d["comunas"]:
        pytest.skip("sin superficie agrícola: correr python -m ingesta.worldcover")
    c = d["comunas"][0]
    assert c["ha_cultivo"] >= c["ha_cultivo_susceptible"] >= 0
    # Ordenadas por cultivo en zona susceptible, de mayor a menor.
    v = [x["ha_cultivo_susceptible"] or 0 for x in d["comunas"]]
    assert v == sorted(v, reverse=True)
