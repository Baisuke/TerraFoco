/* ==========================================================================
   TerraFoco — Cartografía real
   Reemplaza el mapa esquemático por geometrías reales servidas desde PostGIS.

   Estrategia de mejora progresiva: si la API no responde o MapLibre no carga,
   se vuelve al mapa esquemático. Así el prototipo sigue funcionando abierto
   directamente desde el disco, sin backend.

   Geometrías: 33 comunas de la Región de O'Higgins, con código INE oficial.
   Los INDICADORES siguen siendo de ejemplo hasta que el motor los calcule.
   ========================================================================== */

const GTMapaReal = {};

/* Misma fuente que datos-api.js: api-base.js, cargado antes. */
GTMapaReal.API = (typeof GT_API_BASE !== 'undefined') ? GT_API_BASE : 'http://localhost:8000';

/* 5.24 y no 4.x: trae las capas `color-relief` (5.6) y `resampling` (5.20)
   con que se dibujan las teselas de valores, y el sombreado por método
   (5.5). No la 6.x: dejó de publicar este paquete clásico y exige cargarse
   como módulo ES, lo que obligaría a cambiar cómo se carga en las cuatro
   pantallas sin ganar nada que se vea. */
/* Las librerías van en prototipo/vendor: una red que bloquee unpkg.com —pasa
   en redes institucionales— dejaba la pantalla sin mapa. El CDN queda de
   respaldo por si la copia local faltara. */
const MAPLIBRE_JS = ['vendor/maplibre-gl.js', 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js'];
const MAPLIBRE_CSS = ['vendor/maplibre-gl.css', 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css'];
/* Lector de PMTiles: un archivo por capa, leído por rangos HTTP. */
const PMTILES_JS = ['vendor/pmtiles.js', 'https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js'];
const RUTA_RELIEVE = 'datos/teselas/relieve.pmtiles';
/* Mapa base sobrio, para que el dato mande sobre él: CARTO Dark Matter en
   el tema oscuro y Positron en el claro. Son de la misma casa —misma
   licencia, mismo catálogo de capas por tipo—, así que puntosDeInsercion()
   sirve para los dos. Todos los colores del mapa que dependen del tema
   —estilo, bordes, halos, relieve, cielo— vienen de PALETA.mapa. */
const ESTILO_BASE = PALETA.mapa.estilo;

const CENTRO_OHIGGINS = [-71.2, -34.45];

/* -------------------------------------------------------------------------
   Carga de la biblioteca bajo demanda
   ------------------------------------------------------------------------- */

/* Una lista de direcciones: se prueba la primera y, si falla, la siguiente. */
function cargarRecurso(urls, tipo) {
  if (!Array.isArray(urls)) return cargarUno(urls, tipo);
  return urls.slice(1).reduce(function (p, url) {
    return p.catch(function () { return cargarUno(url, tipo); });
  }, cargarUno(urls[0], tipo));
}

function cargarUno(url, tipo) {
  return new Promise(function (ok, error) {
    if (tipo === 'css') {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = url;
      l.onload = ok; l.onerror = function () { error(new Error('CSS: ' + url)); };
      document.head.appendChild(l);
    } else {
      const s = document.createElement('script');
      s.src = url;
      s.onload = ok; s.onerror = function () { error(new Error('JS: ' + url)); };
      document.head.appendChild(s);
    }
  });
}

function cargarMapLibre() {
  if (window.maplibregl) return Promise.resolve(registrarTeselas());
  return Promise.all([
    cargarRecurso(MAPLIBRE_CSS, 'css'),
    cargarRecurso(MAPLIBRE_JS, 'js'),
    /* Sin el lector el mapa funciona igual, con los PNG por comuna: su
       falla no puede tumbar la carga. */
    cargarRecurso(PMTILES_JS, 'js').catch(function () { return null; }),
  ]).then(registrarTeselas);
}

/* Teselas de valores (motor/teselas.py). Un solo lector por archivo, que
   comparten el mapa —vía el protocolo pmtiles://— y la lectura del valor
   bajo el cursor, así el encabezado y el índice se piden una vez.

   Desde file:// no hay peticiones de rango posibles: GTMapaReal.teselas
   queda en null y cada capa usa su alternativa. */
GTMapaReal.teselas = null;

function registrarTeselas() {
  if (GTMapaReal.teselas || !window.pmtiles || !window.maplibregl) return;
  if (location.protocol === 'file:') return;
  const protocolo = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocolo.tile);
  const archivos = {};
  function absoluta(ruta) { return new URL(ruta, location.href).href; }
  GTMapaReal.teselas = {
    archivo: function (ruta) {
      const url = absoluta(ruta);
      if (!archivos[url]) {
        archivos[url] = new pmtiles.PMTiles(url);
        protocolo.add(archivos[url]);
      }
      return archivos[url];
    },
    url: function (ruta) { return 'pmtiles://' + absoluta(ruta); },
    /* Resuelve con los metadatos si el archivo existe; con null si no. Se
       consulta antes de agregar la capa para no llenar la consola de 404. */
    disponible: function (ruta) {
      const a = GTMapaReal.teselas.archivo(ruta);
      return Promise.all([a.getHeader(), a.getMetadata()])
        .then(function (r) { return { encabezado: r[0], meta: r[1] || {} }; })
        .catch(function () { return null; });
    },
  };
}

/* -------------------------------------------------------------------------
   Datos
   ------------------------------------------------------------------------- */

GTMapaReal.disponible = function () {
  return fetch(GT_api('/salud'), { signal: AbortSignal.timeout(3000) })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (e) { return !!(e && e.base_de_datos === 'ok'); })
    .catch(function () { return false; });
};

/* Copia estática exportada desde la API. Existe para que el prototipo publicado
   —GitHub Pages, o abierto desde el disco— muestre igual la cartografía real,
   sin necesidad de levantar la base de datos.

   Hay dos copias del MISMO dato, y la razón es el protocolo:
     · datos/comunas.js       se carga con <script>  → funciona en file://
     · datos/comunas.geojson  se carga con fetch()   → bloqueado en file://
   Al abrir el prototipo con doble clic, el navegador impide leer archivos
   locales por fetch. La copia en .js esquiva esa restricción. */
