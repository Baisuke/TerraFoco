# -*- coding: utf-8 -*-
"""
Censo 2024 del INE: límite urbano, zonas censales y personas por manzana.

Es la población del indicador de áreas verdes (HU-19, RF-25). El módulo se
diseñó por unidad vecinal, pero ese catastro lo lleva cada municipio y no
es público; la zona censal sí, y es la unidad oficial más fina con
población publicada. En Rancagua hay 3.505 manzanas urbanas agrupadas en
zonas de unos pocos miles de personas: el mismo orden de tamaño que una
unidad vecinal.

El INE publica la cartografía por región en su almacenamiento público, sin
credenciales. Se usa el GeoPackage de la región, que trae las diez capas de
la cartografía censal con 189 variables de personas, hogares y viviendas;
de ellas se toman solo tres capas y la cantidad de personas. Nada se lee a
nivel de persona: la base del INE ya viene agregada por manzana.

Solo se cargan las manzanas y zonas URBANAS. Los estándares de áreas verdes
(SIEDU) son urbanos, y en el área rural una "manzana" es una entidad de
varios kilómetros donde no tiene sentido buscar una plaza a 400 m.

    python -m ingesta.censo --descargar   # zip del INE -> /datos/censo/
    python -m ingesta.censo               # descarga si falta y carga
    python -m ingesta.censo --simular     # lee y resume, no escribe
"""
import argparse
import os
import sys
import urllib.request
import zipfile

import config
from bd import Bitacora, conexion, obtener_region

DIR_CENSO = os.path.join(config.DIR_DATOS, "censo")
URL_BASE = ("https://storage.googleapis.com/bktdescargascenso2024/"
            "Cartografia/GPKG/Cartografia_censo2024_R%02d.zip")
ANIO = 2024

# El INE entrega en SIRGAS-Chile (EPSG:4674). Se lleva a 4326 como el resto de
# territorio; la diferencia es de centímetros, pero mezclar SRID en PostGIS
# hace fallar los cruces en vez de dar un número levemente corrido.
SRID_BASE = 4326


def ruta_gpkg(id_region):
    return os.path.join(DIR_CENSO, "Cartografia_censo2024_R%02d.gpkg" % id_region)


def descargar(id_region):
    """Baja y descomprime el GeoPackage de la región. Devuelve su ruta."""
    os.makedirs(DIR_CENSO, exist_ok=True)
    url = URL_BASE % id_region
    zip_local = os.path.join(DIR_CENSO, os.path.basename(url))
    print("  descargando %s" % url)
    urllib.request.urlretrieve(url, zip_local)
    with zipfile.ZipFile(zip_local) as z:
        z.extractall(DIR_CENSO)
    ruta = ruta_gpkg(id_region)
    if not os.path.exists(ruta):
        raise SystemExit("El zip no trae %s; revisar el nombre en el INE." % os.path.basename(ruta))
    return ruta


def leer(ruta):
    """Las tres capas, ya filtradas a lo urbano y en 4326."""
    import geopandas as gpd

    lim = gpd.read_file(ruta, layer="Limite_Urbano_CPV24",
                        columns=["CUT", "LOCALIDAD", "CATEGORIA", "CONURBACION", "n_per"])
    zon = gpd.read_file(ruta, layer="Zonal_CPV24",
                        columns=["CUT", "AREA_C", "ID_ZONA", "COD_ZONA", "LOCALIDAD", "n_per"])
    mz = gpd.read_file(ruta, layer="Manzanas_CPV24",
                       columns=["CUT", "AREA_C", "MANZENT", "ID_ZONA", "n_per"])
    zon = zon[zon["AREA_C"] == "URBANO"]
    mz = mz[mz["AREA_C"] == "URBANO"]
    return (lim.to_crs(SRID_BASE), zon.to_crs(SRID_BASE), mz.to_crs(SRID_BASE))


def validar(lim, zon, mz):
    """Lo que tiene que cumplirse para que el indicador signifique algo."""
    problemas = []
    if mz["MANZENT"].duplicated().any():
        problemas.append("manzanas con MANZENT repetido")
    if (mz["n_per"] < 0).any():
        problemas.append("personas negativas en alguna manzana")
    sin_zona = ~mz["ID_ZONA"].isin(zon["ID_ZONA"])
    if sin_zona.any():
        problemas.append("%d manzanas urbanas sin zona urbana" % int(sin_zona.sum()))
    return problemas


