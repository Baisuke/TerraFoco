/* ==========================================================================
   TerraFoco — Prototipo no funcional
   Datos de ejemplo

   IMPORTANTE: todos los valores de este archivo son ILUSTRATIVOS. Fueron
   escritos a mano para poder mostrar las pantallas del prototipo. No provienen
   de un cálculo real ni de las fuentes oficiales. En la implementación estos
   datos vendrán del motor de procesamiento (SRTM, Sentinel-2, CIREN) y del
   ETL de Transparencia Activa de INDAP y SAG.

   La cartografía tampoco es real: el mapa usa una grilla esquemática que
   representa las 33 comunas de la Región de O'Higgins, no sus geometrías
   verdaderas.
   ========================================================================== */

const GT = {};

/* --------------------------------------------------------------------------
   Comunas — fila/columna en la grilla esquemática
   erosion   : pérdida de suelo estimada, t/ha/año
   sup       : superficie comunal, km²
   haBonif   : hectáreas bonificadas por SIRSD-S (acumulado 2015-2025)
   monto     : inversión acumulada, millones de pesos
   benef     : número de beneficiarios
   indice    : índice de pertinencia territorial (0 = cubierto, 1 = brecha total)
   -------------------------------------------------------------------------- */

GT.comunas = [
  // Provincia de Cardenal Caro — secano costero, la más erosionada
  { id: 'navidad',    nombre: 'Navidad',      prov: 'Cardenal Caro', r: 0, c: 1, sup: 300,  erosion: 31.6, haBonif: 214,  monto: 118, benef: 61,  indice: 0.71 },
  { id: 'litueche',   nombre: 'Litueche',     prov: 'Cardenal Caro', r: 1, c: 0, sup: 622,  erosion: 38.4, haBonif: 120,  monto: 64,  benef: 38,  indice: 0.91 },
  { id: 'la-estrella',nombre: 'La Estrella',  prov: 'Cardenal Caro', r: 1, c: 1, sup: 435,  erosion: 35.2, haBonif: 149,  monto: 79,  benef: 44,  indice: 0.84 },
  { id: 'pichilemu',  nombre: 'Pichilemu',    prov: 'Cardenal Caro', r: 2, c: 0, sup: 749,  erosion: 27.8, haBonif: 268,  monto: 141, benef: 87,  indice: 0.63 },
  { id: 'marchigue',  nombre: 'Marchigüe',    prov: 'Cardenal Caro', r: 2, c: 1, sup: 555,  erosion: 36.9, haBonif: 137,  monto: 71,  benef: 41,  indice: 0.87 },
  { id: 'paredones',  nombre: 'Paredones',    prov: 'Cardenal Caro', r: 3, c: 0, sup: 562,  erosion: 33.1, haBonif: 182,  monto: 96,  benef: 55,  indice: 0.76 },

  // Provincia de Colchagua
  { id: 'lolol',      nombre: 'Lolol',        prov: 'Colchagua', r: 4, c: 0, sup: 602,  erosion: 29.4, haBonif: 231,  monto: 122, benef: 68,  indice: 0.68 },
  { id: 'pumanque',   nombre: 'Pumanque',     prov: 'Colchagua', r: 3, c: 1, sup: 447,  erosion: 32.7, haBonif: 176,  monto: 93,  benef: 49,  indice: 0.79 },
  { id: 'peralillo',  nombre: 'Peralillo',    prov: 'Colchagua', r: 4, c: 1, sup: 283,  erosion: 18.2, haBonif: 302,  monto: 164, benef: 96,  indice: 0.41 },
  { id: 'santa-cruz', nombre: 'Santa Cruz',   prov: 'Colchagua', r: 4, c: 2, sup: 419,  erosion: 14.7, haBonif: 388,  monto: 211, benef: 124, indice: 0.32 },
  { id: 'nancagua',   nombre: 'Nancagua',     prov: 'Colchagua', r: 4, c: 3, sup: 110,  erosion: 9.3,  haBonif: 196,  monto: 104, benef: 71,  indice: 0.27 },
  { id: 'chepica',    nombre: 'Chépica',      prov: 'Colchagua', r: 4, c: 4, sup: 507,  erosion: 16.8, haBonif: 341,  monto: 183, benef: 108, indice: 0.38 },
  { id: 'chimbarongo',nombre: 'Chimbarongo',  prov: 'Colchagua', r: 4, c: 5, sup: 498,  erosion: 12.4, haBonif: 412,  monto: 226, benef: 139, indice: 0.24 },
  { id: 'palmilla',   nombre: 'Palmilla',     prov: 'Colchagua', r: 3, c: 3, sup: 236,  erosion: 11.9, haBonif: 258,  monto: 137, benef: 84,  indice: 0.29 },
  { id: 'placilla',   nombre: 'Placilla',     prov: 'Colchagua', r: 3, c: 5, sup: 145,  erosion: 13.6, haBonif: 187,  monto: 99,  benef: 63,  indice: 0.35 },
  { id: 'san-fernando',nombre:'San Fernando', prov: 'Colchagua', r: 3, c: 6, sup: 2442, erosion: 21.3, haBonif: 496,  monto: 271, benef: 158, indice: 0.47 },

  // Provincia de Cachapoal — valle central y precordillera
  { id: 'las-cabras', nombre: 'Las Cabras',   prov: 'Cachapoal', r: 0, c: 2, sup: 741,  erosion: 22.6, haBonif: 264,  monto: 139, benef: 82,  indice: 0.55 },
  { id: 'coltauco',   nombre: 'Coltauco',     prov: 'Cachapoal', r: 0, c: 3, sup: 222,  erosion: 15.1, haBonif: 208,  monto: 111, benef: 74,  indice: 0.36 },
  { id: 'donihue',    nombre: 'Doñihue',      prov: 'Cachapoal', r: 0, c: 4, sup: 79,   erosion: 10.4, haBonif: 142,  monto: 76,  benef: 52,  indice: 0.26 },
  { id: 'graneros',   nombre: 'Graneros',     prov: 'Cachapoal', r: 0, c: 5, sup: 113,  erosion: 8.7,  haBonif: 158,  monto: 84,  benef: 58,  indice: 0.21 },
  { id: 'mostazal',   nombre: 'Mostazal',     prov: 'Cachapoal', r: 0, c: 6, sup: 532,  erosion: 19.8, haBonif: 231,  monto: 124, benef: 76,  indice: 0.49 },
  { id: 'pichidegua', nombre: 'Pichidegua',   prov: 'Cachapoal', r: 1, c: 2, sup: 322,  erosion: 17.5, haBonif: 244,  monto: 130, benef: 79,  indice: 0.42 },
  { id: 'coinco',     nombre: 'Coinco',       prov: 'Cachapoal', r: 1, c: 3, sup: 98,   erosion: 11.2, haBonif: 129,  monto: 69,  benef: 47,  indice: 0.31 },
  { id: 'olivar',     nombre: 'Olivar',       prov: 'Cachapoal', r: 1, c: 4, sup: 58,   erosion: 7.9,  haBonif: 118,  monto: 63,  benef: 44,  indice: 0.19 },
  { id: 'rancagua',   nombre: 'Rancagua',     prov: 'Cachapoal', r: 1, c: 5, sup: 260,  erosion: 9.6,  haBonif: 174,  monto: 92,  benef: 61,  indice: 0.23 },
  { id: 'codegua',    nombre: 'Codegua',      prov: 'Cachapoal', r: 1, c: 6, sup: 287,  erosion: 20.7, haBonif: 196,  monto: 105, benef: 64,  indice: 0.52 },
  { id: 'peumo',      nombre: 'Peumo',        prov: 'Cachapoal', r: 2, c: 2, sup: 148,  erosion: 13.1, haBonif: 211,  monto: 112, benef: 72,  indice: 0.33 },
  { id: 'quinta',     nombre: 'Quinta de Tilcoco', prov: 'Cachapoal', r: 2, c: 3, sup: 68, erosion: 8.2, haBonif: 121, monto: 65, benef: 45, indice: 0.20 },
  { id: 'malloa',     nombre: 'Malloa',       prov: 'Cachapoal', r: 2, c: 4, sup: 119,  erosion: 12.8, haBonif: 163,  monto: 87,  benef: 57,  indice: 0.30 },
  { id: 'requinoa',   nombre: 'Requínoa',     prov: 'Cachapoal', r: 2, c: 5, sup: 587,  erosion: 23.9, haBonif: 219,  monto: 117, benef: 69,  indice: 0.58 },
  { id: 'machali',    nombre: 'Machalí',      prov: 'Cachapoal', r: 2, c: 6, sup: 2586, erosion: 26.4, haBonif: 188,  monto: 101, benef: 53,  indice: 0.66 },
  { id: 'san-vicente',nombre: 'San Vicente',  prov: 'Cachapoal', r: 3, c: 2, sup: 476,  erosion: 16.2, haBonif: 327,  monto: 175, benef: 103, indice: 0.37 },
  { id: 'rengo',      nombre: 'Rengo',        prov: 'Cachapoal', r: 3, c: 4, sup: 592,  erosion: 18.9, haBonif: 358,  monto: 192, benef: 112, indice: 0.44 }
];