const RESPALDO_ESTATICO = 'datos/comunas.geojson';

let origenGeometrias = null;   // 'api' | 'estatico'

function traerGeometrias() {
  return fetch(GT_api('/comunas/geojson'), { signal: AbortSignal.timeout(4000) })
    .then(function (r) {
      if (!r.ok) throw new Error('La API respondió ' + r.status);
      return r.json();
    })
    .then(function (g) { origenGeometrias = 'api'; return g; })
    .catch(function (e) {
      console.info('[mapa-real] sin API (%s); se usa la copia estática', e.message);

      /* Incrustada por <script>: única vía que sobrevive a file:// */
      if (window.TERRAFOCO_COMUNAS) {
        origenGeometrias = 'estatico';
        return window.TERRAFOCO_COMUNAS;
      }

      return fetch(RESPALDO_ESTATICO).then(function (r) {
        if (!r.ok) throw new Error('tampoco hay copia estática');
        return r.json();
      }).then(function (g) { origenGeometrias = 'estatico'; return g; });
    });
}

/* Une la geometría real con los indicadores del prototipo, por nombre. */
function enriquecer(geojson, capa) {
  const porNombre = {};
  GT.comunas.forEach(function (c, i) { porNombre[c.nombre] = { datos: c, indice: i }; });

  let sinDato = 0;
  geojson.features.forEach(function (f) {
    const par = porNombre[f.properties.nombre];
    if (!par) { sinDato++; f.properties._color = PALETA.sinDato; return; }
    const info = GTMapa.valorCapa(par.datos, capa, par.indice);
    f.properties._color = info.color;
    f.properties._valor = info.v;
    f.properties._unidad = info.unidad;
    // Advertencia sobre el valor (p. ej. fuera del dominio del modelo).
    f.properties._nota = info.nota || null;
    f.properties._id = par.datos.id;
  });
  if (sinDato) console.warn('[mapa-real] %d comunas sin indicador asociado', sinDato);
  return geojson;
}

/* -------------------------------------------------------------------------
   Mapas base

   Por qué NO se usa el satelital de Google: sus condiciones de uso prohíben
   obtener las teselas por cualquier vía que no sea su propia API. El endpoint
   que circula en tutoriales (mt1.google.com/vt/lyrs=s) no está documentado y
   usarlo las incumple. La vía legítima —Map Tiles API— es un producto de
   cobro que exige tarjeta y una clave incrustada en el navegador, y prohíbe
   cachear. Para un prototipo que debe abrirse en cualquier máquina sin
   configuración, no sirve.

   Se ofrece Sentinel-2 en su lugar, y no es un premio de consuelo: el factor C
   de este proyecto SE CALCULA con Sentinel-2. Ver la misma familia de imagen
   con la que se hizo el cálculo evita el error de validar un dato de 2024
   contra una fotografía de fecha desconocida.
   ------------------------------------------------------------------------- */

const BASES = {
  mapa: {
    nombre: 'Mapa',
    detalle: PALETA.mapa.detalle,
    teselas: null,             // el estilo base ya está cargado
    opacidadTema: 0.82,
  },
  satelital: {
    nombre: 'Satelital',
    detalle: 'Sentinel-2 cloudless 2023 · 10 m',
    teselas: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg'],
    // CC BY-NC-SA 4.0. La atribución es obligatoria y va literal.
    atribucion: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless 2023</a> por EOX IT Services GmbH (Copernicus Sentinel modificado)',
    zoomMaximo: 15,
    // Sobre imagen oscura el coropleto tapa; se entra más transparente.
    opacidadTema: 0.45,
  },
};

const ID_FUENTE_BASE = 'base-satelital';
const ID_CAPA_BASE = 'base-satelital-capa';
const ID_ANCLA = 'ancla-relieve';

/* -------------------------------------------------------------------------
   Dónde insertar lo temático dentro del mapa base

   MapLibre apila las capas en el orden en que se agregan, así que un addLayer
   sin `beforeId` queda ENCIMA de todo el estilo base — caminos y nombres de
   ciudad incluidos. Con el relleno de comunas al 82% eso dejaba el territorio
   como una mancha de color: al hacer zoom sobre una comuna no aparecía ni un
   camino, y los nombres de pueblo solo se veían FUERA de la región.

   El estilo Positron va en este orden: fondo y usos de suelo (fill), luego
   agua y caminos (line), y al final las etiquetas (symbol). Insertando por
   tipo en vez de por nombre de capa, esto sigue funcionando si CARTO
   reordena su estilo o si mañana se cambia de mapa base.
   ------------------------------------------------------------------------- */

/* Dark Matter es gris neutro; la interfaz tiene un matiz frío. Se tiñen el
   fondo y el agua con los tonos de los paneles, para que mapa e interfaz se
   lean como una sola superficie. Por tipo
   y por nombre genérico ("water"): si CARTO renombra capas, el mapa queda
   en su gris original, no roto. */
function entintarBase(mapa) {
  const t = PALETA.mapa.entintar;
  if (!t) return;                    // Positron se usa tal cual
  mapa.getStyle().layers.forEach(function (c) {
    try {
      if (c.type === 'background') {
        mapa.setPaintProperty(c.id, 'background-color', t.fondo);
      } else if (c.type === 'fill' && /water/i.test(c.id)) {
        mapa.setPaintProperty(c.id, 'fill-color', t.agua);
      } else if (c.type === 'line' && /water|river/i.test(c.id)) {
        mapa.setPaintProperty(c.id, 'line-color', t.cauces);
      }
    } catch (e) { /* capa sin esa propiedad: se deja como viene */ }
  });
}

