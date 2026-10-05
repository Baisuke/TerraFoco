# -*- coding: utf-8 -*-
"""
Superficie agrícola de la región: ESA WorldCover a 10 m.

Para INDAP la pregunta de una inundación no es cuántas escuelas quedan en
zona susceptible, sino cuántas hectáreas de cultivo y de pradera —y cuántos
agricultores— quedan ahí. Este módulo trae la cobertura del suelo y la deja
en la MISMA grilla de 30 m del índice de inundación, como fracción de cada
celda:

  - cultivo  (clase 40 de WorldCover: "Cropland")
  - pradera  (clase 30: "Grassland"; en la región es en buena parte pradera
              para ganado, pero también matorral abierto: se declara así)

Los frutales y viñedos a menudo caen en "Tree cover" (10) o en cultivo
según su densidad: WorldCover no los separa, y el visor lo dice.

Fuente: ESA WorldCover 10 m 2021 v200 (CC BY 4.0), en el almacenamiento
público de la ESA en AWS, sin credenciales. Se lee solo la ventana de la
región, por bloques de filas, directo del archivo remoto (COG): no se
descargan las dos teselas de 3° completas.

Salidas:
  /datos/cobertura/agricola.tif            2 bandas uint8, % de la celda (255 sin dato)
  /datos/teselas/agricola.pmtiles          z11 para el visor: R = 1 + % cultivo,
                                           G = 1 + % pradera, 0 = fuera de las comunas
  indicadores.cobertura_agricola           ha por comuna, y cuántas sobre el corte
                                           de "Alta" del índice de inundación

    python -m ingesta.worldcover                # todo
    python -m ingesta.worldcover --simular      # calcula y resume, no escribe
    python -m ingesta.worldcover --sin-teselas
"""
import argparse
import json
import os
import subprocess
import sys
import time

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import Window
from rasterio.windows import from_bounds as ventana_de

import config
from bd import Bitacora, conexion, obtener_region
from ingesta.zonal import geometrias_comunas, limites

URL = ("https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
       "ESA_WorldCover_10m_2021_v200_%s_Map.tif")
ANIO = 2021
CLASES = (("cultivo", 40), ("pradera", 30))
DIR_SALIDA = os.path.join(config.DIR_DATOS, "cobertura")
RUTA_TIF = os.path.join(DIR_SALIDA, "agricola.tif")
RUTA_REJILLA = os.path.join(config.DIR_DATOS, "inundacion", "acumulacion.tif")
RUTA_INDICE = os.path.join(config.DIR_DATOS, "inundacion", "susceptibilidad.tif")
RUTA_METODO = os.path.join(config.DIR_DATOS, "inundacion", "susceptibilidad.json")
FILAS_POR_BLOQUE = 256
SIN_DATO = 255


def teselas_de(bbox):
    """Nombres de las teselas de 3° de WorldCover que cubren el recuadro
    (oeste, sur, este, norte). Se nombran por su esquina suroeste."""
    oeste, sur, este, norte = bbox
    nombres = []
    lat = int(np.floor(sur / 3.0) * 3)
    while lat < norte:
        lon = int(np.floor(oeste / 3.0) * 3)
        while lon < este:
            nombres.append("%s%02d%s%03d" % ("S" if lat < 0 else "N", abs(lat),
                                             "W" if lon < 0 else "E", abs(lon)))
            lon += 3
        lat += 3
    return nombres


def fracciones(bloque, clase):
    """Fracción 0..1 de la clase en cada píxel de 10 m (para promediar)."""
    return (bloque == clase).astype("float32")


def a_porcentaje(fraccion, valido):
    """De fracción a uint8 0..100, con SIN_DATO donde no hay dato."""
    salida = np.full(fraccion.shape, SIN_DATO, dtype="uint8")
    salida[valido] = np.clip(np.round(fraccion[valido] * 100), 0, 100).astype("uint8")
    return salida


