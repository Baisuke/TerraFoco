-- =============================================================================
-- 014 — Áreas verdes públicas y población urbana (módulo 3, HU-19, RF-25)
--
-- El objetivo específico 7 del proyecto pide "un indicador de déficit de
-- áreas verdes", y la pantalla de Ciudades lo mostraba con datos de ejemplo
-- por unidad vecinal, porque ese catastro lo tiene cada municipio y no se
-- consiguió. Esta migración lo resuelve con dos fuentes públicas:
--
--   · Censo 2024 (INE): límite urbano, zonas censales y personas por
--     manzana. La zona censal reemplaza a la unidad vecinal: es la unidad
--     oficial más fina con población publicada.
--   · OpenStreetMap: plazas, parques, jardines, áreas recreativas y pasto
--     público. Con esas etiquetas Rancagua da 8,5 m²/hab, dentro del rango
--     que el SIEDU publica con el catastro municipal (8 a 9 m²/hab).
--
-- Los estándares son los del SIEDU (INE / CNDU):
--   · 10 m² de área verde pública por habitante;
--   · una plaza (450 m² a 2 ha) a no más de 400 m;
--   · un parque (2 ha o más) a no más de 3 km.
--
-- Las geometrías se guardan en 4326, como el resto de territorio, y además en
-- 32719 como columna generada: las distancias y las áreas se miden en metros
-- y transformar en cada consulta hacía lentos los cruces de 11.000 manzanas.
-- =============================================================================

