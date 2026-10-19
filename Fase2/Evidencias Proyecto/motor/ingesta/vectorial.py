# -*- coding: utf-8 -*-
"""
Carga de capas vectoriales a PostGIS.

Es el primer paso del Sprint 0 y el más importante: con las comunas cargadas
ya se puede cerrar el circuito completo sin tocar un solo raster.

Uso:
    python -m ingesta.vectorial comunas.shp --tabla territorio.comuna_cruda
"""
import argparse
import subprocess
import sys

import config
from bd import Bitacora, conexion


def inspeccionar(ruta_shp):
    """Muestra el sistema de referencia de origen ANTES de reproyectar.

    El error más caro de esta etapa es suponer el EPSG: las comunas terminan
    en medio del océano y cuesta media jornada darse cuenta.
    """
    salida = subprocess.run(
        ["ogrinfo", "-al", "-so", ruta_shp],
        capture_output=True, text=True, check=True,
    ).stdout
    for linea in salida.splitlines():
        if any(c in linea for c in ("PROJCRS", "GEOGCRS", "AUTHORITY", "Feature Count")):
            print("   ", linea.strip())
    return salida


def cargar(ruta_shp, tabla, epsg_origen=None):
    """Importa un shapefile a PostGIS reproyectando a EPSG:4326."""
    orden = [
        "ogr2ogr",
        "-f", "PostgreSQL",
        # GDAL acepta la URI completa; quitarle el esquema la deja inválida
        "PG:" + config.BD_URL,
        ruta_shp,
        "-nln", tabla,
        "-t_srs", "EPSG:%d" % config.EPSG_ALMACENAMIENTO,
        "-nlt", "MULTIPOLYGON",
        "-lco", "GEOMETRY_NAME=geom",
        "-lco", "FID=gid",
        "-overwrite",
        "-progress",
    ]
    if epsg_origen:
        orden[4:4] = ["-s_srs", "EPSG:%d" % epsg_origen]

    print("[vectorial] cargando %s -> %s" % (ruta_shp, tabla))
    subprocess.run(orden, check=True)


def verificar(tabla):
    """Comprueba lo que suele fallar: cantidad, SRID y validez geométrica."""
    with conexion() as con:
        total = con.execute("SELECT count(*) FROM %s" % tabla).fetchone()[0]
        srids = con.execute(
            "SELECT DISTINCT ST_SRID(geom) FROM %s" % tabla
        ).fetchall()
        invalidas = con.execute(
            "SELECT count(*) FROM %s WHERE NOT ST_IsValid(geom)" % tabla
        ).fetchone()[0]
        centro = con.execute(
            "SELECT round(avg(ST_X(ST_Centroid(geom)))::numeric, 2),"
            "       round(avg(ST_Y(ST_Centroid(geom)))::numeric, 2) FROM %s" % tabla
        ).fetchone()

    print("[verificacion] registros      :", total)
    print("[verificacion] SRID           :", [s[0] for s in srids])
    print("[verificacion] geom invalidas :", invalidas)
    print("[verificacion] centro medio   : lon %s, lat %s" % centro)

    problemas = []
    if total == 0:
        problemas.append("la tabla quedó vacía")
    if [s[0] for s in srids] != [config.EPSG_ALMACENAMIENTO]:
        problemas.append("hay geometrías fuera de EPSG:%d" % config.EPSG_ALMACENAMIENTO)
    if invalidas:
        problemas.append("%d geometrías inválidas — usar ST_MakeValid" % invalidas)
    if centro[0] is not None and not (-76 < centro[0] < -66):
        problemas.append(
            "el centro cae en lon %s, fuera de Chile continental: "
            "revisar el EPSG de origen" % centro[0]
        )
    return problemas


def main():
    p = argparse.ArgumentParser(description="Carga un shapefile a PostGIS")
    p.add_argument("shapefile")
    p.add_argument("--tabla", required=True, help="esquema.tabla de destino")
    p.add_argument("--epsg-origen", type=int, default=None,
                   help="forzar el EPSG de origen si el shapefile no lo declara")
    p.add_argument("--solo-inspeccionar", action="store_true")
    args = p.parse_args()

    print("[inspeccion] %s" % args.shapefile)
    inspeccionar(args.shapefile)
    if args.solo_inspeccionar:
        return 0

    with Bitacora("Carga vectorial: %s" % args.tabla) as b:
        cargar(args.shapefile, args.tabla, args.epsg_origen)
        problemas = verificar(args.tabla)
        with conexion() as con:
            b.registros = con.execute(
                "SELECT count(*) FROM %s" % args.tabla).fetchone()[0]

    if problemas:
        print("\n[!] La carga terminó con observaciones:")
        for x in problemas:
            print("    -", x)
        return 1
    print("\n[ok] Carga verificada.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