def construir_vrt(nombres):
    vrt = os.path.join(DIR_SALIDA, "worldcover.vrt")
    os.makedirs(DIR_SALIDA, exist_ok=True)
    subprocess.run(["gdalbuildvrt", "-q", "-overwrite", vrt]
                   + ["/vsicurl/" + URL % n for n in nombres], check=True)
    return vrt


def remuestrear(vrt, perfil):
    """Fracción de cultivo y pradera en cada celda de la grilla de 30 m.

    Por bloques de filas: para cada bloque se lee la ventana de 10 m que lo
    cubre y se promedia cada clase sobre la celda de 30 m (Resampling.average
    de la máscara de la clase = fracción del área)."""
    alto, ancho = perfil["height"], perfil["width"]
    salida = {n: np.zeros((alto, ancho), dtype="float32") for n, _c in CLASES}
    valido = np.zeros((alto, ancho), dtype=bool)
    t0 = time.time()
    with rasterio.open(vrt) as fuente:
        for f0 in range(0, alto, FILAS_POR_BLOQUE):
            f1 = min(alto, f0 + FILAS_POR_BLOQUE)
            t = perfil["transform"]
            izq, arriba = t * (0, f0)
            der, abajo = t * (ancho, f1)
            o, s, e, n = transform_bounds(perfil["crs"], "EPSG:4326", izq, abajo, der, arriba)
            margen = 0.002
            v = (ventana_de(o - margen, s - margen, e + margen, n + margen, fuente.transform)
                 .round_offsets().round_lengths()
                 .intersection(Window(0, 0, fuente.width, fuente.height)))
            bloque = fuente.read(1, window=v)
            t_src = rasterio.windows.transform(v, fuente.transform)
            t_dst = rasterio.transform.from_origin(izq, arriba, t.a, -t.e)
            hay = np.zeros((f1 - f0, ancho), dtype="float32")
            reproject((bloque > 0).astype("float32"), hay, src_transform=t_src, src_crs=fuente.crs,
                      dst_transform=t_dst, dst_crs=perfil["crs"], resampling=Resampling.average)
            valido[f0:f1] = hay > 0.5
            for nombre, clase in CLASES:
                destino = np.zeros((f1 - f0, ancho), dtype="float32")
                reproject(fracciones(bloque, clase), destino, src_transform=t_src, src_crs=fuente.crs,
                          dst_transform=t_dst, dst_crs=perfil["crs"], resampling=Resampling.average)
                salida[nombre][f0:f1] = destino
            print("  filas %5d-%5d de %d  (%.0f s)" % (f0, f1, alto, time.time() - t0))
    return salida, valido


def por_comuna(salida, valido, perfil, region, indice=None, corte_alta=None):
    """ha de cultivo y pradera por comuna; con el índice, también las que
    quedan sobre el corte de "Alta"."""
    ha_celda = abs(perfil["transform"].a * perfil["transform"].e) / 1e4
    filas = []
    alto, ancho = valido.shape
    for id_comuna, nombre, geo in geometrias_comunas(region.id_region, region.epsg_trabajo):
        minx, miny, maxx, maxy = limites(geo)
        try:
            v = (ventana_de(minx, miny, maxx, maxy, perfil["transform"])
                 .round_offsets().round_lengths().intersection(Window(0, 0, ancho, alto)))
        except Exception:
            continue
        fs = slice(v.row_off, v.row_off + v.height)
        cs = slice(v.col_off, v.col_off + v.width)
        dentro = geometry_mask([geo], out_shape=(v.height, v.width), invert=True,
                               transform=rasterio.windows.transform(v, perfil["transform"]))
        dentro &= valido[fs, cs]
        fila = {"id_comuna": id_comuna, "nombre": nombre,
                "ha_evaluadas": round(float(dentro.sum()) * ha_celda, 1)}
        alta = None
        if indice is not None and corte_alta is not None:
            ind = indice[fs, cs]
            alta = dentro & np.isfinite(ind) & (ind >= corte_alta)
        for n, _c in CLASES:
            frac = salida[n][fs, cs]
            fila["ha_" + n] = round(float(frac[dentro].sum()) * ha_celda, 1)
            fila["ha_%s_susceptible" % n] = (round(float(frac[alta].sum()) * ha_celda, 1)
                                             if alta is not None else None)
        filas.append(fila)
    return filas


