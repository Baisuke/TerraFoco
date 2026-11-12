/* ==========================================================================
   TerraFoco — Mis predios

   Para bajar el análisis al usuario de INDAP: el ejecutivo de área carga un
   CSV con sus predios (nombre y coordenadas) y ve, para cada uno, la
   susceptibilidad a inundación, la pendiente, la erosión y la cobertura
   agrícola de la celda de 30 m donde cae, más el índice de pertinencia de
   su comuna.

   TODO OCURRE EN ESTE NAVEGADOR. El archivo no se sube a ningún servidor ni
   se guarda: se lee aquí, se cruza con las teselas que el visor ya usa y se
   olvida al cerrar la pestaña. Así se puede usar con la planilla interna de
   la agencia sin sacar datos personales (Ley 19.628).

   Coordenadas: grados decimales (lat, lon) o UTM WGS84 (este, norte; huso
   19 sur por omisión, 18 sur para el borde costero si se indica).
   ========================================================================== */

const GTPredios = (function () {
  'use strict';

  const T = 512, Z = 11;
  const CLASES_INU = ['Baja', 'Media', 'Alta', 'Muy alta'];
  const CLASES_PEND = ['Plana', 'Suave', 'Moderada', 'Fuerte', 'Muy fuerte'];
  const CORTES_PEND = [5, 15, 30, 50];
  const CLASES_ERO = ['Ligera', 'Moderada', 'Severa', 'Muy severa', 'Extrema'];
  const MAXIMO = 5000;

  const S = { predios: [], resultados: [], archivos: {}, cortesInu: null, mapa: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  /* ---------------------------------------------------------------------
     Lectura del CSV
     --------------------------------------------------------------------- */

  function separadorDe(linea) {
    const n = { ';': 0, ',': 0, '\t': 0 };
    let entre = false;
    for (const ch of linea) {
      if (ch === '"') entre = !entre;
      else if (!entre && ch in n) n[ch]++;
    }
    return Object.keys(n).sort(function (a, b) { return n[b] - n[a]; })[0];
  }

  function partirLinea(linea, sep) {
    const salida = [];
    let actual = '', entre = false;
    for (let i = 0; i < linea.length; i++) {
      const ch = linea[i];
      if (ch === '"') {
        if (entre && linea[i + 1] === '"') { actual += '"'; i++; } else entre = !entre;
      } else if (ch === sep && !entre) { salida.push(actual); actual = ''; }
      else actual += ch;
    }
    salida.push(actual);
    return salida.map(function (x) { return x.trim(); });
  }

  function numero(v) {
    if (v === undefined || v === null) return NaN;
    let s = String(v).trim().replace(/\s/g, '');
    // 6.234.567,8 o 6234567,8 o -34,123 → punto decimal
    if (/,\d+$/.test(s) && (s.match(/,/g) || []).length === 1) s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s);
  }

  const COLUMNAS = {
    nombre: ['nombre', 'predio', 'nombre predio', 'id', 'codigo', 'rol', 'usuario', 'agricultor'],
    lat: ['lat', 'latitud', 'latitude', 'y wgs84'],
    lon: ['lon', 'lng', 'long', 'longitud', 'longitude', 'x wgs84'],
    este: ['este', 'x', 'utm este', 'easting', 'coord x'],
    norte: ['norte', 'y', 'utm norte', 'northing', 'coord y'],
    huso: ['huso', 'zona', 'zona utm'],
  };

  function leerCsv(texto) {
    const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(function (l) {
      return l.trim() && !/^\s*#/.test(l);
    });
    if (lineas.length < 2) throw new Error('El archivo necesita una fila de encabezado y al menos un predio.');
    const sep = separadorDe(lineas[0]);
    const cab = partirLinea(lineas[0], sep).map(function (c) { return norm(c).replace(/[_-]+/g, ' '); });
    const col = {};
    Object.keys(COLUMNAS).forEach(function (k) {
      const i = cab.findIndex(function (c) { return COLUMNAS[k].indexOf(c) >= 0; });
      if (i >= 0) col[k] = i;
    });
    const conGrados = col.lat !== undefined && col.lon !== undefined;
    const conUtm = col.este !== undefined && col.norte !== undefined;
    if (!conGrados && !conUtm) {
      throw new Error('No encontré las coordenadas. Use columnas "lat" y "lon" (grados) o "este" y "norte" (UTM).');
    }
    const predios = [], errores = [];
    lineas.slice(1, MAXIMO + 1).forEach(function (l, k) {
      const c = partirLinea(l, sep);
      const nombre = col.nombre !== undefined ? c[col.nombre] : 'Predio ' + (k + 1);
      let lat, lon;
      if (conGrados) { lat = numero(c[col.lat]); lon = numero(c[col.lon]); }
      if ((!isFinite(lat) || !isFinite(lon)) && conUtm) {
        const huso = col.huso !== undefined ? parseInt(c[col.huso], 10) || 19 : 19;
        const ll = utmAGrados(numero(c[col.este]), numero(c[col.norte]), huso);
        lat = ll[0]; lon = ll[1];
      }
      if (!isFinite(lat) || !isFinite(lon) || lat > -17 || lat < -56 || lon > -66 || lon < -76) {
        errores.push('fila ' + (k + 2) + ' (' + nombre + '): coordenadas fuera de Chile o vacías');
        return;
      }
      predios.push({ fila: k + 2, nombre: nombre || 'Predio ' + (k + 1), lat: lat, lon: lon });
    });
    return { predios: predios, errores: errores, recortado: lineas.length - 1 > MAXIMO };
  }

  /* UTM WGS84, hemisferio sur, a grados (fórmulas de Snyder). */
  function utmAGrados(este, norte, huso) {
    const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const x = este - 500000, y = norte - 10000000;
    const M = y / k0;
    const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const phi1 = mu + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu)
      + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
      + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu);
    const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) * Math.sin(phi1));
    const T1 = Math.tan(phi1) * Math.tan(phi1);
    const C1 = ep2 * Math.cos(phi1) * Math.cos(phi1);
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi1) * Math.sin(phi1), 1.5);
    const D = x / (N1 * k0);
    const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (D * D / 2
      - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4) / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6) / 720);
    const lon0 = (huso * 6 - 183) * Math.PI / 180;
    const lon = lon0 + (D - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5) / 120) / Math.cos(phi1);
    return [lat * 180 / Math.PI, lon * 180 / Math.PI];
  }

  /* ---------------------------------------------------------------------
     Valores en un punto
     --------------------------------------------------------------------- */

  function mercY(lat) { const r = lat * Math.PI / 180; return Math.log(Math.tan(Math.PI / 4 + r / 2)); }

  function pixel(lat, lon, z) {
    const lado = Math.pow(2, z) * T;
    const px = (lon + 180) / 360 * lado, py = (1 - mercY(lat) / Math.PI) / 2 * lado;
    return { tx: Math.floor(px / T), ty: Math.floor(py / T), x: Math.floor(px) % T, y: Math.floor(py) % T };
  }

  const cacheTeselas = new Map();
  function tesela(archivo, ruta, z, tx, ty) {
    const clave = ruta + '/' + z + '/' + tx + '/' + ty;
    if (!cacheTeselas.has(clave)) {
      cacheTeselas.set(clave, archivo.getZxy(z, tx, ty).then(function (r) {
        if (!r || !r.data) return null;
        return createImageBitmap(new Blob([r.data]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      }).then(function (bmp) {
        if (!bmp) return null;
        const c = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        return { ancho: bmp.width, datos: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
      }).catch(function () { return null; }));
    }
    return cacheTeselas.get(clave);
  }

  function rgbEn(ruta, lat, lon) {
    const archivo = S.archivos[ruta];
    if (!archivo) return Promise.resolve(null);
    const p = pixel(lat, lon, Z);
    return tesela(archivo, ruta, Z, p.tx, p.ty).then(function (t) {
      if (!t) return null;
      const i = (p.y * t.ancho + p.x) * 4;
      return [t.datos[i], t.datos[i + 1], t.datos[i + 2]];
    });
  }

  function valorEn(ruta, lat, lon, escala) {
    return rgbEn(ruta, lat, lon).then(function (c) {
      if (!c) return null;
      const n = c[0] * 65536 + c[1] * 256 + c[2];
      return n ? (-10000 + n * 0.1) / escala : null;
    });
  }

  /* Erosión a 30 m: de las teselas si existen; si no, del PNG por comuna. */
  const pngs = {};
  function erosionEn(lat, lon, comuna) {
    if (S.archivos['datos/teselas/erosion.pmtiles']) {
      return valorEn('datos/teselas/erosion.pmtiles', lat, lon, 1).then(function (v) {
        return v === null ? null : { clase: claseErosion(v), valor: v };
      });
    }
    const idx = window.TERRAFOCO_EROSION;
    const f = idx && comuna && (idx.comunas || []).filter(function (c) { return norm(c.nombre) === norm(comuna); })[0];
    if (!f || !f.png || !f.esquinas) return Promise.resolve(null);
    if (!pngs[f.png]) {
      pngs[f.png] = new Promise(function (ok) {
        const img = new Image();
        img.onload = function () {
          const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          ok({ ancho: img.width, alto: img.height, datos: ctx.getImageData(0, 0, img.width, img.height).data });
        };
        img.onerror = function () { ok(null); };
        img.src = 'datos/erosion/' + f.png;
      });
    }
    return pngs[f.png].then(function (im) {
      if (!im) return null;
      const e = f.esquinas, oeste = e[0][0], este = e[1][0], norte = e[0][1], sur = e[2][1];
      const x = Math.floor((lon - oeste) / (este - oeste) * im.ancho);
      const y = Math.floor((norte - lat) / (norte - sur) * im.alto);
      if (x < 0 || y < 0 || x >= im.ancho || y >= im.alto) return null;
      const i = (y * im.ancho + x) * 4;
      if (im.datos[i + 3] < 128) return null;
      const colores = PALETA.codificacion.erosion.map(function (h) {
        return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
      });
      let mejor = 0, dist = Infinity;
      colores.forEach(function (c, k) {
        const d = Math.pow(c[0] - im.datos[i], 2) + Math.pow(c[1] - im.datos[i + 1], 2) + Math.pow(c[2] - im.datos[i + 2], 2);
        if (d < dist) { dist = d; mejor = k; }
      });
      return { clase: mejor, valor: null };
    });
  }

  function claseErosion(v) {
    const cortes = [10, 18, 26, 34];
    for (let k = 0; k < cortes.length; k++) if (v <= cortes[k]) return k;
    return 4;
  }
  function clasePorCortes(v, cortes) {
    for (let k = 0; k < cortes.length; k++) if (v < cortes[k]) return k;
    return cortes.length;
  }

  function comunaDe(lat, lon) {
    const geo = window.TERRAFOCO_COMUNAS;
    if (!geo) return null;
    for (const f of geo.features) {
      const poligonos = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
      for (const pg of poligonos) {
        if (GTCalculo.dentroDe(pg, lon, lat)) return f.properties.nombre;
      }
    }
    return null;
  }

  function evaluar(p) {
    const comuna = comunaDe(p.lat, p.lon);
    return Promise.all([
      valorEn('datos/teselas/inundacion.pmtiles', p.lat, p.lon, 1000),
      valorEn('datos/teselas/pendiente.pmtiles', p.lat, p.lon, 1),
      rgbEn('datos/teselas/agricola.pmtiles', p.lat, p.lon),
      erosionEn(p.lat, p.lon, comuna),
    ]).then(function (r) {
      const c = comuna && GT.comunas.filter(function (x) { return norm(x.nombre) === norm(comuna); })[0];
      const inu = r[0], pend = r[1], agr = r[2], ero = r[3];
      return Object.assign({}, p, {
        comuna: comuna, idComuna: c ? c.id : null,
        inundacion: inu, claseInu: inu !== null && S.cortesInu ? clasePorCortes(inu, S.cortesInu) : null,
        pendiente: pend, clasePend: pend !== null ? clasePorCortes(pend, CORTES_PEND) : null,
        cultivo: agr && agr[0] ? agr[0] - 1 : null, pradera: agr && agr[1] ? agr[1] - 1 : null,
        erosion30: ero ? ero.clase : null,
        erosionComuna: c && typeof c.erosion === 'number' ? c.erosion : null,
        categoria: c && GT.enIndice(c) ? GT.categoriaPertinencia(c.indice).nombre : (c ? GT.motivoSinIndice(c) : null),
      });
    });
  }

  function observacion(r) {
    const notas = [];
    if (!r.comuna) return 'Fuera de las comunas de la región';
    if (r.claseInu !== null && r.claseInu >= 2) notas.push('terreno susceptible a inundación');
    if (r.erosion30 !== null && r.erosion30 >= 2) notas.push('erosión severa o mayor en su celda');
    if (r.clasePend !== null && r.clasePend >= 3) notas.push('pendiente fuerte');
    return notas.length ? 'Revisar: ' + notas.join(', ') : '';
  }

  /* ---------------------------------------------------------------------
     Interfaz
     --------------------------------------------------------------------- */

  function procesar(texto, origen) {
    let leido;
    try { leido = leerCsv(texto); } catch (e) { mostrarError(e.message); return; }
    $('prEstado').textContent = 'Evaluando ' + leido.predios.length + ' predios…';
    const avisos = leido.errores.slice(0, 8).map(esc);
    if (leido.errores.length > 8) avisos.push('y ' + (leido.errores.length - 8) + ' filas más');
    if (leido.recortado) avisos.unshift('Se leyeron los primeros ' + MAXIMO + ' predios.');
    $('prAvisos').innerHTML = avisos.length ? '<div class="small muted">' + avisos.join('<br>') + '</div>' : '';
    Promise.all(leido.predios.map(evaluar)).then(function (rs) {
      S.resultados = rs;
      $('prEstado').textContent = rs.length + ' predios evaluados desde ' + origen + ' · nada salió de este computador';
      pintarResumen();
      pintarTabla();
      pintarMapa();
      $('prResultados').hidden = false;
    });
  }

  function mostrarError(t) {
    $('prEstado').textContent = '';
    $('prAvisos').innerHTML = '<div class="notice notice--alerta">' + esc(t) + '</div>';
  }

  function colorInu(k) { return k === null ? PALETA.sinDato : PALETA.rampas.agua[k + 1]; }

  function pintarResumen() {
    const rs = S.resultados;
    const n = function (f) { return rs.filter(f).length; };
    $('prResumen').innerHTML = '<div class="cifras cifras--4">' +
      cifra(rs.length, 'predios', n(function (r) { return !r.comuna; }) + ' fuera de la región') +
      cifra(n(function (r) { return r.claseInu !== null && r.claseInu >= 2; }), 'en terreno susceptible a inundación', 'clase Alta o Muy alta') +
      cifra(n(function (r) { return r.erosion30 !== null && r.erosion30 >= 2; }), 'con erosión severa o mayor', 'en la celda de 30 m del predio') +
      cifra(n(function (r) { return r.clasePend !== null && r.clasePend >= 3; }), 'en pendiente fuerte', 'sobre 30 %') +
      '</div>';
  }

  function cifra(v, rotulo, sub) {
    return '<div class="cifra"><span class="cifra__valor">' + GT.fmt(v) + '</span><span class="cifra__rotulo">' +
           rotulo + '</span><span class="tiny muted">' + sub + '</span></div>';
  }

  function pintarTabla() {
    const filas = S.resultados.slice().sort(function (a, b) {
      return (b.claseInu || 0) - (a.claseInu || 0) || (b.erosion30 || 0) - (a.erosion30 || 0);
    });
    $('prTabla').innerHTML = filas.map(function (r) {
      return '<tr>' +
        '<td><strong>' + esc(r.nombre) + '</strong></td>' +
        '<td>' + (r.comuna ? '<a href="inundaciones.html?comuna=' + encodeURIComponent(r.comuna) + '">' + esc(r.comuna) + '</a>' : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (r.claseInu !== null ? '<i class="punto" style="background:' + colorInu(r.claseInu) + '"></i>' + CLASES_INU[r.claseInu] +
                  ' <span class="muted mono">' + GT.fmt(r.inundacion, 2) + '</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (r.erosion30 !== null ? CLASES_ERO[r.erosion30] : '<span class="muted">—</span>') +
                 (r.erosionComuna !== null ? ' <span class="tiny muted">· comuna ' + GT.fmt(r.erosionComuna, 1) + ' t/ha</span>' : '') + '</td>' +
        '<td>' + (r.pendiente !== null ? GT.fmt(r.pendiente, 0) + ' % <span class="tiny muted">' + CLASES_PEND[r.clasePend] + '</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td class="mono small">' + (r.cultivo !== null ? r.cultivo + ' % / ' + r.pradera + ' %' : '—') + '</td>' +
        '<td class="small">' + (r.categoria ? esc(r.categoria) : '—') + '</td>' +
        '<td class="small">' + esc(observacion(r)) + '</td>' +
      '</tr>';
    }).join('');
  }

  function pintarMapa() {
    const m = S.mapa && S.mapa.instancia;
    if (!m) return;
    const datos = { type: 'FeatureCollection', features: S.resultados.map(function (r, k) {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
               properties: { k: k, color: colorInu(r.claseInu) } };
    }) };
    if (m.getSource('predios')) m.getSource('predios').setData(datos);
    else {
      m.addSource('predios', { type: 'geojson', data: datos });
      m.addLayer({ id: 'predios', type: 'circle', source: 'predios', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 8],
        'circle-color': ['get', 'color'], 'circle-stroke-color': PALETA.tinta, 'circle-stroke-width': 1.5 } });
      const popup = new maplibregl.Popup({ closeButton: true, offset: 8 });
      m.on('click', 'predios', function (e) {
        const r = S.resultados[e.features[0].properties.k];
        popup.setLngLat([r.lon, r.lat]).setHTML('<strong>' + esc(r.nombre) + '</strong><br>' +
          '<span class="muted">' + esc(r.comuna || 'fuera de la región') + '</span>' +
          '<div class="emergente__celda"><span>Inundación: ' + (r.claseInu !== null ? CLASES_INU[r.claseInu] : '—') +
          ' · erosión: ' + (r.erosion30 !== null ? CLASES_ERO[r.erosion30] : '—') +
          ' · pendiente: ' + (r.pendiente !== null ? GT.fmt(r.pendiente, 0) + ' %' : '—') + '</span></div>').addTo(m);
      });
      m.on('mouseenter', 'predios', function () { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'predios', function () { m.getCanvas().style.cursor = ''; });
    }
    const b = new maplibregl.LngLatBounds();
    S.resultados.forEach(function (r) { b.extend([r.lon, r.lat]); });
    if (!b.isEmpty()) m.fitBounds(b, { padding: 60, maxZoom: 13, duration: 600 });
  }

  /* ---------------------------------------------------------------------
     Descargas
     --------------------------------------------------------------------- */

  function num(v, d) { return v === null || v === undefined ? '' : Number(v).toFixed(d).replace('.', ','); }

  function csvResultados() {
    const cab = ['nombre', 'lat', 'lon', 'comuna', 'indice_inundacion', 'clase_inundacion', 'erosion_celda_30m',
                 'erosion_comuna_t_ha', 'pendiente_pct', 'clase_pendiente', 'cultivo_pct', 'pradera_pct',
                 'pertinencia_comuna', 'observacion'];
    const celda = function (v) { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const filas = S.resultados.map(function (r) {
      return [r.nombre, num(r.lat, 6), num(r.lon, 6), r.comuna || '', num(r.inundacion, 3),
              r.claseInu !== null ? CLASES_INU[r.claseInu] : '', r.erosion30 !== null ? CLASES_ERO[r.erosion30] : '',
              num(r.erosionComuna, 1), num(r.pendiente, 0), r.clasePend !== null ? CLASES_PEND[r.clasePend] : '',
              r.cultivo !== null ? r.cultivo : '', r.pradera !== null ? r.pradera : '', r.categoria || '', observacion(r)];
    });
    const texto = '﻿# TerraFoco — evaluación de predios · ' + GT_hoy() + '\n' +
      '# Inundación: índice de susceptibilidad a 30 m (clases por cuartiles regionales). Erosión: clase de la celda de 30 m ' +
      '(cálculo propio) y media comunal de CIREN. Cobertura: ESA WorldCover 2021.\n' +
      [cab].concat(filas).map(function (f) { return f.map(celda).join(';'); }).join('\n') + '\n';
    GTZonas.descargar('terrafoco_predios_' + GT_hoy() + '.csv', texto, 'text/csv');
  }

  function kmlResultados() {
    const gj = { type: 'FeatureCollection', name: 'Predios evaluados · TerraFoco', atribucion: 'TerraFoco', features: [] };
    const puntos = S.resultados.map(function (r) {
      return { nombre: r.nombre, lat: r.lat, lng: r.lon,
               descripcion: (r.comuna || 'fuera de la región') + ' · inundación ' +
                 (r.claseInu !== null ? CLASES_INU[r.claseInu] : '—') + ' · erosión ' +
                 (r.erosion30 !== null ? CLASES_ERO[r.erosion30] : '—') + ' · pendiente ' +
                 (r.pendiente !== null ? GT.fmt(r.pendiente, 0) + ' %' : '—') };
    });
    GTZonas.descargar('terrafoco_predios_' + GT_hoy() + '.kml', GTZonas.kml(gj, puntos),
                      'application/vnd.google-earth.kml+xml');
  }

  function plantilla() {
    GTZonas.descargar('plantilla_predios.csv',
      '﻿nombre;lat;lon\nPredio ejemplo 1;-34,3612;-71,2950\nPredio ejemplo 2;-34,4120;-71,0605\n', 'text/csv');
  }

  /* ---------------------------------------------------------------------
     Arranque
     --------------------------------------------------------------------- */

  function iniciar() {
    const rutas = ['datos/teselas/inundacion.pmtiles', 'datos/teselas/pendiente.pmtiles',
                   'datos/teselas/agricola.pmtiles', 'datos/teselas/erosion.pmtiles'];
    const listas = GTMapaReal.cargar ? GTMapaReal.cargar() : Promise.resolve();
    return Promise.resolve(listas).then(function () {
      if (!GTMapaReal.teselas) {
        mostrarError('Para evaluar predios, abra TerraFoco desde su servidor (no desde el disco): ' +
                     'las capas a 30 m se leen por partes y el navegador no lo permite desde un archivo.');
        return;
      }
      return Promise.all(rutas.map(function (r) {
        return GTMapaReal.teselas.disponible(r).then(function (info) {
          if (!info) return;
          S.archivos[r] = GTMapaReal.teselas.archivo(r);
          if (r.indexOf('inundacion') >= 0 && info.meta && info.meta.cortes) S.cortesInu = info.meta.cortes;
        });
      }));
    });
  }

  function montar(api) {
    S.mapa = api;
    const entrada = $('prArchivo'), zona = $('prZona');
    const leerArchivo = function (f) {
      if (!f) return;
      const lector = new FileReader();
      lector.onload = function () { procesar(lector.result, f.name); };
      lector.readAsText(f, 'utf-8');
    };
    entrada.addEventListener('change', function () { leerArchivo(entrada.files[0]); entrada.value = ''; });
    zona.addEventListener('dragover', function (e) { e.preventDefault(); zona.classList.add('es-encima'); });
    zona.addEventListener('dragleave', function () { zona.classList.remove('es-encima'); });
    zona.addEventListener('drop', function (e) {
      e.preventDefault(); zona.classList.remove('es-encima');
      leerArchivo(e.dataTransfer.files[0]);
    });
    $('prPegar').addEventListener('click', function () {
      const t = $('prTexto').value;
      if (t.trim()) procesar(t, 'el texto pegado');
    });
    $('prPlantilla').addEventListener('click', plantilla);
    // Doce predios ficticios en situaciones distintas (datos/predios_ejemplo.csv),
    // para ver la pantalla funcionando sin tener una planilla a mano.
    $('prEjemplo').addEventListener('click', function () {
      fetch('datos/predios_ejemplo.csv', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (t) { procesar(t, 'los predios de ejemplo'); })
        .catch(function () { mostrarError('No se pudo leer datos/predios_ejemplo.csv.'); });
    });
    $('prCsv').addEventListener('click', csvResultados);
    $('prKml').addEventListener('click', kmlResultados);
    $('prLimpiar').addEventListener('click', function () {
      S.resultados = [];
      $('prResultados').hidden = true; $('prEstado').textContent = ''; $('prAvisos').innerHTML = '';
      const m = S.mapa && S.mapa.instancia;
      if (m && m.getSource('predios')) m.getSource('predios').setData({ type: 'FeatureCollection', features: [] });
    });
  }

  return { iniciar: iniciar, montar: montar, leerCsv: leerCsv, utmAGrados: utmAGrados };
})();

if (typeof module !== 'undefined') module.exports = GTPredios;
