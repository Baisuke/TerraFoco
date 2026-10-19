# -*- coding: utf-8 -*-
"""
Temperatura superficial desde ECOSTRESS — HU-18, modulo 3.

POR QUE ECOSTRESS Y NO LANDSAT
------------------------------
La historia dice "desde las bandas termicas de Landsat", y Landsat sigue
siendo la referencia. Pero su descarga masiva pasa por la interfaz M2M del
USGS, que exige una aprobacion que el proyecto no tiene y cuyas credenciales
estan vacias. ECOSTRESS esta en NASA Earthdata, donde las credenciales ya
funcionan porque de ahi sale el modelo de elevacion.

El cambio ademas mejora el instrumento. Landsat pasa siempre a la misma hora
de la manana; ECOSTRESS va en la Estacion Espacial y pasa a horas distintas,
incluida la noche. La isla de calor urbana se manifiesta sobre todo de noche,
cuando el hormigon devuelve el calor que acumulo de dia: medirla solo a las
diez de la manana la subestima.

EL PRODUCTO
-----------
Se usa ECO_L2T_LSTE, la version en mosaico y ya proyectada. Comprobado sobre
una escena real, no supuesto:

  - la banda LST viene en float32 y **ya en Kelvin**, sin factor de escala
  - el relleno es NaN
  - EPSG:32719, que es el sistema de trabajo del proyecto
  - 70 m de resolucion, teselas de 1568x1568
  - trae mascaras de nube y de agua en archivos aparte

Aplicarle el factor 0,02 que documentan otras versiones del producto da
-267 C, o sea que delata el error de inmediato. Se deja anotado porque el
proximo que lo lea va a tener la misma duda.

Uso:
    python -m ingesta.ecostress --revisar
    python -m ingesta.ecostress --simular
    python -m ingesta.ecostress --guardar
"""
import argparse
import glob
import os
import sys
import time

import numpy as np

import config
from bd import Bitacora, conexion, obtener_region

DIR_POR_DEFECTO = os.path.join(config.DIR_DATOS, "ecostress")
COLECCION = "ECO_L2T_LSTE"

# Enero y febrero: la isla de calor se mide en verano. Fuera de esa ventana el
# dato existe pero no responde la pregunta.
MESES_VERANO = (1, 2)

CERO_ABSOLUTO = 273.15

# Rangos de cordura para una superficie terrestre. Una escena que se sale de
# aqui trae un error de unidades o de relleno, y es mejor descartarla que
# promediarla con las buenas.
C_MINIMO, C_MAXIMO = -20.0, 75.0

# El servidor de la NASA devuelve 502 intermitentes. Mismas cifras que la
# ingesta de CIREN, que sufrio lo mismo.
REINTENTOS = 4
ESPERA_BASE = 8      # segundos, se multiplica por el numero de intento


def _rasterio():
    try:
        import rasterio
        return rasterio
    except ImportError:
        sys.exit("Falta rasterio. Corre dentro del contenedor del motor.")


# ------------------------------------------------------------------ descarga

SQL_CAJA = """
SELECT ST_XMin(geom), ST_YMin(geom), ST_XMax(geom), ST_YMax(geom), nombre
FROM   territorio.comuna WHERE id_comuna = %s
"""


def caja_de_comuna(id_comuna):
    """Envolvente de una comuna, para buscar solo las teselas que la cubren.

    Buscar con la caja de la region entera trae la primera tesela que
    responda, que puede estar a cien kilometros de la ciudad de interes: la
    primera corrida devolvio las comunas costeras en vez de Rancagua. El
    modulo 3 es sobre UNA ciudad, asi que la busqueda tiene que serlo tambien.
    """
    with conexion() as con:
        f = con.execute(SQL_CAJA, (id_comuna,)).fetchone()
    if not f:
        sys.exit("No existe la comuna %s" % id_comuna)
    return (float(f[0]), float(f[1]), float(f[2]), float(f[3])), f[4]


