# 17 · Serie del SIRSD-S 2012–2025 e inversión por hectárea erosionada

Hasta la migración 012 la inversión del índice era la planilla de ejecución
2021, expresada como hectáreas bonificadas por cada 1.000 ha comunales. Desde
la 013 es el **incentivo del SIRSD-S 2012–2025, en UF, por hectárea con erosión
severa o superior**. Este documento registra de dónde sale cada número, qué se
validó y qué decisiones quedan por confirmar con la docente.

## 1. La serie

| | |
|---|---|
| Fuente | INDAP, DWH_ODS · BD_SIRSD_S, extraída por el equipo |
| Planes | los ejecutados: estado *Declaración Jurada* o *Traspasado a Tesorería* |
| Año | el de la declaración jurada |
| Incentivo | `SILP_INC_SOLICITADO`, en pesos nominales |
| Período | 2012–2025, 425 celdas comuna-año (33 × 14 = 462; las 37 que faltan no tuvieron planes) |
| Archivo | `bd/semillas/sirsd_serie_definitiva_2012_2025.csv`, agregado por comuna y año |
| Carga | `python -m ingesta.sirsd_serie` → `programas.sirsd_anual` |

**Validación contra la entrega oficial** (2011–2026, 30.313 planes). Solo se
leyeron columnas no personales, con `herramientas/agregar_entrega_indap.py`.
El resultado, en `bd/semillas/sirsd_complemento_oficial_2012_2025.csv`, se
carga en las columnas `*_oficial`:

- 423 de 425 celdas con el mismo número de planes;
- el incentivo total difiere en un 0,002 % y la superficie en un 0,12 %.

**Anomalía 6307 / 2017.** La inversión total de esa celda supera en más de
tres veces a su incentivo, y por sí sola equivale al 16 % de la inversión de
toda la serie (19,5 % medida sobre la serie sin ella). Se marca
`inversion_anomala` y su inversión total se anula. Su incentivo es coherente
y se mantiene: el índice usa el incentivo, no la inversión total.

### Pasar a UF

Cada año se divide por la UF promedio de ese año (`programas.uf_anual`, desde
mindicador.cl). La serie diaria trae dos errores que se limpiaron:

- el 29 y el 30 de diciembre de 2014 aparecen valores cercanos a 608;
- hay fechas duplicadas en 2015.

Se descartan los días que se alejan más de un 2 % de la mediana móvil de 15
días. Un primer filtro de ±5 % sobre la mediana anual eliminaba 91 días
legítimos de 2022, un año con la UF al alza.

## 2. El denominador

`indicadores.superficie_erosionada` guarda, por comuna, las hectáreas con
erosión **mayor a 18 t/ha/año**, que es el corte de la clase Severa
(`RAMPA[1][0]` en `motor/mapa_erosion.py`). Se calculan sobre los rásteres del
cálculo propio con `python -m indicadores.superficie_erosionada`.

Se usa el cálculo propio aunque el origen elegido sea CIREN porque la base no
tiene la superficie severa del inventario: la tabla cruda de CIREN guarda
14.317 polígonos, no la cobertura completa.

**Consecuencia sobre el dominio.** `en_dominio` pasa a exigir que tanto la
erosión como la superficie estén dentro del dominio del modelo. En la
precordillera el cálculo propio sobreestima: a Machalí le atribuye 130.160 ha
severas, y su incentivo por hectárea saldría en 0,003 UF. Por eso seis comunas
quedan fuera del índice **también con el origen CIREN**: Codegua, Machalí,
Mostazal, Rengo, Requínoa y San Fernando. Sus datos del programa se siguen
mostrando; lo que no se muestra es su índice ni su inversión por hectárea.

## 3. La normalización

`inversion_norm` es un min-max del **logaritmo natural** de UF/ha, calculado
por partición (región, origen, en_dominio). Dentro del dominio, la inversión va
de 0,32 UF/ha (Navidad) a 34,2 (San Vicente), dos órdenes de magnitud:

| Normalización | Comunas con brecha alta o crítica |
|---|---|
| Lineal | 18 de 27. San Vicente se lleva la escala y el resto queda cerca de 0 |
| Logarítmica | 6 de 27. Navidad crítica; Peumo, Coinco, Las Cabras, Lolol y Pumanque altas |

**Por confirmar con la docente**: si el logaritmo es aceptable. La razón para
usarlo es que la inversión por hectárea tiene rendimientos decrecientes, así
que pasar de 0,3 a 3 UF/ha no pesa lo mismo que pasar de 30 a 33. El gráfico
de dispersión usa el mismo eje logarítmico, para que lo que se ve coincida
con lo que se calcula.

Frente al índice anterior, 25 de las 27 comunas cambian de categoría.
Palmilla, Quinta de Tilcoco y Chimbarongo quedan en sobre-cobertura.

**Corrección del 28-09.** San Vicente también aparecía en sobre-cobertura
(índice 0,22). La descarga completa de CIREN del 25-09, con las 50 cuencas,
subió su erosión de 12,5 a 16,0 t/ha/año. Ahora su índice es 0,29, en
cobertura adecuada. La corrida anterior no había traído una de las cuencas
que la cruzan. Desde ese día, `ingesta.ciren` se niega a guardar una corrida
con cuencas fallidas (salvo que se pida `--aceptar-parcial`). La brecha en UF
(§7) y la focalización no cambian, porque San Vicente ya estaba sobre la
mediana de UF/ha y de erosión.

## 4. Archivos que no se usan

