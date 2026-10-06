# -*- coding: utf-8 -*-
"""
Cálculo de la pérdida de suelo propia: A = R x K x LS x C x P.

Junta los factores que hay en `indicadores.factor` y escribe una fila por
comuna en `indicadores.erosion` con `origen='TerraFoco'`. Desde ahí la vista de
pertinencia lo compara con la línea base de CIREN, que es el caso de uso UC-06.

NADA SE INVENTA
---------------
Si a una comuna le falta un factor, **no se calcula**. Rellenar con un promedio
regional produciría un número que parece medido y no lo es, y esa es
exactamente la clase de error que no se detecta mirando el mapa.

La única excepción es **P = 1**, y no es un relleno: significa "sin prácticas
de conservación registradas", que es un estado real y verificable. Cuando
lleguen los datos del SIRSD-S, P baja y la erosión con él — ese descenso es el
efecto medible del programa.

Para los factores que aún no tienen fuente propia se pueden pasar valores
explícitos por línea de comandos. Quedan guardados en la fila con su valor, de
modo que cualquiera puede auditar de dónde salió cada número.

Uso:
    python -m calcular --revisar
    python -m calcular --r 1200 --k 0.035 --simular
    python -m calcular --r 1200 --k 0.035
"""
import argparse
import sys

import config
from bd import Bitacora, conexion, obtener_region
from indicadores.almacen import FACTORES, leer
from indicadores.rusle import (Factores, R_MAXIMO_CONFIABLE,
                               clasificar)

SQL_NOMBRES = """
SELECT id_comuna, nombre FROM territorio.comuna WHERE id_region = %s
"""

SQL_INSERTAR = """
INSERT INTO indicadores.erosion
    (id_region, id_comuna, anio, factor_r, factor_k, factor_ls, factor_c,
     factor_p, perdida_ton_ha, clase, origen, en_dominio)
VALUES (%(id_region)s, %(id_comuna)s, %(anio)s, %(R)s, %(K)s, %(LS)s, %(C)s,
        %(P)s, %(perdida)s, %(clase)s, 'TerraFoco', %(en_dominio)s)
"""


def reunir(id_region, por_defecto):
    """Factores por comuna, completando solo con lo que se pidió explícito.

    Devuelve (listas, faltantes): las comunas completas y, para las demás, qué
    factor les falta.
    """
    datos = leer(id_region)
    listas, faltantes = {}, {}

    for id_comuna, d in datos.items():
        completo, falta = {}, []
        for f in FACTORES:
            if f in d:
                completo[f] = d[f]
            elif f in por_defecto and por_defecto[f] is not None:
                completo[f] = por_defecto[f]
            else:
                falta.append(f)
        if falta:
            faltantes[id_comuna] = falta
        else:
            listas[id_comuna] = completo
    return listas, faltantes


def calcular(listas, r_maximo=R_MAXIMO_CONFIABLE):
    """Aplica RUSLE. Las que quedan fuera de rango se informan, no se guardan."""
    resultados, rechazadas = {}, {}
    for id_comuna, f in listas.items():
        factores = Factores(R=f["R"], K=f["K"], LS=f["LS"], C=f["C"], P=f["P"])
        fuera = factores.validar()
        if fuera:
            rechazadas[id_comuna] = fuera
            continue
        a = factores.perdida()
        resultados[id_comuna] = {"factores": f, "perdida": round(a, 2),
                                 "clase": clasificar(a),
                                 "en_dominio": f["R"] <= r_maximo}
    return resultados, rechazadas


