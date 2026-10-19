# -*- coding: utf-8 -*-
"""
Autenticación de las escrituras (RF-31, RNF-19), sin tocar la base.

Ninguna de estas pruebas llega a escribir: o las corta la autenticación, o
llevan un cuerpo inválido que la validación rechaza después de ella. Así
corren también en un equipo sin Docker.
"""
import pytest
from fastapi.testclient import TestClient

import config
from main import app
from seguridad import LARGO_MINIMO

cliente = TestClient(app)

CLAVE = "k" * 40
# Cuerpo que la validación rechaza (falta todo): si la autenticación deja
# pasar, la respuesta es 422 y no una fila nueva en el catálogo.
INVALIDO = {"nombre": "x"}

ESCRITURAS = [("post", "/fuentes"), ("patch", "/fuentes/1")]


def _pedir(metodo, ruta, encabezados=None):
    return getattr(cliente, metodo)(ruta, json=INVALIDO, headers=encabezados or {})


@pytest.fixture
def con_clave(monkeypatch):
    monkeypatch.setattr(config, "CLAVE_ADMIN", CLAVE)


@pytest.mark.parametrize("metodo,ruta", ESCRITURAS)
def test_sin_clave_en_el_servidor_la_escritura_queda_cerrada(monkeypatch, metodo, ruta):
    """Cerrado por defecto: un servidor sin configurar no queda abierto."""
    monkeypatch.setattr(config, "CLAVE_ADMIN", "")
    r = _pedir(metodo, ruta, {"Authorization": "Bearer lo-que-sea"})
    assert r.status_code == 503
    assert "TERRAFOCO_CLAVE_ADMIN" in r.json()["detail"]


def test_una_clave_corta_cuenta_como_no_configurada(monkeypatch):
    corta = "a" * (LARGO_MINIMO - 1)
    monkeypatch.setattr(config, "CLAVE_ADMIN", corta)
    r = _pedir("post", "/fuentes", {"Authorization": "Bearer " + corta})
    assert r.status_code == 503


@pytest.mark.parametrize("metodo,ruta", ESCRITURAS)
def test_sin_encabezado_responde_401_con_desafio(con_clave, metodo, ruta):
    r = _pedir(metodo, ruta)
    assert r.status_code == 401
    assert r.headers.get("www-authenticate") == "Bearer"


@pytest.mark.parametrize("encabezado", [
    "Bearer " + "k" * 39,          # casi
    "Bearer " + CLAVE + "k",       # de más
    "Basic " + CLAVE,              # otro esquema
    CLAVE,                         # sin esquema
    "Bearer ",                     # vacía
])
def test_claves_incorrectas_responden_401(con_clave, encabezado):
    r = _pedir("post", "/fuentes", {"Authorization": encabezado})
    assert r.status_code == 401


@pytest.mark.parametrize("metodo,ruta", ESCRITURAS)
def test_con_la_clave_pasa_a_la_validacion(con_clave, metodo, ruta):
    """Con la clave correcta se llega a validar el cuerpo: 422, no 401."""
    r = _pedir(metodo, ruta, {"Authorization": "Bearer " + CLAVE})
    assert r.status_code == 422


def test_la_autenticacion_va_antes_que_la_validacion(con_clave):
    """Sin clave no se revela qué campos espera la ruta."""
    r = _pedir("post", "/fuentes")
    assert r.status_code == 401
    assert "codigo" not in r.text


def test_las_lecturas_no_piden_clave(monkeypatch):
    monkeypatch.setattr(config, "CLAVE_ADMIN", "")
    assert cliente.get("/salud").status_code != 401
    assert cliente.get("/openapi.json").status_code == 200


def test_la_documentacion_declara_el_esquema():
    """/docs muestra el botón Authorize y marca las rutas que lo piden."""
    doc = cliente.get("/openapi.json").json()
    assert any(e.get("scheme") == "bearer"
               for e in doc["components"]["securitySchemes"].values())
    assert doc["paths"]["/fuentes"]["post"].get("security")
    assert not doc["paths"]["/fuentes"]["get"].get("security")


def test_cors_permite_el_encabezado_de_la_clave():
    """Sin Authorization en allow_headers el navegador ni siquiera envía el PATCH."""
    r = cliente.options("/fuentes/1", headers={
        "Origin": "http://localhost:8081",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "authorization,content-type"})
    assert r.status_code == 200
    permitidos = r.headers.get("access-control-allow-headers", "").lower()
    assert "authorization" in permitidos
