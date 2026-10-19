# Áreas verdes y calor urbano (módulo 3)

Pantalla: `urbano.html` ("Ciudades"), marcada como **complementaria** en el menú: el foco del cliente (INDAP) es rural. → [[Visor - páginas#urbano.html]]

## Calor urbano · temperatura superficial (HU-18)

- **Fuente:** ECOSTRESS `ECO_L2T_LSTE` (NASA Earthdata), no Landsat: la descarga masiva de Landsat exige una aprobación del USGS que el proyecto no tiene; ECOSTRESS usa las mismas credenciales de Earthdata que NASADEM.
- **Ventaja:** ECOSTRESS va en la Estación Espacial y pasa a **distintas horas, también de noche**, cuando la isla de calor se manifiesta (el hormigón devuelve el calor). Landsat pasa siempre en la mañana.
- **Detalle técnico verificado:** la banda LST viene en float32 **ya en Kelvin**, sin factor de escala; aplicar el 0,02 de otras versiones da −267 °C (así se detectó el error). 70 m, EPSG:32719.
- **Cálculo:** media celda a celda de las **escenas de verano** (enero y febrero) sin nube ni agua → media, máxima y mínima por comuna en `indicadores.urbano`. → [[Motor - ingesta#ecostress.py]]
- **Dentro de la ciudad:** `mapa_calor.py` hace los PNG por comuna y `teselas.py` la capa `calor`. Rancagua promedia 27,7 °C pero su décimo más caliente pasa de 32 °C: esa diferencia **es** la isla de calor, y en el coropleto comunal no se ve. → [[Motor - raíz#mapa_calor.py]]

## Déficit de áreas verdes (objetivo específico 7, HU-19, RF-25)

Estándares del **SIEDU** (INE / Consejo Nacional de Desarrollo Urbano):

1. **10 m² de área verde pública por habitante.** Déficit = `max(0, 10 × personas − área)`.
2. **Plaza** (450 m² a 2 ha) a no más de **400 m**.
3. **Parque** (≥ 2 ha) a no más de **3 km**.

### Fuentes

- **Población:** Censo 2024 por manzana urbana, agrupada en **zonas censales** (reemplazan a la unidad vecinal, cuyo catastro es municipal y no público). → [[Motor - ingesta#censo.py]]
- **Áreas verdes:** OpenStreetMap (`leisure=park|garden`, `landuse=village_green|recreation_ground|grass`, salvo privadas). La regla se eligió **contrastándola con el SIEDU**: solo parques y plazas da 6,0 m²/hab en Rancagua; agregando el pasto (bandejones) da **8,5**, dentro del rango oficial (8 a 9). Las canchas quedan fuera. → [[Motor - ingesta#areas_verdes.py]]
- Se disuelven solapes (una plaza dibujada dos veces cuenta una vez), se recorta al límite urbano y se descarta lo < 450 m². Las partes **solo pasto** suman m² pero no cuentan como plaza a la que se va caminando.

### Cálculo

`indicadores/area_verde.py`: por comuna (área urbana) y por zona censal. El acceso se mide desde un punto interior de cada manzana, **en línea recta** (el SIEDU usa la red de calles: aquí el acceso queda **sobreestimado**, y se declara). No respeta límites comunales. → [[Motor - indicadores#area_verde.py]]

### Resultados destacados (Censo 2024, OSM sept. 2026)

| Comuna | m²/hab | Plaza a 400 m | Parque a 3 km |
|---|---|---|---|
| Rancagua | 8,5 | 97 % | 97 % |
| San Fernando | 5,7 | 81 % | 89 % |
| Machalí | 12,5 | 90 % | 93 % |
| Chimbarongo | 3,3 | 58 % | 0 % |

En Rancagua y sus 6 vecinas: 6 de 7 comunas bajo el estándar; 84 de 125 zonas censales bajo el estándar (308 mil personas); faltan 83,9 ha.

## Simular un área verde

Pestaña **Simular un parque** de `urbano.html`: tamaño (0,1 a 20 ha), tipo (pasto, mixto, arbolado) y un clic en el mapa. Brotan los árboles y un halo azul de enfriamiento se abre sobre el mapa de temperatura; un círculo punteado marca hasta dónde se nota.

1. **Mide la isla fresca de esa misma ciudad**, por parque (Cao et al., 2010): cada parque de 1 ha o más (sin los de solo pasto) contra su propio entorno urbano de 100 a 500 m. **Rancagua: 0,44 °C** en 22 parques (El Edén 1,2; Catalunya 0,7). Con menos de 4 parques medibles usa 0,5 °C y lo dice. Comparar con barrios lejanos no sirve: quedan junto a campos regados y daba los parques *más* cálidos.
2. **La aplica al parque nuevo:** crece con el logaritmo del tamaño (Cao et al., 2010), pasto 0,7 · mixto 1 · arbolado 1,3 (Bowler et al., 2010), y afuera decae como exp(−3d/L), con L el ancho del parque entre 60 y 400 m (Aram et al., 2019). Varios parques no se suman.
3. **A quién le llega:** personas (Censo 2024) donde baja ≥ 0,25 °C, personas que ganan una plaza a 400 m y el m²/hab de la zona censal frente al estándar de 10.

Es temperatura de la **superficie**, no del aire, y promedia día y noche: por eso son décimas de grado (a pleno sol es más). Solo hay temperatura por celda para Rancagua y sus seis vecinas. → [[Visor - mapas y módulos#simulacion-calor.js]]

## API y tablas

- `GET /urbano` (temperatura por comuna; el NDVI urbano viene `null` y se dice: "no medido" ≠ "cero").
- `GET /urbano/areas-verdes` y `/urbano/areas-verdes/geojson?comuna=`. → [[API - rutas#urbano.py]]
- Tablas: `indicadores.urbano`, `indicadores.area_verde`, `territorio.area_verde`, `territorio.manzana_censal`, `territorio.zona_censal`, `territorio.limite_urbano` (migraciones 006 y 014). → [[Migraciones#014_areas_verdes.sql]]

Documento completo: [[Documentos del proyecto#18-areas-verdes.md]]
