# L08 · El motor: inundaciones

> [!abstract] En una frase
> Seis variables del terreno se calculan **por celda de 30 m**, se normalizan a 0–1 y se suman con pesos; solo **acumulación de flujo y curvatura** (50/50) quedaron con peso, porque la validación contra **63 eventos históricos** mostró que eran las únicas que ordenaban bien las comunas; las clases son **cuartiles** y el índice solo se marca "calibrado" si pasa un criterio declarado.

## 1. Qué mide (y qué no)

Un **índice de susceptibilidad estática**: qué terreno reúne las condiciones del relieve para que el agua **se junte**. Es una propiedad del lugar, no del clima.

- **Sí:** "este fondo de valle cóncavo con mucha agua drenando hacia él es más susceptible que esa ladera".
- **No:** "mañana se inunda" ni "la probabilidad es 30 %". Eso exige lluvia, caudales y modelos hidráulicos: fuera del alcance por diseño.

> [!tip] Frase que conviene usar
> "El índice dice **dónde** mirar; la lluvia dice **cuándo** mirar." (Está en la advertencia del pronóstico, `api/rutas/inundacion.py`.)

## 2. Las seis variables

| Variable | Qué indica | Fuente | Cálculo | Sentido | Peso |
|---|---|---|---|---|---|
| Pendiente | Lo plano retiene, lo empinado escurre | NASADEM | Horn (1981) | inversa | 0 |
| **Acumulación de flujo** | Cuántas celdas drenan hacia esta | NASADEM | D8 con pysheds, en log₁₀ | **directa** | **50** |
| Distancia a cauces | Cerca de un río, más riesgo | IDE Chile, red hídrica 1:25.000 | Distancia a cauces de orden Strahler ≥ 5 | inversa | 0 |
| TWI | Donde llega mucha agua y no se va | NASADEM | ln(a / tan β) | directa | 0 |
| **Curvatura** | Negativa = cóncavo (hondonada) | NASADEM | Zevenbergen & Thorne (1987) | **inversa** | **50** |
| Cobertura | Vegetación que absorbe | Sentinel-2 | NDVI de verano | inversa | 0 |

- **Directa:** más valor, más susceptible. **Inversa:** se voltea (1 − x) antes de sumar.
- Las cuatro sin peso **se siguen calculando y guardando**: son capas del módulo y otra región podría necesitarlas.

```python
# motor/indicadores/inundacion.py — espejo de GT.variablesInundacion en el visor
VARIABLES = (
    #  nombre              peso  sentido  archivo
    ("pendiente",            0,   -1,    "pendiente.tif"),
    ("acumulacion",         50,   +1,    "acumulacion.tif"),
    ("distancia_cauces",     0,   -1,    "distancia_cauces.tif"),
    ("twi",                  0,   +1,    "twi.tif"),
    ("curvatura",           50,   -1,    "curvatura.tif"),
    ("cobertura",            0,   -1,    "cobertura.tif"),
)
assert sum(v[1] for v in VARIABLES) == 100, "los pesos deben sumar 100"
```

## 3. Cómo se calcula cada variable

### Acumulación de flujo y TWI — `motor/ingesta/hidrologia.py`

La acumulación de una celda depende de **toda la cuenca aguas arriba**, no de sus ocho vecinas. Por eso se calcula **una vez sobre la región completa** (con margen) y no comuna por comuna: recortar primero dejaría fuera el agua que viene de la comuna vecina, que es exactamente la que inunda.

```python
def acumulacion_de_flujo(z, transform, crs, nodata=-9999.0):
    grid = Grid.from_raster(dem)                     # pysheds
    sin_pozos = grid.fill_pits(dem)                  # 1. rellenar hoyos de una celda
    sin_depresiones = grid.fill_depressions(sin_pozos)   # 2. rellenar depresiones
    inclinado = grid.resolve_flats(sin_depresiones)  # 3. dar una leve pendiente a lo plano
    direccion = grid.flowdir(inclinado)              # 4. hacia cuál de 8 vecinas va el agua (D8)
    acumulacion = grid.accumulation(direccion)       # 5. cuántas celdas pasan por cada una
```

Sin el "acondicionamiento" (pasos 1–3), el agua simulada se detiene en cada hoyo del DEM y la acumulación sale a parches.

```python
def indice_topografico_humedad(acumulacion_celdas, pendiente_pct, dx):
    """TWI = ln(a / tan(beta))"""
    a = np.maximum(acumulacion_celdas, 1.0) * dx          # área de captación por ancho
    beta = np.arctan(np.maximum(pendiente_pct, 0.1) / 100.0)   # evita dividir por cero
    return np.log(a / np.tan(beta))
```

### Curvatura — `motor/indicadores/terreno.py::curvatura`

