/* ==========================================================================
   TerraFoco — Viajes a terreno: buscar lugares, llevarse el viaje y
   "Mis viajes"

   Lo que rodea al cálculo de viajes.js:
     · Buscador de lugares (Photon, de Komoot, sobre OpenStreetMap):
       autocompleta mientras se escribe, solo dentro de la región, y avisa
       cuando un resultado cae fuera de las 33 comunas. "Mi ubicación" usa
       el GPS del navegador para la salida.
     · El nombre de un punto marcado en el mapa: la calle o localidad más
       cercana (geocodificación inversa de Photon).
     · Llevarse el viaje: informe imprimible (o PDF), GPX para el GPS o el
       celular, KML para Google Earth, CSV del perfil, abrir en Google Maps
       o Waze y copiar el enlace.
     · Mis viajes: los viajes guardados en este navegador y la planilla de
       rendición de gastos en CSV, con el formato de Excel en español.
   Nada de esto sale del navegador salvo las coordenadas que se buscan.
   ========================================================================== */

const GTViajesExtras = (function () {
  'use strict';

  const PHOTON = 'https://photon.komoot.io';
  const CLAVE_VIAJES = 'terrafoco_mis_viajes';
  const MAX_GUARDADOS = 100;

  const $ = function (id) { return document.getElementById(id); };
  const esc = function (t) {
    return String(t === undefined || t === null ? '' : t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  /* ------------------------------------------------------------------------
     Buscador
     ------------------------------------------------------------------------ */

  let caja = null;
  function cajaRegion() {
    if (caja) return caja;
    const c = [180, 90, -180, -90];
    const recorrer = function (x) {
      if (typeof x[0] === 'number') {
        c[0] = Math.min(c[0], x[0]); c[1] = Math.min(c[1], x[1]);
        c[2] = Math.max(c[2], x[0]); c[3] = Math.max(c[3], x[1]);
      } else x.forEach(recorrer);
    };
    (window.TERRAFOCO_COMUNAS ? window.TERRAFOCO_COMUNAS.features : []).forEach(function (f) {
      recorrer(f.geometry.coordinates);
    });
    caja = c[0] < c[2] ? c.map(function (v) { return +v.toFixed(3); }) : [-72.1, -35.05, -70.0, -33.8];
    return caja;
  }

  const CLASES = {
    city: 'ciudad', town: 'pueblo', village: 'pueblo', hamlet: 'caserío', locality: 'localidad',
    suburb: 'sector', neighbourhood: 'barrio', residential: 'calle', living_street: 'calle',
    primary: 'ruta', secondary: 'camino', tertiary: 'camino', unclassified: 'camino', track: 'camino rural',
    farm: 'predio', farmyard: 'predio', school: 'escuela', hospital: 'hospital', clinic: 'consultorio',
    fuel: 'bencinera', townhall: 'municipalidad', station: 'estación', house: 'dirección',
  };

  function montarBuscador() {
    const entrada = $('vjBuscar'), lista = $('vjSugerencias');
    let espera = null, resultados = [], activo = -1, pedido = 0;

    function cerrar() { lista.hidden = true; activo = -1; entrada.setAttribute('aria-expanded', 'false'); }

    function pintar(error) {
      if (error) {
        lista.innerHTML = '<div class="viaje__sugerencia viaje__sugerencia--nada">' + error + '</div>';
      } else if (!resultados.length) {
        lista.innerHTML = '<div class="viaje__sugerencia viaje__sugerencia--nada">Sin resultados en la región. ' +
                          'Pruebe con el nombre de la comuna o de la calle.</div>';
      } else {
        lista.innerHTML = resultados.map(function (r, i) {
          const fuera = r.comuna === null;
          return '<button type="button" role="option" class="viaje__sugerencia' + (i === activo ? ' is-active' : '') +
                   (fuera ? ' is-fuera' : '') + '" data-i="' + i + '"' + (fuera ? ' aria-disabled="true"' : '') + '>' +
                   '<strong>' + esc(r.nombre) + '</strong>' +
                   '<span>' + esc([r.clase, r.contexto].filter(Boolean).join(' · ')) +
                     (fuera ? ' · <em>fuera de la región</em>' : '') + '</span>' +
                 '</button>';
        }).join('');
      }
      lista.hidden = false;
      entrada.setAttribute('aria-expanded', 'true');
    }

    function aResultado(f) {
      const x = f.properties, p = f.geometry.coordinates;
      const calle = x.street ? x.street + (x.housenumber ? ' ' + x.housenumber : '') : '';
      const nombre = x.name || calle || x.city || x.county || 'Lugar sin nombre';
      const contexto = [x.name && calle ? calle : '', x.city || x.district || x.county || '']
        .filter(function (t, i, a) { return t && t !== nombre && a.indexOf(t) === i; }).join(', ');
      return { p: p, nombre: nombre, contexto: contexto, clase: CLASES[x.osm_value] || '',
               comuna: GTViajes.comunaEn(p) };
    }

    function buscar(q) {
      const n = ++pedido, b = cajaRegion();
      fetch(PHOTON + '/api/?q=' + encodeURIComponent(q) + '&limit=8&lang=default&bbox=' + b.join(',') +
            '&lat=-34.4&lon=-71.0', { signal: AbortSignal.timeout(8000) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) {
          if (n !== pedido) return;
          resultados = (d.features || []).map(aResultado);
          // Primero lo que está dentro de la región.
          resultados.sort(function (a, b2) { return (a.comuna === null) - (b2.comuna === null); });
          activo = resultados.findIndex(function (r) { return r.comuna !== null; });
          pintar();
        })
        .catch(function () { if (n === pedido) { resultados = []; pintar('No se pudo buscar: revise la conexión.'); } });
    }

    function elegir(i) {
      const r = resultados[i];
      if (!r || r.comuna === null) return;
      GTViajes.agregarPunto(r.p, r.nombre, { centrar: true });
      entrada.value = '';
      cerrar();
    }

    entrada.addEventListener('input', function () {
      clearTimeout(espera);
      const q = entrada.value.trim();
      if (q.length < 3) { cerrar(); return; }
      espera = setTimeout(function () { buscar(q); }, 280);
    });
    entrada.addEventListener('keydown', function (e) {
      if (lista.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!resultados.length) return;
        activo = (activo + (e.key === 'ArrowDown' ? 1 : -1) + resultados.length) % resultados.length;
        pintar();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        elegir(activo);
      } else if (e.key === 'Escape') cerrar();
    });
    entrada.addEventListener('blur', function () { setTimeout(cerrar, 180); });
    // mousedown y no click: el blur de la entrada cerraría la lista antes.
    lista.addEventListener('mousedown', function (e) {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      e.preventDefault();
      elegir(+b.dataset.i);
    });
  }

  function miUbicacion() {
    const b = $('vjUbicacion');
    if (!navigator.geolocation) { GTViajes.avisar('Este navegador no entrega la ubicación.', 'alerta'); return; }
    b.disabled = true;
    navigator.geolocation.getCurrentPosition(function (pos) {
      b.disabled = false;
      GTViajes.agregarPunto([pos.coords.longitude, pos.coords.latitude], 'Mi ubicación',
                            { comoSalida: true, centrar: true });
    }, function (err) {
      b.disabled = false;
      GTViajes.avisar(err.code === 1 ? 'El navegador no dio permiso para usar la ubicación.'
                                     : 'No se pudo obtener la ubicación.', 'alerta');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  /* La calle o localidad más cercana a un punto, para nombrarlo. */
  function nombreDe(p) {
    return fetch(PHOTON + '/reverse?lat=' + p[1].toFixed(6) + '&lon=' + p[0].toFixed(6) + '&lang=default&limit=1',
                 { signal: AbortSignal.timeout(6000) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        const f = d && d.features && d.features[0];
        if (!f) return null;
        const x = f.properties;
        const calle = x.street ? x.street + (x.housenumber ? ' ' + x.housenumber : '') : '';
        const lugar = x.name && x.name !== x.street ? x.name : calle;
        const ciudad = x.city || x.district || x.county || '';
        if (!lugar) return ciudad || null;
        return lugar + (ciudad && ciudad !== lugar ? ', ' + ciudad : '');
      })
      .catch(function () { return null; });
  }

  /* ------------------------------------------------------------------------
     Llevarse el viaje
     ------------------------------------------------------------------------ */

  function slug(t) {
    return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'viaje';
  }

  function descargar(texto, nombre, tipo) {
    const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function base(d) { return 'viaje_' + slug(d.nombre) + '_' + GT_hoy(); }

  /* Altura de cada vértice de la forma, desde las piezas del perfil. */
  function alturas(per) {
    const piezas = per.piezas;
    const escala = per.largo / (piezas[piezas.length - 1].hasta || 1);
    let k = 0;
    return per.cum.map(function (c) {
      const d = c / escala;
      while (k < piezas.length - 1 && piezas[k].hasta < d) k++;
      return piezas[k].h;
    });
  }

  function puntosDeViaje(d) {
    const pts = d.paradas.map(function (x) { return x.p; });
    if (d.vuelta) pts.push(d.paradas[0].p);
    return pts;
  }

  function gpx() {
    const d = GTViajes.datos(); if (!d) return;
    const per = d.ruta.perfil, h = alturas(per);
    const punto = function (c, i, etiqueta) {
      return '<' + etiqueta + ' lat="' + c[1].toFixed(6) + '" lon="' + c[0].toFixed(6) + '"><ele>' + h[i].toFixed(1) + '</ele></' + etiqueta + '>';
    };
    const tramo = function (nombre, coords, idx) {
      return '<trk><name>' + esc(nombre) + '</name><trkseg>\n' +
             coords.map(function (c, i) { return punto(c, idx(i), 'trkpt'); }).join('\n') + '\n</trkseg></trk>';
    };
    const n = per.coords.length;
    const texto = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="TerraFoco" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      '<metadata><name>' + esc(d.nombre) + '</name><desc>' + esc(resumenTexto(d)) + '</desc><time>' +
        new Date().toISOString() + '</time></metadata>\n' +
      d.paradas.map(function (x) {
        return '<wpt lat="' + x.p[1].toFixed(6) + '" lon="' + x.p[0].toFixed(6) + '"><name>' + x.letra + ' · ' +
               esc(x.nombre || x.comuna) + '</name><desc>' + x.rol + ' · ' + esc(x.comuna) + '</desc></wpt>';
      }).join('\n') + '\n' +
      tramo(d.vueltaInvertida ? 'Ida' : 'Recorrido', per.coords, function (i) { return i; }) + '\n' +
      (d.vueltaInvertida ? tramo('Vuelta', per.coords.slice().reverse(), function (i) { return n - 1 - i; }) + '\n' : '') +
      '</gpx>\n';
    descargar(texto, base(d) + '.gpx', 'application/gpx+xml');
  }

  /* KML: el color va como aabbggrr (al revés que en la web). */
  function colorKml(hex, alfa) {
    const h = hex.replace('#', '');
    const a = Math.round((alfa === undefined ? 1 : alfa) * 255).toString(16).padStart(2, '0');
    return a + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
  }

  function kml() {
    const d = GTViajes.datos(); if (!d) return;
    const per = d.ruta.perfil;
    const color = colorKml(/^#[0-9a-f]{6}$/i.test(PALETA.naranja) ? PALETA.naranja : '#D75E24', 0.95);
    const texto = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n' +
      '<name>' + esc(d.nombre) + '</name><description>' + esc(resumenTexto(d)) + '</description>\n' +
      '<Style id="ruta"><LineStyle><color>' + color + '</color><width>5</width></LineStyle></Style>\n' +
      d.paradas.map(function (x) {
        return '<Placemark><name>' + x.letra + ' · ' + esc(x.nombre || x.comuna) + '</name><description>' + x.rol + ' · ' +
               esc(x.comuna) + '</description><Point><coordinates>' + x.p[0].toFixed(6) + ',' + x.p[1].toFixed(6) +
               ',0</coordinates></Point></Placemark>';
      }).join('\n') + '\n' +
      '<Placemark><name>Recorrido</name><styleUrl>#ruta</styleUrl><LineString><tessellate>1</tessellate>' +
      '<altitudeMode>clampToGround</altitudeMode><coordinates>' +
      per.coords.map(function (c) { return c[0].toFixed(6) + ',' + c[1].toFixed(6) + ',0'; }).join(' ') +
      '</coordinates></LineString></Placemark>\n</Document></kml>\n';
    descargar(texto, base(d) + '.kml', 'application/vnd.google-earth.kml+xml');
  }

  /* CSV con formato de Excel en español: BOM, punto y coma y coma decimal. */
  function csv(filas, notas) {
    const celda = function (t) {
      t = String(t === undefined || t === null ? '' : t);
      return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    return '﻿' + (notas || []).map(function (n) { return '# ' + n; }).join('\n') + (notas && notas.length ? '\n' : '') +
           filas.map(function (f) { return f.map(celda).join(';'); }).join('\n') + '\n';
  }

  function num(v, dec) {
    return v === null || v === undefined || !isFinite(v) ? '' : Number(v).toFixed(dec).replace('.', ',');
  }

  /* El perfil cada ~100 m: para revisar el cálculo o graficarlo en Excel. */
  function csvPerfil() {
    const d = GTViajes.datos(); if (!d) return;
    const r = d.ruta, piezas = r.perfil.piezas, u = d.opciones.combustible.unidad;
    const filas = [['km', 'Tramo', 'Altura (m)', 'Pendiente (%)', 'Tipo de camino', 'Vía', 'Velocidad (km/h)',
                    'Consumo (' + u + '/100 km)', 'Acumulado (' + u + ')', 'Tiempo (min)']];
    for (let i = 0; i < piezas.length; i += 3) {
      const p = piezas[i], a = r.ida.acum[Math.min(r.ida.acum.length - 1, i + 2)];
      filas.push([num(p.hasta / 1000, 2), String.fromCharCode(65 + p.tramo), num(p.h, 0), num(p.s * 100, 1),
                  GTViaje.TIPOS[p.tipo], p.nombre, num(a.v * 3.6, 0), num(a.intensidad, 1), num(a.l, 3),
                  num(a.t / 60, 1)]);
    }
    descargar(csv(filas, [d.nombre, resumenTexto(d), 'Estimación del modelo físico de TerraFoco (viajes.html).']),
              base(d) + '_perfil.csv', 'text/csv;charset=utf-8');
  }

  function googleMaps() {
    const d = GTViajes.datos(); if (!d) return;
    const pts = puntosDeViaje(d);
    const f = function (p) { return p[1].toFixed(6) + ',' + p[0].toFixed(6); };
    const url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + f(pts[0]) +
                '&destination=' + f(pts[pts.length - 1]) +
                (pts.length > 2 ? '&waypoints=' + encodeURIComponent(pts.slice(1, -1).map(f).join('|')) : '');
    window.open(url, '_blank', 'noopener');
  }

  /* Waze no recibe paradas: se navega a la primera. */
  function waze() {
    const d = GTViajes.datos(); if (!d) return;
    const p = d.paradas[1].p;
    window.open('https://waze.com/ul?ll=' + p[1].toFixed(6) + ',' + p[0].toFixed(6) + '&navigate=yes', '_blank', 'noopener');
  }

  function copiarEnlace() {
    const url = window.location.href;
    const listo = function () { GTViajes.avisar('Enlace copiado: quien lo abra ve este mismo viaje.'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(listo, function () { window.prompt('Copie este enlace:', url); });
    } else window.prompt('Copie este enlace:', url);
  }

  function resumenTexto(d) {
    const t = d.total, u = d.opciones.combustible.unidad;
    return GT.fmt(t.km, 1) + ' km · ' + d.duracion(t.segundos) + ' · ' + GT.fmt(t.litros, 1) + ' ' + u + ' · ' +
           d.pesos(t.costo) + ' · ' + d.opciones.vehiculo.nombre;
  }

  /* ------------------------------------------------------------------------
     Informe imprimible: una hoja con todo, lista para imprimir o guardar
     como PDF desde el diálogo de impresión.
     ------------------------------------------------------------------------ */

  /* La foto del mapa sale del lienzo justo después de un repintado: fuera
     de ese momento el lienzo de WebGL ya está vacío. */
  function foto(mapa) {
    return new Promise(function (ok) {
      if (!mapa) { ok(null); return; }
      mapa.once('render', function () {
        try { ok(mapa.getCanvas().toDataURL('image/jpeg', 0.88)); } catch (e) { ok(null); }
      });
      mapa.triggerRepaint();
      setTimeout(function () { ok(null); }, 2500);
    });
  }

  function armarInforme(d, imagen) {
    const r = d.ruta, t = d.total, o = d.opciones, u = o.combustible.unidad;
    const fila = function (a, b) { return '<tr><th>' + a + '</th><td>' + b + '</td></tr>'; };
    const desglose = {};
    Object.keys(r.ida.desglose).forEach(function (k) {
      desglose[k] = r.ida.desglose[k] + (r.vuelta ? r.vuelta.desglose[k] : 0);
    });
    const causas = { rodadura: 'Rodar', aire: 'Empujar el aire', motor: 'Motor encendido',
                     detenciones: 'Detenerse y arrancar', pendiente: 'Subidas y bajadas' };
    const svg = document.querySelector('#vjPerfil svg');
    const clima = d.clima ? 'viento de ' + GT.fmt(d.clima.ms * 3.6, 0) + ' km/h, ' + GT.fmt(d.clima.temperatura, 0) +
                            ' °C (Open-Meteo, al calcular)' : 'sin viento, 15 °C';
    const indicaciones = r.perfil.indicaciones;
    return '<header class="informe__cabeza">' +
        '<div class="informe__marca">TerraFoco · Viajes a terreno</div>' +
        '<h1>' + esc(d.nombre) + '</h1>' +
        '<div class="informe__fecha">' + GT_fecha(new Date().toISOString()) + '</div>' +
      '</header>' +
      '<section class="informe__cifras">' +
        [[GT.fmt(t.litros, 1) + ' ' + u, 'consumo estimado'], [d.pesos(t.costo), t.peajes ? 'costo, con peajes' : 'costo'],
         [GT.fmt(t.km, 1) + ' km', 'distancia'], [d.duracion(t.segundos), 'manejando'],
         [t.litros > 0 ? GT.fmt(t.km / t.litros, 1) + ' km/' + u : '—', 'rendimiento en la ruta'],
         [GT.fmt(t.co2, 1) + ' kg', 'CO₂']].map(function (c) {
          return '<div><strong>' + c[0] + '</strong><span>' + c[1] + '</span></div>';
        }).join('') +
      '</section>' +
      (imagen ? '<img class="informe__mapa" src="' + imagen + '" alt="Mapa del recorrido">' : '') +
      '<div class="informe__dos">' +
        '<section><h2>Recorrido</h2><ol class="informe__paradas">' +
          d.paradas.map(function (x) {
            return '<li><strong>' + x.letra + ' · ' + esc(x.nombre || x.comuna) + '</strong><br><span>' + x.rol + ' · ' +
                   esc(x.comuna) + ' · ' + GT.fmt(x.p[1], 5) + ', ' + GT.fmt(x.p[0], 5) + '</span></li>';
          }).join('') +
          (d.vuelta ? '<li><strong>Vuelta a A</strong></li>' : '') + '</ol></section>' +
        '<section><h2>Vehículo y supuestos</h2><table class="informe__tabla">' +
          fila('Vehículo', esc(o.vehiculo.nombre)) +
          fila('Combustible', esc(o.combustible.nombre) + ' a ' + d.pesos(o.precio) + '/' + u) +
          fila('Rendimiento promedio', GT.fmt(o.rendimiento, 1) + ' km/' + u) +
          fila('Personas y carga', o.ocupantes + (o.ocupantes === 1 ? ' persona' : ' personas') +
               (o.cargaKg ? ' · ' + GT.fmt(o.cargaKg) + ' kg' : ' · sin carga')) +
          fila('Manejo', d.estilo + (o.maxKmh ? ' · hasta ' + o.maxKmh + ' km/h' : '') + (o.aire ? ' · con aire acondicionado' : '')) +
          fila('Clima', clima) +
          (t.peajes ? fila('Peajes', d.pesos(t.peajes)) : '') +
        '</table></section>' +
      '</div>' +
      (d.tramos.length > 1 ? '<section><h2>Tramos</h2><table class="informe__tabla informe__tabla--datos"><thead><tr><th>Tramo</th>' +
        '<th>km</th><th>Tiempo</th><th>' + u + '</th><th>Pesos</th></tr></thead><tbody>' +
        d.tramos.map(function (x) {
          return '<tr><td>' + x.rotulo + '</td><td>' + GT.fmt(x.km, 1) + '</td><td>' + d.duracion(x.segundos) + '</td><td>' +
                 GT.fmt(x.litros, 2) + '</td><td>' + d.pesos(Math.max(0, x.litros) * o.precio) + '</td></tr>';
        }).join('') + '</tbody></table></section>' : '') +
      '<div class="informe__dos">' +
        '<section><h2>En qué se va el combustible</h2><table class="informe__tabla informe__tabla--datos"><tbody>' +
          Object.keys(causas).map(function (k) {
            return '<tr><td>' + causas[k] + '</td><td>' + (desglose[k] < 0 ? '−' : '') + GT.fmt(Math.abs(desglose[k]), 2) + ' ' + u + '</td></tr>';
          }).join('') + '</tbody></table></section>' +
        '<section><h2>Por tipo de camino' + (r.vuelta ? ' (ida)' : '') + '</h2><table class="informe__tabla informe__tabla--datos"><tbody>' +
          Object.keys(GTViaje.TIPOS).filter(function (k) { return r.ida.porTipo[k].m > 0; }).map(function (k) {
            const x = r.ida.porTipo[k];
            return '<tr><td>' + GTViaje.TIPOS[k] + '</td><td>' + GT.fmt(x.m / 1000, 1) + ' km</td><td>' +
                   GT.fmt(x.litros, 2) + ' ' + u + '</td></tr>';
          }).join('') + '</tbody></table></section>' +
      '</div>' +
      (svg ? '<section><h2>Perfil de alturas</h2><div class="informe__perfil">' + svg.outerHTML + '</div></section>' : '') +
      (indicaciones.length ? '<section class="informe__indicaciones"><h2>Indicaciones</h2><ol>' +
        indicaciones.map(function (x) {
          return '<li>' + esc(x.texto) + (x.largo > 0 ? ' <span>(' + GT.fmt(x.largo / 1000, 1) + ' km)</span>' : '') + '</li>';
        }).join('') + '</ol></section>' : '') +
      '<footer class="informe__pie">Estimación del modelo físico de TerraFoco: rodadura según la superficie, aire según ' +
        'velocidad, altura y viento, pendiente cada 30 m, detenciones y motor, calibrado al rendimiento promedio del ' +
        'vehículo. El tráfico, la presión de los neumáticos y el estado del vehículo pueden moverla un 10 a 20 %. ' +
        'Camino: OpenStreetMap (Valhalla, FOSSGIS). terrafoco.tech</footer>';
  }

  function informe() {
    const d = GTViajes.datos(); if (!d) return;
    const b = $('vjInforme');
    b.disabled = true;
    // Toda la ruta en la foto, no el encuadre que tenía el mapa.
    GTViajes.encuadrar().then(function () { return foto(d.mapa); }).then(function (img) {
      $('vjInformeHoja').innerHTML = armarInforme(d, img);
      b.disabled = false;
      // Las imágenes tienen que estar cargadas antes de imprimir.
      setTimeout(function () { window.print(); }, 150);
    });
  }

  /* ------------------------------------------------------------------------
     Mis viajes
     ------------------------------------------------------------------------ */

  function leerViajes() {
    try { return JSON.parse(localStorage.getItem(CLAVE_VIAJES)) || []; } catch (e) { return []; }
  }

  function escribirViajes(lista) {
    try { localStorage.setItem(CLAVE_VIAJES, JSON.stringify(lista)); return true; } catch (e) { return false; }
  }

  function guardarViaje() {
    const d = GTViajes.datos(); if (!d) return;
    const nombre = $('vjNombreViaje').value.trim() || d.nombre;
    const o = d.opciones, t = d.total;
    const v = {
      id: Date.now(), nombre: nombre.slice(0, 120), fecha: new Date().toISOString(),
      paradas: d.paradas.map(function (x) { return { p: x.p, nombre: x.nombre, comuna: x.comuna }; }),
      vuelta: d.vuelta, vehiculo: o.vehiculo.id,
      combustible: Object.keys(GTViaje.COMBUSTIBLES).find(function (k) { return GTViaje.COMBUSTIBLES[k] === o.combustible; }),
      vehiculoNombre: o.vehiculo.nombre, unidad: o.combustible.unidad,
      km: t.km, litros: t.litros, segundos: t.segundos, combustibleCosto: t.combustible, peajes: t.peajes,
      costo: t.costo, co2: t.co2, recorrido: d.nombre,
    };
    const lista = leerViajes();
    lista.unshift(v);
    if (!escribirViajes(lista.slice(0, MAX_GUARDADOS))) {
      GTViajes.avisar('Este navegador no deja guardar datos: descargue el informe o el GPX para conservar el viaje.', 'alerta');
      return;
    }
    $('vjNombreViaje').value = '';
    pintarViajes();
    GTViajes.avisar('Viaje guardado en "Mis viajes", en este navegador.');
  }

  function pintarViajes() {
    const lista = leerViajes();
    $('vjPlanilla').disabled = !lista.length;
    if (!lista.length) {
      $('vjGuardados').innerHTML = '<p class="small muted" style="margin:0">Todavía no hay viajes guardados. ' +
        'Guarde los que repite o los que tiene que rendir.</p>';
      $('vjGuardadosResumen').textContent = '';
      return;
    }
    const suma = lista.reduce(function (s, v) { s.costo += v.costo; s.km += v.km; return s; }, { costo: 0, km: 0 });
    $('vjGuardadosResumen').textContent = lista.length + (lista.length === 1 ? ' viaje' : ' viajes') + ' · ' +
      GT.fmt(suma.km, 0) + ' km · $' + GT.fmt(Math.round(suma.costo));
    $('vjGuardados').innerHTML = lista.map(function (v) {
      return '<div class="viaje__guardado">' +
               '<div><strong>' + esc(v.nombre) + '</strong>' +
                 '<span class="tiny muted">' + GT_fecha(v.fecha, false) + ' · ' + GT.fmt(v.km, 1) + ' km · ' +
                 GT.fmt(v.litros, 1) + ' ' + v.unidad + ' · $' + GT.fmt(Math.round(v.costo)) + '</span></div>' +
               '<button type="button" class="btn btn--chico" data-abrir="' + v.id + '">Abrir</button>' +
               '<button type="button" class="viaje__quitar" data-borrar="' + v.id + '" aria-label="Borrar ' + esc(v.nombre) + '">✕</button>' +
             '</div>';
    }).join('');
  }

  /* La planilla para rendir gastos: un viaje por fila. */
  function planilla() {
    const lista = leerViajes();
    if (!lista.length) return;
    const filas = [['Fecha', 'Viaje', 'Recorrido', 'Vuelta al inicio', 'Km', 'Consumo', 'Unidad', 'Combustible ($)',
                    'Peajes ($)', 'Total ($)', 'CO2 (kg)', 'Vehículo']];
    lista.slice().reverse().forEach(function (v) {
      filas.push([GT_fecha(v.fecha, false), v.nombre, v.recorrido, v.vuelta ? 'sí' : 'no', num(v.km, 1),
                  num(v.litros, 2), v.unidad, Math.round(v.combustibleCosto), Math.round(v.peajes || 0),
                  Math.round(v.costo), num(v.co2, 1), v.vehiculoNombre]);
    });
    descargar(csv(filas, ['Viajes a terreno guardados en TerraFoco. Montos estimados con el modelo físico.']),
              'rendicion_viajes_' + GT_hoy() + '.csv', 'text/csv;charset=utf-8');
  }

  /* ------------------------------------------------------------------------
     Arranque y avisos de viajes.js
     ------------------------------------------------------------------------ */

  /* viajes.js avisa cada vez que cambia el viaje: con ruta o sin ella. */
  function alCambiar(hay) {
    ['vjInforme', 'vjGpx', 'vjKml', 'vjCsv', 'vjGmaps', 'vjWaze', 'vjCompartir', 'vjGuardar'].forEach(function (id) {
      $(id).disabled = !hay;
    });
    const d = hay ? GTViajes.datos() : null;
    $('vjNombreViaje').placeholder = d ? d.nombre : 'Nombre del viaje';
  }

  function montar() {
    montarBuscador();
    $('vjUbicacion').addEventListener('click', miUbicacion);
    $('vjInforme').addEventListener('click', informe);
    $('vjGpx').addEventListener('click', gpx);
    $('vjKml').addEventListener('click', kml);
    $('vjCsv').addEventListener('click', csvPerfil);
    $('vjGmaps').addEventListener('click', googleMaps);
    $('vjWaze').addEventListener('click', waze);
    $('vjCompartir').addEventListener('click', copiarEnlace);
    $('vjGuardar').addEventListener('click', guardarViaje);
    $('vjNombreViaje').addEventListener('keydown', function (e) { if (e.key === 'Enter') guardarViaje(); });
    $('vjPlanilla').addEventListener('click', planilla);
    $('vjGuardados').addEventListener('click', function (e) {
      const abrir = e.target.closest('[data-abrir]'), quitar = e.target.closest('[data-borrar]');
      if (abrir) {
        const v = leerViajes().find(function (x) { return String(x.id) === abrir.dataset.abrir; });
        if (v) { GTViajes.cargar(v); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      } else if (quitar) {
        escribirViajes(leerViajes().filter(function (x) { return String(x.id) !== quitar.dataset.borrar; }));
        pintarViajes();
      }
    });
    pintarViajes();
    alCambiar(false);
  }

  return { montar: montar, nombreDe: nombreDe, alCambiar: alCambiar, armarInforme: armarInforme };
})();