function puntosDeInsercion(mapa) {
  const capas = mapa.getStyle().layers;
  let bajoCaminos = null, bajoEtiquetas = null;
  /* Rellenos opacos del mapa base —suelo, usos, agua—. Con imagen satelital
     hay que ocultarlos: si no, la foto queda debajo de una capa de color
     plano y no se ve nada. Se recogen por tipo y no por nombre para no
     depender del catálogo de capas de Positron. */
  const fondosOpacos = [];
  /* Sobre qué capa va la imagen: justo encima del fondo, debajo de todo. */
  const sobreElFondo = capas.length > 1 ? capas[1].id : null;

  for (let i = 0; i < capas.length; i++) {
    if (!bajoCaminos && (capas[i].type === 'line' || capas[i].type === 'symbol')) {
      bajoCaminos = capas[i].id;
    }
    if (!bajoCaminos && capas[i].type === 'fill') fondosOpacos.push(capas[i].id);
    if (capas[i].type === 'symbol') { bajoEtiquetas = capas[i].id; break; }
  }
  /* El agua va después de los primeros caminos en Positron, así que el bucle
     de arriba no la alcanza. Se busca aparte, por tipo, entre las que quedan. */
  for (let i = 0; i < capas.length; i++) {
    if (capas[i].type === 'fill' && fondosOpacos.indexOf(capas[i].id) === -1) {
      fondosOpacos.push(capas[i].id);
    }
  }
  return {
    bajoCaminos: bajoCaminos,
    bajoEtiquetas: bajoEtiquetas,
    sobreElFondo: sobreElFondo,
    fondosOpacos: fondosOpacos,
  };
}

/* Opacidad del coropleto. Con una comuna abierta se baja mucho: ahí el dato
   que importa es el ráster a 30 m y el mapa base, no el promedio comunal.
   Las vecinas quedan tenues, como contexto. */
function opacidadRelleno(base, activa, conZoom, conDetalle) {
  const esActiva = ['==', ['get', 'nombre'], activa];
  /* Con detalle, la comuna elegida se aclara para dejar ver su ráster. Sin
     detalle —otra capa del visor, o la pestaña de áreas verdes— eso la
     borraba: la comuna que se está mirando quedaba casi blanca y sus
     vecinas con color. Ahí la elegida va entera y las demás ceden. */
  const valor = !activa ? base
    : conDetalle ? ['case', esActiva, base * 0.15, base * 0.40]
    : ['case', esActiva, base, base * 0.55];
  /* Con el detalle continuo (teselas), el píxel aparece en toda la región
     entre el zoom 8,5 y el 10: en ese mismo tramo el promedio comunal se
     retira, para que no tiña el dato fino con el color de la comuna. Sigue
     ahí, invisible, para recibir los clics. */
  if (!conZoom) return valor;
  return ['interpolate', ['linear'], ['zoom'], 8.5, valor, 10.2, 0];
}

/* Pantalla completa.

   No basta con agrandar el mapa: el requisito es que los filtros sigan a mano.
   Por eso el panel de controles de la página se MUEVE dentro del contenedor
   del mapa mientras dura, y vuelve a su sitio exacto al salir —se guardan
   padre y hermano siguiente, no solo el padre, porque insertar al final
   reordenaría la columna—.

   Se usa la API de pantalla completa del navegador y no una clase con
   position:fixed para que funcione la tecla Esc y para que el mapa ocupe la
   pantalla de verdad, sin la barra del navegador. */
const ANCHO_PANEL = '300px';

function pantallaCompleta(contenedor, mapa, selectorPanel, alCambiar) {
  let panel = null, padre = null, hermano = null;
  let maximizado = false;   // respaldo cuando el navegador niega la API

  function enPantalla() {
    return document.fullscreenElement === contenedor ||
           document.webkitFullscreenElement === contenedor;
  }
  function activa() { return enPantalla() || maximizado; }

  function meterPanel() {
    if (!selectorPanel || panel) return;
    const el = document.querySelector(selectorPanel);
    if (!el) return;
    panel = el;
    padre = el.parentNode;
    hermano = el.nextSibling;
    el.classList.add('map__panel');
    contenedor.appendChild(el);
    /* Solo con panel presente se corre el lienzo y lo que flota encima. Sin
       esto, una pantalla sin filtros dejaría 300 px vacíos a la izquierda. */
    contenedor.style.setProperty('--panel-ancho', ANCHO_PANEL);
  }

  function sacarPanel() {
    if (!panel) return;
    panel.classList.remove('map__panel');
    padre.insertBefore(panel, hermano);
    panel = null; padre = null; hermano = null;
    contenedor.style.removeProperty('--panel-ancho');
  }

  /* Un solo lugar que aplica el estado, lo use la API del navegador o el
     respaldo: si no, los dos caminos se desincronizan. */
  function aplicar(dentro) {
    contenedor.classList.toggle('map--completa', dentro);
    contenedor.classList.toggle('map--maximizada', dentro && maximizado);
    document.body.classList.toggle('sin-desplazamiento', dentro && maximizado);
    if (dentro) meterPanel(); else sacarPanel();
    if (alCambiar) alCambiar(dentro);
    /* Después del reflow, no antes: MapLibre no se entera solo de que el
       lienzo cambió de tamaño. */
    requestAnimationFrame(function () { mapa.resize(); });
  }

  function entrar() {
    const pedir = contenedor.requestFullscreen || contenedor.webkitRequestFullscreen;
    let promesa = null;
    if (pedir) {
      try { promesa = pedir.call(contenedor); } catch (e) { promesa = Promise.reject(e); }
    } else {
      promesa = Promise.reject(new Error('sin API de pantalla completa'));
    }
    /* La API falla en más sitios de los que uno espera: dentro de un iframe
       sin permiso, en algunos navegadores móviles, y cuando el clic no cuenta
       como gesto. En vez de dejar el botón muerto, se ocupa la ventana.

       No basta con capturar el rechazo. Hay contextos —paneles de vista
       previa, algunos visores embebidos— donde la promesa ni se resuelve ni
       se rechaza, y el botón queda mudo para siempre. Por eso la comprobación
       es por tiempo y no por promesa: si en un cuarto de segundo no entramos
       en pantalla completa, no vamos a entrar. */
    Promise.resolve(promesa).catch(function () { /* se resuelve abajo */ });
    setTimeout(function () { if (!enPantalla()) respaldo(); }, 250);
  }

  function respaldo() {
    if (maximizado) return;
    maximizado = true;
    aplicar(true);
    document.addEventListener('keydown', alEscape);
  }

  function salir() {
    if (enPantalla()) {
      const cerrar = document.exitFullscreen || document.webkitExitFullscreen;
      if (cerrar) cerrar.call(document);
      return;
    }
    maximizado = false;
    document.removeEventListener('keydown', alEscape);
    aplicar(false);
  }

  function alEscape(e) { if (e.key === 'Escape') salir(); }

  function alternar() { if (activa()) salir(); else entrar(); }

  /* Cubre la salida con Esc desde la API del navegador, que no pasa por
     nuestro código. */
  function alCambiarPantalla() {
    if (maximizado) return;          // el respaldo se gestiona aparte
    aplicar(enPantalla());
  }
  document.addEventListener('fullscreenchange', alCambiarPantalla);
  document.addEventListener('webkitfullscreenchange', alCambiarPantalla);

  return { alternar: alternar, activa: activa };
}

