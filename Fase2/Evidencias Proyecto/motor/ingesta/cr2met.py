# -*- coding: utf-8 -*-
"""
Erosividad de la lluvia (factor R) desde CR2MET.

CR2MET es una grilla de 0,05 grados con precipitacion diaria para Chile
continental, calibrada contra estaciones reales. Se prefiere a las estaciones
sueltas de la DMC porque **cubre todas las comunas** sin tener que interpolar
entre puntos dispersos, y porque es citable en la tesis.

    Boisier et al., CR2MET v2.5 — Centro de Ciencia del Clima y la Resiliencia

COMO SE PROCESA
---------------
El paquete trae **un NetCDF por mes**, de unos 21 MB, para todo el pais. Son
744 archivos entre 1960 y 2021, y descomprimirlos todos son 2,4 GB en disco
para usar una franja del ancho de una region.

Aqui se extrae **un mes a la vez** desde el propio .zip, se recorta a la
region, se suman los dias para obtener el total mensual, se promedia por comuna
y se descarta el archivo. El disco nunca guarda mas de 21 MB.

Con los totales mensuales de varios anios se arma la **climatologia**: el
promedio de cada mes calendario. Esa es la entrada de `factor_R`, que aplica
Renard & Freimund (1994).

POR QUE UNA CLIMATOLOGIA Y NO UN ANIO
-------------------------------------
El factor R representa el regimen de lluvias del lugar, no lo que llovio en un
anio concreto. Un 2021 seco daria una erosividad artificialmente baja para una
comuna que en promedio recibe el doble. Por eso se promedian varios anios.

Uso:
    python -m ingesta.cr2met --zip /datos/CR2MET_pr_v2.5.zip --desde 2002 --hasta 2021 --simular
    python -m ingesta.cr2met --zip /datos/CR2MET_pr_v2.5.zip --guardar
"""
import argparse
import os
import re
import sys
import tempfile
import zipfile

import numpy as np

import config
from bd import Bitacora, obtener_region
from indicadores.rusle import RANGOS, factor_R
from ingesta.zonal import geometrias_comunas, limites

PATRON = re.compile(r"_(\d{4})_(\d{2})_", re.I)

# Margen alrededor de la region al recortar la grilla, en grados. CR2MET tiene
# celdas de 0,05 grados; medio grado deja holgura de sobra sin traer el pais.
MARGEN = 0.5


def meses_del_zip(ruta, desde, hasta):
    """Entradas .nc del zip dentro del rango de anios, ordenadas."""
    with zipfile.ZipFile(ruta) as z:
        entradas = []
        for nombre in z.namelist():
            if not nombre.lower().endswith(".nc") or "__MACOSX" in nombre:
                continue
            m = PATRON.search(os.path.basename(nombre))
            if not m:
                continue
            anio, mes = int(m.group(1)), int(m.group(2))
            if desde <= anio <= hasta:
                entradas.append((anio, mes, nombre))
    return sorted(entradas)


def _nombres_de_variable(ds):
    """Detecta como se llaman las dimensiones y la variable de lluvia."""
    lat = next((n for n in ("lat", "latitude", "y") if n in ds.variables), None)
    lon = next((n for n in ("lon", "longitude", "x") if n in ds.variables), None)
    pr = next((n for n in ("pr", "precip", "precipitation", "prec")
               if n in ds.variables), None)
    if pr is None:
        # Ultimo recurso: la unica variable de tres dimensiones.
        for n, v in ds.variables.items():
            if len(v.dimensions) == 3:
                pr = n
                break
    if not (lat and lon and pr):
        raise SystemExit(
            "No se reconocen las variables del NetCDF. Presentes: %s"
            % ", ".join(sorted(ds.variables)))
    return lat, lon, pr


def total_mensual(ruta_nc, bbox):
    """Suma los dias del mes y recorta al area. Devuelve (grilla, lats, lons)."""
    from netCDF4 import Dataset

    with Dataset(ruta_nc) as ds:
        n_lat, n_lon, n_pr = _nombres_de_variable(ds)
        lats = np.asarray(ds.variables[n_lat][:], dtype="float64")
        lons = np.asarray(ds.variables[n_lon][:], dtype="float64")

        minx, miny, maxx, maxy = bbox
        i = np.where((lats >= miny - MARGEN) & (lats <= maxy + MARGEN))[0]
        j = np.where((lons >= minx - MARGEN) & (lons <= maxx + MARGEN))[0]
        if i.size == 0 or j.size == 0:
            raise SystemExit("La region cae fuera de la grilla del archivo.")

        # Se lee solo la ventana: el archivo cubre Chile entero y la region es
        # una franja pequena.
        datos = ds.variables[n_pr][:, i[0]:i[-1] + 1, j[0]:j[-1] + 1]
        arr = np.ma.filled(np.ma.masked_invalid(datos), np.nan).astype("float64")
        # Suma sobre los dias; nansum trata los huecos como cero, que para
        # precipitacion acumulada es lo correcto.
        return np.nansum(arr, axis=0), lats[i], lons[j]


