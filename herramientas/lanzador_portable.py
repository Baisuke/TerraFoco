# -*- coding: utf-8 -*-
"""
Lanzador de la copia portable de TerraFoco.

Levanta los tres procesos que la demo necesita —PostgreSQL, la API y el
visor— y abre el navegador. Al cerrarse, apaga PostgreSQL limpio.

Es el respaldo de la demo en Codespaces, no su reemplazo: sirve cuando
GitHub no esta disponible o no hay con que entrar. Los datos son los
mismos, en un PostgreSQL + PostGIS de verdad, y la escritura del panel de
fuentes funciona igual.

Los mapas necesitan internet: MapLibre y el mapa base se cargan de sus
servidores. Todo lo demas corre local.

Se compila a TerraFoco.exe con herramientas/empaquetar_portable.py. Corriendo
desde el repositorio hace exactamente lo mismo, contra dist/TerraFoco-portable:

    python herramientas/lanzador_portable.py
"""
import atexit
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import base_portable

PUERTO_BD_PREFERIDO = 55432      # no 5432: ahi puede haber un PostgreSQL instalado
USUARIO = "terrafoco"
BASE_DATOS = "terrafoco"


# ---------------------------------------------------------------------------
# Donde esta todo
# ---------------------------------------------------------------------------

def raiz():
    """La carpeta portable.

    Congelado, es la del .exe. Desde el repositorio, dist/TerraFoco-portable,
    para poder probar el lanzador sin recompilar en cada cambio.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent / "dist" / "TerraFoco-portable"


RAIZ = raiz()
PGSQL = RAIZ / "pgsql"
CLUSTER = RAIZ / "base"
CLUSTER_NUEVO = RAIZ / "base.nuevo"
DATOS = RAIZ / "datos"
VOLCADO = DATOS / "terrafoco.sql.gz"
PROTOTIPO = RAIZ / "prototipo"
API = RAIZ / "api"
BITACORA = RAIZ / "postgres.log"


def exe(nombre):
    return str(PGSQL / "bin" / (nombre + ".exe"))


# ---------------------------------------------------------------------------
# Comprobaciones previas
#
# Cada una corresponde a una forma concreta en que esto se cae en un
# computador prestado. Vale mas un mensaje claro aqui que un traceback.
# ---------------------------------------------------------------------------

def es_administrador():
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def comprobar():
    faltan = [str(d.name) for d in (PGSQL, PROTOTIPO, API) if not d.exists()]
    # La base puede faltar si viene el volcado: se crea en el primer arranque.
    if not CLUSTER.exists() and not VOLCADO.exists():
        faltan.append("base (o datos/terrafoco.sql.gz)")
    if faltan:
        raise SystemExit(
            "Faltan carpetas de la copia portable: %s\n"
            "El .exe tiene que quedar DENTRO de la carpeta TerraFoco, junto a\n"
            "pgsql, datos, api y prototipo. Copiar el .exe solo no funciona."
            % ", ".join(faltan))

    # PostgreSQL se niega a arrancar con privilegios de administrador, a
    # proposito: un servidor de base de datos no deberia correr elevado.
    if es_administrador():
        raise SystemExit(
            "Esto no puede correr como administrador: PostgreSQL lo rechaza.\n"
            "Cerrar y abrir TerraFoco.exe con doble clic normal.")

    # El cluster necesita escribir. En un pendrive esta bien; en Archivos de
    # programa o en un disco bloqueado, no.
    try:
        prueba = (CLUSTER if CLUSTER.exists() else RAIZ) / ".escritura"
        prueba.write_text("x", encoding="utf-8")
        prueba.unlink()
    except OSError:
        raise SystemExit(
            "No se puede escribir en la carpeta TerraFoco.\n"
            "PostgreSQL necesita permiso de escritura. Copiar la carpeta\n"
            "TerraFoco al escritorio o a un pendrive y abrirla desde ahi.")

    # Con el Control inteligente de aplicaciones activo, Windows no carga los
    # binarios sin firma reconocida y postgres.exe muere sin decir nada. Mejor
    # saberlo aqui que leer "PostgreSQL no arranco" con el log vacio.
    if not base_portable.postgres_corre(exe):
        raise SystemExit(
            "Windows no deja ejecutar PostgreSQL en este computador.\n"
            "Suele ser el Control inteligente de aplicaciones (Seguridad de\n"
            "Windows -> Control de aplicaciones y del explorador), que bloquea\n"
            "los programas sin firma. Usar otro computador o la demo en\n"
            "Codespaces.")


def preparar_base(puerto):
    """Crea base/ desde el volcado si falta o es de otro volcado.

    Pasa una sola vez por carpeta: la base queda marcada con la version del
    volcado y los arranques siguientes la usan directo.
    """
    if base_portable.al_dia(CLUSTER, DATOS):
        return
    print("[0/3] Creando la base desde datos/%s." % VOLCADO.name)
    print("      Es solo la primera vez: uno a dos minutos.")
    base_portable.construir(exe, CLUSTER_NUEVO, VOLCADO, puerto, BITACORA,
                            **sin_consola())
    base_portable.reemplazar(CLUSTER_NUEVO, CLUSTER)
    print("      base lista.")


def alguien_escucha(puerto):
    """Si ya hay un servidor respondiendo en ese puerto de este computador."""
    s = socket.socket()
    s.settimeout(0.3)
    try:
        s.connect(("127.0.0.1", puerto))
        return True
    except OSError:
        return False
    finally:
        s.close()


def puerto_libre(preferido):
    """El preferido si esta libre; si no, cualquiera que el sistema de.

    Probar solo con bind no basta en Windows: enlazar 127.0.0.1:8000 funciona
    aunque otro proceso escuche en 0.0.0.0:8000 —Docker, un servidor de
    desarrollo—, y desde ese momento localhost:8000 le responde al portable y
    no al otro. Por eso primero se pregunta si alguien contesta ahi.
    """
    for puerto in (preferido, 0):
        if puerto and alguien_escucha(puerto):
            continue
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", puerto))
            return s.getsockname()[1]
        except OSError:
            continue
        finally:
            s.close()
    raise SystemExit("No hay puertos libres en este computador.")


# ---------------------------------------------------------------------------
# PostgreSQL
# ---------------------------------------------------------------------------

def sin_consola():
    """Evita que cada proceso hijo abra su propia ventana negra."""
    if os.name != "nt":
        return {}
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return {"startupinfo": si, "creationflags": subprocess.CREATE_NO_WINDOW}


def _sin_entrada(kw):
    """stdin cerrado: pg_ctl no lee nada y heredar una consola a medio cerrar
    lo deja esperando."""
    kw.setdefault("stdin", subprocess.DEVNULL)
    return kw


def detener_postgres():
    subprocess.run([exe("pg_ctl"), "-D", str(CLUSTER), "-m", "fast", "stop"],
                   capture_output=True, **_sin_entrada(sin_consola()))


def arrancar_postgres(puerto):
    # Un cierre anterior a lo bruto —cerrar la ventana con la X— deja el
    # postmaster.pid y el siguiente arranque falla. Se intenta detener antes.
    if (CLUSTER / "postmaster.pid").exists():
        print("  (hay un arranque anterior sin cerrar; deteniendolo)")
        detener_postgres()
        time.sleep(1)

    # Sin capture_output, y esto NO es un descuido: `pg_ctl start` deja a
    # postgres.exe corriendo como nieto, y el nieto hereda las tuberias de
    # salida. pg_ctl termina, pero el lanzador se queda esperando que cierren
    # y no cierran hasta que postgres muera. El arranque nunca terminaria.
    # Lo que haya que leer esta en postgres.log.
    r = subprocess.run(
        [exe("pg_ctl"), "-D", str(CLUSTER), "-l", str(BITACORA), "-w", "-t", "60",
         "-o", "-p %d -c listen_addresses=127.0.0.1" % puerto, "start"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        **_sin_entrada(sin_consola()))
    if r.returncode != 0:
        cola = ""
        if BITACORA.exists():
            cola = "\n".join(BITACORA.read_text(
                encoding="utf-8", errors="replace").splitlines()[-12:])
        raise SystemExit("PostgreSQL no arranco.\n%s" % cola)
    atexit.register(detener_postgres)


def esperar_base(puerto, segundos=60):
    limite = time.time() + segundos
    while time.time() < limite:
        r = subprocess.run([exe("pg_isready"), "-h", "127.0.0.1",
                            "-p", str(puerto), "-d", BASE_DATOS, "-U", USUARIO],
                           capture_output=True, **_sin_entrada(sin_consola()))
        if r.returncode == 0:
            return
        time.sleep(0.5)
    raise SystemExit("La base no respondio en %d segundos." % segundos)


# ---------------------------------------------------------------------------
# API y visor
# ---------------------------------------------------------------------------

def arrancar_api(puerto, bd_url):
    """La API en un hilo, dentro de este mismo proceso.

    Se importa DESPUES de fijar BD_URL: api/config.py lo lee al importarse, y
    al reves apuntaria al PostgreSQL de desarrollo que aqui no existe.
    """
    os.environ["BD_URL"] = bd_url
    # La escritura exige clave de administracion (api/seguridad.py) y sin
    # ella responde 503: el panel de fuentes quedaria de solo lectura, que es
    # justo lo que la demo tiene que mostrar funcionando. Se genera una por
    # sesion y se imprime en esta ventana, para pegarla en el dialogo. Vale
    # mientras la ventana este abierta y la base solo escucha en 127.0.0.1.
    if len(os.environ.get("TERRAFOCO_CLAVE_ADMIN", "")) < 24:
        import secrets
        os.environ["TERRAFOCO_CLAVE_ADMIN"] = secrets.token_urlsafe(24)
    sys.path.insert(0, str(API))
    import uvicorn
    from main import app

    servidor = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=puerto, log_level="warning"))
    threading.Thread(target=servidor.run, daemon=True).start()
    return os.environ["TERRAFOCO_CLAVE_ADMIN"]


def arrancar_prototipo(puerto):
    import functools
    import http.server

    from rangos import ConRangos

    # Con rangos: sin ellos las teselas PMTiles no cargan (ver rangos.py).
    class SinCache(ConRangos):
        def end_headers(self):
            self.send_header("Cache-Control", "no-store, must-revalidate")
            super().end_headers()

        def log_message(self, *_):
            pass

        def handle_error(self, *_):
            # El navegador corta conexiones a media descarga todo el tiempo:
            # cambiar de comuna aborta los PNG de la anterior. Por omision eso
            # escupe un traceback completo, y en la ventana de la demo parece
            # que algo se rompio. No se rompio nada.
            pass

    # Con hilos y no el TCPServer de un hilo: el visor pide el mapa, seis
    # capas y decenas de PNG a la vez, y servidos de a uno la pagina tarda en
    # aparecer justo cuando hay alguien mirando.
    class Servidor(http.server.ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    manejador = functools.partial(SinCache, directory=str(PROTOTIPO))
    servidor = Servidor(("127.0.0.1", puerto), manejador)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    return servidor


def esperar_api(puerto, segundos=30):
    limite = time.time() + segundos
    while time.time() < limite:
        s = socket.socket()
        s.settimeout(0.5)
        try:
            s.connect(("127.0.0.1", puerto))
            return True
        except OSError:
            time.sleep(0.3)
        finally:
            s.close()
    return False


# ---------------------------------------------------------------------------

def main():
    print("TerraFoco - copia portable")
    print("=" * 56)
    comprobar()

    puerto_bd = puerto_libre(PUERTO_BD_PREFERIDO)
    puerto_api = puerto_libre(8000)
    puerto_web = puerto_libre(8081)

    preparar_base(puerto_bd)

    print("[1/3] PostgreSQL + PostGIS (puerto %d)..." % puerto_bd)
    arrancar_postgres(puerto_bd)
    esperar_base(puerto_bd)

    bd_url = "postgresql://%s@127.0.0.1:%d/%s" % (USUARIO, puerto_bd, BASE_DATOS)
    print("[2/3] API (puerto %d)..." % puerto_api)
    clave = arrancar_api(puerto_api, bd_url)
    if not esperar_api(puerto_api):
        raise SystemExit("La API no respondio.")

    print("[3/3] Visor (puerto %d)..." % puerto_web)
    arrancar_prototipo(puerto_web)

    # El ?api= explicito no es un adorno: GT_API_BASE se guarda en
    # localStorage, asi que un navegador que abrio antes la demo en Codespaces
    # seguiria apuntando a ese Codespace, que ya no existe. Pasarlo lo pisa.
    url = ("http://localhost:%d/index.html?api=http://localhost:%d"
           % (puerto_web, puerto_api))

    print("")
    print("  Visor:  http://localhost:%d" % puerto_web)
    print("  API:    http://localhost:%d/docs" % puerto_api)
    print("  Base:   %s" % bd_url)
    print("")
    print("  Clave para cambiar el estado de una fuente (se pega en el")
    print("  dialogo de Fuentes de datos; cambia cada vez que se abre):")
    print("    %s" % clave)
    print("")
    print("  Consola SQL, en otra ventana:")
    print("    pgsql\\bin\\psql.exe -h 127.0.0.1 -p %d -U %s -d %s"
          % (puerto_bd, USUARIO, BASE_DATOS))
    print("")
    print("  Cerrar esta ventana apaga todo.")
    print("=" * 56)

    webbrowser.open(url)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        print("")
        print("Apagando PostgreSQL...")
        detener_postgres()


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        if e.code not in (0, None):
            print("")
            print(e.code)
            print("")
            input("Enter para cerrar...")
        raise
