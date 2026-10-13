# Módulo 2 — Susceptibilidad a inundación

Cómo se construyó, cómo se validó y por qué los pesos finales no son los que
se propusieron. Sigue las fases de CRISP-DM en dos iteraciones. Todo lo que
aparece aquí se reproduce con los comandos del final.

---

## 1. Qué es y qué no es

Un **índice de susceptibilidad estática**: qué territorios reúnen condiciones
del terreno favorables para inundarse. No predice cuándo —eso es hidrología
con lluvia y queda fuera de alcance por diseño—. Se calcula **por píxel a
30 m** y se agrega por comuna.

No es aprendizaje supervisado. Se buscó una fuente de etiquetas
georreferenciadas de dónde se inundó y no existe pública para Chile.
SENAPRED no publica registro descargable; datos.gob.cl no tiene nada de
ONEMI sobre eventos; el dataset de emergencias agrícolas no tiene ni una
inundación en O'Higgins. Lo único estructurado es **DesInventar** (UNDRR,
alimentado por ONEMI): eventos por comuna y fecha, 1970–2014, sin
coordenadas. Con etiquetas a nivel comunal, la muestra son 33 comunas: sirve
para **validar**, no para entrenar. Ese hallazgo es el riesgo R4 del perfil,
confirmado con evidencia.

---

## 2. Las seis variables

| Variable | Fuente | Cómo se calcula | Sentido |
|---|---|---|---|
| Pendiente | NASADEM 30 m | Horn (1981), la misma de GDAL | inversa |
| Acumulación de flujo | NASADEM | D8 sobre el DEM acondicionado (pysheds); se guarda en log₁₀ | directa |
| Distancia a cauces | IDE Chile, red hídrica 1:25.000 | Euclidiana a cauces de orden Strahler ≥ 5 (ríos y esteros principales, 677 tramos de 9.107) | inversa |
| Índice topográfico de humedad (TWI) | NASADEM | ln(a / tan β) | directa |
| Curvatura | NASADEM | Zevenbergen & Thorne, la misma de ArcGIS; negativa en concavidades | inversa |
| Cobertura del suelo | Sentinel-2 | NDVI por píxel, nov-2024 a feb-2025 | inversa |

Las seis comparten rejilla: el DEM recortado al bbox de la región, leído de
`territorio.region`, con 5 km de margen. Se recorta porque la acumulación de
flujo de una celda depende de toda la cuenca aguas arriba, no de sus ocho
vecinas: no se puede derivar por comuna. La cobertura es lo único que llega
a 60 m y se remuestrea.

Cada variable se normaliza a 0–1 recortando a los percentiles 2 y 98 **sobre
el dominio donde las seis existen** —en la práctica, el territorio de las
comunas—. Calcularla sobre todo el bbox fue un error de la primera corrida:
la distancia a cauces llegaba a 29 km por celdas de Maule y la cordillera, y
todo el territorio real caía en una clase.

Las medias comunales van a `indicadores.variable_inundacion`, con la misma
disciplina que `indicadores.factor` y una diferencia deliberada: sin
restricción de signo, porque la curvatura negativa es la señal.

---

## 3. Iteración 1 — pesos a priori

Los del prototipo: pendiente 24, acumulación 21, distancia 19, TWI 16,
curvatura 11, cobertura 9. Suma ponderada por píxel, media por comuna,
clases por intervalos fijos (0,25 / 0,50 / 0,75).

**Validación contra los 63 eventos de DesInventar con comuna:**

| Medida | Resultado |
|---|---|
| Eventos en comunas Alta o Muy alta | 59% |
| …pero comunas en Alta o Muy alta | 20 de 33 → el azar daría **61%** |
| Spearman índice vs. n° de eventos | **−0,16** |

