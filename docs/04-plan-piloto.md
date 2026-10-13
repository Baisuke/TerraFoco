# Plan de pilotaje — TerraFoco

Este documento responde el entregable *"con quién pilotearán la idea"*. No basta con
nombrar una institución: hay que justificar por qué es la adecuada, qué aporta y qué
pasa si no responde.

---

## 1. Situación actual

El equipo trabaja con la **orientación técnica de profesionales del departamento de
datos de INDAP**. Ese vínculo es el eje del pilotaje y explica varias decisiones del
proyecto: la elección del programa SIRSD-S como objeto de análisis, el énfasis en la
trazabilidad de la ejecución presupuestaria por comuna y la alineación de la interfaz
con la identidad visual del organismo.

**Naturaleza del vínculo, con precisión:**

| Aspecto | Estado |
|---|---|
| Tipo de colaboración | Orientación técnica de profesionales del departamento de datos |
| Formalización | Sin convenio ni carta de compromiso institucional |
| Acceso a datos del SIRSD-S | **Entrega comprometida, en proceso** |
| Independencia del análisis | Los indicadores y conclusiones son responsabilidad del equipo |

> Esta distinción importa y conviene declararla tal cual: el equipo recibe apoyo
> técnico, no patrocinio institucional. Decirlo con esa precisión es más sólido —y
> más honesto— que presentar a INDAP como contraparte formal cuando todavía no lo es.

---

## 2. Qué necesitamos de una contraparte

El piloto no requiere que la institución financie ni desarrolle nada. Requiere tres
cosas concretas:

1. **Validación del problema** — que confirme que la pregunta que resuelve el sistema
   es una pregunta que efectivamente se hacen.
2. **Validación de los indicadores** — que revise si el índice de pertinencia tiene
   sentido desde su experiencia en el territorio.
3. **Prueba de usabilidad** — que una o dos personas usen el visor y digan si
   entienden lo que ven.

Con dos reuniones de una hora y una sesión de prueba, el piloto está cumplido.

---

## 3. Contraparte principal — Departamento de datos de INDAP

**Rol en el proyecto:** validación metodológica de los indicadores y provisión de los
datos de ejecución del programa.

| A favor | Puntos de atención |
|---|---|
| Es la contraparte técnicamente más pertinente: conoce el programa por dentro | El vínculo es con profesionales, no con la institución. Puede cambiar si esas personas rotan |
| Ya está establecido y operando: no hay que conseguirlo desde cero | La entrega de datos está comprometida pero **aún no concretada** |
| Es el destinatario natural del producto final | Requiere cuidar la independencia del análisis (ver punto 5) |
| Facilita el acceso a datos que por la vía formal tardan 20 días hábiles | |

**Acciones pendientes**

- [ ] Concretar la entrega de los datos de ejecución del SIRSD-S — **responsable: Carla Morales**
- [ ] Acordar el nivel de agregación: comunal es suficiente y evita datos personales
- [ ] Agendar una sesión de validación del índice de pertinencia
- [ ] Solicitar, si es posible, una **carta de colaboración** que respalde el vínculo
      en el informe final

> El último punto es el de mayor retorno: una carta de una línea que diga *"el
> departamento de datos de INDAP ha brindado orientación técnica a este proyecto"*
> transforma un vínculo informal en evidencia citable.

---

## 4. Contrapartes complementarias

Ninguna reemplaza a la principal; cubren ángulos que el departamento de datos no
cubre.

### Municipio de la región piloto — la mirada del usuario territorial

Los candidatos naturales son las comunas que el análisis identifica con mayor brecha:
**Litueche, Marchigüe, La Estrella, Pumanque o Paredones**.

| A favor | En contra |
|---|---|
| Aporta la perspectiva de quien vive el problema en el territorio | No siempre tienen personal técnico especializado en SIG |
| Contacto directo, sin intermediarios | La rotación de personal puede cortar la interlocución |
| Sirve para la prueba de usabilidad con un usuario no informático | |

### CIREN — la validación de la línea base

| A favor | En contra |
|---|---|
| Es quien elaboró el inventario de erosión sobre el que se construye el módulo 1 | Organismo nacional: tiempos de respuesta más largos |
| Una validación suya tiene mucho peso en la defensa | Puede requerir canal institucional formal |

