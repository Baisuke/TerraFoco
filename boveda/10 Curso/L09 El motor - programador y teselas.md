# L09 · El motor: programador y teselas

> [!abstract] En una frase
> El **programador** revisa cada hora una tabla de tareas, decide con funciones puras cuáles **vencieron** según su cadencia, las **ordena por dependencias** y las ejecuta como comandos; y las **teselas** guardan el **valor** de cada celda de 30 m dentro de los tres canales de color de un píxel, para que el navegador pinte y lea la región entera sin servidor de mapas.

---

# Parte A · El programador

## 1. La idea

Los datos envejecen: Sentinel-2 tiene imágenes nuevas cada mes, CIREN se actualiza cada año, la serie del SIRSD-S crece. En vez de acordarse de correr cada cosa, hay un **programador** que:

1. lee la lista de tareas de la base (`operacion.tarea_programada`);
2. decide cuáles **vencieron**;
3. las **ordena** para que nada corra antes de aquello de lo que depende;
4. las ejecuta y anota cómo terminaron.

> [!tip] La cadencia vive en la base, no en el código
> Cambiar cada cuánto corre una ingesta es un `UPDATE`, no un despliegue.

## 2. La tabla de tareas

```sql
CREATE TABLE operacion.tarea_programada (
    codigo           VARCHAR(60) UNIQUE,     -- 'ingesta.sentinel'
    descripcion      VARCHAR(200),
    comando          VARCHAR(200),           -- 'python -m ingesta.sentinel --guardar'
    cadencia         VARCHAR(20),            -- unica | semanal | mensual | estacional | trimestral | anual | manual
    dia_del_mes      SMALLINT,               -- para mensual (máximo 28: existe en febrero)
    meses_validos    SMALLINT[],             -- para estacional (p. ej. {1,2} = verano)
    depende_de       VARCHAR(60) REFERENCES operacion.tarea_programada(codigo),
    activa           BOOLEAN,
    ultima_ejecucion TIMESTAMPTZ,
    ultimo_estado    VARCHAR(20)             -- 'ok' | 'error'
);
```

Ejemplos reales (de `bd/esquema.sql` y las migraciones 005, 010, 018):

| Tarea | Comando | Cadencia | Depende de |
|---|---|---|---|
| `ingesta.ciren` | `python -m ingesta.ciren` | anual | — |
| `ingesta.nasadem` | `python -m ingesta.srtm --preparar --cargar` | única | — |
| `ingesta.zonal_ls` | `python -m ingesta.zonal --raster … --factor ls --guardar` | única | `ingesta.nasadem` |
| `ingesta.sentinel` | `python -m ingesta.sentinel --guardar` | mensual (día 5) | — |
| `ingesta.transparencia` | `python -m ingesta.sirsd_ide` | mensual (día 10) | — |
| `ingesta.practicas` | `python -m ingesta.practicas --guardar` | mensual (día 11) | `ingesta.transparencia` |
| `indicadores.erosion` | `python -m calcular` | mensual (día 12) | `ingesta.sentinel` |
| `indicadores.inundacion` | `python -m indicadores.inundacion` | trimestral | … |
| `validar.inundacion` | `… validar_inundacion --marcar-si-pasa` | trimestral | `indicadores.inundacion` |
| `variables.inundacion` | `python -m variables_inundacion` | trimestral | `validar.inundacion` |
| `indicadores.superficie_erosionada` | `python -m indicadores.superficie_erosionada` | mensual | `indicadores.erosion` |

> [!note] La pertinencia no es una tarea
> Es una **vista**: se calcula en cada consulta. Programarla sugeriría un paso por lote que no existe (comentario en `bd/esquema.sql`).

## 3. ¿Vencida? — `motor/orquestacion/programacion.py`

Este archivo **no toca la base**: son funciones puras sobre una `Tarea` (un `@dataclass`). Por eso se prueba sin PostgreSQL (`tests/test_programacion.py`).

