# Consumo de combustible

**Viajes a terreno** (`viajes.html`) responde una pregunta práctica de quien sale a ver predios: **¿cuánta bencina y cuánta plata cuesta la visita?** Se marca una salida, una llegada y, si se quiere, paradas en medio (una gira), siempre dentro de las 33 comunas. La pantalla estima litros (o kWh), pesos, tiempo y CO₂, explica por qué se gastan, sugiere cómo gastar menos y un autito recorre la ruta con el estanque bajando.

## El camino y los datos

| Qué | Servicio (abierto, sin clave) | Para qué |
|---|---|---|
| Ruta, alternativas, altura cada 30 m, indicaciones en español | **Valhalla** (FOSSGIS, sobre OpenStreetMap) `/route` | El recorrido y su perfil |
| Clase de vía, **superficie**, velocidad, densidad urbana, peajes | Valhalla `/trace_attributes` | El tipo de cada tramo |
| Orden de las paradas | Valhalla `/optimized_route` | "Ordenar para gastar menos" |
| Ruta de respaldo | **OSRM** (FOSSGIS) + alturas de **Terrarium** (AWS Terrain Tiles) | Si Valhalla no responde |
| Viento y temperatura de hoy | **Open-Meteo** | El aire en contra o a favor |
| Buscar lugares, nombrar puntos | **Photon** (Komoot, sobre OpenStreetMap) | Buscador y nombre de la calle |

Sin conexión queda una línea recta × 1,35 a 60 km/h, plana, y se advierte. Solo viajan coordenadas: nada personal.

## El modelo, cada 30 m

Archivo: `prototipo/js/viaje-calculo.js` (`GTViaje`), sin DOM ni red; se prueba con node.

```
fuerza   = m·g·Crr·cos θ  +  ½·ρ·CdA·(v + vₓ)²  +  m·g·sen θ
           (rodadura)        (aire)                (pendiente)
trabajo  = fuerza·d / ηtransmisión  +  (pérdidas internas + aire acondicionado)·t
consumo  = trabajo / (ηmotor · energía de un litro, o de un kWh)
```

- **Crr** sube con la superficie: asfalto liso ×1, ripio ×2,3, tierra ×2,8 (base 0,011).
- **ρ** baja con la altura y con el calor: en la precordillera y en verano el aire frena menos.
- **vₓ, el viento:** el de hoy (Open-Meteo, a 10 m) al 70 % —a la altura de un auto sopla menos— y proyectado sobre el rumbo de cada tramo: de frente suma, de cola resta.
- **Bajadas:** la combustión corta la inyección y no recupera; el **híbrido** guarda el 35 % del frenado y el **eléctrico** el 60 % (puede llegar con más batería si baja mucho).
- **Detenciones:** por km según la clase de vía (autopista 0, ruta principal 0,25, calle urbana 1,2) más 0,06 × densidad urbana. Cada una obliga a volver a acelerar (½·m·v², +5 % por inercia de las ruedas, menos lo que recupera la batería) y deja 10 s de ralentí, salvo en los que se apagan solos.
- **Manejo:** suave (−6 % de velocidad en carretera, aceleraciones al 75 %), normal o rápido (+6 %, 135 %). **Tope en autopista:** el conductor elige hasta cuánto va.
- **Peso:** masa del vehículo + 75 kg por persona + la carga.

## "Tomando un promedio": la calibración

El rendimiento elegido (km/L o km/kWh) pone la **escala**: el modelo se corre en un ciclo mixto plano de referencia (35 % ciudad a 30 km/h, 35 % camino a 70, 30 % carretera a 100) y se multiplica por el factor que lo lleva exactamente a ese rendimiento. La física **reparte** el gasto entre tramos; el promedio fija **cuánto** es. Con los 8 vehículos de la lista el factor queda entre 0,99 y 1,14 (la página lo muestra en "Notas del cálculo").

| Vehículo | Rendimiento real típico | Motor |
|---|---|---|
| Auto pequeño · Sedán | 15 · 13 km/L | bencina |
| Auto híbrido | 21 km/L | híbrido (bencina) |
| Auto eléctrico | 6,5 km/kWh | eléctrico |
| SUV · Camioneta doble cabina | 10,5 · 8,5 km/L | bencina |
| Camioneta 4x4 · Furgón | 10,5 · 9,5 km/L | diésel |

Son promedios reales, no los de la etiqueta (15 a 25 % arriba). Si el usuario conoce el de su vehículo, lo escribe; queda guardado.

## Lo que muestra

- **Resultado:** consumo, pesos (con peajes si se ingresan), km, tiempo, km/L de esa ruta, CO₂ (2,31 kg/L bencina, 2,68 diésel, 0,27 kg/kWh red eléctrica), % del estanque o batería, desnivel; costo por persona y, si se repite, **al mes y al año**.
- **En qué se va:** rodar, aire, motor encendido, detenerse y arrancar, subidas menos bajadas.
- **Cómo gastar menos:** consejos *calculados* —volver a correr el modelo con un cambio—: bajar 10 km/h en carretera, manejo suave, sin aire, sin carga, otra ruta, evitar ripio.
- **El mismo viaje en otro vehículo:** los 8, con su combustible y precio; un clic lo elige.
- **Tramos** (A → B, B → C…), **tipos de camino**, **rutas posibles**, **indicaciones paso a paso**.
- Mapa y perfil coloreados por consumo, tipo de camino o pendiente; hitos de kilómetro.
- **El autito:** ▶ Recorrer (×1, ×2, ×4), se detiene en cada parada, avisa ripio y subidas fuertes, aguja del estanque, barra para adelantar o retroceder, vista de conductor; el ícono cambia con el vehículo (auto, eléctrico, SUV, camioneta con pickup, furgón).

## Llevarse el viaje

Informe imprimible o PDF (con foto del mapa, perfil e indicaciones), **GPX** (GPS, OsmAnd, Wikiloc), **KML** (Google Earth), **CSV** del perfil cada 100 m, abrir en **Google Maps** (con paradas) o **Waze** (a la primera parada), copiar el enlace (`?p=lat,lon;lat,lon…&vuelta=1`). **Mis viajes** guarda viajes en el navegador y baja la **planilla de rendición** (CSV para Excel en español). "Mis predios" abre la página con el predio de llegada (`?hasta=`).

## Ejemplo de referencia

Gira de ejemplo: Rancagua → tres predios ficticios → Rancagua, en un orden malo a propósito. "Ordenar para gastar menos" ahorra **75 km y 5,6 L** (sedán). La misma gira cuesta ~$13.700 en sedán, ~$8.300 en híbrido y ~$3.800 en eléctrico.

## Límites

No ve el tráfico ni el estado del vehículo; tampoco la presión de los neumáticos (±10–20 %). Los peajes se advierten y se suman a mano. El viento es el de este momento en el centro de la ruta. Los precios son de referencia y se editan.

Ver también: [[Visor - páginas#viajes.html]] · [[Privacidad y datos personales]]
