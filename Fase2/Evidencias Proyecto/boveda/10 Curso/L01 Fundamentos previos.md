# L01 · Fundamentos previos

> [!abstract] En una frase
> TerraFoco es una **página web** (el visor) que le pide datos a un **servicio** (la API), que los lee de una **base de datos espacial** (PostGIS), donde los dejó un **programa de cálculo** (el motor) que trabaja con **mapas de celdas** (rásteres) y **polígonos** (vectores). Todo corre en **contenedores** de Docker.

Esta lección explica cada palabra de esa frase. Si ya sabes algo, sáltalo; si no, léelo con calma: el resto del curso usa estos conceptos sin volver a explicarlos.

---

## 1. La web: navegador, servidor, HTTP y JSON

### Cliente y servidor

- El **cliente** es quien pide. Aquí, el navegador con el visor abierto.
- El **servidor** es quien responde. Aquí hay dos: el que entrega los archivos del visor (HTML, JS, imágenes) y la **API**, que entrega datos.

> [!example] Analogía del restaurante
> El comedor es el **visor** (lo que ve el cliente). El mesero es la **API** (toma el pedido y trae el plato). La despensa es la **base de datos**. La cocina es el **motor**, que prepara los platos con anticipación y los deja en la despensa. El mesero nunca cocina: solo trae lo que ya está preparado. Por eso el comedor nunca espera horas.

### HTTP, URL y parámetros

Cada pedido es una **petición HTTP** a una **URL**:

```
http://localhost:8000/pertinencia?origen=CIREN&region=6
└─┬─┘ └────┬───────┘ └────┬────┘ └──────────┬──────────┘
protocolo  servidor:puerto  ruta      parámetros (query)
```

- `localhost` significa "este mismo computador". `8000` es el **puerto**: la "puerta" donde escucha la API. El visor escucha en el `8081`.
- La **ruta** (`/pertinencia`) dice qué se pide. Cada ruta es un **endpoint**.
- Los **parámetros** van después de `?`, separados por `&`. Aquí: qué origen de erosión y qué región.

Las peticiones tienen un **método**: `GET` para leer, `POST` para crear, `PATCH` para modificar. En TerraFoco casi todo es `GET`; lo único que escribe es el catálogo de fuentes (`POST` y `PATCH` en `/fuentes`).

### JSON

La API responde en **JSON**, un formato de texto para datos estructurados:

```json
{
  "id_comuna": 6203,
  "nombre": "Litueche",
  "perdida_ton_ha": 13.65,
  "en_dominio": true,
  "pertinencia": 0.0689
}
```

`{ }` es un objeto (pares nombre: valor), `[ ]` es una lista. `true/false` son booleanos, `null` es "sin valor".

### Códigos de estado

Cada respuesta trae un número que dice cómo le fue al pedido. Los que aparecen en este proyecto:

| Código | Significa | Dónde aparece |
|---|---|---|
| **200** | Todo bien | Casi siempre |
| **201** | Creado | Al registrar una fuente nueva (`POST /fuentes`) |
| **401** | Falta la clave o es incorrecta | Escribir sin clave de administración |
| **404** | No existe | Comuna sin dato, origen inexistente |
| **409** | Conflicto | Registrar una fuente con un código que ya existe |
| **422** | El pedido está mal formado | Estado de fuente inválido, cuerpo vacío |
| **503** | El servicio no está disponible | Escritura sin clave configurada en el servidor; pronóstico sin red |

### API REST

Una **API REST** es un conjunto de URLs que entregan datos en JSON. La de TerraFoco se documenta sola: en `http://localhost:8000/docs` aparece cada endpoint con un botón para probarlo.

### CORS

El navegador, por seguridad, no deja que una página lea datos de otro servidor salvo que ese servidor lo autorice. Como el visor está en el puerto 8081 y la API en el 8000, son "orígenes distintos": la API tiene que declarar que acepta pedidos del visor. Eso es **CORS** y se configura en `api/main.py`. → [[L10 La API por dentro]]

---

## 2. Bases de datos

### Tabla, fila, columna

Una **base de datos relacional** guarda datos en **tablas**, como una planilla:

| id_comuna | nombre | provincia | superficie_km2 |
|---|---|---|---|
| 6203 | Litueche | Cardenal Caro | 618,21 |
| 6204 | Marchigüe | Cardenal Caro | … |

