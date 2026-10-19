# -*- coding: utf-8 -*-
"""Prueba del endpoint de salud. No requiere base de datos."""
from fastapi.testclient import TestClient

from main import app

cliente = TestClient(app)


def test_raiz_responde():
    r = cliente.get("/")
    assert r.status_code == 200
    assert r.json()["nombre"] == "TerraFoco API"


def test_salud_siempre_responde():
    """Aunque la base este caida, /salud debe contestar e informarlo."""
    r = cliente.get("/salud")
    assert r.status_code == 200
    assert r.json()["api"] == "ok"
    assert r.json()["base_de_datos"] in ("ok", "error")
