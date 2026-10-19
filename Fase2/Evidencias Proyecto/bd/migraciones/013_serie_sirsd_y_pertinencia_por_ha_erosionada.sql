-- =============================================================================
-- 013 — Serie del SIRSD-S 2012-2025 y pertinencia por hectárea erosionada
--
-- Hasta aquí el índice usaba UNA planilla (IDE MINAGRI, 2021, 17 comunas,
-- $426 millones) y medía la inversión como hectáreas bonificadas por cada
-- 1.000 ha comunales. Con la serie que INDAP extrajo de su propia base
-- (docs/17-serie-sirsd.md) se aplican los tres pendientes que el equipo dejó
-- declarados antes de calcular:
--
--   1. Período completo 2012-2025, no un año: el programa opera por
--      concursos y una comuna puede tener un año grande y el siguiente en
--      cero por el ciclo, no por focalización.
--   2. Deflactado a UF: catorce años de pesos nominales subestiman los
--      años tempranos. Promedio anual de la UF del año de la declaración.
--   3. Por hectárea erosionada: la necesidad está en t/ha/año (intensiva) y
--      la inversión en pesos (extensiva); no son comparables. El denominador
--      es la superficie con erosión Severa o superior (> 18 t/ha/año) del
--      cálculo propio a 30 m (indicadores.superficie_erosionada).
--
-- La variable del índice es el INCENTIVO (la plata del Estado), no la
-- inversión total, que incluye el aporte del agricultor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UF promedio anual
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS programas.uf_anual (
    anio          SMALLINT      PRIMARY KEY,
    uf_promedio   NUMERIC(10,2) NOT NULL CHECK (uf_promedio > 0),
    dias          SMALLINT      NOT NULL,
    fuente        VARCHAR(120)  NOT NULL
);

COMMENT ON TABLE programas.uf_anual IS
    'Promedio de los valores diarios de la UF. Fuente: mindicador.cl, que '
    'republica al Banco Central. Se descartaron dos valores erróneos de la '
    'serie publicada (29 y 30-12-2014, ~608) con un filtro de continuidad: '
    'más de 2 % lejos de la mediana de los 15 días que los rodean.';

INSERT INTO programas.uf_anual (anio, uf_promedio, dias, fuente) VALUES
    (2012, 22598.85, 366, 'mindicador.cl / Banco Central de Chile'),
    (2013, 22980.90, 365, 'mindicador.cl / Banco Central de Chile'),
    (2014, 23956.93, 363, 'mindicador.cl / Banco Central de Chile'),
    (2015, 25018.65, 363, 'mindicador.cl / Banco Central de Chile'),
    (2016, 26022.67, 366, 'mindicador.cl / Banco Central de Chile'),
    (2017, 26571.93, 365, 'mindicador.cl / Banco Central de Chile'),
    (2018, 27165.75, 365, 'mindicador.cl / Banco Central de Chile'),
    (2019, 27854.39, 365, 'mindicador.cl / Banco Central de Chile'),
    (2020, 28678.81, 366, 'mindicador.cl / Banco Central de Chile'),
    (2021, 29802.93, 365, 'mindicador.cl / Banco Central de Chile'),
    (2022, 33047.14, 365, 'mindicador.cl / Banco Central de Chile'),
    (2023, 35974.37, 365, 'mindicador.cl / Banco Central de Chile'),
    (2024, 37508.22, 366, 'mindicador.cl / Banco Central de Chile'),
    (2025, 39156.97, 365, 'mindicador.cl / Banco Central de Chile')
ON CONFLICT (anio) DO UPDATE
    SET uf_promedio = EXCLUDED.uf_promedio, dias = EXCLUDED.dias, fuente = EXCLUDED.fuente;

