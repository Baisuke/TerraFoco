# L10 · La API por dentro

> [!abstract] En una frase
> Una aplicación **FastAPI** en `api/` con un archivo por tema en `rutas/`: cada endpoint es una función de Python que recibe los parámetros de la URL ya validados, hace **una consulta SQL** a PostGIS y devuelve un diccionario que FastAPI convierte en JSON; lo único que escribe es el catálogo de fuentes, detrás de una clave.

## 1. Los archivos

```
api/
├── main.py           ← crea la aplicación, CORS, compresión, registra las rutas
├── config.py         ← todo por entorno: BD_URL, región por defecto, clave, orígenes
├── bd.py             ← conexion() para leer, transaccion() para escribir, una_fila()
├── seguridad.py      ← requiere_admin: la clave de administración
├── focalizacion.py   ← cuentas puras: brecha en UF, focalización por año, Spearman
├── rutas/
│   ├── salud.py         GET /salud
│   ├── regiones.py      GET /regiones, /regiones/{id}
│   ├── comunas.py       GET /comunas, /comunas/geojson, /comunas/erosion, /comunas/factores,
│   │                        /comunas/terreno, /comunas/{id}/sirsd
│   ├── pertinencia.py   GET /pertinencia, /pertinencia/{id}, /pertinencia/origenes,
│   │                        /pertinencia/evolucion
│   ├── inundacion.py    GET /inundacion, /inundacion/eventos, /inundacion/validacion,
│   │                        /inundacion/cauces, /inundacion/pronostico
│   ├── exposicion.py    GET /exposicion/poblacion, /manzanas, /equipamiento, /agricola
│   ├── localidades.py   GET /localidades
│   ├── urbano.py        GET /urbano, /urbano/areas-verdes, /urbano/areas-verdes/geojson
│   ├── fuentes.py       GET /fuentes, /fuentes/{id} · POST /fuentes · PATCH /fuentes/{id}
│   └── ejecuciones.py   GET /ejecuciones, /ejecuciones/resumen
└── tests/            ← ~96 pruebas
```

## 2. `main.py`: arma la aplicación

```python
app = FastAPI(title="TerraFoco API", description="...", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ORIGENES,            # quién puede leer desde un navegador
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)
app.add_middleware(GZipMiddleware, minimum_size=2048)   # comprime respuestas > 2 KB

app.include_router(salud.router)
app.include_router(regiones.router)
...
app.include_router(ejecuciones.router)
```

- Un **middleware** es algo que se mete entre la petición y la respuesta en todas las rutas.
- **CORS:** el visor está en otro puerto; sin esto el navegador bloquearía las respuestas. En desarrollo se permite `*` porque el visor también se abre desde `file://` (origen "null") y desde Codespaces (cuya URL cambia).
- **GZip:** las capas son GeoJSON pesados (las manzanas de Rancagua, 2,4 MB): comprimidas, un quinto.
- **Routers:** cada archivo de `rutas/` define un `router` con un prefijo; aquí se enchufan todos.

> [!important] CORS no es seguridad para escribir
> Comentario literal: *"CORS no protege la escritura —curl lo ignora—: la protege la clave de administración."* CORS lo aplica el navegador; un programa como `curl` lo ignora. Por eso la escritura tiene su propia protección.

## 3. `bd.py`: dos formas de conectarse

```python
@contextlib.contextmanager
def conexion():                 # para LEER
    con = psycopg.connect(config.BD_URL)
    try:
        yield con
    finally:
        con.close()

@contextlib.contextmanager
def transaccion():              # para ESCRIBIR
    con = psycopg.connect(config.BD_URL)
    try:
        yield con
        con.commit()            # confirma al salir bien
    except Exception:
        con.rollback()          # revierte si algo falla
        raise
    finally:
        con.close()
```

> [!warning] Por qué dos
> `conexion()` **no confirma**. psycopg abre una transacción implícita y, al cerrar sin `commit`, los cambios se pierden **sin error**: la petición responde 200 y la fila nunca llega. Por eso escribir exige `transaccion()`. Es un bug que se encontró y quedó documentado en el docstring.

## 4. Anatomía de un endpoint

Tomemos `GET /pertinencia/{id_comuna}` (`api/rutas/pertinencia.py`):

