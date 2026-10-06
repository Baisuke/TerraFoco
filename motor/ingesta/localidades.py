# -*- coding: utf-8 -*-
"""
Ciudades y pueblos de la región: el Límite Urbano Censal 2017 del INE.

Para el visor de inundaciones hace falta saber qué localidades hay dentro de
una comuna: la pregunta útil no es cuánto riesgo tiene Rengo como comuna
—mezcla cerro, valle y ciudad— sino qué sector de qué ciudad o pueblo lo
tiene.

El INE ya no publica el servicio que enlaza su portal de geodatos (el ítem de
ArcGIS Online fue retirado). Se usa la copia nacional del Centro de Datos del
Observatorio de Ciudades UC, que declara al INE como fuente original, por su
servicio de ArcGIS: GeoJSON en WGS84, sin credenciales. Licencia CC BY-NC 4.0:
uso no comercial con atribución a INE y OCUC.

    python -m ingesta.localidades               # descarga y carga
    python -m ingesta.localidades --simular     # descarga y resume, no escribe

Reemplaza las localidades de la región en territorio.ciudad: es cartografía
de referencia, no un indicador, y dos copias del mismo pueblo solo
duplicarían las cuentas del visor.
"""
import argparse
import json
import sys
import urllib.parse
import urllib.request

import config
from bd import Bitacora, conexion, obtener_region

SERVICIO = ("https://services9.arcgis.com/kKJR3Qt68ohAWuet/arcgis/rest/services/"
            "LUC_2017/FeatureServer/0/query")
FUENTE = "INE, Límite Urbano Censal 2017 (copia OCUC)"

# Partículas que van en minúscula dentro de un nombre propio en español.
MINUSCULAS = {"de", "del", "la", "las", "los", "el", "y", "e"}


def _mayuscula_inicial(palabra):
    """Mayúscula inicial también tras apóstrofo y guion: O'Higgins, Tagua-Tagua."""
    for sep in ("'", "-"):
        if sep in palabra:
            return sep.join(_mayuscula_inicial(p) for p in palabra.split(sep))
    return palabra[:1].upper() + palabra[1:]


def nombre_propio(texto):
    """"PUNTA DE CORTÉS" -> "Punta de Cortés". El censo escribe todo en
    mayúsculas, y así en el mapa los nombres gritaban junto a los de CARTO."""
    palabras = (texto or "").strip().lower().split()
    # Tras un " - " suelto empieza otro nombre: "La Esperanza - El Cortijo".
    return " ".join(p if (i and p in MINUSCULAS and palabras[i - 1] != "-")
                    else _mayuscula_inicial(p)
                    for i, p in enumerate(palabras))


def url_consulta(codigo_region):
    # El servicio guarda la región como texto y sin cero inicial: '6', no '06'.
    return SERVICIO + "?" + urllib.parse.urlencode({
        "where": "REGION='%d'" % int(codigo_region),
        "outFields": "COMUNA,NOM_COMUNA,URBANO,TIPO,CATEGORIA",
        "outSR": 4326,
        "f": "geojson",
    })


def descargar(region):
    url = url_consulta(region.codigo)
    print("[localidades] %s" % url.split("?")[0])
    with urllib.request.urlopen(url, timeout=180) as r:
        datos = json.load(r)
    if datos.get("error"):
        raise SystemExit("[localidades] el servicio respondió: %s" % datos["error"])
    if (datos.get("properties") or {}).get("exceededTransferLimit"):
        # Con 70 localidades no pasa (el tope del servicio es mayor), pero si
        # pasara, cargar a medias sin avisar dejaría pueblos fuera del mapa.
        raise SystemExit("[localidades] el servicio cortó la respuesta; paginar")
    rasgos = datos.get("features", [])
    if not rasgos:
        raise SystemExit("[localidades] sin localidades para la región %s" % region.codigo)
    return rasgos


def resumir(rasgos):
    from collections import Counter
    cat = Counter((f["properties"].get("CATEGORIA") or "?").lower() for f in rasgos)
    comunas = {f["properties"].get("COMUNA") for f in rasgos}
    print("[localidades] %d áreas urbanas (%s) en %d comunas"
          % (len(rasgos), ", ".join("%d %s" % (n, c) for c, n in cat.most_common()),
             len(comunas)))


SQL_INSERTAR = """
INSERT INTO territorio.ciudad (id_comuna, nombre, categoria, tipo, fuente, geom)
VALUES (%s, %s, %s, %s, %s,
        ST_Multi(ST_CollectionExtract(
            ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)))
"""


def cargar(region, rasgos):
    with conexion() as con:
        comunas = {f[0] for f in con.execute(
            "SELECT id_comuna FROM territorio.comuna WHERE id_region = %s",
            (region.id_region,)).fetchall()}
        con.execute("DELETE FROM territorio.ciudad WHERE id_comuna = ANY(%s)",
                    (sorted(comunas),))
        cargadas, sin_comuna = 0, []
        for f in rasgos:
            p = f["properties"]
            id_comuna = int(p["COMUNA"])
            if id_comuna not in comunas:
                sin_comuna.append("%s (%s)" % (p.get("URBANO"), p["COMUNA"]))
                continue
            con.execute(SQL_INSERTAR, (
                id_comuna, nombre_propio(p.get("URBANO")),
                (p.get("CATEGORIA") or "").lower() or None,
                (p.get("TIPO") or "").lower() or None,
                FUENTE, json.dumps(f["geometry"])))
            cargadas += 1
    if sin_comuna:
        print("[localidades] AVISO: sin comuna en la base: %s" % ", ".join(sin_comuna))
    print("[localidades] %d localidades cargadas en territorio.ciudad" % cargadas)
    return cargadas


def main():
    p = argparse.ArgumentParser(description="Ciudades y pueblos (Límite Urbano Censal 2017)")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--simular", action="store_true", help="descarga y resume, no escribe")
    args = p.parse_args()

    region = obtener_region(args.region)
    print("[localidades] %s" % region.nombre)
    with Bitacora("Localidades urbanas INE — %s" % region.nombre, fuente="ine_luc") as b:
        rasgos = descargar(region)
        resumir(rasgos)
        if args.simular:
            print("\n[localidades] --simular: no se escribió nada.")
            b.simulada = True
            b.registros = 0
            return 0
        b.registros = cargar(region, rasgos)
    return 0


if __name__ == "__main__":
    sys.exit(main())
