# -*- coding: utf-8 -*-
"""Pruebas de los cinco factores de RUSLE.

Se verifican tres cosas distintas:

  1. Que cada ecuación reproduzca su comportamiento publicado.
  2. Que los valores caigan en el rango plausible de RANGOS. Un factor fuera
     de rango casi siempre es un error de unidades, y es el error más caro:
     no falla, solo entrega un resultado equivocado.
  3. Que el conjunto produzca pérdidas comparables con las de CIREN para
     O'Higgins, que están en el orden de 5 a 60 t/ha/año.
"""
import math

import pytest

from indicadores.rusle import (
    Factores, RANGOS, clasificar, factor_C, factor_K, factor_LS, factor_P,
    factor_R, indice_fournier, ndvi_desde_bandas, p_curvas_nivel,
)


def en_rango(nombre, valor):
    bajo, alto = RANGOS[nombre]
    return bajo <= valor <= alto


# --- R: erosividad de la lluvia -------------------------------------------

# Rancagua: mediterráneo, ~450 mm concentrados en invierno (may-ago).
LLUVIA_RANCAGUA = [2, 3, 5, 20, 85, 110, 95, 70, 30, 15, 8, 4]
# Pichilemu, secano costero: más lluvia y aún más concentrada.
LLUVIA_COSTA = [3, 5, 8, 35, 130, 165, 150, 105, 45, 22, 10, 6]


def test_fournier_exige_doce_meses():
    with pytest.raises(ValueError):
        indice_fournier([10] * 11)


def test_fournier_castiga_la_concentracion():
    """El mismo total anual concentrado da un índice mayor.

    Es la propiedad que justifica usar MFI y no el total: 600 mm parejos no
    erosionan como 600 mm caídos en tres meses.
    """
    parejo = [50] * 12
    concentrado = [0, 0, 0, 0, 200, 200, 200, 0, 0, 0, 0, 0]
    assert sum(parejo) == sum(concentrado) == 600
    assert indice_fournier(concentrado) > indice_fournier(parejo) * 3


def test_R_en_rango_para_climas_reales():
    """El método por defecto debe dar valores plausibles en O'Higgins."""
    for serie in (LLUVIA_RANCAGUA, LLUVIA_COSTA):
        r = factor_R(precipitacion_mensual=serie)
        assert en_rango("R", r), r


def test_R_crece_con_la_lluvia():
    assert (factor_R(precipitacion_mensual=LLUVIA_COSTA)
            > factor_R(precipitacion_mensual=LLUVIA_RANCAGUA))


def test_R_anual_es_alternativa_valida():
    r = factor_R(precipitacion_anual=700)
    assert en_rango("R", r), r


def test_R_mensual_sin_metodo_usa_el_total():
    assert (factor_R(precipitacion_mensual=LLUVIA_RANCAGUA)
            == pytest.approx(factor_R(precipitacion_anual=sum(LLUVIA_RANCAGUA))))


def test_fournier_entrega_mas_que_el_metodo_anual():
    """Diferencia documentada en la literatura chilena, no un error.

    Fournier captura la estacionalidad y por eso da más alto; en el régimen
    mediterráneo el MFI pasa de 100 y la rama cuadrática se dispara fuera de
    su tramo de calibración. Por eso 'anual' es el predeterminado y ésta es la
    prueba que deja constancia de la brecha.
    """
    anual = factor_R(precipitacion_mensual=LLUVIA_COSTA)
    fournier = factor_R(precipitacion_mensual=LLUVIA_COSTA, metodo="fournier")
    assert fournier > anual * 2
    assert en_rango("R", anual)


def test_R_sin_lluvia_es_cero():
    """Sin lluvia no hay erosión: el modelo entero se anula, y está bien."""
    assert factor_R(precipitacion_mensual=[0] * 12) == 0.0
    assert factor_R(precipitacion_anual=0) == 0.0
    assert factor_R(precipitacion_mensual=[0] * 12, metodo="fournier") == 0.0


def test_R_exige_alguna_entrada():
    with pytest.raises(ValueError):
        factor_R()
    with pytest.raises(ValueError):
        factor_R(precipitacion_anual=500, metodo="fournier")
    with pytest.raises(ValueError):
        factor_R(precipitacion_anual=500, metodo="inventado")


# --- K: erodabilidad -------------------------------------------------------

def test_K_suelo_franco_tipico_en_rango():
    k = factor_K(limo_pct=40, arena_muy_fina_pct=10, arcilla_pct=20,
                 materia_organica_pct=2.0,
                 estructura="granular fina", permeabilidad="moderada")
    assert en_rango("K", k), k


