# API · rutas

**Carpeta:** `api/rutas/`. Un archivo por recurso, cada uno con su `APIRouter(prefix=...)`. Todas las lecturas aceptan `region` (por omisión 6). `__init__.py` vacío.

## Tabla de endpoints

| Método y ruta | Archivo | Devuelve | Lo usa |
|---|---|---|---|
| `GET /salud` | salud.py | Estado de la API y de la base | Diagnóstico |
| `GET /regiones` · `/regiones/{id}` | regiones.py | Regiones con comunas y años cargados por módulo | Barra superior (`shell.js`) |
| `GET /comunas` | comunas.py | Listado sin geometría | Selectores |
| `GET /comunas/geojson` | comunas.py | Geometrías GeoJSON para MapLibre | `mapa-real.js` |
| `GET /comunas/erosion` | comunas.py | Erosión de CIREN y propia por comuna | Panel, ficha |
| `GET /comunas/factores` | comunas.py | R, K, LS, C, P vigentes con procedencia | Ficha de comuna |
| `GET /comunas/terreno` | comunas.py | NDVI de verano y pendiente media | Visor |
| `GET /comunas/{id}/sirsd` | comunas.py | Serie anual SIRSD-S de la comuna | Ficha (gráfico por año) |
| `GET /pertinencia` | pertinencia.py | Índice por comuna (`origen`, `incluir_fuera_de_dominio`, `limite`) | Pertinencia, panel |
| `GET /pertinencia/{id_comuna}` | pertinencia.py | Ficha de una comuna (UC-03) | `comuna.html` |
| `GET /pertinencia/origenes` | pertinencia.py | Orígenes de erosión cargados | Selector de origen |
| `GET /pertinencia/evolucion` | pertinencia.py | Focalización año a año 2012–2025 | "¿Ha mejorado la focalización?" |
| `GET /inundacion` | inundacion.py | Comunas por susceptibilidad, con eventos y `calibrado` | Inundaciones |
| `GET /inundacion/eventos` | inundacion.py | Eventos DesInventar 1970–2014 | Tabla de eventos |
| `GET /inundacion/validacion` | inundacion.py | Fracción en Alta/Muy alta vs. azar, Spearman | Tarjeta "Eventos validados" |
| `GET /inundacion/cauces` | inundacion.py | Red hídrica GeoJSON (`orden_minimo`, por omisión 4) | Capa de cauces |
| `GET /inundacion/pronostico` | inundacion.py | Lluvia de 7 días por comuna (Open-Meteo, caché 30 min) | Tarjeta "Lluvia pronosticada" |
| `GET /localidades` | localidades.py | Ciudades y pueblos GeoJSON (`comuna` opcional) | Inundaciones |
| `GET /exposicion/poblacion?comuna=` | exposicion.py | Unidades censales 2024 (urbano + rural) | Exposición |
| `GET /exposicion/manzanas?comuna=` | exposicion.py | Manzanas 2017 (respaldo) | Exposición |
| `GET /exposicion/equipamiento` | exposicion.py | Escuelas, salud, emergencia (OSM) | Exposición, mapa |
| `GET /exposicion/agricola` | exposicion.py | ha de cultivo y pradera, y sobre "Alta" | Exposición, modo INDAP |
| `GET /urbano` | urbano.py | Temperatura superficial por comuna | Ciudades |
| `GET /urbano/areas-verdes` | urbano.py | m²/hab, déficit y acceso por comuna y zona | Ciudades |
| `GET /urbano/areas-verdes/geojson?comuna=` | urbano.py | Zonas censales + áreas verdes del entorno | Mapa de Ciudades |
| `GET /fuentes` · `/fuentes/{id}` | fuentes.py | Catálogo de fuentes con su última carga | Fuentes |
| `POST /fuentes` 🔒 | fuentes.py | Registrar fuente (201) | Fuentes (con clave) |
| `PATCH /fuentes/{id}` 🔒 | fuentes.py | Cambiar estado/nota | Fuentes (con clave) |
| `GET /ejecuciones` · `/ejecuciones/resumen` | ejecuciones.py | Bitácora (solo lectura) | Fuentes, panel |

