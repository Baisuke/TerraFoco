# -*- coding: utf-8 -*-
"""
Las seis variables del índice de inundación, celda por celda, para el visor.

El visor ya tenía el índice a 30 m (teselas `inundacion`), pero solo el
resultado: podía decir "esta celda es Muy alta" y no POR QUÉ, ni qué pasaría
con otros pesos. Con esto el navegador tiene lo mismo que el motor usó para
calcularlo, y puede:

  - explicar una celda: cuánto aporta cada variable a su índice;
  - recalcular el índice de la comuna abierta con otros pesos, sin ir al
    servidor —la suma ponderada es barata—;
  - rehacer la validación contra los eventos para esos pesos: la media
    comunal de una suma ponderada es la suma ponderada de las medias, así
    que con la media normalizada de cada variable por comuna el ranking de
    cualquier juego de pesos es EXACTO, no una aproximación.

Dos salidas:

  /datos/teselas/inundacion_variables.pmtiles
      Solo el zoom 11 (una celda por píxel): el visor no las dibuja, las lee.
      Cada tesela es una imagen RGB de 512 x 1024 —dos bloques de 512 x 512,
      uno sobre otro—, con una variable por canal:
          arriba  R pendiente   G acumulación      B distancia a cauces
          abajo   R TWI         G curvatura        B cobertura
      (el orden de VARIABLES en indicadores.inundacion). Cada canal guarda la
      variable NORMALIZADA y ya volteada si es inversa —lo que entra a la
      suma—: 0 es sin dato y 1..255 es 0..1 en 254 pasos. Un paso es 0,004;
      el índice se guarda redondeado a la centésima, así que la cuantización
      no agrega error que se vea.

  /datos/inundacion/variables.json
      Escalas (los percentiles 2 y 98 con que se normalizó), pesos vigentes y
      los juegos de pesos del banco de recalibración, la media normalizada de
      cada variable por comuna, los eventos por comuna y una muestra de la
      región para recalcular los cortes por cuartiles con otros pesos.

Las escalas se leen de susceptibilidad.json —las mismas con que se calculó
el índice—, no se recalculan: si el índice cambia, esto se regenera después.

    python -m variables_inundacion
    python -m variables_inundacion --sin-teselas     # solo el JSON

Copiar al prototipo:
    docker cp terrafoco-motor:/datos/teselas/inundacion_variables.pmtiles prototipo/datos/teselas/
    docker cp terrafoco-motor:/datos/inundacion/variables.json prototipo/datos/inundacion/
"""
import argparse
import base64
import json
import math
import os
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
from bd import conexion, obtener_region
from indicadores.inundacion import (NOMBRES_CLASE, PESOS, PERCENTILES, VARIABLES,
                                    cortes_por_cuartiles, leer_en_rejilla)
from indicadores.recalibrar_inundacion import CANDIDATOS
from ingesta.hidrologia import DIR_SALIDA
from ingesta.zonal import geometrias_comunas, limites
from teselas import TAMANO, _formato, a_imagen, limites_mercator, teselas_en

Z = 11                                  # una celda de 30 m por píxel
PASOS = 254                             # 1..255; el 0 es "sin dato"
MUESTRA = 40000                         # celdas del recuadro para los cuartiles
SEMILLA = 20260928                      # la muestra es la misma en cada corrida

DIR_TESELAS = os.path.join(config.DIR_DATOS, "teselas")
RUTA_TIF = os.path.join(DIR_SALIDA, "variables_normalizadas.tif")
RUTA_JSON = os.path.join(DIR_SALIDA, "variables.json")

# Para el visor: nombre, unidad del valor original y cómo leerlo.
DESCRIPCION = {
    "pendiente":        ("Pendiente", "%", "Horn (1981) sobre NASADEM"),
    "acumulacion":      ("Acumulación de flujo", "log10 celdas",
                         "D8 sobre el DEM acondicionado; cuántas celdas drenan hacia esta"),
    "distancia_cauces": ("Distancia a cauces", "m",
                         "a ríos y esteros de orden Strahler 5 o más (IDE Chile)"),
    "twi":              ("Índice topográfico de humedad", "", "ln(a / tan β)"),
    "curvatura":        ("Curvatura", "1/100 m",
                         "Zevenbergen y Thorne; negativa en concavidades"),
    "cobertura":        ("Cobertura vegetal (NDVI)", "", "Sentinel-2, nov-2024 a feb-2025"),
}

SQL_EVENTOS = """
SELECT id_comuna, count(*), count(*) FILTER (WHERE anio <> 1982)
FROM   indicadores.evento_inundacion
WHERE  id_region = %s AND id_comuna IS NOT NULL
GROUP  BY id_comuna
"""


