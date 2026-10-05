# -*- coding: utf-8 -*-
"""
Teselas de valores para el visor: un archivo PMTiles por capa.

POR QUÉ TESELAS Y NO UN PNG POR COMUNA
--------------------------------------
El detalle a 30 m se servía como un PNG por comuna, ya coloreado. Funciona,
pero tiene límites que se ven en pantalla:

  - se ve una comuna a la vez, y cada clic espera su imagen;
  - el PNG trae el COLOR y no el valor: cambiar un corte u ocultar una clase
    obliga a repintar la imagen entera en el navegador, y bajo el cursor se
    puede decir la clase pero nunca "23,4 t/ha/año";
  - al alejarse, el navegador reduce la imagen completa en cada cuadro.

Aquí la región entera se corta en una pirámide de teselas (512 px, del zoom
6 al 11; en el 11 un píxel mide ~31 m, el tamaño de la celda de cálculo) y
cada píxel guarda el VALOR codificado en RGB con la codificación de los
modelos de elevación ("terrain-RGB" de Mapbox). MapLibre lo trata como un
modelo de elevación y la capa `color-relief` lo colorea en la tarjeta de
video con una expresión de estilo: cambiar cortes, ocultar clases o mover un
umbral es cambiar la expresión, sin volver a descargar nada.

El relieve (NASADEM) va por el mismo camino y alimenta el sombreado del mapa
base y el terreno en 3D.

CODIFICACIÓN
------------
    n = round((valor * escala + 10000) * 10)
    R, G, B = n >> 16, (n >> 8) & 255, n & 255

MapLibre la invierte con `encoding: 'mapbox'`: -10000 + (R·65536 + G·256 + B)
· 0,1. La escala conserva los decimales que hacen falta: el índice de
inundación va de 0 a 1 y se guarda ×1000. Sin dato es n = 0 (-10000), y la
expresión de color lo deja transparente. El relieve no tiene "sin dato": un
hueco a -10000 m sería un precipicio en el sombreado, así que se rellena con 0.

UN SOLO ARCHIVO POR CAPA
------------------------
PMTiles guarda toda la pirámide en un archivo y el navegador pide solo los
bytes de las teselas que ve (peticiones HTTP de rango). No hace falta
servidor de mapas: sirve nginx, GitHub Pages o el lanzador portable.

Uso:
    python -m teselas relieve erosion
    python -m teselas --todas
    python -m teselas erosion --zmax 9            prueba rápida

Escribe /datos/teselas/<capa>.pmtiles. Copiar al prototipo con:
    docker cp terrafoco-programador:/datos/teselas/. prototipo/datos/teselas/
"""
import argparse
import glob
import json
import math
import os
import subprocess
import sys
import time
import warnings

import numpy as np
import rasterio
from rasterio.errors import NotGeoreferencedWarning
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds

import config
from bd import obtener_region

TAMANO = 512                    # px por tesela
ORIGEN = 20037508.342789244     # medio ancho del mundo en EPSG:3857
DIR_SALIDA = os.path.join(config.DIR_DATOS, "teselas")


# --------------------------------------------------------------------------
# Las capas
# --------------------------------------------------------------------------

def _mosaico(carpeta, patron, generador):
    """Une rásteres comunales en un VRT regional.

    Cada comuna trae su propia rejilla (el paso varía en milímetros de una a
    otra) y "sin dato" fuera de sus límites. El VRT los junta sin copiar
    datos, y como declara el sin dato de origen, el borde vacío de una comuna
    no pisa a la vecina.
    """
    rutas = sorted(glob.glob(os.path.join(config.DIR_DATOS, carpeta, patron)))
    if not rutas:
        raise SystemExit("No hay rásteres en /datos/%s. Generarlos con: %s" % (carpeta, generador))
    vrt = os.path.join(config.DIR_DATOS, carpeta, "region.vrt")
    subprocess.run(["gdalbuildvrt", "-q", "-overwrite", "-r", "nearest",
                    "-resolution", "user", "-tr", "30", "30",
                    "-srcnodata", "-9999", "-vrtnodata", "-9999", vrt] + rutas,
                   check=True)
    return vrt


def _mosaico_erosion():
    return _mosaico("erosion", "erosion_*.tif", "python -m mapa_erosion")


