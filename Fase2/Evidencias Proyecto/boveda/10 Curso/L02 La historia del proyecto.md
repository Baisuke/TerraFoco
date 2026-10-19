# L02 · La historia del proyecto

> [!abstract] En una frase
> El Estado gasta en recuperar suelos erosionados (el SIRSD-S de INDAP), pero nadie mide si esa plata llega a las comunas donde el suelo está peor; TerraFoco **mide la erosión, carga la inversión y las cruza** comuna por comuna, y lo muestra en un mapa que un funcionario puede usar.

## 1. El problema, contado como a alguien de afuera

La **erosión** es la pérdida de la capa fértil del suelo: la lluvia golpea, arrastra tierra y la lleva a los ríos. Un suelo erosionado produce menos y no se recupera solo en una vida humana.

En Chile, **INDAP** (Instituto de Desarrollo Agropecuario) financia, con el programa **SIRSD-S** (Sistema de Incentivos para la Sustentabilidad Agroambiental de los Suelos Agropecuarios), prácticas que frenan la erosión: cubiertas vegetales, cero labranza, curvas de nivel, obras en laderas. El agricultor postula a un concurso, se le aprueba un plan y el Estado paga un **incentivo**.

Tres hechos:

1. **La erosión está medida.** CIREN publica el **Inventario Nacional de Erosión**, con el modelo RUSLE, por polígono.
2. **La inversión está registrada.** INDAP sabe cuánto pagó, en qué comuna y en qué año.
3. **Nunca se cruzan.** No hay una medición sistemática de si el incentivo llega **a donde el problema es más grave**.

> [!quote] La pregunta de investigación
> **¿La inversión pública en conservación de suelos llega a las comunas donde el problema es más grave?**

## 2. La idea clave (lo que hay que repetir en la presentación)

El modelo con que se mide la erosión es **RUSLE**:

$$A = R \times K \times LS \times C \times P$$

| Factor | Qué es | ¿Lo cambia una persona? |
|---|---|---|
| **R** | Erosividad de la lluvia | No: es el clima |
| **K** | Erodabilidad del suelo | No (casi): es el tipo de suelo |
| **LS** | Largo y pendiente de la ladera | No: es el relieve |
| **C** | Cobertura vegetal | **Sí**: plantar, cubrir el suelo |
| **P** | Prácticas de conservación | **Sí**: curvas de nivel, terrazas, obras |

> [!important] El aporte original
> Las prácticas que financia el SIRSD-S **actúan exactamente sobre C y P**. La variable que se quiere evaluar (la intervención pública) **ya vive dentro de la ecuación física**. Por eso el cruce erosión–inversión no es "poner dos tablas una al lado de la otra y ver si se parecen": hay un mecanismo físico que los une.

## 3. Qué hace el sistema, en cuatro verbos

1. **Mide** el territorio con datos públicos y satelitales:
   - erosión con RUSLE a 30 m (y la compara con CIREN);
   - susceptibilidad a inundación con seis variables del relieve, validada contra eventos históricos;
   - calor urbano (satélite ECOSTRESS) y déficit de áreas verdes.
2. **Carga** la inversión: la serie del SIRSD-S 2012–2025 por comuna y año, convertida a UF.
3. **Cruza** ambas en el **índice de pertinencia**: necesidad normalizada menos inversión normalizada.
4. **Muestra** todo en un visor web para personas sin formación informática: mapas a 30 m, fichas por comuna, exportación a Google Earth y QGIS, y un análisis de los propios predios.

## 4. Los tres módulos

| Módulo | Pregunta | Pantallas | Estado |
|---|---|---|---|
| **1 · Suelos agrícolas** | ¿Dónde hay erosión y llega la inversión? | Panel, Visor, Pertinencia, Ficha de comuna | El corazón del proyecto |
| **2 · Inundaciones** | ¿Qué terreno es susceptible y qué queda encima? | Inundaciones (+ simulación de lluvia) | Completo y validado |
| **3 · Ciudades** | ¿Dónde hace más calor y falta área verde? | Ciudades (+ simular un parque) | Complementario |

Más tres pantallas transversales: **Mis predios** (el ejecutivo de INDAP sube sus predios y ve el riesgo de cada uno), **Fuentes de datos** (catálogo y bitácora) y **Ayuda**.

## 5. Para quién

El usuario principal es el **ejecutivo de área de INDAP** y quien distribuye el SIRSD-S en la región. Lo que el sistema le permite:

- **Priorizar comunas** en el próximo concurso: el índice y la "brecha en UF" (cuánto le falta a cada comuna para llegar a la inversión típica de la región).
- **Revisar sus predios**: si están en zona de inundación, erosión severa o pendiente fuerte.
- **Llevar zonas a terreno**: exportar a Google Earth las celdas marcadas.
- **Estimar exposición** ante una emergencia: hectáreas de cultivo y agricultores en zona susceptible.

## 6. La región piloto: O'Higgins

- **33 comunas**, 3 provincias: Cachapoal (valle y precordillera), Colchagua y Cardenal Caro (secano costero).
- Erosión heterogénea: el secano costero es el más erosionado; el valle, el menos.
- Nada de la región está escrito en el código: es **una fila** en la tabla `territorio.region`. Agregar otra región es insertar una fila (regla de oro, `motor/config.py`).

## 7. Los resultados que hay que saber de memoria