def main():
    p = argparse.ArgumentParser(description="Calcula la perdida de suelo propia")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--anio", type=int, default=2025)
    p.add_argument("--r", type=float, default=None,
                   help="valor de R a usar mientras no haya fuente propia")
    p.add_argument("--k", type=float, default=None, help="idem para K")
    p.add_argument("--p", type=float, default=1.0,
                   help="P por defecto; 1 = sin practicas registradas")
    p.add_argument("--r-maximo", type=float, default=R_MAXIMO_CONFIABLE,
                   help="erosividad sobre la cual la comuna queda fuera del "
                        "dominio de validez del modelo")
    p.add_argument("--precordillera", default="marcar",
                   choices=("marcar", "excluir"),
                   help="marcar: se calcula y se guarda senalada; "
                        "excluir: no se guarda")
    p.add_argument("--revisar", action="store_true",
                   help="solo mostrar que factores hay y cuales faltan")
    p.add_argument("--simular", action="store_true",
                   help="calcular y mostrar, sin escribir")
    args = p.parse_args()

    region = obtener_region(args.region)
    with conexion() as con:
        nombres = dict(con.execute(SQL_NOMBRES, (args.region,)).fetchall())

    datos = leer(args.region)
    print("\nFactores disponibles en %s" % region.nombre)
    print("  " + "-" * 56)
    for f in FACTORES:
        n = sum(1 for d in datos.values() if f in d)
        fuente = ""
        for d in datos.values():
            if f in d:
                fuente = d.get("_fuentes", {}).get(f, "")
                break
        marca = "" if n else "   <- sin datos"
        print("  %-3s %2d de %2d comunas   %s%s"
              % (f, n, len(nombres), fuente, marca))

    if args.revisar:
        print()
        return 0

    por_defecto = {"R": args.r, "K": args.k, "P": args.p}
    usados = {k: v for k, v in por_defecto.items() if v is not None}
    if usados:
        print("\n  Valores dados por linea de comandos: %s"
              % ", ".join("%s=%s" % kv for kv in sorted(usados.items())))

    listas, faltantes = reunir(args.region, por_defecto)

    if faltantes:
        pendientes = {}
        for id_comuna, fs in faltantes.items():
            pendientes.setdefault(tuple(sorted(fs)), []).append(id_comuna)
        print("\n  %d comunas sin calcular:" % len(faltantes))
        for fs, ids in sorted(pendientes.items()):
            print("     falta %-12s %d comunas" % (",".join(fs), len(ids)))

    if not listas:
        print("\nNo hay ninguna comuna con los cinco factores.")
        print("Aportar los que falten con --r y --k, o cargar su fuente.")
        return 1

    resultados, rechazadas = calcular(listas, args.r_maximo)

    if rechazadas:
        print("\n  %d comunas con factores fuera de rango:" % len(rechazadas))
        for id_comuna, motivos in list(rechazadas.items())[:5]:
            print("     %-20s %s" % (nombres.get(id_comuna, id_comuna),
                                     "; ".join(motivos)[:90]))

    print("\n  %-20s %8s %8s %7s %7s %7s %10s  %-11s %s"
          % ("comuna", "R", "K", "LS", "C", "P", "t/ha/anio", "clase", ""))
    for id_comuna, d in sorted(resultados.items(),
                               key=lambda x: -x[1]["perdida"]):
        f = d["factores"]
        marca = "" if d["en_dominio"] else "  <- fuera de dominio"
        print("  %-20s %8.0f %8.4f %7.2f %7.3f %7.3f %10.2f  %-11s%s"
              % (nombres.get(id_comuna, id_comuna)[:20], f["R"], f["K"],
                 f["LS"], f["C"], f["P"], d["perdida"], d["clase"], marca))

    fuera = {k: d for k, d in resultados.items() if not d["en_dominio"]}
    if fuera:
        print("\n  %d comunas fuera del dominio de validez (R > %.0f):"
              % (len(fuera), args.r_maximo))
        print("     %s" % ", ".join(sorted(nombres.get(k, str(k)) for k in fuera)))
        print("     Son precordilleranas. La ecuacion de erosividad no esta")
        print("     calibrada sobre los 1.000 mm anuales y sobreestima ahi.")
        if args.precordillera == "excluir":
            print("     --precordillera excluir: NO se guardan.")
            resultados = {k: d for k, d in resultados.items() if d["en_dominio"]}
        else:
            print("     Se guardan marcadas con en_dominio = false.")

    if args.simular:
        print("\n[calcular] --simular: no se escribio nada.")
        return 0

    with Bitacora("Calculo RUSLE propio — %s" % region.nombre) as b:
        with conexion() as con:
            for id_comuna, d in resultados.items():
                f = d["factores"]
                con.execute(SQL_INSERTAR, {
                    "id_region": args.region, "id_comuna": id_comuna,
                    "anio": args.anio, "R": f["R"], "K": f["K"], "LS": f["LS"],
                    "C": f["C"], "P": f["P"], "perdida": d["perdida"],
                    "clase": d["clase"], "en_dominio": d["en_dominio"]})
        b.registros = len(resultados)

    print("\n[calcular] %d filas escritas con origen='TerraFoco'" % len(resultados))
    print("           Comparar con CIREN:  /pertinencia?origen=TerraFoco")
    return 0


if __name__ == "__main__":
    sys.exit(main())