/* --------------------------------------------------------------------------
   Clasificación de erosión (basada en los rangos del inventario de CIREN)
   -------------------------------------------------------------------------- */

GT.clasesErosion = [
  { max: 10,  nombre: 'Ligera',     hex: PALETA.rampas.erosion[0] },
  { max: 18,  nombre: 'Moderada',   hex: PALETA.rampas.erosion[1] },
  { max: 26,  nombre: 'Severa',     hex: PALETA.rampas.erosion[2] },
  { max: 34,  nombre: 'Muy severa', hex: PALETA.rampas.erosion[3] },
  { max: 999, nombre: 'Extrema',    hex: PALETA.rampas.erosion[4] }
];

GT.categoriasPertinencia = [
  { max: 0.25, nombre: 'Sobre-cobertura',    hex: PALETA.rampas.pertinencia[0] },
  { max: 0.40, nombre: 'Cobertura adecuada', hex: PALETA.rampas.pertinencia[1] },
  { max: 0.60, nombre: 'Alineación parcial', hex: PALETA.rampas.pertinencia[2] },
  { max: 0.75, nombre: 'Brecha alta',        hex: PALETA.rampas.pertinencia[3] },
  { max: 1.01, nombre: 'Brecha crítica',     hex: PALETA.rampas.pertinencia[4] }
];

