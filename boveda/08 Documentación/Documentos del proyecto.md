# Documentos del proyecto

**Carpeta:** `docs/`. La documentación académica y técnica, numerada por orden de aparición en el semestre. Diagramas en Mermaid (se ven en GitHub y en Obsidian), PlantUML (`docs/uml/casos-de-uso.puml`) y BPMN 2.0 (`docs/uml/proceso-ciclo-analitico.bpmn`, se abre en bpmn.io o Camunda Modeler). Las imágenes generadas están en `docs/img/` (arquitectura 1–6, casos de uso, BPMN, sprints).

> [!tip] Qué leer primero
> 01 (perfil) → 02 (arquitectura) → 13 (inundaciones) → 17 (serie SIRSD-S) → 15 (requerimientos). Son los que más preguntas responden en una defensa.

---

## README.md
Guía de trabajo de la carpeta: índice de documentos, qué herramienta usar para cada diagrama (Mermaid, PlantUML, draw.io) y cómo generarlos, convenciones del repositorio y de los mensajes de commit.

## 01-perfil-del-proyecto.md
**El documento base.** Nombre (y por qué *TerraFoco*: los alternativos chocaban con marcas existentes), problema y **pregunta de investigación**, solución y **aporte original** (la política pública vive dentro del modelo físico vía C y P), objetivo general y **10 objetivos específicos**, alcance y prioridades, fuentes de datos, tecnología, equipo, riesgos, **criterios de éxito** (≥ 3 fuentes automáticas; correspondencia con CIREN; índice para las 33 comunas; inundación que clasifica una proporción mayoritaria de eventos; usuario sin formación completa las tareas; pruebas ejecutadas) y justificación como proyecto de título. → [[Qué es TerraFoco]]

## 02-arquitectura.md
Seis diagramas Mermaid: **contexto** (actores y sistemas externos), **componentes** (motor, API, base, visor y responsabilidades), **flujo del módulo de erosión**, **secuencia** de una consulta, **despliegue** y **modelo de datos conceptual**, más las decisiones de arquitectura. → [[Arquitectura]]

## 03-casos-de-uso.md
Actores (analista territorial, encargado de programa, administrador de datos), diagrama UML y **14 casos de uso**: UC-01 visor, UC-02 cambiar capa, UC-03 ficha de comuna, UC-04 exportar, **UC-05 consultar pertinencia (crítica)**, UC-06 comparar con CIREN, **UC-07 calcular pertinencia (crítica)**, UC-08 inundación, UC-09 térmico urbano, UC-10 catálogo de fuentes, **UC-11 ejecutar ingesta (crítica)**, UC-12 bitácora, UC-13 entrenar modelos, UC-14 autenticarse. Especifica en detalle UC-05, UC-07 y UC-11 y los traza al prototipo.

## 04-plan-piloto.md
**Con quién se pilotea:** la contraparte principal es el **departamento de datos de INDAP** (orientación técnica; explica la elección del SIRSD-S). Contrapartes complementarias: un municipio de la región (mirada del usuario territorial), CIREN (validación de la línea base) y Duoc UC como respaldo. Independencia del análisis, regla de decisión si nadie responde, plantilla de correo y evidencia a resguardar. → [[SIRSD-S e INDAP]]

## 05-scrum.md
Metodología dual **CRISP-DM + Scrum**. Roles (PO Carla Morales, SM Bastián Cárcamo, los tres desarrollan), ceremonias y cadencia, estimación, **8 épicas** (E1 núcleo, E2 inversión, E3 erosión y pertinencia, E4 inundación, E5 urbano, E6 presentación, E7 modelado predictivo, E8 calidad), backlog con historias de usuario (HU-xx), planificación de sprints, Definition of Ready / Done y evidencia por sprint.

## 06-proceso-bpmn.md
Modelo **BPMN 2.0** del **ciclo analítico territorial** (revisión de fuentes → procesamiento → validación → publicación): el único proceso que cruza los tres roles, dos organismos externos, decisiones, paralelo, un plazo legal (solicitud de información) y reproceso. Explica participantes, calles, fases, decisiones y excepciones. → [[Programador de tareas]]

## 07-plan-desarrollo.md
**Sprint 0:** pasar del prototipo al sistema real sin lógica de negocio todavía. Estructura del código, entorno reproducible con Docker, base de datos y sus decisiones, orden de ataque y **el hito** (comunas en PostGIS → API → visor), verificación, riesgos, convenciones y qué no hacer.

## 08-guia-de-arranque.md
Cómo conseguir **credenciales** (NASA Earthdata, Copernicus, USGS) y cargar datos **en orden de dependencia**: primero lo vectorial (límites comunales, la victoria rápida), después el circuito completo, CIREN y MINAGRI, el primer ráster, Sentinel-2 y el factor C, el SIRSD-S. El `.env`, calendario sugerido y **errores frecuentes**. Regla: *empezar por lo vectorial, no por lo ráster*.

## 09-orquestacion.md
Quién dispara qué y cada cuánto: el problema (las fuentes no comparten cadencia; el BPMN suponía un ciclo trimestral único), las cadencias por fuente, **el principio que hace intercambiable al orquestador**, por qué no Airflow, cómo usar el planificador y qué pasa cuando algo falla. → [[Programador de tareas]]