```python
router = APIRouter(prefix="/pertinencia", tags=["indicadores"])   # (1)

@router.get("/{id_comuna}")                                       # (2)
def una(id_comuna: int,                                            # (3)
        origen: str = Query(default="CIREN")):                     # (4)
    """Ficha de una comuna: UC-03."""                              # (5)
    sql = SQL_LISTA.replace("p.id_region = %s", "p.id_comuna = %s")
    with bd.conexion() as con:                                     # (6)
        fila = con.execute(sql, (id_comuna, origen, True)).fetchone()
    if fila is None:                                               # (7)
        raise HTTPException(404, "La comuna %d no tiene pertinencia calculada "
                                 "para el origen %r" % (id_comuna, origen))
    return _fila(fila)                                             # (8)
```

1. **Router con prefijo:** todas las rutas del archivo empiezan con `/pertinencia`. `tags` las agrupa en `/docs`.
2. **Decorador:** "esta función atiende `GET /pertinencia/{id_comuna}`". Lo que va entre llaves es parte de la ruta.
3. **Parámetro de ruta tipado:** `id_comuna: int`. Si alguien pide `/pertinencia/abc`, FastAPI responde **422** solo, sin llegar a la función.
4. **Parámetro de consulta** (`?origen=…`), con valor por defecto. `Query(ge=0, le=500)` validaría un rango.
5. **Docstring:** aparece como descripción en `/docs`.
6. **Consulta con parámetros:** el `%s` lo rellena psycopg **por separado**; nunca se arma SQL pegando texto del usuario → no hay **inyección SQL**.
7. **Error con sentido:** 404 con un mensaje que dice qué falta.
8. **Respuesta:** un diccionario. FastAPI lo convierte a JSON.

### `_fila`: de la fila de SQL al JSON

```python
def _fila(f):
    def num(v):
        return float(v) if v is not None else None     # Decimal de Postgres → float
    return {
        "id_comuna": f[0], "nombre": f[1], ...
        "perdida_ton_ha": num(f[7]), "clase": f[8],
        "pertinencia": num(f[15]),
        "incentivo_uf": num(f[17]), "ha_erosion_severa": num(f[18]),
        "inversion_uf_ha": num(f[19]),
        "mediana_uf_ha": num(f[22]),
        "brecha_uf": (round(brecha_uf(num(f[19]), num(f[18]), num(f[22])), 1)
                      if f[6] and f[19] is not None and f[22] is not None else None),
    }
```

La brecha **no se calcula fuera del dominio** (`f[6]` es `en_dominio`): ahí el denominador sobreestima.

### La consulta de la lista, con la mediana

```sql
WITH m AS (
  SELECT id_region, origen,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY inversion_uf_ha) AS mediana
  FROM   indicadores.v_pertinencia
  WHERE  en_dominio                         -- la mediana, solo con las del dominio
  GROUP  BY id_region, origen
)
SELECT <campos>, m.mediana
FROM   indicadores.v_pertinencia p
LEFT   JOIN m USING (id_region, origen)
WHERE  p.id_region = %s AND origen = %s
  AND  (%s OR p.en_dominio)                 -- incluir_fuera_de_dominio
ORDER  BY p.pertinencia DESC NULLS LAST
```

- **`percentile_cont(0.5)`** es la mediana en SQL.
- La mediana se calcula **solo con las comunas del dominio**: las de precordillera tienen denominadores inflados (0,003 UF/ha en Machalí) y bajarían la meta de todas.
- **`(%s OR p.en_dominio)`**: si el parámetro es verdadero, entran todas; si no, solo las del dominio. Un truco para tener un filtro opcional con un solo SQL.

### Errores que ayudan

Si `/pertinencia` no encuentra filas, distingue "no hay datos" de "el origen no existe":

```python
raise HTTPException(404, {
    "mensaje": "Sin datos de pertinencia para la region %d y el origen %r" % (region, origen),
    "origenes_disponibles": disponibles,
    "sugerencia": "Cargar la linea base con: python -m ingesta.ciren ...",
})
```

## 5. `focalizacion.py`: cuentas puras, compartidas

Va aparte de las rutas para **probarlo con números escritos a mano** y para que `herramientas/sembrar_indicadores.py` use **exactamente las mismas cuentas** al armar la copia local.

```python
def brecha_uf(uf_ha, ha_severa, mediana_uf_ha):
    """UF que faltan para llegar a la mediana; 0 si ya está sobre ella."""
    if uf_ha is None or ha_severa is None or mediana_uf_ha is None:
        return None                                    # sin dato no se inventa brecha
    return max(0.0, (mediana_uf_ha - uf_ha) * ha_severa)
```

