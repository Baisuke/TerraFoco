# TerraFoco — Prototipo no funcional

Prototipo de interfaz del **Sistema de Análisis Geoespacial Multipropósito para la Evaluación Territorial y de Política Pública**, correspondiente al Proyecto APT de la asignatura Capstone, Escuela de Ingeniería Informática, Duoc UC.

**Entrega:** Fase 1 — Semana 3

---

## Qué es y qué no es

Este es un **prototipo no funcional**: existe únicamente la capa de presentación.

**Sí incluye**
- Las 7 pantallas principales del sistema, navegables entre sí
- Interacción de front-end: selección de comunas, cambio de capas, filtros, tabs
- **Cartografía real** de las 33 comunas de O'Higgins sobre un mapa base
- Datos de ejemplo escritos a mano para poder mostrar cada vista

**No incluye**
- Procesamiento real de imágenes satelitales
- Conexión con las fuentes de datos oficiales
- Cálculo real de los indicadores

> ⚠️ **Los indicadores mostrados son ilustrativos**: no provienen de un cálculo real.
>
> **Las geometrías sí son reales**: son los límites comunales oficiales de IDE Chile,
> con código INE. Cada pantalla declara de dónde vienen, en un aviso sobre el mapa.

---

## Pantallas

| Archivo | Pantalla | Componente de la arquitectura |
|---|---|---|
| `index.html` | Panel general | Capa de presentación |
| `visor.html` | Visor cartográfico | Capa de presentación |
| `pertinencia.html` | Índice de pertinencia territorial | Módulo 1 — Suelos |
| `comuna.html` | Ficha de comuna con factores RUSLE | Módulo 1 — Suelos |
| `inundaciones.html` | Susceptibilidad a inundaciones | Módulo 2 |
| `urbano.html` | Análisis térmico y cobertura urbana | Módulo 3 |
| `fuentes.html` | Catálogo de fuentes y pipeline | Núcleo |

---

## Estructura

```
prototipo/
├── index.html              Panel general
├── visor.html              Visor cartográfico
├── pertinencia.html        Índice de pertinencia
├── comuna.html             Ficha de comuna
├── inundaciones.html       Módulo de inundaciones
├── urbano.html             Módulo urbano
├── fuentes.html            Fuentes de datos
├── css/
│   └── styles.css          Sistema de estilos y tokens de diseño
├── js/
│   ├── paleta.js           Paleta institucional — fuente única del color
│   ├── data.js             Datos de ejemplo
│   ├── shell.js            Barra lateral y barra superior
│   ├── mapa.js             Cartografía esquemática — último respaldo
│   ├── mapa-real.js        Cartografía real sobre MapLibre GL JS
│   └── graficos.js         Gráficos en SVG
├── datos/
│   ├── comunas.js          Geometrías incrustadas — las lee el navegador
│   └── comunas.geojson     El mismo dato, para inspeccionarlo o reutilizarlo
└── README.md
```

---

## Cómo ejecutarlo

**Basta con abrir `index.html` en el navegador.** No requiere instalación,
compilación ni servidor, y la cartografía real se ve igual.

Para publicarlo en GitHub Pages: **Settings → Pages → Source: Deploy from a branch → main / (root)**.

### De dónde salen las geometrías

El visor las busca en tres niveles y **usa el primero que responda**:

| | Origen | Cuándo aplica |
|---|---|---|
| 1 | La API en `localhost:8000` | Con el entorno Docker levantado — el dato viene en vivo desde PostGIS |
| 2 | `datos/comunas.js` | Siempre que no haya API. Es una copia exportada desde esa misma API |
| 3 | Mapa esquemático en SVG | Solo si no hay conexión para cargar MapLibre |

Hay dos copias del mismo dato por una restricción del navegador: al abrir un
archivo con doble clic (`file://`), Chrome **prohíbe leer archivos locales con
`fetch()`**. Un `<script>` sí puede, y por eso existe `comunas.js`. El
`.geojson` queda como formato estándar, legible por QGIS o cualquier
herramienta SIG.

El aviso en la esquina del mapa dice cuál de los tres está en uso, para que
nunca haya duda sobre el origen de lo que se muestra.

---

## Decisiones técnicas del prototipo

**Sin framework.** HTML, CSS y JavaScript a secas, sin React, Vue ni build. Las
únicas cargas externas son MapLibre GL JS, el mapa base de CARTO y las
tipografías de Google Fonts; todas tienen respaldo si no hay conexión.

**Mejora progresiva.** El prototipo nunca queda en blanco: si falla la API usa la
copia local, si falla MapLibre dibuja el mapa esquemático en SVG, y si fallan las
tipografías usa las del sistema. Cada nivel se degrada solo y lo declara en pantalla.

**Cartografía real con respaldo esquemático.** El mapa esquemático —una retícula
de puntos con desplazamiento pseudoaleatorio de semilla fija, que siempre se
dibuja igual— dejó de ser lo que se muestra y pasó a ser el último recurso.

**Datos separados de la vista.** Todo el contenido de ejemplo está aislado en `js/data.js`. Cuando exista la API, ese archivo se sustituye por las llamadas correspondientes sin tocar las pantallas.

**Gráficos propios.** Barras, series y dispersión se dibujan en SVG sin librerías, para no introducir dependencias en esta etapa.

**Paleta institucional.** Los colores base fueron tomados del sitio oficial de INDAP (`indap.gob.cl`): verde `#2B9C68`, azul marino `#001C41`, gris `#656565`, más los acentos turquesa, azul, naranja y ámbar. Las rampas de la cartografía y los gráficos se derivaron de esos colores para mantener toda la interfaz en la misma familia cromática. Todo vive en `js/paleta.js`, que es la fuente única: `styles.css` la replica en variables CSS y los módulos de JavaScript la consumen desde ahí.

> El uso de la paleta es una decisión de diseño para alinear el prototipo con el organismo destinatario. El proyecto cuenta con la orientación técnica de profesionales del departamento de datos de INDAP, lo que constituye **apoyo técnico y no patrocinio institucional**: no es un producto oficial de INDAP y no usa su logotipo ni su identidad gráfica.

---

## Tecnología prevista para la implementación

| Capa | Tecnología |
|---|---|
| Procesamiento geoespacial | Python — GDAL, Rasterio, GeoPandas |
| Base de datos | PostgreSQL + PostGIS |
| Aprendizaje automático | scikit-learn, XGBoost |
| Backend / API | FastAPI |
| Frontend | React + MapLibre GL JS |
| Tablero de indicadores | Power BI o Apache Superset |
| Metodología | CRISP-DM + Scrum |

---

## Equipo

- Bastián Cárcamo
- Carla Morales
- Antonio Lankin

Docente guía: Rocío Contreras Aguila
