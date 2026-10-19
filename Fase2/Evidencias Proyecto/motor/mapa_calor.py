# -*- coding: utf-8 -*-
"""
Mapa de temperatura superficial por píxel, para el detalle intracomunal.

Mismo papel que mapa_erosion.py y mapa_inundacion.py en los otros dos
módulos: recorta por comuna, colorea por clase con la MISMA rampa que usa el
prototipo y escribe un PNG en coordenadas geográficas con sus cuatro
esquinas, para que MapLibre lo coloque sin servidor de mapas. El índice va en
indice.json y en indice.js —copia idéntica servida como <script>— porque
file:// no permite fetch() de archivos locales.

Por qué hace falta: el promedio comunal esconde justo lo que busca el módulo.
Rancagua promedia 27,7 °C, pero su décimo más caliente pasa de 32 °C. Esa
diferencia DENTRO de la ciudad es la isla de calor, y en el coropleto comunal
no se ve: al acercarse, la comuna era un solo color.

    python -m mapa_calor --png
    python -m mapa_calor --png --comunas 6101 6106

Usa el mismo compuesto que ingesta.ecostress —media por celda de las escenas
de verano en disco, con nube y agua descartadas—, así que el PNG y el valor
comunal de indicadores.urbano salen del mismo dato. No descarga nada.
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from rasterio.windows import Window, from_bounds

import config
from bd import obtener_region
from ingesta.ecostress import DIR_POR_DEFECTO, escenas, promedio_de_escenas
from ingesta.zonal import geometrias_comunas, limites
from mapa_erosion import escribir_png

# Cortes absolutos, cada 3 °C, y no cuartiles. Con cuartiles cada comuna
# tendría su propia escala y la misma celda sería "cálida" en Rancagua y
# "fresca" en Graneros; con grados, el color significa lo mismo en todo el
# mapa y la leyenda se lee sin explicar el método. Salen del compuesto del
# verano 2025: los percentiles 20-80 de la conurbación caen entre 20 y 28 °C,
# y el núcleo de Rancagua y Graneros supera los 31.
CORTES = (22.0, 25.0, 28.0, 31.0)
CLASES = ("Fresca", "Templada", "Cálida", "Muy cálida", "Extrema")
RANGOS = ("< 22", "22 – 25", "25 – 28", "28 – 31", "31 +")

# Rampa 'calor' de js/paleta.js, en el mismo orden. Si cambia allá, cambia aquí.
COLORES = (
    (253, 244, 224),   # #FDF4E0
    (248, 212, 138),   # #F8D48A
    (239, 164,  60),   # #EFA43C
    (215,  94,  36),   # #D75E24
    (155,  47,  18),   # #9B2F12
)

# La conurbación que analiza el módulo 3: GT.conurbacion en el prototipo.
CONURBACION = (6101, 6102, 6105, 6106, 6108, 6110, 6111)

DIR_SALIDA = os.path.join(config.DIR_DATOS, "calor", "png")


def clasificar_arreglo(a):
    """Clase 0..4 por celda; -1 donde no hay dato."""
    clase = np.full(a.shape, -1, dtype="int8")
    valido = np.isfinite(a)
    clase[valido] = np.searchsorted(np.asarray(CORTES), a[valido], side="right")
    return clase


def colorear(a):
    """Temperatura -> RGBA por clase. Transparente donde no hay dato."""
    clase = clasificar_arreglo(a)
    rgba = np.zeros((4,) + a.shape, dtype="uint8")
    for i, (r, g, b) in enumerate(COLORES):
        tramo = clase == i
        rgba[0][tramo] = r
        rgba[1][tramo] = g
        rgba[2][tramo] = b
    rgba[3][clase >= 0] = 235             # mismo alfa que los otros dos mapas
    return rgba


def celdas_de_la_comuna(geo, tamano):
    """Cuántas celdas ocuparía la comuna completa a esta resolución.

    Hace falta para la cobertura: la tesela de ECOSTRESS no alcanza a cubrir
    Machalí entero, y contar solo las celdas que caen dentro de la tesela
    daría 100% siempre.
    """
    minx, miny, maxx, maxy = limites(geo)
    ancho = int(math.ceil((maxx - minx) / tamano))
    alto = int(math.ceil((maxy - miny) / tamano))
    t = from_origin(minx, maxy, tamano, tamano)
    return int(geometry_mask([geo], out_shape=(alto, ancho), transform=t, invert=True).sum())


def procesar(media, perfil, id_comuna, nombre, geo, salida, png):
    """Recorta el compuesto a la comuna y devuelve su ficha; escribe el PNG si toca."""
    t = perfil["transform"]
    minx, miny, maxx, maxy = limites(geo)
    ventana = from_bounds(minx, miny, maxx, maxy, t).round_offsets().round_lengths()
    ventana = ventana.intersection(Window(0, 0, media.shape[1], media.shape[0]))
    if ventana.width < 1 or ventana.height < 1:
        return None

    (f0, f1), (c0, c1) = ventana.toranges()
    a = media[int(f0):int(f1), int(c0):int(c1)].astype("float64")
    transform = rasterio.windows.transform(ventana, t)
    dentro = geometry_mask([geo], out_shape=a.shape, transform=transform, invert=True)
    a[~dentro] = np.nan

    v = a[np.isfinite(a)]
    # Menos de cien celdas es una esquina de la comuna asomando en la tesela.
    # Mismo umbral que ingesta.ecostress.por_comuna.
    if v.size < 100:
        return None

    clases = clasificar_arreglo(v)
    info = {
        "id_comuna": id_comuna, "nombre": nombre,
        "celdas": int(v.size),
        "resolucion_m": round(abs(t.a), 1),
        "cobertura": round(v.size / max(1, celdas_de_la_comuna(geo, abs(t.a))), 3),
        "media": round(float(v.mean()), 2),
        "p10": round(float(np.percentile(v, 10)), 2),
        "p90": round(float(np.percentile(v, 90)), 2),
        "fraccion": {n: round(float((clases == i).mean()), 3)
                     for i, n in enumerate(CLASES)},
    }
    if png:
        ruta_png = os.path.join(salida, "calor_%d.png" % id_comuna)
        peso, esquinas = escribir_png(colorear(a), transform, perfil["crs"], ruta_png)
        info["png"] = os.path.basename(ruta_png)
        info["png_bytes"] = peso
        info["esquinas"] = esquinas
    return info


RUTA_COMPUESTO = os.path.join(config.DIR_DATOS, "calor", "temperatura_superficial.tif")


def escribir_compuesto(media, perfil, ruta=RUTA_COMPUESTO):
    """El compuesto de verano como GeoTIFF, para las teselas del visor.

    Es el mismo arreglo con que se hacen los PNG y el valor comunal: guardarlo
    evita que teselas.py tenga que volver a promediar las escenas.
    """
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    salida = np.where(np.isfinite(media), media, -9999.0).astype("float32")
    with rasterio.open(ruta, "w", driver="GTiff", width=salida.shape[1],
                       height=salida.shape[0], count=1, dtype="float32",
                       crs=perfil["crs"], transform=perfil["transform"],
                       nodata=-9999.0, compress="deflate", predictor=3) as d:
        d.write(salida, 1)
    print("[calor] compuesto -> %s" % ruta)


def main():
    p = argparse.ArgumentParser(description="Mapa de temperatura superficial por píxel")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--dir", default=DIR_POR_DEFECTO, help="escenas ECOSTRESS en disco")
    p.add_argument("--salida", default=DIR_SALIDA)
    p.add_argument("--comunas", type=int, nargs="*", default=list(CONURBACION),
                   help="códigos INE; por defecto la conurbación de Rancagua")
    p.add_argument("--png", action="store_true", help="escribir los PNG, no solo el índice")
    args = p.parse_args()

    region = obtener_region(args.region)
    print("[calor] %s" % region.nombre)
    rutas = escenas(args.dir)
    if not rutas:
        raise SystemExit("No hay escenas de verano en %s. Descargarlas con:\n"
                         "  python -m ingesta.ecostress --descargar --guardar" % args.dir)
    media, perfil, usadas = promedio_de_escenas(rutas)
    if media is None:
        raise SystemExit("Ninguna escena aportó celdas válidas.")
    print("[calor] %d escenas promediadas · cortes %s °C" % (usadas, CORTES))
    os.makedirs(args.salida, exist_ok=True)
    escribir_compuesto(media, perfil)

    epsg = int(str(perfil["crs"]).split(":")[-1])
    geometrias = [g for g in geometrias_comunas(region.id_region, epsg)
                  if g[0] in set(args.comunas)]

    resultados = []
    for id_comuna, nombre, geo in geometrias:
        info = procesar(media, perfil, id_comuna, nombre, geo, args.salida, args.png)
        if info is None:
            print("  %-22s fuera de la tesela" % nombre[:22])
            continue
        resultados.append(info)
        print("  %-22s media %5.1f  p10 %5.1f  p90 %5.1f  cobertura %3.0f%%%s"
              % (nombre[:22], info["media"], info["p10"], info["p90"],
                 100 * info["cobertura"],
                 ("  %d KB" % (info["png_bytes"] // 1024)) if args.png else ""))

    indice = {"region": region.id_region, "variable": "temperatura_superficial",
              "fuente": "ECOSTRESS ECO_L2T_LSTE, media de %d escenas de verano" % usadas,
              "clases": list(CLASES), "rangos": list(RANGOS), "cortes": list(CORTES),
              "unidad": "°C", "comunas": resultados}
    with open(os.path.join(args.salida, "indice.json"), "w", encoding="utf-8") as f:
        json.dump(indice, f, ensure_ascii=False, indent=1)
    with open(os.path.join(args.salida, "indice.js"), "w", encoding="utf-8") as f:
        f.write("/* TerraFoco - Temperatura superficial por pixel, generado por\n"
                "   mapa_calor.py. Copia identica de indice.json, servida como\n"
                "   <script> para que el detalle funcione abierto desde el disco:\n"
                "   file:// no permite fetch() de archivos locales. */\n")
        f.write("window.TERRAFOCO_CALOR = ")
        json.dump(indice, f, ensure_ascii=False)
        f.write(";\n")
    print("\n[calor] %d comunas -> %s/indice.json (+ indice.js)" % (len(resultados), args.salida))
    return 0


if __name__ == "__main__":
    sys.exit(main())
