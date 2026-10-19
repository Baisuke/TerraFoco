# -*- coding: utf-8 -*-
"""Pruebas del paso de elevación a pendiente y de pendiente a LS.

La gracia de trabajar sobre arreglos es que se puede construir un terreno
cuya pendiente se conoce de forma analítica —un plano inclinado— y exigir que
el algoritmo la reproduzca. Si Horn devuelve 21% donde el plano tiene 20%, hay
un error en el tamaño de celda, y ese error se propaga a toda la región sin
que nada falle.
"""
import numpy as np
import pytest

from indicadores.rusle import factor_LS
from indicadores.terreno import (
    ls_de_comuna, ls_desde_pendiente, media_ponderada, pendiente_horn,
)


def plano(filas, columnas, pendiente_pct, dx=30.0, eje="x"):
    """Superficie perfectamente inclinada, para comparar contra la teoría."""
    j, i = np.meshgrid(np.arange(columnas), np.arange(filas))
    paso = dx * pendiente_pct / 100.0
    return (j * paso if eje == "x" else i * paso).astype("float64")


# --- pendiente -------------------------------------------------------------

def test_plano_horizontal_no_tiene_pendiente():
    assert np.allclose(pendiente_horn(np.full((8, 8), 137.0), 30.0), 0.0)


@pytest.mark.parametrize("pct", [1.0, 5.0, 12.5, 30.0, 60.0])
def test_reproduce_la_pendiente_de_un_plano(pct):
    """En el interior, Horn debe dar el valor exacto del plano."""
    z = plano(10, 10, pct, dx=30.0)
    p = pendiente_horn(z, 30.0)
    assert np.allclose(p[1:-1, 1:-1], pct, rtol=1e-9)


def test_da_igual_la_direccion_de_la_maxima_pendiente():
    a = pendiente_horn(plano(10, 10, 20.0, eje="x"), 30.0)
    b = pendiente_horn(plano(10, 10, 20.0, eje="y"), 30.0)
    assert np.allclose(a[1:-1, 1:-1], b[1:-1, 1:-1])


def test_el_tamano_de_celda_cambia_el_resultado():
    """El mismo desnivel en celdas más chicas es una pendiente mayor.

    Pasar la resolución equivocada -30 donde son 90- multiplica la pendiente
    por tres y la erosión con ella, sin lanzar ningún error.
    """
    z = plano(10, 10, 20.0, dx=30.0)
    fina = pendiente_horn(z, 10.0)[1:-1, 1:-1]
    gruesa = pendiente_horn(z, 90.0)[1:-1, 1:-1]
    assert np.allclose(fina, gruesa * 9.0)


def test_conserva_la_forma_del_arreglo():
    z = plano(7, 11, 15.0)
    assert pendiente_horn(z, 30.0).shape == z.shape


def test_celda_rectangular():
    """dx y dy distintos son válidos: NASADEM en geográficas no es cuadrado."""
    z = plano(10, 10, 20.0, dx=30.0, eje="x")
    p = pendiente_horn(z, 30.0, dy=90.0)
    assert np.allclose(p[1:-1, 1:-1], 20.0)


def test_rechaza_entradas_invalidas():
    with pytest.raises(ValueError):
        pendiente_horn(np.zeros(5), 30.0)
    with pytest.raises(ValueError):
        pendiente_horn(np.zeros((5, 5)), 0.0)


# --- LS vectorizado --------------------------------------------------------

@pytest.mark.parametrize("pct", [0.0, 2.0, 8.9, 9.1, 15.0, 40.0])
def test_la_version_vectorizada_coincide_con_la_escalar(pct):
    """Las dos implementaciones no pueden divergir sin que esto falle."""
    esperado = factor_LS(pct, 50.0)
    obtenido = float(ls_desde_pendiente(np.array([[pct]]), 50.0)[0, 0])
    assert obtenido == pytest.approx(esperado, rel=1e-12)


def test_ls_crece_con_la_pendiente():
    ls = ls_desde_pendiente(np.array([0.0, 5.0, 15.0, 30.0]), 50.0)
    assert np.all(np.diff(ls) > 0)


def test_ls_acepta_longitudes_por_celda():
    """Cuando exista la acumulación de flujo, entra por aquí."""
    pend = np.full((3, 3), 10.0)
    corta = ls_desde_pendiente(pend, np.full((3, 3), 25.0))
    larga = ls_desde_pendiente(pend, np.full((3, 3), 200.0))
    assert np.all(larga > corta)


def test_ls_en_plano_no_es_cero():
    """Cero anularía A = R*K*LS*C*P en todo el valle central."""
    assert np.allclose(ls_desde_pendiente(np.zeros((4, 4))), 0.03)


