# -*- coding: utf-8 -*-
"""
Configuración del motor.

Regla de oro del proyecto: **ninguna coordenada, ningún código de región y
ninguna credencial escritos en el código**. Las coordenadas del área de interés
salen de la tabla `territorio.region`; el resto, del entorno.

Eso es lo que permite agregar una región nueva insertando una fila.
"""
import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


# --------------------------------------------------------------------------
# Conexión a la base de datos
# --------------------------------------------------------------------------

BD_URL = os.getenv(
    "BD_URL",
    "postgresql://terrafoco:desarrollo_local@localhost:5432/terrafoco",
)

# Región sobre la que opera esta ejecución. Se cambia por variable de entorno,
# no editando el código.
ID_REGION = int(os.getenv("ID_REGION", "6"))   # 6 = O'Higgins

# Dónde se guardan las descargas antes de cargarlas a PostGIS
DIR_DATOS = os.getenv("DIR_DATOS", "/datos")


# --------------------------------------------------------------------------
# Credenciales de los repositorios satelitales
# --------------------------------------------------------------------------

EARTHDATA_USER = os.getenv("EARTHDATA_USER", "")
EARTHDATA_PASS = os.getenv("EARTHDATA_PASS", "")
EARTHDATA_TOKEN = os.getenv("EARTHDATA_TOKEN", "")

CDSE_USER = os.getenv("CDSE_USER", "")
CDSE_PASS = os.getenv("CDSE_PASS", "")
CDSE_S3_ACCESS_KEY = os.getenv("CDSE_S3_ACCESS_KEY", "")
CDSE_S3_SECRET_KEY = os.getenv("CDSE_S3_SECRET_KEY", "")

USGS_USER = os.getenv("USGS_USER", "")
USGS_TOKEN = os.getenv("USGS_TOKEN", "")

# Cliente OAuth de Sentinel Hub: permite calcular el NDVI en el servidor y
# traer solo la estadistica por comuna, en vez de descargar las escenas.
SH_CLIENT_ID = os.getenv("SH_CLIENT_ID", "")
SH_CLIENT_SECRET = os.getenv("SH_CLIENT_SECRET", "")

# CDSE no emite API keys: se pide un token OAuth2 con usuario y contraseña.
CDSE_TOKEN_URL = (
    "https://identity.dataspace.copernicus.eu"
    "/auth/realms/CDSE/protocol/openid-connect/token"
)
CDSE_CLIENT_ID = "cdse-public"
CDSE_S3_ENDPOINT = "https://eodata.dataspace.copernicus.eu"


# --------------------------------------------------------------------------
# Parámetros de procesamiento
# --------------------------------------------------------------------------

EPSG_ALMACENAMIENTO = 4326    # todo se guarda en geográficas
TAMANO_TESELA = 256           # px; sin trocear, el raster es inconsultable
NUBOSIDAD_MAXIMA = 10         # % para descartar escenas de Sentinel-2


@dataclass(frozen=True)
class Region:
    """Área de interés leída desde la base de datos."""
    id_region: int
    codigo: str
    nombre: str
    epsg_trabajo: int
    resolucion_m: int
    # (oeste, sur, este, norte) en EPSG:4326
    bbox: tuple


# --------------------------------------------------------------------------
# Credenciales: qué hace falta para cada cosa
#
# Se comprueba por grupo y no en bloque, porque cada tarea necesita lo suyo:
# cargar las comunas no requiere ninguna credencial, y descargar el modelo de
# elevación no requiere las de Copernicus. Exigirlas todas de entrada frenaría
# trabajo que sí se puede hacer.
# --------------------------------------------------------------------------

GRUPOS = {
    "earthdata": {
        "para": "descargar NASADEM (factor LS)",
        "donde": "https://urs.earthdata.nasa.gov",
        # Usuario y contraseña, SIEMPRE: la biblioteca earthaccess no acepta
        # token de acceso, solo EARTHDATA_USERNAME / EARTHDATA_PASSWORD o un
        # .netrc. EARTHDATA_TOKEN queda disponible para descargas por HTTP
        # directo, pero no sustituye a la contraseña para NASADEM.
        "requiere": lambda: bool(EARTHDATA_USER and EARTHDATA_PASS),
        "variables": "EARTHDATA_USER + EARTHDATA_PASS (el token NO los reemplaza)",
    },
    "cdse": {
        "para": "descargar Sentinel-2 (factor C)",
        "donde": "https://dataspace.copernicus.eu",
        "requiere": lambda: bool(CDSE_USER and CDSE_PASS),
        "variables": "CDSE_USER + CDSE_PASS",
    },
    "sentinel_hub": {
        "para": "calcular NDVI en el servidor (factor C)",
        "donde": "https://shapps.dataspace.copernicus.eu/dashboard",
        "requiere": lambda: bool(SH_CLIENT_ID and SH_CLIENT_SECRET),
        "variables": "SH_CLIENT_ID + SH_CLIENT_SECRET",
    },
    "cdse_s3": {
        "para": "descargas masivas de Sentinel-2 por S3",
        "donde": "https://eodata-s3keysmanager.dataspace.copernicus.eu",
        "requiere": lambda: bool(CDSE_S3_ACCESS_KEY and CDSE_S3_SECRET_KEY),
        "variables": "CDSE_S3_ACCESS_KEY + CDSE_S3_SECRET_KEY",
    },
    "usgs": {
        "para": "descargar Landsat, banda térmica (módulo 3)",
        "donde": "https://ers.cr.usgs.gov/profile/access",
        "requiere": lambda: bool(USGS_USER and USGS_TOKEN),
        "variables": "USGS_USER + USGS_TOKEN",
    },
}


def falta(grupo):
    """Mensaje accionable si al grupo le faltan credenciales; None si está listo."""
    g = GRUPOS[grupo]
    if g["requiere"]():
        return None
    return (
        "Faltan credenciales para %s.\n"
        "  Completar en el .env:  %s\n"
        "  Se obtienen en:        %s"
        % (g["para"], g["variables"], g["donde"])
    )


def exigir(grupo):
    """Falla temprano y con instrucciones, en vez de reventar a mitad de descarga."""
    mensaje = falta(grupo)
    if mensaje:
        raise SystemExit(mensaje)


def credenciales_faltantes():
    """Grupos sin configurar. Para el diagnóstico de arranque."""
    return [n for n in GRUPOS if falta(n)]
