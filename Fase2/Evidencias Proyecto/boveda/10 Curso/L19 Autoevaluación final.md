# L19 · Autoevaluación final

> [!abstract] Cómo usarla
> Responde **en voz alta** cada pregunta antes de abrir la respuesta. Marca las que fallaste y vuelve a la lección indicada. Estás listo cuando aciertas **45 de 50** sin mirar y haces los **ejercicios prácticos** sin ayuda.

---

## A. El proyecto (L02)

> [!question]- 1. ¿Qué pregunta responde TerraFoco?
> Si la inversión pública en conservación de suelos (SIRSD-S de INDAP) llega a las comunas donde la erosión es más grave.

> [!question]- 2. ¿Cuál es el aporte original, en una frase?
> Las prácticas que financia el SIRSD-S actúan sobre los factores C y P de RUSLE: la variable evaluada vive dentro del modelo físico, así que el cruce tiene un mecanismo y no es una correlación forzada.

> [!question]- 3. Nombra los tres módulos y las tres pantallas transversales.
> Módulos: Suelos agrícolas (erosión y pertinencia), Inundaciones, Ciudades. Transversales: Mis predios, Fuentes de datos, Ayuda (más el Panel general y el Visor).

> [!question]- 4. ¿Quién es el usuario principal y qué tres usos tiene?
> El ejecutivo de área de INDAP (y quien distribuye el SIRSD-S): priorizar comunas en el concurso (índice y brecha en UF), revisar el riesgo de sus predios, llevar zonas a terreno (KML) y estimar exposición ante emergencias.

> [!question]- 5. ¿Qué declara el proyecto que NO hace?
> No predice inundaciones; el modelo propio no es confiable en precordillera; la inversión incluye subprogramas que no actúan sobre la erosión; con 33 comunas las correlaciones son sugerentes, no concluyentes.

## B. Arquitectura (L03)

> [!question]- 6. ¿Cuáles son las cuatro piezas y qué hace cada una?
> bd (PostgreSQL+PostGIS, guarda y calcula la vista), motor (Python+GDAL, descarga y calcula por lotes), programador (el motor en modo demonio, ejecuta tareas vencidas), api (FastAPI, solo lee y entrega JSON). Más el visor (HTML+JS+MapLibre).

> [!question]- 7. ¿Por qué el motor no está detrás de HTTP?
> Sus procesos tardan minutos u horas; detrás de la API bloquearían al visor. Corre por lotes y deja el resultado en la base.

> [!question]- 8. ¿Por qué el motor parte de la imagen oficial de OSGeo?
> Para que todos tengan exactamente la misma versión de GDAL; instalarlo por pip es la primera fuente de "en mi computador funciona".

> [!question]- 9. ¿Cómo llegan los mapas a 30 m al navegador?
> Como archivos PMTiles que el motor genera y se copian a `prototipo/datos/teselas`; el visor los lee directo por rangos HTTP, sin pasar por la API.

## C. Un dato de punta a punta (L04)

> [!question]- 10. Cuenta el recorrido de la erosión de CIREN de Litueche hasta la ficha.
> `ingesta.ciren` descarga cada cuenca por WFS (con reintentos), la carga con ogr2ogr, recorta cada polígono a la comuna y calcula la media ponderada por hectárea (sin "NO SUELOS"), acumula entre cuencas, clasifica y guarda en `indicadores.erosion` con origen CIREN dentro de una Bitácora → la vista `v_pertinencia` toma la última, le suma la inversión en UF y el denominador y calcula el índice → `GET /pertinencia` lo entrega con la brecha → `GT.hidratar` lo aplica a `GT.comunas` y lo reescala → las páginas lo pintan.

> [!question]- 11. ¿Por qué se suman numeradores y denominadores entre cuencas?
> Para obtener la media ponderada correcta; promediar promedios por cuenca daría el mismo peso a una cuenca con 10 ha en la comuna que a una con 10.000.

> [!question]- 12. ¿Por qué Litueche es "Alineación parcial"?
> Pertinencia API +0,069 → (0,069 + 1)/2 = 0,53 → tramo 0,40–0,60.

> [!question]- 13. ¿Qué es la brecha en UF y cómo se calcula?
> Lo que le falta a una comuna para llegar a la mediana regional de UF por ha erosionada: max(0, mediana − uf_ha) × ha severas. Litueche: (2,42 − 2,19) × 11.022 ≈ 2.531 UF.

