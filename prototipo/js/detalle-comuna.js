/* ==========================================================================
   TerraFoco — Detalle intracomunal de erosión
   Al hacer clic en una comuna, el visor hace zoom y superpone el mapa de
   erosión calculado a 30 metros. Es la escala a la que decide el programa:
   el SIRSD-S bonifica predios, no comunas.

   El promedio comunal esconde justamente lo que hay que focalizar. Pichilemu
   tiene una mediana de 0,13 t/ha/año y un decil superior de 14,4: vista como
   comuna parece un problema menor, pero adentro hay laderas con cien veces
   más erosión que el terreno típico.

   Las capas son PNG ya reproyectados a coordenadas geográficas, así que
   MapLibre solo tiene que colocarlos por sus cuatro esquinas. No hace falta
   servidor: funcionan con el prototipo abierto desde el disco.
   ========================================================================== */

const GTDetalle = {};

/* Una configuración por variable con detalle a 30 m. Erosión (módulo 1) e
   inundación (módulo 2) comparten TODO el mecanismo —PNG por comuna, índice
   json/js, panel con leyenda— y solo cambian ruta, rampa, clases y unidad.
   La leyenda se arma desde la MISMA paleta que ya usa el prototipo, y el
   motor colorea el PNG con esos mismos valores: dos leyendas con colores
   distintos para las mismas clases confunden mas que no tener ninguna.

   `alfas` es la opacidad de cada clase al redibujar el PNG. La clase más baja
   va casi transparente a propósito: es la mayor parte del territorio
   —dos tercios de Pichidegua— y pintada de crema tapaba caminos, casas y la
   imagen satelital justo donde no hay nada que focalizar. El dato que importa
   son las clases altas, y esas van casi opacas. */
/* Formato de un valor para la ventana emergente: coma decimal, como el resto
   del prototipo. */
function coma(v, decimales) {
  // GT.fmt (data.js): coma decimal y punto de miles, como todo el sitio.
  return typeof GT !== 'undefined' && GT.fmt ? GT.fmt(v, decimales)
                                             : v.toFixed(decimales).replace('.', ',');
}

/* `teselas` es el archivo de valores de motor/teselas.py; si existe, el
   detalle deja de ser un PNG por comuna y pasa a cubrir la región entera
   (ver "Modo continuo" más abajo). `cortesInclusivos`: en qué clase cae un
   valor exactamente igual a un corte. El motor de erosión cierra por arriba
   (a <= corte); el de inundación y el de calor, por abajo (searchsorted). */
const VARIABLES = {
  erosion: {
    ruta: 'datos/erosion/',
    teselas: 'datos/teselas/erosion.pmtiles',
    cortesInclusivos: true,
    formato: function (v) { return coma(v, 1) + ' t/ha/año'; },
    global: 'TERRAFOCO_EROSION',          // incrustado por indice.js
    rampa: 'erosion',
    clases: ['Ligera', 'Moderada', 'Severa', 'Muy severa', 'Extrema'],
    // Mismos cortes que RAMPA en motor/mapa_erosion.py y que la leyenda.
    rangos: ['0 – 10', '10 – 18', '18 – 26', '26 – 34', '34 +'],
    unidad: 't/ha/año',
    alfas: [0.10, 0.50, 0.78, 0.90, 0.95],
    // Se descarga desde "Severa": lo que se lleva a terreno es lo crítico.
    exportarDesde: 2,
    titulo: 'erosión a 30 m',
    resumen: function (f) {
      return 'mediana ' + coma(f.mediana, 1) + ' · decil superior ' +
             coma(f.p90, 1) + ' t/ha/año';
    },
  },
  inundacion: {
    ruta: 'datos/inundacion/',
    teselas: 'datos/teselas/inundacion.pmtiles',
    cortesInclusivos: false,
    formato: function (v) { return 'índice ' + coma(v, 2); },
    global: 'TERRAFOCO_INUNDACION',
    rampa: 'agua',
    rampaDesde: 1,                        // el primer tono es fondo, no clase
    clases: ['Baja', 'Media', 'Alta', 'Muy alta'],
    // Cuartiles del índice regional: no hay unidad física que mostrar.
    rangos: null,
    unidad: '',
    /* Lo que hay que ver son las clases altas: por dónde se concentra el
       agua. Con Media al 50 % y Alta al 85 %, en tonos vecinos del mismo
       azul, las cuatro clases —cuartiles, un cuarto del territorio cada
       una— se leían como un solo manto azul. Baja casi no se pinta y Media
       apenas: así aparece la red de drenaje. */
    alfas: [0.04, 0.22, 0.78, 1],
    /* Umbral ajustable (qué se marca como riesgo) y ciudades y pueblos de la
       comuna. Ver "Umbral" y "Localidades" en GTDetalle.conectar. */
    umbral: true,
    localidades: true,
    pistaClic: 'clic dentro de la comuna: por qué esa celda tiene su valor',
    // Ya filtrado por el umbral: se descarga lo que está marcado.
    exportarDesde: 0,
    titulo: 'susceptibilidad a 30 m',
    resumen: function (f) {
      const alta = f.fraccion
        ? Math.round(100 * (f.fraccion['Alta'] + f.fraccion['Muy alta'])) : null;
      return 'índice medio ' + coma(f.media, 2) +
             (alta !== null ? ' · ' + alta + '% del territorio en Alta o superior' : '') +
             (f.escenario ? '<br><strong>Con los pesos del escenario</strong>, no los calibrados' : '');
    },
  },
  /* Módulo 3. ECOSTRESS mide a 70 m, no a 30: el título lo dice para que
     nadie compare celdas entre módulos como si fueran del mismo tamaño. Los
     cortes son grados absolutos y los trae el índice (motor/mapa_calor.py). */
  calor: {
    ruta: 'datos/calor/',
    teselas: 'datos/teselas/calor.pmtiles',
    cortesInclusivos: false,
    formato: function (v) { return coma(v, 1) + ' °C'; },
    global: 'TERRAFOCO_CALOR',
    rampa: 'calor',
    clases: ['Fresca', 'Templada', 'Cálida', 'Muy cálida', 'Extrema'],
    rangos: ['< 22', '22 – 25', '25 – 28', '28 – 31', '31 +'],
    unidad: '°C',
    alfas: [0.10, 0.45, 0.72, 0.88, 0.95],
    titulo: 'temperatura a 70 m',
    celda: 'Celda de 70 m',
    resumen: function (f) {
      const c = f.cobertura < 0.95
        ? ' · la imagen cubre el ' + Math.round(100 * f.cobertura) + '% de la comuna' : '';
      return 'superficie media ' + coma(f.media, 1) +
             ' °C · el 10% más caliente supera ' + coma(f.p90, 1) + ' °C' + c;
    },
  },
};

/* NDVI y pendiente existen solo en teselas: no tienen PNG por comuna
   (`ruta: null`). Sin teselas —file://— estas capas quedan en su promedio
   comunal y el visor no ofrece un detalle que no puede mostrar. Clases,
   rangos y rampa son los de GTMapa.clases (mapa.js), los mismos del
   promedio comunal, para que la leyenda sea una sola. */
function clasesDe(clave) {
  return (typeof GTMapa !== 'undefined' && GTMapa.clases) ? GTMapa.clases[clave] : null;
}
function fraccionDe(f, nombres) {
  return nombres.reduce(function (s, n) { return s + ((f.fraccion && f.fraccion[n]) || 0); }, 0);
}

VARIABLES.ndvi = {
  ruta: null,
  teselas: 'datos/teselas/ndvi.pmtiles',
  cortesInclusivos: false,
  formato: function (v) { return 'NDVI ' + coma(v, 2); },
  rampa: (clasesDe('ndvi') || {}).rampa || 'vegetacion',
  clases: (clasesDe('ndvi') || {}).nombres || ['Sin vegetación', 'Escasa', 'Moderada', 'Densa', 'Muy densa'],
  rangos: (clasesDe('ndvi') || {}).rangos || null,
  unidad: '',
  /* Aquí la clase baja también cuenta —suelo desnudo es lo que la lluvia
     arrastra—, así que no va casi transparente como en erosión. */
  alfas: [0.35, 0.55, 0.72, 0.85, 0.92],
  titulo: 'cobertura vegetal a 30 m',
  resumen: function (f) {
    return 'NDVI mediano ' + coma(f.mediana, 2) + ' · ' +
           Math.round(100 * fraccionDe(f, ['Sin vegetación', 'Escasa'])) +
           '% sin vegetación o escasa';
  },
};

VARIABLES.pendiente = {
  ruta: null,
  teselas: 'datos/teselas/pendiente.pmtiles',
  cortesInclusivos: false,
  formato: function (v) { return coma(v, 0) + ' %'; },
  rampa: (clasesDe('pendiente') || {}).rampa || 'pendiente',
  clases: (clasesDe('pendiente') || {}).nombres || ['Plana', 'Suave', 'Moderada', 'Fuerte', 'Muy fuerte'],
  rangos: (clasesDe('pendiente') || {}).rangos || null,
  unidad: '',
  // Lo plano es la mayor parte del valle y no es lo que se busca: transparente.
  alfas: [0.06, 0.4, 0.62, 0.8, 0.9],
  exportarDesde: 3,              // fuerte y muy fuerte
  titulo: 'pendiente a 30 m',
  resumen: function (f) {
    return 'pendiente mediana ' + coma(f.mediana, 0) + ' % · ' +
           Math.round(100 * fraccionDe(f, ['Fuerte', 'Muy fuerte'])) +
           '% sobre 30 %';
  },
};

/* Los colores con que el motor codificó las clases en el PNG, con el mismo
   corte inicial que la rampa de pantalla. Null si la variable no viene en
   PNG del motor (sus teselas guardan valores, no colores). */
function codificacionDe(cfg) {
  if (typeof PALETA === 'undefined' || !PALETA.codificacion) return null;
  const c = PALETA.codificacion[cfg.rampa];
  return c ? c.slice(cfg.rampaDesde || 0) : null;
}

function tramosDe(cfg) {
  if (typeof PALETA === 'undefined' || !PALETA.rampas) return [];
  const colores = PALETA.rampas[cfg.rampa].slice(cfg.rampaDesde || 0);
  return cfg.clases.map(function (nombre, i) {
    return { nombre: nombre, color: colores[i],
             rango: cfg.rangos ? cfg.rangos[i] : null };
  });
}

/* Cortes entre clases que trae el índice de PNG (inundación: cortes_pixel),
   para ofrecer el umbral también sin teselas. */
const cortesDeIndice = {};

/* Caché por variable: id_comuna -> ficha, y la promesa en curso. */
const indices = {};
const cargas = {};

function indexar(variable, d) {
  const idx = {};
  (d.comunas || []).forEach(function (c) { idx[c.id_comuna] = c; });
  indices[variable] = idx;
  return idx;
}

