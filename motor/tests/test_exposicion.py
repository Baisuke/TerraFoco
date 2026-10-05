# -*- coding: utf-8 -*-
"""Manzanas censales y equipamiento de OSM: lo que se lee de cada servicio."""
import urllib.parse

from ingesta.equipamiento import clasificar, consulta, filas, punto
from ingesta.manzanas import fila, url_pagina


# --- Manzanas ---------------------------------------------------------------

def test_la_pagina_va_ordenada_y_con_desplazamiento():
    """Sin orden fijo, dos páginas pueden repetir o saltarse manzanas."""
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(url_pagina("06", 4000)).query)
    assert q["where"] == ["REGION='6'"]
    assert q["orderByFields"] == ["FID"] and q["resultOffset"] == ["4000"]
    assert q["outSR"] == ["4326"]


def test_fila_de_manzana():
    f = {"type": "Feature",
         "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
         "properties": {"COMUNA": "6101", "MANZENT_I": "6101101003009",
                        "NOM_CATEGO": "CD", "TOTAL_PERS": 62, "TOTAL_VIVI": 20}}
    r = fila(f)
    assert r[:5] == (6101, "6101101003009", "ciudad", 62, 20)


def test_manzana_sin_geometria_o_codigo_se_descarta():
    assert fila({"geometry": None, "properties": {"COMUNA": "6101", "MANZENT_I": "1"}}) is None
    assert fila({"geometry": {"type": "Polygon"}, "properties": {"COMUNA": "6101"}}) is None


def test_personas_nulas_cuentan_cero():
    f = {"geometry": {"type": "Polygon", "coordinates": []},
         "properties": {"COMUNA": "6102", "MANZENT_I": "x", "NOM_CATEGO": "PB",
                        "TOTAL_PERS": None, "TOTAL_VIVI": None}}
    assert fila(f)[2:5] == ("pueblo", 0, 0)


# --- Equipamiento -------------------------------------------------------------

def test_clasifica_por_tipo():
    assert clasificar({"amenity": "school"}) == ("educacion", "school")
    assert clasificar({"healthcare": "centre"}) == ("salud", "clinic")
    assert clasificar({"emergency": "ambulance_station"}) == ("emergencia", "ambulance_station")
    assert clasificar({"amenity": "restaurant"}) is None
    assert clasificar({}) is None


def test_amenity_manda_sobre_healthcare():
    assert clasificar({"amenity": "hospital", "healthcare": "clinic"}) == ("salud", "hospital")


def test_punto_de_nodo_y_de_recinto():
    assert punto({"type": "node", "lon": -70.7, "lat": -34.1}) == (-70.7, -34.1)
    assert punto({"type": "way", "center": {"lon": -70.8, "lat": -34.2}}) == (-70.8, -34.2)
    assert punto({"type": "way"}) == (None, None)


def test_filas_descarta_lo_que_no_interesa_o_no_tiene_lugar():
    elementos = [
        {"type": "node", "id": 1, "lon": -70.7, "lat": -34.1,
         "tags": {"amenity": "school", "name": " Escuela América "}},
        {"type": "way", "id": 2, "center": {"lon": -70.8, "lat": -34.2},
         "tags": {"amenity": "fire_station"}},
        {"type": "node", "id": 3, "lon": -70.7, "lat": -34.1, "tags": {"amenity": "bank"}},
        {"type": "way", "id": 4, "tags": {"amenity": "police"}},
    ]
    f = filas(elementos)
    assert [x[1] for x in f] == [1, 2]
    assert f[0][4] == "Escuela América" and f[1][4] is None


def test_la_consulta_usa_el_recuadro_en_orden_overpass():
    """Overpass pide (sur, oeste, norte, este), no (oeste, sur, este, norte)."""
    q = consulta((-72.1, -35.0, -70.0, -33.8))
    assert "(-35.00000,-72.10000,-33.80000,-70.00000)" in q
    assert "out center tags" in q and '"amenity"' in q and '"healthcare"' in q
