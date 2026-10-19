/* ==========================================================================
   TerraFoco — Prototipo no funcional
   Generador de cartografía esquemática

   El mapa NO usa geometrías reales. Construye una grilla irregular de 35
   celdas (de las cuales se usan 33) mediante una retícula de puntos con
   desplazamiento pseudoaleatorio determinístico. Cada celda representa una
   comuna. En la implementación real este componente se reemplaza por
   MapLibre GL consumiendo las geometrías desde PostGIS.
   ========================================================================== */

const GTMapa = {};

/* PRNG determinístico: la misma semilla produce siempre el mismo mapa */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const COLS = 8, ROWS = 6, ANCHO = 660, ALTO = 480;

/* Retícula de puntos con jitter fijo */
function construirReticula() {
  const rnd = mulberry32(20260818);
  const p = [];
  for (let r = 0; r < ROWS; r++) {
    p[r] = [];
    for (let c = 0; c < COLS; c++) {
      const borde = (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1);
      const j = borde ? 9 : 15;
      p[r][c] = {
        x: 24 + c * 88 + (rnd() - 0.5) * 2 * j,
        y: 22 + r * 86 + (rnd() - 0.5) * 2 * j
      };
    }
  }
  return p;
}

const RETICULA = construirReticula();

/* El SVG se inyecta en un hijo propio para no borrar los overlays (leyenda,
   controles de zoom, escala) que ya viven dentro del contenedor .map */
function lienzo(contenedor) {
  let el = contenedor.querySelector('.map__canvas');
  if (!el) {
    el = document.createElement('div');
    el.className = 'map__canvas';
    contenedor.insertBefore(el, contenedor.firstChild);
  }
  return el;
}

function celda(r, c) {
  const a = RETICULA[r][c], b = RETICULA[r][c + 1],
        d = RETICULA[r + 1][c + 1], e = RETICULA[r + 1][c];
  return {
    puntos: [a, b, d, e].map(function (q) { return q.x.toFixed(1) + ',' + q.y.toFixed(1); }).join(' '),
    cx: (a.x + b.x + d.x + e.x) / 4,
    cy: (a.y + b.y + d.y + e.y) / 4
  };
}

/* ==========================================================================
   Escalas de color
   ========================================================================== */

/* Las rampas viven en js/paleta.js, derivadas de los colores institucionales */
GTMapa.rampas = PALETA.rampas;

function colorPorRampa(rampa, valor, min, max) {
  const t = Math.max(0, Math.min(0.999, (valor - min) / (max - min)));
  return GTMapa.rampas[rampa][Math.floor(t * 5)];
}

/* Clases de NDVI y pendiente: los mismos cortes que motor/teselas.py, para
   que el promedio comunal y la celda de 30 m usen una sola escala y una sola
   leyenda. */
GTMapa.clases = {
  ndvi: {
    rampa: 'vegetacion', cortes: [0.2, 0.4, 0.6, 0.8],
    nombres: ['Sin vegetación', 'Escasa', 'Moderada', 'Densa', 'Muy densa'],
    rangos: ['< 0,2', '0,2 – 0,4', '0,4 – 0,6', '0,6 – 0,8', '0,8 +'],
  },
  pendiente: {
    rampa: 'pendiente', cortes: [5, 15, 30, 50],
    nombres: ['Plana', 'Suave', 'Moderada', 'Fuerte', 'Muy fuerte'],
    rangos: ['< 5 %', '5 – 15 %', '15 – 30 %', '30 – 50 %', '50 % +'],
  },
  /* m² de área verde pública por habitante, con cortes que se leen contra
     el estándar SIEDU de 10: la última clase es "cumple". */
  verde: {
    rampa: 'areaVerde', cortes: [2.5, 5, 7.5, 10],
    nombres: ['Muy bajo', 'Bajo', 'Medio', 'Cerca', 'Cumple el estándar'],
    rangos: ['< 2,5 m²/hab', '2,5 – 5', '5 – 7,5', '7,5 – 10', '10 +'],
  },
  /* Incentivo del SIRSD-S 2012-2025 en UF por hectárea con erosión severa,
     la inversión del índice. Va de 0,3 a 34: con una rampa lineal San
     Vicente se llevaba el color más oscuro y las otras 26 quedaban en los
     dos más claros. Los cortes crecen casi al doble, como la escala
     logarítmica del gráfico de dispersión. */
  inversion: {
    rampa: 'inversion', cortes: [1, 2, 4, 10],
    nombres: ['Muy baja', 'Baja', 'Media', 'Alta', 'Muy alta'],
    rangos: ['< 1 UF/ha', '1 – 2', '2 – 4', '4 – 10', '10 +'],
  },
};

