-- =============================================================================
-- 012 — El catalogo de fuentes deja de estar vacio
--
-- La tabla operacion.fuente existe desde el esquema inicial y nunca se
-- sembro: /fuentes devolvia una lista vacia y fuentes.html caia a los datos
-- de ejemplo de data.js —"48 teselas", "112 escenas", "14.882 poligonos",
-- SENAPRED con "41 eventos"—, todos inventados en la fase del prototipo no
-- funcional. SENAPRED ademas no publica ningun registro descargable: se
-- busco en cuatro fuentes y por eso los eventos salen de DesInventar.
--
-- Se siembran las fuentes que el motor usa de verdad, con su URL, y las que
-- estan pendientes con el motivo. El estado que se siembra es el
-- ADMINISTRATIVO —lo que una persona declara sobre la fuente—; cuando se
-- cargo por ultima vez y como termino sale de la bitacora, no de aqui.
--
-- El codigo es lo que une cada fuente con sus ejecuciones. La columna
-- id_fuente de ejecucion_proceso existia desde el inicio con su llave
-- foranea y ninguna de las 28 ejecuciones registradas la llenaba: la
-- bitacora y el catalogo vivian separados.
-- =============================================================================

ALTER TABLE operacion.fuente
    ADD COLUMN IF NOT EXISTS codigo VARCHAR(30),
    ADD COLUMN IF NOT EXISTS nota   VARCHAR(250);

-- Unico y no nulo, porque es la clave con la que el motor se identifica.
UPDATE operacion.fuente SET codigo = 'fuente-' || id_fuente WHERE codigo IS NULL;
ALTER TABLE operacion.fuente ALTER COLUMN codigo SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuente_codigo_unico') THEN
        ALTER TABLE operacion.fuente ADD CONSTRAINT fuente_codigo_unico UNIQUE (codigo);
    END IF;
END $$;

COMMENT ON COLUMN operacion.fuente.codigo IS
    'Identificador estable con el que el motor registra sus ejecuciones. '
    'Lo pasa Bitacora(fuente="...") y resuelve el id_fuente.';
COMMENT ON COLUMN operacion.fuente.estado IS
    'Estado ADMINISTRATIVO: lo declara una persona. Como termino la ultima '
    'carga sale de operacion.ejecucion_proceso, no de esta columna.';
COMMENT ON COLUMN operacion.fuente.nota IS
    'Por que una fuente esta pendiente, o que limitacion tiene. Sin esto, un '
    '"pendiente" no dice si falta gestion, credenciales o si no existe.';

INSERT INTO operacion.fuente (codigo, nombre, organismo, tipo, url_base, estado, nota) VALUES

-- --- En uso -----------------------------------------------------------------
('nasadem', 'NASADEM — modelo digital de elevación 30 m', 'NASA Earthdata', 'Raster 30 m',
 'https://urs.earthdata.nasa.gov', 'ok',
 'Reprocesamiento oficial del SRTM, con los vacíos rellenados. Base de cinco de las seis variables del módulo 2.'),

('ciren', 'Inventario Nacional de Erosión', 'CIREN', 'Vectorial WFS',
 'https://inventarioerosion.ciren.cl/geoserver/wfs', 'ok',
 'Línea base oficial contra la que se valida el cálculo propio. Cubre de Coquimbo a Los Lagos: es el límite de escalabilidad del módulo 1.'),

('sentinel2', 'Sentinel-2 — NDVI para el factor C', 'Copernicus / Sentinel Hub', 'Raster 10-60 m',
 'https://shapps.dataspace.copernicus.eu/dashboard', 'ok',
 'El NDVI se calcula en el servidor y se trae la estadística por comuna, en vez de descargar las escenas completas.'),

('sirsd_ide', 'SIRSD-S — ejecución del programa', 'IDE MINAGRI / INDAP', 'Servicio ArcGIS',
 'https://ide.minagri.gob.cl', 'parcial',
 'Cubre un solo año (2021) y 17 de las 33 comunas. La serie histórica sigue dependiendo de la gestión con INDAP.'),

('ide_limites', 'Límites comunales', 'IDE Chile', 'Vectorial',
 'https://www.geoportal.cl', 'ok',
 'Las 33 comunas de la región piloto. Se cargan desde la copia estática del prototipo: no hay cargador desatendido.'),

('ide_hidrografia', 'Red hídrica 1:25.000', 'IDE Chile', 'Vectorial WFS',
 'https://geoportal.cl/geoserver/Hidrografia/wfs', 'ok',
 'Trae el orden de Strahler, que permite separar los ríos principales de las quebradas de ladera.'),

