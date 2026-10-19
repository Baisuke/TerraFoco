# L13 · El visor: las pantallas

> [!abstract] En una frase
> Nueve páginas con el mismo marco, cada una responde **una pregunta** de quien usa el sistema: el panel resume la región, el visor explora capas, pertinencia responde la pregunta del proyecto, la ficha baja a una comuna, inundaciones y ciudades son los módulos 2 y 3, mis predios baja el análisis al predio, fuentes administra los datos y ayuda explica.

Para cada pantalla: **la pregunta**, **qué muestra**, **con qué código** y **qué decir en la demo**.

---

## 1. Panel general — `index.html`

**Pregunta:** ¿cómo está la región, de un vistazo?

| Bloque | Qué muestra | De dónde |
|---|---|---|
| Resumen (4 cifras) | **16.347 km²** analizados · **4 de 33** comunas con erosión severa o superior (> 18) · **$19.854 MM** de incentivo 2012–2025 (97.569 ha, 22.449 planes) · índice regional **0,48** (Alineación parcial, 27 comunas) | `GT.comunas` tras `GT.hidratar()` |
| Mapa | Erosión por comuna del origen elegido | `GTMapaReal.crearConRespaldo(…, {capa: 'erosion'})` |
| Comunas por clase | CIREN frente al cálculo propio, por clase | `GTGrafico.comparacion` |
| Mayor brecha | Las 8 comunas con mayor índice (Navidad 1,00; Peumo 0,75; Coinco 0,72…) | `GTGrafico.barras` sobre `GT.comunasIndice()` |
| Estado de las fuentes | Las 6 fuentes cargadas más recientemente, con su estado | `fetch('/fuentes')` |

> [!example] En la demo
> "Este es el resumen: 33 comunas a 30 metros, cuatro con erosión severa en promedio, casi 20 mil millones de incentivo en 14 años. A la derecha, las comunas con mayor brecha: Navidad encabeza, la más erosionada y la que menos recibe por hectárea erosionada."

---

## 2. Visor cartográfico — `visor.html`

**Pregunta:** ¿qué hay en el territorio, capa por capa?

- **Capas** (`GT.capas`): erosión TerraFoco, erosión CIREN, NDVI, pendiente, inversión SIRSD-S (UF/ha), pertinencia; límites comunales. Opacidad.
- **Mapa base:** mapa o satelital (Sentinel-2); **pantalla completa**; **3D**.
- **Clic en una comuna:** zoom, detalle a 30 m de la capa activa (si tiene), ficha lateral de la comuna y botón **Modelo 3D**.
- **Modelo 3D** (`js/modelo3d.js`, con **three.js**): la comuna como un bloque sólido recortado por su límite, con la forma del relieve (teselas `relieve`) y el color de la pendiente (teselas `pendiente`). Se gira en todas direcciones, también por debajo, como una maqueta. three.js se carga recién al abrir el primer modelo.

> [!example] En la demo
> "En el visor cambio de capa: erosión, vegetación, pendiente, inversión, pertinencia. Hago clic en Pichilemu: como comuna parece tener poca erosión, pero a 30 metros aparecen laderas con cien veces más erosión que el terreno típico. Eso es lo que hay que focalizar, porque el programa bonifica predios, no comunas."

---

## 3. Índice de pertinencia — `pertinencia.html`

**Pregunta:** ¿la inversión llega donde el problema es más grave?

| Tarjeta | Qué muestra |
|---|---|
| Pregunta que responde este módulo | La pregunta y cómo se lee el índice |
| **Necesidad frente a inversión** | Dispersión: erosión (eje Y) contra UF por ha erosionada (eje X, logarítmico), cada comuna un punto con su categoría (`GTGrafico.dispersion`) |
| Brecha crítica / Cobertura adecuada o mayor | Las comunas de los extremos |
| Distribución por categoría | Cuántas comunas en cada una de las 5 categorías |
| **¿Cuánto costaría cerrar la brecha?** | Suma de las brechas en UF hasta la mediana regional (`brecha_uf`) |
| **¿Ha mejorado la focalización?** | Año por año, qué parte del incentivo fue a las comunas más erosionadas frente a su parte del problema (`GET /pertinencia/evolucion`, `GTGrafico.focalizacion`) |
| Ranking comunal | Tabla exportable a CSV (`GT_exportarTabla`) |

