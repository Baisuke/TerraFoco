# -*- coding: utf-8 -*-
"""
La base de la copia portable: crearla desde el volcado de la base de desarrollo.

La copia portable lleva siempre `datos/terrafoco.sql.gz` (el volcado, ~50 MB)
y, si se pudo armar, `base/` (el cluster ya cargado, que arranca en segundos).
`base/` es un cache del volcado: lleva dentro la versión del volcado del que
salió, y si no está o es de otro volcado, el lanzador la vuelve a crear en el
primer arranque (uno a dos minutos, una sola vez).

Hace falta porque armar `base/` exige ejecutar PostgreSQL en el equipo que
arma la copia, y Windows puede impedirlo: con el Control inteligente de
aplicaciones (Smart App Control) activo, los binarios sin firma reconocida
—libxml2.dll de PostGIS, entre otros— no se cargan. Sin este camino, ese
equipo no podría producir una copia con datos.

Lo usan herramientas/empaquetar_portable.py y herramientas/lanzador_portable.py.
"""
import gzip
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

USUARIO = "terrafoco"
BASE_DATOS = "terrafoco"
MARCA = "terrafoco_version.txt"       # dentro del cluster: de qué volcado salió
EXTENSIONES = ("postgis", "postgis_raster")


def version_del_volcado(datos):
    ruta = Path(datos) / "version.txt"
    return ruta.read_text(encoding="utf-8").strip() if ruta.exists() else None


def al_dia(cluster, datos):
    """Si el cluster existe y salió del volcado que trae la copia.

    Una copia sin volcado (las armadas antes de este módulo) solo trae el
    cluster: se usa tal cual.
    """
    cluster = Path(cluster)
    if not (cluster / "PG_VERSION").exists():
        return False
    esperada = version_del_volcado(datos)
    if esperada is None:
        return True
    marca = cluster / MARCA
    return marca.exists() and marca.read_text(encoding="utf-8").strip() == esperada


def _cola(ruta, lineas=15):
    try:
        return "\n".join(Path(ruta).read_text(encoding="utf-8", errors="replace")
                         .splitlines()[-lineas:])
    except OSError:
        return "(sin registro)"


def _correr(orden, kw):
    r = subprocess.run(orden, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", stdin=subprocess.DEVNULL, **kw)
    if r.returncode != 0:
        raise SystemExit("Fallo: %s\n%s%s" % (" ".join(str(o) for o in orden),
                                              r.stdout, r.stderr))
    return r.stdout


def restaurar(exe, conexion, volcado, kw):
    """Pasa el volcado comprimido a psql por la entrada estándar.

    Sin descomprimirlo a disco: en un pendrive son 120 MB menos de escritura.
    El error de psql va a un archivo temporal y no a una tubería: con una
    tubería llena, psql se bloquea y la restauración no termina nunca.
    """
    entorno = dict(os.environ, PGOPTIONS="-c client_min_messages=warning")
    with tempfile.TemporaryFile() as errores, gzip.open(volcado, "rb") as origen:
        p = subprocess.Popen([exe("psql")] + conexion +
                             ["-d", BASE_DATOS, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                             stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                             stderr=errores, env=entorno, **kw)
        try:
            shutil.copyfileobj(origen, p.stdin, 1 << 20)
            p.stdin.close()
        except BrokenPipeError:
            pass          # psql se detuvo en un error: el motivo está en `errores`
        if p.wait() != 0:
            errores.seek(0)
            texto = errores.read().decode("utf-8", "replace").strip().splitlines()
            raise SystemExit("La restauración falló:\n%s" % "\n".join(texto[-12:]))


def construir(exe, destino, volcado, puerto, bitacora, aviso=print, **kw):
    """Crea en `destino` un cluster con los datos del volcado.

    initdb, arranque en 127.0.0.1, base y extensiones, restauración, vacuum y
    apagado. Si algo falla, `destino` se borra: nunca queda un cluster a
    medias que el siguiente arranque tome por bueno.
    """
    destino = Path(destino)
    if destino.exists():
        shutil.rmtree(destino)
    try:
        # locale=C: existe en todo Windows y el cluster viaja a computadores
        # ajenos. auth=trust con listen_addresses=127.0.0.1: la base no acepta
        # conexiones de fuera del computador.
        _correr([exe("initdb"), "-D", str(destino), "-U", USUARIO, "-E", "UTF8",
                 "--locale=C", "--auth-local=trust", "--auth-host=trust"], kw)
        # Sin capture_output: pg_ctl deja a postgres como nieto y heredaría
        # las tuberías; Python esperaría a que cierren y no cerrarían nunca.
        r = subprocess.run([exe("pg_ctl"), "-D", str(destino), "-l", str(bitacora),
                            "-w", "-t", "60",
                            "-o", "-p %d -c listen_addresses=127.0.0.1" % puerto, "start"],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, **kw)
        if r.returncode != 0:
            raise SystemExit("PostgreSQL no arrancó:\n%s" % _cola(bitacora))
        try:
            conexion = ["-h", "127.0.0.1", "-p", str(puerto), "-U", USUARIO]
            _correr([exe("psql")] + conexion + ["-d", "postgres", "-v", "ON_ERROR_STOP=1",
                                                "-qc", "CREATE DATABASE %s" % BASE_DATOS], kw)
            # postgis_raster es aparte y hace falta: operacion.cobertura_raster
            # tiene una columna raster y sin ella el volcado se cae al restaurar.
            for extension in EXTENSIONES:
                _correr([exe("psql")] + conexion +
                        ["-d", BASE_DATOS, "-v", "ON_ERROR_STOP=1",
                         "-qc", "CREATE EXTENSION IF NOT EXISTS %s" % extension], kw)
            aviso("  restaurando los datos (%.0f MB comprimidos)..."
                  % (Path(volcado).stat().st_size / 1e6))
            restaurar(exe, conexion, volcado, kw)
            aviso("  actualizando estadísticas...")
            _correr([exe("vacuumdb")] + conexion + ["-d", BASE_DATOS, "-z", "-q"], kw)
        finally:
            subprocess.run([exe("pg_ctl"), "-D", str(destino), "-m", "fast", "stop"],
                           capture_output=True, stdin=subprocess.DEVNULL, **kw)
        version = version_del_volcado(Path(volcado).parent)
        (destino / MARCA).write_text(version or "", encoding="utf-8")
    except BaseException:
        shutil.rmtree(destino, ignore_errors=True)
        raise


def reemplazar(nuevo, actual):
    """El cluster nuevo pasa a ser `actual` recién cuando está completo."""
    nuevo, actual = Path(nuevo), Path(actual)
    if actual.exists():
        shutil.rmtree(actual)
    nuevo.rename(actual)


def postgres_corre(exe):
    """Si este Windows deja ejecutar los binarios de PostgreSQL.

    Con Smart App Control activo, postgres.exe termina con 0xC0E90002 sin
    escribir nada: initdb solo dice "program postgres is needed". Se pregunta
    antes de tocar nada para poder decirlo con todas sus letras.
    """
    try:
        r = subprocess.run([exe("postgres"), "-V"], capture_output=True, text=True,
                           stdin=subprocess.DEVNULL, timeout=30)
    except OSError:
        return False
    return r.returncode == 0 and "PostgreSQL" in r.stdout
