# L14 · Las simulaciones

> [!abstract] En una frase
> Dos herramientas de **escenario** que corren enteras en el navegador: la **simulación de lluvia** calcula hora a hora cuánta agua escurre, cuánta retiene la comuna y qué celdas cubre (en el orden del índice calibrado); la **simulación de un parque** mide la isla fresca de los parques reales de la ciudad y la aplica a uno nuevo según tamaño, tipo y distancia.

> [!warning] Lo primero que hay que decir de ambas
> **Son escenarios, no predicciones.** Sirven para comparar ("con 150 mm en dos días sobre suelo saturado, esto quedaría bajo el agua"), no para anunciar qué va a pasar. Cada supuesto se declara en pantalla.

---

# Parte A · Simulación de lluvia (`inundaciones.html`, pestaña "Simulación de lluvia")

## 1. Qué hace la persona

1. Abre una comuna en el mapa.
2. Elige un **escenario** (lluvia moderada 30 mm/24 h, temporal 80 mm/24 h, sistema frontal intenso 150 mm/48 h, tormenta concentrada 60 mm/6 h, evento extremo 250 mm/72 h) o el **pronóstico de esta semana** de esa comuna; o ajusta a mano: **cuánto** llueve, **en cuánto tiempo** (1 h a 7 días), **cómo cae** (pareja, chubascos, concentrada) y **cómo estaba el suelo** (seco, normal, saturado). En opciones avanzadas: tipo de suelo (A–D), drenaje (rápido, normal, lento) y lámina de agua.
3. Aprieta **Simular**: una **nube llueve** sobre la comuna, el **agua avanza y retrocede** en el mapa hora a hora, y las cifras (hectáreas bajo el agua, cultivo, pradera, personas, viviendas, servicios) siguen a la animación. Se puede pausar, ir y volver en el gráfico, cambiar la velocidad y descargar un CSV.

## 2. Las cuentas — `js/simulacion-lluvia.js` (`GTSimLluvia`)

Tres piezas conocidas y citables:

### Pieza 1 · ¿Cuánta lluvia escurre? Número de Curva (USDA-NRCS, 1986, TR-55)

Cada celda de 30 m recibe un **número de curva (CN)** según lo que la cubre y el tipo de suelo. Más alto = escurre más (asfalto ≈ 98; bosque en suelo arenoso ≈ 30).

```javascript
const CN = {                       // grupo hidrológico del suelo:  A    B    C    D
  cultivo:  [67, 78, 85, 89],
  pradera:  [39, 61, 74, 80],
  arbolado: [30, 55, 70, 77],
  matorral: [30, 48, 65, 73],
  urbano:   [77, 85, 90, 92],
  desnudo:  [77, 86, 91, 94],
};
```

La mezcla de cada celda sale de datos que el visor ya tiene: **% de cultivo y pradera** (WorldCover), **zona poblada** (viviendas del Censo por celda), y para el resto, el **NDVI** (arbolado si ≥ 0,45, matorral si ≥ 0,2, desnudo si menos).

Dos correcciones:

```javascript
function cnHumedad(cn2, humedad) {                 // Chow, Maidment y Mays (1988)
  if (humedad === 'seco')     return 4.2 * cn2 / (10 - 0.058 * cn2);   // condición I
  if (humedad === 'saturado') return 23 * cn2 / (10 + 0.13 * cn2);     // condición III
  return cn2;                                                           // condición II
}
function cnPendiente(cn2, pendiente) {             // Williams (1995), la de SWAT
  const cn3 = 23 * cn2 / (10 + 0.13 * cn2);
  return (cn3 - cn2) / 3 * (1 - 2 * Math.exp(-13.86 * pendiente)) + cn2;
}
```

Y la escorrentía acumulada para una lluvia acumulada P:

```javascript
function escorrentia(P, cn) {
  const S = 25400 / cn - 254, Ia = 0.2 * S;          // retención máxima y pérdida inicial (mm)
  return P > Ia ? (P - Ia) * (P - Ia) / (P - Ia + S) : 0;
}
```

$$S = \frac{25400}{CN} - 254 \qquad Q = \frac{(P - 0{,}2S)^2}{P + 0{,}8S} \;\text{ si } P > 0{,}2S$$

