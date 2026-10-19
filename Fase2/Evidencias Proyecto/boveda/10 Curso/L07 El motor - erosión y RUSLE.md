# L07 · El motor: erosión y RUSLE

> [!abstract] En una frase
> Cinco ingestas calculan **R, K, LS, C y P** por comuna desde cinco fuentes distintas y los guardan por separado; `calcular.py` los multiplica **solo si están los cinco**, marca fuera del dominio las comunas con erosividad > 2.000, y `validar.py` comprueba con Spearman que el resultado **ordena las comunas como CIREN**.

## 1. La ecuación

$$A = R \times K \times LS \times C \times P \quad [\text{t/ha/año}]$$

**Se multiplican, no se suman:** si uno vale cero, la erosión es cero. Sin lluvia no hay erosión, por empinado que sea el terreno. Por lo mismo, la base y el código **prohíben** factores en cero.

Todo el modelo vive en `motor/indicadores/rusle.py`, y **ninguna fórmula es propia**: cada función cita su paper en el docstring ("en una tesis un coeficiente sin procedencia no se puede defender").

```python
@dataclass
class Factores:
    R: float; K: float; LS: float; C: float; P: float

    def perdida(self):
        """A = R x K x LS x C x P"""
        fuera = self.validar()          # ¿algún factor fuera de rango plausible?
        if fuera:
            raise ValueError("Factores fuera de rango: " + "; ".join(fuera))
        return self.R * self.K * self.LS * self.C * self.P
```

### Rangos plausibles: la alarma de unidades

```python
RANGOS = {
    "R":  (200.0, 8000.0),    # MJ·mm/(ha·h·año)
    "K":  (0.005, 0.070),     # t·ha·h/(ha·MJ·mm)
    "LS": (0.0, 25.0),
    "C":  (0.0, 1.0),         # 1 = suelo desnudo
    "P":  (0.0, 1.0),         # 1 = sin prácticas
}
```

> [!tip] Por qué existen
> "Un valor fuera de rango casi siempre significa un error de unidades." Es el error más caro: **no falla**, solo entrega un número equivocado. Un K sin el factor de conversión a unidades SI sale 7,6 veces más grande; un NDVI en escala 0–10.000 en vez de 0–1 da un C absurdo. El rango lo atrapa.

### Clases de erosión (las de CIREN)

```python
CLASES = [(10.0, "Ligera"), (18.0, "Moderada"), (26.0, "Severa"),
          (34.0, "Muy severa"), (float("inf"), "Extrema")]
```

"Severa o superior" es **> 18 t/ha/año**: el umbral que usa el denominador del índice.

---

## 2. Los cinco factores, uno por uno

Para cada uno: qué es, la fórmula, de dónde sale el dato y **Litueche** como ejemplo.

### R · Erosividad de la lluvia

**Qué es:** no cuánto llueve, sino la **energía** con que la gota golpea el suelo. Una tormenta corta e intensa erosiona más que una llovizna de todo el día.

**Fórmula** (Renard & Freimund, 1994), con P = lluvia anual en mm:

```python
if p < 850.0:
    return 0.0483 * (p ** 1.610)
return 587.8 - 1.219 * p + 0.004105 * p * p
```

**Dato:** CR2MET v2.5 (grilla de lluvia diaria de Chile, del Centro de Ciencia del Clima y la Resiliencia). `motor/ingesta/cr2met.py` abre el `.zip` **un mes a la vez** (744 archivos NetCDF de ~21 MB), recorta a la región, suma los días, promedia por comuna y arma la **climatología 2002–2021** (el promedio de cada mes). Una climatología, no un año: un año seco daría una erosividad artificialmente baja.

**Litueche:** 500,5 mm/año → $R = 0{,}0483 \times 500{,}5^{1{,}61} \approx$ **1.071,4**.

> [!info] Dos métodos y por qué se usa el "anual"
> Existe también el método de **Fournier** (que captura cuán concentrada está la lluvia en el año). En el clima mediterráneo de Chile central, con la lluvia en cuatro meses, el índice de Fournier supera 100 y la rama cuadrática de la ecuación se dispara fuera de su tramo de calibración. Por eso el método por defecto es el anual, más conservador; tener los dos permite un **análisis de sensibilidad** (`--metodo fournier`).

### K · Erodabilidad del suelo

**Qué es:** qué tan fácil se desarma ese suelo. Depende de la textura (limo, arena, arcilla) y de la materia orgánica.

**Fórmula** (nomograma de Wischmeier & Smith, 1978, convertida a SI por Foster et al., 1981):

