# Migraciones

**Ubicación:** `bd/migraciones/0NN_nombre.sql`. Se aplican en orden con `bash herramientas/inicializar.sh` ([[Herramientas#inicializar.sh]]). Cada una empieza con un comentario que explica **el problema que resolvió**: leerlas en orden es leer la historia del proyecto.

> [!tip] Cómo estudiarlas
> Para cada una, saber responder: ¿qué problema había?, ¿qué tabla/vista toca?, ¿qué módulo del motor o ruta de la API la usa?

## 001_pertinencia_por_origen.sql
- **Problema:** la vista de pertinencia filtraba `origen = 'TerraFoco'`, así que el índice quedaba vacío hasta tener RUSLE propio (o sea, hasta resolver las descargas satelitales).
- **Cambio:** el origen pasa a ser una columna; con la línea base de CIREN el índice existe **desde el primer día**, y ambos orígenes se comparan (UC-06). `DROP VIEW` (no `CREATE OR REPLACE`) porque cambian las columnas.
- **Toca:** `indicadores.v_pertinencia`.

## 002_factores_por_comuna.sql
- **Problema:** cada factor RUSLE tiene fuente y cadencia propias (LS estático, C por temporada, R anual, P según el programa); guardarlos en una fila de `erosion` obligaba a tener los cinco a la vez.
- **Cambio:** tabla `indicadores.factor`: cada proceso escribe lo suyo cuando lo tiene; `calcular.py` junta lo disponible. Queda la trazabilidad (fuente y fecha de cada número). → [[Motor - indicadores#almacen.py]]

## 003_dominio_de_validez.sql
- **Problema:** el modelo sobreestima 20–300 veces en seis comunas precordilleranas.
- **Cambio:** columna `en_dominio` en `indicadores.erosion`. Se **marcan**, no se ocultan. → [[Dominio de validez]]

## 004_pertinencia_con_dominio.sql
- La vista expone la bandera `en_dominio`. El filtro es decisión de quien consulta, no de la vista.

## 005_tareas_programadas_reales.sql
- **Problema:** la programación se sembró con los comandos del diseño y el motor se construyó con otros nombres: de nueve tareas vencidas, seis fallaban cada hora. Dos fallas **silenciosas**: `ingesta.sentinel` corría sin `--guardar` (calculaba y descartaba) y `ingesta.transparencia` apuntaba a un paquete `etl` inexistente.
- **Cambio:** las tareas apuntan a los módulos reales; las de módulos aún no escritos se desactivan ("una tarea activa que apunta a la nada es ruido que entrena a ignorar errores"). → [[Programador de tareas]]

## 006_urbano_por_comuna.sql
- **Problema:** `indicadores.urbano` se diseñó por unidad vecinal, que no tiene capa nacional ni población pública.
- **Cambio:** la tabla acepta **dos escalas** (comuna o unidad vecinal) y cada fila declara cuál usa. La temperatura entra por comuna sin esperar. Idempotente.

## 007_variables_de_inundacion.sql
- Tabla `indicadores.variable_inundacion` con la forma de `factor`, pero **sin `CHECK (valor > 0)`**: el modelo de inundación es aditivo y la curvatura negativa marca las concavidades donde se junta el agua. Nombre en `VARCHAR(20)`.

## 008_red_hidrica.sql
- Tabla `territorio.cauce`: red hídrica 1:25.000 de IDE Chile (2021) por WFS, con **orden de Strahler**, que permite separar el río Rapel de una quebrada de ladera. → [[Motor - ingesta#cauces.py]]

## 009_eventos_historicos.sql
- Tabla `indicadores.evento_inundacion`: DesInventar (13.534 fichas de Chile 1970–2014, con comuna pero sin coordenadas). Sirve para **validar, no entrenar**. Guarda el nombre de comuna original para auditar el emparejamiento ("Donigue"). → [[Motor - ingesta#desinventar.py]]

## 010_tareas_modulo_inundacion.sql
- Activa y **encadena por dependencia** las tareas del módulo 2 (hidrología, cauces, DesInventar, índice). `ingesta.senapred` se reemplaza por `ingesta.desinventar` (SENAPRED no publica registro descargable).

## 011_trazabilidad_indice_inundacion.sql
- El índice guarda **con qué se calculó** (pesos y método de clasificación) en cada fila: sin eso, dos versiones con números distintos no se podrían explicar.

## 012_catalogo_de_fuentes.sql
- **Problema:** `operacion.fuente` nunca se había sembrado; `/fuentes` devolvía vacío y la pantalla caía a cifras inventadas del prototipo ("48 teselas", SENAPRED con "41 eventos"). Ninguna de las 28 ejecuciones registradas llenaba `id_fuente`.
- **Cambio:** siembra las fuentes reales con su URL y las pendientes con su motivo; agrega el **código** que une catálogo y bitácora. → [[Bitácora y catálogo de fuentes]]

## 013_serie_sirsd_y_pertinencia_por_ha_erosionada.sql
- **La más importante para el índice.** Crea `programas.sirsd_anual`, `programas.uf_anual`, `indicadores.superficie_erosionada` y rehace `v_pertinencia`:
  1. período completo 2012–2025;
  2. deflactado a UF;
  3. inversión **por hectárea con erosión Severa o superior**;
  4. normalización logarítmica de la inversión;
  5. ventana `PARTITION BY id_region, origen, en_dominio`.
- La variable es el **incentivo** (plata del Estado), no la inversión total. → [[Índice de pertinencia]]

## 014_areas_verdes.sql
- Objetivo específico 7. Tablas `territorio.limite_urbano`, `zona_censal`, `manzana_censal`, `area_verde` e `indicadores.area_verde`. Geometrías en 4326 + **columna generada en 32719** (los cruces de 11.000 manzanas eran lentos transformando en cada consulta). Estándares SIEDU. → [[Áreas verdes y calor urbano]]

## 015_localidades_urbanas.sql
- `territorio.ciudad` existía desde el esquema y **nunca se llenó**. Se carga el Límite Urbano Censal 2017 (copia del Observatorio de Ciudades UC; CC BY-NC 4.0) para decir **qué sector de qué localidad** corre más riesgo. → [[Motor - ingesta#localidades.py]]

## 016_exposicion_inundacion.sql
- `territorio.manzana` (Censo 2017, ~706 mil personas urbanas) y `territorio.equipamiento` (OSM). Fuentes `ine_manzanas` y `osm_equipamiento` en el catálogo. → [[Exposición]]

## 017_catalogo_al_dia.sql
- Tres fuentes (CR2MET, SoilGrids, serie INDAP) seguían como "Pendiente" con datos ya cargados: el panel se contradecía ("Falta correrlo" al lado de "33 registros"). Se corrige **solo si** sigue en el `pendiente` de la siembra y el dato existe.

## 018_tareas_nuevas_fuentes.sql
- El programador conoce las fuentes nuevas (localidades, manzanas, equipamiento, censo, áreas verdes, superficie erosionada, variables de inundación).
- **Arreglo clave:** recalcular el índice lo deja `calibrado = FALSE` y nada lo volvía a validar. Ahora `validar.inundacion --marcar-si-pasa` va en la cadena y `mapa.inundacion` depende de ella. → [[Validación y Spearman]]

## 019_exposicion_agricola_y_rural.sql
- **Para INDAP:** `territorio.unidad_censal` (Censo 2024: manzanas urbanas, aldeas y entidades rurales, ~982 mil personas, la región completa) e `indicadores.cobertura_agricola` (ha de cultivo y pradera, y cuántas sobre el corte "Alta"). Fuente `esa_worldcover`; tareas `ingesta.poblacion_censal` e `ingesta.worldcover`. → [[Exposición]]

Ver también: [[Esquema de la base]] · [[Semillas]]
