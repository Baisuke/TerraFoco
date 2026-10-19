# -*- coding: utf-8 -*-
"""
Validacion del calculo propio contra la linea base de CIREN.

Responde dos preguntas que hasta ahora estaban contestadas en los documentos
pero no en el codigo: cuanto se parece nuestro calculo al inventario oficial,
y hasta donde el modelo es valido.

POR QUE NO SE COMPARAN LOS VALORES
----------------------------------
CIREN y TerraFoco miden el mismo fenomeno con anios, insumos y resoluciones
distintos. Exigir que los numeros coincidan no tendria sentido. Lo que si
tiene sentido es exigir que **ordenen igual el territorio**: si una comuna se
erosiona mas que otra segun CIREN, deberia hacerlo tambien segun el calculo
propio. Por eso la correlacion es de Spearman, sobre rangos, y no de Pearson.

EL UMBRAL NO SE ELIGE PARA QUE LA CORRELACION SALGA BIEN
--------------------------------------------------------
Esa seria la trampa obvia: barrer umbrales y quedarse con el que da el mejor
numero. El umbral sale de un argumento fisico previo —la ecuacion de
erosividad de Renard y Freimund (1994) se ajusto con estaciones bajo los
1.000 mm anuales y sobreestima fuera de ese rango— y la correlacion solo
*confirma* que ahi esta el quiebre. El barrido se imprime entero para que
cualquiera vea que el resultado no depende de haber acertado un numero
exacto.

Sin scipy: Spearman es Pearson sobre rangos, y la significancia se obtiene
por permutaciones. Son treinta lineas y evitan una dependencia mas en una
imagen que ya pesa 1,3 GB.

Uso:
    python -m validar
    python -m validar --umbral 1800
    python -m validar --permutaciones 50000
"""
import argparse
import sys

import numpy as np

import config
from bd import Bitacora, conexion
from indicadores.rusle import R_MAXIMO_CONFIABLE

# Ultimo valor por comuna y origen: la tabla es historica y nunca sobrescribe.
SQL = """
WITH ultima AS (
    SELECT DISTINCT ON (id_comuna, origen)
           id_comuna, origen, perdida_ton_ha, factor_r, anio
    FROM   indicadores.erosion
    WHERE  id_region = %s
    ORDER  BY id_comuna, origen, anio DESC, calculado_en DESC
)
SELECT c.id_comuna, c.nombre,
       b.perdida_ton_ha AS base,
       p.perdida_ton_ha AS propio,
       p.factor_r       AS r
FROM   territorio.comuna c
JOIN   ultima b ON b.id_comuna = c.id_comuna AND b.origen = %s
JOIN   ultima p ON p.id_comuna = c.id_comuna AND p.origen = %s
ORDER  BY p.factor_r DESC NULLS LAST
"""

# El umbral vive junto a las demas constantes del modelo, con su
# justificacion. Aqui solo se usa.
UMBRAL_POR_DEFECTO = R_MAXIMO_CONFIABLE


# --------------------------------------------------------------- estadistica

def rangos(x):
    """Rangos con empates promediados, como hace Spearman."""
    x = np.asarray(x, dtype=float)
    orden = x.argsort()
    r = np.empty(len(x), dtype=float)
    r[orden] = np.arange(1, len(x) + 1, dtype=float)
    # Los empates comparten el promedio de sus posiciones; si no, el resultado
    # dependeria del orden en que vinieron las filas de la base.
    for valor in np.unique(x):
        iguales = x == valor
        if iguales.sum() > 1:
            r[iguales] = r[iguales].mean()
    return r


def spearman(a, b):
    ra, rb = rangos(a), rangos(b)
    ra = ra - ra.mean()
    rb = rb - rb.mean()
    den = np.sqrt((ra ** 2).sum() * (rb ** 2).sum())
    return float((ra * rb).sum() / den) if den else float("nan")


def significancia(a, b, repeticiones, semilla=20260921):
    """Probabilidad de obtener una correlacion asi de fuerte por azar.

    Se baraja uno de los dos vectores muchas veces y se cuenta cuantas veces
    el azar iguala o supera lo observado. No necesita suponer normalidad, que
    con 27 comunas seria una suposicion incomoda.
    """
    obs = abs(spearman(a, b))
    az = np.random.default_rng(semilla)
    b = np.asarray(b, dtype=float)
    veces = sum(1 for _ in range(repeticiones)
                if abs(spearman(a, az.permutation(b))) >= obs)
    return (veces + 1) / (repeticiones + 1)


# ------------------------------------------------------------------ informe