/* --------------------------------------------------------------------------
   Factores RUSLE ILUSTRATIVOS, solo para el modo ejemplo
   -------------------------------------------------------------------------- */

/* Con API o copia local la ficha usa los medidos (GT.factoresRusle, en
   datos-api.js). Esto queda para cuando no hay ninguno de los dos, y la
   ficha lo rotula como ilustrativo.

   Los cinco factores se derivan de forma que su producto sea exactamente la
   erosión declarada para la comuna, manteniendo cada uno dentro de rangos
   plausibles:
     R  varía con la erosividad de la lluvia de la zona
     LS crece con la pendiente, correlacionada con la erosión observada
     C  crece cuando hay menos cobertura vegetal protegiendo el suelo
     P  baja cuando hay más prácticas de conservación bonificadas
     K  se despeja de la ecuación y queda en el rango real de 0,01 a 0,07
   En la implementación cada factor se calcula desde su fuente y la erosión
   es el resultado, no el punto de partida. */
GT.getFactores = function (id) {
  const c = typeof id === 'string' ? GT.comuna(id) : id;
  if (!c) return null;

  const R  = 950 + (c.sup % 7) * 40;
  const LS = +(0.80 + c.erosion * 0.085).toFixed(2);
  const C  = +(0.10 + c.erosion * 0.005).toFixed(3);
  const intensidad = c.haBonif / (c.sup / 10);
  const P  = +(1 - 0.30 * Math.min(1, intensidad / 18)).toFixed(3);
  const K  = +(c.erosion / (R * LS * C * P)).toFixed(4);

  return { R: R, K: K, LS: LS, C: C, P: P, A: c.erosion };
};

