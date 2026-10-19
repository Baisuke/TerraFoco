# L15 · Pruebas y calidad

> [!abstract] En una frase
> ~270 pruebas del motor y ~96 de la API, escritas con **pytest**, que se concentran en **lo que falla en silencio** (unidades, rangos, cadencias, codificación, clases) y que pueden existir porque las cuentas viven en **funciones puras**, separadas de la base y de la red; además, cada modelo tiene su **validación estadística** contra datos reales.

## 1. Tres niveles de calidad

| Nivel | Pregunta | Cómo | Dónde |
|---|---|---|---|
| **Pruebas automatizadas** | ¿El código hace lo que dice? | pytest, ~370 pruebas | `motor/tests/`, `api/tests/` |
| **Validación del modelo** | ¿El resultado se parece a la realidad? | Spearman contra CIREN y contra 63 eventos | `validar.py`, `validar_inundacion.py` |
| **Controles en ejecución** | ¿Este dato es plausible? | Rangos, CHECK de la base, cobertura mínima, criterio de calibración | `RANGOS`, migraciones, `zonal.py`, `pasa_criterio` |

## 2. La idea que lo hace posible: funciones puras

Una **función pura** recibe números y devuelve números: no lee archivos, no consulta la base, no llama a internet. Se puede probar con valores escritos a mano en milisegundos. El proyecto separa a propósito las cuentas de la entrada/salida:

| Cuentas puras (se prueban solas) | Entrada/salida (las usan) |
|---|---|
| `indicadores/rusle.py` (los 5 factores) | `calcular.py`, las ingestas |
| `indicadores/terreno.py` (pendiente, curvatura, LS) | `ingesta/zonal.py`, `hidrologia.py` |
| `orquestacion/programacion.py` (cadencias, orden) | `orquestacion/orquestador.py` |
| `api/focalizacion.py` (brecha, focalización) | `api/rutas/pertinencia.py`, `sembrar_indicadores.py` |
| `js/inundacion-calculo.js`, `js/simulacion-lluvia.js`, `js/simulacion-calor.js` | `inundacion.js`, `simulacion-*.js` |

## 3. Qué tipo de error persiguen

> [!important] El error caro no es el que revienta: es el que no falla
> Un K sin conversión a unidades SI sale 7,6 veces más grande y el programa corre feliz. Una pendiente calculada con celdas en grados sale cinco órdenes de magnitud equivocada sin un solo error. Una cadencia mal escrita hace correr una tarea cada hora para siempre. Las pruebas están escritas contra esos casos.

### Ejemplos reales

**Contra la teoría — `tests/test_terreno.py`:** se construye un plano con pendiente **conocida** y se exige que Horn la reproduzca.

```python
def plano(filas, columnas, pendiente_pct, dx=30.0, eje="x"):
    """Superficie perfectamente inclinada, para comparar contra la teoría."""
    j, i = np.meshgrid(np.arange(columnas), np.arange(filas))
    paso = dx * pendiente_pct / 100.0
    return (j * paso if eje == "x" else i * paso).astype("float64")

@pytest.mark.parametrize("pct", [1.0, 5.0, 12.5, 30.0, 60.0])
def test_reproduce_la_pendiente_de_un_plano(pct):
    """En el interior, Horn debe dar el valor exacto del plano."""
    z = plano(10, 10, pct, dx=30.0)
    p = pendiente_horn(z, 30.0)
    assert np.allclose(p[1:-1, 1:-1], pct, rtol=1e-9)
```

"Si Horn devuelve 21 % donde el plano tiene 20 %, hay un error en el tamaño de celda, y ese error se propaga a toda la región sin que nada falle." Otras del mismo archivo: `test_curvatura_valle_es_negativa_y_loma_positiva`, `test_promediar_ls_no_es_promediar_pendiente`, `test_la_version_vectorizada_coincide_con_la_escalar` (la versión numpy y la de `rusle.py` no pueden divergir).

**Contra lo publicado — `tests/test_factores.py`, `test_rusle.py`:** cada ecuación reproduce su comportamiento documentado y cae en el rango plausible: `test_fournier_castiga_la_concentracion` (600 mm en tres meses erosionan más que 600 mm parejos), `test_R_en_rango_para_climas_reales` con la lluvia de Rancagua y Pichilemu, y que el conjunto dé pérdidas del orden de CIREN (5 a 60 t/ha/año).

**Contra los bugs que ya ocurrieron — `tests/test_programacion.py`:**

```
test_cadencia_desconocida_falla_fuerte
test_tras_un_error_espera_un_dia_antes_de_reintentar
test_detecta_dependencia_circular
test_no_calcula_indicadores_si_la_ingesta_fallo
test_la_dependencia_que_no_corre_en_el_ciclo_vale_por_su_ultimo_estado
test_ultima_ejecucion_con_zona_horaria
```

Los nombres son frases: leer la lista es leer la especificación.

**Ida y vuelta — `tests/test_teselas.py`:** codificar y decodificar devuelve el mismo valor con precisión de una décima; el cero real y "sin dato" no se confunden; la regla de clases del motor es la misma que la del visor (`test_regla_de_clases_igual_a_la_del_visor`).

