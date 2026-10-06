# -*- coding: utf-8 -*-
"""
Pruebas de la lógica de programación.

No tocan la base de datos: es justamente el punto de haber separado las
funciones puras. Los errores de cadencia son silenciosos —una tarea que nunca
corre, o que corre de más— y solo se detectan con pruebas como estas.
"""
from datetime import datetime

import pytest

from orquestacion.programacion import (
    Tarea, bloqueadas_por_dependencia, esta_vencida, ordenar_por_dependencia,
)

AHORA = datetime(2026, 8, 15, 10, 0)


def tarea(**kw):
    base = dict(codigo="t", descripcion="d", comando="cmd", cadencia="mensual")
    base.update(kw)
    return Tarea(**base)


# --- primera ejecución -----------------------------------------------------

def test_lo_que_nunca_corrio_esta_vencido():
    assert esta_vencida(tarea(cadencia="anual"), AHORA)


def test_la_tarea_unica_no_se_repite():
    t = tarea(cadencia="unica", ultima_ejecucion=datetime(2020, 1, 1),
              ultimo_estado="ok")
    assert not esta_vencida(t, AHORA)


def test_una_tarea_manual_nunca_vence_sola():
    assert not esta_vencida(tarea(cadencia="manual"), AHORA)


def test_la_inactiva_no_vence():
    assert not esta_vencida(tarea(cadencia="anual", activa=False), AHORA)


# --- reintento tras error --------------------------------------------------

def test_si_fallo_vuelve_a_intentarse_aunque_sea_del_mismo_mes():
    """Un error no cuenta como ejecución hecha."""
    t = tarea(cadencia="mensual", dia_del_mes=10,
              ultima_ejecucion=datetime(2026, 8, 10), ultimo_estado="error")
    assert esta_vencida(t, AHORA)


def test_tras_un_error_espera_un_dia_antes_de_reintentar():
    """Lo que falla por un archivo que falta no se reintenta cada hora."""
    t = tarea(cadencia="anual", ultima_ejecucion=datetime(2026, 8, 15, 8, 0),
              ultimo_estado="error")
    assert not esta_vencida(t, AHORA)                        # hace 2 horas
    assert esta_vencida(t, datetime(2026, 8, 16, 9, 0))      # al día siguiente


def test_si_salio_ok_este_mes_no_se_repite():
    t = tarea(cadencia="mensual", dia_del_mes=10,
              ultima_ejecucion=datetime(2026, 8, 10), ultimo_estado="ok")
    assert not esta_vencida(t, AHORA)


# --- cadencias -------------------------------------------------------------

def test_mensual_espera_al_dia_indicado():
    t = tarea(cadencia="mensual", dia_del_mes=20,
              ultima_ejecucion=datetime(2026, 7, 20), ultimo_estado="ok")
    assert not esta_vencida(t, datetime(2026, 8, 15))   # aún no llega el 20
    assert esta_vencida(t, datetime(2026, 8, 20))


def test_semanal_a_los_siete_dias():
    t = tarea(cadencia="semanal", ultima_ejecucion=datetime(2026, 8, 9),
              ultimo_estado="ok")
    assert not esta_vencida(t, datetime(2026, 8, 15))
    assert esta_vencida(t, datetime(2026, 8, 16))


def test_estacional_solo_dentro_de_su_ventana():
    """Landsat termico: solo tiene sentido en verano."""
    t = tarea(cadencia="estacional", meses_validos=[1, 2])
    assert not esta_vencida(t, datetime(2026, 8, 15))   # agosto: fuera
    assert esta_vencida(t, datetime(2026, 1, 15))       # enero: dentro


def test_estacional_una_vez_al_ano():
    t = tarea(cadencia="estacional", meses_validos=[1, 2],
              ultima_ejecucion=datetime(2026, 1, 10), ultimo_estado="ok")
    assert not esta_vencida(t, datetime(2026, 2, 10))   # mismo año
    assert esta_vencida(t, datetime(2027, 1, 10))


def test_trimestral_cambia_con_el_trimestre():
    t = tarea(cadencia="trimestral", ultima_ejecucion=datetime(2026, 8, 1),
              ultimo_estado="ok")
    assert not esta_vencida(t, datetime(2026, 9, 30))   # mismo trimestre
    assert esta_vencida(t, datetime(2026, 10, 1))       # siguiente


def test_cadencia_desconocida_falla_fuerte():
    with pytest.raises(ValueError):
        esta_vencida(tarea(cadencia="cada_luna_llena"), AHORA)


# --- dependencias ----------------------------------------------------------

def test_las_dependencias_van_antes():
    tareas = [
        tarea(codigo="indicadores.erosion", depende_de="ingesta.sentinel"),
        tarea(codigo="ingesta.sentinel"),
    ]
    orden = [t.codigo for t in ordenar_por_dependencia(tareas)]
    assert orden.index("ingesta.sentinel") < orden.index("indicadores.erosion")


def test_detecta_dependencia_circular():
    tareas = [tarea(codigo="a", depende_de="b"), tarea(codigo="b", depende_de="a")]
    with pytest.raises(ValueError):
        ordenar_por_dependencia(tareas)


def test_no_calcula_indicadores_si_la_ingesta_fallo():
    """El caso que importa: nunca calcular el indice sobre datos a medias."""
    tareas = [tarea(codigo="indicadores.erosion", depende_de="ingesta.sentinel")]
    bloqueadas = bloqueadas_por_dependencia(tareas, {"ingesta.sentinel": "error"})
    assert bloqueadas == {"indicadores.erosion": "ingesta.sentinel"}


def test_si_la_ingesta_salio_bien_el_indicador_corre():
    tareas = [tarea(codigo="indicadores.erosion", depende_de="ingesta.sentinel")]
    assert bloqueadas_por_dependencia(tareas, {"ingesta.sentinel": "ok"}) == {}


def test_la_dependencia_que_no_corre_en_el_ciclo_vale_por_su_ultimo_estado(monkeypatch):
    """La dependencia salió bien antes y no toca ahora: la tarea corre igual.

    Era el caso de hidrología: NASADEM (única) estaba "ok" desde septiembre y
    no vence nunca más, así que nunca estaba en el ciclo; hidrología se
    saltaba en cada revisión diciendo que NASADEM "no terminó bien".
    """
    from orquestacion import orquestador
    tareas = [tarea(codigo="ingesta.nasadem", cadencia="unica",
                    ultima_ejecucion=datetime(2026, 8, 1), ultimo_estado="ok"),
              tarea(codigo="ingesta.hidrologia", cadencia="unica", depende_de="ingesta.nasadem")]
    corridas = []
    monkeypatch.setattr(orquestador, "cargar_tareas", lambda: tareas)
    monkeypatch.setattr(orquestador, "ejecutar_tarea",
                        lambda t: corridas.append(t.codigo) or "ok")
    assert orquestador.ejecutar_pendientes(AHORA) == 0
    assert corridas == ["ingesta.hidrologia"]


def test_ultima_ejecucion_con_zona_horaria():
    """La base devuelve timestamptz; `ahora` llega sin zona. No debe fallar."""
    from datetime import timezone
    t = tarea(cadencia="semanal", ultima_ejecucion=datetime(2026, 8, 1, tzinfo=timezone.utc),
              ultimo_estado="ok")
    assert esta_vencida(t, datetime(2026, 8, 15))
    t = tarea(cadencia="anual", ultima_ejecucion=datetime.now(timezone.utc), ultimo_estado="error")
    assert not esta_vencida(t, datetime.now())