function traerIndice(variable) {
  const cfg = VARIABLES[variable];
  if (indices[variable]) return Promise.resolve(indices[variable]);
  // Variables solo en teselas: no hay índice de PNG que pedir.
  if (!cfg.ruta) { indices[variable] = {}; return Promise.resolve(indices[variable]); }
  if (cargas[variable]) return cargas[variable];

  cargas[variable] = fetch(cfg.ruta + 'indice.json')
    .then(function (r) {
      if (!r.ok) throw new Error('sin indice de erosion (' + r.status + ')');
      return r.json();
    })
    .then(function (d) {
      cortesDeIndice[variable] = d.cortes_pixel || d.cortes || null;
      const idx = indexar(variable, d);
      console.info('[detalle] %d comunas con mapa de %s (fetch)',
                   Object.keys(idx).length, variable);
      return idx;
    })
    .catch(function (e) {
      /* Incrustado por <script>: la unica via que sobrevive a file://, igual
         que datos/comunas.js para las geometrias. Sin esto, abrir el
         prototipo con doble clic dejaba el detalle sin funcionar: fetch()
         no puede leer archivos locales desde file://. */
      if (window[cfg.global]) {
        const idx = indexar(variable, window[cfg.global]);
        console.info('[detalle] %d comunas con mapa de %s (incrustado)',
                     Object.keys(idx).length, variable);
        return idx;
      }
      // Sin detalle el visor sigue funcionando: es una capa extra, no un
      // requisito. Se informa y se sigue.
      console.info('[detalle] %s no disponible: %s', variable, e.message);
      indices[variable] = {};
      return indices[variable];
    });
  return cargas[variable];
}

/* El prototipo identifica comunas por nombre; el motor, por código INE. */
function fichaDe(idx, comuna) {
  if (!idx) return null;
  const claves = Object.keys(idx);
  for (let i = 0; i < claves.length; i++) {
    const f = idx[claves[i]];
    if (normalizar(f.nombre) === normalizar(comuna.nombre)) return f;
  }
  return null;
}

function normalizar(t) {
  return String(t || '').normalize('NFD')
    .replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const ID_FUENTE = 'detalle-fuente';
const ID_CAPA = 'detalle-capa';
/* La vista refinada usa dos pares fuente/capa que se turnan: el nuevo se
   monta encima del anterior y recién entonces se quita aquel, así el
   cambio al detenerse el mapa no parpadea. */
const IDS_VISTA = ['detalle-vista-a', 'detalle-vista-b'];

function quitarCapa(mapa) {
  IDS_VISTA.map(function (id) { return id + '-capa'; }).concat([ID_CAPA])
    .forEach(function (id) { if (mapa.getLayer(id)) mapa.removeLayer(id); });
  IDS_VISTA.concat([ID_FUENTE])
    .forEach(function (id) { if (mapa.getSource(id)) mapa.removeSource(id); });
}

/* --------------------------------------------------------------------------
   El PNG como dato y no solo como imagen

   El motor pinta cada clase con su color exacto de la paleta, así que el
   color de un píxel ES su clase. Leyéndolo de vuelta se recupera la clase
   de cada celda de 30 m sin pedirle nada más al servidor, y con eso el visor
   puede decir qué hay bajo el cursor, cuánto territorio cae en cada clase y
   ocultar las que no interesan.

   Desde file:// el navegador no deja leer los píxeles de una imagen local
   (el lienzo queda "contaminado"). Ahí se devuelve null y el visor muestra
   el PNG tal cual, como antes: se pierde la interacción, no el mapa.
   -------------------------------------------------------------------------- */

const SIN_DATO = 255;

function hexARgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* `codigo` son los colores con que el motor escribió cada clase; `dibujo`,
   los del tema con que se vuelve a pintar. Van separados a propósito: ver
   PALETA.codificacion. */
function leerClases(url, codigo, dibujo) {
  const rgb = codigo.map(hexARgb);
  return new Promise(function (ok) {
    const img = new Image();
    img.onload = function () {
      try {
        const ancho = img.naturalWidth, alto = img.naturalHeight;
        const lienzo = document.createElement('canvas');
        lienzo.width = ancho; lienzo.height = alto;
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, ancho, alto).data;   // falla en file://

        const clases = new Uint8Array(ancho * alto).fill(SIN_DATO);
        const conteo = codigo.map(function () { return 0; });
        /* Casi todos los píxeles calzan exacto con un color de la rampa. La
           caché evita buscar el más cercano para cada uno de los que no. */
        const cache = {};
        rgb.forEach(function (c, k) { cache[(c[0] << 16) | (c[1] << 8) | c[2]] = k; });

        for (let i = 0, p = 0; i < clases.length; i++, p += 4) {
          if (px[p + 3] === 0) continue;
          const clave = (px[p] << 16) | (px[p + 1] << 8) | px[p + 2];
          let k = cache[clave];
          if (k === undefined) {
            let mejor = Infinity;
            rgb.forEach(function (c, j) {
              const d = (c[0] - px[p]) * (c[0] - px[p]) +
                        (c[1] - px[p + 1]) * (c[1] - px[p + 1]) +
                        (c[2] - px[p + 2]) * (c[2] - px[p + 2]);
              if (d < mejor) { mejor = d; k = j; }
            });
            cache[clave] = k;
          }
          clases[i] = k;
          conteo[k]++;
        }
        ok({ ancho: ancho, alto: alto, clases: clases, conteo: conteo,
             lienzo: lienzo, rgb: (dibujo || codigo).map(hexARgb) });
      } catch (e) {
        console.info('[detalle] sin lectura de píxeles (%s); PNG sin interacción', e.message);
        ok(null);
      }
    };
    img.onerror = function () { ok(null); };
    img.src = url;
  });
}

/* Redibuja con la opacidad de cada clase y solo las visibles. Devuelve una
   URL de datos para ImageSource.updateImage. */
function pintar(datos, alfas, visibles) {
  const ctx = datos.lienzo.getContext('2d');
  const salida = ctx.createImageData(datos.ancho, datos.alto);
  const d = salida.data;
  const a = alfas.map(function (x) { return Math.round(x * 255); });
  for (let i = 0, p = 0; i < datos.clases.length; i++, p += 4) {
    const k = datos.clases[i];
    if (k === SIN_DATO || !visibles[k]) continue;
    const c = datos.rgb[k];
    d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = a[k];
  }
  ctx.putImageData(salida, 0, 0);
  return datos.lienzo.toDataURL('image/png');
}

/* --------------------------------------------------------------------------
   Bordes refinados al acercar

   La celda de cálculo mide 30 m (70 en calor). Acercado a una comuna, cada
   celda ocupa decenas de píxeles de pantalla: dibujada nítida es un mosaico
   de cuadrados, y suavizada con el color es una mancha. Interpolar el VALOR
   tampoco sirve —ver montarContinua—: entre una celda Ligera y una Extrema
   pinta anillos de clases que ahí no existen.

   Aquí se suaviza el BORDE de cada clase, no el valor: cada punto toma, de
   las celdas que lo rodean, la clase con más peso. Los bordes pasan a ser
   curvas y cada punto pintado es siempre la clase de una celda de su
   vecindario inmediato: no se inventa ninguna. El borde de la comuna —el
   "sin dato"— se suaviza igual. Los porcentajes del panel siguen saliendo
   de las celdas, no de lo dibujado.

   Y se calcula a la resolución de la PANTALLA, para lo que se está viendo:
   un punto por píxel. Con un factor fijo (×2, ×4) siempre había un zoom
   desde el que volvían a verse cuadrados. Al detenerse el mapa se recalcula
   —uno o dos millones de puntos, cosa de 50 a 100 ms en un Web Worker, fuera
   del hilo de la página—; mientras se mueve, se estira la vista anterior.
   -------------------------------------------------------------------------- */

const PUNTOS_VISTA = 12e6;         // tope de puntos por vista
const LADO_MAXIMO = 4096;          // tope de textura que aceptan todas las tarjetas
const CELDA_MINIMA_PX = 1.5;       // bajo esto la celda ya no se distingue: sin refinar
const MARGEN_VISTA = 0.3;          // se refina un 30 % más allá del borde, para desplazar

/* Cada punto suma, por clase, el peso de las 16 celdas que lo rodean
   (4 × 4, peso gaussiano por distancia al centro de cada celda) y toma la
   clase de más peso. Con solo las 4 vecinas y peso bilineal, cuando las
   cuatro eran de clases distintas —en inundación pasa todo el tiempo: el
   índice cambia en cada celda siguiendo el drenaje— ganaba la más cercana, y
   eso es dibujar cuadrados otra vez.

   σ se eligió midiendo, no a ojo. Con σ = 0,35 celda: una celda aislada
   conserva el 86 % de su área, un bloque de 2 × 2 el 96 %, las esquinas
   salen redondeadas y dos celdas en diagonal quedan unidas —así un cauce
   se lee como línea—. Con 0,5 la celda aislada bajaba al 37 % y la diagonal
   se cortaba: justo las celdas sueltas de riesgo alto se veían más chicas
   de lo que son. */
const SIGMA_CELDAS = 0.35;

const CODIGO_REFINADOR = [
  'self.onmessage = function (e) {',
  '  var d = e.data, w = d.ancho, h = d.alto, src = d.clases;',
  '  var W = d.W, H = d.H, sx = d.nx / W, sy = d.ny / H, S = 2 * d.sigma * d.sigma;',
  '  var ci = new Int32Array(W * 4), cw = new Float32Array(W * 4);',
  '  for (var X = 0; X < W; X++) {',
  '    var u = d.x0 + (X + 0.5) * sx - 0.5, i = Math.floor(u);',
  '    for (var k = 0; k < 4; k++) {',
  '      var c = i + k - 1, dx = u - c;',
  '      cw[X * 4 + k] = Math.exp(-dx * dx / S);',
  '      ci[X * 4 + k] = c < 0 ? 0 : c > w - 1 ? w - 1 : c;',
  '    }',
  '  }',
  '  var rf = new Int32Array(4), rw = new Float32Array(4), acc = new Float32Array(8);',
  '  var out = new Uint8Array(W * H);',
  '  for (var Y = 0; Y < H; Y++) {',
  '    var v = d.y0 + (Y + 0.5) * sy - 0.5, j = Math.floor(v);',
  '    for (var q = 0; q < 4; q++) {',
  '      var r = j + q - 1, dy = v - r;',
  '      rw[q] = Math.exp(-dy * dy / S);',
  '      rf[q] = (r < 0 ? 0 : r > h - 1 ? h - 1 : r) * w;',
  '    }',
  '    for (var X2 = 0; X2 < W; X2++) {',
  '      acc[0] = acc[1] = acc[2] = acc[3] = acc[4] = acc[5] = acc[6] = acc[7] = 0;',
  '      var o = X2 * 4;',
  '      for (var a = 0; a < 4; a++) {',
  '        var fila = rf[a], py = rw[a];',
  '        for (var b = 0; b < 4; b++) {',
  '          var cl = src[fila + ci[o + b]];',
  '          acc[cl === 255 ? 7 : cl] += py * cw[o + b];',
  '        }',
  '      }',
  '      var mejor = 0, m = acc[0];',
  '      for (var t = 1; t < 8; t++) if (acc[t] > m) { m = acc[t]; mejor = t; }',
  '      out[Y * W + X2] = mejor === 7 ? 255 : mejor;',
  '    }',
  '  }',
  '  self.postMessage({ clases: out }, [out.buffer]);',
  '};'
].join('\n');

let trabajador = null;

