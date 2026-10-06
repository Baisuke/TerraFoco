-- =============================================================================
-- 016 — Qué hay expuesto: personas por manzana y equipamiento crítico
--
-- El índice dice qué terreno es susceptible. La pregunta de quien planifica
-- es otra: cuánta gente y qué escuelas, postas y cuarteles quedan sobre ese
-- terreno. El visor de inundaciones la responde cruzando la grilla de 30 m
-- de la comuna abierta con estas dos capas, en el navegador, para que siga
-- al umbral que la persona mueve.
--
-- territorio.manzana — población y viviendas por manzana del Censo 2017
--   (INE), copia nacional del Centro de Datos del Observatorio de Ciudades
--   UC. Solo el área urbana: la manzana es la unidad censal de las ciudades
--   y pueblos. En O'Higgins cubre unas 706 mil de las 914 mil personas; la
--   población rural no tiene aquí dónde ubicarse y el visor lo declara.
--   Carga: python -m ingesta.manzanas
--
-- territorio.equipamiento — escuelas, jardines, centros de salud, bomberos y
--   policía de OpenStreetMap (ODbL, © colaboradores de OpenStreetMap), por
--   la API Overpass. Es cartografía colaborativa: completa en las ciudades,
--   con huecos en lo rural. Carga: python -m ingesta.equipamiento
-- =============================================================================

CREATE TABLE IF NOT EXISTS territorio.manzana (
    id_manzana   SERIAL        PRIMARY KEY,
    id_comuna    INTEGER       NOT NULL REFERENCES territorio.comuna(id_comuna),
    manzent      VARCHAR(20)   NOT NULL,            -- código censal de la manzana
    categoria    VARCHAR(10),                       -- ciudad o pueblo
    personas     INTEGER       NOT NULL DEFAULT 0,
    viviendas    INTEGER       NOT NULL DEFAULT 0,
    geom         geometry(MultiPolygon, 4326) NOT NULL,
    CONSTRAINT manzana_unica UNIQUE (manzent)
);

CREATE INDEX IF NOT EXISTS ix_manzana_geom   ON territorio.manzana USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_manzana_comuna ON territorio.manzana (id_comuna);

COMMENT ON TABLE territorio.manzana IS
    'Población y viviendas por manzana, Censo 2017 (INE, copia OCUC). Solo área urbana.';

CREATE TABLE IF NOT EXISTS territorio.equipamiento (
    id_equipamiento SERIAL       PRIMARY KEY,
    id_comuna       INTEGER      REFERENCES territorio.comuna(id_comuna),
    osm_tipo        VARCHAR(8)   NOT NULL,          -- node, way, relation
    osm_id          BIGINT       NOT NULL,
    categoria       VARCHAR(20)  NOT NULL,          -- educacion, salud, emergencia
    tipo            VARCHAR(30)  NOT NULL,          -- school, hospital, fire_station...
    nombre          VARCHAR(200),
    geom            geometry(Point, 4326) NOT NULL,
    cargado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT equipamiento_unico UNIQUE (osm_tipo, osm_id),
    CONSTRAINT equipamiento_categoria_valida
        CHECK (categoria IN ('educacion', 'salud', 'emergencia'))
);

CREATE INDEX IF NOT EXISTS ix_equipamiento_geom   ON territorio.equipamiento USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_equipamiento_comuna ON territorio.equipamiento (id_comuna);

COMMENT ON TABLE territorio.equipamiento IS
    'Equipamiento crítico de OpenStreetMap (ODbL): educación, salud y emergencia. '
    'Un punto por elemento; los edificios y recintos se representan por su centro.';

INSERT INTO operacion.fuente (codigo, nombre, organismo, tipo, url_base, estado, nota) VALUES
('ine_manzanas', 'Población por manzana, Censo 2017',
 'INE · copia del Observatorio de Ciudades UC', 'Vectorial ArcGIS',
 'https://services9.arcgis.com/kKJR3Qt68ohAWuet/arcgis/rest/services/Manzanas_censo_2017/FeatureServer',
 'ok',
 'Personas y viviendas por manzana urbana. Sin población rural: la manzana es la unidad censal urbana.'),
('osm_equipamiento', 'Equipamiento crítico (educación, salud, emergencia)',
 'OpenStreetMap', 'API Overpass',
 'https://overpass-api.de/api/interpreter',
 'ok',
 'Escuelas, jardines, hospitales, clínicas, consultorios, bomberos y policía. ODbL, © colaboradores de OpenStreetMap.')
ON CONFLICT (codigo) DO UPDATE SET
    nombre    = EXCLUDED.nombre,
    organismo = EXCLUDED.organismo,
    tipo      = EXCLUDED.tipo,
    url_base  = EXCLUDED.url_base,
    nota      = EXCLUDED.nota;
-- Como en la 012 y la 015, el estado queda fuera del DO UPDATE.
