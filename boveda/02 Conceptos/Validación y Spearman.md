# Validación y Spearman

El proyecto valida dos modelos, y en los dos la medida principal es la **correlación de rangos de Spearman (ρ)**.

## Qué es Spearman y por qué

Spearman = la correlación de Pearson calculada sobre los **rangos** (posiciones en el orden) en vez de los valores. Mide si dos cosas **ordenan igual** el territorio, sin exigir que los números coincidan ni que la relación sea lineal.

- ρ = +1: mismo orden. ρ = −1: orden inverso. ρ ≈ 0: sin relación.
- Los empates comparten el rango promedio.
- Se implementa **sin scipy** (son ~30 líneas) y la significancia se obtiene **por permutaciones**. → [[Motor - raíz#validar.py]] · [[Motor - pruebas#test_validar.py]]

## Validación 1 · Erosión propia contra CIREN

- **Pregunta:** ¿el cálculo propio ordena las comunas como el inventario oficial?
- **Resultado:** ρ ≈ −0,04 sobre las 33; **≈ +0,67 sobre las 27** dentro del [[Dominio de validez]].
- **Trampa evitada:** no se barren umbrales para quedarse con el mejor. El umbral sale de la física (R ≤ 2.000) y el barrido se imprime completo para mostrar que el resultado no depende de acertar un número.
- Comando: `python -m validar`.

## Validación 2 · Índice de inundación contra eventos históricos

Eventos: **DesInventar** (UNDRR, alimentado por ONEMI), 63 eventos con comuna en O'Higgins (1970–2014). → [[Motor - ingesta#desinventar.py]]

Tres preguntas, en orden de exigencia ([[Motor - indicadores#validar_inundacion.py]]):

1. **¿Qué fracción de eventos cae en comunas Alta o Muy alta?** Es el criterio declarado en el perfil ("una proporción mayoritaria"), pero solo engaña: si muchas comunas son Alta, el azar ya da mucho. Se compara con el azar.
2. **¿Ordena el índice como los eventos?** Spearman índice vs. número de eventos.
3. **¿Qué variable aporta y cuál estorba?** Spearman de cada variable contra su signo esperado.

**Resultado vigente:** **43 de 63 eventos (68 %) en Alta/Muy alta frente a 52 % del azar (+16–17 puntos); Spearman ≈ +0,36.**

### Criterio para marcar "calibrado"

`pasa_criterio`: más del 50 % de los eventos en Alta/Muy alta **y** al menos **10 puntos** sobre el azar (`MEJORA_MINIMA = 0.10`) **y** ρ > 0. La tarea `validar.inundacion --marcar-si-pasa` corre después de cada recálculo y solo marca `calibrado = TRUE` si se cumple. → [[Programador de tareas]] · [[Motor - pruebas#test_criterio_calibracion.py]]

### Límites que se imprimen con el resultado

- 33 comunas: ±0,35 es sugerente, no concluyente.
- Eventos de prensa (El Mercurio sobre todo): sobrerrepresentan comunas pobladas.
- Todo es **en muestra**: los mismos eventos que eligieron los pesos los miden. Por eso los juegos de pesos se declararon de antemano.
- 1982 concentra 31 de 63 eventos: se reporta también sin ese año.

## En el visor

El explorador de pesos de `inundaciones.html` rehace esta validación en el navegador para cualquier juego de pesos, con el mismo ρ que el motor (±0,0001 en el índice comunal). → [[Visor - mapas y módulos#inundacion-calculo.js]]

Ver también: [[Susceptibilidad a inundación]] · [[Preguntas de defensa]]