-- ---------------------------------------------------------------------------
-- Serie del SIRSD-S por comuna y año (ingesta.sirsd_serie)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS programas.sirsd_anual (
    id_comuna            INTEGER       NOT NULL REFERENCES territorio.comuna(id_comuna),
    anio                 SMALLINT      NOT NULL,
    planes               INTEGER       NOT NULL CHECK (planes >= 0),
    agricultores         INTEGER       NOT NULL CHECK (agricultores >= 0),
    incentivo            NUMERIC(15,0) NOT NULL CHECK (incentivo >= 0),
    inversion_total      NUMERIC(15,0) CHECK (inversion_total >= 0),
    inversion_anomala    BOOLEAN       NOT NULL DEFAULT false,
    ha_reales            NUMERIC(12,2),
    ha_ejecutada         NUMERIC(12,2),
    ha_practica          NUMERIC(12,2),
    -- De la entrega oficial (herramientas/agregar_entrega_indap.py): la base
    -- no los reproduce, y los *_oficial son el control externo.
    ases_formulacion     NUMERIC(15,0),
    ases_ejecucion       NUMERIC(15,0),
    supagr_predios       NUMERIC(12,2),
    planes_oficial       INTEGER,
    incentivo_oficial    NUMERIC(15,0),
    fuente               VARCHAR(80)   NOT NULL,
    cargado_en           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (id_comuna, anio)
);

COMMENT ON COLUMN programas.sirsd_anual.incentivo IS
    'SILP_INC_SOLICITADO en pesos del año: la plata del Estado. Variable del índice.';
COMMENT ON COLUMN programas.sirsd_anual.inversion_anomala IS
    'true cuando la inversión total supera 3 veces el incentivo (lo normal es '
    '~1,25). Es un error del sistema de origen —6307/2017: 4.811 millones contra '
    '~100 en los años vecinos, y el mismo valor en la entrega oficial—. El '
    'incentivo de esa celda es correcto; la inversión no se suma.';
COMMENT ON COLUMN programas.sirsd_anual.ha_practica IS
    'Intensidad de intervención, NO superficie: una hectárea con dos prácticas cuenta dos veces.';
COMMENT ON COLUMN programas.sirsd_anual.agricultores IS
    'Agricultores distintos EN EL AÑO. Sumar años cuenta dos veces a quien tuvo planes en ambos.';

-- ---------------------------------------------------------------------------
-- Superficie erosionada por comuna (indicadores.superficie_erosionada)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indicadores.superficie_erosionada (
    id_comuna        INTEGER       NOT NULL REFERENCES territorio.comuna(id_comuna),
    id_region        SMALLINT      NOT NULL,
    origen           VARCHAR(20)   NOT NULL,
    anio             SMALLINT      NOT NULL,
    umbral_t_ha      NUMERIC(6,2)  NOT NULL,
    ha_evaluadas     NUMERIC(12,2) NOT NULL,
    ha_sobre_umbral  NUMERIC(12,2) NOT NULL,
    en_dominio       BOOLEAN       NOT NULL,
    calculado_en     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (id_comuna, origen, anio, umbral_t_ha)
);

COMMENT ON TABLE indicadores.superficie_erosionada IS
    'Hectáreas con erosión sobre el umbral, contadas en el ráster de 30 m del '
    'cálculo propio. Denominador de la inversión en v_pertinencia. en_dominio '
    'viene de indicadores.erosion: fuera de él el modelo sobreestima y la '
    'superficie "severa" llega al 55-94 % de la comuna.';

-- ---------------------------------------------------------------------------
-- Vista de pertinencia
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS indicadores.v_pertinencia;

