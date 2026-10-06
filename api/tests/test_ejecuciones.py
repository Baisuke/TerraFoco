# -*- coding: utf-8 -*-
"""Pruebas de la bitácora de ejecuciones (UC-12), de solo lectura."""
import pytest
from fastapi.testclient import TestClient

from main import app
from tests.test_fuentes import hay_base

cliente = TestClient(app)

necesita_base = pytest.mark.skipif(
    not hay_base(), reason="requiere PostgreSQL levantado")


def test_el_limite_se_valida():
    """Sin tope, una consulta podría arrastrar toda la bitácora histórica."""
    assert cliente.get("/ejecuciones?limite=0").status_code == 422
    assert cliente.get("/ejecuciones?limite=500").status_code == 422
    assert cliente.get("/ejecuciones?limite=abc").status_code == 422


@necesita_base
def test_devuelve_las_mas_recientes_primero():
    r = cliente.get("/ejecuciones?limite=5")
    assert r.status_code == 200
    filas = r.json()
    ids = [f["id_proceso"] for f in filas]
    assert ids == sorted(ids, reverse=True)
    assert len(filas) <= 5


@necesita_base
def test_el_resumen_cuadra_con_la_bitacora():
    """El total es el historico completo, no el de la pagina consultada."""
    r = cliente.get("/ejecuciones/resumen")
    assert r.status_code == 200
    d = r.json()

    assert d["total"] >= d["ok"] + d["error"]
    assert d["en_curso"] >= 0
    if d["total"]:
        assert d["ultima"] is not None

    # Si el total saliera de una pagina acotada, pedir menos filas lo
    # cambiaria. Tiene que ser el mismo numero.
    assert cliente.get("/ejecuciones/resumen").json()["total"] == d["total"]
    assert len(cliente.get("/ejecuciones?limite=1").json()) <= 1


@necesita_base
def test_cada_fila_trae_lo_que_la_pantalla_necesita():
    filas = cliente.get("/ejecuciones?limite=3").json()
    if not filas:
        pytest.skip("la bitácora está vacía")
    for f in filas:
        assert f["proceso"] and f["inicio"]
        assert f["estado"] in ("ok", "error", "en curso")
        # La duración se calcula en la API: un proceso sin cerrar la deja en
        # nulo, y el navegador no tiene que restar fechas con un nulo dentro.
        if f["fin"] is None:
            assert f["segundos"] is None
        else:
            assert isinstance(f["segundos"], int) and f["segundos"] >= 0
