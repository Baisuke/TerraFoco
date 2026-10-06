# -*- coding: utf-8 -*-
"""Derivados hidrológicos del DEM. Sin base de datos ni red."""
import numpy as np
import pytest

from ingesta.hidrologia import indice_topografico_humedad


def test_twi_sube_con_la_acumulacion():
    """Más agua aguas arriba, más húmedo: TWI creciente en la acumulación."""
    pendiente = np.full(4, 10.0)
    acum = np.array([1.0, 10.0, 100.0, 1000.0])
    twi = indice_topografico_humedad(acum, pendiente, 30.0)
    assert np.all(np.diff(twi) > 0)


def test_twi_baja_con_la_pendiente():
    """El agua se va de lo empinado: TWI decreciente en la pendiente."""
    acum = np.full(4, 100.0)
    pendiente = np.array([1.0, 5.0, 20.0, 50.0])
    twi = indice_topografico_humedad(acum, pendiente, 30.0)
    assert np.all(np.diff(twi) < 0)


def test_twi_no_revienta_en_plano_ni_en_cero():
    """Pendiente cero y acumulación cero se acotan; no hay inf ni NaN."""
    twi = indice_topografico_humedad(np.array([0.0, 0.0]), np.array([0.0, 0.0]), 30.0)
    assert np.all(np.isfinite(twi))


def test_twi_es_el_logaritmo_esperado():
    """Comprobación numérica contra la definición ln(a / tan(beta))."""
    acum, pend, dx = 200.0, 8.0, 30.0
    esperado = np.log((acum * dx) / np.tan(np.arctan(pend / 100.0)))
    assert np.isclose(indice_topografico_humedad(np.array([acum]), np.array([pend]), dx)[0],
                      esperado)


@pytest.mark.skipif(pytest.importorskip("pysheds", reason="pysheds no instalado") is None,
                    reason="pysheds no instalado")
def test_acumulacion_crece_hacia_abajo_en_un_plano_inclinado():
    """En una rampa hacia el este, la última columna recibe a todas las demás."""
    from rasterio.transform import from_origin
    from ingesta.hidrologia import acumulacion_de_flujo
    n = 12
    z = np.tile(np.arange(n, 0, -1, dtype="float64") * 5.0, (n, 1))  # desciende al este
    acum = acumulacion_de_flujo(z, from_origin(0, n * 30.0, 30.0, 30.0), "EPSG:32719")
    fila = acum[n // 2]
    assert fila[-1] > fila[0]
    assert np.all(np.diff(fila) >= 0)