La segunda derivada del terreno (cuánto "se curva"), de la ventana 3×3. **Negativa** = cóncavo: el fondo de un valle, una hondonada, donde el agua se junta. **Positiva** = convexo: una loma, de donde escurre. Por eso el almacén de inundación **no rechaza negativos**.

### Distancia a cauces — `motor/ingesta/cauces.py`

La red hídrica de IDE Chile trae el **orden de Strahler** (1 = quebrada de cabecera; sube al juntarse cauces). En el área hay 9.107 tramos, 8.400 de ellos quebradas de ladera: drenaje, no inundación. La distancia se mide a los de **orden ≥ 5** (ríos y esteros principales, ~680 tramos).

### Cobertura — el NDVI de Sentinel-2

Los NDVI por comuna se unen en un mosaico (`mosaico_ndvi`) y se remuestrean a la rejilla del DEM.

## 4. El índice — `motor/indicadores/inundacion.py`

### 4.1 Normalizar cada variable a 0–1

```python
PERCENTILES = (2, 98)

def normalizar(arreglo, sentido, dominio=None, percentiles=PERCENTILES):
    validas = v[dominio & ~np.isnan(v)]
    bajo, alto = np.percentile(validas, percentiles)       # recorte en p2 y p98
    n = np.clip((v - bajo) / (alto - bajo), 0.0, 1.0)      # a 0–1
    if sentido < 0:
        n = 1.0 - n                                        # voltear las inversas
    n[np.isnan(v)] = np.nan
    return n, (float(bajo), float(alto))
```

Dos decisiones con historia:

- **Recortar en los percentiles 2 y 98:** una celda con pendiente 443 % (un "acantilado" del DEM) fijaba el máximo y aplastaba todo el territorio contra el cero.
- **Escala sobre el `dominio`** (las celdas donde las seis variables existen, o sea, el territorio de las comunas), **no sobre todo el rectángulo**: el recorte del DEM incluye Maule, la Metropolitana y la cordillera hasta Argentina; con eso la distancia a cauces llegaba a 29 km y todo el territorio real quedaba en un extremo.

### 4.2 Sumar con pesos

```python
def combinar(capas):
    """Suma ponderada. NaN donde falte cualquiera: nada se rellena."""
    indice = np.zeros_like(next(iter(capas.values())), dtype="float64")
    for nombre, peso, _sentido, _archivo in VARIABLES:
        if peso:
            indice += capas[nombre] * (peso / 100.0)
    return indice
```

Con los pesos vigentes: `índice = 0,5 × acumulación_norm + 0,5 × (1 − curvatura_norm)`.

### 4.3 Por píxel primero, por comuna después

> [!important] La decisión clave del módulo
> Se combina **celda por celda** y recién después se promedia por comuna. Al revés no funciona: la **curvatura media** de 300.000 celdas es ≈ 0 (lo cóncavo y lo convexo se cancelan) y la **acumulación media** la dominan las laderas. A nivel de celda ambas discriminan; a nivel de comuna, no. Combinando primero, la comuna **hereda** la señal.

```python
def agregar(indice, transform, geometrias, cortes_pixel):
    for id_comuna, nombre, geo in geometrias:
        dentro = geometry_mask([geo], ...)           # celdas de la comuna
        v = indice[dentro]; v = v[~np.isnan(v)]
        resultado[id_comuna] = {
            "media": float(v.mean()),
            "fraccion_alta": float((v >= cortes_pixel[1]).mean()),   # % en Alta o más
            "celdas": int(v.size)}
    cortes_comuna = cortes_por_cuartiles(medias)     # clases entre comunas
```

### 4.4 Clases por cuartiles

```python
def cortes_por_cuartiles(valores):
    return tuple(float(x) for x in np.percentile(v, (25, 50, 75)))

NOMBRES_CLASE = ("Baja", "Media", "Alta", "Muy alta")
```

Con los pesos calibrados, las medias comunales caen entre **0,34 y 0,38**: cortes fijos (0,25 / 0,50 / 0,75) meterían todo en "Media". Los cuartiles dan clases **relativas**: a nivel de píxel cada clase es un cuarto del territorio de la región; a nivel comunal, un cuarto de las comunas. "Muy alta" significa "el cuarto más susceptible de la región", y así se declara.

**Cortes de píxel vigentes:** 0,229 / 0,349 / 0,484.

### 4.5 Guardar con su receta

- Ráster `susceptibilidad.tif` + `susceptibilidad.json` con pesos, percentiles, cortes y escalas: quien lea el `.tif` sabe cómo se hizo, y `mapa_inundacion.py` colorea con **los mismos cortes**.
- Una fila por comuna en `indicadores.susceptibilidad_inundacion` con la media, la clase, `fraccion_alta`, los **pesos** y el **método** (migración 011) y **`calibrado = FALSE`**.

