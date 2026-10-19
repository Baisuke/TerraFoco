# SIRSD-S e INDAP

## El programa

**SIRSD-S**: Sistema de Incentivos para la Sustentabilidad Agroambiental de los Suelos Agropecuarios. Lo ejecutan **INDAP** (pequeños agricultores) y el SAG. Bonifica prácticas que recuperan o conservan el suelo: curvas de nivel, obras de conservación, cubiertas, enmiendas, fertilidad. Opera **por concursos** y bonifica **predios**.

**INDAP** (Instituto de Desarrollo Agropecuario) es el **cliente final** del proyecto y la contraparte del piloto: el equipo trabaja con la orientación del departamento de datos de INDAP. → [[Documentos del proyecto#04-plan-piloto.md]]

## Dónde entra en el modelo

Las prácticas que actúan sobre la pendiente efectiva (curvas de nivel, terrazas) bajan el **factor P** de RUSLE; las de cubierta bajan **C**; las enmiendas actúan sobre **K**. El esquema `programas.practica` marca a qué factor actúa cada práctica (`factor_rusle`) para no contar dos veces el mismo efecto. → [[RUSLE y erosión]] · [[Motor - ingesta#practicas.py]]

## Las tres fuentes de inversión que pasaron por el proyecto

| Fuente | Qué trae | Módulo | Estado |
|---|---|---|---|
| **IDE MINAGRI** (FeatureServer de CIREN, *Programa de Recuperación de Suelos Degradados*) | Superficie bonificada y monto por predio, 2021, 17 comunas | [[Motor - ingesta#sirsd_ide.py]] → `programas.ejecucion` | Se usa para el factor P. Los campos con nombre del agricultor y rol del predio **se descartan en el código** |
| **Planillas** (transparencia activa o entrega directa) | Detalle por comuna, con o sin superficie | [[Motor - ingesta#sirsd.py]] → `programas.ejecucion` / `ejecucion_rechazada` | Cargador genérico; marca `precision_dato` |
| **Serie INDAP 2012–2025** (DWH_ODS · BD_SIRSD_S) | Planes, agricultores, incentivo, inversión, hectáreas por comuna y año (425 celdas) | [[Motor - ingesta#sirsd_serie.py]] → `programas.sirsd_anual` | **Es la que usa el índice** desde la migración 013 |

## La serie 2012–2025 (la que importa)

- **Planes ejecutados:** estado *Declaración Jurada* o *Traspasado a Tesorería*; año = el de la declaración jurada.
- **Incentivo:** lo que pone el Estado (`SILP_INC_SOLICITADO`), en pesos nominales → se pasa a UF.
- **Validada** contra la entrega oficial de INDAP (30.313 planes): 423 de 425 celdas con el mismo número de planes; incentivo total con 0,002 % de diferencia.
- **Anomalía 6307/2017:** la inversión total supera tres veces al incentivo (error del sistema de origen). Se marca `inversion_anomala`; el incentivo se conserva porque es coherente.
- **Archivo versionado:** `bd/semillas/sirsd_serie_definitiva_2012_2025.csv` (ya agregado; sin datos personales). → [[Semillas]]

Detalle completo en [[Documentos del proyecto#17-serie-sirsd.md]].

## Las planillas oficiales y la privacidad

La entrega oficial de INDAP ("1- Solo Planes <año>.xlsx") trae **RUT, nombres, sexo, etnia, rol y nombre del predio**. Nunca se versionan ni se cargan. `herramientas/agregar_entrega_indap.py` lee **solo columnas no personales, por nombre**, suma por comuna y año y escribe únicamente el agregado. → [[Herramientas#agregar_entrega_indap.py]] · [[Privacidad y datos personales]]

## Lo que INDAP le pide a la herramienta (revisión crítica)

Desde el punto de vista de un funcionario de INDAP se implementaron:

1. Exposición **agrícola y rural** en inundaciones (hectáreas de cultivo/pradera y población rural, no solo escuelas urbanas). → [[Exposición]]
2. **Zonas descargables** para Google Earth (KML) y QGIS (GeoJSON). → [[Visor - mapas y módulos#zonas.js]]
3. **Recomendación** en la ficha de comuna ("Priorizar en el próximo concurso…"). → [[Visor - scripts base#data.js]]
4. **Mis predios**: el ejecutivo de área carga un CSV con sus predios y ve el riesgo de cada uno, sin subir nada a un servidor. → [[Visor - mapas y módulos#predios.js]]
5. Lectura "modo INDAP" en el visor de inundaciones.

Pendientes que dependen de datos de INDAP: tabla oficial de **agencias de área**, desglose del SIRSD-S **por subprograma/práctica**, y guía de mantenimiento para TI de INDAP.

Ver también: [[Índice de pertinencia]]
