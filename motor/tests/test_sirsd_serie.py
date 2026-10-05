# -*- coding: utf-8 -*-
"""Serie del SIRSD-S y superficie erosionada: lo que alimenta el índice (013)."""
import math
import os

import pytest

import numpy as np
import pandas as pd

from indicadores.superficie_erosionada import UMBRAL_T_HA, hectareas
from ingesta.sirsd_serie import a_filas, leer, marcar_anomalias, revisar_cobertura


# ---------------------------------------------------------- superficie

def test_el_umbral_es_el_limite_de_moderada():
    """18,0 t/ha/año todavía es Moderada (mapa_erosion cierra por arriba)."""
    from mapa_erosion import RAMPA
    assert UMBRAL_T_HA == RAMPA[1][0]
    evaluadas, severas = hectareas([17.9, 18.0, 18.01, 40.0], 0.09)
    assert evaluadas == 4 * 0.09
    assert math.isclose(severas, 2 * 0.09)


def test_sin_dato_no_cuenta_en_ninguna():
    evaluadas, severas = hectareas([np.nan, 50.0, np.nan], 0.09)
    assert math.isclose(evaluadas, 0.09) and math.isclose(severas, 0.09)


# ---------------------------------------------------------------- serie

def _serie(**cambios):
    s = pd.DataFrame({"id_comuna": [6101, 6307, 6307], "anio": [2016, 2016, 2017],
                      "planes": [10, 63, 63], "agricultores": [9, 55, 58],
                      "incentivo": [1e7, 87e6, 102e6], "inversion_total": [1.25e7, 99e6, 4811e6],
                      "ha_reales": [50.0, 435.8, 427.2], "ha_ejecutada": [50.0, 435.8, 427.2],
                      "ha_practica": [60.0, np.nan, 500.0]})
    return s.assign(**cambios)


def test_marca_solo_la_inversion_imposible():
    """6307/2017: 47 veces el incentivo. Lo normal es ~1,25."""
    s = marcar_anomalias(_serie())
    assert s.inversion_anomala.tolist() == [False, False, True]


def test_la_celda_anomala_conserva_su_incentivo():
    s = marcar_anomalias(_serie())
    assert s.loc[s.inversion_anomala, "incentivo"].item() == 102e6


def test_cobertura_detecta_comunas_faltantes_y_ajenas():
    s = _serie()
    assert revisar_cobertura(s, [6101, 6307]) == []
    assert any("sin ninguna fila" in p for p in revisar_cobertura(s, [6101, 6307, 6102]))
    assert any("no son de la región" in p for p in revisar_cobertura(s, [6101]))


def test_cobertura_detecta_duplicados():
    s = pd.concat([_serie(), _serie().iloc[[0]]])
    assert any("duplicadas" in p for p in revisar_cobertura(s, [6101, 6307]))


def test_nan_se_carga_como_null_y_no_como_cero():
    """Una ha_practica vacía no es cero hectáreas."""
    s = marcar_anomalias(_serie())
    for c in ("ases_formulacion", "ases_ejecucion", "supagr_predios", "planes_oficial", "incentivo_oficial"):
        s[c] = np.nan
    f = a_filas(s)
    assert f[1]["ha_practica"] is None
    assert f[0]["planes"] == 10 and isinstance(f[0]["planes"], int)
    assert f[2]["inversion_anomala"] is True


def test_une_el_complemento_por_comuna_y_anio(tmp_path):
    serie = tmp_path / "serie.csv"
    comp = tmp_path / "comp.csv"
    _serie().to_csv(serie, sep=";", index=False)
    pd.DataFrame({"id_comuna": [6307], "anio": [2017], "planes_oficial": [63],
                  "incentivo_oficial": [102e6], "inversion_oficial": [4811e6],
                  "ha_ejecutada_oficial": [427.2], "ases_formulacion": [7e6],
                  "ases_ejecucion": [0], "supagr_predios": [900.0]}).to_csv(comp, sep=";", index=False)
    s = leer(str(serie), str(comp))
    assert len(s) == 3
    fila = s[(s.id_comuna == 6307) & (s.anio == 2017)].iloc[0]
    assert fila.ases_formulacion == 7e6 and fila.planes_oficial == 63
    assert s[(s.id_comuna == 6101)].ases_formulacion.isna().all()


def test_la_semilla_de_superficie_es_la_del_calculo():
    """bd/semillas/superficie_erosionada.csv: sin ella, en cualquier equipo que
    no tenga los rásteres el índice queda vacío (33 comunas fuera)."""
    from indicadores.superficie_erosionada import SEMILLA, leer_semilla
    if not os.path.exists(SEMILLA):
        pytest.skip("sin /bd montado")
    filas = leer_semilla()
    assert len({f["id_comuna"] for f in filas}) == 33
    assert all(f["umbral"] == UMBRAL_T_HA and f["origen"] == "TerraFoco" for f in filas)
    assert all(0 < f["ha_sobre_umbral"] <= f["ha_evaluadas"] for f in filas)
    # Las seis precordilleranas, las mismas que deja fuera el índice.
    assert sum(not f["en_dominio"] for f in filas) == 6
