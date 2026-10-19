# -*- coding: utf-8 -*-
"""
Derivados hidrológicos del DEM: acumulación de flujo e índice topográfico
de humedad (TWI). Son dos de las seis variables del índice de susceptibilidad
a inundación.

Por qué un módulo aparte y no una transformación más en `zonal`: la
acumulación de flujo de una celda depende de TODA la cuenca aguas arriba, no
de sus ocho vecinas. Recortar por comuna antes de calcularla dejaría fuera lo
que drena desde la comuna de al lado, que es exactamente lo que inunda. Aquí
se calcula una vez sobre la región completa, se escriben los rásteres, y
`zonal --factor acumulacion|twi` los agrega por comuna con la identidad.

Se recorta al área de interés de la región —leída de la base, nunca escrita
aquí— con un margen. El DEM cubre tres teselas de más y la canalización
hidrológica crea varias copias en memoria: sobre las 107 millones de celdas
completas no cabe en el contenedor.

    python -m ingesta.hidrologia                 # escribe /datos/inundacion/*.tif
    python -m ingesta.hidrologia --simular       # calcula y resume, no escribe

Los rásteres resultantes están en el EPSG de trabajo, en metros: `zonal` los
acepta directo.
"""
import argparse
import os
import sys

import numpy as np
import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

import config
from bd import Bitacora, obtener_region
from indicadores.terreno import curvatura, pendiente_horn

DIR_SALIDA = os.path.join(config.DIR_DATOS, "inundacion")

# Margen alrededor del bbox de la región, en metros. Suficiente para que las
# cuencas que nacen justo fuera del límite aporten a la acumulación.
MARGEN_M = 5000


# --------------------------------------------------------------------------
# Recorte
# --------------------------------------------------------------------------

def recortar(ruta_dem, region, margen_m=MARGEN_M):
    """Lee la ventana del DEM que cubre la región más el margen.

    Devuelve (elevacion float64 con NaN en nodata, transform, crs, dx).
    """
    with rasterio.open(ruta_dem) as d:
        if d.crs is None or d.crs.is_geographic:
            raise SystemExit(
                "El DEM debe estar proyectado en metros (llegó %s). "
                "Usar el dem_utm.tif que deja `ingesta.srtm --preparar`." % d.crs)

        oeste, sur, este, norte = transform_bounds("EPSG:4326", d.crs, *region.bbox)
        ventana = from_bounds(oeste - margen_m, sur - margen_m,
                              este + margen_m, norte + margen_m, d.transform)
        ventana = ventana.round_offsets().round_lengths()
        ventana = ventana.intersection(
            rasterio.windows.Window(0, 0, d.width, d.height))

        z = d.read(1, window=ventana).astype("float64")
        if d.nodata is not None:
            z[z == d.nodata] = np.nan
        transform = d.window_transform(ventana)
        dx = abs(d.transform.a)
        return z, transform, d.crs, dx


# --------------------------------------------------------------------------
# Hidrología
# --------------------------------------------------------------------------

def acumulacion_de_flujo(z, transform, crs, nodata=-9999.0):
    """Celdas que drenan a cada celda, por D8, sobre un DEM acondicionado.

    La secuencia es la estándar: rellenar pozos de una celda, rellenar
    depresiones, resolver planicies, dirección de flujo D8, acumulación. Sin
    el acondicionamiento el flujo se detiene en cada hoyo del modelo de
    elevación y la acumulación sale a parches.
    """
    from pysheds.grid import Grid
    from pysheds.sview import Raster, ViewFinder

    relleno = np.where(np.isnan(z), nodata, z)
    vista = ViewFinder(affine=transform, shape=z.shape, crs=crs, nodata=nodata)
    dem = Raster(relleno, viewfinder=vista)
    grid = Grid.from_raster(dem)

    sin_pozos = grid.fill_pits(dem)
    sin_depresiones = grid.fill_depressions(sin_pozos)
    inclinado = grid.resolve_flats(sin_depresiones)
    direccion = grid.flowdir(inclinado)
    acumulacion = grid.accumulation(direccion)

    a = np.asarray(acumulacion, dtype="float64")
    a[np.isnan(z)] = np.nan
    return a


def indice_topografico_humedad(acumulacion_celdas, pendiente_pct, dx):
    """TWI = ln(a / tan(beta)), con a el área específica de captación.

    a = celdas aguas arriba * área de celda / ancho de celda = celdas * dx.
    beta es la pendiente. Se acota abajo para no dividir por cero en las
    celdas planas: tan(0.1%) en vez de tan(0), como hace la mayoría de las
    implementaciones. El TWI es alto donde llega mucha agua y no se va —el
    fondo de un valle plano—, que es la definición operativa de inundable.
    """
    a = np.maximum(acumulacion_celdas, 1.0) * dx
    beta = np.arctan(np.maximum(pendiente_pct, 0.1) / 100.0)
    return np.log(a / np.tan(beta))


