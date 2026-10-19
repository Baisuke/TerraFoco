# -*- coding: utf-8 -*-
"""
Demostración del ciclo escritura -> lectura contra PostGIS.

Sirve como evidencia reproducible: se ejecuta un comando, queda la salida, y
quien corrija puede repetirla. Muestra las dos vías por las que el sistema
escribe en la base, que son distintas a propósito:

  · La API escribe el catálogo de fuentes (UC-10). Es administración: la
    decide una persona, y por eso vive detrás de HTTP.
  · El motor escribe los indicadores. Es cálculo por lotes, y por eso NO vive
    detrás de HTTP: una ingesta de imágenes no puede bloquear al visor.

Uso:
    python herramientas/demostracion.py             ciclo completo
    python herramientas/demostracion.py --simular   sin escribir indicadores
    python herramientas/demostracion.py --sin-motor solo la API

Requisitos: `docker compose up -d bd api` levantado.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

API = "http://localhost:8000"


def clave_admin():
    """La clave de administración (RF-31), para las escrituras por la API.

    Primero del entorno y si no del .env, del que se lee SOLO esa línea.
    Nunca se imprime.
    """
    clave = os.environ.get("TERRAFOCO_CLAVE_ADMIN", "")
    if clave:
        return clave
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    try:
        with open(ruta, encoding="utf-8") as f:
            for linea in f:
                if linea.startswith("TERRAFOCO_CLAVE_ADMIN="):
                    return linea.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""
CONTENEDOR_BD = "terrafoco-bd"

# La demostracion escribe sobre una fuente propia y no sobre las reales.
#
# Antes sembraba el catalogo y despues marcaba CIREN como 'ok' en cada corrida.
# Desde la migracion 012 el catalogo viene sembrado con estados que decide una
# persona, y cambiarle el estado a CIREN para demostrar un UPDATE pisaba esa
# decision. Esta fuente existe solo para esto y lo dice en su nota.
DEMO = {
    "codigo": "demostracion",
    "nombre": "Fuente de demostración",
    "organismo": "TerraFoco",
    "tipo": "prueba",
    "nota": "Creada por herramientas/demostracion.py para mostrar la "
            "escritura. No es una fuente de datos real.",
}

# Lo que se mide antes y después. La bitácora va aparte porque interesa su
# contenido, no su tamaño.
TABLAS = [
    ("operacion.fuente", "catálogo de fuentes"),
    ("operacion.ejecucion_proceso", "bitácora de ejecuciones"),
    ("indicadores.factor", "factores de RUSLE"),
    ("indicadores.erosion", "erosión calculada"),
    ("programas.ejecucion", "ejecución del SIRSD-S"),
    ("territorio.comuna", "comunas"),
]


# ------------------------------------------------------------------ utilidades

def titulo(n, texto):
    print("\n" + "=" * 74)
    print("%d. %s" % (n, texto.upper()))
    print("=" * 74)


def psql(sql):
    """Consulta directa, para verificar lo que la aplicación dice haber escrito.

    Se usa solo para comprobar, nunca para escribir: la escritura tiene que
    venir del software, o la demostración no demuestra nada.
    """
    salida = subprocess.run(
        ["docker", "exec", CONTENEDOR_BD, "psql", "-U", "terrafoco",
         "-d", "terrafoco", "-tAc", sql],
        capture_output=True, text=True, encoding="utf-8")
    if salida.returncode:
        raise SystemExit("psql falló: %s" % salida.stderr.strip())
    return salida.stdout.strip()


def pedir(metodo, ruta, cuerpo=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    encabezados = {"Content-Type": "application/json"}
    if metodo != "GET":
        encabezados["Authorization"] = "Bearer " + clave_admin()
    pet = urllib.request.Request(
        API + ruta, data=datos, method=metodo, headers=encabezados)
    try:
        with urllib.request.urlopen(pet, timeout=20) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")
    except urllib.error.URLError as e:
        raise SystemExit("La API no responde en %s (%s).\n"
                         "Levántala con: docker compose up -d bd api" % (API, e))


def conteos():
    return {t: int(psql("SELECT count(*) FROM %s" % t)) for t, _ in TABLAS}


def mostrar_conteos(antes, despues=None):
    print("  %-30s %-28s %8s%s" % ("tabla", "qué contiene", "filas",
                                   "   cambio" if despues else ""))
    print("  " + "-" * 72)
    for tabla, glosa in TABLAS:
        # Con dos instantáneas se muestra el conteo FINAL y su variación: poner
        # el inicial al lado del delta hacía que no cuadrara con la base.
        actual = despues[tabla] if despues else antes[tabla]
        linea = "  %-30s %-28s %8d" % (tabla, glosa, actual)
        if despues:
            delta = despues[tabla] - antes[tabla]
            linea += "   %+d" % delta if delta else "    ="
        print(linea)


# --------------------------------------------------------------------- pasos

def comprobar():
    estado, cuerpo = pedir("GET", "/salud")
    if estado != 200 or cuerpo.get("base_de_datos") != "ok":
        raise SystemExit("La API responde pero la base no: %s" % cuerpo)
    print("  API .............. ok")
    print("  base de datos .... ok  (PostGIS %s)" % cuerpo.get("postgis"))


def escribir_por_api():
    """UC-10: alta y cambio de estado. INSERT y UPDATE vía HTTP."""
    _, existentes = pedir("GET", "/fuentes")
    previa = next((f for f in existentes if f["codigo"] == DEMO["codigo"]), None)

    if previa is None:
        estado, cuerpo = pedir("POST", "/fuentes", DEMO)
        if estado != 201:
            raise SystemExit("POST /fuentes devolvió %s: %s" % (estado, cuerpo))
        objetivo = cuerpo
        print("  POST   /fuentes            201  id=%d  codigo=%s"
              % (objetivo["id_fuente"], objetivo["codigo"]))
    else:
        objetivo = previa
        print("  (la fuente de demostración ya existía de una corrida anterior,"
              " id=%d)" % objetivo["id_fuente"])

    # Se alterna el estado en cada corrida para que el UPDATE cambie algo de
    # verdad y no reescriba el mismo valor.
    nuevo = "pendiente" if objetivo["estado"] == "ok" else "ok"
    estado, cuerpo = pedir("PATCH", "/fuentes/%d" % objetivo["id_fuente"],
                           {"estado": nuevo, "marcar_carga": True})
    if estado != 200:
        raise SystemExit("PATCH devolvió %s: %s" % (estado, cuerpo))
    print("  PATCH  /fuentes/%-2d          200  estado %s -> %s  ultima_carga=%s"
          % (cuerpo["id_fuente"], objetivo["estado"], cuerpo["estado"],
             cuerpo["ultima_carga"][:19]))

    print("\n  Rechazo de datos inválidos, que también es parte del contrato:")
    estado, _ = pedir("PATCH", "/fuentes/%d" % objetivo["id_fuente"],
                      {"estado": "inventado"})
    print("  PATCH  estado='inventado'  %s  (la restricción CHECK de la tabla "
          "está replicada en la API)" % estado)
    estado, _ = pedir("POST", "/fuentes", DEMO)
    print("  POST   código repetido     %s  (un pedido mal hecho es 4xx, "
          "no un error del servidor)" % estado)
    estado, _ = pedir("PATCH", "/fuentes/9999", {"estado": "ok"})
    print("  PATCH  /fuentes/9999       %s" % estado)
    return 1 if previa is None else 0


def escribir_por_motor(simular):
    """El motor recalcula la erosión desde los factores ya almacenados."""
    orden = ["docker", "compose", "run", "--rm", "motor",
             "python", "-m", "calcular"]
    if simular:
        orden.append("--simular")
    print("  $ " + " ".join(orden[4:]))
    salida = subprocess.run(orden, cwd=str(RAIZ), capture_output=True,
                            text=True, encoding="utf-8", errors="replace")
    texto = (salida.stdout or "") + (salida.stderr or "")

    # Docker narra el arranque de los contenedores por stderr. Eso no es
    # salida del programa y en una evidencia solo estorba.
    RUIDO = ("level=warning", "Container terrafoco", "Network terrafoco",
             " Creating", " Created", " Running", " Waiting", " Healthy",
             " Started", " Starting")
    utiles = [l.rstrip() for l in texto.splitlines()
              if l.strip() and not any(r in l for r in RUIDO)]

    # El detalle por comuna son 33 filas: se muestran las primeras y se dice
    # cuántas se omitieron, para que la evidencia quepa en una página.
    TOPE = 16
    for linea in utiles[:TOPE]:
        print("    " + linea[:112])
    if len(utiles) > TOPE:
        print("    ... %d líneas más (la corrida completa las imprime todas)"
              % (len(utiles) - TOPE))
        for linea in utiles[-3:]:
            print("    " + linea[:112])
    if salida.returncode:
        print("\n  El motor terminó con código %d. La escritura por API de "
              "arriba no depende de esto." % salida.returncode)
    return salida.returncode == 0


def leer_por_api():
    for ruta, descripcion in [("/comunas", "comunas del territorio"),
                              ("/pertinencia", "índice por comuna"),
                              ("/fuentes", "catálogo de fuentes")]:
        estado, cuerpo = pedir("GET", ruta)
        print("  GET %-14s %s  %d registros   (%s)"
              % (ruta, estado, len(cuerpo), descripcion))

    _, origenes = pedir("GET", "/pertinencia/origenes")
    for o in origenes:
        print("     origen %-10s %2d comunas, año %s"
              % (o["origen"], o["comunas"], o["anio"]))


def mostrar_bitacora():
    """Las dos escrituras de cada proceso: el INSERT al abrir, el UPDATE al cerrar."""
    filas = psql("""
        SELECT id_proceso, proceso, estado,
               coalesce(registros::text, '-'),
               to_char(inicio, 'DD-MM HH24:MI:SS'),
               coalesce(to_char(fin, 'HH24:MI:SS'), 'sin cerrar')
        FROM   operacion.ejecucion_proceso
        ORDER  BY id_proceso DESC LIMIT 5
    """)
    print("  %-5s %-28s %-9s %9s %-15s %s"
          % ("id", "proceso", "estado", "registros", "inicio", "fin"))
    print("  " + "-" * 82)
    for linea in filas.splitlines():
        if linea.strip():
            print("  %-5s %-28s %-9s %9s %-15s %s"
                  % tuple(x[:28] for x in linea.split("|")))


# ---------------------------------------------------------------------- main

RAIZ = __import__("pathlib").Path(__file__).resolve().parent.parent


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--simular", action="store_true",
                   help="el motor no escribe indicadores")
    p.add_argument("--sin-motor", action="store_true",
                   help="omite el paso del motor")
    args = p.parse_args()

    print("TerraFoco — demostración de escritura y lectura en PostgreSQL/PostGIS")
    print("Repositorio: %s" % RAIZ)

    titulo(1, "comprobaciones previas")
    comprobar()

    titulo(2, "estado inicial de la base")
    antes = conteos()
    mostrar_conteos(antes)

    titulo(3, "escritura desde la API — catálogo de fuentes (UC-10)")
    escribir_por_api()

    if not args.sin_motor:
        titulo(4, "escritura desde el motor — cálculo de erosión")
        escribir_por_motor(args.simular)

    titulo(5, "lectura desde la API")
    leer_por_api()

    titulo(6, "bitácora: cada proceso deja un INSERT y un UPDATE")
    mostrar_bitacora()

    titulo(7, "estado final de la base")
    despues = conteos()
    mostrar_conteos(antes, despues)

    cambiadas = sum(1 for t, _ in TABLAS if despues[t] != antes[t])
    print("\n%d de %d tablas cambiaron durante esta corrida."
          % (cambiadas, len(TABLAS)))
    if not cambiadas:
        print("Ninguna cambió porque el catálogo ya estaba completo"
              + (" y el motor corrió en modo simulación." if args.simular
                 else "."))
        print("Para ver los deltas: vaciar operacion.fuente, o correr sin "
              "--simular.")
    print("Escritura y lectura verificadas contra la base, no contra la "
          "interfaz: los conteos salen de consultas directas a PostgreSQL.")


if __name__ == "__main__":
    sys.exit(main())
