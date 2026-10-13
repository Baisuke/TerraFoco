# Preguntas de defensa

Preguntas probables de la comisión, con una respuesta corta y dónde profundizar. Practicarlas **en voz alta**, sin leer.

## El proyecto

**¿Qué problema resuelve TerraFoco?**
Nadie mide si la inversión en conservación de suelos (SIRSD-S de INDAP) llega a las comunas con peor erosión. TerraFoco cruza ambas cosas comuna por comuna y lo muestra en un visor para no informáticos. → [[Qué es TerraFoco]]

**¿Cuál es el aporte original?**
Que la variable evaluada —las prácticas de conservación— ya vive dentro del modelo físico: es el factor P (y en parte C) de RUSLE. El cruce no es una correlación forzada entre dos tablas. → [[RUSLE y erosión]]

**¿Por qué O'Higgins?**
Región agrícola con erosión heterogénea (secano costero, valle, precordillera), con ejecución del SIRSD-S en casi todas sus comunas y datos públicos completos. El sistema no está atado a ella: la región es una fila en `territorio.region`.

## Modelo y datos

**¿Por qué RUSLE y no otro modelo?**
Es el estándar internacional, el mismo que usó CIREN para el inventario nacional (permite validar contra él) y es multiplicativo con factores interpretables; C y P son justamente los que mueve la política pública.

**¿Cómo validaron la erosión propia?**
Contra CIREN por Spearman sobre rangos: no se exige que los números coincidan (insumos y años distintos) sino que ordenen igual. ρ ≈ +0,67 en las 27 comunas dentro del dominio de validez. → [[Validación y Spearman]]

**¿Por qué excluyen seis comunas? ¿No es acomodar el resultado?**
No se excluyen: se **marcan** y se ven. El umbral (R ≤ 2.000) sale de la calibración física de la ecuación de erosividad (estaciones bajo 1.000 mm), no de buscar la mejor correlación; el barrido completo de umbrales se imprime y el resultado es estable entre 1.200 y 2.200. → [[Dominio de validez]]

**¿Cómo se calcula el índice de pertinencia?**
`necesidad_norm − inversión_norm`. Necesidad: pérdida de suelo normalizada. Inversión: incentivo 2012–2025 en UF por hectárea con erosión severa, normalizado en logaritmo. Se normaliza por región, origen y dominio. → [[Índice de pertinencia]]

**¿Por qué UF por hectárea erosionada y no pesos totales?**
La necesidad es intensiva (t/ha) y la inversión extensiva (pesos): no son comparables. Además, catorce años de pesos nominales subestiman los tempranos (por eso UF), y un solo año confunde el ciclo de concursos con focalización (por eso 2012–2025).

**¿Por qué logaritmo en la inversión?**
Va de 0,3 a 34 UF/ha (dos órdenes de magnitud); en escala lineal tres comunas aplastaban a las demás contra cero.

**¿Qué limitaciones tiene el índice?**
La serie incluye todos los subprogramas (también fertilidad); el denominador sale del cálculo propio; con 33 comunas cualquier estadística es frágil. Todo está declarado en pantalla y en `docs/17`.

**¿De dónde sale la inversión? ¿Tienen datos personales?**
De la base de INDAP (serie agregada por comuna y año) validada contra la entrega oficial. Las planillas con RUT y nombres nunca se cargan: una herramienta lee solo columnas no personales y escribe el agregado. → [[Privacidad y datos personales]]

## Inundaciones

**¿Qué mide el índice de inundación?**
Susceptibilidad estática del terreno (dónde se junta el agua), no probabilidad ni cuándo. → [[Susceptibilidad a inundación]]

**¿Por qué solo dos de seis variables tienen peso?**
Porque la validación contra 63 eventos mostró que solo acumulación de flujo y curvatura correlacionan con los eventos; la pendiente lo hacía al revés. Con los pesos a priori el índice era peor que el azar (ρ −0,16); con 50/50, ρ +0,36 a +0,41 y 68 % de eventos en Alta/Muy alta frente a 52 % del azar.

**¿No es sobreajuste elegir pesos con los mismos eventos?**
Por eso los juegos se declararon de antemano (no se optimizaron), se reporta sin 1982 (año que concentra la mitad de los eventos) y se dice que la validación es en muestra. Con 33 comunas, ±0,35 es sugerente, no concluyente.

**¿Por qué cuartiles?**
Con los pesos calibrados las medias comunales caen entre 0,34 y 0,38; cortes fijos meterían todo en "Media". Las clases son relativas ("el cuarto más susceptible de la región") y así se declaran.

**¿Qué hace el visor con eso?**
Umbral elegido por la persona, población urbana y rural, hectáreas de cultivo y pradera y servicios críticos sobre el umbral, explicación de cada celda, explorador de pesos exacto y exportación a Google Earth/QGIS. → [[Exposición]]

## Arquitectura e ingeniería

**¿Por qué separar motor y API?**
Una ingesta satelital tarda minutos u horas; detrás de HTTP bloquearía al visor. El motor corre por lotes y escribe en la base; la API solo lee. → [[Arquitectura]]

**¿Cómo se actualiza el sistema solo?**
Un programador propio lee `operacion.tarea_programada`, decide qué venció según su cadencia, ordena por dependencias y ejecuta. Si algo falla, lo dependiente no corre y se reintenta a las 24 h. → [[Programador de tareas]]

**¿Por qué no Airflow?**
El orquestador no sabe nada del dominio: solo comandos, cadencias y dependencias. Migrar sería escribir DAGs que llamen los mismos comandos. Para tres personas, Airflow era más infraestructura que problema.

**¿Cómo muestran mapas a 30 m de toda la región sin servidor de mapas?**
Teselas PMTiles con el **valor** de cada píxel codificado en RGB; MapLibre las colorea en la GPU y el navegador pide solo los bytes que necesita. → [[Teselas y PMTiles]]

**¿Qué pasa si se cae la API?**
El visor usa la copia local de los últimos valores reales y lo dice en el badge; si falla MapLibre, el mapa esquemático. Nunca queda en blanco ni presenta una copia como dato en vivo. → [[Copia local y modo sin API]]

**¿Cómo protegen la escritura?**
Solo el catálogo de fuentes escribe, con clave por encabezado, cerrada por defecto, comparación en tiempo constante. La base no expone puerto en producción. → [[API - núcleo#seguridad.py]]

**¿Cómo aseguran la calidad?**
~270 pruebas del motor y ~96 de la API, centradas en lo que falla en silencio (unidades, rangos, cadencias, cuartiles, codificación de teselas); funciones puras separadas de la E/S; validación estadística de ambos modelos. → [[Motor - pruebas]] · [[API - pruebas]]

**¿Cómo se despliega?**
Compose de producción con base, API y Caddy (HTTPS automático) en una VM; el motor procesa en el PC y se publica el resultado. Respaldo: Codespaces para la demo y una copia portable para Windows. → [[Despliegue y Codespaces]]

## Para INDAP

**¿Qué uso real le daría un funcionario de INDAP?**
Priorizar comunas en el próximo concurso (pertinencia y brecha en UF), revisar si sus predios están en zona de inundación o erosión severa (Mis predios), llevar las zonas a Google Earth en terreno y estimar hectáreas de cultivo y agricultores expuestos ante una emergencia. → [[SIRSD-S e INDAP]]

**¿Qué falta para usarlo en producción?**
La tabla oficial de agencias de área, el desglose del SIRSD-S por práctica (requiere datos de INDAP), una guía de mantenimiento para TI y la prueba de usabilidad con usuarios reales (HU-24).