## 5. La validación — `motor/indicadores/validar_inundacion.py`

**Eventos:** DesInventar (UNDRR, alimentado por ONEMI): 13.534 fichas de Chile 1970–2014; **63 eventos de inundación con comuna** en O'Higgins (`motor/ingesta/desinventar.py`). SENAPRED no publica un registro descargable. Sirven para **validar**, no para entrenar: con etiquetas por comuna, la muestra son 33.

Tres preguntas, de menos a más exigente:

1. **¿Qué fracción de los eventos cae en comunas Alta o Muy alta?** Es el criterio declarado en el perfil ("una proporción mayoritaria"). Pero solo **engaña**: si 17 de 33 comunas son Alta o Muy alta, el azar ya da 52 %. Se compara con el azar.
2. **¿Ordena el índice como los eventos?** Spearman entre índice y número de eventos. No depende de dónde se pongan los cortes.
3. **¿Qué variable aporta y cuál estorba?** Spearman de cada variable con los eventos, contra el signo que el modelo le supone: si sale al revés, la variable está **restando**.

```python
MEJORA_MINIMA = 0.10        # 10 puntos sobre el azar

def pasa_criterio(r):
    if r["frac_alta"] <= 0.5:
        return False, "menos de la mitad de los eventos cae en Alta o Muy alta"
    if r["frac_alta"] - r["azar"] < MEJORA_MINIMA:
        return False, "no mejora al azar en 10 puntos"
    if not r["rho"] > 0:
        return False, "el índice ordena las comunas al revés de los eventos"
    return True, "cumple: ..."
```

`--marcar-si-pasa` actualiza `calibrado = TRUE` en la versión más reciente **solo si pasa**. Lo usa el programador después de cada recálculo: así el índice nunca queda declarado como calibrado sin haberlo demostrado.

**Resultado vigente:** **43 de 63 eventos (68 %)** en comunas Alta o Muy alta, frente a **52 %** del azar (+16 puntos); **ρ ≈ +0,36**. Pasa el criterio.

## 6. La historia de los pesos (CRISP-DM en acción)

| | Iteración 1 (a priori) | Iteración 2 (recalibrada) |
|---|---|---|
| Pesos | 24 / 21 / 19 / 16 / 11 / 9 (las seis) | Acumulación 50 + curvatura 50 |
| Eventos en Alta/Muy alta | 59 %, **pero el azar daba 61 %** | 68 % frente a 52 % del azar |
| Spearman | **−0,16** (peor que el azar) | **+0,41** en el banco de pruebas (+0,46 sin 1982); ≈ +0,36 vigente |

**Qué pasó:** la **pendiente**, el peso mayor, correlacionaba **al revés**. A escala comunal la pendiente media la fija la cordillera, no el pueblo junto al río: las comunas con más eventos (pobladas, de valle) tienen la cordillera como parte de su territorio. Y la pendiente no se pierde: está dentro del TWI y la curvatura es su segunda derivada.

**Cómo se eligió sin hacer trampa** (`motor/indicadores/recalibrar_inundacion.py`):

- Los juegos de pesos se **declararon de antemano**; no se optimizaron. Con 33 comunas, optimizar seis pesos contra 63 eventos de prensa daría un ajuste perfecto y falso.
- Se probó también cómo agregar el píxel a la comuna (media, percentil 90, fracción en Alta).
- Se reporta **sin 1982**, año que concentra 31 de los 63 eventos.
- Se dice que es **en muestra**: los mismos eventos eligen y miden. Una diferencia de Spearman menor a 0,15 es ruido.

> [!important] Cómo defenderlo
> "No elegimos los pesos para que el número saliera bien: comparamos juegos declarados antes de mirar el resultado, el criterio para marcarlo calibrado está escrito en el código, y declaramos los límites: eventos de prensa que sobrerrepresentan comunas pobladas, 33 comunas, validación en muestra."

## 7. Lo que el motor deja para el visor

| Salida | Archivo / tabla | Lo usa |
|---|---|---|
| Índice a 30 m (valores) | `teselas/inundacion.pmtiles` | Detalle continuo en `inundaciones.html` |
| Las 6 variables por celda | `teselas/inundacion_variables.pmtiles` + `inundacion/variables.json` | "¿Por qué esta celda?" y el explorador de pesos (`variables_inundacion.py`) |
| PNG por comuna (respaldo) | `datos/inundacion/*.png` | Detalle cuando no hay teselas o desde `file://` |
| Índice comunal, eventos, validación | API `/inundacion`, `/inundacion/eventos`, `/inundacion/validacion` | Mapa regional, tabla y tarjeta de validación |
| % cultivo y pradera por celda | `teselas/agricola.pmtiles` (`ingesta/worldcover.py`) | Exposición agrícola |
| Personas por unidad censal, equipamiento, localidades | `territorio.unidad_censal`, `equipamiento`, `ciudad` | Exposición |

