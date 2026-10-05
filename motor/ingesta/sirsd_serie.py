# -*- coding: utf-8 -*-
"""
Carga la serie del SIRSD-S 2012-2025 por comuna y año (programas.sirsd_anual).

La serie la extrajo el equipo de la réplica de la base de INDAP (DWH_ODS,
BD_SIRSD_S) con una sola definición; está documentada en
docs/17-serie-sirsd.md. Se complementa con los agregados de la entrega
oficial (herramientas/agregar_entrega_indap.py): asesoría técnica,
superficie agrícola de los predios y los totales oficiales que sirven de
control.

Lo que hace además de copiar:
  - marca inversion_anomala cuando la inversión supera 3 veces el incentivo
    (6307/2017: 4.811 millones contra ~100 en los años vecinos, error del
    sistema de origen). El incentivo de esa celda se carga igual: es correcto;
  - compara cada celda contra la entrega oficial y lo informa;
  - rechaza la carga si faltan comunas o años, en vez de dejar un índice
    calculado sobre una región incompleta sin que nadie lo note.

Uso:
    python -m ingesta.sirsd_serie --simular
    python -m ingesta.sirsd_serie
"""
import argparse
import os
import sys

import pandas as pd

import config
from bd import Bitacora, conexion, obtener_region

SEMILLAS = os.environ.get("DIR_SEMILLAS", "/bd/semillas")
SERIE = os.path.join(SEMILLAS, "sirsd_serie_definitiva_2012_2025.csv")
COMPLEMENTO = os.path.join(SEMILLAS, "sirsd_complemento_oficial_2012_2025.csv")
FUENTE = "INDAP DWH_ODS · BD_SIRSD_S"

# Lo normal es ~1,25 (el incentivo es el 90% del costo de tabla y el
# agricultor aporta el resto). Tres veces es imposible dentro de las reglas.
RAZON_ANOMALA = 3.0

COLUMNAS_SERIE = ["id_comuna", "anio", "planes", "agricultores", "incentivo",
                  "inversion_total", "ha_reales", "ha_ejecutada", "ha_practica"]

SQL_GUARDAR = """
INSERT INTO programas.sirsd_anual
       (id_comuna, anio, planes, agricultores, incentivo, inversion_total,
        inversion_anomala, ha_reales, ha_ejecutada, ha_practica,
        ases_formulacion, ases_ejecucion, supagr_predios,
        planes_oficial, incentivo_oficial, fuente)
VALUES (%(id_comuna)s, %(anio)s, %(planes)s, %(agricultores)s, %(incentivo)s,
        %(inversion_total)s, %(inversion_anomala)s, %(ha_reales)s,
        %(ha_ejecutada)s, %(ha_practica)s, %(ases_formulacion)s,
        %(ases_ejecucion)s, %(supagr_predios)s, %(planes_oficial)s,
        %(incentivo_oficial)s, %(fuente)s)
ON CONFLICT (id_comuna, anio) DO UPDATE SET
       planes = EXCLUDED.planes, agricultores = EXCLUDED.agricultores,
       incentivo = EXCLUDED.incentivo, inversion_total = EXCLUDED.inversion_total,
       inversion_anomala = EXCLUDED.inversion_anomala, ha_reales = EXCLUDED.ha_reales,
       ha_ejecutada = EXCLUDED.ha_ejecutada, ha_practica = EXCLUDED.ha_practica,
       ases_formulacion = EXCLUDED.ases_formulacion,
       ases_ejecucion = EXCLUDED.ases_ejecucion,
       supagr_predios = EXCLUDED.supagr_predios,
       planes_oficial = EXCLUDED.planes_oficial,
       incentivo_oficial = EXCLUDED.incentivo_oficial,
       fuente = EXCLUDED.fuente, cargado_en = now()
"""


