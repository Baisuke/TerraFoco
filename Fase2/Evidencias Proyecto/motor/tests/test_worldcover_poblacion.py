# -*- coding: utf-8 -*-
"""Superficie agrícola (WorldCover) y población censal urbana y rural."""
import numpy as np

from ingesta.poblacion_censal import entero, nombre
from ingesta.worldcover import CLASES, SIN_DATO, a_porcentaje, fracciones, teselas_de


def test_teselas_de_la_region():
    """O'Higgins cruza el meridiano 72° O: dos teselas de 3°."""
    assert teselas_de((-72.05, -35.0, -70.0, -33.85)) == ["S36W075", "S36W072"]


def test_tesela_unica():
    assert teselas_de((-71.5, -34.5, -70.5, -34.0)) == ["S36W072"]


def test_clases_de_worldcover():
    """Cultivo es la clase 40 y pradera la 30: si cambian, todo el conteo cambia."""
    assert dict(CLASES) == {"cultivo": 40, "pradera": 30}


def test_fraccion_y_porcentaje():
    bloque = np.array([[40, 40, 30, 10], [0, 40, 40, 30]], dtype="uint8")
    f = fracciones(bloque, 40)
    assert f.sum() == 4 and f.dtype == np.float32
    pct = a_porcentaje(np.array([0.0, 0.333, 1.0, 0.5]), np.array([True, True, True, False]))
    assert pct.tolist() == [0, 33, 100, SIN_DATO]


def test_censo_enteros_y_nombres():
    assert entero(12.0) == 12 and entero(None) == 0 and entero(float("nan")) == 0
    assert nombre("EL ARRAYÁN") == "El Arrayán"
    assert nombre(None) is None and nombre(float("nan")) is None