- Cada **fila** es un registro (una comuna).
- Cada **columna** es un atributo con un **tipo** (número, texto, fecha, geometría).
- La **llave primaria** identifica cada fila sin repetirse (`id_comuna`, el código INE).
- Una **llave foránea** apunta a la llave de otra tabla: `indicadores.erosion.id_comuna` apunta a `territorio.comuna.id_comuna`. La base **no deja** guardar una erosión de una comuna que no existe.
- Una **restricción CHECK** es una regla que la base hace cumplir: "la clase de erosión es una de estas cinco", "los factores son positivos".

### Esquemas

Un **esquema** es una carpeta de tablas. TerraFoco tiene cuatro:

| Esquema | Guarda | Ejemplos |
|---|---|---|
| `territorio` | Lo que está en el mapa | `region`, `comuna`, `cauce`, `manzana`, `equipamiento` |
| `indicadores` | Lo que se calcula | `erosion`, `factor`, `susceptibilidad_inundacion`, `v_pertinencia` |
| `programas` | La inversión pública | `sirsd_anual`, `uf_anual`, `ejecucion` |
| `operacion` | El funcionamiento del sistema | `fuente`, `ejecucion_proceso`, `tarea_programada` |

### SQL en cinco instrucciones

**SQL** es el lenguaje para consultar. Con estas cinco palabras se lee casi todo el proyecto:

```sql
SELECT nombre, perdida_ton_ha          -- qué columnas
FROM   indicadores.v_pertinencia       -- de qué tabla o vista
WHERE  origen = 'CIREN'                -- qué filas (filtro)
ORDER  BY perdida_ton_ha DESC          -- en qué orden
LIMIT  5;                              -- cuántas
```

Y dos más para combinar:

```sql
-- JOIN: unir dos tablas por una columna común
SELECT c.nombre, e.perdida_ton_ha
FROM   territorio.comuna c
JOIN   indicadores.erosion e ON e.id_comuna = c.id_comuna;

-- GROUP BY: agrupar y resumir
SELECT id_comuna, SUM(incentivo) AS total
FROM   programas.sirsd_anual
GROUP  BY id_comuna;
```

`c` y `e` son **alias**: nombres cortos para no repetir el nombre completo de la tabla.

### Vista

Una **vista** es una consulta guardada con nombre, que se usa como si fuera una tabla. **No guarda datos**: los calcula cada vez que se consulta. El índice de pertinencia es una vista (`indicadores.v_pertinencia`): por eso nunca está desactualizado. → [[L05 La base de datos por dentro]]

### Transacción

Un grupo de cambios que se aplica **entero o nada**. Si algo falla a la mitad, se deshace todo (*rollback*); si termina bien, se confirma (*commit*). En el código lo hacen las funciones `conexion()` del motor y `transaccion()` de la API.

### Migración

Un archivo SQL numerado (`001_…sql`, `002_…sql`, …) que cambia la estructura de la base de forma ordenada. Se aplican en orden y cada una se puede volver a correr sin romper nada (*idempotente*). TerraFoco tiene 19. → [[Migraciones]]

---

## 3. Datos geográficos

### Vector: puntos, líneas y polígonos

Un **vector** es una forma con coordenadas:

- **Punto:** una escuela, un predio (`[-71.98, -34.08]`).
- **Línea:** un río.
- **Polígono:** el límite de una comuna (una lista de puntos que cierra).
- **Multipolígono:** varios polígonos juntos (una comuna con islas).

Se intercambian en **GeoJSON** (JSON con geometrías) y se guardan en PostGIS en columnas de tipo `geometry`.

### Ráster: una grilla de celdas

Un **ráster** es una imagen donde cada **celda** (píxel) guarda un **valor**, no un color:

```
┌────┬────┬────┐
│ 412│ 418│ 431│   ← elevación en metros (un DEM)
├────┼────┼────┤
│ 405│ 409│ 420│
├────┼────┼────┤
│ 399│ 401│ 411│
└────┴────┴────┘
  cada celda mide 30 × 30 m
```

