# -*- coding: utf-8 -*-
"""Sondeo: que productos de temperatura superficial alcanzamos con las
credenciales de Earthdata que ya funcionan, sin depender del USGS."""
import earthaccess

# Rancagua y alrededores
CAJA = (-70.90, -34.30, -70.60, -34.10)
CANDIDATOS = [
    ("ECOSTRESS LST 70 m", "ECO_L2T_LSTE"),
    ("ECOSTRESS LST v1", "ECO2LSTE"),
    ("Landsat C2 L2 (ST)", "Landsat"),
    ("MODIS LST 1 km", "MOD11A1"),
    ("ASTER LST 90 m", "AST_08"),
]

earthaccess.login(strategy="environment", persist=False)
print("  autenticado\n")
for nombre, patron in CANDIDATOS:
    try:
        r = earthaccess.search_data(short_name=patron, bounding_box=CAJA,
                                    temporal=("2024-01-01", "2025-03-31"),
                                    count=3)
        print("  %-22s %d granulos" % (nombre, len(r)))
        if r:
            print("       ej: %s" % str(r[0]).split("\n")[0][:90])
    except Exception as e:
        print("  %-22s error: %s" % (nombre, str(e)[:60]))
