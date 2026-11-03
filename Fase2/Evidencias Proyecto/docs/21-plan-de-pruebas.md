# Plan de pruebas

Qué se prueba en TerraFoco, en qué niveles, con qué criterios y quién lo hace, incluidas las pruebas de integración con la base de datos.

Versión 1.0 · 02-11-2026 · Responsable: Carla Morales (Product Owner)  
Equipo TerraFoco: Bastián Cárcamo, Carla Morales, Antonio Lankin  

## 1. Identificación y propósito

Este es el plan de pruebas de TerraFoco: define qué se prueba, en qué niveles, con qué herramientas, con qué criterios se aprueba y quién lo hace. Sigue la estructura de IEEE 829 / ISO/IEC/IEEE 29119-3.

Se separa del documento 08 (*Plan y resultados de pruebas*), que pasa a ser el **informe de resultados**: inventario por archivo, ejecuciones, validación de los modelos y defectos encontrados. Este plan es la referencia de lo que debe cumplirse; el 08 registra lo que se obtuvo.

| Elemento | Descripción |
|---|---|
| Identificador | TF-PP-01, versión 1.0, 02-11-2026 |
| Responsable del plan | Carla Morales (Product Owner) |
| Elementos bajo prueba | Base de datos (bd/), motor (motor/), API (api/) y visor (prototipo/) de Fase2/Evidencias Proyecto |
| Documentos relacionados | 12 — Especificación de requerimientos · 04 — Definition of Done · 08 — Resultados de pruebas · docs/16-plan-de-usabilidad.md |

## 2. Alcance

### 2.1 Qué se prueba

- Las ecuaciones y transformaciones del motor (RUSLE, terreno, inundación, áreas verdes, agregación zonal, teselas).
- La lógica de programación de tareas y la bitácora.
- El contrato de la API: rutas, validaciones, códigos de respuesta y autenticación de las escrituras.
- La integración entre motor, API y PostgreSQL/PostGIS sobre el esquema real.
- La validez de los modelos contra referencias independientes (CIREN y DesInventar).
- La comprensión del visor por usuarios sin formación técnica.

### 2.2 Qué no se prueba y por qué

| Fuera de alcance | Motivo |
|---|---|
| Prueba de carga y estrés | Uso previsto: pocos usuarios simultáneos (INDAP y municipios). Se mide el tiempo de respuesta (CS-05), no la concurrencia |
| Descargas reales desde los servicios externos | Dependen de credenciales y de la disponibilidad del servicio; se prueban la lectura y el procesamiento con datos de muestra |
| Compatibilidad entre navegadores | Se usa un navegador actualizado (RNF-14) |

## 3. Estrategia y niveles de prueba

| Nivel | Objetivo | Herramienta | Dónde está | Cuándo |
|---|---|---|---|---|
| Unitarias | Cada función hace lo que dice, sin base ni red | pytest | motor/tests, api/tests | Antes de cada fusión a main |
| Contrato de la API | Rutas, validaciones y códigos de respuesta | pytest + TestClient | api/tests | Antes de cada fusión a main |
| Integración | Motor y API funcionan sobre el esquema real de PostgreSQL/PostGIS | pytest + base temporal | api/tests/integracion, motor/tests/integracion | Antes de cada fusión y en cada Sprint Review |
| Seguridad | Escrituras autenticadas, cerrado por defecto, sin datos personales | pytest | test_seguridad.py, test_fuentes.py, PI-08 a PI-11 | Antes de cada fusión a main |
| Sistema | El sistema completo desplegado cumple los RNF | Docker Compose, navegador, curl | CS-01 a CS-06 | Sprint Review previa a la defensa |
| Validación de modelos | Los resultados ordenan las comunas como la referencia | motor/validar.py | CS-07 | Cada recalibración |
| Aceptación | Usuarios reales entienden y usan el sistema | Sesiones moderadas | CS-08, docs/16 | Antes de la presentación final |
| Regresión | Lo que funcionaba sigue funcionando | Toda la suite | — | Ante cada cambio (Definition of Done) |

### 3.1 Principios

