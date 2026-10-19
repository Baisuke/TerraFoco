# -*- coding: utf-8 -*-
"""Clases del mapa de temperatura: lo que el visor lee de vuelta desde el PNG."""
import re

import numpy as np

from mapa_calor import CLASES, COLORES, CORTES, RANGOS, clasificar_arreglo, colorear


def test_cinco_clases_con_color_y_rango():
    assert len(CLASES) == len(COLORES) == len(RANGOS) == len(CORTES) + 1


def test_los_rangos_dicen_los_mismos_cortes():
    """La leyenda del visor muestra RANGOS; si alguien mueve un corte y no el
    texto, el mapa y la leyenda dirían cosas distintas."""
    numeros = [float(n) for r in RANGOS for n in re.findall(r"\d+(?:\.\d+)?", r)]
    assert sorted(set(numeros)) == list(CORTES)


def test_el_corte_pertenece_a_la_clase_de_arriba():
    a = np.array([21.99, 22.0, 24.99, 25.0, 30.99, 31.0, 45.0])
    assert clasificar_arreglo(a).tolist() == [0, 1, 1, 2, 3, 4, 4]


def test_sin_dato_es_transparente_y_no_tiene_clase():
    a = np.array([[np.nan, 20.0], [26.0, 33.0]])
    assert clasificar_arreglo(a)[0, 0] == -1
    rgba = colorear(a)
    assert rgba[3, 0, 0] == 0
    assert (rgba[3][np.isfinite(a)] > 0).all()


def test_cada_clase_se_pinta_con_su_color_exacto():
    """El visor recupera la clase comparando el color del píxel contra la
    rampa: un color aproximado rompería esa lectura."""
    a = np.array([[20.0, 23.0, 26.0, 29.0, 35.0]])
    rgba = colorear(a)
    for i, color in enumerate(COLORES):
        assert tuple(int(x) for x in rgba[:3, 0, i]) == color
