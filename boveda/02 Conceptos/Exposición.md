# Exposición

El índice dice **qué terreno** es susceptible. La pregunta de quien planifica es otra: **qué y quiénes quedan encima**. La exposición responde eso para la comuna abierta en `inundaciones.html`, siempre respecto del **umbral** que la persona eligió.

## Las capas

| Qué | Fuente | Tabla / archivo | Carga | Migración |
|---|---|---|---|---|
| **Población y viviendas (2024)** en manzanas urbanas, manzanas de aldea y entidades rurales | INE, Censo 2024 (GeoPackage regional) | `territorio.unidad_censal` (~982 mil personas: la región completa) | [[Motor - ingesta#poblacion_censal.py]] | 019 |
| Población urbana (2017), respaldo | INE Censo 2017 por manzana (copia OCUC) | `territorio.manzana` (~706 mil, solo urbano) | [[Motor - ingesta#manzanas.py]] | 016 |
| **Cultivo y pradera** (% de cada celda de 30 m) | ESA WorldCover 10 m 2021 (clase 40 cultivo, 30 pradera) | `agricola.pmtiles` + `indicadores.cobertura_agricola` | [[Motor - ingesta#worldcover.py]] | 019 |
| **Servicios críticos**: educación, salud, emergencia (bomberos, policía, ambulancias) | OpenStreetMap vía Overpass | `territorio.equipamiento` | [[Motor - ingesta#equipamiento.py]] | 016 |
| Ciudades y pueblos | INE, Límite Urbano Censal 2017 (copia OCUC) | `territorio.ciudad` | [[Motor - ingesta#localidades.py]] | 015 |

Región completa según WorldCover: ≈ 213.700 ha de cultivo y ≈ 408.300 ha de pradera.

## Cómo se cruza (en el navegador)

El cruce no lo hace la base: lo hace `inundacion-calculo.js` sobre la **misma grilla de 30 m que está pintada**, para que todo siga al umbral sin volver al servidor. → [[Visor - mapas y módulos#inundacion-calculo.js]]

1. **Población:** `rasterizarManzanas` reparte las personas de cada unidad censal entre las celdas que cubre. `exposicion` suma las personas de las celdas sobre el umbral, separando urbano y rural (`rurales` / `ruralesSobre`).
2. **Agrícola:** `grillaAgricola` lee las teselas `agricola` (R = 1 + % cultivo, G = 1 + % pradera); `exposicionAgricola` suma hectáreas de cultivo y pradera sobre el umbral (`haPorCelda` corrige el área real de la celda en Mercator).
3. **Servicios:** `evaluarEquipamiento` mira en qué celda cae cada punto y si supera el umbral.
4. **Localidades:** `dentroDe` decide qué celdas caen dentro de cada ciudad o pueblo y la página dice qué sector de qué localidad corre más riesgo.

## Lo que se declara al lado de la cifra

- La entidad rural es grande (mediana ~200 ha): repartir sus personas en sus celdas es más grueso que en la ciudad.
- WorldCover no separa frutales y viñedos: a menudo caen en "árboles" (clase 10) o en cultivo según densidad. La pradera incluye matorral abierto.
- OSM es colaborativo: completo en ciudades, con huecos en lo rural. El visor dice "según OpenStreetMap", no "todas las escuelas".
- Si no hay Censo 2024 cargado, el visor cae al Censo 2017 urbano y lo dice.

## Por qué importa para INDAP

Para INDAP lo urgente no son las escuelas urbanas sino **cuántas hectáreas de cultivo y cuántos agricultores** quedan en zona susceptible: sus usuarios viven en el campo, justo lo que la manzana urbana no cubre. Por eso la migración 019 agregó población rural y superficie agrícola. → [[SIRSD-S e INDAP]]

## API

`/exposicion/poblacion?comuna=`, `/exposicion/manzanas?comuna=`, `/exposicion/equipamiento`, `/exposicion/agricola`, `/localidades`. Cada respuesta lleva su **atribución** (INE/OCUC CC BY-NC 4.0, OSM ODbL, ESA CC BY 4.0). → [[API - rutas#exposicion.py]]

Ver también: [[Susceptibilidad a inundación]]