> [!example] Con números
> 100 mm sobre una celda con CN 80: S = 63,5 mm, Ia = 12,7 mm, **Q = 50,5 mm** escurren. Con el suelo saturado, el CN sube a ≈ 90 y escurre bastante más.

### Pieza 2 · ¿Cuánta se queda? Embalse lineal (Nash, 1957)

Lo que escurre entra a la red de drenaje, que lo evacúa como un **embalse lineal**: cada hora sale una fracción fija de lo retenido, con una constante de vaciado **k** (rápido 6 h, normal 24 h, lento 72 h).

```javascript
const decae = Math.exp(-1 / k);
for (let t = 0; t < HORAS_MAXIMAS; t++) {
  P += lluvia[t];                                    // lluvia acumulada
  const Q = escorrentiaTotal(P);                     // m³ escurridos hasta ahora
  const entra = Math.max(0, Q - Qprev);              // lo que escurrió en esta hora
  const W1 = W * decae + entra * (1 - decae) * k;    // agua retenida al final de la hora
  W = W1;
  const anegadas = Math.floor(W / (lamina * areaCelda));   // ¿cuántas celdas cubre?
  pasos.push({ hora: t + 1, lluvia: mm, acumulada: P, retenida: W, celdas: anegadas });
}
```

> [!important] Así entra la intensidad
> El número de curva solo ve el total de lluvia. El embalse ve **cuándo** llega: una lluvia corta e intensa deja más agua retenida **a la vez** que la misma lluvia repartida en días, porque el drenaje no alcanza a evacuarla. Por eso "tormenta concentrada" anega más que "lluvia moderada" con totales parecidos.

### Pieza 3 · ¿Dónde se junta? El orden del índice calibrado

El volumen retenido cubre primero las celdas que el **índice de susceptibilidad calibrado** marca como más altas (fondos de valle, zonas cóncavas, mucha acumulación de flujo), con una **lámina media** de 0,5 m. Es el orden **validado contra los eventos históricos**; la lluvia decide **hasta dónde** llega.

```javascript
function ordenarCeldas(valores, dentro) {
  // Celdas de mayor a menor índice, por CONTEO sobre el índice cuantizado en 65.536 niveles:
  // tiempo lineal aunque la comuna tenga millones de celdas (un sort tardaba segundos).
}
```

Un **acumulador** (`Acumulador.mover(k)`) suma hectáreas, cultivo, personas y servicios de las primeras k celdas del orden y se mueve de a poco: al reproducir, k cambia unas pocas celdas por cuadro, sin recalcular todo.

### Todo se calcula de una vez

Al apretar "Simular" se calcula la serie **hora a hora** completa (hasta que el agua baja del 2 % del máximo); la página solo **reproduce**. Por eso se puede ir y volver en el tiempo.

## 3. La pantalla — `js/simulacion-inundacion.js` (`GTSimInundacion`)

- **El agua:** un lienzo (`canvas`) del tamaño de la grilla de 30 m, puesto sobre el mapa por sus **cuatro esquinas** (fuente `canvas` de MapLibre). Cada cuadro pinta las celdas anegadas en azules de la rampa del agua (más oscuro donde es más hondo).
- **La nube:** un marcador de MapLibre sobre la comuna con gotas animadas por CSS, mientras dura la lluvia; muestra los mm/h de esa hora.
- **El índice se atenúa** (opacidad 0,18) mientras corre, para que el agua sea lo que se ve.
- **Gráfico:** barras de lluvia por hora y área bajo el agua; se puede arrastrar para ir a una hora.
- **Cifras:** lluvia caída, hectáreas bajo el agua (y % de la comuna), cultivo y pradera anegados, personas y viviendas con agua en su sector, servicios.

## 4. Lo que **no** simula (y se dice)

- La **crecida de los ríos** que vienen de la cordillera (el agua que llega desde fuera de la comuna).
- **Caudales, velocidades, profundidades reales**, obras de drenaje.
- Usa la lámina media como supuesto; la profundidad por celda es una estimación.

---

# Parte B · Simular un parque (`urbano.html`, pestaña "Simular un parque")