```python
mo = min(float(materia_organica_pct or 0.0), 4.0)          # satura en 4 %
M = (limo_pct + arena_muy_fina_pct) * (100.0 - arcilla_pct)
k_ingles = (2.1e-4 * (M ** 1.14) * (12.0 - mo)
            + 3.25 * (s - 2)          # estructura del suelo (1 a 4)
            + 2.5 * (p - 3)) / 100.0  # permeabilidad (1 a 6)
return max(0.0, k_ingles * A_SI)      # A_SI = 0,1317: a unidades SI
```

**Dato:** SoilGrids 2.0 (ISRIC), que entrega textura y **carbono** orgánico a 250 m para todo el mundo. `motor/ingesta/soilgrids.py` consulta una malla de puntos dentro de cada comuna (no descarga el ráster: para un promedio comunal da lo mismo). Dos conversiones que hay que saber:

1. Carbono orgánico → materia orgánica con el factor de **Van Bemmelen (1,724)**.
2. La ecuación pide **arena muy fina**, que SoilGrids no separa: se toma el **15 %** de la arena total (conservador: sobreestimarla inflaría K).

**Por qué no un dato chileno:** las capas de IDE MINAGRI para O'Higgins solo traen la clase de capacidad de uso (sin textura) y la que trae materia orgánica cubre solo la Región Metropolitana. Se declara como limitación.

**Litueche:** limo 26,6 %, arena 55,7 %, arcilla 17,8 %, materia orgánica 12,2 % (saturada a 4 %) → **K = 0,02694**.

### LS · Largo y pendiente de la ladera

**Qué es:** cuánto acelera el agua cuesta abajo. Más pendiente y laderas más largas, más erosión.

**Cálculo en tres pasos:**

1. **Pendiente por celda** con el método de **Horn (1981)**, el mismo de GDAL y ArcGIS (`motor/indicadores/terreno.py::pendiente_horn`):

   ```python
   # Ventana 3x3 alrededor de cada celda:  a b c / d e f / g h i
   dz_dx = ((c + 2*f + i) - (a + 2*d + g)) / (8.0 * dx)   # cambio este-oeste
   dz_dy = ((g + 2*h + i) - (a + 2*b + c)) / (8.0 * dy)   # cambio norte-sur
   return np.hypot(dz_dx, dz_dy) * 100.0                   # pendiente en %
   ```

   Pondera las ocho vecinas (doble peso a las cuatro ortogonales) y así suaviza el ruido del DEM. Está escrito con numpy sobre **todo el arreglo a la vez**: las variables `a`, `b`, `c`… son la grilla entera corrida una celda.

2. **LS por celda** (Renard et al., 1997; McCool et al., 1987), en `ls_desde_pendiente`:

   ```python
   theta = np.arctan(s_pct / 100.0)
   S = np.where(s_pct < 9.0, 10.8 * sen + 0.03,     # bajo 9 %: erosión laminar
                              16.8 * sen - 0.50)     # sobre 9 %: flujo concentrado
   L = (lam / 22.13) ** m                            # 22,13 m = la parcela patrón
   ```

   Sin acumulación de flujo, la longitud de ladera es la de la parcela patrón: **L ≈ 1**. Es una simplificación habitual a esta resolución y **se declara** (subestima laderas largas y uniformes).

3. **Media por comuna** (`motor/ingesta/zonal.py`), pero **promediando el LS, no la pendiente**: la relación no es lineal, y promediar la pendiente primero subestima el factor en terreno variado.

**Dato:** NASADEM a 30 m (NASA Earthdata, `motor/ingesta/srtm.py`), reproyectado a UTM 19S (`dem_utm.tif`).

**Litueche:** 653.403 celdas → **LS = 1,691**.

### C · Cobertura vegetal

**Qué es:** si hay algo protegiendo el suelo del golpe de la gota. 1 = suelo desnudo; cerca de 0 = vegetación densa.

**Fórmula** (Van der Knijff et al., 2000):

```python
def factor_C(ndvi, alfa=2.0, beta=1.0):
    if ndvi <= 0:        return 1.0           # agua, nube, nieve: sin protección
    if ndvi >= beta:     return 0.0
    return math.exp(-alfa * ndvi / (beta - ndvi))
```

Es **exponencial a propósito**: los primeros tramos de vegetación protegen mucho más que los últimos.

**Dato:** Sentinel-2 (Copernicus). `motor/ingesta/sentinel.py` usa la **Process API** de Sentinel Hub: el NDVI se calcula **en el servidor** y llega una imagen recortada a la comuna de unos cientos de KB, en vez de gigabytes de escenas. Decisiones:

