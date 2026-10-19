# -*- coding: utf-8 -*-
"""
Superficie con erosión Severa o superior por comuna: el denominador de la
inversión en el índice de pertinencia (migración 013).

La necesidad se mide en t/ha/año, que es intensiva; la inversión del
SIRSD-S, en pesos, que es extensiva. Para compararlas la inversión se lleva a
UF por hectárea erosionada, y esa hectárea sale de aquí: se cuentan las
celdas de 30 m del cálculo propio (mapa_erosion) con pérdida sobre el umbral.

Por qué del cálculo propio y no de CIREN: la ingesta de CIREN conserva la
media por comuna, no la superficie por clase (los polígonos se descartan al
agregar cada cuenca). Recuperarla exige volver a bajar ~50 cuencas.

Fuera del dominio de validez el modelo sobreestima —la superficie "severa"
llega al 55-94 % de la comuna— y la fila se marca en_dominio = false: la
vista deja esas comunas fuera del índice por defecto.

SEMILLA
-------
Los rásteres del cálculo propio (/datos/erosion) pesan gigabytes y solo
existen en el equipo que corrió el motor. Sin esta tabla, la vista deja las
33 comunas fuera de dominio y sin UF/ha: el índice desaparece en cualquier
otro equipo, y con él la copia portable que se arme ahí. Por eso el
resultado —33 filas— se versiona en bd/semillas/superficie_erosionada.csv,
igual que la serie del SIRSD-S, y se carga desde ahí cuando no hay rásteres.

Uso:
    python -m indicadores.superficie_erosionada --simular
    python -m indicadores.superficie_erosionada                 # rásteres; si no hay, la semilla
    python -m indicadores.superficie_erosionada --desde-semilla
    python -m indicadores.superficie_erosionada --exportar-semilla > bd/semillas/superficie_erosionada.csv
    python -m indicadores.superficie_erosionada --desde-png /datos/erosion_png

La semilla (bd/semillas) es la medición exacta sobre los rásteres, y es lo
que se usa por defecto donde los rásteres no están. --desde-png mide desde
los PNG por comuna que genera mapa_erosion para el visor (y su indice.json):
sirve si hay que volver a medir sin los GeoTIFF —el PNG trae la clase de
cada celda, y "Severa o superior" son exactamente las clases sobre el corte
de 18 t/ha/año—; las hectáreas evaluadas salen de los píxeles válidos del
ráster original, que el índice guarda. Difiere de la semilla en décimas de
punto por el remuestreo del PNG.
"""
import argparse
import csv
import glob
import os
import re
import sys

import numpy as np
import rasterio

import config
from bd import Bitacora, conexion, obtener_region

# Límite superior de "Moderada" en mapa_erosion.RAMPA: Severa o superior es
# lo que lo SUPERA (las clases cierran por arriba, a <= corte).
UMBRAL_T_HA = 18.0
ORIGEN = "TerraFoco"
DIR_EROSION = os.path.join(config.DIR_DATOS, "erosion")
SEMILLA = "/bd/semillas/superficie_erosionada.csv"
COLUMNAS = ("id_comuna", "origen", "anio", "umbral_t_ha", "ha_evaluadas",
            "ha_sobre_umbral", "en_dominio")

SQL_EXPORTAR = """
SELECT id_comuna, origen, anio, umbral_t_ha, ha_evaluadas, ha_sobre_umbral, en_dominio
FROM   indicadores.superficie_erosionada
WHERE  id_region = %s
ORDER  BY id_comuna, origen, anio
"""

SQL_DOMINIO = """
SELECT DISTINCT ON (id_comuna) id_comuna, anio, en_dominio
FROM   indicadores.erosion
WHERE  origen = %s AND id_region = %s
ORDER  BY id_comuna, anio DESC, calculado_en DESC
"""

SQL_GUARDAR = """
INSERT INTO indicadores.superficie_erosionada
       (id_comuna, id_region, origen, anio, umbral_t_ha, ha_evaluadas,
        ha_sobre_umbral, en_dominio)
VALUES (%(id_comuna)s, %(id_region)s, %(origen)s, %(anio)s, %(umbral)s,
        %(ha_evaluadas)s, %(ha_sobre_umbral)s, %(en_dominio)s)
ON CONFLICT (id_comuna, origen, anio, umbral_t_ha) DO UPDATE
   SET ha_evaluadas = EXCLUDED.ha_evaluadas,
       ha_sobre_umbral = EXCLUDED.ha_sobre_umbral,
       en_dominio = EXCLUDED.en_dominio,
       calculado_en = now()
"""


