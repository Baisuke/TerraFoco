# -*- coding: utf-8 -*-
"""El criterio con que el programador marca el índice como calibrado.

Se corre solo después de cada recálculo (migración 018): si dejara pasar un
índice que no cumple, la pantalla diría "calibrado" sobre algo que no lo es.
"""
from indicadores.validar_inundacion import MEJORA_MINIMA, pasa_criterio


def _r(frac_alta, azar, rho):
    return {"frac_alta": frac_alta, "azar": azar, "rho": rho}


def test_el_indice_vigente_pasa():
    pasa, motivo = pasa_criterio(_r(0.68, 0.52, 0.36))
    assert pasa and "68%" in motivo


def test_mayoria_pero_igual_que_el_azar_no_pasa():
    """La iteración 1: 59 % de los eventos en Alta, pero el azar daba 61 %."""
    pasa, motivo = pasa_criterio(_r(0.59, 0.61, -0.16))
    assert not pasa and "azar" in motivo


def test_sin_mayoria_no_pasa():
    assert not pasa_criterio(_r(0.45, 0.20, 0.5))[0]


def test_orden_al_reves_no_pasa_aunque_mejore_al_azar():
    pasa, motivo = pasa_criterio(_r(0.70, 0.50, -0.05))
    assert not pasa and "al revés" in motivo


def test_la_mejora_minima_es_de_diez_puntos():
    assert MEJORA_MINIMA == 0.10
    assert not pasa_criterio(_r(0.60, 0.51, 0.3))[0]       # 9 puntos
    assert pasa_criterio(_r(0.62, 0.51, 0.3))[0]           # 11 puntos
