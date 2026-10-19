# Perfil del Proyecto — TerraFoco

> **Nota sobre el nombre.** `TerraFoco` fue seleccionado tras verificar que los
> nombres alternativos presentaban colisión con marcas existentes: *GeoTerra*
> coincide con una empresa estadounidense de cartografía aérea y SIG, partner de
> Esri; *TerraFirme* con TerraFirma Software, dedicada a modelamiento de riesgo
> ambiental; y *AgroMétrica* con agrometrica.com, del mismo rubro. Queda pendiente
> la verificación formal en INAPI y la disponibilidad del dominio en NIC Chile.

---

## 1. Identificación

| Campo | Detalle |
|---|---|
| **Nombre** | TerraFoco |
| **Descriptor** | Sistema de Análisis Geoespacial para la Focalización Territorial de la Inversión Pública |
| **Asignatura** | Capstone — Proyecto APT |
| **Escuela** | Ingeniería Informática, Duoc UC |
| **Docente guía** | Rocío Contreras Aguila |
| **Integrantes** | Bastián Cárcamo · Carla Morales · Antonio Lankin |
| **Período** | Segundo semestre 2026 |
| **Región piloto** | Región del Libertador General Bernardo O'Higgins |
| **Contraparte técnica** | Departamento de datos de INDAP — orientación técnica, sin patrocinio institucional |

**Áreas de desempeño:** Análisis y Evaluación de soluciones informáticas ·
Desarrollo de Software · Gestión de Proyectos Informáticos.

---

## 2. Problema

Chile enfrenta tres problemáticas territoriales de naturaleza analítica común: la
degradación de sus suelos agrícolas, la exposición recurrente de territorios a
inundación, y el deterioro térmico y de cobertura vegetal en sus ciudades. Las tres
pueden caracterizarse con información satelital pública, y las tres reciben
inversión del Estado.

El problema no es la ausencia de datos, sino tres brechas:

**Brecha 1 — El dato ambiental existe pero es inaccesible en la práctica.**
SRTM, Sentinel-2, Landsat, CIREN e IDE Chile son de acceso público y gratuito, pero
se distribuyen en GeoTIFF, shapefile y servicios WMS/WFS cuyo aprovechamiento exige
conocimientos especializados de sistemas de información geográfica.

**Brecha 2 — Las plataformas públicas son visores, no herramientas de análisis.**
Geoportal.cl, IDE Chile y el visor de CIREN permiten *ver* capas preexistentes. No
calculan indicadores derivados, no superponen capas de distinta naturaleza ni
agregan métricas por unidad administrativa.

**Brecha 3 — El dato ambiental y el dato administrativo no se cruzan.**
Es la brecha central. El estado del territorio y la inversión pública destinada a
intervenirlo residen en sistemas separados, con custodios y lógicas distintas.

### Pregunta de investigación

> **¿La inversión pública está llegando a los territorios donde el problema es más
> severo, según la evidencia satelital disponible?**

Sin esa respuesta, la asignación territorial de recursos no puede evaluarse,
focalizarse ni justificarse con evidencia objetiva.

---

## 3. Solución propuesta

Una plataforma web compuesta por un **núcleo de procesamiento geoespacial
reutilizable** y **tres módulos analíticos** que se apoyan sobre él. La arquitectura
permite abordar tres dominios sin triplicar el esfuerzo de infraestructura, porque
la ingesta, normalización y almacenamiento del dato raster es común a todos.

| Componente | Función |
|---|---|
| **Núcleo** | Ingesta automatizada, normalización, almacenamiento espacial y API |
| **Módulo 1 — Suelos** | Erosión actualizada y cruce con la inversión del programa SIRSD-S |
| **Módulo 2 — Inundaciones** | Índice de susceptibilidad por análisis multicriterio |
| **Módulo 3 — Ciudades** | Temperatura superficial y déficit de áreas verdes |
| **Transversal** | Evaluación comparativa de tres algoritmos de aprendizaje supervisado |
| **Presentación** | Visor cartográfico y tablero de indicadores |

### El aporte original

