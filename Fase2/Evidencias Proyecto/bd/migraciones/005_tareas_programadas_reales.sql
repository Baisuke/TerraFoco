-- =============================================================================
-- 005 — La programacion apunta a los modulos que existen
--
-- La tabla se sembro con los comandos previstos en el diseno, y el motor se
-- construyo despues con otros nombres y otras banderas. El planificador quedo
-- invocando modulos inexistentes: de nueve tareas vencidas, seis fallaban en
-- cada revision horaria.
--
-- Dos de esas fallas eran silenciosas y por eso peores. `ingesta.sentinel`
-- corria SIN --guardar: descargaba las escenas, calculaba el NDVI de las 33
-- comunas y descartaba el resultado. Terminaba en 'ok' y no escribia nada.
-- `ingesta.transparencia` apuntaba a un paquete `etl` que nunca existio.
--
-- Las tareas de los modulos 2 y 3 no se corrigen porque no hay nada que
-- corregir todavia: se desactivan. Una tarea activa que apunta a un modulo sin
-- escribir no es una tarea pendiente, es ruido que entrena al equipo a ignorar
-- los errores del planificador.
-- =============================================================================

-- --- Comandos corregidos, tareas que ya tienen modulo -----------------------

-- El cargador real de CIREN es su propio modulo y se descarga por WFS.
-- `ingesta.vectorial` exige un shapefile posicional y --tabla: nunca pudo
-- ejecutarse desatendido.
UPDATE operacion.tarea_programada
SET    comando     = 'python -m ingesta.ciren',
       descripcion = 'Inventario Nacional de Erosion (WFS de CIREN)'
WHERE  codigo = 'ingesta.ciren';

-- Sin --guardar el factor C se calcula y se tira. --preparar deja el
-- dem_utm.tif reproyectado que necesita el factor LS.
UPDATE operacion.tarea_programada
SET    comando = 'python -m ingesta.sentinel --guardar'
WHERE  codigo = 'ingesta.sentinel';

UPDATE operacion.tarea_programada
SET    comando = 'python -m ingesta.srtm --preparar --cargar'
WHERE  codigo = 'ingesta.nasadem';

-- El SIRSD-S resulto estar publicado como servicio en IDE MINAGRI, asi que la
-- via automatizable es esa y no las planillas de Transparencia.
UPDATE operacion.tarea_programada
SET    comando     = 'python -m ingesta.sirsd_ide',
       descripcion = 'Ejecucion del SIRSD-S desde IDE MINAGRI'
WHERE  codigo = 'ingesta.transparencia';

-- El calculo propio vive en la raiz del motor, no en el paquete indicadores.
UPDATE operacion.tarea_programada
SET    comando = 'python -m calcular'
WHERE  codigo = 'indicadores.erosion';

-- --- Tareas desactivadas ----------------------------------------------------

-- Modulos 2 y 3: el indicador esta especificado, el modulo no esta escrito.
-- Se corrige igual el comando para que una base migrada quede identica a una
-- creada desde esquema.sql, y para que activarlas sea cambiar un booleano.
UPDATE operacion.tarea_programada
SET    activa = false
WHERE  codigo IN ('ingesta.landsat', 'ingesta.senapred');

UPDATE operacion.tarea_programada
SET    comando = 'python -m indicadores.inundacion',
       activa  = false
WHERE  codigo = 'indicadores.inundacion';

-- Los limites comunales entran desde un shapefile descargado a mano; no hay
-- cargador desatendido y cambian una vez por decada.
UPDATE operacion.tarea_programada
SET    comando = 'python -m ingesta.vectorial --tabla territorio.comuna_cruda comunas.shp',
       activa  = false
WHERE  codigo = 'ingesta.limites';

-- La pertinencia es una VISTA: se calcula en cada consulta. No hay proceso por
-- lote que programar, y tenerlo aqui sugeria un paso que no existe. Se elimina
-- en vez de desactivarse porque no hay nada que activar despues.
DELETE FROM operacion.tarea_programada WHERE codigo = 'indicadores.pertinencia';

-- --- Factores que ya tienen modulo y no estaban programados -----------------
--
-- `indicadores.erosion` depende de que los cinco factores esten cargados, pero
-- solo C estaba en la tabla. Los otros cuatro se ejecutaban a mano, de modo que
-- el calculo automatico nunca habria tenido con que multiplicar.

INSERT INTO operacion.tarea_programada
       (codigo, descripcion, comando, cadencia, dia_del_mes, meses_validos, depende_de) VALUES
('ingesta.cr2met',    'Factor R — erosividad de la lluvia (CR2MET)',
 'python -m ingesta.cr2met --guardar',    'anual',   NULL, NULL, NULL),
('ingesta.soilgrids', 'Factor K — erodabilidad del suelo (SoilGrids)',
 'python -m ingesta.soilgrids --guardar', 'anual',   NULL, NULL, NULL),
('ingesta.practicas', 'Factor P — practicas de conservacion (SIRSD-S)',
 'python -m ingesta.practicas --guardar', 'mensual',   11, NULL, 'ingesta.transparencia'),
('ingesta.zonal_ls',  'Factor LS — topografia sobre el DEM reproyectado',
 'python -m ingesta.zonal --raster /datos/srtm/dem_utm.tif --factor ls --guardar',
                                          'unica',   NULL, NULL, 'ingesta.nasadem')
ON CONFLICT (codigo) DO NOTHING;