```python
ESPERA_TRAS_ERROR = timedelta(hours=24)

def esta_vencida(tarea, ahora=None):
    if tarea.cadencia not in CADENCIAS:                 # 1. cadencia mal escrita: error, no silencio
        raise ValueError("Cadencia desconocida ...")
    if not tarea.activa or tarea.cadencia == "manual":  # 2. apagada o manual: nunca sola
        return False

    ultima = tarea.ultima_ejecucion
    if tarea.ultimo_estado not in (None, "ok"):         # 3. la última falló:
        if ultima is not None and ahora - ultima < ESPERA_TRAS_ERROR:
            return False                                #    espera 24 h antes de reintentar
        ultima = None                                   #    pasadas 24 h, cuenta como "nunca corrió bien"

    if ultima is None:                                  # 4. nunca corrió con éxito: vence
        if tarea.cadencia == "estacional":
            return ahora.month in (tarea.meses_validos or [])
        return True

    if tarea.cadencia == "unica":      return False
    if tarea.cadencia == "semanal":    return ahora - ultima >= timedelta(days=7)
    if tarea.cadencia == "mensual":
        mismo_mes = (ultima.year, ultima.month) == (ahora.year, ahora.month)
        return not mismo_mes and ahora.day >= (tarea.dia_del_mes or 1)
    if tarea.cadencia == "estacional":
        return ahora.month in tarea.meses_validos and ultima.year != ahora.year
    if tarea.cadencia == "trimestral":
        return (ultima.year, trimestre(ultima)) != (ahora.year, trimestre(ahora))
    if tarea.cadencia == "anual":      return ultima.year != ahora.year
```

Tres bugs reales que este código ya resolvió (están contados en sus comentarios):

1. **Cadencia mal escrita** caía en "nunca ejecutada" y devolvía `True`: la tarea corría **cada hora para siempre**. Ahora se valida primero.
2. **Sin espera tras error**, una tarea que falla por algo que no cambia solo (un archivo que se descarga a mano) se reintentaba cada hora indefinidamente. Ahora espera 24 h.
3. **Zonas horarias:** la base guarda fecha con zona y `ahora` llega sin zona; restarlas fallaba. Se normaliza.

## 4. Ordenar por dependencias

```python
def ordenar_por_dependencia(tareas):
    """Toda tarea aparece después de aquella de la que depende. ValueError si hay un ciclo."""
    por_codigo = {t.codigo: t for t in tareas}
    ordenadas, visitando, listas = [], set(), set()

    def visitar(codigo):
        if codigo in listas: return                     # ya ubicada
        if codigo in visitando:
            raise ValueError("Dependencia circular en '%s'" % codigo)   # A→B→A
        visitando.add(codigo)
        tarea = por_codigo.get(codigo)
        if tarea is not None:
            if tarea.depende_de:
                visitar(tarea.depende_de)               # primero la dependencia...
            ordenadas.append(tarea)                     # ...después ella
        visitando.discard(codigo); listas.add(codigo)

    for t in tareas:
        visitar(t.codigo)
    return ordenadas
```

Es un **orden topológico** con búsqueda en profundidad: antes de poner una tarea en la lista, pone la de la que depende. Si encuentra un ciclo, **falla** en vez de colgarse.

```python
def bloqueadas_por_dependencia(tareas, resultados):
    """Tareas que no deben correr porque aquello de lo que dependen no quedó bien."""
    for t in tareas:
        if not t.depende_de: continue
        estado = resultados.get(t.depende_de)            # ¿corrió en este ciclo?
        if estado is None:                               # si no, su último estado guardado
            estado = por_codigo[t.depende_de].ultimo_estado
        if estado not in ("ok",):
            bloqueadas[t.codigo] = t.depende_de
```

> [!important] La regla
> Si una tarea falla, **lo que depende de ella no corre** y queda para el ciclo siguiente. Así el índice nunca se calcula sobre datos a medias.

## 5. El orquestador — `motor/orquestacion/orquestador.py`

