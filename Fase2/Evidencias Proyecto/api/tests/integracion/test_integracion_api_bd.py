# -*- coding: utf-8 -*-
"""
Pruebas de integración: API FastAPI + PostgreSQL/PostGIS real.

Cada prueba atraviesa las capas que las pruebas unitarias aíslan:

    petición HTTP -> ruta FastAPI -> psycopg -> esquema + migraciones
                  -> vista indicadores.v_pertinencia -> JSON

Los datos se siembran aquí mismo, con valores elegidos para que el resultado
esperado se pueda calcular a mano. Así una diferencia entre lo que la vista
calcula y lo que la API entrega se detecta, en vez de depender de lo que
tenga cargado la base de desarrollo.

Casos del plan de pruebas: PI-01 a PI-12 (docs/21-plan-de-pruebas.md).
"""
import math

import psycopg
import pytest
from fastapi.testclient import TestClient

import config
from main import app

CLAVE = "clave-de-integracion-" + "x" * 24

# Cuatro comunas ficticias de la región 6. Las tres primeras quedan dentro
# del dominio de validez; la cuarta fuera, como la precordillera.
#   id      nombre             erosión CIREN  ha severas  incentivo (pesos)
COMUNAS = [
    (6901, "Comuna Prueba A", 10.0, 100.0, 22598850.0),    # 1.000 UF en 2012
    (6902, "Comuna Prueba B", 20.0, 200.0, 45197700.0),    # 2.000 UF
    (6903, "Comuna Prueba C", 40.0, 400.0, 11299425.0),    #   500 UF
    (6904, "Comuna Prueba D", 50.0, 50.0, 22598850.0),     # fuera de dominio
]
UF_2012 = 22598.85        # sembrada por la migración 013


def _cuadrado(i):
    """Un cuadrado de 0,05° dentro de la extensión de O'Higgins."""
    x0, y0 = -71.5 + i * 0.06, -34.5
    return ("SRID=4326;MULTIPOLYGON(((%f %f,%f %f,%f %f,%f %f,%f %f)))"
            % (x0, y0, x0 + .05, y0, x0 + .05, y0 + .05, x0, y0 + .05, x0, y0))


@pytest.fixture(scope="module")
def cliente(api_en_base_de_pruebas):
    url = api_en_base_de_pruebas
    with psycopg.connect(url) as con:
        for i, (id_c, nombre, erosion, ha, incentivo) in enumerate(COMUNAS):
            dentro = id_c != 6904
            con.execute(
                "INSERT INTO territorio.comuna (id_comuna, id_region, nombre, "
                "provincia, superficie_km2, geom) VALUES (%s, 6, %s, 'Prueba', 25, %s)",
                (id_c, nombre, _cuadrado(i)))
            con.execute(
                "INSERT INTO indicadores.erosion (id_region, id_comuna, anio, factor_r, "
                "factor_k, factor_ls, factor_c, factor_p, perdida_ton_ha, clase, origen, "
                "en_dominio) VALUES (6, %s, 2020, 1, 1, 1, 1, 1, %s, 'Moderada', "
                "'CIREN', true)", (id_c, erosion))
            con.execute(
                "INSERT INTO indicadores.superficie_erosionada (id_comuna, id_region, "
                "origen, anio, umbral_t_ha, ha_evaluadas, ha_sobre_umbral, en_dominio) "
                "VALUES (%s, 6, 'TerraFoco', 2024, 18, 1000, %s, %s)", (id_c, ha, dentro))
            con.execute(
                "INSERT INTO programas.sirsd_anual (id_comuna, anio, planes, "
                "agricultores, incentivo, fuente) VALUES (%s, 2012, 5, 5, %s, 'prueba')",
                (id_c, incentivo))
        # Una celda con 2 planes: la API debe publicarla reservada (sin cifras).
        con.execute(
            "INSERT INTO programas.sirsd_anual (id_comuna, anio, planes, agricultores, "
            "incentivo, fuente) VALUES (6901, 2013, 2, 2, 1000000, 'prueba')")
    return TestClient(app)


