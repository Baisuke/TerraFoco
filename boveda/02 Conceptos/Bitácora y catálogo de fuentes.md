# Bitácora y catálogo de fuentes

Dos tablas del esquema `operacion` que dicen **qué datos hay, de dónde vienen y qué corrió**.

## Catálogo de fuentes — `operacion.fuente` (UC-10)

- Una fila por fuente: código (`ciren`, `nasadem`, `esa_worldcover`, `osm_equipamiento`, `ine_manzanas`, `indap_serie`…), nombre, organismo, tipo, URL base, **estado administrativo** (`ok`, `parcial`, `pendiente`, `error`: lo que una persona declara) y una nota. Cuándo se cargó por última vez y cómo terminó **no** se guarda aquí: sale de la bitácora.
- Sembrado en la migración 012 (antes estaba vacío y la pantalla mostraba cifras inventadas); corregido en 017; cada migración que trae una fuente nueva la agrega (016, 019). → [[Migraciones#012_catalogo_de_fuentes.sql]]
- **Es lo único que la API escribe** (`POST /fuentes`, `PATCH /fuentes/{id}`), protegido con la clave de administración. → [[API - rutas#fuentes.py]] · [[API - núcleo#seguridad.py]]
- La API valida el estado contra **la misma lista que el CHECK de la tabla**: responde 422 con un mensaje claro antes de que PostgreSQL rechace el INSERT con un error de integridad.

## Bitácora — `operacion.ejecucion_proceso` (UC-12)

- Cada proceso del motor **abre una fila al empezar y la cierra al terminar** con `estado` (`ok`/`error`), `registros` escritos y `mensaje`.
- Se implementa con el gestor de contexto `Bitacora` de `motor/bd.py`:

```python
with Bitacora("ingesta.worldcover", fuente="esa_worldcover") as b:
    ...            # si algo lanza excepción, la fila queda en 'error'
    b.registros = n
```

- `fuente="codigo"` se traduce a `id_fuente`: así la bitácora y el catálogo hablan el mismo idioma y `fuentes.html` muestra "cargada el …, N registros" por fuente. Si el código no existe, **no rompe la ingesta** (avisa y deja la fila sin fuente); por eso hay una prueba que compara los códigos usados en `motor/ingesta` contra los sembrados. → [[Motor - pruebas#test_bitacora_fuente.py]]
- `--simular`: la fila de una corrida simulada se borra al cerrar (`Bitacora.simulada`), para no ensuciar el registro.
- La API la expone **solo lectura** (`GET /ejecuciones`, `/ejecuciones/resumen`): si la API pudiera tocarla, el registro dejaría de ser evidencia de lo que realmente pasó. → [[API - rutas#ejecuciones.py]]

## Dónde se ve

`fuentes.html`: tarjetas "Fuentes conectadas", "Procesos ejecutados", "Catálogo de fuentes" (editable con clave), "Últimas ejecuciones" y "Gestión pendiente". → [[Visor - páginas#fuentes.html]]

## Otras tablas de operación

- `operacion.tarea_programada` — la programación del motor. → [[Programador de tareas]]
- `operacion.cobertura_raster` — qué rásteres hay y qué cubren.
- `operacion.erosion_ciren_cruda` — tabla de paso de la ingesta de CIREN.

Ver también: [[Esquema de la base]]