Controles de la barra: **origen** (CIREN o cálculo propio) y **fuera de dominio**.

> [!example] En la demo
> "Cada punto es una comuna: arriba las más erosionadas, a la derecha las que más reciben por hectárea erosionada. Lo ideal sería una diagonal. Navidad está arriba a la izquierda: mucha erosión, poca inversión. Las comunas más erosionadas tienen el 61 % de la superficie con erosión severa y recibieron cerca del 46 % del incentivo, sin mejora entre la primera y la segunda mitad del período."

---

## 4. Ficha de comuna — `comuna.html?id=6203`

**Pregunta:** ¿qué pasa en **esta** comuna y qué debería hacer INDAP?

| Tarjeta | Qué muestra | De dónde |
|---|---|---|
| Erosión estimada | CIREN y cálculo propio, clase | `GT.comunas` |
| Índice de pertinencia | Valor, categoría, brecha en UF | ídem |
| **Descomposición del modelo RUSLE** | R × K × LS × C × P = A con los factores **medidos**, su fuente y la mediana regional | `GT.factoresRusle()` → `GET /comunas/factores` |
| **Incentivo SIRSD-S por año** | La serie 2012–2025 (planes, agricultores, UF) | `GT.serieSirsd(c)` → `GET /comunas/{id}/sirsd` |
| El programa en la comuna / Lectura del cruce | Texto que interpreta los números | — |
| **Recomendación para INDAP** | Qué hacer, según la categoría y la brecha | `GT.recomendacion(c)` en `data.js` |
| La comuna en los otros módulos | Su inundación y calor | `GT.hidratarInundacion()` |

`GT.recomendacion` habla como quien distribuye el SIRSD-S y **solo usa lo que la pantalla ya muestra**: por ejemplo, para "Brecha crítica": *"Priorizar en el próximo concurso del SIRSD-S: tiene erosión alta y recibe de las inversiones más bajas por hectárea erosionada de la región. Llegar a la mediana regional requiere ≈ 17.486 UF."* Va acompañada de una salvedad (`GT.notaInversion`): la inversión incluye subprogramas de fertilidad, que no actúan sobre la erosión.

---

## 5. Inundaciones — `inundaciones.html`

**Pregunta:** ¿qué terreno es susceptible y qué queda encima?

Columna derecha con dos pestañas: **Riesgo actual** y **Simulación de lluvia** (→ [[L14 Las simulaciones]]).

### 5.1 Lo que se hace con una comuna abierta (`js/inundacion.js`)

1. **Umbral** con histograma del índice dentro de la comuna: la persona elige desde qué valor se marca "riesgo" (por defecto, el corte de "Alta").
2. **Qué queda encima**, siempre respecto del umbral:
   - personas y viviendas (urbanas y rurales, Censo 2024);
   - hectáreas de **cultivo** y **pradera** (ESA WorldCover);
   - **escuelas, salud y emergencias** (OpenStreetMap);
   - qué **sector de cada ciudad o pueblo** corre más riesgo.
3. **¿Por qué esta celda?** Clic dentro de la comuna → las seis variables de esa celda y cuánto aporta cada una a su índice (`inundacion_variables.pmtiles`).
4. **Explorador de pesos** (análisis técnico): cambiar los pesos recalcula el índice comunal **exacto** y su validación (Spearman, % de eventos en Alta) en el navegador; se puede pintar en el mapa como **escenario**.
5. **Lluvia pronosticada 7 días** por comuna (Open-Meteo vía la API).
6. **Eventos históricos** y su validación; **Cómo se calcula**.
7. **Exportar:** informe imprimible, CSV, imagen del mapa, **KML y GeoJSON** de las zonas marcadas; **enlace** que reabre la vista (`?comuna=&umbral=&pesos=…`).

### 5.2 Cómo se cruza la exposición (`js/inundacion-calculo.js`)

Todo en el navegador, sobre **la misma grilla de 30 m que está pintada**, para que siga al umbral sin volver al servidor:

