# L06 · El motor: anatomía de un módulo

> [!abstract] En una frase
> Cada script del motor es un **programa de línea de comandos** que sigue el mismo molde: lee la región de la base, trabaja, muestra un resumen, y solo si no se pidió `--simular` escribe dentro de un `with Bitacora(...)` que deja constancia de la corrida.

Si entiendes este molde, puedes abrir cualquiera de los ~40 archivos del motor y orientarte en un minuto.

## 1. Qué hay en `motor/`

```
motor/
├── config.py          ← configuración: todo por variables de entorno
├── bd.py              ← conexión, región y bitácora (lo usan todos)
├── calcular.py        ← RUSLE propio por comuna
├── validar.py         ← erosión propia vs CIREN (Spearman)
├── estado.py          ← resumen de lo cargado
├── credenciales.py    ← qué credenciales hay y si funcionan
├── mapa_erosion.py    ← erosión a 30 m (GeoTIFF y PNG por comuna)
├── mapa_inundacion.py, mapa_calor.py   ← lo mismo para inundación y calor
├── variables_inundacion.py              ← las 6 variables por celda, para el visor
├── teselas.py         ← pirámides PMTiles para el visor
├── ingesta/           ← un archivo por fuente externa (~22)
├── indicadores/       ← modelos y cálculos (RUSLE, inundación, superficie, área verde…)
├── orquestacion/      ← el programador
└── tests/             ← ~270 pruebas
```

Regla de reparto: **`ingesta/` trae datos de afuera**, **`indicadores/` calcula**, los de la raíz **producen** (mapas, teselas, informes).

## 2. `config.py`: nada escrito en el código

```python
"""
Regla de oro del proyecto: **ninguna coordenada, ningún código de región y
ninguna credencial escritos en el código**. Las coordenadas del área de interés
salen de la tabla `territorio.region`; el resto, del entorno.
"""
BD_URL = os.getenv("BD_URL", "postgresql://terrafoco:desarrollo_local@localhost:5432/terrafoco")
ID_REGION = int(os.getenv("ID_REGION", "6"))   # 6 = O'Higgins
DIR_DATOS = os.getenv("DIR_DATOS", "/datos")

EARTHDATA_USER = os.getenv("EARTHDATA_USER", "")
...
EPSG_ALMACENAMIENTO = 4326    # todo se guarda en geográficas
NUBOSIDAD_MAXIMA = 10         # % para descartar escenas de Sentinel-2
```

`os.getenv("X", "valor")` lee la variable de entorno `X` (que Docker toma del `.env`); si no existe, usa el valor por defecto.

### Credenciales por grupo

```python
GRUPOS = {
    "earthdata": {
        "para": "descargar NASADEM (factor LS)",
        "donde": "https://urs.earthdata.nasa.gov",
        "requiere": lambda: bool(EARTHDATA_USER and EARTHDATA_PASS),
        "variables": "EARTHDATA_USER + EARTHDATA_PASS (el token NO los reemplaza)",
    },
    "cdse": {...}, "sentinel_hub": {...}, "cdse_s3": {...}, "usgs": {...},
}

def exigir(grupo):
    """Falla temprano y con instrucciones, en vez de reventar a mitad de descarga."""
    mensaje = falta(grupo)
    if mensaje:
        raise SystemExit(mensaje)
```

> [!tip] Por qué por grupo
> Cargar las comunas no necesita ninguna credencial; descargar el DEM no necesita las de Copernicus. Exigirlas todas de entrada frenaría trabajo que sí se puede hacer. Y si faltan, el mensaje dice **qué** completar y **dónde** obtenerlo.

## 3. `bd.py`: tres herramientas que usan todos

### 3.1 `conexion()` — abrir y cerrar siempre

```python
@contextlib.contextmanager
def conexion():
    """Abre una conexión y la cierra siempre, incluso si algo falla."""
    con = psycopg.connect(config.BD_URL)
    try:
        yield con          # aquí corre el bloque "with"
        con.commit()       # si terminó bien: confirma
    except Exception:
        con.rollback()     # si falló: deshace todo
        raise              # y deja que el error siga su camino
    finally:
        con.close()        # en cualquier caso: cierra
```

Uso: `with conexion() as con: con.execute(SQL, parametros)`. Es una **transacción**: o se escribe todo el bloque, o nada.

### 3.2 `obtener_region()` — la región sale de la base

```python
def obtener_region(id_region=None):
    """Lee el área de interés desde la base. Nunca desde el código."""
    sql = """
        SELECT id_region, codigo, nombre, epsg_trabajo, resolucion_m,
               ST_XMin(extension), ST_YMin(extension),
               ST_XMax(extension), ST_YMax(extension)
        FROM   territorio.region WHERE id_region = %s
    """
    ...
    if fila is None:
        raise ValueError("La región %s no existe en territorio.region. "
                         "Agregar una región es insertar una fila, no tocar el código." % id_region)
    return config.Region(id_region=fila[0], codigo=fila[1], nombre=fila[2],
                         epsg_trabajo=fila[3], resolucion_m=fila[4],
                         bbox=(fila[5], fila[6], fila[7], fila[8]))
```