-- --- Censo 2024 -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS territorio.limite_urbano (
    id_limite    SERIAL        PRIMARY KEY,
    id_comuna    INTEGER       NOT NULL REFERENCES territorio.comuna(id_comuna),
    localidad    VARCHAR(120),
    categoria    VARCHAR(30),                       -- Ciudad, Pueblo...
    conurbacion  VARCHAR(120),                      -- la del INE, si la hay
    personas     INTEGER,
    geom         geometry(MultiPolygon, 4326) NOT NULL,
    geom_utm     geometry(MultiPolygon, 32719)
                 GENERATED ALWAYS AS (ST_Transform(geom, 32719)) STORED,
    cargado_en   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_limite_urbano_utm ON territorio.limite_urbano USING GIST (geom_utm);

CREATE TABLE IF NOT EXISTS territorio.zona_censal (
    id_zona      BIGINT        PRIMARY KEY,         -- ID_ZONA del INE
    id_comuna    INTEGER       NOT NULL REFERENCES territorio.comuna(id_comuna),
    cod_zona     INTEGER       NOT NULL,
    localidad    VARCHAR(120),
    personas     INTEGER,
    geom         geometry(MultiPolygon, 4326) NOT NULL,
    geom_utm     geometry(MultiPolygon, 32719)
                 GENERATED ALWAYS AS (ST_Transform(geom, 32719)) STORED,
    cargado_en   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_zona_censal_utm ON territorio.zona_censal USING GIST (geom_utm);

-- Solo manzanas urbanas: el estándar es urbano, y en el área rural la
-- "manzana" es una entidad de varios kilómetros sin plazas que medir.
CREATE TABLE IF NOT EXISTS territorio.manzana_censal (
    id_manzana   BIGINT        PRIMARY KEY,         -- MANZENT del INE
    id_comuna    INTEGER       NOT NULL REFERENCES territorio.comuna(id_comuna),
    id_zona      BIGINT        REFERENCES territorio.zona_censal(id_zona),
    personas     INTEGER       NOT NULL DEFAULT 0 CHECK (personas >= 0),
    geom         geometry(MultiPolygon, 4326) NOT NULL,
    punto_utm    geometry(Point, 32719)
                 GENERATED ALWAYS AS (ST_PointOnSurface(ST_Transform(geom, 32719))) STORED,
    cargado_en   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_manzana_punto ON territorio.manzana_censal USING GIST (punto_utm);
CREATE INDEX IF NOT EXISTS ix_manzana_zona  ON territorio.manzana_censal (id_zona);

-- --- Áreas verdes públicas ---------------------------------------------------

-- Una fila por área continua, ya disuelta y recortada al límite urbano: una
-- plaza dibujada como "park" con un "grass" encima cuenta una vez.
CREATE TABLE IF NOT EXISTS territorio.area_verde (
    id_area      SERIAL        PRIMARY KEY,
    id_comuna    INTEGER       NOT NULL REFERENCES territorio.comuna(id_comuna),
    tipo         VARCHAR(10)   NOT NULL CHECK (tipo IN ('plaza', 'parque')),
    nombre       VARCHAR(160),
    area_m2      NUMERIC(12,1) NOT NULL CHECK (area_m2 >= 450),
    -- Bandejones y platabandas: cuentan en los m² por habitante, como en los
    -- catastros municipales, pero no como plaza a la que se va caminando.
    solo_pasto   BOOLEAN       NOT NULL DEFAULT false,
    osm_ids      TEXT,                              -- trazabilidad: way/123,relation/45
    geom         geometry(MultiPolygon, 4326) NOT NULL,
    geom_utm     geometry(MultiPolygon, 32719)
                 GENERATED ALWAYS AS (ST_Transform(geom, 32719)) STORED,
    fecha_osm    DATE,
    cargado_en   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_area_verde_utm ON territorio.area_verde USING GIST (geom_utm);

-- --- El indicador ------------------------------------------------------------

-- Por comuna (su área urbana) y por zona censal urbana. Una sola tabla con
-- la escala como columna, igual que indicadores.urbano.
CREATE TABLE IF NOT EXISTS indicadores.area_verde (
    id             BIGSERIAL     PRIMARY KEY,
    escala         VARCHAR(10)   NOT NULL CHECK (escala IN ('comuna', 'zona')),
    id_comuna      INTEGER       NOT NULL REFERENCES territorio.comuna(id_comuna),
    id_zona        BIGINT        REFERENCES territorio.zona_censal(id_zona),
    personas       INTEGER       NOT NULL,
    area_verde_m2  NUMERIC(12,1) NOT NULL,
    m2_hab         NUMERIC(8,2),
    deficit_m2     NUMERIC(12,1),                   -- lo que falta para 10 m²/hab
    pob_plaza_400  INTEGER,                         -- personas con plaza a <= 400 m
    pob_parque_3km INTEGER,                         -- personas con parque a <= 3 km
    plazas         INTEGER,
    parques        INTEGER,
    anio_poblacion SMALLINT      NOT NULL,
    fecha_osm      DATE,
    calculado_en   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT area_verde_escala_coherente CHECK
        ((escala = 'zona') = (id_zona IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_ind_area_verde ON indicadores.area_verde (escala, id_comuna, calculado_en DESC);

-- --- Catálogo de fuentes -----------------------------------------------------

INSERT INTO operacion.fuente (codigo, nombre, organismo, tipo, url_base, estado, nota) VALUES
('ine_censo2024', 'Censo 2024 — cartografía y personas por manzana', 'INE', 'Vectorial GPKG',
 'https://storage.googleapis.com/bktdescargascenso2024/Cartografia/GPKG/', 'ok',
 'Límite urbano, zonas censales y personas por manzana urbana. Da la población del indicador de áreas verdes y reemplaza a la unidad vecinal, que no tiene catastro público.'),
('osm_areas_verdes', 'OpenStreetMap — plazas y parques', 'OpenStreetMap', 'Vectorial API',
 'https://overpass-api.de/api/interpreter', 'ok',
 'Áreas verdes públicas por Overpass, sin credenciales. Contrastado con el SIEDU: Rancagua 8,5 m²/hab contra 8 a 9 del catastro municipal.')
ON CONFLICT (codigo) DO NOTHING;