```python
def ejecutar_tarea(tarea):
    try:
        subprocess.run(shlex.split(tarea.comando), check=True)   # corre el comando tal cual
        estado = "ok"
    except subprocess.CalledProcessError as e:                   # terminó con código ≠ 0
        estado = "error"
    except FileNotFoundError:                                    # el comando no existe
        estado = "error"
    registrar(tarea.codigo, estado)                              # UPDATE ultima_ejecucion, ultimo_estado
    return estado

def ejecutar_pendientes(ahora=None):
    tareas = cargar_tareas()                                     # SELECT de la tabla
    vencidas = [t for t in tareas if esta_vencida(t, ahora)]
    resultados = {}
    for tarea in ordenar_por_dependencia(vencidas):
        bloqueo = bloqueadas_por_dependencia(tareas, resultados).get(tarea.codigo)
        if bloqueo:
            print("  -- %s : se salta, '%s' no terminó bien" % (tarea.codigo, bloqueo))
            continue
        resultados[tarea.codigo] = ejecutar_tarea(tarea)

def demonio(intervalo):
    while True:
        try:
            ejecutar_pendientes()
        except Exception as e:            # nunca morir por una tarea
            print("[planificador] error no controlado: %s" % e)
        time.sleep(intervalo)             # 3600 s
```

- **`shlex.split`** separa el comando en palabras **sin pasar por una shell**: el comando de la tabla no puede inyectar otras órdenes.
- **`check=True`** convierte un código de salida distinto de cero en excepción: así "el módulo falló" se ve como "error". Por eso cada módulo termina en `sys.exit(main())`.
- **El orquestador no sabe nada del dominio:** solo comandos, cadencias y dependencias.

### Uso

```bash
docker exec -i terrafoco-programador python -m orquestacion.orquestador --listar          # qué venció
docker exec -i terrafoco-programador python -m orquestacion.orquestador --ejecutar        # correr lo vencido
docker exec -i terrafoco-programador python -m orquestacion.orquestador --forzar ingesta.ciren   # ignorar la cadencia
```

`--forzar` existe para los eventos: cuando ocurre algo, no hay que esperar al ciclo.

> [!question]- ¿Por qué no Airflow? (abre después de pensarlo)
> El orquestador no sabe nada del dominio: solo qué comando, cuándo y de qué depende. Migrar a Airflow o Prefect sería escribir DAGs que llamen **los mismos comandos**, sin tocar el motor. Para tres personas y una docena de tareas, Airflow (servidor, base propia, programador, interfaz) era más infraestructura que problema.

## 6. Bitácora y catálogo de fuentes

Dos tablas que dicen cosas distintas:

| | `operacion.fuente` (catálogo) | `operacion.ejecucion_proceso` (bitácora) |
|---|---|---|
| Qué dice | Qué fuentes hay y su **estado administrativo** (lo declara una persona) | Cada **corrida real** del motor: cuándo, cómo terminó, cuántos registros |
| Quién escribe | La API (`POST/PATCH /fuentes`, con clave) | El motor (`Bitacora`) |
| Se une por | `codigo` ('ciren', 'nasadem'…) ← `Bitacora(fuente="ciren")` resuelve el `id_fuente` | |

`GET /fuentes` une ambas con un `LATERAL` que trae **la última ejecución** de cada fuente: la fecha de "última carga" sale sola de la bitácora, sin mantenerla a mano. → [[Bitácora y catálogo de fuentes]]

---

# Parte B · Las teselas

## 7. El problema que resuelven

Antes, el detalle a 30 m se servía como **un PNG por comuna, ya coloreado**. Funcionaba, pero:

- se veía una comuna a la vez, y cada clic esperaba su imagen;
- el PNG trae el **color**, no el valor: bajo el cursor se podía decir "Severa" pero nunca "23,4 t/ha/año", y cambiar un corte obligaba a repintar la imagen;
- al alejarse, el navegador reducía la imagen entera en cada cuadro.

## 8. La solución: el valor dentro del color