Devuelve una `Region` (un `@dataclass` con nombre, EPSG de trabajo y el rectángulo `bbox`). **Todos** los módulos que necesitan saber "dónde" llaman a esta función. Por eso no hay coordenadas en el código.

### 3.3 `Bitacora` — cada corrida deja constancia

```python
class Bitacora:
    def __init__(self, proceso, id_fuente=None, id_region=None, fuente=None):
        self.proceso = proceso
        self.codigo_fuente = fuente      # "ciren", "nasadem"... el código del catálogo
        self.registros = None            # cuántas filas se escribieron (lo pone quien la usa)
        self.simulada = False            # con --simular no se registra

    def __enter__(self):                 # al entrar al "with"
        # INSERT INTO operacion.ejecucion_proceso (..., estado) VALUES (..., 'en curso')
        ...
        return self

    def __exit__(self, tipo, valor, traza):   # al salir del "with", bien o mal
        estado = "ok" if tipo is None else "error"
        mensaje = None if tipo is None else "%s: %s" % (tipo.__name__, valor)
        if self.simulada and tipo is None:
            # DELETE: una simulación no cuenta como carga
            ...
        # UPDATE ... SET fin = now, estado = 'ok'|'error', registros, mensaje
        return False   # nunca suprime la excepción
```

`__enter__` y `__exit__` son lo que hace que una clase funcione con `with`. Uso:

```python
with Bitacora("Ingesta CIREN — O'Higgins", fuente="ciren") as b:
    ...                     # trabajo
    b.registros = 33        # dato para la bitácora
# al salir: fila en operacion.ejecucion_proceso con estado 'ok' o 'error'
```

> [!important] Qué gana el sistema con esto
> - **Fuentes de datos** (`fuentes.html`) muestra la última carga real de cada fuente sin que nadie mantenga fechas a mano: sale de esta tabla.
> - Si un proceso revienta, el error queda escrito con su mensaje.
> - `return False` en `__exit__` significa: el error **no se esconde**, sigue hasta quien llamó (y el programador lo ve como fallido).

## 4. El molde de un módulo

Casi todos los scripts tienen esta forma (ejemplo condensado de `motor/indicadores/inundacion.py`):

```python
"""Docstring largo: qué hace, por qué, de dónde salen las fórmulas, cómo se usa."""
import argparse, sys
import config
from bd import Bitacora, conexion, obtener_region

CONSTANTES = ...            # parámetros del modelo, con su justificación al lado

def funcion_pura(arreglo):  # cuentas: reciben números, devuelven números (se prueban)
    ...

def guardar(region, resultado):   # E/S: escribe en la base
    with conexion() as con:
        ...

def main():
    p = argparse.ArgumentParser(description="…")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--simular", action="store_true")      # calcula y muestra, no escribe
    args = p.parse_args()

    region = obtener_region(args.region)                  # dónde
    with Bitacora("Índice … — %s" % region.nombre) as b:  # constancia
        resultado = funcion_pura(...)                     # qué
        informe(resultado)                                # mostrar
        if args.simular:
            b.simulada = True                             # no cuenta como carga
            return 0
        b.registros = guardar(region, resultado)          # escribir
    return 0

if __name__ == "__main__":
    sys.exit(main())     # el número que devuelve main es el código de salida
```

### Las piezas, una por una

| Pieza | Para qué |
|---|---|
| **Docstring** | Explica el **porqué**. Muchas respuestas de defensa están ahí. Léelo siempre primero. |
| **Constantes con comentario** | Cada número tiene su procedencia (`R_MAXIMO_CONFIABLE = 2000.0` con un párrafo que lo justifica). |
| **Funciones puras** | Las cuentas, separadas de leer/escribir: se prueban sin base ni red. |
| **`argparse`** | Las opciones: `--region`, `--simular`, `--guardar`, `--revisar`, `--anio`… |
| **`--simular`** | Corre todo y muestra el resultado **sin escribir**. Es la forma segura de probar. |
| **`obtener_region`** | La región, de la base. |
| **`with Bitacora(...)`** | La constancia en `operacion.ejecucion_proceso`. |
| **`sys.exit(main())`** | Devuelve 0 si salió bien, otro número si no. El programador usa ese código para decidir "ok" o "error". |

> [!tip] El `if __name__ == "__main__":`
> Significa "solo si este archivo se ejecuta como programa (no si otro lo importa)". Permite que las pruebas importen `rusle.py` y usen sus funciones sin ejecutar nada.

### Banderas que vas a ver

| Bandera | Significa | Ejemplos |
|---|---|---|
| `--simular` | No escribe nada | casi todos |
| `--guardar` | Escribe (por defecto solo muestra) | `zonal`, `cr2met`, `soilgrids`, `sentinel`, `practicas` |
| `--revisar` | Muestra lo que ya hay guardado | `calcular`, `indicadores.inundacion` |
| `--listar` | Lista lo disponible | `ciren`, `orquestador` |
| `--region N` | Otra región | todos |