def _mosaico_ndvi():
    # El NDVI de verano a 30 m con que se calcula el factor C (ingesta.sentinel).
    return _mosaico("ndvi", "ndvi_*.tif",
                    "python -m ingesta.sentinel --mascara /datos/mascara_ciren.tif --guardar")


def _cortes_inundacion():
    """Los mismos cortes con que se clasificó el índice (susceptibilidad.json)."""
    ruta = os.path.join(config.DIR_DATOS, "inundacion", "susceptibilidad.json")
    if not os.path.exists(ruta):
        return None
    with open(ruta, encoding="utf-8") as f:
        return json.load(f).get("cortes_pixel")


def _cortes_erosion():
    from mapa_erosion import RAMPA
    return [c for c, _ in RAMPA if math.isfinite(c)]


def _cortes_calor():
    from mapa_calor import CORTES
    return list(CORTES)


# `cortes` va en los metadatos del archivo: el visor arma la expresión de
# color leyéndolos de ahí, así que el motor es la única fuente de los cortes.
# `cortes_inclusivos`: en qué clase cae un valor igual a un corte. Erosión
# cierra por arriba (a <= corte, como mapa_erosion); las demás por abajo
# (searchsorted a la derecha, como inundación y calor).
CAPAS = {
    "relieve": {
        "descripcion": "Elevación NASADEM a 30 m",
        "fuente": lambda: os.path.join(config.DIR_DATOS, "srtm", "dem_utm.tif"),
        # Zoom 10 (~62 m): el sombreado es suave por naturaleza y el terreno
        # 3D no gana con más. El 11 cuadruplicaba el peso sin que se notara.
        "escala": 1.0, "unidad": "m", "zmin": 5, "zmax": 10,
        # El sombreado necesita el relieve también alrededor de la región: si
        # se cortara en el límite, el mapa base quedaría plano justo al lado.
        "margen_grados": 0.35,
        "rellenar_con": 0.0,
        "remuestreo_fino": Resampling.bilinear,
        # NASADEM mide en metros enteros; los decimales que deja el
        # remuestreo son ruido, y el ruido no se comprime: con ellos el
        # archivo pesaba 54 MB. Al sombreado le basta el metro.
        "redondeo": 1.0,
        "cortes": None,
    },
    "erosion": {
        "descripcion": "Pérdida de suelo estimada (RUSLE) a 30 m, t/ha/año",
        "fuente": _mosaico_erosion,
        "escala": 1.0, "unidad": "t/ha/año", "zmin": 6, "zmax": 11,
        "margen_grados": 0.0, "rellenar_con": None,
        "remuestreo_fino": Resampling.nearest,
        "cortes": _cortes_erosion, "cortes_inclusivos": True,
    },
    "ndvi": {
        "descripcion": "NDVI de verano (Sentinel-2) a 30 m, el del factor C",
        "fuente": _mosaico_ndvi,
        "escala": 1000.0, "unidad": "", "zmin": 6, "zmax": 11,
        "margen_grados": 0.0, "rellenar_con": None,
        "remuestreo_fino": Resampling.nearest,
        # Dos decimales: las clases están a dos décimas una de otra.
        "redondeo": 0.01,
        # Umbrales habituales de cobertura: bajo 0,2 suelo desnudo o
        # construido; sobre 0,8 vegetación muy densa. En la región reparten
        # 16 / 31 / 23 / 20 / 10 % de las celdas.
        "cortes": lambda: [0.2, 0.4, 0.6, 0.8], "cortes_inclusivos": False,
    },
    "pendiente": {
        "descripcion": "Pendiente del terreno (NASADEM, Horn) a 30 m, en %",
        "fuente": lambda: os.path.join(config.DIR_DATOS, "inundacion", "pendiente.tif"),
        "escala": 1.0, "unidad": "%", "zmin": 6, "zmax": 11,
        "margen_grados": 0.0, "rellenar_con": None,
        "remuestreo_fino": Resampling.nearest,
        "redondeo": 1.0,           # porcentaje entero
        # Tramos usuales de aptitud y riesgo de erosión: plano, suave,
        # moderado, fuerte y muy fuerte.
        "cortes": lambda: [5.0, 15.0, 30.0, 50.0], "cortes_inclusivos": False,
    },
    "inundacion": {
        "descripcion": "Índice de susceptibilidad a inundación a 30 m (0–1)",
        "fuente": lambda: os.path.join(config.DIR_DATOS, "inundacion", "susceptibilidad.tif"),
        "escala": 1000.0, "unidad": "", "zmin": 6, "zmax": 11,
        "margen_grados": 0.0, "rellenar_con": None,
        "remuestreo_fino": Resampling.nearest,
        "cortes_inclusivos": False,
        # Centésimas. La codificación admite diezmilésimas, pero el índice
        # sigue la red de drenaje y cambia en cada celda: con cuatro
        # decimales el archivo pesaba 44 MB y con tres, 38. Los cortes entre
        # clases están a más de una décima uno de otro (0,23 / 0,35 / 0,49 en
        # la corrida de septiembre), así que redondear solo puede mover de
        # clase a las celdas que caen a menos de media centésima de un corte.
        "redondeo": 0.01,
        "cortes": _cortes_inundacion,
    },
    "calor": {
        "descripcion": "Temperatura superficial ECOSTRESS a 70 m, °C (verano)",
        "fuente": lambda: os.path.join(config.DIR_DATOS, "calor", "temperatura_superficial.tif"),
        # 70 m de origen: pasado el zoom 10 solo se repetirían píxeles.
        "escala": 1.0, "unidad": "°C", "zmin": 6, "zmax": 10,
        "margen_grados": 0.0, "rellenar_con": None,
        "remuestreo_fino": Resampling.nearest,
        "cortes": _cortes_calor, "cortes_inclusivos": False,
    },
}