def test_ls_rechaza_valores_imposibles():
    with pytest.raises(ValueError):
        ls_desde_pendiente(np.array([-1.0]))
    with pytest.raises(ValueError):
        ls_desde_pendiente(np.array([5.0]), np.array([0.0]))


# --- agregación ------------------------------------------------------------

def test_media_ignora_nan():
    v = np.array([1.0, 2.0, np.nan, 3.0])
    media, n = media_ponderada(v)
    assert media == pytest.approx(2.0)
    assert n == 3


def test_media_respeta_la_mascara():
    v = np.array([[1.0, 100.0], [1.0, 100.0]])
    mascara = np.array([[True, False], [True, False]])
    media, n = media_ponderada(v, mascara)
    assert media == pytest.approx(1.0)
    assert n == 2


def test_sin_celdas_validas_devuelve_none_no_nan():
    """Distinguir 'no hay dato' de 'el dato es cero' evita un mapa mentiroso."""
    media, n = media_ponderada(np.array([np.nan, np.nan]))
    assert media is None and n == 0

    media, n = media_ponderada(np.ones((2, 2)), np.zeros((2, 2), dtype=bool))
    assert media is None and n == 0


def test_pesos_por_superficie_de_celda():
    v = np.array([10.0, 20.0])
    media, _ = media_ponderada(v, pesos=np.array([3.0, 1.0]))
    assert media == pytest.approx(12.5)


# --- el recorrido completo -------------------------------------------------

def test_de_dem_a_ls_de_comuna():
    z = plano(20, 20, 12.0, dx=30.0)
    mascara = np.zeros_like(z, dtype=bool)
    mascara[2:-2, 2:-2] = True          # se evita el borde replicado

    ls, n = ls_de_comuna(z, 30.0, mascara)
    assert n == 16 * 16
    assert ls == pytest.approx(factor_LS(12.0, 22.13), rel=1e-9)


@pytest.mark.parametrize("suave,fuerte", [(2.0, 40.0), (0.0, 60.0), (5.0, 25.0)])
def test_promediar_ls_no_es_promediar_pendiente(suave, fuerte):
    """Los dos órdenes dan resultados distintos, y por eso el orden importa.

    `ls_de_comuna` promedia el LS, no la pendiente. La razón es que LS es lo
    que entra en el producto R*K*LS*C*P: promediar antes de transformar
    responde a otra pregunta.

    Lo interesante es que **el sesgo no siempre va en la misma dirección**.
    Medido sobre estos pares:

        2% y 40%   promediar LS da  +5,4%
        5% y 25%   promediar LS da  +6,8%
        0% y 60%   promediar LS da  -1,5%

    La ecuación de McCool es lineal a trozos y cambia de recta en 9%, así que
    LS no es convexa en todo el rango y la desigualdad de Jensen no aplica de
    forma global. Conviene saberlo antes de que alguien en la defensa
    pregunte por qué el resultado difiere de un cálculo hecho al revés.
    """
    pend = np.array([[suave, suave], [fuerte, fuerte]])

    ls_promediado = float(np.mean(ls_desde_pendiente(pend, 50.0)))
    ls_de_la_media = factor_LS(float(pend.mean()), 50.0)

    assert ls_promediado != pytest.approx(ls_de_la_media, rel=1e-3)


# --------------------------------------------------------------------------
# Curvatura
# --------------------------------------------------------------------------

def test_curvatura_plano_es_cero():
    from indicadores.terreno import curvatura
    z = np.full((5, 5), 100.0)
    assert np.allclose(curvatura(z, 30.0), 0.0)


def test_curvatura_rampa_uniforme_es_cero():
    """Una pendiente constante no tiene curvatura: la segunda derivada es 0."""
    from indicadores.terreno import curvatura
    z = np.tile(np.arange(5, dtype="float64") * 10.0, (5, 1))
    assert np.allclose(curvatura(z, 30.0)[1:-1, 1:-1], 0.0)


def test_curvatura_valle_es_negativa_y_loma_positiva():
    """El signo es lo que importa para inundaciones: concavo negativo."""
    from indicadores.terreno import curvatura
    x = np.arange(-3, 4, dtype="float64")
    valle = np.tile(x ** 2, (7, 1))       # fondo en el centro
    loma = -valle
    assert curvatura(valle, 30.0)[3, 3] < 0
    assert curvatura(loma, 30.0)[3, 3] > 0
    # Simetrica: mismo valor, signo opuesto
    assert np.isclose(curvatura(valle, 30.0)[3, 3], -curvatura(loma, 30.0)[3, 3])


def test_curvatura_rechaza_celda_invalida():
    from indicadores.terreno import curvatura
    with pytest.raises(ValueError):
        curvatura(np.zeros((3, 3)), 0)
