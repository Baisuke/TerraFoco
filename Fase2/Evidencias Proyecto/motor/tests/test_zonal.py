# -*- coding: utf-8 -*-
"""Pruebas de la agregación de ráster por comuna.

Se fabrican rásteres sintéticos con rasterio: un plano de pendiente conocida,
un NDVI constante, un ráster con huecos. Así se verifica el recorte y la
media sin descargar NASADEM ni Sentinel-2, y sin base de datos.
"""
import numpy as np
import pytest

rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin      # noqa: E402

from indicadores.rusle import factor_C, factor_LS                    # noqa: E402
from ingesta.zonal import (                                          # noqa: E402
    agregar_por_comuna, tamano_de_celda, transformacion_c, transformacion_ls,
)

CELDA = 30.0
ORIGEN_X, ORIGEN_Y = 300000.0, 6200000.0     # UTM 19S, cualquier punto
EPSG_PROYECTADO = "EPSG:32719"


def escribir(tmp_path, arreglo, nombre="r.tif", crs=EPSG_PROYECTADO, nodata=None,
             dtype="float64"):
    """Escribe un GeoTIFF de prueba.

    Por defecto en float64: en float32 el valor 0,6 se guarda como 0,60000002
    y las comparaciones exactas contra la versión escalar fallan por un error
    de redondeo del andamiaje, no del código bajo prueba.
    """
    ruta = tmp_path / nombre
    transform = from_origin(ORIGEN_X, ORIGEN_Y, CELDA, CELDA)
    with rasterio.open(
        ruta, "w", driver="GTiff", height=arreglo.shape[0],
        width=arreglo.shape[1], count=1, dtype=dtype,
        crs=crs, transform=transform, nodata=nodata,
    ) as d:
        d.write(arreglo.astype(dtype), 1)
    return str(ruta)


