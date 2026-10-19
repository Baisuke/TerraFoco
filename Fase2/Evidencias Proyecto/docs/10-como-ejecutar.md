# Cómo ejecutar el proyecto

Guía corta para levantar TerraFoco y ver el avance. No cubre el desarrollo:
para las credenciales y la carga inicial de datos está la
[guía de arranque](08-guia-de-arranque.md).

---

## 1. Levantar el entorno

Requisito único: **Docker Desktop instalado y abierto**.

```bash
cd "Fase 2/Evidencias Proyecto/Evidencias de sistema/Aplicación"
docker compose up -d
```

Levanta cuatro servicios:

| Servicio | Qué hace |
|---|---|
| `bd` | PostgreSQL 16 + PostGIS 3.4 |
| `api` | FastAPI, en el puerto 8000 |
| `motor` | Procesos por lote; no corre como servicio |
| `programador` | Revisa cada hora qué tarea venció |

Comprobar que están arriba:

```bash
docker compose ps
```

---

## 2. Ver el prototipo

**Doble clic en `Aplicación/prototipo/index.html`.** No hace falta servidor.

Funciona porque la API responde `access-control-allow-origin: *`, así que el
navegador permite la conexión aunque la página venga del disco.

### El badge dice qué estás viendo

Arriba a la derecha:

| Dice | Significa |
|---|---|
| **Datos reales · erosión CIREN 2024** | Conectado a la API, mostrando datos del motor |
| **Prototipo · datos de ejemplo** | Sin API: cayó a los datos de `js/data.js` |

Y sobre el mapa hay un segundo aviso, con el origen de las geometrías:

| Dice | Significa |
|---|---|
| Geometrías reales · en vivo desde PostGIS | La base responde |
| Geometrías reales · copia estática de IDE Chile | Sin base, usando `datos/comunas.js` |
| Cartografía esquemática | Sin conexión para cargar MapLibre |

**El prototipo nunca queda en blanco, y nunca miente sobre lo que muestra.**
Si algo falla, se degrada un nivel y lo declara en pantalla.

---

## 3. Ver el estado del sistema

El comando más útil del día a día:

```bash
docker exec -i terrafoco-programador python -m estado
```

Responde de una vez: qué hay cargado, cuánto cubre, el historial de las
últimas ejecuciones y qué credenciales faltan.

Para revisar solo las credenciales, y comprobar que **de verdad sirven** —no
solo que estén escritas en el `.env`—:

```bash
docker exec -i terrafoco-programador python -m credenciales --probar
```

Con `--probar` pide un token real a cada servicio. La diferencia importa: una
contraseña mal copiada se ve idéntica a una correcta hasta que falla a mitad
de una descarga de media hora.

---

## 4. Ver la API

Documentación interactiva, con botón para probar cada endpoint:

**<http://localhost:8000/docs>**

Los principales:

| Endpoint | Devuelve |
|---|---|
| `/salud` | Estado de la API y de la base |
| `/comunas/geojson` | Geometrías para el visor |
| `/pertinencia?origen=CIREN` | Comunas ordenadas por brecha |
| `/pertinencia/origenes` | Qué orígenes de erosión hay cargados |
| `/regiones` | Regiones cargadas, sus comunas y el período de datos de cada módulo |
| `/inundacion` | Susceptibilidad por comuna, eventos históricos y si está calibrado |
| `/urbano` | Temperatura superficial por comuna (ECOSTRESS) |

Todos los endpoints de indicadores aceptan `?region=N`. El visor lo pasa
siempre: la región activa se elige en el selector de la barra superior y se
recuerda en el navegador. Para abrir el visor en otra región directamente:
`visor.html?region=7`.

---

## 5. Consultar la base

```bash
docker exec -it terrafoco-bd psql -U terrafoco -d terrafoco
```

Algunas consultas útiles:

```sql
-- Las diez comunas con mayor brecha
SELECT nombre, perdida_ton_ha, round(pertinencia::numeric, 2) AS indice
FROM   indicadores.v_pertinencia
WHERE  origen = 'CIREN'
ORDER  BY pertinencia DESC LIMIT 10;

-- Erosión media por provincia
SELECT c.provincia, round(avg(e.perdida_ton_ha), 1) AS erosion
FROM   indicadores.erosion e JOIN territorio.comuna c USING (id_comuna)
WHERE  e.origen = 'CIREN'
GROUP  BY c.provincia ORDER BY erosion DESC;

-- Qué proceso corrió y cómo terminó
SELECT inicio, proceso, estado, registros
FROM   operacion.ejecucion_proceso ORDER BY id_proceso DESC LIMIT 10;
```

Se sale con `\q`.

---

## 6. Cargar datos

Todos los cargadores aceptan `--simular`: procesan, muestran el resumen y
**no escriben nada**. Conviene usarlo siempre la primera vez.

```bash
# Erosión de CIREN — se descarga sola por WFS, no requiere credenciales.
# Demora cerca de una hora: son 50 cuencas y ~2 millones de polígonos.
docker exec -i terrafoco-programador python -m ingesta.ciren --simular
docker exec -i terrafoco-programador python -m ingesta.ciren

# Ejecución del SIRSD-S, desde una planilla CSV o XLSX
docker exec -i terrafoco-programador python -m ingesta.sirsd \
  --archivo /datos/sirsd_2024.csv --anio 2024 --simular

# Modelo de elevación (necesita credenciales de NASA Earthdata)
docker exec -i terrafoco-programador python -m ingesta.srtm --region 6

# Agregar un ráster por comuna
docker exec -i terrafoco-programador python -m ingesta.zonal \
  --raster /datos/srtm/dem_utm.tif --factor ls
```

> **Los rásteres deben estar proyectados en metros.** NASADEM y Sentinel-2
> llegan en grados, y `zonal` los rechaza a propósito: calcular una pendiente
> con celdas medidas en grados da un resultado equivocado por un factor de
> ~100.000 sin lanzar ningún error. Para reproyectar:
>
> ```bash
> docker exec -i terrafoco-programador gdalwarp -t_srs EPSG:32719 -r bilinear entrada.tif salida.tif
> ```

---

## 7. Ejecutar las pruebas

```bash
docker exec -i terrafoco-programador python -m pytest tests -q
```

Las de la API corren en su propio contenedor:

```bash
docker compose exec -T api python -m pytest tests -q
```

---

## Problemas frecuentes

**Editaste el `.env` y no pasa nada.**
Docker inyecta las variables al **crear** el contenedor, no las relee. Hay que
recrearlo:

```bash
docker compose up -d programador
```

**El prototipo muestra "datos de ejemplo" con la API arriba.**
Casi siempre es caché del navegador. Recarga forzada con `Ctrl+Shift+R`; si
persiste, abre la consola del navegador y busca los avisos `[datos-api]`.

**Un contenedor quedó en `exited (255)`.**
Pasa al reiniciar Docker Desktop. Se resuelve con `docker compose up -d`.

**El puerto 8000 está ocupado.**
Lo usa otro proyecto. Cerrarlo, o cambiar el mapeo en `docker-compose.yml`.

**`ogr2ogr: command not found`.**
Estás ejecutando en Windows en vez del contenedor. GDAL vive dentro de la
imagen: todos los comandos de ingesta van con `docker exec`.
