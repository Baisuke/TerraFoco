# L17 · Guion de la presentación

> [!abstract] En una frase
> Contar **una historia** (problema → idea clave → cómo funciona → demostración → cómo sabemos que está bien → límites), con la demo siguiendo **una pregunta de INDAP** de pantalla en pantalla y con un plan B para cada cosa que pueda fallar.

Este guion está pensado para **18 minutos** (5 de exposición, 10 de demo, 3 de calidad y cierre). Al final hay versiones de 5 y 10 minutos. Ajusta los tiempos al formato que te pidan.

---

## Antes de entrar (checklist)

- [ ] Docker Desktop abierto **con tiempo**; `docker compose ps` muestra los 4 contenedores.
- [ ] `curl http://localhost:8000/salud` → `"base_de_datos": "ok"`.
- [ ] `python herramientas/servir_prototipo.py prototipo 8081` corriendo.
- [ ] `python herramientas/sembrar_indicadores.py` (copia local al día).
- [ ] Pestañas abiertas y **ya cargadas** (el mapa base tarda ~20 s la primera vez):
  1. `index.html`
  2. `pertinencia.html`
  3. `comuna.html?id=6205` (Navidad)
  4. `visor.html`
  5. `inundaciones.html`
  6. `predios.html`
  7. `fuentes.html`
  8. `http://localhost:8000/docs`
- [ ] Tema: oscuro en pantalla de computador; **`?tema=claro` si es proyector** (el oscuro se ve lavado).
- [ ] Copia portable en el escritorio, probada una vez (plan B).
- [ ] Nada de la clave de administración a la vista. No abrir el `.env`.
- [ ] Zoom del navegador cómodo para la sala (Ctrl + / Ctrl −).

---

## Parte 1 · El problema (1 min 30 s)

**Decir:**

> "La erosión es la pérdida de la capa fértil del suelo, y en el secano de O'Higgins es severa. INDAP invierte para recuperarla con el SIRSD-S: en esta región, casi 20 mil millones de pesos entre 2012 y 2025, en más de 22 mil planes. La erosión está medida por CIREN y la inversión está registrada por INDAP, pero **nadie las cruza**: no se sabe si la plata llega a donde el suelo está peor. Esa es nuestra pregunta."

**Mostrar:** la lámina con la pregunta, o directamente el panel general (`index.html`).

## Parte 2 · La solución y la idea clave (1 min 30 s)

> "TerraFoco hace cuatro cosas: mide la erosión con datos satelitales, carga catorce años de inversión, las cruza en un índice de pertinencia comuna por comuna, y lo muestra en un visor pensado para el ejecutivo de INDAP."
>
> "La idea clave: medimos la erosión con RUSLE, el mismo modelo que usa CIREN. RUSLE multiplica cinco factores, y dos de ellos —la cobertura vegetal y las prácticas de conservación— son **exactamente** lo que financia el SIRSD-S. La política pública está dentro de la ecuación física. Por eso este cruce no es una correlación forzada."

**Mostrar:** la fórmula A = R × K × LS × C × P con C y P resaltados.

## Parte 3 · Cómo está construido (2 min)

> "Son cuatro piezas en Docker. Un **motor** en Python con GDAL descarga las fuentes —CIREN, NASA, Copernicus, INE, OpenStreetMap, INDAP— y calcula por lotes. Deja todo en **PostgreSQL con PostGIS**. Una **API** en FastAPI solo lee esa base y entrega JSON. Y el **visor**, en HTML y JavaScript con MapLibre, dibuja los mapas en la tarjeta de video."
>
> "Separamos cálculo y consulta porque una descarga satelital tarda horas y no puede bloquear al usuario. El sistema se actualiza solo con un programador de tareas. Y el visor nunca queda en blanco: si la API se cae, usa una copia de los últimos datos reales y lo dice."

**Mostrar:** el diagrama de [[L03 Arquitectura en concreto]].

---

## Parte 4 · Demostración (10 min)

> [!tip] El hilo de la demo
> Seguir **la pregunta de un funcionario de INDAP**: "¿a qué comunas debería priorizar en el próximo concurso, y dónde dentro de ellas?". Cada pantalla responde un pedazo.

### 4.1 Panel general — `index.html` (1 min)

**Hacer:** mostrar las cuatro cifras y el ranking de la derecha.