# --------------------------------------------------------------------------
# Cuantización
# --------------------------------------------------------------------------

def cuantizar(crudo, bajo, alto, sentido):
    """Valor original -> 0..255: 0 sin dato, 1..255 la variable normalizada
    (recortada a [bajo, alto], a 0-1 y volteada si es inversa)."""
    v = np.asarray(crudo, dtype="float64")
    n = np.clip((v - bajo) / (alto - bajo), 0.0, 1.0)
    if sentido < 0:
        n = 1.0 - n
    q = np.zeros(v.shape, dtype="uint8")
    ok = np.isfinite(v)
    q[ok] = (1 + np.round(n[ok] * PASOS)).astype("uint8")
    return q


def normalizada(q):
    """Inversa de cuantizar (sin el volteo: devuelve lo que entra a la suma)."""
    q = np.asarray(q, dtype="float64")
    return np.where(q > 0, (q - 1) / PASOS, np.nan)


def original(n, bajo, alto, sentido):
    """De vuelta a la unidad de origen. Aproximado dentro de [bajo, alto]; en
    los extremos el recorte a percentiles hace que solo se sepa "≤ bajo" o
    "≥ alto"."""
    n = 1.0 - n if sentido < 0 else n
    return bajo + n * (alto - bajo)


# --------------------------------------------------------------------------
# Resúmenes
# --------------------------------------------------------------------------

def medias_por_comuna(capas, perfil, region):
    """Lo necesario para la media comunal del índice con CUALQUIER juego de
    pesos, exacta.

    El motor promedia el índice sobre las celdas de la comuna donde existen
    las variables con peso, y ese conjunto cambia con el juego: sin cobertura
    entran celdas que con cobertura no. Por eso no basta una media por
    variable. Se agrupan las celdas por PATRÓN —qué variables tienen dato,
    un bit por variable— y de cada grupo se guardan las celdas y la suma de
    cada variable normalizada. Para un juego se toman los grupos que tienen
    todas sus variables con peso y se divide. En la práctica hay dos o tres
    patrones por comuna."""
    resultado = []
    alto_total, ancho_total = capas[0].shape
    for id_comuna, nombre, geo in geometrias_comunas(region.id_region, region.epsg_trabajo):
        minx, miny, maxx, maxy = limites(geo)
        try:
            v = (ventana_de(minx, miny, maxx, maxy, perfil["transform"])
                 .round_offsets().round_lengths()
                 .intersection(Window(0, 0, ancho_total, alto_total)))
        except Exception:
            continue
        filas = slice(v.row_off, v.row_off + v.height)
        cols = slice(v.col_off, v.col_off + v.width)
        dentro = geometry_mask([geo], out_shape=(v.height, v.width), invert=True,
                               transform=rasterio.windows.transform(v, perfil["transform"]))
        q = np.stack([c[filas, cols][dentro] for c in capas], axis=1)    # (celdas, 6)
        patron = ((q > 0) * (1 << np.arange(len(VARIABLES)))).sum(axis=1)
        grupos = []
        for pt in np.unique(patron):
            if not pt:
                continue
            g = q[patron == pt]
            n = normalizada(g)
            grupos.append({"patron": int(pt), "celdas": int(g.shape[0]),
                           "sumas": [round(float(np.nansum(n[:, k])), 3)
                                     for k in range(len(VARIABLES))]})
        if not grupos:
            continue
        resultado.append({"id_comuna": id_comuna, "nombre": nombre, "grupos": grupos})
    return resultado


def muestra_regional(capas, n=MUESTRA, semilla=SEMILLA):
    """n celdas al azar donde exista al menos una variable, con las seis
    cuantizadas (0 donde falte), en un solo bloque base64: [v0 .. v5] por celda.

    No se muestrea solo el dominio de las seis: el motor calcula los cortes
    por cuartiles sobre toda celda donde existan las variables CON PESO
    —con los pesos vigentes, acumulación y curvatura, que cubren todo el
    recuadro del DEM, más allá de la región—. Con la muestra así, cada juego
    de pesos filtra las celdas que el motor habría usado para ese juego."""
    alguna = np.zeros(capas[0].shape, dtype=bool)
    for c in capas:
        alguna |= c > 0
    idx = np.flatnonzero(alguna.ravel())
    rng = np.random.default_rng(semilla)
    elegidas = np.sort(rng.choice(idx, size=min(n, idx.size), replace=False))
    bloque = np.stack([c.ravel()[elegidas] for c in capas], axis=1).astype("uint8")
    return base64.b64encode(bloque.tobytes()).decode("ascii"), int(bloque.shape[0])