## 5. Qué hace la persona

Elige **tamaño** (0,1 a 20 ha) y **tipo** (pasto, mixto, arbolado), hace **clic** en el mapa donde iría el parque, **brotan los árboles** y un **halo azul de enfriamiento** se abre sobre el mapa de temperatura. Un círculo punteado marca hasta dónde se nota. Se pueden poner varios y quitarlos.

Las cifras responden:

- **¿Cuánto baja?** En el parque y alrededor.
- **¿Hasta dónde se nota?**
- **¿A quién le llega?** Personas (Censo 2024) que viven donde baja al menos 0,25 °C.
- **¿Cómo cambia el área verde por habitante** de su zona censal, frente al estándar SIEDU de **10 m²**?

## 6. Las cuentas — `js/simulacion-calor.js` (`GTSimCalor`)

### Paso 1 · Medir lo que ya pasa en esa ciudad

No usa un número genérico: **mide** la "isla fresca" de los parques que existen, como se hace en la literatura (Cao et al., 2010):

- Cada parque de **1 ha o más** que no es solo pasto, contra **su propio entorno urbano de 100 a 500 m** (sin otras áreas verdes), con la temperatura de ECOSTRESS a 70 m.
- El promedio ponderado por celdas es la isla fresca de la ciudad. **Rancagua: 0,44 °C** (22 parques; El Edén 1,2 °C, Catalunya 0,7 °C).
- Con menos de 4 parques medibles se usa **0,5 °C** y se dice.

> [!info] Lo que se descartó al probar
> Comparar las áreas verdes con los barrios a más de 500 m de cualquiera **no sirve**: esos barrios quedan en el borde de la ciudad, junto a campos regados más frescos, y la mayoría de las áreas de OSM son bandejones de pasto. Así medidos, los parques salían **0,3 °C más cálidos**. Por eso se mide parque por parque contra su entorno.
>
> **¿Por qué solo décimas?** La temperatura de ECOSTRESS promedia escenas de día y de noche; de noche el efecto casi desaparece. A pleno sol la diferencia es mayor.

### Paso 2 · Aplicarla al parque nuevo

```javascript
const TIPOS = { pasto: 0.7, mixto: 1.0, arbolado: 1.3 };         // Bowler et al. (2010)

function intensidad(base, areaM2, tipo, areaTipica) {
  const tam = clamp(1 + 0.3 * Math.log(areaM2 / areaTipica), 0.4, 1.6);   // Cao et al. (2010)
  return base * tam * TIPOS[tipo];
}
function alcance(areaM2) { return clamp(Math.sqrt(areaM2), 60, 400); }    // Aram et al. (2019)

function efecto(parques, g) {          // enfriamiento de cada celda
  // dentro del parque: −intensidad
  // fuera, a distancia d del borde: −intensidad · exp(−3d / L), con L = alcance
  // varios parques no se suman: cada celda toma el más fuerte
}
```

- **Tamaño:** la isla fresca crece con el **logaritmo** del área, relativo al parque típico de la ciudad.
- **Tipo:** los árboles dan **sombra** además de evapotranspiración: arbolado × 1,3; pasto × 0,7.
- **Distancia:** fuera del parque el efecto decae como $e^{-3d/L}$, con L igual al ancho del parque (entre 60 y 400 m).

> [!example] Con números (si el parque típico mide 1 ha)
> Un parque **arbolado de 5 ha**: tamaño 1 + 0,3·ln 5 = 1,48; intensidad 0,44 × 1,48 × 1,3 ≈ **0,85 °C** dentro; L = √50.000 ≈ 224 m; sigue bajando al menos 0,25 °C hasta ≈ **90 m** del borde.
> Una plaza de **pasto de 0,25 ha**: 0,44 × 0,58 × 0,7 ≈ **0,18 °C**: casi no se nota. Es la lección que da la herramienta: el tamaño y los árboles importan.

### Por qué un halo y no recolorear el mapa

Las clases del mapa de calor van de **3 en 3 °C**; el efecto es de **décimas**. Recoloreadas, casi ninguna celda cambiaba de clase. Por eso se dibuja un **halo azul** de intensidad proporcional al enfriamiento (`pintarLienzo`), que se abre en 2,6 s (`animar`).