- **«detalles datos indap.csv»**: `es_superficie` viene marcado en 820 filas
  que no son hectáreas. Además usa otro eje de años (2023 aparece con +90 %) y
  no trae 2012–2014.
- **«datos indap.csv»**: es una extracción anterior; solo 228 de 329 celdas
  coinciden con la serie definitiva.

Correcciones al `.md` del equipo:

- llegaron 16 planillas, no 10;
- `ha_practica` tiene 6 nulos;
- la superficie severa de CIREN no está en la base (ver §2).

## 5. Privacidad

La entrega oficial trae datos personales de 4.279 personas: RUT, nombre,
sexo, etnia y predio. **Esa entrega no entra al repositorio ni a la base.** Lo
que se versiona son agregados numéricos por comuna y año, y el script que los
genera tiene aserciones que impiden escribir otras columnas.

Queda una consideración antes de publicar: 52 celdas comuna-año tienen 1 o 2
planes. En esas celdas, el incentivo de la celda es prácticamente el de un
productor. Si el sistema se publica fuera del curso, conviene suprimir o
agrupar las celdas con menos de 3 planes en la serie anual (la ficha de
comuna). El índice usa totales 2012–2025 y no tiene ese problema.

## 6. En la interfaz

- `/pertinencia` se pide siempre con las comunas fuera de dominio incluidas.
  Así llegan su erosión y su serie reales. Su índice queda en `null`, salvo
  que se marque la casilla, y las vistas del índice las filtran con
  `GT.enIndice`. Antes no se pedían, se quedaban con el índice de ejemplo de
  `data.js` y aparecían en el ranking como si fueran datos medidos.
- La ficha de comuna muestra la serie real (`/comunas/{id}/sirsd`) en vez del
  monto total repartido en siete años con una fórmula. Sin API, la serie sale
  de la copia local.
- La capa *Inversión SIRSD-S* del visor usa cortes de 1, 2, 4 y 10 UF/ha.
- La capa del índice se pinta por categoría, con los mismos cortes que los
  badges. Antes usaba una rampa lineal con cortes distintos a los de la tabla.

## 7. Brecha en UF y focalización por año

Las dos cuentas están en `api/focalizacion.py`, que no depende de la base.
Sus pruebas usan números calculados a mano (`test_focalizacion.py`). La
copia local usa esas mismas funciones.

### Cuánto costaría cerrar la brecha

    brecha_uf = max(0, mediana_uf_ha − uf_ha) × ha_erosion_severa

Es cuánto incentivo le falta a una comuna para recibir, por hectárea
erosionada, lo mismo que la comuna típica de la región.

- La meta es la **mediana**, calculada solo con las comunas del dominio:
  2,4 UF/ha con CIREN.
- No se usa el máximo como meta: sería San Vicente, con 34 UF/ha, y daría una
  brecha impagable que no informa nada.
- Fuera del dominio no se calcula, porque el denominador es justo el valor que
  el modelo sobreestima.

Resultado con CIREN:

- **49.627 UF** para las 6 comunas con brecha alta o crítica: Lolol 18.972,
  Navidad 17.486, Peumo 5.229, Coinco 4.356, Pumanque 3.134 y Las Cabras 450.
- A la UF promedio de 2025 son **$1.943 millones**, el 95 % de lo que el
  programa paga en un año promedio en toda la región.
- Otras 7 comunas también están bajo la mediana y suman 22.380 UF. El índice
  las deja en brecha moderada o menor porque su erosión es más baja.

### ¿Ha mejorado la focalización?

Las «más erosionadas» son las comunas del índice con una tasa sobre la
mediana: 13 de 27 con CIREN, sobre 12,4 t/ha/año. Para cada año se compara qué
parte del incentivo recibieron con la parte de la superficie severa que
tienen, que es lo que les tocaría si el incentivo siguiera a la superficie
dañada.

Cada período se calcula con el incentivo sumado, no como promedio de los
porcentajes anuales. Así, un año de 17 mil UF no pesa lo mismo que uno de 80
mil.

| | CIREN | Cálculo propio |
|---|---|---|
| Superficie severa de las más erosionadas | 61,4 % | 72,6 % |
| Incentivo recibido, 2012–2018 | 47,3 % | 46,6 % |
| Incentivo recibido, 2019–2025 | 45,6 % | 44,5 % |
| Rango anual | 41 %–50 % | 41 %–50 % |
| Puntos bajo la referencia, cada año | 12 a 21 | 23 a 31 |

- **La focalización no mejoró.** Con cualquiera de los dos orígenes, todos
  los años la participación queda bajo la referencia, y 2019–2025 queda
  levemente peor que 2012–2018.
- **El programa se achicó.** El incentivo anual de la región pasó de 71 mil
  UF en promedio (2012–2018) a 34 mil (2019–2025).
- **Medida complementaria.** El ρ de Spearman entre la erosión y las UF/ha de
  cada año es negativo en los 14 años: entre −0,39 y −0,01 con CIREN. La API
  lo entrega en `rho`. No es la medida principal porque, con 27 comunas y años
  con pocos planes, varía mucho de un año a otro.

**Por confirmar con INDAP.** 2023 tiene 608 planes, contra 1.100 a 2.200 en
los demás años. La entrega oficial muestra la misma cifra, así que la caída
viene de la fuente y no de la extracción. Además, los años se cuentan por
la fecha de la declaración jurada. Los planes de 2025 declarados en 2026 caen
en 2026, así que 2025 puede estar incompleto.
