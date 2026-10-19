# Semillas y respaldo

Datos **ya agregados** que se versionan porque no se pueden (o no conviene) regenerar en cualquier equipo.

## bd/semillas/sirsd_serie_definitiva_2012_2025.csv
- **Qué es:** la serie del SIRSD-S por comuna y año (425 filas), extraída por el equipo de la réplica de la base de INDAP (DWH_ODS · BD_SIRSD_S).
- **Columnas:** `id_comuna; anio; planes; agricultores; incentivo; inversion_total; ha_reales; ha_ejecutada; ha_practica; ases_formulacion; ases_ejecucion; supagr_predios; dif_planes_vs_oficial; dif_incentivo_pct`.
- **Uso:** `python -m ingesta.sirsd_serie` → `programas.sirsd_anual`. Es la inversión del [[Índice de pertinencia]]. → [[Motor - ingesta#sirsd_serie.py]]
- **Sin datos personales:** solo agregados comuna-año.

## bd/semillas/sirsd_complemento_oficial_2012_2025.csv
- **Qué es:** los mismos ejes desde la **entrega oficial** de INDAP (planillas por año), agregados con `herramientas/agregar_entrega_indap.py`.
- **Columnas:** `id_comuna; anio; planes_oficial; incentivo_oficial; inversion_oficial; ha_ejecutada_oficial; ases_formulacion; ases_ejecucion; supagr_predios`.
- **Uso:** `sirsd_serie.py` lo une por comuna y año: sirve de **control** (423 de 425 celdas coinciden en planes) y aporta asesoría técnica y superficie agrícola de los predios. → [[Herramientas#agregar_entrega_indap.py]]

## bd/semillas/superficie_erosionada.csv
- **Qué es:** 33 filas: hectáreas con erosión > 18 t/ha/año por comuna, del cálculo propio a 30 m (`id_comuna; origen; anio; umbral_t_ha; ha_evaluadas; ha_sobre_umbral; en_dominio`).
- **Por qué existe:** los rásteres de erosión a 30 m (`/datos/erosion`) pesan gigabytes y solo están en el equipo que corrió el motor (el de Bastián). Sin esta tabla, la vista dejaría las 33 comunas sin UF/ha y el índice desaparecería en cualquier otro equipo (y en la copia portable).
- **Uso:** `python -m indicadores.superficie_erosionada --desde-semilla` (es también el respaldo automático cuando no hay rásteres). → [[Motor - indicadores#superficie_erosionada.py]]

## bd/respaldo
- `terrafoco-2026-09-22.dump` (1,7 MB, formato *custom* de `pg_dump`): la base tal como estaba ese día — comunas, erosión de ambos orígenes, factores, variables e índice de inundación, eventos, urbano, cauces, programas, catálogo, bitácora y tareas. Sirve para restaurar un entorno sin repetir horas de ingesta:

```bash
docker exec -i terrafoco-bd pg_restore -U terrafoco -d terrafoco --clean --if-exists < bd/respaldo/terrafoco-2026-09-22.dump
```

> [!warning] Es una foto de septiembre
> No incluye lo que llegó después (serie SIRSD-S de la 013, áreas verdes de la 014, exposición de la 016 y la 019). Tras restaurarlo hay que correr `inicializar.sh` y las ingestas nuevas.

Ver también: [[Esquema de la base]] · [[Migraciones]]
