# Plan de desarrollo — Sprint 0

Cómo pasar del prototipo al sistema real. Este documento cubre el **Sprint 0**: las
tres semanas de configuración que hacen posible todo lo demás.

> **Principio rector del Sprint 0:** no se escribe lógica de negocio. Se construye el
> terreno donde esa lógica va a vivir. Si al final del sprint los tres integrantes
> pueden levantar el mismo entorno con un comando y cargar una capa de prueba en
> PostGIS, el sprint fue un éxito.

---

## 1. Estructura del código

```
Aplicación/
├── docker-compose.yml        Levanta todo el entorno con un comando
├── prototipo/                Prototipo no funcional (Fase 2, ya entregado)
├── motor/                    Procesamiento geoespacial — Python
│   ├── ingesta/              Descarga desde repositorios de origen
│   ├── normalizacion/        Reproyección, remuestreo, recorte
│   ├── indicadores/          RUSLE, índice de pertinencia, susceptibilidad
│   ├── etl/                  Consolidación de planillas del SIRSD-S
│   └── tests/
├── api/                      FastAPI
│   ├── rutas/
│   ├── esquemas/             Modelos Pydantic
│   └── tests/
└── web/                      React + MapLibre GL (reemplaza al prototipo en Fase 3)
```

**Regla:** el `motor/` no importa nada de `api/`, y `api/` no importa nada de `web/`.
Las dependencias van en una sola dirección. Esto permite ejecutar el procesamiento por
lotes sin levantar la API.

---

## 2. Entorno reproducible

El problema real: **GDAL es difícil de instalar** y difiere entre máquinas. Con tres
integrantes en tres computadores, sin contenedores se pierden días en "en mi máquina
funciona".

`Aplicación/docker-compose.yml` levanta tres servicios:

| Servicio | Imagen | Para qué |
|---|---|---|
| `bd` | `postgis/postgis:16-3.4` | PostgreSQL 16 con PostGIS 3.4 |
| `motor` | Python 3.12 + GDAL | Procesamiento por lotes |
| `api` | Python 3.12 | FastAPI con recarga automática |

```bash
docker compose up -d
```

Con eso los tres tienen exactamente la misma versión de GDAL, PROJ y PostGIS.

> **Si Docker resulta un obstáculo insalvable** en alguna máquina, la alternativa es
> `conda` con el canal `conda-forge`, que resuelve GDAL razonablemente bien. Pero
> conviene intentar Docker primero: es lo que se usa en la industria y suma al
> proyecto.

---

## 3. Base de datos

El esquema completo está en `Evidencias de sistema/Base de datos/esquema.sql`.

### Decisiones de diseño que importan

**1. Todo cuelga de `region`.** La tabla `region` incluye el *bounding box* y el
sistema de referencia. El motor lee de ahí el área de interés; **no hay coordenadas
escritas en el código**. Agregar una región es insertar una fila.

**2. Se guardan valores absolutos, no normalizados.** `indicador_erosion` almacena
toneladas por hectárea al año, y `ejecucion_programa` almacena hectáreas y pesos. **El
índice de pertinencia se calcula en la consulta**, con el alcance como parámetro. Así
"comparar dentro de la región" o "comparar a nivel nacional" es una opción del usuario
y no una migración de datos.

**3. Particionado por región desde el día uno.** Las tablas de indicadores están
particionadas por `id_region`. Es gratis hacerlo ahora y caro después.

**4. Los factores RUSLE se guardan por separado.** No solo el resultado `A`. Permite
auditar el cálculo y responder "¿por qué esta comuna salió así?".

**5. Versionado temporal.** Cada indicador tiene `anio` y `calculado_en`. Nunca se
sobrescribe: se inserta una versión nueva. El histórico es parte del producto.

---

## 4. Orden de ataque del Sprint 0

Las tareas están ordenadas por dependencia. **No conviene paralelizar las tres
primeras**: hasta que la base de datos no esté levantada, no hay dónde cargar nada.

