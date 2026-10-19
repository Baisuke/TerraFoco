# -*- coding: utf-8 -*-
"""
Red hídrica de IDE Chile y distancia a cauces.

Es la quinta variable del índice de susceptibilidad a inundación, y la única
que no sale del modelo de elevación. Viene de la cartografía de la red
hídrica a 1:25.000 del grupo de hidrografía de IDE Chile (2021), por WFS,
sin credenciales, igual que las comunas y que CIREN.

Tres pasos, cada uno con su bandera para poder repetirlo por separado:

    python -m ingesta.cauces --descargar    # WFS -> /datos/inundacion/cauces.geojson
    python -m ingesta.cauces --cargar       # geojson -> territorio.cauce
    python -m ingesta.cauces --distancia    # cauces -> distancia_cauces.tif

    python -m ingesta.cauces                # los tres
    python -m ingesta.cauces --simular      # descarga y resume, no escribe

La capa trae el orden de Strahler, y eso es lo que la hace útil. En el bbox
de O'Higgins hay 9.107 tramos: 8.400 son quebradas de ladera, que son
drenaje, no inundación. La distancia se calcula a los cauces de orden 5 o
superior —ríos y esteros principales, unos 680 tramos— y el umbral queda
registrado en el ráster, para que quien quiera otro lo cambie y sepa cuál
se usó.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import transform_geom

import config
from bd import Bitacora, conexion, obtener_region
from ingesta.hidrologia import DIR_SALIDA, escribir, recortar

WFS = "https://geoportal.cl/geoserver/Hidrografia/wfs"
CAPA = "Hidrografia:hidrografa"

RUTA_GEOJSON = os.path.join(DIR_SALIDA, "cauces.geojson")
RUTA_DISTANCIA = os.path.join(DIR_SALIDA, "distancia_cauces.tif")

# Orden de Strahler mínimo para contar como cauce en la distancia.
ORDEN_MINIMO = 5


# --------------------------------------------------------------------------
# Descarga
# --------------------------------------------------------------------------

def url_wfs(bbox):
    oeste, sur, este, norte = bbox
    return WFS + "?" + urllib.parse.urlencode({
        "service": "WFS", "version": "1.1.0", "request": "GetFeature",
        "typeName": CAPA, "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "bbox": "%s,%s,%s,%s,EPSG:4326" % (oeste, sur, este, norte),
    })


def descargar(region, destino=RUTA_GEOJSON):
    """Baja la red hídrica del bbox de la región a un GeoJSON."""
    url = url_wfs(region.bbox)
    print("[cauces] WFS %s" % CAPA)
    with urllib.request.urlopen(url, timeout=600) as r:
        datos = json.load(r)
    rasgos = datos.get("features", [])
    if not rasgos:
        raise SystemExit("[cauces] el WFS no devolvió rasgos para el bbox %s" % (region.bbox,))
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(datos, f)
    print("[cauces] %d tramos -> %s (%.1f MB)"
          % (len(rasgos), destino, os.path.getsize(destino) / 1e6))
    return datos


def resumir(datos):
    from collections import Counter
    rasgos = datos["features"]
    ordenes = Counter(_entero(f["properties"].get("strahler_n")) for f in rasgos)
    tipos = Counter(f["properties"].get("tipo") for f in rasgos)
    print("[cauces] por orden de Strahler: %s"
          % ", ".join("%s:%d" % (k, v) for k, v in sorted(ordenes.items(), key=lambda t: t[0] or 0)))
    print("[cauces] por tipo: %s" % ", ".join("%s %d" % t for t in tipos.most_common(5)))
    principales = sum(v for k, v in ordenes.items() if k and k >= ORDEN_MINIMO)
    print("[cauces] con orden >= %d: %d tramos" % (ORDEN_MINIMO, principales))


def _entero(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------
# Carga a PostGIS
# --------------------------------------------------------------------------

SQL_INSERTAR = """
INSERT INTO territorio.cauce
    (id_region, nombre, tipo, strahler, cod_cuenca, nom_cuenca, nom_subsubc,
     longitud_m, geom)
VALUES
    (%(id_region)s, %(nombre)s, %(tipo)s, %(strahler)s, %(cod_cuenca)s,
     %(nom_cuenca)s, %(nom_subsubc)s, %(longitud_m)s,
     ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326)))