El módulo insignia toma como referencia el modelo **RUSLE**
(`A = R × K × LS × C × P`), estándar internacional para estimar pérdida de suelo.
CIREN ya lo aplicó a Chile, de modo que existe una línea base oficial contra la cual
validar. El aporte no es replicar ese cálculo, sino dos acciones que la línea base
no cubre:

1. **Actualizar el factor C** (cobertura vegetal) con imágenes Sentinel-2 recientes,
   para estimar la evolución del estado erosivo respecto de la línea base.
2. **Cruzar con el factor P** incorporando la ejecución real del programa SIRSD-S,
   y construir un **índice de pertinencia territorial**.

El fundamento del cruce no es arbitrario: **el factor P del modelo representa las
prácticas de conservación de suelo, que es exactamente lo que financian los
programas de INDAP y MINAGRI.** La variable a evaluar ya estaba dentro del modelo
científico.

---

## 4. Objetivos

### Objetivo general

Desarrollar una plataforma web de análisis geoespacial que integre datos satelitales
y geoespaciales públicos para generar indicadores de diagnóstico territorial en los
ámbitos de erosión de suelos, susceptibilidad a inundaciones y condición térmica
urbana, y que permita evaluar la pertinencia territorial de la inversión pública
asociada.

### Objetivos específicos

1. Diseñar e implementar un modelo de datos geoespacial que soporte almacenamiento,
   versionado y consulta eficiente de información raster y vectorial multitemporal.
2. Construir un motor de ingesta y preprocesamiento automatizado.
3. Implementar un proceso ETL que consolide la ejecución del programa SIRSD-S
   publicada por INDAP y el SAG.
4. Desarrollar el módulo de erosión actualizando el factor de cobertura vegetal y
   contrastándolo con la línea base de CIREN.
5. Definir, calcular y validar el índice de pertinencia territorial.
6. Desarrollar el módulo de susceptibilidad a inundaciones validado contra registros
   históricos.
7. Desarrollar el módulo urbano generando un indicador de déficit de áreas verdes.
8. Evaluar comparativamente al menos tres algoritmos supervisados e integrar el de
   mejor rendimiento.
9. Implementar visor cartográfico y tablero para usuarios sin formación informática.
10. Ejecutar plan de pruebas y proceso de validación y verificación.

---

## 5. Alcance

| Sí contempla | No contempla |
|---|---|
| Una región piloto acotada | Cobertura nacional |
| Resolución espacial de 30 m | Análisis submétrico o LiDAR |
| Módulo de erosión con profundidad completa | Trabajo de campo o muestreo de suelos |
| Inundaciones a nivel de susceptibilidad estática | Modelo hidrodinámico de crecidas |
| Módulo urbano en una ciudad | Todas las ciudades de la región |
| Análisis por comuna o distrito censal | Análisis predial con datos personales |
| Comparación de tres algoritmos supervisados | Arquitecturas de aprendizaje profundo |
| Despliegue en ambiente de prueba | Puesta en producción institucional |

### Prioridades de entrega

| Prioridad | Componente | Compromiso |
|---|---|---|
| Crítica | Núcleo de procesamiento | Innegociable |
| Crítica | Módulo 1 — Erosión y pertinencia | Profundidad completa |
| Alta | Visor y tablero | Innegociable |
| Media | Módulo 2 — Inundaciones | Acotado a susceptibilidad estática |
| Media | Módulo 3 — Urbano | Acotado a una ciudad |
| Media | Componente predictivo | Tres algoritmos, integrar el mejor |

---

## 6. Fuentes de datos

| Fuente | Insumo | Estado |
|---|---|---|
| NASA — SRTM | DEM 30 m | ✅ Público |
| Copernicus — Sentinel-2 | Multiespectral | ✅ Público |
| USGS — Landsat | Banda térmica | ✅ Público |
| CIREN | Inventario Nacional de Erosión, shapefile | ✅ Acceso liberado |
| IDE MINAGRI | ~140 capas agrológicas y de clima | ✅ Descarga directa |
| IDE Chile | Límites administrativos, hidrografía | ✅ WMS/WFS |
| INDAP · SAG | SIRSD-S — entrega directa gestionada con el departamento de datos | 🔄 Comprometida, en proceso — ver riesgo R1 |
| ODEPA | Series consolidadas del SIRSD | ✅ Público |
| SENAPRED | Eventos históricos de inundación | ✅ Público |

