# -*- coding: utf-8 -*-
"""
Equipamiento crítico de la región desde OpenStreetMap.

Para el visor de inundaciones: qué escuelas, jardines infantiles, centros de
salud, cuarteles de bomberos y de policía quedan sobre las celdas que
superan el umbral de riesgo. Son los lugares que un plan de emergencia
revisa primero —por la gente que concentran o porque son los que responden—.

Se consulta la API Overpass por el recuadro de la región y cada punto se
asigna a su comuna en la base: lo que cae fuera de las comunas de la región
se descarta. Los edificios y recintos (ways, relations) llegan como su
centro. Licencia ODbL: la atribución "© colaboradores de OpenStreetMap" va
con el dato en la API y en el mapa.

Es cartografía colaborativa: en las ciudades está casi todo; en lo rural hay
huecos. Por eso el visor dice "según OpenStreetMap" y no "todas las escuelas".

    python -m ingesta.equipamiento               # consulta y carga
    python -m ingesta.equipamiento --simular     # consulta y resume
"""
import argparse
import json
import sys
import urllib.parse
import urllib.request
from collections import Counter

import config
from bd import Bitacora, conexion, obtener_region

OVERPASS = "https://overpass-api.de/api/interpreter"
# Overpass rechaza (406) las consultas sin un agente que se identifique.
AGENTE = "TerraFoco/1.0 (focalizacion territorial INDAP; proyecto academico)"

# (clave OSM, valor) -> (categoría, tipo). El tipo es el valor de OSM, para
# que se pueda rastrear; el visor lo traduce.
TIPOS = {
    ("amenity", "school"):              ("educacion", "school"),
    ("amenity", "kindergarten"):        ("educacion", "kindergarten"),
    ("amenity", "college"):             ("educacion", "college"),
    ("amenity", "university"):          ("educacion", "university"),
    ("amenity", "hospital"):            ("salud", "hospital"),
    ("amenity", "clinic"):              ("salud", "clinic"),
    ("amenity", "doctors"):             ("salud", "doctors"),
    ("healthcare", "hospital"):         ("salud", "hospital"),
    ("healthcare", "clinic"):           ("salud", "clinic"),
    ("healthcare", "centre"):           ("salud", "clinic"),
    ("healthcare", "doctor"):           ("salud", "doctors"),
    ("amenity", "fire_station"):        ("emergencia", "fire_station"),
    ("amenity", "police"):              ("emergencia", "police"),
    ("emergency", "ambulance_station"): ("emergencia", "ambulance_station"),
}


def consulta(bbox):
    """Consulta Overpass QL por el recuadro (oeste, sur, este, norte)."""
    oeste, sur, este, norte = bbox
    caja = "(%.5f,%.5f,%.5f,%.5f)" % (sur, oeste, norte, este)
    por_clave = {}
    for (clave, valor) in TIPOS:
        por_clave.setdefault(clave, []).append(valor)
    partes = ['  nwr["%s"~"^(%s)$"]%s;' % (clave, "|".join(sorted(set(v))), caja)
              for clave, v in sorted(por_clave.items())]
    return "[out:json][timeout:180];\n(\n%s\n);\nout center tags;" % "\n".join(partes)


def clasificar(etiquetas):
    """(categoría, tipo) de un elemento, o None si no es de los que interesan.
    Manda amenity: un hospital etiquetado también como healthcare=clinic es
    hospital."""
    for clave in ("amenity", "healthcare", "emergency"):
        t = TIPOS.get((clave, etiquetas.get(clave)))
        if t:
            return t
    return None


def punto(elemento):
    """(lon, lat) del nodo, o del centro que Overpass calcula para ways y relations."""
    if elemento.get("type") == "node":
        return elemento.get("lon"), elemento.get("lat")
    c = elemento.get("center") or {}
    return c.get("lon"), c.get("lat")


def filas(elementos):
    salida = []
    for e in elementos:
        t = clasificar(e.get("tags") or {})
        lon, lat = punto(e)
        if not t or lon is None or lat is None:
            continue
        nombre = ((e.get("tags") or {}).get("name") or "").strip() or None
        salida.append((e["type"], int(e["id"]), t[0], t[1], nombre, float(lon), float(lat)))
    return salida


def descargar(region):
    datos = urllib.parse.urlencode({"data": consulta(region.bbox)}).encode()
    pedido = urllib.request.Request(OVERPASS, data=datos,
                                    headers={"User-Agent": AGENTE, "Accept": "application/json"})
    print("[equipamiento] %s" % OVERPASS)
    with urllib.request.urlopen(pedido, timeout=240) as r:
        respuesta = json.load(r)
    if respuesta.get("remark") and not respuesta.get("elements"):
        raise SystemExit("[equipamiento] Overpass respondió: %s" % respuesta["remark"])
    return respuesta.get("elements", [])


def resumir(f):
    c = Counter(x[2] for x in f)
    print("[equipamiento] %d elementos en el recuadro: %s"
          % (len(f), ", ".join("%d %s" % (n, k) for k, n in c.most_common())))


SQL_INSERTAR = """
INSERT INTO territorio.equipamiento (id_comuna, osm_tipo, osm_id, categoria, tipo, nombre, geom)
SELECT c.id_comuna, %(osm_tipo)s, %(osm_id)s, %(categoria)s, %(tipo)s, %(nombre)s, p.geom
FROM   (SELECT ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326) AS geom) p
JOIN   territorio.comuna c ON c.id_region = %(region)s AND ST_Contains(c.geom, p.geom)
ON CONFLICT (osm_tipo, osm_id) DO UPDATE SET
    id_comuna = EXCLUDED.id_comuna, categoria = EXCLUDED.categoria,
    tipo = EXCLUDED.tipo, nombre = EXCLUDED.nombre, geom = EXCLUDED.geom,
    cargado_en = now()
"""


def cargar(region, f):
    with conexion() as con:
        con.execute("""DELETE FROM territorio.equipamiento
                       WHERE id_comuna IN (SELECT id_comuna FROM territorio.comuna
                                           WHERE id_region = %s)""", (region.id_region,))
        with con.cursor() as cur:
            cur.executemany(SQL_INSERTAR, [{
                "osm_tipo": x[0], "osm_id": x[1], "categoria": x[2], "tipo": x[3],
                "nombre": x[4], "lon": x[5], "lat": x[6], "region": region.id_region,
            } for x in f])
        n = con.execute("""SELECT count(*) FROM territorio.equipamiento e
                           JOIN territorio.comuna c USING (id_comuna)
                           WHERE c.id_region = %s""", (region.id_region,)).fetchone()[0]
    print("[equipamiento] %d dentro de las comunas de la región (de %d en el recuadro)"
          % (n, len(f)))
    return n


def main():
    p = argparse.ArgumentParser(description="Equipamiento crítico desde OpenStreetMap")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--simular", action="store_true", help="consulta y resume, no escribe")
    args = p.parse_args()

    region = obtener_region(args.region)
    print("[equipamiento] %s" % region.nombre)
    with Bitacora("Equipamiento crítico OSM — %s" % region.nombre, fuente="osm_equipamiento") as b:
        f = filas(descargar(region))
        resumir(f)
        if args.simular:
            print("\n[equipamiento] --simular: no se escribió nada.")
            b.simulada = True
            b.registros = 0
            return 0
        b.registros = cargar(region, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