## D. Base de datos (L05)

> [!question]- 14. Nombra los cuatro esquemas.
> territorio, indicadores, programas, operacion.

> [!question]- 15. ¿Qué significa que los indicadores "nunca se sobrescriben"?
> Cada recálculo inserta una fila nueva con su fecha; para leer el valor vigente se usa `DISTINCT ON … ORDER BY anio DESC, calculado_en DESC`. El histórico permite explicar cambios y un recálculo malo no destruye el anterior.

> [!question]- 16. Las tres decisiones de la migración 013.
> Período completo 2012–2025 (ciclo de concursos), deflactado a UF (pesos de años distintos), por hectárea con erosión severa (intensiva vs extensiva). Además: la variable es el incentivo, no la inversión total.

> [!question]- 17. ¿Qué hace `WINDOW w AS (PARTITION BY id_region, origen, en_dominio)`?
> Define el grupo para el mínimo y máximo de la normalización: por región, sin mezclar orígenes ni comunas fuera del dominio.

> [!question]- 18. ¿Por qué la inversión se normaliza en logaritmo?
> Va de 0,3 a 34 UF/ha; en escala lineal unas pocas comunas aplastaban al resto contra cero.

> [!question]- 19. ¿Por qué las migraciones no se cargan solas?
> Postgres solo ejecuta la raíz de `/docker-entrypoint-initdb.d` (el esquema) y solo la primera vez; las migraciones están en una subcarpeta. Las aplica `inicializar.sh`.

## E. Motor (L06–L09)

> [!question]- 20. Describe el molde de un módulo del motor.
> Docstring con el porqué; constantes justificadas; funciones puras; `main()` con argparse (`--simular`, `--region`…); `obtener_region`; trabajo dentro de `with Bitacora(...)`; escritura solo si no es simulación; `sys.exit(main())`.

> [!question]- 21. ¿Qué hace `Bitacora` al salir con un error?
> Actualiza la fila con estado `error` y el mensaje, y devuelve False para que la excepción siga (el programador ve la falla).

> [!question]- 22. Fórmula de RUSLE y fuente de cada factor.
> A = R·K·LS·C·P. R: CR2MET (Renard & Freimund). K: SoilGrids (Wischmeier & Smith). LS: NASADEM (Horn + Renard/McCool). C: Sentinel-2 NDVI (Van der Knijff). P: SIRSD-S de IDE MINAGRI (Wischmeier & Smith, ponderado por fracción intervenida).

> [!question]- 23. ¿Por qué P es casi 1 en todas las comunas?
> Porque la superficie intervenida es mínima frente a la agrícola (Litueche: 19 ha de 58.806). No es un error: es lo que mide el modelo; si el programa crece, P baja.

> [!question]- 24. ¿Qué hace `calcular.py` si falta un factor?
> No calcula esa comuna y lo informa. Nada se inventa (solo P tiene un valor por defecto de 1, que significa "sin prácticas").

