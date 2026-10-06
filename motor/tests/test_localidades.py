# -*- coding: utf-8 -*-
"""Localidades: nombres propios y consulta al servicio del censo."""
import urllib.parse

from ingesta.localidades import nombre_propio, url_consulta


def test_las_particulas_van_en_minuscula():
    assert nombre_propio("PUNTA DE CORTÉS") == "Punta de Cortés"
    assert nombre_propio("SAN VICENTE DE TAGUA TAGUA") == "San Vicente de Tagua Tagua"


def test_la_primera_palabra_siempre_con_mayuscula():
    """"La Estrella" empieza con partícula y es nombre propio igual."""
    assert nombre_propio("LA ESTRELLA") == "La Estrella"
    assert nombre_propio("EL TAMBO") == "El Tambo"


def test_apostrofo_y_guion():
    assert nombre_propio("O'HIGGINS") == "O'Higgins"
    assert nombre_propio("TAGUA-TAGUA") == "Tagua-Tagua"


def test_tras_un_guion_suelto_empieza_otro_nombre():
    assert nombre_propio("LA ESPERANZA - EL CORTIJO") == "La Esperanza - El Cortijo"


def test_espacios_y_vacios():
    assert nombre_propio("  VILLA   SAN RAMÓN DOS ") == "Villa San Ramón Dos"
    assert nombre_propio(None) == ""


def test_la_region_va_sin_cero_inicial():
    """El servicio guarda '6', no '06': con el cero no devuelve nada."""
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(url_consulta("06")).query)
    assert q["where"] == ["REGION='6'"]
    assert q["f"] == ["geojson"] and q["outSR"] == ["4326"]
