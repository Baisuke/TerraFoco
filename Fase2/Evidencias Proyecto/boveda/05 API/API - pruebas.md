# API · pruebas

**Carpeta:** `api/tests/` (≈96 pruebas, pytest + `fastapi.testclient`). **Correr:**

```bash
docker compose exec -T api python -m pytest tests -q
```

Las que validan el contrato **no tocan la base** (corren en un equipo sin Docker); las que leen datos usan `hay_base` de `test_fuentes.py` y se **saltan** si no hay base. `__init__.py` vacío.

---

## test_salud.py
La raíz responde; `/salud` responde **siempre**, aun sin base. → [[API - rutas#salud.py]]

## test_seguridad.py
Sin clave en el servidor la escritura queda **cerrada (503)**; una clave corta cuenta como no configurada; sin encabezado → 401 con desafío; claves incorrectas → 401; con la clave pasa a la validación; **la autenticación va antes que la validación**; las lecturas no piden clave; `/docs` declara el esquema de seguridad; CORS permite el encabezado `Authorization`. Ninguna llega a escribir. → [[API - núcleo#seguridad.py]]

## test_fuentes.py
Rechaza estados fuera de la lista; los válidos son los del CHECK; PATCH sin cambios es error; el alta exige campos obligatorios, nombre no demasiado corto y código bien formado; **ciclo completo de alta y cambio** (con base, limpiando lo creado); código repetido → 409 y no 500; inexistente → 404; listar devuelve el catálogo. Define `hay_base` y `_clave`, que importan las demás. → [[API - rutas#fuentes.py]]

## test_ejecuciones.py
El límite se valida; las más recientes primero; el resumen cuadra con la bitácora; cada fila trae lo que la pantalla necesita. → [[API - rutas#ejecuciones.py]]

## test_factores.py
**El producto de los factores da la erosión que se muestra**; cada factor trae su procedencia; el dominio es el de la erosividad; la región viene completa. → [[API - rutas#comunas.py]]

## test_terreno.py
Una fila por comuna; valores en rango o nulos; región sin comunas → lista vacía; la erosión trae los dos orígenes por comuna y **coincide con la pertinencia de cada origen**. → [[API - rutas#comunas.py]]

## test_pertinencia_sirsd.py
La inversión es **UF por hectárea erosionada**; normalizaciones entre 0 y 1; la de inversión es **logarítmica**; fuera de dominio solo si se pide; serie por comuna ordenada y con UF; la inversión anómala no se entrega; comuna sin serie → lista vacía; los años con pocos planes van reservados. → [[API - rutas#pertinencia.py]]

## test_focalizacion.py
Con números a mano: la brecha es lo que falta hasta la mediana; sobre la mediana no hay brecha; sin dato no se inventa brecha; la mediana ignora nulos; rangos promedian empates; Spearman en los extremos; participación y referencia; un año sin incentivo no divide por cero; los períodos ponderan por incentivo. Con base: la brecha de la API cuadra; fuera de dominio sin brecha; la evolución cubre la serie; origen inexistente → 404. → [[API - núcleo#focalizacion.py]]

## test_localidades.py
GeoJSON con atribución; cada localidad trae lo que usa el visor; filtra por comuna; región sin localidades → colección vacía. → [[API - rutas#localidades.py]]

## test_exposicion.py
Manzanas exige la comuna; manzanas con atribución; comuna sin manzanas → colección vacía; equipamiento filtra por comuna y atribuye a OSM; **las respuestas grandes van comprimidas** (GZip); cauces respeta el orden mínimo; `armar_pronostico` ordena por lluvia de 72 h y rechaza respuestas desalineadas; el pronóstico se guarda y se declara; **sin servicio y sin copia → 503; sin servicio con copia → la copia vencida**; población exige la comuna; población 2024 urbana y rural; agrícola. → [[API - rutas#exposicion.py]] · [[API - rutas#inundacion.py]]

## test_areas_verdes.py
El estándar es el del SIEDU; **Rancagua reproduce el SIEDU** (8–9 m²/hab); las cuentas cuadran; las zonas suman la comuna; filtro por comuna; GeoJSON de una comuna; comuna sin zonas → 404. → [[API - rutas#urbano.py]]