### Duoc UC — respaldo garantizado

Un docente del área de recursos naturales o medio ambiente como contraparte técnica
interna. Disponibilidad prácticamente asegurada y cero fricción administrativa. Sirve
sobre todo para validar los supuestos agronómicos, que es el punto más débil del
equipo.

---

## 5. Independencia del análisis

El proyecto **evalúa la focalización territorial de un programa de INDAP**, y al mismo
tiempo recibe orientación técnica de profesionales de INDAP. Eso no es un problema
—es lo que hace viable el proyecto— pero exige explicitar cómo se preserva la
independencia:

1. **Los criterios del índice los define el equipo**, y quedan documentados antes de
   ver los resultados. No se ajustan después para suavizar un hallazgo incómodo.
2. **La línea base es externa**: el inventario de erosión es de CIREN, no de INDAP.
3. **Los resultados se publican completos**, incluidas las comunas con brecha
   crítica, sin filtrar.
4. **La validación metodológica se busca también fuera de INDAP** (CIREN, docente
   Duoc), no solo con la institución evaluada.

> Plantear esto por iniciativa propia en la defensa es un punto a favor: demuestra
> criterio metodológico y anticipa la pregunta antes de que la hagan.

---

## 6. Estrategia y regla de decisión

| Prioridad | Contraparte | Rol | Estado |
|---|---|---|---|
| 1 | Departamento de datos de INDAP | Validación de indicadores y provisión de datos | **Activo, entrega en proceso** |
| 2 | Municipio de la región piloto | Validación del problema y prueba de usabilidad | Por contactar |
| 3 | CIREN | Validación de la línea base | Por contactar |
| Respaldo | Docente Duoc UC del área | Validación de supuestos agronómicos | Por contactar |

**Regla de decisión sobre los datos:** si al **viernes de la semana 6** la entrega
comprometida no se ha concretado, se presenta la solicitud de acceso a información
pública como respaldo, para no consumir el plazo legal de 20 días hábiles dentro del
período de desarrollo.

---

## 7. Plantilla de correo para las contrapartes complementarias

> **Asunto:** Proyecto de título Duoc UC — análisis satelital de erosión de suelos en la Región de O'Higgins
>
> Estimado/a [Nombre o "Encargado/a de Medio Ambiente"]:
>
> Somos Bastián Cárcamo, Carla Morales y Antonio Lankin, estudiantes de Ingeniería en
> Informática de Duoc UC. Estamos desarrollando nuestro proyecto de título, que
> consiste en una plataforma que procesa imágenes satelitales públicas para estimar
> el estado de erosión del suelo en la Región de O'Higgins, y contrastarlo con la
> inversión pública destinada a recuperarlo.
>
> El sistema utiliza datos abiertos de NASA, Copernicus, CIREN e IDE Chile, y contamos
> con la orientación técnica de profesionales del departamento de datos de INDAP.
>
> Nos gustaría contar con [nombre de la institución] como contraparte para validar
> la utilidad del análisis. Esto **no implica costo ni compromiso de recursos**:
> concretamente, solicitamos dos reuniones de aproximadamente una hora durante el
> semestre, para que nos indiquen si la información que produce el sistema les
> resulta pertinente y comprensible.
>
> Quedamos atentos a su disponibilidad. Con gusto podemos presentar el avance de
> forma presencial o remota.
>
> Cordialmente,
> [Nombres] — Escuela de Ingeniería Informática, Duoc UC
> [Correo de contacto] · Docente guía: Rocío Contreras Aguila

---

## 8. Evidencia a resguardar

Para el informe final hay que documentar el pilotaje. Guardar desde el primer día:

- [ ] Correos y respuestas con el departamento de datos de INDAP
- [ ] Actas de reunión: fecha, asistentes, temas tratados, acuerdos
- [ ] Retroalimentación recibida sobre los indicadores
- [ ] Registro de la entrega de datos: qué se recibió, en qué formato y cuándo
- [ ] Resultados de la prueba de usabilidad: tareas, observaciones, tiempos
- [ ] Carta de colaboración, si se consigue

> Lo más valioso para la defensa es poder decir: *"esto lo revisó el departamento de
> datos de INDAP y nos dijo [observación concreta], por lo que cambiamos [decisión]."*
> Eso convierte el piloto en evidencia real, no en un trámite.