CREATE VIEW indicadores.v_pertinencia AS
WITH ultima_erosion AS (
    SELECT DISTINCT ON (id_comuna, origen)
           id_comuna, id_region, origen, perdida_ton_ha, clase, anio, en_dominio
    FROM   indicadores.erosion
    ORDER  BY id_comuna, origen, anio DESC, calculado_en DESC
),
inversion AS (
    SELECT s.id_comuna,
           SUM(s.ha_reales)                                  AS ha_bonificadas,
           SUM(s.incentivo)                                  AS monto_total,
           SUM(s.incentivo / u.uf_promedio)                  AS incentivo_uf,
           SUM(s.agricultores)                               AS beneficiarios,
           SUM(s.planes)                                     AS planes,
           SUM(s.inversion_total) FILTER (WHERE NOT s.inversion_anomala) AS inversion_total,
           MIN(s.anio)                                       AS anio_desde,
           MAX(s.anio)                                       AS anio_hasta,
           -- Un año sin UF no desaparece en silencio: el incentivo en pesos
           -- lo cuenta igual, y esta columna avisa que el de UF no.
           COUNT(*) FILTER (WHERE u.anio IS NULL)            AS anios_sin_uf
    FROM   programas.sirsd_anual s
    LEFT   JOIN programas.uf_anual u USING (anio)
    GROUP  BY s.id_comuna
),
superficie AS (
    SELECT DISTINCT ON (id_comuna)
           id_comuna, ha_sobre_umbral, en_dominio
    FROM   indicadores.superficie_erosionada
    WHERE  origen = 'TerraFoco' AND umbral_t_ha = 18
    ORDER  BY id_comuna, anio DESC, calculado_en DESC
),
base AS (
    SELECT c.id_comuna,
           c.id_region,
           c.nombre,
           c.provincia,
           c.superficie_km2,
           e.origen,
           e.anio AS anio_erosion,
           -- Válida para el índice si lo es la erosión Y el denominador: con
           -- CIREN como origen, las seis comunas donde el cálculo propio
           -- sobreestima quedan fuera por su superficie erosionada.
           (e.en_dominio AND COALESCE(sf.en_dominio, false)) AS en_dominio,
           e.perdida_ton_ha,
           e.clase,
           i.ha_bonificadas,
           i.monto_total,
           i.beneficiarios,
           CASE WHEN i.id_comuna IS NULL THEN 'sin informacion' ELSE 'completa' END
               AS precision_dato,
           i.planes,
           i.incentivo_uf,
           i.inversion_total,
           i.anio_desde,
           i.anio_hasta,
           i.anios_sin_uf,
           sf.ha_sobre_umbral AS ha_erosion_severa,
           i.incentivo_uf / NULLIF(sf.ha_sobre_umbral, 0) AS inversion_uf_ha
    FROM   territorio.comuna c
    JOIN   ultima_erosion e ON e.id_comuna = c.id_comuna
    LEFT   JOIN inversion i  ON i.id_comuna = c.id_comuna
    LEFT   JOIN superficie sf ON sf.id_comuna = c.id_comuna
)
SELECT b.*,
       (b.perdida_ton_ha - MIN(b.perdida_ton_ha) OVER w)
           / NULLIF(MAX(b.perdida_ton_ha) OVER w - MIN(b.perdida_ton_ha) OVER w, 0)
           AS necesidad_norm,
       -- En logaritmo: la inversión por hectárea erosionada va de 0,3 a 34
       -- UF entre comunas (dos órdenes de magnitud) y tres comunas muy por
       -- encima dejaban a las demás apretadas contra el cero en escala lineal.
       (LN(NULLIF(b.inversion_uf_ha, 0)) - MIN(LN(NULLIF(b.inversion_uf_ha, 0))) OVER w)
           / NULLIF(MAX(LN(NULLIF(b.inversion_uf_ha, 0))) OVER w
                    - MIN(LN(NULLIF(b.inversion_uf_ha, 0))) OVER w, 0)
           AS inversion_norm,
       (b.perdida_ton_ha - MIN(b.perdida_ton_ha) OVER w)
           / NULLIF(MAX(b.perdida_ton_ha) OVER w - MIN(b.perdida_ton_ha) OVER w, 0)
       - COALESCE(
           (LN(NULLIF(b.inversion_uf_ha, 0)) - MIN(LN(NULLIF(b.inversion_uf_ha, 0))) OVER w)
               / NULLIF(MAX(LN(NULLIF(b.inversion_uf_ha, 0))) OVER w
                        - MIN(LN(NULLIF(b.inversion_uf_ha, 0))) OVER w, 0),
           0)
           AS pertinencia
FROM   base b
-- La normalización separa por dominio: mezclar comunas válidas con otras
-- donde el modelo sobreestima aplastaría la escala.
WINDOW w AS (PARTITION BY b.id_region, b.origen, b.en_dominio);

COMMENT ON VIEW indicadores.v_pertinencia IS
    'pertinencia = necesidad_norm - inversion_norm. Necesidad: pérdida de suelo '
    '(t/ha/año) del origen. Inversión: incentivo del SIRSD-S 2012-2025 en UF por '
    'hectárea con erosión Severa o superior del cálculo propio, normalizada en '
    'logaritmo. Normalización por región, origen y dominio de validez.';