def resumir(lim, zon, mz):
    print("  límite urbano: %d polígonos" % len(lim))
    print("  zonas urbanas: %d" % len(zon))
    print("  manzanas urbanas: %d con %s personas"
          % (len(mz), format(int(mz["n_per"].fillna(0).sum()), ",").replace(",", ".")))
    por_comuna = mz.groupby("CUT")["n_per"].sum().sort_values(ascending=False)
    for cut, n in por_comuna.head(5).items():
        print("    %d  %8d" % (cut, n))


SQL_LIMITE = """
INSERT INTO territorio.limite_urbano (id_comuna, localidad, categoria, conurbacion, personas, geom)
VALUES (%s, %s, %s, %s, %s, ST_Multi(ST_SetSRID(ST_GeomFromWKB(%s), 4326)))
"""

# Las zonas y manzanas llevan el id del INE como llave: se actualizan en su
# lugar y el indicador que las referencia no queda huérfano al recargar.
SQL_ZONA = """
INSERT INTO territorio.zona_censal (id_zona, id_comuna, cod_zona, localidad, personas, geom)
VALUES (%s, %s, %s, %s, %s, ST_Multi(ST_SetSRID(ST_GeomFromWKB(%s), 4326)))
ON CONFLICT (id_zona) DO UPDATE SET
    id_comuna = EXCLUDED.id_comuna, cod_zona = EXCLUDED.cod_zona,
    localidad = EXCLUDED.localidad, personas = EXCLUDED.personas,
    geom = EXCLUDED.geom, cargado_en = now()
"""

SQL_MANZANA = """
INSERT INTO territorio.manzana_censal (id_manzana, id_comuna, id_zona, personas, geom)
VALUES (%s, %s, %s, %s, ST_Multi(ST_SetSRID(ST_GeomFromWKB(%s), 4326)))
ON CONFLICT (id_manzana) DO UPDATE SET
    id_comuna = EXCLUDED.id_comuna, id_zona = EXCLUDED.id_zona,
    personas = EXCLUDED.personas, geom = EXCLUDED.geom, cargado_en = now()
"""


def _texto(v):
    return None if v is None or (isinstance(v, float) and v != v) or v == "" else str(v)


def _entero(v):
    return 0 if v is None or v != v else int(round(v))


def cargar(id_region, lim, zon, mz):
    """Reemplaza el límite urbano y actualiza zonas y manzanas de la región."""
    with conexion() as con:
        validas = {f[0] for f in con.execute(
            "SELECT id_comuna FROM territorio.comuna WHERE id_region = %s", (id_region,))}
        faltan = set(int(c) for c in mz["CUT"].unique()) - validas
        if faltan:
            raise SystemExit("Comunas del censo que no están en territorio.comuna: %s" % sorted(faltan))

        con.execute("DELETE FROM territorio.limite_urbano WHERE id_comuna = ANY(%s)", (list(validas),))
        with con.cursor() as cur:
            cur.executemany(SQL_LIMITE, [
                (int(f.CUT), _texto(f.LOCALIDAD), _texto(f.CATEGORIA), _texto(f.CONURBACION),
                 _entero(f.n_per), f.geometry.wkb) for f in lim.itertuples()])
            cur.executemany(SQL_ZONA, [
                (int(f.ID_ZONA), int(f.CUT), int(f.COD_ZONA), _texto(f.LOCALIDAD),
                 _entero(f.n_per), f.geometry.wkb) for f in zon.itertuples()])
            cur.executemany(SQL_MANZANA, [
                (int(f.MANZENT), int(f.CUT), int(f.ID_ZONA), _entero(f.n_per), f.geometry.wkb)
                for f in mz.itertuples()])
    return len(lim) + len(zon) + len(mz)


def main():
    p = argparse.ArgumentParser(description="Carga el Censo 2024 urbano del INE")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--descargar", action="store_true", help="solo descargar el GeoPackage")
    p.add_argument("--simular", action="store_true", help="leer y resumir, sin escribir")
    args = p.parse_args()

    region = obtener_region(args.region)
    ruta = ruta_gpkg(args.region)
    if args.descargar or not os.path.exists(ruta):
        ruta = descargar(args.region)
        if args.descargar:
            return

    print("\nCenso %d urbano — %s" % (ANIO, region.nombre))
    lim, zon, mz = leer(ruta)
    resumir(lim, zon, mz)
    problemas = validar(lim, zon, mz)
    if problemas:
        sys.exit("No se carga: " + "; ".join(problemas))
    if args.simular:
        print("  (simulación: no se escribe)")
        return

    with Bitacora("Censo 2024 urbano — %s" % region.nombre, fuente="ine_censo2024") as b:
        b.registros = cargar(args.region, lim, zon, mz)
    print("  cargados %d registros" % b.registros)


if __name__ == "__main__":
    main()