> "Este es el resumen de la región: 16 mil kilómetros cuadrados analizados a 30 metros, cuatro comunas con erosión severa en promedio, y el incentivo de 14 años. A la derecha, las comunas con mayor brecha entre necesidad e inversión. **Arriba dice 'Datos reales'**: lo que vemos sale en vivo de la base."

### 4.2 Pertinencia — `pertinencia.html` (2 min)

**Hacer:** pasar el cursor por **Navidad** en la dispersión; bajar a "¿Ha mejorado la focalización?".

> "Cada punto es una comuna. Hacia arriba, más erosión; hacia la derecha, más inversión por hectárea erosionada. Lo ideal sería que las comunas más erosionadas fueran las que más reciben. Navidad está arriba a la izquierda: es la más erosionada, 25,9 toneladas por hectárea al año, y recibe 0,32 UF por hectárea erosionada, cuando la mediana regional es 2,4."
>
> "Medimos la inversión en UF por hectárea erosionada por tres razones: el programa funciona por concursos, así que usamos 14 años y no uno; los pesos de 2012 no valen lo mismo que los de hoy; y la erosión se mide por hectárea, así que la inversión también."
>
> "Y año por año: las comunas más erosionadas tienen el 61 % de la superficie con erosión severa y recibieron cerca del 46 % del incentivo, sin mejora entre la primera y la segunda mitad del período."

**Si preguntan por las 6 comunas que faltan:** "Están fuera del dominio de validez del modelo; las muestro con esta casilla" (marcar **fuera de dominio** y volver a desmarcar).

### 4.3 Ficha de Navidad — `comuna.html?id=6205` (1 min 30 s)

**Hacer:** bajar a la **Descomposición RUSLE** y a la **Recomendación para INDAP**.

> "La ficha baja a la comuna. Aquí están los cinco factores **medidos**, cada uno con su fuente: la lluvia de CR2MET, el suelo de SoilGrids, el relieve de NASADEM, la vegetación de Sentinel-2 y las prácticas del propio SIRSD-S. Fíjense en P: casi 1, porque la superficie intervenida es mínima frente a la agrícola. Cuando el programa crezca, P baja y la erosión con él: ese es el efecto medible del programa."
>
> "Y abajo, la recomendación en lenguaje de INDAP: priorizar en el próximo concurso; llegar a la mediana regional requiere unas 17 mil UF."

### 4.4 Visor a 30 m — `visor.html` (1 min 30 s)

**Hacer:** capa erosión → clic en **Pichilemu** → pasar el cursor por las laderas → (opcional) botón **3D** y girar con la rueda.

> "El promedio comunal esconde lo que hay que focalizar. Pichilemu, como comuna, tiene poca erosión. Pero a 30 metros aparecen laderas con cien veces más erosión que el terreno típico. Bajo el cursor leo el valor exacto de cada celda. Esto importa porque el SIRSD-S bonifica **predios**, no comunas."
>
> "Técnicamente, el valor de cada celda viaja codificado en los colores de un píxel y la tarjeta de video lo colorea; por eso no necesitamos un servidor de mapas."

### 4.5 Inundaciones — `inundaciones.html` (2 min)

**Hacer:** clic en **Coinco** → mover el **umbral** → leer las cifras de exposición → clic en una celda ("¿por qué esta celda?") → (si hay tiempo) pestaña **Simulación de lluvia** → "Tormenta concentrada" → **Simular**.

> "El segundo módulo mide susceptibilidad a inundación: dónde se junta el agua, no cuándo. Lo validamos contra 63 eventos históricos: el 68 % cae en las comunas de clase alta, frente a un 52 % que daría el azar."
>
> "Abro Coinco. Este control es el **umbral**: yo decido desde qué valor considero riesgo, y se recalcula al instante cuántas hectáreas de cultivo, cuántas personas del campo y qué escuelas quedan encima. Si hago clic en una celda, me explica por qué tiene ese valor. Todo se puede descargar a Google Earth para llevarlo a terreno."
>
> (Simulación) "Y aquí un escenario: con una tormenta concentrada sobre esta comuna, esto es lo que quedaría bajo el agua hora a hora. No es un pronóstico: es para comparar escenarios."

### 4.6 Mis predios — `predios.html` (1 min)

**Hacer:** "Probar con predios de ejemplo" → mostrar la tabla y la columna de observaciones.

