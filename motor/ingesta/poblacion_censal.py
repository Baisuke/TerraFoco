# -*- coding: utf-8 -*-
"""
Población del Censo 2024 en todo el territorio: ciudad, aldea y campo.

La exposición del visor de inundaciones contaba solo población urbana, y los
usuarios de INDAP viven en el campo. El GeoPackage del Censo 2024 que ya
baja ingesta.censo trae las tres unidades con personas y viviendas:

  - manzanas urbanas   (Manzanas_CPV24, AREA_C = URBANO)       ~717 mil personas
  - manzanas de aldeas (Manzanas_CPV24, AREA_C = RURAL)         ~76 mil
  - entidades rurales  (Entidades_CPV24: caseríos, parcelas,    ~188 mil
                        fundos; polígonos de cientos de ha)

Juntas suman la región completa. La entidad rural es grande (mediana ~200
ha), así que repartir sus personas en sus celdas es una aproximación más
gruesa que en la ciudad: el visor lo declara.

Solo se leen la llave, la categoría, el nombre de la entidad y los totales
de personas y viviendas: nada a nivel de persona.

    python -m ingesta.poblacion_censal
    python -m ingesta.poblacion_censal --simular
"""
import argparse
import os
import sys

import config
from bd import Bitacora, conexion, obtener_region
from ingesta.censo import descargar, ruta_gpkg

ANIO = 2024


def leer(ruta):
    import geopandas as gpd
    mz = gpd.read_file(ruta, layer="Manzanas_CPV24",
                       columns=["CUT", "AREA_C", "MANZENT", "CATEGORIA", "ENTIDAD", "n_per", "n_vp"])
    en = gpd.read_file(ruta, layer="Entidades_CPV24",
                       columns=["CUT", "AREA_C", "MANZENT", "CATEGORIA", "ENTIDAD", "n_per", "n_vp"])
    mz["tipo"] = mz["AREA_C"].map({"URBANO": "manzana_urbana", "RURAL": "aldea"})
    en["tipo"] = "entidad_rural"
    todas = gpd.GeoDataFrame(
        __import__("pandas").concat([mz, en], ignore_index=True), crs=mz.crs).to_crs(4326)
    return todas[todas["tipo"].notna()]


def filas(gdf):
    """Tuplas listas para insertar."""
    salida = []
    for f in gdf.itertuples():
        if f.geometry is None or f.geometry.is_empty:
            continue
        salida.append((int(f.MANZENT), int(f.CUT), ANIO, f.tipo,
                       (f.CATEGORIA or None), nombre(f.ENTIDAD),
                       entero(f.n_per), entero(f.n_vp), f.geometry.wkb))
    return salida


def entero(v):
    try:
        return int(v) if v == v and v is not None else 0
    except (TypeError, ValueError):
        return 0


def nombre(v):
    """Las entidades vienen en mayúsculas; se dejan como nombre propio."""
    if not v or v != v:
        return None
    from ingesta.localidades import nombre_propio
    return nombre_propio(str(v))


SQL = """
INSERT INTO territorio.unidad_censal
       (id_unidad, id_comuna, anio, tipo, categoria, nombre, personas, viviendas, geom)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s,
        ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromWKB(%s), 4326)), 3)))
ON CONFLICT (id_unidad) DO UPDATE SET
    id_comuna = EXCLUDED.id_comuna, anio = EXCLUDED.anio, tipo = EXCLUDED.tipo,
    categoria = EXCLUDED.categoria, nombre = EXCLUDED.nombre, personas = EXCLUDED.personas,
    viviendas = EXCLUDED.viviendas, geom = EXCLUDED.geom, cargado_en = now()
"""


def main():
    p = argparse.ArgumentParser(description="Población del Censo 2024, urbana y rural")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--simular", action="store_true")
    args = p.parse_args()

    region = obtener_region(args.region)
    with Bitacora("Población Censo 2024 urbana y rural — %s" % region.nombre,
                  fuente="ine_censo2024") as b:
        ruta = ruta_gpkg(region.id_region)
        if not os.path.exists(ruta):
            ruta = descargar(region.id_region)
        gdf = leer(ruta)
        resumen = gdf.groupby("tipo")["n_per"].agg(["count", "sum"])
        for tipo, r in resumen.iterrows():
            print("  %-15s %6d unidades  %9d personas" % (tipo, r["count"], r["sum"]))
        print("  total            %9d personas" % gdf["n_per"].sum())
        if args.simular:
            b.simulada = True
            b.registros = 0
            return 0
        f = filas(gdf)
        with conexion() as con:
            comunas = {r[0] for r in con.execute(
                "SELECT id_comuna FROM territorio.comuna WHERE id_region = %s", (region.id_region,))}
            f = [x for x in f if x[1] in comunas]
            con.execute("DELETE FROM territorio.unidad_censal WHERE id_comuna = ANY(%s)", (sorted(comunas),))
            with con.cursor() as cur:
                cur.executemany(SQL, f)
        b.registros = len(f)
        print("[poblacion] %d unidades cargadas en territorio.unidad_censal" % len(f))
    return 0


if __name__ == "__main__":
    sys.exit(main())
