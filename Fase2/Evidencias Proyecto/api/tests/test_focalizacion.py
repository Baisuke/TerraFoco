# -*- coding: utf-8 -*-
"""Brecha en UF y focalización por año (focalizacion.py y sus rutas)."""
import pytest
from fastapi.testclient import TestClient

from focalizacion import brecha_uf, focalizacion, mediana, rangos, spearman
from main import app
from tests.test_fuentes import hay_base

cliente = TestClient(app)
necesita_base = pytest.mark.skipif(not hay_base(), reason="requiere PostgreSQL levantado")


# ----------------------------------------------------------- cuentas a mano

def test_brecha_es_lo_que_falta_hasta_la_mediana():
    # 0,5 UF/ha con 1.000 ha severas y mediana 2: faltan 1,5 x 1.000.
    assert brecha_uf(0.5, 1000, 2.0) == pytest.approx(1500)


def test_sobre_la_mediana_no_hay_brecha():
    assert brecha_uf(3.0, 1000, 2.0) == 0
    assert brecha_uf(2.0, 1000, 2.0) == 0


def test_sin_dato_no_se_inventa_brecha():
    assert brecha_uf(None, 1000, 2.0) is None
    assert brecha_uf(1.0, None, 2.0) is None
    assert brecha_uf(1.0, 1000, None) is None


def test_mediana_ignora_los_nulos():
    assert mediana([3, None, 1, 2]) == 2
    assert mediana([None]) is None


def test_rangos_promedian_empates():
    assert rangos([10, 20, 20, 30]) == [1, 2.5, 2.5, 4]


def test_spearman_en_los_extremos():
    assert spearman([1, 2, 3, 4], [10, 20, 30, 40]) == pytest.approx(1)
    assert spearman([1, 2, 3, 4], [40, 30, 20, 10]) == pytest.approx(-1)
    # Sin variación no hay orden que comparar.
    assert spearman([1, 2, 3], [5, 5, 5]) is None


def _comuna(i, erosion, ha, uf):
    return {"id_comuna": i, "nombre": "C%d" % i, "erosion": erosion, "ha_severa": ha, "uf": uf}


def test_participacion_y_referencia():
    """Dos comunas sobre la mediana con 3/4 de la superficie severa; el año
    2020 reciben 30 de 100 UF."""
    comunas = [
        _comuna(1, 5, 100, {2020: 40}),
        _comuna(2, 10, 100, {2020: 30}),
        _comuna(3, 20, 300, {2020: 10}),
        _comuna(4, 30, 300, {2020: 20}),
    ]
    # Con cuatro comunas la mediana es 15: quedan sobre ella la 3 y la 4.
    d = focalizacion(comunas, [2020])
    assert d["corte_erosion"] == 15
    assert d["comunas_mas_erosionadas"] == ["C3", "C4"]
    assert d["referencia"] == pytest.approx(600 / 800)
    s = d["serie"][0]
    assert s["incentivo_uf"] == 100
    assert s["participacion"] == pytest.approx(0.30)


def test_un_anio_sin_incentivo_no_divide_por_cero():
    d = focalizacion([_comuna(1, 5, 10, {}), _comuna(2, 9, 10, {}), _comuna(3, 12, 10, {})], [2020])
    assert d["serie"][0]["participacion"] is None
    assert d["serie"][0]["comunas_sin_planes"] == 3


def test_los_periodos_ponderan_por_incentivo():
    """Un año chico no pesa lo mismo que uno grande: 90 de 100 y 0 de 900
    dan 9 %, no el 45 % que daría promediar los porcentajes."""
    comunas = [_comuna(1, 1, 10, {2020: 10, 2021: 900}),
               _comuna(2, 2, 10, {}),
               _comuna(3, 9, 10, {2020: 90})]
    d = focalizacion(comunas, [2020, 2021])
    assert d["periodos"][0]["participacion"] == pytest.approx(0.9)
    assert d["periodos"][1]["participacion"] == pytest.approx(0.0)
    total = sum(p["incentivo_uf"] for p in d["periodos"])
    assert total == pytest.approx(1000)


# --------------------------------------------------------------- con la base

@necesita_base
def test_la_brecha_de_la_api_cuadra():
    filas = cliente.get("/pertinencia?region=6&origen=CIREN").json()
    med = filas[0]["mediana_uf_ha"]
    bajo = [f for f in filas if f["inversion_uf_ha"] < med]
    assert bajo and all(f["brecha_uf"] > 0 for f in bajo)
    assert all(f["brecha_uf"] == 0 for f in filas if f["inversion_uf_ha"] >= med)
    for f in bajo:
        assert f["brecha_uf"] == pytest.approx((med - f["inversion_uf_ha"]) * f["ha_erosion_severa"], abs=0.1)


@necesita_base
def test_fuera_de_dominio_sin_brecha():
    filas = cliente.get("/pertinencia?region=6&origen=CIREN&incluir_fuera_de_dominio=true").json()
    fuera = [f for f in filas if not f["en_dominio"]]
    assert fuera and all(f["brecha_uf"] is None for f in fuera)
    # La mediana es la del dominio: incluir la precordillera no la mueve.
    dentro = cliente.get("/pertinencia?region=6&origen=CIREN").json()
    assert filas[0]["mediana_uf_ha"] == pytest.approx(dentro[0]["mediana_uf_ha"])


@necesita_base
def test_evolucion_cubre_la_serie():
    r = cliente.get("/pertinencia/evolucion?region=6&origen=CIREN")
    assert r.status_code == 200
    d = r.json()
    anios = [s["anio"] for s in d["serie"]]
    assert anios == sorted(anios) and anios[0] == 2012 and anios[-1] == 2025
    assert 0 < d["referencia"] < 1
    for s in d["serie"]:
        assert 0 <= s["participacion"] <= 1
        # Las comunas del índice son parte del total regional.
        assert s["incentivo_uf"] <= s["incentivo_uf_region"] + 0.1


def test_evolucion_de_un_origen_inexistente_da_404():
    if not hay_base():
        pytest.skip("requiere PostgreSQL levantado")
    assert cliente.get("/pertinencia/evolucion?origen=NoExiste").status_code == 404
