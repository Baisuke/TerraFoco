# Esquema de la base

**Ubicación:** `bd/esquema.sql` (≈430 líneas) + `bd/migraciones/` → [[Migraciones]].
**Motor:** PostgreSQL 16 + PostGIS 3.4, contenedor `terrafoco-bd`, base `terrafoco`, usuario `terrafoco`.

## Cómo se carga

- `esquema.sql` está montado en `/docker-entrypoint-initdb.d` y Postgres lo ejecuta **solo la primera vez** que crea el volumen `bd_datos`.
- Las migraciones (subcarpeta) **no** se ejecutan solas: las aplica `bash herramientas/inicializar.sh`, en orden. → [[Herramientas#inicializar.sh]]
- Todo es idempotente (`IF NOT EXISTS`, `DROP ... IF EXISTS`, `ON CONFLICT DO NOTHING`).

## Los cuatro esquemas

| Esquema | Qué guarda | Quién escribe |
|---|---|---|
| `territorio` | Geometrías y unidades: región, comunas, ciudades, manzanas, cauces, equipamiento, áreas verdes | Motor (ingestas) |
| `indicadores` | Resultados calculados: erosión, factores, inundación, urbano, áreas verdes, cobertura agrícola; la vista de pertinencia | Motor |
| `programas` | Inversión pública: programas, prácticas, ejecución, serie SIRSD-S, UF | Motor (ETL) |
| `operacion` | Funcionamiento del sistema: catálogo de fuentes, bitácora, tareas programadas, rásteres | Motor + API (solo `fuente`) |

## Tablas, una por una

### territorio
| Tabla | Contenido | Origen |
|---|---|---|
| `region` | id, código INE, nombre, **EPSG de trabajo (32719)**, **extensión (bbox)**, resolución (30 m). Sembrada con la región 6 | esquema |
| `comuna` | id = código INE (CUT), región, nombre, provincia, km², `geom` MultiPolygon 4326, índice GIST | esquema; carga `sembrar_comunas.py` |
| `ciudad` | Ciudades y pueblos (Límite Urbano Censal 2017) | esquema; llenada desde 015 |
| `unidad_vecinal` | Prevista para el módulo urbano; reemplazada en la práctica por la zona censal | esquema |
| `cauce` | Red hídrica 1:25.000 con orden de Strahler | 008 |
| `limite_urbano`, `zona_censal`, `manzana_censal`, `area_verde` | Censo 2024 urbano y áreas verdes de OSM (geom 4326 + columna generada en 32719) | 014 |
| `manzana` | Manzanas Censo 2017 (personas, viviendas) | 016 |
| `equipamiento` | Escuelas, salud, emergencia (OSM) | 016 |
| `unidad_censal` | Censo 2024 completo: manzana urbana, aldea, entidad rural; personas y viviendas | 019 |

### indicadores
| Tabla | Contenido | Nota |
|---|---|---|
| `erosion` | Factores R K LS C P, `perdida_ton_ha`, `clase`, **`origen`** (CIREN/TerraFoco), `en_dominio` (003). **Particionada por región** (`erosion_r06`). Nunca se sobrescribe: cada recálculo inserta una versión | [[RUSLE y erosión]] |
| `factor` | Un valor por comuna, factor y fecha, con su fuente y detalle; `CHECK valor > 0` | 002 · [[Motor - indicadores#almacen.py]] |
| `variable_inundacion` | Igual que `factor`, pero sin restricción de signo (la curvatura negativa es la señal) | 007 |
| `susceptibilidad_inundacion` | Índice 0–1, clase, **`calibrado`**, método y pesos (011). Particionada (`_r06`) | [[Susceptibilidad a inundación]] |
| `evento_inundacion` | Eventos de DesInventar con comuna emparejada y nombre original | 009 |
| `urbano` | Temperatura superficial (media, máx, mín); escala comunal o vecinal (006) | [[Áreas verdes y calor urbano]] |
| `area_verde` | m²/hab, déficit, acceso a plaza y parque por comuna y zona censal | 014 |
| `superficie_erosionada` | ha > 18 t/ha/año por comuna (denominador de la inversión) | 013 |
| `cobertura_agricola` | ha de cultivo y pradera, y cuántas sobre el corte "Alta" | 019 |
| **`v_pertinencia`** (vista) | Une erosión + inversión + superficie y normaliza | [[Índice de pertinencia]] |

### programas
| Tabla | Contenido |
|---|---|
| `programa` | SIRSD-S de INDAP y de SAG |
| `practica` | Prácticas con el factor RUSLE sobre el que actúan (`C`, `P`, `K`) |
| `ejecucion` | Ejecución por comuna, año y práctica; `precision_dato` (`completa`/`reducida`/`sin informacion`) y `fuente` |
| `ejecucion_rechazada` | Lo que no se pudo cargar, con la línea original (JSONB) y el **motivo**: nada se pierde en silencio |
| `sirsd_anual` | Serie 2012–2025 por comuna y año (planes, agricultores, incentivo, inversión, ha, columnas `_oficial`, `inversion_anomala`) — 013 |
| `uf_anual` | UF promedio por año (deflactor) — 013 |

### operacion
| Tabla | Contenido |
|---|---|
| `fuente` | Catálogo de fuentes (código, estado administrativo) → [[Bitácora y catálogo de fuentes]] |
| `ejecucion_proceso` | Bitácora: proceso, inicio, fin, estado (`en curso`/`ok`/`parcial`/`error`), registros, mensaje |
| `tarea_programada` | Programación: código, comando, cadencia, día del mes (≤ 28), meses válidos, `depende_de`, activa → [[Programador de tareas]] |
| `cobertura_raster` | Rásteres en PostGIS (tipo `raster`, índice sobre `ST_ConvexHull`) |
| `erosion_ciren_cruda` | Tabla de paso de CIREN (se vacía por cuenca) |

## Decisiones de diseño para defender

- **Código INE como llave** de comunas: es estable y es el que usan todas las fuentes chilenas.
- **Particiones por región** en las tablas grandes de indicadores: agregar una región es crear una partición, sin tocar las demás.
- **Versionado por inserción** (nunca `UPDATE` de un resultado): el histórico es parte del producto y permitió recuperar valores buenos tras una carga contaminada.
- **CHECK que reflejan reglas del dominio** (clases de erosión válidas, factores positivos, rango 0–1, cadencias, estados).
- **Geometrías en 4326** (lo que lee la web) y, donde se mide, una **columna generada en 32719** (metros) para no transformar en cada consulta.

Ver también: [[Migraciones]] · [[Semillas]]
