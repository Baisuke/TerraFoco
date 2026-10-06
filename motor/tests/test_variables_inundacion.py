# -*- coding: utf-8 -*-
"""Las variables del índice de inundación que lee el visor.

El navegador reconstruye el índice desde estos bytes: si la cuantización, el
orden de los canales o la media por patrón se desalinean con el motor, el
visor explica una celda con números que no son los que la clasificaron.
"""
import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds

from variables_inundacion import (PASOS, Z, cuantizar, indice_comunal, indice_de_muestra,
                                  normalizada, original, tesela_de_variables)
from teselas import TAMANO, limites_mercator


def test_cero_es_sin_dato_y_los_extremos_van_a_1_y_255():
    q = cuantizar([np.nan, 0.0, 5.0, 10.0, 99.0], 0.0, 10.0, +1)
    assert q.tolist() == [0, 1, 128, 255, 255]


def test_las_inversas_se_voltean_antes_de_guardar():
    """Lo guardado es lo que entra a la suma: una pendiente baja suma mucho."""
    q = cuantizar([0.0, 10.0], 0.0, 10.0, -1)
    assert q.tolist() == [255, 1]


def test_ida_y_vuelta_dentro_de_medio_paso():
    x = np.linspace(-3, 13, 200)
    for sentido in (+1, -1):
        n = normalizada(cuantizar(x, 0.0, 10.0, sentido))
        esperado = np.clip(x / 10.0, 0, 1)
        if sentido < 0:
            esperado = 1 - esperado
        assert np.nanmax(np.abs(n - esperado)) <= 0.5 / PASOS + 1e-12
        # Y de vuelta a la unidad original, dentro del rango recortado.
        dentro = (x >= 0) & (x <= 10)
        assert np.allclose(original(n, 0.0, 10.0, sentido)[dentro], x[dentro], atol=10 / PASOS)


def test_la_media_comunal_usa_solo_las_celdas_con_las_variables_con_peso():
    # Dos patrones: 63 (las seis) y 31 (sin cobertura, el bit 5).
    grupos = [
        {"patron": 63, "celdas": 100, "sumas": [0, 50, 0, 0, 80, 30]},
        {"patron": 31, "celdas": 50, "sumas": [0, 40, 0, 0, 10, 0]},
    ]
    # Sin cobertura en el juego: entran los 150.
    assert abs(indice_comunal(grupos, [0, 50, 0, 0, 50, 0]) - (0.5 * 90 + 0.5 * 90) / 150) < 1e-12
    # Con cobertura: solo los 100 que la tienen.
    assert abs(indice_comunal(grupos, [0, 50, 0, 0, 0, 50]) - (0.5 * 50 + 0.5 * 30) / 100) < 1e-12
    assert indice_comunal([{"patron": 1, "celdas": 5, "sumas": [1] * 6}], [0, 100, 0, 0, 0, 0]) is None


def test_la_muestra_filtra_como_el_motor():
    bloque = np.array([[0, 255, 0, 0, 1, 0],      # acumulación y curvatura: entra
                       [9, 0, 9, 9, 128, 9]],     # sin acumulación: fuera
                      dtype="uint8")
    idx = indice_de_muestra(bloque, [0, 50, 0, 0, 50, 0])
    assert idx.shape == (1,) and abs(idx[0] - 0.5) < 1e-12


def test_disposicion_de_la_tesela():
    """Arriba R,G,B = variables 0,1,2; abajo, 3,4,5. El visor lo lee así."""
    x, y = 623, 1242                                  # una tesela z11 de O'Higgins
    oeste, sur, este, norte = limites_mercator(x, y, Z)
    datos = np.stack([np.full((64, 64), 10 * (k + 1), dtype="uint8") for k in range(6)])
    perfil = {"driver": "GTiff", "count": 6, "dtype": "uint8", "nodata": 0,
              "width": 64, "height": 64, "crs": "EPSG:3857",
              "transform": from_bounds(oeste, sur, este, norte, 64, 64)}
    with MemoryFile() as mf:
        with mf.open(**perfil) as d:
            d.write(datos)
        with mf.open() as fuente:
            img = tesela_de_variables(fuente, x, y)
    assert img.shape == (3, 2 * TAMANO, TAMANO)
    assert [int(img[c, 5, 5]) for c in range(3)] == [10, 20, 30]
    assert [int(img[c, TAMANO + 5, 5]) for c in range(3)] == [40, 50, 60]


def test_tesela_vacia_no_se_guarda():
    x, y = 623, 1242
    oeste, sur, este, norte = limites_mercator(x, y, Z)
    perfil = {"driver": "GTiff", "count": 6, "dtype": "uint8", "nodata": 0,
              "width": 8, "height": 8, "crs": "EPSG:3857",
              "transform": from_bounds(oeste, sur, este, norte, 8, 8)}
    with MemoryFile() as mf:
        with mf.open(**perfil) as d:
            d.write(np.zeros((6, 8, 8), dtype="uint8"))
        with mf.open() as fuente:
            assert tesela_de_variables(fuente, x, y) is None
