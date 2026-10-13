# Requerimientos — TerraFoco

Especificación de requerimientos funcionales y no funcionales del sistema.

Este documento no inventa requerimientos: cada uno proviene de un caso de uso
del [documento 03](03-casos-de-uso.md) o de una historia de usuario del
[documento 05](05-scrum.md), y declara si ya está implementado y dónde. Los que
están pendientes se marcan como tales en lugar de escribirse en futuro
indefinido.

**Estado al cierre de la semana 4.**

---

## 1. Alcance

| | |
|---|---|
| **Sistema** | TerraFoco — plataforma de análisis geoespacial para focalización territorial |
| **Región piloto** | Libertador General Bernardo O'Higgins, 33 comunas |
| **Módulos** | 1 — Suelos · 2 — Inundaciones · 3 — Ciudades |
| **Fuera de alcance** | Modelación hidrodinámica de crecidas; predicción de eventos; escalas menores a 30 m; regiones fuera de la cobertura de CIREN |

---

## 2. Actores

| Actor | Tipo | Qué espera del sistema |
|---|---|---|
| **Analista territorial** | Primario | Indicadores calculados sin manejar software SIG |
| **Encargado de programa** | Primario | Verificar si la inversión está bien focalizada |
| **Administrador de datos** | Primario | Mantener fuentes y procesos corriendo |
| **Repositorios satelitales** | Externo | NASA, Copernicus, USGS — proveen insumos |
| **IDE MINAGRI · INDAP** | Externo | Provee la ejecución del programa SIRSD-S |

---

## 3. Convenciones

**Identificadores.** `RF-nn` para requerimientos funcionales, `RNF-nn` para no
funcionales. Los números no se reutilizan: si un requerimiento se elimina, su
identificador queda retirado.

**Prioridad**, en notación MoSCoW: **M** debe estar · **S** debería estar ·
**C** podría estar.

**Estado.** ✅ implementado y con prueba · 🔧 implementado sin prueba
automatizada · ⏳ pendiente.

**Verificación.** Cada requerimiento declara cómo se comprueba. Un requerimiento
que no se puede verificar no es un requerimiento, es una intención.

---

## 4. Requerimientos funcionales

### 4.1 Núcleo de procesamiento

| ID | Requerimiento | Origen | Pri | Estado | Verificación |
|---|---|---|---|---|---|
| RF-01 | Almacenar información raster y vectorial con indexación espacial y versionado temporal | HU-01, UC-10 | M | ✅ | Cuatro esquemas en `bd/migraciones`; las tablas de indicadores llevan fecha de cálculo |
| RF-02 | Mantener un catálogo de fuentes con su estado y fecha de última carga | UC-10 | M | ✅ | Tabla `operacion.fuente` |
| RF-03 | Descargar imágenes Sentinel-2 del área de interés sin intervención manual | HU-02, UC-11 | M | ✅ | `motor/ingesta/sentinel.py`; prueba de enmascaramiento de nubes |
| RF-04 | Descargar el modelo digital de elevación del área | HU-03, UC-11 | M | ✅ | `motor/ingesta/srtm.py` |
| RF-05 | Descargar el inventario nacional de erosión de CIREN por cuenca | UC-06 | M | ✅ | `motor/ingesta/ciren.py`; 49 de 50 cuencas cargadas |
| RF-06 | Descargar precipitación grillada y propiedades de suelo | UC-11 | M | ✅ | `cr2met.py` y `soilgrids.py` |
| RF-07 | Reproyectar a un sistema común, remuestrear a 30 m y recortar al área de interés | HU-04 | M | ✅ | Prueba de que el cálculo aborta si el sistema de referencia es geográfico |
| RF-08 | Registrar cada ejecución con duración, estado y motivo de falla | HU-05, UC-12 | S | ✅ | Tabla `operacion.ejecucion_proceso` |
| RF-09 | Programar las ingestas según la cadencia propia de cada fuente y no ejecutar un indicador si su ingesta falló | UC-11 | S | ✅ | `motor/orquestacion`; `test_programacion.py` |

### 4.2 Datos de inversión pública

| ID | Requerimiento | Origen | Pri | Estado | Verificación |
|---|---|---|---|---|---|
| RF-10 | Incorporar la ejecución del programa SIRSD-S agregada por comuna | HU-06, HU-08 | M | ✅ | `motor/ingesta/sirsd_ide.py`; `test_sirsd.py` |
| RF-11 | Normalizar los nombres de comuna a los códigos oficiales; los registros no identificables van a una tabla de rechazos y no se descartan en silencio | HU-06 | M | ✅ | Tabla `programas.ejecucion_rechazada` |
| RF-12 | Descartar los datos personales del origen antes de almacenar | — | M | ✅ | La ingesta enumera los campos explícitamente en lugar de pedir todos; ver RNF-15 |
| RF-13 | Registrar el origen y el nivel de precisión de cada registro de ejecución | UC-07 | M | ✅ | Columna `origen`; la vista de pertinencia agrupa por ella |

