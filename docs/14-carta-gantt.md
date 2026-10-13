# Carta Gantt — 18 semanas

Planificación del proyecto alineada al cronograma de la asignatura, no a un
calendario propio. Las fechas provienen del cronograma oficial: cada semana
comienza un lunes y termina un sábado.

> **Verificar antes de usar:** el cronograma disponible indica la sigla
> `PTY4614`, mientras que los documentos de evaluación indican `APT122`. Puede
> tratarse de otra sección. Confirmar las fechas con la docente guía antes de
> comprometerse con ellas.

---

## Hitos del calendario

| Semana | Fechas | Hito |
|---|---|---|
| 4 | 31 ago – 5 sep | **Presentación del proyecto** · Sumativa Fase 1 |
| 6 | 14 – 19 sep | Entrega de objetivos, metodología y cronograma actualizados |
| 10 | 12 – 17 oct | Evaluación de avance, sin presentación |
| 15 | 16 – 21 nov | **Presentación del desarrollo y resultados** · Sumativa Fase 2 |
| 17–18 | 30 nov – 12 dic | **Presentación final** · Fase 3 |

---

## Actividades

```
                                          FASE 1        FASE 2                      FASE 3
Actividad                                 1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18
─────────────────────────────────────────────────────────────────────────────────────────────
Definición del proyecto y fuentes         ██ ██ ██ ██
Infraestructura y modelo de datos               ██ ██ ██
Carga de cartografía y línea base                  ██ ██ ██ ██
Motor de cálculo del modelo RUSLE                        ██ ██ ██ ██ ██ ██
Ingesta de la ejecución del programa                        ██ ██ ██
Índice de pertinencia y publicación                            ██ ██ ██ ██
Visor cartográfico y detalle predial                              ██ ██ ██ ██ ██
Validación del modelo                                                ██ ██ ██ ██ ██
Módulos 2 y 3 — inundaciones y ciudades                                    ██ ██ ██ ██
Informe, resultados y presentación                                               ██ ██ ██ ██ ██
```

---

## Detalle por actividad

### 1 · Definición del proyecto y fuentes — semanas 1 a 4

Identificar la problemática, **verificar empíricamente** la disponibilidad de
los datos y definir alcance y objetivos.

La verificación temprana resultó decisiva: se comprobó que el portal de datos
abiertos del Estado no publica la información de INDAP, que el inventario de
CIREN ya calcula la erosión —lo que redirigió el aporte original del proyecto
hacia el cruce— y que su cobertura llega hasta Los Lagos, que es el techo real
de escalabilidad.

**Responsable:** equipo completo

### 2 · Infraestructura y modelo de datos — semanas 3 a 5

Entorno con contenedores, esquema espacial y control de versiones.

*Facilitador:* los contenedores garantizan que los tres integrantes usen la
misma versión de las bibliotecas geoespaciales.
*Obstaculizador:* instalar esas bibliotecas a mano difiere entre sistemas
operativos y es la primera fuente de «en mi computador funciona».

**Responsable:** Bastián Cárcamo

### 3 · Carga de cartografía y línea base — semanas 4 a 7

Límites comunales oficiales e inventario nacional de erosión.

*Obstaculizador:* el servidor del inventario limita las descargas por ráfaga y
responde con error tras varias consultas seguidas. Se resolvió con reintentos
de espera creciente y pausas entre cuencas.

**Responsable:** Bastián Cárcamo

### 4 · Motor de cálculo del modelo RUSLE — semanas 6 a 11

Los cinco factores del modelo desde datos climáticos, de suelo, relieve y
cobertura vegetal.

*Facilitador:* cada factor se calcula y almacena por separado, de modo que la
falta de una fuente no bloquea el avance de las demás.

**Responsable:** Bastián Cárcamo y Antonio Lankin

### 5 · Ingesta de la ejecución del programa — semanas 7 a 9

Registros de bonificación del SIRSD-S, agregados por comuna y sin datos
personales.

*Facilitador:* el dato resultó estar publicado como servicio en IDE MINAGRI.
*Obstaculizador:* cubre un solo año, por lo que la serie histórica sigue
dependiendo de la gestión con INDAP.

**Responsable:** Carla Morales

### 6 · Índice de pertinencia y publicación — semanas 8 a 11

El indicador que cruza degradación e inversión, expuesto mediante interfaz de
programación.

*Facilitador:* el índice se calcula en la consulta y no en el almacenamiento,
de modo que cambiar el alcance de comparación no exige migrar datos.

**Responsable:** Antonio Lankin

### 7 · Visor cartográfico y detalle predial — semanas 9 a 13

Interfaz de exploración y descenso desde el promedio comunal al detalle de 30
metros.

*Facilitador:* el visor se degrada por niveles y sigue funcionando aunque no
haya conexión con el servidor.

**Responsable:** Antonio Lankin

### 8 · Validación del modelo — semanas 10 a 14

Contraste contra el inventario de CIREN y determinación del dominio de validez.

*Obstaculizador:* la ecuación de erosividad empleada no está calibrada para
regímenes de precipitación andinos, lo que obligó a declarar seis comunas
fuera del dominio de validez del sistema.

**Responsable:** Bastián Cárcamo

### 9 · Módulos 2 y 3 — inundaciones y ciudades — semanas 12 a 15

Índice de susceptibilidad a inundación por análisis multicriterio sobre
derivados del modelo de elevación, e indicador de temperatura superficial y
déficit de áreas verdes por habitante. Ambos se construyen sobre el mismo
núcleo del módulo de suelos.

*Facilitador:* la ingesta, la normalización y el almacenamiento del dato raster
ya están resueltos por el núcleo, de modo que lo único que cambia es el
indicador que se calcula.
*Obstaculizador:* el acceso a la interfaz de descarga masiva del USGS requiere
aprobación previa que puede demorar días.

**Son los módulos que se recortan si el calendario se estrecha**, primero el
urbano. El resultado central del proyecto no depende de ellos.

**Responsable:** equipo completo

### 10 · Informe, resultados y presentación — semanas 14 a 18

Informe final, figuras y presentación de resultados.

*Facilitador:* la documentación se ha mantenido versionada junto al código
desde el inicio, de modo que el informe se redacta sobre material existente y
no desde cero.

**Responsable:** equipo completo

---

## Criterio de recorte

Si el calendario se estrecha, el orden en que se sacrifica el alcance es:

1. **Módulo 3** — clima urbano
2. **Módulo 2** — inundaciones
3. **Cálculo propio de RUSLE**, quedándose con la línea base de CIREN

Lo que **no se recorta** es el índice de pertinencia territorial: es el
resultado que responde la pregunta del proyecto y el único que no existe en
ninguna otra herramienta.
