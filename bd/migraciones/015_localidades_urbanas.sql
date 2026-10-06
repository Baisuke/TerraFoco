-- =============================================================================
-- 015 — Ciudades y pueblos de la región
--
-- territorio.ciudad existe desde el esquema inicial y nunca se llenó: ningún
-- cargador escribía en ella. El visor de inundaciones necesita saber qué
-- ciudades y pueblos hay dentro de una comuna para responder la pregunta que
-- de verdad importa —qué sector de qué localidad corre más riesgo—, y no
-- solo el promedio de la comuna, que mezcla cerro, valle y ciudad.
--
-- La fuente es el Límite Urbano Censal 2017 del INE: el área urbana de cada
-- ciudad y pueblo según el Censo. El INE ya no publica el servicio que
-- enlaza su portal (el ítem de ArcGIS Online fue retirado); se usa la copia
-- nacional del Centro de Datos del Observatorio de Ciudades UC, que declara
-- al INE como fuente original. Licencia CC BY-NC 4.0: uso no comercial con
-- atribución a ambos. Se probó otro servicio con la cartografía censal
-- completa y solo traía Atacama.
--
-- Carga: python -m ingesta.localidades   (en terrafoco-motor)
-- =============================================================================

ALTER TABLE territorio.ciudad
    ADD COLUMN IF NOT EXISTS categoria VARCHAR(20),
    ADD COLUMN IF NOT EXISTS tipo      VARCHAR(30),
    ADD COLUMN IF NOT EXISTS fuente    VARCHAR(80);

COMMENT ON COLUMN territorio.ciudad.categoria IS
    'Categoría censal del INE en el Límite Urbano Censal 2017: ciudad o pueblo.';
COMMENT ON COLUMN territorio.ciudad.tipo IS
    'capital regional, capital provincial, capital comunal o urbano.';

CREATE INDEX IF NOT EXISTS ix_ciudad_geom   ON territorio.ciudad USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_ciudad_comuna ON territorio.ciudad (id_comuna);

INSERT INTO operacion.fuente (codigo, nombre, organismo, tipo, url_base, estado, nota) VALUES
('ine_luc', 'Límite Urbano Censal 2017 — ciudades y pueblos',
 'INE · copia del Observatorio de Ciudades UC', 'Vectorial ArcGIS',
 'https://services9.arcgis.com/kKJR3Qt68ohAWuet/arcgis/rest/services/LUC_2017/FeatureServer',
 'ok',
 'Área urbana de cada ciudad y pueblo según el Censo 2017. CC BY-NC 4.0: uso no comercial con atribución a INE y OCUC.')
ON CONFLICT (codigo) DO UPDATE SET
    nombre    = EXCLUDED.nombre,
    organismo = EXCLUDED.organismo,
    tipo      = EXCLUDED.tipo,
    url_base  = EXCLUDED.url_base,
    nota      = EXCLUDED.nota;
-- Como en la 012, el estado queda fuera del DO UPDATE: lo cambia una persona
-- desde el panel de fuentes.