### 4.3 Módulo 1 — Suelos agrícolas

| ID | Requerimiento | Origen | Pri | Estado | Verificación |
|---|---|---|---|---|---|
| RF-14 | Calcular el índice de vegetación desde Sentinel-2, descartando nube, sombra y agua | HU-09 | M | ✅ | `test_factores.py` |
| RF-15 | Derivar pendiente y factor topográfico desde el modelo de elevación | HU-10 | M | ✅ | `test_terreno.py`; incluye la prueba de que promediar LS no es promediar pendiente |
| RF-16 | Estimar la pérdida de suelo por comuna aplicando los cinco factores de RUSLE | HU-11, UC-07 | M | ✅ | `test_rusle.py`; 33 de 33 comunas con los cinco factores |
| RF-17 | Clasificar el resultado en las cinco categorías de severidad | HU-11 | M | ✅ | `test_rusle.py` |
| RF-18 | Calcular el índice de pertinencia territorial por comuna | HU-13, UC-07 | **M** | ✅ | Vista en `bd/migraciones/004`; es el resultado central del proyecto |
| RF-19 | Ante falta de superficie bonificada, calcular el índice con monto y beneficiarios marcándolo como *precisión reducida*; las comunas sin datos quedan como *sin información* y no como índice cero | HU-13 | M | ✅ | La vista distingue ambos casos |
| RF-20 | Contrastar el cálculo propio contra la línea base de CIREN y marcar las comunas fuera del dominio de validez | HU-12, UC-06 | M | ✅ | Columna `en_dominio`; ver sección 7 |

### 4.4 Módulo 2 — Inundaciones

| ID | Requerimiento | Origen | Pri | Estado | Verificación |
|---|---|---|---|---|---|
| RF-21 | Derivar acumulación de flujo y distancia a cauces desde el modelo de elevación | HU-15 | S | ✅ | `ingesta/hidrologia.py` y `ingesta/cauces.py` |
| RF-22 | Calcular un índice de susceptibilidad por comuna mediante análisis multicriterio | HU-16, UC-08 | S | ✅ | `indicadores/inundacion.py`; 33 de 33 comunas |
| RF-23 | Contrastar el índice con los eventos históricos registrados | HU-17 | S | ✅ | Eventos de DesInventar; Spearman en `docs/13-modulo-inundaciones.md` |

### 4.5 Módulo 3 — Ciudades

| ID | Requerimiento | Origen | Pri | Estado | Verificación |
|---|---|---|---|---|---|
| RF-24 | Calcular la temperatura superficial desde las bandas térmicas de Landsat | HU-18 | S | ✅ | Con ECOSTRESS en vez de Landsat (`ingesta/ecostress.py`), por comuna de la conurbación |
| RF-25 | Calcular el área verde por habitante por unidad vecinal y su déficit respecto del estándar | HU-19, UC-09 | S | ✅ | Por zona censal, porque las unidades vecinales no tienen catastro público; Censo 2024 y OSM con el estándar SIEDU. Ver `docs/18-areas-verdes.md` |

### 4.6 Presentación

| ID | Requerimiento | Origen | Pri | Estado | Verificación |
|---|---|---|---|---|---|
| RF-26 | Mostrar las comunas en un mapa coloreado según el indicador seleccionado | HU-20, UC-01 | M | ✅ | `prototipo/visor.html` con cartografía real |
| RF-27 | Permitir cambiar la capa temática sin recargar la vista | HU-21, UC-02 | M | ✅ | `prototipo/js` |
| RF-28 | Abrir la ficha de una comuna con su detalle sin salir del mapa | HU-22, UC-03 | M | ✅ | `detalle-comuna.js`; incluye el descenso al detalle intracomunal |
| RF-29 | Exponer los indicadores mediante una interfaz de programación documentada | UC-05 | M | ✅ | Cuatro rutas: `/comunas`, `/comunas/geojson`, `/pertinencia`, `/pertinencia/{id}` |
| RF-30 | Exportar un reporte de la región | HU-23, UC-04 | C | ⏳ | Primer candidato a recorte dentro de presentación |
| RF-31 | Autenticar a los usuarios para las operaciones de administración | UC-14 | S | ✅ | Clave de administración en `api/seguridad.py`; `test_seguridad.py` |

### 4.7 Transversal

