-- =============================================================================
-- 004 — La vista de pertinencia expone el dominio de validez
--
-- Quien consulte debe poder distinguir una comuna donde el modelo esta
-- validado de una donde sobreestima. Se expone la bandera en vez de filtrar
-- aqui: el filtro es decision de quien consulta, no de la vista.
-- =============================================================================

DROP VIEW IF EXISTS indicadores.v_pertinencia;

CREATE OR REPLACE VIEW indicadores.v_pertinencia AS
WITH ultima_erosion AS (
    SELECT DISTINCT ON (id_comuna, origen)
           id_comuna, id_region, origen, perdida_ton_ha, clase, anio, en_dominio
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
           e.en_dominio,
           e.perdida_ton_ha,
           e.clase,
           i.ha_bonificadas,
           i.monto_total,
           i.beneficiarios,
           COALESCE(i.precision_dato, 'sin informacion') AS precision_dato,
           CASE WHEN c.superficie_km2 > 0
                THEN i.ha_bonificadas / (c.superficie_km2 / 10.0)
           END AS intensidad
    FROM   territorio.comuna c
    JOIN   ultima_erosion e ON e.id_comuna = c.id_comuna
    LEFT   JOIN inversion i ON i.id_comuna = c.id_comuna
)
SELECT b.*,
       (b.perdida_ton_ha - MIN(b.perdida_ton_ha) OVER w)
           / NULLIF(MAX(b.perdida_ton_ha) OVER w - MIN(b.perdida_ton_ha) OVER w, 0)
           AS necesidad_norm,
       (b.intensidad - MIN(b.intensidad) OVER w)
           / NULLIF(MAX(b.intensidad) OVER w - MIN(b.intensidad) OVER w, 0)
           AS inversion_norm,
       (b.perdida_ton_ha - MIN(b.perdida_ton_ha) OVER w)
           / NULLIF(MAX(b.perdida_ton_ha) OVER w - MIN(b.perdida_ton_ha) OVER w, 0)
       - COALESCE(
           (b.intensidad - MIN(b.intensidad) OVER w)
               / NULLIF(MAX(b.intensidad) OVER w - MIN(b.intensidad) OVER w, 0),
           0)
           AS pertinencia
FROM   base b
-- La normalizacion tambien separa por dominio: mezclar comunas validadas con
-- otras que sobreestiman 300 veces aplastaria toda la escala contra el cero.
WINDOW w AS (PARTITION BY b.id_region, b.origen, b.en_dominio);

COMMENT ON VIEW indicadores.v_pertinencia IS
    'pertinencia = necesidad_norm - inversion_norm. Positivo: mucho problema y '
    'poca inversion. La normalizacion ocurre en consulta y se separa por region, '
    'origen y dominio de validez. Filtrar por en_dominio es responsabilidad de '
    'quien consulta: la vista muestra todo y lo declara.';