> [!question]- 25. ¿Qué es el dominio de validez y de dónde sale R ≤ 2.000?
> El rango donde el modelo propio es confiable. La ecuación de erosividad se calibró con estaciones bajo 1.000 mm (R ≈ 2.000 en O'Higgins); sobre eso sobreestima 20–300 veces. Seis comunas precordilleranas quedan marcadas.

> [!question]- 26. ¿Cómo se valida la erosión propia y qué resultado da?
> Spearman contra CIREN, con significancia por permutaciones: ≈ −0,04 con 33 comunas, ≈ +0,67 con las 27 del dominio; el barrido de umbrales muestra que es estable entre 1.200 y 2.200.

> [!question]- 27. ¿Qué hace la máscara de CIREN?
> Limita el promedio a la superficie que CIREN evalúa como suelo (sin roca, agua ni ciudad); sin ella, las comunas cordilleranas se promediaban sobre roca (Machalí 733 t/ha vs 1,71).

> [!question]- 28. ¿Qué dos variables tienen peso en el índice de inundación y por qué?
> Acumulación de flujo y curvatura (50/50): la validación mostró que eran las únicas que correlacionaban con los eventos en el sentido esperado; la pendiente lo hacía al revés.

> [!question]- 29. ¿Por qué se combina por píxel y después se agrega?
> Porque la curvatura media comunal ≈ 0 y la acumulación media la dominan las laderas: agregadas, pierden la señal.

> [!question]- 30. Resultado de la validación de inundación y criterio de calibración.
> 43 de 63 eventos (68 %) en Alta/Muy alta frente a 52 % del azar; ρ ≈ +0,36. Criterio: > 50 %, ≥ 10 puntos sobre el azar y ρ > 0.

> [!question]- 31. ¿Cómo decide el programador si una tarea mensual venció?
> Si su última ejecución exitosa no fue en el mismo mes y ya se alcanzó el día del mes indicado. Si la última falló, espera 24 h y luego la considera no ejecutada.

> [!question]- 32. ¿Qué pasa con una tarea si falla aquella de la que depende?
> No corre en ese ciclo (`bloqueadas_por_dependencia`).

> [!question]- 33. Fórmula de codificación de las teselas.
> n = round((valor × escala + 10000) × 10); R = n >> 16, G = (n >> 8) & 255, B = n & 255. n = 0 es sin dato. Inversa: −10000 + n × 0,1, dividido por la escala.

## F. API (L10)

> [!question]- 34. ¿Qué hace FastAPI con `id_comuna: int` si llega "abc"?
> Responde 422 sin ejecutar la función.

> [!question]- 35. ¿Por qué existen `conexion()` y `transaccion()`?
> `conexion()` no confirma (sirve para leer); escribir con ella perdería los cambios sin error. `transaccion()` confirma o revierte.

> [!question]- 36. Las decisiones de seguridad de la escritura.
> Cerrado por defecto (503 sin clave o clave < 24), clave por encabezado Bearer (sin CSRF), comparación en tiempo constante, se registra el intento sin la clave, una sola clave (un solo administrador).

> [!question]- 37. ¿Por qué la mediana para la brecha se calcula solo con comunas del dominio?
> Las fuera de dominio tienen denominadores inflados (0,003 UF/ha en Machalí) y bajarían la meta de todas.

## G. Visor (L11–L14)

> [!question]- 38. Orden de carga de los scripts base.
> tema.js (head) → api-base.js → paleta.js → data.js → datos/indicadores.js → datos-api.js → shell.js → mapa.js → datos/comunas.js → mapa-real.js → módulos de la página.

> [!question]- 39. Los tres orígenes posibles de los datos y cómo se ven.
> api ("Datos reales…"), copia ("Copia local…"), ejemplo ("Prototipo · datos de ejemplo").

> [!question]- 40. ¿Por qué cambiar de origen, región o tema recarga la página?
> Cada página se dibuja una vez dentro de `hidratar().then`; recargar mantiene un solo camino de carga y evita partes con el valor viejo.

> [!question]- 41. ¿Cómo sabe MapLibre de qué color pintar una comuna?
> `enriquecer` pone `_color` en cada polígono con `GTMapa.valorCapa`; la capa usa `['get', '_color']`.

> [!question]- 42. ¿Qué pasa si MapLibre no carga?
> Prueba `vendor/` y luego el CDN; si falla, `crearConRespaldo` dibuja el mapa esquemático y lo rotula.

> [!question]- 43. ¿Cómo se lee el valor de una celda bajo el cursor?
> Se calcula la tesela y el píxel del punto en el zoom máximo, se decodifica la tesela (sin corrección de color) y se aplica la fórmula inversa de la codificación.

> [!question]- 44. ¿Cómo se calcula la población sobre el umbral?
> En el navegador: cada unidad censal reparte sus personas entre las celdas cuyo centro cae dentro; se suman las de las celdas que pasan el umbral. Se recalcula al mover el umbral (evento `detalle:umbral`).

> [!question]- 45. ¿Por qué Mis predios no sube el archivo?
> Privacidad: se cruza en el navegador con las teselas públicas y se olvida al cerrar la pestaña (Ley 19.628).

> [!question]- 46. Las tres piezas de la simulación de lluvia.
> Número de Curva (cuánto escurre), embalse lineal (cuánto se retiene; ahí entra la intensidad), orden del índice calibrado (dónde se junta).

> [!question]- 47. ¿De dónde sale el enfriamiento de un parque simulado?
> De medir la isla fresca de los parques reales de la ciudad contra su entorno (Rancagua 0,44 °C), escalada por tamaño (log del área), tipo (0,7/1/1,3) y distancia (exp(−3d/L)).

## H. Calidad y despliegue (L15–L16)

> [!question]- 48. ¿Qué tipo de error persiguen las pruebas?
> Los que no revientan: unidades, rangos, cadencias, codificación, clases. Ejemplo: un plano de pendiente conocida que Horn debe reproducir exacto.

> [!question]- 49. ¿Qué corre en el servidor público y qué no?
> Base, API y Caddy (HTTPS automático). No el motor: procesa en el PC y se publica el resultado.

> [!question]- 50. ¿Qué es la copia portable y por qué es un `.cmd`?
> Python oficial + PostgreSQL embebido + API + visor, lanzados con `TerraFoco.cmd`; un `.exe` sin firma lo bloquea Smart App Control.

---

## Ejercicios prácticos (con el código abierto)

> [!example] Ejercicio 1 · Encuentra el umbral del dominio
> ¿En qué archivo y con qué nombre está el umbral de erosividad? ¿Qué módulos lo usan?
> > [!question]- Respuesta
> > `motor/indicadores/rusle.py`, `R_MAXIMO_CONFIABLE = 2000.0`. Lo usan `calcular.py` (marca `en_dominio`) y `validar.py` (umbral por defecto). La API tiene una copia en `api/rutas/comunas.py` (no importa el motor) y `api/tests/test_factores.py` comprueba que `en_dominio` la respete.

> [!example] Ejercicio 2 · ¿Dónde se clasifica la pertinencia en el visor?
> Busca dónde están los cortes 0,25 / 0,40 / 0,60 / 0,75.
> > [!question]- Respuesta
> > `prototipo/js/data.js`, `GT.categoriasPertinencia`, y la función `GT.categoriaPertinencia(v)`.

> [!example] Ejercicio 3 · Sigue una URL
> ¿Qué función de Python atiende `GET /inundacion/pronostico` y qué hace si Open-Meteo no responde?
> > [!question]- Respuesta
> > `api/rutas/inundacion.py::pronostico`. Si falla y hay un pronóstico en caché, lo devuelve con `vencido: True`; si no hay, responde 503.

> [!example] Ejercicio 4 · Cambia una cadencia (en papel)
> Quieres que la ingesta de Sentinel corra el día 15 en vez del 5. ¿Qué cambias?
> > [!question]- Respuesta
> > Nada de código: `UPDATE operacion.tarea_programada SET dia_del_mes = 15 WHERE codigo = 'ingesta.sentinel';`

> [!example] Ejercicio 5 · Lee un valor en la consola
> En `comuna.html?id=6205`, abre la consola y obtén la erosión y el índice de Navidad.
> > [!question]- Respuesta
> > `GT.comunas.find(c => c.nombre === 'Navidad')` → `erosion` 25,9 e `indice` 1 (Brecha crítica).

> [!example] Ejercicio 6 · Encuentra la prueba de la clave corta
> ¿Qué prueba verifica que una clave de 23 caracteres cuenta como no configurada?
> > [!question]- Respuesta
> > `api/tests/test_seguridad.py::test_una_clave_corta_cuenta_como_no_configurada` (espera 503).

> [!example] Ejercicio 7 · Explica una línea de SQL
> ¿Qué hace `COUNT(*) FILTER (WHERE u.anio IS NULL) AS anios_sin_uf` en la vista?
> > [!question]- Respuesta
> > Cuenta los años de la serie sin UF cargada, para que un año sin deflactor no desaparezca en silencio del total en UF.

> [!example] Ejercicio 8 · Provoca el plan B
> Apaga la API (`docker stop terrafoco-api`), recarga `index.html` y explica en voz alta qué cambió y por qué. Vuelve a encenderla.
> > [!question]- Respuesta
> > El badge dice "Copia local · CIREN": `GT.hidratar` no obtuvo respuesta en 4 s, entró al `.catch` y aplicó `TERRAFOCO_INDICADORES`. La tarjeta de fuentes dice "sin conexión con la base". El mapa usa las geometrías de la copia estática.

Siguiente: [[L20 Tarjetas de repaso]]