('desinventar', 'Eventos históricos de desastre', 'DesInventar — UNDRR / ONEMI', 'Tabular XML',
 'https://www.desinventar.net/DesInventar/download_base.jsp?countrycode=chl', 'parcial',
 'Única fuente pública estructurada de eventos: 1970-2014, por comuna, sin coordenadas. Registros de prensa. Valida el índice; no sirve para entrenar.'),

('ecostress', 'ECOSTRESS — temperatura superficial', 'NASA Earthdata', 'Raster 70 m',
 'https://urs.earthdata.nasa.gov', 'ok',
 'Reemplaza a Landsat: va en la Estación Espacial y pasa a horas distintas, incluida la noche, cuando la isla de calor se manifiesta.'),

-- --- Con modulo escrito, sin cargar -----------------------------------------
('cr2met', 'CR2MET — precipitación para el factor R', 'CR2 — Universidad de Chile', 'NetCDF',
 'https://www.cr2.cl/datos-productos-grillados', 'pendiente',
 'El módulo existe (ingesta.cr2met). Falta descargar la serie.'),

('soilgrids', 'SoilGrids — propiedades del suelo para el factor K', 'ISRIC', 'API REST',
 'https://rest.isric.org', 'pendiente',
 'El módulo existe (ingesta.soilgrids). Falta correrlo.'),

-- --- Sin fuente disponible ---------------------------------------------------
('senapred', 'Registro de emergencias', 'SENAPRED', 'Sin descarga',
 'https://senapred.cl', 'pendiente',
 'No publica registro descargable y datos.gob.cl no tiene nada de ONEMI sobre eventos. Por eso los eventos salen de DesInventar.'),

('usgs_landsat', 'Landsat — banda térmica', 'USGS EarthExplorer', 'Raster 30 m',
 'https://ers.cr.usgs.gov/profile/access', 'pendiente',
 'La descarga masiva pasa por la interfaz M2M, que exige una aprobación que el proyecto no tiene. Se reemplazó por ECOSTRESS.'),

('indap_serie', 'SIRSD-S — serie histórica completa', 'INDAP', 'Entrega directa',
 NULL, 'pendiente',
 'Comprometida por el departamento de datos, en gestión. Respaldo: solicitud por transparencia.')

ON CONFLICT (codigo) DO UPDATE SET
    nombre    = EXCLUDED.nombre,
    organismo = EXCLUDED.organismo,
    tipo      = EXCLUDED.tipo,
    url_base  = EXCLUDED.url_base,
    nota      = EXCLUDED.nota;
-- El estado queda fuera del DO UPDATE a proposito: lo cambia una persona
-- desde el panel de fuentes, y reponerlo aqui desharia ese cambio cada vez
-- que se corriera la migracion.

-- --- Enlazar las ejecuciones ya registradas -----------------------------------
--
-- Reparacion unica: las ejecuciones anteriores a esta migracion quedaron con
-- id_fuente nulo porque nadie lo llenaba. El historial es real y sirve —dice
-- cuando se cargo cada fuente—, asi que se enlaza por el texto del proceso.
--
-- De aqui en adelante lo pone Bitacora(fuente="..."), no este UPDATE: emparejar
-- por texto es fragil y solo se justifica para lo ya escrito.
--
-- Hidrologia del DEM y el indice de susceptibilidad NO se enlazan a proposito:
-- son calculos derivados, no cargas desde una fuente externa. Su fuente es el
-- NASADEM que ya figura en su propia ejecucion.

UPDATE operacion.ejecucion_proceso e
SET    id_fuente = f.id_fuente
FROM   operacion.fuente f
WHERE  e.id_fuente IS NULL
  AND  f.codigo = CASE
         WHEN e.proceso LIKE 'Ingesta CIREN%'            THEN 'ciren'
         WHEN e.proceso LIKE 'Ingesta NASADEM%'          THEN 'nasadem'
         WHEN e.proceso LIKE 'Ingesta NDVI Sentinel-2%'  THEN 'sentinel2'
         WHEN e.proceso LIKE 'Ingesta SIRSD-S (IDE MINAGRI)%' THEN 'sirsd_ide'
         WHEN e.proceso LIKE 'Ingesta ECOSTRESS%'        THEN 'ecostress'
         WHEN e.proceso LIKE 'Red hídrica IDE Chile%'    THEN 'ide_hidrografia'
         WHEN e.proceso LIKE 'Eventos históricos DesInventar%' THEN 'desinventar'
       END;

-- La fecha administrativa del catalogo parte de la ultima carga real.
UPDATE operacion.fuente f
SET    ultima_carga = u.inicio
FROM   (SELECT DISTINCT ON (id_fuente) id_fuente, inicio
        FROM   operacion.ejecucion_proceso
        WHERE  id_fuente IS NOT NULL AND estado = 'ok'
        ORDER  BY id_fuente, inicio DESC) u
WHERE  f.id_fuente = u.id_fuente AND f.ultima_carga IS NULL;