`motor/teselas.py` corta la región en una **pirámide** de teselas de 512 px (zoom 6 al 11; en el 11 un píxel mide ~31 m, la celda de cálculo), y en cada píxel guarda el **valor codificado en RGB** con la codificación "terrain-RGB" de Mapbox:

```python
def codificar(a, escala):
    """Valores (NaN = sin dato) -> RGB."""
    n = np.zeros(a.shape, dtype=np.int64)
    ok = np.isfinite(a)
    n[ok] = np.clip(np.round((a[ok] * escala + 10000.0) * 10.0), 1, 2 ** 24 - 1)
    return np.stack([(n >> 16) & 255, (n >> 8) & 255, n & 255]).astype(np.uint8)
```

$$n = \text{round}\big((\text{valor} \times \text{escala} + 10000) \times 10\big) \qquad R = n \gg 16,\; G = (n \gg 8)\,\&\,255,\; B = n\,\&\,255$$

> [!example] Codificar 13,79 t/ha/año (erosión, escala 1)
> $n = \text{round}((13{,}79 + 10000) \times 10) = 100.138$
> $R = 100.138 \div 65.536 = 1$ (resto 34.602) · $G = 34.602 \div 256 = 135$ (resto 42) · $B = 42$
> El píxel es **RGB(1, 135, 42)**: un verde oscuro que nadie ve, porque **no se muestra tal cual**.
> Decodificar: $1 \times 65.536 + 135 \times 256 + 42 = 100.138 \Rightarrow -10000 + 100.138 \times 0{,}1 = 13{,}8$.

- **`× 10`**: precisión de una décima en la unidad codificada.
- **`escala`**: para conservar decimales. El índice de inundación (0–1) va ×1.000; el NDVI también.
- **`n = 0`** está reservado para **sin dato** y queda transparente.
- Las teselas se guardan en **WebP o PNG sin pérdida**: aquí el color **es** el dato; una compresión con pérdida cambiaría los valores.

## 9. Por qué MapLibre puede pintarlo

MapLibre sabe leer **modelos de elevación** en terrain-RGB (`encoding: 'mapbox'`). TerraFoco le "miente": le dice que la erosión es una elevación. Después, la capa **`color-relief`** colorea esa "elevación" con una **expresión de estilo** en la tarjeta de video. Cambiar los cortes, ocultar una clase o mover un umbral es cambiar la expresión: **no se descarga nada nuevo**. → [[L12 El visor - el mapa]]

## 10. PMTiles: toda la pirámide en un archivo

Una pirámide son miles de teselas. **PMTiles** las guarda en **un solo archivo** con un índice al principio. El navegador:

1. lee el encabezado y el índice (unos KB);
2. para cada tesela que necesita, pide **solo esos bytes** con una petición HTTP de rango (`Range: bytes=…`).

No hace falta servidor de mapas: sirve cualquier servidor que atienda rangos (nginx, Caddy, GitHub Pages, o `servir_prototipo.py` del proyecto, que se los agrega a Python con `herramientas/rangos.py`).

## 11. Las capas

| Capa | Fuente | Escala | Zoom | Cortes |
|---|---|---|---|---|
| `relieve` | NASADEM | 1 (m) | 5–10 | — (sombreado y 3D) |
| `erosion` | Mosaico de `erosion_*.tif` | 1 (t/ha/año) | 6–11 | 10 / 18 / 26 / 34 (inclusivos) |
| `ndvi` | Mosaico de NDVI | 1.000 | 6–11 | 0,2 / 0,4 / 0,6 / 0,8 |
| `pendiente` | `pendiente.tif` | 1 (%) | 6–11 | 5 / 15 / 30 / 50 |
| `inundacion` | `susceptibilidad.tif` | 1.000 | 6–11 | Los cuartiles de `susceptibilidad.json` |
| `calor` | ECOSTRESS | 1 (°C) | 6–10 | Los de `mapa_calor.py` |