GT.descripcionFactores = [
  { sym: 'R',  nombre: 'Erosividad de la lluvia', pregunta: '¿Con cuánta fuerza llueve aquí?', fuente: 'CR2MET v2.5', unidad: 'MJ·mm/ha·h·año', humano: false },
  { sym: 'K',  nombre: 'Erodabilidad del suelo',  pregunta: '¿Qué tan fácil se desarma este suelo?', fuente: 'ISRIC SoilGrids 2.0', unidad: 't·ha·h/ha·MJ·mm', humano: false },
  { sym: 'LS', nombre: 'Factor topográfico',      pregunta: '¿Qué tan empinado y largo es el terreno?', fuente: 'NASADEM', unidad: 'adimensional', humano: false },
  { sym: 'C',  nombre: 'Cobertura vegetal',       pregunta: '¿Hay vegetación protegiendo el suelo?', fuente: 'Sentinel-2 L2A', unidad: 'adimensional', humano: true },
  { sym: 'P',  nombre: 'Prácticas de conservación', pregunta: '¿Hay obras de conservación?', fuente: 'SIRSD-S / IDE MINAGRI', unidad: 'adimensional', humano: true }
];

/* --------------------------------------------------------------------------
   Capas disponibles en el visor
   -------------------------------------------------------------------------- */

GT.capas = [
  /* Los ids se conservan por compatibilidad, pero ya no dicen años: son el
     cálculo propio y el inventario CIREN. datos-api.js completa la fuente
     con el año del dato cargado. */
  { id: 'erosion26',  nombre: 'Erosión estimada TerraFoco', fuente: 'Cálculo propio',   activa: true,  grupo: 'Suelos' },
  { id: 'erosion10',  nombre: 'Erosión actual CIREN',       fuente: 'Inventario CIREN', activa: false, grupo: 'Suelos' },
  { id: 'ndvi',       nombre: 'Cobertura vegetal (NDVI)',fuente: 'Sentinel-2',  activa: false, grupo: 'Suelos' },
  { id: 'pendiente',  nombre: 'Pendiente',               fuente: 'NASADEM 30 m', activa: false, grupo: 'Terreno' },
  { id: 'inversion',  nombre: 'Inversión SIRSD-S',       fuente: 'INDAP · SAG', activa: false, grupo: 'Programas' },
  { id: 'pertinencia',nombre: 'Índice de pertinencia',   fuente: 'TerraFoco',    activa: false, grupo: 'Programas' },
  { id: 'limites',    nombre: 'Límites comunales',       fuente: 'IDE Chile',   activa: true,  grupo: 'Base' }
];

/* --------------------------------------------------------------------------
   Fuentes de datos y estado del pipeline
   -------------------------------------------------------------------------- */

GT.fuentes = [
  { nombre: 'SRTM — Modelo digital de elevación', org: 'NASA / USGS', tipo: 'Raster 30 m', registros: '48 teselas', act: '2026-08-02', estado: 'ok' },
  { nombre: 'Sentinel-2 — Multiespectral',        org: 'Copernicus',  tipo: 'Raster 10 m', registros: '112 escenas', act: '2026-08-14', estado: 'ok' },
  { nombre: 'Landsat 8/9 — Banda térmica',        org: 'USGS',        tipo: 'Raster 30 m', registros: '26 escenas', act: '2026-07-29', estado: 'ok' },
  { nombre: 'Inventario Nacional de Erosión',     org: 'CIREN',       tipo: 'Vectorial',   registros: '14.882 polígonos', act: '2026-06-11', estado: 'ok' },
  { nombre: 'Capas agrológicas y de clima',       org: 'IDE MINAGRI', tipo: 'Vectorial',   registros: '9 capas', act: '2026-06-11', estado: 'ok' },
  { nombre: 'Límites administrativos',            org: 'IDE Chile',   tipo: 'Vectorial',   registros: '33 comunas', act: '2026-05-30', estado: 'ok' },
  { nombre: 'SIRSD-S — Transparencia Activa',     org: 'INDAP',       tipo: 'Planillas',   registros: '132 planillas', act: '2026-08-09', estado: 'parcial' },
  { nombre: 'SIRSD-S — Solicitud de acceso',      org: 'SAG',         tipo: 'Pendiente',   registros: '—', act: '—', estado: 'pendiente' },
  { nombre: 'Registros históricos de eventos',    org: 'SENAPRED',    tipo: 'Tabular',     registros: '41 eventos', act: '2026-07-18', estado: 'ok' }
];

GT.pipeline = [
  { n: '01', t: 'Ingesta',       d: 'Descarga programática desde los repositorios de origen' },
  { n: '02', t: 'Normalización', d: 'Reproyección, remuestreo y recorte al área de interés' },
  { n: '03', t: 'Almacenamiento',d: 'Persistencia en PostgreSQL + PostGIS con versionado' },
  { n: '04', t: 'Indicadores',   d: 'Cálculo de factores, índices y agregación por comuna' },
  { n: '05', t: 'Publicación',   d: 'Exposición vía API REST al visor y al tablero' }
];

