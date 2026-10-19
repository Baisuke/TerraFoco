# -*- coding: utf-8 -*-
"""
Erodabilidad del suelo (factor K) desde SoilGrids.

POR QUE NO SE USA UNA FUENTE CHILENA
------------------------------------
Se revisaron las dos disponibles en IDE MINAGRI y ninguna alcanza:

  · `SUELOS_AGROLOGICOS` para O'Higgins entrega solo la **clase de capacidad
    de uso** (III, VII, N.C.). No trae textura ni materia organica.
  · `ANALISIS_DE_SUELOS_DESCARGA` si trae materia organica y pH, pero su unica
    capa cubre la **Region Metropolitana, 2016**.

El nomograma de Wischmeier & Smith necesita textura y materia organica, asi que
con el dato local solo se podria aproximar K desde la clase de capacidad, que
es bastante peor.

SoilGrids (ISRIC) entrega arcilla, limo, arena y carbono organico para todo el
mundo a 250 m, sin credenciales y con cita formal. Es menos preciso que un
estudio agrologico chileno —y eso **hay que declararlo en el informe**— pero
permite aplicar la ecuacion completa en vez de una tabla aproximada.

    ISRIC SoilGrids 2.0 — soilgrids.org

DOS CONVERSIONES QUE HAY QUE CONOCER
------------------------------------
1. SoilGrids entrega valores enteros escalados: hay que dividir por el factor
   que el propio servicio declara (10 para textura y carbono).
2. Entrega **carbono organico**, no materia organica. Se convierte con el
   factor de Van Bemmelen, 1,724. Es una convencion aceptada, no un invento,
   pero es una suposicion mas en la cadena.

MUESTREO
--------
Se consulta el servicio en varios puntos dentro de cada comuna y se promedia.
No se descarga el raster: para un promedio comunal, una malla de puntos bien
repartidos da lo mismo y evita bajar gigabytes.

Uso:
    python -m ingesta.soilgrids --simular
    python -m ingesta.soilgrids --guardar
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

import config
from bd import Bitacora, obtener_region
from indicadores.rusle import RANGOS, factor_K
from ingesta.zonal import geometrias_comunas, limites

SERVICIO = "https://rest.isric.org/soilgrids/v2.0/properties/query"
PROFUNDIDAD = "0-5cm"
PROPIEDADES = ("clay", "silt", "sand", "soc")

# Carbono organico -> materia organica (Van Bemmelen).
FACTOR_MO = 1.724

# El servicio limita la frecuencia de consultas; sin pausa devuelve 429.
ESPERA = 1.2
REINTENTOS = 3

# Sin dato de estructura ni permeabilidad, se usan los codigos centrales del
# nomograma. Es una suposicion declarada: mueve K menos que la textura, pero
# la mueve, y por eso queda a la vista y no escondida dentro de la formula.
ESTRUCTURA_SUPUESTA = 3      # granular media o gruesa
PERMEABILIDAD_SUPUESTA = 4   # lenta a moderada


def consultar(lon, lat):
    """Textura y carbono en un punto. Devuelve porcentajes, ya desescalados."""
    params = [("lon", "%.5f" % lon), ("lat", "%.5f" % lat),
              ("depth", PROFUNDIDAD), ("value", "mean")]
    params += [("property", p) for p in PROPIEDADES]
    url = SERVICIO + "?" + urllib.parse.urlencode(params)

    ultimo = None
    for intento in range(REINTENTOS):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                d = json.loads(r.read().decode())
            break
        except Exception as e:
            ultimo = e
            time.sleep(2 * (intento + 1))
    else:
        raise ultimo

    salida = {}
    for capa in d.get("properties", {}).get("layers", []):
        nombre = capa["name"]
        factor = capa.get("unit_measure", {}).get("d_factor") or 1
        for prof in capa.get("depths", []):
            v = prof.get("values", {}).get("mean")
            if v is None:
                continue
            salida[nombre] = float(v) / float(factor)
    return salida


def puntos_en_comuna(geometria, n_lado=4):
    """Malla regular dentro de la envolvente, filtrada por el poligono."""
    from shapely.geometry import shape, Point

    poligono = shape(geometria)
    minx, miny, maxx, maxy = limites(geometria)
    xs = np.linspace(minx, maxx, n_lado + 2)[1:-1]
    ys = np.linspace(miny, maxy, n_lado + 2)[1:-1]

    dentro = [(float(x), float(y)) for x in xs for y in ys
              if poligono.contains(Point(x, y))]
    if not dentro:
        # Comuna muy estrecha o irregular: el centroide interior siempre cae
        # dentro, aunque el centroide simple podria quedar fuera.
        c = poligono.representative_point()
        dentro = [(float(c.x), float(c.y))]
    return dentro


def k_de_comuna(geometria, n_lado):
    """K medio de la comuna, promediando los puntos consultados."""
    valores, fallos = [], 0
    for lon, lat in puntos_en_comuna(geometria, n_lado):
        try:
            d = consultar(lon, lat)
        except Exception:
            fallos += 1
            continue
        time.sleep(ESPERA)
        if not all(p in d for p in PROPIEDADES):
            fallos += 1
            continue

        # `consultar` YA dividio por el d_factor que declara el servicio, asi
        # que aqui los valores llegan en porcentaje. Volver a dividir por 10
        # daba arcilla de 2% y materia organica de 22%: imposibles ambos, y sin
        # error de por medio. El unico sintoma era un K diez veces mas chico.
        # Textura y carbono NO usan la misma unidad, aunque compartan d_factor:
        #   clay/silt/sand  ->  tras el d_factor quedan en %
        #   soc             ->  tras el d_factor queda en g/kg, y 1% = 10 g/kg
        # Tratarlos igual daba materia organica de 224%, fisicamente imposible.
        arcilla = d["clay"]
        limo = d["silt"]
        arena = d["sand"]
        mo = (d["soc"] / 10.0) * FACTOR_MO

        # La ecuacion pide arena MUY FINA, que SoilGrids no separa. Se toma una
        # fraccion conservadora de la arena total: sobreestimarla inflaria K.
        arena_muy_fina = arena * 0.15

        try:
            k = factor_K(limo, arena_muy_fina, arcilla, mo,
                         ESTRUCTURA_SUPUESTA, PERMEABILIDAD_SUPUESTA)
        except ValueError:
            fallos += 1
            continue
        valores.append({"K": k, "arcilla": arcilla, "limo": limo,
                        "arena": arena, "mo": mo})

    if not valores:
        return None
    return {
        "K": float(np.mean([v["K"] for v in valores])),
        "puntos": len(valores),
        "fallos": fallos,
        "arcilla": float(np.mean([v["arcilla"] for v in valores])),
        "limo": float(np.mean([v["limo"] for v in valores])),
        "arena": float(np.mean([v["arena"] for v in valores])),
        "mo": float(np.mean([v["mo"] for v in valores])),
    }


def main():
    p = argparse.ArgumentParser(description="Factor K desde SoilGrids")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--puntos", type=int, default=3,
                   help="lado de la malla; 3 = hasta 9 puntos por comuna")
    p.add_argument("--anio", type=int, default=2020)
    p.add_argument("--limite", type=int, default=0)
    p.add_argument("--faltantes", action="store_true",
                   help="solo las comunas que aun no tienen K guardado")
    p.add_argument("--guardar", action="store_true")
    p.add_argument("--simular", action="store_true")
    args = p.parse_args()

    region = obtener_region(args.region)
    geometrias = geometrias_comunas(args.region, 4326)

    if args.faltantes:
        # El servicio limita la frecuencia de consultas y algunas comunas se
        # caen por eso. Reintentar solo las que faltan evita repetir media hora
        # de trabajo ya hecho.
        from indicadores.almacen import leer
        con_k = {i for i, d in leer(args.region).items() if "K" in d}
        geometrias = [g for g in geometrias if g[0] not in con_k]
        print("[soilgrids] %d comunas sin K" % len(geometrias))
        if not geometrias:
            print("[soilgrids] no falta ninguna.")
            return 0

    if args.limite:
        geometrias = geometrias[:args.limite]

    print("[soilgrids] %s — %d comunas, malla de %dx%d"
          % (region.nombre, len(geometrias), args.puntos, args.puntos))

    resultados = {}
    for i, (id_comuna, nombre, geo) in enumerate(geometrias, 1):
        d = k_de_comuna(geo, args.puntos)
        if d is None:
            print("  %2d/%d  %-20s sin respuesta del servicio"
                  % (i, len(geometrias), nombre[:20]))
            continue
        resultados[id_comuna] = d
        bajo, alto = RANGOS["K"]
        marca = "" if bajo <= d["K"] <= alto else "  <- fuera de rango"
        print("  %2d/%d  %-20s K %.4f   arcilla %.0f%% limo %.0f%% MO %.1f%%  (%d pts)%s"
              % (i, len(geometrias), nombre[:20], d["K"], d["arcilla"],
                 d["limo"], d["mo"], d["puntos"], marca))
        sys.stdout.flush()

    if not resultados:
        print("[soilgrids] no se obtuvo ningun valor.")
        return 1

    ks = sorted(d["K"] for d in resultados.values())
    print("\n[soilgrids] %d comunas — K entre %.4f y %.4f (mediana %.4f)"
          % (len(ks), ks[0], ks[-1], ks[len(ks) // 2]))

    if args.simular or not args.guardar:
        print("[soilgrids] no se escribio nada (usar --guardar).")
        return 0

    from indicadores.almacen import guardar
    with Bitacora("Ingesta SoilGrids — %s" % region.nombre, fuente="soilgrids") as b:
        valores = {i: d["K"] for i, d in resultados.items()}
        detalles = {i: {"arcilla_pct": round(d["arcilla"], 1),
                        "limo_pct": round(d["limo"], 1),
                        "arena_pct": round(d["arena"], 1),
                        "materia_organica_pct": round(d["mo"], 2),
                        "puntos": d["puntos"],
                        "profundidad": PROFUNDIDAD}
                    for i, d in resultados.items()}
        n, _desc = guardar(args.region, valores, "K", args.anio,
                           "ISRIC SoilGrids 2.0", detalles)
        b.registros = n
    print("[soilgrids] %d factores K guardados" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
