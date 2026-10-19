/* ==========================================================================
   TerraFoco — Gráficos en SVG, sin librerías externas

   Los colores salen de roles de PALETA (tinta, gris, rejilla, serie1...)
   y no de nombres de marca: así el tema se cambia en un solo lugar.
   ========================================================================== */

const GTGrafico = {};

/* Degradé vertical para rellenar un área: del color de la serie, arriba,
   a transparente en la base. Cada gráfico necesita su propio id —puede
   haber varios en la misma página— y el contador lo garantiza. */
let contadorDegrade = 0;
function degradeVertical(color, opacidadArriba) {
  const id = 'gt-degrade-' + (++contadorDegrade);
  return {
    id: id,
    def: '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
           '<stop offset="0" stop-color="' + color + '" stop-opacity="' + opacidadArriba + '"/>' +
           '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/>' +
         '</linearGradient></defs>'
  };
}

/* Lo que se LEE va con coma decimal (GT.fmt, es-CL). Lo que es sintaxis
   —anchos en %, coordenadas del SVG— sigue con punto: con coma, el
   navegador no lo entiende. */
function numeroLegible(v, decimales) {
  return decimales === undefined
    ? Number(v).toLocaleString('es-CL', { maximumFractionDigits: 2 })
    : GT.fmt(Number(v), decimales);
}

/* Barras horizontales con etiqueta y valor */
GTGrafico.barras = function (datos, opciones) {
  const cfg = Object.assign({ max: null, decimales: 2, sufijo: '' }, opciones);
  const max = cfg.max || Math.max.apply(null, datos.map(function (d) { return d.valor; }));
  return datos.map(function (d) {
    const pct = (d.valor / max) * 100;
    return '<div class="bar-row">' +
             '<div class="bar-row__name">' + d.nombre + '</div>' +
             '<div class="bar-row__track"><div class="bar-row__fill" style="width:' + pct.toFixed(1) + '%;' +
               (d.color ? 'background:' + d.color : '') + '"></div></div>' +
             '<div class="bar-row__val">' + numeroLegible(d.valor, cfg.decimales) + cfg.sufijo + '</div>' +
           '</div>';
  }).join('');
};

/* Barras verticales agrupadas — comparación entre dos series */
GTGrafico.comparacion = function (contenedor, categorias, serieA, serieB, etiquetas) {
  const W = 620, H = 210, padL = 34, padB = 34, padT = 12;
  const max = Math.max.apply(null, serieA.concat(serieB)) * 1.15;
  const anchoGrupo = (W - padL - 10) / categorias.length;
  const anchoBarra = Math.min(26, anchoGrupo / 2.8);

  let barras = '', ejes = '';

  for (let i = 0; i <= 4; i++) {
    const y = padT + (H - padT - padB) * (1 - i / 4);
    const v = numeroLegible(max * i / 4, 0);
    ejes += '<line x1="' + padL + '" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="' + PALETA.rejilla + '" stroke-width="1"/>' +
            '<text x="' + (padL - 7) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="9" fill="' + PALETA.gris + '" font-family="Roboto Mono, monospace">' + v + '</text>';
  }

  categorias.forEach(function (cat, i) {
    const x0 = padL + i * anchoGrupo + anchoGrupo / 2;
    const hA = (serieA[i] / max) * (H - padT - padB);
    const hB = (serieB[i] / max) * (H - padT - padB);
    barras += '<rect x="' + (x0 - anchoBarra - 2) + '" y="' + (H - padB - hA) + '" width="' + anchoBarra + '" height="' + hA + '" rx="2" fill="' + PALETA.serie1 + '"/>' +
              '<rect x="' + (x0 + 2) + '" y="' + (H - padB - hB) + '" width="' + anchoBarra + '" height="' + hB + '" rx="2" fill="' + PALETA.serie2 + '"/>' +
              '<text x="' + x0 + '" y="' + (H - padB + 15) + '" text-anchor="middle" font-size="10" fill="' + PALETA.tinta + '">' + cat + '</text>';
  });

  const leyenda =
    '<g transform="translate(' + padL + ',' + (H - 6) + ')">' +
      '<rect x="0" y="-8" width="10" height="10" rx="2" fill="' + PALETA.serie1 + '"/>' +
      '<text x="15" y="0" font-size="10" fill="' + PALETA.tinta2 + '">' + etiquetas[0] + '</text>' +
      '<rect x="' + (etiquetas[0].length * 5.6 + 30) + '" y="-8" width="10" height="10" rx="2" fill="' + PALETA.serie2 + '"/>' +
      '<text x="' + (etiquetas[0].length * 5.6 + 45) + '" y="0" font-size="10" fill="' + PALETA.tinta2 + '">' + etiquetas[1] + '</text>' +
    '</g>';

  contenedor.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + (H + 6) + '" style="width:100%;height:auto">' +
    ejes + barras + leyenda + '</svg>';
};