- La **resolución** es el tamaño de la celda. TerraFoco trabaja a **30 m**: una celda es 0,09 hectáreas.
- Un **DEM** (modelo digital de elevación) es un ráster de alturas. Aquí, **NASADEM** de la NASA.
- El **NDVI** es un ráster de vegetación calculado de una imagen satelital: `(infrarrojo − rojo) / (infrarrojo + rojo)`. Va de −1 a 1; más alto, más vegetación.
- Se guardan en archivos **GeoTIFF** (`.tif`), que además de los valores dicen dónde está cada celda en la Tierra.

### Coordenadas y proyecciones

- **Geográficas:** latitud y longitud en **grados**. Ejemplo: Rancagua ≈ (−34,17; −70,74). Código **EPSG:4326**.
- **Proyectadas:** la Tierra "aplanada" a un plano en **metros**. Chile central usa **UTM huso 19 sur**, código **EPSG:32719**.
- **Web Mercator** (EPSG:3857): la proyección de los mapas web; la usan las teselas.

> [!warning] Por qué importa
> Una pendiente es "metros que sube por metro que avanza". Si el tamaño de celda está en **grados** (0,0003°) en vez de metros (30 m), la pendiente sale miles de veces equivocada **sin dar ningún error**. Por eso `motor/ingesta/zonal.py` **rechaza** los rásteres en grados (`tamano_de_celda`). TerraFoco **guarda** en grados (4326, el estándar para compartir) y **calcula** en metros (32719).

### Teselas y zoom

Un mapa web no descarga la región entera a máxima resolución. La corta en **teselas**: cuadrados de 256 o 512 píxeles, en una **pirámide** de niveles de zoom. En el zoom 6 una tesela cubre media región; en el 11, un píxel mide ~31 m. El navegador pide solo las teselas que se ven. TerraFoco guarda cada pirámide en **un solo archivo PMTiles** y el navegador pide solo los bytes que necesita. → [[L09 El motor - programador y teselas]]

### PostGIS

**PostgreSQL** es la base de datos; **PostGIS** es la extensión que le enseña geografía. Las funciones que aparecen en el código empiezan con `ST_`:

| Función | Qué hace | Dónde se usa |
|---|---|---|
| `ST_Intersects(a, b)` | ¿Se tocan dos geometrías? | Cruzar polígonos de CIREN con comunas |
| `ST_Intersection(a, b)` | La parte común | Qué parte del polígono cae en la comuna |
| `ST_Area(g::geography)` | Área en m² sobre la Tierra real | Hectáreas de cada polígono |
| `ST_Transform(g, 32719)` | Cambiar de proyección | Pasar comunas a metros para el cálculo |
| `ST_AsGeoJSON(g)` | Geometría a texto GeoJSON | Lo que entrega la API |
| `ST_PointOnSurface(g)` | Un punto que cae dentro | Dónde pedir el pronóstico de lluvia |

Un **índice GIST** es lo que hace rápidas esas consultas: como el índice de un libro, pero por ubicación.

---

## 4. Docker

| Concepto | Qué es | En TerraFoco |
|---|---|---|
| **Imagen** | Una "foto" de un sistema con todo instalado | `postgis/postgis:16-3.4`, la imagen de OSGeo con GDAL |
| **Contenedor** | Una imagen corriendo, aislada | `terrafoco-bd`, `terrafoco-api`, `terrafoco-motor`, `terrafoco-programador` |
| **Docker Compose** | Un archivo que levanta varios contenedores juntos | `docker-compose.yml` |
| **Volumen** | Un disco que sobrevive cuando el contenedor se borra | `terrafoco_bd` (la base), `terrafoco_datos` (rásteres) |
| **Puerto publicado** | Una puerta del contenedor abierta hacia el PC | `8000` (API), `5432` (base) |

Comandos que vas a ver:

```bash
docker compose up -d                       # levanta todo en segundo plano
docker compose ps                          # qué está corriendo
docker exec -i terrafoco-motor python -m calcular --revisar   # correr algo DENTRO de un contenedor
docker logs terrafoco-api                  # ver lo que imprimió la API
```

**Por qué Docker:** los tres integrantes tienen exactamente la misma versión de GDAL, PostGIS y Python. Instalar GDAL a mano es la causa número uno de "en mi computador funciona".

---

## 5. Leer Python

El motor y la API están en Python. Lo justo para leerlos:

