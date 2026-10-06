# -*- coding: utf-8 -*-
"""Combinación del índice de susceptibilidad. Sin base de datos ni rásteres."""
import numpy as np
import pytest

from indicadores.inundacion import (NOMBRES_CLASE, PESOS, VARIABLES, clasificar,
                                    clasificar_arreglo, combinar, cortes_por_cuartiles,
                                    normalizar)


def test_los_pesos_suman_cien_y_cada_variable_declara_sentido():
    assert sum(v[1] for v in VARIABLES) == 100
    assert all(v[2] in (-1, 1) for v in VARIABLES)
    assert len({v[0] for v in VARIABLES}) == 6


def test_los_pesos_calibrados_son_los_que_respaldo_la_validacion():
    """Iteración 2: solo acumulación y curvatura correlacionan con los eventos.
    Si alguien cambia los pesos, que sea a sabiendas de que esto lo mira."""
    con_peso = {n for n, p in PESOS.items() if p}
    assert con_peso == {"acumulacion", "curvatura"}


def test_normalizar_directa_va_de_cero_a_uno_y_recorta_extremos():
    v = np.linspace(0, 100, 1001)
    n, (bajo, alto) = normalizar(v, +1, percentiles=(2, 98))
    assert np.isclose(bajo, 2) and np.isclose(alto, 98)
    assert n.min() == 0 and n.max() == 1
    # Lo que queda fuera de los percentiles se recorta, no se extrapola.
    assert n[0] == 0 and n[-1] == 1
    assert np.all(np.diff(n) >= 0)


def test_normalizar_inversa_voltea():
    v = np.array([0.0, 50.0, 100.0])
    n, _ = normalizar(v, -1, percentiles=(0, 100))
    assert np.allclose(n, [1.0, 0.5, 0.0])


def test_normalizar_conserva_nan_y_escala_solo_sobre_el_dominio():
    """La escala sale del dominio: una celda enorme fuera de él no la fija."""
    v = np.array([1.0, 2.0, 3.0, np.nan, 1000.0])
    dominio = np.array([True, True, True, False, False])
    n, (bajo, alto) = normalizar(v, +1, dominio, percentiles=(0, 100))
    assert (bajo, alto) == (1.0, 3.0)
    assert np.isnan(n[3])
    assert n[4] == 1.0            # fuera de rango: recortada, no NaN


def test_normalizar_rechaza_variable_constante():
    with pytest.raises(ValueError):
        normalizar(np.full(10, 7.0), +1)


def test_combinar_es_la_suma_ponderada_y_propaga_nan():
    capas = {v[0]: np.array([1.0, 0.0, np.nan]) for v in VARIABLES}
    i = combinar(capas)
    assert np.isclose(i[0], 1.0)
    assert np.isclose(i[1], 0.0)
    assert np.isnan(i[2])         # nada se rellena


def test_combinar_ignora_las_variables_sin_peso():
    """Una variable con peso 0 no entra aunque traiga cualquier valor."""
    capas = {v[0]: np.array([0.5]) for v in VARIABLES}
    for n, p in PESOS.items():
        if not p:
            capas[n] = np.array([99.0])
    assert np.isclose(combinar(capas)[0], 0.5)


def test_cortes_por_cuartiles_reparten_en_cuatro_partes_iguales():
    v = np.arange(1, 101, dtype="float64")
    c = cortes_por_cuartiles(np.concatenate([v, [np.nan]]))
    assert len(c) == 3
    assert c[0] < c[1] < c[2]
    clases = clasificar_arreglo(v, c)
    assert clases.min() == 0 and clases.max() == 3
    conteo = np.bincount(clases, minlength=4)
    assert conteo.max() - conteo.min() <= 2      # un cuarto cada una, salvo empates


def test_clasificar_es_relativo_a_los_cortes():
    cortes = (0.2, 0.5, 0.8)
    assert clasificar(0.10, cortes) == "Baja"
    assert clasificar(0.30, cortes) == "Media"
    assert clasificar(0.60, cortes) == "Alta"
    assert clasificar(0.90, cortes) == "Muy alta"
    assert clasificar(0.50, cortes) == "Alta"        # el corte pertenece a la clase superior
    assert list(NOMBRES_CLASE) == ["Baja", "Media", "Alta", "Muy alta"]


def test_clasificar_arreglo_marca_sin_dato():
    a = np.array([0.1, np.nan, 0.9])
    c = clasificar_arreglo(a, (0.2, 0.5, 0.8))
    assert list(c) == [0, -1, 3]