def descargar(caja, destino, desde, hasta, limite):
    import earthaccess

    # earthaccess solo lee EARTHDATA_USERNAME/PASSWORD. El proyecto los llama
    # EARTHDATA_USER/PASS: sin este puente la busqueda funciona igual, porque
    # el catalogo es publico, y la descarga falla con un mensaje que no dice
    # que el problema son las credenciales.
    os.environ.setdefault("EARTHDATA_USERNAME", config.EARTHDATA_USER or "")
    os.environ.setdefault("EARTHDATA_PASSWORD", config.EARTHDATA_PASS or "")
    earthaccess.login(strategy="environment", persist=False)

    print("[ecostress] buscando escenas de %s a %s" % (desde, hasta))
    granulos = earthaccess.search_data(
        short_name=COLECCION, bounding_box=caja,
        temporal=(desde, hasta), count=limite)
    print("[ecostress] %d granulos" % len(granulos))
    if not granulos:
        return []

    os.makedirs(destino, exist_ok=True)

    # Se baja de a un granulo, con reintentos, en vez de pasar la lista entera.
    #
    # El servidor de la NASA devuelve 502 de vez en cuando, y earthaccess
    # aborta el lote completo ante el primer fallo: diez escenas se perdian
    # porque una no respondio. Mismo criterio que la ingesta de CIREN, que
    # tuvo el mismo problema con su servidor.
    archivos, fallados = [], 0
    for i, g in enumerate(granulos, 1):
        for intento in range(1, REINTENTOS + 1):
            try:
                archivos += earthaccess.download([g], destino)
                break
            except Exception as e:
                if intento == REINTENTOS:
                    fallados += 1
                    print("[ecostress] granulo %d/%d descartado tras %d "
                          "intentos: %s" % (i, len(granulos), REINTENTOS,
                                            str(e)[:60]))
                    break
                espera = ESPERA_BASE * intento
                print("[ecostress] granulo %d/%d fallo (%s); reintento en %ds"
                      % (i, len(granulos), str(e)[:40], espera))
                time.sleep(espera)

    if fallados:
        print("[ecostress] %d de %d granulos no se pudieron bajar. Se sigue "
              "con los demas." % (fallados, len(granulos)))
    return archivos


# ----------------------------------------------------------------- lectura

def es_de_verano(ruta):
    """La fecha viene en el nombre: ..._20250101T230928_..."""
    for parte in os.path.basename(ruta).split("_"):
        if len(parte) == 15 and parte[8] == "T" and parte[:8].isdigit():
            return int(parte[4:6]) in MESES_VERANO
    return False


def escenas(directorio, solo_verano=True):
    rutas = sorted(glob.glob(os.path.join(directorio, "*_LST.tif")))
    return [r for r in rutas if not solo_verano or es_de_verano(r)]


def leer_celsius(ruta_lst):
    """Temperatura en grados, con nube y agua descartadas.

    Devuelve (arreglo enmascarado, perfil) o (None, None) si la escena no
    tiene nada util: una escena completamente nublada no aporta y promediarla
    ensuciaria el resultado.
    """
    rasterio = _rasterio()
    with rasterio.open(ruta_lst) as d:
        kelvin = d.read(1).astype("float32")
        perfil = d.profile

    celsius = kelvin - CERO_ABSOLUTO
    valido = np.isfinite(celsius) & (celsius > C_MINIMO) & (celsius < C_MAXIMO)

    # El agua y las nubes vienen en archivos hermanos. Si faltan se sigue sin
    # ellos: es peor descartar la escena entera que perder el enmascarado.
    for sufijo in ("_cloud.tif", "_water.tif"):
        hermano = ruta_lst.replace("_LST.tif", sufijo)
        if not os.path.exists(hermano):
            continue
        with rasterio.open(hermano) as d:
            marca = d.read(1)
        valido &= (marca == 0)

    if not valido.any():
        return None, None
    return np.where(valido, celsius, np.nan), perfil


def promedio_de_escenas(rutas):
    """Media por celda entre escenas, ignorando las celdas sin dato.

    Una sola pasada de ECOSTRESS trae huecos por nube y por el borde de la
    orbita. Promediando varias del mismo verano el mosaico se completa y el
    resultado deja de depender del dia que toco.
    """
    suma = cuenta = perfil = None
    usadas = 0
    for ruta in rutas:
        datos, p = leer_celsius(ruta)
        if datos is None:
            continue
        if suma is None:
            suma = np.zeros(datos.shape, dtype="float64")
            cuenta = np.zeros(datos.shape, dtype="int32")
            perfil = p
        elif datos.shape != suma.shape:
            # Teselas distintas no se pueden apilar sin remuestrear. Se avisa
            # en vez de mezclarlas en silencio.
            print("[ecostress] se omite %s: tesela distinta"
                  % os.path.basename(ruta))
            continue
        hay = np.isfinite(datos)
        suma[hay] += datos[hay]
        cuenta[hay] += 1
        usadas += 1

    if not usadas:
        return None, None, 0
    media = np.where(cuenta > 0, suma / np.maximum(cuenta, 1), np.nan)
    return media.astype("float32"), perfil, usadas


# ------------------------------------------------------------ almacenamiento

SQL_GUARDAR = """
INSERT INTO indicadores.urbano
       (id_comuna, anio, temp_superficial, temp_maxima, temp_minima,
        escenas_usadas, fuente)
VALUES (%(id_comuna)s, %(anio)s, %(media)s, %(max)s, %(min)s,
        %(escenas)s, %(fuente)s)
"""


