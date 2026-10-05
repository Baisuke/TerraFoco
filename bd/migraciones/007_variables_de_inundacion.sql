-- =============================================================================
-- 007 — Variables del indice de susceptibilidad a inundacion, por comuna
--
-- El modulo 2 combina seis variables con pesos: pendiente, acumulacion de
-- flujo, distancia a cauces, indice topografico de humedad, curvatura y
-- cobertura del suelo. Cada una sale de una fuente distinta y se calcula por
-- separado, igual que los factores de RUSLE. La tabla copia la forma de
-- indicadores.factor por la misma razon que aquella existe: cada proceso
-- escribe lo suyo cuando lo tiene, nada se sobrescribe, y queda de donde
-- salio cada numero.
--
-- Dos diferencias deliberadas con indicadores.factor:
--
--   * El nombre no cabe en dos letras. VARCHAR(20).
--   * NO hay CHECK (valor > 0). En RUSLE un factor en cero anula el producto
--     y por eso alli se rechaza; aqui el modelo es aditivo y el signo tiene
--     significado. La curvatura es negativa en las concavidades, que es
--     exactamente donde el agua se junta. Rechazar negativos borraria la
--     senal que se busca.
-- =============================================================================

CREATE TABLE IF NOT EXISTS indicadores.variable_inundacion (
    id_variable  BIGSERIAL     PRIMARY KEY,
    id_region    SMALLINT      NOT NULL REFERENCES territorio.region(id_region),
    id_comuna    INTEGER       NOT NULL REFERENCES territorio.comuna(id_comuna),
    variable     VARCHAR(20)   NOT NULL,
    valor        NUMERIC(14,6) NOT NULL,
    anio         SMALLINT      NOT NULL,
    fuente       VARCHAR(60)   NOT NULL,
    detalle      JSONB,
    calculado_en TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT variable_inundacion_nombre_valido
        CHECK (variable IN ('pendiente', 'acumulacion', 'distancia_cauces',
                            'twi', 'curvatura', 'cobertura'))
);

CREATE INDEX IF NOT EXISTS ix_variable_inundacion_comuna
    ON indicadores.variable_inundacion
       (id_comuna, variable, anio DESC, calculado_en DESC);

COMMENT ON TABLE indicadores.variable_inundacion IS
    'Una variable del indice de susceptibilidad a inundacion por comuna y anio. '
    'Misma disciplina que indicadores.factor: nunca se sobrescribe, la version '
    'mas reciente gana. Sin restriccion de signo: el modelo es aditivo y la '
    'curvatura negativa es senal, no error.';

COMMENT ON COLUMN indicadores.variable_inundacion.detalle IS
    'Procedencia: raster de origen, resolucion, celdas utiles, transformacion '
    'aplicada (p. ej. log10 en la acumulacion de flujo).';