def _esperado():
    """La pertinencia calculada a mano, con la misma definición de la vista."""
    dentro = [c for c in COMUNAS if c[0] != 6904]
    uf_ha = {c[0]: (c[4] / UF_2012) / c[3] for c in dentro}
    # La celda de 2013 de la comuna A también cuenta en el índice.
    uf_ha[6901] += (1000000 / 22980.90) / 100.0
    ero = {c[0]: c[2] for c in dentro}
    lo_e, hi_e = min(ero.values()), max(ero.values())
    logs = {k: math.log(v) for k, v in uf_ha.items()}
    lo_l, hi_l = min(logs.values()), max(logs.values())
    return {k: (ero[k] - lo_e) / (hi_e - lo_e) - (logs[k] - lo_l) / (hi_l - lo_l)
            for k in ero}


# ------------------------------------------------------------------ PI-01

def test_salud_informa_la_base_de_pruebas(cliente):
    r = cliente.get("/salud").json()
    assert r["base_de_datos"] == "ok"
    assert r["nombre_base"] == "terrafoco_integracion"
    assert r["postgis"].startswith("3.")


# ------------------------------------------------------------------ PI-02

def test_las_migraciones_dejan_el_modelo_completo(api_en_base_de_pruebas):
    """31 tablas en los cuatro esquemas y la vista del índice."""
    with psycopg.connect(api_en_base_de_pruebas) as con:
        tablas = con.execute("""
            SELECT count(*) FROM information_schema.tables
            WHERE table_schema IN ('territorio','indicadores','programas','operacion')
              AND table_type = 'BASE TABLE' AND table_name !~ '_r[0-9]+$'
        """).fetchone()[0]
        vista = con.execute(
            "SELECT to_regclass('indicadores.v_pertinencia')").fetchone()[0]
    assert tablas == 31
    assert vista is not None


# ------------------------------------------------------------------ PI-03

def test_region_y_periodos_salen_de_la_base(cliente):
    r = cliente.get("/regiones/6").json()
    assert r["comunas"] == 4
    assert r["periodos"]["erosion"] == {"desde": 2020, "hasta": 2020}
    assert r["periodos"]["inversion"] == {"desde": 2012, "hasta": 2013}
    assert cliente.get("/regiones/99").status_code == 404


# ------------------------------------------------------------------ PI-04

def test_geojson_de_comunas_valido(cliente):
    g = cliente.get("/comunas/geojson?region=6").json()
    assert g["type"] == "FeatureCollection"
    assert len(g["features"]) == 4
    assert {f["geometry"]["type"] for f in g["features"]} == {"MultiPolygon"}
    ids = {f["properties"]["id_comuna"] for f in g["features"]}
    assert ids == {c[0] for c in COMUNAS}


# ------------------------------------------------------------------ PI-05

def test_pertinencia_de_la_api_coincide_con_el_calculo_a_mano(cliente):
    """La cadena completa: tablas -> vista -> ruta -> JSON."""
    filas = cliente.get("/pertinencia?region=6&origen=CIREN").json()
    esperado = _esperado()
    assert {f["id_comuna"] for f in filas} == set(esperado)
    for f in filas:
        assert f["pertinencia"] == pytest.approx(esperado[f["id_comuna"]], abs=1e-9)
    # Ordenadas de mayor a menor brecha
    valores = [f["pertinencia"] for f in filas]
    assert valores == sorted(valores, reverse=True)


# ------------------------------------------------------------------ PI-06

def test_fuera_de_dominio_solo_si_se_pide(cliente):
    dentro = cliente.get("/pertinencia?region=6&origen=CIREN").json()
    todas = cliente.get(
        "/pertinencia?region=6&origen=CIREN&incluir_fuera_de_dominio=true").json()
    assert 6904 not in {f["id_comuna"] for f in dentro}
    d = next(f for f in todas if f["id_comuna"] == 6904)
    assert d["en_dominio"] is False and d["brecha_uf"] is None


# ------------------------------------------------------------------ PI-07

def test_origen_inexistente_responde_404_con_los_disponibles(cliente):
    r = cliente.get("/pertinencia?region=6&origen=Inventado")
    assert r.status_code == 404
    assert r.json()["detail"]["origenes_disponibles"] == ["CIREN"]


# ------------------------------------------------------------------ PI-08

def test_reserva_estadistica_de_la_serie_sirsd(cliente):
    serie = cliente.get("/comunas/6901/sirsd").json()
    por_anio = {s["anio"]: s for s in serie}
    assert por_anio[2012]["reservado"] is False
    assert por_anio[2012]["incentivo_uf"] == pytest.approx(1000.0, abs=0.1)
    assert por_anio[2013]["reservado"] is True
    assert por_anio[2013]["incentivo"] is None


# ------------------------------------------------------------------ PI-09