**Por qué la mediana y no el máximo:** el máximo es San Vicente (34 UF/ha); tomarlo como meta daría una brecha impagable que no diría nada. La mediana es "lo que recibe la comuna típica": una meta que ya cumple la mitad.

`focalizacion(comunas, anios)` responde, **año por año**: ¿qué parte del incentivo fue a las comunas más erosionadas (sobre la mediana de erosión), frente a la parte que les tocaría según su superficie con erosión severa? Se lee sin estadística: *"tienen el 61 % del problema y recibieron el 47 %"*. Agrega el ρ de Spearman para quien quiera la medida clásica, y resume dos períodos **sumando el incentivo** (no promediando porcentajes: un año de 17 mil UF no pesa lo mismo que uno de 80 mil). Lo sirve `GET /pertinencia/evolucion`.

## 6. La seguridad de la escritura — `seguridad.py`

```python
LARGO_MINIMO = 24
_esquema = HTTPBearer(auto_error=False)

def requiere_admin(request: Request,
                   credenciales: HTTPAuthorizationCredentials | None = Depends(_esquema)):
    clave = config.CLAVE_ADMIN or ""
    if len(clave) < LARGO_MINIMO:                                    # (1) cerrado por defecto
        raise HTTPException(503, "La escritura está deshabilitada en este servidor: ...")
    if credenciales is None:                                         # (2) sin encabezado
        raise _no_autorizado("Esta operación requiere la clave de administración.")
    if not secrets.compare_digest(credenciales.credentials.encode("utf-8"),
                                  clave.encode("utf-8")):            # (3) tiempo constante
        log.warning("clave de administración incorrecta desde %s ...", ...)   # nunca la clave
        raise _no_autorizado("Clave de administración incorrecta.")
```

Y en la ruta:

```python
@router.patch("/{id_fuente}", dependencies=[Depends(requiere_admin)])
def actualizar(cambio: CambioDeFuente, id_fuente: int = Path(ge=1)):
    ...
```

**`Depends`** es la "inyección de dependencias" de FastAPI: antes de ejecutar `actualizar`, ejecuta `requiere_admin`; si esa lanza un error, la ruta no corre.

| Decisión | Por qué |
|---|---|
| **Cerrado por defecto** (503 sin clave o con una corta) | Un servidor mal configurado queda sin poder escribir, pero **no expuesto** |
| **Clave por encabezado** (`Authorization: Bearer …`), no cookie | El navegador no la adjunta solo: una página ajena no puede usarla → no hay CSRF que defender |
| **`secrets.compare_digest`** | Compara en **tiempo constante**: el tiempo de respuesta no revela cuántos caracteres acertó un intento |
| **Mínimo 24 caracteres** | `secrets.token_urlsafe` de 24 caracteres son ~144 bits; una clave corta suele ser "admin123" |
| **Una sola clave, sin usuarios** | Hay una sola persona que administra; un sistema de cuentas sería superficie de ataque sin necesidad. Si hubiera roles, se cambia la dependencia, no la ruta |
| **Se registra el intento, nunca la clave** | Los logs no se convierten en una filtración |

### Validación con pydantic

```python
class CambioDeFuente(BaseModel):
    """Todo opcional: se actualiza solo lo que venga en el cuerpo."""
    estado: Optional[str] = None
    url_base: Optional[str] = None
    marcar_carga: bool = False

class FuenteNueva(BaseModel):
    codigo: str = Field(pattern=r"^[a-z][a-z0-9_]{1,29}$")    # como 'ciren', 'cr2met'
    nombre: str = Field(min_length=3, max_length=160)
    ...
```

FastAPI valida el cuerpo JSON contra el modelo; si no calza, **422**. Además el estado se revisa contra `ESTADOS = ("ok", "parcial", "pendiente", "error")` (la misma lista del CHECK de la tabla) para responder 422 con un mensaje claro en vez de un error de integridad de la base. Un código repetido responde **409** (no 500: el pedido está mal, no el servidor).

## 7. Otras rutas que vale la pena conocer

