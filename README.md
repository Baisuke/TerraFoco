# TerraFoco — motor de análisis

Sistema que compara el **estado real de degradación del suelo** con la
**distribución territorial de la inversión pública** en recuperación de suelos,
para identificar comunas donde la necesidad es alta y la intervención baja.

Región piloto: **Libertador General Bernardo O'Higgins**, 33 comunas.

> Este es el repositorio de **desarrollo**. La entrega académica vive en
> `TERRAFOCO-APT122`, con la estructura de carpetas que exige la Escuela.
> Se sincroniza con `python herramientas/sincronizar.py` — nunca al revés.

---

## Levantar el entorno

Requisito único: **Docker Desktop** instalado y abierto.

```bash
docker compose up -d
docker compose ps
```

Cuatro servicios:

| Servicio | Qué hace |
|---|---|
| `bd` | PostgreSQL 16 + PostGIS 3.4, puerto 5432 |
| `api` | FastAPI, puerto 8000 |
| `motor` | Procesos por lote; no corre como servicio |
| `programador` | Revisa cada hora qué tarea venció |

`esquema.sql` se carga solo la primera vez que arranca `bd`. Las migraciones
**no**: Postgres solo ejecuta lo que está en la raíz de su carpeta de arranque y
`bd/migraciones/` es un subdirectorio. Un solo comando las aplica en orden y
carga las 33 comunas desde la copia estática del prototipo:

```bash
bash herramientas/inicializar.sh
```

Es idempotente. Sin las migraciones faltan la tabla `indicadores.factor` y la
columna `en_dominio`, y la API responde error al consultar la pertinencia.

Para presentar el sistema desde cualquier navegador, sin computador propio,
está [docs/12-demo-en-codespaces.md](docs/12-demo-en-codespaces.md).

Ver el estado de lo cargado, de un vistazo:

```bash
docker exec -i terrafoco-programador python -m estado
```

---

## Estructura

```
motor/          Procesamiento: ingesta, indicadores, orquestación
  ingesta/      Un módulo por fuente de datos
  indicadores/  RUSLE, terreno, inundación, áreas verdes y el almacén de factores
  orquestacion/ El programador de tareas
  tests/        ~270 pruebas, casi todas sin base de datos ni red
api/            FastAPI: expone los indicadores al visor (~96 pruebas)
prototipo/      Front-end, funciona sin servidor
bd/             esquema.sql, migraciones numeradas y semillas
herramientas/   Inicializar, servir el visor, copia local, portable, entrega
despliegue/     Servidor público (compose de producción, Caddy)
docs/           Documentación del proyecto
boveda/         Guía de estudio en Obsidian: qué hace cada archivo y por qué
```

Para estudiar el proyecto, abrir `boveda/` como bóveda en Obsidian y empezar
por `00 Inicio`.

---

## Credenciales

Copiar `.env.ejemplo` como `.env` y completar. Después de editarlo hay que
**recrear el contenedor**: Docker inyecta las variables al crearlo, no las
relee.

```bash
docker compose up -d programador
docker exec -i terrafoco-programador python -m credenciales --probar
```

Con `--probar` se pide un token real a cada servicio. La diferencia importa:
una contraseña mal copiada se ve idéntica a una correcta hasta que falla a
mitad de una descarga de media hora.

Ninguna credencial bloquea las capas vectoriales —comunas, CIREN, SIRSD-S—,
que se cargan sin cuenta.

### Clave de administración de la API

La API es de lectura pública. Lo único que escribe es el catálogo de fuentes
(alta y cambio de estado), y eso pide `Authorization: Bearer <clave>`
(`api/seguridad.py`). Sin clave configurada la API arranca igual, pero **no
escribe**: responde 503 en vez de quedar abierta.

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"   # pegarla en .env como TERRAFOCO_CLAVE_ADMIN
docker compose up -d api
```

Para usarla:

- En **Fuentes de datos**, al cambiar un estado se pide la clave. Queda
  guardada en la pestaña y se olvida al cerrarla.
- En **http://localhost:8000/docs**, con el botón *Authorize*.
- `herramientas/demostracion.py` la toma del `.env` sin mostrarla.

---

## Cargar datos

Todos los cargadores aceptan `--simular`: procesan, muestran el resumen y **no
escriben nada**. Conviene usarlo siempre la primera vez.

```bash
# Erosión de CIREN — se descarga sola por WFS, sin credenciales.
# Cerca de una hora: 50 cuencas y ~2 millones de polígonos.
docker exec -i terrafoco-programador python -m ingesta.ciren --mascara /datos/mascara_ciren.tif

