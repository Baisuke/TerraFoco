-- =============================================================================
-- 002 — Tabla de factores calculados por comuna
--
-- Cada factor de RUSLE se calcula por separado, desde una fuente distinta y con
-- su propia cadencia: LS es practicamente estatico, C cambia cada temporada, R
-- es anual y P depende de la ejecucion del programa. Guardarlos en una sola
-- fila de `indicadores.erosion` obligaria a tener los cinco a la vez para poder
-- escribir cualquiera.
--
-- Con esta tabla cada proceso escribe lo suyo cuando lo tiene, y el calculo de
-- la perdida junta lo disponible. Ademas queda la trazabilidad: de que fuente
-- salio cada numero y cuando.
-- =============================================================================

CREATE TABLE IF NOT EXISTS indicadores.factor (
    id_factor    BIGSERIAL     PRIMARY KEY,
    id_region    SMALLINT      NOT NULL REFERENCES territorio.region(id_region),
    id_comuna    INTEGER       NOT NULL REFERENCES territorio.comuna(id_comuna),
    factor       VARCHAR(2)    NOT NULL,
    valor        NUMERIC(12,6) NOT NULL,
    anio         SMALLINT      NOT NULL,
    fuente       VARCHAR(60)   NOT NULL,
    -- Periodo, resolucion, pixeles utiles: lo que haga falta para auditar el
    -- numero sin volver a calcularlo.
    detalle      JSONB,
    calculado_en TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT factor_nombre_valido
        CHECK (factor IN ('R', 'K', 'LS', 'C', 'P')),
    -- Positivo, no solo no negativo: un factor en cero anula toda la ecuacion
    -- multiplicativa y dejaria la comuna en erosion nula.
    CONSTRAINT factor_positivo CHECK (valor > 0)
);

CREATE INDEX IF NOT EXISTS ix_factor_comuna
    ON indicadores.factor (id_comuna, factor, anio DESC, calculado_en DESC);

COMMENT ON TABLE indicadores.factor IS
    'Un factor de RUSLE por comuna y anio. Nunca se sobrescribe: cada recalculo '
    'inserta una version nueva y la mas reciente gana. El historico permite '
    'explicar por que cambio un indicador entre dos entregas.';

COMMENT ON COLUMN indicadores.factor.detalle IS
    'Procedencia del calculo: periodo de las imagenes, resolucion, celdas '
    'utiles. Sin esto, un valor raro obliga a rehacer todo para entenderlo.';
