# Plan de pruebas de usabilidad

Cierra la **HU-24**: *«Como usuario sin formación informática, quiero que la
interfaz sea comprensible sin capacitación previa, para poder usarla en mi
trabajo diario.»*

Es la única historia *Must* de la épica de presentación que sigue abierta, y
la única del proyecto que no se puede cerrar escribiendo código: requiere
sentar a alguien frente a la pantalla.

---

## 1. Qué se evalúa

Los tres criterios de aceptación declarados en el backlog:

| | Criterio | Cómo se comprueba |
|---|---|---|
| **C1** | Un usuario sin experiencia previa completa las tres tareas sin ayuda | Sesión observada, sección 3 |
| **C2** | Ningún término técnico aparece sin explicación accesible | Auditoría, sección 5 |
| **C3** | Toda cifra mostrada indica su unidad de medida | Auditoría, sección 5 |

C1 necesita personas. C2 y C3 se revisan sobre la interfaz y **ya tienen
hallazgos**, listados en la sección 5.

---

## 2. A quién se prueba

**Tres personas, ninguna del equipo.** Con tres se detecta la mayoría de los
problemas graves; sumar más encuentra cada vez menos cosas nuevas.

El perfil que importa es el del usuario real: alguien que entiende de
territorio o de gestión pública, **no de informática**. Un agrónomo, un
funcionario municipal, un estudiante de otra carrera. Sirve cualquiera que
cumpla dos condiciones:

- No ha visto el sistema antes.
- No sabe qué es RUSLE, ni un ráster, ni PostGIS.

**Un compañero de la carrera no sirve para esta prueba.** Va a entender las
palabras técnicas que justamente estamos evaluando.

---

## 3. Las tres tareas

Se leen **en voz alta y textualmente**, tal como están escritas. Cualquier
palabra que se agregue explicando algo invalida la medición: lo que se está
probando es si la pantalla explica sola.

### Tarea 1 — Encontrar dónde falta inversión

> «Eres analista de un servicio público. Encuentra la comuna de la región
> donde el problema de erosión es más grave en relación con lo poco que ha
> recibido del programa de recuperación de suelos.»

**Se logra si:** llega al índice de pertinencia y nombra una comuna del
extremo de mayor brecha.
**Cubre:** UC-05, la pregunta central del proyecto.

### Tarea 2 — Comparar dos fuentes

> «Este sistema calcula la erosión por su cuenta, y además muestra la cifra
> oficial del organismo del Estado que la mide. Para la comuna que
> encontraste, averigua si las dos fuentes coinciden.»

**Se logra si:** usa el selector de origen y compara los dos valores.
**Cubre:** UC-06, y de paso verifica si el selector que acabamos de agregar
se descubre solo.

### Tarea 3 — Llevarse los datos

> «Necesitas incluir estos datos en un informe que estás escribiendo en
> Excel.»

**Se logra si:** encuentra el botón Exportar y abre el archivo.
**Cubre:** UC-04.

---

## 4. Cómo se observa

Una persona conduce y **otra toma notas**. Quien conduce no ayuda, no sugiere
y no explica; si preguntan, responde *«¿qué harías tú?»* y espera.

Se le pide a la persona que **piense en voz alta**. Lo que dice mientras
busca vale más que si acierta: *«no sé qué es pertinencia»* es un hallazgo,
aunque después encuentre el menú por descarte.

De cada tarea se registra:

| Dato | Para qué sirve |
|---|---|
| ¿La completó? sí / con ayuda / no | Es el criterio C1 |
| Cuánto tardó | Distingue «costó» de «no pudo» |
| Dónde se detuvo | Es lo accionable |
| Qué dijo textual | Delata qué palabra no se entendió |

**Dos reglas que hacen la diferencia:**

- **Ayuda solo después de dos minutos de bloqueo.** Antes, se espera aunque
  incomode. El silencio es la parte útil de la sesión.
- **Cuando una tarea se da por perdida, se anota y se pasa a la siguiente.**
  No se explica cómo era, porque contamina las tareas que vienen.

Sesión de **20 minutos** por persona. Más que eso cansa y los últimos datos
ya no sirven.

---

## 5. Auditoría de términos y unidades

Esto no necesita usuarios y **ya está hecho**. Se revisó el texto visible de
las siete pantallas, excluyendo código y comentarios.

### C2 — Términos técnicos sin explicación

| Término | Dónde aparece | Problema |
|---|---|---|
| **PostGIS** | `index.html`, `urbano.html` | Es el motor de base de datos. Al usuario no le aporta nada saberlo |
| **RUSLE** | `comuna.html` | Es el modelo científico. Necesita una línea que diga qué es |
| **SIRSD-S** | 5 pantallas | Sigla del programa. La conoce quien trabaja en INDAP, nadie más |
| **multicriterio**, **normalizado** | `inundaciones.html` | Jerga metodológica |

**PostGIS es el más claro de resolver: se saca.** Es un detalle de
implementación que no cambia nada para quien usa el sistema.

Para los otros tres la salida no es eliminarlos —son los nombres correctos—
sino que **cada uno aparezca explicado la primera vez**, con una línea en
lenguaje llano al lado o en un texto emergente.

### C3 — Cifras sin unidad

Hay tarjetas de indicador que muestran un número solo, como `2.148`, sin
decir de qué. La regla a aplicar es simple y verificable: **ninguna cifra
puede quedar sin unidad o sin glosa debajo.**

Caso aparte es el **índice de pertinencia**, que es adimensional y va de 0 a
1. No tiene unidad, así que necesita glosa: *«cerca de 1: mucha erosión y
poca inversión»*.

---

## 6. Criterio de aprobación

La historia se cierra cuando se cumplen las tres:

1. **Las tres personas completan las tres tareas sin ayuda.** Si alguien
   necesita ayuda en una, esa tarea se considera reprobada y hay que corregir
   la pantalla antes de volver a probar.
2. **Ningún término de la sección 5 queda sin explicación.**
3. **Ninguna cifra queda sin unidad ni glosa.**

Si una tarea falla en dos de las tres personas, **el problema es de la
interfaz, no de las personas**. Esa distinción es el propósito entero de la
prueba.

---

## 7. Qué se entrega

Una plantilla por sesión —tres en total— con las notas, y un resumen con:

- Cuántas tareas se completaron de nueve intentos
- Los problemas encontrados, ordenados por cuántas personas tropezaron
- Qué se corrigió a partir de ellos

Van a `docs/sprints/sprint-4/usabilidad/`, junto al resto de la evidencia del
sprint.

---

## 8. Cuándo

Sprint 4, que es donde el backlog ubica la HU-30. Conviene hacerla **antes de
la presentación de resultados**, no después: lo que se aprende acá todavía se
puede corregir, y un hallazgo de usabilidad encontrado por la comisión pesa
mucho más que uno que el equipo encontró y arregló solo.