/* Refina la ventana [x0, x0+nx) × [y0, y0+ny) de la grilla nativa —en
   celdas— a W × H puntos. null si no hay Worker. Una a la vez: la vista
   nueva cancela la que estaba en curso. */
function refinarVentana(base, x0, y0, nx, ny, W, H) {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  if (trabajador) trabajador.terminate();
  let url, este;
  try {
    url = URL.createObjectURL(new Blob([CODIGO_REFINADOR], { type: 'text/javascript' }));
    este = trabajador = new Worker(url);
  } catch (e) {
    return Promise.resolve(null);
  }
  return new Promise(function (ok) {
    function fin(resultado) {
      este.terminate();
      URL.revokeObjectURL(url);
      if (trabajador === este) trabajador = null;
      ok(resultado);
    }
    este.onmessage = function (e) { fin(e.data.clases); };
    este.onerror = function () { fin(null); };
    este.postMessage({ ancho: base.ancho, alto: base.alto, clases: base.clases,
                       x0: x0, y0: y0, nx: nx, ny: ny, W: W, H: H,
                       sigma: SIGMA_CELDAS });
  });
}

/* Latitud desde la Y de Mercator (la inversa de mercY). */
function latDeMerc(m) { return (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180 / Math.PI; }

/* La grilla fina pintada en un lienzo, con el color y la opacidad de cada
   clase y solo las visibles. Se entrega el lienzo y no una imagen: codificar
   un PNG de ocho millones de puntos tomaba más que el refinado mismo. */
/* `zonas` (opcional): { indice, ancho } de la grilla nativa, con 0 fuera de
   toda localidad. Con ella, lo que cae fuera de las ciudades y pueblos se
   pinta a dos quintos de su opacidad: así resalta qué sector de cada
   localidad corre riesgo, sin borrar el resto de la comuna (con menos, la
   comuna parecía vacía fuera de sus pueblos). */
const FUERA_DE_LOCALIDAD = 0.4;

function pintarFino(fino, rgb, alfas, visibles, zonas) {
  if (!fino.lienzo) {
    fino.lienzo = document.createElement('canvas');
    fino.lienzo.width = fino.ancho;
    fino.lienzo.height = fino.alto;
  }
  const ctx = fino.lienzo.getContext('2d');
  const salida = ctx.createImageData(fino.ancho, fino.alto);
  const d = salida.data;
  const a = alfas.map(function (x) { return Math.round(x * 255); });
  const af = alfas.map(function (x) { return Math.round(x * 255 * FUERA_DE_LOCALIDAD); });
  /* Qué celda nativa corresponde a cada columna y fila de la vista. */
  let col = null, fil = null;
  if (zonas) {
    col = new Int32Array(fino.ancho);
    fil = new Int32Array(fino.alto);
    for (let X = 0; X < fino.ancho; X++) {
      col[X] = Math.min(zonas.ancho - 1, Math.floor(fino.x0 + (X + 0.5) * fino.nx / fino.ancho));
    }
    for (let Y = 0; Y < fino.alto; Y++) {
      fil[Y] = Math.floor(fino.y0 + (Y + 0.5) * fino.ny / fino.alto) * zonas.ancho;
    }
  }
  for (let Y = 0, i = 0, p = 0; Y < fino.alto; Y++) {
    for (let X = 0; X < fino.ancho; X++, i++, p += 4) {
      const k = fino.clases[i];
      if (k === SIN_DATO || !visibles[k]) continue;
      const c = rgb[k];
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2];
      d[p + 3] = (zonas && !zonas.indice[fil[Y] + col[X]]) ? af[k] : a[k];
    }
  }
  ctx.putImageData(salida, 0, 0);
  return fino.lienzo;
}

/* Y de Mercator. MapLibre coloca la imagen por sus esquinas interpolando en
   Mercator, así que para saber qué píxel está bajo el cursor hay que
   interpolar igual: es lo que efectivamente se ve. */
function mercY(lat) {
  const r = lat * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}

/* Para las páginas que cruzan otras capas con la grilla de la comuna
   (inundaciones: variables, manzanas, equipamiento). */
GTDetalle.SIN_DATO = 255;
GTDetalle.mercY = mercY;
GTDetalle.latDeMerc = function (m) { return latDeMerc(m); };

/* Zoom a partir del cual un píxel de 30 m ocupa más de un píxel de pantalla.
   Desde ahí se dibuja con 'nearest': cada celda es un cuadrado de un solo
   color de la leyenda. Con 'linear' MapLibre mezclaba celdas vecinas y al
   acercarse aparecían bordes difusos y tonos que no están en la leyenda. Por
   debajo se deja 'linear', que al reducir la imagen suaviza en vez de
   salpicar. */
function zoomDePixel(esquinas, ancho) {
  const oeste = esquinas[0][0], este = esquinas[1][0];
  const lat = (esquinas[0][1] + esquinas[2][1]) / 2;
  const cos = Math.cos(lat * Math.PI / 180);
  const metrosPorPixel = (este - oeste) * 111320 * cos / ancho;
  const dpr = window.devicePixelRatio || 1;
  return Math.log2(156543.03 * cos / (metrosPorPixel * dpr));
}

/* --------------------------------------------------------------------------
   Modo continuo: teselas de valores (motor/teselas.py)

   Cada píxel de la tesela guarda el VALOR, no el color, con la codificación
   de los modelos de elevación. MapLibre lo trata como un relieve y la capa
   `color-relief` lo colorea en la tarjeta de video con una expresión: las
   clases, sus colores y cuáles están visibles son solo esa expresión. Ocultar
   una clase es cambiarla, sin redibujar ni volver a descargar nada.

   Diferencias con el PNG por comuna:
     - cubre la región entera y aparece al acercarse, sin esperar un clic;
     - bajo el cursor se lee el valor exacto, no solo la clase;
     - los cortes vienen del propio archivo (los escribe el motor), así que
       el mapa no puede quedar coloreado con cortes de otra corrida.
   -------------------------------------------------------------------------- */

const ID_FUENTE_CONT = 'detalle-continuo-fuente';
const ID_CAPA_CONT = 'detalle-continuo-capa';

/* Tramo del zoom en que el detalle continuo entra. El coropleto comunal sale
   en el mismo tramo (mapa-real.js, opacidadRelleno). */
const ZOOM_ENTRA = 8.3, ZOOM_PLENO = 9.8;