/* Conmutador de mapa base, dibujado sobre el propio mapa.

   Va aquí y no en el marcado de cada página porque solo el visor tiene panel
   lateral: puesto en el mapa, la misma pieza sirve en las cuatro pantallas y
   se escribe una vez. `alCambiar` recibe el id elegido. */
function conmutadorDeBase(barra, alCambiar) {
  const caja = document.createElement('div');
  caja.className = 'basectl';
  caja.setAttribute('role', 'group');
  caja.setAttribute('aria-label', 'Mapa base');

  const botones = Object.keys(BASES).map(function (id) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = BASES[id].nombre;
    b.title = BASES[id].detalle;
    b.setAttribute('aria-pressed', id === 'mapa' ? 'true' : 'false');
    b.addEventListener('click', function () {
      botones.forEach(function (o) { o.setAttribute('aria-pressed', 'false'); });
      b.setAttribute('aria-pressed', 'true');
      alCambiar(id);
    });
    caja.appendChild(b);
    return b;
  });

  barra.appendChild(caja);
  /* Para que el panel lateral del visor pueda reflejar un cambio hecho aquí. */
  return function marcar(id) {
    Object.keys(BASES).forEach(function (k, i) {
      botones[i].setAttribute('aria-pressed', String(k === id));
    });
  };
}

/* Barra que agrupa los controles propios del mapa, para no ir sumando
   posiciones absolutas sueltas cada vez que aparece un control nuevo. */
function barraDeControles(contenedor) {
  const previa = contenedor.querySelector('.mapbar');
  if (previa) previa.remove();
  const barra = document.createElement('div');
  barra.className = 'mapbar';
  contenedor.appendChild(barra);
  return barra;
}

function botonPantallaCompleta(barra, control) {
  const caja = document.createElement('div');
  caja.className = 'basectl';
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Pantalla completa';
  b.title = 'Ampliar el mapa (Esc para salir)';
  b.addEventListener('click', control.alternar);
  caja.appendChild(b);
  barra.appendChild(caja);
  return function marcar(dentro) {
    b.textContent = dentro ? 'Salir' : 'Pantalla completa';
    b.setAttribute('aria-pressed', String(dentro));
  };
}

/* -------------------------------------------------------------------------
   Relieve: sombreado y terreno 3D

   Positron es plano. Sobre él, la región se leía como un mosaico de
   polígonos sin geografía, cuando la erosión es justamente cosa de laderas:
   Pichidegua es "Severa" por sus cerros, no por su valle. El sombreado va
   SOBRE el dato y bajo los caminos, como en la cartografía impresa: oscurece
   las laderas en sombra sin cambiar el color de la clase.

   Viene de las mismas teselas NASADEM que el motor usa para el factor LS.
   Si el archivo no está, el mapa queda como antes.
   ------------------------------------------------------------------------- */

function agregarRelieve(mapa, punto) {
  let en3D = false, conImagen = false;
  const teselas = GTMapaReal.teselas;
  const listo = !teselas ? Promise.resolve(false)
    : teselas.disponible(RUTA_RELIEVE).then(function (r) {
        if (!r) return false;
        const fuente = { type: 'raster-dem', url: teselas.url(RUTA_RELIEVE),
                         tileSize: 512, encoding: 'mapbox' };
        /* Dos fuentes sobre el mismo archivo: MapLibre recomienda no
           compartir la del sombreado con la del terreno, porque cada una
           pide las teselas a una resolución distinta. */
        mapa.addSource('relieve', fuente);
        mapa.addSource('relieve-3d', Object.assign({}, fuente));
        mapa.addLayer({
          id: 'relieve-sombra', type: 'hillshade', source: 'relieve',
          paint: {
            /* 'igor' casi no sombrea lo plano: el valle central, donde se
               lee el dato, queda limpio, y el relieve aparece donde lo hay. */
            'hillshade-method': 'igor',
            'hillshade-exaggeration': 0.55,
            /* En oscuro la sombra es negra y la luz apenas perceptible:
               con luz blanca las laderas soleadas se leían como otra clase
               del coropleto. */
            'hillshade-shadow-color': PALETA.mapa.relieve.sombra,
            'hillshade-highlight-color': PALETA.mapa.relieve.luz,
            'hillshade-accent-color': PALETA.mapa.relieve.acento,
          },
        }, punto.bajoCaminos);
        // Por si se cambió a satelital mientras el archivo respondía.
        base(conImagen);
        return true;
      });

  /* La foto satelital ya trae sus sombras: encima, el sombreado las dobla. */
  function base(imagen) {
    conImagen = imagen;
    if (mapa.getLayer('relieve-sombra')) {
      mapa.setLayoutProperty('relieve-sombra', 'visibility', imagen ? 'none' : 'visible');
    }
  }

  function alternar3D(activar) {
    en3D = activar === undefined ? !en3D : activar;
    if (en3D) {
      mapa.setTerrain({ source: 'relieve-3d', exaggeration: 1.6 });
      try {
        /* Cielo y niebla en los tonos de la interfaz: la cordillera lejana
           se funde con el fondo de la página. */
        mapa.setSky(PALETA.mapa.cielo);
      } catch (e) { /* sin cielo el 3D funciona igual */ }
      mapa.easeTo({ pitch: 62, bearing: mapa.getBearing() || -18, duration: 900 });
    } else {
      mapa.setTerrain(null);
      mapa.easeTo({ pitch: 0, bearing: 0, duration: 700 });
    }
    return en3D;
  }

  return { listo: listo, base: base, alternar3D: alternar3D,
           en3D: function () { return en3D; } };
}

