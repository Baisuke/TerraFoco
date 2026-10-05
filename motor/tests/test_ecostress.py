# -*- coding: utf-8 -*-
"""
Pruebas del modulo de temperatura superficial.

Se cubre la conversion y el promediado, que es donde un error no se nota: un
factor de escala mal aplicado o un relleno tratado como dato dan un numero
plausible. De hecho paso durante el desarrollo — aplicar el factor 0,02 que
documentan otras versiones del producto daba -267 C, y solo se detecto
porque el valor era absurdo. Con un error mas sutil no habria saltado.

La descarga no se prueba aqui: depende de la red y de credenciales.
"""
import numpy as np
import pytest

from ingesta.ecostress import (C_MAXIMO, C_MINIMO, CERO_ABSOLUTO,
                               es_de_verano, promedio_de_escenas)


# ------------------------------------------------------- ventana de verano

@pytest.mark.parametrize("nombre,esperado", [
    ("ECOv002_L2T_LSTE_36802_026_19HCC_20250101T230928_0713_01_LST.tif", True),
    ("ECOv002_L2T_LSTE_36802_026_19HCC_20250228T101500_0713_01_LST.tif", True),
    ("ECOv002_L2T_LSTE_36802_026_19HCC_20250715T101500_0713_01_LST.tif", False),
    ("ECOv002_L2T_LSTE_36802_026_19HCC_20241203T101500_0713_01_LST.tif", False),
])
def test_solo_enero_y_febrero_son_verano(nombre, esperado):
    """Hemisferio sur. Una escena de julio mide el invierno, no la isla."""
    assert es_de_verano(nombre) is esperado


def test_un_nombre_sin_fecha_no_se_toma_por_verano():
    assert es_de_verano("cualquier_cosa.tif") is False


# ------------------------------------------------------------- conversion

def test_el_cero_absoluto_es_el_valor_fisico():
    """Si alguien lo redondea a 273, cada lectura se corre 0,15 grados."""
    assert CERO_ABSOLUTO == 273.15


def test_los_limites_de_cordura_cubren_una_superficie_real():
    """Un suelo desnudo al sol pasa de 60 C; el aire nunca, pero la superficie
    si. Y bajo -20 C en O'Higgins delata un relleno tomado por dato."""
    assert C_MINIMO < 0 < 50 < C_MAXIMO
    # El error real que ocurrio: aplicar el factor 0,02 a un dato que ya
    # venia en Kelvin da -267 C, y tiene que quedar fuera de rango.
    assert (300.0 * 0.02) - CERO_ABSOLUTO < C_MINIMO


# -------------------------------------------------------------- promediado

def _escena(valores):
    """Una escena falsa en Kelvin, con NaN donde no hay dato."""
    return np.asarray(valores, dtype="float32") + CERO_ABSOLUTO


def test_promedia_celda_a_celda(monkeypatch, tmp_path):
    from ingesta import ecostress

    escenas = {"a": _escena([[10.0, 20.0]]), "b": _escena([[20.0, 30.0]])}

    def falso_leer(ruta):
        clave = ruta.split("/")[-1]
        return escenas[clave] - CERO_ABSOLUTO, {"crs": "EPSG:32719"}

    monkeypatch.setattr(ecostress, "leer_celsius", falso_leer)
    media, _perfil, usadas = ecostress.promedio_de_escenas(["a", "b"])

    assert usadas == 2
    assert media[0][0] == pytest.approx(15.0)
    assert media[0][1] == pytest.approx(25.0)


def test_una_celda_sin_dato_no_arrastra_el_promedio(monkeypatch):
    """Lo importante: la celda nublada en una escena se promedia solo con las
    escenas donde si habia dato, no cuenta como cero."""
    from ingesta import ecostress

    datos = {"a": np.array([[10.0, np.nan]], dtype="float32"),
             "b": np.array([[20.0, 30.0]], dtype="float32")}
    monkeypatch.setattr(ecostress, "leer_celsius",
                        lambda r: (datos[r], {"crs": "EPSG:32719"}))

    media, _p, usadas = ecostress.promedio_de_escenas(["a", "b"])
    assert usadas == 2
    assert media[0][0] == pytest.approx(15.0)    # (10+20)/2
    assert media[0][1] == pytest.approx(30.0)    # solo la escena b


def test_las_escenas_vacias_se_descartan(monkeypatch):
    from ingesta import ecostress
    datos = {"buena": np.array([[12.0]], dtype="float32"), "nublada": None}

    def falso(r):
        d = datos[r]
        return (None, None) if d is None else (d, {"crs": "EPSG:32719"})

    monkeypatch.setattr(ecostress, "leer_celsius", falso)
    media, _p, usadas = ecostress.promedio_de_escenas(["nublada", "buena"])
    assert usadas == 1
    assert media[0][0] == pytest.approx(12.0)


def test_sin_escenas_utiles_no_inventa_un_resultado(monkeypatch):
    from ingesta import ecostress
    monkeypatch.setattr(ecostress, "leer_celsius", lambda r: (None, None))
    media, perfil, usadas = ecostress.promedio_de_escenas(["a", "b"])
    assert media is None and perfil is None and usadas == 0


def test_las_teselas_de_distinto_tamano_no_se_mezclan(monkeypatch):
    """Apilarlas sin remuestrear daria un error de forma o, peor, un
    resultado desplazado. Se omiten y se avisa."""
    from ingesta import ecostress
    datos = {"chica": np.array([[10.0]], dtype="float32"),
             "grande": np.array([[10.0, 11.0], [12.0, 13.0]], dtype="float32")}
    monkeypatch.setattr(ecostress, "leer_celsius",
                        lambda r: (datos[r], {"crs": "EPSG:32719"}))

    media, _p, usadas = ecostress.promedio_de_escenas(["chica", "grande"])
    assert usadas == 1
    assert media.shape == (1, 1)
