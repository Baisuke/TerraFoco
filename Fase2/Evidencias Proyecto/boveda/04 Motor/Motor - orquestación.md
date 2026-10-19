# Motor · orquestación

**Carpeta:** `motor/orquestacion/`. El programador de tareas, separado en **lógica pura** (sin base) y **ejecutor** (con base y procesos). Concepto completo: [[Programador de tareas]]. `__init__.py` está vacío.

---

## programacion.py
- **Qué es:** la lógica de programación **sin acceso a la base de datos**: funciones puras sobre estructuras simples. Así se prueba sin PostgreSQL, que es donde se esconden los errores de este tipo de código (una tarea que nunca corre o corre de más no lanza ninguna excepción).
- **Contenido:**
  - `Tarea` (dataclass: código, comando, cadencia, día del mes, meses válidos, depende de, activa, última ejecución y estado).
  - `CADENCIAS` = `unica, semanal, mensual, estacional, trimestral, anual, manual`; una cadencia desconocida **falla fuerte**.
  - `ESPERA_TRAS_ERROR = 24 h`: tras un error no reintenta cada hora.
  - `trimestre(fecha)`.
  - `esta_vencida(tarea, ahora)` — la regla de cada cadencia; normaliza zonas horarias (comparar una fecha con zona y otra sin zona lanzaba `TypeError`).
  - `ordenar_por_dependencia(tareas)` — orden topológico; detecta **dependencias circulares**.
  - `bloqueadas_por_dependencia(tareas, resultados)` — qué no se ejecuta porque su dependencia falló o no ha corrido; busca en **toda** la lista de tareas.
- **Pruebas:** [[Motor - pruebas#test_programacion.py]]

## orquestador.py
- **Qué es:** el ejecutor. **No sabe nada del dominio**: solo qué comando invocar, cuándo y de qué depende (por eso migrar a Airflow sería escribir DAGs con los mismos comandos).
- **Uso:**

```bash
python -m orquestacion.orquestador --listar
python -m orquestacion.orquestador --ejecutar
python -m orquestacion.orquestador --forzar ingesta.ciren
python -m orquestacion.orquestador --demonio --intervalo 3600    # lo que corre terrafoco-programador
```

- **Funciones:** `cargar_tareas` (lee `operacion.tarea_programada`), `ejecutar_tarea` (`subprocess` con `shlex.split` del comando), `registrar` (actualiza `ultima_ejecucion`/`ultimo_estado`), `listar`, `ejecutar_pendientes` (vencidas → ordenadas → saltando las bloqueadas), `forzar`, `demonio` (bucle con intervalo), `main`.
- **Usa:** [[#programacion.py]], `bd.conexion`.

Ver también: [[Migraciones#005_tareas_programadas_reales.sql]] · [[Migraciones#018_tareas_nuevas_fuentes.sql]]