El criterio declarado —"una proporción mayoritaria"— se cumplía en el papel
y **no era mejor que tirar una moneda**. El patrón del error era
sistemático: el secano costero (Marchigüe, Litueche, Pumanque) puntuaba alto
con cero eventos; San Fernando, Rengo, Santa Cruz y Chépica quedaban en Media
con 16 eventos entre las cuatro.

**Por variable**, Spearman de la media comunal con el n° de eventos:

| Variable | ρ | Signo esperado | Veredicto |
|---|---|---|---|
| Curvatura | −0,39 | negativo | coincide |
| Acumulación | +0,37 | positivo | coincide |
| Pendiente | +0,28 | negativo | **contraria** |
| Distancia a cauces | +0,12 | negativo | nula |
| Cobertura | +0,10 | negativo | nula |
| TWI | +0,03 | positivo | nula |

La variable con más peso correlacionaba al revés. Tiene explicación: a escala
comunal la pendiente media la fija el interior cordillerano, no el pueblo
junto al río. Rengo, San Fernando y Machalí son empinadas en promedio y se
inundan donde el río sale de la cordillera. Las dos que funcionan son las de
**concentración de agua**.

---

## 4. Iteración 2 — recalibración

Se probaron juegos de pesos **declarados de antemano**, no ajustados por
optimización: con 33 comunas, optimizar seis pesos contra 63 eventos daría
un ajuste perfecto y falso. Cada juego se midió con todos los eventos y
**sin 1982**, que concentra 31 de los 63 —un juego que solo acertara ese año
no valdría—.

| Pesos (pend / acum / dist / TWI / curv / cob) | ρ todos | ρ sin 1982 |
|---|---|---|
| a priori 24 / 21 / 19 / 16 / 11 / 9 | −0,16 | −0,17 |
| evidencia 5 / 30 / 19 / 16 / 25 / 5 | −0,10 | +0,04 |
| dominante 80/20 | +0,09 | +0,28 |
| dominante 90/10 | +0,34 | +0,39 |
| **solo acumulación y curvatura 0 / 50 / 0 / 0 / 50 / 0** | **+0,41** | **+0,46** |

Dos cosas que este banco dejó claras:

- **Rebalancear las seis no basta.** Las cuatro variables sin señal, sumando
  el 45% del peso, ahogan a las dos que sí la tienen. La tendencia es
  monótona: cuanto menos pesan, mejor ordena.
- **La señal sobrevive sin 1982** —mejora, incluso—. No es un artefacto de un
  solo evento.

También se probó cambiar el agregado comunal (percentil 90, fracción en
Alta) por si la media diluía. No mejoró: la media queda.

**Pesos finales: acumulación de flujo 50%, curvatura 50%.** La pendiente no
se pierde: está dentro del TWI y la curvatura es su segunda derivada; no era
información independiente. Las otras cuatro se siguen calculando y guardando
—son capas del módulo, y una región distinta puede necesitarlas— pero no
pesan en el índice.

**Clases por cuartiles**, no por intervalos fijos. Con los pesos calibrados
las medias comunales caen entre 0,34 y 0,38 y unos cortes en 0,25 / 0,50 /
0,75 meterían todo en "Media". A nivel de píxel cada clase es un cuarto del
territorio de la región; a nivel comunal, un cuarto de las comunas. Es una
clase **relativa** —"el cuarto más susceptible"— y así se declara. Los
cortes se guardan con el resultado, en `susceptibilidad.json` y en la
columna `metodo`.

**Validación de la iteración 2:**

| Medida | Iteración 1 | Iteración 2 |
|---|---|---|
| Eventos en Alta o Muy alta | 59% (azar 61%) | **68%** (azar 52%) |
| Mejora sobre el azar | −2 puntos | **+17 puntos** |
| Spearman | −0,16 | **+0,36 a +0,41** |

Cumple el criterio declarado y mejora al azar de forma clara. El índice se
marca `calibrado = TRUE`.

