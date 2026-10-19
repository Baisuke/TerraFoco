# Teselas y PMTiles

Cómo el visor muestra el detalle a 30 m de **toda la región**, con el valor exacto bajo el cursor, sin servidor de mapas.

## El problema que resuelven

Antes, el detalle a 30 m se servía como **un PNG por comuna, ya coloreado** (sigue existiendo como respaldo en `prototipo/datos/{erosion,inundacion,calor}/`). Limitaciones:

- una comuna a la vez, y cada clic espera su imagen;
- el PNG trae el **color**, no el valor: no se puede decir "23,4 t/ha/año" bajo el cursor ni mover un corte sin repintar;
- al alejarse, el navegador reduce la imagen completa en cada cuadro.

## La solución

`motor/teselas.py` corta la región en una **pirámide de teselas** de 512 px (zoom 6 a 11; en z11 un píxel ≈ 31 m, la celda de cálculo). Cada píxel guarda el **valor** codificado en RGB con la codificación *terrain-RGB* de Mapbox:

```text
n = round((valor · escala + 10000) · 10)
R, G, B = n >> 16, (n >> 8) & 255, n & 255
valor = (−10000 + (R·65536 + G·256 + B) · 0,1) / escala      ← lo hace MapLibre
```

MapLibre lo trata como un **modelo de elevación** y la capa `color-relief` lo colorea en la GPU con una expresión de estilo. Cambiar cortes, ocultar clases o mover el umbral es cambiar la expresión: **no se vuelve a descargar nada**. El 0 (RGB 0,0,0) es "sin dato".

Todas las teselas de una capa van en **un solo archivo PMTiles**. El navegador pide solo los bytes de las teselas en pantalla con **peticiones de rango HTTP** (`Range:`). Por eso el servidor del visor debe soportar rangos. → [[Herramientas#rangos.py]]

## Las capas

| Capa | Fuente | Escala | Zoom | Cortes | Uso |
|---|---|---|---|---|---|
| `relieve` | NASADEM | 1 (m) | 5–10 | — | Sombreado del mapa base, terreno 3D, modelo 3D |
| `erosion` | `/datos/erosion/erosion_*.tif` (RUSLE 30 m) | 1 | 6–11 | 10/18/26/34 | Visor, capa erosión |
| `ndvi` | NDVI Sentinel-2 de verano | 1000 | 6–11 | 0,2/0,4/0,6/0,8 | Visor, capa vegetación |
| `pendiente` | `/datos/inundacion/pendiente.tif` | 1 (%) | 6–11 | 5/15/30/50 | Visor, modelo 3D |
| `inundacion` | `susceptibilidad.tif` | 1000 | 6–11 | cuartiles del `.json` | Inundaciones |
| `calor` | ECOSTRESS, °C | 1 | 6–10 | los de `mapa_calor` | Ciudades |

Los **cortes viajan en los metadatos** del archivo: el motor es la única fuente de los cortes; el visor arma la expresión de color leyéndolos de ahí.

### Dos archivos especiales (no se dibujan, se leen)

- `inundacion_variables.pmtiles` — solo z11; cada tesela es una imagen **512×1024** (dos bloques): arriba R pendiente, G acumulación, B distancia a cauces; abajo R TWI, G curvatura, B cobertura. Cada canal guarda la variable **normalizada y ya volteada** (0 = sin dato, 1..255 = 0..1). → [[Motor - raíz#variables_inundacion.py]]
- `agricola.pmtiles` — z11; R = 1 + % cultivo, G = 1 + % pradera, 0 = fuera de las comunas. → [[Motor - ingesta#worldcover.py]]

## Dónde están

`prototipo/datos/teselas/*.pmtiles` — **no se versionan** (`.gitignore`), pesan ~150 MB en total. Se regeneran con `python -m teselas`, `python -m variables_inundacion` y `python -m ingesta.worldcover`, o se suben al servidor con `publicar.sh --teselas`. Sin ellas, el visor usa los PNG por comuna. → [[Despliegue y Codespaces#publicar.sh]]

## En el visor

`mapa-real.js` registra el protocolo `pmtiles://` (`registrarTeselas`) y `detalle-comuna.js` arma la capa continua, la expresión de color, la lectura del valor bajo el cursor (`decodificarT…`) y la grilla de la comuna abierta. → [[Visor - mapas y módulos#mapa-real.js]] · [[Visor - mapas y módulos#detalle-comuna.js]]

Pruebas: [[Motor - pruebas#test_teselas.py]] (ida y vuelta con precisión de una décima, el 0 no se confunde con "sin dato", la regla de clases es la misma del visor).