- **Nubes fuera** con la máscara de escena (SCL). Una nube tiene NDVI bajo y se confundiría con suelo desnudo, justo el error que más importa.
- **Mediana, no promedio**: una nube que sobrevive al filtro mueve el promedio pero casi no la mediana.
- **Mosaico de verano** (nov–feb), el de menor nubosidad por píxel.

**Litueche:** NDVI mediano 0,387 → $C = e^{-2 \cdot 0{,}387 / 0{,}613} \approx$ **0,2825**.

> [!info] Por qué no la Statistical API
> Sería más directa, pero en esta cuenta respondía `{"data": []}` con estado 200 para consultas que sí tenían escenas: un **fallo silencioso**. Se verificó contra el catálogo y se cambió a la Process API. Está contado en el docstring.

### P · Prácticas de conservación (aquí entra la política pública)

**Qué es:** si alguien está haciendo algo activamente (curvas de nivel, terrazas, obras). 1 = nada.

**Fórmula** (Wischmeier & Smith, 1978), ponderada por la fracción intervenida:

```python
fraccion = min(1.0, intervenida / superficie_agricola_ha)   # qué parte está bonificada
p_practica = p_curvas_nivel(pendiente_pct)                  # 0,5 a 0,95 según pendiente
return 1.0 - fraccion * (1.0 - p_practica)
```

- Fracción 0 → P = 1 (nada cambia). Fracción 1 → P = el valor de la práctica.
- **Superficie agrícola, no la total**: dividir por toda la comuna (con cordillera y ciudad) diluiría la fracción y P daría ≈ 1 en todas partes.

**Dato:** `motor/ingesta/practicas.py` toma las hectáreas bonificadas de `programas.ejecucion` (IDE MINAGRI), la superficie agrícola de la máscara de CIREN y la pendiente media. **Tres supuestos declarados:** la superficie agrícola ≈ lo que CIREN evalúa; toda la superficie bonificada se atribuye a P (sobreestima su efecto: el servicio no informa la práctica); se usa la tabla de curvas de nivel.

**Litueche:** 19,3 ha bonificadas de 58.806 agrícolas (fracción 0,0003) → **P = 0,9999**.

> [!important] Lo que dice el número de P
> P casi no baja en ninguna comuna porque la superficie intervenida es mínima frente a la agrícola. Eso **no es un error**: es exactamente lo que el proyecto quiere mostrar. Cuando el programa crezca, P baja y la erosión con él: ese descenso es el efecto medible del SIRSD-S.

### El producto, para Litueche

| R | K | LS | C | P | **A** |
|---|---|---|---|---|---|
| 1.071,41 | 0,02694 | 1,691 | 0,2825 | 0,9999 | **13,79 t/ha/año** (Moderada) |

CIREN: 13,65. Diferencia: 1 %.

---

## 3. Del ráster al número por comuna: `zonal.py`

`motor/ingesta/zonal.py` es la pieza que convierte un ráster regional (millones de celdas) en un número por comuna. Tres decisiones que vale la pena contar:

1. **Rechaza rásteres en grados** (`tamano_de_celda`): la pendiente saldría cinco órdenes de magnitud equivocada sin ningún error.
2. **Una ventana por comuna, con margen de 3 celdas.** Leer el DEM regional entero agotaba la memoria del contenedor (el proceso moría sin rastro, *exit 137*). Cada comuna se lee con un poco de borde para que la pendiente de las celdas del límite tenga vecinas reales; después se recorta al polígono.
3. **Máscara de CIREN:** el promedio se calcula solo sobre la superficie que CIREN evalúa como suelo. Sin ella, una comuna cordillerana se promediaba sobre roca y nieve (Machalí daba 733 t/ha contra 1,71 de CIREN). Y **cobertura mínima del 30 %**: si la máscara deja muy pocas celdas, el valor no se guarda ("un LS calculado sobre 98 de 300.000 celdas describe una ladera, no un territorio").

Además, el nodata (relleno −32768) se quita **antes** de calcular la pendiente: metido en la cuenta, crea un "acantilado" falso que contamina las ocho vecinas.

## 4. El almacén de factores: `almacen.py`

```python
RUSLE = Almacen("indicadores.factor", "factor", ("R","K","LS","C","P"), exige_positivo=True)
INUNDACION = Almacen("indicadores.variable_inundacion", "variable", (...6...), exige_positivo=False)
```

Una sola clase, dos tablas. `guardar` inserta (nunca actualiza) y **devuelve los descartes** (nulos o no positivos) para que se informen. `leer` trae el **último valor de cada factor por comuna** con el molde `DISTINCT ON`. La diferencia entre ambos almacenes es el signo: en RUSLE un cero anula todo; en inundación la curvatura **negativa** es justo la señal (concavidades).

