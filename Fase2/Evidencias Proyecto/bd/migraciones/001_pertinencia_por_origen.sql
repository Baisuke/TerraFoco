-- =============================================================================
-- 001 — La vista de pertinencia deja de exigir el calculo propio
--
-- Antes filtraba origen = 'TerraFoco', asi que el indice quedaba vacio hasta
-- tener RUSLE calculado, o sea hasta despues de resolver las descargas
-- satelitales. Ahora el origen es una columna: la linea base de CIREN produce
-- el indice desde el primer dia y ambos origenes se pueden comparar (UC-06).
--
-- Se hace DROP y no CREATE OR REPLACE porque cambia la lista de columnas.
-- =============================================================================

DROP VIEW IF EXISTS indicadores.v_pertinencia;

CREATE OR REPLACE VIEW indicadores.v_pertinencia AS
WITH ultima_erosion AS (
    SELECT DISTINCT ON (id_comuna, origen)
           id_comuna, id_region, origen, perdida_ton_ha, clase, anio
    FROM   indicadores.erosion
    ORDER  BY id_comuna, origen, anio DESC, calculado_en DESC
),
inversion AS (
    SELECT id_comuna,
           SUM(superficie_ha)  AS ha_bonificadas,
           SUM(monto_pesos)    AS monto_total,
           SUM(beneficiarios)  AS beneficiarios,
           MIN(precision_dato) AS precision_dato
    FROM   programas.ejecucion
    GROUP  BY id_comuna
),
base AS (
    SELECT c.id_comuna,
           c.id_region,
           c.nombre,
           c.provincia,
           c.superficie_km2,
           e.origen,
           e.anio AS anio_erosion,
           e.perdida_ton_ha,
           e.clase,
           i.ha_bonificadas,
           i.monto_total,
           i.beneficiarios,
           COALESCE(i.precision_dato, 'sin informacion') AS precision_dato,
           -- Intensidad de intervención: hectáreas bonificadas por cada 1.000 ha
           CASE WHEN c.superficie_km2 > 0
                THEN i.ha_bonificadas / (c.superficie_km2 / 10.0)
           END AS intensidad
    FROM   territorio.comuna c
    JOIN   ultima_erosion e ON e.id_comuna = c.id_comuna
    LEFT   JOIN inversion i ON i.id_comuna = c.id_comuna
)
SELECT b.*,
       -- Normalización dentro del alcance de la consulta (aquí: región y origen).
       -- Incluir el origen en la partición no es cosmético: mezclar la erosión de
       -- CIREN con la propia en un mismo mínimo-máximo produciría un índice sin
       -- sentido, porque son dos escalas distintas.
       (b.perdida_ton_ha - MIN(b.perdida_ton_ha) OVER w)
           / NULLIF(MAX(b.perdida_ton_ha) OVER w - MIN(b.perdida_ton_ha) OVER w, 0)
           AS necesidad_norm,
       (b.intensidad - MIN(b.intensidad) OVER w)
           / NULLIF(MAX(b.intensidad) OVER w - MIN(b.intensidad) OVER w, 0)
           AS inversion_norm,
       -- El índice mismo, para no repetir la resta en cada consulta.
       (b.perdida_ton_ha - MIN(b.perdida_ton_ha) OVER w)
           / NULLIF(MAX(b.perdida_ton_ha) OVER w - MIN(b.perdida_ton_ha) OVER w, 0)
       - COALESCE(
           (b.intensidad - MIN(b.intensidad) OVER w)
               / NULLIF(MAX(b.intensidad) OVER w - MIN(b.intensidad) OVER w, 0),
           0)
           AS pertinencia
FROM   base b
WINDOW w AS (PARTITION BY b.id_region, b.origen);

COMMENT ON VIEW indicadores.v_pertinencia IS
    'pertinencia = necesidad_norm - inversion_norm. Positivo: mucho problema y '
    'poca inversion. Negativo: al reves. La normalizacion ocurre aqui y no en el '
    'almacenamiento: cambiar el alcance de comparacion a nacional es cambiar la '
    'clausula WINDOW, no migrar datos. Filtrar por origen es responsabilidad de '
    'quien consulta: la vista expone CIREN y TerraFoco lado a lado.';