function colorPorCortes(clave, valor) {
  const c = GTMapa.clases[clave];
  let i = 0;
  while (i < c.cortes.length && valor >= c.cortes[i]) i++;
  return GTMapa.rampas[c.rampa][i];
}

/* Sin el dato medido, "sin dato" y no el número de ejemplo, salvo que toda
   la página esté en modo ejemplo (sin API ni copia), donde el badge ya lo
   declara. Mezclar un valor inventado con datos reales, sin nada que lo
   distinga, es lo que este prototipo evita en todas partes. */
function sinDatoMedido(unidad) {
  const conDatos = GT.origenDatos === 'api' || GT.origenDatos === 'copia';
  return conDatos ? { v: undefined, color: PALETA.sinDato, unidad: unidad } : null;
}

/* Erosión CIREN de EJEMPLO: la erosión multiplicada por un factor
   ilustrativo, de la fase del prototipo no funcional. Solo se usa en modo
   ejemplo (sin API ni copia); con datos, la de CIREN es la del inventario
   (comuna.erosionCiren) y la ficha, el panel y el visor la toman de ahí. */
GTMapa.erosionCirenEjemplo = function (comuna, i) {
  const factor = 0.87 + ((i * 37) % 11) * 0.028;
  return +(comuna.erosion * factor).toFixed(1);
};

/* Las dos erosiones de una comuna, para el visor, el panel general y la
   ficha: un solo lugar decide de dónde salen.
     ciren, propia  t/ha/año, o undefined si no hay dato
     enDominio      el cálculo propio es válido en esta comuna
     ejemplo        true si son cifras de ejemplo (página sin datos) */
GTMapa.erosionesDe = function (comuna, i) {
  const conDatos = GT.origenDatos === 'api' || GT.origenDatos === 'copia';
  if (conDatos) {
    return { ciren: comuna.erosionCiren, propia: comuna.erosionPropia,
             enDominio: comuna.propiaEnDominio !== false, ejemplo: false };
  }
  return { ciren: GTMapa.erosionCirenEjemplo(comuna, i || 0), propia: comuna.erosion,
           enDominio: true, ejemplo: true };
};