function boton3D(barra, relieve, contenedor) {
  const caja = document.createElement('div');
  caja.className = 'basectl';
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = '3D';
  b.title = 'Ver el relieve en 3D (arrastra con la rueda del mouse, o con clic derecho, para girar e inclinar)';
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', function () {
    const activo = relieve.alternar3D();
    b.setAttribute('aria-pressed', String(activo));
    if (activo) pistaOrbita(contenedor);
  });
  caja.appendChild(b);
  barra.appendChild(caja);
}

/* Al entrar al 3D, cómo mover la cámara: sin esto nadie sabe que existe. */
function pistaOrbita(contenedor) {
  if (!contenedor) return;
  let p = contenedor.querySelector('.map__pista3d');
  if (!p) {
    p = document.createElement('div');
    p.className = 'map__pista3d';
    contenedor.appendChild(p);
  }
  p.textContent = 'Arrastra con la rueda del mouse para girar e inclinar la cámara';
  p.classList.add('es-visible');
  clearTimeout(p._t);
  p._t = setTimeout(function () { p.classList.remove('es-visible'); }, 4200);
}

/* Girar e inclinar arrastrando con la rueda apretada, como en Google Earth:
   horizontal cambia el rumbo, vertical la inclinación (hacia arriba mira al
   horizonte). MapLibre lo hace con el clic derecho, que pocos conocen; la
   rueda es el gesto que la gente ya trae de Google Earth. */
function orbitaConRueda(mapa) {
  const zona = mapa.getCanvasContainer();
  let arrastre = null;
  zona.addEventListener('mousedown', function (e) {
    if (e.button !== 1) return;
    e.preventDefault();               // sin el desplazamiento automático de Windows
    arrastre = { x: e.clientX, y: e.clientY, rumbo: mapa.getBearing(), inclinacion: mapa.getPitch() };
    zona.classList.add('orbitando');
  });
  window.addEventListener('mousemove', function (e) {
    if (!arrastre) return;
    const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
    mapa.jumpTo({
      bearing: arrastre.rumbo + dx * 0.45,
      pitch: Math.max(0, Math.min(mapa.getMaxPitch(), arrastre.inclinacion - dy * 0.35)),
    });
  });
  window.addEventListener('mouseup', function (e) {
    if (e.button !== 1 || !arrastre) return;
    arrastre = null;
    zona.classList.remove('orbitando');
  });
  zona.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });
}

/* -------------------------------------------------------------------------
   Construcción del mapa
   ------------------------------------------------------------------------- */

