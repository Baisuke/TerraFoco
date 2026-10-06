-- =============================================================================
-- 003 — Dominio de validez del cálculo propio
--
-- La validación contra CIREN mostró que el modelo NO funciona igual en toda la
-- región. Sobre 27 de las 33 comunas la correlación de rangos es 0,668 y las
-- magnitudes caen dentro de un factor de 1,5. En las seis precordilleranas
-- —Machalí, San Fernando, Mostazal, Requínoa, Codegua y Rengo— sobreestima
-- entre 20 y 300 veces.
--
-- La causa es identificable: la ecuación de erosividad de Renard & Freimund
-- está calibrada con datos de Estados Unidos y su rama cuadrática crece
-- demasiado rápido sobre los 850 mm anuales. Las seis comparten el mismo
-- perfil: R sobre 2.200 y LS sobre 4.
--
-- No se ocultan esas comunas: se MARCAN. Un modelo con dominio de validez
-- declarado vale más que uno que aparenta funcionar en todas partes, y quien
-- consulte debe poder ver el dato y saber que está fuera de rango.
-- =============================================================================

ALTER TABLE indicadores.erosion
    ADD COLUMN IF NOT EXISTS en_dominio BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN indicadores.erosion.en_dominio IS
    'false = la comuna queda fuera del dominio de validez del modelo propio '
    '(precordillera: erosividad sobre el umbral calibrado). El valor se '
    'calcula y se guarda igual, pero no debe compararse con la linea base ni '
    'usarse para focalizar sin advertencia explicita.';

-- La linea base de CIREN siempre esta en dominio: es el dato de referencia.
UPDATE indicadores.erosion SET en_dominio = true WHERE origen = 'CIREN';