/* Valor y color según la capa activa */
GTMapa.valorCapa = function (comuna, capa, i) {
  switch (capa) {
    /* Las dos erosiones reales, cada una con las clases de siempre. */
    case 'erosion10': {
      const e = GTMapa.erosionesDe(comuna, i);
      if (typeof e.ciren === 'number') {
        return { v: +e.ciren.toFixed(2), color: GT.claseErosion(e.ciren).hex, unidad: 't/ha/año' };
      }
      return { v: undefined, color: PALETA.sinDato, unidad: 't/ha/año' };
    }
    case 'erosion26': {
      const e = GTMapa.erosionesDe(comuna, i);
      if (typeof e.propia !== 'number') return { v: undefined, color: PALETA.sinDato, unidad: 't/ha/año' };
      /* Fuera del dominio de validez el modelo sobreestima (Machalí: 561
         t/ha/año contra 1,7 de CIREN). Se oculta como en el índice, salvo
         que se pida verlo, y en ambos casos la ventana lo advierte. */
      if (!e.enDominio && !GT.incluirFueraDeDominio) {
        return { v: undefined, color: PALETA.sinDato, unidad: 't/ha/año', nota: 'fuera del dominio del modelo' };
      }
      return { v: +e.propia.toFixed(2), color: GT.claseErosion(e.propia).hex, unidad: 't/ha/año',
               nota: e.enDominio ? null : 'fuera del dominio: el modelo sobreestima' };
    }
    /* NDVI y pendiente medidos (/comunas/terreno). El cálculo de respaldo,
       derivado de la erosión, es de la fase del prototipo no funcional y
       solo se usa cuando la página entera está en modo ejemplo. */
    case 'ndvi':
      if (typeof comuna.ndvi === 'number') {
        return { v: +comuna.ndvi.toFixed(2), color: colorPorCortes('ndvi', comuna.ndvi), unidad: 'NDVI mediano' };
      }
      return sinDatoMedido('NDVI') ||
        { v: +(0.72 - comuna.erosion * 0.011).toFixed(2), color: colorPorCortes('ndvi', 0.72 - comuna.erosion * 0.011), unidad: 'NDVI (ejemplo)' };
    case 'pendiente':
      if (typeof comuna.pendiente === 'number') {
        return { v: comuna.pendiente, color: colorPorCortes('pendiente', comuna.pendiente), unidad: '% medio' };
      }
      return sinDatoMedido('%') ||
        { v: +(comuna.erosion * 0.62).toFixed(1), color: colorPorCortes('pendiente', comuna.erosion * 0.62), unidad: '% (ejemplo)' };
    case 'inversion': {
      /* El denominador es la superficie con erosión severa del cálculo
         propio, que fuera del dominio sobreestima: la inversión por ha de
         Machalí saldría 0,003 UF porque el modelo le atribuye 130.000 ha
         severas. Se oculta como su erosión, salvo que se pida verla. */
      if (comuna.fueraDeDominio && !GT.incluirFueraDeDominio) {
        return { v: undefined, color: PALETA.sinDato, unidad: 'UF/ha', nota: 'fuera del dominio del modelo' };
      }
      if (typeof comuna.inversionUFha === 'number') {
        return { v: +comuna.inversionUFha.toFixed(comuna.inversionUFha < 1 ? 2 : 1),
                 color: colorPorCortes('inversion', comuna.inversionUFha), unidad: 'UF/ha erosionada' };
      }
      const r = GT.inversionDe(comuna) || 0;
      return { v: +r.toFixed(1), color: colorPorRampa('agua', r, 0.5, 20), unidad: 'ha/1.000 ha' };
    }
    case 'pertinencia':
      if (!GT.enIndice(comuna)) {
        return { v: undefined, color: PALETA.sinDato, unidad: 'índice', nota: GT.motivoSinIndice(comuna).toLowerCase() };
      }
      /* Por categoría y no por rampa: la rampa lineal de 0,15 a 0,95 cortaba
         en otros valores que las categorías, y Lolol (0,63) salía en el mapa
         como alineación parcial y en la tabla como brecha alta. */
      return { v: +comuna.indice.toFixed(2), color: GT.categoriaPertinencia(comuna.indice).hex, unidad: 'índice' };
    case 'urbano-temp': {
      const u = GT.datoUrbano(comuna.nombre);
      if (!u) return { v: null, color: PALETA.sinDato, unidad: '°C' };
      /* Con dato real la escala es la del dato: ECOSTRESS promedia pasadas de
         día y de noche y ronda los 20-26 °C, no los 30-36 del ejemplo diurno.
         Con la escala fija todo saldría del mismo color frío. */
      const r = GT.urbanoRango || [30, 36];
      return { v: u.temp, color: colorPorRampa('calor', u.temp, r[0], r[1]), unidad: '°C' };
    }
    case 'urbano-verde': {
      const u = GT.datoUrbano(comuna.nombre);
      if (!u) return { v: null, color: PALETA.sinDato, unidad: 'm²/hab' };
      /* Con el dato real (Censo 2024 y OSM), las clases del estándar; el de
         ejemplo conserva su rampa y la unidad lo dice. */
      if (u.verdeReal) {
        return { v: +u.verde.toFixed(1), color: colorPorCortes('verde', u.verde), unidad: 'm²/hab urbano' };
      }
      return { v: u.verde, color: colorPorRampa('vegetacion', u.verde, 2, 9), unidad: 'm²/hab (ejemplo)' };
    }
    case 'inundacion': {
      /* Con la API, el índice real del motor (indicadores.inundacion), que va
         de 0 a 1. Sin ella, la aproximación de ejemplo: inversa a la
         pendiente, aproximada por la erosión. */
      /* Por la CLASE comunal que entrega el motor, no por el valor sobre una
         escala fija. La escala estaba en 0,40–0,65, de una corrida anterior;
         con la calibración vigente los índices comunales van de 0,34 a 0,38,
         todos caían bajo el mínimo y las 33 comunas salían del mismo azul.
         Las clases son cuartiles entre comunas y usan los mismos colores que
         el detalle a 30 m. Tres decimales: las comunas se separan en el
         tercero, y con dos la mitad se leía igual. */
      if (typeof comuna.susceptibilidad === 'number') {
        const r = comuna.susceptibilidad;
        const k = GTMapa.CLASES_INUNDACION.indexOf(comuna.claseInundacion);
        if (k >= 0) {
          return { v: +r.toFixed(3), color: PALETA.rampas.agua[k + 1],
                   unidad: '· ' + comuna.claseInundacion.toLowerCase() };
        }
        const vs = GT.comunas.map(function (c) { return c.susceptibilidad; })
          .filter(function (x) { return typeof x === 'number'; });
        return { v: +r.toFixed(3), unidad: 'susceptibilidad',
                 color: colorPorRampa('agua', r, Math.min.apply(null, vs), Math.max.apply(null, vs)) };
      }
      const s = Math.max(0.08, Math.min(0.95, 0.98 - comuna.erosion * 0.022));
      return { v: +s.toFixed(2), color: colorPorRampa('agua', s, 0.08, 0.95), unidad: 'susceptibilidad' };
    }
    default:
      return { v: comuna.erosion, color: GT.claseErosion(comuna.erosion).hex, unidad: 't/ha/año' };
  }
};

