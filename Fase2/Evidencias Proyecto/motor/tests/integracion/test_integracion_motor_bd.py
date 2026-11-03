# -*- coding: utf-8 -*-
"""
Pruebas de integración: motor + PostgreSQL/PostGIS real.

Las pruebas unitarias del motor prueban la lógica sin base: el cálculo de
RUSLE, la decisión de qué tarea está vencida, el orden por dependencias.
Estas prueban que esa lógica, conectada a la base real, deja en las tablas
lo que el resto del sistema espera leer:

    Almacen.guardar/leer   <->  indicadores.factor, indicadores.variable_inundacion
    Bitacora               <->  operacion.ejecucion_proceso + operacion.fuente
    obtener_region         <->  territorio.region (el área de interés)
    orquestador            <->  operacion.tarea_programada + subprocesos reales

Casos del plan de pruebas: PI-13 a PI-20 (docs/21-plan-de-pruebas.md).
"""
import sys

import psycopg
import pytest

from bd import Bitacora, obtener_region
from indicadores import almacen
from orquestacion import orquestador

COMUNA = 6901


@pytest.fixture(scope="module")
def base(motor_en_base_de_pruebas):
    url = motor_en_base_de_pruebas
    with psycopg.connect(url) as con:
        con.execute(
            "INSERT INTO territorio.comuna (id_comuna, id_region, nombre, provincia, geom) "
            "VALUES (%s, 6, 'Comuna Prueba', 'Prueba', ST_Multi(ST_MakeEnvelope("
            "-71.5, -34.5, -71.45, -34.45, 4326)))", (COMUNA,))
    return url


def _una(url, sql_, params=()):
    with psycopg.connect(url) as con:
        return con.execute(sql_, params).fetchone()


# ------------------------------------------------------------------ PI-13

def test_el_area_de_interes_sale_de_la_base(base):
    r = obtener_region(6)
    assert r.epsg_trabajo == 32719
    assert r.bbox == pytest.approx((-72.10, -35.05, -70.02, -33.85))
    with pytest.raises(ValueError):
        obtener_region(99)


# ------------------------------------------------------------------ PI-14

def test_factores_se_versionan_y_gana_el_mas_reciente(base):
    """RNF-06: ningún recálculo sobrescribe; la lectura toma la última versión."""
    almacen.guardar(6, {COMUNA: 1500.0}, "R", 2023, "prueba v1")
    almacen.guardar(6, {COMUNA: 1600.0}, "R", 2024, "prueba v2")

    filas = _una(base, "SELECT count(*) FROM indicadores.factor "
                       "WHERE id_comuna = %s AND factor = 'R'", (COMUNA,))[0]
    assert filas == 2
    leido = almacen.leer(6)[COMUNA]
    assert leido["R"] == 1600.0
    assert leido["_fuentes"]["R"] == "prueba v2 (2024)"
    # Pedir un año anterior devuelve la versión de ese año, no la última.
    assert almacen.leer(6, anio=2023)[COMUNA]["R"] == 1500.0


# ------------------------------------------------------------------ PI-15

def test_rusle_descarta_no_positivos_e_inundacion_conserva_el_signo(base):
    guardados, descartados = almacen.guardar(6, {COMUNA: 0.0}, "K", 2024, "prueba")
    assert (guardados, descartados) == (0, [(COMUNA, 0.0)])
    assert "K" not in almacen.leer(6).get(COMUNA, {})

    g, d = almacen.INUNDACION.guardar(6, {COMUNA: -0.8}, "curvatura", 2024, "prueba")
    assert (g, d) == (1, [])
    assert almacen.INUNDACION.leer(6)[COMUNA]["curvatura"] == -0.8


# ------------------------------------------------------------------ PI-16

def test_el_detalle_se_guarda_como_jsonb(base):
    almacen.guardar(6, {COMUNA: 0.12}, "C", 2024, "prueba",
                    detalles={COMUNA: {"ndvi_mediana": 0.61, "resolucion_m": 30}})
    detalle = _una(base, "SELECT detalle FROM indicadores.factor WHERE id_comuna = %s "
                         "AND factor = 'C' ORDER BY calculado_en DESC LIMIT 1",
                   (COMUNA,))[0]
    assert detalle == {"ndvi_mediana": 0.61, "resolucion_m": 30}