| Ruta | Qué tiene de interesante |
|---|---|
| `GET /salud` | Responde **aunque la base esté caída** (lo dice en el JSON). Primer endpoint que debe funcionar |
| `GET /comunas/geojson` | Arma el GeoJSON **dentro de PostgreSQL** (`json_build_object`, `json_agg`, `ST_AsGeoJSON`): la API solo lo reenvía. Fue el hito del Sprint 0 |
| `GET /comunas/factores` | Los factores con que se calculó la erosión vigente (de `indicadores.erosion`) y su procedencia (de `indicadores.factor`), con un `LATERAL` |
| `GET /regiones` | Lista de regiones y **los años que realmente hay cargados** por módulo: el selector no promete años sin dato |
| `GET /inundacion/pronostico` | Llama a Open-Meteo, **caché de 30 min**, y si falla devuelve el último con `vencido: true` |
| `GET /exposicion/*` | GeoJSON con 6 decimales (~10 cm) y la **atribución** de la licencia de cada fuente |
| `GET /ejecuciones` | La bitácora, **de solo lectura a propósito**: si la API pudiera tocarla, dejaría de ser evidencia fiable |

## 8. Las pruebas de la API

```python
from fastapi.testclient import TestClient
from main import app
cliente = TestClient(app)

def test_salud_siempre_responde():
    """Aunque la base este caida, /salud debe contestar e informarlo."""
    r = cliente.get("/salud")
    assert r.status_code == 200
    assert r.json()["base_de_datos"] in ("ok", "error")
```

`TestClient` simula peticiones HTTP sin levantar un servidor. Las pruebas de seguridad **no llegan a escribir**: o las corta la autenticación, o llevan un cuerpo inválido. Las que necesitan base se **saltan** solas si no hay PostgreSQL (`hay_base()` con tope de tiempo). → [[L15 Pruebas y calidad]]

## Pruébalo

1. Abre `http://localhost:8000/docs`. Despliega `GET /pertinencia`, botón **Try it out**, origen `TerraFoco`, **Execute**. Mira la URL generada, el JSON y el código 200.
2. Prueba `GET /pertinencia/99999`: 404 con mensaje.
3. Prueba `GET /pertinencia/abc` en el navegador: 422 (FastAPI valida el tipo).
4. Intenta `PATCH /fuentes/1` sin pulsar **Authorize**: 401 (o 503 si el servidor no tiene clave).

```bash
docker compose exec -T api python -m pytest tests -q
```

## Cómo decirlo en la presentación

> [!example] Versión corta
> "La API está en FastAPI: cada endpoint es una función que recibe los parámetros ya validados por tipo, hace una consulta parametrizada a PostGIS y devuelve JSON; la documentación interactiva se genera sola en /docs. Es de lectura pública por diseño. Lo único que escribe es el catálogo de fuentes, con una clave por encabezado que está cerrada por defecto y se compara en tiempo constante."

## Autoevaluación

> [!question]- ¿Qué hace FastAPI si pides `/pertinencia/abc`?
> Responde 422 sin ejecutar la función, porque `id_comuna` está declarado como `int` y "abc" no lo es.

> [!question]- ¿Cómo se evita la inyección SQL?
> Las consultas usan parámetros (`%s`) que psycopg envía aparte del texto SQL; nunca se concatena texto del usuario dentro de la consulta.

> [!question]- ¿Por qué hay `conexion()` y `transaccion()` en `api/bd.py`?
> `conexion()` sirve para leer y no confirma; si se usara para escribir, los cambios se perderían sin error. `transaccion()` confirma al terminar bien y revierte si falla.

> [!question]- ¿Qué responde la API si se intenta escribir sin clave configurada en el servidor? ¿Y con una clave incorrecta?
> 503 si el servidor no tiene clave (o tiene una de menos de 24 caracteres): cerrado por defecto. 401 con `WWW-Authenticate: Bearer` si falta el encabezado o la clave es incorrecta.

> [!question]- ¿Por qué la clave va en un encabezado y no en una cookie?
> El navegador adjunta las cookies solo; una página maliciosa podría aprovecharlas (CSRF). Un encabezado hay que ponerlo a propósito, así que una página ajena no puede usarlo.

> [!question]- ¿Qué es `Depends(requiere_admin)`?
> Una dependencia de FastAPI: se ejecuta antes de la ruta y, si lanza un error, la ruta no corre. Así la protección se declara en una línea en cada escritura.

> [!question]- ¿Por qué la brecha se mide contra la mediana regional y no contra el máximo?
> El máximo (San Vicente, 34 UF/ha) daría metas impagables y sin sentido. La mediana es lo que recibe la comuna típica: una meta que ya cumple la mitad de las comunas.

> [!question]- ¿Por qué `focalizacion.py` está separado de las rutas?
> Para probar sus cuentas con números escritos a mano, sin base, y para que la herramienta que arma la copia local use exactamente las mismas funciones.

Siguiente: [[L11 El visor - cómo arranca una página]]