| ID | Requerimiento | Origen | Pri | Estado | Verificación |
|---|---|---|---|---|---|
| RF-32 | Evaluar comparativamente al menos tres algoritmos supervisados e integrar el de mejor rendimiento | UC-13 | C | ⏳ | Alcance en revisión; ver sección 8 |

---

## 5. Requerimientos no funcionales

Cada uno declara un criterio medible. Un requerimiento no funcional sin número
no se puede aprobar ni reprobar.

### 5.1 Rendimiento

| ID | Requerimiento | Criterio medible | Estado |
|---|---|---|---|
| RNF-01 | La consulta de indicadores debe responder rápido para uso interactivo | Menos de 2 segundos para la región completa, con la base en caliente | 🔧 |
| RNF-02 | El cálculo de un factor para toda la región debe caber en una sesión de trabajo | Menos de 30 minutos en un equipo del equipo | 🔧 |
| RNF-03 | El procesamiento raster no debe agotar la memoria del equipo | El cálculo zonal se ejecuta por ventanas comunales y corre en equipos de 8 GB | ✅ |

> RNF-03 no es teórico: el cálculo original leía el ráster completo de 29 millones
> de celdas y el proceso moría sin mensaje. La lectura por ventanas fue la
> corrección.

### 5.2 Fiabilidad

| ID | Requerimiento | Criterio medible | Estado |
|---|---|---|---|
| RNF-04 | Las ingestas deben tolerar fallos transitorios del servicio de origen | Reintentos con espera creciente: 5 intentos para CIREN, 3 para el resto | ✅ |
| RNF-05 | Un fallo de ingesta no debe producir un indicador con datos parciales | El programador no ejecuta un indicador si su ingesta falló | ✅ |
| RNF-06 | Ningún proceso sobrescribe un resultado anterior | Los indicadores se insertan con marca temporal; nunca se actualizan en sitio | ✅ |
| RNF-07 | No se publica un indicador calculado sobre cobertura insuficiente | Umbral de 30 % de la superficie comunal; por debajo, el resultado se descarta | ✅ |

> RNF-06 dejó de ser una preferencia de diseño el día que un lote quedó
> contaminado con 98 celdas de una máscara incompleta: como la tabla nunca
> sobrescribe, bastó borrar ese lote para recuperar el estado anterior.

### 5.3 Precisión y validez

| ID | Requerimiento | Criterio medible | Estado |
|---|---|---|---|
| RNF-08 | El sistema debe declarar dónde su modelo es válido y dónde no | Cada comuna lleva marca de dominio de validez; los agregados se calculan por separado dentro y fuera | ✅ |
| RNF-09 | Toda cifra publicada indica su unidad de medida | Revisión de interfaz y de respuestas de la API | ✅ |
| RNF-10 | Ninguna ecuación del sistema es de elaboración propia | Cada una cita su fuente en el módulo que la implementa; ver [documento 13](13-referencias.md) | ✅ |
| RNF-11 | Los factores se almacenan por separado, de modo que la falta de una fuente no bloquee el resto | Tabla `indicadores.factor`, un registro por factor y comuna | ✅ |

### 5.4 Usabilidad

| ID | Requerimiento | Criterio medible | Estado |
|---|---|---|---|
| RNF-12 | La interfaz debe ser comprensible sin capacitación previa | Un usuario sin experiencia completa las tres tareas del plan de usabilidad sin ayuda | ⏳ |
| RNF-13 | Ningún término técnico aparece sin explicación accesible | Revisión de la interfaz contra un glosario | 🔧 |
| RNF-14 | El visor funciona sin instalar software | Navegador actualizado, sin complementos | ✅ |
| RNF-15 | El visor se degrada por niveles ante fallas | Si la API no responde, sigue mostrando la cartografía y los datos embebidos | ✅ |

### 5.5 Seguridad y privacidad

| ID | Requerimiento | Criterio medible | Estado |
|---|---|---|---|
| RNF-16 | El sistema no almacena datos personales de los beneficiarios del programa | La ingesta enumera los nueve campos que necesita en lugar de pedir todos; el nombre del agricultor y el rol de la propiedad se descartan en el origen | ✅ |
| RNF-17 | Los resultados se publican agregados por comuna | Ninguna vista expone el registro predial individual | ✅ |
| RNF-18 | Las credenciales de las fuentes no se versionan | Viven en un archivo excluido del repositorio; el repositorio incluye solo la plantilla | ✅ |
| RNF-19 | Las operaciones de administración deben requerir autenticación | Toda escritura sin la clave responde 401. Sin clave configurada, la escritura se cierra (503) en vez de quedar abierta | ✅ |