def hectareas(valores, area_celda_ha, umbral=UMBRAL_T_HA):
    """(ha evaluadas, ha sobre el umbral) de un arreglo de pérdida de suelo.

    NaN es "sin dato" y no cuenta en ninguna de las dos. Estrictamente sobre
    el umbral: 18,0 t/ha/año todavía es Moderada.
    """
    v = np.asarray(valores, dtype="float64")
    v = v[np.isfinite(v)]
    return float(v.size * area_celda_ha), float((v > umbral).sum() * area_celda_ha)


def medir_png(ruta, pixeles, resolucion_m):
    """(ha evaluadas, ha sobre el umbral) desde el PNG del visor.

    Cada píxel opaco se asigna a la clase de RAMPA con el color más cercano
    (el PNG va sin pérdida, así que en la práctica la distancia es cero).
    """
    from mapa_erosion import RAMPA
    with rasterio.open(ruta) as d:
        img = d.read()                                   # (4, alto, ancho)
    opacos = img[3] > 0
    rgb = img[:3, opacos].T.astype("int32")              # (n, 3)
    colores = np.array([c for _corte, c in RAMPA], dtype="int32")
    clase = ((rgb[:, None, :] - colores[None, :, :]) ** 2).sum(axis=2).argmin(axis=1)
    cortes = [c for c, _color in RAMPA]
    severa = next(k for k, c in enumerate(cortes) if c > UMBRAL_T_HA)
    fraccion = float((clase >= severa).mean()) if clase.size else 0.0
    evaluadas = pixeles * resolucion_m ** 2 / 1e4
    return float(evaluadas), float(evaluadas * fraccion)


def rutas_png(carpeta):
    """{id_comuna: (ruta, pixeles, resolucion_m)} desde indice.json."""
    import json
    with open(os.path.join(carpeta, "indice.json"), encoding="utf-8") as f:
        indice = json.load(f)
    return {c["id_comuna"]: (os.path.join(carpeta, c["png"]), c["pixeles"], c["resolucion_m"])
            for c in indice["comunas"] if os.path.exists(os.path.join(carpeta, c["png"]))}


def medir(ruta):
    with rasterio.open(ruta) as d:
        a = d.read(1, masked=True).astype("float64").filled(np.nan)
        area_celda_ha = abs(d.transform.a * d.transform.e) / 1e4
    return hectareas(a, area_celda_ha)


def exportar_semilla(id_region, salida=sys.stdout):
    """La tabla, en el CSV de bd/semillas. Se escribe por stdout porque /bd
    está montado de solo lectura en el contenedor."""
    with conexion() as con:
        filas = con.execute(SQL_EXPORTAR, (id_region,)).fetchall()
    if not filas:
        raise SystemExit("La tabla está vacía: no hay nada que exportar.")
    w = csv.writer(salida, delimiter=";", lineterminator="\n")
    w.writerow(COLUMNAS)
    for f in filas:
        w.writerow([f[0], f[1], f[2], float(f[3]), float(f[4]), float(f[5]),
                    "true" if f[6] else "false"])
    return len(filas)


def leer_semilla(ruta=SEMILLA):
    """Filas listas para SQL_GUARDAR, sin id_region (lo pone quien carga)."""
    with open(ruta, encoding="utf-8") as f:
        filas = list(csv.DictReader(f, delimiter=";"))
    if not filas or set(COLUMNAS) - set(filas[0]):
        raise SystemExit("%s no tiene las columnas %s" % (ruta, ", ".join(COLUMNAS)))
    return [{"id_comuna": int(f["id_comuna"]), "origen": f["origen"], "anio": int(f["anio"]),
             "umbral": float(f["umbral_t_ha"]), "ha_evaluadas": float(f["ha_evaluadas"]),
             "ha_sobre_umbral": float(f["ha_sobre_umbral"]),
             "en_dominio": f["en_dominio"].strip().lower() == "true"} for f in filas]


