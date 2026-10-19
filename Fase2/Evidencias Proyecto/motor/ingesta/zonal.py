# -*- coding: utf-8 -*-
"""
Del ráster al valor por comuna.

Es la pieza que faltaba para cerrar el circuito: toma un ráster regional
—elevación de NASADEM, NDVI de Sentinel-2— y devuelve un número por comuna,
listo para entrar en RUSLE.

    raster (millones de celdas)  ->  transformacion  ->  media por comuna

EL ORDEN DE LAS OPERACIONES IMPORTA
-----------------------------------
La transformación se aplica ANTES de recortar, sobre el ráster completo. No es
un detalle de eficiencia: la pendiente de una celda depende de sus ocho
vecinas, así que recortar primero dejaría el borde de cada comuna calculado
contra celdas inexistentes. El error se concentraría justo en los límites
comunales, que es donde nadie lo mira.

SOBRE EL SISTEMA DE REFERENCIA
------------------------------
El ráster **debe estar proyectado en metros**. NASADEM y Sentinel-2 se
descargan en grados, y calcular una pendiente con un tamaño de celda expresado
en grados da un resultado cinco órdenes de magnitud equivocado sin lanzar
ningún error. Por eso aquí se rechaza y se indica cómo reproyectar, en vez de
adivinar.

Uso:
    python -m ingesta.zonal --raster /datos/srtm/dem.tif --factor ls
    python -m ingesta.zonal --raster /datos/s2/ndvi.tif --factor c
"""
import argparse
import json
import os
import sys

import numpy as np

import config
from bd import conexion, obtener_region
from indicadores.rusle import factor_C
from indicadores.terreno import (curvatura, ls_desde_pendiente, media_ponderada,
                                 pendiente_horn)

SQL_GEOMETRIAS = """
SELECT id_comuna,
       nombre,
       ST_AsGeoJSON(ST_Transform(geom, %(epsg)s)) AS geojson
FROM   territorio.comuna
WHERE  id_region = %(region)s
ORDER  BY id_comuna
"""


def geometrias_comunas(id_region, epsg_destino):
    """Límites comunales reproyectados al sistema del ráster.

    Se reproyecta en PostGIS y no en Python: la base ya tiene PROJ y lo hace
    sobre el índice, sin traer geometrías de más.
    """
    with conexion() as con:
        filas = con.execute(SQL_GEOMETRIAS,
                            {"region": id_region, "epsg": epsg_destino}).fetchall()
    return [(f[0], f[1], json.loads(f[2])) for f in filas]


def tamano_de_celda(datos):
    """Ancho y alto de celda en metros. Falla si el ráster está en grados."""
    crs = datos.crs
    if crs is None:
        raise SystemExit("El raster no declara sistema de referencia.")
    if not crs.is_projected:
        raise SystemExit(
            "El raster esta en coordenadas geograficas (%s) y el tamano de\n"
            "celda quedaria en grados: la pendiente saldria absurda.\n"
            "Reproyectar antes, por ejemplo:\n"
            "  gdalwarp -t_srs EPSG:32719 -r bilinear entrada.tif salida.tif"
            % crs.to_string())

    t = datos.transform
    return abs(t.a), abs(t.e)


def transformacion_ls(longitud_m=None):
    """Elevación -> pendiente -> LS."""
    def aplicar(banda, dx, dy):
        return ls_desde_pendiente(pendiente_horn(banda, dx, dy), longitud_m)
    return aplicar


def transformacion_c():
    """NDVI -> factor C, celda a celda.

    Se vectoriza la relación de Van der Knijff en vez de llamar a `factor_C`
    por celda: un mosaico regional tiene decenas de millones de píxeles.
    """
    def aplicar(banda, dx, dy):
        ndvi = np.clip(banda, -1.0, 1.0)
        c = np.where(ndvi <= 0, 1.0,
                     np.exp(-2.0 * np.clip(ndvi, None, 0.999)
                            / (1.0 - np.clip(ndvi, None, 0.999))))
        return np.where(ndvi >= 1.0, 0.0, c)
    return aplicar