/* ==========================================================================
   Mapa regional
   ========================================================================== */

GTMapa.crearRegional = function (contenedor, opciones) {
  const cfg = Object.assign({ capa: 'erosion26', etiquetas: true, limites: true, alSeleccionar: null }, opciones);
  let seleccionada = cfg.seleccionada || null;

  function pintar() {
    const piezas = GT.comunas.map(function (comuna, i) {
      const g = celda(comuna.r, comuna.c);
      const info = GTMapa.valorCapa(comuna, cfg.capa, i);
      const activa = comuna.id === seleccionada ? ' is-active' : '';
      return '<polygon class="map__cell' + activa + '" data-id="' + comuna.id + '" points="' + g.puntos + '" ' +
             'fill="' + info.color + '" stroke="' + (cfg.limites ? PALETA.mapaFondo : 'none') +
             '" stroke-width="1.6" stroke-linejoin="round">' +
             '<title>' + comuna.nombre + ' — ' + info.v + ' ' + info.unidad + '</title></polygon>';
    }).join('');

    const etiquetas = cfg.etiquetas ? GT.comunas.map(function (comuna) {
      const g = celda(comuna.r, comuna.c);
      const corto = comuna.nombre.length > 13 ? comuna.nombre.slice(0, 11) + '…' : comuna.nombre;
      return '<text class="map__label" x="' + g.cx.toFixed(0) + '" y="' + g.cy.toFixed(0) + '" text-anchor="middle">' + corto + '</text>';
    }).join('') : '';

    /* Cauce principal esquemático — río Cachapoal / Tinguiririca */
    const rio = '<path d="M645 96 C 560 130, 500 148, 430 168 S 300 214, 236 262 S 132 322, 46 392" ' +
                'fill="none" stroke="' + PALETA.azulClaro + '" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>';

    const destino = lienzo(contenedor);
    destino.innerHTML =
      '<svg viewBox="0 0 ' + ANCHO + ' ' + ALTO + '" role="img" aria-label="Mapa esquemático de la Región de O\'Higgins">' +
        '<rect width="' + ANCHO + '" height="' + ALTO + '" fill="' + PALETA.mapaFondo + '"/>' +
        piezas + rio + etiquetas +
      '</svg>';

    destino.querySelectorAll('.map__cell').forEach(function (el) {
      el.addEventListener('click', function () {
        seleccionada = el.dataset.id;
        pintar();
        if (cfg.alSeleccionar) cfg.alSeleccionar(GT.comuna(seleccionada));
      });
    });
  }

  pintar();

  return {
    cambiarCapa: function (capa) { cfg.capa = capa; pintar(); },
    cambiarLimites: function (v) { cfg.limites = v; pintar(); },
    cambiarEtiquetas: function (v) { cfg.etiquetas = v; pintar(); },
    seleccionar: function (id) { seleccionada = id; pintar(); }
  };
};

