# Recorridos por el código

Seguir una acción concreta a través de todas las capas. Abrir cada archivo mientras se lee.

---

## 1 · Abro `pertinencia.html` y veo el ranking

1. **HTML** `prototipo/pertinencia.html` carga en orden `tema.js` → `api-base.js` → `paleta.js` → `data.js` → `datos/indicadores.js` → `datos-api.js` → `shell.js` → `mapa.js` → `graficos.js`. → [[Visor - páginas#pertinencia.html]]
2. `pintarShell('pertinencia', …)` dibuja menú y barra superior; `montarControlesRegion` pide `GET /regiones`. → [[Visor - scripts base#shell.js]]
3. El script de la página llama `GT.hidratar()` → `fetch(GT_api('/pertinencia?origen=CIREN'))` (+ `/comunas/erosion`, `/comunas/terreno`). → [[Visor - scripts base#datos-api.js]]
4. **API** `api/rutas/pertinencia.py::listar` consulta `indicadores.v_pertinencia` filtrando región, origen y dominio, y agrega la brecha con `focalizacion.brecha_uf`. → [[API - rutas#pertinencia.py]]
5. **Base** la vista une la última erosión por comuna y origen, la suma 2012–2025 del incentivo en UF (`programas.sirsd_anual` ⋈ `uf_anual`) y la superficie con erosión severa; normaliza por ventana. → [[Índice de pertinencia]]
6. De vuelta, `aplicar` vuelca cada fila en `GT.comunas`, `aEscalaCero` lleva el índice a 0..1 y `rotular` escribe el badge "Datos reales · CIREN …".
7. La página clasifica con `GT.categoriaPertinencia`, dibuja la dispersión con `GTGrafico.dispersion`, el mapa con `GTMapaReal.crearConRespaldo` y la tabla exportable con `GT_exportarTabla`.
8. **Si la API no responde:** en el paso 3 el `fetch` falla, `GT.hidratar` usa `TERRAFOCO_INDICADORES` y el badge dice "Copia local". → [[Copia local y modo sin API]]

## 2 · Un número de CIREN llega a la ficha de Litueche

1. `python -m ingesta.ciren` (motor) pide por WFS cada cuenca al GeoServer de CIREN. → [[Motor - ingesta#ciren.py]]
2. Importa los polígonos a `operacion.erosion_ciren_cruda`, calcula la media de `RUSLE` ponderada por `AREA_HA` dentro de cada comuna y la acumula entre cuencas; descarta los polígonos.
3. `clasificar` (de `rusle.py`) da la clase; se inserta en `indicadores.erosion` con `origen='CIREN'`. Todo dentro de `Bitacora("…", fuente="ciren")`: queda la fila en la bitácora con `registros = 33`. → [[Bitácora y catálogo de fuentes]]
4. `GET /pertinencia/6203?origen=CIREN` → `pertinencia.py::una` → la fila de la vista.
5. `comuna.html?id=6203` muestra "Erosión estimada", la descomposición RUSLE (`/comunas/factores`), la serie (`/comunas/6203/sirsd`) y la **Recomendación para INDAP** (`GT.recomendacion`).

## 3 · Recalcular el índice de inundación (el programador)

1. `terrafoco-programador` corre `orquestador --demonio --intervalo 3600`. Cada hora, `cargar_tareas` lee `operacion.tarea_programada`. → [[Motor - orquestación#orquestador.py]]
2. `esta_vencida` decide: `indicadores.inundacion` es **trimestral**; si cambió el trimestre, vence. Su dependencia `ingesta.hidrologia` corrió ok, así que no está bloqueada. → [[Motor - orquestación#programacion.py]]
3. Se ejecuta `python -m indicadores.inundacion`: normaliza, combina por píxel, escribe `susceptibilidad.tif/.json`, agrega por comuna y guarda con `calibrado = FALSE`. → [[Motor - indicadores#inundacion.py]]
4. Vence `validar.inundacion` (depende de la anterior): `validar_inundacion --marcar-si-pasa` calcula la fracción de eventos en Alta/Muy alta, el azar y ρ; si `pasa_criterio`, marca `calibrado = TRUE`. → [[Validación y Spearman]]
5. Luego `mapa.inundacion`, `variables.inundacion` e `ingesta.worldcover` (dependen de la validación) regeneran PNG, variables y cobertura agrícola.
6. Si algo falla: queda `error` en la bitácora, se reintenta **24 h después**, y lo que dependía de esa tarea queda bloqueado. → [[Programador de tareas]]

## 4 · Muevo el umbral en `inundaciones.html` y cambia la población expuesta

1. Clic en una comuna → `mapa-real.js` llama `abrirComuna` → el controlador de `detalle-comuna.js` (`mostrar`) monta la capa continua desde `inundacion.pmtiles` y recorta la **grilla de la comuna** (`recortarAComuna`). Emite `detalle:base`. → [[Visor - mapas y módulos#detalle-comuna.js]]
2. `inundacion.js` (`alAbrirComuna`) pide `/exposicion/poblacion?comuna=`, `/localidades?comuna=`, `/exposicion/equipamiento` y lee `agricola.pmtiles`. `GTCalculo.rasterizarManzanas` reparte personas por celda; `grillaAgricola` lee el % de cultivo y pradera.
3. Muevo el control del umbral → `fijarUmbral` → la expresión de color cambia en la GPU (sin descargar nada) y se emite `detalle:umbral`.
4. `inundacion.js` recibe el evento y llama `GTCalculo.exposicion` y `exposicionAgricola` con las celdas sobre el umbral → `pintarResumen` + `lecturaIndap` ("≈ N ha de cultivo y M personas rurales sobre el umbral"); `evaluarEquipamiento` marca escuelas y postas. → [[Exposición]]
5. `escribirUrl` guarda el estado en la URL: el enlace reabre la misma vista.
6. "Descargar KML" → `zonasExportar` → `GTZonas.geojson` → `GTZonas.kml` → archivo para Google Earth. → [[Visor - mapas y módulos#zonas.js]]

## 5 · Cambio el estado de una fuente en `fuentes.html`

1. La persona pega la clave de administración en el diálogo (queda solo en la pestaña).
2. `PATCH /fuentes/12` con `Authorization: Bearer …`. CORS lo deja pasar (`allow_methods` incluye PATCH, `allow_headers` incluye Authorization). → [[API - núcleo#main.py]]
3. `requiere_admin` compara en tiempo constante; sin clave en el servidor → 503; clave mala → 401. → [[API - núcleo#seguridad.py]]
4. `CambioDeFuente` (pydantic) y `_validar_estado` validan contra `ESTADOS` → 422 si no corresponde. → [[API - rutas#fuentes.py]]
5. `UPDATE operacion.fuente` en una transacción; la respuesta trae la fila nueva con su última carga (de la bitácora).

## 6 · Un ejecutivo de INDAP evalúa sus predios

1. `predios.html` → arrastra un CSV. `GTPredios.leerCsv` detecta separador y coma decimal; `utmAGrados` convierte si vienen en UTM. → [[Visor - mapas y módulos#predios.js]]
2. Para cada punto: `comunaDe` (punto en polígono), `valorEn` lee la celda en `inundacion.pmtiles`, `pendiente.pmtiles` y `agricola.pmtiles`; `erosionEn` la erosión (teselas o PNG); la pertinencia de la comuna viene de `GT.comunas`.
3. `evaluar` + `observacion` arman la fila; `pintarTabla` y `pintarMapa` la muestran; `csvResultados` / `kmlResultados` exportan.
4. **Nada se envía a un servidor:** solo se piden teselas públicas; el CSV se olvida al cerrar la pestaña. → [[Privacidad y datos personales]]