GTMapaReal.crear = function (contenedor, opciones) {
  const cfg = Object.assign({ capa: 'erosion26', alSeleccionar: null, limites: true,
                             /* Se llama al volver a la región, por clic fuera
                                o por volverARegion(). */
                             alDeseleccionar: null,
                             soloComunas: null, zoomInicial: null,
                             alCambiarBase: null,
                             /* Selector del panel de filtros que acompaña al
                                mapa en pantalla completa. Sin él, la pantalla
                                completa muestra solo el mapa. */
                             panel: null, alCambiarPantalla: null,
                             /* false: el clic no abre comunas ni vuelve a la
                                región, y no hay ventana con el valor. Para
                                pantallas donde el clic marca otra cosa (Viajes
                                a terreno marca la salida y la llegada). */
                             interactivo: true }, opciones);
  let mapa = null, geo = null, seleccionada = null, opacidadBase = 0.82;
  /* La opacidad con que entra la base actual. El detalle a 30 m se atenúa en
     proporción a ella, no en absoluto: cambiar a satelital baja el coropleto
     al 45% pero no debe apagar el detalle, que ya es transparente donde no
     hay nada que ver. */
  let opacidadTema = 0.82;

  const lienzo = document.createElement('div');
  lienzo.className = 'map__canvas';
  lienzo.style.cssText = 'position:absolute;inset:0';
  contenedor.insertBefore(lienzo, contenedor.firstChild);
  contenedor.style.minHeight = contenedor.style.minHeight || '460px';

  return cargarMapLibre()
    .then(traerGeometrias)
    .then(function (datos) {
      /* Acota el mapa a un subconjunto, p. ej. la conurbación de Rancagua */
      if (cfg.soloComunas) {
        datos = Object.assign({}, datos, {
          features: datos.features.filter(function (f) {
            return cfg.soloComunas.indexOf(f.properties.nombre) !== -1;
          })
        });
      }
      geo = enriquecer(datos, cfg.capa);

      mapa = new maplibregl.Map({
        container: lienzo,
        style: ESTILO_BASE,
        center: CENTRO_OHIGGINS,
        zoom: 7.4,
        /* 85° deja mirar casi al horizonte en 3D; el valor por omisión (60)
           cortaba la vista de los valles cordilleranos. */
        maxPitch: 85,
        attributionControl: { compact: true },
      });
      orbitaConRueda(mapa);

      mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      mapa.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

      /* Se marca aquí y no al resolver la promesa: en este punto ya sabemos que
         la geometría llegó y que el mapa se construyó. Depender del evento
         'load' hacía que el aviso no apareciera si el estilo base tardaba. */
      marcarOrigen(contenedor, true);

      return new Promise(function (listo) {
        mapa.on('load', function () {
          mapa.addSource('comunas', { type: 'geojson', data: geo });

          entintarBase(mapa);
          const punto = puntosDeInsercion(mapa);

          /* Imagen satelital, al fondo de todo y apagada de entrada. Se deja
             creada desde el principio para que cambiar de base sea encender
             una capa y no reconstruir el estilo: setStyle() borra las capas
             temáticas y obligaría a rearmarlas cada vez. */
          mapa.addSource(ID_FUENTE_BASE, {
            type: 'raster',
            tiles: BASES.satelital.teselas,
            tileSize: 256,
            maxzoom: BASES.satelital.zoomMaximo,
            attribution: BASES.satelital.atribucion,
          });
          mapa.addLayer({
            id: ID_CAPA_BASE, type: 'raster', source: ID_FUENTE_BASE,
            layout: { visibility: 'none' },
            paint: { 'raster-fade-duration': 200 },
          }, punto.sobreElFondo);

          /* El coropleto va bajo los caminos: es el fondo temático sobre el
             que se leen calles, pueblos y ríos, no una tapa sobre el mapa. */
          mapa.addLayer({
            id: 'comunas-relleno', type: 'fill', source: 'comunas',
            paint: {
              'fill-color': ['get', '_color'],
              'fill-opacity': opacidadRelleno(opacidadBase, null),
            },
          }, punto.bajoCaminos);

          /* Ancla invisible sobre el coropleto. El detalle por píxel se
             inserta bajo ella y el sombreado del relieve, que llega después
             (su archivo se consulta primero), sobre ella: así el orden queda
             coropleto → detalle → relieve → caminos, sin importar cuál de
             los dos termina de cargar antes. */
          mapa.addLayer({ id: ID_ANCLA, type: 'background',
                          layout: { visibility: 'none' } }, punto.bajoCaminos);

          /* Los límites sí van sobre los caminos —son la unidad de análisis—,
             pero bajo las etiquetas, para no borrar los nombres de ciudad. */
          /* Límite neutro y fino: separa comunas vecinas de la misma clase
             sin competir con el dato. */
          mapa.addLayer({
            id: 'comunas-borde', type: 'line', source: 'comunas',
            paint: {
              'line-color': PALETA.mapa.borde,
              'line-width': cfg.limites ? 0.9 : 0,
            },
          }, punto.bajoEtiquetas);

          /* Comuna seleccionada: una línea sobre un casco de color opuesto
             —blanca sobre casco oscuro en el tema oscuro, al revés en el
             claro—, como en la cartografía impresa. El casco la separa del
             relleno sea cual sea su color; sola, se perdía sobre las clases
             de su mismo tono. */
          mapa.addLayer({
            id: 'comunas-activa-casco', type: 'line', source: 'comunas',
            filter: ['==', 'nombre', ''],
            paint: { 'line-color': PALETA.mapa.casco, 'line-width': 5 },
          }, punto.bajoEtiquetas);
          mapa.addLayer({
            id: 'comunas-activa', type: 'line', source: 'comunas',
            filter: ['==', 'nombre', ''],
            paint: { 'line-color': PALETA.mapa.seleccion, 'line-width': 2.2 },
          }, punto.bajoEtiquetas);

          /* Encuadre exacto sobre las geometrías, sin coordenadas fijas */
          function limitesRegion() {
            const b = new maplibregl.LngLatBounds();
            geo.features.forEach(function (f) {
              const anillos = f.geometry.type === 'MultiPolygon'
                ? f.geometry.coordinates.flat() : f.geometry.coordinates;
              anillos.forEach(function (a) { a.forEach(function (p) { b.extend(p); }); });
            });
            return b;
          }
          mapa.fitBounds(limitesRegion(), { padding: 28, duration: 0 });

          /* Detalle intracomunal: al hacer clic se hace zoom y se superpone
             el mapa de erosión a 30 m. Es opcional — si los rásteres no
             están, el visor se comporta como antes. */
          /* `detalle: true` sigue siendo erosión; un texto elige otra
             variable; una lista conecta una por capa (el visor: erosión,
             NDVI y pendiente) y enciende la primera. `detalle` es siempre la
             encendida; activarDetalle(variable) cambia de una a otra. */
          const variablesDetalle = !cfg.detalle ? []
            : Array.isArray(cfg.detalle) ? cfg.detalle
            : [typeof cfg.detalle === 'string' ? cfg.detalle : 'erosion'];
          const detalles = {};
          if (typeof GTDetalle !== 'undefined') {
            variablesDetalle.forEach(function (v, i) {
              detalles[v] = GTDetalle.conectar(mapa, contenedor, ID_ANCLA, v, {
                activo: i === 0,
                /* Con teselas el detalle cubre la región entera y aparece al
                   acercarse: el coropleto tiene que ceder con el zoom. */
                alMontar: function () { pintarSeleccion(); },
              });
            });
          }
          let detalle = detalles[variablesDetalle[0]] || null;
          let detalleActivo = true;

          const relieve = agregarRelieve(mapa, punto);

          /* Sobre la foto los límites finos desaparecen y las etiquetas
             pierden contraste. Se refuerzan al encender la imagen y se
             devuelven al apagarla. El halo sale del tema (PALETA.mapa): Dark
             Matter escribe en claro y necesita halo oscuro; Positron, al
             revés. Con un halo fijo, uno de los dos quedaba ilegible al
             volver del satelital. */
          function ajustarParaImagen(conImagen) {
            punto.fondosOpacos.forEach(function (id) {
              if (mapa.getLayer(id)) {
                mapa.setLayoutProperty(id, 'visibility', conImagen ? 'none' : 'visible');
              }
            });
            mapa.getStyle().layers.forEach(function (c) {
              if (c.type !== 'symbol' || c.id === ID_CAPA_BASE) return;
              if (!mapa.getLayer(c.id)) return;
              try {
                mapa.setPaintProperty(c.id, 'text-halo-width', conImagen ? 2 : 1.2);
                mapa.setPaintProperty(c.id, 'text-halo-color',
                                      conImagen ? PALETA.mapa.haloImagen : PALETA.mapa.halo);
              } catch (e) { /* capas sin texto: se ignoran */ }
            });
            mapa.setPaintProperty('comunas-borde', 'line-width',
                                  cfg.limites ? (conImagen ? 1.3 : 0.9) : 0);
            mapa.setPaintProperty('comunas-borde', 'line-color',
                                  conImagen ? PALETA.mapa.bordeImagen
                                            : PALETA.mapa.borde);
          }

          function cambiarBase(id) {
            const base = BASES[id] || BASES.mapa;
            const conImagen = id === 'satelital';
            mapa.setLayoutProperty(ID_CAPA_BASE, 'visibility',
                                   conImagen ? 'visible' : 'none');
            ajustarParaImagen(conImagen);
            relieve.base(conImagen);
            /* Cada base entra con la opacidad que la hace legible: sobre foto
               oscura el coropleto al 82% tapa la imagen. */
            opacidadBase = base.opacidadTema;
            opacidadTema = base.opacidadTema;
            pintarSeleccion();
            /* Se avisa a la página para que sus propios controles —el
               deslizador de opacidad del visor— no queden desfasados. */
            if (cfg.alCambiarBase) cfg.alCambiarBase(id, base);
            return base;
          }

          const barra = barraDeControles(contenedor);
          const marcarBase = conmutadorDeBase(barra, cambiarBase);

          /* La pantalla completa se ofrece solo si el navegador la soporta:
             mejor no mostrar un botón que no hace nada. */
          let marcarPantalla = null;
          const completa = pantallaCompleta(contenedor, mapa, cfg.panel,
            function (dentro) {
              if (marcarPantalla) marcarPantalla(dentro);
              if (cfg.alCambiarPantalla) cfg.alCambiarPantalla(dentro);
            });
          if (completa) marcarPantalla = botonPantallaCompleta(barra, completa);
          // El botón aparece solo si hay relieve que levantar.
          relieve.listo.then(function (hay) { if (hay) boton3D(barra, relieve, contenedor); });

          function pintarSeleccion() {
            mapa.setFilter('comunas-activa', ['==', 'nombre', seleccionada || '']);
            mapa.setFilter('comunas-activa-casco', ['==', 'nombre', seleccionada || '']);
            const conDetalle = !!(detalle && detalleActivo && detalle.disponible());
            mapa.setPaintProperty('comunas-relleno', 'fill-opacity',
                                  opacidadRelleno(opacidadBase, seleccionada,
                                                  conDetalle && detalle.continuo(), conDetalle));
            // A todos, no solo al encendido: al cambiar de capa entra con la misma.
            Object.keys(detalles).forEach(function (v) {
              detalles[v].opacidad(Math.min(1, opacidadBase / opacidadTema));
            });
          }

          /* Abre una comuna como el clic, desde fuera del mapa: el buscador
             y el enlace compartido de inundaciones. */
          function abrirComuna(nombre) {
            const c = GT.comunas.find(function (x) { return x.nombre === nombre; });
            if (!c) return false;
            seleccionada = nombre;
            pintarSeleccion();
            if (cfg.alSeleccionar) cfg.alSeleccionar(c);
            if (detalle && detalleActivo && detalle.disponible()) detalle.mostrar(c);
            return true;
          }

          mapa.on('click', 'comunas-relleno', function (e) {
            if (!cfg.interactivo) return;
            const p = e.features[0].properties;
            /* Un clic dentro de la comuna ya abierta no la vuelve a abrir
               —el encuadre saltaba—: si la página quiere, es para mirar esa
               celda. */
            if (p.nombre === seleccionada && cfg.alClicEnAbierta) {
              cfg.alClicEnAbierta(e.lngLat);
              return;
            }
            seleccionada = p.nombre;
            pintarSeleccion();
            const c = GT.comunas.find(function (x) { return x.nombre === p.nombre; });
            if (cfg.alSeleccionar && c) cfg.alSeleccionar(c);
            if (detalle && c && detalleActivo && detalle.disponible()) detalle.mostrar(c);
          });

          /* Vuelta a la vista regional. La usan el clic fuera de las comunas
             y, en el visor, el botón que cierra la ficha de la comuna. */
          function volverARegion() {
            seleccionada = null;
            pintarSeleccion();
            // Apagado, ocultar() volvería a poner la pista de "haz clic".
            if (detalle && detalleActivo) detalle.ocultar();
            if (cfg.alDeseleccionar) cfg.alDeseleccionar();
            mapa.fitBounds(limitesRegion(), { padding: 28, duration: 500 });
          }

          mapa.on('click', function (e) {
            const encima = mapa.queryRenderedFeatures(e.point,
                                                      { layers: ['comunas-relleno'] });
            if (!encima.length && cfg.interactivo) volverARegion();
          });

          mapa.on('mouseenter', 'comunas-relleno', function () {
            if (!cfg.interactivo) return;
            mapa.getCanvas().style.cursor = 'pointer';
          });
          mapa.on('mouseleave', 'comunas-relleno', function () {
            if (!cfg.interactivo) return;
            mapa.getCanvas().style.cursor = '';
          });

          const emergente = new maplibregl.Popup({
            closeButton: false, closeOnClick: false, offset: 10,
          });
          /* Además del valor comunal se dice qué hay en la celda bajo el
             cursor. Es lo que responde "¿esto de aquí es grave?" sin tener
             que comparar colores contra la leyenda a ojo. Con teselas el
             dato es el valor exacto y está en toda la región; con los PNG,
             la clase y solo en la comuna abierta. */
          let ultimo = null;
          /* `props` viaja aparte porque MapLibre borra e.features al terminar
             el evento: cuando la tesela terminaba de decodificarse y se
             repintaba la ventana, e.features ya no existía y fallaba. */
          function pintarEmergente(e, props) {
            ultimo = e;
            const p = props || e.features[0].properties;
            const celda = (detalle && detalleActivo)
              ? detalle.claseEn(e.lngLat, function () { if (ultimo === e) pintarEmergente(e, p); })
              : null;
            // Coma decimal y punto de miles, igual que la celda y el resto del sitio.
            const valorComuna = typeof p._valor === 'number'
              ? p._valor.toLocaleString('es-CL', { maximumFractionDigits: 2 }) : p._valor;
            emergente.setLngLat(e.lngLat).setHTML(
              '<strong>' + p.nombre + '</strong><br>' +
              (p._valor !== undefined ? valorComuna + ' ' + (p._unidad || '') : 'sin dato') +
              (p._nota ? ' <span class="muted">· ' + p._nota + '</span>' : '') +
              (celda ? ' <span class="muted">· comuna</span>' +
                '<div class="emergente__celda"><i style="background:' + celda.color + '"></i>' +
                '<span>' + celda.etiqueta + ': ' +
                (celda.valor
                  ? '<strong>' + celda.valor + '</strong> · ' + celda.nombre
                  : '<strong>' + celda.nombre + '</strong>' + (celda.rango ? ' · ' + celda.rango : '')) +
                '</span></div>' : '')
            ).addTo(mapa);
          }
          if (cfg.interactivo) {
            mapa.on('mousemove', 'comunas-relleno', pintarEmergente);
            mapa.on('mouseleave', 'comunas-relleno', function () { emergente.remove(); });
          }

          listo({
            cambiarCapa: function (capa) {
              cfg.capa = capa;
              mapa.getSource('comunas').setData(enriquecer(geo, capa));
              /* La ventana abierta describe la capa anterior —decía
                 "20,91 t/ha/año" sobre el índice de pertinencia— y no se
                 renueva hasta mover el cursor. Se cierra. */
              emergente.remove();
            },
            cambiarLimites: function (v) {
              mapa.setPaintProperty('comunas-borde', 'line-width', v ? 0.9 : 0);
            },
            cambiarEtiquetas: function () { /* las aporta el mapa base */ },
            /* El deslizador atenúa el coropleto para leer el mapa base debajo.
               Antes apuntaba al <svg> del mapa esquemático, que con cartografía
               real no existe: mover el control no hacía nada. */
            cambiarOpacidad: function (v) {
              opacidadBase = Math.max(0, Math.min(1, v));
              pintarSeleccion();
            },
            /* Alterna entre el mapa claro y la imagen de Sentinel-2. Caminos,
               nombres de ciudad y límites siguen encima en ambos: es la vista
               híbrida, que es la que sirve para mirar una comuna de cerca.
               Marca también el conmutador del mapa, para que el panel lateral
               del visor y los botones no queden diciendo cosas distintas. */
            cambiarBase: function (id) {
              const base = cambiarBase(id);
              marcarBase(id);
              return base;
            },
            bases: BASES,
            /* El detalle por píxel vale para una capa, no para todas: en
               Ciudades existe para la temperatura y no para el área verde. */
            /* `v`: true/false enciende o apaga el detalle actual; el nombre
               de una variable conectada cambia a esa (y lo enciende). */
            activarDetalle: function (v) {
              const siguiente = typeof v === 'string' ? detalles[v] : detalle;
              const encender = typeof v === 'string' ? !!siguiente : !!v;
              if (!detalle && !siguiente) return;
              if (siguiente === detalle && encender === detalleActivo) return;

              if (detalle && detalleActivo) detalle.pausar();
              if (siguiente) detalle = siguiente;
              detalleActivo = encender;
              if (encender) {
                detalle.reanudar();
                /* Si había una comuna abierta vuelve su resumen, sin mover la
                   cámara: cambiar de capa no es pedir otro encuadre. */
                const c = seleccionada &&
                  GT.comunas.find(function (x) { return x.nombre === seleccionada; });
                if (c && detalle.disponible()) detalle.mostrar(c, { encuadrar: false });
              }
              pintarSeleccion();
            },
            pantallaCompleta: function () { if (completa) completa.alternar(); },
            seleccionar: function (nombre) {
              seleccionada = nombre || null;
              pintarSeleccion();
            },
            abrirComuna: abrirComuna,
            seleccionada: function () { return seleccionada; },
            volverARegion: volverARegion,
            /* El controlador del detalle por píxel: el de la variable pedida o
               el encendido. La página lo usa para el umbral y las localidades. */
            detalle: function (variable) {
              return variable ? (detalles[variable] || null) : detalle;
            },
            instancia: mapa,
          });
        });
      });
    });
};

