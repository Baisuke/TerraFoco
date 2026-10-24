# TerraFoco

**Sistema de análisis territorial que compara el estado real de degradación del
suelo con la distribución de la inversión pública en recuperación de suelos, para
identificar las comunas donde la necesidad es alta y la intervención baja.**

Proyecto APT (Capstone PTY4614) · Duoc UC, sede Antonio Varas
Docente guía: Rocío Contreras Aguila

Sitio publicado: **https://terrafoco.tech**

---

## 1. Descripción

TerraFoco integra datos satelitales, climáticos, de suelo, censales y
administrativos en una base espacial, calcula indicadores por comuna y los
muestra en un visor web pensado para funcionarios de INDAP y equipos técnicos
municipales. La región piloto es **O'Higgins (33 comunas)**.

El sistema tiene tres módulos:

| Módulo | Qué responde | Cómo se calcula | Cómo se valida |
|---|---|---|---|
| **1. Suelos agrícolas** | ¿Dónde hay más erosión y dónde llega menos inversión? | Pérdida de suelo con RUSLE (A = R·K·LS·C·P) e índice de pertinencia con la serie del programa SIRSD-S 2012–2025 (INDAP) | Contra el inventario de erosión de CIREN: ρ de Spearman ≈ +0,67 en las 27 comunas dentro del dominio de validez |
| **2. Inundaciones** | ¿Qué comunas son más susceptibles a inundarse? | Índice ponderado de pendiente, acumulación de flujo, distancia a cauces, TWI, curvatura y cobertura | Contra 63 eventos históricos de DesInventar: 68 % de los eventos en comunas Alta o Muy alta, frente a 52 % por azar |
| **3. Ciudades** | ¿Dónde faltan áreas verdes y hace más calor? | m² de área verde por habitante (Censo 2024 y OpenStreetMap) y temperatura superficial (NASA ECOSTRESS) | Contra los estándares del SIEDU |

Cada cifra del sistema indica su unidad y su fuente, y las comunas donde un
modelo no es confiable se marcan en vez de ocultarse.

---

## 2. Tecnologías

| Capa | Tecnología |
|---|---|
| Base de datos | PostgreSQL 16 + PostGIS 3.4, migraciones SQL numeradas |
| Motor de procesamiento | Python 3 · GDAL, rasterio, geopandas, shapely, numpy, pandas, pysheds, scipy |
| API | FastAPI + Uvicorn, documentación OpenAPI automática |
| Visor web | HTML, CSS y JavaScript · MapLibre GL JS · teselas PMTiles |
| Pruebas | pytest (366 pruebas automatizadas) |
| Contenedores | Docker y Docker Compose |
| Servidor público | Google Cloud (Compute Engine, Santiago) · Caddy con HTTPS de Let's Encrypt |
| Fuentes de datos | CIREN, IDE MINAGRI, INDAP (SIRSD-S), NASA Earthdata (SRTM, ECOSTRESS), Copernicus / Sentinel Hub (Sentinel-2), CR2MET, SoilGrids, ESA WorldCover, INE (Censo), OpenStreetMap, DesInventar |
| Gestión | GitHub, Scrum, CRISP-DM |

---

## 3. Ejecución local

Requisito: **Docker Desktop** instalado y abierto.

```bash
git clone https://github.com/Baisuke/TerraFoco.git
cd "TerraFoco/Fase2/Evidencias Proyecto"
cp .env.ejemplo .env                 # completar las credenciales de las fuentes
docker compose up -d                 # base de datos, API, motor y programador
bash herramientas/inicializar.sh     # aplica las migraciones y carga las comunas
```

| Dirección | Qué se ve |
|---|---|
| http://localhost:8000/docs | API con su documentación interactiva |
| `prototipo/index.html` | Visor web (funciona también sin servidor, con datos embebidos) |

Ver el estado de las cargas: `docker exec -i terrafoco-programador python -m estado`

Ejecutar las pruebas:

```bash
docker exec -i terrafoco-programador python -m pytest tests -q
docker compose exec -T api python -m pytest tests -q
```

El detalle de la instalación, la carga de datos y el despliegue está en el
[Manual técnico](Fase2/Evidencias%20Grupales/09%20-%20Manual%20tecnico.docx)
y en el [README técnico del código](Fase2/Evidencias%20Proyecto/README.md).

