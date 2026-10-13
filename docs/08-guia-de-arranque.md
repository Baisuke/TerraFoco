# Guía de arranque — Credenciales, datos y primeros pasos

Cómo conseguir los accesos, bajar los datos y montar la base. Está ordenado por
dependencia: **cada paso habilita el siguiente**, y ninguno requiere el que viene
después.

> **La regla que evita perder dos semanas:** empezar por lo vectorial, no por lo
> raster. Un shapefile de límites comunales pesa unos pocos MB, no necesita
> credenciales y valida el circuito completo: base de datos, API y visor. Recién
> cuando eso funciona tiene sentido pelear con imágenes satelitales.

---

## 1. Panorama de accesos

| Fuente | ¿Requiere cuenta? | Cómo se accede | ¿Cuándo se necesita? |
|---|---|---|---|
| **IDE Chile** — límites comunales | No | Descarga directa / WFS | **Paso 1** |
| **CIREN** — inventario de erosión | No | Descarga de shapefile | Paso 2 |
| **IDE MINAGRI** — capas agrológicas | No | Descarga directa | Paso 2 |
| **NASA Earthdata** — SRTM | **Sí, gratuita** | Earthdata Login + biblioteca `earthaccess` | Paso 4 |
| **Copernicus Data Space** — Sentinel-2 | **Sí, gratuita** | Registro + token OAuth2 | Paso 5 |
| **USGS EarthExplorer** — Landsat | **Sí, gratuita** | Registro; la API M2M se solicita aparte | Módulo 3, más adelante |
| **INDAP** — SIRSD-S | No, pero sí gestión | Entrega directa del departamento de datos | Paso 6 |
| **Transparencia Activa** | No | Descarga de planillas mensuales | Respaldo del paso 6 |

**Nada de esto tiene costo.** Lo único que cuesta es tiempo de registro y, en el caso
de INDAP, gestión.

---

## 2. Crear las cuentas — hacerlo hoy, toma 30 minutos

Conviene tener las credenciales listas antes de necesitarlas. Los registros son
inmediatos, pero la activación a veces demora.

### 2.1 NASA Earthdata Login