def leer(serie=SERIE, complemento=COMPLEMENTO):
    """Serie + complemento, en una tabla por comuna y año."""
    s = pd.read_csv(serie, sep=";")
    faltan = [c for c in COLUMNAS_SERIE if c not in s.columns]
    if faltan:
        raise SystemExit("La serie no trae las columnas %s" % faltan)
    s = s[COLUMNAS_SERIE]
    if os.path.exists(complemento):
        c = pd.read_csv(complemento, sep=";")
        s = s.merge(c[["id_comuna", "anio", "ases_formulacion", "ases_ejecucion",
                       "supagr_predios", "planes_oficial", "incentivo_oficial"]],
                    on=["id_comuna", "anio"], how="left")
    else:
        print("[sirsd] sin complemento oficial (%s): se carga la serie sola" % complemento)
        for col in ("ases_formulacion", "ases_ejecucion", "supagr_predios",
                    "planes_oficial", "incentivo_oficial"):
            s[col] = None
    return s


def marcar_anomalias(s, razon=RAZON_ANOMALA):
    s = s.copy()
    s["inversion_anomala"] = (s.inversion_total > razon * s.incentivo).fillna(False)
    return s


def revisar_cobertura(s, comunas_region):
    """Mensajes de lo que falta. Vacío si la serie cubre la región."""
    problemas = []
    sobran = sorted(set(s.id_comuna) - set(comunas_region))
    faltan = sorted(set(comunas_region) - set(s.id_comuna))
    if sobran:
        problemas.append("comunas que no son de la región: %s" % sobran)
    if faltan:
        problemas.append("comunas sin ninguna fila: %s" % faltan)
    if s.duplicated(["id_comuna", "anio"]).any():
        problemas.append("celdas comuna-año duplicadas")
    return problemas


def a_filas(s):
    def limpio(v):
        return None if pd.isna(v) else (int(v) if float(v).is_integer() else float(v))
    filas = []
    for r in s.to_dict("records"):
        f = {k: limpio(v) if k not in ("inversion_anomala",) else bool(v) for k, v in r.items()}
        f["fuente"] = FUENTE
        filas.append(f)
    return filas


def main():
    p = argparse.ArgumentParser(description="Carga la serie del SIRSD-S 2012-2025")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--serie", default=SERIE)
    p.add_argument("--complemento", default=COMPLEMENTO)
    p.add_argument("--simular", action="store_true")
    args = p.parse_args()

    region = obtener_region(args.region)
    with Bitacora("Serie SIRSD-S 2012-2025 — %s" % region.nombre, fuente="indap_serie") as b:
        s = marcar_anomalias(leer(args.serie, args.complemento))
        with conexion() as con:
            comunas = [f[0] for f in con.execute(
                "SELECT id_comuna FROM territorio.comuna WHERE id_region = %s", (region.id_region,))]
        problemas = revisar_cobertura(s, comunas)
        if problemas:
            raise SystemExit("[sirsd] no se carga: " + "; ".join(problemas))

        print("[sirsd] %d celdas, %d comunas, %d-%d, incentivo total $%s"
              % (len(s), s.id_comuna.nunique(), s.anio.min(), s.anio.max(),
                 f"{s.incentivo.sum():,.0f}".replace(",", ".")))
        for _, r in s[s.inversion_anomala].iterrows():
            print("[sirsd] inversión anómala marcada: %d/%d (%.0f millones con incentivo de %.0f)"
                  % (r.id_comuna, r.anio, r.inversion_total / 1e6, r.incentivo / 1e6))
        if s.planes_oficial.notna().any():
            con_of = s[s.planes_oficial.notna()]
            exactas = int((con_of.planes == con_of.planes_oficial).sum())
            dif_inc = 100 * (con_of.incentivo.sum() - con_of.incentivo_oficial.sum()) / con_of.incentivo_oficial.sum()
            print("[sirsd] contra la entrega oficial: %d de %d celdas con los mismos planes; "
                  "incentivo %+.3f%%" % (exactas, len(con_of), dif_inc))

        if args.simular:
            print("[sirsd] --simular: no se escribió nada.")
            b.simulada = True
            b.registros = 0
            return 0
        filas = a_filas(s)
        with conexion() as con:
            for f in filas:
                con.execute(SQL_GUARDAR, f)
        b.registros = len(filas)
        print("[sirsd] %d celdas en programas.sirsd_anual" % len(filas))
    return 0


if __name__ == "__main__":
    sys.exit(main())
