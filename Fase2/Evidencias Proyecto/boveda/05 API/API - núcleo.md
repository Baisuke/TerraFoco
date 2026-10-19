# API · núcleo

**Carpeta:** `api/`. API REST en **FastAPI**, contenedor `terrafoco-api`, puerto **8000**. Expone los indicadores que calcula el motor. **No procesa nada:** consulta PostGIS y devuelve JSON/GeoJSON. Documentación interactiva: `http://localhost:8000/docs`.

Rutas: [[API - rutas]] · Pruebas: [[API - pruebas]]

---

## Dockerfile
- `python:3.12-slim`, instala `requirements.txt`. **No necesita GDAL**: solo consulta la base. En desarrollo el compose monta `./api` y corre `uvicorn main:app --reload` (cambios en caliente); en producción, 2 procesos sin recarga y sin montar código. → [[Despliegue y Codespaces#docker-compose.yml (producción)]]

## requirements.txt
- fastapi, uvicorn, psycopg 3, pydantic 2, python-dotenv, httpx (cliente de pruebas), pytest.

## main.py
- **Qué hace:** crea la app (`FastAPI(title="TerraFoco API")`), agrega middlewares e incluye los routers.
- **CORS:** orígenes desde `TERRAFOCO_ORIGENES`; métodos `GET, POST, PATCH`; encabezados `Authorization` y `Content-Type`. El visor se sirve desde otro puerto (8081) y sin CORS el navegador bloquearía las peticiones. **CORS no protege la escritura** (curl lo ignora): la protege la clave.
- **GZip** desde 2 KB: las manzanas de Rancagua pesan 2,4 MB en GeoJSON y comprimidas un quinto.
- **Routers:** `salud`, `regiones`, `comunas`, `localidades`, `exposicion`, `pertinencia`, `inundacion`, `urbano`, `fuentes`, `ejecuciones`. `GET /` (`raiz`) describe la API.
- **Decisión clave:** el procesamiento pesado vive en el motor, separado, para que una ingesta no bloquee al visor. → [[Arquitectura]]

## config.py
- Todo por entorno: `BD_URL`, `ID_REGION_POR_DEFECTO` (6), `CLAVE_ADMIN` (`TERRAFOCO_CLAVE_ADMIN`), `ORIGENES` (`TERRAFOCO_ORIGENES`, por omisión `*`).

## bd.py
- `conexion()` (psycopg, filas como diccionarios), `transaccion()` (para la escritura del catálogo), `una_fila(sql, parámetros)`.

## seguridad.py
- **Qué hace:** autenticación de las operaciones de administración (RF-31, RNF-19). La API es de **lectura pública** por diseño (RF-29); lo único que escribe es el catálogo de fuentes.
- **Cómo:** una clave por encabezado `Authorization: Bearer <TERRAFOCO_CLAVE_ADMIN>`, dependencia `requiere_admin` en las rutas que escriben.
- **Tres decisiones:**
  1. **Cerrado por defecto:** sin clave configurada (o con una corta) la escritura responde **503**; un servidor mal configurado no queda expuesto.
  2. **Encabezado, no cookie:** el navegador no lo adjunta solo, así que una página ajena no puede usarlo (sin CSRF). Por eso CORS puede seguir abierto para lecturas.
  3. **Comparación en tiempo constante** (`secrets.compare_digest`): el tiempo de respuesta no revela cuántos caracteres acertó un atacante.
- **Respuestas:** 401 con desafío `WWW-Authenticate: Bearer` si falta o es incorrecta. La autenticación va **antes** que la validación del cuerpo.
- **Por qué no usuarios y contraseñas:** hay una sola persona que administra; un sistema de cuentas sería superficie de ataque sin nadie que lo necesite. Si aparecen roles, se cambia la dependencia, no la ruta.
- → [[Privacidad y datos personales]] · [[API - pruebas#test_seguridad.py]]

## focalizacion.py
- **Qué es:** las cuentas de la **brecha en UF** y de la **focalización por año**, **sin base de datos**, para probarlas con números escritos a mano y para que `herramientas/sembrar_indicadores.py` use exactamente las mismas al armar la copia local.
- **Funciones:** `mediana` (ignora nulos), `brecha_uf` (`max(0, mediana_uf_ha − uf_ha) × ha_erosión_severa`), `rangos`, `spearman`, `focalizacion` (por año: participación de las comunas sobre la mediana de erosión en el incentivo vs. su participación en la superficie severa, más ρ).
- **Por qué la mediana y no el máximo:** el máximo (San Vicente, 34 UF/ha) daría una brecha impagable; la mediana es "lo que recibe la comuna típica".
- → [[Índice de pertinencia#Brecha en UF y focalización]] · [[API - pruebas#test_focalizacion.py]]