def indice_comunal(grupos, pesos):
    """Media comunal del índice para un juego de pesos, desde los grupos de
    medias_por_comuna. None si ninguna celda tiene todas las variables."""
    mascara = sum(1 << k for k, p in enumerate(pesos) if p)
    celdas, suma = 0, 0.0
    for g in grupos:
        if g["patron"] & mascara == mascara:
            celdas += g["celdas"]
            suma += sum(g["sumas"][k] * p / 100.0 for k, p in enumerate(pesos) if p)
    return suma / celdas if celdas else None


def indice_de_muestra(bloque, pesos):
    """Índice de las celdas de la muestra donde existen todas las variables
    con peso: las que el motor habría usado con ese juego."""
    usadas = [k for k, p in enumerate(pesos) if p]
    ok = (bloque[:, usadas] > 0).all(axis=1)
    return (normalizada(bloque[ok]) [:, usadas] * np.asarray(pesos)[usadas] / 100.0).sum(axis=1)


# --------------------------------------------------------------------------
# Teselas
# --------------------------------------------------------------------------

def tesela_de_variables(fuente, x, y):
    """Los seis canales de una tesela en una imagen de 512 x 1024 (RGB)."""
    destino = np.zeros((len(VARIABLES), TAMANO, TAMANO), dtype="uint8")
    for banda in range(len(VARIABLES)):
        reproject(
            source=rasterio.band(fuente, banda + 1), destination=destino[banda],
            src_transform=fuente.transform, src_crs=fuente.crs, src_nodata=0,
            dst_transform=from_bounds(*limites_mercator(x, y, Z), TAMANO, TAMANO),
            dst_crs="EPSG:3857", dst_nodata=0, resampling=Resampling.nearest)
    if not destino.any():
        return None
    arriba, abajo = destino[:3], destino[3:]
    return np.concatenate([arriba, abajo], axis=1)          # (3, 1024, 512)


def generar_teselas(region, metadatos, salida=DIR_TESELAS):
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer

    formato = _formato()
    teselas, t0 = [], time.time()
    with rasterio.open(RUTA_TIF) as fuente:
        fo, fs, fe, fn = transform_bounds(fuente.crs, "EPSG:4326", *fuente.bounds)
        oeste, sur, este, norte = region.bbox
        bbox = (max(oeste, fo), max(sur, fs), min(este, fe), min(norte, fn))
        for x, y in teselas_en(bbox, Z):
            img = tesela_de_variables(fuente, x, y)
            if img is None:
                continue
            teselas.append((zxy_to_tileid(Z, x, y), a_imagen(img, formato)))
    print("[variables] z%d: %d teselas %s en %.0f s" % (Z, len(teselas), formato, time.time() - t0))

    os.makedirs(salida, exist_ok=True)
    ruta = os.path.join(salida, "inundacion_variables.pmtiles")
    teselas.sort(key=lambda t: t[0])
    with open(ruta, "wb") as f:
        w = Writer(f)
        for tileid, datos in teselas:
            w.write_tile(tileid, datos)
        w.finalize(
            {
                "tile_type": TileType.WEBP if formato == "WEBP" else TileType.PNG,
                "tile_compression": Compression.NONE,
                "min_zoom": Z, "max_zoom": Z,
                "min_lon_e7": int(bbox[0] * 1e7), "min_lat_e7": int(bbox[1] * 1e7),
                "max_lon_e7": int(bbox[2] * 1e7), "max_lat_e7": int(bbox[3] * 1e7),
                "center_zoom": Z,
                "center_lon_e7": int((bbox[0] + bbox[2]) / 2 * 1e7),
                "center_lat_e7": int((bbox[1] + bbox[3]) / 2 * 1e7),
            },
            dict(metadatos, name="TerraFoco · variables del índice de inundación",
                 attribution="TerraFoco", tamano_tesela=TAMANO, alto_imagen=2 * TAMANO,
                 disposicion="arriba R,G,B = variables 0,1,2; abajo R,G,B = variables 3,4,5"),
        )
    print("[variables] -> %s (%.1f MB)" % (ruta, os.path.getsize(ruta) / 1e6))
    return ruta


# --------------------------------------------------------------------------
# Punto de entrada
# --------------------------------------------------------------------------

def leer_metodo(datos):
    ruta = os.path.join(datos, "susceptibilidad.json")
    if not os.path.exists(ruta):
        raise SystemExit("Falta %s. Calcular antes el índice: python -m indicadores.inundacion" % ruta)
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