## 5. `calcular.py`: juntar sin inventar

```python
def reunir(id_region, por_defecto):
    datos = leer(id_region)                    # {id_comuna: {"R":…, "K":…, …}}
    listas, faltantes = {}, {}
    for id_comuna, d in datos.items():
        completo, falta = {}, []
        for f in FACTORES:
            if f in d:                                         completo[f] = d[f]
            elif f in por_defecto and por_defecto[f] is not None: completo[f] = por_defecto[f]
            else:                                              falta.append(f)
        if falta: faltantes[id_comuna] = falta     # se informa, no se calcula
        else:     listas[id_comuna] = completo
    return listas, faltantes
```

```python
def calcular(listas, r_maximo=R_MAXIMO_CONFIABLE):
    for id_comuna, f in listas.items():
        factores = Factores(R=f["R"], K=f["K"], LS=f["LS"], C=f["C"], P=f["P"])
        if factores.validar(): rechazadas[...]; continue        # fuera de rango
        a = factores.perdida()
        resultados[id_comuna] = {"perdida": round(a, 2), "clase": clasificar(a),
                                 "en_dominio": f["R"] <= r_maximo}   # ← el dominio
```

- **Nada se inventa:** sin los cinco factores, la comuna no se calcula.
- **La única excepción es P = 1** por defecto, y no es un relleno: significa "sin prácticas registradas", un estado real.
- Se pueden dar valores explícitos (`--r 1200 --k 0.035`), y quedan guardados en la fila para auditarlos.
- Escribe con `origen='TerraFoco'` dentro de una `Bitacora`.

## 6. El dominio de validez

```python
R_MAXIMO_CONFIABLE = 2000.0   # MJ·mm/(ha·h·año)
```

La ecuación de Renard & Freimund se ajustó con estaciones **bajo los 1.000 mm anuales**; en O'Higgins eso corresponde a R ≈ 2.000. En las seis comunas precordilleranas (Machalí, San Fernando, Mostazal, Requínoa, Codegua, Rengo) llueve más, la rama cuadrática crece demasiado y el modelo **sobreestima entre 20 y 300 veces**. Comparten un perfil: R > 2.200 y LS > 4.

> [!important] Se marcan, no se ocultan
> Se calculan, se guardan con `en_dominio = false` y se ven en el visor con aviso. Un modelo con su dominio de validez declarado vale más que uno que aparenta funcionar en todas partes. → [[Dominio de validez]]

## 7. `validar.py`: ¿ordena igual que CIREN?

**Por qué no comparar valores:** CIREN y el cálculo propio usan años, insumos y resoluciones distintos; exigir que coincidan no tiene sentido. Se exige que **ordenen igual** el territorio → **Spearman** (correlación de rangos).

```python
def rangos(x):                        # posiciones, con empates promediados
    ...
def spearman(a, b):                   # Pearson sobre los rangos
    ra, rb = rangos(a), rangos(b)
    ra = ra - ra.mean(); rb = rb - rb.mean()
    return float((ra * rb).sum() / np.sqrt((ra**2).sum() * (rb**2).sum()))

def significancia(a, b, repeticiones, semilla=20260921):
    """Probabilidad de obtener una correlación así de fuerte por azar."""
    obs = abs(spearman(a, b))
    veces = sum(1 for _ in range(repeticiones)
                if abs(spearman(a, az.permutation(b))) >= obs)
    return (veces + 1) / (repeticiones + 1)
```

**Permutaciones:** se baraja uno de los vectores 20.000 veces y se cuenta cuántas veces el azar iguala lo observado. No hay que suponer normalidad (incómodo con 27 comunas). Sin scipy: son treinta líneas.

**Resultados:**

| Conjunto | ρ |
|---|---|
| Las 33 comunas | ≈ **−0,04** (ninguna relación: algo hay que explicar) |
| Las 27 dentro del dominio (R ≤ 2.000) | ≈ **+0,67** (difícil de atribuir al azar) |

> [!warning] La trampa que se evitó
> Barrer umbrales y quedarse con el que da la mejor correlación sería hacer trampa. El umbral sale de un **argumento físico previo** (la calibración de la ecuación), y el programa **imprime el barrido completo** (1.200 a 3.000) para que se vea que el resultado se sostiene entre 1.200 y 2.200 y se derrumba sobre 2.500. No depende de haber acertado un número exacto.

## 8. El mapa a 30 m: `mapa_erosion.py`

El promedio comunal esconde lo que hay que focalizar (Pichilemu: mediana 0,13 t/ha/año, decil superior 14,4). `mapa_erosion.py` calcula la erosión **por píxel**:

