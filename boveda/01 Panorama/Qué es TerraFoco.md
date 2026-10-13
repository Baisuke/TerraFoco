# Qué es TerraFoco

**Sistema de Análisis Geoespacial Multipropósito para la Evaluación Territorial y de Política Pública.** Proyecto de título (Capstone APT, Ingeniería en Informática, Duoc UC).

## El problema

INDAP financia con el **SIRSD-S** (Sistema de Incentivos para la Sustentabilidad Agroambiental de los Suelos Agropecuarios) prácticas que recuperan suelos degradados. Nadie mide de forma sistemática si esa plata llega **a donde el suelo está peor**. La erosión está medida (CIREN), la inversión está registrada (INDAP), pero nunca se cruzan comuna por comuna.

**Pregunta de investigación:** ¿la inversión pública en conservación de suelos llega a las comunas donde el problema es más grave?

## La solución

Una plataforma web que:

1. **Mide el territorio** con datos públicos y satelitales: erosión (RUSLE a 30 m), susceptibilidad a inundación (seis variables del relieve, validada contra eventos) y calor urbano (ECOSTRESS) más déficit de áreas verdes.
2. **Carga la inversión** del SIRSD-S 2012–2025 por comuna y año, deflactada a UF.
3. **Cruza ambas** en el [[Índice de pertinencia]]: necesidad normalizada menos inversión normalizada.
4. **Lo muestra** en un visor para personas sin formación informática, con mapas a 30 m, fichas por comuna, exportaciones (CSV, KML, GeoJSON) y un análisis de los predios propios.

El **aporte original** está en que la variable evaluada —las prácticas de conservación— **ya vive dentro del modelo físico**: es el factor **P** (y en parte C) de RUSLE. Por eso el cruce no es una correlación forzada. → [[RUSLE y erosión]]

## Los tres módulos

| Módulo | Pregunta | Pantalla | Nota |
|---|---|---|---|
| 1 · Suelos agrícolas | ¿Dónde hay erosión y llega la inversión? | `pertinencia.html`, `comuna.html`, `visor.html` | [[RUSLE y erosión]], [[Índice de pertinencia]] |
| 2 · Inundaciones | ¿Qué terreno es susceptible y qué queda encima? | `inundaciones.html` | [[Susceptibilidad a inundación]], [[Exposición]] |
| 3 · Ciudades | ¿Dónde hace más calor y falta área verde? | `urbano.html` | [[Áreas verdes y calor urbano]] |

Más dos pantallas transversales: **Mis predios** (`predios.html`, para el ejecutivo de área de INDAP) y **Fuentes** (`fuentes.html`, administración del catálogo y la bitácora). → [[Visor - páginas]]

## Objetivos específicos (del perfil)

1. Modelo de datos geoespacial → [[Esquema de la base]]
2. Motor de ingesta automatizado → [[Motor - ingesta]], [[Programador de tareas]]
3. ETL del SIRSD-S → [[Motor - ingesta#sirsd.py]], [[Motor - ingesta#sirsd_serie.py]]
4. Módulo de erosión contrastado con CIREN → [[Motor - raíz#calcular.py]], [[Motor - raíz#validar.py]]
5. Índice de pertinencia → [[Índice de pertinencia]]
6. Inundaciones validado contra eventos → [[Validación y Spearman]]
7. Déficit de áreas verdes → [[Áreas verdes y calor urbano]]
8. Comparar algoritmos supervisados → declarado en el backlog (épica E7); no es el foco de lo implementado.
9. Visor y tablero para no informáticos → [[Visor - páginas]]
10. Pruebas y validación → [[Motor - pruebas]], [[API - pruebas]]

## Equipo

| Integrante | Rol técnico | Rol Scrum |
|---|---|---|
| Bastián Cárcamo | Ingeniería de datos y geoprocesamiento | Scrum Master |
| Carla Morales | Backend y modelado analítico | Product Owner (vínculo con INDAP) |
| Antonio Lankin | Frontend, visualización y calidad | Development Team |

Metodología dual: **CRISP-DM** para el trabajo con datos y **Scrum** para el desarrollo. → [[Documentos del proyecto#05-scrum.md]]

## Región piloto

**O'Higgins (región 6)**: 33 comunas, 3 provincias (Cachapoal, Colchagua, Cardenal Caro). Nada de la región está escrito en el código: sale de la tabla `territorio.region`, así que agregar otra región es insertar una fila. → [[Motor - raíz#config.py]]

Ver también: [[Arquitectura]] · [[Flujo de datos]] · [[Mapa del repositorio]]
