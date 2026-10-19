-- =============================================================================
-- TerraFoco — Esquema de base de datos
-- PostgreSQL 16 + PostGIS 3.4
--
-- Decisiones de diseño documentadas en:
--   Evidencias de documentación/docs/07-plan-desarrollo.md
--
-- Ejecutar sobre una base vacía:
--   psql -U terrafoco -d terrafoco -f esquema.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_raster;

CREATE SCHEMA IF NOT EXISTS territorio;
CREATE SCHEMA IF NOT EXISTS indicadores;
CREATE SCHEMA IF NOT EXISTS programas;
CREATE SCHEMA IF NOT EXISTS operacion;

-- Sistema de referencia de trabajo: SIRGAS-Chile / UTM 19S
-- Se usa métrico para poder calcular superficies y distancias sin reproyectar.
-- El EPSG efectivo se guarda por región, porque el país cruza dos husos UTM.

-- =============================================================================
-- TERRITORIO
-- =============================================================================

CREATE TABLE territorio.region (
    id_region        SMALLINT     PRIMARY KEY,
    codigo           VARCHAR(3)   NOT NULL UNIQUE,   -- código oficial INE
    nombre           VARCHAR(120) NOT NULL,
    epsg_trabajo     INTEGER      NOT NULL,          -- p. ej. 32719 para UTM 19S
    -- Área de interés: el motor lee de aquí el recorte. NUNCA en el código.
    extension        geometry(Polygon, 4326) NOT NULL,
    resolucion_m     SMALLINT     NOT NULL DEFAULT 30,
    activa           BOOLEAN      NOT NULL DEFAULT TRUE,
    CONSTRAINT region_resolucion_valida CHECK (resolucion_m > 0)
);

COMMENT ON COLUMN territorio.region.extension IS
    'Bounding box del área de interés. Parametriza la ingesta: agregar una región '
    'es insertar una fila, no modificar código.';

CREATE TABLE territorio.comuna (
    id_comuna        INTEGER      PRIMARY KEY,       -- código oficial INE
    id_region        SMALLINT     NOT NULL REFERENCES territorio.region(id_region),
    nombre           VARCHAR(120) NOT NULL,
    provincia        VARCHAR(120) NOT NULL,
    superficie_km2   NUMERIC(10,2),
    geom             geometry(MultiPolygon, 4326) NOT NULL,
    CONSTRAINT comuna_superficie_positiva CHECK (superficie_km2 IS NULL OR superficie_km2 > 0)
);

CREATE INDEX ix_comuna_geom   ON territorio.comuna USING GIST (geom);
CREATE INDEX ix_comuna_region ON territorio.comuna (id_region);

CREATE TABLE territorio.ciudad (
    id_ciudad        SERIAL       PRIMARY KEY,
    id_comuna        INTEGER      NOT NULL REFERENCES territorio.comuna(id_comuna),
    nombre           VARCHAR(120) NOT NULL,
    geom             geometry(MultiPolygon, 4326)
);

CREATE TABLE territorio.unidad_vecinal (
    id_uv            SERIAL       PRIMARY KEY,
    id_ciudad        INTEGER      NOT NULL REFERENCES territorio.ciudad(id_ciudad),
    nombre           VARCHAR(160) NOT NULL,
    habitantes       INTEGER,
    geom             geometry(MultiPolygon, 4326) NOT NULL,
    CONSTRAINT uv_habitantes_positivos CHECK (habitantes IS NULL OR habitantes >= 0)
);

CREATE INDEX ix_uv_geom ON territorio.unidad_vecinal USING GIST (geom);

-- =============================================================================
-- INDICADORES
-- Particionados por región: escalar a otra región no degrada las consultas.
-- Se guardan VALORES ABSOLUTOS. La normalización se hace en consulta.
-- =============================================================================