```javascript
function rasterizarManzanas(geo, base) {
  // Cada unidad censal reparte sus personas por partes iguales entre las celdas
  // cuyo centro cae dentro del polígono (prueba par-impar: dentroDe).
  // Una manzana más chica que una celda deja todo en la celda de su centro.
  ...
  return { personas: Float32Array, viviendas: ..., rurales: ... };   // un valor por celda
}

function exposicion(pob, base, zonas, nLocalidades) {
  for (let i = 0; i < N; i++) {
    if (base.original[i] === 255) continue;          // fuera de la comuna
    const sobre = base.clases[i] !== 255;            // ¿pasa el umbral?
    r.personas += pob.personas[i];
    if (sobre) { r.personasSobre += pob.personas[i]; r.ruralesSobre += ...; }
    ...                                              // y por localidad
  }
}
```

Al mover el umbral, `detalle-comuna.js` recalcula `base.clases` y emite `detalle:umbral`; `inundacion.js` vuelve a llamar `exposicion` y `exposicionAgricola` y repinta. Y escribe la **lectura para INDAP**:

> *"Para INDAP: en Coinco, ≈ N ha de cultivo y M ha de pradera y ≈ K personas del campo quedan en terreno susceptible con este umbral. Son las superficies y familias a considerar primero en el plan de emergencias agrícolas…"*

> [!example] En la demo
> "Abro Coinco. Este control es el umbral: decido desde qué valor considero riesgo. Arriba se actualiza qué queda encima: hectáreas de cultivo, personas del campo, escuelas. Si hago clic en una celda, me explica por qué tiene ese valor. Y esto se descarga a Google Earth para llevarlo a terreno."

---

## 6. Ciudades — `urbano.html` (módulo 3, complementario)

**Pregunta:** ¿dónde hace más calor y dónde falta área verde?

- Cifras: **temperatura superficial media** 24,3 °C (ECOSTRESS, verano, día y noche), **diferencia térmica** 6 °C (Graneros 26,4 frente a Machalí 20,4), **área verde por habitante** 8,2 m² (estándar SIEDU: 10 m²), **84 de 125 zonas censales** bajo el estándar.
- Mapa de Rancagua y sus seis vecinas con tres pestañas: **Temperatura** (detalle a 70 m), **Áreas verdes** (parques de OSM y déficit por zona censal) y **Simular un parque** (→ [[L14 Las simulaciones]]).
- Déficit de área verde por comuna y zona censal (`motor/indicadores/area_verde.py`).

> [!info] Por qué "complementario"
> El objetivo del proyecto es la inversión en suelos agrícolas; el módulo 3 aplica la misma plataforma (ingesta, cálculo, visor) a un problema urbano, para mostrar que la arquitectura sirve para otros indicadores.

---

## 7. Mis predios — `predios.html`

**Pregunta del ejecutivo de INDAP:** ¿cuáles de **mis** predios tienen riesgo?

1. Arrastra un **CSV** con nombre y coordenadas (grados decimales o UTM 19S), o lo pega, o prueba con los **12 predios de ejemplo ficticios**.
2. `GTPredios.leerCsv` detecta el separador y la coma decimal; `utmAGrados` convierte UTM si hace falta.
3. Para cada punto, `evaluar`:

```javascript
function evaluar(p) {
  const comuna = comunaDe(p.lat, p.lon);                                  // punto en polígono
  return Promise.all([
    valorEn('datos/teselas/inundacion.pmtiles', p.lat, p.lon, 1000),     // índice de su celda
    valorEn('datos/teselas/pendiente.pmtiles', p.lat, p.lon, 1),         // pendiente
    rgbEn('datos/teselas/agricola.pmtiles', p.lat, p.lon),               // % cultivo y pradera
    erosionEn(p.lat, p.lon, comuna),                                      // erosión de la celda
  ]).then(...)   // + la categoría de pertinencia de su comuna
}
```

4. `observacion` arma la alerta: *"Revisar: terreno susceptible a inundación, erosión severa o mayor en su celda, pendiente fuerte"*.
5. Tabla, mapa con los predios coloreados, exportación **CSV** y **KML**.

> [!important] Privacidad por diseño
> **Todo ocurre en el navegador.** El archivo no se sube a ningún servidor ni se guarda: se cruza con las teselas que el visor ya descarga y se olvida al cerrar la pestaña. Así se puede usar con la planilla interna de la agencia sin sacar datos personales (Ley 19.628). → [[Privacidad y datos personales]]

---

## 8. Fuentes de datos — `fuentes.html`

**Pregunta:** ¿qué datos tiene el sistema, de cuándo y cómo están?

