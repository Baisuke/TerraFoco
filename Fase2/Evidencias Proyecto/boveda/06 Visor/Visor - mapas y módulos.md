# Visor · mapas y módulos

**Carpeta:** `prototipo/js/`. Los scripts que hacen el trabajo pesado del visor: el mapa real, el detalle a 30 m, el cálculo y la interfaz de inundaciones, las exportaciones, el modelo 3D y Mis predios. Base: [[Visor - scripts base]].

| Archivo | Global | Lo cargan |
|---|---|---|
| [[#mapa-real.js]] | `GTMapaReal` | index, visor, inundaciones, urbano, predios |
| [[#detalle-comuna.js]] | `GTDetalle` | visor, inundaciones, urbano |
| [[#inundacion-calculo.js]] | `GTCalculo` | inundaciones, predios |
| [[#inundacion.js]] | `GTInundacion` | inundaciones |
| [[#zonas.js]] | `GTZonas` | visor, inundaciones, predios |
| [[#modelo3d.js]] | `GTModelo3D` | visor |
| [[#predios.js]] | `GTPredios` | predios |
| [[#simulacion-lluvia.js]] | `GTSimLluvia` | inundaciones |
| [[#simulacion-inundacion.js]] | `GTSimInundacion` | inundaciones |
| [[#simulacion-calor.js]] | `GTSimCalor` | urbano |
| [[#simulacion-verde.js]] | `GTSimVerde` | urbano |

---

## mapa-real.js
- **Qué hace:** el mapa con **geometrías reales** (MapLibre GL 5). Reemplaza al esquemático de `mapa.js` con **mejora progresiva**: si la API no responde usa `datos/comunas.js`; si MapLibre no carga, vuelve al esquemático. Siempre marca el origen de la geometría (`marcarOrigen`).
- **Entrada pública:** `GTMapaReal.crearConRespaldo(contenedor, { capa })` (lo que llaman las páginas), `GTMapaReal.crear`, `GTMapaReal.disponible`, `GTMapaReal.teselas` (rutas de los PMTiles), `GTMapaReal.API`. Devuelve un objeto con el mapa y sus controles (`listo`, `base`, `alternar3D`, `en3D`).
- **Librerías:** `cargarMapLibre` / `cargarRecurso` intentan primero `prototipo/vendor/` y después unpkg (`MAPLIBRE_JS`, `PMTILES_JS`). `registrarTeselas` registra el protocolo `pmtiles://`.
- **Mapa base:** CARTO Dark Matter (oscuro) o Positron (claro), "entintado" para que el dato mande (`entintarBase`); `conmutadorDeBase` alterna base; `agregarRelieve` añade sombreado y terreno con las teselas `relieve`.
- **3D estilo Google Earth:** `boton3D` y `orbitaConRueda`: **arrastrar con la rueda apretada** gira y cambia la inclinación (hasta 85°); `pistaOrbita` lo explica la primera vez. Pantalla completa (`pantallaCompleta`, Esc para salir).
- **Clic en comuna:** abre el detalle (`abrirComuna` → [[#detalle-comuna.js]]); un segundo clic dentro de la comuna abierta consulta la celda (`alClicEnAbierta`).

- **`interactivo: false`** (opción de `crear`): el clic no abre comunas ni vuelve a la región, y no hay ventana con el valor. Lo usa `viajes.html`, donde el clic marca la salida y la llegada.

## detalle-comuna.js
- **Qué hace:** el **detalle intracomunal a 30 m** (erosión, inundación, pendiente, NDVI, calor) sobre el mapa. Es la escala a la que decide el programa: el SIRSD-S bonifica predios, no comunas.
- **Dos modos:**
  1. **Continuo** (teselas PMTiles de valores): `montarContinua`, `expresionColor` (colores por clase en la GPU), `decodificarTesela` / `lectorDeValores` (valor exacto bajo el cursor), `recortarAComuna` (la grilla de la comuna abierta). → [[Teselas y PMTiles]]
  2. **PNG por comuna** (respaldo): `traerIndice` (lee `datos/*/indice.js`), `fichaDe`, `leerClases` (clase desde el color), `pintar` / `pintarFino` (refinado en un *web worker*, `refinarVentana`).
- **Conexión:** `GTDetalle.conectar(mapa, contenedor, bajoCaminos, variable, opciones)` devuelve un **controlador** con: `mostrar(comuna)`, `ocultar`, `opacidad`, `disponible`, `infoUmbral`, `fijarUmbral`, `umbral`, `base` (la grilla), `indiceEn(lngLat)`, `claseEn`, `fijarValores` (pintar otros valores, p. ej. el índice con otros pesos), `escenario`, `localidades` / `listaLocalidades` / `irALocalidad` / `zonas` (índice de localidades), `resumen`, `zonasMarcadas` / `exportarZonas`, `pausar` / `reanudar`.
- **Eventos** que emite sobre el contenedor: `detalle:base` (grilla lista), `detalle:umbral`, `detalle:resumen`, `detalle:exportar`. `inundacion.js` escucha estos para recalcular exposición y localidades.
- **Configuración por variable:** clases, cortes, colores, `exportarDesde` (desde qué clase se exporta: erosión Severa, inundación todo lo marcado, pendiente Fuerte).
- **Panel lateral** (`panel`): clases con su superficie, casillas para ocultar clases (`alternarClase`), pista de clic, botón de exportar.

## inundacion-calculo.js
- **Qué es:** **las cuentas** del visor de inundaciones, sin interfaz, separadas para leerlas y probarlas como lo que son. Reproduce el motor, no lo aproxima.
- **Estadística:** `percentil` (interpolación lineal, como numpy), `cuartiles`, `fraccionBajo`, `clasificar`, `rangos`, `spearman`.
- **Pesos:** `Modelo` (carga `variables.json`), `normalizarPesos`, `mismosPesos`, `indiceComunal` (con las sumas por **patrón de datos disponibles**: el índice comunal exacto para cualquier juego, ±0,0001 respecto de la base), `normalizar`.
- **Celdas:** `grillaVariables` (lee `inundacion_variables.pmtiles`: las seis variables de cada celda), `valoresConPesos` (índice por celda con otros pesos).
- **Exposición:** `rasterizarManzanas` (reparte personas de cada unidad censal entre sus celdas; distingue rurales), `exposicion` (personas y viviendas sobre el umbral, urbano/rural), `grillaAgricola` + `exposicionAgricola` + `haPorCelda` (hectáreas de cultivo y pradera), `dentroDe` (punto en polígono), `evaluarEquipamiento`, `histograma`.
- → [[Exposición]] · [[Motor - raíz#variables_inundacion.py]]

## inundacion.js
- **Qué es:** la **interfaz** de `inundaciones.html` (`GTInundacion.iniciar`, `GTInundacion.inspeccionar`). Responde cuatro preguntas en orden: ¿qué parte se marca como riesgo? (umbral + histograma) · ¿qué queda encima? (localidades, población, agrícola, servicios) · ¿por qué esta celda? · ¿y con otros pesos?
- **Bloques:** `montarUmbral` / `dibujarHistograma`; `pintarResumen` + `lecturaIndap` (la lectura en lenguaje de INDAP: hectáreas y agricultores primero); `traerEquipamiento` / `pintarEquipamiento` / `popupEquipo`; `mostrarCauces`; `inspeccionar` / `pintarCelda` (las seis variables de la celda y su aporte); `montarPesos` / `juegos` / `pintarValidacion` / `aplicarEscenarioMapa` (explorador de pesos); `cargarPronostico` / `pintarPronostico`; `pintarEventos`; `montarBuscador` (comunas y localidades).
- **Enlace reproducible:** `leerUrl` / `escribirUrl` / `restaurarUrl` con `?comuna=&umbral=&pesos=&escenario=&loc=&cauces=&equip=`; `restaurarCuandoListo` espera a que la grilla anuncie el umbral antes de aplicar.
- **Exportar:** `informe` / `htmlInforme` (imprimible), CSV de comunas, localidades y equipamiento (`csvComunas`, `csvLocalidades`, `csvEquipamiento`), `pngMapa`, `zonasExportar` (KML/GeoJSON vía [[#zonas.js]]), `copiarEnlace`.
- Población: Censo 2024 (`/exposicion/poblacion`) con respaldo al Censo 2017 (`/exposicion/manzanas`), declarado.

## zonas.js
- **Qué hace:** convierte la grilla de 30 m de la comuna abierta en **polígonos por clase** descargables para **Google Earth (KML)** y **QGIS (GeoJSON)**.
- **Algoritmo:** `rectangulos` junta celdas en rectángulos (corridas por fila, luego corridas iguales de filas seguidas). Si salen más de `MAX_RECTANGULOS = 20000`, `agrupar` en bloques de k×k celdas por **mayoría** (no "cualquiera": no agranda lo marcado) con k creciente (60, 90… m) y lo declara en el nombre.
- **Salidas:** `geojson` (una Feature MultiPolygon por clase, 5 decimales, con clase, color, tamaño de celda y celdas), `kml` (color en `aabbggrr`, hectáreas en la descripción, carpeta de puntos opcional), `descargar`, `archivo` (nombre de archivo sin tildes).
- Pasó de un KML de 16 MB a ~1,7 MB en la misma comuna.

## modelo3d.js
- **Qué hace:** la comuna elegida como **un bloque sólido recortado por su límite**, que se gira en todas direcciones (también por debajo), como una maqueta. `GTModelo3D.abrir(comuna)` / `cerrar`.
- **Datos:** forma desde las teselas `relieve` (NASADEM, ~63 m en z10) y color desde `pendiente` (~31 m en z11) o hipsométrico por elevación (`texturaPendiente`, `texturaElevacion`). Paredes y base cierran el bloque (`construir`).
- **Controles:** botón izquierdo o rueda apretada giran, derecho desplaza, rueda acerca; táctil: un dedo gira, dos acercan. Exageración vertical, vistas predefinidas, giro automático, brújula, exportar PNG.
- **three.js** (r170) se carga **recién al abrir el primer modelo** (`cargarThree`, `import()` dinámico de `vendor/`): quien no lo usa no lo descarga.

## predios.js
- **Qué hace:** **Mis predios**. El ejecutivo de área carga un CSV con sus predios y ve, por predio: clase de inundación, erosión de la celda (y media CIREN de la comuna), pendiente, % cultivo/pradera y pertinencia de la comuna, con una observación.
- **Todo en el navegador** (Ley 19.628): el archivo no se sube ni se guarda. → [[Privacidad y datos personales]]
- **Funciones:** `leerCsv` (detecta separador `;`/`,`/tab y coma decimal), `utmAGrados` (UTM WGS84 huso 19 S por omisión, 18 S si se indica), `valorEn` / `rgbEn` / `tesela` / `pixel` (lee el valor de la celda en las teselas), `erosionEn`, `comunaDe`, `evaluar`, `observacion`, `pintarTabla`, `pintarMapa`, `csvResultados`, `kmlResultados`, `plantilla` (CSV de ejemplo). Públicas: `iniciar`, `montar`, `leerCsv`, `utmAGrados`.
- Un predio es **un punto**: se evalúa la celda donde cae la coordenada, no toda su superficie (se dice en pantalla).

## simulacion-lluvia.js
- **Qué es:** las cuentas de la simulación de lluvia, sin interfaz (probadas en Node). → [[Susceptibilidad a inundación#Simulación de lluvia]]
- **Contenido:** `CN` (tabla TR-55 por cobertura y grupo de suelo), `cnHumedad` (condiciones I/II/III), `cnPendiente` (Williams), `escorrentia` (número de curva), `original` (valor real de una variable desde su canal normalizado), `numerosDeCurva` (CN de cada celda con cultivo, pradera, ciudad, NDVI y pendiente; avisa qué faltó), `hietograma` (lluvia por hora: pareja, chubascos, concentrada o diaria del pronóstico), `ordenarCeldas` (de mayor a menor índice, por conteo: lineal aunque haya millones de celdas), `Acumulador` (suma lo expuesto en las primeras k celdas moviéndose de a poco), `simular` (hora a hora: lluvia, escorrentía, embalse lineal, celdas anegadas; corre hasta que el agua baja del 2 % del máximo), `profundidad`.
- Se agrupa por número de curva (medio punto) para sumar la escorrentía: la lluvia es la misma en toda la comuna.

## simulacion-inundacion.js
- **Qué es:** la pestaña **Simulación de lluvia** de `inundaciones.html` (`GTSimInundacion.iniciar`).
- **Piezas:** `montarPestanas` (Riesgo | Simulación), `montarControles` y `elegirEscenario` (escenarios y pronóstico), `preparar` (CN, orden y capas expuestas de la comuna, desde `GTInundacion.contexto()`), `simular` (precalcula todo y reproduce), `reproducir` / `pausar` / `irA` (animación interpolada entre horas), `asegurarCapa` / `pintarAgua` (un **lienzo** del tamaño de la grilla puesto sobre el mapa por sus esquinas, con los tonos de la rampa del agua por profundidad), `asegurarNube` / `pintarNube` (marcador con nube y gotas; más intensidad, más gotas y más rápidas), `pintarCifras`, `dibujarGrafico` (lluvia arriba, área anegada abajo; clic para ir a una hora), `descargarCsv`.
- Mientras corre, la capa del índice se atenúa al 18 % para que se lea el agua.

## simulacion-calor.js
- **Qué es:** las cuentas de **Simular un área verde**, sin interfaz (probadas en Node). → [[Áreas verdes y calor urbano#Simular un área verde]]
- **Contenido:** `grilla` (lng/lat ↔ celdas, tamaño real), `temperaturas` (°C desde la clase del PNG, corrido a la media medida de la comuna), `rasterizar` y `dentroDe` (polígonos a celdas), `distancia` (chaflán de dos pasadas en metros), `perfilPorParque` (isla fresca medida: cada parque de 1 ha o más contra su entorno de 100–500 m), `intensidad` (tamaño y tipo), `alcance` (60–400 m), `efecto` (enfriamiento por celda; varios parques toman el más fuerte), `resumir` (antes/después, a 100 y 200 m, hectáreas y personas más frescas, quién gana una plaza a 400 m, zona censal).

## simulacion-verde.js
- **Qué es:** la pestaña **Simular un parque** de `urbano.html` (`GTSimVerde.iniciar`, `activar`, `alClic`).
- **Piezas:** `preparar` (temperatura, zonas censales, áreas verdes, población rasterizada con `GTCalculo.rasterizarManzanas`), `pintarLocal` (lo que ya pasa en la ciudad), `colocar` / `alClic` (modo de ubicación; el clic llega por `alClicEnAbierta` de mapa-real), `plantar` (árboles como marcadores que brotan escalonados, en espiral de ángulo áureo), `pintarLienzo` + `animar` (un halo azul de enfriamiento que se abre desde el parque en 2,6 s, sobre el mapa de temperatura; recolorear las clases de 3 °C no mostraba cambios de décimas), `pintarFiguras` (círculo del parque y alcance punteado), `pintarResultados`, `quitarParque` / `quitarTodo`.

Ver también: [[Visor - páginas]] · [[Recorridos por el código]]
