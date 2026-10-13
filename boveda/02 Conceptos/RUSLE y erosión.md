# RUSLE y erosión

**RUSLE** (*Revised Universal Soil Loss Equation*) estima la pérdida de suelo por erosión hídrica:

$$A = R \times K \times LS \times C \times P$$

`A` en **toneladas por hectárea al año (t/ha/año)**. Implementación: [[Motor - indicadores#rusle.py]].

## Por qué se multiplican

Si un factor vale cero, no hay erosión: sin lluvia (R = 0) no se erosiona nada, por empinado que sea el terreno. Por eso en `indicadores.factor` un valor ≤ 0 se rechaza (al revés que en inundación, donde el signo es señal). → [[Migraciones#002_factores_por_comuna.sql]]

## Los cinco factores

| Factor | Qué mide | Fuente de datos | Ecuación (cita) | Módulo |
|---|---|---|---|---|
| **R** erosividad de la lluvia | Cuánta energía trae la lluvia | CR2MET v2.5 (grilla 0,05°, 2002–2021), climatología mensual | Renard & Freimund (1994) desde el Índice de Fournier Modificado (Arnoldus 1980). P < 850 mm: `R = 0,0483·P^1,61`; sobre 850, rama cuadrática | [[Motor - ingesta#cr2met.py]] |
| **K** erodabilidad del suelo | Qué tan fácil se desprende el suelo | SoilGrids 2.0 (ISRIC, 250 m): arcilla, limo, arena, carbono orgánico | Nomograma de Wischmeier & Smith (1978) en SI (Foster et al. 1981); carbono → materia orgánica × 1,724 (Van Bemmelen) | [[Motor - ingesta#soilgrids.py]] |
| **LS** longitud y pendiente | El relieve | NASADEM 30 m | Renard et al. (1997) con McCool et al. (1987, 1989); pendiente por Horn | [[Motor - indicadores#terreno.py]] · [[Motor - ingesta#zonal.py]] |
| **C** cobertura | Si algo protege el suelo | NDVI de Sentinel-2 (verano, mediana sin nubes) | Van der Knijff et al. (2000): `C = exp(−2·NDVI/(1−NDVI))` | [[Motor - ingesta#sentinel.py]] |
| **P** prácticas de conservación | Si alguien hace algo (curvas de nivel, terrazas) | Superficie bonificada SIRSD-S / superficie agrícola | `P = 1 − fracción·(1 − P_práctica)`, con P_práctica de la tabla de Wischmeier & Smith por pendiente | [[Motor - ingesta#practicas.py]] |

**C y P son los únicos que dependen de la acción humana**, y son exactamente sobre los que actúa el SIRSD-S. Ese es el fundamento del proyecto: la variable que se quiere evaluar ya vive dentro del modelo. → [[SIRSD-S e INDAP]]

## Clases de erosión (las de CIREN)

| Clase | t/ha/año |
|---|---|
| Ligera | < 10 |
| Moderada | 10 – 18 |
| Severa | 18 – 26 |
| Muy severa | 26 – 34 |
| Extrema | > 34 |

El umbral **18 t/ha/año** (Severa o superior) define la "superficie erosionada" que se usa como denominador de la inversión. → [[Índice de pertinencia]] · [[Motor - indicadores#superficie_erosionada.py]]

## Dos orígenes: CIREN y TerraFoco

| | CIREN (línea base) | TerraFoco (cálculo propio) |
|---|---|---|
| Qué es | Inventario Nacional de Erosión, ya calculado con RUSLE por polígono | RUSLE con factores actualizados (C del NDVI reciente, P del SIRSD-S) |
| Cómo entra | WFS del GeoNode de CIREN, ~50 cuencas, se guarda solo la media comunal | `calcular.py` junta los factores de `indicadores.factor` |
| Resolución | Polígonos de CIREN | Comuna (y mapa a 30 m con `mapa_erosion.py`) |
| Uso | Índice desde el día 1 y vara de validación (UC-06) | El aporte: muestra el efecto de C y P |

Ambos viven en `indicadores.erosion` con la columna `origen`. El visor permite alternarlos (selector de origen). → [[Motor - ingesta#ciren.py]] · [[Motor - raíz#calcular.py]]

## A 30 m dentro de la comuna

`mapa_erosion.py` calcula `A_píxel = R_comuna × K_comuna × P_comuna × LS_píxel × C_píxel`: R, K y P son constantes de la comuna; LS y C varían por celda y son los que mandan (una ladera desnuda erosiona veinte veces más que el fondo de valle). Importa porque el SIRSD-S **bonifica predios, no comunas**. → [[Motor - raíz#mapa_erosion.py]]

## Nada se inventa

Si a una comuna le falta un factor, **no se calcula**. Rellenar con el promedio regional daría un número que parece medido y no lo es. La única excepción es **P = 1**, que no es relleno: significa "sin prácticas registradas", un estado real. → [[Motor - raíz#calcular.py]]

## Validación contra CIREN

No se exige que los números coincidan (años, insumos y resoluciones distintos) sino que **ordenen igual** el territorio: Spearman sobre rangos. Sobre las 33 comunas ρ ≈ −0,04; dentro del [[Dominio de validez]] (27 comunas) ρ ≈ +0,67. → [[Motor - raíz#validar.py]] · [[Validación y Spearman]]

Ver también: [[Dominio de validez]] · [[Glosario]]
