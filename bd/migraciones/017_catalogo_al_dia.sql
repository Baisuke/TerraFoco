-- =============================================================================
-- 017 — El catálogo de fuentes dice lo que hay cargado
--
-- Tres fuentes seguían con la nota y el estado de cuando se sembró el
-- catálogo (012), aunque sus datos ya están en la base y el sistema los usa:
-- el panel general las listaba como "Pendiente" y la de SoilGrids decía
-- "Falta correrlo" al lado de "33 registros, cargada el 27-09". Para quien
-- mira el panel eso es una contradicción: no sabe a cuál creerle.
--
--   cr2met       el factor R de las 33 comunas (CR2MET v2.5, 2002-2021)
--   soilgrids    el factor K de las 33 comunas (SoilGrids 2.0)
--   indap_serie  la serie 2012-2025 de las 33 comunas (programas.sirsd_anual)
--
-- El estado es administrativo y lo cambia una persona (012): aquí solo se
-- corrige si sigue en el 'pendiente' de la siembra y el dato existe.
-- =============================================================================

UPDATE operacion.fuente
SET    nota = 'Precipitación media 2002-2021 de CR2MET v2.5: da el factor R (erosividad) de las 33 comunas.',
       estado = CASE WHEN estado = 'pendiente'
                      AND EXISTS (SELECT 1 FROM indicadores.factor WHERE factor = 'R')
                     THEN 'ok' ELSE estado END
WHERE  codigo = 'cr2met';

UPDATE operacion.fuente
SET    nota = 'Textura y carbono orgánico de SoilGrids 2.0: dan el factor K (erodabilidad) de las 33 comunas.',
       estado = CASE WHEN estado = 'pendiente'
                      AND EXISTS (SELECT 1 FROM indicadores.factor WHERE factor = 'K')
                     THEN 'ok' ELSE estado END
WHERE  codigo = 'soilgrids';

UPDATE operacion.fuente
SET    nota = 'Serie 2012-2025 de las 33 comunas, extraída de la base de INDAP y contrastada con la entrega oficial (docs/17-serie-sirsd.md).',
       estado = CASE WHEN estado = 'pendiente'
                      AND EXISTS (SELECT 1 FROM programas.sirsd_anual)
                     THEN 'ok' ELSE estado END
WHERE  codigo = 'indap_serie';
