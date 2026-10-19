-- =============================================================================
-- 008 — Red hidrica de IDE Chile
--
-- Cartografia de la red hidrica a 1:25.000 del grupo de trabajo de
-- hidrografia de IDE Chile (2021), que cubre de Arica a O'Higgins. Se
-- descarga por WFS al bbox de la region, igual que las comunas y CIREN:
-- publico, sin credenciales.
--
-- Trae el orden de Strahler, y eso es lo que la hace util: permite separar
-- el Rapel de una quebrada de ladera. La distancia a cauces del indice de
-- inundacion se calcula sobre un umbral de orden, no sobre toda la red.
-- =============================================================================

CREATE TABLE IF NOT EXISTS territorio.cauce (
    id_cauce     SERIAL        PRIMARY KEY,
    id_region    SMALLINT      NOT NULL REFERENCES territorio.region(id_region),
    nombre       VARCHAR(120),
    tipo         VARCHAR(30),                       -- Rio, Estero, Quebrada...
    strahler     SMALLINT,                          -- orden de la red
    cod_cuenca   VARCHAR(10),
    nom_cuenca   VARCHAR(120),
    nom_subsubc  VARCHAR(160),
    longitud_m   NUMERIC(12,2),
    geom         geometry(MultiLineString, 4326) NOT NULL,
    cargado_en   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cauce_geom     ON territorio.cauce USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_cauce_strahler ON territorio.cauce (id_region, strahler);

COMMENT ON TABLE territorio.cauce IS
    'Red hidrica de IDE Chile, 1:25.000, recortada al bbox de la region. '
    'El orden de Strahler es lo que la hace util: la distancia a cauces del '
    'indice de inundacion se calcula sobre un umbral de orden, no sobre todo.';
