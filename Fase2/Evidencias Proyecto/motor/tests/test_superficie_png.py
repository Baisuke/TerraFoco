# -*- coding: utf-8 -*-
"""Superficie erosionada desde los PNG del visor (--desde-png).

El PNG trae la clase de cada celda con los colores de RAMPA; "Severa o
superior" son las clases sobre el corte de 18 t/ha/año. Si el conteo por
color se desalinea de los cortes, el índice de pertinencia cambia de
denominador sin que nada falle.
"""
import json

import numpy as np
import rasterio

from indicadores.superficie_erosionada import UMBRAL_T_HA, medir_png, rutas_png
from mapa_erosion import RAMPA


def _png(ruta, clases):
    """PNG RGBA con una celda por clase de `clases` (-1 = transparente)."""
    alto, ancho = clases.shape
    img = np.zeros((4, alto, ancho), dtype="uint8")
    for k, (_corte, color) in enumerate(RAMPA):
        m = clases == k
        for b in range(3):
            img[b][m] = color[b]
        img[3][m] = 255
    with rasterio.open(ruta, "w", driver="PNG", width=ancho, height=alto, count=4,
                       dtype="uint8") as d:
        d.write(img)


def test_severa_o_superior_son_las_clases_sobre_18(tmp_path):
    # Ligera, Moderada, Severa, Muy severa, Extrema y dos transparentes.
    clases = np.array([[0, 1, 2, 3], [4, 4, -1, -1]])
    ruta = str(tmp_path / "erosion_6101.png")
    _png(ruta, clases)
    evaluadas, severas = medir_png(ruta, pixeles=1000, resolucion_m=30.0)
    assert evaluadas == 1000 * 900 / 1e4                     # 90 ha
    assert abs(severas - evaluadas * 4 / 6) < 1e-9           # 4 de 6 opacas sobre 18
    assert RAMPA[1][0] == UMBRAL_T_HA                        # Moderada cierra en 18


def test_transparente_no_cuenta(tmp_path):
    ruta = str(tmp_path / "erosion_6102.png")
    _png(ruta, np.array([[-1, -1], [-1, 0]]))
    _ev, severas = medir_png(ruta, pixeles=10, resolucion_m=30.0)
    assert severas == 0


def test_rutas_desde_el_indice(tmp_path):
    _png(str(tmp_path / "erosion_6101.png"), np.array([[0]]))
    (tmp_path / "indice.json").write_text(json.dumps({"region": 6, "comunas": [
        {"id_comuna": 6101, "png": "erosion_6101.png", "pixeles": 5, "resolucion_m": 30.0},
        {"id_comuna": 6102, "png": "erosion_6102.png", "pixeles": 5, "resolucion_m": 30.0},
    ]}), encoding="utf-8")
    r = rutas_png(str(tmp_path))
    assert list(r) == [6101]                                  # sin PNG, se omite
    assert r[6101][1:] == (5, 30.0)
