-- =============================================================================
-- 009 — Eventos historicos de inundacion (DesInventar)
--
-- La unica fuente publica y estructurada de eventos de inundacion en Chile
-- resulto ser DesInventar (UNDRR), alimentada por ONEMI: 13.534 fichas de
-- 1970 a 2014, con comuna pero sin coordenadas. SENAPRED no publica registro
-- descargable, y datos.gob.cl no tiene nada de ONEMI sobre eventos.
--
-- Sirve para VALIDAR el indice de susceptibilidad —que fraccion de los
-- eventos cae en comunas Alta o Muy alta, el criterio de exito declarado— y
-- no para entrenar: con etiquetas a nivel comunal la muestra son 33 comunas.
--
-- Se guarda el nombre de comuna tal como viene, ademas del id emparejado:
-- DesInventar trae tipografias ("Donigue") y el emparejamiento debe poder
-- auditarse.
-- =============================================================================

CREATE TABLE IF NOT EXISTS indicadores.evento_inundacion (
    id_evento      SERIAL       PRIMARY KEY,
    id_region      SMALLINT     NOT NULL REFERENCES territorio.region(id_region),
    id_comuna      INTEGER      REFERENCES territorio.comuna(id_comuna),
    comuna_texto   VARCHAR(120),                    -- como viene en la fuente
    tipo           VARCHAR(40)  NOT NULL,           -- Inundacion, Aluvion
    causa          VARCHAR(120),
    lugar          VARCHAR(250),
    anio           SMALLINT     NOT NULL,
    mes            SMALLINT,
    dia            SMALLINT,
    muertos        INTEGER,
    afectados      INTEGER,
    damnificados   INTEGER,
    evacuados      INTEGER,
    viviendas_destruidas INTEGER,
    viviendas_afectadas  INTEGER,
    fuente_cita    VARCHAR(250),                    -- diario, pagina
    serial_fuente  VARCHAR(30)  NOT NULL UNIQUE,    -- serial de DesInventar
    cargado_en     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_evento_inundacion_comuna
    ON indicadores.evento_inundacion (id_region, id_comuna, anio);

COMMENT ON TABLE indicadores.evento_inundacion IS
    'Eventos historicos de inundacion y aluvion de DesInventar (UNDRR/ONEMI), '
    '1970-2014, a nivel comunal. Son la referencia contra la que se valida el '
    'indice de susceptibilidad; no sirven para entrenar. Reportados por prensa: '
    'sobrerrepresentan las comunas pobladas.';