**Ranking resultante:** Machalí, Mostazal, Codegua, Rengo, Requínoa,
Doñihue, Coltauco en "Muy alta" —el frente cordillerano por donde el
Cachapoal y sus afluentes salen al valle—. El secano costero abajo. Es el
reverso exacto de la iteración 1, y es donde ocurrieron los eventos.

---

## 5. Límites que hay que decir

- **Es en muestra.** Los pesos se eligieron con los mismos eventos que los
  miden. El control sin 1982 mitiga, no elimina.
- **33 comunas.** Una diferencia de Spearman menor a 0,15 es ruido. El 0,36
  vs 0,41 según cómo se agregue el borde de cada comuna lo ilustra.
- **Los eventos vienen de prensa** (El Mercurio, sobre todo) y
  sobrerrepresentan las comunas pobladas. Rancagua tiene 8 eventos en parte
  porque es la capital.
- **1970–2014.** Los frontales de 2021, 2022 y junio de 2023 —los que
  golpearon O'Higgins recientemente— no están en ninguna base estructurada.
- **El ranking comunal es sensible.** Las medias difieren en milésimas. El
  producto robusto es el **mapa por píxel**: ahí la curvatura y la
  acumulación discriminan con claridad, y ahí está la focalización.

Una mejora posible con datos que existen: el Copernicus Emergency Management
Service publica polígonos de inundación delineados con Sentinel-1 en sus
activaciones. Para junio de 2023 en Chile central es probable que haya una.
Sería **un** evento georreferenciado: sirve para validar el ráster a 30 m,
no para entrenar.

---

## 6. Dentro de la comuna: lo que hace el visor

El índice comunal ordena comunas; la decisión se toma dentro de ellas. Al abrir
una comuna, el visor (`prototipo/inundaciones.html`, con `js/inundacion.js` y
`js/inundacion-calculo.js`) trabaja sobre la grilla de 30 m de esa comuna:

- **Umbral.** Qué celda se marca como riesgo: índice igual o mayor. Parte en el
  corte de "Alta" (0,35). El histograma muestra cuántas celdas hay a cada lado.
- **Ciudades y pueblos** (Límite Urbano Censal 2017, INE): el % del área de
  cada localidad que supera el umbral.
- **Superficie agrícola** (ESA WorldCover 10 m, 2021): la fracción de cultivo
  (clase 40) y de pradera (30) de cada celda de 30 m (`ingesta.worldcover`), y
  cuántas hectáreas quedan sobre el umbral. Es lo primero que se muestra: para
  INDAP la pregunta es qué superficie productiva queda en terreno susceptible.
  Los frutales densos pueden caer en cobertura arbórea.
- **Personas y viviendas** (Censo 2024, INE, `ingesta.poblacion_censal`):
  manzanas urbanas, manzanas de aldeas y entidades rurales —la región
  completa, ~982 mil personas—. Cada unidad reparte sus personas entre las
  celdas cuyo centro cae dentro; en el campo la entidad es grande (mediana ~200
  ha) y el reparto es aproximado. Se informa aparte cuántas viven en el campo.
  Si la tabla 2024 no está cargada, se usa el Censo 2017 urbano.
- **Servicios críticos** (OpenStreetMap): escuelas, jardines, centros de salud,
  bomberos y policía, evaluados en la celda donde cae cada punto.
- **Por qué esta celda.** Las seis variables normalizadas de la celda, su peso y
  su aporte; la suma es el índice. Salen de `inundacion_variables.pmtiles`
  (`motor/variables_inundacion.py`): el mismo dato con que se calculó.
- **Explorador de pesos.** Recalcula el índice con otros pesos y **rehace la
  validación** (eventos en Alta frente al azar, Spearman). Es exacto, no una
  aproximación: la media comunal de una suma ponderada es la suma ponderada de
  las medias, y `variables.json` guarda, por comuna, las sumas de cada variable
  por patrón de datos disponibles —el motor promedia sobre las celdas donde
  existen las variables con peso—. Con los pesos vigentes reproduce el índice
  de la base (±0,0001) y su ρ (+0,36). Con los a priori, ρ −0,16, como la
  iteración 1. Explorar no recalibra: el índice oficial sigue siendo el vigente.
