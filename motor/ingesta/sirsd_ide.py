# -*- coding: utf-8 -*-
"""
Ejecución del SIRSD-S desde el servicio ArcGIS de IDE MINAGRI.

Es el eje de inversión del proyecto, y resultó estar público: CIREN publica el
Programa de Recuperación de Suelos Degradados como FeatureServer consultable,
con superficie bonificada y monto por predio.

    esri.ciren.cl/server/rest/services/IDEMINAGRI
        /PROG_RECUPERACION_SUELOS_DEGRA_DESCARGA/FeatureServer

DATOS PERSONALES: NO SE CARGAN
------------------------------
El servicio expone `nom_operad`, el nombre del agricultor, y `rol_4`, el rol de
la propiedad. **Este módulo los descarta explícitamente.** Que la fuente los
publique no obliga a replicarlos: el proyecto declaró ante INDAP que trabaja
solo con agregados comunales, y esa promesa se cumple en el código, no solo en
el correo. Aquí se agrega por comuna antes de escribir nada.

SOBRE `su_uso_agr`
------------------
Trae la superficie de uso agrícola del predio, y es tentador usarla como
denominador del factor P. **No sirve para eso:** solo cubre los predios que
recibieron bonificación, no la superficie agrícola total de la comuna. Usarla
sobreestimaría la fracción intervenida. El denominador correcto viene del
Censo Agropecuario o de la capa de cobertura de la tierra.

Uso:
    python -m ingesta.sirsd_ide --simular
    python -m ingesta.sirsd_ide
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

import config
from bd import Bitacora, conexion, obtener_region
from ingesta.sirsd import normalizar

SERVICIO = ("https://esri.ciren.cl/server/rest/services/IDEMINAGRI"
            "/PROG_RECUPERACION_SUELOS_DEGRA_DESCARGA/FeatureServer")

# Campos que se piden. Se enumeran en vez de usar '*' para dejar por escrito
# que el nombre del operador y el rol de la propiedad NO se traen.
CAMPOS = ("codcom", "comuna", "codreg", "sup_ha", "bon_total",
          "temporada", "concurso", "tip_conc", "admisible")

PAGINA = 1000
REINTENTOS = 3


def _pedir(url, timeout=120):
    ultimo = None
    for intento in range(REINTENTOS):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            ultimo = e
            # El servicio corta conexiones bajo carga; reintentar con espera
            # creciente evita perder una capa completa por un fallo puntual.
            time.sleep(2 * (intento + 1))
    raise ultimo


def capas():
    d = _pedir(SERVICIO + "?f=json")
    return [c["id"] for c in d.get("layers", [])]


def consultar(capa, id_region):
    """Todos los registros de una capa para la región, paginando."""
    filas, desplazamiento = [], 0
    while True:
        params = {
            "f": "json",
            "where": "codreg='%02d'" % id_region,
            "outFields": ",".join(CAMPOS),
            "returnGeometry": "false",
            "resultOffset": desplazamiento,
            "resultRecordCount": PAGINA,
        }
        url = "%s/%d/query?%s" % (SERVICIO, capa, urllib.parse.urlencode(params))
        d = _pedir(url)
        lote = [f["attributes"] for f in d.get("features", [])]
        filas.extend(lote)
        if len(lote) < PAGINA or not d.get("exceededTransferLimit"):
            break
        desplazamiento += PAGINA
    return filas


def catalogo_comunas(con, id_region):
    """Dos formas de emparejar: por codigo INE y por nombre normalizado."""
    filas = con.execute(
        "SELECT id_comuna, nombre FROM territorio.comuna WHERE id_region = %s",
        (id_region,)).fetchall()
    por_codigo = {i: i for i, _ in filas}
    por_nombre = {normalizar(n): i for i, n in filas}
    return por_codigo, por_nombre


def agregar(filas, por_codigo, por_nombre):
    """Suma por comuna y temporada. Devuelve (agregados, rechazos)."""
    agregados, rechazos = {}, []

    for f in filas:
        # Solo lo efectivamente bonificado: las postulaciones no admisibles no
        # son inversion ejecutada y contarlas inflaria la cobertura.
        if str(f.get("admisible") or "").strip().lower().startswith("no"):
            rechazos.append((f, "postulacion no admisible"))
            continue

        id_comuna = None
        codcom = f.get("codcom")
        if codcom:
            try:
                cand = int(str(codcom).lstrip("0") or 0)
                if cand in por_codigo:
                    id_comuna = cand
            except ValueError:
                pass
        if id_comuna is None:
            id_comuna = por_nombre.get(normalizar(f.get("comuna")))
        if id_comuna is None:
            rechazos.append((f, "comuna no encontrada: %r" % f.get("comuna")))
            continue

        sup = f.get("sup_ha")
        monto = f.get("bon_total")
        if sup is None and monto is None:
            rechazos.append((f, "sin superficie ni monto"))
            continue

        anio = int(f.get("temporada") or 0)
        if anio < 1990:
            rechazos.append((f, "temporada invalida: %r" % f.get("temporada")))
            continue

        d = agregados.setdefault((id_comuna, anio),
                                 {"sup": 0.0, "monto": 0.0, "predios": 0})
        d["sup"] += float(sup or 0)
        d["monto"] += float(monto or 0)
        d["predios"] += 1

    return agregados, rechazos


SQL_EJECUCION = """
INSERT INTO programas.ejecucion
    (id_programa, id_comuna, id_practica, anio, superficie_ha, monto_pesos,
     beneficiarios, precision_dato, fuente)
