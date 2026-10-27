# Visor · páginas

**Carpeta:** `prototipo/`. Nueve páginas HTML sin framework. Todas comparten la misma estructura: `<div id="sidebar">` + `<div id="topbar">` que pinta `pintarShell(id, título, subtítulo, …)` de `shell.js`, y un `<script>` final que espera `GT.hidratar()` antes de dibujar. → [[Copia local y modo sin API]]

**Orden de carga típico** (importa: cada script usa globales del anterior): `tema.js` (en `<head>`, antes del CSS) → `api-base.js` → `paleta.js` → `data.js` → `datos/indicadores.js` → `datos-api.js` → `shell.js` → `mapa.js` → `datos/comunas.js` → `mapa-real.js` → módulos de la página. → [[Visor - scripts base]]

Menú lateral (`MENU` en shell.js): **General** (Panel, Visor, Mis predios, Viajes a terreno) · **Módulo 1 — Suelos** (Pertinencia, Ficha de comuna) · **Módulos 2 y 3** (Inundaciones, Ciudades "complementario") · **Núcleo** (Fuentes, Ayuda).

---

## index.html
- **Panel general.** Tarjetas: superficie analizada, erosión severa o superior, incentivo SIRSD-S acumulado, índice de pertinencia regional, mapa de erosión por comuna, comunas por clase, **mayor brecha entre necesidad e inversión**, estado de las fuentes.
- **API:** `/pertinencia`, `/comunas/erosion`, `/ejecuciones/resumen`, `/fuentes`.

## visor.html
- **Visor cartográfico** de la región. Capas (`GT.capas`): erosión TerraFoco, erosión CIREN, NDVI, pendiente, inversión SIRSD-S, pertinencia, límites. Opacidad, mapa base, 3D con órbita por botón central (como Google Earth), y **clic en una comuna** → detalle a 30 m ([[Visor - mapas y módulos#detalle-comuna.js]]) y botón **Modelo 3D** de la comuna ([[Visor - mapas y módulos#modelo3d.js]]).

## predios.html
- **Mis predios** (para el ejecutivo de área de INDAP). Carga un CSV (o texto pegado) con nombre y lat/lon o UTM 19S; evalúa cada predio: inundación, erosión, pendiente, % cultivo/pradera y pertinencia de su comuna. Exporta CSV y KML. **Nada sale del navegador.**
- **Probar con predios de ejemplo:** carga `datos/predios_ejemplo.csv`, 12 predios **ficticios** sobre suelo agrícola elegidos para mostrar situaciones distintas (vega junto a un río, valle sin riesgo, ladera de secano, precordillera fuera de dominio). `datos/predios_ejemplo_utm.csv` trae cuatro de ellos en UTM para probar ese formato. → [[Visor - mapas y módulos#predios.js]] · [[Privacidad y datos personales]]

## viajes.html
- **Viajes a terreno.** Se marca la salida (A) y la llegada (B) con clic dentro de las 33 comunas (fuera de ellas, se avisa); se arrastran para moverlas. Estima litros, pesos, tiempo, km/L, CO₂ y % del estanque según el camino (tipo de vía, ripio, pendiente), el vehículo, la carga y el aire acondicionado. Ida y vuelta, evitar peajes o ripio, y hasta 3 rutas posibles comparadas. → [[Consumo de combustible]]
- Mapa y **perfil de alturas** coloreados por consumo, tipo de camino o pendiente; pasar el cursor por el perfil marca el tramo en el mapa.
- **▶ Recorrer:** un autito recorre la ruta (×1, ×2, ×4) con un tablero de km, velocidad, vía, altura, pendiente, litros, pesos y la aguja del estanque. "Vista de conductor" inclina y gira la cámara detrás del auto.
- El viaje queda en la dirección (`?desde=lat,lon&hasta=lat,lon`) para compartirlo; "Mis predios" abre la página con el predio de llegada (`?hasta=`). El mapa se crea con `interactivo: false`: el clic marca puntos, no abre comunas.
- Archivos: `js/viaje-calculo.js` (el modelo, sin DOM) y `js/viajes.js` (camino, mapa, perfil y autito).

## pertinencia.html
- **Índice de pertinencia.** Pregunta del módulo, dispersión necesidad vs. inversión, brecha crítica, cobertura adecuada, distribución por categoría, **¿cuánto costaría cerrar la brecha?** (UF), **¿ha mejorado la focalización?** (por año), ranking comunal exportable. Selector de origen y casilla "fuera de dominio". → [[Índice de pertinencia]]

## comuna.html
- **Ficha de comuna** (`comuna.html?id=6101`). Erosión estimada y modelo propio, superficie intervenida, índice, **descomposición RUSLE** (R, K, LS, C, P medidos), incentivo SIRSD-S por año, lectura del cruce, **Recomendación para INDAP** (`GT.recomendacion`) y la comuna en los otros módulos.

## inundaciones.html
- **Susceptibilidad a inundación.** Columna derecha con dos pestañas: **Riesgo dentro de la comuna** y **Simulación de lluvia** (una nube llueve sobre la comuna y el agua avanza hora a hora; ver [[Susceptibilidad a inundación#Simulación de lluvia]]). El mapa queda fijo al recorrer la columna. Mapa regional y de la comuna, **umbral** con histograma, ciudades y pueblos, **¿por qué esta celda?**, exposición (personas urbanas y rurales, ha de cultivo y pradera, escuelas/salud/emergencia), explorador de pesos, lluvia pronosticada 7 días, eventos validados, tabla de eventos, "Cómo se calcula". Exporta informe, CSV, imagen, **KML y GeoJSON**. Enlace reproducible: `?comuna=&umbral=&pesos=&escenario=&loc=&cauces=&equip=`. → [[Visor - mapas y módulos#inundacion.js]] · [[Susceptibilidad a inundación]]

## urbano.html
- **Ciudades** (módulo 3, complementario). Tres pestañas en el mapa: Temperatura, Áreas verdes y **Simular un parque** (se pone un área verde con un clic, brotan los árboles y el mapa se enfría; ver [[Áreas verdes y calor urbano#Simular un área verde]]). Temperatura superficial media, diferencia térmica interna, área verde por habitante, déficit por zona censal, mapa de Rancagua y vecinas con detalle de calor a 70 m. → [[Áreas verdes y calor urbano]]

## fuentes.html
- **Fuentes de datos** (núcleo). Motor, fuentes conectadas, comunas con indicadores, procesos ejecutados, **catálogo editable con la clave de administración** (se guarda solo en la pestaña), últimas ejecuciones, gestión pendiente; exporta el catálogo. → [[Bitácora y catálogo de fuentes]]

## ayuda.html
- **Ayuda y glosario.** Qué es TerraFoco, atajos de teclado, qué responde cada pantalla, glosario, "lo que esta herramienta no dice" y licencias de los datos.

## Parámetros de URL comunes
- `?api=https://…` — dónde está la API (se recuerda en `localStorage`; `?api=` vuelve al valor por defecto). → [[Visor - scripts base#api-base.js]]
- `?region=6` — región activa. `?tema=claro` — tema claro (proyectores).