def mascaras_comunas(geometrias, lats, lons):
    """Mascara booleana de cada comuna sobre la grilla de CR2MET."""
    from rasterio.features import geometry_mask
    from rasterio.transform import from_origin

    # CR2MET viene con la latitud creciente; el raster necesita el norte
    # arriba, asi que se invierte y se recuerda para invertir tambien el dato.
    invertir = lats[0] < lats[-1]
    lat_orden = lats[::-1] if invertir else lats

    paso_x = abs(float(lons[1] - lons[0]))
    paso_y = abs(float(lat_orden[0] - lat_orden[1]))
    transform = from_origin(float(lons[0]) - paso_x / 2,
                            float(lat_orden[0]) + paso_y / 2, paso_x, paso_y)
    forma = (len(lats), len(lons))

    mascaras = {}
    for id_comuna, nombre, geo in geometrias:
        m = geometry_mask([geo], out_shape=forma, transform=transform,
                          invert=True, all_touched=True)
        mascaras[id_comuna] = (nombre, m)
    return mascaras, invertir


def main():
    p = argparse.ArgumentParser(description="Factor R desde CR2MET")
    p.add_argument("--zip", default="/datos/CR2MET_pr_v2.5.zip")
    p.add_argument("--desde", type=int, default=2002)
    p.add_argument("--hasta", type=int, default=2021)
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--metodo", default="anual", choices=("anual", "fournier"))
    p.add_argument("--guardar", action="store_true")
    p.add_argument("--simular", action="store_true")
    args = p.parse_args()

    if not os.path.exists(args.zip):
        raise SystemExit("No existe el archivo: %s" % args.zip)

    region = obtener_region(args.region)
    geometrias = geometrias_comunas(args.region, 4326)

    xs = [limites(g)[0] for _i, _n, g in geometrias]
    ys = [limites(g)[1] for _i, _n, g in geometrias]
    xs2 = [limites(g)[2] for _i, _n, g in geometrias]
    ys2 = [limites(g)[3] for _i, _n, g in geometrias]
    bbox = (min(xs), min(ys), max(xs2), max(ys2))

    entradas = meses_del_zip(args.zip, args.desde, args.hasta)
    anios = sorted({a for a, _m, _n in entradas})
    print("[cr2met] %s — %d archivos, %d anios (%d a %d)"
          % (region.nombre, len(entradas), len(anios), anios[0], anios[-1]))
    if not entradas:
        raise SystemExit("El zip no tiene meses en ese rango.")

    # acumulado[id_comuna][mes] = lista de totales mensuales, uno por anio
    acumulado = {i: {m: [] for m in range(1, 13)} for i, _n, _g in geometrias}
    mascaras = None
    tmp = os.path.join(tempfile.gettempdir(), "cr2met_mes.nc")

    with zipfile.ZipFile(args.zip) as z:
        for k, (anio, mes, nombre) in enumerate(entradas, 1):
            with z.open(nombre) as origen, open(tmp, "wb") as destino:
                destino.write(origen.read())
            try:
                grilla, lats, lons = total_mensual(tmp, bbox)
                if mascaras is None:
                    mascaras, invertir = mascaras_comunas(geometrias, lats, lons)
                if invertir:
                    grilla = grilla[::-1, :]
                for id_comuna, (_nombre, m) in mascaras.items():
                    v = grilla[m]
                    v = v[np.isfinite(v)]
                    if v.size:
                        acumulado[id_comuna][mes].append(float(v.mean()))
            finally:
                if os.path.exists(tmp):
                    os.remove(tmp)
            if k % 24 == 0 or k == len(entradas):
                print("  %d/%d  (%d-%02d)" % (k, len(entradas), anio, mes))
                sys.stdout.flush()

    # Climatologia: promedio de cada mes calendario a lo largo de los anios.
    resultados = {}
    for id_comuna, por_mes in acumulado.items():
        mensual = [float(np.mean(por_mes[m])) if por_mes[m] else None
                   for m in range(1, 13)]
        if any(v is None for v in mensual):
            continue
        r = factor_R(precipitacion_mensual=mensual, metodo=args.metodo)
        resultados[id_comuna] = {"R": r, "anual": sum(mensual),
                                 "mensual": mensual}

    nombres = {i: n for i, n, _g in geometrias}
    print("\n  %-22s %10s %12s %10s" % ("comuna", "mm/anio", "R", "en rango"))
    for id_comuna, d in sorted(resultados.items(), key=lambda x: -x[1]["R"]):
        bajo, alto = RANGOS["R"]
        marca = "si" if bajo <= d["R"] <= alto else "NO"
        print("  %-22s %10.0f %12.0f %10s"
              % (nombres[id_comuna][:22], d["anual"], d["R"], marca))

    fuera = [i for i, d in resultados.items()
             if not (RANGOS["R"][0] <= d["R"] <= RANGOS["R"][1])]
    if fuera:
        print("\n  %d comunas con R fuera del rango plausible %s."
              % (len(fuera), RANGOS["R"]))
        print("  Revisar el metodo antes de guardar: 'fournier' entrega valores")
        print("  mas altos que 'anual' en clima mediterraneo.")

    if args.simular or not args.guardar:
        print("\n[cr2met] no se escribio nada (usar --guardar).")
        return 0

    from indicadores.almacen import guardar
    with Bitacora("Ingesta CR2MET — %s" % region.nombre, fuente="cr2met") as b:
        valores = {i: d["R"] for i, d in resultados.items()}
        detalles = {i: {"mm_anual": round(d["anual"], 1),
                        "metodo": args.metodo,
                        "periodo": "%d-%d" % (anios[0], anios[-1])}
                    for i, d in resultados.items()}
        n, descartados = guardar(args.region, valores, "R", anios[-1],
                                 "CR2MET v2.5", detalles)
        b.registros = n
    print("\n[cr2met] %d factores R guardados" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
