# Orquestación — Quién dispara qué y cada cuánto

Este documento responde una brecha detectada en la revisión de arquitectura: el
modelo de proceso describía **un ciclo trimestral único**, pero las fuentes no
comparten cadencia. Ese supuesto era incorrecto.

---

## 1. El problema

Cada fuente tiene un ritmo propio, y ninguno coincide con los demás:

| Fuente | Ritmo real del dato |
|---|---|
| NASADEM (elevación) | **Estático.** La topografía no cambia entre semestres |
| Sentinel-2 | Revisita de ~5 días sobre el mismo punto |
| Landsat (banda térmica) | ~8 días combinando Landsat 8 y 9 |
| CIREN — inventario de erosión | Estático: es una línea base de ~2010 |
| IDE Chile — límites comunales | Cambia rara vez, por acto administrativo |
| SIRSD-S — Transparencia Activa | **Publicación mensual obligatoria** (Ley 20.285) |
| SIRSD-S — entrega directa | Cadencia acordada con el organismo |
| SENAPRED — eventos | **Event-dependiente**, sin periodicidad |

Forzar todo a un ciclo trimestral produce dos errores opuestos: **se re-descarga
lo que no cambió** (elevación, línea base) y **se llega tarde a lo que sí cambió**
(publicaciones mensuales, eventos).

---

## 2. Cadencias definidas

| Tarea | Cadencia | Por qué esa y no otra |
|---|---|---|
| `ingesta.limites` | Anual | Los cambios comunales son actos administrativos infrecuentes |
| `ingesta.nasadem` | **Única**, al dar de alta una región | La elevación no cambia. Volver a bajarla es gasto puro |
| `ingesta.ciren` | Única + revisión anual | Es línea base; se re-verifica por si CIREN publica una actualización |
| `ingesta.sentinel` | **Mensual** | Aunque la revisita sea de 5 días, una escena suelta puede venir nublada. Se compone el mes y se procesa el compuesto |
| `ingesta.landsat` | **Estacional** (enero–febrero) | La isla de calor urbano se mide en verano; el resto del año el dato no sirve al indicador |
| `ingesta.transparencia` | **Mensual, día 10** | La publicación es mensual y obligatoria; el día 10 da margen a que el organismo cargue |
| `ingesta.senapred` | **Semanal + disparo manual** | No hay webhook. Se revisa seguido y se fuerza cuando ocurre un evento conocido |
| `indicadores.erosion` | Mensual, después de Sentinel-2 | Depende del factor C actualizado |
| `indicadores.pertinencia` | **Trimestral** | La ejecución presupuestaria se mueve lento; recalcular más seguido no aporta señal |
| `indicadores.inundacion` | Trimestral o tras un evento | La susceptibilidad es estructural, salvo que haya evidencia nueva |

> **Sobre Sentinel-2 y la revisita de 5 días.** La tentación es ingerir con esa
> frecuencia porque el satélite pasa. Pero el indicador que necesitamos —el factor C
> de cobertura vegetal— **no cambia cada 5 días**, y una escena individual puede estar
> tapada por nubes. Componer el mes descartando píxeles nublados da un dato más
> robusto y reduce el volumen a procesar en un orden de magnitud.

---

## 3. El principio que hace intercambiable al orquestador

**Cada tarea es un comando idempotente invocable desde la línea de comandos.**

```bash
python -m ingesta.sentinel --region 6 --periodo 2026-08
```

De ahí se desprenden tres propiedades:

1. **Idempotencia.** Volver a ejecutar el mismo período produce el mismo resultado,
   no duplica filas. Los indicadores se insertan versionados; la ingesta verifica si
   el período ya está cubierto.
2. **Ventana explícita.** La tarea recibe *qué período procesar*, no asume "ahora".
   Eso permite reprocesar historia (*backfill*) con el mismo código.
3. **El orquestador no sabe nada del dominio.** Solo sabe qué comando ejecutar,
   cuándo, y de qué depende.

> Esta es la decisión que importa: **cambiar de orquestador pasa a ser cambiar quién
> llama, no reescribir el motor.** Si mañana hay que migrar a la infraestructura de
> INDAP, se escriben DAGs que invocan exactamente los mismos comandos.