**Consistencia entre piezas — `tests/test_bitacora_fuente.py`:** cada código de fuente que usa una ingesta (`Bitacora(fuente="ciren")`) **existe** en el catálogo que siembra la migración 012. Un código mal escrito no lanza ninguna excepción en producción (la ejecución queda "huérfana"), así que tiene que saltar aquí. Por eso el contenedor monta `./bd` de solo lectura.

**Entrada inválida — `tests/test_zonal.py`:** `test_rechaza_raster_en_grados`.

**Seguridad — `api/tests/test_seguridad.py`:** sin clave en el servidor → 503; clave corta = no configurada; sin encabezado → 401 con `WWW-Authenticate`; clave casi correcta o con un carácter de más → 401. **Ninguna llega a escribir**: o las corta la autenticación o llevan un cuerpo inválido.

**Cuentas a mano — `api/tests/test_focalizacion.py`:**

```python
def test_brecha_es_lo_que_falta_hasta_la_mediana():
    # 0,5 UF/ha con 1.000 ha severas y mediana 2: faltan 1,5 x 1.000.
    assert brecha_uf(0.5, 1000, 2.0) == pytest.approx(1500)

def test_sin_dato_no_se_inventa_brecha():
    assert brecha_uf(None, 1000, 2.0) is None
```

## 4. Cómo están escritas (para leerlas)

```python
import pytest

def test_algo_que_debe_cumplirse():       # pytest corre toda función que empiece con test_
    resultado = funcion(entrada)
    assert resultado == esperado           # si es falso, la prueba falla

@pytest.mark.parametrize("pct", [1.0, 5.0, 30.0])   # la misma prueba con varios valores
def test_varios(pct): ...

with pytest.raises(ValueError):            # se espera un error
    indice_fournier([10] * 11)             # 11 meses en vez de 12

pytest.approx(1500)                         # igualdad con tolerancia (decimales)
monkeypatch.setattr(config, "CLAVE_ADMIN", "...")   # cambiar algo solo durante la prueba
```

- **`TestClient`** (FastAPI) simula peticiones HTTP sin levantar el servidor.
- Las pruebas que necesitan PostgreSQL se **saltan** si no hay base (`skipif(not hay_base())`), para que la batería corra en cualquier equipo.

## 5. Cómo correrlas

```bash
docker exec -i terrafoco-programador python -m pytest tests -q     # motor (~270)
docker compose exec -T api python -m pytest tests -q               # API (~96)
```

`-q` = salida corta. El resultado esperado: una línea de puntos y "N passed".

## 6. La calidad que no es código

- **Docstrings que explican el porqué**, con la fuente de cada fórmula: es documentación que no se separa del código.
- **Comentarios que cuentan el bug que evitan** ("Machalí daba 733 t/ha contra 1,71 de CIREN", "San Vicente pasó de 12,5 a 16,0"): quien venga después no lo deshace.
- **Constantes con nombre y justificación** (`R_MAXIMO_CONFIABLE`, `MEJORA_MINIMA`, `PERCENTILES`).
- **`--simular`** en casi todo: probar contra datos reales sin escribir.
- **La bitácora:** evidencia de qué corrió, cuándo y cómo terminó.
- **Declarar los límites** en pantalla y en `docs/`: dominio de validez, eventos de prensa, 33 comunas, subprogramas incluidos.

## Cómo decirlo en la presentación

> [!example] Versión corta
> "Tenemos unas 370 pruebas automatizadas, y no persiguen cobertura por cobertura: persiguen los errores que no revientan, como unidades equivocadas, cadencias mal escritas o una codificación que pierde decimales. Por ejemplo, construimos un plano con pendiente conocida y exigimos que el algoritmo la reproduzca exacta. Eso es posible porque separamos las cuentas de la base de datos. Y además cada modelo se valida contra datos reales: el de erosión contra CIREN y el de inundación contra 63 eventos."

## Autoevaluación

> [!question]- ¿Qué es una función pura y por qué ayuda a probar?
> Una función que solo recibe valores y devuelve valores, sin leer archivos, base ni red. Se prueba con números escritos a mano, rápido y en cualquier equipo.

> [!question]- Da un ejemplo de prueba "contra la teoría".
> `test_reproduce_la_pendiente_de_un_plano`: se construye un plano inclinado con pendiente conocida (1 %, 5 %, 30 %…) y se exige que `pendiente_horn` la reproduzca exacta en el interior.

> [!question]- ¿Por qué existe `test_bitacora_fuente.py`?
> Porque un código de fuente mal escrito en una ingesta no lanza error en producción: la ejecución queda sin fuente en el catálogo. La prueba compara los códigos usados contra los que siembra la migración 012.

> [!question]- ¿Cómo prueban la seguridad sin riesgo de escribir en la base?
> Las pruebas usan cuerpos inválidos o les falta la clave: o las corta la autenticación (401/503) o las rechaza la validación (422) después de autenticar. Nunca llegan a insertar.

> [!question]- ¿Qué diferencia hay entre una prueba y una validación del modelo?
> La prueba verifica que el código hace lo que dice (con datos controlados). La validación verifica que el resultado se parece a la realidad (Spearman contra CIREN o contra eventos).

> [!question]- ¿Cómo se corren las pruebas del motor?
> `docker exec -i terrafoco-programador python -m pytest tests -q`.

Siguiente: [[L16 Despliegue y copias]]