| # | Tarea | Responsable | Depende de |
|---|---|---|---|
| 1 | Levantar `docker compose` en las tres máquinas | Todos | — |
| 2 | Ejecutar `esquema.sql` y verificar que PostGIS responde | Ing. de datos | 1 |
| 3 | Cargar los límites comunales de la región piloto desde IDE Chile | Ing. de datos | 2 |
| 4 | Descargar una tesela SRTM y cargarla como raster | Ing. de datos | 3 |
| 5 | ~~Esqueleto de FastAPI con `/salud`~~ ✅ **ya está en el repositorio** | Backend | 1 |
| 6 | Endpoint `/comunas` que devuelva las geometrías cargadas | Backend | 3, 5 |
| 7 | Página de prueba que dibuje esas geometrías con MapLibre | Frontend | 6 |
| 8 | Configurar GitHub Actions: linter y tests en cada push | QA | 1 |
| 9 | Redactar el plan de pruebas | QA | — |
| 10 | Enviar la solicitud de datos del SIRSD-S | Product Owner | — |

### El hito del Sprint 0

**Una comuna real, dibujada en un mapa real, servida por la API desde PostGIS.**

Sin indicadores, sin RUSLE, sin estilos. Solo el circuito completo funcionando de
punta a punta. Ese momento —cuando el polígono de Litueche aparece en el navegador
viniendo de la base de datos— es el que demuestra que la arquitectura es viable.

Todo lo demás del semestre es agregar capas sobre ese circuito.

---

## 5. Verificación antes de cerrar el sprint

- [ ] Los tres integrantes levantan el entorno con un solo comando
- [ ] `esquema.sql` corre limpio sobre una base vacía
- [ ] Las 33 comunas de la región piloto están cargadas con geometría válida
- [ ] Una tesela SRTM está cargada y se puede consultar por área
- [ ] `GET /comunas` responde GeoJSON válido
- [ ] La página de prueba dibuja las comunas
- [ ] El pipeline de GitHub Actions pasa en verde
- [ ] La solicitud de datos del SIRSD-S está enviada, con fecha registrada

---

## 6. Riesgos propios de esta etapa

| Riesgo | Señal temprana | Qué hacer |
|---|---|---|
| GDAL no instala en alguna máquina | Falla el `docker compose build` | Usar la imagen oficial de OSGeo en vez de instalar por `pip` |
| Las geometrías de IDE Chile vienen en otro sistema de referencia | Las comunas aparecen en medio del océano | Verificar el EPSG de origen y reproyectar en la carga, no después |
| El raster de SRTM es muy pesado para la base | La carga tarda demasiado o llena el disco | Cargar por teselas con `-t 256x256` y activar compresión |
| Se empieza a programar RUSLE antes de tener datos | Código sin nada que procesar | Respetar el orden: primero el circuito, después la lógica |

---

## 7. Convenciones de trabajo

**Ramas:** `main` protegida. Una rama por historia de usuario:
`feature/HU-02-ingesta-sentinel`. Se integra por pull request con revisión de al menos
un compañero.

**Commits:** `tipo: descripción en presente` — `feat`, `fix`, `docs`, `refactor`,
`test`, `chore`.

**Cada integrante commitea su propio trabajo.** El historial es evidencia de aporte
individual y es probable que se evalúe.

**Issues:** cada historia del backlog es un issue en GitHub Projects, con etiqueta de
épica y de sprint. El pull request referencia el issue con `Closes #12`.

---

## 8. Qué NO hacer en el Sprint 0

- Escribir el cálculo de RUSLE. No hay datos todavía.
- Diseñar la interfaz definitiva. El prototipo ya cumple ese rol en Fase 2.
- Optimizar consultas. Primero que funcionen.
- Intentar cargar la región completa. Una comuna basta para validar el circuito.

> La tentación natural es empezar por lo interesante —el modelo, los mapas bonitos—.
> Pero sin el circuito de datos funcionando, todo eso se construye sobre supuestos que
> después hay que rehacer.
