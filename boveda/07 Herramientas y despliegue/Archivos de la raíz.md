# Archivos de la raíz

Los archivos sueltos en la raíz del repositorio `terrafoco-dev/`.

---

## README.md
- La portada del repositorio: qué es el motor, **cómo levantar el entorno** (`docker compose up -d` + `inicializar.sh`), estructura, credenciales y clave de administración, **orden completo de carga de datos** (todos los `python -m …` comentados), pruebas y **reglas del proyecto** (ninguna coordenada en el código, nada se rellena, la tabla de factores no se sobrescribe, rásteres en metros).
- Docente guía: Rocío Contreras Aguila. Proyecto APT122, Capstone, Duoc UC. → [[Cómo correrlo]]

## docker-compose.yml
- El entorno de **desarrollo**: cuatro servicios.

| Servicio | Contenedor | Imagen | Puertos | Detalle |
|---|---|---|---|---|
| `bd` | `terrafoco-bd` | `postgis/postgis:16-3.4` | 5432 | Volumen `bd_datos`; monta `./bd` en `/docker-entrypoint-initdb.d` (el esquema se carga la primera vez); `healthcheck` con `pg_isready` |
| `motor` | `terrafoco-motor` | build `./motor` | — | Monta `./motor` (código en vivo), `./bd` de solo lectura (para una prueba) y el volumen `datos_crudos` en `/datos`; credenciales satelitales del `.env`; queda vivo con `tail -f /dev/null` |
| `api` | `terrafoco-api` | build `./api` | 8000 | Monta `./api`; `uvicorn --reload`; `TERRAFOCO_CLAVE_ADMIN` y `TERRAFOCO_ORIGENES` del `.env` |
| `programador` | `terrafoco-programador` | build `./motor` | — | `python -m orquestacion.orquestador --demonio --intervalo 3600` |

- Los nombres de las variables deben coincidir **exactamente** con los que lee `motor/config.py` (una vez decían `COPERNICUS_*` y el código buscaba `CDSE_*`: llegaban vacías).
- **Nunca** usar "Reset to factory defaults" de Docker Desktop: borra los volúmenes con los datos. → [[Arquitectura]]

## .env.ejemplo
- Plantilla del `.env` (que **nunca** se versiona). Variables, sin valores:
  - `BD_PASSWORD` — contraseña de la base.
  - `TERRAFOCO_CLAVE_ADMIN` — clave de escritura de la API (≥ 24 caracteres; **generarla**: `python -c "import secrets; print(secrets.token_urlsafe(32))"`).
  - `TERRAFOCO_ORIGENES` (opcional) — orígenes CORS; `*` en desarrollo.
  - `ID_REGION` — 6 = O'Higgins.
  - `EARTHDATA_USER` / `EARTHDATA_PASS` / `EARTHDATA_TOKEN` — NASA Earthdata (NASADEM, ECOSTRESS).
  - `CDSE_USER` / `CDSE_PASS` (+ claves S3) — Copernicus Data Space (token OAuth2 de ~10 min; con verificación en dos pasos, las descargas automáticas dejan de funcionar).
  - `USGS_USER` / `USGS_TOKEN` — USGS (Landsat; no se usa por falta de aprobación).
  - `SH_CLIENT_ID` / `SH_CLIENT_SECRET` — Sentinel Hub (Process API del NDVI).
- Advertencia del propio archivo: una credencial subida por error queda en el historial; hay que **cambiarla en el servicio**, no basta un commit que la borre. → [[Privacidad y datos personales]]

## .gitignore
- Fuera del repo: `.env` y `despliegue/.env`, llaves (`*.pem`, `*.key`, `credenciales*.json`), cachés de Python y entornos virtuales, **rásteres y paquetes pesados** (`*.tif`, `*.hgt`, `*.nc`, `*.hdf`, `*.zip`, `datos/crudos/`, `datos/intermedios/`), **`prototipo/datos/teselas/*.pmtiles`**, `dist/` y `build/` (la copia portable), basura de editores y sistemas, y `boveda/.obsidian/` (la configuración de Obsidian, que la aplicación reescribe cada vez que alguien abre la bóveda).

## .gitattributes
- Fuerza **LF** en `*.sh`, `Caddyfile` y `despliegue/*.yml`: corren en Linux, y con CRLF bash falla en la primera línea (`\r: command not found`) y Caddy no lee su archivo. El error aparecería solo en la otra máquina.

Ver también: [[Mapa del repositorio]] · [[Despliegue y Codespaces]]