| Qué | Cifra | De dónde |
|---|---|---|
| Superficie analizada | **16.347 km²**, 33 comunas, a 30 m | Panel general |
| Incentivo SIRSD-S 2012–2025 | **$19.854 millones** (≈ 729 mil UF), **22.449 planes** | Serie de INDAP |
| Comunas en el índice | **27 de 33** (6 precordilleranas fuera del dominio de validez) | Validación |
| Mayor brecha | **Navidad**: 25,9 t/ha/año de erosión y 0,32 UF por hectárea erosionada (la mediana regional es 2,42) | Pertinencia |
| Validación de la erosión propia | Spearman **ρ ≈ +0,67** contra CIREN en las 27 comunas del dominio (≈ −0,04 con las 33) | `python -m validar` |
| Validación de inundación | **43 de 63 eventos (68 %)** en comunas Alta o Muy alta, frente a **52 %** del azar; ρ ≈ +0,36 | `validar_inundacion` |
| Focalización | Las comunas más erosionadas tienen el **61 %** de la superficie con erosión severa y recibieron **≈ 47 %** del incentivo (2012–2018) y **≈ 46 %** (2019–2025) | `/pertinencia/evolucion` |
| Calor urbano | Graneros 26,4 °C frente a Machalí 20,4 °C: **6 °C** de diferencia en la conurbación de Rancagua | Ciudades |
| Pruebas automatizadas | **~270** del motor y **~96** de la API | `pytest` |

> [!warning] Las cifras pueden moverse
> Salen de los datos cargados (CIREN 2024, cálculo propio 2025, serie SIRSD-S 2012–2025). Si se recalcula algo, cambian. Antes de presentar, confírmalas en el visor: el panel general, pertinencia y la ficha de Navidad.

## 8. Lo que el proyecto declara que NO hace

Decirlo antes de que lo pregunten da seguridad:

- **No predice** inundaciones ni dice cuándo: mide **susceptibilidad estática** del terreno.
- El modelo propio de erosión **no es confiable en la precordillera** (6 comunas): ahí la ecuación de lluvia sobreestima. Se **marcan**, no se esconden.
- La inversión es **todo el SIRSD-S** (también fertilidad, que no actúa sobre la erosión): el desglose por práctica requiere datos personales que no se cargan.
- Con 33 comunas, cualquier correlación es **sugerente, no concluyente**.

## 9. El equipo y la metodología

| Integrante | Rol técnico | Rol Scrum |
|---|---|---|
| Bastián Cárcamo | Ingeniería de datos y geoprocesamiento | Scrum Master |
| Carla Morales | Backend y modelado analítico | Product Owner (vínculo con INDAP) |
| Antonio Lankin | Frontend, visualización y calidad | Development Team |

- **CRISP-DM** para lo de datos (comprender, preparar, modelar, **evaluar**, desplegar). La recalibración del índice de inundación es un ejemplo de vuelta a la fase de modelado tras la evaluación.
- **Scrum** para el desarrollo (sprints, historias de usuario HU-xx, requisitos RF-xx, casos de uso UC-xx).

## Cómo decirlo en la presentación

> [!example] Versión de 30 segundos
> "INDAP invierte en recuperar suelos erosionados con el SIRSD-S, pero nadie mide si esa plata llega a donde el suelo está peor. TerraFoco calcula la erosión con el mismo modelo que usa el inventario nacional, carga catorce años de inversión y los cruza comuna por comuna en un índice de pertinencia. La clave es que las prácticas que financia el programa son dos de los factores del modelo físico: el cruce tiene un mecanismo, no es una correlación forzada. Todo se ve en un visor web pensado para el ejecutivo de INDAP."

> [!example] Versión de 2 minutos (agregar a la anterior)
> "Lo probamos en O'Higgins: 33 comunas a 30 metros. Validamos nuestro cálculo contra CIREN y ordena igual las comunas (ρ 0,67) salvo en seis de precordillera, donde la ecuación de lluvia sobreestima; esas las marcamos, no las escondemos. El índice muestra que Navidad, la comuna más erosionada, es la que menos recibe por hectárea erosionada. Además sumamos un módulo de inundaciones validado contra 63 eventos históricos y uno de calor urbano. El sistema se actualiza solo con un programador de tareas, y el visor nunca queda en blanco: si la API cae, usa una copia de los últimos datos reales y lo dice."

## Autoevaluación

> [!question]- ¿Qué pregunta responde TerraFoco?
> Si la inversión pública en conservación de suelos (SIRSD-S de INDAP) llega a las comunas donde la erosión es más grave.

> [!question]- ¿Por qué el cruce no es una "correlación forzada"?
> Porque las prácticas que financia el SIRSD-S actúan sobre los factores C y P de RUSLE, el mismo modelo con que se mide la erosión. La intervención está dentro de la ecuación física.

> [!question]- ¿Cuáles son los tres módulos y cuál es el principal?
> 1 Suelos agrícolas (principal: erosión y pertinencia), 2 Inundaciones (susceptibilidad y exposición), 3 Ciudades (calor y áreas verdes, complementario).

> [!question]- ¿Por qué hay 27 comunas en el índice y no 33?
> Seis comunas precordilleranas quedan fuera del dominio de validez del modelo propio: su erosividad supera 2.000 y la ecuación de Renard y Freimund sobreestima ahí. Se calculan y se muestran marcadas, pero no entran al índice por defecto.

> [!question]- ¿Qué tres cosas declara el proyecto que no hace?
> No predice inundaciones (es susceptibilidad estática); el modelo propio no es confiable en precordillera; la inversión incluye subprogramas que no actúan sobre la erosión. Además, con 33 comunas las correlaciones son sugerentes, no concluyentes.

> [!question]- Di el pitch de 30 segundos sin mirar.
> Compáralo con la versión de arriba: problema (nadie mide si llega), solución (medir, cargar, cruzar), idea clave (C y P), para quién (el ejecutivo de INDAP).

Siguiente: [[L03 Arquitectura en concreto]]
