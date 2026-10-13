# Dominio de validez

El cálculo propio de erosión **no funciona igual en toda la región**, y el sistema lo declara en vez de esconderlo.

## Qué pasó

Al validar contra CIREN: en 27 de las 33 comunas el orden coincide (Spearman ≈ +0,67) y las magnitudes caen dentro de un factor 1,5. En **seis comunas precordilleranas** —Machalí, San Fernando, Mostazal, Requínoa, Codegua y Rengo— el modelo sobreestima entre 20 y 300 veces.

## Por qué

La ecuación de erosividad de Renard & Freimund se ajustó con estaciones **bajo los 1.000 mm anuales** (en Estados Unidos) y su rama cuadrática crece demasiado rápido sobre los 850 mm. Las seis comparten perfil: mucha lluvia (R alto) y relieve fuerte (LS alto).

## La regla

`R_MAXIMO_CONFIABLE = 2000` MJ·mm/(ha·h·año) en [[Motor - indicadores#rusle.py]]. Sobre eso, la fila de `indicadores.erosion` lleva `en_dominio = false`.

> [!important] El umbral no se eligió para que la correlación saliera bien
> Sale de un argumento físico previo (la calibración de la ecuación). La validación solo **confirma** el quiebre: `python -m validar` imprime el barrido completo de umbrales (1.200 a 3.000) y muestra que el resultado se sostiene entre 1.200 y 2.200 y se derrumba sobre 2.500. → [[Motor - raíz#validar.py]]

## Cómo se usa

- **Base de datos:** columna `en_dominio` (migración 003), expuesta por la vista de pertinencia (004). La vista **normaliza por separado** las comunas dentro y fuera del dominio para no aplastar la escala. → [[Migraciones#003_dominio_de_validez.sql]]
- **API:** `/pertinencia?incluir_fuera_de_dominio=true` las incluye solo si se pide. → [[API - rutas#pertinencia.py]]
- **Visor:** casilla "incluir fuera de dominio" (`montarCasillaDominio` en shell.js); la ficha de comuna recomienda decidir con la línea base de CIREN (`GT.recomendacion`). → [[Visor - scripts base#shell.js]] · [[Visor - scripts base#data.js]]
- **Superficie erosionada:** fuera del dominio la superficie "severa" llega al 55–94 % de la comuna, por eso esas filas también van con `en_dominio = false`. → [[Motor - indicadores#superficie_erosionada.py]]

## Para la defensa

"Un modelo con dominio de validez declarado vale más que uno que aparenta funcionar en todas partes." Quien consulta ve el dato **y** sabe que está fuera de rango.

Ver también: [[RUSLE y erosión]] · [[Índice de pertinencia]]
