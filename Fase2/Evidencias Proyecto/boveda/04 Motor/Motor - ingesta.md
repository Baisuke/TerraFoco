# Motor · ingesta

**Carpeta:** `motor/ingesta/`. **Un módulo por fuente externa.** Cada uno descarga (o lee), valida, transforma y escribe en la base o en `/datos`, dejando su fila en la bitácora. Se corren con `docker exec -i terrafoco-motor python -m ingesta.<modulo>`.

| Grupo | Módulos |
|---|---|
| Territorio | [[#vectorial.py]] · [[#localidades.py]] · [[#cauces.py]] |
| Erosión (factores RUSLE) | [[#ciren.py]] · [[#srtm.py]] · [[#zonal.py]] · [[#cr2met.py]] · [[#soilgrids.py]] · [[#sentinel.py]] · [[#practicas.py]] |
| Inversión | [[#sirsd.py]] · [[#sirsd_ide.py]] · [[#sirsd_serie.py]] |
| Inundación | [[#hidrologia.py]] · [[#desinventar.py]] |
| Exposición | [[#manzanas.py]] · [[#poblacion_censal.py]] · [[#equipamiento.py]] · [[#worldcover.py]] |
| Ciudades | [[#censo.py]] · [[#areas_verdes.py]] · [[#ecostress.py]] |

`__init__.py` está vacío: solo marca la carpeta como paquete.

---

## vectorial.py
- **Fuente:** shapefile/GeoJSON de límites (IDE Chile). **Uso:** `python -m ingesta.vectorial comunas.shp --tabla territorio.comuna_cruda`.
- **Qué hace:** `inspeccionar` (SRID, campos), `cargar` con `ogr2ogr` a PostGIS, `verificar`. Primer paso del Sprint 0: con las comunas ya se cierra el circuito sin un ráster.
- **Alternativa en uso:** [[Herramientas#sembrar_comunas.py]] carga las mismas 33 comunas desde la copia del prototipo, sin descargar nada.

## localidades.py
- **Fuente:** Límite Urbano Censal 2017 del INE, copia del **Observatorio de Ciudades UC** (ArcGIS, GeoJSON, sin credenciales; CC BY-NC 4.0). El servicio original del INE fue retirado.
- **Escribe:** `territorio.ciudad` (reemplaza las de la región). **Funciones:** `nombre_propio` (mayúsculas correctas: "El Arrayán", partículas en minúscula), `url_consulta`, `descargar`, `cargar`.
- **Para qué:** el visor de inundaciones dice qué sector de qué ciudad corre más riesgo. → [[Exposición]]

## cauces.py
- **Fuente:** red hídrica 1:25.000 de IDE Chile (2021), WFS. **Pasos:** `--descargar` → `--cargar` (`territorio.cauce`) → `--distancia` (`distancia_cauces.tif`).
- **Clave:** usa el **orden de Strahler**: de 9.107 tramos en el bbox, 8.400 son quebradas de ladera (drenaje, no inundación). La distancia se calcula a cauces de **orden ≥ 5** (~680 tramos) con transformada de distancia euclidiana (scipy). El umbral queda en el ráster.
- Quinta variable del índice de inundación. → [[Susceptibilidad a inundación]]

## ciren.py
- **Fuente:** Inventario Nacional de Erosión de CIREN (`inventarioerosion.ciren.cl`), GeoNode/GeoServer por **WFS**; una capa por cuenca (~50 en O'Higgins). **Uso:** `--listar`, `--simular`, `--anio 2024`. Tarda ~1 h.
- **Qué hace:** por cuenca: descarga el GeoJSON, importa a `operacion.erosion_ciren_cruda`, agrega la **media ponderada por superficie** (`RUSLE` × `AREA_HA`) por comuna, **quema** los polígonos en una máscara ráster (`mascara_ciren.tif`: el área que CIREN evalúa) y descarta los crudos (~40 mil polígonos por cuenca).
- **Escribe:** `indicadores.erosion` con `origen='CIREN'`.
- **Dos funciones:** produce el índice **sin satélites** (destraba el proyecto) y es la vara de validación (UC-06). → [[RUSLE y erosión]]

## srtm.py
- **Fuente:** **NASADEM** (reprocesamiento oficial de SRTM, sin vacíos) vía NASA Earthdata (`earthaccess`, requiere credenciales). **Uso:** `python -m ingesta.srtm --preparar --cargar`.
- **Qué hace:** `descargar` las teselas del bbox de la región (leído de la base), `preparar` (mosaico y reproyección a **UTM 19S** → `/datos/srtm/dem_utm.tif`), `cargar_a_postgis`.
- **Base de:** LS, pendiente, curvatura, acumulación, TWI, relieve 3D.

## zonal.py
- **Qué hace:** **del ráster al valor por comuna**. `python -m ingesta.zonal --raster dem_utm.tif --factor ls --guardar`.
- **Transformaciones:** `ls`, `c`, `pendiente`, `curvatura`, `identidad` (para acumulación, TWI, distancia).
- **El orden importa:** la transformación se aplica **antes de recortar**, sobre el ráster completo: la pendiente depende de las 8 vecinas y recortar primero dejaría mal calculado justo el borde de cada comuna.
- **Rechaza rásteres en grados** (`tamano_de_celda`): una pendiente con celdas en grados da un error de ~100.000× sin lanzar excepción.
- **Funciones:** `geometrias_comunas`, `agregar_por_comuna` (media por comuna con máscara), `informe`. Lo reutilizan casi todas las ingestas de rásteres.

## cr2met.py
- **Fuente:** CR2MET v2.5 (Boisier et al., CR2), precipitación diaria en grilla de 0,05°. El zip trae **un NetCDF por mes** (744 archivos, 2,4 GB descomprimido) y se descarga a mano.
- **Qué hace:** extrae **un mes a la vez** del zip, recorta a la región, suma los días, promedia por comuna y descarta (nunca más de 21 MB en disco). Arma la **climatología** (promedio de cada mes calendario) y aplica `factor_R`.
- **Por qué climatología:** R representa el régimen de lluvias, no un año concreto (un año seco daría una erosividad artificialmente baja).
- **Escribe:** factor **R** en `indicadores.factor`.

## soilgrids.py
- **Fuente:** ISRIC **SoilGrids 2.0** (250 m, sin credenciales): arcilla, limo, arena, carbono orgánico.
- **Por qué no una fuente chilena:** `SUELOS_AGROLOGICOS` (IDE MINAGRI) solo trae clase de capacidad de uso; `ANALISIS_DE_SUELOS` solo cubre la RM 2016. El nomograma necesita textura y materia orgánica.
- **Conversiones:** dividir por el factor de escala del servicio (10) y carbono → materia orgánica × **1,724** (Van Bemmelen).
- **Qué hace:** consulta puntos dentro de cada comuna (`puntos_en_comuna`), calcula K (`k_de_comuna`). **Escribe:** factor **K**.

## sentinel.py
- **Fuente:** Sentinel-2 L2A vía la **Process API de Sentinel Hub** (Copernicus Data Space; credenciales `SH_CLIENT_ID/SECRET`).
- **Por qué Process API:** el servidor compone el mosaico, descarta nubes y calcula el NDVI; llega una imagen de cientos de KB por comuna (minutos en vez de días). La Statistical API respondía `{"data": []}` con estado 200 en esta cuenta: **falla silenciosa**, verificada contra el Catalog API.
- **Decisiones:** nubes fuera con la máscara **SCL** (una nube tiene NDVI bajo y se confundiría con suelo desnudo); **mediana**, no promedio.
- **Escribe:** factor **C** (vía `factor_C`) y, con `--raster-dir`, el NDVI a 30 m por comuna (lo usan `mapa_erosion` y el índice de inundación).

## practicas.py
- **Qué hace:** el **factor P**, donde la política pública entra al modelo: `P = 1 − fracción_intervenida·(1 − P_práctica)`.
- **Piezas:** superficie intervenida (`programas.ejecucion`), superficie agrícola ≈ **área que evalúa CIREN** (`mascara_ciren.tif`), pendiente media sobre esa máscara.
- **Supuestos declarados:** la superficie agrícola se aproxima por el área de CIREN (comparte huella con LS, C y la línea base); toda la superficie bonificada se atribuye a P; etc.
- **Estado:** falla en este equipo porque falta `mascara_ciren.tif` (la deja `ciren.py`; existe en el equipo de Bastián). → [[Programador de tareas#Estado conocido]]

## sirsd.py
- **Qué hace:** cargador **genérico** de planillas del SIRSD-S (CSV/XLSX): `--archivo planilla.csv --anio 2024 [--fuente "transparencia activa"]`.
- **Calidad declarada:** `entrega directa` con superficie → `precision_dato='completa'`; transparencia activa sin superficie → `'reducida'`.
- **Nada se pierde en silencio:** lo que no se asocia a una comuna va a `programas.ejecucion_rechazada` con el motivo ("un programa que pierde el 8 % de los registros sin avisar produce un mapa que miente").
- **Funciones:** `normalizar` (sin tildes ni mayúsculas), `a_numero` (formato chileno: `1.234,5`), `mapear_columnas` (cabeceras con variantes), `emparejar_practica`, `procesar`, `resumen`. Lo reutiliza `sirsd_ide.py`.

## sirsd_ide.py
- **Fuente:** FeatureServer público `IDEMINAGRI/PROG_RECUPERACION_SUELOS_DEGRA_DESCARGA` (CIREN): superficie bonificada y monto por predio.
- **Privacidad:** descarta explícitamente `nom_operad` (nombre) y `rol_4` (rol); agrega por comuna antes de escribir. → [[Privacidad y datos personales]]
- **Ojo:** `su_uso_agr` (superficie agrícola del predio) **no** sirve como denominador de P: solo cubre predios bonificados.
- **Escribe:** `programas.ejecucion`. Tarea del programador: `ingesta.transparencia`.

## sirsd_serie.py
- **Fuente:** `bd/semillas/sirsd_serie_definitiva_2012_2025.csv` + complemento oficial. **Escribe:** `programas.sirsd_anual`.
- **Además de copiar:** `marcar_anomalias` (inversión > 3× incentivo, caso 6307/2017), compara cada celda con la entrega oficial, y `revisar_cobertura` **rechaza la carga** si faltan comunas o años o hay duplicados. → [[SIRSD-S e INDAP]] · [[Semillas]]

## hidrologia.py
- **Qué hace:** derivados del DEM sobre **toda la región** (con margen): pendiente, curvatura, **acumulación de flujo** (D8 sobre el DEM acondicionado con pysheds, en log₁₀) y **TWI** = ln(a / tan β). Escribe `/datos/inundacion/{pendiente,curvatura,acumulacion,twi}.tif`.
- **Por qué aparte de `zonal`:** la acumulación de una celda depende de **toda la cuenca aguas arriba**; recortar por comuna dejaría fuera lo que drena desde la comuna vecina (justo lo que inunda). Recorta al área de interés porque las 107 millones de celdas completas no caben en memoria.

## desinventar.py
- **Fuente:** **DesInventar** (UNDRR, alimentado por ONEMI): export del país, ZIP de 3 MB con XML de 98 MB. SENAPRED no publica registro descargable (se buscó).
- **Qué hace:** filtra la región por código INE, empareja comunas **por nombre normalizado** (los códigos de DesInventar no coinciden con el INE), guarda el nombre original para auditar. **Escribe:** `indicadores.evento_inundacion` (63 eventos con comuna).
- **Para validar, no entrenar.** → [[Validación y Spearman]]

## manzanas.py
- **Fuente:** Censo **2017** por manzana (INE, copia OCUC), paginado. **Escribe:** `territorio.manzana` (7.762 manzanas, ~706 mil personas: solo urbano). Hoy es el **respaldo** de [[#poblacion_censal.py]].

## poblacion_censal.py
- **Fuente:** el GeoPackage del **Censo 2024** que ya baja [[#censo.py]], capas `Manzanas_CPV24` (urbanas y de aldea) y `Entidades_CPV24` (caseríos, parcelas, fundos).
- **Escribe:** `territorio.unidad_censal` (~982 mil personas: la región completa). Solo llave, categoría, nombre, personas y viviendas. **Funciones:** `leer`, `filas`, `entero`, `nombre`. → [[Exposición]]

## equipamiento.py
- **Fuente:** OpenStreetMap vía **Overpass** (requiere encabezado `User-Agent`; sin él responde 406).
- **Qué hace:** `consulta` por el recuadro de la región; `clasificar` por `TIPOS` (educación: school, kindergarten, college, university; salud: hospital, clinic, doctors; emergencia: fire_station, police, ambulance_station); `punto` (nodos o centro de recintos); asigna comuna en la base y descarta lo de fuera. **Escribe:** `territorio.equipamiento`. Licencia ODbL.

## worldcover.py
- **Fuente:** **ESA WorldCover 10 m 2021 v200** (CC BY 4.0), en el almacenamiento público de la ESA en AWS; se lee **solo la ventana de la región** por bloques directo del COG remoto (`/vsicurl/`).
- **Qué hace:** fracción de **cultivo (clase 40)** y **pradera (clase 30)** en cada celda de la rejilla de 30 m del índice de inundación (`teselas_de`, `fracciones`, `construir_vrt`, `remuestrear` por bloques de 256 filas).
- **Salidas:** `/datos/cobertura/agricola.tif`, `/datos/teselas/agricola.pmtiles` (R = 1 + % cultivo, G = 1 + % pradera) e `indicadores.cobertura_agricola` (ha por comuna y cuántas sobre el corte "Alta"). → [[Exposición]]

## censo.py
- **Fuente:** INE, Censo 2024, GeoPackage regional (almacenamiento público, sin credenciales; 189 variables, se usan 3 capas y la cantidad de personas).
- **Escribe:** `territorio.limite_urbano`, `zona_censal`, `manzana_censal` (**solo urbanas**: los estándares de áreas verdes son urbanos). La zona censal reemplaza a la unidad vecinal. **Funciones:** `ruta_gpkg`, `descargar`, `leer`, `validar`, `cargar`.

## areas_verdes.py
- **Fuente:** OSM vía Overpass. **Escribe:** `territorio.area_verde`.
- **Tres pasos:** 1) polígonos con geometría; 2) **disolver solapes** y recortar al límite urbano; 3) partes ≥ 450 m² clasificadas como **plaza** (< 2 ha) o **parque** (≥ 2 ha); las de solo pasto se marcan `solo_pasto`.
- **Regla contrastada con el SIEDU** (Rancagua 8,5 m²/hab vs. 8–9 oficial). → [[Áreas verdes y calor urbano]]

## ecostress.py
- **Fuente:** ECOSTRESS `ECO_L2T_LSTE` (NASA Earthdata; ~340 MB). **Por qué no Landsat:** su descarga masiva exige aprobación del USGS.
- **Verificado sobre una escena real:** LST en float32 **ya en Kelvin**, relleno NaN, EPSG:32719, 70 m, máscaras de nube y agua aparte.
- **Qué hace:** `escenas` de **verano** (`es_de_verano`: enero y febrero), `leer_celsius`, `promedio_de_escenas` (celda a celda, ignorando sin dato), `por_comuna`. **Escribe:** `indicadores.urbano`.

Ver también: [[Motor - pruebas]] · [[Flujo de datos]]
