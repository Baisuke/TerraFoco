# Motor · pruebas

**Carpeta:** `motor/tests/` (≈270 pruebas, pytest). **Correr:**

```bash
docker exec -i terrafoco-programador python -m pytest tests -q
docker exec -i terrafoco-programador python -m pytest tests/test_factores.py -q    # un archivo
```

**Filosofía:** se prueba donde un error **no se nota**: un factor mal escalado, un rango mal calculado o una cadencia mal evaluada dan un resultado plausible y equivocado, sin excepción. Casi todas son **sin base de datos ni red**: rásteres sintéticos con rasterio, planos de pendiente conocida, casos con respuesta conocida. `__init__.py` vacío.

| Tema | Archivos |
|---|---|
| Erosión | [[#test_rusle.py]] · [[#test_factores.py]] · [[#test_terreno.py]] · [[#test_zonal.py]] · [[#test_validar.py]] |
| Inversión | [[#test_sirsd.py]] · [[#test_sirsd_serie.py]] · [[#test_superficie_png.py]] |
| Operación | [[#test_bitacora_fuente.py]] · [[#test_programacion.py]] |
| Inundación | [[#test_hidrologia.py]] · [[#test_cauces.py]] · [[#test_inundacion.py]] · [[#test_criterio_calibracion.py]] · [[#test_variables_inundacion.py]] · [[#test_teselas.py]] |
| Exposición | [[#test_exposicion.py]] · [[#test_worldcover_poblacion.py]] · [[#test_localidades.py]] |
| Ciudades | [[#test_areas_verdes.py]] · [[#test_ecostress.py]] · [[#test_mapa_calor.py]] |

---

## test_rusle.py
Producto de los cinco factores; un factor en cero anula el resultado; rechaza factores fuera de rango; clasificación según los rangos de CIREN. → [[Motor - indicadores#rusle.py]]

## test_factores.py
Cada ecuación reproduce su comportamiento publicado: Fournier exige 12 meses y castiga la concentración de lluvia; R en rango para climas reales y crece con la lluvia; sin lluvia R = 0; K de un suelo franco típico en rango, **"si falta la conversión a SI se notaría"**, más materia orgánica → menos erodable (satura en 4 %), rechaza porcentajes imposibles; LS de la parcela patrón; C y P en sus casos límite. Además, que el conjunto dé pérdidas del orden de CIREN (5–60 t/ha/año). → [[Motor - indicadores#rusle.py]]

## test_terreno.py
Un plano horizontal no tiene pendiente; Horn **reproduce la pendiente de un plano inclinado** en cualquier dirección; el tamaño de celda cambia el resultado (si diera 21 % donde el plano tiene 20 %, hay un error de celda); celdas rectangulares; versión vectorizada = escalar; LS crece con la pendiente; media ignora NaN y respeta máscara; sin celdas válidas devuelve `None`, no NaN. → [[Motor - indicadores#terreno.py]]

## test_zonal.py
Rechaza rásteres en grados y acepta proyectados; LS de un plano coincide con la teoría; **cada comuna recibe solo sus celdas**; una comuna fuera del ráster no inventa un cero; el nodata no se toma como elevación; C baja donde hay más vegetación; agua y nube dan cobertura nula. → [[Motor - ingesta#zonal.py]]

## test_validar.py
Rangos sin empates y con empates (promedio); el orden de entrada no altera; monótona creciente → 1, decreciente → −1; mide orden y no escala; **caso con respuesta conocida**; constante sin correlación definida; simetría; la relación perfecta es improbable por azar y el ruido no alcanza significancia; reproducible; el barrido excluye por erosividad. → [[Motor - raíz#validar.py]]

## test_sirsd.py
`normalizar` quita tildes, mayúsculas y puntuación; **formato chileno** (`1.234,5`) no se lee como decimal; vacíos y marcadores dan `None`; mapeo de cabeceras con variantes; prácticas exactas y laxas; fila completa se carga; sin superficie → `reducida`; comuna desconocida se **rechaza con motivo**; fila vacía no suma cero; **nada se pierde en silencio** (cargadas + rechazadas = total). → [[Motor - ingesta#sirsd.py]]

## test_sirsd_serie.py
El umbral de superficie es el límite de "Moderada" (18); sin dato no cuenta; se marca **solo** la inversión imposible y la celda anómala conserva su incentivo; la cobertura detecta comunas faltantes, ajenas y duplicadas; NaN se carga como NULL y no como cero; une el complemento por comuna y año; la semilla de superficie es la del cálculo. → [[Motor - ingesta#sirsd_serie.py]]

## test_superficie_png.py
Contar "Severa o superior" desde los PNG: son las clases sobre 18; lo transparente no cuenta; rutas desde el índice. Si el conteo por color se desalinea de los cortes, el índice cambia de denominador sin que nada falle. → [[Motor - indicadores#superficie_erosionada.py]]

## test_bitacora_fuente.py
`Bitacora(fuente=...)` traduce el código a `id_fuente`; un código desconocido **no rompe** la ingesta; un id explícito manda; y la prueba clave: **cada código de fuente usado en `motor/ingesta` existe en el catálogo** que siembran las migraciones (por eso el compose monta `./bd` en el motor). → [[Bitácora y catálogo de fuentes]]

## test_programacion.py
Lo que nunca corrió está vencido; la `unica` no se repite; la `manual` nunca vence sola; la inactiva no vence; si falló se reintenta pero **espera un día**; mensual espera al día indicado; semanal a los 7 días; estacional solo en su ventana y una vez al año; trimestral cambia con el trimestre; cadencia desconocida falla fuerte; las dependencias van antes; detecta ciclos; bloquea por dependencia fallida. → [[Motor - orquestación#programacion.py]]

## test_hidrologia.py
TWI sube con la acumulación y baja con la pendiente; no revienta en plano ni en cero; es el logaritmo esperado; la acumulación crece hacia abajo en un plano inclinado. → [[Motor - ingesta#hidrologia.py]]

## test_cauces.py
`_entero` tolera lo que manda el WFS; la URL pide GeoJSON en 4326 dentro del bbox; la distancia euclidiana en metros desde una línea. → [[Motor - ingesta#cauces.py]]

## test_inundacion.py
Los pesos suman 100 y cada variable declara su sentido; **los pesos calibrados son los que respaldó la validación**; normalizar directa va de 0 a 1 y recorta extremos; la inversa voltea; conserva NaN; rechaza variable constante; combinar = suma ponderada que propaga NaN e ignora pesos 0; los cuartiles reparten en cuatro partes iguales; clasificar es relativo a los cortes. → [[Motor - indicadores#inundacion.py]]

## test_criterio_calibracion.py
El índice vigente pasa; mayoría pero igual que el azar **no** pasa; sin mayoría no pasa; orden al revés no pasa aunque mejore al azar; la mejora mínima es de 10 puntos. → [[Motor - indicadores#validar_inundacion.py]]

## test_variables_inundacion.py
Cero es sin dato y los extremos van a 1 y 255; las inversas se voltean antes de guardar; ida y vuelta dentro de medio paso; **la media comunal usa solo las celdas con las variables con peso**; la muestra filtra como el motor; disposición de la tesela (dos bloques); tesela vacía no se guarda. Si esto se desalinea, el visor explicaría una celda con números que no son los que la clasificaron. → [[Motor - raíz#variables_inundacion.py]]

## test_teselas.py
Ida y vuelta con precisión de una décima; la escala conserva decimales del índice; sin dato es 0 y vuelve como NaN; negativos y el cero no se confunden con sin dato; fórmula de Mapbox; la tesela contiene al punto; cada capa declara lo que el visor necesita; **la regla de clases es la misma del visor**; la erosión cierra arriba y las demás abajo. → [[Teselas y PMTiles]]

## test_exposicion.py
Paginación ordenada de las manzanas; fila de manzana; sin geometría o código se descarta; personas nulas cuentan cero; equipamiento clasifica por tipo, `amenity` manda sobre `healthcare`; punto de nodo y de recinto; la consulta usa el recuadro en orden Overpass. → [[Motor - ingesta#manzanas.py]] · [[Motor - ingesta#equipamiento.py]]

## test_worldcover_poblacion.py
O'Higgins cruza el meridiano 72° O: **dos teselas** de WorldCover (`S36W075`, `S36W072`); clases cultivo = 40 y pradera = 30; fracción y porcentaje (255 = sin dato); enteros y nombres del censo ("EL ARRAYÁN" → "El Arrayán"). → [[Motor - ingesta#worldcover.py]] · [[Motor - ingesta#poblacion_censal.py]]

## test_localidades.py
Partículas en minúscula, primera palabra con mayúscula, apóstrofo y guion, espacios y vacíos; la región va sin cero inicial en la consulta. → [[Motor - ingesta#localidades.py]]

## test_areas_verdes.py
Qué cuenta como área verde pública; un way abierto no es polígono; relación con anillo partido y laguna; umbrales SIEDU; lo que se solapa cuenta una vez; bandejón solo pasto y mínimo de 450 m²; recorte al límite urbano; el déficit es lo que falta para el estándar; validación del censo. → [[Motor - ingesta#areas_verdes.py]] · [[Motor - indicadores#area_verde.py]]

## test_ecostress.py
Solo enero y febrero son verano; un nombre sin fecha no se toma por verano; el cero absoluto es el valor físico; límites de cordura; promedia celda a celda; una celda sin dato no arrastra el promedio; escenas vacías se descartan; sin escenas útiles no inventa; teselas de distinto tamaño no se mezclan. → [[Motor - ingesta#ecostress.py]]

## test_mapa_calor.py
Cinco clases con color y rango; los rangos dicen los mismos cortes; el corte pertenece a la clase de arriba; sin dato es transparente; cada clase con su color exacto (el visor lee la clase desde el color del PNG). → [[Motor - raíz#mapa_calor.py]]
