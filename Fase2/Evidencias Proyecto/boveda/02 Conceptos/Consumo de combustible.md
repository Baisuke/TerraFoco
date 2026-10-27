# Consumo de combustible

**Viajes a terreno** (`viajes.html`) responde una pregunta práctica de quien sale a ver predios: **¿cuánta bencina y cuánta plata cuesta llegar?** Se marca una salida (A) y una llegada (B) dentro de las 33 comunas, y la pantalla estima litros, pesos, tiempo y CO₂, por qué se gastan y en qué tramos. Un autito recorre la ruta con el estanque bajando.

## El camino

| Orden | Servicio | Qué entrega | Cuándo se usa |
|---|---|---|---|
| 1 | **Valhalla** (FOSSGIS, sobre OpenStreetMap) | Ruta y hasta 2 alternativas, **altura cada 30 m** y, con `trace_attributes`, por cada arco: clase de vía, **superficie** (asfalto, ripio, tierra), velocidad, densidad urbana, peaje | Siempre, primero |
| 2 | **OSRM** (FOSSGIS) + **Terrarium** (AWS Terrain Tiles) | Solo forma y velocidad; la altura se lee de teselas de elevación públicas | Si Valhalla no responde |
| 3 | Línea recta × 1,35 a 60 km/h, plana | Solo orden de magnitud, y se advierte | Sin conexión |

Ninguno pide clave; solo viajan las dos coordenadas. "Evitar ripio" usa `exclude_unpaved`: si el destino está en un camino de ripio no hay ruta solo por pavimento, y se repite sin la restricción avisándolo.

## El modelo, cada 30 m

Archivo: `prototipo/js/viaje-calculo.js` (`GTViaje`), sin DOM ni red; se prueba con node.

```
fuerza   = m·g·Crr·cos θ  +  ½·ρ·CdA·v²  +  m·g·sen θ
           (rodadura)        (aire)          (pendiente)
trabajo  = fuerza·d / ηtransmisión  +  (pérdidas internas + aire acondicionado)·t
litros   = trabajo / (ηmotor · energía de un litro)
```

- **Crr** sube con la superficie: asfalto liso ×1, ripio ×2,3, tierra ×2,8 (base 0,011).
- **ρ**, la densidad del aire, baja con la altura: en la precordillera el aire frena menos.
- **En bajada** el trabajo puede salir negativo: el motor corta la inyección y no gasta, pero tampoco recupera. Lo que sobra se pierde en los frenos.
- **Detenciones:** por km según la clase de vía (autopista 0, ruta principal 0,25, calle urbana 1,2) más 0,06 × densidad urbana. Cada una obliga a volver a acelerar (½·m·v², +5 % por la inercia de las ruedas) y deja 10 s de ralentí.
- **Peso:** masa del vehículo + 75 kg por persona + la carga.
- **Motor:** eficiencia media en uso real, 28 % bencina y 33 % diésel; las pérdidas internas crecen con el tamaño del vehículo.

## "Tomando un promedio": la calibración

El rendimiento elegido (km/L) pone la **escala**. El modelo se corre en un ciclo mixto plano de referencia (35 % ciudad a 30 km/h, 35 % camino a 70 km/h, 30 % carretera a 100 km/h) y se multiplica por el factor que lo lleva exactamente a ese rendimiento. La física **reparte** el gasto entre tramos; el promedio fija **cuánto** es. Con los vehículos de la lista el factor queda entre 1,03 y 1,14: la física sola ya explica casi todo, y la página lo muestra en "Notas del cálculo".

Los rendimientos de la lista son **promedios reales**, no los de la etiqueta (que se miden en laboratorio y quedan 15 a 25 % arriba). Si el usuario conoce el de su vehículo, lo escribe.

## Lo que muestra

- Litros y pesos (ida, o ida y vuelta por el mismo camino con las pendientes invertidas), km, tiempo, km/L de esa ruta, CO₂ (2,31 kg/L bencina, 2,68 diésel) y % del estanque.
- **En qué se va el combustible:** rodar, empujar el aire, motor encendido, detenerse y arrancar, subidas menos bajadas.
- **Por tipo de camino:** km y rendimiento en autopista, ruta principal, camino secundario, calle urbana y ripio o tierra.
- **Rutas posibles:** cuál gasta menos y cuál es más rápida (no siempre coinciden).
- Mapa y perfil de alturas coloreados por **consumo** (frente al promedio del vehículo), **tipo de camino** o **pendiente**.

## Ejemplo de referencia

Rancagua → predio ficticio de la precordillera (Hijuela El Alto, `datos/predios_ejemplo.csv`), sedán: la ida sube 1.149 m y gasta **5,4 L**; la vuelta, **3,4 L**. Los 6,9 km de ripio rinden 5,1 km/L, contra 11 km/L en la ruta pavimentada.

## Límites

No ve el tráfico ni el estilo de manejo; tampoco la presión de los neumáticos ni el viento (±10–20 %). Los peajes se advierten, no se suman. Los precios son de referencia y se editan (quedan en `localStorage`).

Ver también: [[Visor - páginas#viajes.html]] · [[Privacidad y datos personales]]