CREATE TABLE indicadores.erosion (
    id_erosion       BIGSERIAL,
    id_region        SMALLINT     NOT NULL REFERENCES territorio.region(id_region),
    id_comuna        INTEGER      NOT NULL REFERENCES territorio.comuna(id_comuna),
    anio             SMALLINT     NOT NULL,
    -- Factores RUSLE por separado: permite auditar el resultado
    factor_r         NUMERIC(8,2)  NOT NULL,
    factor_k         NUMERIC(7,5)  NOT NULL,
    factor_ls        NUMERIC(7,3)  NOT NULL,
    factor_c         NUMERIC(6,4)  NOT NULL,
    factor_p         NUMERIC(6,4)  NOT NULL,
    perdida_ton_ha   NUMERIC(9,2)  NOT NULL,         -- resultado A
    clase            VARCHAR(20)   NOT NULL,
    origen           VARCHAR(30)   NOT NULL,         -- 'CIREN' | 'TerraFoco'
    calculado_en     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (id_erosion, id_region),
    CONSTRAINT erosion_factores_positivos
        CHECK (factor_r > 0 AND factor_k > 0 AND factor_ls > 0
               AND factor_c > 0 AND factor_p > 0),
    CONSTRAINT erosion_clase_valida
        CHECK (clase IN ('Ligera','Moderada','Severa','Muy severa','Extrema'))
) PARTITION BY LIST (id_region);

COMMENT ON TABLE indicadores.erosion IS
    'Nunca se sobrescribe: cada recálculo inserta una versión nueva con su '
    'marca temporal. El histórico es parte del producto.';

CREATE TABLE indicadores.susceptibilidad_inundacion (
    id_susc          BIGSERIAL,
    id_region        SMALLINT     NOT NULL REFERENCES territorio.region(id_region),
    id_comuna        INTEGER      NOT NULL REFERENCES territorio.comuna(id_comuna),
    pendiente_media  NUMERIC(6,2),
    acum_flujo       NUMERIC(12,2),
    dist_cauce_m     NUMERIC(10,2),
    indice_twi       NUMERIC(7,3),
    susceptibilidad  NUMERIC(4,3) NOT NULL,          -- 0 a 1
    clase            VARCHAR(20)  NOT NULL,
    calibrado        BOOLEAN      NOT NULL DEFAULT FALSE,
    calculado_en     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id_susc, id_region),
    CONSTRAINT susc_rango CHECK (susceptibilidad BETWEEN 0 AND 1)
) PARTITION BY LIST (id_region);

COMMENT ON COLUMN indicadores.susceptibilidad_inundacion.calibrado IS
    'FALSE cuando no hubo eventos históricos suficientes para validar. Se declara '
    'explícitamente en la interfaz: un índice no calibrado no se presenta como '
    'equivalente a uno validado.';

CREATE TABLE indicadores.urbano (
    id_urbano        BIGSERIAL    PRIMARY KEY,
    id_uv            INTEGER      NOT NULL REFERENCES territorio.unidad_vecinal(id_uv),
    anio             SMALLINT     NOT NULL,
    temp_superficial NUMERIC(5,2),                   -- °C
    ndvi             NUMERIC(5,4),
    area_verde_m2    NUMERIC(12,2),
    area_verde_hab   NUMERIC(8,2),
    calculado_en     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT urbano_ndvi_rango CHECK (ndvi IS NULL OR ndvi BETWEEN -1 AND 1)
);

-- =============================================================================
-- PROGRAMAS DE INVERSIÓN PÚBLICA
-- =============================================================================

CREATE TABLE programas.programa (
    id_programa      SMALLSERIAL  PRIMARY KEY,
    codigo           VARCHAR(20)  NOT NULL,          -- 'SIRSD-S'
    nombre           VARCHAR(200) NOT NULL,
    organismo        VARCHAR(60)  NOT NULL,          -- 'INDAP' | 'SAG'
    -- El SIRSD-S lo ejecutan DOS organismos: INDAP para la agricultura familiar
    -- campesina y SAG para medianos y grandes. El código por sí solo no identifica
    -- al programa; la unicidad es por la combinación.
    CONSTRAINT programa_unico UNIQUE (codigo, organismo)
);