$$A_{píxel} = R_{comuna} \times K_{comuna} \times P_{comuna} \times LS_{píxel} \times C_{píxel}$$

R, K y P son de la comuna (clima, suelo e intervención se estiman a esa escala); **LS y C varían dentro** y son los que mandan. Produce un GeoTIFF por comuna (`erosion_<id>.tif`), un PNG coloreado para el visor y, con `teselas.py`, la pirámide `erosion.pmtiles`. De esos rásteres sale también `indicadores.superficie_erosionada` (hectáreas > 18 t/ha/año). → [[L09 El motor - programador y teselas]]

## Pruébalo

```bash
docker exec -i terrafoco-motor python -m calcular --revisar     # cobertura de cada factor
docker exec -i terrafoco-motor python -m calcular --simular     # la tabla R K LS C P A por comuna
docker exec -i terrafoco-motor python -m validar                # Spearman, barrido y permutaciones
docker exec -i terrafoco-programador python -m pytest tests/test_factores.py tests/test_rusle.py -q
```

En el visor: `comuna.html?id=6203` → tarjeta **Descomposición del modelo RUSLE**: los cinco factores medidos, su fuente y cómo se comparan con la mediana regional.

## Cómo decirlo en la presentación

> [!example] Versión corta
> "Cada factor sale de una fuente distinta: la lluvia de CR2MET, el suelo de SoilGrids, el relieve de NASADEM, la vegetación de Sentinel-2 y las prácticas del propio SIRSD-S. Cada uno se guarda por separado con su procedencia, y la erosión se calcula solo si están los cinco. Validamos contra CIREN con Spearman, porque no esperamos los mismos números sino el mismo orden: 0,67 en las 27 comunas donde la ecuación de lluvia está calibrada. Las seis de precordillera quedan marcadas fuera del dominio, y el umbral sale de la física, no de buscar la mejor correlación."

## Autoevaluación

> [!question]- ¿Por qué los factores de RUSLE se multiplican y qué consecuencia tiene en el código?
> Porque la erosión necesita todos los agentes a la vez (sin lluvia no hay erosión). Consecuencia: un factor en cero anula todo, así que la base (CHECK > 0) y el almacén descartan valores no positivos.

> [!question]- ¿Cuáles factores dependen de la acción humana y por qué importa?
> C (cobertura) y P (prácticas). Son los que modifican las prácticas del SIRSD-S: la variable evaluada está dentro del modelo físico.

> [!question]- ¿Para qué sirve `RANGOS` en `rusle.py`?
> Para detectar errores de unidades: un factor fuera del rango plausible casi siempre es un error de escala que, si no, pasaría sin fallar. `Factores.validar()` lo revisa antes de calcular.

> [!question]- ¿Por qué se promedia el LS por comuna y no la pendiente?
> Porque la relación pendiente–LS no es lineal; promediar la pendiente primero subestima el LS en terreno heterogéneo.

> [!question]- ¿Por qué `zonal.py` lee una ventana por comuna y no el ráster completo?
> El DEM regional a 30 m tiene decenas de millones de celdas y el cálculo de pendiente crea copias intermedias: leerlo entero agotaba la memoria del contenedor. Por comuna, con un margen de 3 celdas, el resultado es idéntico y la memoria queda acotada.

> [!question]- ¿Qué es la máscara de CIREN y qué problema resolvió?
> Un ráster que marca la superficie que CIREN evalúa como suelo (sin roca, agua ni ciudad). Sin ella, las comunas cordilleranas se promediaban sobre roca y nieve (Machalí 733 t/ha contra 1,71 de CIREN).

> [!question]- ¿Qué hace `calcular.py` si a una comuna le falta K?
> No la calcula y la informa entre las "comunas sin calcular" con el factor que le falta. No se rellena con promedios. Solo P tiene un valor por defecto (1), que significa "sin prácticas registradas".

> [!question]- ¿De dónde sale el umbral R ≤ 2.000 y cómo se demuestra que no es acomodado?
> De la calibración de la ecuación de Renard y Freimund (estaciones bajo 1.000 mm, que en O'Higgins equivale a R ≈ 2.000). `validar.py` imprime el barrido completo de umbrales y muestra que la correlación se sostiene entre 1.200 y 2.200: no depende de un valor exacto.

> [!question]- ¿Qué es la prueba por permutaciones?
> Barajar al azar uno de los vectores miles de veces y contar qué fracción de las veces el azar logra una correlación igual o mayor que la observada. Esa fracción es el valor p; no requiere suponer distribución normal.

Siguiente: [[L08 El motor - inundaciones]]
