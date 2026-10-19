# -*- coding: utf-8 -*-
"""Red hídrica y distancia a cauces. Sin base de datos ni red."""
import numpy as np
import pytest

from ingesta.cauces import _entero, url_wfs


def test_entero_tolera_lo_que_manda_el_wfs():
    """strahler_n llega como texto, y a veces vacío o ausente."""
    assert _entero("5") == 5
    assert _entero(7) == 7
    assert _entero("") is None
    assert _entero(None) is None
    assert _entero("x") is None


def test_url_wfs_pide_geojson_en_4326_dentro_del_bbox():
    u = url_wfs((-72.1, -35.05, -70.02, -33.85))
    assert "request=GetFeature" in u
    assert "outputFormat=application%2Fjson" in u
    assert "srsName=EPSG%3A4326" in u
    assert "bbox=-72.1%2C-35.05%2C-70.02%2C-33.85%2CEPSG%3A4326" in u


def test_distancia_euclidiana_en_metros_desde_una_linea():
    """La transformada de distancia, tal como la usa distancia_a_cauces:
    una columna de cauce en el centro y celdas de 30 m."""
    from scipy.ndimage import distance_transform_edt
    es_cauce = np.zeros((5, 7), dtype=bool)
    es_cauce[:, 3] = True
    d = distance_transform_edt(~es_cauce, sampling=(30.0, 30.0))
    assert d[2, 3] == 0
    assert d[2, 2] == 30 and d[2, 4] == 30
    assert d[2, 0] == 90 and d[2, 6] == 90
