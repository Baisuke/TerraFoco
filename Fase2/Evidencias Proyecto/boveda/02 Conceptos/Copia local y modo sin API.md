# Copia local y modo sin API

Principio del visor: **nunca queda en blanco y nunca miente sobre lo que muestra.**

## Los tres orígenes de un dato en pantalla

| Origen | Cuándo | Badge (barra superior) |
|---|---|---|
| **API** (en vivo) | La API responde | verde: "Datos reales · CIREN 2024 · 27 de 33 comunas en el índice"; cambia a aviso si se muestran comunas fuera de dominio |
| **Copia local** | La API no responde, pero existe `prototipo/datos/indicadores.js` | gris: "Copia local · …" (ni verde ni naranja: es real pero no en vivo) |
| **Ejemplo** | Ni API ni copia (caso extremo) | "Prototipo · datos de ejemplo" |

El texto lo arma `rotular` en `datos-api.js` (expuesto como `GT.rotularOrigen`) y el color, `estadoBadge` en `shell.js`.

## La copia local

- **Archivo:** `prototipo/datos/indicadores.js` — un `<script>` que define `TERRAFOCO_INDICADORES` con los **últimos valores reales conocidos** (pertinencia, erosión de ambos orígenes, factores, serie SIRSD-S, inundación, eventos, urbano y áreas verdes), en JSON compacto.
- **Se genera con** `python herramientas/sembrar_indicadores.py` (consulta la API; usa las mismas cuentas de `api/focalizacion.py`). → [[Herramientas#sembrar_indicadores.py]]
- **Por qué `.js` y no `.json`:** al abrir el HTML con doble clic la página viene de `file://`, donde `fetch()` de un archivo local está bloqueado; un `<script>` sí carga.
- **Historia:** antes el respaldo eran cifras escritas a mano en `data.js` (Litueche aparecía con 38,4 t/ha cuando el dato real es 4,64). La copia reemplazó la ficción por datos reales.

## Cómo funciona en el código

`datos-api.js` envuelve cada página: `GT.hidratar().then(...)`. La promesa **nunca se rechaza**: si la API no está, se resuelve igual con la copia (o con el ejemplo) y marca el origen (`GT.origen…`). Lo mismo `GT.hidratarInundacion`, `GT.hidratarUrbano`, `GT.hidratarAreasVerdes`. → [[Visor - scripts base#datos-api.js]]

## Otros respaldos del visor (mejora progresiva)

| Si falla… | …se usa | Dónde |
|---|---|---|
| La API de geometrías | `prototipo/datos/comunas.js` (copia estática de IDE Chile) | [[Visor - mapas y módulos#mapa-real.js]] |
| MapLibre (no carga) | El mapa esquemático de `mapa.js` | [[Visor - scripts base#mapa.js]] |
| El CDN de MapLibre/PMTiles/three.js | Las copias en `prototipo/vendor/` | [[Visor - estilos, datos y librerías#vendor/]] |
| Las teselas PMTiles | Los PNG por comuna (`datos/*/indice.js`) | [[Teselas y PMTiles]] |
| El pronóstico de Open-Meteo | La última respuesta guardada (marcada "vencida") | [[API - rutas#inundacion.py]] |

## Lo que la copia no tiene

Lo que se calcula por comuna en el momento (exposición, localidades, pronóstico) requiere la API. Las páginas lo dicen en vez de inventar.

Ver también: [[Arquitectura]]