# --------------------------------------------------------------------------
# Geometría de las teselas
# --------------------------------------------------------------------------

def tesela_de(lon, lat, z):
    """Índices x, y de la tesela que contiene un punto (esquema XYZ)."""
    n = 2 ** z
    lat = max(min(lat, 85.0511), -85.0511)
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def limites_mercator(x, y, z):
    """(oeste, sur, este, norte) de la tesela, en metros EPSG:3857."""
    lado = 2 * ORIGEN / 2 ** z
    oeste = -ORIGEN + x * lado
    norte = ORIGEN - y * lado
    return oeste, norte - lado, oeste + lado, norte


def teselas_en(bbox, z):
    oeste, sur, este, norte = bbox
    x0, y0 = tesela_de(oeste, norte, z)
    x1, y1 = tesela_de(este, sur, z)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            yield x, y


# --------------------------------------------------------------------------
# Codificación
# --------------------------------------------------------------------------

def codificar(a, escala):
    """Valores (NaN = sin dato) -> RGB uint8 de forma (3, alto, ancho)."""
    n = np.zeros(a.shape, dtype=np.int64)
    ok = np.isfinite(a)
    # n = 0 queda reservado para "sin dato": ningún valor real lo produce.
    n[ok] = np.clip(np.round((a[ok] * escala + 10000.0) * 10.0), 1, 2 ** 24 - 1)
    return np.stack([(n >> 16) & 255, (n >> 8) & 255, n & 255]).astype(np.uint8)


def decodificar(rgb, escala):
    """Inversa de codificar(); la usan las pruebas. Sin dato vuelve como NaN."""
    n = (rgb[0].astype(np.int64) << 16) | (rgb[1].astype(np.int64) << 8) | rgb[2]
    v = (-10000.0 + n * 0.1) / escala
    return np.where(n == 0, np.nan, v)


def _formato():
    """WebP sin pérdida si GDAL lo trae (pesa cerca de la mitad), si no PNG.

    Tiene que ser SIN pérdida: aquí el color es el dato, y una compresión con
    pérdida cambiaría los valores.
    """
    from rasterio.drivers import raster_driver_extensions
    return "WEBP" if "webp" in raster_driver_extensions() else "PNG"


def a_imagen(rgb, formato):
    opciones = {"LOSSLESS": "TRUE"} if formato == "WEBP" else {"ZLEVEL": 9}
    # Una tesela suelta no lleva georreferencia: la posición la da su índice.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with MemoryFile() as mf:
            with mf.open(driver=formato, width=rgb.shape[2], height=rgb.shape[1],
                         count=3, dtype="uint8", **opciones) as d:
                d.write(rgb)
            return mf.read()