# --------------------------------------------------------------------------
# Salida
# --------------------------------------------------------------------------

def escribir(ruta, arreglo, transform, crs, nodata=-9999.0):
    datos = np.where(np.isnan(arreglo), nodata, arreglo).astype("float32")
    perfil = {
        "driver": "GTiff", "dtype": "float32", "count": 1,
        "height": datos.shape[0], "width": datos.shape[1],
        "transform": transform, "crs": crs, "nodata": nodata,
        "compress": "deflate", "tiled": True, "predictor": 3,
    }
    with rasterio.open(ruta, "w", **perfil) as d:
        d.write(datos, 1)


def resumen(nombre, arreglo):
    v = arreglo[~np.isnan(arreglo)]
    print("  %-14s min %10.3f  mediana %10.3f  max %12.3f  (%d celdas)"
          % (nombre, v.min(), np.median(v), v.max(), v.size))


# --------------------------------------------------------------------------
# Punto de entrada
# --------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Acumulación de flujo y TWI desde el DEM")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--dem", default=os.path.join(config.DIR_DATOS, "srtm", "dem_utm.tif"))
    p.add_argument("--salida", default=DIR_SALIDA)
    p.add_argument("--margen", type=int, default=MARGEN_M, help="metros alrededor del bbox")
    p.add_argument("--simular", action="store_true", help="calcula y resume, no escribe")
    args = p.parse_args()

    region = obtener_region(args.region)
    print("[hidrologia] %s — EPSG %d" % (region.nombre, region.epsg_trabajo))

    with Bitacora("Hidrología del DEM — %s" % region.nombre) as b:
        print("[hidrologia] recortando %s al bbox + %d m" % (args.dem, args.margen))
        z, transform, crs, dx = recortar(args.dem, region, args.margen)
        print("[hidrologia] %d x %d celdas de %.0f m" % (z.shape[1], z.shape[0], dx))

        print("[hidrologia] acondicionando y acumulando flujo (D8)")
        acumulacion = acumulacion_de_flujo(z, transform, crs)

        print("[hidrologia] pendiente, curvatura y TWI")
        pendiente = pendiente_horn(z, dx, dx)
        curva = curvatura(z, dx, dx)
        twi = indice_topografico_humedad(acumulacion, pendiente, dx)

        # La acumulación en celdas es brutalmente asimétrica: la mayoría de
        # las celdas tienen unas pocas aguas arriba y el río principal tiene
        # millones. Para agregarla por comuna y para combinarla con las otras
        # variables se guarda en log10, que es como se usa en todos los
        # índices multicriterio de inundación. La cruda queda también, para
        # quien quiera extraer la red de drenaje por umbral.
        log_acumulacion = np.log10(np.maximum(acumulacion, 1.0))
        log_acumulacion[np.isnan(acumulacion)] = np.nan

        print("[hidrologia] resumen")
        resumen("pendiente", pendiente)
        resumen("curvatura", curva)
        resumen("acumulacion", acumulacion)
        resumen("log10(acum)", log_acumulacion)
        resumen("twi", twi)

        if args.simular:
            print("\n[hidrologia] --simular: no se escribió nada.")
            b.simulada = True
            b.registros = 0
            return 0

        os.makedirs(args.salida, exist_ok=True)
        # Pendiente y curvatura tambien se escriben aqui, aunque zonal sepa
        # derivarlas por comuna: el indice de susceptibilidad se calcula por
        # pixel sobre las seis variables en la MISMA rejilla, y para eso las
        # necesita como raster completo, no por recortes.
        salidas = {
            "pendiente.tif": pendiente,
            "curvatura.tif": curva,
            "acumulacion_celdas.tif": acumulacion,
            "acumulacion.tif": log_acumulacion,
            "twi.tif": twi,
        }
        for nombre, arreglo in salidas.items():
            ruta = os.path.join(args.salida, nombre)
            escribir(ruta, arreglo, transform, crs)
            print("  -> %s (%.1f MB)" % (ruta, os.path.getsize(ruta) / 1e6))
        b.registros = len(salidas)

    print("\n[hidrologia] listo. Agregar por comuna con:")
    print("  python -m ingesta.zonal --raster %s/acumulacion.tif --factor acumulacion --guardar"
          % args.salida)
    print("  python -m ingesta.zonal --raster %s/twi.tif --factor twi --guardar" % args.salida)
    return 0


if __name__ == "__main__":
    sys.exit(main())
