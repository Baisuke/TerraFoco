# -*- coding: utf-8 -*-
"""
Áreas verdes públicas desde OpenStreetMap (HU-19, RF-25).

QUÉ CUENTA COMO ÁREA VERDE PÚBLICA
----------------------------------
Parques, jardines, áreas verdes vecinales, áreas recreativas y superficies de
pasto (leisure=park|garden, landuse=village_green|recreation_ground|grass),
salvo las marcadas como privadas. La regla no es un gusto: se eligió
contrastándola con el único dato oficial que existe, el del SIEDU, que usa
los catastros municipales.

  Rancagua, m² por habitante urbano (Censo 2024):
    solo parques y plazas ............ 6,0
    + pasto (bandejones y platabandas) 8,5   <- SIEDU: entre 8 y 9
    + canchas y juegos infantiles .... 9,4

El pasto entra porque los catastros municipales cuentan los bandejones; las
canchas quedan fuera porque el SIEDU mide área verde, no recintos deportivos.

TRES PASOS
----------
1. Overpass devuelve los polígonos con su geometría, sin credenciales.
2. Se disuelven los que se solapan —una plaza dibujada como park con un grass
   encima cuenta una vez— y se recortan al límite urbano del censo.
3. Cada parte continua de 450 m² o más se clasifica como el SIEDU:
   plaza hasta 2 ha, parque desde 2 ha. Lo menor a 450 m² no es un área
   verde utilizable y se descarta.

Las partes hechas solo de pasto (landuse=grass) se marcan `solo_pasto`: un
bandejón de 600 m² suma a los m² por habitante, como en el catastro
municipal, pero no es una plaza a la que se pueda ir caminando, y no cuenta
para el acceso a 400 m.

    python -m ingesta.areas_verdes              # descarga y carga
    python -m ingesta.areas_verdes --simular    # descarga y resume
    python -m ingesta.areas_verdes --desde-archivo   # usa la última descarga

LIMITACIÓN QUE SE DECLARA
-------------------------
OpenStreetMap es tan completo como su comunidad. En Rancagua reproduce el
catastro oficial; en pueblos chicos puede faltar una plaza, y entonces el
déficit se sobreestima. Por eso la pantalla muestra la fecha de la descarga
y cada área lleva sus identificadores de OSM.
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date

import config
from bd import Bitacora, conexion, obtener_region

OVERPASS = "https://overpass-api.de/api/interpreter"
DIR_SALIDA = os.path.join(config.DIR_DATOS, "areas_verdes")

LEISURE = {"park", "garden"}
LANDUSE = {"village_green", "recreation_ground", "grass"}
ACCESO_PRIVADO = {"private", "no", "customers"}

# Estándares SIEDU (INE / CNDU).
AREA_MINIMA_M2 = 450
AREA_PARQUE_M2 = 20000


def consulta(bbox):
    """Overpass QL para el bbox (oeste, sur, este, norte) de la región."""
    o, s, e, n = bbox
    caja = "%f,%f,%f,%f" % (s, o, n, e)
    return """[out:json][timeout:180];
(way["leisure"~"^(park|garden)$"](%(c)s);
 relation["leisure"~"^(park|garden)$"](%(c)s);
 way["landuse"~"^(village_green|recreation_ground|grass)$"](%(c)s);
 relation["landuse"~"^(village_green|recreation_ground|grass)$"](%(c)s););