# Ejecución del SIRSD-S desde el servicio ArcGIS de IDE MINAGRI
docker exec -i terrafoco-programador python -m ingesta.sirsd_ide --simular

# Modelo de elevación (necesita NASA Earthdata)
docker exec -i terrafoco-programador python -m ingesta.srtm --region 6
docker exec -i terrafoco-programador python -m ingesta.srtm --solo-preparar

# Los cinco factores de RUSLE
docker exec -i terrafoco-programador python -m ingesta.cr2met --guardar        # R
docker exec -i terrafoco-programador python -m ingesta.soilgrids --guardar     # K
docker exec -i terrafoco-programador python -m ingesta.zonal --raster /datos/srtm/dem_utm.tif --factor ls --mascara /datos/mascara_ciren.tif --guardar
docker exec -i terrafoco-programador python -m ingesta.sentinel --mascara /datos/mascara_ciren.tif --guardar
docker exec -i terrafoco-programador python -m ingesta.practicas --guardar     # P

# Calcular la pérdida propia
docker exec -i terrafoco-programador python -m calcular

# Mapa de erosión por píxel, para el detalle intracomunal
docker exec -i terrafoco-programador python -m mapa_erosion --png

# Inversión del índice (migración 013): la serie del SIRSD-S 2012-2025, ya
# agregada por comuna y año en bd/semillas, y la superficie con erosión
# severa que la divide. En terrafoco-motor, que es el que monta /bd.
docker exec -i terrafoco-motor python -m ingesta.sirsd_serie
docker exec -i terrafoco-motor python -m indicadores.superficie_erosionada
python herramientas/sembrar_indicadores.py      # copia local para abrir sin API

# Módulo 3 — déficit de áreas verdes (docs/18-areas-verdes.md): población
# urbana del Censo 2024 y plazas y parques de OpenStreetMap, sin credenciales.
docker exec -i terrafoco-motor python -m ingesta.censo
docker exec -i terrafoco-motor python -m ingesta.areas_verdes
docker exec -i terrafoco-motor python -m indicadores.area_verde

# Módulo 2 — variables del índice de inundación, desde el DEM ya preparado
docker exec -i terrafoco-programador python -m ingesta.zonal --raster /datos/srtm/dem_utm.tif --factor pendiente --guardar
docker exec -i terrafoco-programador python -m ingesta.zonal --raster /datos/srtm/dem_utm.tif --factor curvatura --guardar
docker exec -i terrafoco-programador python -m ingesta.hidrologia            # acumulación de flujo y TWI, ~2 min
docker exec -i terrafoco-programador python -m ingesta.zonal --raster /datos/inundacion/acumulacion.tif --factor acumulacion --guardar
docker exec -i terrafoco-programador python -m ingesta.zonal --raster /datos/inundacion/twi.tif --factor twi --guardar
docker exec -i terrafoco-programador python -m ingesta.cauces                # red hídrica de IDE Chile por WFS, sin credenciales
docker exec -i terrafoco-programador python -m ingesta.zonal --raster /datos/inundacion/distancia_cauces.tif --factor distancia_cauces --guardar
docker exec -i terrafoco-programador python -m ingesta.sentinel --raster-dir /datos/inundacion/ndvi   # NDVI por píxel (Sentinel Hub)

# Índice de susceptibilidad: combina las seis por píxel y agrega por comuna
docker exec -i terrafoco-programador python -m indicadores.inundacion --simular
docker exec -i terrafoco-programador python -m indicadores.inundacion

