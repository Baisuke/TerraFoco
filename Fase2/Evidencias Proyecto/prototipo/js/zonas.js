/* ==========================================================================
   TerraFoco — Zonas descargables (Google Earth y QGIS)

   En terreno se usa Google Earth y en la oficina QGIS: lo que el visor
   marca en una comuna —las celdas sobre el umbral de inundación, la erosión
   severa, la pendiente fuerte— tiene que poder llevarse a esas
   herramientas. Aquí la grilla de 30 m de la comuna abierta se convierte en
   polígonos por clase y se descarga como KML o GeoJSON.

   Las celdas se juntan en rectángulos: primero las corridas de cada fila,
   después las corridas iguales de filas seguidas. Sin eso, una comuna con
   la mitad de su superficie marcada eran cientos de miles de cuadrados; así
   son unos miles, y el archivo se abre sin esperar.
   ========================================================================== */

const GTZonas = (function () {
  'use strict';

  const SIN = 255;

  function mercY(lat) {
    const r = lat * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + r / 2));
  }
  function latDeMerc(m) { return (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180 / Math.PI; }

  /* Rectángulos [x0, y0, x1, y1) de las celdas de cada clase. `clases` es la
     grilla (255 = nada); solo se devuelven las clases de `quiero`. */
  function rectangulos(clases, W, H, quiero) {
    const porClase = {};
    quiero.forEach(function (k) { porClase[k] = []; });
    // abiertos: "x0,x1,k" -> rectángulo que sigue creciendo hacia abajo
    let abiertos = new Map();
    for (let y = 0; y <= H; y++) {
      const fila = new Map();
      if (y < H) {
        let x = 0;
        while (x < W) {
          const k = clases[y * W + x];
          if (k === SIN || !(k in porClase)) { x++; continue; }
          let x1 = x + 1;
          while (x1 < W && clases[y * W + x1] === k) x1++;
          fila.set(x + ',' + x1 + ',' + k, { x0: x, x1: x1, k: k });
          x = x1;
        }
      }
      const siguientes = new Map();
      fila.forEach(function (c, clave) {
        const r = abiertos.get(clave);
        if (r) { r.y1 = y + 1; siguientes.set(clave, r); abiertos.delete(clave); }
        else siguientes.set(clave, { x0: c.x0, x1: c.x1, y0: y, y1: y + 1, k: c.k });
      });
      abiertos.forEach(function (r) { porClase[r.k].push(r); });
      abiertos = siguientes;
    }
    return porClase;
  }

  /* Bloques de k x k celdas: el bloque toma la clase más frecuente entre sus
     celdas marcadas, si las marcadas son al menos la mitad. Es la mayoría,
     no "cualquiera": no agranda lo marcado. */
  function agrupar(clases, W, H, k) {
    const W2 = Math.ceil(W / k), H2 = Math.ceil(H / k);
    const salida = new Uint8Array(W2 * H2).fill(SIN);
    const cuenta = new Uint16Array(256);
    for (let by = 0; by < H2; by++) {
      for (let bx = 0; bx < W2; bx++) {
        let marcadas = 0, total = 0, mejor = SIN, maxima = 0;
        const tocadas = [];
        for (let y = by * k; y < Math.min(H, by * k + k); y++) {
          for (let x = bx * k; x < Math.min(W, bx * k + k); x++) {
            total++;
            const c = clases[y * W + x];
            if (c === SIN) continue;
            marcadas++;
            if (!cuenta[c]) tocadas.push(c);
            cuenta[c]++;
          }
        }
        tocadas.forEach(function (c) {
          if (cuenta[c] > maxima || (cuenta[c] === maxima && c > mejor)) { maxima = cuenta[c]; mejor = c; }
          cuenta[c] = 0;
        });
        if (marcadas * 2 >= total) salida[by * W2 + bx] = mejor;
      }
    }
    return { clases: salida, W: W2, H: H2 };
  }

  const MAX_RECTANGULOS = 20000;   // ~3 MB de KML: se abre sin esperar en Google Earth

  /* GeoJSON: una Feature MultiPolygon por clase. `base` es la grilla de la
     comuna (esquinas en lng/lat, filas en Mercator). Si a 30 m salen más de
     MAX_RECTANGULOS, se agrupa en bloques de 60, 90… m y se declara. */
  function geojson(base, clases, opciones) {
    const e = base.esquinas;
    const quiero = opciones.clases.map(function (c, k) { return k; })
      .filter(function (k) { return k >= (opciones.desde || 0); });
    let k = 1, g = { clases: clases, W: base.ancho, H: base.alto }, rect;
    for (;;) {
      rect = rectangulos(g.clases, g.W, g.H, quiero);
      const n = quiero.reduce(function (s, q) { return s + rect[q].length; }, 0);
      if (n <= MAX_RECTANGULOS || k >= 6) break;
      k++;
      g = agrupar(clases, base.ancho, base.alto, k);
    }
    const W = g.W * k > base.ancho ? base.ancho / k : g.W, H = g.H * k > base.alto ? base.alto / k : g.H;
    const yN = mercY(e[0][1]), yS = mercY(e[2][1]);
    const lng = function (x) { return +(e[0][0] + Math.min(x, W) / W * (e[1][0] - e[0][0])).toFixed(5); };
    const lat = function (y) { return +latDeMerc(yN - Math.min(y, H) / H * (yN - yS)).toFixed(5); };
    const features = [];
    quiero.forEach(function (q) {
      if (!rect[q].length) return;
      features.push({
        type: 'Feature',
        properties: Object.assign({ clase: opciones.clases[q], orden: q, color: opciones.colores[q], celda_m: 30 * k,
                                    celdas: rect[q].reduce(function (s, r) { return s + (r.x1 - r.x0) * (r.y1 - r.y0); }, 0) * k * k },
                                  opciones.propiedades || {}),
        geometry: { type: 'MultiPolygon', coordinates: rect[q].map(function (r) {
          return [[[lng(r.x0), lat(r.y0)], [lng(r.x1), lat(r.y0)], [lng(r.x1), lat(r.y1)],
                   [lng(r.x0), lat(r.y1)], [lng(r.x0), lat(r.y0)]]];
        }) },
      });
    });
    return { type: 'FeatureCollection', name: opciones.nombre + (k > 1 ? ' · bloques de ' + 30 * k + ' m' : ''),
             atribucion: opciones.atribucion || 'TerraFoco', features: features };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* KML: el color va como aabbggrr (al revés que en la web). */
  function colorKml(hex, alfa) {
    const h = hex.replace('#', '');
    const a = Math.round((alfa === undefined ? 0.6 : alfa) * 255).toString(16).padStart(2, '0');
    return a + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
  }

  function kml(gj, puntos) {
    const estilos = gj.features.map(function (f, i) {
      return '<Style id="c' + i + '"><LineStyle><color>' + colorKml(f.properties.color, 0.9) +
             '</color><width>0.6</width></LineStyle><PolyStyle><color>' + colorKml(f.properties.color, 0.55) +
             '</color></PolyStyle></Style>';
    }).join('');
    const lugares = gj.features.map(function (f, i) {
      const ha = f.properties.celdas * (f.properties.haPorCelda || 0.09);
      return '<Placemark><name>' + esc(f.properties.clase) + '</name>' +
        '<description>' + esc(gj.name) + ' · ≈ ' + Math.round(ha).toLocaleString('es-CL') + ' ha</description>' +
        '<styleUrl>#c' + i + '</styleUrl><MultiGeometry>' +
        f.geometry.coordinates.map(function (pg) {
          return '<Polygon><outerBoundaryIs><LinearRing><coordinates>' +
                 pg[0].map(function (p) { return p[0] + ',' + p[1]; }).join(' ') +
                 '</coordinates></LinearRing></outerBoundaryIs></Polygon>';
        }).join('') + '</MultiGeometry></Placemark>';
    }).join('');
    const pts = (puntos || []).map(function (p) {
      return '<Placemark><name>' + esc(p.nombre) + '</name><description>' + esc(p.descripcion || '') +
             '</description><Point><coordinates>' + p.lng + ',' + p.lat + '</coordinates></Point></Placemark>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + esc(gj.name) + '</name>' +
      '<description>' + esc(gj.atribucion) + '</description>' + estilos +
      '<Folder><name>Zonas</name>' + lugares + '</Folder>' +
      (pts ? '<Folder><name>Puntos</name>' + pts + '</Folder>' : '') +
      '</Document></kml>';
  }

  function descargar(nombre, texto, tipo) {
    const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function archivo(texto) {
    return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  return { rectangulos: rectangulos, geojson: geojson, kml: kml, descargar: descargar, archivo: archivo };
})();

if (typeof module !== 'undefined') module.exports = GTZonas;
