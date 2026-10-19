# -*- coding: utf-8 -*-
"""
Pruebas del catálogo de fuentes (UC-10), el único endpoint que escribe.

Las que validan el contrato no tocan la base: comprueban que la API rechaza lo
que la restricción CHECK de la tabla rechazaría, antes de intentar el INSERT.
Eso importa porque un estado inválido que llega a PostgreSQL vuelve como error
de integridad, y el visor no sabe traducir eso a un mensaje para la persona.

Las que sí escriben están marcadas y se saltan si no hay base, para que la
batería siga corriendo en un equipo sin Docker levantado.
"""
import pytest
from fastapi.testclient import TestClient

import bd
from main import app
from rutas.fuentes import ESTADOS

cliente = TestClient(app)

# Las escrituras piden la clave de administración (seguridad.py). Las pruebas
# de este archivo son del catálogo, no de la autenticación —esas están en
# test_seguridad.py—, así que fijan una clave y la mandan siempre.
CLAVE_PRUEBA = "clave-de-prueba-" + "x" * 24
admin = TestClient(app, headers={"Authorization": "Bearer " + CLAVE_PRUEBA})


@pytest.fixture(autouse=True)
def _clave(monkeypatch):
    import config
    monkeypatch.setattr(config, "CLAVE_ADMIN", CLAVE_PRUEBA)


def hay_base():
    """Sondeo con tope de tiempo, no con la conexión normal de la API.

    Esto se evalúa al importar el módulo. Sin `connect_timeout` psycopg espera
    lo que decida el sistema operativo, que pueden ser minutos: en un
    Codespace recién arrancado la base todavía no acepta conexiones y la
    batería de pruebas se veía colgada en vez de saltarse estas.
    """
    import psycopg

    import config
    try:
        with psycopg.connect(config.BD_URL, connect_timeout=3) as con:
            con.execute("SELECT 1")
        return True
    except Exception:
        return False


necesita_base = pytest.mark.skipif(
    not hay_base(), reason="requiere PostgreSQL levantado")


# --------------------------------------------------- contrato, sin tocar la base

@pytest.mark.parametrize("estado", ["inventado", "OK", "", "ok "])
def test_rechaza_estados_fuera_de_la_lista(estado):
    """La API valida antes de escribir, no delega en el error de la base."""
    r = admin.patch("/fuentes/1", json={"estado": estado})
    assert r.status_code == 422


def test_los_estados_validos_son_los_de_la_restriccion():
    """Si alguien cambia el CHECK de la tabla, esta prueba avisa."""
    assert set(ESTADOS) == {"ok", "parcial", "pendiente", "error"}


def test_patch_sin_cambios_es_error():
    r = admin.patch("/fuentes/1", json={})
    assert r.status_code == 422


def test_alta_exige_los_campos_obligatorios():
    r = admin.post("/fuentes", json={"nombre": "Solo el nombre"})
    assert r.status_code == 422


def test_alta_rechaza_nombre_demasiado_corto():
    r = admin.post("/fuentes", json={
        "codigo": "valido", "nombre": "ab", "organismo": "X", "tipo": "WFS"})
    assert r.status_code == 422


def test_alta_exige_codigo():
    """Desde la migracion 012 el codigo es obligatorio en la tabla. Si la API
    no lo exige, el INSERT revienta en la base y el visor recibe un 500."""
    r = admin.post("/fuentes", json={
        "nombre": "Sin codigo", "organismo": "Pruebas", "tipo": "ninguno"})
    assert r.status_code == 422


@pytest.mark.parametrize("codigo", [
    "Mayusculas", "con espacios", "con-guion", "1empieza_con_numero", "x",
    "demasiado_largo_para_la_columna_de_treinta"])
def test_alta_rechaza_codigos_mal_formados(codigo):
    """Mismo formato que los que siembra la 012: minusculas, digitos y _."""
    r = admin.post("/fuentes", json={
        "codigo": codigo, "nombre": "Formato", "organismo": "P", "tipo": "x"})
    assert r.status_code == 422


# ------------------------------------------------------- escritura de verdad

CODIGO_PRUEBA = "prueba_automatizada"


def _limpiar_prueba():
    """Por si una corrida anterior murio a medias y dejo la fila."""
    with bd.transaccion() as con:
        con.execute("DELETE FROM operacion.fuente WHERE codigo = %s",
                    (CODIGO_PRUEBA,))


@necesita_base
def test_ciclo_completo_de_alta_y_cambio():
    """Alta, lectura, cambio de estado y verificación de que persistió."""
    _limpiar_prueba()
    nuevo = {"codigo": CODIGO_PRUEBA,
             "nombre": "Fuente de prueba automatizada",
             "organismo": "Pruebas", "tipo": "ninguno"}

    r = admin.post("/fuentes", json=nuevo)
    assert r.status_code == 201
    creada = r.json()
    assert creada["estado"] == "pendiente"       # el valor por defecto
    assert creada["ultima_carga"] is None
    id_fuente = creada["id_fuente"]

    try:
        r = cliente.get("/fuentes/%d" % id_fuente)
        assert r.status_code == 200
        assert r.json()["nombre"] == nuevo["nombre"]

        r = admin.patch("/fuentes/%d" % id_fuente,
                          json={"estado": "ok", "marcar_carga": True})
        assert r.status_code == 200
        assert r.json()["estado"] == "ok"
        assert r.json()["ultima_carga"] is not None

        # Lo que importa: que el cambio quedó confirmado en la base y no solo
        # en la respuesta. Sin commit la API responde 200 igual.
        with bd.conexion() as con:
            fila = con.execute(
                "SELECT estado FROM operacion.fuente WHERE id_fuente = %s",
                (id_fuente,)).fetchone()
        assert fila is not None and fila[0] == "ok"
    finally:
        _limpiar_prueba()


@necesita_base
def test_codigo_repetido_da_409_y_no_500():
    """Un pedido mal hecho es culpa del cliente (4xx), no del servidor (5xx).
    Antes un codigo repetido llegaba como error interno."""
    _limpiar_prueba()
    nuevo = {"codigo": CODIGO_PRUEBA, "nombre": "Primera",
             "organismo": "Pruebas", "tipo": "ninguno"}
    try:
        assert admin.post("/fuentes", json=nuevo).status_code == 201
        r = admin.post("/fuentes", json=dict(nuevo, nombre="Segunda"))
        assert r.status_code == 409
        assert CODIGO_PRUEBA in r.json()["detail"]
    finally:
        _limpiar_prueba()


@necesita_base
def test_fuente_inexistente_da_404():
    assert cliente.get("/fuentes/999999").status_code == 404
    assert admin.patch("/fuentes/999999",
                         json={"estado": "ok"}).status_code == 404


@necesita_base
def test_listar_devuelve_el_catalogo():
    r = cliente.get("/fuentes")
    assert r.status_code == 200
    for f in r.json():
        assert f["estado"] in ESTADOS
