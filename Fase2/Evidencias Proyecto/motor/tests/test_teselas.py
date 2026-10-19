# -*- coding: utf-8 -*-
"""Teselas de valores: lo que MapLibre y el visor van a decodificar."""
import math

import numpy as np
import pytest

from teselas import (CAPAS, clasificar, codificar, decodificar, limites_mercator,
                     tesela_de)


def test_ida_y_vuelta_con_precision_de_una_decima():
    a = np.array([[0.0, 0.13, 23.47, 1999.9]], dtype="float64")
    v = decodificar(codificar(a, 1.0), 1.0)
    assert np.allclose(v, [[0.0, 0.1, 23.5, 1999.9]], atol=1e-6)


def test_la_escala_conserva_decimales_del_indice():
    """El índice de inundación va de 0 a 1: sin escala se perdería."""
    a = np.array([[0.2273, 0.3505]])
    v = decodificar(codificar(a, 1000.0), 1000.0)
    assert np.allclose(v, [[0.2273, 0.3505]], atol=1e-4)


def test_sin_dato_es_cero_y_vuelve_como_nan():
    rgb = codificar(np.array([[np.nan, 5.0]]), 1.0)
    assert rgb[:, 0, 0].tolist() == [0, 0, 0]
    v = decodificar(rgb, 1.0)
    assert math.isnan(v[0, 0]) and v[0, 1] == pytest.approx(5.0)


def test_valores_negativos_y_el_cero_no_se_confunden_con_sin_dato():
    """Temperaturas bajo cero en la cordillera, y erosión nula en el valle."""
    v = decodificar(codificar(np.array([[-6.1, 0.0]]), 1.0), 1.0)
    assert v[0].tolist() == pytest.approx([-6.1, 0.0])


def test_formula_de_mapbox():
    """La que aplica MapLibre con encoding 'mapbox': si cambia aquí y no
    allá, todo el mapa se desplaza de valor sin que nada falle."""
    r, g, b = codificar(np.array([[23.4]]), 1.0)[:, 0, 0].astype(int)
    assert -10000 + (r * 65536 + g * 256 + b) * 0.1 == pytest.approx(23.4)


def test_la_tesela_contiene_al_punto():
    lon, lat, z = -71.30, -34.37, 11
    x, y = tesela_de(lon, lat, z)
    oeste, sur, este, norte = limites_mercator(x, y, z)
    mx = math.radians(lon) * 6378137.0
    my = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * 6378137.0
    assert oeste <= mx < este and sur < my <= norte


@pytest.mark.parametrize("nombre", sorted(CAPAS))
def test_cada_capa_declara_lo_que_el_visor_necesita(nombre):
    c = CAPAS[nombre]
    assert c["escala"] > 0 and c["zmin"] <= c["zmax"]
    assert callable(c["fuente"])


def test_regla_de_clases_igual_a_la_del_visor():
    """detalle-comuna.js (claseDe) usa v <= corte si los cortes son
    inclusivos y v < corte si no. El % por clase del resumen tiene que
    contar igual, o el panel y el mapa discrepan en los bordes."""
    v = np.array([9.9, 10.0, 10.1, 34.0, 50.0])
    assert clasificar(v, [10, 18, 26, 34], True).tolist() == [0, 0, 1, 3, 4]
    assert clasificar(v, [10, 18, 26, 34], False).tolist() == [0, 1, 1, 4, 4]


def test_la_erosion_cierra_arriba_y_las_demas_abajo():
    """Misma regla que los motores que generan cada dato."""
    assert CAPAS["erosion"]["cortes_inclusivos"] is True
    for nombre in ("inundacion", "calor", "ndvi", "pendiente"):
        assert CAPAS[nombre]["cortes_inclusivos"] is False