> El servicio de origen expone el nombre del agricultor y el rol de la
> propiedad. Que el sistema no los almacene es una decisión explícita del código,
> documentada en el módulo, y no una consecuencia de que el dato no estuviera
> disponible.

### 5.6 Mantenibilidad

| ID | Requerimiento | Criterio medible | Estado |
|---|---|---|---|
| RNF-20 | El motor de cálculo debe tener pruebas automatizadas que corran ante cada cambio | 104 pruebas: 102 en el motor y 2 en la interfaz de programación. La suite del motor corre en menos de un segundo | ✅ |
| RNF-21 | Toda decisión que se aparta de la fuente original queda documentada con su razón | Revisión de los módulos que implementan ecuaciones | ✅ |
| RNF-22 | El esquema evoluciona por migraciones versionadas | Cuatro migraciones numeradas; ningún cambio manual sobre la base | ✅ |

### 5.7 Portabilidad e interoperabilidad

| ID | Requerimiento | Criterio medible | Estado |
|---|---|---|---|
| RNF-23 | El entorno completo se levanta con un solo comando | Contenedores; los tres integrantes trabajan sobre las mismas versiones de las bibliotecas geoespaciales | ✅ |
| RNF-24 | Incorporar una región adicional no requiere modificar código | Las tablas están particionadas por región: basta insertar una fila | ✅ |
| RNF-25 | La interfaz de programación publica su documentación automáticamente | Especificación OpenAPI generada por el propio servicio | ✅ |
| RNF-26 | Los datos espaciales se entregan en un formato estándar | GeoJSON en el sistema de referencia geográfico mundial | ✅ |

---

## 6. Trazabilidad

Cada requerimiento crítico se puede seguir desde la necesidad hasta la prueba.

| Necesidad | Caso de uso | Historia | Requerimiento | Implementación | Prueba |
|---|---|---|---|---|---|
| Saber si la inversión llega donde el problema es grave | UC-05, UC-07 | HU-13, HU-14 | RF-18, RF-19 | Vista de pertinencia | Validación contra CIREN |
| Conocer el estado actual del suelo | UC-06 | HU-09 a HU-12 | RF-14 a RF-17, RF-20 | Motor RUSLE | `test_rusle.py`, `test_terreno.py`, `test_factores.py` |
| Mantener las fuentes al día sin trabajo manual | UC-10, UC-11, UC-12 | HU-01 a HU-05 | RF-01 a RF-09 | Ingesta y orquestación | `test_programacion.py` |
| Explorar el territorio sin software especializado | UC-01 a UC-03 | HU-20 a HU-22, HU-24 | RF-26 a RF-29 | Visor y API | Plan de usabilidad, pendiente |

---

## 7. Restricciones

| ID | Restricción | Consecuencia |
|---|---|---|
| R-01 | El inventario de CIREN cubre desde Coquimbo hasta Los Lagos | Es el techo real de escalabilidad del módulo de suelos |
| R-02 | El proyecto no dispone de presupuesto | Solo se usan fuentes públicas y software de código abierto |
| R-03 | La ecuación de erosividad empleada no está calibrada sobre los 1.000 mm anuales | Seis comunas precordilleranas quedan fuera del dominio de validez declarado |
| R-04 | La isla de calor urbana solo se mide en verano | El módulo 3 depende de imágenes de enero y febrero |
| R-05 | La ejecución del SIRSD-S publicada cubre un solo año | La serie histórica depende de una gestión institucional en curso |
| R-06 | El acceso a la descarga masiva del USGS requiere aprobación previa | Riesgo de calendario para el módulo 3 |

---

## 8. Puntos abiertos

1. **RF-32, modelado predictivo.** Aparece en el perfil del proyecto y en el
   caso de uso UC-13, pero no en los objetivos específicos del documento de
   definición. Hay que decidir si entra al alcance comprometido o se retira de
   los tres documentos.
2. **RNF-12, plan de usabilidad.** El criterio está definido pero la prueba con
   usuarios reales no se ha ejecutado.
3. **RF-31 y RNF-19, autenticación.** Resueltas con una sola clave de
   administración, porque hay un solo rol que escribe. Si aparecen más roles,
   la dependencia `requiere_admin` se reemplaza por tokens con identidad sin
   tocar las rutas.

---

## 9. Orden de recorte

Si el calendario se estrecha, los requerimientos se sacrifican en este orden:

1. **RF-32** — modelado predictivo
2. **RF-24, RF-25** — módulo de ciudades
3. **RF-21 a RF-23** — módulo de inundaciones
4. **RF-30** — exportación de reportes

**No se recorta RF-18**, el índice de pertinencia territorial: es el
requerimiento que responde la pregunta del proyecto y el único que no existe en
ninguna otra herramienta.