GT.ejecuciones = [
  { fecha: '2026-08-14 04:12', proceso: 'Sentinel-2 → NDVI → factor C', dur: '18 min', estado: 'ok' },
  { fecha: '2026-08-09 04:12', proceso: 'ETL Transparencia Activa INDAP', dur: '3 min',  estado: 'parcial' },
  { fecha: '2026-08-02 04:12', proceso: 'SRTM → pendiente → factor LS',  dur: '26 min', estado: 'ok' },
  { fecha: '2026-07-29 04:12', proceso: 'Landsat → temperatura superficial', dur: '11 min', estado: 'ok' },
  { fecha: '2026-07-18 04:12', proceso: 'Carga de eventos SENAPRED',     dur: '1 min',  estado: 'ok' }
];

/* --------------------------------------------------------------------------
   Módulo de inundaciones
   -------------------------------------------------------------------------- */

/* Pesos CALIBRADOS (iteración 2). Espejo de VARIABLES en
   motor/indicadores/inundacion.py: si cambian allá, cambian aquí.
   Los a priori eran 24/21/19/16/11/9; la validación contra los 63 eventos
   de DesInventar mostró que solo acumulación y curvatura correlacionan a
   escala comunal. Las otras cuatro se calculan igual, pero no pesan. */
GT.variablesInundacion = [
  { nombre: 'Acumulación de flujo',         peso: 50, fuente: 'NASADEM',    aPriori: 21 },
  { nombre: 'Curvatura del terreno',        peso: 50, fuente: 'NASADEM',    aPriori: 11 },
  { nombre: 'Pendiente',                    peso: 0,  fuente: 'NASADEM',    aPriori: 24, nota: 'correlaciona al revés a escala comunal' },
  { nombre: 'Distancia a cauces',           peso: 0,  fuente: 'IDE Chile',  aPriori: 19, nota: 'sin correlación con eventos' },
  { nombre: 'Índice topográfico de humedad',peso: 0,  fuente: 'NASADEM',    aPriori: 16, nota: 'sin correlación con eventos' },
  { nombre: 'Cobertura del suelo',          peso: 0,  fuente: 'Sentinel-2', aPriori: 9,  nota: 'sin correlación con eventos' }
];

GT.eventosInundacion = [
  { fecha: 'Jun 2023', lugar: 'San Vicente',  clase: 'Alta',    acierto: true },
  { fecha: 'Ago 2023', lugar: 'Peumo',        clase: 'Alta',    acierto: true },
  { fecha: 'Jun 2023', lugar: 'Las Cabras',   clase: 'Media',   acierto: true },
  { fecha: 'Jul 2022', lugar: 'Rengo',        clase: 'Alta',    acierto: true },
  { fecha: 'Ago 2021', lugar: 'Coltauco',     clase: 'Media',   acierto: true },
  { fecha: 'Jun 2020', lugar: 'Pichidegua',   clase: 'Baja',    acierto: false },
  { fecha: 'Jul 2019', lugar: 'Malloa',       clase: 'Alta',    acierto: true },
  { fecha: 'May 2019', lugar: 'Quinta de Tilcoco', clase: 'Media', acierto: true }
];

/* --------------------------------------------------------------------------
   Módulo urbano — unidades vecinales de Rancagua
   temp: temperatura superficial media °C · verde: m² de área verde por habitante
   -------------------------------------------------------------------------- */

