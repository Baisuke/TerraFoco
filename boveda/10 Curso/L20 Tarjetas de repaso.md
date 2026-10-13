# L20 · Tarjetas de repaso

> [!abstract] Cómo usarlas
> Lee la pregunta, responde en voz alta y recién entonces mira la respuesta (después de `::`). Repasa **15 minutos al día** durante la semana previa. Las que falles, márcalas y repítelas al día siguiente.
>
> Si usas el plugin **Spaced Repetition** de Obsidian, este formato (`pregunta::respuesta`, con la etiqueta `#tarjetas`) funciona tal cual: el plugin te las va mostrando según cuánto te cuesten.

#tarjetas

## El proyecto

¿Qué pregunta responde TerraFoco?::Si la inversión del SIRSD-S de INDAP llega a las comunas donde la erosión es más grave.
¿Qué significa SIRSD-S?::Sistema de Incentivos para la Sustentabilidad Agroambiental de los Suelos Agropecuarios.
¿Cuál es la idea clave del proyecto?::Las prácticas del SIRSD-S actúan sobre C y P de RUSLE: la política pública está dentro del modelo físico.
¿Cuántas comunas tiene la región piloto y cuál es?::33, O'Higgins (región 6), en 3 provincias.
¿Cuántas comunas entran al índice y por qué no todas?::27; seis precordilleranas están fuera del dominio de validez (R > 2.000).
¿Cuánto incentivo y cuántos planes 2012–2025?::≈ $19.854 millones (≈ 729 mil UF) y 22.449 planes.
¿Qué comuna tiene la mayor brecha y por qué?::Navidad: 25,9 t/ha/año (la más erosionada) y 0,32 UF por ha erosionada (mediana 2,42).
¿Qué metodologías usa el equipo?::CRISP-DM para los datos y Scrum para el desarrollo.

## Arquitectura

¿Cuáles son las cuatro piezas en Docker?::bd (PostgreSQL+PostGIS), motor (Python+GDAL), programador (el motor en modo demonio) y api (FastAPI).
¿Por qué el motor no está detrás de la API?::Sus procesos tardan horas y bloquearían al visor; corre por lotes y escribe en la base.
¿Qué es lo único que escribe la API?::El catálogo de fuentes (POST y PATCH /fuentes), con clave de administración.
¿En qué puertos están la API y el visor?::API 8000, visor 8081.
¿Por qué GDAL desde la imagen de OSGeo?::Para que todos tengan la misma versión; por pip difiere entre sistemas.
¿Qué es la regla de oro de config.py?::Ninguna coordenada, región ni credencial en el código: la región sale de territorio.region y lo demás del entorno.

## Base de datos

¿Cuáles son los cuatro esquemas?::territorio, indicadores, programas, operacion.
¿Cómo se lee el valor vigente de un indicador?::DISTINCT ON (comuna, …) ORDER BY anio DESC, calculado_en DESC.
¿Dónde se calcula el índice de pertinencia?::En la vista indicadores.v_pertinencia (migración 013).
¿Fórmula de la pertinencia?::necesidad_norm − inversión_norm (de −1 a 1; el visor la lleva a 0–1 con (p+1)/2).
¿Qué es la inversión en el índice?::Incentivo 2012–2025 deflactado a UF, dividido por las ha con erosión > 18 t/ha/año, normalizado en logaritmo.
¿Por qué UF?::Para comparar pesos de 14 años distintos.
¿Por qué por hectárea erosionada?::La necesidad es intensiva (t/ha) y la inversión extensiva (pesos totales).
¿Por qué 2012–2025 y no un año?::El programa funciona por concursos; un año grande seguido de uno en cero es ciclo, no focalización.
¿Por qué logaritmo en la inversión?::Va de 0,3 a 34 UF/ha; en escala lineal unas pocas comunas aplastaban al resto.
¿Por qué la normalización separa por dominio?::Las comunas donde el modelo sobreestima aplastarían la escala de las demás.
¿Quién aplica las migraciones?::herramientas/inicializar.sh (idempotente); Postgres solo carga esquema.sql la primera vez.

## Motor y modelos

¿Fórmula de RUSLE?::A = R × K × LS × C × P, en t/ha/año.
¿Fuente de R?::CR2MET (lluvia 2002–2021), ecuación de Renard & Freimund (1994).
¿Fuente de K?::SoilGrids (textura y carbono), nomograma de Wischmeier & Smith (1978).
¿Fuente de LS?::NASADEM 30 m; pendiente de Horn (1981), LS de Renard (1997) y McCool (1987).
¿Fuente de C?::NDVI de Sentinel-2 (mediana de verano, sin nubes); Van der Knijff (2000).
¿Fuente de P?::Superficie bonificada del SIRSD-S (IDE MINAGRI) sobre la agrícola; curvas de nivel de Wischmeier & Smith.
¿Litueche: factores y resultado?::R 1.071 · K 0,027 · LS 1,69 · C 0,28 · P 0,9999 = 13,79 t/ha/año (CIREN 13,65).
¿Qué pasa si a una comuna le falta un factor?::No se calcula y se informa: nada se inventa.
¿Umbral del dominio de validez?::R ≤ 2.000 MJ·mm/(ha·h·año), de la calibración de Renard & Freimund (bajo 1.000 mm).
¿Spearman de la erosión propia contra CIREN?::≈ −0,04 con 33 comunas; ≈ +0,67 con las 27 del dominio.
¿Qué es Spearman?::Correlación de rangos: mide si dos cosas ordenan igual, sin exigir los mismos valores.
¿Para qué la máscara de CIREN?::Promediar solo sobre suelo evaluado (sin roca, agua ni ciudad).
¿Qué hace Bitacora?::Registra cada corrida en operacion.ejecucion_proceso (inicio, fin, estado, registros, mensaje).
¿Qué hace --simular?::Calcula y muestra sin escribir; la bitácora no lo cuenta como carga.

