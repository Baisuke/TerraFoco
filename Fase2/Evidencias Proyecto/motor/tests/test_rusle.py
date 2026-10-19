# -*- coding: utf-8 -*-
"""Pruebas del modelo RUSLE. Son las unicas que se pueden escribir sin datos."""
import pytest

from indicadores.rusle import Factores, clasificar


def test_producto_de_los_cinco_factores():
    f = Factores(R=1190, K=0.0281, LS=4.06, C=0.29, P=0.97)
    assert f.perdida() == pytest.approx(38.2, abs=0.5)


def test_un_factor_en_cero_anula_el_resultado():
    """Sin lluvia no hay erosion, por empinado que sea el terreno."""
    f = Factores(R=0, K=0.03, LS=20, C=1.0, P=1.0)
    with pytest.raises(ValueError):
        f.perdida()          # R=0 queda fuera del rango plausible


def test_rechaza_factores_fuera_de_rango():
    f = Factores(R=1000, K=5.0, LS=2.0, C=0.2, P=0.9)   # K absurdo
    fuera = f.validar()
    assert any(x.startswith("K") for x in fuera)


def test_clasificacion_segun_rangos_de_ciren():
    assert clasificar(8.0) == "Ligera"
    assert clasificar(15.0) == "Moderada"
    assert clasificar(22.0) == "Severa"
    assert clasificar(30.0) == "Muy severa"
    assert clasificar(45.0) == "Extrema"
