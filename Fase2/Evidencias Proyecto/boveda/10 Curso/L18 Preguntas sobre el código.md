# L18 · Preguntas sobre el código

> [!abstract] Cómo usar esta lección
> Complementa [[Preguntas de defensa]] (que cubre el proyecto y los modelos) con las preguntas **técnicas** que suele hacer una comisión de informática: diseño, seguridad, rendimiento, decisiones de tecnología. Cada respuesta trae **dónde mostrarlo** en el código. Practícalas en voz alta; abre la respuesta solo después.

> [!tip] La mejor respuesta a una pregunta técnica
> **Respuesta corta → la razón → muéstralo.** "Sí, con parámetros. Porque concatenar texto permite inyección SQL. Aquí está: `api/rutas/pertinencia.py`, el `con.execute(SQL, (region, origen, …))`."

---

## Arquitectura y diseño

> [!question]- ¿Por qué no usaron un framework de frontend como React?
> Porque el visor tiene que abrir en cualquier máquina, incluso con doble clic desde un pendrive, sin paso de compilación. HTML y JS plano cumplen eso sin dependencias que mantener. El trabajo pesado (dibujar millones de celdas) lo hace MapLibre en la GPU, no el framework. Los módulos se organizan con funciones que encapsulan su estado y publican una interfaz (`const GTZonas = (function () { … return {…}; })()`).
> **Mostrar:** `prototipo/js/zonas.js` (patrón de módulo), `prototipo/index.html` (orden de scripts).

> [!question]- ¿Por qué no un ORM (SQLAlchemy, Django)?
> Porque las consultas centrales son espaciales y analíticas (funciones de ventana, `DISTINCT ON`, `ST_Intersection`, `percentile_cont`), que se expresan mejor y más claro en SQL directo. Un ORM agregaría una capa que habría que esquivar justo en esas consultas. Las consultas son parametrizadas igual.
> **Mostrar:** `bd/migraciones/013_…sql` (la vista), `api/rutas/pertinencia.py::SQL_LISTA`.

> [!question]- ¿Por qué FastAPI y no Flask o Django?
> Valida los parámetros por tipo sola (`id_comuna: int` → 422 si no es número), genera la documentación interactiva en `/docs` sin escribirla, tiene inyección de dependencias para la seguridad (`Depends(requiere_admin)`) y es liviana: la API solo consulta.
> **Mostrar:** `http://localhost:8000/docs`, `api/seguridad.py`.

> [!question]- ¿Por qué el índice de pertinencia es una vista y no una tabla?
> Para que siempre esté al día con lo cargado sin correr un proceso, y para que el criterio de comparación (por región, origen, dominio) sea una cláusula `WINDOW` y no una migración de datos. Con 33 comunas el costo de calcularla en cada consulta es despreciable.
> **Mostrar:** `bd/migraciones/013_…sql`, última línea `WINDOW w AS (PARTITION BY …)`.

> [!question]- ¿Cómo escala a otra región o al país?
> La región es una fila en `territorio.region` (área de interés, EPSG de trabajo); el motor la lee con `obtener_region` y no hay coordenadas en el código. Las tablas de indicadores están particionadas por región. La vista normaliza por región. El límite real es de datos: CIREN cubre de Coquimbo a Los Lagos, y la ecuación de erosividad habría que revisarla sobre 1.500 mm (sur).
> **Mostrar:** `motor/config.py` (regla de oro), `motor/bd.py::obtener_region`, `bd/esquema.sql` (`PARTITION BY LIST`).

> [!question]- ¿Qué pasa si dos procesos escriben a la vez?
> Los indicadores solo reciben INSERT (nunca UPDATE): dos corridas generan dos versiones y la lectura toma la más reciente con `DISTINCT ON … ORDER BY calculado_en DESC`. Cada proceso escribe dentro de una transacción. El programador ejecuta las tareas en serie.
> **Mostrar:** `motor/indicadores/almacen.py::sql_leer`.

> [!question]- ¿Por qué el motor no es un microservicio con su propia API?
> No lo necesita: nadie lo llama por red. Lo ejecuta el programador como comandos, o una persona con `docker exec`. Ponerlo detrás de HTTP solo agregaría una superficie que exponer y un tiempo de espera que manejar.

> [!question]- ¿Por qué guardar en EPSG:4326 y calcular en 32719?
> 4326 (grados) es el estándar para intercambiar y lo que esperan GeoJSON y los mapas web. Las áreas, distancias y pendientes se calculan en metros (UTM 19S, 32719); la reproyección la hace PostGIS (`ST_Transform`) o GDAL. Las áreas en grados se calculan con `::geography`.
> **Mostrar:** `motor/ingesta/zonal.py::SQL_GEOMETRIAS`, `motor/ingesta/ciren.py::SQL_AGREGAR`.

