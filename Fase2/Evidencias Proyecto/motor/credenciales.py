# -*- coding: utf-8 -*-
"""
Estado de las credenciales y prueba de que realmente sirven.

Tener la variable escrita en el .env no significa que funcione: la contraseña
puede estar mal, la cuenta sin verificar o el token vencido. Este comando
distingue las dos cosas -configurada y válida- porque el error tipico aparece
recien a mitad de una descarga larga.

Uso:
    python -m credenciales              # solo mira el .env, no sale a la red
    python -m credenciales --probar     # ademas verifica contra cada servicio
"""
import argparse
import sys

import config

OK, VACIO, MALA = "OK", "sin configurar", "NO valida"


def _probar_earthdata():
    """Pide un token nuevo: es la forma barata de validar la cuenta."""
    import urllib.request
    import base64

    if config.EARTHDATA_TOKEN:
        pet = urllib.request.Request(
            "https://urs.earthdata.nasa.gov/api/users/tokens",
            headers={"Authorization": "Bearer " + config.EARTHDATA_TOKEN},
        )
    else:
        par = "%s:%s" % (config.EARTHDATA_USER, config.EARTHDATA_PASS)
        cab = base64.b64encode(par.encode()).decode()
        pet = urllib.request.Request(
            "https://urs.earthdata.nasa.gov/api/users/tokens",
            headers={"Authorization": "Basic " + cab},
        )
    with urllib.request.urlopen(pet, timeout=20) as r:
        return r.status == 200


def _probar_cdse():
    """Pide un token OAuth2. Si vuelve access_token, la cuenta esta activa."""
    import json
    import urllib.parse
    import urllib.request

    datos = urllib.parse.urlencode({
        "client_id": config.CDSE_CLIENT_ID,
        "username": config.CDSE_USER,
        "password": config.CDSE_PASS,
        "grant_type": "password",
    }).encode()
    pet = urllib.request.Request(config.CDSE_TOKEN_URL, data=datos)
    with urllib.request.urlopen(pet, timeout=20) as r:
        return "access_token" in json.loads(r.read().decode())


PRUEBAS = {"earthdata": _probar_earthdata, "cdse": _probar_cdse}


def revisar(probar=False):
    filas = []
    for nombre, g in config.GRUPOS.items():
        if config.falta(nombre):
            filas.append((nombre, VACIO, g["para"], g["donde"]))
            continue
        if not probar or nombre not in PRUEBAS:
            filas.append((nombre, OK, g["para"], ""))
            continue
        try:
            ok = PRUEBAS[nombre]()
            filas.append((nombre, OK if ok else MALA, g["para"],
                          "" if ok else g["donde"]))
        except Exception as e:
            # Un 401 aqui casi siempre es la cuenta sin verificar por correo.
            filas.append((nombre, MALA, g["para"], "%s: %s" % (type(e).__name__, e)))
    return filas


def main():
    p = argparse.ArgumentParser(description="Estado de las credenciales")
    p.add_argument("--probar", action="store_true",
                   help="verificar contra cada servicio, no solo leer el .env")
    args = p.parse_args()

    filas = revisar(args.probar)
    ancho = max(len(f[0]) for f in filas)
    print()
    for nombre, estado, para, nota in filas:
        print("  %-*s  %-13s  %s" % (ancho, nombre, estado, para))
        if nota:
            print("  %-*s  %-13s  -> %s" % (ancho, "", "", nota))
    print()

    pendientes = [f for f in filas if f[1] != OK]
    if not pendientes:
        print("Todas las credenciales configuradas.")
        return 0
    print("%d pendiente(s). Nada de esto bloquea cargar las capas vectoriales"
          % len(pendientes))
    print("(comunas, CIREN, SIRSD-S), que no piden credenciales.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