---

## 4. Integrantes y roles

| Integrante | Rol Scrum | Responsabilidades principales |
|---|---|---|
| **Bastián Cárcamo** | Scrum Master · Development Team | Infraestructura y modelo de datos, carga de cartografía y línea base de CIREN, motor RUSLE, validación del modelo y despliegue en la nube |
| **Carla Morales** | Product Owner · Development Team | Backlog y gestión ágil, vínculo con INDAP y datos del SIRSD-S, documentación, plan de pruebas y prueba de usabilidad |
| **Antonio Lankin** | Development Team | Visor web y experiencia de usuario, motor RUSLE junto a Bastián, comprensibilidad de la interfaz |

---

## 5. Metodología

El proyecto combina **CRISP-DM** y **Scrum**:

- **CRISP-DM** ordena el trabajo con los datos: comprensión del problema y de
  los datos, preparación, modelado y una evaluación contra referencias
  independientes antes de dar un resultado por válido. Esa evaluación obligó a
  recalibrar el índice de inundación y a definir un dominio de validez para la
  erosión.
- **Scrum** conduce el desarrollo en sprints de 3 semanas, con Product Owner y
  Scrum Master explícitos, daily tres veces por semana, Sprint Review y
  Retrospectiva al cierre de cada sprint.

Artefactos en `Fase2/Evidencias Grupales`: metodología (01), Product Vision (02),
Product Backlog (03), Definition of Done (04), Sprint Backlog (05),
Retrospectivas (06), Sprint Reviews (07) y Plan y resultados de pruebas (08).

---

## 6. Arquitectura

```
 Fuentes externas            Servidor (Docker Compose)                 Usuario
 ─────────────────     ┌──────────────────────────────────────┐     ──────────
 CIREN, INDAP,         │  Programador ──► Motor (Python)      │
 NASA, Copernicus, ───►│   (cada hora)     ingesta·indicadores│
 INE, OSM, ...         │                        │             │
                       │                        ▼             │
                       │              PostgreSQL + PostGIS    │
                       │                        │             │
                       │                        ▼             │
                       │                  API FastAPI ──► Caddy (HTTPS) ──► Visor web
                       └──────────────────────────────────────┘          (MapLibre)
```

- **Motor**: un módulo de ingesta por fuente y un módulo por indicador; cada
  factor se guarda por separado y ningún cálculo sobrescribe uno anterior.
- **Programador**: revisa cada hora qué tarea venció (Sentinel-2 y OpenStreetMap
  mensual, inundación trimestral, CIREN anual) y registra cada corrida en una
  bitácora.
- **API**: lectura pública; la única escritura (catálogo de fuentes) exige clave.
- **Visor**: páginas por módulo, comuna y predio; si la API no responde, sigue mostrando la
  cartografía y los datos embebidos.

La arquitectura completa está documentada como vista **4+1** (lógica,
desarrollo, procesos, física y escenarios) en
`Fase2/Evidencias Grupales/Diagramas 4+1`, junto con el modelo de datos, los
diagramas de componentes y de estados y los procesos BPMN.

---

## 7. Estructura del repositorio

```
Fase 1/
  Evidencias Individuales/   Autoevaluaciones y diarios de reflexión (1.1, 1.2, 1.3)
  Evidencias Grupales/       Guía 1.5, formativa 1.4, presentación, requerimientos,
                             carta Gantt, casos de uso, arquitectura inicial
Fase2/
  Evidencias Individuales/   Diarios de reflexión 2.1 de cada integrante
  Evidencias Grupales/       Guías 2.4 y 2.6, artefactos Scrum (01–07), pruebas (08),
                             manual técnico (09), diagramas 4+1, modelo de datos, BPMN,
                             justificación de la innovación
  Evidencias Proyecto/       Presentación del proyecto y código del sistema:
    api/                     API FastAPI y sus pruebas
    motor/                   Ingesta, indicadores, programador y sus pruebas
    bd/                      esquema.sql, migraciones numeradas, semillas y respaldo
    prototipo/               Visor web
    despliegue/              Servidor público (compose de producción, Caddy)
    docs/                    Documentación técnica del proyecto
    herramientas/            Inicialización, copia local, versión portable
```

---

Licencia: ver [LICENSE](LICENSE).