`variables.json` trae, por comuna, las medias normalizadas de cada variable. Como **la media de una suma ponderada es la suma ponderada de las medias**, el visor recalcula el índice comunal para **cualquier** juego de pesos de forma **exacta** (no aproximada) y rehace la validación en el navegador. → [[L13 El visor - las pantallas]]

### El pronóstico (en la API)

`GET /inundacion/pronostico` consulta **Open-Meteo** con un punto interior de cada comuna (`ST_PointOnSurface`) y devuelve la lluvia de 7 días. Tiene caché de 30 minutos y, si Open-Meteo falla, devuelve el último con `vencido: true` ("mejor uno viejo, y avisado, que nada").

## Pruébalo

```bash
docker exec -i terrafoco-motor python -m indicadores.inundacion --revisar   # ranking guardado
docker exec -i terrafoco-motor python -m indicadores.validar_inundacion     # las tres preguntas
docker exec -i terrafoco-motor python -m indicadores.recalibrar_inundacion  # el banco de pesos
```

API: `http://localhost:8000/inundacion/validacion`. Visor: `inundaciones.html` → tarjeta de validación y **Explorador de pesos** (pon peso a la pendiente y mira cómo cae el Spearman).

## Cómo decirlo en la presentación

> [!example] Versión corta
> "El índice de inundación mide susceptibilidad del terreno, no predice. Calculamos seis variables por celda de 30 metros y las sumamos con pesos. La primera versión, con pesos a priori, resultó peor que el azar al validarla contra 63 eventos históricos: la pendiente correlacionaba al revés. Probamos juegos de pesos declarados de antemano y quedaron acumulación de flujo y curvatura, mitad y mitad: 68 % de los eventos cae en las comunas de clase alta, frente a 52 % que daría el azar. El índice solo se marca calibrado si pasa ese criterio, y lo dice el programa, no una persona."

## Autoevaluación

> [!question]- ¿Por qué el índice se calcula por píxel y luego se promedia, y no al revés?
> Porque la curvatura media de una comuna es ≈ 0 (cóncavo y convexo se cancelan) y la acumulación media la dominan las laderas: promediadas, pierden la señal. Combinando por celda, la comuna hereda la señal de sus peores celdas.

> [!question]- ¿Por qué la acumulación de flujo se calcula sobre la región completa?
> Porque el agua que llega a una celda viene de toda la cuenca aguas arriba, que puede estar en otra comuna. Recortar antes dejaría fuera justo el agua que inunda.

> [!question]- ¿Para qué se recorta en los percentiles 2 y 98?
> Para que valores extremos del DEM (una pendiente de 443 %) no fijen el máximo y aplasten al resto del territorio contra cero.

> [!question]- ¿Por qué las clases son cuartiles y no cortes fijos?
> Las medias comunales calibradas caen entre 0,34 y 0,38; con cortes en 0,25/0,50/0,75 todo sería "Media". Los cuartiles dan clases relativas: "el cuarto más susceptible de la región".

> [!question]- ¿Por qué no basta con decir "68 % de los eventos cae en Alta o Muy alta"?
> Porque si muchas comunas son Alta, el azar ya da mucho. Hay que compararlo con el azar (17 de 33 = 52 %) y además medir si el índice ordena las comunas como los eventos (Spearman).

> [!question]- ¿Cuál es el criterio para marcar el índice como calibrado?
> Más del 50 % de los eventos en Alta o Muy alta, al menos 10 puntos sobre el azar y Spearman positivo (`pasa_criterio`). La tarea `--marcar-si-pasa` lo aplica tras cada recálculo.

> [!question]- ¿Por qué la pendiente quedó con peso cero si "obviamente" importa?
> A escala comunal correlaciona al revés con los eventos: la pendiente media la fija la cordillera, no el sector poblado junto al río. Además su información ya está en el TWI y la curvatura.

> [!question]- ¿Cómo se evitó el sobreajuste al recalibrar?
> Juegos de pesos declarados de antemano (no optimizados), comparación de formas de agregar, resultado sin 1982 y declaración de que la validación es en muestra.

> [!question]- ¿Cómo puede el visor recalcular el índice con otros pesos de forma exacta?
> Porque la media de una suma ponderada es la suma ponderada de las medias: con la media normalizada de cada variable por comuna (`variables.json`), el índice comunal de cualquier juego de pesos sale exacto.

Siguiente: [[L09 El motor - programador y teselas]]