1. Registrarse en [urs.earthdata.nasa.gov](https://urs.earthdata.nasa.gov)
2. Confirmar el correo
3. Guardar usuario y contraseña en el archivo `.env` (ver sección 7)

**Biblioteca recomendada:** [`earthaccess`](https://earthaccess.readthedocs.io/), la
biblioteca oficial de la comunidad NASA. Resuelve la autenticación, la búsqueda en el
CMR y la descarga en una sola interfaz.

```python
import earthaccess

earthaccess.login()          # lee las credenciales del .netrc o del entorno

resultados = earthaccess.search_data(
    short_name="NASADEM_HGT",                       # SRTM reprocesado
    bounding_box=(-72.10, -35.05, -70.02, -33.85),  # Región de O'Higgins
)
archivos = earthaccess.download(resultados, "/datos/srtm")
```

> **Por qué NASADEM y no SRTM a secas:** NASADEM es el reprocesamiento oficial del
> SRTM, con los vacíos rellenados y mejor georreferenciación. Es el mismo dato,
> corregido. Si la comisión pregunta, esa es la respuesta.

### 2.2 Copernicus Data Space Ecosystem

El antiguo *Copernicus Open Access Hub* fue retirado. El acceso actual es por
[dataspace.copernicus.eu](https://dataspace.copernicus.eu).

1. Registrarse — cuenta gratuita
2. Guardar usuario y contraseña en el `.env`
3. Para la API se necesita un **token de acceso OAuth2**, que se pide así:

```bash
curl -s -X POST \
  'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token' \
  -d 'client_id=cdse-public' \
  -d "username=$CDSE_USER" \
  -d "password=$CDSE_PASS" \
  -d 'grant_type=password'
```

El token dura poco: hay que renovarlo en cada sesión de descarga, no guardarlo.

**APIs disponibles:** OData y OpenSearch para catálogo y descarga, STAC, openEO y
Sentinel Hub para procesamiento. Para descargas masivas la vía recomendada es el
**acceso S3** con AWS CLI. La documentación está en
[documentation.dataspace.copernicus.eu](https://documentation.dataspace.copernicus.eu/APIs.html).

> **Recomendación:** para el Sprint 0 basta con OData y descargar una o dos escenas a
> mano. El acceso S3 se justifica recién cuando haya que bajar series completas.

### 2.3 USGS EarthExplorer

Solo se necesita para el módulo urbano (Landsat, banda térmica), que es del Sprint 4.
Conviene registrarse igual ahora en
[earthexplorer.usgs.gov](https://earthexplorer.usgs.gov), porque **el acceso a la API
M2M se solicita aparte y puede demorar días en aprobarse**.

---

## 3. Paso 1 — Límites comunales (la victoria rápida)

**Objetivo:** tener las 33 comunas de O'Higgins dentro de PostGIS, con geometría
válida.

1. Descargar la capa de división político-administrativa desde IDE Chile
   (`geoportal.cl`), en shapefile.
2. Levantar el entorno:

```bash
docker compose up -d
```

3. Cargar el esquema:

```bash
docker compose exec bd psql -U terrafoco -d terrafoco -f /docker-entrypoint-initdb.d/esquema.sql
```

4. Importar el shapefile a una tabla temporal:

```bash
ogr2ogr -f PostgreSQL PG:"host=localhost port=5432 user=terrafoco dbname=terrafoco" \
  comunas.shp -nln territorio.comuna_cruda -t_srs EPSG:4326 \
  -nlt MULTIPOLYGON -lco GEOMETRY_NAME=geom -overwrite
```

5. Filtrar la región y pasar a la tabla definitiva con un `INSERT ... SELECT`,
   quedándose solo con las comunas de la Región de O'Higgins.

### Verificación

```sql
-- ¿Están las 33 y en el sistema de referencia correcto?
SELECT count(*) AS comunas, ST_SRID(geom) AS srid
FROM   territorio.comuna
GROUP  BY ST_SRID(geom);

-- ¿Hay geometrías inválidas? Debe devolver 0 filas.
SELECT nombre, ST_IsValidReason(geom)
FROM   territorio.comuna
WHERE  NOT ST_IsValid(geom);

-- ¿Caen donde corresponde? La longitud debe estar entre -72 y -70.
SELECT nombre, round(ST_X(ST_Centroid(geom))::numeric, 2) AS lon
FROM   territorio.comuna ORDER BY lon LIMIT 5;
```

> Si las comunas aparecen en medio del océano o cerca de África, el problema es el
> sistema de referencia de origen. **Verificar el EPSG del shapefile antes de
> reproyectar**, no después: `ogrinfo -al -so comunas.shp | grep -i srs`.

---

## 4. Paso 2 — El circuito completo

Con las comunas cargadas ya se puede cerrar el circuito, **sin ningún raster**:

1. Endpoint `GET /comunas` en FastAPI que devuelva GeoJSON desde PostGIS
2. Página de prueba con MapLibre que dibuje esa respuesta

Cuando el polígono de Litueche aparezca en el navegador viniendo de la base de datos,
la arquitectura está validada. **Ese es el hito del Sprint 0.**

Consulta base para el endpoint:

```sql
SELECT json_build_object(
  'type', 'FeatureCollection',
  'features', json_agg(ST_AsGeoJSON(c.*)::json)
)
FROM (SELECT id_comuna, nombre, provincia, geom
      FROM territorio.comuna WHERE id_region = 6) c;
```

---

## 5. Paso 3 — Capas de CIREN y MINAGRI

Sin credenciales, descarga directa:

- **Inventario Nacional de Erosión** — `inventarioerosion.ciren.cl`, en shapefile
- **Capas agrológicas y de clima** — `ide.minagri.gob.cl/geoweb/index.php/descargas`

Se cargan igual que las comunas, con `ogr2ogr`. La capa de erosión de CIREN es la
**línea base contra la cual se valida todo el módulo 1**, así que conviene cargarla
temprano aunque todavía no se use.

> **Ojo con el alcance:** el inventario de CIREN cubre de Coquimbo a Los Lagos. Para
> la región piloto está bien, pero es el límite de escalabilidad del módulo.

---

## 6. Paso 4 — El primer raster

Recién ahora, con el circuito funcionando, entra el SRTM.

```bash
raster2pgsql -s 4326 -I -C -M -t 256x256 \
  -F srtm_ohiggins.tif operacion.cobertura_raster_cruda \
  | docker compose exec -T bd psql -U terrafoco -d terrafoco
```

Las banderas que importan:

| Bandera | Para qué |
|---|---|
| `-t 256x256` | Trocea en teselas. **Sin esto, una región completa entra como una sola fila gigante y las consultas se vuelven inservibles** |
| `-I` | Crea el índice espacial |
| `-C` | Aplica las restricciones estándar de raster |
| `-M` | Ejecuta `VACUUM ANALYZE` al terminar |

### Verificación

```sql
SELECT count(*) AS teselas,
       ST_SRID(rast) AS srid,
       round(ST_ScaleX(rast)::numeric, 6) AS tamano_pixel
FROM   operacion.cobertura_raster_cruda
GROUP  BY ST_SRID(rast), ST_ScaleX(rast);

-- Altura en un punto conocido: Rancagua ronda los 500 m
SELECT ST_Value(rast, ST_SetSRID(ST_Point(-70.74, -34.17), 4326))
FROM   operacion.cobertura_raster_cruda
WHERE  ST_Intersects(rast, ST_SetSRID(ST_Point(-70.74, -34.17), 4326));
```

> Si el valor devuelto es absurdo (negativo, o decenas de miles), lo más probable es
> que el raster esté en otro sistema de referencia o que la banda no sea la de
> elevación.

---

## 7. Paso 5 — Sentinel-2 y el factor de cobertura

Es el más pesado. Recomendaciones para no ahogarse:

- **Filtrar por nubosidad** en la búsqueda: menos de 10%. Una escena nublada no sirve
  y pesa lo mismo.
- **Usar el producto L2A** (corregido atmosféricamente), no L1C. Ahorra un paso de
  procesamiento completo.
- **Bajar solo las bandas necesarias:** para NDVI son B04 (rojo) y B08 (infrarrojo
  cercano). Una escena completa trae 13 bandas.
- **Elegir la ventana temporal correcta:** para el factor C interesa el período de
  mayor cobertura vegetal, no cualquier fecha del año.

NDVI, una vez que se tienen las bandas:

```
NDVI = (B08 - B04) / (B08 + B04)
```

---

## 8. Paso 6 — Datos del SIRSD-S

Dos vías, en paralelo:

1. **Entrega directa** del departamento de datos de INDAP — la vía comprometida.
2. **Transparencia Activa** — descargar las planillas mensuales de
   `transparencia.indap.cl` mientras tanto, para ir construyendo y probando el ETL con
   datos reales aunque estén incompletos.

**No esperar la entrega para escribir el ETL.** Con las planillas públicas ya se puede
desarrollar toda la consolidación; cuando lleguen los datos completos, solo cambia la
fuente de entrada.

---

## 9. Credenciales: el archivo `.env`

**Nunca se versiona.** Ya está en el `.gitignore`.

```bash
# .env — NO subir a GitHub
BD_PASSWORD=una_clave_local

EARTHDATA_USER=usuario_nasa
EARTHDATA_PASS=clave_nasa

CDSE_USER=usuario_copernicus
CDSE_PASS=clave_copernicus
```

Conviene mantener un `.env.ejemplo` **sin valores reales**, ese sí versionado, para
que cualquiera del equipo sepa qué variables necesita.

> Si alguna credencial se sube por accidente a un repositorio público, no basta con
> borrarla en un commit posterior: **queda en el historial**. Hay que cambiar la
> contraseña en el servicio.

---

## 10. Calendario sugerido del Sprint 0

| Semana | Foco | Resultado esperado |
|---|---|---|
| **1** | Cuentas y entorno | Las tres máquinas levantan `docker compose`. Cuentas de Earthdata y Copernicus creadas |
| **2** | Base de datos y vectorial | Esquema cargado, 33 comunas dentro con geometría válida, capas de CIREN cargadas |
| **3** | Circuito completo y primer raster | `GET /comunas` respondiendo, mapa dibujando, una tesela SRTM consultable |

**Reparto sugerido:**

| Integrante | Se enfoca en |
|---|---|
| Bastián Cárcamo | Base de datos, carga de capas, cuentas de acceso |
| Carla Morales | Entorno Docker, API, y **gestión de los datos con INDAP** |
| Antonio Lankin | Página de prueba con MapLibre, plan de pruebas, GitHub Actions |

---

## 11. Errores frecuentes y cómo reconocerlos

| Síntoma | Causa probable | Solución |
|---|---|---|
| Las comunas aparecen en el océano | EPSG de origen mal supuesto | `ogrinfo -al -so` para ver el real, y reproyectar desde ese |
| `ST_IsValid` devuelve falso | Polígonos con auto-intersección | `ST_MakeValid(geom)` al cargar |
| La consulta raster tarda minutos | Raster cargado sin trocear | Recargar con `-t 256x256` |
| Error 401 en Copernicus | Token expirado | Renovarlo; dura poco por diseño |
| `earthaccess` no autentica | Falta `.netrc` o variables de entorno | Configurar el `.env` y reiniciar el contenedor |
| El disco se llena | Se bajaron escenas completas | Filtrar bandas y nubosidad antes de descargar |

---

## 12. Qué NO hacer todavía

- **No programar RUSLE.** Sin los cinco factores cargados no hay nada que multiplicar.
- **No bajar la región completa en Sentinel-2.** Una escena sobre una comuna basta
  para validar el procesamiento.
- **No optimizar consultas.** Primero que devuelvan lo correcto.
- **No diseñar la interfaz definitiva.** El prototipo ya cumple ese rol en Fase 2.