> "El ejecutivo de área sube un CSV con sus predios y ve el riesgo de cada uno: inundación, erosión, pendiente, cobertura agrícola y la pertinencia de su comuna. **Nada sale del navegador**: el archivo se cruza aquí con los mapas y se olvida al cerrar. Por eso se puede usar con la planilla interna de la agencia sin exponer datos personales."

### 4.7 Fuentes — `fuentes.html` (30 s)

> "Y la operación: cada fuente con su última carga real, sacada de la bitácora que deja el motor en cada corrida. El catálogo es lo único que se edita desde la web, y está protegido con una clave."

---

## Parte 5 · Cómo sabemos que está bien (2 min)

> "Tres cosas. Primero, **validamos** los dos modelos con datos reales. El cálculo propio de erosión ordena las comunas igual que CIREN, con una correlación de Spearman de 0,67 en las 27 comunas donde la ecuación de lluvia está calibrada. En seis de precordillera sobreestima, y no las escondimos: las marcamos, y el umbral sale de la física, no de buscar la mejor correlación."
>
> "Segundo, el índice de inundación: la primera versión, con pesos a priori, fue **peor que el azar**. Lo reconocimos, probamos juegos de pesos declarados de antemano y quedaron acumulación de flujo y curvatura. Eso es CRISP-DM: evaluar y volver a modelar."
>
> "Tercero, unas 370 **pruebas automatizadas**, centradas en los errores que no revientan: unidades equivocadas, cadencias, decimales que se pierden."

## Parte 6 · Límites y próximos pasos (1 min)

> "Lo que el sistema no dice: no predice inundaciones; el modelo propio no sirve en precordillera; y la inversión incluye subprogramas de fertilidad que no actúan sobre la erosión, porque separarlos exige datos personales que no cargamos. Con 33 comunas, toda correlación es sugerente, no concluyente."
>
> "Para usarlo en producción falta: el desglose del SIRSD-S por práctica, la tabla oficial de agencias de área y una prueba de usabilidad con funcionarios."

## Cierre (30 s)

> "TerraFoco responde con datos una pregunta que hoy se responde a ojo: si la inversión en suelos llega a donde se necesita. En O'Higgins, la respuesta es: no del todo, y ya sabemos dónde corregir. Gracias."

---

## Plan B en vivo

| Pasa esto | Haz esto | Y dilo así |
|---|---|---|
| El mapa no carga (sin internet para el mapa base) | Sigue: los datos, el detalle y los gráficos funcionan | "El mapa base viene de internet; nuestros datos no" |
| La API se cae | Recarga: el badge dirá "Copia local" | "Justamente para esto el visor tiene copia local, y lo declara" |
| Docker no levanta | Abre la copia portable | "Esta es la versión portable: PostgreSQL embebido, sin Docker" |
| Se traba el navegador | Cierra la pestaña y abre la siguiente de la lista | — |
| Preguntan algo que no sabes | "Lo puedo mostrar en el código" → abre el archivo ([[L18 Preguntas sobre el código]]) | — |

## Versiones cortas

> [!example] 5 minutos
> Parte 1 (problema) + Parte 2 (idea clave) en 2 min → demo: **pertinencia** (Navidad) y **ficha** (RUSLE + recomendación) en 2 min → validación en 1 min.

> [!example] 10 minutos
> Partes 1–3 en 3 min → demo: panel, pertinencia, ficha, visor a 30 m, inundaciones con umbral (6 min) → validación y límites (1 min).

## Reparto sugerido si presentan los tres

| Parte | Quién | Por qué |
|---|---|---|
| Problema, solución, INDAP | Carla (vínculo con INDAP) | Conoce el programa y al usuario |
| Arquitectura, motor, datos, validación | Bastián (datos y geoprocesamiento) | Ingestas y modelos |
| Demo del visor, calidad, cierre | Antonio (frontend, visualización y calidad) | Es su parte |

Pero **cada uno debe poder hacer toda la demo**: si la comisión le pregunta a otro, tiene que poder responder.

## Ensayo

1. Ensaya en voz alta con cronómetro, **tres veces**.
2. La segunda vez, que alguien te interrumpa con preguntas de [[Preguntas de defensa]] y [[L18 Preguntas sobre el código]].
3. La tercera, provoca una falla a propósito (apaga la API a la mitad) y practica el plan B.

Siguiente: [[L18 Preguntas sobre el código]]