## Inundaciones

¿Qué mide el índice de inundación?::Susceptibilidad estática del terreno: dónde se junta el agua, no cuándo.
¿Las seis variables?::Pendiente, acumulación de flujo, distancia a cauces, TWI, curvatura, cobertura (NDVI).
¿Pesos vigentes?::Acumulación 50 y curvatura 50; las demás 0.
¿Por qué por píxel y después por comuna?::La curvatura media comunal ≈ 0 y la acumulación media la dominan las laderas.
¿Por qué cuartiles?::Las medias comunales caen entre 0,34 y 0,38; cortes fijos meterían todo en Media.
¿Resultado de la validación?::43 de 63 eventos (68 %) en Alta/Muy alta frente a 52 % del azar; ρ ≈ +0,36.
¿Criterio de "calibrado"?::> 50 % de eventos en Alta/Muy alta, ≥ 10 puntos sobre el azar y ρ > 0.
¿Qué pasó con los pesos a priori?::Ordenaban peor que el azar (ρ −0,16): la pendiente correlacionaba al revés.
¿De dónde salen los eventos?::DesInventar (UNDRR/ONEMI), 1970–2014; 63 con comuna en O'Higgins.

## Programador y teselas

¿Dónde vive la cadencia de las tareas?::En operacion.tarea_programada; cambiarla es un UPDATE.
¿Qué pasa si una tarea falla?::Espera 24 h para reintentar y lo que depende de ella no corre.
¿Por qué no Airflow?::El orquestador no sabe nada del dominio; migrar sería llamar los mismos comandos.
¿Fórmula de codificación de teselas?::n = round((valor × escala + 10000) × 10); R = n>>16, G = (n>>8)&255, B = n&255.
¿Qué es PMTiles?::Toda una pirámide de teselas en un archivo, leído por rangos HTTP.
¿Por qué teselas sin pérdida?::El color es el dato: una compresión con pérdida cambia los valores.

## API

¿Qué framework usa la API?::FastAPI (con uvicorn y psycopg).
¿Dónde está la documentación de la API?::http://localhost:8000/docs (se genera sola).
¿Cómo se evita la inyección SQL?::Consultas parametrizadas (%s) que psycopg envía aparte.
¿Qué responde escribir sin clave configurada?::503: cerrado por defecto.
¿Qué responde escribir con clave incorrecta?::401 con WWW-Authenticate: Bearer.
¿Por qué compare_digest?::Compara en tiempo constante: el tiempo no revela cuántos caracteres acertó.
¿Qué es la brecha en UF?::max(0, mediana − uf_ha) × ha severas: lo que falta para la mediana regional.

## Visor

¿Por qué sin framework?::Para abrir en cualquier máquina, incluso con doble clic desde un pendrive, sin compilar.
¿Qué hace GT.hidratar?::Trae /pertinencia y aplica los datos a GT.comunas; si falla, la copia local; si no, los de ejemplo.
¿Los tres estados del badge?::Datos reales · Copia local · Prototipo (datos de ejemplo).
¿Qué genera la copia local?::herramientas/sembrar_indicadores.py → prototipo/datos/indicadores.js.
¿Por qué la copia local es .js?::Con doble clic (file://) el navegador bloquea fetch a archivos locales.
¿Qué librería dibuja el mapa?::MapLibre GL 5, en la tarjeta de video.
¿Cómo se pinta cada comuna?::Con su propiedad _color y la expresión ['get', '_color'].
¿Qué pasa si MapLibre no carga?::Mapa esquemático de mapa.js, rotulado.
¿Qué hace el Web Worker del detalle?::Refina la grilla de 30 m a la resolución de la pantalla sin trabar la página.
¿Dónde se cruza la exposición?::En el navegador (inundacion-calculo.js), sobre la grilla pintada, siguiendo al umbral.
¿Mis predios envía datos al servidor?::No: todo ocurre en el navegador y se olvida al cerrar.
¿Simulación de lluvia: tres piezas?::Número de curva, embalse lineal, orden del índice calibrado.
¿Isla fresca de Rancagua?::0,44 °C (22 parques de 1 ha o más contra su entorno de 100–500 m).

## Calidad y despliegue

¿Cuántas pruebas hay?::~270 del motor y ~96 de la API.
¿Qué persiguen las pruebas?::Los errores que no revientan: unidades, rangos, cadencias, codificación.
¿Qué corre en el servidor público?::Base, API y Caddy (HTTPS). No el motor.
¿Qué hace Caddy?::Certificado HTTPS automático, /api → API, el resto archivos del visor.
¿Cómo se abre la copia portable?::Doble clic en TerraFoco.cmd (Python oficial + PostgreSQL embebido).
