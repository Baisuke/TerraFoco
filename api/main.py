# -*- coding: utf-8 -*-
"""
API REST de TerraFoco.

Expone los indicadores calculados por el motor. No procesa nada: solo consulta
PostGIS y devuelve JSON. El procesamiento pesado vive en el worker, separado,
para que una ingesta de imágenes no bloquee las consultas del visor.

Documentación interactiva: http://localhost:8000/docs
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

import config
from rutas import (comunas, ejecuciones, exposicion, fuentes, inundacion, localidades,
                   pertinencia, regiones, salud, urbano)

app = FastAPI(
    title="TerraFoco API",
    description=(
        "Indicadores de focalización territorial de la inversión pública. "
        "Proyecto APT — Duoc UC."
    ),
    version="0.1.0",
)

# El visor se sirve desde otro puerto; sin esto el navegador bloquea las
# peticiones. Los orígenes se configuran con TERRAFOCO_ORIGENES (config.py).
# CORS no protege la escritura —curl lo ignora—: la protege la clave de
# administración (seguridad.py), que va en un encabezado y no en una cookie.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ORIGENES,
    # El catálogo de fuentes (UC-10) se administra desde el navegador, así que
    # las escrituras también tienen que pasar el control de origen.
    allow_methods=["GET", "POST", "PATCH"],
    # Solo los encabezados que se usan: el cuerpo JSON y la clave.
    allow_headers=["Authorization", "Content-Type"],
)

# Las capas del visor son GeoJSON: las manzanas de Rancagua pesan 2,4 MB y
# comprimidas, un quinto.
app.add_middleware(GZipMiddleware, minimum_size=2048)

app.include_router(salud.router)
app.include_router(regiones.router)
app.include_router(comunas.router)
app.include_router(localidades.router)
app.include_router(exposicion.router)
app.include_router(pertinencia.router)
app.include_router(inundacion.router)
app.include_router(urbano.router)
app.include_router(fuentes.router)
app.include_router(ejecuciones.router)


@app.get("/", tags=["general"])
def raiz():
    return {
        "nombre": "TerraFoco API",
        "version": "0.1.0",
        "documentacion": "/docs",
    }
