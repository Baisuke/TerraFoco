# Visor · scripts base

**Carpeta:** `prototipo/js/`. Los scripts que cargan **todas** (o casi todas) las páginas. Sin framework ni bundler: cada archivo define globales (`GT`, `PALETA`, `GTMapa`, `GTGrafico`, funciones `GT_…`) y se cargan con `<script>` en orden. Así el visor funciona incluso abierto con doble clic (`file://`).

Orden: [[#tema.js]] → [[#api-base.js]] → [[#paleta.js]] → [[#data.js]] → `datos/indicadores.js` → [[#datos-api.js]] → [[#shell.js]] → [[#mapa.js]] → [[#graficos.js]]. Los módulos de mapas vienen después: [[Visor - mapas y módulos]].

---

## tema.js
- **Qué hace:** fija `<html data-tema="oscuro|claro">` **antes de que se pinte nada** (va en `<head>`, antes del CSS; al final del body la página parpadeaba).
- El tema se elige con el botón de la barra superior y se recuerda en `localStorage`; también `?tema=claro` (útil para proyectar: el oscuro se ve lavado en proyector).
- **Cambiar de tema recarga la página:** mapa base, rampas y gráficos se arman al cargar; repintarlos en caliente sería un segundo camino de pintado que mantener.

## api-base.js
- **Qué hace:** decide **dónde está la API**. Por omisión `http://localhost:8000`; con `?api=https://…` (una vez) queda guardado en `localStorage` y las demás páginas lo reutilizan; `?api=` vuelve al valor por defecto. También `?region=`.
- **Globales:** `GT_API_BASE`, `GT_REGION`, `GT_api(ruta)` (arma la URL).
- **Por qué existe:** en un Codespace o una VM, "localhost" es el computador del público, donde no hay nada. Va primero porque lo leen `datos-api.js` y `mapa-real.js`, y no todas las páginas cargan ambos.

## paleta.js
- **Qué es:** **la única fuente de verdad del color.** El CSS replica estos valores en variables; los módulos JS los leen de `PALETA`.
- **Familia INDAP:** verde institucional `#2B9C68` (botones, enlaces, lo elegido), azul marino `#001C41`, turquesa, azules, naranja, ámbar, rojo.
- **Dos temas** (`TEMAS_PALETA`) con los mismos nombres de rol (tinta, gris, rejilla, serie1…). El oscuro **no es el claro invertido**: sus rampas se generaron en OKLCH con tono fijo y se validaron contra el fondo del mapa (`#0B1626`): luminosidad monótona, saltos ≥ 0,06, clase más tenue a más de 2:1 del fondo.
- **Rampas de datos** (`PALETA.rampas`): `erosion`, `pertinencia`, `agua` (inundación), `calor`, `ndvi`, `pendiente`… Los colores de erosión son **exactamente** los que usa `mapa_erosion.py` (el visor lee la clase desde el color del PNG).

## data.js
- **Qué es:** el objeto global `GT` con **datos de ejemplo** (de la fase de prototipo no funcional) **y las reglas de negocio del visor**.
- **Datos:** `GT.comunas` (33, con cifras ilustrativas que la API o la copia reemplazan), `GT.capas` (capas del visor), `GT.fuentes`, `GT.ejecuciones`, `GT.pipeline`, `GT.unidadesVecinales`, `GT.conurbacion` (Rancagua y vecinas), `GT.eventosInundacion`, `GT.variablesInundacion`.
- **Reglas que hay que conocer:**
  - `GT.clasesErosion` (Ligera…Extrema) y `GT.claseErosion(v)`.
  - `GT.categoriasPertinencia` (Sobre-cobertura < 0,25 … Brecha crítica ≥ 0,75) y `GT.categoriaPertinencia(v)`. → [[Índice de pertinencia]]
  - `GT.enIndice(c)`, `GT.motivoSinIndice(c)`, `GT.comunasIndice()` — qué comunas entran al índice (dominio, origen).
  - `GT.recomendacion(c)` — la frase para INDAP según la categoría y la brecha en UF ("Priorizar en el próximo concurso del SIRSD-S…"; fuera de dominio: "Decidir con la línea base de CIREN…"). No agrega juicios que el dato no respalde.
  - `GT.notaInversion`, `GT.unidadInversion`, `GT.inversionDe`, `GT.medianaInversion`.
  - Formato chileno: `GT.fmt` (coma decimal, `es-CL`), `GT.fmtUF`.
  - `GT.getFactores`, `GT.descripcionFactores` (textos de R, K, LS, C, P).

## datos-api.js
- **Qué hace:** **hidrata** `GT` desde la API, o desde la copia local, y **rotula** el origen. → [[Copia local y modo sin API]]
- **Uso en cada página:** `GT.hidratar().then(function () { …dibujar… })`. La promesa **nunca se rechaza**.
- **Funciones públicas:** `GT.hidratar` (pertinencia + erosión + terreno), `GT.hidratarInundacion`, `GT.hidratarUrbano`, `GT.hidratarAreasVerdes`, `GT.areasVerdesGeo`, `GT.factoresRusle`, `GT.serieSirsd`, `GT.evolucionFocalizacion`, `GT.origenesDisponibles`, `GT.cambiarOrigen`, `GT.cambiarDominio`, `GT.rotularOrigen`.
- **Internas:** `normalizar`, `aEscalaCero` (`(p+1)/2`: de −1..1 a 0..1), `aplicar` (vuelca la respuesta en `GT.comunas`), `aplicarErosionesA`, `aplicarTerrenoA`, `rotular` (texto del badge: "Datos reales · CIREN 2024 · 27 de 33 comunas en el índice" / "Copia local · …" / "Prototipo · datos de ejemplo"), `aplicarInundacion`, `eventosReales`, `aplicarUrbano`, `aplicarAreasVerdes`.
- Variables de estado: `GT.origenDatos` (`api`/`copia`/`ejemplo`), `GT.origenErosion`, `GT.origenInundacion`, `GT.incluirFueraDeDominio`.

## shell.js
- **Qué hace:** la **barra lateral y la barra superior** comunes. `pintarShell(id, título, subtítulo, extra, descripción)` las dibuja en `#sidebar` y `#topbar`.
- **Contenido:** `ICONOS` (SVG en línea), `MENU` (grupos y páginas; Ciudades marcada "complementario"), `montarMenuLateral` (con botón ☰ en pantallas chicas), `montarBuscadorGlobal` (buscar comuna → ficha), `montarControlesRegion` (región como texto + período leído de `/regiones`), `estadoBadge` (color del badge: vivo/aviso/copia), `montarCasillaDominio` ("incluir fuera de dominio"), `montarSelectorOrigen` (CIREN/TerraFoco), `botonTema`.
- **Utilidades globales:** `GT_fecha` / `GT_hoy` (fechas en zona `America/Santiago`), `GT_exportarTabla` / `exportarCSV` (CSV con BOM y `;` para Excel en español).

## mapa.js
- **Qué es:** el **mapa esquemático** de la fase de prototipo: una retícula irregular de 35 celdas (33 usadas) con desplazamiento pseudoaleatorio determinístico (`mulberry32`). Hoy es el **respaldo** cuando MapLibre no carga.
- **También aporta las leyendas y clases** que usa todo el visor: `GTMapa.leyendaRampa`, `leyendaCortes`, `leyendaClases`, `leyendaInundacion`, `leyendaPertinencia`, `GTMapa.rampas`, `GTMapa.clases`, `GTMapa.valorCapa`, `GTMapa.filaSinDato`; y `GTMapa.crearRegional` / `crearCiudad` (el esquemático).

## graficos.js
- **Qué es:** gráficos **en SVG sin librerías** (`GTGrafico`): `barras`, `serie` (línea temporal, p. ej. incentivo por año), `dispersion` (necesidad vs. inversión), `comparacion`, `focalizacion` (participación en el incentivo vs. en el problema, por año).
- Colores por **rol** de `PALETA` (tinta, gris, rejilla, serie1…), no por nombre de marca: el tema se cambia en un solo lugar. Lo que se lee va con coma decimal (`numeroLegible`); la sintaxis del SVG, con punto.

Ver también: [[Visor - páginas]] · [[Visor - estilos, datos y librerías]]
