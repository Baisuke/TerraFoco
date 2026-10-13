# Mapa del repositorio

Todo lo versionado (≈300 archivos), carpeta por carpeta, con la nota donde se explica cada archivo. Lo que **no** está en git: el `.env` (credenciales), los rásteres de `/datos` (gigabytes, viven en el volumen Docker `datos_crudos`) y las teselas `.pmtiles` (se regeneran).

| Carpeta o archivo | Qué es | Nota |
|---|---|---|
| `README.md` | Portada: levantar, cargar datos, reglas | [[Archivos de la raíz#README.md]] |
| `docker-compose.yml` | Entorno de desarrollo (bd, motor, api, programador) | [[Archivos de la raíz#docker-compose.yml]] |
| `.env.ejemplo` | Plantilla de credenciales | [[Archivos de la raíz#.env.ejemplo]] |
| `.gitignore`, `.gitattributes` | Qué no se versiona; finales de línea LF | [[Archivos de la raíz]] |
| `.devcontainer/` | GitHub Codespaces | [[Despliegue y Codespaces#.devcontainer]] |
| **`bd/`** | **Base de datos** | |
| `bd/esquema.sql` | Esquema inicial (4 esquemas, tablas base) | [[Esquema de la base]] |
| `bd/migraciones/001…019` | Cambios ordenados del esquema | [[Migraciones]] |
| `bd/semillas/*.csv` | Serie SIRSD-S, complemento oficial, superficie erosionada | [[Semillas]] |
| `bd/respaldo/*.dump` | Respaldo de la base del 22-09 | [[Semillas#bd/respaldo]] |
| **`motor/`** | **Procesamiento (Python + GDAL)** | |
| `Dockerfile`, `requirements.txt`, `bd.py`, `config.py`, `credenciales.py`, `estado.py` | Imagen, dependencias, base, configuración | [[Motor - raíz]] |
| `calcular.py`, `validar.py` | Erosión propia y su validación contra CIREN | [[Motor - raíz]] |
| `mapa_erosion.py`, `mapa_inundacion.py`, `mapa_calor.py` | Mapas a 30/70 m por comuna (PNG) | [[Motor - raíz]] |
| `teselas.py`, `variables_inundacion.py`, `sondeo.py` | Teselas PMTiles, variables para el visor, sondeo de ECOSTRESS | [[Motor - raíz]] |
| `motor/ingesta/` (22 módulos) | Una fuente externa por módulo | [[Motor - ingesta]] |
| `motor/indicadores/` | RUSLE, terreno, inundación, validación, áreas verdes | [[Motor - indicadores]] |
| `motor/orquestacion/` | Programador de tareas | [[Motor - orquestación]] |
| `motor/tests/` (≈270 pruebas) | Pruebas del motor | [[Motor - pruebas]] |
| **`api/`** | **API REST (FastAPI)** | |
| `Dockerfile`, `requirements.txt`, `main.py`, `config.py`, `bd.py`, `seguridad.py`, `focalizacion.py` | Núcleo de la API | [[API - núcleo]] |
| `api/rutas/` (10 routers) | Endpoints | [[API - rutas]] |
| `api/tests/` (≈96 pruebas) | Pruebas de la API | [[API - pruebas]] |
| **`prototipo/`** | **Visor (lo que ve el usuario)** | |
| `*.html` (9 páginas) | Pantallas | [[Visor - páginas]] |
| `js/` api-base, tema, paleta, data, datos-api, shell, graficos, mapa | Scripts base | [[Visor - scripts base]] |
| `js/` mapa-real, detalle-comuna, inundacion(-calculo), zonas, modelo3d, predios | Mapas y módulos | [[Visor - mapas y módulos]] |
| `js/` simulacion-lluvia, simulacion-inundacion, simulacion-calor, simulacion-verde | Simulaciones de lluvia y de áreas verdes | [[Visor - mapas y módulos#simulacion-lluvia.js]] |
| `css/styles.css` | Hoja de estilos | [[Visor - estilos, datos y librerías#css/styles.css]] |
| `datos/` | Comunas, copia local, PNG por comuna, variables, teselas | [[Visor - estilos, datos y librerías#datos/ (datos estáticos del visor)]] |
| `vendor/` | MapLibre, PMTiles, three.js | [[Visor - estilos, datos y librerías#vendor/]] |
| `nginx.conf`, `README.md` | Configuración de referencia y README de la fase 1 | [[Visor - estilos, datos y librerías]] |
| **`herramientas/`** | **Scripts de apoyo** | [[Herramientas]] |
| **`despliegue/`** | **Servidor público** | [[Despliegue y Codespaces]] |
| **`docs/`** | **Documentación académica** | [[Documentos del proyecto]] |
| **`boveda/`** | **Esta guía (Obsidian)** | [[00 Inicio]] |

## Convenciones que se repiten en todo el código

| Convención | Dónde se ve | Por qué |
|---|---|---|
| Todo en español: nombres, comentarios, commits | En todo el repo | El equipo y el cliente (INDAP) hablan español |
| Cada módulo del motor empieza con un docstring largo que explica **por qué**, no solo qué | `motor/**/*.py` | Es documentación defendible; los números citan su fuente |
| Cada módulo del motor se corre con `python -m paquete.modulo` y acepta `--simular` | `motor/ingesta`, `motor/indicadores` | `--simular` calcula y muestra sin escribir: se puede probar sin tocar la base |
| Cada script JS del visor es un IIFE que expone un objeto global `GT…` | `prototipo/js/*.js` | Funciona sin bundler y abierto con doble clic (`file://`) |
| Datos estáticos como `.js` además de `.json` | `prototipo/datos/*/indice.js`, `comunas.js` | `file://` no permite `fetch()` de archivos locales; un `<script>` sí carga |
| Migraciones numeradas e idempotentes | `bd/migraciones/0NN_*.sql` | Se pueden volver a correr sin romper nada |
| Pruebas al lado del código: `x.py` ↔ `tests/test_x.py` | motor y api | `dividir_entrega.py` las mantiene juntas al repartir |

## Contenedores y puertos

| Contenedor | Puerto | Servicio |
|---|---|---|
| `terrafoco-bd` | 5432 | PostgreSQL + PostGIS |
| `terrafoco-api` | 8000 | FastAPI (`/docs` = documentación interactiva) |
| `terrafoco-motor` | — | Queda encendido con `tail -f /dev/null`; se usa con `docker exec` |
| `terrafoco-programador` | — | `python -m orquestacion.orquestador --demonio` |
| (visor) | 8081 | `python herramientas/servir_prototipo.py prototipo 8081` |

Ver también: [[Cómo correrlo]] · [[Arquitectura]]