# --------------------------------------------------------------------------
# Resumen por comuna
# --------------------------------------------------------------------------

def clasificar(valores, cortes, inclusivos):
    """Índice de clase por valor, con la misma regla que el visor."""
    return np.searchsorted(np.asarray(cortes, dtype="float64"), valores,
                           side="left" if inclusivos else "right")


def resumen_por_comuna(ruta_fuente, region, cortes, inclusivos):
    """Mediana, percentiles y % del territorio en cada clase, por comuna.

    Va en los metadatos del archivo para que el resumen que el visor muestra
    al hacer clic salga del MISMO dato que está pintado, y no de otra
    corrida. Se calcula sobre el ráster de origen, a su resolución, no sobre
    las teselas.
    """
    from rasterio.features import geometry_mask
    from rasterio.windows import Window, from_bounds

    from ingesta.zonal import geometrias_comunas, limites

    salida = []
    with rasterio.open(ruta_fuente) as fuente:
        for id_comuna, nombre, geo in geometrias_comunas(region.id_region,
                                                          fuente.crs.to_epsg()):
            minx, miny, maxx, maxy = limites(geo)
            try:
                ventana = (from_bounds(minx, miny, maxx, maxy, fuente.transform)
                           .round_offsets().round_lengths()
                           .intersection(Window(0, 0, fuente.width, fuente.height)))
            except Exception:
                continue                               # comuna fuera del ráster
            a = fuente.read(1, window=ventana, masked=True).astype("float64").filled(np.nan)
            dentro = geometry_mask([geo], out_shape=a.shape, invert=True,
                                   transform=fuente.window_transform(ventana))
            v = a[dentro & np.isfinite(a)]
            if v.size < 100:                           # una esquina asomando
                continue
            clase = clasificar(v, cortes, inclusivos)
            w, s, e, n = transform_bounds(fuente.crs, "EPSG:4326", minx, miny, maxx, maxy)
            salida.append({
                "id_comuna": id_comuna, "nombre": nombre,
                "celdas": int(v.size),
                "cobertura": round(v.size / max(1, int(dentro.sum())), 3),
                "media": round(float(v.mean()), 3),
                "mediana": round(float(np.median(v)), 3),
                "p10": round(float(np.percentile(v, 10)), 3),
                "p90": round(float(np.percentile(v, 90)), 3),
                "fraccion": [round(float((clase == k).mean()), 4)
                             for k in range(len(cortes) + 1)],
                "esquinas": [[round(w, 5), round(n, 5)], [round(e, 5), round(n, 5)],
                             [round(e, 5), round(s, 5)], [round(w, 5), round(s, 5)]],
            })
    return salida


# --------------------------------------------------------------------------
# Generación
# --------------------------------------------------------------------------

def leer_tesela(fuente, x, y, z, remuestreo, sin_dato):
    """La tesela como arreglo float32, con NaN donde no hay dato."""
    destino = np.full((TAMANO, TAMANO), np.nan, dtype="float32")
    reproject(
        source=rasterio.band(fuente, 1), destination=destino,
        src_transform=fuente.transform, src_crs=fuente.crs, src_nodata=sin_dato,
        dst_transform=from_bounds(*limites_mercator(x, y, z), TAMANO, TAMANO),
        dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=remuestreo)
    return destino


