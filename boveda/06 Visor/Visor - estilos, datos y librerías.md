# Visor · estilos, datos y librerías

Lo que no es lógica en `prototipo/`: la hoja de estilos, los datos estáticos que acompañan al visor y las librerías de terceros.

---

## css/styles.css
- **Ubicación:** `prototipo/css/styles.css` (~1.600 líneas, una sola hoja).
- **Criterio de diseño:** tema oscuro y sobrio; *"la interfaz calla y el dato habla"*. El cromo (paneles, bordes, texto) es neutro; el color se reserva para mapas y gráficos. **Un solo acento:** el verde institucional de INDAP, solo en lo que se puede tocar o está elegido. Sin brillos, degradados decorativos ni texturas (se probaron y hacían ver el sistema como plantilla). La jerarquía sale de tamaño, peso y espacio.
- **Accesibilidad:** contraste medido con WCAG: el texto de los tres niveles pasa AA sobre las tres superficies.
- **Organización:** variables de color por tema (`[data-tema]`, replican [[Visor - scripts base#paleta.js]]), layout (`.app`, `.sidebar`, `.main`, `.content`, `.grid--main`, `.stack`), componentes (`.card`, `.kpi`, `.table`, `.btn`, `.notice`, `.badge`, `.chip`), mapas (`.map`, `.map__overlay`, leyendas, `.basectl`), y bloques por módulo: detalle intracomunal (`.detalle__…`), umbral e histograma, pesos, lluvia, cifras de exposición, modelo 3D, recomendación, carga de predios, menú en pantallas chicas.
- **Responsive:** columnas que se apilan y menú lateral plegable en pantallas angostas.

## datos/ (datos estáticos del visor)

| Archivo | Qué es | Generado por | Por qué está |
|---|---|---|---|
| `datos/comunas.geojson` y `datos/comunas.js` | Las 33 comunas de IDE Chile con código INE (el `.js` es copia idéntica como `<script>`) | Copia de IDE Chile | Respaldo de `/comunas/geojson`; fuente de `sembrar_comunas.py` |
| `datos/indicadores.js` | **Copia local** de los indicadores (JSON compacto en `TERRAFOCO_INDICADORES`) | [[Herramientas#sembrar_indicadores.py]] | Modo sin API → [[Copia local y modo sin API]] |
| `datos/erosion/indice.json` + `.js` + 33 PNG | Erosión a 30 m por comuna (PNG coloreado + esquinas + mediana, p90, máximo) | [[Motor - raíz#mapa_erosion.py]] | Respaldo del detalle continuo |
| `datos/inundacion/indice.json` + `.js` + 33 PNG | Susceptibilidad a 30 m por comuna, con método, pesos y cortes | [[Motor - raíz#mapa_inundacion.py]] | Ídem |
| `datos/inundacion/variables.json` | Variables del índice, sumas por patrón y muestra de 40 mil celdas | [[Motor - raíz#variables_inundacion.py]] | Explorador de pesos exacto |
| `datos/calor/indice.json` + `.js` + 7 PNG | Temperatura superficial (Rancagua y vecinas) | [[Motor - raíz#mapa_calor.py]] | Detalle de Ciudades |
| `datos/predios_ejemplo.csv` y `datos/predios_ejemplo_utm.csv` | 12 predios **ficticios** (y 4 de ellos en UTM 19S) en situaciones distintas | Elegidos midiendo puntos agrícolas en las capas del índice, pendiente y WorldCover | Botón "Probar con predios de ejemplo" de Mis predios |
| `datos/teselas/*.pmtiles` | `relieve`, `pendiente`, `inundacion`, `inundacion_variables`, `agricola` (y `erosion`, `ndvi`, `calor` donde existan los rásteres) | `teselas.py`, `variables_inundacion.py`, `ingesta.worldcover` | **No se versionan** (~150 MB) → [[Teselas y PMTiles]] |

**Por qué hay `.js` gemelos de los `.json`:** abierto con doble clic (`file://`) el navegador bloquea `fetch()` de archivos locales; un `<script>` sí carga.

> [!note] En este PC
> Faltan `erosion.pmtiles` y `ndvi.pmtiles` (los rásteres de 30 m los tiene el equipo de Bastián): el visor usa los PNG por comuna para esas dos capas.

## vendor/
Librerías de terceros **incluidas en el repositorio**, para que el mapa cargue aunque una red institucional bloquee el CDN (si faltaran, `mapa-real.js` las pide a unpkg):

| Archivo | Librería | Licencia | Lo usa |
|---|---|---|---|
| `maplibre-gl.js` / `.css` | MapLibre GL 5.24.0 | BSD-3 (`LICENCIA-maplibre.txt`) | Todos los mapas |
| `pmtiles.js` | PMTiles 4.5.0 (Protomaps) | BSD-3 | Lectura de teselas por rangos |
| `three.module.min.js` | three.js r170 | MIT (`LICENCIA-three.txt`) | Modelo 3D |
| `OrbitControls.js` | Controles de órbita de three.js, **parchado** para importar `./three.module.min.js` en vez de `three` (sin mapa de importaciones) | MIT | Modelo 3D |
| `LEEME.txt` | Versiones, licencias y el porqué | — | — |

## nginx.conf
- Configuración de nginx **sin caché** (`Cache-Control: no-store`) para servir el prototipo en una demo: el navegador no se queda con un JS viejo. Hoy no la monta ningún script (Codespaces usa la configuración por defecto de `nginx:alpine`, y en desarrollo se usa `servir_prototipo.py`). Se conserva como referencia.

## README.md (del prototipo)
- El README de la **Fase 1** (prototipo no funcional, semana 3): qué era, pantallas, cómo abrirlo, decisiones y tecnología prevista. Es **histórico**: describe el punto de partida; el estado actual está en el README de la raíz y en esta bóveda.

Ver también: [[Visor - páginas]]
