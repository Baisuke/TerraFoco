# -*- coding: utf-8 -*-
"""
Eventos históricos de inundación desde DesInventar.

DesInventar (UNDRR) es la única fuente pública y estructurada de eventos de
desastre en Chile: 13.534 fichas de 1970 a 2014 alimentadas por ONEMI, con
comuna y fecha. SENAPRED no publica un registro descargable y datos.gob.cl no
tiene nada de ONEMI sobre eventos —se buscó—. El export completo del país es
un ZIP de 3 MB con un XML de 98 MB.

Los eventos sirven para VALIDAR el índice de susceptibilidad, no para
entrenarlo: son etiquetas a nivel de comuna, y con eso la muestra son 33.
Además vienen de prensa (El Mercurio, sobre todo), así que sobrerrepresentan
las comunas pobladas. Ambas cosas se declaran donde se usan.

    python -m ingesta.desinventar               # descarga, filtra, carga
    python -m ingesta.desinventar --simular     # descarga, filtra, resume
    python -m ingesta.desinventar --zip ruta    # usar un export ya bajado

La región se filtra por el código INE (`territorio.region.codigo`), que
DesInventar usa tal cual en su nivel 0. Las comunas se emparejan por nombre
normalizado: DesInventar numera las provincias distinto que el INE, así que
sus códigos de nivel 2 no sirven directo. El nombre original se guarda para
poder auditar cada emparejamiento.
"""
import argparse
import io
import os
import re
import sys
import unicodedata
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

import config
from bd import Bitacora, conexion, obtener_region

URL = "https://www.desinventar.net/DesInventar/download/DI_export_chl.zip"
RUTA_ZIP = os.path.join(config.DIR_DATOS, "inundacion", "DI_export_chl.zip")

# Tipos de evento de DesInventar que cuentan como inundación para el índice.
# "Lluvias" y "Tempestad" quedan fuera a propósito: son la causa, no el
# efecto, y muchas veces no inundaron nada.
TIPOS = {"inundacion": "Inundacion", "aluvion": "Aluvion"}

# Tipografías conocidas de la fuente. Se corrigen aquí, con nombre y apellido,
# en vez de con un emparejamiento difuso que acierte por casualidad.
ALIAS = {
    "donigue": "donihue",
}