def generar(nombre, region, zmin=None, zmax=None, salida=DIR_SALIDA):
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer

    capa = CAPAS[nombre]
    ruta_fuente = capa["fuente"]()
    if not os.path.exists(ruta_fuente):
        raise SystemExit("No existe %s (capa %s)" % (ruta_fuente, nombre))
    zmin = capa["zmin"] if zmin is None else zmin
    zmax = capa["zmax"] if zmax is None else zmax
    formato = _formato()
    cortes = capa["cortes"]() if capa["cortes"] else None

    m = capa["margen_grados"]
    oeste, sur, este, norte = region.bbox
    with rasterio.open(ruta_fuente) as fuente:
        # La extensión útil es la del dato, recortada a la región (+ margen).
        fo, fs, fe, fn = transform_bounds(fuente.crs, "EPSG:4326", *fuente.bounds)
        bbox = (max(oeste - m, fo), max(sur - m, fs), min(este + m, fe), min(norte + m, fn))
        sin_dato = fuente.nodata

        print("[teselas] %s: %s  z%d-%d  %s  fuente %s"
              % (nombre, capa["descripcion"], zmin, zmax, formato, os.path.basename(ruta_fuente)))
        teselas, minimo, maximo, t0 = [], np.inf, -np.inf, time.time()
        for z in range(zmin, zmax + 1):
            # Bajo el zoom máximo cada píxel de tesela cubre varias celdas:
            # promedio. En el máximo, una celda por píxel, sin inventar
            # valores (vecino más cercano) o suave para el relieve.
            rs = capa["remuestreo_fino"] if z == zmax else Resampling.average
            escritas = 0
            for x, y in teselas_en(bbox, z):
                a = leer_tesela(fuente, x, y, z, rs, sin_dato)
                if not np.isfinite(a).any():
                    continue                         # tesela vacía: no se guarda
                if capa.get("redondeo"):
                    a = np.round(a / capa["redondeo"]) * capa["redondeo"]
                if capa["rellenar_con"] is not None:
                    a = np.where(np.isfinite(a), a, capa["rellenar_con"])
                else:
                    minimo = min(minimo, float(np.nanmin(a)))
                    maximo = max(maximo, float(np.nanmax(a)))
                teselas.append((zxy_to_tileid(z, x, y),
                                a_imagen(codificar(a, capa["escala"]), formato)))
                escritas += 1
            print("  z%-2d %4d teselas" % (z, escritas))

    inclusivos = capa.get("cortes_inclusivos", False)
    comunas = resumen_por_comuna(ruta_fuente, region, cortes, inclusivos) if cortes else []

    os.makedirs(salida, exist_ok=True)
    ruta = os.path.join(salida, "%s.pmtiles" % nombre)
    teselas.sort(key=lambda t: t[0])                 # PMTiles las quiere en orden
    with open(ruta, "wb") as f:
        w = Writer(f)
        for tileid, datos in teselas:
            w.write_tile(tileid, datos)
        w.finalize(
            {
                "tile_type": TileType.WEBP if formato == "WEBP" else TileType.PNG,
                "tile_compression": Compression.NONE,
                "min_zoom": zmin, "max_zoom": zmax,
                "min_lon_e7": int(bbox[0] * 1e7), "min_lat_e7": int(bbox[1] * 1e7),
                "max_lon_e7": int(bbox[2] * 1e7), "max_lat_e7": int(bbox[3] * 1e7),
                "center_zoom": zmin + 2,
                "center_lon_e7": int((bbox[0] + bbox[2]) / 2 * 1e7),
                "center_lat_e7": int((bbox[1] + bbox[3]) / 2 * 1e7),
            },
            {
                "name": "TerraFoco · %s" % nombre,
                "description": capa["descripcion"],
                "attribution": "TerraFoco",
                "codificacion": "mapbox",
                "escala": capa["escala"],
                "unidad": capa["unidad"],
                "tamano_tesela": TAMANO,
                "cortes": cortes,
                "cortes_inclusivos": inclusivos,
                "comunas": comunas,
                "minimo": None if not math.isfinite(minimo) else round(minimo, 2),
                "maximo": None if not math.isfinite(maximo) else round(maximo, 2),
            },
        )
    peso = os.path.getsize(ruta)
    print("[teselas] -> %s  %d teselas, %.1f MB, %.0f s, %d comunas resumidas"
          % (ruta, len(teselas), peso / 1e6, time.time() - t0, len(comunas)))
    return ruta


def main():
    p = argparse.ArgumentParser(description="Teselas de valores (PMTiles) para el visor")
    p.add_argument("capas", nargs="*", choices=sorted(CAPAS), help="capas a generar")
    p.add_argument("--todas", action="store_true")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--zmin", type=int, default=None)
    p.add_argument("--zmax", type=int, default=None)
    p.add_argument("--salida", default=DIR_SALIDA)
    args = p.parse_args()

    capas = sorted(CAPAS) if args.todas else args.capas
    if not capas:
        p.error("indicar al menos una capa, o --todas")
    region = obtener_region(args.region)
    for nombre in capas:
        generar(nombre, region, args.zmin, args.zmax, args.salida)
    return 0


if __name__ == "__main__":
    sys.exit(main())
