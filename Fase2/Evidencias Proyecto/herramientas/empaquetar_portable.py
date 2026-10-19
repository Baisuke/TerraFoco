# -*- coding: utf-8 -*-
"""
Arma la copia portable de TerraFoco: una carpeta que corre en cualquier
Windows sin instalar nada, con PostgreSQL + PostGIS de verdad adentro.

Es el respaldo de la demo en Codespaces: arranca desde un pendrive en
cualquier Windows, sin GitHub, sin Docker y sin cuenta de nadie.

Los mapas siguen necesitando internet —MapLibre y el mapa base vienen de
sus servidores—, pero la base, la API y las tablas no.

    python herramientas/empaquetar_portable.py                  # todo
    python herramientas/empaquetar_portable.py --solo-lanzador  # API, visor, Python y lanzador
    python herramientas/empaquetar_portable.py --solo-datos     # recargar la base

Lo que produce, en dist/TerraFoco-portable/:

    TerraFoco.cmd    el lanzador: doble clic
    python/          Python 3 oficial (firmado) con las librerias de la API
    lanzador/        el codigo del lanzador (lanzador_portable.py y sus modulos)
    pgsql/           binarios de PostgreSQL 16 + PostGIS 3.4
    datos/           el volcado de la base (terrafoco.sql.gz) y su version
    base/            el cluster ya cargado, si este equipo pudo armarlo
    api/             la API, en .py, para poder corregirla sin recompilar
    prototipo/       el visor

Cuando se puede, el cluster va cargado: el primer arranque son segundos y no
dos minutos de initdb delante de la comision. Armarlo exige ejecutar
PostgreSQL aqui, y un Windows con el Control inteligente de aplicaciones
activo no lo deja; entonces la copia sale solo con el volcado y el lanzador
crea la base en su primer arranque (ver base_portable.py).

POR QUE UN .cmd Y NO UN .exe
---------------------------
Hasta octubre el lanzador se compilaba con PyInstaller a TerraFoco.exe. Un
.exe recien compilado no tiene firma ni historial, y Windows con el Control
inteligente de aplicaciones (Smart App Control) lo bloquea sin ofrecer
"ejecutar de todas formas": en el PC de desarrollo bloqueo casi todas las
compilaciones. Ahora la copia lleva el Python oficial —python.exe y sus DLL
firmados por la Python Software Foundation— y TerraFoco.cmd lo usa para
correr el lanzador. No hay ningun ejecutable nuestro que firmar ni que
Windows tenga que conocer.

Las librerias de la API van en python/Lib/site-packages. psycopg va en su
version Python pura y usa la libpq de pgsql/bin: la variante "binary" trae
su propia libpq y OpenSSL sin firma, que es lo que el control de
aplicaciones revisa.

Requiere Docker arriba, porque los datos salen de la base de desarrollo, y
correr con el Python oficial de Windows (el de python.org), porque es el que
se copia.
"""
import argparse
import gzip
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import base_portable

RAIZ = Path(__file__).resolve().parent.parent
# Con TERRAFOCO_DIST se construye fuera del repositorio. Sirve cuando el
# repositorio está en OneDrive o similar: son ~500 MB de descargas y ~700 MB
# de portable que, dentro de dist/, se sincronizarían a la nube.
#   TERRAFOCO_DIST=C:/Users/yo/terrafoco-dist python herramientas/empaquetar_portable.py
DIST = Path(os.environ["TERRAFOCO_DIST"]) if os.environ.get("TERRAFOCO_DIST") else RAIZ / "dist"
DESCARGAS = DIST / "descargas"
SALIDA = DIST / "TerraFoco-portable"
PYTHON = SALIDA / "python"
LANZADOR = SALIDA / "lanzador"
# Lo que va de herramientas/ a lanzador/: el lanzador y lo que importa.
MODULOS_LANZADOR = ("lanzador_portable.py", "base_portable.py", "rangos.py")
# De api/requirements.txt, lo que no hace falta para correr la API.
SOLO_PRUEBAS = ("pytest", "httpx")