/* Dispersión con cuadrantes — necesidad frente a inversión */
GTGrafico.dispersion = function (contenedor, opciones) {
  const cfg = Object.assign({ alSeleccionar: null }, opciones);
  const W = 640, H = 420, padL = 52, padB = 46, padT = 16, padR = 16;
  const ix = W - padR, iy = H - padB;

  /* Los ejes se calibran con los datos, no con constantes. Estaban fijos en 42
     y 22 —tomados de los datos de ejemplo— y con la linea base real de CIREN,
     que llega a 25,9 t/ha/ano, las 33 comunas quedaban aplastadas contra la
     esquina inferior izquierda usando poco mas de la mitad del area util. */
  /* Solo las comunas que entran al índice: las fuera de dominio llegan con
     su erosión real pero sin índice, y un punto sin categoría no tiene
     color con que pintarse. */
  const comunas = GT.comunasIndice();

  /* La inversión es la del índice: UF del SIRSD-S por hectárea con erosión
     severa. Va de 0,3 a 34 —dos órdenes de magnitud— y en escala lineal
     cuatro comunas se comían el eje y el resto quedaba pegado al piso. El
     índice la normaliza con logaritmo; el gráfico la muestra igual, para
     que lo que se ve sea lo que se calcula. Sin API (medida anterior, ha
     por 1.000 ha) el eje sigue lineal. */
  const inversion = function (c) { return GT.inversionDe(c) || 0; };
  const logY = GT.unidadInversion().indexOf('UF') === 0 &&
               comunas.every(function (c) { return inversion(c) > 0; });

  /* Se redondea al paso de la rejilla de CADA eje —6 divisiones en X, 4 en Y—
     para que las etiquetas salgan enteras sin dejar holgura de mas. */
  const techo = function (valores, divisiones, minimo) {
    const alto = Math.max.apply(null, valores.concat([0])) * 1.12;
    return Math.max(minimo, Math.ceil(alto / divisiones) * divisiones);
  };

  const maxX = techo(comunas.map(function (c) { return c.erosion || 0; }), 6, 12);

  /* Eje Y: décadas enteras en logarítmica (0,1 · 1 · 10 · 100), cuartos en
     lineal. */
  const valoresY = comunas.map(inversion);
  let yMin = 0, yMax, marcasY;
  if (logY) {
    yMin = Math.pow(10, Math.floor(Math.log10(Math.min.apply(null, valoresY))));
    yMax = Math.pow(10, Math.ceil(Math.log10(Math.max.apply(null, valoresY))));
    marcasY = [];
    for (let d = yMin; d <= yMax * 1.0001; d *= 10) marcasY.push(d);
  } else {
    yMax = techo(valoresY, 4, 8);
    marcasY = [0, 1, 2, 3, 4].map(function (j) { return yMax * j / 4; });
  }

  const px = function (v) { return padL + (v / maxX) * (ix - padL); };
  const py = logY
    ? function (v) {
        const t = (Math.log10(v) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin));
        return iy - t * (iy - padT);
      }
    : function (v) { return iy - (v / yMax) * (iy - padT); };

  /* Los cortes tambien: estaban en 24 y 9, y con el dato real dejaban los
     cuadrantes casi vacios —el de la brecha, que es el que da sentido al
     grafico, se quedaba con una comuna—. La mediana reparte siempre, y define
     la brecha como lo que se quiere mirar: erosion sobre la mediana regional
     con inversion bajo la mediana regional. */
  const mediana = function (valores) {
    const v = valores.slice().sort(function (a, b) { return a - b; });
    if (!v.length) return 0;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };

  const cortX = px(mediana(comunas.map(function (c) { return c.erosion || 0; })));
  const cortY = py(mediana(valoresY));

  let rejilla = '';
  for (let i = 0; i <= 6; i++) {
    const x = padL + (ix - padL) * i / 6;
    rejilla += '<line x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + iy + '" stroke="' + PALETA.rejilla + '"/>' +
               '<text x="' + x + '" y="' + (iy + 15) + '" text-anchor="middle" font-size="9" fill="' + PALETA.gris + '" font-family="Roboto Mono, monospace">' + numeroLegible(maxX * i / 6, 0) + '</text>';
  }
  marcasY.forEach(function (v) {
    const y = py(v);
    const dec = v >= 1 ? 0 : Math.round(-Math.log10(v));
    rejilla += '<line x1="' + padL + '" y1="' + y + '" x2="' + ix + '" y2="' + y + '" stroke="' + PALETA.rejilla + '"/>' +
               '<text x="' + (padL - 8) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="9" fill="' + PALETA.gris + '" font-family="Roboto Mono, monospace">' + numeroLegible(v, logY ? dec : 0) + '</text>';
  });
  /* En logarítmica se marcan también 2 y 5 de cada década, sin rótulo: sin
     ellas las distancias entre décadas se leen como lineales. */
  if (logY) {
    marcasY.slice(0, -1).forEach(function (d) {
      [2, 5].forEach(function (k) {
        const y = py(d * k);
        rejilla += '<line x1="' + padL + '" y1="' + y + '" x2="' + ix + '" y2="' + y + '" stroke="' + PALETA.rejilla + '" stroke-dasharray="2 3" opacity=".7"/>';
      });
    });
  }

  const cuadrantes =
    '<rect x="' + cortX + '" y="' + cortY + '" width="' + (ix - cortX) + '" height="' + (iy - cortY) + '" fill="' + PALETA.naranja + '" opacity=".08"/>' +
    '<text x="' + (ix - 10) + '" y="' + (iy - 10) + '" text-anchor="end" font-size="10.5" font-weight="600" fill="' + PALETA.naranja + '">Brecha: erosión sobre la mediana, inversión bajo la mediana</text>' +
    '<text x="' + (padL + 10) + '" y="' + (padT + 16) + '" font-size="10.5" font-weight="600" fill="' + PALETA.turquesa + '">Sobre-cobertura</text>' +
    '<line x1="' + cortX + '" y1="' + padT + '" x2="' + cortX + '" y2="' + iy + '" stroke="' + PALETA.borde2 + '" stroke-dasharray="4 3"/>' +
    '<line x1="' + padL + '" y1="' + cortY + '" x2="' + ix + '" y2="' + cortY + '" stroke="' + PALETA.borde2 + '" stroke-dasharray="4 3"/>';

  const unidadCorta = logY ? ' UF/ha' : ' ha/1.000 ha';
  const puntos = comunas.map(function (c) {
    const x = px(c.erosion);
    const y = py(inversion(c));
    const cat = GT.categoriaPertinencia(c.indice);
    /* Las fuera de dominio, si se piden, van con borde discontinuo: se ven,
       pero no se confunden con las validadas. */
    const borde = c.fueraDeDominio
      ? ' stroke="' + PALETA.tinta + '" stroke-width="1.5" stroke-dasharray="2 2"'
      : ' stroke="' + PALETA.superficie + '" stroke-width="2"';
    return '<g class="punto" data-id="' + c.id + '" style="cursor:pointer">' +
             '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="6" fill="' + cat.hex + '"' + borde + '/>' +
             '<title>' + c.nombre + ' — ' + numeroLegible(c.erosion, 1) + ' t/ha/año · ' +
               numeroLegible(inversion(c), logY && inversion(c) < 1 ? 2 : 1) + unidadCorta +
               ' · índice ' + numeroLegible(c.indice, 2) +
               (c.fueraDeDominio ? ' · fuera de dominio' : '') + '</title>' +
           '</g>';
  }).join('');

  /* Se rotulan las cuatro de mayor brecha en vez de cuatro comunas escritas a
     mano: con la linea base real las interesantes no son las mismas que en los
     datos de ejemplo, y rotular a dedo dejaba el grafico senalando otra cosa. */
  const destacadas = comunas.slice()
    .sort(function (a, b) { return b.indice - a.indice; })
    .slice(0, 4)
    .map(function (c) {
      const x = px(c.erosion), y = py(inversion(c));
      return '<text x="' + (x + 9) + '" y="' + (y + 3) + '" font-size="10" fill="' + PALETA.tinta + '">' + c.nombre + '</text>';
    }).join('');

  const titulosEjes =
    '<text x="' + ((padL + ix) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10.5" fill="' + PALETA.gris + '">Erosión estimada — t/ha/año</text>' +
    '<text transform="translate(13,' + ((padT + iy) / 2) + ') rotate(-90)" text-anchor="middle" font-size="10.5" fill="' + PALETA.gris + '">' +
      (logY ? 'Incentivo SIRSD-S — UF por ha erosionada (log)' : 'Superficie bonificada — ha por cada 1.000 ha') + '</text>';

  contenedor.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">' +
    rejilla + cuadrantes + puntos + destacadas + titulosEjes + '</svg>';

  if (cfg.alSeleccionar) {
    contenedor.querySelectorAll('.punto').forEach(function (el) {
      el.addEventListener('click', function () { cfg.alSeleccionar(GT.comuna(el.dataset.id)); });
    });
  }
};

