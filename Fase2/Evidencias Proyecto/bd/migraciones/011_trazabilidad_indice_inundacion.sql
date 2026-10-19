-- =============================================================================
-- 011 — El indice de inundacion guarda con que se calculo
--
-- La recalibracion cambio los pesos y la forma de clasificar. Sin registrar
-- ambos en cada fila, dos versiones del indice con numeros distintos no se
-- podrian explicar. Es la misma disciplina que indicadores.factor.detalle.
-- =============================================================================

ALTER TABLE indicadores.susceptibilidad_inundacion
    ADD COLUMN IF NOT EXISTS pesos  JSONB,
    ADD COLUMN IF NOT EXISTS metodo VARCHAR(60),
    ADD COLUMN IF NOT EXISTS fraccion_alta NUMERIC(4,3);

COMMENT ON COLUMN indicadores.susceptibilidad_inundacion.pesos IS
    'Pesos por variable con los que se calculo esta fila, en porcentaje.';
COMMENT ON COLUMN indicadores.susceptibilidad_inundacion.metodo IS
    'Como se clasifico: p. ej. "cuartiles regionales" o "intervalos iguales".';
COMMENT ON COLUMN indicadores.susceptibilidad_inundacion.fraccion_alta IS
    'Fraccion del territorio comunal en las dos clases superiores del pixel.';

-- Con los pesos calibrados las medias comunales caen entre 0,34 y 0,38 y se
-- separan en la cuarta cifra. Tres decimales creaban empates que borraban el
-- orden: el Spearman bajaba de 0,41 a 0,37 solo por redondeo.
ALTER TABLE indicadores.susceptibilidad_inundacion
    ALTER COLUMN susceptibilidad TYPE NUMERIC(7,6);