/* ==========================================================================
   Mapa urbano — manzanas de una ciudad
   ========================================================================== */

GTMapa.crearCiudad = function (contenedor, opciones) {
  const cfg = Object.assign({ metrica: 'temp', alSeleccionar: null }, opciones);
  let seleccionada = null;

  /* 12 unidades vecinales dispuestas en una grilla de 4 x 3 con manzanas */
  function pintar() {
    const anchoUV = 156, altoUV = 148, gap = 6;
    const bloques = GT.unidadesVecinales.map(function (uv, i) {
      const col = i % 4, fil = Math.floor(i / 4);
      const x0 = 16 + col * (anchoUV + gap);
      const y0 = 16 + fil * (altoUV + gap);
      const valor = cfg.metrica === 'temp' ? uv.temp : uv.verde;
      const color = cfg.metrica === 'temp'
        ? colorPorRampa('calor', uv.temp, 29, 37)
        : colorPorRampa('vegetacion', uv.verde, 0.5, 11.5);

      /* manzanas interiores */
      let manzanas = '';
      for (let mf = 0; mf < 4; mf++) {
        for (let mc = 0; mc < 4; mc++) {
          manzanas += '<rect x="' + (x0 + 10 + mc * 34) + '" y="' + (y0 + 10 + mf * 32) + '" ' +
                      'width="28" height="26" rx="2" fill="rgba(4,10,20,.35)"/>';
        }
      }

      const activa = uv.id === seleccionada ? ' is-active' : '';
      return '<g class="map__cell' + activa + '" data-id="' + uv.id + '">' +
               '<rect x="' + x0 + '" y="' + y0 + '" width="' + anchoUV + '" height="' + altoUV + '" rx="3" fill="' + color + '"/>' +
               manzanas +
               '<text class="map__label" x="' + (x0 + 8) + '" y="' + (y0 + altoUV - 8) + '">' + uv.nombre.split('—')[0].trim() + '</text>' +
               '<title>' + uv.nombre + ' — ' + valor + (cfg.metrica === 'temp' ? ' °C' : ' m²/hab') + '</title>' +
             '</g>';
    }).join('');

    const destino = lienzo(contenedor);
    destino.innerHTML =
      '<svg viewBox="0 0 660 480" role="img" aria-label="Mapa esquemático de unidades vecinales">' +
        '<rect width="660" height="480" fill="' + PALETA.mapaFondo + '"/>' + bloques +
      '</svg>';

    destino.querySelectorAll('.map__cell').forEach(function (el) {
      el.addEventListener('click', function () {
        seleccionada = el.dataset.id;
        pintar();
        if (cfg.alSeleccionar) {
          cfg.alSeleccionar(GT.unidadesVecinales.find(function (u) { return u.id === seleccionada; }));
        }
      });
    });
  }

  pintar();

  return { cambiarMetrica: function (m) { cfg.metrica = m; pintar(); } };
};

/* ==========================================================================
   Leyenda
   ========================================================================== */

GTMapa.leyendaRampa = function (rampa, min, max, unidad) {
  const colores = GTMapa.rampas[rampa].map(function (c) {
    return '<span style="background:' + c + '"></span>';
  }).join('');
  return '<div class="legend">' +
           '<div class="legend__ramp">' + colores + '</div>' +
           '<div class="legend__scale"><span>' + min + '</span><span>' + unidad + '</span><span>' + max + '</span></div>' +
         '</div>';
};

