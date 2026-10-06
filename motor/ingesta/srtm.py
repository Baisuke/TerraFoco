# -*- coding: utf-8 -*-
"""
Descarga del modelo digital de elevación desde NASA Earthdata.

Se usa NASADEM y no SRTM crudo: es el reprocesamiento oficial del mismo dato,
con los vacíos rellenados y mejor georreferenciación.

El área de descarga se lee de `territorio.region`, no está en el código.

Uso:
    python -m ingesta.srtm
    python -m ingesta.srtm --region 6
"""
import argparse
import os
import subprocess
import sys

import config
from bd import Bitacora, obtener_region

COLECCION = "NASADEM_HGT"


def descargar(region, destino):
    """Descarga las teselas que cubren el área de interés de la región."""
    try:
        import earthaccess
    except ImportError:
        raise SystemExit(
            "Falta earthaccess. Instalar con: pip install earthaccess"
        )

    config.exigir("earthdata")

    # earthaccess SOLO lee estas dos variables (mas .netrc). No acepta token:
    # se verifico sobre el codigo de la version instalada. Poner el token aqui
    # no da error, simplemente no se usa y la descarga falla mas adelante
    # pidiendo credenciales, que es peor que fallar de entrada.
    os.environ.setdefault("EARTHDATA_USERNAME", config.EARTHDATA_USER)
    os.environ.setdefault("EARTHDATA_PASSWORD", config.EARTHDATA_PASS)
    earthaccess.login(strategy="environment")

    print("[srtm] buscando teselas para %s" % region.nombre)
    print("[srtm] bbox %s" % (region.bbox,))
    resultados = earthaccess.search_data(
        short_name=COLECCION,
        bounding_box=region.bbox,
    )
    print("[srtm] %d teselas encontradas" % len(resultados))

    os.makedirs(destino, exist_ok=True)
    archivos = earthaccess.download(resultados, destino)
    print("[srtm] %d archivos descargados en %s" % (len(archivos), destino))
    return archivos


def preparar(directorio, region, destino=None):
    """Descomprime, une las teselas y reproyecta a metros.

    NASADEM llega en teselas de 1 grado, comprimidas y en coordenadas
    geograficas. Los tres pasos son obligatorios y en este orden:

      1. Descomprimir los .zip y sacar los .hgt
      2. Unirlos en un mosaico virtual (VRT), que no copia datos
      3. Reproyectar al EPSG de trabajo de la region

    El paso 3 no es opcional: con el modelo en grados, el tamano de celda que
    lee `zonal` estaria en grados y la pendiente saldria equivocada por un
    factor enorme. `zonal` lo rechaza a proposito, y aqui se resuelve.
    """
    import glob
    import zipfile

    destino = destino or os.path.join(directorio, "dem_utm.tif")
    crudos = os.path.join(directorio, "crudos")
    os.makedirs(crudos, exist_ok=True)

    zips = sorted(glob.glob(os.path.join(directorio, "*.zip")))
    for z in zips:
        with zipfile.ZipFile(z) as f:
            # Solo el modelo de elevacion: el paquete trae ademas capas de
            # numero de observaciones y mascara de agua que no se usan.
            for nombre in f.namelist():
                if nombre.lower().endswith(".hgt"):
                    f.extract(nombre, crudos)
    hgts = sorted(glob.glob(os.path.join(crudos, "**", "*.hgt"), recursive=True))
    print("[srtm] %d zips -> %d teselas .hgt" % (len(zips), len(hgts)))
    if not hgts:
        raise SystemExit("No se encontraron archivos .hgt en %s" % directorio)

    vrt = os.path.join(directorio, "mosaico.vrt")
    subprocess.run(["gdalbuildvrt", "-overwrite", vrt] + hgts,
                   check=True, capture_output=True)

    print("[srtm] reproyectando a EPSG:%d" % region.epsg_trabajo)
    subprocess.run([
        "gdalwarp", "-t_srs", "EPSG:%d" % region.epsg_trabajo,
        "-tr", str(region.resolucion_m), str(region.resolucion_m),
        # Bilineal y no vecino mas cercano: al derivar la pendiente, los
        # escalones del vecino mas cercano producen bandas artificiales.
        "-r", "bilinear",
        "-dstnodata", "-32768",
        "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES",
        "-overwrite", vrt, destino,
    ], check=True, capture_output=True)

    tam = os.path.getsize(destino) / 1e6
    print("[srtm] listo: %s (%.1f MB)" % (destino, tam))
    return destino


def cargar_a_postgis(patron_tif, tabla="operacion.cobertura_raster_cruda"):
    """Carga el raster troceado.

    El `-t 256x256` no es opcional: sin trocear, una región completa entra
    como una sola fila y cualquier consulta espacial se vuelve inservible.
    """
    orden = (
        "raster2pgsql -s %d -I -C -M -t %dx%d -F %s %s | psql %s"
        % (config.EPSG_ALMACENAMIENTO, config.TAMANO_TESELA,
           config.TAMANO_TESELA, patron_tif, tabla, config.BD_URL)
    )
    print("[srtm] %s" % orden)
    subprocess.run(orden, shell=True, check=True)


def main():
    p = argparse.ArgumentParser(description="Descarga NASADEM para una región")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--destino", default=os.path.join(config.DIR_DATOS, "srtm"))
    p.add_argument("--cargar", action="store_true",
                   help="además, cargar los .tif descargados a PostGIS")
    p.add_argument("--preparar", action="store_true",
                   help="descomprimir, unir y reproyectar lo ya descargado")
    p.add_argument("--solo-preparar", action="store_true",
                   help="omitir la descarga; usar los .zip que ya estan")
    args = p.parse_args()

    region = obtener_region(args.region)

    if args.solo_preparar:
        preparar(args.destino, region)
        return 0

    with Bitacora("Ingesta NASADEM — %s" % region.nombre, fuente="nasadem") as b:
        archivos = descargar(region, args.destino)
        b.registros = len(archivos)
        if args.preparar:
            preparar(args.destino, region)
        if args.cargar:
            cargar_a_postgis(os.path.join(args.destino, "*.tif"))

    return 0


if __name__ == "__main__":
    sys.exit(main())
