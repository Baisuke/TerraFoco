# Ruta de estudio

Un orden para entender el proyecto de punta a punta. Cada etapa tiene notas para leer, archivos para abrir y una **prueba de salida**: si puedes responderla sin mirar, pasa a la siguiente.

> [!tip] Si partes de cero
> Esta ruta asume que ya sabes leer código. Si no, sigue primero el curso de [[L00 Cómo usar este curso]], que explica los conceptos previos y el código paso a paso, y vuelve aquí para repasar.

## Etapa 1 · El problema y la idea (1 h)
- Leer: [[Qué es TerraFoco]] · [[Documentos del proyecto#01-perfil-del-proyecto.md]] · [[SIRSD-S e INDAP]]
- Abrir: `docs/01-perfil-del-proyecto.md`, la pantalla `index.html`.
- **Prueba:** explica en 30 segundos qué pregunta responde TerraFoco, para quién y por qué el cruce no es una correlación forzada.

## Etapa 2 · Cómo está armado (1 h)
- Leer: [[Arquitectura]] · [[Mapa del repositorio]] · [[Cómo correrlo]]
- Hacer: `docker compose up -d`, `bash herramientas/inicializar.sh`, abrir `http://localhost:8000/docs` y el visor.
- **Prueba:** ¿por qué el motor no está detrás de HTTP? ¿qué es lo único que la API escribe y cómo se protege?

## Etapa 3 · Erosión y pertinencia — el corazón (2–3 h)
- Leer: [[RUSLE y erosión]] → [[Dominio de validez]] → [[Índice de pertinencia]] → [[Validación y Spearman#Validación 1 · Erosión propia contra CIREN]]
- Abrir: `motor/indicadores/rusle.py` (leer los docstrings), `motor/calcular.py`, `bd/migraciones/013_…sql` (la vista), `api/rutas/pertinencia.py`, `api/focalizacion.py`.
- **Prueba:** escribe la fórmula de RUSLE y di de dónde sale cada factor; escribe la fórmula de la pertinencia y explica las tres decisiones de la migración 013; ¿por qué hay seis comunas fuera del dominio?

## Etapa 4 · Datos y motor (2 h)
- Leer: [[Flujo de datos]] → [[Motor - raíz]] → [[Motor - ingesta]] (al menos ciren, srtm, zonal, sentinel, sirsd_serie) → [[Bitácora y catálogo de fuentes]] → [[Programador de tareas]]
- Hacer: `docker exec -i terrafoco-programador python -m estado` y `python -m orquestacion.orquestador --listar`.
- **Prueba:** ¿qué pasa si a una comuna le falta el factor K? ¿por qué `zonal` rechaza rásteres en grados? ¿qué hace `--simular`?

## Etapa 5 · Base de datos (1 h)
- Leer: [[Esquema de la base]] → [[Migraciones]] → [[Semillas]]
- Hacer: `bash herramientas/sql.sh "\dt indicadores.*"`.
- **Prueba:** nombra los cuatro esquemas y qué guarda cada uno; ¿por qué `erosion` está particionada y nunca se sobrescribe?

## Etapa 6 · Inundaciones (2 h)
- Leer: [[Susceptibilidad a inundación]] → [[Validación y Spearman]] → [[Exposición]] → [[Teselas y PMTiles]]
- Abrir: `motor/indicadores/inundacion.py`, `validar_inundacion.py`, `prototipo/js/inundacion-calculo.js`; usar `inundaciones.html` (mover el umbral, clic en una celda, cambiar pesos, exportar KML).
- **Prueba:** ¿por qué se combina por píxel antes de agregar por comuna? ¿por qué solo dos variables tienen peso? ¿qué significa "calibrado" y quién lo marca?

## Etapa 7 · El visor (2 h)
- Leer: [[Visor - páginas]] → [[Visor - scripts base]] → [[Visor - mapas y módulos]] → [[Copia local y modo sin API]]
- Hacer: apagar la API (`docker stop terrafoco-api`) y recargar: ver el badge "Copia local". Volver a encenderla.
- **Prueba:** ¿qué pasa si la API no responde? ¿si MapLibre no carga? ¿por qué hay `indice.js` además de `indice.json`?

## Etapa 8 · Módulo 3, operación y entrega (1 h)
- Leer: [[Áreas verdes y calor urbano]] · [[Privacidad y datos personales]] · [[Herramientas]] · [[Despliegue y Codespaces]]
- **Prueba:** ¿qué datos personales trae la entrega de INDAP y cómo se garantiza que no entren? ¿qué corre en el servidor público y qué no?

## Etapa 9 · Ensayo de defensa
- [[Preguntas de defensa]] (responder en voz alta) y [[Recorridos por el código]] (seguir cada recorrido con el código abierto). Repasar el [[Glosario]].

> [!tip] Reparto sugerido para estudiar en equipo
> Cada uno domina dos etapas a fondo y las explica a los otros dos: así los tres pueden responder por cualquier parte, que es lo que evalúa la comisión.