/* Leyenda por clases de NDVI o pendiente (GTMapa.clases). */
GTMapa.leyendaCortes = function (clave) {
  const c = GTMapa.clases[clave];
  const colores = GTMapa.rampas[c.rampa];
  return '<div class="legend">' + c.nombres.map(function (n, i) {
    return '<div class="legend__row">' +
             '<span class="legend__swatch" style="background:' + colores[i] + '"></span>' +
             '<span>' + n + '</span>' +
             '<span class="muted tiny mono" style="margin-left:auto">' + c.rangos[i] + '</span>' +
           '</div>';
  }).join('') + '</div>';
};

/* Renglón gris de las comunas sin valor en la capa, con el motivo. Sin él,
   el gris del mapa no aparecía en ninguna leyenda y se leía como otra clase. */
GTMapa.filaSinDato = function (texto) {
  return '<div class="legend"><div class="legend__row">' +
           '<span class="legend__swatch" style="background:' + PALETA.sinDato + '"></span>' +
           '<span class="muted">' + texto + '</span>' +
         '</div></div>';
};

/* Las cinco categorías del índice, con sus cortes: la misma leyenda que
   los badges de la tabla y la ficha. */
GTMapa.leyendaPertinencia = function () {
  return '<div class="legend">' + GT.categoriasPertinencia.map(function (c, i) {
    const desde = i === 0 ? '0' : GT.fmt(GT.categoriasPertinencia[i - 1].max, 2);
    const hasta = c.max > 1 ? '1' : GT.fmt(c.max, 2);
    return '<div class="legend__row">' +
             '<span class="legend__swatch" style="background:' + c.hex + '"></span>' +
             '<span>' + c.nombre + '</span>' +
             '<span class="muted tiny mono" style="margin-left:auto">' + desde + ' – ' + hasta + '</span>' +
           '</div>';
  }).join('') + '</div>';
};

GTMapa.CLASES_INUNDACION = ['Baja', 'Media', 'Alta', 'Muy alta'];

/* Leyenda del coropleto de inundación: las cuatro clases comunales con el
   rango de índice que abarca cada una en los datos cargados. Dice que son
   relativas: la diferencia entre la comuna más baja y la más alta es de
   pocas centésimas, y un "Muy alta" absoluto sería engañoso. */
GTMapa.leyendaInundacion = function () {
  const n = GT.comunas.length;
  return '<div class="legend">' + GTMapa.CLASES_INUNDACION.map(function (nombre, k) {
    const vs = GT.comunas.filter(function (c) { return c.claseInundacion === nombre; })
      .map(function (c) { return c.susceptibilidad; });
    const rango = vs.length
      ? GT.fmt(Math.min.apply(null, vs), 3) + ' – ' + GT.fmt(Math.max.apply(null, vs), 3) : '—';
    return '<div class="legend__row">' +
             '<span class="legend__swatch" style="background:' + PALETA.rampas.agua[k + 1] + '"></span>' +
             '<span>' + nombre + '</span>' +
             '<span class="muted tiny mono" style="margin-left:auto">' + rango + '</span>' +
           '</div>';
  }).join('') +
  '<div class="tiny muted" style="margin-top:2px">Cuartiles del índice entre las ' + n + ' comunas</div>' +
  '</div>';
};

GTMapa.leyendaClases = function () {
  return '<div class="legend">' + GT.clasesErosion.map(function (c, i) {
    const desde = i === 0 ? '0' : GT.clasesErosion[i - 1].max;
    const hasta = c.max === 999 ? '+' : '– ' + c.max;
    return '<div class="legend__row">' +
             '<span class="legend__swatch" style="background:' + c.hex + '"></span>' +
             '<span>' + c.nombre + '</span>' +
             '<span class="muted tiny mono" style="margin-left:auto">' + desde + ' ' + hasta + '</span>' +
           '</div>';
  }).join('') + '</div>';
};
