# Índice de pertinencia

La pregunta del proyecto convertida en un número por comuna: **¿la inversión llega donde el problema es más grave?**

$$\text{pertinencia} = \text{necesidad\_norm} - \text{inversión\_norm}$$

- **Positivo:** mucho problema y poca inversión (brecha).
- **Negativo:** poco problema y mucha inversión (sobre-cobertura).

Vive en la vista `indicadores.v_pertinencia` (migración 013) y lo sirve `GET /pertinencia`. → [[Migraciones#013_serie_sirsd_y_pertinencia_por_ha_erosionada.sql]] · [[API - rutas#pertinencia.py]]

## Necesidad

La pérdida de suelo de la comuna (t/ha/año) del origen elegido (CIREN o TerraFoco), normalizada **min–max** a 0–1. → [[RUSLE y erosión]]

## Inversión

El **incentivo** del SIRSD-S (la plata del Estado, no el aporte del agricultor) sumado **2012–2025**, **deflactado a UF** (UF promedio de cada año) y dividido por las **hectáreas con erosión Severa o superior** (> 18 t/ha/año, del cálculo propio a 30 m):

$$\text{inversión\_uf\_ha} = \frac{\sum \text{incentivo} / \text{UF}_{año}}{\text{ha erosionadas}}$$

Se normaliza en **logaritmo**: va de 0,3 a 34 UF/ha entre comunas (dos órdenes de magnitud); en escala lineal tres comunas aplastaban a las demás contra el cero.

### Por qué así (las tres decisiones de la migración 013)

1. **Período completo, no un año:** el programa opera por concursos; una comuna puede tener un año grande y el siguiente en cero por el ciclo.
2. **Deflactado a UF:** catorce años de pesos nominales subestiman los tempranos. Tabla `programas.uf_anual`.
3. **Por hectárea erosionada:** la necesidad es intensiva (t/ha) y la inversión extensiva (pesos); para compararlas, la inversión se lleva a "por hectárea con problema".

## Normalización por grupo

La ventana SQL es `PARTITION BY id_region, origen, en_dominio`: se normaliza por región, por origen y **separando las comunas fuera del [[Dominio de validez]]**.

## Escala en el visor

La API entrega −1..1. El visor lo lleva a 0..1 con `(p + 1) / 2` (`datos-api.js`) y lo clasifica:

| Índice (0–1) | Categoría |
|---|---|
| < 0,25 | Sobre-cobertura |
| 0,25 – 0,40 | Cobertura adecuada |
| 0,40 – 0,60 | Alineación parcial |
| 0,60 – 0,75 | Brecha alta |
| ≥ 0,75 | Brecha crítica |

→ [[Visor - scripts base#data.js]] (`GT.categoriasPertinencia`, `GT.recomendacion`)

## Brecha en UF y focalización

`api/focalizacion.py` agrega dos lecturas sin estadística:

- **Brecha en UF:** `max(0, mediana_uf_ha − uf_ha) × ha_erosión_severa`. Cuánto incentivo falta para que la comuna llegue a la **mediana** regional (no al máximo: San Vicente, 34 UF/ha, daría una meta impagable).
- **Focalización por año:** qué parte del incentivo de cada año fue a las comunas más erosionadas, frente a la parte que les tocaría según su superficie erosionada ("tienen el 61 % del problema y recibieron el 41 %"). Se acompaña del ρ de Spearman.

→ [[API - núcleo#focalizacion.py]] · pantalla `pertinencia.html` (tarjetas "¿Cuánto costaría cerrar la brecha?" y "¿Ha mejorado la focalización?")

## Limitación declarada

La serie del SIRSD-S cubre **todos los subprogramas** (también fertilidad, que no actúa sobre la erosión). El desglose por práctica requiere planillas de INDAP con datos personales que no se cargan. → [[SIRSD-S e INDAP]] · [[Privacidad y datos personales]]

Ver también: [[Preguntas de defensa]]