def cargar_semilla(region, ruta=SEMILLA):
    filas = leer_semilla(ruta)
    with Bitacora("Superficie erosionada desde la semilla — %s" % region.nombre) as b:
        with conexion() as con:
            validas = {f[0] for f in con.execute(
                "SELECT id_comuna FROM territorio.comuna WHERE id_region = %s", (region.id_region,))}
            filas = [dict(f, id_region=region.id_region) for f in filas if f["id_comuna"] in validas]
            for f in filas:
                con.execute(SQL_GUARDAR, f)
        b.registros = len(filas)
    print("[superficie] %d comunas cargadas desde %s" % (len(filas), ruta))
    return len(filas)


def main():
    p = argparse.ArgumentParser(description="Superficie con erosión Severa o superior por comuna")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--dir", default=DIR_EROSION)
    p.add_argument("--desde-png", metavar="DIR",
                   help="medir desde los PNG del visor (prototipo/datos/erosion)")
    p.add_argument("--simular", action="store_true")
    p.add_argument("--desde-semilla", action="store_true",
                   help="cargar bd/semillas/superficie_erosionada.csv en vez de medir rásteres")
    p.add_argument("--exportar-semilla", action="store_true",
                   help="escribir la tabla como CSV por la salida estándar")
    args = p.parse_args()

    region = obtener_region(args.region)
    if args.exportar_semilla:
        exportar_semilla(region.id_region)
        return 0
    if args.desde_semilla:
        cargar_semilla(region)
        return 0

    with conexion() as con:
        dominio = {f[0]: (f[1], f[2]) for f in con.execute(SQL_DOMINIO, (ORIGEN, region.id_region))}
    if not dominio:
        raise SystemExit("No hay erosión del cálculo propio en la base. Correr: python -m calcular")

    if args.desde_png:
        pngs = rutas_png(args.desde_png)
        rutas = sorted(pngs[i][0] for i in pngs)
        if not rutas:
            raise SystemExit("No hay PNG ni indice.json en %s" % args.desde_png)
    else:
        pngs = None
        rutas = sorted(glob.glob(os.path.join(args.dir, "erosion_*.tif")))
        if not rutas:
            # Lo normal en cualquier equipo que no sea el que corrió el motor.
            if os.path.exists(SEMILLA) and not args.simular:
                print("[superficie] no hay rásteres en %s: se usa la semilla versionada" % args.dir)
                cargar_semilla(region)
                return 0
            raise SystemExit("No hay rásteres en %s. Generarlos con: python -m mapa_erosion" % args.dir)

    with Bitacora("Superficie erosionada (> %g t/ha/año) — %s" % (UMBRAL_T_HA, region.nombre)) as b:
        filas = []
        print("  %-8s %10s %10s %6s  %s" % ("comuna", "ha eval.", "ha severa", "%", "dominio"))
        for ruta in rutas:
            m = re.search(r"erosion_(\d+)\.(?:tif|png)$", ruta)
            id_comuna = int(m.group(1))
            if id_comuna not in dominio:
                print("  %-8d sin fila en indicadores.erosion: se omite" % id_comuna)
                continue
            anio, en_dominio = dominio[id_comuna]
            evaluadas, severas = (medir_png(*pngs[id_comuna]) if pngs else medir(ruta))
            filas.append({"id_comuna": id_comuna, "id_region": region.id_region, "origen": ORIGEN,
                          "anio": anio, "umbral": UMBRAL_T_HA, "ha_evaluadas": round(evaluadas, 2),
                          "ha_sobre_umbral": round(severas, 2), "en_dominio": bool(en_dominio)})
            print("  %-8d %10.0f %10.0f %5.1f%%  %s" % (id_comuna, evaluadas, severas,
                  100 * severas / evaluadas if evaluadas else 0, "sí" if en_dominio else "NO"))

        if args.simular:
            print("\n[superficie] --simular: no se escribió nada.")
            b.simulada = True
            b.registros = 0
            return 0
        with conexion() as con:
            for f in filas:
                con.execute(SQL_GUARDAR, f)
            con.commit()
        b.registros = len(filas)
        print("\n[superficie] %d comunas guardadas en indicadores.superficie_erosionada" % len(filas))
    return 0


if __name__ == "__main__":
    sys.exit(main())