Los **cortes viajan en los metadatos del archivo**: el visor arma la expresión de color leyéndolos de ahí. Así **el motor es la única fuente de los cortes**, y el mapa y la leyenda no pueden discrepar.

> [!info] "Cortes inclusivos"
> En qué clase cae un valor **exactamente igual** a un corte. Erosión cierra por arriba (18,0 es Moderada); inundación y calor por abajo. Viaja también en los metadatos.

Uso:

```bash
docker exec -i terrafoco-programador python -m teselas --todas
docker cp terrafoco-programador:/datos/teselas/. prototipo/datos/teselas/
```

## Pruébalo

```bash
docker exec -i terrafoco-programador python -m orquestacion.orquestador --listar
docker exec -i terrafoco-programador python -m pytest tests/test_programacion.py tests/test_teselas.py -q
ls -la prototipo/datos/teselas/          # los .pmtiles, un archivo por capa
```

En el visor, abre la consola (F12) en `visor.html` y mira la pestaña **Red** al hacer zoom: verás peticiones a `erosion.pmtiles` con estado **206 Partial Content** (rangos).

## Cómo decirlo en la presentación

> [!example] Programador
> "El sistema se actualiza solo. Un programador propio lee de la base la lista de tareas, decide cuáles vencieron según su cadencia, las ordena por dependencias y las ejecuta. Si una falla, lo que depende de ella no corre y se reintenta al día siguiente. No usamos Airflow porque el orquestador no sabe nada del dominio: si algún día se migra, los comandos son los mismos."

> [!example] Teselas
> "Para mostrar la región entera a 30 metros sin un servidor de mapas, guardamos el valor de cada celda dentro de los tres colores de un píxel. MapLibre lo trata como un modelo de elevación y lo colorea en la tarjeta de video; por eso cambiar un umbral es instantáneo y bajo el cursor podemos decir el valor exacto. Todo vive en un archivo por capa y el navegador pide solo los bytes que necesita."

## Autoevaluación

> [!question]- ¿Dónde se define cada cuánto corre una tarea?
> En la tabla `operacion.tarea_programada` (columnas `cadencia`, `dia_del_mes`, `meses_validos`). Cambiarla es un `UPDATE`, no un cambio de código.

> [!question]- ¿Qué pasa si una tarea falla?
> Queda con estado `error`; no se reintenta antes de 24 h; y las tareas que dependen de ella no corren en ese ciclo (`bloqueadas_por_dependencia`).

> [!question]- ¿Por qué `programacion.py` no accede a la base?
> Para que la lógica (cadencias, orden, bloqueos) sean funciones puras que se prueban sin levantar PostgreSQL, que es donde se esconden los errores de este tipo de código.

> [!question]- ¿Qué algoritmo ordena las tareas y qué hace con un ciclo?
> Un orden topológico por búsqueda en profundidad: cada tarea se ubica después de su dependencia. Si detecta un ciclo, lanza `ValueError` en vez de colgarse.

> [!question]- ¿Cómo sabe el orquestador si un módulo terminó bien?
> Por el código de salida del proceso: `subprocess.run(..., check=True)` lanza excepción si es distinto de cero. Cada módulo termina con `sys.exit(main())`.

> [!question]- Codifica el valor 0 de erosión con escala 1.
> n = round((0 + 10000) × 10) = 100.000 → R = 1 (resto 34.464), G = 134 (resto 160), B = 160. RGB(1, 134, 160). El valor "sin dato" es n = 0, distinto de cero real.

> [!question]- ¿Por qué las teselas no pueden ser JPEG?
> Porque el color es el dato: una compresión con pérdida cambia los valores. Se usan WebP o PNG sin pérdida.

> [!question]- ¿Qué es una petición de rango y por qué la necesita PMTiles?
> Un pedido HTTP de solo una parte de un archivo (`Range: bytes=…`, respuesta 206). PMTiles guarda toda la pirámide en un archivo y el navegador pide solo los bytes de las teselas visibles.

Siguiente: [[L10 La API por dentro]]