1. **Sin base de datos ni red siempre que se pueda.** El motor separa cálculo y lectura, así casi todas las pruebas unitarias usan rásteres y tablas pequeñas construidas en la prueba.
2. **La integración usa una base propia y conocida.** Cada ejecución crea `terrafoco_integracion` (API) o `terrafoco_integracion_motor` (motor), le aplica `esquema.sql` y las 19 migraciones, siembra datos cuyo resultado se puede calcular a mano y la borra al terminar. Nunca toca la base de desarrollo.
3. **Omitir con motivo, nunca fallar por el entorno.** Sin PostgreSQL las pruebas que lo necesitan se omiten e informan por qué.
4. **Casos borde explícitos**: comunas sin un factor, rásteres en grados, cobertura insuficiente, empates, estados inválidos, escrituras sin clave.
5. **Criterios declarados de antemano** para validar modelos, para no ajustar el modelo a los mismos datos con que se evalúa.

## 4. Inventario de pruebas automatizadas

| Tipo | Suite | Pruebas | Requiere PostgreSQL |
|---|---|---|---|
| Unitarias del motor | motor/tests (22 archivos) | 270 | No (1 necesita /bd montado) |
| Unitarias y de contrato de la API | api/tests (11 archivos) | 96 | 48 sí, con datos cargados |
| Integración API + BD | api/tests/integracion | 12 | Sí; crea su propia base |
| Integración motor + BD | motor/tests/integracion | 9 | Sí; crea su propia base |
| **Total** |  | **387** |  |

De esas, son de **seguridad**: test_seguridad.py (9), la validación de entradas de test_fuentes.py y los casos de integración PI-08 a PI-11. El detalle por archivo está en el documento 08.

## 5. Casos de prueba de integración

Datos de prueba: cuatro comunas ficticias de la región 6 (6901 a 6904), erosión CIREN de 10, 20, 40 y 50 t/ha/año, hectáreas severas de 100, 200, 400 y 50, e incentivos equivalentes a 1.000, 2.000, 500 y 1.000 UF de 2012. La cuarta comuna queda fuera del dominio de validez. Con esos valores el índice esperado se calcula a mano en la propia prueba.

| ID | Componentes | Qué verifica | Requerimiento |
|---|---|---|---|
| PI-01 | API | /salud responde contra la base de pruebas e informa la versión de PostGIS | RF-29 |
| PI-02 | BD | esquema.sql + 19 migraciones dejan las 31 tablas y la vista v_pertinencia | RF-01, RNF-22 |
| PI-03 | API + BD | La región, sus comunas y los períodos con datos salen de la base | RNF-24 |
| PI-04 | API + BD | /comunas/geojson devuelve un FeatureCollection válido con las comunas sembradas | RNF-26 |
| PI-05 | API + vista | La pertinencia de la API coincide con el cálculo a mano y viene ordenada | RF-13, RF-18 |
| PI-06 | API + vista | Las comunas fuera del dominio solo aparecen si se piden y sin brecha en UF | RF-20, RNF-08 |
| PI-07 | API + BD | Un origen inexistente responde 404 con los orígenes disponibles | RF-29 |
| PI-08 | API + BD | La serie del SIRSD-S reserva las celdas con menos de 3 planes | RNF-17 |
| PI-09 | API + BD | El alta de una fuente queda confirmada en la base; un código repetido da 409 | RF-02 |
| PI-10 | API + BD | El cambio de estado exige la clave (401 sin ella) y se persiste con ella | RF-31, RNF-19 |
| PI-11 | API + BD | La lista de estados de la API y la restricción CHECK de la tabla coinciden | RF-02 |
| PI-12 | API + BD | La bitácora que escribe el motor llega al catálogo y a /ejecuciones | RF-08 |
| PI-13 | Motor + BD | El área de interés y el EPSG se leen de territorio.region | RF-07, RNF-24 |
| PI-14 | Motor + BD | Los factores se versionan, gana el más reciente y se puede pedir un año anterior | RF-16, RNF-06, RNF-11 |
| PI-15 | Motor + BD | RUSLE descarta valores no positivos; inundación conserva el signo | RF-22, RNF-11 |
| PI-16 | Motor + BD | La trazabilidad del cálculo se guarda como JSONB | RF-01 |
| PI-17 | Motor + BD | La bitácora registra el éxito y lo enlaza con su fuente | RF-08 |
| PI-18 | Motor + BD | La bitácora registra el error sin ocultarlo; una simulación no queda (2 pruebas) | RF-08 |
| PI-19 | Motor + BD | Las tareas sembradas por las migraciones pasan la validación de cadencias y no tienen ciclos | RF-09 |
| PI-20 | Motor + BD + SO | Si la tarea padre falla de verdad, la hija no corre; al corregirla, ambas quedan ok | RF-09, RNF-05 |

