# 18 · Déficit de áreas verdes (módulo 3, objetivo 7)

El objetivo específico 7 del perfil pide «desarrollar el módulo urbano
generando un indicador de déficit de áreas verdes». Hasta la migración 013,
la pantalla de Ciudades lo mostraba con cifras de ejemplo por unidad vecinal.
Desde la 014 se calcula con datos públicos, con los estándares oficiales
chilenos.

## 1. Fuentes

| Qué | Fuente | Cómo se obtiene |
|---|---|---|
| Personas por manzana, zonas censales y límite urbano | Censo 2024, INE | GeoPackage regional del almacenamiento público del INE (29 MB para O'Higgins), `python -m ingesta.censo` |
| Plazas, parques y áreas verdes | OpenStreetMap | Overpass API, sin credenciales, `python -m ingesta.areas_verdes` |
| Estándares | SIEDU (INE / CNDU) | 10 m²/hab; plaza (450 m² a 2 ha) a 400 m; parque (2 ha o más) a 3 km |

**Por qué zona censal y no unidad vecinal.** El catastro de unidades
vecinales lo lleva cada municipio y no es público. La zona censal es la unidad
oficial más fina con población publicada: Rancagua tiene 79 zonas urbanas de
unos pocos miles de personas cada una, el mismo orden de tamaño que una unidad
vecinal.

Solo se usa lo **urbano**: 10.487 manzanas con 717.233 personas en 32
comunas. En el área rural una «manzana» es una entidad de varios kilómetros,
donde no tiene sentido buscar una plaza a 400 m.

## 2. Qué cuenta como área verde pública

La regla se eligió comparándola con el único dato oficial que existe: el
SIEDU, que usa los catastros municipales y ubica a Rancagua **entre 8 y 9
m²/hab**.

| Etiquetas de OSM | Rancagua |
|---|---|
| parques y plazas (`leisure=park\|garden`, `landuse=village_green\|recreation_ground`) | 6,0 m²/hab |
| **+ pasto (`landuse=grass`: bandejones y platabandas)** | **8,5 m²/hab** |
| + canchas y juegos infantiles | 9,4 m²/hab |

- Se usa la segunda fila.
- El pasto entra porque los catastros municipales cuentan los bandejones.
- Las canchas y los juegos no, porque el SIEDU mide área verde y no recintos
  deportivos.
- Se descarta lo marcado como privado.

Después de filtrar:

1. Los polígonos que se solapan se disuelven. Una plaza dibujada como `park`
   con un `grass` encima cuenta una vez.
2. Se recortan al límite urbano del censo.
3. Cada parte continua de 450 m² o más se clasifica como el SIEDU: plaza
   hasta 2 ha, parque desde 2 ha.

Resultado en la región: 1.776 áreas (1.749 plazas y 27 parques) y 593 ha.
Cada área guarda los identificadores de OSM de donde salió.

**Bandejones (`solo_pasto`).** Las áreas hechas solo de pasto suman a los m²
por habitante, como en los catastros municipales. No cuentan para el acceso a
400 m, porque un bandejón no es un lugar al que se va caminando.

## 3. Las tres medidas

Por comuna (su área urbana) y por zona censal:

1. **m² por habitante** = área verde / personas urbanas. El **déficit** es lo
   que falta para 10: `max(0, 10 × personas − área)`.
2. **Acceso a plaza**: personas cuya manzana tiene una plaza o un parque a
   400 m o menos.
3. **Acceso a parque**: personas con un parque a 3 km o menos.

El acceso se mide desde un punto interior de cada manzana y no respeta
límites comunales, igual que las personas: una manzana de Machalí a 300 m de
una plaza de Rancagua tiene plaza.

**Limitación que se declara.** El acceso se mide en **línea recta**. El SIEDU
usa la red de calles, que es más larga, así que aquí el acceso queda
sobreestimado: el 97 % de Rancagua con plaza a 400 m es un techo, no el valor
exacto.

## 4. Resultados (Censo 2024, OSM al 25-09-2026)

| Comuna | Personas urbanas | m²/hab | Faltan (ha) | Plaza a 400 m | Parque a 3 km |
|---|---|---|---|---|---|
| Rancagua | 244.771 | 8,5 | 37,5 | 97 % | 97 % |
| San Fernando | 65.267 | 5,7 | 28,2 | 81 % | 89 % |
| Machalí | 59.273 | 12,5 | — | 90 % | 93 % |
| Rengo | 50.370 | 7,2 | 14,4 | 87 % | 83 % |
| Graneros | 31.494 | 5,6 | 13,7 | 95 % | 0 % |
| Chimbarongo | 24.300 | 3,3 | 16,3 | 58 % | 0 % |
| Doñihue | 16.712 | 2,6 | 12,3 | 67 % | 0 % |

**En la vista de Ciudades** (Rancagua y sus 6 comunas vecinas):

- 390 mil habitantes urbanos, con 8,2 m²/hab en conjunto;
- 6 de las 7 comunas bajo el estándar;
- 84 de 125 zonas censales bajo el estándar, donde viven 308 mil personas;
- faltan 83,9 ha para que todas lo cumplan.

**Dentro de Rancagua** el promedio esconde mucho. Hay zonas con 0,5 m²/hab
(la zona 4, con 5.805 personas) al lado de otras que superan el estándar. Esa
diferencia es la que el detalle por zona hace visible.

## 5. Completitud de OpenStreetMap

OSM es tan completo como su comunidad. En Rancagua reproduce el catastro
oficial. En pueblos chicos puede faltar una plaza, y entonces el déficit se
sobreestima. Por eso la pantalla muestra la fecha de la descarga. Para revisar
una comuna en particular, sus áreas se pueden ver en el mapa y cada una lleva
su enlace a OSM.

## 6. Simular un área verde

En **Ciudades → Simular un parque** se elige tamaño (0,1 a 20 ha) y tipo
(pasto, mixto, arbolado), y se hace clic en el mapa: brotan los árboles y el
un halo azul de enfriamiento se abre sobre el mapa de temperatura. Responde:
si se pone un área verde aquí, ¿cuánto baja la temperatura, hasta dónde se
nota y a quién le llega?

1. **Mide lo que ya pasa en esa ciudad**, como se mide en la literatura (Cao
   et al., 2010): cada parque de 1 ha o más que no es solo pasto, contra su
   propio entorno urbano de 100 a 500 m sin otras áreas verdes, con la
   temperatura de ECOSTRESS a 70 m. El promedio ponderado por celdas es la
   isla fresca local. **En Rancagua: 0,44 °C** (22 parques; El Edén 1,2 °C,
   Catalunya 0,7 °C). Con menos de 4 parques medibles se usa 0,5 °C y se
   dice.

   Se probó primero comparar las áreas verdes con los barrios a más de 500 m
   de cualquiera, y no sirve: esos barrios quedan en el borde de la ciudad,
   junto a campos regados más frescos, y la mayoría de las áreas de OSM son
   bandejones de pasto; así medidos, los parques de Rancagua salían 0,3 °C
   *más cálidos*. Las cifras son de décimas porque la temperatura promedia
   escenas de día y de noche: a pleno sol la diferencia es mayor.
2. **La aplica al parque nuevo**, escalada por el tamaño (crece con el
   logaritmo del área; Cao et al., 2010), el tipo (pasto 0,7, mixto 1,
   arbolado 1,3; Bowler et al., 2010) y la distancia (afuera decae como
   `exp(−3d/L)`, con `L` el ancho del parque entre 60 y 400 m; Aram et al.,
   2019). Varios parques no se suman: cada celda toma el más fuerte.
3. **A quién le llega:** personas del Censo 2024 que viven donde baja al
   menos 0,25 °C, personas que quedan con una plaza a 400 m sin tenerla hoy, y
   el área verde por habitante de la zona censal frente al estándar de 10 m².

Con solo PNG por comuna (sin teselas de calor), la temperatura de cada celda
sale de su clase: el punto medio de cada tramo, corrido para que la media de
la comuna sea la que midió el motor.

Lo que no dice: es temperatura de la **superficie**, no del aire (la del aire
baja bastante menos), y el resultado real depende del riego, las especies y
el diseño. Hay temperatura por celda para Rancagua y sus seis comunas
vecinas.

## 7. Orden de ejecución

```bash
docker exec -i terrafoco-motor python -m ingesta.censo            # descarga el GeoPackage si falta
docker exec -i terrafoco-motor python -m ingesta.areas_verdes     # Overpass
docker exec -i terrafoco-motor python -m indicadores.area_verde
```

API:
- `/urbano/areas-verdes`: por comuna y por zona censal, con los estándares;
- `/urbano/areas-verdes/geojson?comuna=`: zonas con su indicador y plazas y
  parques, para el mapa.