PGSQL = SALIDA / "pgsql"
CLUSTER = SALIDA / "base"
CLUSTER_NUEVO = SALIDA / "base.nuevo"
DATOS = SALIDA / "datos"
VOLCADO = DATOS / "terrafoco.sql.gz"

# PostgreSQL 16 porque el proyecto corre en postgis/postgis:16-3.4. La minor
# puede diferir (16.15 contra 16.4): el formato del cluster es por major.
ZIP_PG = "postgresql-16.15-windows-x64-binaries.zip"
URL_PG = "https://sbp.enterprisedb.com/getfile.jsp?fileid=1260572"

# 3.4.2 y no la 3.6 que OSGeo publica hoy: la base de desarrollo tiene 3.4.3
# y conviene quedarse en la misma linea menor para restaurar sin sorpresas.
ZIP_POSTGIS = "postgis-bundle-pg16-3.4.2x64.zip"
URL_POSTGIS = ("https://download.osgeo.org/postgis/windows/pg16/archive/"
               "postgis-bundle-pg16-3.4.2x64.zip")

# pgAdmin son 807 MB de los 966 del paquete de EDB, y la demo no lo usa: se
# muestra la base con psql. doc, include y StackBuilder tampoco hacen falta.
FUERA_DE_PG = ("pgsql/pgAdmin 4/", "pgsql/doc/", "pgsql/include/",
               "pgsql/StackBuilder/")

USUARIO = "terrafoco"
BASE_DATOS = "terrafoco"
PUERTO_BUILD = 55433        # solo durante la construccion

# public queda fuera a proposito: ahi vive PostGIS, que el cluster destino
# crea por su cuenta. Arrastrarlo significaria llevar tambien los 7 MB de
# spatial_ref_sys, que el destino ya trae. ogr_system_tables la deja GDAL al
# escribir y nadie la lee.
ESQUEMAS = ("territorio", "indicadores", "operacion", "programas")


def paso(n, texto):
    print("")
    print("[%s] %s" % (n, texto))
    print("-" * 60)


