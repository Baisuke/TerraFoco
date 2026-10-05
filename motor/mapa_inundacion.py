# -*- coding: utf-8 -*-
"""
Mapa de susceptibilidad a inundación por píxel, para el detalle intracomunal.

Mismo papel que mapa_erosion.py para el módulo 1: recorta el ráster de
susceptibilidad por comuna, lo colorea con la MISMA rampa que usa el
prototipo y lo escribe como PNG en coordenadas geográficas, con sus cuatro
esquinas, para que MapLibre lo coloque sin servidor de mapas. El índice de
comunas va en indice.json y en indice.js —copia idéntica servida como
<script>— porque file:// no permite fetch() de archivos locales.

    python -m mapa_inundacion --png
    python -m mapa_inundacion --png --salida /datos/inundacion/png

Requiere el ráster que deja `indicadores.inundacion`. No recalcula nada:
si el índice cambia, se corre aquel primero y este después.
"""
import argparse
import json
import os
import sys

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import from_bounds

import config
from bd import obtener_region
from indicadores.inundacion import NOMBRES_CLASE, clasificar, clasificar_arreglo
from ingesta.hidrologia import DIR_SALIDA
from ingesta.zonal import geometrias_comunas, limites
from mapa_erosion import escribir_png

# Rampa 'agua' del prototipo (js/paleta.js), del tono más claro al más
# oscuro. Cuatro clases, cuatro colores: el primero de la rampa (casi blanco)
# se reserva para el fondo. Si cambia allá, cambia aquí.
COLORES = {
    "Baja":     (188, 216, 238),   # #BCD8EE
    "Media":    (127, 182, 222),   # #7FB6DE
    "Alta":     ( 15, 105, 196),   # #0F69C4
    "Muy alta": ( 10,  58, 115),   # #0A3A73
}

RUTA_RASTER = os.path.join(DIR_SALIDA, "susceptibilidad.tif")
RUTA_METODO = os.path.join(DIR_SALIDA, "susceptibilidad.json")


def leer_metodo(ruta=RUTA_METODO):
    """Los cortes con que se clasificó el índice. Se colorea con ESOS, no con
    otros: si el PNG usara cortes distintos de los de la tabla, la misma
    celda sería 'Alta' en un sitio y 'Media' en otro."""
    if not os.path.exists(ruta):
        raise SystemExit("No existe %s. Correr primero: python -m indicadores.inundacion" % ruta)
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


def colorear(a, cortes):
    """Índice -> RGBA por clase (cuartiles). Transparente donde no hay dato."""
    alto, ancho = a.shape
    rgba = np.zeros((4, alto, ancho), dtype="uint8")
    clase = clasificar_arreglo(a, cortes)
    for i, nombre in enumerate(NOMBRES_CLASE):
        tramo = clase == i
        r, g, b = COLORES[nombre]
        rgba[0][tramo] = r
        rgba[1][tramo] = g
        rgba[2][tramo] = b
    rgba[3][clase >= 0] = 235             # algo de transparencia para ver el mapa base
    return rgba


