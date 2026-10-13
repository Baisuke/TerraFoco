# Glosario

| Término | Significado | Nota |
|---|---|---|
| **Acumulación de flujo** | Cuántas celdas drenan hacia una celda siguiendo la pendiente (D8). Alta en fondos de valle y cauces | [[Susceptibilidad a inundación]] |
| **API REST** | Servicio HTTP que entrega datos en JSON; aquí FastAPI en el puerto 8000 | [[API - núcleo]] |
| **Bitácora** | Registro de cada ejecución del motor (`operacion.ejecucion_proceso`) | [[Bitácora y catálogo de fuentes]] |
| **Brecha en UF** | Incentivo que le falta a una comuna para llegar a la mediana regional de UF por hectárea erosionada | [[Índice de pertinencia]] |
| **Calibrado** | Marca del índice de inundación cuando la validación cumple el criterio declarado | [[Validación y Spearman]] |
| **CIREN** | Centro de Información de Recursos Naturales; publica el Inventario Nacional de Erosión (línea base) | [[Motor - ingesta#ciren.py]] |
| **COG** | *Cloud Optimized GeoTIFF*: ráster que se puede leer por ventanas desde internet | [[Motor - ingesta#worldcover.py]] |
| **CORS** | Regla del navegador que limita qué sitios pueden leer una API | [[API - núcleo#main.py]] |
| **CR2MET** | Grilla de precipitación diaria de Chile (Centro de Ciencia del Clima y la Resiliencia) | [[Motor - ingesta#cr2met.py]] |
| **CRISP-DM** | Metodología estándar de proyectos de datos (comprensión, preparación, modelado, evaluación, despliegue) | [[Documentos del proyecto#05-scrum.md]] |
| **Cuartiles** | Cortes que dividen los datos en cuatro partes iguales; clases de inundación | [[Susceptibilidad a inundación]] |
| **Curvatura** | Segunda derivada del terreno; negativa en concavidades (donde se junta el agua) | [[Motor - indicadores#terreno.py]] |
| **DEM** | Modelo digital de elevación; aquí NASADEM 30 m | [[Motor - ingesta#srtm.py]] |
| **DesInventar** | Base de desastres de UNDRR alimentada por ONEMI; fuente de los 63 eventos | [[Motor - ingesta#desinventar.py]] |
| **Dominio de validez** | Rango donde el modelo propio de erosión es confiable (R ≤ 2.000) | [[Dominio de validez]] |
| **ECOSTRESS** | Sensor térmico en la Estación Espacial; temperatura superficial de día y de noche | [[Áreas verdes y calor urbano]] |
| **EPSG:4326 / 32719** | Coordenadas geográficas (grados, WGS84) / UTM huso 19 sur (metros) | [[Esquema de la base]] |
| **Factor C, K, LS, P, R** | Cobertura, erodabilidad del suelo, longitud-pendiente, prácticas, erosividad de la lluvia | [[RUSLE y erosión]] |
| **GeoJSON** | Formato JSON para geometrías; lo que entrega la API y lee QGIS | — |
| **Horn (1981)** | Método estándar para calcular pendiente en una grilla (el de GDAL) | [[Motor - indicadores#terreno.py]] |
| **INDAP** | Instituto de Desarrollo Agropecuario; cliente final y ejecutor del SIRSD-S | [[SIRSD-S e INDAP]] |
| **Idempotente** | Que se puede correr varias veces con el mismo resultado (migraciones, `inicializar.sh`) | [[Migraciones]] |
| **KML** | Formato de Google Earth; las zonas y predios se exportan así | [[Visor - mapas y módulos#zonas.js]] |
| **MapLibre GL** | Librería de mapas web en GPU (fork libre de Mapbox GL) | [[Visor - mapas y módulos#mapa-real.js]] |
| **Migración** | Script SQL numerado que cambia el esquema de forma ordenada | [[Migraciones]] |
| **NDVI** | Índice de vegetación: (NIR − rojo)/(NIR + rojo); de −1 a 1 | [[Motor - ingesta#sentinel.py]] |
| **Normalización min–max** | Llevar valores a 0–1: (x − mín)/(máx − mín) | [[Índice de pertinencia]] |
| **OSM / Overpass** | OpenStreetMap y su API de consultas; fuente de áreas verdes y equipamiento | [[Motor - ingesta#equipamiento.py]] |
| **Pertinencia** | Grado en que la inversión llega donde está el problema; `necesidad − inversión` | [[Índice de pertinencia]] |
| **PMTiles** | Un archivo con toda una pirámide de teselas, leído por rangos HTTP | [[Teselas y PMTiles]] |
| **PostGIS** | Extensión espacial de PostgreSQL (geometrías, rásteres, índices GIST) | [[Esquema de la base]] |
| **Ráster** | Imagen georreferenciada donde cada celda guarda un valor (elevación, NDVI…) | — |
| **RUSLE** | *Revised Universal Soil Loss Equation*: `A = R·K·LS·C·P` | [[RUSLE y erosión]] |
| **Semilla** | Datos agregados versionados que se cargan sin descargar nada | [[Semillas]] |
| **Sentinel-2** | Satélites ópticos de la ESA (10–20 m, revisita ~5 días) | [[Motor - ingesta#sentinel.py]] |
| **SIEDU** | Sistema de Indicadores y Estándares de Desarrollo Urbano (INE/CNDU) | [[Áreas verdes y calor urbano]] |
| **SIRSD-S** | Sistema de Incentivos para la Sustentabilidad Agroambiental de los Suelos Agropecuarios | [[SIRSD-S e INDAP]] |
| **Spearman (ρ)** | Correlación de rangos: mide si dos variables ordenan igual | [[Validación y Spearman]] |
| **Strahler** | Orden jerárquico de los cauces: quebradas 1–2, ríos principales ≥ 5 | [[Motor - ingesta#cauces.py]] |
| **Terrain-RGB** | Codificación de un valor numérico en los tres canales de color de un píxel | [[Teselas y PMTiles]] |
| **Tesela** | Cuadrado de 256/512 px de una pirámide de zoom | [[Teselas y PMTiles]] |
| **TWI** | Índice topográfico de humedad: ln(área drenada / tan pendiente) | [[Susceptibilidad a inundación]] |
| **UF** | Unidad de Fomento: unidad reajustable por inflación; se usa para deflactar | [[Índice de pertinencia]] |
| **Umbral** | Valor del índice desde el cual el visor marca "riesgo"; lo elige la persona | [[Exposición]] |
| **WFS** | *Web Feature Service*: estándar para pedir geometrías a un servidor (CIREN, IDE Chile) | [[Motor - ingesta]] |
| **WorldCover** | Mapa global de cobertura del suelo de la ESA a 10 m (2021) | [[Motor - ingesta#worldcover.py]] |
| **Zona censal** | Agrupación oficial de manzanas del INE; reemplaza a la unidad vecinal | [[Motor - ingesta#censo.py]] |