GT.unidadesVecinales = [
  { id: 'uv01', nombre: 'UV 1 — Centro',        temp: 34.8, verde: 1.9, hab: 8420 },
  { id: 'uv02', nombre: 'UV 2 — Estación',      temp: 35.6, verde: 1.2, hab: 6110 },
  { id: 'uv03', nombre: 'UV 3 — Baquedano',     temp: 33.1, verde: 3.4, hab: 7250 },
  { id: 'uv04', nombre: 'UV 4 — El Sauce',      temp: 31.4, verde: 6.8, hab: 5480 },
  { id: 'uv05', nombre: 'UV 5 — Rancagua Norte',temp: 34.2, verde: 2.6, hab: 9130 },
  { id: 'uv06', nombre: 'UV 6 — Machalí Sur',   temp: 30.2, verde: 9.1, hab: 4260 },
  { id: 'uv07', nombre: 'UV 7 — Los Olivos',    temp: 35.1, verde: 1.6, hab: 7890 },
  { id: 'uv08', nombre: 'UV 8 — Parque Central',temp: 29.6, verde: 11.4,hab: 3980 },
  { id: 'uv09', nombre: 'UV 9 — Industrial',    temp: 36.3, verde: 0.8, hab: 2140 },
  { id: 'uv10', nombre: 'UV 10 — El Manzanal',  temp: 32.7, verde: 4.2, hab: 6640 },
  { id: 'uv11', nombre: 'UV 11 — La Compañía',  temp: 33.9, verde: 2.9, hab: 8010 },
  { id: 'uv12', nombre: 'UV 12 — Poniente',     temp: 34.5, verde: 2.1, hab: 5720 }
];

/* m² de área verde pública por habitante. Era 9, la cifra que suele
   atribuirse a la OMS; el estándar chileno es el del SIEDU (INE / CNDU), 10,
   y es el que usa el cálculo real. */
GT.ESTANDAR_VERDE = 10;

/* --------------------------------------------------------------------------
   Conurbación de Rancagua — indicadores urbanos a nivel comunal.

   El módulo 3 está diseñado para trabajar por unidad vecinal, pero el catastro
   de unidades vecinales lo publica cada municipio y no es homogéneo. Mientras
   no se consiga, la cartografía usa la geometría comunal, que sí es real.

   temp : temperatura superficial media de verano, °C
   verde: área verde por habitante, m²
   -------------------------------------------------------------------------- */

GT.conurbacion = [
  { nombre: 'Rancagua', temp: 34.6, verde: 3.1 },
  { nombre: 'Machalí',  temp: 31.2, verde: 7.8 },
  { nombre: 'Graneros', temp: 33.8, verde: 2.4 },
  { nombre: 'Olivar',   temp: 33.1, verde: 4.6 },
  { nombre: 'Doñihue',  temp: 32.4, verde: 5.2 },
  { nombre: 'Codegua',  temp: 32.9, verde: 6.1 },
  { nombre: 'Mostazal', temp: 33.4, verde: 3.9 }
];

GT.datoUrbano = function (nombre) {
  return GT.conurbacion.find(function (c) { return c.nombre === nombre; });
};

/* --------------------------------------------------------------------------
   Utilidades de clasificación
   -------------------------------------------------------------------------- */

GT.claseErosion = function (v) {
  return GT.clasesErosion.find(function (c) { return v <= c.max; });
};

GT.categoriaPertinencia = function (v) {
  return GT.categoriasPertinencia.find(function (c) { return v <= c.max; });
};

/* Si la comuna entra al índice. Quedan fuera las que el origen elegido no
   trae y, salvo que se marque la casilla, las que están fuera del dominio de
   validez: su índice llega en null. Toda vista del índice —ranking, KPIs,
   dispersión, capa de pertinencia— pasa por aquí; las de datos medidos
   (erosión, serie del programa) siguen mostrando las 33. */
GT.enIndice = function (c) {
  return !c.sinDatoEnOrigen && typeof c.indice === 'number';
};
GT.comunasIndice = function () {
  return GT.comunas.filter(GT.enIndice);
};

/* UF escritas para leer: "49.627 UF" o, si se pide, "49,6 mil UF". */
GT.fmtUF = function (v, enMiles) {
  if (typeof v !== 'number') return '—';
  return enMiles ? GT.fmt(v / 1000, v < 10000 ? 1 : 0) + ' mil UF' : GT.fmt(v) + ' UF';
};

/* El motivo, para rotular en vez de dejar un hueco sin explicación. */
GT.motivoSinIndice = function (c) {
  if (c.sinDatoEnOrigen) return 'Sin dato en este origen';
  if (c.fueraDeDominio) return 'Fuera del dominio de validez';
  return 'Sin índice';
};

/* Qué hacer con una comuna, dicho como lo diría quien distribuye el SIRSD-S.
   Sale solo de la categoría del índice y de la brecha en UF que la pantalla
   ya muestra: no agrega juicios que el dato no respalde. */