def test_K_falta_la_conversion_a_SI_se_notaria():
    """Sin el factor de Foster, K saldría ~7,6 veces mayor y fuera de rango.

    Esta prueba existe para que ese error no pase inadvertido: es de los que
    no rompen nada, solo multiplican la erosión por siete.
    """
    k = factor_K(40, 10, 20, 2.0, "granular fina", "moderada")
    assert k < RANGOS["K"][1]
    assert k * 7.6 > RANGOS["K"][1]


def test_K_mas_materia_organica_menos_erodable():
    pobre = factor_K(40, 10, 20, 0.5, "granular fina", "moderada")
    rico = factor_K(40, 10, 20, 4.0, "granular fina", "moderada")
    assert rico < pobre


def test_K_materia_organica_se_satura_en_cuatro():
    """Sobre 4% la ecuación original no aplica; saturar evita valores negativos."""
    assert factor_K(40, 10, 20, 4.0, 2, 3) == factor_K(40, 10, 20, 9.0, 2, 3)


def test_K_acepta_codigos_enteros_y_texto():
    assert factor_K(40, 10, 20, 2.0, 2, 3) == pytest.approx(
        factor_K(40, 10, 20, 2.0, "granular fina", "moderada"))


def test_K_rechaza_porcentajes_imposibles():
    with pytest.raises(ValueError):
        factor_K(140, 10, 20, 2.0, 2, 3)
    with pytest.raises(ValueError):
        factor_K(40, 10, 20, 2.0, 9, 3)


# --- LS: topografía --------------------------------------------------------

def test_LS_parcela_patron_es_solo_pendiente():
    """Con la longitud patrón, L = 1 y LS queda igual a S."""
    ls = factor_LS(5.0)
    theta = math.atan(0.05)
    assert ls == pytest.approx(10.8 * math.sin(theta) + 0.03, rel=1e-9)


def test_LS_crece_con_pendiente_y_longitud():
    assert factor_LS(20) > factor_LS(5)
    assert factor_LS(15, 200) > factor_LS(15, 50)


def test_LS_quiebre_en_nueve_por_ciento():
    """McCool cambia de recta en 9%. El salto debe ser pequeño, no un abismo."""
    antes, despues = factor_LS(8.9), factor_LS(9.1)
    assert despues > antes
    assert abs(despues - antes) < 0.35


def test_LS_terreno_plano_no_anula_el_modelo():
    """Pendiente 0 devuelve el mínimo de McCool, no cero.

    Si devolviera cero, A = R*K*LS*C*P sería cero en todo el valle central y
    el mapa mostraría erosión nula donde sí la hay.
    """
    assert factor_LS(0.0) == pytest.approx(0.03)


def test_LS_en_rango_para_terreno_de_secano():
    for pend in (2, 8, 15, 25, 40):
        assert en_rango("LS", factor_LS(pend, 100)), pend


def test_LS_rechaza_entradas_imposibles():
    with pytest.raises(ValueError):
        factor_LS(-5)
    with pytest.raises(ValueError):
        factor_LS(10, 0)


# --- C: cobertura ----------------------------------------------------------

def test_C_suelo_desnudo_es_uno():
    assert factor_C(0.0) == 1.0
    assert factor_C(-0.3) == 1.0


def test_C_baja_al_subir_el_ndvi():
    assert factor_C(0.7) < factor_C(0.4) < factor_C(0.15) < factor_C(0.0)


def test_C_es_convexo_no_lineal():
    """Los primeros tramos de cobertura protegen mucho más que los últimos."""
    ganancia_inicial = factor_C(0.0) - factor_C(0.2)
    ganancia_final = factor_C(0.6) - factor_C(0.8)
    assert ganancia_inicial > ganancia_final


def test_C_no_diverge_en_el_limite():
    """La exponencial explota en NDVI = beta; debe estar contenido."""
    assert factor_C(1.0) == 0.0
    assert 0.0 <= factor_C(0.999) <= 1.0


def test_C_rechaza_ndvi_imposible():
    with pytest.raises(ValueError):
        factor_C(1.4)


def test_ndvi_desde_bandas():
    assert ndvi_desde_bandas(0.30, 0.10) == pytest.approx(0.5)
    assert ndvi_desde_bandas(0.0, 0.0) is None
    assert ndvi_desde_bandas(None, 0.1) is None


