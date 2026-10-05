# -*- coding: utf-8 -*-
"""
Población y viviendas por manzana, Censo 2017.

El visor de inundaciones dice qué parte de una comuna supera el umbral de
riesgo. Con esto dice también CUÁNTA GENTE vive ahí: cruza cada manzana con
la grilla de 30 m y reparte sus personas entre sus celdas.

Fuente: el Censo 2017 del INE por manzana, en la copia nacional del Centro de
Datos del Observatorio de Ciudades UC (el mismo servicio que el Límite Urbano
Censal). La manzana es la unidad censal URBANA: la población rural no está.
En O'Higgins son 7.762 manzanas con unas 706 mil personas, de 914 mil en la
región. El visor lo declara al lado de la cifra.

    python -m ingesta.manzanas               # descarga y carga
    python -m ingesta.manzanas --simular     # descarga y resume, no escribe
"""
import argparse
import json
import sys
import urllib.parse
import urllib.request

import config
from bd import Bitacora, conexion, obtener_region

SERVICIO = ("https://services9.arcgis.com/kKJR3Qt68ohAWuet/arcgis/rest/services/"
            "Manzanas_censo_2017/FeatureServer/0/query")
POR_PAGINA = 2000                  # maxRecordCount del servicio
CATEGORIAS = {"CD": "ciudad", "PB": "pueblo"}


def url_pagina(codigo_region, desde):
    # Como en el Límite Urbano: la región va como texto y sin cero inicial.
    return SERVICIO + "?" + urllib.parse.urlencode({
        "where": "REGION='%d'" % int(codigo_region),
        "outFields": "COMUNA,MANZENT_I,NOM_CATEGO,TOTAL_PERS,TOTAL_VIVI",
        "orderByFields": "FID",
        "resultOffset": desde,
        "resultRecordCount": POR_PAGINA,
        "geometryPrecision": 6,
        "outSR": 4326,
        "f": "geojson",
    })


def descargar(region):
    rasgos, desde = [], 0
    print("[manzanas] %s" % SERVICIO.rsplit("/query", 1)[0])
    while True:
        with urllib.request.urlopen(url_pagina(region.codigo, desde), timeout=180) as r:
            datos = json.load(r)
        if datos.get("error"):
            raise SystemExit("[manzanas] el servicio respondió: %s" % datos["error"])
        pagina = datos.get("features", [])
        rasgos.extend(pagina)
        print("  %5d manzanas" % len(rasgos))
        # Sigue mientras el servicio diga que cortó, o la página venga llena.
        cortada = (datos.get("properties") or {}).get("exceededTransferLimit")
        if not pagina or (not cortada and len(pagina) < POR_PAGINA):
            break
        desde += len(pagina)
    if not rasgos:
        raise SystemExit("[manzanas] sin manzanas para la región %s" % region.codigo)
    return rasgos


def fila(f):
    """(id_comuna, manzent, categoria, personas, viviendas, geojson) o None."""
    p = f.get("properties") or {}
    if not f.get("geometry") or not p.get("MANZENT_I") or not p.get("COMUNA"):
        return None
    return (int(p["COMUNA"]), str(p["MANZENT_I"]),
            CATEGORIAS.get((p.get("NOM_CATEGO") or "").upper()),
            int(p.get("TOTAL_PERS") or 0), int(p.get("TOTAL_VIVI") or 0),
            json.dumps(f["geometry"]))


def resumir(rasgos):
    filas = [x for x in map(fila, rasgos) if x]
    print("[manzanas] %d manzanas, %d personas, %d viviendas en %d comunas"
          % (len(filas), sum(x[3] for x in filas), sum(x[4] for x in filas),
             len({x[0] for x in filas})))
    return filas


SQL_INSERTAR = """
INSERT INTO territorio.manzana (id_comuna, manzent, categoria, personas, viviendas, geom)
VALUES (%s, %s, %s, %s, %s,
        ST_Multi(ST_CollectionExtract(
            ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)))
ON CONFLICT (manzent) DO UPDATE SET
    id_comuna = EXCLUDED.id_comuna, categoria = EXCLUDED.categoria,
    personas  = EXCLUDED.personas,  viviendas = EXCLUDED.viviendas,
    geom      = EXCLUDED.geom
"""


def cargar(region, filas):
    with conexion() as con:
        comunas = {r[0] for r in con.execute(
            "SELECT id_comuna FROM territorio.comuna WHERE id_region = %s",
            (region.id_region,)).fetchall()}
        validas = [x for x in filas if x[0] in comunas]
        if len(validas) < len(filas):
            print("[manzanas] AVISO: %d manzanas de comunas que no están en la base"
                  % (len(filas) - len(validas)))
        con.execute("DELETE FROM territorio.manzana WHERE id_comuna = ANY(%s)",
                    (sorted(comunas),))
        with con.cursor() as cur:
            cur.executemany(SQL_INSERTAR, validas)
    print("[manzanas] %d manzanas cargadas en territorio.manzana" % len(validas))
    return len(validas)


def main():
    p = argparse.ArgumentParser(description="Población por manzana (Censo 2017)")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--simular", action="store_true", help="descarga y resume, no escribe")
    args = p.parse_args()

    region = obtener_region(args.region)
    print("[manzanas] %s" % region.nombre)
    with Bitacora("Manzanas censales INE — %s" % region.nombre, fuente="ine_manzanas") as b:
        filas = resumir(descargar(region))
        if args.simular:
            print("\n[manzanas] --simular: no se escribió nada.")
            b.simulada = True
            b.registros = 0
            return 0
        b.registros = cargar(region, filas)
    return 0


if __name__ == "__main__":
    sys.exit(main())