GT.recomendacion = function (c) {
  if (!c) return null;
  if (!GT.enIndice(c)) {
    return c.fueraDeDominio
      ? 'Decidir con la línea base de CIREN: el modelo propio no es confiable en esta comuna precordillerana y su índice no se calcula.'
      : 'Sin índice con el origen elegido: revisar la ficha con la línea base de CIREN.';
  }
  const brecha = typeof c.brechaUF === 'number' && c.brechaUF > 0
    ? ' Llegar a la mediana regional requiere ≈ ' + GT.fmtUF(c.brechaUF) + '.' : '';
  switch (GT.categoriaPertinencia(c.indice).nombre) {
    case 'Brecha crítica':
      return 'Priorizar en el próximo concurso del SIRSD-S: tiene erosión alta y recibe de las inversiones ' +
             'más bajas por hectárea erosionada de la región.' + brecha;
    case 'Brecha alta':
      return 'Considerar como prioridad en el próximo concurso: la inversión por hectárea erosionada está ' +
             'bajo la mediana regional.' + brecha;
    case 'Alineación parcial':
      return 'Mantener la asignación y orientar los planes a prácticas de conservación (cobertura vegetal, ' +
             'cero labranza, obras en laderas) donde la erosión es severa.' + brecha;
    case 'Cobertura adecuada':
      return 'La inversión está en línea con la erosión: mantener y cuidar que los planes se concentren en ' +
             'los sectores con erosión severa.';
    default:
      return 'Recibe sobre la mediana regional por hectárea erosionada: evaluar si parte del incentivo puede ' +
             'orientarse a comunas con brecha alta o crítica.';
  }
};

/* La salvedad que acompaña a la recomendación: la inversión es todo el
   SIRSD-S, no solo conservación. */
GT.notaInversion = 'La inversión suma todos los subprogramas del SIRSD-S, también los de fertilidad ' +
  '(fósforo, enmiendas calcáreas). Con el detalle por práctica de INDAP se podrá comparar la erosión solo ' +
  'con la inversión en conservación.';

GT.comuna = function (id) {
  return GT.comunas.find(function (c) { return c.id === id; });
};

/* Formato para mostrar: coma decimal y punto de miles (es-CL). Todo número
   que se LEE en pantalla pasa por aquí; los que son sintaxis —anchos en %,
   coordenadas de SVG, parámetros de la API— siguen con punto. */
GT.fmt = function (n, dec) {
  return n.toLocaleString('es-CL', {
    minimumFractionDigits: dec || 0,
    maximumFractionDigits: dec || 0
  });
};

/* La inversión con que se calcula el índice (migración 013): incentivo del
   SIRSD-S 2012-2025 en UF por hectárea con erosión Severa o superior. Sin
   ese dato (página en modo ejemplo) se vuelve a la medida anterior, ha
   bonificadas por cada 1.000 ha comunales, y `unidad` lo dice. */
GT.inversionDe = function (c) {
  if (typeof c.inversionUFha === 'number') return c.inversionUFha;
  return c.sup > 0 ? (c.haBonif || 0) / (c.sup / 10) : null;
};
GT.unidadInversion = function () {
  return GT.comunas.some(function (c) { return typeof c.inversionUFha === 'number'; })
    ? 'UF por ha con erosión severa' : 'ha bonificadas por cada 1.000 ha';
};

/* Mediana regional de esa inversión, entre las comunas con dato. Pertinencia
   y la ficha de comuna la tenían fija en 8,6, un número de los datos de
   ejemplo. */
GT.medianaInversion = function () {
  /* La de la API cuando está: es la misma con que se calcula la brecha. */
  if (typeof GT.medianaUFha === 'number' && GT.unidadInversion().indexOf('UF') === 0) {
    return GT.medianaUFha;
  }
  /* Sin las fuera de dominio aunque se hayan pedido: su UF/ha sale de un
     denominador inflado (0,003 en Machalí) y bajaría la mediana. */
  const v = GT.comunasIndice()
    .filter(function (c) { return !c.fueraDeDominio; })
    .map(GT.inversionDe)
    .filter(function (x) { return typeof x === 'number'; })
    .sort(function (a, b) { return a - b; });
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