Resultado de la ejecución del 02-11-2026 (Python 3.13, PostgreSQL 16.15, PostGIS 3.4): **21 de 21 aprobadas** (12 de la API en 1,3 s y 9 del motor en 0,8 s). Junto a ellas corrieron las 270 unitarias del motor: 269 aprobadas y 1 omitida (la que necesita /bd montado).

## 6. Casos de prueba de sistema y aceptación

Se ejecutan a mano sobre el entorno completo y se registran en la Sprint Review (fecha, responsable, resultado, evidencia).

| ID | Caso | Procedimiento | Resultado esperado | Req. |
|---|---|---|---|---|
| CS-01 | Levantar el entorno con un solo comando | `docker compose up -d` y `bash herramientas/inicializar.sh` | /salud con base ok y 33 comunas válidas | RNF-23 |
| CS-02 | Documentación de la API | Abrir http://localhost:8000/docs | Se listan las rutas y el botón Authorize | RNF-25 |
| CS-03 | Recorrido del visor | Abrir el visor, cambiar de capa y abrir la ficha de una comuna | Sin recargar la página; cada cifra con unidad | RF-26 a RF-28, RNF-14 |
| CS-04 | Visor sin API | Detener el servicio api y recargar el visor | Se ven la cartografía y los datos embebidos, con aviso | RNF-15 |
| CS-05 | Tiempo de respuesta | 10 consultas a /pertinencia?region=6 con la base en caliente | Mediana menor a 2 s | RNF-01 |
| CS-06 | Tiempo de cálculo de un factor | `time` sobre `python -m ingesta.zonal --factor ls` para la región | Menos de 30 min | RNF-02 |
| CS-07 | Validación de los modelos | `python -m validar` y `python -m indicadores.validar_inundacion` | ρ ≈ +0,67 en el dominio; criterio de calibración cumplido | RF-20, RF-23 |
| CS-08 | Usabilidad con usuarios externos | Tres tareas de docs/16-plan-de-usabilidad.md | Tres de tres personas completan sin ayuda | RNF-12, RNF-13 |

### 6.1 Medición del tiempo de respuesta (CS-05)

```bash
for i in $(seq 10); do
  curl -s -o /dev/null -w "%{time_total}\n" "http://localhost:8000/pertinencia?region=6"
done | sort -n | sed -n 5,6p      # la mediana está entre estos dos valores
```

## 7. Criterios

| Criterio | Condición |
|---|---|
| Entrada | El cambio está en una rama; `docker compose up -d` deja la base sana; las migraciones nuevas están en bd/migraciones |
| Aprobación de una prueba | Termina sin error y con el resultado esperado. Una omisión vale solo si informa su motivo |
| Salida (fusionar a main) | 0 fallas en unitarias, contrato e integración (Definition of Done) |
| Salida (entrega final) | Lo anterior, más CS-01 a CS-07 registrados y CS-08 con al menos 3 sesiones |
| Suspensión | La base no levanta o una migración falla: se detiene todo hasta corregir, porque el resto de las pruebas no sería confiable |
| Reanudación | Se vuelve a correr la suite completa, no solo la prueba que falló |

## 8. Entorno de pruebas