## 10-como-ejecutar.md
Guía corta para levantar y ver el avance: servicios, el prototipo y **qué dice el badge**, el estado del sistema, la API, consultar la base, cargar datos, pruebas y problemas frecuentes. → [[Cómo correrlo]]

## 11-solicitud-datos-indap.md
Evidencia de la gestión con INDAP para obtener la ejecución del SIRSD-S: por qué el dato es crítico, qué se pidió, **el texto de la solicitud y por qué está redactado así**, bitácora del trámite y **plan alternativo** (fuentes públicas: IDE MINAGRI). Responsable: Carla Morales.

## 12-demo-en-codespaces.md
Cómo **demostrar escritura y lectura** desde cualquier navegador con GitHub Codespaces (pensado para la entrega del 20 % funcionando): por qué Codespaces, preparación una vez antes del día, **guion de tres minutos** (correr una ingesta en vivo y ver la bitácora sumar una fila), qué hacer si algo falla y límites. → [[Despliegue y Codespaces#.devcontainer]]

## 13-modulo-inundaciones.md
**Módulo 2 completo:** qué es y qué no es, las seis variables, **iteración 1** (pesos a priori, ρ −0,16, peor que el azar), **iteración 2** (recalibración: acumulación y curvatura 50/50, cuartiles; 68 % de eventos en Alta/Muy alta vs. 52 % del azar), límites, lo que hace el visor dentro de la comuna (umbral, exposición, por qué esta celda, explorador de pesos), recálculo automático con calibración, y **comandos para reproducir**. → [[Susceptibilidad a inundación]] · [[Validación y Spearman]]

## 13-referencias.md
Referencias en **APA 7**, solo las que sustentan una decisión: modelo de erosión (Renard et al. 1997, Wischmeier & Smith 1978), erosividad (Renard & Freimund 1994, Arnoldus 1980), cobertura (Van der Knijff et al. 2000), conjuntos de datos (NASADEM, Sentinel-2, CIREN, CR2MET, SoilGrids…), metodología (CRISP-DM, Scrum) y marco institucional (SIRSD-S, Ley 20.412). Cada una también está citada en el docstring del módulo que la usa.

## 14-carta-gantt.md
Planificación de **18 semanas** alineada al cronograma de la asignatura: hitos del calendario y 10 actividades (definición y fuentes; infraestructura y modelo de datos; cartografía y línea base; motor RUSLE; ingesta del programa; índice de pertinencia; visor y detalle predial; validación; módulos 2 y 3; informe y presentación) con su **criterio de recorte**.

## 15-requerimientos.md
**Requerimientos funcionales (RF) y no funcionales (RNF)**, cada uno trazado a un caso de uso o historia y con su estado (implementado y dónde, o pendiente): núcleo, inversión, módulos 1–3, presentación, transversal; rendimiento, fiabilidad, precisión, usabilidad, seguridad y privacidad (RF-29 lectura pública, RF-31/RNF-19 autenticación), mantenibilidad, portabilidad. Restricciones, puntos abiertos y orden de recorte.

## 16-plan-de-usabilidad.md
Cierra la **HU-24** ("comprensible sin capacitación"): qué se evalúa, a quién, **tres tareas** (encontrar dónde falta inversión, comparar dos fuentes, llevarse los datos), cómo se observa, auditoría de términos técnicos y cifras sin unidad, criterio de aprobación y entregables. Es la única historia *Must* que no se cierra escribiendo código.

## 17-serie-sirsd.md
De dónde sale cada número de la **inversión del índice** desde la migración 013: la serie 2012–2025 (DWH_ODS de INDAP), su validación contra la entrega oficial, la anomalía 6307/2017, el paso a UF (y los errores limpiados en la serie de la UF), el denominador (ha con erosión severa), la normalización logarítmica, archivos que no se usan, **privacidad**, cómo se ve en la interfaz y la **brecha en UF y focalización por año**. → [[Índice de pertinencia]] · [[SIRSD-S e INDAP]]

## 18-areas-verdes.md
**Módulo 3, objetivo 7:** fuentes (Censo 2024, OSM), qué cuenta como área verde pública (contrastado con el SIEDU), las tres medidas, resultados por comuna y en la conurbación de Rancagua, completitud de OSM y orden de ejecución. → [[Áreas verdes y calor urbano]]

## 19-despliegue.md
Despliegue en un servidor público con el compose de producción: qué corre en el servidor y qué no (el motor no), crear la máquina, preparar y publicar desde el PC, actualizar, **privacidad** y otras plataformas. → [[Despliegue y Codespaces#despliegue/]]

## uml/
- `casos-de-uso.puml` — fuente PlantUML del diagrama de casos de uso (regenerar en plantuml.com o con la extensión de VS Code).
- `proceso-ciclo-analitico.bpmn` — modelo BPMN 2.0 del ciclo analítico.

## img/
PNG/SVG generados de los diagramas: `arq-1-contexto` … `arq-6-modelo-datos`, `casos-de-uso`, `proceso-bpmn`, `scrum-1-sprints`.