def transformacion_pendiente():
    """Elevación -> pendiente en porcentaje, sin pasar a LS.

    La pendiente media de la comuna la necesita el factor P: la eficacia de las
    curvas de nivel depende de cuán empinado sea el terreno.
    """
    def aplicar(banda, dx, dy):
        return pendiente_horn(banda, dx, dy)
    return aplicar


def transformacion_curvatura():
    """Elevación -> curvatura general (Zevenbergen & Thorne)."""
    def aplicar(banda, dx, dy):
        return curvatura(banda, dx, dy)
    return aplicar


def transformacion_identidad():
    """El ráster ya trae la variable calculada; solo se agrega por comuna.

    Es el caso de la acumulación de flujo y del índice topográfico de humedad:
    dependen de toda la cuenca aguas arriba, no de la ventana 3x3, así que no
    se pueden derivar aquí por recortes. Los produce ingesta.hidrologia sobre
    el DEM completo y esta función solo promedia lo que ya está.
    """
    def aplicar(banda, dx, dy):
        return banda
    return aplicar


# La clave es a la vez la transformación y el nombre con que se guarda. Las
# de RUSLE van en indicadores.factor; las demás en variable_inundacion. El
# almacén decide por el nombre, no este módulo.
TRANSFORMACIONES = {
    "ls": transformacion_ls,
    "c": transformacion_c,
    "pendiente": transformacion_pendiente,
    "curvatura": transformacion_curvatura,
    "acumulacion": transformacion_identidad,
    "twi": transformacion_identidad,
    "distancia_cauces": transformacion_identidad,
    "cobertura": transformacion_identidad,
}


