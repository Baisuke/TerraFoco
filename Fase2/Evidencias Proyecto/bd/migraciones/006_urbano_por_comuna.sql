-- =============================================================================
-- 006 — El indicador urbano admite escala comunal
--
-- indicadores.urbano se diseno para unidades vecinales, que es la escala a la
-- que el indicador de area verde por habitante tiene sentido. Pero las
-- unidades vecinales son una division municipal: no existe una capa nacional
-- publicada y su poblacion no es un dato publico. Conseguirlas exige gestion
-- con cada municipio.
--
-- La temperatura superficial (HU-18) no necesita esa escala: se mide sobre la
-- ciudad y se agrega por comuna. Bloquear todo el modulo 3 esperando las
-- unidades vecinales seria dejar sin entregar lo que ya se puede medir.
--
-- Entonces la tabla acepta las dos escalas y exige que cada fila declare cual
-- usa. Cuando lleguen las unidades vecinales, el indicador de area verde
-- entra por la otra via sin migrar nada.
--
-- Idempotente: se puede volver a correr.
-- =============================================================================

ALTER TABLE indicadores.urbano
    ALTER COLUMN id_uv DROP NOT NULL;

ALTER TABLE indicadores.urbano
    ADD COLUMN IF NOT EXISTS id_comuna      INTEGER
        REFERENCES territorio.comuna(id_comuna),
    ADD COLUMN IF NOT EXISTS temp_maxima    NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS temp_minima    NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS escenas_usadas SMALLINT,
    ADD COLUMN IF NOT EXISTS fuente         VARCHAR(60);

-- Una escala y solo una. Sin esta restriccion una fila podria quedar colgando
-- de las dos o de ninguna, y las consultas tendrian que adivinar cual vale.
ALTER TABLE indicadores.urbano
    DROP CONSTRAINT IF EXISTS urbano_una_escala;
ALTER TABLE indicadores.urbano
    ADD CONSTRAINT urbano_una_escala CHECK (
        (id_uv IS NOT NULL AND id_comuna IS NULL) OR
        (id_uv IS NULL AND id_comuna IS NOT NULL)
    );

-- La maxima no puede ser menor que la minima: atrapa una inversion de
-- columnas al guardar, que de otro modo pasa desapercibida.
ALTER TABLE indicadores.urbano
    DROP CONSTRAINT IF EXISTS urbano_rango_coherente;
ALTER TABLE indicadores.urbano
    ADD CONSTRAINT urbano_rango_coherente CHECK (
        temp_maxima IS NULL OR temp_minima IS NULL OR temp_maxima >= temp_minima
    );

CREATE INDEX IF NOT EXISTS ix_urbano_comuna
    ON indicadores.urbano (id_comuna, anio);

COMMENT ON TABLE indicadores.urbano IS
    'Indicadores del modulo urbano. Cada fila cuelga de una unidad vecinal o '
    'de una comuna, nunca de ambas: la temperatura se agrega por comuna y el '
    'area verde por habitante necesita la escala de unidad vecinal.';

COMMENT ON COLUMN indicadores.urbano.escenas_usadas IS
    'Cuantas pasadas satelitales se promediaron. Una sola trae huecos por '
    'nube y por el borde de la orbita; el numero permite juzgar el dato.';
