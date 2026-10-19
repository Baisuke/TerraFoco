# -*- coding: utf-8 -*-
"""Áreas verdes (HU-19, RF-25): geometría de OSM, clasificación SIEDU y déficit."""
import math

import geopandas as gpd
import pytest
from shapely.geometry import Polygon, box

from indicadores.area_verde import ESTANDAR_M2_HAB, deficit_m2, m2_por_habitante
from ingesta.areas_verdes import (AREA_MINIMA_M2, AREA_PARQUE_M2, clasificar, construir,
                                  es_area_verde_publica, poligono)
from ingesta.censo import validar

# Un punto de Rancagua, para que las geometrías de prueba caigan en la UTM 19S.
LON, LAT = -70.74, -34.17
GRADO_M = 111_320 * math.cos(math.radians(LAT))   # metros por grado de longitud aquí


def cuadrado_lonlat(x0, y0, lado_m):
    """Un cuadrado de `lado_m` metros, con esquina en (x0, y0) metros desde LON/LAT."""
    dx, dy = 1 / GRADO_M, 1 / 111_320
    return [(LON + (x0 + a) * dx, LAT + (y0 + b) * dy)
            for a, b in ((0, 0), (lado_m, 0), (lado_m, lado_m), (0, lado_m), (0, 0))]


def way(i, tags, pts):
    return {"type": "way", "id": i, "tags": tags,
            "geometry": [{"lon": x, "lat": y} for x, y in pts]}


# ---------------------------------------------------------------- etiquetas

@pytest.mark.parametrize("tags,esperado", [
    ({"leisure": "park"}, True),
    ({"leisure": "garden"}, True),
    ({"landuse": "grass"}, True),
    ({"landuse": "village_green"}, True),
    ({"leisure": "pitch"}, False),          # recinto deportivo, no área verde
    ({"leisure": "playground"}, False),
    ({"leisure": "park", "access": "private"}, False),
    ({"landuse": "grass", "access": "customers"}, False),
    ({"building": "yes"}, False),
])
def test_que_cuenta_como_area_verde_publica(tags, esperado):
    assert es_area_verde_publica(tags) is esperado


# ---------------------------------------------------------------- geometría

def test_un_way_abierto_no_es_poligono():
    pts = cuadrado_lonlat(0, 0, 50)[:-1]
    assert poligono(way(1, {}, pts)) is None


def test_relacion_con_anillo_partido_y_laguna():
    """El exterior viene en dos ways y el interior es una laguna que se resta."""
    ext = cuadrado_lonlat(0, 0, 100)
    lag = cuadrado_lonlat(40, 40, 20)
    rel = {"type": "relation", "id": 9, "tags": {"leisure": "park"}, "members": [
        {"role": "outer", "geometry": [{"lon": x, "lat": y} for x, y in ext[:3]]},
        {"role": "outer", "geometry": [{"lon": x, "lat": y} for x, y in ext[2:]]},
        {"role": "inner", "geometry": [{"lon": x, "lat": y} for x, y in lag]},
    ]}
    g = gpd.GeoSeries([poligono(rel)], crs=4326).to_crs(32719).iloc[0]
    assert g.area == pytest.approx(100 * 100 - 20 * 20, rel=0.01)


# ----------------------------------------------------------- clasificación

def test_umbrales_siedu():
    assert clasificar(AREA_MINIMA_M2 - 1) is None
    assert clasificar(AREA_MINIMA_M2) == "plaza"
    assert clasificar(AREA_PARQUE_M2 - 1) == "plaza"
    assert clasificar(AREA_PARQUE_M2) == "parque"


def _urbano():
    """Un área urbana de 1 km² alrededor del punto, en UTM."""
    return gpd.GeoSeries([Polygon(cuadrado_lonlat(-200, -200, 1000))], crs=4326).to_crs(32719).iloc[0]


def test_lo_que_se_solapa_cuenta_una_vez():
    """Una plaza como park con un grass encima: una sola área, de su tamaño."""
    crudo = {"elements": [
        way(1, {"leisure": "park", "name": "Plaza de Armas"}, cuadrado_lonlat(0, 0, 100)),
        way(2, {"landuse": "grass"}, cuadrado_lonlat(20, 20, 50)),
    ]}
    areas = construir(crudo, {6101: _urbano()})
    assert len(areas) == 1
    a = areas[0]
    assert a["area_m2"] == pytest.approx(10000, rel=0.01)
    assert a["tipo"] == "plaza" and a["nombre"] == "Plaza de Armas"
    assert a["solo_pasto"] is False
    assert a["osm_ids"] == "way/1,way/2"


def test_bandejon_solo_pasto_y_minimo():
    crudo = {"elements": [
        way(3, {"landuse": "grass"}, cuadrado_lonlat(300, 300, 30)),   # 900 m²: entra, solo pasto
        way(4, {"landuse": "grass"}, cuadrado_lonlat(500, 500, 15)),   # 225 m²: bajo el mínimo
    ]}
    areas = construir(crudo, {6101: _urbano()})
    assert len(areas) == 1 and areas[0]["solo_pasto"] is True


def test_se_recorta_al_limite_urbano():
    """Un parque que sale del área urbana cuenta solo la parte de adentro."""
    crudo = {"elements": [way(5, {"leisure": "park"}, cuadrado_lonlat(650, 0, 300))]}
    areas = construir(crudo, {6101: _urbano()})
    # El área urbana llega hasta x = 800 m: de los 300 x 300 quedan 150 x 300.
    assert len(areas) == 1
    assert areas[0]["area_m2"] == pytest.approx(150 * 300, rel=0.02)
    assert areas[0]["tipo"] == "parque"


# ------------------------------------------------------------------ déficit

def test_deficit_es_lo_que_falta_para_el_estandar():
    assert ESTANDAR_M2_HAB == 10
    assert deficit_m2(1000, 4000) == pytest.approx(6000)
    assert deficit_m2(1000, 12000) == 0
    assert m2_por_habitante(1000, 8500) == pytest.approx(8.5)
    assert m2_por_habitante(0, 500) is None


# -------------------------------------------------------------------- censo

def _gdf(filas):
    return gpd.GeoDataFrame(filas, geometry=[box(0, 0, 1, 1)] * len(filas), crs=4326)


def test_censo_valido_y_con_problemas():
    zon = _gdf([{"ID_ZONA": 1}])
    bien = _gdf([{"MANZENT": 10, "ID_ZONA": 1, "n_per": 5}, {"MANZENT": 11, "ID_ZONA": 1, "n_per": 0}])
    assert validar(None, zon, bien) == []
    mal = _gdf([{"MANZENT": 10, "ID_ZONA": 1, "n_per": 5}, {"MANZENT": 10, "ID_ZONA": 2, "n_per": -1}])
    problemas = validar(None, zon, mal)
    assert any("repetido" in p for p in problemas)
    assert any("negativas" in p for p in problemas)
    assert any("sin zona" in p for p in problemas)
