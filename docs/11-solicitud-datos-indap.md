# Solicitud de datos a INDAP — ejecución del SIRSD-S

Evidencia de la gestión con la contraparte institucional. Contiene el texto de
la solicitud, el razonamiento detrás de su redacción, la bitácora del trámite y
el plan alternativo.

**Responsable de la gestión:** Carla Morales (Product Owner, vínculo con INDAP).

---

## 1. Por qué este dato es crítico

El proyecto compara dos ejes:

| Eje | Fuente | Estado |
|---|---|---|
| **Necesidad** — degradación del suelo | Inventario de erosión de CIREN | ✅ Cargado, 33 comunas |
| **Inversión** — recuperación de suelos | Ejecución del SIRSD-S | ⬜ **Este trámite** |

Sin el segundo eje **no hay pregunta que responder**: el índice de pertinencia
territorial es precisamente el cruce entre ambos. Es el único insumo del
proyecto que no se puede descargar y que depende de un tercero, y por eso es el
riesgo principal del cronograma.

---

## 2. Qué se solicita

Una fila por **comuna, año y práctica**, con:

| Campo | Detalle | ¿Imprescindible? |
|---|---|---|
| Comuna | Nombre o código INE | **Sí** |
| Año | Idealmente 2015 a 2025 | **Sí** |
| Superficie bonificada | Hectáreas | **Sí** |
| Monto bonificado | Pesos | Deseable |
| Beneficiarios | Cantidad | Deseable |
| Práctica o subprograma | Tipo de intervención | Deseable |

La práctica importa más de lo que parece: el esquema asocia cada una al factor
de RUSLE sobre el que actúa (`programas.practica.factor_rusle`). Las de
cobertura vegetal actúan sobre C, las obras de conservación sobre P y las
enmiendas sobre K. Sin ese campo, todas se tratan igual y se pierde el vínculo
entre la política pública y el modelo físico.

**No se solicita ningún dato personal:** ni RUT, ni nombres, ni ubicación de
predios. Solo agregados comunales.

---

## 3. Texto de la solicitud

> **Asunto:** Solicitud de datos agregados de ejecución SIRSD-S — Proyecto de
> título Duoc UC, Región de O'Higgins
>
> Estimado/a [nombre]:
>
> Junto con saludar, me dirijo a usted en el marco de nuestro proyecto de
> título de Ingeniería en Informática en Duoc UC, que desarrollamos con la
> orientación técnica del departamento de datos de INDAP.
>
> El proyecto construye un sistema que compara el **estado real de degradación
> del suelo** con la **distribución territorial de la inversión pública** en
> recuperación de suelos, para identificar comunas donde la necesidad es alta y
> la intervención baja.
>
> **Ya tenemos resuelta la mitad del análisis.** Cargamos el Inventario
> Nacional de Erosión de CIREN para las 33 comunas de la Región de O'Higgins,
> procesando cerca de dos millones de polígonos, y obtuvimos la pérdida de
> suelo promedio por comuna. Los resultados son consistentes con la geografía
> conocida: el secano de Cardenal Caro presenta 14,1 t/ha/año frente a 9,5 del
> valle central de Cachapoal.
>
> Para completar el cruce necesitamos la **ejecución del programa SIRSD-S**,
> con el siguiente detalle: comuna, año, superficie bonificada en hectáreas,
> monto bonificado, número de beneficiarios y práctica o subprograma.
>
> **Solicitamos exclusivamente datos agregados por comuna.** No requerimos RUT,
> nombres, ubicación de predios ni ningún antecedente que permita identificar a
> personas o explotaciones individuales. Una fila por comuna, año y práctica es
> suficiente para todo el análisis.
>
> Si la entrega completa no fuera posible, **el mínimo que nos permite avanzar
> es comuna, año y superficie bonificada**. Con eso el sistema ya funciona, y
> así lo declara en pantalla cuando el dato es parcial.
>
> El formato puede ser CSV o Excel, en la estructura que les resulte más simple
> de exportar; nuestro proceso de carga se adapta a distintas denominaciones de
> columnas.
>
> Nuestro calendario académico contempla la defensa en la última semana de
> noviembre, por lo que agradeceríamos contar con la información antes del
> [fecha].
>
> Por último, ofrecemos compartir los resultados con el equipo: el índice de
> focalización por comuna y el detalle metodológico completo. Cabe precisar que
> se trata de un ejercicio académico y que las conclusiones son de
> responsabilidad exclusiva del equipo; no constituye un producto ni una
> evaluación oficial de INDAP.
>
> Quedamos atentos a cualquier consulta.
>
> Saluda atentamente,
>
> **Carla Morales**
> Estudiante de Ingeniería en Informática
> Escuela de Ingeniería Informática — Duoc UC
> Proyecto de título APT122 · Docente guía: Rocío Contreras Aguila

---

## 4. Por qué está redactado así

**El párrafo sobre datos personales va antes de que pregunten.** La razón más
frecuente por la que una solicitud de este tipo se traba no es la negativa: es
que quien la recibe no sabe si puede entregar el dato sin infringir la
normativa de datos personales, y ante la duda no responde. Declarar de entrada
que solo se piden agregados comunales le quita ese problema de encima.

**Se muestra el avance, no la intención.** Con el inventario de erosión ya
cargado, la solicitud no viene de un proyecto por empezar sino de uno al que le
falta una pieza. Los números concretos hacen ese trabajo sin adjetivos.

**Se declara un mínimo aceptable.** Evita el todo o nada: si no pueden entregar
monto ni beneficiarios, que no descarten la solicitud completa.

**Se ofrece algo de vuelta**, y al mismo tiempo se acota el alcance
institucional para no comprometer a INDAP con conclusiones que no son suyas.

---

## 5. Bitácora del trámite

| Fecha | Acción | Estado |
|---|---|---|
| | Envío de la solicitud | ⬜ |
| | Confirmación de recepción | ⬜ |
| | Respuesta | ⬜ |
| | Entrega del archivo | ⬜ |
| | Carga en el sistema | ⬜ |

*Completar a medida que avance. Es evidencia de la gestión con la contraparte.*

---

## 6. Plan alternativo

**No se depende de la respuesta.** Las planillas de **Transparencia Activa** de
INDAP son públicas y se descargan hoy. Son menos precisas —con frecuencia sin
superficie bonificada—, pero el sistema está preparado:

- `programas.ejecucion.precision_dato` distingue `completa` de `reducida`
- El cargador marca cada fila según lo que traiga
- El prototipo lo declara en pantalla

Cuando llegue el dato de INDAP se recarga y el indicador sube de precisión, sin
cambiar una línea de código.

La regla de decisión: **si al cierre del Sprint 2 no hay respuesta, se carga
Transparencia Activa y se sigue.** Esperar no es una opción con la defensa en
noviembre.