> [!warning] `--guardar` vs `--simular`
> Algunos módulos escriben por defecto y se frenan con `--simular`; otros solo muestran por defecto y escriben con `--guardar`. Por eso la tarea programada de LS es `python -m ingesta.zonal … --guardar`: sin esa bandera la tarea terminaba en "ok" **y no escribía nada** (comentario en `bd/esquema.sql`).

## 5. Cómo se ejecuta un módulo

```bash
docker exec -i terrafoco-motor python -m calcular --revisar
docker exec -i terrafoco-motor python -m ingesta.ciren --simular
docker exec -i terrafoco-motor python -m indicadores.inundacion
```

- `docker exec -i terrafoco-motor` → "dentro del contenedor del motor"
- `python -m calcular` → "ejecuta el módulo `calcular` (archivo `calcular.py`)"
- `python -m ingesta.ciren` → "el módulo `ciren` del paquete `ingesta`" (archivo `ingesta/ciren.py`)

Dentro del contenedor, el código del PC está en `/app` (montado) y los rásteres en `/datos` (volumen).

## 6. Dos principios que atraviesan el motor

### "Nada se inventa"

Si falta un dato, **no se calcula** y se dice. Nunca se rellena con un promedio regional: produciría un número que parece medido y no lo es. Ejemplos:

- `calcular.py`: una comuna sin los cinco factores queda fuera y se informa qué le falta.
- `zonal.py`: una comuna sin celdas válidas queda con valor `None`, no `0` ("hay que poder distinguir *el ráster no la cubre* de *el valor es cero*").
- `almacen.py`: los valores nulos o no positivos se **devuelven** al que llama para que los informe.

### "Cada número sabe de dónde salió"

- Cada factor guarda **fuente**, **año** y un **detalle** en JSON (período de las imágenes, celdas usadas, cobertura).
- Cada índice de inundación guarda los **pesos** y **cortes** con que se calculó.
- Cada corrida queda en la **bitácora**.

## 7. Los diagnósticos

```bash
docker exec -i terrafoco-programador python -m estado          # qué hay cargado
docker exec -i terrafoco-programador python -m credenciales    # qué credenciales hay y si sirven
```

`estado.py` imprime bloques (territorio, erosión por origen, factores, inundación, SIRSD-S, credenciales) con consultas que, como siempre, toman la **última versión** de cada comuna ("contar filas daba 99 comunas en una región de 33").

## Pruébalo

```bash
docker exec -i terrafoco-motor python -m calcular --revisar     # qué factores hay por comuna
docker exec -i terrafoco-motor python -m calcular --simular     # el cálculo completo sin escribir
bash herramientas/sql.sh "SELECT proceso, estado, registros, inicio::date FROM operacion.ejecucion_proceso ORDER BY inicio DESC LIMIT 8;"
```

## Cómo decirlo en la presentación

> [!example] Versión corta
> "El motor son programas de línea de comandos en Python que siguen un mismo molde: leen la región desde la base —no hay coordenadas en el código—, calculan con funciones puras que probamos aparte, y escriben dentro de una bitácora que deja constancia de cada corrida. Todos tienen un modo simular para ver el resultado sin escribir. Y una regla: si falta un dato, no se inventa."

## Autoevaluación

> [!question]- ¿Dónde están las coordenadas de O'Higgins?
> En la base, en `territorio.region.extension` (un rectángulo en EPSG:4326). El motor las lee con `bd.obtener_region()`. No hay coordenadas en el código.

> [!question]- ¿Qué pasa en la bitácora si un proceso falla a la mitad?
> `Bitacora.__exit__` recibe la excepción, actualiza la fila con estado `error` y el mensaje, y devuelve `False` para que la excepción siga. El programador ve el código de salida distinto de cero y marca la tarea como fallida.

> [!question]- ¿Para qué sirve `--simular` y qué hace la bitácora en ese caso?
> Corre el cálculo completo y muestra el resultado sin escribir en la base. La bitácora borra su fila al salir (`simulada = True`), porque una simulación no es una carga.

> [!question]- ¿Por qué las credenciales se validan por grupo?
> Porque cada tarea necesita las suyas; exigir todas de entrada frenaría lo que sí se puede hacer. `exigir(grupo)` falla temprano con instrucciones de qué completar y dónde.

> [!question]- ¿Qué hace `with conexion() as con:` si una de diez inserciones falla?
> Hace rollback: no queda ninguna de las diez. Es una transacción.

> [!question]- ¿Cómo se ejecuta `motor/ingesta/ciren.py`?
> `docker exec -i terrafoco-motor python -m ingesta.ciren` (con `--simular` para probar sin escribir, `--listar` para ver las cuencas).

Siguiente: [[L07 El motor - erosión y RUSLE]]
