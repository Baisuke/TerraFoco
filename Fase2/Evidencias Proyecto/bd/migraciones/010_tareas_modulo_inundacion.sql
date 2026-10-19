-- =============================================================================
-- 010 — El planificador conoce el modulo de inundaciones
--
-- Las tareas del modulo 2 entraron desactivadas en la 005 porque no habia
-- modulo que ejecutar. Ahora lo hay: hidrologia, cauces, DesInventar y el
-- indice. Se activan y se encadenan por dependencia para que el indice no se
-- calcule sobre capas a medias.
--
-- `ingesta.senapred` se reemplaza por `ingesta.desinventar`: SENAPRED no
-- publica registro descargable y DesInventar es la fuente que existe.
-- =============================================================================

-- Sentinel entrega ademas el NDVI por pixel, que la cobertura del indice usa.
UPDATE operacion.tarea_programada
SET    comando = 'python -m ingesta.sentinel --guardar --raster-dir /datos/inundacion/ndvi'
WHERE  codigo = 'ingesta.sentinel';

INSERT INTO operacion.tarea_programada
       (codigo, descripcion, comando, cadencia, dia_del_mes, meses_validos, depende_de, activa) VALUES
('ingesta.hidrologia',   'Acumulacion de flujo, TWI, pendiente y curvatura del DEM',
 'python -m ingesta.hidrologia',          'unica',   NULL, NULL, 'ingesta.nasadem', true),
('ingesta.cauces',       'Red hidrica de IDE Chile y distancia a cauces',
 'python -m ingesta.cauces',              'anual',   NULL, NULL, 'ingesta.nasadem', true),
('ingesta.desinventar',  'Eventos historicos de inundacion (DesInventar)',
 'python -m ingesta.desinventar',         'anual',   NULL, NULL, NULL, true),
('mapa.inundacion',      'PNG de susceptibilidad por comuna para el visor',
 'python -m mapa_inundacion --png',       'trimestral', NULL, NULL, 'indicadores.inundacion', true)
ON CONFLICT (codigo) DO NOTHING;

UPDATE operacion.tarea_programada
SET    comando = 'python -m indicadores.inundacion',
       depende_de = 'ingesta.hidrologia',
       activa = true
WHERE  codigo = 'indicadores.inundacion';

-- Sin fuente que la alimente, mejor fuera que fallando cada semana.
DELETE FROM operacion.tarea_programada WHERE codigo = 'ingesta.senapred';