SQL_GUARDAR = """
INSERT INTO indicadores.cobertura_agricola
       (id_comuna, id_region, fuente, anio, ha_evaluadas, ha_cultivo, ha_pradera,
        ha_cultivo_susceptible, ha_pradera_susceptible, corte_susceptible)
VALUES (%(id_comuna)s, %(id_region)s, 'ESA WorldCover 10 m v200', %(anio)s, %(ha_evaluadas)s,
        %(ha_cultivo)s, %(ha_pradera)s, %(ha_cultivo_susceptible)s, %(ha_pradera_susceptible)s,
        %(corte)s)
ON CONFLICT (id_comuna, anio) DO UPDATE SET
    ha_evaluadas = EXCLUDED.ha_evaluadas, ha_cultivo = EXCLUDED.ha_cultivo,
    ha_pradera = EXCLUDED.ha_pradera,
    ha_cultivo_susceptible = EXCLUDED.ha_cultivo_susceptible,
    ha_pradera_susceptible = EXCLUDED.ha_pradera_susceptible,
    corte_susceptible = EXCLUDED.corte_susceptible, calculado_en = now()
"""


def escribir_tif(salida, valido, perfil, region):
    """Las dos bandas en %, y solo dentro de las comunas (fuera, sin dato)."""
    geos = [geo for _i, _n, geo in geometrias_comunas(region.id_region, region.epsg_trabajo)]
    fuera = geometry_mask(geos, out_shape=valido.shape, transform=perfil["transform"],
                          all_touched=True)
    perfil_tif = {"driver": "GTiff", "count": len(CLASES), "dtype": "uint8", "nodata": SIN_DATO,
                  "width": perfil["width"], "height": perfil["height"],
                  "transform": perfil["transform"], "crs": perfil["crs"],
                  "compress": "deflate", "tiled": True, "blockxsize": 512, "blockysize": 512}
    with rasterio.open(RUTA_TIF, "w", **perfil_tif) as d:
        for k, (n, _c) in enumerate(CLASES):
            banda = a_porcentaje(salida[n], valido & ~fuera)
            d.write(banda, k + 1)
    print("[worldcover] -> %s (%.0f MB)" % (RUTA_TIF, os.path.getsize(RUTA_TIF) / 1e6))


def generar_teselas(region):
    """z11, como las variables de inundación: el visor lee la comuna abierta."""
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer

    from teselas import TAMANO, _formato, a_imagen, limites_mercator, teselas_en
    z = 11
    formato = _formato()
    teselas = []
    with rasterio.open(RUTA_TIF) as fuente:
        fo, fs, fe, fn = transform_bounds(fuente.crs, "EPSG:4326", *fuente.bounds)
        oeste, sur, este, norte = region.bbox
        bbox = (max(oeste, fo), max(sur, fs), min(este, fe), min(norte, fn))
        for x, y in teselas_en(bbox, z):
            img = np.zeros((3, TAMANO, TAMANO), dtype="uint8")
            for b in range(len(CLASES)):
                dst = np.full((TAMANO, TAMANO), SIN_DATO, dtype="uint8")
                reproject(source=rasterio.band(fuente, b + 1), destination=dst,
                          src_nodata=SIN_DATO, dst_nodata=SIN_DATO,
                          dst_transform=from_bounds(*limites_mercator(x, y, z), TAMANO, TAMANO),
                          dst_crs="EPSG:3857", resampling=Resampling.nearest)
                img[b] = np.where(dst == SIN_DATO, 0, dst.astype("int16") + 1).astype("uint8")
            if not img.any():
                continue
            teselas.append((zxy_to_tileid(z, x, y), a_imagen(img, formato)))
    ruta = os.path.join(config.DIR_DATOS, "teselas", "agricola.pmtiles")
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    teselas.sort(key=lambda t: t[0])
    with open(ruta, "wb") as f:
        w = Writer(f)
        for tileid, datos in teselas:
            w.write_tile(tileid, datos)
        w.finalize(
            {"tile_type": TileType.WEBP if formato == "WEBP" else TileType.PNG,
             "tile_compression": Compression.NONE, "min_zoom": z, "max_zoom": z,
             "min_lon_e7": int(bbox[0] * 1e7), "min_lat_e7": int(bbox[1] * 1e7),
             "max_lon_e7": int(bbox[2] * 1e7), "max_lat_e7": int(bbox[3] * 1e7),
             "center_zoom": z, "center_lon_e7": int((bbox[0] + bbox[2]) / 2 * 1e7),
             "center_lat_e7": int((bbox[1] + bbox[3]) / 2 * 1e7)},
            {"name": "TerraFoco · superficie agrícola", "attribution": "ESA WorldCover 2021 (CC BY 4.0)",
             "tamano_tesela": TAMANO, "canales": ["cultivo", "pradera"],
             "codificacion": "0 = fuera de las comunas; 1 + % de la celda"},
        )
    print("[worldcover] -> %s (%d teselas, %.1f MB)" % (ruta, len(teselas), os.path.getsize(ruta) / 1e6))