"""


def cargar(region, datos):
    """Reemplaza la red de la región en territorio.cauce.

    Aquí sí se reemplaza en vez de versionar: es cartografía de referencia,
    no un indicador calculado, y tener dos copias del mismo río duplicaría
    la distancia a cauces sin aportar nada.
    """
    rasgos = datos["features"]
    with conexion() as con:
        con.execute("DELETE FROM territorio.cauce WHERE id_region = %s", (region.id_region,))
        for f in rasgos:
            p = f["properties"]
            con.execute(SQL_INSERTAR, {
                "id_region": region.id_region,
                "nombre": (p.get("nombre") or None),
                "tipo": p.get("tipo"),
                "strahler": _entero(p.get("strahler_n")),
                "cod_cuenca": p.get("cod_cuen"),
                "nom_cuenca": p.get("nom_cuen"),
                "nom_subsubc": p.get("nom_ssubc"),
                "longitud_m": p.get("shape_le_1") or p.get("shape_leng"),
                "geom": json.dumps(f["geometry"]),
            })
    print("[cauces] %d tramos cargados en territorio.cauce" % len(rasgos))
    return len(rasgos)


# --------------------------------------------------------------------------
# Distancia a cauces
# --------------------------------------------------------------------------

def distancia_a_cauces(datos, region, ruta_dem, orden_minimo=ORDEN_MINIMO):
    """Ráster de distancia euclidiana, en metros, al cauce más cercano.

    Se rasterizan los tramos de orden >= orden_minimo sobre la MISMA rejilla
    que usa ingesta.hidrologia (el DEM recortado al bbox de la región), para
    que las seis variables compartan celda a celda. Luego una transformada de
    distancia sobre la máscara. Es la definición directa de la variable, sin
    aproximaciones por buffer.
    """
    from scipy.ndimage import distance_transform_edt

    z, transform, crs, dx = recortar(ruta_dem, region)
    print("[cauces] rejilla %d x %d celdas de %.0f m (la del DEM)" % (z.shape[1], z.shape[0], dx))

    seleccion = [f for f in datos["features"]
                 if (_entero(f["properties"].get("strahler_n")) or 0) >= orden_minimo]
    if not seleccion:
        raise SystemExit("[cauces] ningún tramo con orden >= %d" % orden_minimo)

    formas = [transform_geom("EPSG:4326", crs, f["geometry"]) for f in seleccion]
    es_cauce = rasterize(((g, 1) for g in formas), out_shape=z.shape,
                         transform=transform, fill=0, dtype="uint8",
                         all_touched=True).astype(bool)
    print("[cauces] %d tramos de orden >= %d rasterizados: %d celdas de cauce"
          % (len(seleccion), orden_minimo, int(es_cauce.sum())))

    # distance_transform_edt mide desde las celdas en cero, por eso se niega.
    distancia = distance_transform_edt(~es_cauce, sampling=(dx, dx))
    distancia = distancia.astype("float64")
    distancia[np.isnan(z)] = np.nan
    return distancia, transform, crs


def resumen_distancia(d):
    v = d[~np.isnan(d)]
    print("[cauces] distancia: min %.0f m  mediana %.0f m  p90 %.0f m  max %.0f m"
          % (v.min(), np.median(v), np.percentile(v, 90), v.max()))


# --------------------------------------------------------------------------
# Punto de entrada
# --------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Red hídrica de IDE Chile y distancia a cauces")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--descargar", action="store_true")
    p.add_argument("--cargar", action="store_true")
    p.add_argument("--distancia", action="store_true")
    p.add_argument("--orden-minimo", type=int, default=ORDEN_MINIMO,
                   help="orden de Strahler mínimo para contar como cauce")
    p.add_argument("--dem", default=os.path.join(config.DIR_DATOS, "srtm", "dem_utm.tif"))
    p.add_argument("--geojson", default=RUTA_GEOJSON)
    p.add_argument("--simular", action="store_true", help="descarga y resume, no escribe")
    args = p.parse_args()

    # Sin banderas se hacen los tres pasos.
    todo = not (args.descargar or args.cargar or args.distancia)
    region = obtener_region(args.region)
    print("[cauces] %s" % region.nombre)

    with Bitacora("Red hídrica IDE Chile — %s" % region.nombre, fuente="ide_hidrografia") as b:
        if args.descargar or todo or args.simular:
            datos = descargar(region, args.geojson if not args.simular else os.devnull)
        else:
            with open(args.geojson, encoding="utf-8") as f:
                datos = json.load(f)
            print("[cauces] %d tramos leídos de %s" % (len(datos["features"]), args.geojson))
        resumir(datos)

        if args.simular:
            print("\n[cauces] --simular: no se escribió nada.")
            b.simulada = True
            b.registros = 0
            return 0

        if args.cargar or todo:
            b.registros = cargar(region, datos)

        if args.distancia or todo:
            distancia, transform, crs = distancia_a_cauces(datos, region, args.dem,
                                                           args.orden_minimo)
            resumen_distancia(distancia)
            os.makedirs(DIR_SALIDA, exist_ok=True)
            escribir(RUTA_DISTANCIA, distancia, transform, crs)
            print("[cauces] -> %s (%.1f MB)"
                  % (RUTA_DISTANCIA, os.path.getsize(RUTA_DISTANCIA) / 1e6))

    print("\n[cauces] agregar por comuna con:")
    print("  python -m ingesta.zonal --raster %s --factor distancia_cauces --guardar" % RUTA_DISTANCIA)
    return 0


if __name__ == "__main__":
    sys.exit(main())
