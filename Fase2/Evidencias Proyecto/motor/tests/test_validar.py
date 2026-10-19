# -*- coding: utf-8 -*-
"""
Pruebas de la validacion contra la linea base.

Aqui se comprueba la estadistica, no la base de datos. El rho que sale de
estas funciones termina impreso en el informe de titulo, asi que tiene que
estar verificado contra casos de respuesta conocida: un error silencioso en
el calculo de rangos daria un numero plausible y equivocado, que es
exactamente la clase de error que nadie detecta leyendo la salida.
"""
import numpy as np
import pytest

from validar import barrido, rangos, significancia, spearman


# ------------------------------------------------------------------ rangos

def test_rangos_sin_empates():
    assert list(rangos([10, 30, 20])) == [1.0, 3.0, 2.0]


def test_los_empates_comparten_el_promedio():
    """Sin esto el resultado dependeria del orden en que llegan las filas."""
    assert list(rangos([5, 7, 7, 9])) == [1.0, 2.5, 2.5, 4.0]
    assert list(rangos([1, 1, 1])) == [2.0, 2.0, 2.0]


def test_el_orden_de_entrada_no_altera_los_rangos():
    datos = [3.0, 1.0, 3.0, 2.0]
    az = np.random.default_rng(1)
    esperado = sorted(rangos(datos))
    for _ in range(20):
        assert sorted(rangos(az.permutation(datos))) == esperado


# ---------------------------------------------------------------- spearman

def test_monotona_creciente_da_uno():
    assert spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]) == pytest.approx(1.0)


def test_monotona_decreciente_da_menos_uno():
    assert spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10]) == pytest.approx(-1.0)


def test_mide_el_orden_y_no_la_escala():
    """Es la razon de usar Spearman: CIREN y TerraFoco no son comparables en
    magnitud, solo en como ordenan el territorio."""
    x = [1, 2, 3, 4, 5]
    assert spearman(x, [1, 4, 9, 16, 25]) == pytest.approx(1.0)
    assert spearman(x, [2 ** n for n in x]) == pytest.approx(1.0)


def test_caso_con_respuesta_conocida():
    """Ejemplo clasico: d = [-1, 1, 0, 0, 0], suma de d^2 = 2, n = 5.
    rho = 1 - 6*2 / (5*24) = 0.9"""
    assert spearman([1, 2, 3, 4, 5], [2, 1, 3, 4, 5]) == pytest.approx(0.9)


def test_una_constante_no_tiene_correlacion_definida():
    assert np.isnan(spearman([1, 2, 3], [7, 7, 7]))


def test_es_simetrica():
    a, b = [4, 1, 7, 3], [9, 2, 8, 5]
    assert spearman(a, b) == pytest.approx(spearman(b, a))


# ----------------------------------------------------------- significancia

def test_la_relacion_perfecta_es_improbable_por_azar():
    p = significancia([1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7], 2000)
    assert p < 0.01


def test_el_ruido_no_alcanza_significancia():
    az = np.random.default_rng(7)
    p = significancia(list(az.normal(size=30)), list(az.normal(size=30)), 2000)
    assert p > 0.05


def test_es_reproducible():
    """Con semilla fija, dos corridas dan lo mismo: si no, el p del informe
    cambiaria cada vez que alguien lo vuelve a correr."""
    a, b = [3, 1, 4, 1, 5, 9, 2, 6], [2, 7, 1, 8, 2, 8, 1, 8]
    assert significancia(a, b, 500) == significancia(a, b, 500)


def test_nunca_devuelve_cero():
    """El estimador lleva +1 arriba y abajo. Informar p = 0 seria afirmar
    imposibilidad, que 20.000 permutaciones no autorizan."""
    assert significancia([1, 2, 3, 4, 5], [1, 2, 3, 4, 5], 100) > 0


# --------------------------------------------------------------- barrido

def test_el_barrido_excluye_por_erosividad():
    # Seis comunas ordenan igual en ambos origenes; las dos de erosividad
    # alta rompen ese orden, que es el patron real de la precordillera.
    filas = [{"r": 900.0, "base": 1.0, "propio": 1.0},
             {"r": 1000.0, "base": 2.0, "propio": 2.0},
             {"r": 1100.0, "base": 3.0, "propio": 3.0},
             {"r": 1200.0, "base": 4.0, "propio": 4.0},
             {"r": 1500.0, "base": 5.0, "propio": 5.0},
             {"r": 1800.0, "base": 6.0, "propio": 6.0},
             {"r": 2500.0, "base": 7.0, "propio": 0.5},
             {"r": 5000.0, "base": 8.0, "propio": 0.2}]
    resultado = dict((u, (n, rho)) for u, n, rho in barrido(filas, [2000, 6000]))
    assert resultado[2000][0] == 6        # deja fuera las dos altas
    assert resultado[6000][0] == 8
    # Con la comuna que rompe el orden, la correlacion baja.
    assert resultado[2000][1] > resultado[6000][1]


def test_el_barrido_omite_muestras_demasiado_chicas():
    filas = [{"r": 900.0, "base": 1.0, "propio": 1.0}] * 3
    assert barrido(filas, [1000]) == []


def test_las_comunas_sin_erosividad_no_entran():
    filas = [{"r": None, "base": 1.0, "propio": 1.0}] * 10
    assert barrido(filas, [2000]) == []