| Elemento | Versión o valor |
|---|---|
| Base de datos | PostgreSQL 16 + PostGIS 3.4 (imagen postgis/postgis:16-3.4) |
| Motor | Python 3 sobre ghcr.io/osgeo/gdal:ubuntu-small-3.9.2, dependencias fijadas en motor/requirements.txt |
| API | Python 3.12, FastAPI 0.115, psycopg 3.2, pytest 8.3 |
| Variables | `.env` a partir de `.env.example`; las pruebas fijan su propia clave de administración |
| Bases temporales | terrafoco_integracion y terrafoco_integracion_motor (se crean y se borran solas). Se cambian con TERRAFOCO_BD_PRUEBAS |
| Esquema y migraciones | Montados en /bd dentro de los contenedores (o TERRAFOCO_BD_DIR) |

### 8.1 Cómo ejecutar

```bash
docker compose up -d
# Motor: unitarias + integración
docker exec -i terrafoco-programador python -m pytest tests -q
# API: unitarias, contrato e integración
docker compose exec -T api python -m pytest tests -q
# Solo integración
docker compose exec -T api python -m pytest tests -m integracion -v
docker exec -i terrafoco-programador python -m pytest tests/integracion -v
```

## 9. Trazabilidad requerimientos — pruebas

| Requerimiento | Unitarias | Integración | Sistema |
|---|---|---|---|
| RF-01, RF-02 | test_fuentes | PI-02, PI-09, PI-11, PI-16 | — |
| RF-07 | test_zonal | PI-13 | — |
| RF-08, RF-09 | test_programacion, test_ejecuciones, test_bitacora_fuente | PI-12, PI-17 a PI-20 | — |
| RF-10 a RF-13 | test_sirsd, test_sirsd_serie | PI-05 | — |
| RF-14 a RF-17 | test_factores, test_terreno, test_rusle | PI-14 | — |
| RF-18 a RF-20 | test_pertinencia_sirsd, test_focalizacion, test_validar | PI-05, PI-06 | CS-07 |
| RF-21 a RF-23 | test_hidrologia, test_cauces, test_inundacion, test_criterio_calibracion | PI-15 | CS-07 |
| RF-24, RF-25 | test_ecostress, test_areas_verdes | — | — |
| RF-26 a RF-28 | — | — | CS-03 |
| RF-29 | test_salud y rutas | PI-01 a PI-07 | CS-02 |
| RF-31, RNF-19 | test_seguridad | PI-10 | — |
| RNF-01, RNF-02 | — | — | CS-05, CS-06 |
| RNF-05, RNF-06, RNF-11 | test_programacion | PI-14, PI-15, PI-20 | — |
| RNF-12 a RNF-15 | — | — | CS-03, CS-04, CS-08 |
| RNF-17 | — | PI-08 | — |
| RNF-22 a RNF-26 | test_seguridad (OpenAPI) | PI-02 a PI-04, PI-13 | CS-01, CS-02 |

## 10. Responsables y calendario

| Actividad | Responsable principal | Fecha |
|---|---|---|
| Mantener este plan y la trazabilidad | Carla Morales | Continuo |
| Pruebas unitarias e integración de la base y el motor | Bastián Cárcamo | Ante cada cambio |
| Pruebas del visor (CS-03, CS-04) | Antonio Lankin | Sprint Review previa a la defensa |
| Mediciones CS-05 y CS-06 | Equipo | Antes del 20-11-2026 |
| Sesiones de usabilidad (CS-08) | Carla Morales | Antes del 20-11-2026 |
| Integración continua (GitHub Actions) con unitarias e integración | Equipo | En implementación |

## 11. Riesgos y observaciones

| Riesgo u observación | Mitigación |
|---|---|
| Las pruebas de contrato de la API asumen la base de desarrollo **con datos cargados**: con PostgreSQL levantado pero vacío, 7 fallan en vez de omitirse (test_exposicion, test_focalizacion, test_pertinencia_sirsd) | Correr `herramientas/inicializar.sh` antes; las de integración no dependen de eso porque siembran sus datos |
| Un servicio externo cambia su formato | Las ingestas validan columnas y registran el error en la bitácora; las pruebas usan muestras fijas |
| Validación de modelos en muestra (33 comunas) | Criterios fijados de antemano y límites declarados en el documento 08 |
| Pocas sesiones de usabilidad | Perfiles reales (territorio o gestión pública); resultados cualitativos registrados |