def cuadro(fila0, col0, filas, columnas):
    """Polígono GeoJSON que cubre un bloque de celdas, en coordenadas del raster."""
    x0 = ORIGEN_X + col0 * CELDA
    x1 = ORIGEN_X + (col0 + columnas) * CELDA
    y0 = ORIGEN_Y - fila0 * CELDA
    y1 = ORIGEN_Y - (fila0 + filas) * CELDA
    return {"type": "Polygon",
            "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


def plano(filas, columnas, pendiente_pct):
    j = np.arange(columnas)[None, :]
    return np.repeat(j * CELDA * pendiente_pct / 100.0, filas, axis=0)


# --- sistema de referencia -------------------------------------------------

def test_rechaza_raster_en_grados(tmp_path):
    """Calcular pendiente con celdas en grados da un resultado absurdo.

    Es el error más caro posible en este módulo: no falla, solo entrega
    números equivocados por un factor de ~100.000.
    """
    ruta = escribir(tmp_path, np.zeros((5, 5)), crs="EPSG:4326")
    with rasterio.open(ruta) as d:
        with pytest.raises(SystemExit) as e:
            tamano_de_celda(d)
    assert "gdalwarp" in str(e.value)


def test_acepta_raster_proyectado(tmp_path):
    ruta = escribir(tmp_path, np.zeros((5, 5)))
    with rasterio.open(ruta) as d:
        assert tamano_de_celda(d) == (CELDA, CELDA)


# --- LS --------------------------------------------------------------------

def test_ls_de_un_plano_coincide_con_la_teoria(tmp_path):
    ruta = escribir(tmp_path, plano(20, 20, 12.0))
    # se evita el borde, donde Horn replica la fila exterior
    geoms = [(1, "Prueba", cuadro(3, 3, 10, 10))]

    r = agregar_por_comuna(ruta, geoms, transformacion_ls())
    assert r[1]["celdas"] == 100
    assert r[1]["valor"] == pytest.approx(factor_LS(12.0), rel=1e-6)


def test_cada_comuna_recibe_solo_sus_celdas(tmp_path):
    """Un ráster con dos mitades distintas debe dar dos valores distintos."""
    z = np.zeros((20, 20))
    z[:, 10:] = plano(20, 10, 20.0)          # mitad derecha inclinada
    ruta = escribir(tmp_path, z)

    geoms = [(1, "Plana", cuadro(3, 1, 10, 6)),
             (2, "Inclinada", cuadro(3, 12, 10, 6))]
    r = agregar_por_comuna(ruta, geoms, transformacion_ls())

    assert r[1]["valor"] < r[2]["valor"]
    assert r[2]["valor"] == pytest.approx(factor_LS(20.0), rel=1e-6)


def test_comuna_fuera_del_raster_no_inventa_un_cero(tmp_path):
    """Sin cobertura el valor es None. Un cero sería un dato falso."""
    ruta = escribir(tmp_path, plano(10, 10, 10.0))
    lejos = {"type": "Polygon", "coordinates": [[
        [ORIGEN_X + 90000, ORIGEN_Y], [ORIGEN_X + 91000, ORIGEN_Y],
        [ORIGEN_X + 91000, ORIGEN_Y - 1000], [ORIGEN_X + 90000, ORIGEN_Y - 1000],
        [ORIGEN_X + 90000, ORIGEN_Y]]]}

    r = agregar_por_comuna(ruta, [(9, "Lejana", lejos)], transformacion_ls())
    assert r[9]["valor"] is None
    assert r[9]["celdas"] == 0


# --- nodata ----------------------------------------------------------------

def test_el_nodata_no_se_toma_como_elevacion(tmp_path):
    """Un -32768 de relleno crearía un acantilado ficticio.

    NASADEM trae huecos rellenos con ese valor. Si entra al cálculo de
    pendiente, la celda y sus ocho vecinas quedan con una pendiente
    disparatada, y eso contamina el promedio de la comuna entera.
    """
    z = plano(20, 20, 10.0)
    z[10, 10] = -32768.0
    ruta = escribir(tmp_path, z, nodata=-32768.0)

    geoms = [(1, "Con hueco", cuadro(3, 3, 14, 14))]
    r = agregar_por_comuna(ruta, geoms, transformacion_ls())

    # Sin el tratamiento de nodata, la media se dispararia decenas de veces.
    assert r[1]["valor"] == pytest.approx(factor_LS(10.0), rel=0.5)


# --- C ---------------------------------------------------------------------

@pytest.mark.parametrize("ndvi", [0.0, 0.25, 0.6, 0.85])
def test_c_vectorizado_coincide_con_el_escalar(tmp_path, ndvi):
    ruta = escribir(tmp_path, np.full((10, 10), ndvi))
    geoms = [(1, "Uniforme", cuadro(2, 2, 6, 6))]

    r = agregar_por_comuna(ruta, geoms, transformacion_c())
    assert r[1]["valor"] == pytest.approx(factor_C(ndvi), rel=1e-9)


def test_c_agua_y_nube_dan_cobertura_nula(tmp_path):
    """NDVI negativo es agua o nube: sin vegetación que proteja, C = 1."""
    ruta = escribir(tmp_path, np.full((10, 10), -0.3))
    r = agregar_por_comuna(ruta, [(1, "Agua", cuadro(2, 2, 6, 6))],
                           transformacion_c())
    assert r[1]["valor"] == pytest.approx(1.0)


def test_c_baja_donde_hay_mas_vegetacion(tmp_path):
    z = np.full((20, 20), 0.1)
    z[:, 10:] = 0.7
    ruta = escribir(tmp_path, z)

    geoms = [(1, "Desnuda", cuadro(2, 2, 6, 6)),
             (2, "Vegetada", cuadro(2, 12, 6, 6))]
    r = agregar_por_comuna(ruta, geoms, transformacion_c())
    assert r[2]["valor"] < r[1]["valor"]


# --- sin transformación ----------------------------------------------------

def test_sin_transformacion_promedia_el_raster_crudo(tmp_path):
    z = np.zeros((10, 10))
    z[2:8, 2:8] = 5.0
    ruta = escribir(tmp_path, z)

    r = agregar_por_comuna(ruta, [(1, "Centro", cuadro(2, 2, 6, 6))])
    assert r[1]["valor"] == pytest.approx(5.0)