def test_alta_de_fuente_queda_persistida(cliente, api_en_base_de_pruebas, monkeypatch):
    """La escritura se confirma: otra conexión la ve después de la respuesta."""
    monkeypatch.setattr(config, "CLAVE_ADMIN", CLAVE)
    cuerpo = {"codigo": "prueba_integracion", "nombre": "Fuente de prueba",
              "organismo": "Duoc UC", "tipo": "vectorial"}
    r = cliente.post("/fuentes", json=cuerpo,
                     headers={"Authorization": "Bearer " + CLAVE})
    assert r.status_code == 201
    id_fuente = r.json()["id_fuente"]

    with psycopg.connect(api_en_base_de_pruebas) as con:
        fila = con.execute("SELECT codigo, estado FROM operacion.fuente "
                           "WHERE id_fuente = %s", (id_fuente,)).fetchone()
    assert fila == ("prueba_integracion", "pendiente")

    # El mismo código otra vez: conflicto, no error del servidor.
    r2 = cliente.post("/fuentes", json=cuerpo,
                      headers={"Authorization": "Bearer " + CLAVE})
    assert r2.status_code == 409


# ------------------------------------------------------------------ PI-10

def test_cambio_de_estado_y_rechazo_sin_clave(cliente, monkeypatch):
    monkeypatch.setattr(config, "CLAVE_ADMIN", CLAVE)
    id_ciren = next(f["id_fuente"] for f in cliente.get("/fuentes").json()
                    if f["codigo"] == "ciren")

    sin_clave = cliente.patch("/fuentes/%d" % id_ciren, json={"estado": "error"})
    assert sin_clave.status_code == 401
    assert cliente.get("/fuentes/%d" % id_ciren).json()["estado"] != "error"

    r = cliente.patch("/fuentes/%d" % id_ciren, json={"estado": "parcial"},
                      headers={"Authorization": "Bearer " + CLAVE})
    assert r.status_code == 200
    assert cliente.get("/fuentes/%d" % id_ciren).json()["estado"] == "parcial"


# ------------------------------------------------------------------ PI-11

def test_la_restriccion_de_la_base_y_la_api_aceptan_lo_mismo(cliente, monkeypatch,
                                                            api_en_base_de_pruebas):
    """La lista ESTADOS de la API está duplicada a propósito de la CHECK de la
    tabla. Si alguien cambia una sin la otra, esta prueba lo detecta."""
    from rutas.fuentes import ESTADOS
    with psycopg.connect(api_en_base_de_pruebas) as con:
        definicion = con.execute("""
            SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conname = 'fuente_estado_valido'""").fetchone()[0]
    for estado in ESTADOS:
        assert "'%s'" % estado in definicion

    monkeypatch.setattr(config, "CLAVE_ADMIN", CLAVE)
    r = cliente.patch("/fuentes/1", json={"estado": "inventado"},
                      headers={"Authorization": "Bearer " + CLAVE})
    assert r.status_code == 422


# ------------------------------------------------------------------ PI-12

def test_bitacora_del_motor_llega_al_catalogo(cliente, api_en_base_de_pruebas):
    """El motor escribe la bitácora; la API la cruza con el catálogo."""
    with psycopg.connect(api_en_base_de_pruebas) as con:
        con.execute("""
            INSERT INTO operacion.ejecucion_proceso
                   (id_fuente, id_region, proceso, inicio, fin, estado, registros)
            SELECT id_fuente, 6, 'Ingesta CIREN (prueba)', now() - interval '5 min',
                   now(), 'ok', 33
            FROM operacion.fuente WHERE codigo = 'ciren'""")
        con.execute("""
            INSERT INTO operacion.ejecucion_proceso (id_region, proceso, estado)
            VALUES (6, 'Proceso sin cerrar', 'en curso')""")

    ciren = next(f for f in cliente.get("/fuentes").json() if f["codigo"] == "ciren")
    assert ciren["ultimo_estado"] == "ok"
    assert ciren["ultimos_registros"] == 33

    lista = cliente.get("/ejecuciones?limite=5").json()
    abierto = next(e for e in lista if e["proceso"] == "Proceso sin cerrar")
    assert abierto["fin"] is None and abierto["segundos"] is None

    resumen = cliente.get("/ejecuciones/resumen").json()
    assert resumen["total"] >= 2 and resumen["en_curso"] >= 1
    assert resumen["registros_escritos"] >= 33