# ------------------------------------------------------------------ PI-17

def test_bitacora_registra_exito_y_lo_enlaza_con_su_fuente(base):
    with Bitacora("Ingesta de prueba", fuente="ciren") as b:
        b.registros = 33
    fila = _una(base, """
        SELECT e.estado, e.registros, e.fin IS NOT NULL, f.codigo
        FROM   operacion.ejecucion_proceso e
        JOIN   operacion.fuente f USING (id_fuente)
        WHERE  e.id_proceso = %s""", (b.id_proceso,))
    assert fila == ("ok", 33, True, "ciren")


# ------------------------------------------------------------------ PI-18

def test_bitacora_registra_el_error_y_no_lo_oculta(base):
    with pytest.raises(RuntimeError):
        with Bitacora("Ingesta que falla") as b:
            raise RuntimeError("servidor caido")
    estado, mensaje = _una(base, "SELECT estado, mensaje FROM operacion.ejecucion_proceso "
                                 "WHERE id_proceso = %s", (b.id_proceso,))
    assert estado == "error"
    assert "servidor caido" in mensaje


def test_una_simulacion_no_queda_en_la_bitacora(base):
    with Bitacora("Simulación") as b:
        b.simulada = True
    assert _una(base, "SELECT count(*) FROM operacion.ejecucion_proceso "
                      "WHERE id_proceso = %s", (b.id_proceso,))[0] == 0


# ------------------------------------------------------------------ PI-19

def test_las_tareas_sembradas_por_las_migraciones_son_validas(base):
    """Lo que el orquestador lee de la base pasa por la misma validación que
    usa en producción: una cadencia mal escrita lanzaría ValueError aquí."""
    tareas = orquestador.cargar_tareas()
    assert len(tareas) >= 20
    from orquestacion.programacion import esta_vencida, ordenar_por_dependencia
    for t in tareas:
        esta_vencida(t)
    ordenar_por_dependencia(tareas)          # sin ciclos


# ------------------------------------------------------------------ PI-20

def _estados_de_prueba(url):
    with psycopg.connect(url) as con:
        return dict(con.execute(
            "SELECT codigo, ultimo_estado FROM operacion.tarea_programada "
            "WHERE codigo LIKE 'prueba.%'").fetchall())


def test_orquestador_respeta_la_dependencia_en_la_base(base):
    """RNF-05 de punta a punta: si la tarea padre falla de verdad (proceso
    que termina con código 1), la hija no corre y la base lo refleja."""
    py = sys.executable
    with psycopg.connect(base) as con:
        con.execute("UPDATE operacion.tarea_programada SET activa = false")
        con.execute("""
            INSERT INTO operacion.tarea_programada
                   (codigo, descripcion, comando, cadencia, activa)
            VALUES ('prueba.padre', 'Falla a propósito', %s, 'mensual', true),
                   ('prueba.hija',  'Depende del padre', %s, 'mensual', true)""",
                    ('%s -c "raise SystemExit(1)"' % py, '%s -c "pass"' % py))
        con.execute("UPDATE operacion.tarea_programada SET depende_de = 'prueba.padre' "
                    "WHERE codigo = 'prueba.hija'")

    assert orquestador.ejecutar_pendientes() == 1
    estados = _estados_de_prueba(base)
    assert estados == {"prueba.padre": "error", "prueba.hija": None}

    # Se corrige el padre y se fuerza: ahora la hija sí corre.
    with psycopg.connect(base) as con:
        con.execute("UPDATE operacion.tarea_programada SET comando = %s "
                    "WHERE codigo = 'prueba.padre'", ('%s -c "pass"' % py,))
    assert orquestador.forzar("prueba.padre") == 0
    assert orquestador.ejecutar_pendientes() == 0
    estados = _estados_de_prueba(base)
    assert estados == {"prueba.padre": "ok", "prueba.hija": "ok"}
