# TerraFoco · Guía de estudio

Esta bóveda explica el proyecto completo: qué es, cómo está armado y **qué hace cada archivo del repositorio, dónde está y para qué se usa**. Está pensada para estudiar antes de la defensa y para que cualquiera del equipo (Antonio, Bastián y Carla) pueda responder por cualquier parte del sistema.

> [!tip] Cómo abrirla
> En Obsidian: *Abrir carpeta como bóveda* → elegir `boveda/` dentro del repositorio. Los enlaces `[[...]]` llevan de una nota a otra y la vista de grafo (Ctrl+G) muestra cómo se conectan; para colorear cada área, en el grafo: *Grupos* → `path:"04 Motor"`, etc. La configuración de Obsidian (`boveda/.obsidian/`) no se versiona: cada uno tiene la suya.

## La idea en tres líneas

TerraFoco cruza **el estado del territorio** (erosión del suelo, susceptibilidad a inundación, calor urbano), medido con datos satelitales y públicos, con **la inversión pública** (el programa SIRSD-S de INDAP), para responder: *¿la plata llega a las comunas donde el problema es más grave?* La región piloto es O'Higgins, con 33 comunas. → [[Qué es TerraFoco]]

## Mapa de la bóveda

| Carpeta | Qué hay | Empezar por |
|---|---|---|
| **01 Panorama** | Qué es, arquitectura, flujo de datos, estructura del repo, cómo levantarlo | [[Qué es TerraFoco]] · [[Arquitectura]] · [[Mapa del repositorio]] |
| **02 Conceptos** | Las ideas que hay que entender antes del código | [[RUSLE y erosión]] · [[Índice de pertinencia]] · [[Susceptibilidad a inundación]] |
| **03 Base de datos** | Esquema, cada migración y las semillas | [[Esquema de la base]] · [[Migraciones]] |
| **04 Motor** | El procesamiento en Python: ingestas, indicadores, programador, pruebas | [[Motor - raíz]] · [[Motor - ingesta]] · [[Motor - indicadores]] |
| **05 API** | FastAPI: cada ruta y sus pruebas | [[API - núcleo]] · [[API - rutas]] |
| **06 Visor** | Las páginas HTML, cada script JS, estilos y datos estáticos | [[Visor - páginas]] · [[Visor - scripts base]] · [[Visor - mapas y módulos]] |
| **07 Herramientas y despliegue** | Scripts de apoyo, copia portable, servidor público, raíz del repo | [[Herramientas]] · [[Despliegue y Codespaces]] · [[Archivos de la raíz]] |
| **08 Documentación** | Resumen de cada documento de `docs/` | [[Documentos del proyecto]] |
| **09 Estudio** | Ruta de estudio, recorridos por el código, preguntas de defensa, glosario | [[Ruta de estudio]] · [[Preguntas de defensa]] · [[Glosario]] |

## Conceptos clave (atajos)

- [[RUSLE y erosión]]: `A = R × K × LS × C × P`, por qué se multiplican y de dónde sale cada factor.
- [[Dominio de validez]]: por qué 6 comunas precordilleranas quedan marcadas fuera.
- [[Índice de pertinencia]]: `necesidad_norm − inversión_norm`, en UF por hectárea erosionada.
- [[SIRSD-S e INDAP]]: el programa evaluado y la serie 2012–2025.
- [[Susceptibilidad a inundación]]: acumulación 50 % + curvatura 50 %, cuartiles regionales.
- [[Validación y Spearman]]: 43 de 63 eventos en Alta/Muy alta; ρ +0,36.
- [[Exposición]]: población (Censo 2024), cultivo y pradera (WorldCover) y servicios (OSM) sobre el umbral.
- [[Teselas y PMTiles]]: cómo el visor tiene el valor de cada celda de 30 m sin servidor de mapas.
- [[Copia local y modo sin API]]: por qué el visor nunca queda en blanco ni miente.
- [[Programador de tareas]] y [[Bitácora y catálogo de fuentes]]: la operación del sistema.
- [[Áreas verdes y calor urbano]]: el módulo 3.
- [[Privacidad y datos personales]]: qué nunca se carga.

## Reglas del proyecto que atraviesan todo

1. **Nada se inventa.** Si falta un dato, no se calcula y se dice; nunca se rellena con un promedio. → [[RUSLE y erosión#Nada se inventa]]
2. **Ninguna coordenada, región ni credencial escrita en el código.** La región sale de `territorio.region`; las credenciales, del `.env`. → [[Motor - raíz#config.py]]
3. **Cada número sabe de dónde salió.** Factores y variables guardan fuente y fecha; cada proceso deja su fila en la bitácora. → [[Bitácora y catálogo de fuentes]]
4. **El visor declara lo que muestra:** dato en vivo, copia local o ejemplo. → [[Copia local y modo sin API]]
5. **Los límites se declaran, no se esconden** (dominio de validez, sesgo de prensa de los eventos, población rural aproximada).
6. **Sin datos personales.** Solo agregados por comuna. → [[Privacidad y datos personales]]