🔒 = requiere `Authorization: Bearer <clave>` → [[API - núcleo#seguridad.py]]

---

## salud.py
`GET /salud`. **El primer endpoint que debe funcionar**: responde aunque la base esté caída; el cuerpo dice `api: ok`, `base_de_datos: ok|error` y la versión de PostGIS (`PostGIS_Lib_Version()`). → [[API - pruebas#test_salud.py]]

## regiones.py
- Regiones disponibles y **los años que realmente tienen cargados, por módulo** (`_periodos`). El selector de región de la barra superior se llena desde aquí, no desde una lista escrita en el front.
- Reemplazó al selector de año del prototipo, que ofrecía 2026, 2020, 2015 y 2010 —ninguno con dato— y no filtraba nada: "un período que se lee de la base no puede prometer lo que no hay".

## comunas.py
- **Hito del Sprint 0:** cuando `/comunas/geojson` devolvió GeoJSON válido y el visor lo dibujó, el circuito base → API → visor quedó validado.
- `erosion` trae **ambos orígenes** por comuna; `factores` trae los cinco factores **medidos** (no derivados) con su fuente, y su producto da la erosión que se muestra; `terreno` NDVI y pendiente; `sirsd` la serie anual (con `_anio_sirsd` para los años con pocos planes). → [[API - pruebas#test_factores.py]] · [[API - pruebas#test_terreno.py]]

## pertinencia.py
- Lee `indicadores.v_pertinencia`. `pertinencia = necesidad_norm − inversion_norm`, en −1..1.
- **La normalización ocurre en la consulta, no en el almacenamiento:** por eso `origen` alterna entre CIREN y TerraFoco sin migrar datos (UC-06).
- `listar` agrega la **brecha en UF** de cada comuna (`focalizacion.brecha_uf`); `evolucion` la focalización por año; `una` la ficha de una comuna; `origenes` los orígenes cargados.
- Fuera de dominio solo si se pide (`incluir_fuera_de_dominio=true`); la inversión anómala no se entrega.
- → [[Índice de pertinencia]] · [[API - pruebas#test_pertinencia_sirsd.py]] · [[API - pruebas#test_focalizacion.py]]

## inundacion.py
- Índice por comuna (`listar`), eventos (`eventos`), resumen de la validación (`validacion`), red hídrica (`cauces`, filtrada por orden de Strahler) y **pronóstico**.
- **Pronóstico:** `consultar_open_meteo` pide en una sola llamada la lluvia **diaria** de 7 días (`precipitation_sum` y probabilidad máxima) para un punto interior de cada comuna (`ST_PointOnSurface`); `armar_pronostico` arma la fila de cada comuna y ordena por la lluvia de las próximas 72 h (rechaza respuestas desalineadas); `_cache_pronostico` guarda la respuesta **30 min** (`VIGENCIA_S = 1800`). Si Open-Meteo no responde, devuelve la **última copia marcada como vencida**; si no hay copia, 503.
- `calibrado` va en cada fila: un índice no calibrado se muestra igual, pero **no se presenta como validado**.
- → [[Susceptibilidad a inundación]] · [[API - pruebas#test_exposicion.py]]

## localidades.py
- GeoJSON de `territorio.ciudad` (Límite Urbano Censal 2017) con atribución INE/OCUC. El riesgo por localidad se calcula **en el navegador** sobre la grilla pintada, para seguir al umbral. → [[API - pruebas#test_localidades.py]]

## exposicion.py
- `manzanas` (Censo 2017) y `poblacion` (Censo 2024: urbano, aldea y entidad rural; las entidades se simplifican a 0,00005° para aligerar) exigen `comuna`; `equipamiento` por región o comuna; `agricola` por región.
- Cada respuesta lleva su **atribución** (INE/OCUC CC BY-NC 4.0, OSM ODbL, ESA CC BY 4.0), pasada como `%s::text` (sin el cast, PostgreSQL no sabe el tipo del parámetro).
- → [[Exposición]] · [[API - pruebas#test_exposicion.py]]

## urbano.py
- `listar`: temperatura media, máxima y mínima por comuna (de mayor a menor). El **NDVI urbano viene en `null`** porque aún no se calcula, y la respuesta lo dice tal cual en vez de omitir el campo: "no medido" ≠ "cero".
- `areas_verdes` (por comuna y zona censal, estándar SIEDU) y `areas_verdes_geojson` (zonas de una comuna + áreas verdes del entorno). → [[Áreas verdes y calor urbano]] · [[API - pruebas#test_areas_verdes.py]]

## fuentes.py
- **Única parte de la API que escribe** (UC-10): el catálogo lo administra una persona.
- Modelos pydantic `FuenteNueva` y `CambioDeFuente`; `_validar_estado` contra `ESTADOS = (ok, parcial, pendiente, error)`, **la misma lista del CHECK** de la tabla: la API responde 422 con mensaje claro antes de que la base devuelva un error de integridad. Código repetido → 409 (no 500); inexistente → 404.
- → [[Bitácora y catálogo de fuentes]] · [[API - pruebas#test_fuentes.py]]

## ejecuciones.py
- Bitácora de ejecuciones (UC-12), **solo lectura a propósito**: si la API pudiera tocarla, dejaría de ser evidencia. `listar` (más recientes primero, `limite` 1–200) y `resumen` (totales para el panel). → [[API - pruebas#test_ejecuciones.py]]