```python
import numpy as np                  # usar una biblioteca (np es su apodo)
from bd import conexion             # traer una función de otro archivo del proyecto

UMBRAL = 18.0                       # constante: en mayúscula por convención

def clasificar(perdida):            # definir una función que recibe un valor
    """Texto de documentación."""   # docstring: explica qué hace
    if perdida <= 10:               # condición
        return "Ligera"             # devuelve y termina
    return "Moderada"

valores = {"R": 1071.4, "K": 0.027} # diccionario: nombre → valor
lista = [1, 2, 3]                   # lista
nada = None                         # "sin valor" (como null)
```

### Cosas que aparecen mucho

- **`python -m ingesta.ciren`**: corre el archivo `ingesta/ciren.py` como programa. Así se ejecuta todo el motor.
- **`argparse`**: lee las opciones de la línea de comandos (`--simular`, `--guardar`, `--region 6`).
- **`with conexion() as con:`**: un **gestor de contexto**. Abre algo al entrar y lo cierra al salir **pase lo que pase**. Si hay un error, igual cierra. Ver `motor/bd.py`.
- **`@dataclass`**: una forma corta de declarar una "ficha" con campos (`Factores(R=…, K=…)`).
- **`raise ValueError("…")`**: lanzar un error a propósito cuando algo está mal. **`try: … except: …`**: atrapar un error para manejarlo.
- **`"%s comunas" % n`**: insertar un valor en un texto.
- **numpy (`np`)**: opera sobre **millones de celdas a la vez**. `np.where(ndvi <= 0, 1.0, c)` decide celda por celda sin escribir un ciclo. Es lo que hace que una región a 30 m se calcule en segundos.

### El SQL dentro de Python

```python
con.execute("SELECT nombre FROM territorio.comuna WHERE id_region = %s", (6,))
```

El `%s` **no** es concatenar texto: es un **parámetro** que la biblioteca (psycopg) envía aparte. Así un valor malicioso nunca se ejecuta como SQL (**inyección SQL**). Es una pregunta típica de seguridad. → [[L18 Preguntas sobre el código]]

---

## 6. Leer JavaScript

El visor está en JavaScript **sin framework** (sin React ni Vue): archivos `.js` que se cargan en orden con etiquetas `<script>`.

```javascript
const GT = {};                         // un objeto vacío: el "espacio de nombres" del proyecto
GT.fmt = function (n, dec) { ... };    // se le cuelga una función

const lista = [3, 1, 2];
lista.map(function (x) { return x * 2; });       // [6, 2, 4]   transformar cada uno
lista.filter(function (x) { return x > 1; });    // [3, 2]      quedarse con algunos
lista.reduce(function (a, x) { return a + x; }, 0); // 6        resumir en uno
```

### Las ideas que importan

- **Orden de carga:** cada `<script>` puede usar lo que definieron los anteriores. Si `datos-api.js` se carga antes que `data.js`, falla porque `GT` todavía no existe. Ver el final de cualquier `.html`.
- **Objetos globales:** cada módulo crea uno: `GT` (datos y reglas), `PALETA` (colores), `GTMapa` (mapa esquemático), `GTMapaReal` (mapa real), `GTDetalle` (detalle a 30 m), `GTGrafico` (gráficos), `GTCalculo` (cuentas de inundación), etc.
- **Módulo con función inmediata:**
  ```javascript
  const GTZonas = (function () {
    function interna() { ... }          // privada: no se ve desde afuera
    return { kml: kml, geojson: geojson };  // lo que se publica
  })();
  ```
  Encierra lo interno y publica solo lo que devuelve. Así está hecha la mitad del visor.
- **`fetch(url)`**: pide algo por HTTP. Devuelve una **promesa**.
- **Promesa:** un valor que llegará después. Se encadena:
  ```javascript
  fetch(url)
    .then(function (r) { return r.json(); })   // cuando llegue: convertir a JSON
    .then(function (datos) { ... })            // cuando esté convertido: usarlo
    .catch(function (e) { ... });              // si algo falló en cualquier paso
  ```
- **DOM:** la página como objetos. `document.getElementById('kpiSup')` toma un elemento; `.textContent = '16.347'` le cambia el texto; `.innerHTML = '<b>…</b>'` le pone HTML.
- **Eventos:** `elemento.addEventListener('click', funcion)` = "cuando hagan clic, ejecuta esto".
- **`localStorage`:** un cajón del navegador que recuerda cosas entre visitas (el tema, el origen elegido, la dirección de la API).

