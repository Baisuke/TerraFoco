# Cómo correrlo

Requisito único: **Docker Desktop** abierto. Todo lo demás corre en contenedores.

## 1. Levantar

```bash
docker compose up -d          # bd, api, motor, programador
docker compose ps
bash herramientas/inicializar.sh   # migraciones 001..019 + 33 comunas (idempotente)
```

- `esquema.sql` se carga **solo la primera vez** que arranca `bd` (está montado en `/docker-entrypoint-initdb.d`).
- Las migraciones **no** se cargan solas: Postgres solo ejecuta la raíz de esa carpeta y `migraciones/` es un subdirectorio. Por eso existe `inicializar.sh`. → [[Herramientas#inicializar.sh]]

## 2. Ver el visor

```bash
python herramientas/servir_prototipo.py prototipo 8081
```

Abrir `http://localhost:8081/index.html`. El servidor propio existe porque `python -m http.server` no manda `Cache-Control` (el navegador se queda con el JS viejo) ni soporta peticiones de rango (las necesita PMTiles). → [[Herramientas#servir_prototipo.py]] · [[Herramientas#rangos.py]]

También funciona **con doble clic** en un HTML (`file://`): usa la copia local y los PNG por comuna. → [[Copia local y modo sin API]]

## 3. Ver la API

`http://localhost:8000/docs` — documentación interactiva generada por FastAPI. `http://localhost:8000/salud` responde aunque la base esté caída. → [[API - rutas]]

## 4. Estado y base

```bash
docker exec -i terrafoco-programador python -m estado         # qué hay cargado, de un vistazo
bash herramientas/sql.sh "SELECT count(*) FROM territorio.comuna;"
docker exec -i terrafoco-programador python -m orquestacion.orquestador --listar
```

## 5. Cargar o recalcular datos

Cada paso es `docker exec -i terrafoco-motor python -m <módulo>`. El orden completo está en el README (sección *Cargar datos*) y en [[Flujo de datos]]. Los más usados:

| Qué | Comando | Credenciales |
|---|---|---|
| Línea base de erosión | `python -m ingesta.ciren` (~1 h) | No |
| SIRSD-S (IDE MINAGRI) | `python -m ingesta.sirsd_ide` | No |
| Serie SIRSD-S 2012–2025 | `python -m ingesta.sirsd_serie` | No (semilla en `bd/semillas`) |
| Superficie erosionada | `python -m indicadores.superficie_erosionada` | No |
| Modelo de elevación | `python -m ingesta.srtm --preparar --cargar` | NASA Earthdata |
| Índice de inundación | `python -m indicadores.inundacion` → `validar_inundacion` → `mapa_inundacion --png` | No |
| Exposición (INDAP) | `python -m ingesta.poblacion_censal` · `python -m ingesta.worldcover` | No |
| Teselas del visor | `python -m teselas` · `python -m variables_inundacion` | No |
| Copia local | `python herramientas/sembrar_indicadores.py` (desde el PC, con la API arriba) | No |

## 6. Pruebas

```bash
docker exec -i terrafoco-programador python -m pytest tests -q   # motor (~270)
docker compose exec -T api python -m pytest tests -q             # api (~96)
```

→ [[Motor - pruebas]] · [[API - pruebas]]

## 7. Problemas típicos

| Síntoma | Causa | Solución |
|---|---|---|
| El visor muestra "Copia local" | La API no responde | `docker compose up -d api`; revisar `docker logs terrafoco-api` |
| La pertinencia responde error | Faltan migraciones | `bash herramientas/inicializar.sh` |
| El mapa a 30 m es por comuna y no continuo | Faltan los `.pmtiles` o el servidor no soporta rangos | `python -m teselas`; servir con `servir_prototipo.py` |
| Un cambio en un `.js` no aparece | Caché del navegador | Usar `servir_prototipo.py` (sin caché) o Ctrl+F5 |
| Docker Desktop no arranca | — | **Nunca** usar "Reset to factory defaults": borra los volúmenes con los datos |

> [!warning] La clave de administración
> `TERRAFOCO_CLAVE_ADMIN` vive solo en el `.env`. No se imprime, no se copia a documentos ni a commits. → [[API - núcleo#seguridad.py]]