---

## 4. Elección del orquestador

| Opción | A favor | En contra | Veredicto |
|---|---|---|---|
| **Planificador propio + cron** | Cero infraestructura extra. Se lee entero en 150 líneas | Sin interfaz de observabilidad ni reintentos sofisticados | ✅ **Fase 2 y 3** |
| **Prefect** | Nativo de Python, despliegue liviano, buena trazabilidad | Un servicio más que mantener; el equipo tendría que aprenderlo | 🟡 Si sobra tiempo |
| **Airflow** | Estándar de la industria. Si INDAP ya lo tiene, integración directa | Requiere su propia base, scheduler, webserver y workers. Desproporcionado para tres personas en un semestre | 🟡 **Solo si INDAP lo aporta** |

**Decisión para el proyecto:** planificador propio, declarativo, con la tabla de
programación en la misma base.

El razonamiento: el entregable de este proyecto es **el análisis territorial**, no una
plataforma de orquestación. Montar Airflow consumiría un sprint completo en
infraestructura que no responde la pregunta de investigación. Y como las tareas son
comandos idempotentes, la migración posterior es barata.

**Pregunta abierta para el departamento de datos de INDAP:** si ya operan Airflow o
Prefect, conviene alinearse desde ahora — se escribirían los DAGs en vez del
planificador propio, sin cambiar el motor.

---

## 5. Cómo funciona el planificador

La programación **vive en la base de datos**, no en el código:

```sql
SELECT codigo, cadencia, ultima_ejecucion, ultimo_estado
FROM   operacion.tarea_programada
WHERE  activa;
```

El servicio `programador` despierta cada hora y:

1. Lee las tareas activas
2. Calcula cuáles están vencidas según su cadencia y su última ejecución exitosa
3. **Ordena por dependencias** — `indicadores.erosion` no corre antes que
   `ingesta.sentinel`
4. Ejecuta cada comando y registra el resultado en `operacion.ejecucion_proceso`
5. Si una tarea falla, **las que dependen de ella no se ejecutan** y quedan
   pendientes para el ciclo siguiente

### Ejecución manual

Todo lo que hace el planificador se puede forzar a mano:

```bash
# Ver qué está vencido, sin ejecutar nada
docker compose run --rm motor python -m orquestacion.orquestador --listar

# Ejecutar solo lo vencido
docker compose run --rm motor python -m orquestacion.orquestador --ejecutar

# Forzar una tarea concreta, ignorando su cadencia
docker compose run --rm motor python -m orquestacion.orquestador --forzar ingesta.senapred
```

El `--forzar` es la respuesta al caso de SENAPRED: cuando ocurre un evento conocido,
no hay que esperar al ciclo semanal.

---

## 6. Qué pasa cuando algo falla

| Situación | Comportamiento |
|---|---|
| Una fuente externa no responde | La tarea queda en `error`, se reintenta en el ciclo siguiente |
| Una tarea dependiente falla | Las que dependen de ella se saltan y quedan pendientes |
| El planificador se cae | Al reiniciar recalcula lo vencido desde `ultima_ejecucion`. No se pierde nada |
| Se ejecuta dos veces el mismo período | La idempotencia lo absorbe: no duplica |

**Nada se ejecuta en silencio.** Toda corrida, exitosa o no, deja fila en
`operacion.ejecucion_proceso` con inicio, fin, estado y mensaje de error.

---

## 7. Relación con el modelo BPMN

El BPMN del [documento 06](06-proceso-bpmn.md) modela **el ciclo trimestral de
indicadores**, que es el proceso de negocio: el que involucra a las personas, a la
solicitud de transparencia y a la validación del analista.

Este documento describe **la capa que está por debajo**: las ingestas técnicas que
alimentan ese ciclo, cada una con su ritmo. Son dos niveles distintos y no se
contradicen — el BPMN empieza cuando los datos ya están disponibles.

Dicho de otro modo: el planificador mantiene la base al día de forma continua; el
proceso trimestral es cuando alguien **mira** esos datos y emite un juicio.
