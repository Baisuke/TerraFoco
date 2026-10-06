-- =============================================================================
-- 019 — Exposición para INDAP: superficie agrícola y población rural
--
-- La exposición del visor de inundaciones contaba personas urbanas, escuelas
-- y cuarteles (016). Para INDAP eso es lo secundario: sus usuarios son
-- agricultores y viven en el campo, que es justo lo que la manzana urbana
-- no cubre. Esta migración agrega:
--
-- territorio.unidad_censal — la población del Censo 2024 en sus tres
--   unidades: manzanas urbanas, manzanas de aldeas y entidades rurales
--   (caseríos, parcelas, fundos). En O'Higgins suman ~982 mil personas, la
--   región completa; la 016 cubría ~706 mil (solo urbano, Censo 2017).
--   Carga: python -m ingesta.poblacion_censal
--
-- indicadores.cobertura_agricola — hectáreas de cultivo y de pradera por
--   comuna (ESA WorldCover 10 m, CC BY 4.0) y cuántas quedan sobre el corte
--   de "Alta" del índice de inundación. El detalle por celda va en las
--   teselas `agricola`.  Carga: python -m ingesta.worldcover
-- =============================================================================

CREATE TABLE IF NOT EXISTS territorio.unidad_censal (
    id_unidad    BIGINT       PRIMARY KEY,          -- MANZENT o ID_ENTIDAD del INE
    id_comuna    INTEGER      NOT NULL REFERENCES territorio.comuna(id_comuna),
    anio         SMALLINT     NOT NULL,
    tipo         VARCHAR(20)  NOT NULL,             -- manzana_urbana, aldea, entidad_rural
    categoria    VARCHAR(40),                       -- Ciudad, Pueblo, Aldea, Caserío, Parcela-Hijuela...
    nombre       VARCHAR(120),
    personas     INTEGER      NOT NULL DEFAULT 0,
    viviendas    INTEGER      NOT NULL DEFAULT 0,
    geom         geometry(MultiPolygon, 4326) NOT NULL,
    cargado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT unidad_censal_tipo_valido
        CHECK (tipo IN ('manzana_urbana', 'aldea', 'entidad_rural'))
);

CREATE INDEX IF NOT EXISTS ix_unidad_censal_geom   ON territorio.unidad_censal USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_unidad_censal_comuna ON territorio.unidad_censal (id_comuna, tipo);

COMMENT ON TABLE territorio.unidad_censal IS
    'Población del Censo 2024 por manzana urbana, manzana de aldea y entidad rural (INE). '
    'Cubre la región completa, también el campo.';

CREATE TABLE IF NOT EXISTS indicadores.cobertura_agricola (
    id_comuna               INTEGER      NOT NULL REFERENCES territorio.comuna(id_comuna),
    id_region               SMALLINT     NOT NULL REFERENCES territorio.region(id_region),
    fuente                  VARCHAR(60)  NOT NULL,
    anio                    SMALLINT     NOT NULL,
    ha_evaluadas            NUMERIC(12,1),
    ha_cultivo              NUMERIC(12,1),
    ha_pradera              NUMERIC(12,1),
    ha_cultivo_susceptible  NUMERIC(12,1),
    ha_pradera_susceptible  NUMERIC(12,1),
    corte_susceptible       NUMERIC(6,4),               -- el corte de "Alta" con que se contó
    calculado_en            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id_comuna, anio)
);

COMMENT ON TABLE indicadores.cobertura_agricola IS
    'Hectáreas de cultivo (WorldCover 40) y pradera (30) por comuna, y cuántas sobre el corte '
    'de Alta del índice de inundación. Los frutales pueden caer en cobertura arbórea.';

INSERT INTO operacion.fuente (codigo, nombre, organismo, tipo, url_base, estado, nota) VALUES
('esa_worldcover', 'Cobertura del suelo ESA WorldCover 10 m (2021)',
 'Agencia Espacial Europea', 'Raster COG',
 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/',
 'ok',
 'Cultivo y pradera por celda de 30 m para la exposición agrícola a inundación. CC BY 4.0.')
ON CONFLICT (codigo) DO UPDATE SET
    nombre = EXCLUDED.nombre, organismo = EXCLUDED.organismo, tipo = EXCLUDED.tipo,
    url_base = EXCLUDED.url_base, nota = EXCLUDED.nota;

INSERT INTO operacion.tarea_programada
       (codigo, descripcion, comando, cadencia, dia_del_mes, meses_validos, depende_de, activa) VALUES
('ingesta.poblacion_censal', 'Población del Censo 2024 urbana y rural (manzanas, aldeas, entidades)',
 'python -m ingesta.poblacion_censal', 'unica', NULL, NULL, 'ingesta.censo', true),
('ingesta.worldcover',       'Superficie agrícola ESA WorldCover y su exposición a inundación',
 'python -m ingesta.worldcover',       'trimestral', NULL, NULL, 'validar.inundacion', true)
ON CONFLICT (codigo) DO NOTHING;