def main():
    p = argparse.ArgumentParser(description="Variables normalizadas del índice de inundación")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--datos", default=DIR_SALIDA)
    p.add_argument("--sin-teselas", action="store_true", help="solo el JSON")
    args = p.parse_args()

    region = obtener_region(args.region)
    metodo = leer_metodo(args.datos)
    escalas = metodo["escalas"]
    print("[variables] %s" % region.nombre)

    with rasterio.open(os.path.join(args.datos, "acumulacion.tif")) as ref:
        perfil = {"transform": ref.transform, "crs": ref.crs,
                  "width": ref.width, "height": ref.height}

    capas = []
    for nombre, _peso, sentido, archivo in VARIABLES:
        bajo, alto = escalas[nombre]
        crudo = leer_en_rejilla(os.path.join(args.datos, archivo), perfil)
        q = cuantizar(crudo, bajo, alto, sentido)
        del crudo
        capas.append(q)
        print("  %-18s escala %.3f .. %.3f  %s" % (nombre, bajo, alto,
                                                   "inversa" if sentido < 0 else "directa"))

    # Comprobación: la suma ponderada de lo cuantizado reproduce los cortes
    # del índice guardado. Si no, las escalas no son las del índice.
    muestra_b64, n_muestra = muestra_regional(capas)
    bloque = np.frombuffer(base64.b64decode(muestra_b64), dtype="uint8").reshape(-1, len(VARIABLES))
    pesos = [PESOS[n] for n, _p, _s, _a in VARIABLES]
    cortes = cortes_por_cuartiles(indice_de_muestra(bloque, pesos))
    print("[variables] cortes desde la muestra: %s  (guardados: %s)"
          % (", ".join("%.3f" % c for c in cortes), metodo["cortes_pixel"]))
    if max(abs(a - b) for a, b in zip(cortes, metodo["cortes_pixel"])) > 0.01:
        raise SystemExit("Los cortes no coinciden con susceptibilidad.json: regenerar el índice.")

    comunas = medias_por_comuna(capas, perfil, region)
    with conexion() as con:
        ev = {i: (n, n82) for i, n, n82 in con.execute(SQL_EVENTOS, (region.id_region,)).fetchall()}
    for c in comunas:
        c["eventos"], c["eventos_sin_1982"] = ev.get(c["id_comuna"], (0, 0))
        c["indice"] = round(indice_comunal(c["grupos"], pesos), 5)
    print("[variables] %d comunas, %d eventos" % (len(comunas), sum(c["eventos"] for c in comunas)))

    metadatos = {
        "region": region.id_region,
        "variables": [{
            "clave": n, "nombre": DESCRIPCION[n][0], "unidad": DESCRIPCION[n][1],
            "como": DESCRIPCION[n][2], "sentido": s, "peso": pesos[k],
            "escala": [round(x, 4) for x in escalas[n]],
        } for k, (n, _p, s, _a) in enumerate(VARIABLES)],
        "cuantizacion": {"pasos": PASOS, "sin_dato": 0,
                         "lectura": "n = (q - 1) / pasos; ya volteada si la variable es inversa"},
        "percentiles": list(PERCENTILES),
        "clases": list(NOMBRES_CLASE),
        "cortes_pixel": metodo["cortes_pixel"],
        "cortes_comuna": metodo["cortes_comuna"],
        "juegos": [{"nombre": k, "pesos": list(v)} for k, v in CANDIDATOS.items()],
    }
    salida = dict(metadatos,
                  comunas=comunas,
                  muestra={"n": n_muestra, "semilla": SEMILLA, "datos": muestra_b64})
    with open(RUTA_JSON, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"))
    print("[variables] -> %s (%.0f kB)" % (RUTA_JSON, os.path.getsize(RUTA_JSON) / 1e3))

    if args.sin_teselas:
        return 0

    perfil_tif = {"driver": "GTiff", "count": len(VARIABLES), "dtype": "uint8", "nodata": 0,
                  "width": perfil["width"], "height": perfil["height"],
                  "transform": perfil["transform"], "crs": perfil["crs"],
                  "compress": "deflate", "tiled": True, "blockxsize": 512, "blockysize": 512}
    # Las teselas solo dentro de las comunas: el visor lee la comuna abierta,
    # y el resto del recuadro (Maule, la cordillera) casi duplicaba el peso.
    geos = [geo for _i, _n, geo in geometrias_comunas(region.id_region, region.epsg_trabajo)]
    fuera = geometry_mask(geos, out_shape=capas[0].shape, transform=perfil["transform"],
                          all_touched=True)
    with rasterio.open(RUTA_TIF, "w", **perfil_tif) as d:
        for k, q in enumerate(capas):
            q[fuera] = 0
            d.write(q, k + 1)
    del capas
    print("[variables] -> %s (%.0f MB)" % (RUTA_TIF, os.path.getsize(RUTA_TIF) / 1e6))
    generar_teselas(region, metadatos)
    return 0


if __name__ == "__main__":
    sys.exit(main())