out geom qt;""" % {"c": caja}


def descargar(bbox, destino):
    datos = urllib.parse.urlencode({"data": consulta(bbox)}).encode()
    pet = urllib.request.Request(OVERPASS, data=datos, headers={
        # Overpass pide identificarse; sin esto responde 429 a la segunda.
        "User-Agent": "TerraFoco/0.1 (proyecto de titulo Duoc UC)"})
    for intento in range(3):
        try:
            with urllib.request.urlopen(pet, timeout=240) as r:
                crudo = json.load(r)
            break
        except Exception as e:
            if intento == 2:
                raise
            print("  Overpass falló (%s); reintento" % e)
            time.sleep(15 * (intento + 1))
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(crudo, f)
    return crudo


# ------------------------------------------------------------ geometría pura

def es_area_verde_publica(tags):
    if (tags.get("access") or "").lower() in ACCESO_PRIVADO:
        return False
    return tags.get("leisure") in LEISURE or tags.get("landuse") in LANDUSE


def poligono(elemento):
    """Polígono de un way cerrado o de una relación multipolígono; None si no cierra.

    En la relación, los anillos exteriores se arman uniendo sus tramos (un
    anillo grande suele venir partido en varios ways) y los interiores se
    restan: un parque con una laguna al medio no cuenta la laguna.
    """
    from shapely.geometry import LineString, Polygon
    from shapely.ops import polygonize, unary_union

    def coords(g):
        return [(p["lon"], p["lat"]) for p in g]

    if elemento.get("type") == "way":
        pts = coords(elemento.get("geometry") or [])
        if len(pts) < 4 or pts[0] != pts[-1]:
            return None
        g = Polygon(pts)
        return g if g.is_valid else g.buffer(0)

    def anillos(rol):
        lineas = [LineString(coords(m["geometry"])) for m in elemento.get("members", [])
                  if m.get("role") == rol and m.get("geometry") and len(m["geometry"]) >= 2]
        return list(polygonize(unary_union(lineas))) if lineas else []

    externos = anillos("outer")
    if not externos:
        return None
    g = unary_union(externos)
    internos = anillos("inner")
    if internos:
        g = g.difference(unary_union(internos))
    return g if g.is_valid else g.buffer(0)


def clasificar(area_m2):
    """plaza, parque o None (bajo el mínimo del SIEDU)."""
    if area_m2 < AREA_MINIMA_M2:
        return None
    return "parque" if area_m2 >= AREA_PARQUE_M2 else "plaza"


def partes(geometria):
    return [g for g in getattr(geometria, "geoms", [geometria]) if not g.is_empty and g.area > 0]


def construir(crudo, limites_por_comuna):
    """De la respuesta de Overpass a las áreas verdes finales, por comuna.

    limites_por_comuna: {id_comuna: geometría del área urbana en EPSG:32719}.
    Devuelve [{id_comuna, tipo, nombre, area_m2, osm_ids, geom_utm}].
    """
    import geopandas as gpd
    from shapely.ops import unary_union

    filas = []
    for e in crudo.get("elements", []):
        tags = e.get("tags", {})
        if not es_area_verde_publica(tags):
            continue
        g = poligono(e)
        if g is None or g.is_empty:
            continue
        filas.append({"osm": "%s/%d" % (e["type"], e["id"]), "nombre": tags.get("name"),
                      "pasto": tags.get("landuse") == "grass" and not tags.get("leisure"),
                      "geometry": g})
    if not filas:
        return []
    osm = gpd.GeoDataFrame(filas, crs=4326).to_crs(32719)
    indice = osm.sindex

    salida = []
    for id_comuna, urbano in limites_por_comuna.items():
        cerca = osm.iloc[list(indice.query(urbano, predicate="intersects"))]
        if cerca.empty:
            continue
        verde = unary_union(list(cerca.geometry)).intersection(urbano)
        for parte in partes(verde):
            tipo = clasificar(parte.area)
            if tipo is None:
                continue
            fuentes = cerca[cerca.intersects(parte)]
            con_nombre = fuentes[fuentes["nombre"].notna()]
            nombre = None
            if not con_nombre.empty:
                # El nombre del elemento que más aporta a la parte.
                nombre = con_nombre.assign(
                    aporte=con_nombre.geometry.intersection(parte).area
                ).sort_values("aporte", ascending=False)["nombre"].iloc[0]
            salida.append({"id_comuna": id_comuna, "tipo": tipo, "nombre": nombre,
                           "area_m2": round(parte.area, 1),
                           "solo_pasto": bool(fuentes["pasto"].all()),
                           "osm_ids": ",".join(sorted(fuentes["osm"]))[:2000],
                           "geom_utm": parte})
    return salida


# ------------------------------------------------------------------- base

SQL_LIMITES = """
SELECT l.id_comuna, ST_AsBinary(ST_Union(l.geom_utm))
FROM   territorio.limite_urbano l
JOIN   territorio.comuna c USING (id_comuna)
WHERE  c.id_region = %s
GROUP  BY l.id_comuna
"""

SQL_INSERTAR = """
INSERT INTO territorio.area_verde (id_comuna, tipo, nombre, area_m2, solo_pasto, osm_ids, geom, fecha_osm)
VALUES (%s, %s, %s, %s, %s, %s,
        ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromWKB(%s), 32719), 4326)), %s)
