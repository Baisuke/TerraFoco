# -*- coding: utf-8 -*-
"""
Autenticación de las operaciones de administración — RF-31, RNF-19.

La API es de lectura pública por diseño (RF-29): los indicadores son para
quien quiera consultarlos. Lo único que escribe es el catálogo de fuentes
(UC-10), y eso lo decide una persona con permiso. Hasta ahora cualquiera que
alcanzara el puerto 8000 podía cambiarle el estado a CIREN.

Una sola clave de administración, por encabezado:

    Authorization: Bearer <TERRAFOCO_CLAVE_ADMIN>

Por qué así y no con usuarios y contraseñas: hay una sola persona que
administra el catálogo, y un sistema de cuentas sería superficie de ataque
sin nadie que la necesite. Cuando haya más de un rol, esto se reemplaza por
tokens con identidad; la ruta no cambia, solo la dependencia.

Tres decisiones que importan:

- **Cerrado por defecto.** Sin clave configurada, o con una corta, la
  escritura responde 503 en vez de quedar abierta. Un servidor mal
  configurado queda sin poder escribir, pero no queda expuesto.
- **Encabezado, no cookie.** El navegador no la adjunta solo, así que una
  página ajena no puede usarla aunque el usuario tenga la sesión abierta
  (no hay CSRF que defender). Por lo mismo, CORS puede seguir abierto para
  las lecturas: no es CORS lo que protege la escritura, es la clave.
- **Comparación en tiempo constante** (secrets.compare_digest), para que el
  tiempo de respuesta no revele cuántos caracteres acertó un intento.
"""
import logging
import secrets

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import config

log = logging.getLogger("terrafoco.seguridad")

# 24 caracteres de secrets.token_urlsafe son ~144 bits: fuera del alcance de
# cualquier intento por fuerza bruta contra una API HTTP. Una clave más corta
# suele ser una escrita a mano ("admin123"), y esa sí se adivina.
LARGO_MINIMO = 24

# auto_error=False: sin encabezado FastAPI respondería 403, y lo correcto es
# 401 con WWW-Authenticate. Además registra el esquema en /docs, que muestra
# el botón "Authorize" para probar las escrituras desde ahí.
_esquema = HTTPBearer(auto_error=False,
                      description="Clave de administración (TERRAFOCO_CLAVE_ADMIN)")


def _no_autorizado(detalle):
    return HTTPException(status_code=401, detail=detalle,
                         headers={"WWW-Authenticate": "Bearer"})


def requiere_admin(request: Request,
                   credenciales: HTTPAuthorizationCredentials | None = Depends(_esquema)):
    """Dependencia de las rutas que escriben. No devuelve nada: deja pasar o corta."""
    # Se lee en cada petición y no al importar, para que las pruebas puedan
    # fijarla sin reiniciar la aplicación.
    clave = config.CLAVE_ADMIN or ""
    if len(clave) < LARGO_MINIMO:
        raise HTTPException(
            status_code=503,
            detail="La escritura está deshabilitada en este servidor: falta "
                   "configurar TERRAFOCO_CLAVE_ADMIN (mínimo %d caracteres)."
                   % LARGO_MINIMO)
    if credenciales is None:
        raise _no_autorizado("Esta operación requiere la clave de administración.")
    if not secrets.compare_digest(credenciales.credentials.encode("utf-8"),
                                  clave.encode("utf-8")):
        # Se registra el intento, nunca la clave recibida.
        log.warning("clave de administración incorrecta desde %s en %s %s",
                    request.client.host if request.client else "?",
                    request.method, request.url.path)
        raise _no_autorizado("Clave de administración incorrecta.")