---

## 7. Tecnología

| Capa | Tecnología |
|---|---|
| Procesamiento geoespacial | Python — GDAL, Rasterio, GeoPandas, RichDEM |
| Base de datos | PostgreSQL + PostGIS |
| Aprendizaje automático | scikit-learn, XGBoost |
| Backend / API | FastAPI |
| Frontend | React + MapLibre GL JS |
| Servicios OGC | GeoServer |
| Tablero | Power BI o Apache Superset |
| Entorno y despliegue | Git, GitHub, Docker |
| Metodología | CRISP-DM para el ciclo analítico + Scrum para la gestión |

---

## 8. Equipo

| Integrante | Rol técnico | Rol Scrum |
|---|---|---|
| Bastián Cárcamo | Ingeniería de datos y geoprocesamiento | Scrum Master |
| Carla Morales | Backend y modelado analítico | **Product Owner** — mantiene el vínculo con INDAP |
| Antonio Lankin | Frontend, visualización y calidad | Development Team |

Los tres ejes técnicos son diferenciables y de carga equivalente, lo que justifica la
conformación de un equipo de tres integrantes.

---

## 9. Riesgos

| ID | Riesgo | Nivel | Mitigación |
|---|---|---|---|
| R1 | Los datos de ejecución del SIRSD-S no llegan a tiempo o sin el detalle requerido | **Medio** | El departamento de datos de INDAP comprometió la entrega y está en gestión. Respaldo: solicitud de acceso a información pública. Último recurso: construir el índice con monto y beneficiarios |
| R2 | Volumen de datos raster excede la capacidad disponible | Medio | Región piloto estricta, remuestreo homogéneo, procesamiento por teselas |
| R3 | Curva de aprendizaje de herramientas geoespaciales | Medio | Sprint 0 extendido a tres semanas para capacitación |
| R4 | Registros históricos insuficientes para validar inundaciones | Medio | Fuentes alternativas; en su defecto, declarar el índice como no calibrado |
| R5 | Sobrecarga de alcance por cantidad de módulos | Medio | Priorización formal de la sección 5 |
| R6 | Interpretación agronómica incorrecta | Bajo | RUSLE y línea base CIREN como marco validado; consulta a profesionales del área |

---

## 10. Criterios de éxito

- El motor ingiere, normaliza y almacena automáticamente al menos tres fuentes.
- La estimación de erosión presenta correspondencia verificable con la línea base
  CIREN en zonas sin cambio de cobertura.
- El índice de pertinencia se calcula para las 33 comunas de la región piloto e
  identifica casos de desalineación.
- El índice de susceptibilidad clasifica correctamente una proporción mayoritaria de
  los eventos históricos registrados.
- El algoritmo seleccionado supera un umbral predefinido y a los otros dos evaluados.
- Un usuario sin formación informática completa las tareas del plan de usabilidad.
- El plan de pruebas se ejecuta completo con registro y resolución de defectos.

---

## 11. Justificación como proyecto de título

| Criterio | Cumplimiento |
|---|---|
| Integración de competencias | Integra cuatro competencias del perfil de egreso |
| Situación real o simulada | Real: fuentes públicas existentes, programas vigentes, pregunta sin respuesta pública |
| Factibilidad | Alcance delimitado por región, resolución y profundidad diferenciada |
| Originalidad | No es comercio electrónico, agenda ni carro de compra. Los geoportales nacionales no realizan el cruce que constituye el aporte |
| Profundidad técnica | Procesamiento raster, álgebra de mapas, modelamiento hidrológico, modelo científico validado, ML supervisado, base de datos espacial |
| Trabajo grupal justificado | Tres ejes técnicos diferenciables de carga equivalente |

### Proyección

La arquitectura modular permite incorporar nuevos dominios sin rediseñar el núcleo:
riesgo de incendios forestales, disponibilidad hídrica, evaluación de otros programas
públicos con expresión territorial y ampliación geográfica al resto del país.
