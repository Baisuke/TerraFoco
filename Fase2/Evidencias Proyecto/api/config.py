# -*- coding: utf-8 -*-
"""Configuración de la API. Todo por entorno, nada escrito en el código."""
import os

from dotenv import load_dotenv

load_dotenv()

BD_URL = os.getenv(
    "BD_URL",
    "postgresql://terrafoco:desarrollo_local@localhost:5432/terrafoco",
)

ID_REGION_POR_DEFECTO = int(os.getenv("ID_REGION", "6"))

# Clave de las operaciones de administración (seguridad.py). Sin valor, la
# escritura queda deshabilitada: cerrado por defecto, no abierto.
CLAVE_ADMIN = os.getenv("TERRAFOCO_CLAVE_ADMIN", "")

# Orígenes que el navegador deja leer la API. "*" en desarrollo porque el
# prototipo se abre también desde file:// (origen "null") y desde Codespaces,
# cuya URL cambia con cada espacio. Lo que protege la escritura es la clave,
# no esta lista; en un despliegue público conviene fijarla igual.
ORIGENES = [o.strip() for o in os.getenv("TERRAFOCO_ORIGENES", "*").split(",")
            if o.strip()]