/* -------------------------------------------------------------------------
   Punto de entrada con retroceso al mapa esquemático
   ------------------------------------------------------------------------- */

GTMapaReal.crearConRespaldo = function (contenedor, opciones) {
  return GTMapaReal.crear(contenedor, opciones)
    .catch(function (e) {
      console.warn('[mapa-real] usando el mapa esquemático:', e.message);
      const lienzo = contenedor.querySelector('.map__canvas');
      if (lienzo) lienzo.remove();
      marcarOrigen(contenedor, false);
      return GTMapa.crearRegional(contenedor, opciones);
    });
};

function marcarOrigen(contenedor, esReal) {
  const previo = contenedor.querySelector('.map__origen');
  if (previo) previo.remove();
  const chip = document.createElement('div');
  /* La posición sale de la clase y no de un style en línea: en pantalla
     completa hay que correr estos avisos para que el panel de filtros no los
     tape, y un style en línea gana siempre sobre la hoja de estilos. */
  chip.className = 'map__overlay map__overlay--tl map__origen';
  chip.style.cssText = 'font-size:11px;font-weight:400;z-index:2';

  let texto;
  if (!esReal) {
    texto = '<strong>Cartografía esquemática</strong> · sin geometrías disponibles';
  } else if (origenGeometrias === 'api') {
    texto = '<strong>Geometrías reales</strong> · en vivo desde PostGIS';
  } else {
    texto = '<strong>Geometrías reales</strong> · copia estática de IDE Chile';
  }
  chip.innerHTML = texto;
  contenedor.appendChild(chip);
}