def main():
    p = argparse.ArgumentParser(description="Superficie agrícola (ESA WorldCover 10 m)")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--simular", action="store_true")
    p.add_argument("--sin-teselas", action="store_true")
    args = p.parse_args()

    region = obtener_region(args.region)
    print("[worldcover] %s" % region.nombre)
    with rasterio.open(RUTA_REJILLA) as ref:
        perfil = {"transform": ref.transform, "crs": ref.crs, "width": ref.width, "height": ref.height}

    with Bitacora("Superficie agrícola ESA WorldCover — %s" % region.nombre, fuente="esa_worldcover") as b:
        nombres = teselas_de(region.bbox)
        print("[worldcover] teselas %s, grilla %d x %d" % (", ".join(nombres), perfil["width"], perfil["height"]))
        salida, valido = remuestrear(construir_vrt(nombres), perfil)

        indice, corte = None, None
        if os.path.exists(RUTA_INDICE) and os.path.exists(RUTA_METODO):
            with rasterio.open(RUTA_INDICE) as d:
                indice = d.read(1).astype("float32")
                if d.nodata is not None:
                    indice[indice == d.nodata] = np.nan
            with open(RUTA_METODO, encoding="utf-8") as f:
                corte = json.load(f)["cortes_pixel"][1]
        filas = por_comuna(salida, valido, perfil, region, indice, corte)
        del indice
        print("\n  %-20s %10s %10s %12s" % ("comuna", "ha cultivo", "ha pradera", "cultivo alta+"))
        for f in sorted(filas, key=lambda x: -x["ha_cultivo"])[:12]:
            print("  %-20s %10.0f %10.0f %12s" % (f["nombre"][:20], f["ha_cultivo"], f["ha_pradera"],
                  "%.0f" % f["ha_cultivo_susceptible"] if f["ha_cultivo_susceptible"] is not None else "-"))
        print("  región: %.0f ha de cultivo, %.0f ha de pradera"
              % (sum(f["ha_cultivo"] for f in filas), sum(f["ha_pradera"] for f in filas)))

        if args.simular:
            print("\n[worldcover] --simular: no se escribió nada.")
            b.simulada = True
            b.registros = 0
            return 0
        escribir_tif(salida, valido, perfil, region)
        with conexion() as con:
            for f in filas:
                con.execute(SQL_GUARDAR, dict(f, id_region=region.id_region, anio=ANIO, corte=corte))
        b.registros = len(filas)
        if not args.sin_teselas:
            generar_teselas(region)
    return 0


if __name__ == "__main__":
    sys.exit(main())