"""


def limites(id_region):
    from shapely import wkb
    with conexion() as con:
        filas = con.execute(SQL_LIMITES, (id_region,)).fetchall()
    if not filas:
        raise SystemExit("No hay límite urbano cargado. Correr antes: python -m ingesta.censo")
    return {f[0]: wkb.loads(bytes(f[1])) for f in filas}


def fecha_osm(crudo):
    marca = (crudo.get("osm3s") or {}).get("timestamp_osm_base", "")
    try:
        return date.fromisoformat(marca[:10])
    except ValueError:
        return date.today()


def guardar(id_region, areas, fecha):
    with conexion() as con:
        con.execute("""DELETE FROM territorio.area_verde WHERE id_comuna IN
                       (SELECT id_comuna FROM territorio.comuna WHERE id_region = %s)""",
                    (id_region,))
        with con.cursor() as cur:
            cur.executemany(SQL_INSERTAR, [
                (a["id_comuna"], a["tipo"], a["nombre"], a["area_m2"], a["solo_pasto"], a["osm_ids"],
                 a["geom_utm"].wkb, fecha) for a in areas])
    return len(areas)


def resumir(areas):
    from collections import Counter
    tipos = Counter(a["tipo"] for a in areas)
    total = sum(a["area_m2"] for a in areas)
    print("  %d áreas: %d plazas (%d solo pasto) y %d parques, %s ha en total"
          % (len(areas), tipos["plaza"], sum(1 for a in areas if a["solo_pasto"]), tipos["parque"],
             format(round(total / 10000, 1), ",").replace(",", "X").replace(".", ",").replace("X", ".")))


def main():
    p = argparse.ArgumentParser(description="Áreas verdes públicas desde OpenStreetMap")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--simular", action="store_true", help="descargar y resumir, sin escribir")
    p.add_argument("--desde-archivo", action="store_true",
                   help="usar la última descarga en vez de consultar Overpass")
    args = p.parse_args()

    region = obtener_region(args.region)
    archivo = os.path.join(DIR_SALIDA, "overpass_R%02d.json" % args.region)
    print("\nÁreas verdes OSM — %s" % region.nombre)

    if args.desde_archivo:
        with open(archivo, encoding="utf-8") as f:
            crudo = json.load(f)
    else:
        t = time.time()
        crudo = descargar(region.bbox, archivo)
        print("  %d elementos de Overpass en %.0f s" % (len(crudo.get("elements", [])), time.time() - t))

    areas = construir(crudo, limites(args.region))
    resumir(areas)
    if args.simular:
        print("  (simulación: no se escribe)")
        return
    with Bitacora("Áreas verdes OSM — %s" % region.nombre, fuente="osm_areas_verdes") as b:
        b.registros = guardar(args.region, areas, fecha_osm(crudo))
    print("  guardadas %d áreas (OSM al %s)" % (b.registros, fecha_osm(crudo)))


if __name__ == "__main__":
    sys.exit(main())