CREATE TABLE programas.practica (
    id_practica      SMALLSERIAL  PRIMARY KEY,
    nombre           VARCHAR(160) NOT NULL,
    -- Factor RUSLE sobre el que actúa. Es el vínculo conceptual del proyecto.
    factor_rusle     CHAR(2)      NOT NULL,
    CONSTRAINT practica_factor_valido CHECK (factor_rusle IN ('C','P','K'))
);

CREATE TABLE programas.ejecucion (
    id_ejecucion     BIGSERIAL    PRIMARY KEY,
    id_programa      SMALLINT     NOT NULL REFERENCES programas.programa(id_programa),
    id_comuna        INTEGER      NOT NULL REFERENCES territorio.comuna(id_comuna),
    id_practica      SMALLINT     REFERENCES programas.practica(id_practica),
    anio             SMALLINT     NOT NULL,
    superficie_ha    NUMERIC(12,2),                  -- puede faltar: ver 'precision'
    monto_pesos      NUMERIC(15,0),
    beneficiarios    INTEGER,
    precision_dato   VARCHAR(20)  NOT NULL DEFAULT 'completa',
    fuente           VARCHAR(40)  NOT NULL,          -- 'entrega directa' | 'transparencia activa' | 'SAIP'
    cargado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ejecucion_precision_valida
        CHECK (precision_dato IN ('completa','reducida','sin informacion')),
    CONSTRAINT ejecucion_valores_no_negativos
        CHECK (COALESCE(superficie_ha,0) >= 0 AND COALESCE(monto_pesos,0) >= 0
               AND COALESCE(beneficiarios,0) >= 0)
);

CREATE INDEX ix_ejecucion_comuna_anio ON programas.ejecucion (id_comuna, anio);

COMMENT ON COLUMN programas.ejecucion.precision_dato IS
    'reducida = falta superficie bonificada, el indice se construye con monto y '
    'beneficiarios. Se declara en la interfaz, no se oculta.';