# Validación contra eventos históricos (DesInventar) y PNG para el visor
docker exec -i terrafoco-programador python -m ingesta.desinventar
docker exec -i terrafoco-programador python -m indicadores.recalibrar_inundacion   # banco de pruebas de pesos
docker exec -i terrafoco-programador python -m indicadores.validar_inundacion --marcar-si-pasa
docker exec -i terrafoco-programador python -m mapa_inundacion --png
docker cp terrafoco-motor:/datos/inundacion/png/. prototipo/datos/inundacion/

# Inundaciones dentro de la comuna (migraciones 015 y 016): ciudades y pueblos,
# personas por manzana y servicios críticos. Sin credenciales.
docker exec -i terrafoco-motor python -m ingesta.localidades     # Límite Urbano Censal 2017 (INE/OCUC)
docker exec -i terrafoco-motor python -m ingesta.manzanas        # Censo 2017 por manzana (INE/OCUC)
docker exec -i terrafoco-motor python -m ingesta.equipamiento    # escuelas, salud, bomberos, policía (OSM)
# Lo que más le importa a INDAP (migración 019): superficie agrícola y población
# rural. WorldCover se lee directo del almacenamiento público de la ESA (~1 min).
docker exec -i terrafoco-motor python -m ingesta.worldcover        # ha de cultivo y pradera por celda de 30 m
docker exec -i terrafoco-motor python -m ingesta.poblacion_censal  # Censo 2024 urbano y rural (manzanas, aldeas, entidades)
docker cp terrafoco-motor:/datos/teselas/agricola.pmtiles prototipo/datos/teselas/
# Las seis variables del índice por celda: desglose de una celda y explorador
# de pesos. ~3 min; las teselas (~63 MB) no se versionan, el JSON sí.
docker exec -i terrafoco-motor python -m variables_inundacion
docker cp terrafoco-motor:/datos/teselas/inundacion_variables.pmtiles prototipo/datos/teselas/
docker cp terrafoco-motor:/datos/inundacion/variables.json prototipo/datos/inundacion/

# Módulo 3 — temperatura superficial (necesita NASA Earthdata; ~5 min, 340 MB)
docker exec -i terrafoco-programador python -m ingesta.ecostress --descargar --guardar
# PNG por comuna para el detalle a 70 m de Ciudades (usa las escenas ya descargadas)
docker exec -i terrafoco-programador python -m mapa_calor --png
docker cp terrafoco-programador:/datos/calor/png/. prototipo/datos/calor/

# Teselas de valores para el visor: detalle continuo en toda la región, valor
# exacto bajo el cursor, relieve sombreado y vista 3D. Van al final porque
# leen lo que dejan los pasos anteriores. ~5 min, ~60 MB; no se versionan
# (.gitignore). Sin ellas el visor usa los PNG por comuna.
docker exec -i terrafoco-programador python -m teselas --todas
docker cp terrafoco-programador:/datos/teselas/. prototipo/datos/teselas/
```

---

## Pruebas

```bash
docker exec -i terrafoco-programador python -m pytest tests -q
docker compose exec -T api python -m pytest tests -q
```

---

## Reglas del proyecto

**Ninguna coordenada ni código de región en el código.** El área de interés sale
de `territorio.region`; agregar una región es insertar una fila.

**Nada se rellena por cuenta propia.** Si a una comuna le falta un factor, no se
calcula. Un promedio regional produciría un número que parece medido y no lo es.

**La tabla de factores nunca sobrescribe.** Cada recálculo inserta una versión
nueva y la más reciente gana. Eso ya permitió recuperar valores buenos después
de una carga contaminada.

**Los rásteres deben estar proyectados en metros.** `zonal` rechaza los que
llegan en grados: calcular una pendiente con celdas medidas en grados da un
resultado equivocado por un factor de ~100.000 sin lanzar ningún error.

---

Proyecto APT122 · Capstone · Escuela de Ingeniería Informática, Duoc UC
Bastián Cárcamo · Carla Morales · Antonio Lankin
Docente guía: Rocío Contreras Aguila
