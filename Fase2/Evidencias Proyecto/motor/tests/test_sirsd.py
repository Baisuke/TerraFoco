# -*- coding: utf-8 -*-
"""Pruebas del cargador del SIRSD-S.

Se prueba la lógica pura -normalización, números, mapeo de columnas y el
reparto entre cargable y rechazado-, que no necesita base de datos. Ahí es
donde están los errores que corrompen el indicador en silencio.
"""
from ingesta.sirsd import (
    a_numero, emparejar_practica, mapear_columnas, normalizar, procesar,
)

COMUNAS = {
    "rancagua": 6101,
    "machali": 6102,
    "san vicente": 6116,
    "las cabras": 6114,
}
PRACTICAS = {
    "establecimiento de cubierta vegetal": 1,
    "labranza minima o cero laboreo": 2,
    "enmiendas calcareas": 4,
}


# --- normalización --------------------------------------------------------

def test_normalizar_quita_tildes_y_mayusculas():
    assert normalizar("MACHALÍ") == "machali"
    assert normalizar("Ñuñoa") == "nunoa"


def test_normalizar_colapsa_espacios_y_puntuacion():
    assert normalizar("  San   Vicente ") == "san vicente"
    assert normalizar("O'Higgins") == "o higgins"


# --- conversión de números ------------------------------------------------

def test_formato_chileno_no_se_lee_como_decimal():
    """'1.234' son mil doscientos treinta y cuatro, no 1,234.

    Es el error que subestimaría el monto por mil sin que nada falle.
    """
    assert a_numero("1.234,50") == 1234.50
    assert a_numero("$ 12.500.000") == 12500000.0
    assert a_numero("1234,5") == 1234.5


def test_vacios_y_marcadores_dan_none():
    for v in (None, "", "  ", "-", "s/i", "N/A"):
        assert a_numero(v) is None


def test_numero_simple():
    assert a_numero("45") == 45.0
    assert a_numero(45.5) == 45.5


def test_puntos_de_miles_sin_coma():
    """'12.500.000' es doce millones y medio, no un ValueError.

    Antes esta entrada devolvía None y la fila entraba con monto vacío: la
    comuna aparecía con menos inversión de la real y nadie lo notaba.
    """
    assert a_numero("12.500.000") == 12500000.0
    assert a_numero("1.234") == 1234.0


def test_punto_decimal_se_respeta():
    """Un punto que no separa grupos de tres es decimal, no de miles."""
    assert a_numero("1234.5") == 1234.5
    assert a_numero("0.75") == 0.75


# --- mapeo de columnas ----------------------------------------------------

def test_mapea_cabeceras_con_variantes():
    mapa = mapear_columnas(["Comuna", "Superficie Ha", "Monto Bonificado",
                            "N° Beneficiarios", "Práctica"])
    assert mapa["comuna"] == "Comuna"
    assert mapa["superficie"] == "Superficie Ha"
    assert mapa["monto"] == "Monto Bonificado"
    assert mapa["beneficiarios"] == "N° Beneficiarios"


def test_mapeo_por_contencion():
    mapa = mapear_columnas(["NOM COMUNA", "MONTO TOTAL 2024"])
    assert mapa["comuna"] == "NOM COMUNA"
    assert mapa["monto"] == "MONTO TOTAL 2024"


# --- prácticas ------------------------------------------------------------

def test_practica_exacta_y_laxa():
    assert emparejar_practica("Enmiendas calcáreas", PRACTICAS) == 4
    assert emparejar_practica("cubierta vegetal", PRACTICAS) == 1
    assert emparejar_practica("labranza minima", PRACTICAS) == 2


def test_practica_desconocida_no_revienta():
    assert emparejar_practica("riego tecnificado", PRACTICAS) is None
    assert emparejar_practica("", PRACTICAS) is None


# --- reparto cargable / rechazado -----------------------------------------

MAPA = {"comuna": "Comuna", "superficie": "Sup", "monto": "Monto",
        "beneficiarios": "Benef", "practica": "Practica"}


def procesar_filas(filas):
    return procesar(filas, MAPA, COMUNAS, PRACTICAS, 2024,
                    "transparencia activa", 1)


def test_fila_completa_se_carga():
    listos, rechazos = procesar_filas([
        {"Comuna": "Rancagua", "Sup": "120,5", "Monto": "$ 8.400.000",
         "Benef": "14", "Practica": "Enmiendas calcáreas"},
    ])
    assert not rechazos
    assert listos[0]["id_comuna"] == 6101
    assert listos[0]["superficie_ha"] == 120.5
    assert listos[0]["monto_pesos"] == 8400000
    assert listos[0]["id_practica"] == 4
    assert listos[0]["precision_dato"] == "completa"


def test_sin_superficie_es_reducida_pero_se_carga():
    """Transparencia Activa suele omitir la superficie. La fila sirve igual."""
    listos, rechazos = procesar_filas([
        {"Comuna": "Machalí", "Sup": "", "Monto": "3.000.000", "Benef": "5",
         "Practica": ""},
    ])
    assert not rechazos
    assert listos[0]["precision_dato"] == "reducida"
    assert listos[0]["superficie_ha"] is None


def test_comuna_desconocida_se_rechaza_con_motivo():
    listos, rechazos = procesar_filas([
        {"Comuna": "Valparaíso", "Sup": "10", "Monto": "1000", "Benef": "1",
         "Practica": ""},
    ])
    assert not listos
    assert len(rechazos) == 1
    assert "no encontrada" in rechazos[0][1]


def test_fila_vacia_se_rechaza_y_no_suma_cero():
    """Una fila sin ningún valor no puede entrar: sumaría cero a la comuna
    y bajaría su intensidad de intervención sin que exista tal dato."""
    listos, rechazos = procesar_filas([
        {"Comuna": "Las Cabras", "Sup": "", "Monto": "", "Benef": "",
         "Practica": ""},
    ])
    assert not listos
    assert "sin superficie, monto ni beneficiarios" in rechazos[0][1]


def test_nada_se_pierde_en_silencio():
    """Toda fila de entrada termina cargada o rechazada, nunca desaparecida."""
    filas = [
        {"Comuna": "Rancagua", "Sup": "1", "Monto": "1", "Benef": "1", "Practica": ""},
        {"Comuna": "Arica", "Sup": "1", "Monto": "1", "Benef": "1", "Practica": ""},
        {"Comuna": "", "Sup": "1", "Monto": "1", "Benef": "1", "Practica": ""},
        {"Comuna": "Machalí", "Sup": "", "Monto": "", "Benef": "", "Practica": ""},
    ]
    listos, rechazos = procesar_filas(filas)
    assert len(listos) + len(rechazos) == len(filas)


def test_tildes_y_mayusculas_no_pierden_filas():
    listos, _ = procesar_filas([
        {"Comuna": "MACHALÍ", "Sup": "5", "Monto": "1", "Benef": "1", "Practica": ""},
        {"Comuna": "machali", "Sup": "5", "Monto": "1", "Benef": "1", "Practica": ""},
        {"Comuna": " San  Vicente ", "Sup": "5", "Monto": "1", "Benef": "1",
         "Practica": ""},
    ])
    assert [r["id_comuna"] for r in listos] == [6102, 6102, 6116]