-- Registros que no se pudieron asociar a una comuna. No se descartan en silencio.
CREATE TABLE programas.ejecucion_rechazada (
    id_rechazo       BIGSERIAL    PRIMARY KEY,
    linea_origen     JSONB        NOT NULL,
    motivo           VARCHAR(200) NOT NULL,
    archivo          VARCHAR(260),
    detectado_en     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- =============================================================================
-- OPERACIÓN DEL NÚCLEO
-- =============================================================================

CREATE TABLE operacion.fuente (
    id_fuente        SMALLSERIAL  PRIMARY KEY,
    nombre           VARCHAR(160) NOT NULL,
    organismo        VARCHAR(80)  NOT NULL,
    tipo             VARCHAR(40)  NOT NULL,
    url_base         TEXT,
    estado           VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
    ultima_carga     TIMESTAMPTZ,
    CONSTRAINT fuente_estado_valido
        CHECK (estado IN ('ok','parcial','pendiente','error'))
);

CREATE TABLE operacion.ejecucion_proceso (
    id_proceso       BIGSERIAL    PRIMARY KEY,
    id_fuente        SMALLINT     REFERENCES operacion.fuente(id_fuente),
    id_region        SMALLINT     REFERENCES territorio.region(id_region),
    proceso          VARCHAR(120) NOT NULL,
    inicio           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    fin              TIMESTAMPTZ,
    estado           VARCHAR(20)  NOT NULL DEFAULT 'en curso',
    registros        INTEGER,
    mensaje          TEXT,
    CONSTRAINT proceso_estado_valido
        CHECK (estado IN ('en curso','ok','parcial','error'))
);

CREATE INDEX ix_proceso_inicio ON operacion.ejecucion_proceso (inicio DESC);

-- Cobertura raster: teselas normalizadas
CREATE TABLE operacion.cobertura_raster (
    id_cobertura     BIGSERIAL    PRIMARY KEY,
    id_region        SMALLINT     NOT NULL REFERENCES territorio.region(id_region),
    capa             VARCHAR(60)  NOT NULL,          -- 'srtm' | 'ndvi' | 'lst'
    fecha_captura    DATE,
    rast             raster       NOT NULL,
    cargado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX ix_cobertura_convex ON operacion.cobertura_raster
    USING GIST (ST_ConvexHull(rast));
CREATE INDEX ix_cobertura_capa ON operacion.cobertura_raster (id_region, capa);

-- =============================================================================
-- DATOS INICIALES
-- =============================================================================

INSERT INTO territorio.region (id_region, codigo, nombre, epsg_trabajo, extension) VALUES
(6, '06', 'Región del Libertador General Bernardo O''Higgins', 32719,
 ST_MakeEnvelope(-72.10, -35.05, -70.02, -33.85, 4326));

INSERT INTO programas.programa (codigo, nombre, organismo) VALUES
('SIRSD-S', 'Sistema de Incentivos para la Sustentabilidad Agroambiental de los Suelos Agropecuarios', 'INDAP'),
('SIRSD-S', 'Sistema de Incentivos para la Sustentabilidad Agroambiental de los Suelos Agropecuarios', 'SAG')
ON CONFLICT (codigo, organismo) DO NOTHING;

INSERT INTO programas.practica (nombre, factor_rusle) VALUES
('Establecimiento de cubierta vegetal',        'C'),
('Labranza mínima o cero laboreo',             'P'),
('Obras de conservación y curvas de nivel',    'P'),
('Enmiendas calcáreas',                        'K'),
('Fertilización fosforada',                    'K'),
('Eliminación de impedimentos físicos',        'P');

-- Partición de la región piloto
CREATE TABLE indicadores.erosion_r06
    PARTITION OF indicadores.erosion FOR VALUES IN (6);
CREATE TABLE indicadores.susceptibilidad_inundacion_r06
    PARTITION OF indicadores.susceptibilidad_inundacion FOR VALUES IN (6);

-- -----------------------------------------------------------------------------
-- Programación de tareas
-- La cadencia vive en la base, no en el código: cambiar cada cuánto corre una
-- ingesta es un UPDATE, no un despliegue.
-- -----------------------------------------------------------------------------

CREATE TABLE operacion.tarea_programada (
    id_tarea         SMALLSERIAL  PRIMARY KEY,
    codigo           VARCHAR(60)  NOT NULL UNIQUE,   -- 'ingesta.sentinel'
    descripcion      VARCHAR(200) NOT NULL,
    comando          VARCHAR(200) NOT NULL,          -- lo que se ejecuta
    cadencia         VARCHAR(20)  NOT NULL,
    dia_del_mes      SMALLINT,                       -- solo para cadencia mensual
    meses_validos    SMALLINT[],                     -- solo para cadencia estacional
    depende_de       VARCHAR(60) REFERENCES operacion.tarea_programada(codigo),
    activa           BOOLEAN      NOT NULL DEFAULT TRUE,
    ultima_ejecucion TIMESTAMPTZ,
    ultimo_estado    VARCHAR(20),
    CONSTRAINT tarea_cadencia_valida CHECK (cadencia IN
        ('unica','semanal','mensual','estacional','trimestral','anual','manual')),
    CONSTRAINT tarea_dia_valido CHECK (dia_del_mes IS NULL OR dia_del_mes BETWEEN 1 AND 28)
);

COMMENT ON COLUMN operacion.tarea_programada.depende_de IS
    'Si la tarea de la que depende falla, esta no se ejecuta y queda pendiente '
    'para el ciclo siguiente. Asi el indice nunca se calcula sobre datos a medias.';

COMMENT ON COLUMN operacion.tarea_programada.dia_del_mes IS
    'Limitado a 28 para que exista en todos los meses, febrero incluido.';

-- El comando es el que se invoca tal cual, sin shell: tiene que coincidir con
-- un modulo que exista y con las banderas que ese modulo acepta. Una tarea que
-- apunta a un modulo inexistente falla cada hora sin que nadie lo mire; una que
-- omite --guardar es peor, porque termina en 'ok' y no escribe nada.
--
-- Las tareas de los modulos 2 y 3 entran DESACTIVADAS: el indicador esta
-- especificado y el modulo todavia no. Se activan cuando exista que ejecutar.

INSERT INTO operacion.tarea_programada
       (codigo, descripcion, comando, cadencia, dia_del_mes, meses_validos, depende_de, activa) VALUES

-- Linea base y territorio
('ingesta.limites',       'Limites comunales desde IDE Chile',
 'python -m ingesta.vectorial --tabla territorio.comuna_cruda comunas.shp',
                                          'anual',      NULL, NULL, NULL, false),
('ingesta.ciren',         'Inventario Nacional de Erosion (WFS de CIREN)',
 'python -m ingesta.ciren',               'anual',      NULL, NULL, NULL, true),

-- Los cinco factores de RUSLE. Sin ellos no hay nada que multiplicar.
('ingesta.cr2met',        'Factor R — erosividad de la lluvia (CR2MET)',
 'python -m ingesta.cr2met --guardar',     'anual',     NULL, NULL, NULL, true),
('ingesta.soilgrids',     'Factor K — erodabilidad del suelo (SoilGrids)',
 'python -m ingesta.soilgrids --guardar',  'anual',     NULL, NULL, NULL, true),
('ingesta.nasadem',       'Modelo de elevacion NASADEM',
 'python -m ingesta.srtm --preparar --cargar',
                                           'unica',     NULL, NULL, NULL, true),
('ingesta.zonal_ls',      'Factor LS — topografia sobre el DEM reproyectado',
 'python -m ingesta.zonal --raster /datos/srtm/dem_utm.tif --factor ls --guardar',
                                           'unica',     NULL, NULL, 'ingesta.nasadem', true),
('ingesta.sentinel',      'Factor C — NDVI de Sentinel-2',
 'python -m ingesta.sentinel --guardar',   'mensual',      5, NULL, NULL, true),
('ingesta.transparencia', 'Ejecucion del SIRSD-S desde IDE MINAGRI',
 'python -m ingesta.sirsd_ide',            'mensual',     10, NULL, NULL, true),
('ingesta.practicas',     'Factor P — practicas de conservacion (SIRSD-S)',
 'python -m ingesta.practicas --guardar',  'mensual',     11, NULL, 'ingesta.transparencia', true),

-- Calculo propio. La pertinencia NO va aqui: es una vista, se calcula en cada
-- consulta, y programarla sugeria un paso por lote que no existe.
('indicadores.erosion',   'Calculo de erosion con RUSLE',
 'python -m calcular',                     'mensual',     12, NULL, 'ingesta.sentinel', true),

-- Modulos 2 y 3: aun sin modulo que ejecutar.
('ingesta.senapred',      'Eventos historicos de inundacion',
 'python -m ingesta.senapred',             'semanal',   NULL, NULL, NULL, false),
('indicadores.inundacion','Susceptibilidad a inundacion',
 'python -m indicadores.inundacion',       'trimestral',NULL, NULL, 'ingesta.nasadem', false),
('ingesta.landsat',       'Banda termica de verano',
 'python -m ingesta.landsat',              'estacional',NULL, '{1,2}', NULL, false);

-- =============================================================================
-- VISTA: índice de pertinencia
-- Se calcula EN CONSULTA, no se almacena. Así el alcance de comparación
-- (regional o nacional) es una decisión de quien consulta.
-- =============================================================================

-- El origen NO se filtra aquí. Antes esta vista exigía origen = 'TerraFoco', lo
-- que dejaba el índice en cero hasta tener el cálculo propio de RUSLE — es
-- decir, hasta después de resolver descargas satelitales. Al conservar el
-- origen como columna, la línea base de CIREN produce el índice desde el primer
-- día y el cálculo propio pasa a ser una mejora, no un prerrequisito.
-- Como beneficio adicional, ambos orígenes conviven y se pueden comparar: eso
-- es exactamente el caso de uso UC-06.
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