function rgba(hex, a) {
  const c = hexARgb(hex);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

/* Expresión de color por clases escalonadas. `color-relief-color` solo
   acepta interpolaciones, así que cada escalón son dos paradas pegadas: el
   último valor de una clase y el primero de la siguiente, a media décima —la
   resolución de la codificación— una de otra. Sin dato viene como -10000. */
function expresionColor(cortes, tramos, alfas, visibles, inclusivos) {
  const d = 0.05;
  const e = ['interpolate', ['linear'], ['elevation'],
             -10000, 'rgba(0,0,0,0)', -10000 + d, 'rgba(0,0,0,0)'];
  function color(k) { return visibles[k] ? rgba(tramos[k].color, alfas[k]) : 'rgba(0,0,0,0)'; }
  e.push(-10000 + 2 * d, color(0));
  cortes.forEach(function (c, i) {
    const cierre = inclusivos ? c : c - d;     // último valor de la clase i
    e.push(cierre, color(i), cierre + d, color(i + 1));
  });
  return e;
}

function claseDe(v, cortes, inclusivos) {
  for (let i = 0; i < cortes.length; i++) {
    if (inclusivos ? v <= cortes[i] : v < cortes[i]) return i;
  }
  return cortes.length;
}

/* Valor bajo el cursor: se decodifica la tesela del zoom máximo, que tiene
   la celda de cálculo, y se guardan las últimas en memoria. La primera vez
   que el cursor entra a una tesela el valor llega un instante después; por
   eso se avisa con `alListo` para que la ventana emergente se repinte. */
/* Los píxeles RGBA de una tesela, sin conversión de color ni premultiplicar:
   cada byte es parte de un valor, no de un color. */
function decodificarTesela(archivo, z, x, y, tamano) {
  return archivo.getZxy(z, x, y).then(function (r) {
    if (!r || !r.data) return null;
    return createImageBitmap(new Blob([r.data]),
                             { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }).then(function (bmp) {
    if (!bmp) return null;
    const lienzo = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(tamano, tamano)
      : Object.assign(document.createElement('canvas'), { width: tamano, height: tamano });
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, tamano, tamano).data;
  }).catch(function () { return null; });
}

function lectorDeValores(archivo, z, tamano, escala) {
  const cache = new Map();            // "x/y" -> Uint8ClampedArray | null | Promise
  const MAXIMO = 48;

  function decodificar(x, y) { return decodificarTesela(archivo, z, x, y, tamano); }

  return function valorEn(lngLat, alListo) {
    const n = Math.pow(2, z);
    const fx = (lngLat.lng + 180) / 360 * n;
    const lat = lngLat.lat * Math.PI / 180;
    const fy = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * n;
    const x = Math.floor(fx), y = Math.floor(fy), clave = x + '/' + y;

    let t = cache.get(clave);
    if (t === undefined) {
      const p = decodificar(x, y).then(function (datos) {
        cache.set(clave, datos);
        if (cache.size > MAXIMO) cache.delete(cache.keys().next().value);
        if (alListo) alListo();
      });
      cache.set(clave, p);
      return undefined;                  // cargando
    }
    if (t === null) return null;         // tesela sin datos
    if (typeof t.then === 'function') return undefined;

    const px = Math.min(tamano - 1, Math.floor((fx - x) * tamano));
    const py = Math.min(tamano - 1, Math.floor((fy - y) * tamano));
    const i = (py * tamano + px) * 4;
    const codigo = t[i] * 65536 + t[i + 1] * 256 + t[i + 2];
    if (codigo === 0) return null;       // sin dato
    return (-10000 + codigo * 0.1) / escala;
  };
}

function montarContinua(mapa, cfg, info, antesDe, variable) {
  const meta = info.meta || {};
  const escala = meta.escala || 1;
  if (!meta.cortes || !meta.cortes.length) return null;   // sin cortes no hay clases
  const cortes = meta.cortes.slice();                        // en unidades del dato
  const cortesCodificados = cortes.map(function (c) { return c * escala; });
  // La regla de borde la declara el archivo; la de VARIABLES es el respaldo.
  const inclusivos = typeof meta.cortes_inclusivos === 'boolean'
    ? meta.cortes_inclusivos : cfg.cortesInclusivos;
  const tramos = tramosDe(cfg);
  const visibles = tramos.map(function () { return true; });
  let factor = 1, pausada = false;
  /* Un par fuente/capa por variable: en el visor conviven erosión, NDVI y
     pendiente, y solo una está encendida a la vez. */
  const idFuente = ID_FUENTE_CONT + '-' + variable;
  const idCapa = ID_CAPA_CONT + '-' + variable;

  /* Resumen por comuna que el motor dejó en el archivo: sale del mismo
     ráster que está pintado, así que el panel y el mapa no pueden
     discrepar. Índice por nombre normalizado, como el resto del detalle. */
  const resumenes = {};
  (meta.comunas || []).forEach(function (c) { resumenes[normalizar(c.nombre)] = c; });

  function opacidadPorZoom() {
    return ['interpolate', ['linear'], ['zoom'], ZOOM_ENTRA, 0, ZOOM_PLENO, factor];
  }
  function pintarColor() {
    mapa.setPaintProperty(idCapa, 'color-relief-color',
      expresionColor(cortesCodificados, tramos, cfg.alfas, visibles, inclusivos));
  }

  mapa.addSource(idFuente, {
    type: 'raster-dem', url: GTMapaReal.teselas.url(cfg.teselas),
    tileSize: meta.tamano_tesela || 512, encoding: 'mapbox',
  });
  mapa.addLayer({
    id: idCapa, type: 'color-relief', source: idFuente,
    paint: {
      'color-relief-color': expresionColor(cortesCodificados, tramos, cfg.alfas,
                                           visibles, inclusivos),
      'color-relief-opacity': opacidadPorZoom(),
      /* Nítida desde que una celda ocupa más de un píxel de pantalla. Con
         interpolación lineal los bordes salían como curvas suaves, pero
         falsas: entre una celda Ligera y una Extrema el valor interpolado
         pasa por Moderada, Severa y Muy severa, y dibujaba un anillo de
         clases que no existen ahí —y el cursor, que lee la celda real,
         decía "Extrema" sobre un píxel pintado de Moderada—. Bajo el 11,5
         la celda mide menos de un píxel y el anillo no se alcanza a ver. */
      'resampling': ['step', ['zoom'], 'linear', 11.5, 'nearest'],
    },
  }, antesDe);

  const archivo = GTMapaReal.teselas.archivo(cfg.teselas);
  const valorEn = lectorDeValores(archivo, info.encabezado.maxZoom,
                                  meta.tamano_tesela || 512, escala);

  return {
    cortes: cortes,
    visibles: visibles,
    alternar: function (k) { visibles[k] = !visibles[k]; pintarColor(); },
    opacidad: function (v) {
      factor = v;
      mapa.setPaintProperty(idCapa, 'color-relief-opacity', opacidadPorZoom());
    },
    pausar: function (v) {
      pausada = v;
      mapa.setLayoutProperty(idCapa, 'visibility', v ? 'none' : 'visible');
    },
    /* Con una comuna refinada encima, la capa regional se esconde: debajo
       asomaban sus cuadrados de 30 m a través de las clases translúcidas.
       No toca `pausada`: el valor bajo el cursor sigue leyéndose. */
    mostrarCapa: function (v) {
      if (!pausada) mapa.setLayoutProperty(idCapa, 'visibility', v ? 'visible' : 'none');
    },
    /* Las clases de la tesela de zoom máximo recortadas al rectángulo de una
       comuna, para refinarlas. Las esquinas se calculan de los píxeles del
       recorte, que están en Mercator igual que la imagen que se monta. */
    grilla: function (esquinas) {
      const z = info.encabezado.maxZoom, T = meta.tamano_tesela || 512;
      const lado = Math.pow(2, z) * T;
      const gx = function (lng) { return (lng + 180) / 360 * lado; };
      const gy = function (lat) {
        const r = lat * Math.PI / 180;
        return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * lado;
      };
      const lngs = esquinas.map(function (p) { return p[0]; });
      const lats = esquinas.map(function (p) { return p[1]; });
      const px0 = Math.floor(gx(Math.min.apply(null, lngs)));
      const px1 = Math.ceil(gx(Math.max.apply(null, lngs)));
      const py0 = Math.floor(gy(Math.max.apply(null, lats)));
      const py1 = Math.ceil(gy(Math.min.apply(null, lats)));
      const ancho = px1 - px0, alto = py1 - py0;
      if (ancho <= 0 || alto <= 0 || ancho * alto > 6e6) return Promise.resolve(null);

      const pedidos = [];
      for (let ty = Math.floor(py0 / T); ty <= Math.floor((py1 - 1) / T); ty++) {
        for (let tx = Math.floor(px0 / T); tx <= Math.floor((px1 - 1) / T); tx++) {
          pedidos.push(decodificarTesela(archivo, z, tx, ty, T).then(function (d) {
            return { tx: tx, ty: ty, d: d };
          }));
        }
      }
      return Promise.all(pedidos).then(function (teselas) {
        const clases = new Uint8Array(ancho * alto).fill(SIN_DATO);
        /* El valor de cada celda, para el umbral continuo: con solo la
           clase, el umbral saltaría de corte en corte. */
        const valores = new Float32Array(ancho * alto).fill(NaN);
        teselas.forEach(function (t) {
          if (!t.d) return;
          for (let y = 0; y < T; y++) {
            const fy = t.ty * T + y - py0;
            if (fy < 0 || fy >= alto) continue;
            for (let x = 0; x < T; x++) {
              const fx = t.tx * T + x - px0;
              if (fx < 0 || fx >= ancho) continue;
              const i = (y * T + x) * 4;
              const codigo = t.d[i] * 65536 + t.d[i + 1] * 256 + t.d[i + 2];
              if (codigo === 0) continue;
              const v = (-10000 + codigo * 0.1) / escala;
              valores[fy * ancho + fx] = v;
              clases[fy * ancho + fx] = claseDe(v, cortes, inclusivos);
            }
          }
        });
        const lng = function (px) { return px / lado * 360 - 180; };
        const lat = function (py) {
          return Math.atan(Math.sinh(Math.PI * (1 - 2 * py / lado))) * 180 / Math.PI;
        };
        return {
          ancho: ancho, alto: alto, clases: clases, valores: valores,
          esquinas: [[lng(px0), lat(py0)], [lng(px1), lat(py0)],
                     [lng(px1), lat(py1)], [lng(px0), lat(py1)]],
        };
      });
    },
    /* Ficha de la comuna con la forma que usan panel() y cfg.resumen: el %
       por clase como diccionario por nombre y como conteo para la barra.
       null si el archivo no trae resúmenes (teselas de antes de este
       cambio); entonces se usa el PNG, como antes. */
    fichaDe: function (comuna) {
      const r = resumenes[normalizar(comuna.nombre)];
      if (!r) return null;
      const fraccion = {};
      cfg.clases.forEach(function (n, i) { fraccion[n] = r.fraccion[i] || 0; });
      return Object.assign({}, r, {
        fraccion: fraccion,
        conteo: r.fraccion.map(function (f) { return Math.round(f * r.celdas); }),
      });
    },
    /* Con la capa aún transparente (vista regional) no se ofrece el valor:
       sería describir algo que en pantalla no se ve. */
    celdaEn: function (lngLat, alListo) {
      if (pausada || mapa.getZoom() < ZOOM_ENTRA + 0.5) return null;
      const v = valorEn(lngLat, alListo);
      if (v === undefined || v === null) return null;
      const k = claseDe(v, cortes, inclusivos);
      if (!visibles[k]) return null;
      return { nombre: tramos[k].nombre, color: tramos[k].color,
               valor: cfg.formato(v), etiqueta: cfg.celda || 'Celda de 30 m' };
    },
  };
}

/* --------------------------------------------------------------------------
   Panel sobre el mapa
   -------------------------------------------------------------------------- */

/* Sin comuna elegida, el mapa dice qué hacer con él. Antes eso estaba solo
   en el texto de la página, lejos del mapa. Va en la esquina del panel de
   detalle; si la página ya tiene ahí su leyenda regional —inundaciones—, se
   apila encima en vez de taparla. */
function panelInicial(contenedor, cfg, continuo) {
  const caja = contenedor.querySelector('.detalle-erosion');
  if (caja) caja.remove();
  contenedor.classList.remove('map--detalle');
  let pista = contenedor.querySelector('.detalle-pista');
  if (!pista) {
    pista = document.createElement('div');
    pista.className = 'detalle-pista';
    contenedor.appendChild(pista);
  }
  /* Con teselas no hace falta el clic para ver el dato fino: aparece al
     acercarse en cualquier parte. El clic da el resumen de la comuna. */
  pista.textContent = continuo
    ? 'Acerca el mapa para ver la ' + cfg.titulo + ' · clic en una comuna para su resumen'
    : 'Haz clic en una comuna para ver la ' + cfg.titulo;
  apilarPista(contenedor);
}

function apilarPista(contenedor) {
  const pista = contenedor.querySelector('.detalle-pista');
  if (!pista) return;
  const leyenda = contenedor.querySelector('.map__overlay--bl:not(.detalle-erosion)');
  pista.style.bottom = leyenda && leyenda.offsetHeight
    ? (14 + leyenda.offsetHeight + 8) + 'px' : '';
}

/* Lo que tapa el mapa por la derecha —la ficha de la comuna en el visor— se
   descuenta del encuadre: si no, la comuna queda centrada debajo de la ficha.
   Una ficha más ancha que medio mapa es la versión de pantalla angosta, que
   va abajo y no al costado. */
function margenes(contenedor) {
  const m = { top: 40, bottom: 40, left: 40, right: 40 };
  const ficha = contenedor.querySelector('.map__ficha:not([hidden])');
  if (ficha && ficha.offsetWidth < contenedor.offsetWidth / 2) {
    m.right += ficha.offsetWidth + 14;
  }
  return m;
}

function panel(contenedor, ficha, cfg, estado, alCambiar) {
  const pista = contenedor.querySelector('.detalle-pista');
  if (pista) pista.remove();
  /* Con una comuna abierta la leyenda de la región sobra —la del detalle la
     reemplaza— y ocupaba la misma esquina. La clase la oculta por CSS. */
  contenedor.classList.add('map--detalle');
  let caja = contenedor.querySelector('.detalle-erosion');
  if (!caja) {
    caja = document.createElement('div');
    /* Igual que el chip de origen: la posición va en la clase, para que en
       pantalla completa se corra junto al panel de filtros. */
    caja.className = 'map__overlay map__overlay--bl detalle-erosion';
    contenedor.appendChild(caja);
  }
  const tramos = tramosDe(cfg);
  const total = estado ? estado.datos.conteo.reduce(function (s, n) { return s + n; }, 0) : 0;

  /* Barra apilada: cuánto del territorio evaluado cae en cada clase. Es la
     misma información que el promedio comunal, pero sin esconder la cola. */
  const barra = estado ? '<div class="detalle__barra" aria-hidden="true">' +
    tramos.map(function (t, k) {
      const f = estado.datos.conteo[k] / (total || 1);
      return f > 0 ? '<i style="flex:' + f.toFixed(4) + ';background:' + t.color +
                     (estado.visibles[k] ? '' : ';opacity:.25') + '"></i>' : '';
    }).join('') + '</div>' : '';

  const clases = tramos.map(function (t, k) {
    const pct = estado ? Math.round(100 * estado.datos.conteo[k] / (total || 1)) : null;
    const etiqueta = '<i style="background:' + t.color + '"></i>' +
      '<span>' + t.nombre + '</span>' +
      (pct !== null ? '<span class="detalle__pct">' + pct + '%</span>' : '');
    /* Sin lectura de píxeles la leyenda sigue siendo leyenda, pero no botón:
       un botón que no hace nada es peor que no tenerlo. */
    return estado
      ? '<button type="button" class="detalle__clase" data-k="' + k + '" aria-pressed="' +
          (estado.visibles[k] ? 'true' : 'false') + '" title="' +
          (estado.visibles[k] ? 'Ocultar' : 'Mostrar') + ' ' + t.nombre.toLowerCase() +
          // NDVI y pendiente traen la unidad en el rango: unidad vacía.
          (t.rango ? ' (' + (t.rango + ' ' + cfg.unidad).trim() + ')' : '') + '">' + etiqueta + '</button>'
      : '<span class="detalle__clase">' + etiqueta + '</span>';
  }).join('');

  caja.innerHTML =
    '<div class="detalle__titulo">' + ficha.nombre + ' · ' + cfg.titulo + '</div>' +
    '<div class="muted">' + cfg.resumen(ficha) + '</div>' +
    barra +
    '<div class="detalle__clases">' + clases + '</div>' +
    (estado && cfg.exportarDesde !== undefined && typeof GTZonas !== 'undefined'
      ? '<div class="detalle__exportar"><span class="muted">Descargar ' +
          (cfg.exportarDesde > 0 ? 'desde ' + cfg.clases[cfg.exportarDesde].toLowerCase() : 'lo marcado') + ':</span>' +
          '<button type="button" data-exportar="kml" title="KML para Google Earth">Google Earth</button>' +
          '<button type="button" data-exportar="geojson" title="GeoJSON para QGIS o ArcGIS">QGIS</button></div>'
      : '') +
    '<div class="muted detalle__pie">' +
      (estado ? 'Pasa el cursor para ver cada celda · clic en una clase para ocultarla<br>' : '') +
      (estado && cfg.pistaClic ? cfg.pistaClic.charAt(0).toUpperCase() + cfg.pistaClic.slice(1) + '<br>' : '') +
      'Clic fuera para volver a la región</div>';

  caja.querySelectorAll('button[data-exportar]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      contenedor.dispatchEvent(new CustomEvent('detalle:exportar', { detail: b.getAttribute('data-exportar') }));
    });
  });
  if (estado) {
    caja.querySelectorAll('button[data-k]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        alCambiar(Number(b.getAttribute('data-k')));
      });
    });
  }
}