/* Focalización año a año — pertinencia.html.
   Arriba, qué parte del incentivo de cada año fue a las comunas más
   erosionadas, contra la línea de lo que les tocaría por su superficie
   severa; el área entre ambas es la brecha de focalización. Abajo, cuánto
   incentivo hubo que repartir cada año en toda la región: sin eso, una
   participación estable esconde que el programa se achicó. */
GTGrafico.focalizacion = function (contenedor, datos) {
  const serie = datos.serie.filter(function (s) { return typeof s.participacion === 'number'; });
  if (!serie.length) { contenedor.innerHTML = ''; return; }
  const W = 640, H = 340, padL = 44, padR = 96;
  const arriba = [20, 190], abajo = [250, 304];
  const n = serie.length;
  const paso = (W - padL - padR) / (n - 1);
  const x = function (i) { return padL + i * paso; };

  /* Eje de participación en décimas, con aire alrededor de datos y referencia. */
  const valores = serie.map(function (s) { return s.participacion; }).concat([datos.referencia]);
  const yMin = Math.max(0, Math.floor((Math.min.apply(null, valores) - 0.05) * 10) / 10);
  const yMax = Math.min(1, Math.ceil((Math.max.apply(null, valores) + 0.05) * 10) / 10);
  const y = function (v) { return arriba[1] - (v - yMin) / (yMax - yMin) * (arriba[1] - arriba[0]); };
  const pct = function (v) { return GT.fmt(v * 100, 0) + ' %'; };
  const tinta = PALETA.rampas.erosion[3];

  let rejilla = '';
  for (let v = yMin; v <= yMax + 1e-9; v += 0.1) {
    rejilla += '<line x1="' + padL + '" y1="' + y(v) + '" x2="' + (W - padR) + '" y2="' + y(v) + '" stroke="' + PALETA.rejilla + '"/>' +
               '<text x="' + (padL - 8) + '" y="' + (y(v) + 3.5) + '" text-anchor="end" font-size="9" fill="' + PALETA.gris + '" font-family="Roboto Mono, monospace">' + pct(v) + '</text>';
  }

  const yRef = y(datos.referencia);
  const puntos = serie.map(function (s, i) { return x(i).toFixed(1) + ',' + y(s.participacion).toFixed(1); });
  const brecha = 'M' + x(0) + ',' + yRef + ' L' + puntos.join(' L') + ' L' + x(n - 1) + ',' + yRef + ' Z';

  const referencia =
    '<line x1="' + padL + '" y1="' + yRef + '" x2="' + (W - padR) + '" y2="' + yRef + '" stroke="' + PALETA.tinta + '" stroke-width="1.5" stroke-dasharray="5 4"/>' +
    '<text x="' + (W - padR + 8) + '" y="' + (yRef - 3) + '" font-size="10" font-weight="600" fill="' + PALETA.tinta + '">' + pct(datos.referencia) + '</text>' +
    '<text x="' + (W - padR + 8) + '" y="' + (yRef + 10) + '" font-size="9" fill="' + PALETA.gris + '">según su</text>' +
    '<text x="' + (W - padR + 8) + '" y="' + (yRef + 21) + '" font-size="9" fill="' + PALETA.gris + '">superficie severa</text>';

  const ultima = serie[n - 1];
  const relleno = degradeVertical(tinta, 0.2);
  const linea =
    relleno.def +
    '<path d="' + brecha + '" fill="url(#' + relleno.id + ')"/>' +
    '<polyline points="' + puntos.join(' ') + '" fill="none" stroke="' + tinta + '" stroke-width="2.2" stroke-linejoin="round"/>' +
    serie.map(function (s, i) {
      return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(s.participacion).toFixed(1) + '" r="3.5" fill="' + PALETA.superficie + '" stroke="' + tinta + '" stroke-width="2">' +
               '<title>' + s.anio + ': ' + pct(s.participacion) + ' del incentivo (' + GT.fmtUF(s.incentivo_uf_mas_erosionadas) +
               ' de ' + GT.fmtUF(s.incentivo_uf) + ')</title></circle>';
    }).join('') +
    '<text x="' + (W - padR + 8) + '" y="' + (y(ultima.participacion) + 4) + '" font-size="10" font-weight="600" fill="' + tinta + '">' + pct(ultima.participacion) + '</text>' +
    '<text x="' + padL + '" y="' + (arriba[0] - 8) + '" font-size="10" fill="' + PALETA.gris + '">% del incentivo del año que recibieron las ' + datos.comunas_mas_erosionadas.length + ' comunas más erosionadas</text>';

  /* Barras del total regional, en miles de UF. */
  const maxUF = Math.max.apply(null, serie.map(function (s) { return s.incentivo_uf_region || s.incentivo_uf; }));
  const alto = abajo[1] - abajo[0];
  const anchoBarra = Math.min(22, paso * 0.62);
  const iMax = serie.reduce(function (m, s, i) {
    return (s.incentivo_uf_region || 0) > (serie[m].incentivo_uf_region || 0) ? i : m;
  }, 0);
  const barras = serie.map(function (s, i) {
    const v = s.incentivo_uf_region || s.incentivo_uf;
    const h = v / maxUF * alto;
    const rotulo = (i === iMax || i === n - 1)
      ? '<text x="' + x(i) + '" y="' + (abajo[1] - h - 4) + '" text-anchor="middle" font-size="9" fill="' + PALETA.tinta + '" font-family="Roboto Mono, monospace">' + GT.fmt(v / 1000, 0) + '</text>' : '';
    return '<rect x="' + (x(i) - anchoBarra / 2).toFixed(1) + '" y="' + (abajo[1] - h).toFixed(1) + '" width="' + anchoBarra.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + PALETA.rampas.agua[2] + '">' +
             '<title>' + s.anio + ': ' + GT.fmtUF(v) + ' en la región' + (s.planes_region ? ' · ' + GT.fmt(s.planes_region) + ' planes' : '') + '</title></rect>' + rotulo;
  }).join('') +
    '<text x="' + padL + '" y="' + (abajo[0] - 26) + '" font-size="10" fill="' + PALETA.gris + '">Incentivo pagado en toda la región, miles de UF</text>';

  const anios = serie.map(function (s, i) {
    return '<text x="' + x(i) + '" y="' + (abajo[1] + 15) + '" text-anchor="middle" font-size="9" fill="' + PALETA.gris + '" font-family="Roboto Mono, monospace">' +
           (n > 10 ? "'" + String(s.anio).slice(2) : s.anio) + '</text>';
  }).join('');

  contenedor.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + (H + 6) + '" style="width:100%;height:auto" role="img" ' +
    'aria-label="Participación de las comunas más erosionadas en el incentivo de cada año">' +
    rejilla + referencia + linea + barras + anios + '</svg>';
};

