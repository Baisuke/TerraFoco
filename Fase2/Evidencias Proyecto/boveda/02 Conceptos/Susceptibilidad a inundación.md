# Susceptibilidad a inundación

Un **índice de susceptibilidad estática**: qué terreno reúne condiciones del relieve favorables para que el agua se junte. **No predice cuándo** (eso es hidrología con lluvia, fuera de alcance por diseño). Documento completo: [[Documentos del proyecto#13-modulo-inundaciones.md]].

## Las seis variables

| Variable | Fuente | Cómo | Sentido | Peso final |
|---|---|---|---|---|
| Pendiente | NASADEM 30 m | Horn (1981) | inversa | 0 |
| **Acumulación de flujo** | NASADEM | D8 sobre el DEM acondicionado (pysheds), en log₁₀ | directa | **50** |
| Distancia a cauces | IDE Chile, red hídrica 1:25.000 | Euclidiana a cauces de orden Strahler ≥ 5 | inversa | 0 |
| TWI (índice topográfico de humedad) | NASADEM | ln(a / tan β) | directa | 0 |
| **Curvatura** | NASADEM | Zevenbergen & Thorne; negativa en concavidades | inversa | **50** |
| Cobertura | Sentinel-2 | NDVI de verano | inversa | 0 |

- **Directa:** más valor = más susceptible. **Inversa:** se voltea (1 − x) antes de sumar.
- Cada variable se normaliza a 0–1 recortando a los **percentiles 2 y 98** sobre el dominio donde existen (el territorio de las comunas).
- Las cuatro sin peso se siguen calculando y guardando: otra región puede necesitarlas.

Dónde se calculan: [[Motor - ingesta#hidrologia.py]] (pendiente, curvatura, acumulación, TWI), [[Motor - ingesta#cauces.py]] (distancia), [[Motor - ingesta#sentinel.py]] (NDVI); la combinación en [[Motor - indicadores#inundacion.py]].

## Por píxel primero, por comuna después

Se combina **por celda de 30 m** y recién después se promedia por comuna. Al revés no funciona: la curvatura media de 300.000 celdas es ≈ 0 (lo cóncavo y lo convexo se cancelan) y la acumulación media la dominan las laderas. Combinando primero, la comuna hereda la señal.

## Clases por cuartiles

Con los pesos calibrados las medias comunales caen entre 0,34 y 0,38; cortes fijos (0,25/0,50/0,75) meterían todo en "Media". Por eso las clases son **cuartiles regionales**: cada clase es un cuarto del territorio de la región (a nivel de píxel) o un cuarto de las comunas. Es una clase **relativa** —"el cuarto más susceptible"— y así se declara.

Cortes de píxel vigentes: **0,229 / 0,349 / 0,484** → Baja · Media · Alta · Muy alta. Se guardan con el resultado en `susceptibilidad.json` y en la columna `metodo`. → [[Migraciones#011_trazabilidad_indice_inundacion.sql]]

## Cómo se llegó a los pesos (CRISP-DM, dos iteraciones)

1. **Iteración 1 (pesos a priori 24/21/19/16/11/9):** 59 % de los eventos en Alta/Muy alta, pero el azar daba 61 %; Spearman **−0,16**. Peor que una moneda. La pendiente (el peso mayor) correlacionaba **al revés**: a escala comunal la fija la cordillera, no el pueblo junto al río.
2. **Iteración 2 (recalibración):** juegos de pesos **declarados de antemano**, no optimizados (con 33 comunas, optimizar seis pesos daría un ajuste perfecto y falso). Solo acumulación + curvatura 50/50: ρ +0,41 (y +0,46 sin 1982, año que concentra 31 de 63 eventos). → [[Motor - indicadores#recalibrar_inundacion.py]]

Resultado vigente → [[Validación y Spearman]].

## En el visor (inundaciones.html)

- **Umbral:** la persona elige desde qué valor del índice se marca "riesgo", con el histograma de la comuna. Todo lo demás sigue a ese umbral.
- **¿Por qué esta celda?** Clic en el mapa → las seis variables de esa celda y cuánto aporta cada una (lee `inundacion_variables.pmtiles`).
- **Explorador de pesos:** recalcula el índice comunal y su validación para cualquier juego de pesos, **exacto** (no aproximado): la media de una suma ponderada es la suma ponderada de las medias. → [[Visor - mapas y módulos#inundacion-calculo.js]] · [[Motor - raíz#variables_inundacion.py]]
- **Exposición:** personas, hectáreas de cultivo y pradera, y servicios sobre el umbral. → [[Exposición]]
- **Pronóstico de lluvia** a 7 días por comuna (Open-Meteo, vía la API con caché de 30 min). → [[API - rutas#inundacion.py]]
- **Exportar:** informe imprimible, CSV, imagen, KML y GeoJSON de las zonas marcadas. → [[Visor - mapas y módulos#zonas.js]]

## Simulación de lluvia

Pestaña **Simulación de lluvia** de `inundaciones.html`: se elige cuánto llueve (mm), en cuánto tiempo (1 h a 7 días), cómo cae (pareja, chubascos, concentrada), cómo estaba el suelo (seco, normal, saturado) y, en opciones, el tipo de suelo, el drenaje y la lámina. Hay escenarios armados (moderada, temporal, sistema frontal, tormenta, extremo) y el **pronóstico de esta semana** de la comuna. Una nube llueve sobre la comuna y el agua avanza y retrocede en el mapa hora a hora; las cifras siguen a la animación y se exportan a CSV.

Es un **modelo de escenario**, no hidráulico:
1. **Cuánta escurre** — Número de Curva (USDA-NRCS, 1986, TR-55) por celda según cultivo, pradera, ciudad y vegetación, corregido por humedad previa (Chow et al., 1988) y pendiente (Williams, 1995).
2. **Cuánta se queda** — la red de drenaje la evacúa como un **embalse lineal** (Nash, 1957) con constante k de 6, 24 o 72 h. Así entra la intensidad: concentrada anega más que repartida.
3. **Dónde se junta** — el volumen retenido cubre las celdas de **mayor a menor índice calibrado**, con una lámina media (0,5 m).

No simula la crecida de los ríos que vienen de la cordillera, ni velocidades ni obras. → [[Visor - mapas y módulos#simulacion-lluvia.js]] · [[Documentos del proyecto#13-modulo-inundaciones.md]]

## Límites que se declaran

- Susceptibilidad estática, no amenaza ni probabilidad.
- Eventos de prensa (DesInventar): sobrerrepresentan comunas pobladas.
- 33 comunas: un ρ de ±0,35 es **sugerente, no concluyente**.
- Clases relativas a la región.

Ver también: [[Exposición]] · [[Validación y Spearman]]