/* --------------------------------------------------------------------------
   Punto de entrada
   -------------------------------------------------------------------------- */

/* `variable` es 'erosion' (por defecto), 'inundacion' o 'calor'.
   `opciones.alMontar` se llama cuando el modo continuo queda montado, para
   que el mapa ajuste su coropleto. `opciones.activo: false` lo crea
   apagado: el visor conecta uno por capa y enciende el de la elegida. */
GTDetalle.conectar = function (mapa, contenedor, bajoCaminos, variable, opciones) {
  variable = VARIABLES[variable] ? variable : 'erosion';
  const cfg = VARIABLES[variable];
  opciones = opciones || {};
  /* El umbral se anuncia cuando ya se sabe si hay teselas: si el índice de
     PNG respondía primero, salía en modo por clases aunque las teselas —con
     el valor de cada celda— llegaran un instante después. */
  let teselasResueltas = !(cfg.teselas && typeof GTMapaReal !== 'undefined' && GTMapaReal.teselas);
  traerIndice(variable).then(function () { if (teselasResueltas) anunciarUmbral(); });
  /* La barra de controles la arma el mapa en el mismo evento de carga: se
     espera un ciclo para que exista. */
  setTimeout(montarBotonLocalidades, 0);

  let continua = null;   // controlador del modo continuo, si hay teselas
  let pausado = opciones.activo === false;
  // Sin PNG (NDVI, pendiente) no hay nada que ofrecer hasta que haya teselas.
  if (!pausado && cfg.ruta) panelInicial(contenedor, cfg);

  if (cfg.teselas && typeof GTMapaReal !== 'undefined' && GTMapaReal.teselas) {
    GTMapaReal.teselas.disponible(cfg.teselas).then(function (info) {
      teselasResueltas = true;
      if (!info) { anunciarUmbral(); return; }
      continua = montarContinua(mapa, cfg, info, bajoCaminos, variable);
      if (!continua) { anunciarUmbral(); return; }
      anunciarUmbral();
      /* El detalle es de la comuna elegida, no de la región: la capa de
         teselas no se muestra sola al acercar. Se usa como fuente del dato
         —la grilla de la comuna, el valor bajo el cursor, el resumen del
         panel— y lo que se ve es la vista refinada de esa comuna. */
      continua.mostrarCapa(false);
      console.info('[detalle] %s en teselas continuas (z%d-%d)', variable,
                   info.encabezado.minZoom, info.encabezado.maxZoom);
      continua.opacidad(opacidad);
      if (pausado) continua.pausar(true);
      /* Si alguien alcanzó a abrir una comuna con el PNG mientras se
         consultaba el archivo, se pasa esa comuna al modo continuo. Solo
         entonces se quita la capa PNG: su id es compartido, y un detalle
         apagado que termina de montarse no puede borrar la del encendido. */
      if (estado) {
        quitarCapa(mapa);
        estado.visibles = continua.visibles;
        panel(contenedor, estado.ficha, cfg, estado, alternarClase);
      } else if (!pausado) {
        panelInicial(contenedor, cfg, false);
      }
      if (opciones.alMontar) opciones.alMontar();
    });
  }
  /* La leyenda regional cambia de alto al cambiar de capa —clases contra
     rampa— y la pista va apilada encima: se vuelve a medir. */
  const leyenda = contenedor.querySelector('.map__overlay--bl:not(.detalle-erosion)');
  if (leyenda && window.ResizeObserver) {
    new ResizeObserver(function () { apilarPista(contenedor); }).observe(leyenda);
  }

  let estado = null;     // { ficha, datos, visibles, zoomNitido } de la comuna abierta
  let opacidad = 1;      // la fija el deslizador de la página
  let pedido = 0;        // para descartar respuestas de una comuna ya cerrada

  /* La pista y el panel vacío, solo si esta variable tiene detalle que
     mostrar. NDVI y pendiente sin teselas no lo tienen: invitar a hacer
     clic para no ver nada sería peor que no decir nada. */
  function pistaInicial() {
    if (continua || cfg.ruta) { panelInicial(contenedor, cfg, false); return; }
    const caja = contenedor.querySelector('.detalle-erosion');
    if (caja) caja.remove();
    const pista = contenedor.querySelector('.detalle-pista');
    if (pista) pista.remove();
    contenedor.classList.remove('map--detalle');
  }

  function ajustarMuestreo() {
    if (!estado || !mapa.getLayer(ID_CAPA)) return;
    const modo = mapa.getZoom() >= estado.zoomNitido - 0.5 ? 'nearest' : 'linear';
    if (modo !== estado.muestreo) {
      estado.muestreo = modo;
      mapa.setPaintProperty(ID_CAPA, 'raster-resampling', modo);
    }
  }
  mapa.on('zoom', ajustarMuestreo);

  /* --- Vista refinada -----------------------------------------------------
     `base` es la grilla nativa de la comuna abierta; `vista`, lo refinado
     para lo que está en pantalla. Ver "Bordes refinados al acercar". */
  let base = null;       // { ancho, alto, clases, esquinas }
  let vista = null;      // { ancho, alto, clases, esquinas, lienzo, id }
  let turnoVista = 0;    // para descartar una vista que llega tarde
  let turnoId = 0;       // qué par de IDS_VISTA toca

  /* Esconde (o devuelve) lo que se ve debajo de la vista: la imagen de 30 m
     de la comuna, o la capa regional de teselas. Con ambas a la vista, las
     clases translúcidas dejaban asomar los cuadrados de abajo. */
  function nativaVisible(v) {
    if (mapa.getLayer(ID_CAPA)) {
      mapa.setPaintProperty(ID_CAPA, 'raster-opacity', v ? (estado ? 1 : 0.88) * opacidad : 0);
    }
  }

  function quitarVista() {
    turnoVista++;
    IDS_VISTA.forEach(function (id) {
      if (mapa.getLayer(id + '-capa')) mapa.removeLayer(id + '-capa');
      if (mapa.getSource(id)) mapa.removeSource(id);
    });
    if (vista) nativaVisible(true);
    vista = null;
  }

  function montarVista(nueva) {
    const id = IDS_VISTA[turnoId++ % 2];
    nueva.id = id;
    if (mapa.getLayer(id + '-capa')) mapa.removeLayer(id + '-capa');
    if (mapa.getSource(id)) mapa.removeSource(id);
    mapa.addSource(id, {
      type: 'canvas', animate: false, coordinates: nueva.esquinas,
      canvas: pintarFino(nueva, estado.rgb, cfg.alfas, estado.visibles,
                         loc.activas && loc.indice ? { indice: loc.indice, ancho: base.ancho } : null),
    });
    /* 'linear' con un punto por píxel es solo el suavizado del borde. */
    mapa.addLayer({
      id: id + '-capa', type: 'raster', source: id,
      paint: { 'raster-opacity': opacidad, 'raster-fade-duration': 0,
               'raster-resampling': 'linear' },
    }, bajoCaminos);
    if (vista && vista.id !== id) {
      if (mapa.getLayer(vista.id + '-capa')) mapa.removeLayer(vista.id + '-capa');
      if (mapa.getSource(vista.id)) mapa.removeSource(vista.id);
    }
    vista = nueva;
    nativaVisible(false);
  }

  /* Repinta la vista actual con otras clases visibles, sin recalcularla. */
  function repintarVista() {
    if (!vista) return;
    const anterior = vista;
    anterior.lienzo = null;          // lienzo nuevo: el anterior sigue en pantalla
    montarVista(anterior);
  }

  /* `forzada`: recalcular aunque la vista siga siendo la misma —cambió el
     umbral, no la cámara—. */
  function actualizarVista(forzada) {
    const turno = ++turnoVista;
    if (!estado || !base) return;
    const e = base.esquinas;
    const mundo = 512 * Math.pow(2, mapa.getZoom());
    const px = function (lng) { return (lng + 180) / 360 * mundo; };
    const py = function (lat) { return (1 - mercY(lat) / Math.PI) / 2 * mundo; };
    const celdaX = (px(e[1][0]) - px(e[0][0])) / base.ancho;
    const celdaY = (py(e[2][1]) - py(e[0][1])) / base.alto;
    if (celdaX < CELDA_MINIMA_PX) {
      /* Con PNG, debajo está la imagen de 30 m de la comuna. Con teselas no
         hay nada: se monta la grilla de la comuna tal cual, una vez. */
      /* Lejos, la grilla de la comuna tal cual, una vez. Se usa también con
         PNG —y no la imagen original— porque el umbral y las localidades
         cambian lo que se pinta, y la imagen no los conoce. */
      if (!(vista && vista.nativa) || forzada) {
        montarVista({ ancho: base.ancho, alto: base.alto, clases: base.clases,
                      esquinas: base.esquinas, nativa: true,
                      x0: 0, y0: 0, nx: base.ancho, ny: base.alto });
      }
      return;
    }

    /* Lo visible, con margen, en celdas de la grilla nativa. */
    const b = mapa.getBounds();
    const dx = (b.getEast() - b.getWest()) * MARGEN_VISTA;
    const mN = mercY(b.getNorth()), mS = mercY(b.getSouth()), dm = (mN - mS) * MARGEN_VISTA;
    const yN = mercY(e[0][1]), yS = mercY(e[2][1]);
    const cx = function (lng) { return (lng - e[0][0]) / (e[1][0] - e[0][0]) * base.ancho; };
    const cy = function (m) { return (yN - m) / (yN - yS) * base.alto; };
    const x0 = Math.max(0, Math.floor(cx(b.getWest() - dx)));
    const x1 = Math.min(base.ancho, Math.ceil(cx(b.getEast() + dx)));
    const y0 = Math.max(0, Math.floor(cy(mN + dm)));
    const y1 = Math.min(base.alto, Math.ceil(cy(mS - dm)));
    if (x1 <= x0 || y1 <= y0) { quitarVista(); return; }

    const dpr = window.devicePixelRatio || 1;
    let W = (x1 - x0) * celdaX * dpr, H = (y1 - y0) * celdaY * dpr;
    const k = Math.min(1, LADO_MAXIMO / W, LADO_MAXIMO / H, Math.sqrt(PUNTOS_VISTA / (W * H)));
    W = Math.max(1, Math.round(W * k));
    H = Math.max(1, Math.round(H * k));

    refinarVentana(base, x0, y0, x1 - x0, y1 - y0, W, H).then(function (clases) {
      if (turno !== turnoVista || !clases || !estado) return;
      const lng = function (x) { return e[0][0] + x / base.ancho * (e[1][0] - e[0][0]); };
      const lat = function (y) { return latDeMerc(yN - y / base.alto * (yN - yS)); };
      montarVista({
        ancho: W, alto: H, clases: clases,
        x0: x0, y0: y0, nx: x1 - x0, ny: y1 - y0,
        esquinas: [[lng(x0), lat(y0)], [lng(x1), lat(y0)], [lng(x1), lat(y1)], [lng(x0), lat(y1)]],
      });
    });
  }

  /* Se recalcula al detenerse el mapa, no en cada cuadro del movimiento. */
  let esperaVista = null;
  mapa.on('moveend', function () {
    clearTimeout(esperaVista);
    esperaVista = setTimeout(function () { actualizarVista(false); }, 60);
  });

  /* Fija la grilla nativa de la comuna abierta y refina lo que se ve.
     `base.original` son las clases de las celdas; `base.clases`, lo que se
     pinta después de aplicar el umbral. */
  function usarBase(grilla, esquinas, este, comuna) {
    if (este !== pedido || !grilla || !estado) return;
    base = { ancho: grilla.ancho, alto: grilla.alto, esquinas: esquinas,
             original: grilla.clases, valores: grilla.valores || null, clases: null,
             nombre: comuna ? comuna.nombre : null };
    /* Un escenario de pesos es de la grilla en que se calculó: la comuna
       nueva parte con el índice calibrado, y la página lo vuelve a aplicar
       si sigue activo (evento 'detalle:base'). */
    if (escenario) {
      umbral = escenario.umbral0;
      escenario = null;
      emitir('umbral', infoUmbral());
    }
    ficha0 = estado.ficha;
    conteo0 = estado.datos && estado.datos.conteo;
    emitir('base', { nombre: base.nombre, ancho: base.ancho, alto: base.alto,
                     esquinas: base.esquinas, continuo: !!base.valores });
    aplicarUmbral();
    actualizarVista(true);
    if (cfg.localidades) prepararLocalidades();
    else emitir('resumen', resumen());
  }

  /* --- Umbral -------------------------------------------------------------
     Qué se marca como riesgo. Por omisión, desde el corte de "Alta": lo que
     el módulo ya llamaba "Alta o superior". Bajo el umbral la celda no se
     pinta, y el borde entre lo que pasa y lo que no se refina igual que los
     demás. Con teselas el umbral es continuo —cada celda trae su valor—;
     con PNG solo hay clases, y el umbral cae en los cortes entre ellas. */
  let umbral = null;
  let umbralAnunciado = false;

  /* --- Escenario de pesos -------------------------------------------------
     La página de inundaciones puede recalcular el índice de la comuna con
     otros pesos (las seis variables vienen en sus propias teselas). Aquí
     solo se reemplazan los valores y los cortes de clase de la grilla, y
     se guarda lo calibrado para volver. */
  let escenario = null;     // { cortes, valores0, original0, umbral0 }
  let ficha0 = null, conteo0 = null;   // la ficha calibrada, para volver

  function fijarValores(valores, cortes, opciones) {
    if (!base || !base.valores) return false;       // sin valores (PNG) no hay escenario
    opciones = opciones || {};
    if (!valores) {
      if (!escenario) return true;
      base.valores = escenario.valores0;
      base.original = escenario.original0;
      umbral = opciones.umbral !== undefined ? opciones.umbral : escenario.umbral0;
      escenario = null;
      if (estado && ficha0) {
        estado.ficha = ficha0;
        if (estado.datos && conteo0) estado.datos.conteo = conteo0;
      }
    } else {
      if (!escenario) {
        escenario = { valores0: base.valores, original0: base.original, umbral0: umbral };
      }
      escenario.cortes = cortes.slice();
      const o0 = escenario.original0, n = o0.length;
      const original = new Uint8Array(n).fill(SIN_DATO);
      const conteo = cfg.clases.map(function () { return 0; });
      let suma = 0, celdas = 0;
      for (let i = 0; i < n; i++) {
        const v = valores[i];
        if (o0[i] === SIN_DATO || v !== v) continue;
        const k = claseDe(v, cortes, cfg.cortesInclusivos);
        original[i] = k; conteo[k]++; suma += v; celdas++;
      }
      base.valores = valores;
      base.original = original;
      if (opciones.umbral !== undefined) umbral = opciones.umbral;
      if (estado && ficha0) {
        const fraccion = {};
        cfg.clases.forEach(function (c, k) { fraccion[c] = celdas ? conteo[k] / celdas : 0; });
        estado.ficha = Object.assign({}, ficha0, { media: celdas ? suma / celdas : null,
                                                   fraccion: fraccion, escenario: true });
        if (estado.datos) estado.datos.conteo = conteo;
      }
    }
    if (estado) panel(contenedor, estado.ficha, cfg, estado, alternarClase);
    aplicarUmbral();
    actualizarVista(true);
    emitir('umbral', infoUmbral());
    emitir('resumen', resumen());
    return true;
  }

  function cortesUmbral() {
    if (escenario) return escenario.cortes;
    if (continua && continua.cortes) return continua.cortes;
    return cortesDeIndice[variable] || null;
  }

  function infoUmbral() {
    if (!teselasResueltas) return null;          // todavía no se sabe si es continuo
    const c = cortesUmbral();
    if (!cfg.umbral || !c || !c.length) return null;
    const paso = c.length > 1 ? c[1] - c[0] : 0.1;
    if (umbral === null) umbral = c[Math.max(0, c.length - 2)];
    return {
      continuo: !!continua,
      cortes: c.slice(),
      clases: cfg.clases.slice(),
      minimo: Math.max(0, +(c[0] - 2 * paso).toFixed(2)),
      maximo: +(c[c.length - 1] + 2 * paso).toFixed(2),
      umbral: umbral,
    };
  }

  /* La página se entera de que hay umbral apenas se conocen los cortes: al
     montar las teselas o al leer el índice de PNG. */
  function anunciarUmbral() {
    if (umbralAnunciado) return;
    const info = infoUmbral();
    if (!info) return;
    umbralAnunciado = true;
    emitir('umbral', info);
  }

  /* Sin valores (PNG), una celda pasa si toda su clase está sobre el umbral. */
  function limitesInferiores() {
    const c = cortesUmbral() || [];
    return [-Infinity].concat(c);
  }

  function sobreUmbral(i) {
    if (!cfg.umbral || umbral === null) return true;
    if (base.valores) {
      const v = base.valores[i];
      return v === v && v >= umbral - 1e-9;          // v === v: no es NaN
    }
    return limitesInferiores()[base.original[i]] >= umbral - 1e-9;
  }

  function aplicarUmbral() {
    if (!base) return;
    if (!cfg.umbral || umbral === null) { base.clases = base.original; return; }
    const n = base.original.length, salida = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const k = base.original[i];
      salida[i] = (k === SIN_DATO || !sobreUmbral(i)) ? SIN_DATO : k;
    }
    base.clases = salida;
  }

  /* Cuánto de la comuna, y de cada localidad, queda sobre el umbral. El
     área es aproximada: celdas por el tamaño medio de una celda en el suelo. */
  function haPorCelda() {
    const e = base.esquinas, lat = (e[0][1] + e[2][1]) / 2 * Math.PI / 180;
    const ancho = (e[1][0] - e[0][0]) * 111320 * Math.cos(lat) / base.ancho;
    const alto = (e[0][1] - e[2][1]) * 110540 / base.alto;
    return ancho * alto / 10000;
  }

  function resumen() {
    if (!base) return null;
    const ha = haPorCelda();
    const n = loc.lista.length;
    const locTotal = new Float64Array(n), locSobre = new Float64Array(n);
    let total = 0, sobre = 0;
    for (let i = 0; i < base.original.length; i++) {
      if (base.original[i] === SIN_DATO) continue;
      total++;
      const pasa = base.clases[i] !== SIN_DATO;
      if (pasa) sobre++;
      const z = loc.indice ? loc.indice[i] : 0;
      if (z) { locTotal[z - 1]++; if (pasa) locSobre[z - 1]++; }
    }
    return {
      comuna: base.nombre,
      umbral: cfg.umbral ? umbral : null,
      continuo: !!base.valores,
      fraccionSobre: total ? sobre / total : 0,
      haSobre: sobre * ha,
      localidadesActivas: loc.activas,
      localidades: loc.lista.map(function (f, k) {
        return {
          id: f.properties.id_ciudad, nombre: f.properties.nombre,
          categoria: f.properties.categoria, tipo: f.properties.tipo,
          haTotal: locTotal[k] * ha, haSobre: locSobre[k] * ha,
          fraccionSobre: locTotal[k] ? locSobre[k] / locTotal[k] : 0,
        };
      }).sort(function (a, b) { return b.fraccionSobre - a.fraccionSobre; }),
    };
  }

  function emitir(tipo, detalle) {
    contenedor.dispatchEvent(new CustomEvent('detalle:' + tipo, { detail: detalle }));
  }

  /* --- Zonas para Google Earth y QGIS (js/zonas.js) ---------------------- */
  function zonasMarcadas(extra) {
    if (!base || typeof GTZonas === 'undefined' || cfg.exportarDesde === undefined) return null;
    const tramos = tramosDe(cfg);
    const umbralTexto = cfg.umbral && umbral !== null && base.valores
      ? ' · índice ≥ ' + coma(umbral, 2) : '';
    return GTZonas.geojson(base, base.clases, {
      clases: cfg.clases, colores: tramos.map(function (t) { return t.color; }),
      desde: cfg.exportarDesde,
      nombre: base.nombre + ' · ' + cfg.titulo + umbralTexto,
      atribucion: 'TerraFoco · ' + cfg.titulo + ' · celdas de 30 m',
      propiedades: Object.assign({ comuna: base.nombre, haPorCelda: +haPorCelda().toFixed(4) }, extra || {}),
    });
  }

  function exportarZonas(formato, puntos) {
    if (!estado) return;
    const gj = zonasMarcadas();
    if (!gj) return;
    const nombre = 'terrafoco_' + variable + '_' + GTZonas.archivo(base.nombre);
    if (formato === 'geojson') {
      GTZonas.descargar(nombre + '.geojson', JSON.stringify(gj), 'application/geo+json');
    } else {
      GTZonas.descargar(nombre + '.kml', GTZonas.kml(gj, puntos), 'application/vnd.google-earth.kml+xml');
    }
  }
  contenedor.addEventListener('detalle:exportar', function (e) {
    // Varias variables comparten el contenedor (el visor): exporta la encendida.
    if (!pausado && estado) exportarZonas(e.detail);
  });

  /* --- Localidades --------------------------------------------------------
     Ciudades y pueblos (Límite Urbano Censal 2017, /localidades). Con el
     botón encendido se dibujan sobre el mapa con su nombre, y dentro de la
     comuna abierta se atenúa lo que queda fuera de ellas: resalta qué sector
     de cada localidad corre riesgo. La cuenta por localidad se hace aquí,
     sobre la misma grilla pintada, para que responda al umbral al instante. */
  const loc = { activas: false, geo: null, lista: [], indice: null, idComuna: null,
                boton: null, pedido: null };
  const ID_LOC = 'localidades';

  function traerLocalidades() {
    if (loc.pedido) return loc.pedido;
    if (typeof GT_api === 'undefined') return Promise.resolve(null);
    loc.pedido = fetch(GT_api('/localidades'), { signal: AbortSignal.timeout(6000) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (g) { loc.geo = g && g.features && g.features.length ? g : null; return loc.geo; })
      .catch(function () { return null; });
    return loc.pedido;
  }

  /* La fuente de letra la pone el mapa base: una que no está en su estilo no
     se descarga y el nombre no aparece. */
  function fuenteDelEstilo() {
    const capa = mapa.getStyle().layers.filter(function (c) {
      return c.type === 'symbol' && c.layout && c.layout['text-font'];
    })[0];
    return capa ? capa.layout['text-font'] : ['Open Sans Regular'];
  }

  function capasLocalidades() {
    if (mapa.getSource(ID_LOC) || !loc.geo) return;
    mapa.addSource(ID_LOC, { type: 'geojson', data: loc.geo });
    const tinta = PALETA.mapa.seleccion, halo = PALETA.mapa.halo;
    mapa.addLayer({ id: ID_LOC + '-relleno', type: 'fill', source: ID_LOC,
                    layout: { visibility: 'none' },
                    paint: { 'fill-color': tinta, 'fill-opacity': 0.05 } });
    mapa.addLayer({ id: ID_LOC + '-borde', type: 'line', source: ID_LOC,
                    layout: { visibility: 'none' },
                    paint: { 'line-color': tinta, 'line-width': 1.6,
                             'line-dasharray': [2, 1.5], 'line-opacity': 0.9 } });
    mapa.addLayer({ id: ID_LOC + '-nombre', type: 'symbol', source: ID_LOC,
                    layout: { visibility: 'none', 'text-field': ['get', 'nombre'],
                              'text-font': fuenteDelEstilo(), 'text-size': 12.5,
                              'text-allow-overlap': false, 'symbol-placement': 'point' },
                    paint: { 'text-color': tinta, 'text-halo-color': halo,
                             'text-halo-width': 1.8 } });
  }

  function mostrarCapasLocalidades() {
    const v = loc.activas ? 'visible' : 'none';
    const filtro = loc.idComuna ? ['==', ['get', 'id_comuna'], loc.idComuna] : null;
    ['-relleno', '-borde', '-nombre'].forEach(function (s) {
      if (!mapa.getLayer(ID_LOC + s)) return;
      mapa.setLayoutProperty(ID_LOC + s, 'visibility', v);
      mapa.setFilter(ID_LOC + s, filtro);
    });
  }

  /* Cada localidad de la comuna, pintada sobre la grilla nativa: índice
     k + 1 donde cae la localidad k, 0 fuera. Una por pasada —y no todas de
     una— porque el suavizado del lienzo mezclaría los índices en los bordes. */
  function rasterizarLocalidades() {
    loc.indice = null;
    if (!base || !loc.lista.length) return;
    const e = base.esquinas, yN = mercY(e[0][1]), yS = mercY(e[2][1]);
    const lienzo = document.createElement('canvas');
    lienzo.width = base.ancho; lienzo.height = base.alto;
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    const indice = new Uint8Array(base.ancho * base.alto);
    loc.lista.forEach(function (f, k) {
      ctx.clearRect(0, 0, base.ancho, base.alto);
      ctx.beginPath();
      const poligonos = f.geometry.type === 'MultiPolygon'
        ? f.geometry.coordinates : [f.geometry.coordinates];
      poligonos.forEach(function (poligono) {
        poligono.forEach(function (anillo) {
          anillo.forEach(function (p, i) {
            const x = (p[0] - e[0][0]) / (e[1][0] - e[0][0]) * base.ancho;
            const y = (yN - mercY(p[1])) / (yN - yS) * base.alto;
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          });
        });
      });
      ctx.fill('evenodd');
      const a = ctx.getImageData(0, 0, base.ancho, base.alto).data;
      for (let i = 0; i < indice.length; i++) if (a[i * 4 + 3] >= 128) indice[i] = k + 1;
    });
    loc.indice = indice;
  }

  /* Con la comuna abierta: sus localidades, su índice sobre la grilla y el
     resumen para la página. */
  function prepararLocalidades() {
    const nombre = base && base.nombre;
    traerLocalidades().then(function (geo) {
      if (!base || base.nombre !== nombre) return;
      return idDeComuna(nombre).then(function (id) {
        if (!base || base.nombre !== nombre) return;
        loc.idComuna = id;
        loc.lista = geo ? geo.features.filter(function (f) {
          return f.properties.id_comuna === id;
        }) : [];
        rasterizarLocalidades();
        if (loc.boton) loc.boton.parentNode.hidden = !geo;
        capasLocalidades();
        mostrarCapasLocalidades();
        if (loc.activas) repintarVista();
        emitir('resumen', resumen());
      });
    });
  }

  function idDeComuna(nombre) {
    const fuente = mapa.getSource('comunas');
    if (!fuente || typeof fuente.getData !== 'function') return Promise.resolve(null);
    return Promise.resolve(fuente.getData()).then(function (geo) {
      const buscado = normalizar(nombre);
      const f = (geo && geo.features || []).filter(function (x) {
        return normalizar(x.properties.nombre) === buscado;
      })[0];
      return f ? (f.properties.id_comuna || f.properties._id || null) : null;
    }).catch(function () { return null; });
  }

  function activarLocalidades(v) {
    loc.activas = v === undefined ? !loc.activas : !!v;
    if (loc.boton) loc.boton.setAttribute('aria-pressed', String(loc.activas));
    return traerLocalidades().then(function (geo) {
      if (!geo) return false;
      capasLocalidades();
      mostrarCapasLocalidades();
      if (vista) repintarVista();
      if (base) emitir('resumen', resumen());
      return true;
    });
  }

  function irALocalidad(id) {
    const f = loc.lista.concat(loc.geo ? loc.geo.features : []).filter(function (x) {
      return x.properties.id_ciudad === id;
    })[0];
    if (!f) return;
    const b = new maplibregl.LngLatBounds();
    const poligonos = f.geometry.type === 'MultiPolygon'
      ? f.geometry.coordinates : [f.geometry.coordinates];
    poligonos.forEach(function (pg) { pg[0].forEach(function (p) { b.extend(p); }); });
    mapa.fitBounds(b, { padding: margenes(contenedor), duration: 700, maxZoom: 15.5 });
  }

  /* El botón va en la barra de controles del mapa, junto a Satelital y 3D,
     y solo si hay localidades que mostrar. */
  function montarBotonLocalidades() {
    if (!cfg.localidades || loc.boton) return;
    const barra = contenedor.querySelector('.mapbar');
    if (!barra) return;
    const caja = document.createElement('div');
    caja.className = 'basectl';
    caja.hidden = true;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Localidades';
    b.title = 'Marcar las ciudades y pueblos de la comuna y resaltar sus sectores en riesgo';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { activarLocalidades(); });
    caja.appendChild(b);
    barra.appendChild(caja);
    loc.boton = b;
    traerLocalidades().then(function (geo) { caja.hidden = !geo; });
  }

  /* Deja como "sin dato" lo que cae fuera del polígono de la comuna. La
     grilla de teselas es el rectángulo que la contiene, y como la capa
     regional se esconde mientras la comuna está abierta, se veía un borde
     recto que no existe. El polígono sale de la misma fuente del mapa; si
     no se puede leer, se deja el rectángulo. */
  function recortarAComuna(g, nombre) {
    const fuente = mapa.getSource('comunas');
    if (!g || !fuente || typeof fuente.getData !== 'function') return Promise.resolve(g);
    return Promise.resolve(fuente.getData()).then(function (geo) {
      const buscado = normalizar(nombre);
      const f = (geo && geo.features || []).filter(function (x) {
        return normalizar(x.properties.nombre) === buscado;
      })[0];
      if (!f) return g;
      const e = g.esquinas;
      const oeste = e[0][0], este = e[1][0], yN = mercY(e[0][1]), yS = mercY(e[2][1]);
      const lienzo = document.createElement('canvas');
      lienzo.width = g.ancho; lienzo.height = g.alto;
      const ctx = lienzo.getContext('2d', { willReadFrequently: true });
      ctx.beginPath();
      const poligonos = f.geometry.type === 'MultiPolygon'
        ? f.geometry.coordinates : [f.geometry.coordinates];
      poligonos.forEach(function (poligono) {
        poligono.forEach(function (anillo) {
          anillo.forEach(function (p, i) {
            const x = (p[0] - oeste) / (este - oeste) * g.ancho;
            const y = (yN - mercY(p[1])) / (yN - yS) * g.alto;
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          });
        });
      });
      ctx.fill('evenodd');
      const a = ctx.getImageData(0, 0, g.ancho, g.alto).data;
      for (let i = 0; i < g.clases.length; i++) {
        if (a[i * 4 + 3] < 128) {
          g.clases[i] = SIN_DATO;
          if (g.valores) g.valores[i] = NaN;
        }
      }
      return g;
    }).catch(function () { return g; });
  }

  function alternarClase(k) {
    if (!estado) return;
    if (continua) {
      // Arreglo compartido: continua lo invierte y pinta toda la región.
      continua.alternar(k);
      repintarVista();
    } else if (vista) {
      estado.visibles[k] = !estado.visibles[k];
      repintarVista();
      /* La imagen de 30 m también, para cuando se aleje y la vista se quite. */
      const fuente = mapa.getSource(ID_FUENTE);
      if (fuente && estado.datos && estado.datos.lienzo) {
        fuente.updateImage({ url: pintar(estado.datos, cfg.alfas, estado.visibles),
                             coordinates: estado.ficha.esquinas });
      }
    } else {
      estado.visibles[k] = !estado.visibles[k];
      const fuente = mapa.getSource(ID_FUENTE);
      if (fuente) {
        fuente.updateImage({ url: pintar(estado.datos, cfg.alfas, estado.visibles),
                             coordinates: estado.ficha.esquinas });
      }
    }
    panel(contenedor, estado.ficha, cfg, estado, alternarClase);
  }

  return {
    /* `opciones.encuadrar: false` deja la cámara donde está: lo usa el
       visor al volver a la capa de erosión con una comuna ya abierta. */
    mostrar: function (comuna, opciones) {
      const encuadrar = !opciones || opciones.encuadrar !== false;
      const este = ++pedido;
      base = null;
      quitarVista();

      /* Modo continuo con resumen en el archivo: ni PNG ni índice. */
      const resumen = continua && continua.fichaDe(comuna);
      if (resumen) {
        quitarCapa(mapa);
        if (encuadrar) {
          const b = new maplibregl.LngLatBounds();
          resumen.esquinas.forEach(function (p) { b.extend(p); });
          mapa.fitBounds(b, { padding: margenes(contenedor), duration: 600 });
        }
        estado = { ficha: resumen, datos: { conteo: resumen.conteo },
                   visibles: continua.visibles,
                   rgb: tramosDe(cfg).map(function (t) { return hexARgb(t.color); }) };
        panel(contenedor, resumen, cfg, estado, alternarClase);
        continua.grilla(resumen.esquinas).then(function (g) {
          return este === pedido ? recortarAComuna(g, comuna.nombre) : null;
        }).then(function (g) {
          usarBase(g, g && g.esquinas, este, comuna);
        });
        return Promise.resolve(true);
      }

      return traerIndice(variable).then(function (idx) {
        const ficha = fichaDe(idx, comuna);
        quitarCapa(mapa);
        estado = null;
        if (!ficha || !ficha.esquinas || !ficha.png) {
          pistaInicial();
          return false;
        }

        const url = cfg.ruta + ficha.png;
        const colores = tramosDe(cfg).map(function (t) { return t.color; });
        const codigo = codificacionDe(cfg) || colores;

        /* El encuadre no espera a la lectura de píxeles: el zoom empieza al
           clic y el ráster aparece cuando está listo. */
        if (encuadrar) {
          const b = new maplibregl.LngLatBounds();
          ficha.esquinas.forEach(function (p) { b.extend(p); });
          mapa.fitBounds(b, { padding: margenes(contenedor), duration: 600 });
        }

        return leerClases(url, codigo, colores).then(function (datos) {
          if (este !== pedido) return false;     // se eligió otra comuna entretanto
          quitarCapa(mapa);

          /* Modo continuo: el dato ya está en pantalla para toda la región.
             Del PNG solo se usan sus conteos, para el porcentaje por clase
             de ESTA comuna, y las clases ocultas son las de la región. */
          if (continua) {
            estado = datos ? { ficha: ficha, datos: datos, visibles: continua.visibles } : null;
            panel(contenedor, ficha, cfg, estado, alternarClase);
            return true;
          }

          if (datos) {
            estado = {
              ficha: ficha, datos: datos, muestreo: null,
              visibles: cfg.clases.map(function () { return true; }),
              zoomNitido: zoomDePixel(ficha.esquinas, datos.ancho),
            };
          }

          mapa.addSource(ID_FUENTE, {
            type: 'image',
            url: datos ? pintar(datos, cfg.alfas, estado.visibles) : url,
            coordinates: ficha.esquinas,
          });
          /* Bajo los caminos, igual que el coropleto: el ráster es el dato de
             fondo y encima tienen que leerse calles, pueblos y ríos. Sin el
             beforeId quedaba sobre todo el mapa base y el zoom a una comuna no
             mostraba un solo camino. La opacidad por clase ya va en la imagen;
             aquí solo el factor del deslizador. Sin lectura de píxeles se
             conserva el 0,88 de siempre sobre el PNG original. */
          mapa.addLayer({
            id: ID_CAPA, type: 'raster', source: ID_FUENTE,
            paint: {
              'raster-opacity': (datos ? 1 : 0.88) * opacidad,
              'raster-fade-duration': 200,
              'raster-resampling': datos ? 'linear' : 'nearest',
            },
          }, bajoCaminos);
          ajustarMuestreo();

          panel(contenedor, ficha, cfg, estado, alternarClase);
          if (datos) {
            estado.rgb = datos.rgb;
            usarBase(datos, ficha.esquinas, este, comuna);
          }
          return true;
        });
      });
    },

    ocultar: function () {
      pedido++;
      base = null;
      loc.idComuna = null; loc.lista = []; loc.indice = null;
      mostrarCapasLocalidades();
      emitir('resumen', null);
      quitarVista();
      estado = null;
      quitarCapa(mapa);
      pistaInicial();
    },

    /* Si esta variable tiene algo que mostrar por celda: teselas, o al menos
       el PNG por comuna. */
    disponible: function () { return !!continua || !!cfg.ruta; },

    /* Factor 0..1 del deslizador de opacidad de la página. Antes movía solo el
       coropleto comunal, y con una comuna abierta no pasaba nada visible. */
    opacidad: function (v) {
      opacidad = Math.max(0, Math.min(1, v));
      if (continua) continua.opacidad(opacidad);
      if (mapa.getLayer(ID_CAPA)) {
        mapa.setPaintProperty(ID_CAPA, 'raster-opacity',
                              vista ? 0 : (estado ? 1 : 0.88) * opacidad);
      }
      if (vista && mapa.getLayer(vista.id + '-capa')) {
        mapa.setPaintProperty(vista.id + '-capa', 'raster-opacity', opacidad);
      }
    },

    /* Siempre false: el detalle ya no se muestra en toda la región al
       acercar, así que el coropleto comunal no tiene por qué retirarse. */
    continuo: function () { return false; },

    /* Para la página: umbral y localidades. Lo que cambia se anuncia con
       eventos sobre el contenedor del mapa —'detalle:umbral' cuando se
       conocen los cortes, 'detalle:resumen' con el % sobre el umbral de la
       comuna y de cada localidad—. */
    infoUmbral: infoUmbral,
    fijarUmbral: function (u) {
      if (!cfg.umbral) return;
      umbral = u;
      if (!base) return;
      aplicarUmbral();
      actualizarVista(true);
      emitir('resumen', resumen());
    },
    localidades: activarLocalidades,
    irALocalidad: irALocalidad,
    resumen: resumen,

    /* La grilla de la comuna abierta, de solo lectura: `valores` (índice por
       celda, o null con PNG), `original` (clase de cada celda, 255 fuera),
       `clases` (lo que pasa el umbral) y `esquinas`. null sin comuna. */
    base: function () { return base; },
    /* Localidad de cada celda: k + 1 donde cae la localidad k de
       resumen().localidades, en el orden de la lista original; 0 fuera. */
    zonas: function () { return loc.indice ? { indice: loc.indice, lista: loc.lista } : null; },
    /* Índice de la celda de la grilla bajo un punto, o -1 fuera de ella. */
    indiceEn: function (lngLat) {
      if (!base) return -1;
      const e = base.esquinas;
      const x = Math.floor((lngLat.lng - e[0][0]) / (e[1][0] - e[0][0]) * base.ancho);
      const y = Math.floor((mercY(e[0][1]) - mercY(lngLat.lat)) /
                           (mercY(e[0][1]) - mercY(e[2][1])) * base.alto);
      return (x < 0 || y < 0 || x >= base.ancho || y >= base.alto) ? -1 : y * base.ancho + x;
    },
    umbral: function () { return umbral; },
    /* `valores`: el índice recalculado por celda (Float32Array del largo de
       la grilla, NaN sin dato), con los `cortes` de clase de ese juego de
       pesos; null vuelve a lo calibrado. `opciones.umbral` fija el umbral en
       la escala nueva. */
    fijarValores: fijarValores,
    escenario: function () { return !!escenario; },
    /* GeoJSON de las zonas marcadas, o descarga en KML / GeoJSON. */
    zonasMarcadas: zonasMarcadas,
    exportarZonas: exportarZonas,
    /* El GeoJSON de las ciudades y pueblos de la región (una sola petición,
       compartida con el botón Localidades). */
    listaLocalidades: traerLocalidades,

    /* Lo que hay en la celda bajo un punto, o null fuera del dato, sin dato,
       o si su clase está oculta. La usa la ventana emergente del mapa. En
       modo continuo trae el valor exacto; `alListo` avisa cuando la tesela
       termina de decodificarse, la primera vez que el cursor entra en ella. */
    claseEn: function (lngLat, alListo) {
      if (continua) {
        /* Solo dentro de la comuna abierta: fuera de ella no se dibuja nada,
           y describir una celda que no se ve confunde. */
        if (!estado || !base) return null;
        const e = base.esquinas;
        const x = Math.floor((lngLat.lng - e[0][0]) / (e[1][0] - e[0][0]) * base.ancho);
        const y = Math.floor((mercY(e[0][1]) - mercY(lngLat.lat)) /
                             (mercY(e[0][1]) - mercY(e[2][1])) * base.alto);
        if (x < 0 || y < 0 || x >= base.ancho || y >= base.alto ||
            base.original[y * base.ancho + x] === SIN_DATO) return null;
        if (escenario) {
          const i = y * base.ancho + x, k = base.original[i];
          if (!estado.visibles[k]) return null;
          const t = tramosDe(cfg)[k];
          return { nombre: t.nombre + ' (escenario)', color: t.color,
                   valor: cfg.formato(base.valores[i]), etiqueta: cfg.celda || 'Celda de 30 m' };
        }
        return continua.celdaEn(lngLat, alListo);
      }
      if (!estado) return null;
      /* Se lee la grilla que está pintada: con la refinada, la clase que se
         nombra es la del color bajo el cursor también en los bordes. */
      function celda(g, e) {
        const x = Math.floor((lngLat.lng - e[0][0]) / (e[1][0] - e[0][0]) * g.ancho);
        const y = Math.floor((mercY(e[0][1]) - mercY(lngLat.lat)) /
                             (mercY(e[0][1]) - mercY(e[2][1])) * g.alto);
        return (x < 0 || y < 0 || x >= g.ancho || y >= g.alto) ? undefined
          : g.clases[y * g.ancho + x];
      }
      let k = vista ? celda(vista, vista.esquinas) : undefined;
      if (k === undefined) k = celda(estado.datos, estado.ficha.esquinas);
      if (k === undefined) return null;
      if (k === SIN_DATO || !estado.visibles[k]) return null;
      const t = tramosDe(cfg)[k];
      return { nombre: t.nombre, color: t.color,
               rango: t.rango ? t.rango + ' ' + cfg.unidad : null,
               etiqueta: cfg.celda || 'Celda de 30 m' };
    },

    /* Para páginas donde el detalle vale solo para una de sus capas: en
       Ciudades, la pestaña de áreas verdes no tiene mapa por píxel. Apagado
       no hay capa, ni panel, ni pista que invite a hacer clic. */
    pausar: function () {
      pedido++;
      estado = null;
      pausado = true;
      quitarCapa(mapa);
      if (continua) continua.pausar(true);
      const caja = contenedor.querySelector('.detalle-erosion');
      if (caja) caja.remove();
      const pista = contenedor.querySelector('.detalle-pista');
      if (pista) pista.remove();
      contenedor.classList.remove('map--detalle');
    },
    reanudar: function () {
      pausado = false;
      if (continua) continua.pausar(false);
      pistaInicial();
    },
  };
};