- **Lluvia pronosticada** (Open-Meteo, `/inundacion/pronostico`): 7 días por
  comuna, en un punto representativo. **No es un pronóstico de inundación**:
  el índice dice dónde, la lluvia dice cuándo mirar.

Todo lo de esta sección se calcula en el navegador sobre la grilla abierta,
para que siga al umbral sin volver al servidor. La URL guarda comuna, umbral,
capas y pesos; el menú Exportar da un informe imprimible, CSV, imagen y las
**zonas sobre el umbral en KML (Google Earth) y GeoJSON (QGIS)**, con los
servicios críticos como puntos. Las celdas se juntan en rectángulos y, si una
comuna tiene demasiadas, en bloques de 60 o 90 m por mayoría (se declara en el
nombre del archivo).

**Mis predios** (`prototipo/predios.html`): el ejecutivo de área carga un CSV
con sus predios (grados o UTM) y ve la inundación, la erosión, la pendiente y
la cobertura de la celda de cada uno, y la pertinencia de su comuna. El
archivo se procesa en el navegador y no se guarda.

### Recálculo automático y calibración

`indicadores.inundacion` escribe cada recálculo con `calibrado = FALSE`. El
programador (migración 018) encadena después
`validar_inundacion --marcar-si-pasa`, que lo marca calibrado **solo si**
cumple el criterio declarado: más de la mitad de los eventos en Alta o Muy
alta, al menos 10 puntos sobre el azar y ρ positivo. Si no cumple, el índice
queda como no calibrado y la pantalla lo dice. Luego regenera las variables
para el visor (`variables_inundacion`) y los PNG.

---

## 7. Reproducir

```bash
# capas (una vez; ~5 min con el DEM ya preparado)
docker exec -i terrafoco-programador python -m ingesta.hidrologia
docker exec -i terrafoco-programador python -m ingesta.cauces
docker exec -i terrafoco-programador python -m ingesta.sentinel --raster-dir /datos/inundacion/ndvi
for v in pendiente curvatura; do
  docker exec -i terrafoco-programador python -m ingesta.zonal --raster /datos/srtm/dem_utm.tif --factor $v --guardar
done
for v in acumulacion twi distancia_cauces cobertura; do
  docker exec -i terrafoco-programador python -m ingesta.zonal --raster /datos/inundacion/$v.tif --factor $v --guardar
done

# eventos y validación
docker exec -i terrafoco-programador python -m ingesta.desinventar
docker exec -i terrafoco-programador python -m indicadores.recalibrar_inundacion   # el banco de pruebas

# índice, validación, mapa
docker exec -i terrafoco-programador python -m indicadores.inundacion
docker exec -i terrafoco-programador python -m indicadores.validar_inundacion --marcar-si-pasa
docker exec -i terrafoco-programador python -m mapa_inundacion --png
docker cp terrafoco-motor:/datos/inundacion/png/. prototipo/datos/inundacion/

# dentro de la comuna: localidades, exposición y variables por celda
docker exec -i terrafoco-motor python -m ingesta.localidades
docker exec -i terrafoco-motor python -m ingesta.manzanas
docker exec -i terrafoco-motor python -m ingesta.equipamiento
docker exec -i terrafoco-motor python -m variables_inundacion
docker cp terrafoco-motor:/datos/teselas/inundacion_variables.pmtiles prototipo/datos/teselas/
docker cp terrafoco-motor:/datos/inundacion/variables.json prototipo/datos/inundacion/
```

Los pesos viven en `motor/indicadores/inundacion.py` (`VARIABLES`) y su
espejo en `prototipo/js/data.js` (`GT.variablesInundacion`). Si cambia uno,
cambia el otro.