def correr(orden, **kw):
    # stdin cerrado, siempre. `docker compose exec` se queda esperando entrada
    # aunque nadie la vaya a escribir, y el empaquetador se cuelga sin decir
    # nada: diez minutos de silencio hasta darse cuenta.
    kw.setdefault("stdin", subprocess.DEVNULL)
    r = subprocess.run(orden, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", **kw)
    if r.returncode != 0:
        raise SystemExit("Fallo: %s\n%s\n%s"
                         % (" ".join(str(o) for o in orden), r.stdout, r.stderr))
    return r.stdout


def pgexe(nombre):
    return str(PGSQL / "bin" / (nombre + ".exe"))


# ---------------------------------------------------------------------------

def descargar():
    DESCARGAS.mkdir(parents=True, exist_ok=True)
    for nombre, url in ((ZIP_PG, URL_PG), (ZIP_POSTGIS, URL_POSTGIS)):
        destino = DESCARGAS / nombre
        if destino.exists() and zipfile.is_zipfile(destino):
            print("  ya esta: %s (%.0f MB)" % (nombre, destino.stat().st_size / 1e6))
            continue
        print("  bajando %s ..." % nombre)
        correr(["curl", "-sL", "--max-time", "900", "-A", "Mozilla/5.0",
                "-o", str(destino), url])
        if not zipfile.is_zipfile(destino):
            raise SystemExit("La descarga de %s no es un zip valido." % nombre)
        print("  -> %.0f MB" % (destino.stat().st_size / 1e6))


def extraer_binarios():
    if PGSQL.exists():
        shutil.rmtree(PGSQL)
    SALIDA.mkdir(parents=True, exist_ok=True)

    print("  PostgreSQL (sin pgAdmin, doc ni include)...")
    with zipfile.ZipFile(DESCARGAS / ZIP_PG) as z:
        miembros = [m for m in z.namelist()
                    if not any(m.startswith(p) for p in FUERA_DE_PG)]
        z.extractall(SALIDA, members=miembros)
    print("  -> %d archivos, %.0f MB" % (contar(PGSQL), pesa(PGSQL)))

    print("  PostGIS, fusionado dentro de pgsql/...")
    tmp = DIST / "_postgis"
    if tmp.exists():
        shutil.rmtree(tmp)
    with zipfile.ZipFile(DESCARGAS / ZIP_POSTGIS) as z:
        z.extractall(tmp)
    # El bundle trae bin/, lib/, share/ con la misma forma que una instalacion
    # de PostgreSQL: se copian encima, que es lo que indica su propio README.
    interior = next(d for d in tmp.iterdir() if d.is_dir())
    for sub in ("bin", "lib", "share", "gdal-data", "utils"):
        origen = interior / sub
        if origen.exists():
            shutil.copytree(origen, PGSQL / sub, dirs_exist_ok=True)
    shutil.rmtree(tmp)
    print("  -> %d archivos, %.0f MB" % (contar(PGSQL), pesa(PGSQL)))


def contar(d):
    return sum(1 for _ in d.rglob("*") if _.is_file())


def pesa(d):
    return sum(f.stat().st_size for f in d.rglob("*") if f.is_file()) / 1e6


# ---------------------------------------------------------------------------

def volcar_desde_docker():
    """El volcado sale de la base de desarrollo, que es la que tiene los datos.

    Va comprimido a datos/terrafoco.sql.gz (~50 MB) y SIEMPRE viaja en la
    copia: con él, el lanzador crea la base en el primer arranque si base/ no
    viene armada o es de otro volcado. version.txt dice de cuál.
    """
    DATOS.mkdir(parents=True, exist_ok=True)
    orden = ["docker", "compose", "exec", "-T", "bd",
             "pg_dump", "-U", USUARIO, "-d", BASE_DATOS,
             "--no-owner", "--no-privileges"]
    for e in ESQUEMAS:
        orden += ["-n", e]
    entorno = dict(os.environ, MSYS_NO_PATHCONV="1")
    temporal = VOLCADO.with_suffix(".tmp")
    # El error a un archivo y no a una tubería: si se llenara, pg_dump se
    # bloquearía esperando que alguien la lea.
    with tempfile.TemporaryFile() as errores:
        with gzip.open(temporal, "wb", compresslevel=6) as destino:
            p = subprocess.Popen(orden, stdout=subprocess.PIPE, stderr=errores,
                                 stdin=subprocess.DEVNULL, cwd=RAIZ, env=entorno)
            shutil.copyfileobj(p.stdout, destino, 1 << 20)
            codigo = p.wait()
        if codigo != 0:
            temporal.unlink(missing_ok=True)
            errores.seek(0)
            raise SystemExit("pg_dump fallo. Docker tiene que estar arriba.\n%s"
                             % errores.read().decode("utf-8", "replace"))
    temporal.replace(VOLCADO)
    (DATOS / "version.txt").write_text(time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")
    print("  volcado: datos/%s (%.1f MB)" % (VOLCADO.name, VOLCADO.stat().st_size / 1e6))


def revisar_datos():
    """Que la base de origen tenga el índice completo antes de empaquetarla.

    El portable copia la base de desarrollo tal como está. Si en ese equipo no
    se cargó la serie del SIRSD-S o la superficie erosionada, el portable
    sale con la pertinencia vacía —33 comunas fuera del índice— y nadie lo
    nota hasta abrirlo delante de la comisión.
    """
    consultas = (
        ("serie SIRSD-S", "SELECT count(*) FROM programas.sirsd_anual"),
        ("superficie erosionada", "SELECT count(*) FROM indicadores.superficie_erosionada"),
        ("comunas con UF/ha", "SELECT count(*) FROM indicadores.v_pertinencia "
                              "WHERE origen = 'CIREN' AND inversion_uf_ha IS NOT NULL"),
    )
    entorno = dict(os.environ, MSYS_NO_PATHCONV="1")
    faltan = []
    for etiqueta, sql in consultas:
        r = subprocess.run(["docker", "compose", "exec", "-T", "bd", "psql", "-U", USUARIO,
                            "-d", BASE_DATOS, "-tAc", sql],
                           capture_output=True, cwd=RAIZ, env=entorno, stdin=subprocess.DEVNULL)
        n = r.stdout.decode().strip() if r.returncode == 0 else "error"
        print("  %-22s %s" % (etiqueta, n))
        if n in ("0", "error", ""):
            faltan.append(etiqueta)
    if faltan:
        raise SystemExit("La base de desarrollo no tiene: %s.\n"
                         "Cargarlos con: bash herramientas/inicializar.sh\n"
                         "(toma las semillas de bd/semillas y no necesita el motor completo)"
                         % ", ".join(faltan))


def cargar_datos():
    """El volcado siempre; la base armada, si este Windows deja correr PostgreSQL.

    La base nueva se arma en base.nuevo y reemplaza a la anterior recién al
    final: si algo falla a medio camino, la copia conserva la que tenía. (Antes
    se borraba primero, y un initdb fallido dejaba la copia sin base.)
    """
    revisar_datos()
    volcar_desde_docker()
    if not base_portable.postgres_corre(pgexe):
        print("")
        print("  AVISO: este Windows no deja ejecutar PostgreSQL (Control inteligente")
        print("  de aplicaciones). La copia lleva el volcado y TerraFoco.cmd crea la")
        print("  base en su primer arranque, en el computador donde se use (1-2 min).")
        if CLUSTER.exists():
            shutil.rmtree(CLUSTER)
            print("  base/ anterior eliminada: era de otro volcado.")
        return
    base_portable.construir(pgexe, CLUSTER_NUEVO, VOLCADO, PUERTO_BUILD, DIST / "build.log")
    base_portable.reemplazar(CLUSTER_NUEVO, CLUSTER)
    print("  base/ lista (%.0f MB)" % pesa(CLUSTER))


# ---------------------------------------------------------------------------

def copiar_aplicacion():
    for nombre in ("api", "prototipo"):
        destino = SALIDA / nombre
        if destino.exists():
            shutil.rmtree(destino)
        shutil.copytree(RAIZ / nombre, destino,
                        ignore=shutil.ignore_patterns(
                            "__pycache__", "*.pyc", "tests", ".pytest_cache"))
        print("  %-10s %d archivos, %.1f MB" % (nombre, contar(destino), pesa(destino)))
    # La API va en .py: un error se corrige con un editor de texto en la
    # sala, sin rearmar nada.
    (SALIDA / "api" / ".env").unlink(missing_ok=True)


def dependencias():
    """Lo de api/requirements.txt que la API necesita para correr.

    Sin las de pruebas, y sin extras: uvicorn[standard] suma httptools,
    watchfiles y websockets, tres modulos nativos sin firma que la API no
    usa; psycopg[binary] trae su propia libpq. psycopg puro usa la de pgsql/bin.
    """
    salida = []
    for linea in (RAIZ / "api" / "requirements.txt").read_text(encoding="utf-8").splitlines():
        linea = linea.split("#")[0].strip()
        if not linea:
            continue
        nombre = re.split(r"[\[<>=!~ ]", linea)[0].lower()
        if nombre in SOLO_PRUEBAS:
            continue
        salida.append(re.sub(r"\[[^\]]*\]", "", linea))
    return salida


def preparar_python():
    """Copia el Python oficial con el que corre esto y le instala la API.

    Es el de python.org instalado en el PC que arma la copia: python.exe, sus
    DLL y los modulos nativos de la biblioteca estandar vienen firmados por la
    Python Software Foundation. Una instalacion de Python es reubicable:
    python.exe encuentra Lib/ junto a si mismo, sin registro de Windows.
    """
    base = Path(sys.base_prefix)
    if os.name != "nt" or platform.architecture()[0] != "64bit":
        raise SystemExit("La copia portable se arma con el Python de Windows de 64 bits.")
    if not (base / "python.exe").exists() or not (base / "Lib" / "os.py").exists():
        raise SystemExit("No encuentro una instalacion normal de Python en %s.\n"
                         "Correr esto con el Python de python.org, no con el de la tienda "
                         "ni dentro de un entorno conda." % base)
    if PYTHON.exists():
        shutil.rmtree(PYTHON)
    PYTHON.mkdir(parents=True)
    for patron in ("python.exe", "pythonw.exe", "python3*.dll", "vcruntime*.dll", "LICENSE.txt"):
        for f in base.glob(patron):
            shutil.copy2(f, PYTHON / f.name)
    # Sin tkinter (interfaz grafica), ni pruebas, ni lo instalado en el PC.
    shutil.copytree(base / "DLLs", PYTHON / "DLLs",
                    ignore=shutil.ignore_patterns("_tkinter*", "tcl*", "tk*", "*.pdb"))
    shutil.copytree(base / "Lib", PYTHON / "Lib",
                    ignore=shutil.ignore_patterns("site-packages", "test", "tests", "idlelib",
                                                  "tkinter", "turtledemo", "ensurepip",
                                                  "__pycache__", "*.pyc"))
    sitio = PYTHON / "Lib" / "site-packages"
    sitio.mkdir()
    paquetes = dependencias()
    print("  Python %s (%s), %.0f MB" % (platform.python_version(), base, pesa(PYTHON)))
    print("  instalando: %s" % ", ".join(paquetes))
    correr([sys.executable, "-m", "pip", "install", "-q", "--disable-pip-version-check",
            "--no-warn-script-location", "--only-binary=:all:",
            "--target", str(sitio)] + paquetes)
    print("  -> %d archivos, %.0f MB" % (contar(PYTHON), pesa(PYTHON)))


CMD = """@echo off
rem TerraFoco - copia portable: base de datos, API y visor en este computador.
title TerraFoco
cd /d "%~dp0"
"%~dp0python\\python.exe" -E -s "%~dp0lanzador\\lanzador_portable.py"
if errorlevel 1 pause
"""


def instalar_lanzador():
    if LANZADOR.exists():
        shutil.rmtree(LANZADOR)
    LANZADOR.mkdir(parents=True)
    for nombre in MODULOS_LANZADOR:
        shutil.copy2(RAIZ / "herramientas" / nombre, LANZADOR / nombre)
    # CRLF: es un archivo por lotes de Windows.
    (SALIDA / "TerraFoco.cmd").write_bytes(CMD.replace("\n", "\r\n").encode("ascii"))
    # El .exe de las copias anteriores: Windows lo bloquea y confunde.
    (SALIDA / "TerraFoco.exe").unlink(missing_ok=True)
    print("  TerraFoco.cmd + lanzador/ (%s)" % ", ".join(MODULOS_LANZADOR))


LEEME = """TerraFoco - copia portable
==========================

La demo sin Docker y sin instalar nada: PostgreSQL + PostGIS con los datos
reales van adentro de esta carpeta.

Los mapas si necesitan internet: MapLibre y el mapa base se cargan de sus
servidores. Sin conexion se ve todo menos el mapa; la base, la API, las
tablas y el panel de Fuentes funcionan igual.

COMO SE USA
  1. Copiar la carpeta TerraFoco completa al escritorio o a un pendrive.
  2. Doble clic en TerraFoco.cmd.
  3. Se abre el navegador solo. Para cerrar, cerrar la ventana negra.

  Si la carpeta vino en un zip bajado de internet, Windows puede mostrar
  "Windows protegio tu PC" al abrir TerraFoco.cmd: Mas informacion ->
  Ejecutar de todas formas.

  Si la carpeta no trae base/ (o trae una de otra version de los datos), el
  primer arranque la crea desde datos/terrafoco.sql.gz: uno a dos minutos,
  una sola vez. Conviene abrirlo una vez antes de la presentacion.

QUE LLEVA ADENTRO
  python/      Python 3 oficial (firmado) con las librerias de la API
  lanzador/    el programa que abre todo (lo usa TerraFoco.cmd)
  pgsql/       PostgreSQL 16 + PostGIS 3.4, los binarios oficiales
  datos/       el volcado de la base con los datos reales
  base/        la base ya cargada (se crea sola si falta)
  api/         la API REST, en .py editable
  prototipo/   el visor

  Los datos son los mismos que en Codespaces, en un PostGIS de verdad.
  El panel de Fuentes escribe en la base: cambiar el estado de una fuente
  guarda y se puede comprobar con psql.

SI ALGO FALLA
  "No se puede escribir": la carpeta esta en un disco bloqueado. Copiarla
  al escritorio.
  "No puede correr como administrador": abrirlo con doble clic normal, sin
  "Ejecutar como administrador". PostgreSQL rechaza correr elevado.
  "Windows no deja ejecutar PostgreSQL": ese computador tiene activo el
  Control inteligente de aplicaciones, que bloquea los programas sin firma
  y no ofrece "ejecutar de todas formas". Usar otro computador o la demo
  en Codespaces.
  Cualquier otra cosa: postgres.log, junto al .exe.

VER LA BASE DURANTE LA PRESENTACION
  Abrir otra ventana de simbolo del sistema en esta carpeta y correr la
  linea de psql que el lanzador imprime al arrancar. Sirve para mostrar
  \\dn, \\dt territorio.* y las consultas de la guia.
"""


def main():
    p = argparse.ArgumentParser(description="Arma la copia portable de TerraFoco")
    p.add_argument("--solo-lanzador", "--solo-exe", dest="solo_lanzador", action="store_true",
                   help="rearmar API, visor, Python y lanzador (sin tocar la base)")
    p.add_argument("--solo-datos", action="store_true", help="recargar solo la base")
    args = p.parse_args()

    inicio = time.time()
    if args.solo_lanzador:
        # Tambien copia api/ y prototipo/: son la aplicacion, igual que el
        # lanzador, y separarlos deja un lanzador nuevo contra un visor viejo,
        # que es la clase de incoherencia que aparece en la sala.
        paso("1/3", "Copiando la API y el visor")
        copiar_aplicacion()
        paso("2/3", "Python y librerias de la API")
        preparar_python()
        paso("3/3", "Lanzador")
        instalar_lanzador()
    elif args.solo_datos:
        paso("1/1", "Recargando la base")
        cargar_datos()
    else:
        paso("1/6", "Descargando binarios")
        descargar()
        paso("2/6", "Extrayendo PostgreSQL y PostGIS")
        extraer_binarios()
        paso("3/6", "Volcando los datos y armando la base")
        cargar_datos()
        paso("4/6", "Copiando la API y el visor")
        copiar_aplicacion()
        paso("5/6", "Python y librerias de la API")
        preparar_python()
        paso("6/6", "Lanzador")
        instalar_lanzador()

    (SALIDA / "LEEME.txt").write_text(LEEME, encoding="utf-8")
    print("")
    print("=" * 60)
    print("Listo en %.0f s: %s" % (time.time() - inicio, SALIDA))
    print("Pesa %.0f MB" % pesa(SALIDA))
    print("=" * 60)


if __name__ == "__main__":
    sys.exit(main())