def guardar(valores, anio, escenas_usadas, fuente):
    with conexion() as con:
        for id_comuna, v in sorted(valores.items()):
            con.execute(SQL_GUARDAR, {
                "id_comuna": id_comuna, "anio": anio,
                "media": round(v["media"], 2),
                "max": round(v["max"], 2), "min": round(v["min"], 2),
                "escenas": escenas_usadas, "fuente": fuente})
        con.commit()
    return len(valores)


# --------------------------------------------------------------- agregacion

def por_comuna(media, perfil, id_region):
    """Media, maxima y minima dentro de cada comuna.

    No se usa `agregar_por_comuna` de zonal.py porque aquel devuelve solo el
    promedio, y aqui la diferencia entre el punto mas caliente y el mas frio
    de la comuna ES el indicador: eso es la isla de calor. Un promedio no la
    muestra.
    """
    rasterio = _rasterio()
    from rasterio.features import geometry_mask
    from ingesta.zonal import geometrias_comunas

    epsg = int(str(perfil["crs"]).split(":")[-1])
    geoms = geometrias_comunas(id_region, epsg)

    salida = {}
    for id_comuna, nombre, geom in geoms:
        try:
            dentro = ~geometry_mask([geom], out_shape=media.shape,
                                    transform=perfil["transform"],
                                    invert=False)
        except Exception:
            continue
        v = media[dentro & np.isfinite(media)]
        # Menos de cien celdas es una esquina de la comuna asomando en la
        # tesela, no la comuna: su estadistica no representa nada.
        if v.size < 100:
            continue
        salida[id_comuna] = {"nombre": nombre, "media": float(v.mean()),
                             "max": float(np.percentile(v, 99)),
                             "min": float(np.percentile(v, 1)),
                             "celdas": int(v.size)}
    return salida


# --------------------------------------------------------------------- main

def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    p.add_argument("--region", type=int, default=config.ID_REGION)
    # Rancagua: es la ciudad que el alcance declara para el modulo urbano.
    p.add_argument("--comuna", type=int, default=6101,
                   help="comuna cuya ciudad se analiza")
    p.add_argument("--anio", type=int, default=2025)
    p.add_argument("--dir", default=DIR_POR_DEFECTO)
    p.add_argument("--descargar", action="store_true",
                   help="baja escenas antes de calcular")
    p.add_argument("--limite", type=int, default=40,
                   help="maximo de granulos a descargar")
    p.add_argument("--revisar", action="store_true",
                   help="solo decir que escenas hay en disco")
    p.add_argument("--simular", action="store_true",
                   help="calcular y mostrar, sin escribir")
    p.add_argument("--guardar", action="store_true")
    args = p.parse_args()

    caja, nombre_comuna = caja_de_comuna(args.comuna)
    print("[ecostress] ciudad objetivo: %s" % nombre_comuna)

    if args.descargar:
        descargar(caja, args.dir,
                  "%d-01-01" % args.anio, "%d-02-28" % args.anio, args.limite)

    rutas = escenas(args.dir)
    print("\n[ecostress] %d escenas de verano en %s" % (len(rutas), args.dir))
    if args.revisar:
        for r in rutas[:12]:
            print("   %s" % os.path.basename(r))
        return 0
    if not rutas:
        print("   No hay escenas. Corre con --descargar.")
        return 1

    media, perfil, usadas = promedio_de_escenas(rutas)
    if media is None:
        print("   Ninguna escena aporto celdas validas.")
        return 1
    validas = np.isfinite(media)
    print("[ecostress] %d escenas promediadas, %d celdas con dato"
          % (usadas, int(validas.sum())))
    print("[ecostress] rango %.1f a %.1f C"
          % (np.nanmin(media), np.nanmax(media)))

    valores = por_comuna(media, perfil, args.region)
    # Se conserva la comuna objetivo y sus vecinas dentro de la tesela: el
    # contraste con el entorno rural ES la isla de calor.
    if not valores:
        print("   Ninguna comuna quedo dentro de la tesela descargada.")
        return 1

    print("\n   %-22s %8s %8s %8s %9s"
          % ("comuna", "media", "p99", "p01", "celdas"))
    print("   " + "-" * 60)
    for _id, v in sorted(valores.items(), key=lambda x: -x[1]["media"]):
        print("   %-22s %8.1f %8.1f %8.1f %9d"
              % (v["nombre"][:22], v["media"], v["max"], v["min"], v["celdas"]))

    if args.guardar and not args.simular:
        fuente = "ECOSTRESS %s (%d escenas)" % (COLECCION, usadas)
        n = guardar(valores, args.anio, usadas, fuente)
        print("\n[ecostress] %d comunas escritas en indicadores.urbano" % n)
    else:
        print("\n[ecostress] --simular: no se escribio nada.")
    return 0


if __name__ == "__main__":
    with Bitacora("Ingesta ECOSTRESS - temperatura superficial", fuente="ecostress") as b:
        codigo = main()
        b.registros = 0 if codigo else None
    sys.exit(codigo)