VALUES (%(id_programa)s, %(id_comuna)s, NULL, %(anio)s, %(sup)s, %(monto)s,
        %(predios)s, %(precision)s, 'IDE MINAGRI')
"""

SQL_RECHAZO = """
INSERT INTO programas.ejecucion_rechazada (linea_origen, motivo, archivo)
VALUES (%s, %s, 'IDE MINAGRI FeatureServer')
"""


def main():
    p = argparse.ArgumentParser(
        description="Carga la ejecucion del SIRSD-S desde IDE MINAGRI")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--organismo", default="INDAP", choices=("INDAP", "SAG"))
    p.add_argument("--simular", action="store_true",
                   help="descarga y resume, pero no escribe")
    args = p.parse_args()

    region = obtener_region(args.region)
    ids = capas()
    print("[sirsd-ide] %s — %d capas en el servicio" % (region.nombre, len(ids)))

    filas, sin_respuesta = [], []
    for capa in ids:
        try:
            lote = consultar(capa, args.region)
            filas.extend(lote)
            print("  capa %2d  %5d registros" % (capa, len(lote)))
        except Exception as e:
            print("  capa %2d  FALLO %s" % (capa, type(e).__name__))
            sin_respuesta.append(capa)

    if sin_respuesta:
        print("\n[sirsd-ide] %d capas sin respuesta: %s  (reintentar mas tarde)"
              % (len(sin_respuesta), sin_respuesta))
    if not filas:
        print("[sirsd-ide] no se obtuvo ningun registro.")
        return 1

    with conexion() as con:
        por_codigo, por_nombre = catalogo_comunas(con, args.region)
        fila = con.execute(
            "SELECT id_programa FROM programas.programa "
            "WHERE codigo='SIRSD-S' AND organismo=%s", (args.organismo,)).fetchone()
    if fila is None:
        raise SystemExit("No existe el programa SIRSD-S para %s" % args.organismo)
    id_programa = fila[0]

    agregados, rechazos = agregar(filas, por_codigo, por_nombre)

    print("\n[sirsd-ide] %d predios leidos -> %d filas comuna/temporada"
          % (len(filas), len(agregados)))
    if rechazos:
        motivos = {}
        for _f, m in rechazos:
            motivos[m.split(":")[0]] = motivos.get(m.split(":")[0], 0) + 1
        print("  %d descartados:" % len(rechazos))
        for m, n in sorted(motivos.items(), key=lambda x: -x[1]):
            print("     %-40s %4d" % (m, n))

    con_nombre = {}
    with conexion() as con:
        con_nombre = dict(con.execute(
            "SELECT id_comuna, nombre FROM territorio.comuna WHERE id_region=%s",
            (args.region,)).fetchall())

    print("\n  %-22s %5s %10s %14s %8s" % ("comuna", "anio", "ha", "pesos", "predios"))
    for (id_comuna, anio), d in sorted(agregados.items(),
                                       key=lambda x: -x[1]["sup"]):
        print("  %-22s %5d %10.2f %14.0f %8d"
              % (con_nombre.get(id_comuna, id_comuna)[:22], anio,
                 d["sup"], d["monto"], d["predios"]))

    sin_dato = len(con_nombre) - len({k[0] for k in agregados})
    print("\n  %d de %d comunas con ejecucion; %d sin registros"
          % (len({k[0] for k in agregados}), len(con_nombre), sin_dato))

    if args.simular:
        print("\n[sirsd-ide] --simular: no se escribio nada.")
        return 0

    with Bitacora("Ingesta SIRSD-S (IDE MINAGRI) — %s" % region.nombre, fuente="sirsd_ide") as b:
        with conexion() as con:
            for (id_comuna, anio), d in sorted(agregados.items()):
                con.execute(SQL_EJECUCION, {
                    "id_programa": id_programa, "id_comuna": id_comuna,
                    "anio": anio, "sup": round(d["sup"], 2),
                    "monto": round(d["monto"]),
                    "predios": d["predios"],
                    # Trae superficie y monto: es dato completo, no reducido.
                    "precision": "completa"})
            for f, motivo in rechazos:
                con.execute(SQL_RECHAZO,
                            (json.dumps(f, ensure_ascii=False, default=str), motivo))
        b.registros = len(agregados)

    print("\n[sirsd-ide] %d filas cargadas, %d en ejecucion_rechazada"
          % (len(agregados), len(rechazos)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