## Seguridad

> [!question]- ¿Cómo evitan la inyección SQL?
> Todas las consultas usan parámetros (`%s`) que psycopg envía separados del SQL. Donde se arma texto SQL con `%` (por ejemplo el nombre de la tabla en `almacen.py`), los valores vienen del propio código, nunca del usuario.
> **Mostrar:** `api/rutas/pertinencia.py::listar`.

> [!question]- ¿Quién puede escribir en el sistema?
> Por HTTP, solo el catálogo de fuentes, con la clave de administración (`Authorization: Bearer`), cerrada por defecto (503 sin clave), comparada en tiempo constante. Los indicadores los escribe el motor, que no está expuesto. La bitácora es de solo lectura en la API para que siga siendo evidencia fiable.
> **Mostrar:** `api/seguridad.py`, `api/rutas/fuentes.py` (`dependencies=[Depends(requiere_admin)]`).

> [!question]- ¿Por qué CORS abierto (`*`) en desarrollo? ¿No es inseguro?
> CORS lo aplica el navegador y solo controla quién puede **leer** respuestas desde otra página; `curl` lo ignora. Los datos son públicos por diseño. La escritura no depende de CORS sino de la clave, que va en un encabezado que el navegador no adjunta solo (sin CSRF). En producción, CORS se fija al dominio.
> **Mostrar:** comentario en `api/main.py`, `despliegue/docker-compose.yml`.

> [!question]- ¿Dónde están las credenciales?
> En el `.env` (no versionado) y, en el servidor, generadas allí por `preparar_servidor.sh`. El código las lee con `os.getenv`. Nunca se imprimen ni se registran; un intento fallido de clave se registra sin la clave.
> **Mostrar:** `motor/config.py`, `api/config.py`, `.gitignore`.

> [!question]- ¿Cómo manejan los datos personales de INDAP?
> No entran al sistema. Las planillas de la entrega oficial traen RUT y nombres; `herramientas/agregar_entrega_indap.py` lee solo columnas no personales por nombre, suma por comuna y año y escribe el agregado. Mis predios procesa el CSV en el navegador y no lo envía.
> **Mostrar:** docstring de `herramientas/agregar_entrega_indap.py`, `prototipo/js/predios.js`.

## Rendimiento

> [!question]- ¿Cómo muestran millones de celdas sin que el navegador se caiga?
> Teselas: solo se descargan las visibles, y del archivo PMTiles solo los bytes de esas teselas. La GPU colorea con una expresión. El detalle de la comuna se refina a la resolución de la pantalla en un Web Worker (fuera del hilo principal) y solo al detenerse el mapa.
> **Mostrar:** `motor/teselas.py` (docstring), `prototipo/js/detalle-comuna.js::refinarVentana`.

> [!question]- ¿Cómo procesan un DEM regional sin quedarse sin memoria?
> `zonal.py` lee una ventana por comuna (con margen de 3 celdas) en vez del ráster entero; leerlo completo mataba el contenedor (exit 137). `hidrologia.py` recorta al área de la región con margen. CR2MET se lee un mes a la vez desde el zip.
> **Mostrar:** `motor/ingesta/zonal.py::agregar_por_comuna`.

> [!question]- ¿Por qué numpy?
> Opera sobre arreglos completos en código compilado: una región a 30 m son decenas de millones de celdas, y un ciclo en Python tardaría minutos donde numpy tarda milisegundos. Por eso LS y C tienen una versión vectorizada, y una prueba exige que coincida con la escalar.
> **Mostrar:** `motor/indicadores/terreno.py::ls_desde_pendiente`, `tests/test_terreno.py::test_la_version_vectorizada_coincide_con_la_escalar`.

> [!question]- ¿Cómo ordenan millones de celdas en la simulación de lluvia sin trabar la página?
> Con un ordenamiento por conteo sobre el índice cuantizado en 65.536 niveles: tiempo lineal. Un `sort` con comparador tardaba segundos.
> **Mostrar:** `prototipo/js/simulacion-lluvia.js::ordenarCeldas`.

## Datos y modelos

> [!question]- ¿Qué pasa si una fuente cambia su formato o deja de responder?
> La ingesta falla con un mensaje y queda `error` en la bitácora; el programador no corre lo que depende de ella y reintenta a las 24 h; los indicadores anteriores siguen vigentes porque nunca se sobrescriben. En CIREN, si falla una cuenca, no se guarda nada para no reemplazar una línea base completa por una parcial.
> **Mostrar:** `motor/orquestacion/programacion.py`, `motor/ingesta/ciren.py` (final de `main`).

