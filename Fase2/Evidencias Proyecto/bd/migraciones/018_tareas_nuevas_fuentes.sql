-- =============================================================================
-- 018 — El programador conoce las fuentes y pasos nuevos
--
-- Desde la 010 entraron al sistema localidades, manzanas censales, servicios
-- críticos (OSM), el Censo 2024 y las áreas verdes, la superficie
-- erosionada y las variables del índice de inundación para el visor. Ninguno
-- tenía tarea: se cargaban a mano una vez y nadie los volvía a mirar.
--
-- Además, recalcular el índice de inundación lo deja "no calibrado"
-- (indicadores.inundacion escribe calibrado = FALSE) y nada lo volvía a
-- validar: tras el primer recálculo trimestral la pantalla habría dicho "no
-- calibrado" para siempre. Ahora la validación va en la cadena y marca el
-- índice solo si cumple el criterio declarado (--marcar-si-pasa).
--
-- Cadencias: lo que no cambia (censos) es 'unica'; OpenStreetMap cambia de
-- verdad mes a mes; el límite urbano, una vez al año por si el INE publica.
-- =============================================================================

INSERT INTO operacion.tarea_programada
       (codigo, descripcion, comando, cadencia, dia_del_mes, meses_validos, depende_de, activa) VALUES
('validar.inundacion',     'Validación del índice de inundación contra DesInventar (marca calibrado si pasa)',
 'python -m indicadores.validar_inundacion --marcar-si-pasa', 'trimestral', NULL, NULL, 'indicadores.inundacion', true),
('variables.inundacion',   'Variables normalizadas del índice para el visor (teselas y JSON)',
 'python -m variables_inundacion',                            'trimestral', NULL, NULL, 'validar.inundacion', true),
('ingesta.localidades',    'Ciudades y pueblos (Límite Urbano Censal 2017, INE)',
 'python -m ingesta.localidades',                             'anual',      NULL, NULL, NULL, true),
('ingesta.manzanas',       'Población por manzana, Censo 2017 (INE)',
 'python -m ingesta.manzanas',                                'unica',      NULL, NULL, NULL, true),
('ingesta.equipamiento',   'Servicios críticos de OpenStreetMap (educación, salud, emergencia)',
 'python -m ingesta.equipamiento',                            'mensual',    1,    NULL, NULL, true),
('ingesta.censo',          'Censo 2024: límite urbano, zonas censales y personas por manzana',
 'python -m ingesta.censo',                                   'unica',      NULL, NULL, NULL, true),
('ingesta.areas_verdes',   'Plazas y parques públicos de OpenStreetMap',
 'python -m ingesta.areas_verdes',                            'mensual',    1,    NULL, 'ingesta.censo', true),
('indicadores.area_verde', 'Déficit de áreas verdes por comuna y zona censal (SIEDU)',
 'python -m indicadores.area_verde',                          'mensual',    1,    NULL, 'ingesta.areas_verdes', true),
('indicadores.superficie_erosionada', 'Superficie con erosión severa o superior (denominador del índice)',
 'python -m indicadores.superficie_erosionada',               'mensual',    NULL, NULL, 'indicadores.erosion', true)
ON CONFLICT (codigo) DO NOTHING;

-- Los PNG del visor, después de validar: un mapa de un índice que no pasó
-- la validación no debería publicarse como el vigente.
UPDATE operacion.tarea_programada
SET    depende_de = 'validar.inundacion'
WHERE  codigo = 'mapa.inundacion' AND depende_de = 'indicadores.inundacion';