- Motor, fuentes conectadas, comunas con indicadores, procesos ejecutados.
- **Catálogo de fuentes** con la última carga real (de la bitácora) y el estado administrativo.
- **Editar el catálogo** (cambiar estado, URL, marcar carga): pide la **clave de administración** en un diálogo y la guarda en `sessionStorage` (**solo en esa pestaña**, se olvida al cerrarla; botón para olvidarla antes). Envía `PATCH /fuentes/{id}` con `Authorization: Bearer …`.
- **Últimas ejecuciones** (`GET /ejecuciones`) y gestión pendiente.

> [!warning] En la presentación
> Si muestras la edición, **no escribas la clave a la vista** del público ni la dejes en pantalla.

---

## 9. Ayuda y glosario — `ayuda.html`

Qué es TerraFoco, atajos de teclado, qué responde cada pantalla, glosario, **"lo que esta herramienta no dice"** (sus límites) y las licencias de los datos.

---

## 10. Piezas compartidas

| Módulo | Qué hace | Dónde se ve |
|---|---|---|
| `graficos.js` (`GTGrafico`) | Barras, comparación, dispersión, focalización y series en **SVG propio**, sin librerías; colores por **rol** de `PALETA` | Panel, pertinencia, ficha |
| `zonas.js` (`GTZonas`) | Convierte las celdas marcadas en **rectángulos** (corridas por fila y luego filas iguales: de cientos de miles de cuadrados a unos miles) y los exporta a **KML** (Google Earth) y **GeoJSON** (QGIS) | Detalle a 30 m, inundaciones |
| `shell.js` (`GT_exportarTabla`, `exportarCSV`) | CSV con notas de procedencia | Todas |
| `modelo3d.js` (`GTModelo3D`) | Maqueta 3D de una comuna con three.js | Visor |

## Pruébalo: el recorrido de demo completo

1. `index.html`: lee las cuatro cifras y el ranking.
2. `pertinencia.html`: pasa el cursor por Navidad en la dispersión; mira "¿Ha mejorado la focalización?".
3. `comuna.html?id=6205` (Navidad), o búscala en el buscador de la barra: descomposición RUSLE y recomendación.
4. `inundaciones.html`: abre Coinco, mueve el umbral, clic en una celda, descarga el KML.
5. `predios.html`: "Probar con predios de ejemplo".
6. `fuentes.html`: el catálogo y las últimas ejecuciones.

## Autoevaluación

> [!question]- ¿Qué pregunta responde cada pantalla?
> Panel: cómo está la región. Visor: qué hay en el territorio, capa por capa. Pertinencia: si la inversión llega donde está el problema. Ficha: qué pasa en una comuna y qué hacer. Inundaciones: qué terreno es susceptible y qué queda encima. Ciudades: dónde hace calor y falta verde. Mis predios: cuáles de mis predios tienen riesgo. Fuentes: qué datos hay y cómo están. Ayuda: cómo se usa y qué no dice.

> [!question]- ¿Cómo se calcula cuánta gente queda sobre el umbral?
> En el navegador: cada unidad censal reparte sus personas entre las celdas de 30 m cuyo centro cae dentro (`rasterizarManzanas`), y `exposicion` suma las personas de las celdas que pasan el umbral. Al mover el umbral se recalcula sin volver al servidor.

> [!question]- ¿Por qué Mis predios no envía nada al servidor?
> Por privacidad: las planillas de INDAP pueden tener datos personales. El CSV se lee y se cruza en el navegador con las teselas públicas y se olvida al cerrar la pestaña.

> [!question]- ¿De dónde sale la recomendación de la ficha?
> De `GT.recomendacion` en `data.js`: un texto según la categoría del índice y la brecha en UF, sin agregar juicios que los datos no respalden.

> [!question]- ¿Cómo se lleva una zona marcada a Google Earth?
> Botón de descarga del detalle o de inundaciones: `GTZonas` junta las celdas marcadas en rectángulos y escribe un KML (o GeoJSON para QGIS).

> [!question]- ¿Dónde se guarda la clave de administración en `fuentes.html`?
> En `sessionStorage`: solo en esa pestaña, se olvida al cerrarla. Nunca en el código ni en `localStorage`.

Siguiente: [[L14 Las simulaciones]]