---

## 7. Estadística mínima

| Concepto | En simple | Dónde aparece |
|---|---|---|
| **Media** | Suma ÷ cantidad | Erosión media de la comuna |
| **Mediana** | El valor del medio al ordenar; no la mueven los extremos | Mediana regional de UF/ha; NDVI de Sentinel |
| **Percentil p** | El valor bajo el cual queda el p % de los datos | Recorte 2–98 de las variables de inundación |
| **Cuartiles** | Percentiles 25, 50 y 75: dividen en cuatro partes iguales | Clases Baja/Media/Alta/Muy alta |
| **Normalización min–máx** | `(x − mín) / (máx − mín)`: lleva todo a 0–1 | Necesidad e inversión del índice |
| **Logaritmo** | Comprime lo grande: 0,3 y 34 quedan más cerca | Inversión por hectárea |
| **Correlación** | Si dos cosas suben y bajan juntas (de −1 a 1) | Validación |
| **Spearman (ρ)** | Correlación de los **rangos** (posiciones), no de los valores: ¿ordenan igual? | Validar erosión contra CIREN e inundación contra eventos |
| **Permutaciones** | Barajar los datos miles de veces para ver qué daría el azar | Significancia de la validación |

> [!example] Spearman con tres comunas
> CIREN ordena: A (30) > B (20) > C (10). El cálculo propio: A (50) > B (40) > C (5). Los números no se parecen, pero **el orden es el mismo**: ρ = 1. Eso es lo que se le pide al modelo propio: que ordene el territorio como el inventario oficial, no que dé los mismos números.

---

## 8. Git, en dos líneas

Git guarda la historia del código en **commits** (fotos con mensaje). Se trabaja en la rama `main` y se sube a GitHub con `git push`. Para la presentación basta con saber que cada cambio tiene autor, fecha y motivo.

---

## Autoevaluación

> [!question]- ¿Qué diferencia hay entre la API y la base de datos?
> La base **guarda** los datos (tablas en PostgreSQL/PostGIS). La API es un **servicio HTTP** que recibe pedidos del navegador, consulta la base y responde en JSON. El navegador nunca habla directo con la base.

> [!question]- ¿Qué es un ráster y qué resolución usa TerraFoco?
> Una grilla de celdas donde cada una guarda un valor (elevación, NDVI, erosión). TerraFoco calcula a 30 m (0,09 ha por celda); la temperatura de ECOSTRESS viene a 70 m.

> [!question]- ¿Por qué no se puede calcular la pendiente con coordenadas en grados?
> Porque la pendiente es metros de subida por metro de avance; con el tamaño de celda en grados la división da un número absurdo sin lanzar error. Por eso se trabaja en UTM 19S (EPSG:32719, metros) y `zonal.py` rechaza rásteres en grados.

> [!question]- ¿Qué es una vista y por qué el índice de pertinencia es una vista?
> Una consulta guardada que se calcula cada vez que se pide; no almacena datos. El índice es una vista para que siempre esté al día con los datos cargados y para poder cambiar el criterio de normalización (por origen, por región) sin migrar datos.

> [!question]- ¿Qué hace `with conexion() as con:`?
> Abre una conexión a la base, ejecuta el bloque y la cierra siempre, aunque haya un error. En el motor además confirma (commit) si todo salió bien y revierte (rollback) si falló.

> [!question]- ¿Qué es una promesa en JavaScript?
> Un valor que llegará más tarde (por ejemplo, la respuesta de un `fetch`). Se usa con `.then(...)` para hacer algo cuando llegue y `.catch(...)` para manejar el error.

> [!question]- ¿Por qué Spearman y no comparar los números directamente?
> Porque CIREN y el cálculo propio usan insumos, años y resoluciones distintos: exigir los mismos números no tiene sentido. Lo que sí se exige es que **ordenen igual** las comunas. Spearman mide eso: la correlación de las posiciones.

> [!question]- Nombra los cuatro esquemas de la base y qué guarda cada uno.
> `territorio` (región, comunas, cauces, manzanas, equipamiento), `indicadores` (erosión, factores, inundación, pertinencia), `programas` (SIRSD-S y UF), `operacion` (catálogo de fuentes, bitácora, tareas programadas).

Siguiente: [[L02 La historia del proyecto]]