def procesar(datos, id_comuna, nombre, geo, salida, png, metodo):
    """Recorta el índice a la comuna y devuelve su ficha; escribe el PNG si toca."""
    minx, miny, maxx, maxy = limites(geo)
    ventana = from_bounds(minx, miny, maxx, maxy, datos.transform)
    ventana = ventana.round_offsets().round_lengths()
    ventana = ventana.intersection(rasterio.windows.Window(0, 0, datos.width, datos.height))
    if ventana.width < 1 or ventana.height < 1:
        return None

    a = datos.read(1, window=ventana).astype("float64")
    a[a == datos.nodata] = np.nan
    transform = datos.window_transform(ventana)
    dentro = geometry_mask([geo], out_shape=a.shape, transform=transform, invert=True)
    a[~dentro] = np.nan

    v = a[np.isfinite(a)]
    if v.size == 0:
        return None

    cortes_pixel = tuple(metodo["cortes_pixel"])
    cortes_comuna = tuple(metodo["cortes_comuna"])
    clases_pixel = clasificar_arreglo(v, cortes_pixel)
    info = {
        "id_comuna": id_comuna, "nombre": nombre,
        "celdas": int(v.size),
        "mediana": round(float(np.median(v)), 3),
        "p90": round(float(np.percentile(v, 90)), 3),
        "media": round(float(v.mean()), 3),
        # La clase comunal es relativa entre comunas (cuartiles de las medias).
        "clase": clasificar(float(v.mean()), cortes_comuna),
        # Fracción del territorio en cada clase del píxel: lo que el detalle muestra.
        "fraccion": {n: round(float((clases_pixel == i).mean()), 3)
                     for i, n in enumerate(NOMBRES_CLASE)},
    }
    if png:
        ruta_png = os.path.join(salida, "inundacion_%d.png" % id_comuna)
        peso, esquinas = escribir_png(colorear(a, cortes_pixel), transform, datos.crs, ruta_png)
        info["png"] = os.path.basename(ruta_png)
        info["png_bytes"] = peso
        info["esquinas"] = esquinas
    return info


def main():
    p = argparse.ArgumentParser(description="Mapa de susceptibilidad por píxel")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--raster", default=RUTA_RASTER)
    p.add_argument("--salida", default=os.path.join(DIR_SALIDA, "png"))
    p.add_argument("--png", action="store_true", help="escribir los PNG, no solo el índice")
    p.add_argument("--limite", type=int, default=0, help="solo las primeras N comunas")
    args = p.parse_args()

    region = obtener_region(args.region)
    print("[mapa] %s" % region.nombre)
    if not os.path.exists(args.raster):
        raise SystemExit("No existe %s. Correr primero: python -m indicadores.inundacion" % args.raster)
    os.makedirs(args.salida, exist_ok=True)

    metodo = leer_metodo()
    print("[mapa] pesos %s · cortes del pixel %s"
          % ({k: v for k, v in metodo["pesos"].items() if v}, metodo["cortes_pixel"]))
    geometrias = geometrias_comunas(region.id_region, region.epsg_trabajo)
    if args.limite:
        geometrias = geometrias[:args.limite]

    resultados = []
    with rasterio.open(args.raster) as datos:
        for id_comuna, nombre, geo in geometrias:
            info = procesar(datos, id_comuna, nombre, geo, args.salida, args.png, metodo)
            if info is None:
                print("  %-22s sin dato" % nombre[:22])
                continue
            resultados.append(info)
            print("  %-22s mediana %.3f  p90 %.3f  %-9s%s"
                  % (nombre[:22], info["mediana"], info["p90"], info["clase"],
                     ("  %d KB" % (info["png_bytes"] // 1024)) if args.png else ""))

    indice = {"region": region.id_region, "variable": "susceptibilidad",
              "clases": list(NOMBRES_CLASE), "metodo": metodo["metodo"],
              "pesos": metodo["pesos"], "cortes_pixel": metodo["cortes_pixel"],
              "comunas": resultados}
    with open(os.path.join(args.salida, "indice.json"), "w", encoding="utf-8") as f:
        json.dump(indice, f, ensure_ascii=False, indent=1)
    with open(os.path.join(args.salida, "indice.js"), "w", encoding="utf-8") as f:
        f.write("/* TerraFoco - Indice de susceptibilidad por pixel, generado por\n"
                "   mapa_inundacion.py. Copia identica de indice.json, servida como\n"
                "   <script> para que el detalle funcione abierto desde el disco:\n"
                "   file:// no permite fetch() de archivos locales. */\n")
        f.write("window.TERRAFOCO_INUNDACION = ")
        json.dump(indice, f, ensure_ascii=False)
        f.write(";\n")
    print("\n[mapa] %d comunas -> %s/indice.json (+ indice.js)" % (len(resultados), args.salida))
    return 0


if __name__ == "__main__":
    sys.exit(main())
