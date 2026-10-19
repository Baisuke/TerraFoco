# -*- coding: utf-8 -*-
"""Comprobación de estado. Es el primer endpoint que debe funcionar."""
from fastapi import APIRouter

import bd

router = APIRouter(tags=["general"])


@router.get("/salud")
def salud():
    """Verifica que la API responde y que PostGIS está accesible."""
    estado = {"api": "ok", "base_de_datos": "sin verificar", "postgis": None}
    try:
        fila = bd.una_fila("SELECT PostGIS_Lib_Version(), current_database()")
        estado["base_de_datos"] = "ok"
        estado["postgis"] = fila[0]
        estado["nombre_base"] = fila[1]
    except Exception as e:
        estado["base_de_datos"] = "error"
        estado["detalle"] = str(e)
    return estado
