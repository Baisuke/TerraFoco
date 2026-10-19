# Motor · archivos de la raíz

**Carpeta:** `motor/`. Es el procesamiento geoespacial en Python. Corre **por lotes** dentro del contenedor `terrafoco-motor` (y el mismo código, en modo demonio, en `terrafoco-programador`). Cada módulo se ejecuta con `python -m <modulo>` y la mayoría acepta `--simular` (calcula y muestra, no escribe).

Subcarpetas: [[Motor - ingesta]] · [[Motor - indicadores]] · [[Motor - orquestación]] · [[Motor - pruebas]]

---

## Dockerfile
- **Ubicación:** `motor/Dockerfile`
- **Qué hace:** parte de la imagen oficial `ghcr.io/osgeo/gdal:ubuntu-small-3.9.2` (GDAL ya compilado), instala `python3-pip`, `postgresql-client`, crea un venv en `/opt/venv` con `requirements.txt`, deja `PYTHONPATH=/app` y queda vivo con `tail -f /dev/null`.
- **Por qué:** instalar GDAL por pip es la primera fuente de "en mi computador funciona"; la imagen de OSGeo garantiza la misma versión de GDAL/PROJ para los tres.
- **Usado por:** `docker-compose.yml` (servicios `motor` y `programador`). → [[Archivos de la raíz#docker-compose.yml]]

## requirements.txt
- **Ubicación:** `motor/requirements.txt`
- **Qué fija:** psycopg 3 (PostgreSQL), rasterio (rásteres), geopandas + shapely (vectorial), numpy, pandas, python-dotenv, earthaccess (NASA Earthdata), requests, openpyxl (planillas SIRSD-S), netCDF4 (CR2MET), pysheds (hidrología), scipy, pmtiles (teselas), pytest. GDAL **no** va aquí: viene de la imagen base.

## bd.py
- **Ubicación:** `motor/bd.py` · **Qué hace:** acceso a la base y bitácora.
- **Funciones:**
  - `conexion()` — gestor de contexto con una conexión psycopg a `BD_URL`.
  - `obtener_region(id)` — lee `territorio.region` y devuelve un `config.Region` (bbox, EPSG de trabajo, resolución). **Así ningún módulo escribe coordenadas.**
  - `Bitacora(proceso, fuente="codigo")` — gestor de contexto que abre una fila en `operacion.ejecucion_proceso` y la cierra con `ok`/`error` y `registros`. Si es `simulada`, borra su fila al cerrar.
- **Usado por:** todos los módulos de ingesta e indicadores. → [[Bitácora y catálogo de fuentes]]

## config.py
- **Ubicación:** `motor/config.py` · **Qué hace:** toda la configuración desde el entorno.
- **Regla de oro:** *ninguna coordenada, ningún código de región y ninguna credencial escritos en el código.* Las coordenadas salen de `territorio.region`; lo demás, del `.env`.
- **Contiene:** `BD_URL`, `ID_REGION` (6), `DIR_DATOS` (`/datos`), credenciales (Earthdata, CDSE/Copernicus, Sentinel Hub, USGS), constantes (`EPSG_ALMACENAMIENTO = 4326`, `NUBOSIDAD_MAXIMA = 10`), la clase `Region`, `GRUPOS` de credenciales y `falta()`, `exigir()`, `credenciales_faltantes()`.
- **Por qué importa:** agregar una región es insertar una fila, no tocar código.

## credenciales.py
- **Uso:** `python -m credenciales` (solo mira el `.env`) · `python -m credenciales --probar` (verifica contra cada servicio).
- **Qué hace:** distingue **configurada** de **válida**: la contraseña puede estar mal o el token vencido, y el error aparecía recién a mitad de una descarga larga. Prueba Earthdata y CDSE.

## estado.py
- **Uso:** `python -m estado` · **Qué hace:** resume en un segundo qué hay cargado y qué falta (comunas, erosión por origen, factores, programas, inundación, urbano, bitácora). Para el día a día y la demo.

## calcular.py
- **Uso:** `python -m calcular --revisar` · `--simular` · (con valores explícitos `--r 1200 --k 0.035`).
- **Qué hace:** la **pérdida de suelo propia** `A = R·K·LS·C·P`: junta los factores de `indicadores.factor` (`reunir`), calcula (`calcular`) y escribe una fila por comuna en `indicadores.erosion` con `origen='TerraFoco'`. Marca `en_dominio` según `R_MAXIMO_CONFIABLE`.
- **Nada se inventa:** si falta un factor, la comuna no se calcula. Excepción: **P = 1** = "sin prácticas registradas" (estado real). Los valores pasados por línea de comandos quedan guardados para auditar.
- **Depende de:** [[Motor - indicadores#rusle.py]], [[Motor - indicadores#almacen.py]]. → [[RUSLE y erosión]]

## validar.py
- **Uso:** `python -m validar` · `--umbral 1800`.
- **Qué hace:** compara el cálculo propio con CIREN por **Spearman sobre rangos** (no Pearson: no se pide que los números coincidan, sino que ordenen igual). Significancia por **permutaciones**, sin scipy. Imprime el **barrido de umbrales** de R para mostrar que el dominio de validez no depende de un número exacto.
- **Funciones:** `rangos`, `spearman`, `significancia`, `leer`, `barrido`. → [[Validación y Spearman]] · [[Dominio de validez]]

## mapa_erosion.py
- **Uso:** `python -m mapa_erosion --simular` · `--png`.
- **Qué hace:** erosión **por píxel a 30 m**: `A = R_comuna·K_comuna·P_comuna·LS_píxel·C_píxel`. LS sale del DEM (remuestreado a la rejilla del NDVI) y C del NDVI. Escribe `/datos/erosion/erosion_<comuna>.tif` y, con `--png`, PNG coloreados en geográficas + `indice.json`/`indice.js` (copiados a `prototipo/datos/erosion/`).
- **Funciones:** `ls_en_rejilla`, `c_desde_ndvi`, `colorear`, `escribir_png`, `procesar`. Define `RAMPA` (cortes y colores de las clases) que reutilizan `teselas.py` y `superficie_erosionada.py`.
- **Por qué:** el SIRSD-S bonifica predios; "Navidad: 25,9 t/ha" no dice dónde poner los recursos dentro de Navidad.

## mapa_inundacion.py
- **Uso:** `python -m mapa_inundacion --png`.
- **Qué hace:** recorta `susceptibilidad.tif` por comuna, colorea con la rampa `agua` del visor y escribe PNG + `indice.json`/`indice.js` en `/datos/inundacion/png` (se copian a `prototipo/datos/inundacion/` con `docker cp`). **No recalcula**: si el índice cambia, se corre `indicadores.inundacion` primero. Lo dispara la tarea `mapa.inundacion`.

> [!note] El motor escribe en `/datos`, el visor lee de `prototipo/datos`
> Todos los generadores (`mapa_*`, `teselas`, `variables_inundacion`, `worldcover`) escriben dentro del volumen del contenedor. Pasar el resultado al visor es un `docker cp terrafoco-motor:/datos/... prototipo/datos/...` explícito: así nada del motor pisa el visor sin que alguien lo decida.

## mapa_calor.py
- **Uso:** `python -m mapa_calor --png [--comunas 6101 6106]`.
- **Qué hace:** temperatura superficial por píxel (70 m) por comuna, mismo compuesto de verano que `ingesta.ecostress`, coloreado por clase (`CORTES`), a `/datos/calor/` (copia en `prototipo/datos/calor/`). Muestra la isla de calor que el promedio comunal esconde. → [[Áreas verdes y calor urbano]]

## teselas.py
- **Uso:** `python -m teselas` (todas las capas) o por capa.
- **Qué hace:** genera un **PMTiles por capa** (`relieve`, `erosion`, `ndvi`, `pendiente`, `inundacion`, `calor`) con el valor de cada píxel codificado en terrain-RGB; los cortes van en los metadatos. Une rásteres comunales en un VRT (`_mosaico`), reproyecta a Web Mercator, codifica (`codificar`/`decodificar`) y escribe.
- **Constantes:** `TAMANO = 512`, `CAPAS` (descripción, fuente, escala, zoom, redondeo, cortes, `cortes_inclusivos`).
- → [[Teselas y PMTiles]]

## variables_inundacion.py
- **Uso:** `python -m variables_inundacion` (~3 min).
- **Qué hace:** deja en el visor **lo mismo que usó el motor** para el índice:
  - `/datos/teselas/inundacion_variables.pmtiles` — z11, 512×1024 RGB, una variable normalizada por canal (0 = sin dato);
  - `/datos/inundacion/variables.json` (se copia a `prototipo/datos/inundacion/`) — por variable (nombre, unidad, sentido, peso, escala) y, por comuna, **sumas por patrón de datos disponibles** (bitmask) + una **muestra regional de 40 mil celdas** para los cortes por cuartiles.
- **Por qué el patrón:** el motor promedia sobre las celdas donde existen las variables **con peso**; guardando sumas por patrón, el navegador reproduce el índice comunal exacto para cualquier juego de pesos (±0,0001, mismo ρ).
- **Funciones:** `cuantizar`, `normalizada`, `original`, `medias_por_comuna`, `muestra_regional`, `indice_comunal`, `indice_de_muestra`, `tesela_de_variables`, `generar_teselas`.
- → [[Visor - mapas y módulos#inundacion-calculo.js]] · [[Motor - pruebas#test_variables_inundacion.py]]

## sondeo.py
- **Qué es:** script exploratorio de 27 líneas: qué productos de temperatura superficial se alcanzan con las credenciales de Earthdata, sin depender del USGS. Fue el que decidió usar **ECOSTRESS** en vez de Landsat. No lo usa nada en producción.

Ver también: [[Flujo de datos]]