/* Serie temporal simple — inversión por año */
GTGrafico.serie = function (contenedor, anios, valores, etiqueta) {
  const W = 620, H = 170, padL = 40, padB = 28, padT = 12;
  const max = (Math.max.apply(null, valores.filter(function (v) { return v !== null; }).concat([0])) || 1) * 1.2;
  const paso = (W - padL - 12) / (anios.length - 1);
  const x = function (i) { return (padL + i * paso).toFixed(1); };
  const y = function (v) { return (H - padB - (v / max) * (H - padT - padB)).toFixed(1); };

  /* Un null (año reservado) corta la serie: cada tramo continuo lleva su
     propia línea y su propia área. */
  const tramos = [[]];
  valores.forEach(function (v, i) {
    if (v === null) { if (tramos[tramos.length - 1].length) tramos.push([]); return; }
    tramos[tramos.length - 1].push(i);
  });
  const conPuntos = tramos.filter(function (t) { return t.length; });
  const pts = [];
  let area = '';
  let lineas = '';
  conPuntos.forEach(function (t) {
    const p = t.map(function (i) { return x(i) + ',' + y(valores[i]); });
    pts.push.apply(pts, p);
    area += 'M' + x(t[0]) + ',' + (H - padB) + ' L' + p.join(' L') + ' L' + x(t[t.length - 1]) + ',' + (H - padB) + ' Z ';
    lineas += '<polyline points="' + p.join(' ') + '" fill="none" stroke="' + PALETA.verde + '" stroke-width="2" stroke-linejoin="round"/>';
  });

  const marcas = anios.map(function (a, i) {
    return '<text x="' + (padL + i * paso) + '" y="' + (H - padB + 15) + '" text-anchor="middle" font-size="9" fill="' + PALETA.gris + '" font-family="Roboto Mono, monospace">' + a + '</text>';
  }).join('');

  const puntos = valores.map(function (v, i) {
    if (v === null) {
      return '<circle cx="' + x(i) + '" cy="' + (H - padB) + '" r="3" fill="none" stroke="' + PALETA.gris + '" stroke-dasharray="1.5 1.5">' +
             '<title>' + anios[i] + ': reservado (menos de 3 planes)</title></circle>';
    }
    return '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="3" fill="' + PALETA.verde + '">' +
           '<title>' + anios[i] + ': ' + numeroLegible(v) + '</title></circle>';
  }).join('');

  const relleno = degradeVertical(PALETA.verde, 0.22);
  contenedor.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">' +
    relleno.def +
    '<path d="' + area + '" fill="url(#' + relleno.id + ')"/>' +
    lineas +
    puntos + marcas +
    '<text x="' + padL + '" y="' + (padT + 2) + '" font-size="10" fill="' + PALETA.gris + '">' + etiqueta + '</text>' +
    '</svg>';
};
