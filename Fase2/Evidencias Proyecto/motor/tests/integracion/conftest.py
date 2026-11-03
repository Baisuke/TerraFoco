# -*- coding: utf-8 -*-
"""
Base de datos temporal para las pruebas de integración del motor.

Las pruebas unitarias del motor (tests/*.py) no tocan la base: usan rásteres
y tablas armadas en memoria. Las de integración necesitan otra cosa:
una base **conocida**, creada desde cero con el mismo esquema y las mismas
migraciones que producción, y con datos que la prueba controla. Solo así se
puede afirmar "con estos datos, el motor escribe exactamente esto".

Qué hace este archivo:

  1. Se conecta a la base configurada en BD_URL (la del docker-compose).
  2. Crea una base aparte, `terrafoco_integracion_motor`, y la borra al final.
     (Otro nombre que el de la API, para poder correr ambas suites a la vez.)
     NUNCA usa la base de desarrollo: si los nombres coinciden, se niega.
  3. Le aplica bd/esquema.sql y las 19 migraciones, en orden.
  4. Apunta config.BD_URL del motor a esa base mientras duran las pruebas.

Si no hay PostgreSQL, o el usuario no puede crear bases, las pruebas se
omiten con el motivo, igual que el resto de la batería.

Ejecución (con el compose levantado):

    docker exec -i terrafoco-programador python -m pytest tests/integracion -v
"""
import os
import pathlib
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from psycopg import sql

import config

NOMBRE_BASE = os.getenv("TERRAFOCO_BD_PRUEBAS", "terrafoco_integracion_motor")


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "integracion: prueba de integración motor + PostgreSQL/PostGIS")


def pytest_collection_modifyitems(items):
    # Todo lo que vive en esta carpeta es de integración: así se puede correr
    # solo esto con `-m integracion` o excluirlo con `-m "not integracion"`.
    for item in items:
        if pathlib.Path(str(item.fspath)).parent.name == "integracion":
            item.add_marker(pytest.mark.integracion)


def directorio_bd():
    """Dónde están esquema.sql y las migraciones.

    Dentro de los contenedores motor y programador se montan en /bd
    (docker-compose.yml).
    En un equipo sin Docker se encuentran subiendo desde esta carpeta.
    """
    candidatos = [
        os.getenv("TERRAFOCO_BD_DIR"),
        "/bd",
        pathlib.Path(__file__).resolve().parents[3] / "bd",
    ]
    for c in candidatos:
        if c and (pathlib.Path(c) / "esquema.sql").is_file():
            return pathlib.Path(c)
    return None


def url_con_base(url, base):
    partes = urlsplit(url)
    return urlunsplit(partes._replace(path="/" + base))


def scripts_en_orden(dir_bd):
    """esquema.sql primero y luego las migraciones por su número."""
    return [dir_bd / "esquema.sql"] + sorted((dir_bd / "migraciones").glob("*.sql"))


def aplicar(url, rutas):
    """Corre cada script completo. Sin parámetros psycopg acepta varias
    sentencias en una llamada, igual que `psql -f`."""
    with psycopg.connect(url, autocommit=True) as con:
        for ruta in rutas:
            con.execute(ruta.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def url_integracion():
    url_original = config.BD_URL
    if urlsplit(url_original).path.lstrip("/") == NOMBRE_BASE:
        pytest.skip("BD_URL ya apunta a %s: no se usa la misma base para "
                    "administrar y para probar" % NOMBRE_BASE)

    dir_bd = directorio_bd()
    if dir_bd is None:
        pytest.skip("no se encontró bd/esquema.sql (montar ./bd en /bd o "
                    "definir TERRAFOCO_BD_DIR)")

    try:
        admin = psycopg.connect(url_original, autocommit=True, connect_timeout=3)
    except Exception as e:
        pytest.skip("requiere PostgreSQL levantado (%s)" % e.__class__.__name__)

    try:
        nombre = sql.Identifier(NOMBRE_BASE)
        admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(nombre))
        admin.execute(sql.SQL("CREATE DATABASE {}").format(nombre))
    except psycopg.Error as e:
        admin.close()
        pytest.skip("el usuario no puede crear la base de pruebas: %s" % e)

    url = url_con_base(url_original, NOMBRE_BASE)
    try:
        aplicar(url, scripts_en_orden(dir_bd))
        yield url
    finally:
        admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)")
                      .format(sql.Identifier(NOMBRE_BASE)))
        admin.close()


@pytest.fixture(scope="module")
def motor_en_base_de_pruebas(url_integracion):
    """El motor completo, leyendo y escribiendo en la base de pruebas.

    Por módulo y no por sesión: al terminar se devuelve config.BD_URL a su
    valor, para que las pruebas que corren después lean la base de siempre.
    """
    original = config.BD_URL
    config.BD_URL = url_integracion
    yield url_integracion
    config.BD_URL = original