## 7. La pantalla — `js/simulacion-verde.js` (`GTSimVerde`)

- **Preparar la comuna:** la temperatura por celda, las áreas verdes que existen (`GT.areasVerdesGeo`), la población por celda (`/exposicion/poblacion` + `GTCalculo.rasterizarManzanas`) y las zonas censales.
- **Clic:** coloca el parque (`alClic`), calcula `efecto`, anima el halo y los árboles (marcadores con un SVG de árbol que "brota").
- **Resultados:** cuánto baja, hasta dónde, personas alcanzadas y m²/hab de la zona antes y después.

## 8. Lo que **no** dice (y se declara)

- Es temperatura de la **superficie** (lo que mide el satélite), no del aire: las diferencias de aire son del orden de un tercio a la mitad.
- El resultado real depende del **riego, la especie y el diseño**.

## Pruébalo

1. `inundaciones.html` → abre **Coinco** → pestaña **Simulación de lluvia** → "Tormenta concentrada" → **Simular**. Después "Lluvia moderada" y compara el máximo.
2. Cambia "Suelo antes de llover" a **Saturado** y vuelve a simular.
3. `urbano.html` → pestaña **Simular un parque** → 5 ha, arbolado → clic en un barrio denso de Rancagua.
4. Prueba 0,25 ha de pasto en el mismo lugar.

## Cómo decirlo en la presentación

> [!example] Lluvia
> "Esta pestaña responde: con esta lluvia, ¿qué queda bajo el agua? Usamos el número de curva del Departamento de Agricultura de Estados Unidos para saber cuánta lluvia escurre según la cobertura de cada celda, un embalse lineal para modelar cuánto alcanza a drenar, y el índice calibrado para decidir dónde se junta. No es un pronóstico: es un escenario para comparar lluvias y preparar la respuesta."

> [!example] Parque
> "Aquí la pregunta es: si pongo un parque aquí, ¿cuánto baja la temperatura? No usamos un número de un paper: medimos cuánto más frescos están hoy los parques de Rancagua que su entorno, 0,44 grados en promedio, y lo escalamos por tamaño, tipo y distancia con relaciones publicadas. La herramienta enseña que una plaza de pasto casi no cambia nada y un parque arbolado grande sí."

## Autoevaluación

> [!question]- ¿Qué calcula el número de curva y de qué depende?
> Cuánta lluvia escurre en vez de infiltrarse. Depende de la cobertura (cultivo, pradera, ciudad, vegetación), del grupo hidrológico del suelo (A–D), de la humedad previa y de la pendiente.

> [!question]- ¿Por qué hace falta el embalse lineal si ya está el número de curva?
> Porque el número de curva solo ve el total de lluvia. El embalse modela que el drenaje evacúa una fracción por hora: una lluvia concentrada deja más agua a la vez que la misma lluvia repartida. Así entra la intensidad.

> [!question]- ¿Cómo decide la simulación qué celdas se anegan?
> Llena las celdas en orden de mayor a menor índice de susceptibilidad calibrado (el orden validado contra eventos), tantas como alcance el volumen retenido dividido por la lámina media por el área de una celda.

> [!question]- ¿Qué no simula la lluvia?
> La crecida de los ríos que vienen de fuera de la comuna, caudales, velocidades, profundidades reales ni obras.

> [!question]- ¿De dónde sale el 0,44 °C del parque?
> De medir en Rancagua cada parque de 1 ha o más (no solo pasto) contra su propio entorno urbano de 100 a 500 m, con ECOSTRESS, y promediar ponderando por celdas.

> [!question]- ¿Por qué no se comparó con los barrios lejos de toda área verde?
> Porque quedan en el borde de la ciudad, junto a campos regados más frescos; así medidos, los parques salían más cálidos que los barrios.

> [!question]- ¿Por qué se muestra un halo en vez de recolorear el mapa de calor?
> Porque las clases del mapa van de 3 en 3 °C y el efecto es de décimas: casi ninguna celda cambiaba de color.

Siguiente: [[L15 Pruebas y calidad]]