> [!question]- ¿Cómo sé de dónde salió un número?
> Cada factor guarda fuente, año y un `detalle` JSON (período, celdas, cobertura); cada índice de inundación guarda pesos y método; cada corrida queda en la bitácora; la ficha de comuna muestra la fuente de cada factor.
> **Mostrar:** `GET /comunas/factores`, `bd/migraciones/002_…sql`.

> [!question]- ¿Qué hacen con los datos faltantes?
> No se inventan: una comuna sin un factor no se calcula; un valor sin celdas es `None`, no `0`; una brecha sin dato es `null`. Se informa qué falta.
> **Mostrar:** `motor/calcular.py::reunir`, `api/focalizacion.py::brecha_uf`.

> [!question]- ¿Por qué Spearman y no Pearson o R²?
> Porque se pide que el modelo ordene igual el territorio, no que dé los mismos números (insumos, años y resoluciones distintos). Spearman mide el orden y no supone relación lineal ni normalidad. La significancia se obtiene por permutaciones.
> **Mostrar:** `motor/validar.py`.

> [!question]- ¿Elegir los pesos con los mismos eventos no es sobreajuste?
> Los juegos de pesos se declararon antes de evaluarlos (no se optimizaron), se reporta sin 1982, y se declara que la validación es en muestra. Con 33 comunas, diferencias de ρ menores a 0,15 son ruido.
> **Mostrar:** `motor/indicadores/recalibrar_inundacion.py` (docstring).

> [!question]- ¿Por qué no usaron machine learning?
> Con 33 comunas y 63 eventos no hay muestra para entrenar sin sobreajustar. Los modelos físicos (RUSLE) y de índice ponderado son interpretables, citables y validables. Comparar algoritmos supervisados está declarado en el backlog (épica E7) para cuando haya etiquetas a nivel de celda.

## Ingeniería

> [!question]- ¿Cómo controlan las versiones de la base de datos?
> Con migraciones numeradas e idempotentes (`IF NOT EXISTS`, `DROP … IF EXISTS`, `ON CONFLICT`) que aplica `herramientas/inicializar.sh` en orden. Cada migración explica en su cabecera qué cambia y por qué.
> **Mostrar:** `bd/migraciones/`, `herramientas/inicializar.sh`.

> [!question]- ¿Cómo garantizan que todos tengan el mismo entorno?
> Docker Compose con imágenes fijas: PostGIS 16-3.4, GDAL 3.9.2 de OSGeo, Python 3.12 slim, y versiones exactas en `requirements.txt`.
> **Mostrar:** `docker-compose.yml`, `motor/Dockerfile`, `motor/requirements.txt`.

> [!question]- ¿Qué es lo más difícil que resolvieron?
> Buenas candidatas (elige la que mejor sepas contar): (1) la recalibración del índice de inundación, que pasó de peor que el azar a 68 % frente a 52 %; (2) el dominio de validez de la erosión, de ρ −0,04 a +0,67 con un umbral físico; (3) mostrar la región entera a 30 m sin servidor de mapas, con el valor dentro del color; (4) la máscara de CIREN, que bajó Machalí de 733 a un valor comparable.

> [!question]- ¿Qué cambiarían si empezaran de nuevo?
> Respuesta honesta y madura: tener la serie del SIRSD-S por práctica desde el inicio (separar conservación de fertilidad), definir las teselas de valores desde el principio en vez de PNG por comuna, y validar con usuarios de INDAP antes. Lo que sí mantendrían: separar motor y API, las funciones puras y "nada se inventa".

> [!question]- ¿Cuánto código es?
> Unos 12.500 líneas de Python en el motor, 2.900 en la API, 1.800 de SQL, 14.300 en el visor (HTML, JS y CSS), más ~2.700 en herramientas. ~370 pruebas.

## Preguntas sobre tu rol (Antonio: frontend, visualización y calidad)

> [!question]- ¿Qué hiciste tú?
> Prepárala con tus propias palabras. Pistas de lo que corresponde a tu rol: el visor (las nueve pantallas, el marco común `shell.js`, la hidratación con respaldo `datos-api.js`), los mapas (MapLibre, detalle a 30 m, teselas en el navegador), los gráficos SVG, Mis predios, las simulaciones, el sistema de diseño y la calidad (pruebas, validación de contraste, accesibilidad).

> [!question]- ¿Cómo aseguraron que el visor sea usable por alguien de INDAP?
> Cada pantalla responde una pregunta y la escribe arriba; los números van con coma decimal y unidades; el badge dice siempre de dónde vienen los datos; las recomendaciones están en lenguaje del programa; se exporta a las herramientas que ya usan (Google Earth, QGIS, Excel). El contraste del texto pasa AA. Pendiente: la prueba de usabilidad con usuarios reales (HU-24, `docs/16-plan-de-usabilidad.md`).

Siguiente: [[L19 Autoevaluación final]]