def limites(geometria):
    """Envolvente de un Polygon o MultiPolygon GeoJSON."""
    xs, ys = [], []

    def recorrer(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        else:
            for sub in c:
                recorrer(sub)

    recorrer(geometria["coordinates"])
    return min(xs), min(ys), max(xs), max(ys)


# Celdas de margen alrededor de la comuna. La pendiente de una celda depende
# de sus ocho vecinas, asi que sin margen el borde de cada comuna se calcularia
# contra la fila replicada del recorte. Dos celdas bastan para el nucleo 3x3.
MARGEN_CELDAS = 3


def agregar_por_comuna(ruta_raster, geometrias, transformar=None, banda=1,
                       ruta_mascara=None):
    """Media del ráster transformado dentro de cada comuna.

    Se procesa **una ventana por comuna**, no el ráster completo. Un modelo de
    elevación regional a 30 m tiene decenas de millones de celdas y el cálculo
    de pendiente crea varias copias intermedias: leerlo entero agota la memoria
    del contenedor y el proceso muere sin dejar rastro (exit 137).

    Cada ventana se extiende `MARGEN_CELDAS` más allá de la comuna para que el
    cálculo de pendiente tenga vecinas reales en el borde, y luego se recorta
    al polígono. Así el resultado es idéntico al de procesar todo junto, pero
    la memoria queda acotada por la comuna más grande.

    Devuelve {id_comuna: {"nombre":…, "valor":…, "celdas":…}}. Una comuna sin
    celdas válidas queda con valor None, no con cero: hay que poder distinguir
    "el ráster no la cubre" de "el valor es cero".
    """
    import rasterio
    from rasterio.features import geometry_mask
    from rasterio.windows import Window, from_bounds

    # La mascara restringe el calculo a la superficie que CIREN evalua como
    # suelo. Sin ella, el promedio de una comuna cordillerana se calcula sobre
    # roca y nieve: Machali daba 733 t/ha contra 1,71 de CIREN, y la
    # comparacion del UC-06 no se sostenia. Ademas es lo correcto para el
    # proposito: el SIRSD-S bonifica suelo agricola, no glaciares.
    filtro = None
    if ruta_mascara:
        filtro = rasterio.open(ruta_mascara)

    resultado = {}
    with rasterio.open(ruta_raster) as datos:
        if filtro is not None and (filtro.width, filtro.height) != (datos.width,
                                                                    datos.height):
            filtro.close()
            raise SystemExit(
                "La mascara no comparte rejilla con el raster: %dx%d vs %dx%d. "
                "Debe generarse desde el mismo archivo de referencia."
                % (filtro.width, filtro.height, datos.width, datos.height))
        dx, dy = tamano_de_celda(datos)
        margen_x = MARGEN_CELDAS * dx
        margen_y = MARGEN_CELDAS * dy

        for id_comuna, nombre, geo in geometrias:
            try:
                minx, miny, maxx, maxy = limites(geo)
                ventana = from_bounds(minx - margen_x, miny - margen_y,
                                      maxx + margen_x, maxy + margen_y,
                                      datos.transform)
                # Recorta la ventana a lo que existe en el raster.
                ventana = ventana.round_offsets().round_lengths()
                ventana = ventana.intersection(
                    Window(0, 0, datos.width, datos.height))
            except Exception:
                resultado[id_comuna] = {"nombre": nombre, "valor": None,
                                        "celdas": 0}
                continue

            if ventana.width < 1 or ventana.height < 1:
                resultado[id_comuna] = {"nombre": nombre, "valor": None,
                                        "celdas": 0}
                continue

            arreglo = datos.read(banda, window=ventana).astype("float64")

            # El nodata sale ANTES de transformar: un -32768 de relleno metido
            # en un calculo de pendiente produce un acantilado ficticio que
            # contamina las ocho celdas vecinas.
            if datos.nodata is not None:
                arreglo[arreglo == datos.nodata] = np.nan

            valores = transformar(arreglo, dx, dy) if transformar else arreglo
            transform = datos.window_transform(ventana)

            dentro = geometry_mask([geo], out_shape=valores.shape,
                                   transform=transform, invert=True)
            celdas_comuna = int(dentro.sum())

            if filtro is not None:
                evaluado = filtro.read(1, window=ventana) == 1
                dentro = dentro & evaluado

            media, n = media_ponderada(valores, dentro)
            resultado[id_comuna] = {"nombre": nombre, "valor": media,
                                    "celdas": n,
                                    "celdas_comuna": celdas_comuna}

    if filtro is not None:
        filtro.close()
    return resultado


def informe(resultado, etiqueta):
    sin_dato = [d["nombre"] for d in resultado.values() if d["valor"] is None]
    con_dato = {k: d for k, d in resultado.items() if d["valor"] is not None}

    print("\n%s por comuna — %d de %d con dato"
          % (etiqueta, len(con_dato), len(resultado)))
    # Con máscara importa saber qué fracción de la comuna entró al promedio:
    # un valor calculado sobre el 8% de la superficie no dice lo mismo que uno
    # sobre el 90%, aunque el número se vea igual de contundente.
    con_mascara = any(d.get("celdas_comuna") for d in con_dato.values())
    if con_mascara:
        print("\n  %-22s %10s %12s %9s" % ("comuna", etiqueta, "celdas", "cobert."))
    else:
        print("\n  %-22s %10s %12s" % ("comuna", etiqueta, "celdas"))

    for _k, d in sorted(con_dato.items(), key=lambda x: -x[1]["valor"]):
        if con_mascara and d.get("celdas_comuna"):
            cob = 100.0 * d["celdas"] / d["celdas_comuna"]
            print("  %-22s %10.3f %12d %8.0f%%"
                  % (d["nombre"][:22], d["valor"], d["celdas"], cob))
        else:
            print("  %-22s %10.3f %12d"
                  % (d["nombre"][:22], d["valor"], d["celdas"]))

    if sin_dato:
        print("\n  %d comunas SIN cobertura del raster: %s"
              % (len(sin_dato), ", ".join(sin_dato[:8])))
    return con_dato


def main():
    p = argparse.ArgumentParser(description="Agrega un raster por comuna")
    p.add_argument("--raster", required=True)
    p.add_argument("--factor", required=True, choices=sorted(TRANSFORMACIONES))
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--banda", type=int, default=1)
    p.add_argument("--longitud-ladera", type=float, default=None,
                   help="longitud de ladera en m para LS; por defecto, la celda")
    p.add_argument("--guardar", action="store_true",
                   help="escribir el resultado en indicadores.factor")
    p.add_argument("--anio", type=int, default=2025)
    p.add_argument("--fuente", default=None,
                   help="procedencia del dato; por defecto se deduce del factor")
    p.add_argument("--mascara", default=None,
                   help="raster de mascara; limita el calculo a esa superficie")
    p.add_argument("--cobertura-minima", type=float, default=0.30,
                   help="fraccion minima de la comuna para guardar el valor")
    args = p.parse_args()

    region = obtener_region(args.region)
    print("[zonal] region %s, EPSG de trabajo %d"
          % (region.nombre, region.epsg_trabajo))

    geometrias = geometrias_comunas(args.region, region.epsg_trabajo)
    print("[zonal] %d comunas" % len(geometrias))

    # Se despacha por el diccionario, no por un if/else: con dos ramas,
    # --factor pendiente caia en la de C y trataba la elevacion como NDVI.
    # Los Andes salian con pendiente cero y la costa con la mas alta.
    if args.factor == "ls":
        transformar = transformacion_ls(args.longitud_ladera)
    else:
        transformar = TRANSFORMACIONES[args.factor]()

    resultado = agregar_por_comuna(args.raster, geometrias, transformar,
                                   args.banda, args.mascara)
    con_dato = informe(resultado, args.factor.upper())

    if args.guardar:
        from indicadores.almacen import FACTORES, almacen_de

        # Los factores de RUSLE se nombran en mayúscula (LS, C); las variables
        # de inundación en minúscula tal cual. El almacén se elige por eso.
        nombre = args.factor.upper() if args.factor.upper() in FACTORES else args.factor
        almacen = almacen_de(nombre)

        # Con mascara, una comuna puede quedar con un punado de celdas. El
        # promedio existe y no falla, pero no representa a la comuna: un LS
        # calculado sobre 98 de 300.000 celdas describe una ladera, no un
        # territorio. Guardarlo seria peor que no tenerlo, porque nadie
        # distingue despues un valor solido de uno anecdotico.
        pobres = {}
        aptos = {}
        for k, d in con_dato.items():
            total = d.get("celdas_comuna")
            cob = (float(d["celdas"]) / total) if total else 1.0
            if total and cob < args.cobertura_minima:
                pobres[k] = (d["nombre"], cob, d["celdas"])
            else:
                aptos[k] = dict(d, cobertura=cob)

        if pobres:
            print()
            print("[zonal] %d comunas NO se guardan por cobertura bajo %.0f%%:"
                  % (len(pobres), 100 * args.cobertura_minima))
            for _k, (nombre, cob, celdas) in sorted(pobres.items(),
                                                    key=lambda x: x[1][1]):
                print("          %-22s %5.1f%%  (%d celdas)"
                      % (nombre[:22], 100 * cob, celdas))
            print("        Conservan su valor anterior. Completar la mascara y")
            print("        volver a correr para reemplazarlo.")

        if not aptos:
            print("\n[zonal] ninguna comuna supera la cobertura minima; "
                  "no se escribio nada.")
            return 1

        fuente = args.fuente or ("NASADEM" if args.factor == "ls" else "raster")
        valores = {k: d["valor"] for k, d in aptos.items()}
        detalles = {k: {"celdas": d["celdas"],
                        "cobertura": round(d["cobertura"], 3),
                        "mascara": os.path.basename(args.mascara) if args.mascara else None,
                        "raster": os.path.basename(args.raster)}
                    for k, d in aptos.items()}
        n, descartados = almacen.guardar(args.region, valores, nombre,
                                         args.anio, fuente, detalles)
        print()
        print("[zonal] %d valores de %s guardados en %s" % (n, nombre, almacen.tabla))
        if descartados:
            print("[zonal] %d descartados (nulos%s): %s"
                  % (len(descartados),
                     " o no positivos" if almacen.exige_positivo else "",
                     descartados[:5]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