def normalizar(texto):
    t = unicodedata.normalize("NFD", texto or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", t).strip().lower()


# --------------------------------------------------------------------------
# Descarga y lectura
# --------------------------------------------------------------------------

def descargar(destino=RUTA_ZIP):
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    print("[desinventar] descargando %s" % URL)
    with urllib.request.urlopen(URL, timeout=300) as r, open(destino, "wb") as f:
        f.write(r.read())
    print("[desinventar] -> %s (%.1f MB)" % (destino, os.path.getsize(destino) / 1e6))
    return destino


def fichas(ruta_zip):
    """Itera las fichas del XML sin cargarlo entero: son 98 MB."""
    with zipfile.ZipFile(ruta_zip) as z:
        nombre = next(n for n in z.namelist() if n.endswith(".xml"))
        with z.open(nombre) as f:
            en_fichas = False
            for evento, el in ET.iterparse(f, events=("start", "end")):
                if evento == "start" and el.tag == "fichas":
                    en_fichas = True
                elif evento == "end" and el.tag == "fichas":
                    break
                elif en_fichas and evento == "end" and el.tag == "TR":
                    yield {h.tag: (h.text or "").strip() for h in el}
                    el.clear()


def entero(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def filtrar(ruta_zip, codigo_region):
    """Fichas de inundación y aluvión de la región, ya normalizadas."""
    salida = []
    for f in fichas(ruta_zip):
        if f.get("level0") != codigo_region:
            continue
        tipo = TIPOS.get(normalizar(f.get("evento")))
        if not tipo:
            continue
        salida.append({
            "serial": f.get("serial"),
            "tipo": tipo,
            "causa": f.get("causa") or None,
            "lugar": (f.get("lugar") or None),
            "comuna_texto": f.get("name2") or None,
            "anio": entero(f.get("fechano")),
            "mes": entero(f.get("fechames")),
            "dia": entero(f.get("fechadia")),
            "muertos": entero(f.get("muertos")),
            "afectados": entero(f.get("afectados")),
            "damnificados": entero(f.get("damnificados")),
            "evacuados": entero(f.get("evacuados")),
            "vivdest": entero(f.get("vivdest")),
            "vivafec": entero(f.get("vivafec")),
            "fuente": (f.get("fuentes") or None),
        })
    return salida


# --------------------------------------------------------------------------
# Emparejamiento y carga
# --------------------------------------------------------------------------

def comunas_de(region):
    with conexion() as con:
        filas = con.execute(
            "SELECT id_comuna, nombre FROM territorio.comuna WHERE id_region = %s",
            (region.id_region,)).fetchall()
    return {normalizar(n): i for i, n in filas}


def emparejar(eventos, por_nombre):
    sin_par = set()
    for e in eventos:
        clave = normalizar(e["comuna_texto"])
        clave = ALIAS.get(clave, clave)
        e["id_comuna"] = por_nombre.get(clave)
        if e["comuna_texto"] and e["id_comuna"] is None:
            sin_par.add(e["comuna_texto"])
    return sin_par


SQL_INSERTAR = """
INSERT INTO indicadores.evento_inundacion
    (id_region, id_comuna, comuna_texto, tipo, causa, lugar, anio, mes, dia,
     muertos, afectados, damnificados, evacuados, viviendas_destruidas,
     viviendas_afectadas, fuente_cita, serial_fuente)
VALUES
    (%(id_region)s, %(id_comuna)s, %(comuna_texto)s, %(tipo)s, %(causa)s,
     %(lugar)s, %(anio)s, %(mes)s, %(dia)s, %(muertos)s, %(afectados)s,
     %(damnificados)s, %(evacuados)s, %(vivdest)s, %(vivafec)s, %(fuente)s,
     %(serial)s)
ON CONFLICT (serial_fuente) DO NOTHING
"""


def cargar(region, eventos):
    n = 0
    with conexion() as con:
        for e in eventos:
            if e["anio"] is None:
                continue
            fila = dict(e, id_region=region.id_region,
                        lugar=(e["lugar"] or "")[:250] or None,
                        fuente=(e["fuente"] or "")[:250] or None)
            con.execute(SQL_INSERTAR, fila)
            n += 1
    return n


def resumen(eventos, sin_par):
    from collections import Counter
    print("[desinventar] %d eventos de %s" % (len(eventos), " y ".join(TIPOS.values())))
    anios = Counter(e["anio"] for e in eventos)
    print("[desinventar] por año: %s"
          % ", ".join("%s:%d" % (a, c) for a, c in sorted(anios.items()) if a))
    comunas = Counter(e["comuna_texto"] for e in eventos if e["comuna_texto"])
    print("[desinventar] por comuna: %s"
          % ", ".join("%s %d" % t for t in comunas.most_common(12)))
    print("[desinventar] con comuna: %d · sin comuna: %d"
          % (sum(1 for e in eventos if e["comuna_texto"]),
             sum(1 for e in eventos if not e["comuna_texto"])))
    if sin_par:
        print("[desinventar] AVISO: comunas sin par en la base: %s" % sorted(sin_par))
        print("               Agregar el alias en ALIAS si es una tipografía.")


# --------------------------------------------------------------------------
# Punto de entrada
# --------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Eventos de inundación desde DesInventar")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--zip", default=None, help="export ya descargado; si no, se baja")
    p.add_argument("--simular", action="store_true")
    args = p.parse_args()

    region = obtener_region(args.region)
    print("[desinventar] %s (código INE %s)" % (region.nombre, region.codigo))

    with Bitacora("Eventos históricos DesInventar — %s" % region.nombre, fuente="desinventar") as b:
        ruta = args.zip or (RUTA_ZIP if os.path.exists(RUTA_ZIP) else descargar())
        eventos = filtrar(ruta, region.codigo)
        sin_par = emparejar(eventos, comunas_de(region))
        resumen(eventos, sin_par)

        if args.simular:
            print("\n[desinventar] --simular: no se escribió nada.")
            b.simulada = True
            b.registros = 0
            return 0

        b.registros = cargar(region, eventos)
        print("\n[desinventar] %d eventos cargados en indicadores.evento_inundacion"
              % b.registros)
    return 0


if __name__ == "__main__":
    sys.exit(main())