def leer(id_region, base, propio):
    with conexion() as con:
        filas = con.execute(SQL, (id_region, base, propio)).fetchall()
    return [{"id": f[0], "nombre": f[1], "base": float(f[2]),
             "propio": float(f[3]), "r": float(f[4]) if f[4] else None}
            for f in filas]


def barrido(filas, candidatos):
    """Correlacion resultante al excluir las comunas sobre cada umbral."""
    salida = []
    for u in candidatos:
        dentro = [f for f in filas if f["r"] is not None and f["r"] <= u]
        if len(dentro) < 5:
            continue
        rho = spearman([f["base"] for f in dentro],
                       [f["propio"] for f in dentro])
        salida.append((u, len(dentro), rho))
    return salida


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--base", default="CIREN")
    p.add_argument("--propio", default="TerraFoco")
    p.add_argument("--umbral", type=float, default=UMBRAL_POR_DEFECTO)
    p.add_argument("--permutaciones", type=int, default=20000)
    args = p.parse_args()

    filas = leer(args.region, args.base, args.propio)
    if len(filas) < 5:
        print("Hacen falta los dos origenes cargados. Hay %d comunas con "
              "ambos." % len(filas))
        return 1

    base = [f["base"] for f in filas]
    propio = [f["propio"] for f in filas]

    print("\nValidacion de %s contra %s" % (args.propio, args.base))
    print("=" * 68)
    print("  %d comunas con ambos origenes" % len(filas))

    rho_todas = spearman(base, propio)
    print("\n1. CON TODAS LAS COMUNAS")
    print("   rho de Spearman: %+.3f" % rho_todas)
    if abs(rho_todas) < 0.2:
        print("   Practicamente ninguna relacion. Algo hay que explicar.")

    # --- donde esta el quiebre -------------------------------------------
    print("\n2. LAS COMUNAS, ORDENADAS POR EROSIVIDAD")
    print("   %-22s %8s %9s %9s" % ("comuna", "R", args.base, args.propio))
    print("   " + "-" * 52)
    for f in filas:
        marca = "  <- sobre el umbral" if f["r"] and f["r"] > args.umbral else ""
        print("   %-22s %8.0f %9.2f %9.2f%s"
              % (f["nombre"][:22], f["r"] or 0, f["base"], f["propio"], marca))

    dentro = [f for f in filas if f["r"] is not None and f["r"] <= args.umbral]
    fuera = [f for f in filas if f not in dentro]

    print("\n3. EXCLUYENDO LAS %d SOBRE R = %.0f" % (len(fuera), args.umbral))
    if not fuera:
        print("   Ninguna comuna supera el umbral: no hay nada que excluir.")
        rho_dentro = rho_todas
    else:
        rho_dentro = spearman([f["base"] for f in dentro],
                              [f["propio"] for f in dentro])
        print("   quedan %d comunas" % len(dentro))
        print("   rho de Spearman: %+.3f   (era %+.3f)" % (rho_dentro, rho_todas))
        print("   fuera: %s" % ", ".join(f["nombre"] for f in fuera))

        pv = significancia([f["base"] for f in dentro],
                           [f["propio"] for f in dentro], args.permutaciones)
        print("   p = %.4f  por %d permutaciones" % (pv, args.permutaciones))
        print("   %s" % ("Dificil de atribuir al azar." if pv < 0.05
                         else "No se puede descartar el azar."))

    # --- que tan sensible es el resultado al umbral elegido ---------------
    print("\n4. SENSIBILIDAD AL UMBRAL")
    print("   El umbral sale de la calibracion de la ecuacion, no de buscar")
    print("   el mejor numero. Esto muestra que no depende de acertarlo:")
    print("\n   %8s %9s %8s" % ("umbral", "comunas", "rho"))
    print("   " + "-" * 27)
    for u, n, rho in barrido(filas, [1200, 1500, 1800, 2000, 2200, 2500, 3000]):
        marca = "  <-- el declarado" if u == args.umbral else ""
        print("   %8.0f %9d %+8.3f%s" % (u, n, rho, marca))

    print("\n" + "=" * 68)
    print("Dominio de validez declarado: R <= %.0f" % args.umbral)
    print("%d de %d comunas dentro, rho = %+.3f"
          % (len(dentro), len(filas), rho_dentro))
    print("Fuera del dominio el modelo sobreestima y las comunas quedan")
    print("marcadas con en_dominio = false, no se ocultan.\n")
    return 0


if __name__ == "__main__":
    with Bitacora("Validacion contra linea base") as b:
        codigo = main()
        b.registros = 1
    sys.exit(codigo)
