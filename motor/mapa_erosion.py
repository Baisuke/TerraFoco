# -*- coding: utf-8 -*-
"""
Mapa de erosión por píxel: el detalle que el promedio comunal esconde.

Combina los cinco factores a resolución de 30 m:

    A_pixel = R_comuna x K_comuna x P_comuna x LS_pixel x C_pixel

R, K y P son constantes de la comuna —clima, suelo e intervención se estiman a
esa escala—. LS sale del modelo de elevación y C del NDVI de Sentinel-2, y esos
dos SI varian dentro de la comuna. Son justamente los que mandan: una ladera
desnuda y empinada erosiona veinte veces mas que el fondo de valle vecino.

POR QUE IMPORTA
---------------
El SIRSD-S bonifica **predios, no comunas**. Un encargado que ve "Navidad: 25,9
t/ha" no sabe donde poner los recursos dentro de Navidad. Este raster responde
esa pregunta, y es la escala a la que se toman las decisiones del programa.

SOBRE LA REJILLA
----------------
Se usa la del NDVI como referencia y el LS se remuestrea a ella. Ambos estan a
30 m y en UTM 19S, pero con origenes distintos: el NDVI se pide sobre la
envolvente de cada comuna y el modelo de elevacion cubre la region completa.

Uso:
    python -m mapa_erosion --simular
    python -m mapa_erosion --png
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

import config
from bd import Bitacora, conexion, obtener_region
from indicadores.almacen import leer
from indicadores.rusle import CLASES
from indicadores.terreno import ls_desde_pendiente, pendiente_horn

NODATO = -9999.0

# Rampa por clase de erosion, en el mismo orden que CLASES.
#
# Son EXACTAMENTE los colores de `paleta.js` en el prototipo (paletas.erosion).
# No se inventa una rampa nueva: la pantalla ya tiene una leyenda con esas
# clases, y dos leyendas con colores distintos para lo mismo confunden mas que
# no tener ninguna. Si cambia una, tiene que cambiar la otra.
RAMPA = [
    (10.0, (251, 243, 227)),        # Ligera      #FBF3E3
    (18.0, (245, 220, 174)),        # Moderada    #F5DCAE
    (26.0, (235, 174,  99)),        # Severa      #EBAE63
    (34.0, (215,  94,  36)),        # Muy severa  #D75E24
    (float("inf"), (152, 56, 15)),  # Extrema     #98380F
]

SQL_COMUNAS = """
SELECT id_comuna, nombre FROM territorio.comuna WHERE id_region = %s
"""


def ls_en_rejilla(ruta_dem, destino_transform, destino_forma, crs):
    """Calcula LS sobre el modelo de elevación y lo lleva a la rejilla dada.

    La pendiente se calcula ANTES de remuestrear: hacerlo al revés suavizaría
    la elevación primero y aplanaría las laderas, que es lo que más pesa aquí.
    """
    import rasterio
    from rasterio.warp import Resampling, reproject
    from rasterio.windows import Window, from_bounds
    from rasterio.transform import array_bounds

    minx, miny, maxx, maxy = array_bounds(destino_forma[0], destino_forma[1],
                                          destino_transform)

    with rasterio.open(ruta_dem) as dem:
        dx, dy = abs(dem.transform.a), abs(dem.transform.e)
        margen_x, margen_y = 4 * dx, 4 * dy
        ventana = from_bounds(minx - margen_x, miny - margen_y,
                              maxx + margen_x, maxy + margen_y, dem.transform)
        ventana = ventana.round_offsets().round_lengths()
        ventana = ventana.intersection(Window(0, 0, dem.width, dem.height))
        if ventana.width < 3 or ventana.height < 3:
            return None

        elev = dem.read(1, window=ventana).astype("float64")
        if dem.nodata is not None:
            elev[elev == dem.nodata] = np.nan
        origen_transform = dem.window_transform(ventana)

    ls = ls_desde_pendiente(pendiente_horn(elev, dx, dy)).astype("float32")

    salida = np.full(destino_forma, np.nan, dtype="float32")
    reproject(source=ls, destination=salida,
              src_transform=origen_transform, src_crs=crs,
              dst_transform=destino_transform, dst_crs=crs,
              src_nodata=np.nan, dst_nodata=np.nan,
              resampling=Resampling.bilinear)
    return salida


def c_desde_ndvi(ndvi):
    """Van der Knijff, vectorizado. NDVI no válido queda en NaN."""
    v = np.where(np.isfinite(ndvi), ndvi, np.nan)
    v = np.clip(v, -1.0, 0.999)
    c = np.where(v <= 0, 1.0, np.exp(-2.0 * v / (1.0 - v)))
    return np.where(np.isfinite(v), c, np.nan).astype("float32")


def colorear(a):
    """Erosión -> RGBA. Transparente donde no hay dato."""
    alto, ancho = a.shape
    rgba = np.zeros((4, alto, ancho), dtype="uint8")
    valido = np.isfinite(a)

    anterior = -np.inf
    for limite, (r, g, b) in RAMPA:
        tramo = valido & (a > anterior) & (a <= limite)
        rgba[0][tramo] = r
        rgba[1][tramo] = g
        rgba[2][tramo] = b
        anterior = limite
    rgba[3][valido] = 235      # algo de transparencia para ver el mapa base
    return rgba


def escribir_png(rgba, transform, crs, destino):
    """RGBA -> PNG en coordenadas geográficas, con sus límites en lon/lat.

    Se reproyecta a EPSG:4326 antes de convertir. MapLibre coloca una imagen
    dando sus cuatro esquinas en lon/lat: si el PNG siguiera en UTM, esas
    esquinas formarían un cuadrilátero girado y la capa quedaría torcida sobre
    el mapa base, con un desfase que crece hacia los bordes de la comuna.

    GDAL solo crea PNG por copia, así que el camino es GeoTIFF -> warp -> PNG.
    """
    import rasterio

    tmp = destino + ".tmp.tif"
    geo = destino + ".geo.tif"
    perfil = {"driver": "GTiff", "height": rgba.shape[1], "width": rgba.shape[2],
              "count": 4, "dtype": "uint8", "crs": crs, "transform": transform}
    try:
        with rasterio.open(tmp, "w", **perfil) as d:
            d.write(rgba)
        subprocess.run([
            "gdalwarp", "-t_srs", "EPSG:4326", "-r", "near",
            "-dstalpha", "-overwrite", "-q", tmp, geo,
        ], check=True, capture_output=True)
        with rasterio.open(geo) as d:
            b = d.bounds
        subprocess.run(["gdal_translate", "-of", "PNG", "-q", geo, destino],
                       check=True, capture_output=True)
    finally:
        for extra in (tmp, geo, destino + ".aux.xml"):
            if os.path.exists(extra):
                os.remove(extra)

    # Orden que espera MapLibre: superior izquierda, superior derecha,
    # inferior derecha, inferior izquierda.
    esquinas = [[b.left, b.top], [b.right, b.top],
                [b.right, b.bottom], [b.left, b.bottom]]
    return os.path.getsize(destino), esquinas


def procesar(id_comuna, nombre, factores, args, crs):
    import rasterio
    from rasterio.transform import array_bounds
    from rasterio.warp import Resampling, reproject

    ruta_ndvi = os.path.join(args.ndvi_dir, "ndvi_%d.tif" % id_comuna)
    if not os.path.exists(ruta_ndvi):
        return None, "sin raster de NDVI"

    faltan = [f for f in ("R", "K", "P") if f not in factores]
    if faltan:
        return None, "faltan factores %s" % ",".join(faltan)

    with rasterio.open(ruta_ndvi) as d:
        ndvi = d.read(1).astype("float32")
        ndvi[ndvi == d.nodata] = np.nan
        transform, forma = d.transform, (d.height, d.width)

    ls = ls_en_rejilla(args.dem, transform, forma, crs)
    if ls is None:
        return None, "la comuna cae fuera del modelo de elevacion"

    c = c_desde_ndvi(ndvi)
    constante = factores["R"] * factores["K"] * factores["P"]
    a = (constante * ls * c).astype("float32")

    if args.mascara and os.path.exists(args.mascara):
        evaluado = np.zeros(forma, dtype="uint8")
        with rasterio.open(args.mascara) as m:
            reproject(source=rasterio.band(m, 1), destination=evaluado,
                      src_transform=m.transform, src_crs=m.crs,
                      dst_transform=transform, dst_crs=m.crs,
                      resampling=Resampling.nearest)
        a = np.where(evaluado == 1, a, np.nan)

    validos = np.isfinite(a)
    if not validos.any():
        return None, "sin pixeles validos"

    os.makedirs(args.salida, exist_ok=True)
    ruta_tif = os.path.join(args.salida, "erosion_%d.tif" % id_comuna)
    perfil = {"driver": "GTiff", "height": forma[0], "width": forma[1],
              "count": 1, "dtype": "float32", "crs": crs,
              "transform": transform, "nodata": NODATO,
              "compress": "DEFLATE", "tiled": True}
    with rasterio.open(ruta_tif, "w", **perfil) as d:
        d.write(np.where(validos, a, NODATO).astype("float32"), 1)

    v = a[validos]
    minx, miny, maxx, maxy = array_bounds(forma[0], forma[1], transform)
    info = {
        "id_comuna": id_comuna, "nombre": nombre,
        "mediana": float(np.median(v)),
        "p90": float(np.percentile(v, 90)),
        "maximo": float(v.max()),
        "pixeles": int(validos.sum()),
        "resolucion_m": abs(transform.a),
        "limites_utm": [minx, miny, maxx, maxy],
        "epsg": int(str(crs).split(":")[-1]),
    }

    if args.png:
        ruta_png = os.path.join(args.salida, "erosion_%d.png" % id_comuna)
        peso, esquinas = escribir_png(colorear(a), transform, crs, ruta_png)
        info["png_bytes"] = peso
        info["png"] = "erosion_%d.png" % id_comuna
        info["esquinas"] = esquinas
    return info, None


def main():
    p = argparse.ArgumentParser(description="Raster de erosion por pixel")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--dem", default="/datos/srtm/dem_utm.tif")
    p.add_argument("--ndvi-dir", default="/datos/ndvi")
    p.add_argument("--mascara", default="/datos/mascara_ciren.tif")
    p.add_argument("--salida", default="/datos/erosion")
    p.add_argument("--png", action="store_true",
                   help="ademas del GeoTIFF, generar el PNG coloreado")
    p.add_argument("--limite", type=int, default=0)
    p.add_argument("--simular", action="store_true",
                   help="no escribe indice; los rasteres se generan igual")
    args = p.parse_args()

    region = obtener_region(args.region)
    with conexion() as con:
        comunas = con.execute(SQL_COMUNAS, (args.region,)).fetchall()
    if args.limite:
        comunas = comunas[:args.limite]

    factores = leer(args.region)
    crs = "EPSG:%d" % region.epsg_trabajo
    print("[mapa] %s — %d comunas, rejilla del NDVI, %s"
          % (region.nombre, len(comunas), crs))

    resultados, fallos = [], []
    with Bitacora("Mapa de erosion por pixel — %s" % region.nombre) as b:
        for i, (id_comuna, nombre) in enumerate(comunas, 1):
            info, motivo = procesar(id_comuna, nombre,
                                    factores.get(id_comuna, {}), args, crs)
            if info is None:
                print("  %2d/%d  %-22s %s" % (i, len(comunas), nombre[:22], motivo))
                fallos.append(nombre)
                continue
            resultados.append(info)
            print("  %2d/%d  %-22s mediana %7.2f  p90 %8.2f  max %9.2f  (%d px)"
                  % (i, len(comunas), nombre[:22], info["mediana"],
                     info["p90"], info["maximo"], info["pixeles"]))
            sys.stdout.flush()
        b.registros = len(resultados)

    if resultados and not args.simular:
        indice = os.path.join(args.salida, "indice.json")
        with open(indice, "w", encoding="utf-8") as f:
            json.dump({"region": args.region, "comunas": resultados},
                      f, ensure_ascii=False, indent=1)
        print("\n[mapa] indice escrito en %s" % indice)

    if resultados:
        med = sorted(r["mediana"] for r in resultados)
        p90 = sorted(r["p90"] for r in resultados)
        print("\n[mapa] %d comunas con raster" % len(resultados))
        print("       mediana entre %.2f y %.2f t/ha/anio" % (med[0], med[-1]))
        print("       percentil 90 entre %.2f y %.2f" % (p90[0], p90[-1]))
        print("       La diferencia entre mediana y p90 es el detalle que el")
        print("       promedio comunal borraba: ahi estan las laderas criticas.")
    if fallos:
        print("[mapa] %d sin generar: %s" % (len(fallos), ", ".join(fallos[:6])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