# --- P: prácticas ----------------------------------------------------------

def test_P_sin_intervencion_es_uno():
    assert factor_P(0, 5000, 10) == 1.0


def test_P_baja_con_la_intervencion():
    nada = factor_P(0, 1000, 10)
    algo = factor_P(300, 1000, 10)
    todo = factor_P(1000, 1000, 10)
    assert todo < algo < nada
    assert todo == pytest.approx(p_curvas_nivel(10))


def test_P_curvas_sirven_menos_en_terreno_empinado():
    """En pendiente fuerte la práctica pierde eficacia: P se acerca a 1."""
    assert p_curvas_nivel(5) < p_curvas_nivel(30)
    assert factor_P(500, 1000, 5) < factor_P(500, 1000, 30)


def test_P_no_puede_superar_el_cien_por_ciento():
    """Más hectáreas bonificadas que superficie agrícola es un error de datos.

    Se acota en vez de producir un P menor que el de la práctica, que sería
    físicamente imposible.
    """
    acotado = factor_P(9000, 1000, 10)
    assert acotado == pytest.approx(p_curvas_nivel(10))
    assert acotado >= 0.0


def test_P_exige_superficie_agricola():
    with pytest.raises(ValueError):
        factor_P(100, 0, 10)


# --- El conjunto -----------------------------------------------------------

def comuna_secano():
    """Promedio de una comuna del secano: pendiente media, no la peor ladera."""
    return Factores(
        R=factor_R(precipitacion_mensual=LLUVIA_COSTA),
        K=factor_K(45, 12, 18, 1.5, "granular media o gruesa", "lenta a moderada"),
        LS=factor_LS(8.0, 50.0),
        C=factor_C(0.30),           # matorral ralo, secano degradado
        P=factor_P(150, 4000, 8),   # poca intervención
    )


def test_perdida_de_comuna_cae_en_el_orden_de_CIREN():
    """El promedio comunal debe parecerse al de CIREN para la región.

    CIREN entrega valores por polígono de 0 a 100 t/ha/año, con mediana en
    torno a 9. Si el promedio de una comuna diera 0,5 o 900, hay un error de
    unidades en algún factor.
    """
    f = comuna_secano()
    assert f.validar() == []
    a = f.perdida()
    assert 2.0 < a < 80.0, a
    assert clasificar(a) in ("Moderada", "Severa", "Muy severa", "Extrema")


def test_una_ladera_empinada_supera_con_creces_al_promedio_comunal():
    """La escala importa: un píxel de 30 m en ladera fuerte da mucho más.

    RUSLE aplicado a la peor ladera de la comuna entrega valores varias veces
    superiores al promedio comunal. No es un error del modelo: es la razón por
    la que la agregación tiene que ser una media PONDERADA POR SUPERFICIE y no
    un máximo ni un promedio de píxeles sueltos. Confundir ambas escalas es el
    error que haría ver toda la región en rojo.
    """
    ladera = Factores(
        R=factor_R(precipitacion_mensual=LLUVIA_COSTA),
        K=factor_K(45, 12, 18, 1.5, "granular media o gruesa", "lenta a moderada"),
        LS=factor_LS(18.0, 120.0),
        C=factor_C(0.22),
        P=factor_P(150, 4000, 18),
    )
    assert ladera.perdida() > comuna_secano().perdida() * 3
    assert clasificar(ladera.perdida()) == "Extrema"


def test_perdida_valle_regado_es_menor_que_secano():
    valle = Factores(
        R=factor_R(precipitacion_mensual=LLUVIA_RANCAGUA),
        K=factor_K(35, 8, 25, 3.0, "granular fina", "moderada"),
        LS=factor_LS(3.0, 60.0),
        C=factor_C(0.72),           # frutales y cultivos bajo riego
        P=factor_P(400, 3000, 3),
    )
    secano = Factores(
        R=factor_R(precipitacion_mensual=LLUVIA_COSTA),
        K=factor_K(45, 12, 18, 1.5, "granular media o gruesa", "lenta a moderada"),
        LS=factor_LS(8.0, 50.0),
        C=factor_C(0.30),
        P=factor_P(150, 4000, 8),
    )
    assert valle.perdida() < secano.perdida()


def test_un_factor_en_cero_anula_todo():
    """La multiplicatividad no es un detalle: sin lluvia no hay erosión."""
    f = Factores(R=0.0, K=0.03, LS=5.0, C=0.3, P=0.8)
    assert "R" in "; ".join(f.validar())
