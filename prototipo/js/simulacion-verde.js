/* ==========================================================================
   TerraFoco — Simular un área verde (urbano.html)

   La pestaña "Simular un parque": se elige tamaño y tipo, se hace clic en
   el mapa donde iría, y brotan los árboles mientras un halo de
   enfriamiento se expande sobre el mapa de temperatura superficial. (Es un
   halo y no un cambio de color del mapa: las clases van de 3 en 3 °C y el
   efecto es de décimas; recoloreadas, casi ninguna celda cambiaba.) Las cifras dicen cuánto baja, hasta dónde
   se nota, cuántas personas viven en lo que se enfría y cómo cambia el área
   verde por habitante de su zona censal (el estándar SIEDU de 10 m²).

   Las cuentas están en simulacion-calor.js. Aquí: preparar la comuna (la
   temperatura por celda, las áreas verdes que existen y la población), la
   capa de temperatura simulada, los árboles y el panel.
   ========================================================================== */

const GTSimVerde = (function () {
  'use strict';

  const TAMANOS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 20];      // ha
  const ID_FUENTE = 'simv-calor', ID_CAPA = 'simv-calor-capa';
  const ID_PARQUES = 'simv-parques', ID_ALCANCE = 'simv-alcance', ID_EXISTENTES = 'simv-existentes';
  const DURACION = 2600;                                      // ms de la animación

  const S = {
    api: null, mapa: null, detalle: null, el: null,
    activa: false, colocando: false, comuna: null,
    c: null,                // la comuna preparada: grilla, temperaturas, zonas, población
    parques: [], previo: null, nuevo: null, cuadro: null,
    lienzo: null, ctx: null, imagen: null, px: null, marcadores: [],
    tamano: 1, tipo: 'mixto', pedido: 0,
  };

  function $(id) { return document.getElementById(id); }
  function fmt(n, d) { return GT.fmt(n, d || 0); }
  function grados(v, d) { return (v < 0 ? '−' : '') + GT.fmt(Math.abs(v), d === undefined ? 1 : d) + ' °C'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function calor() { return window.TERRAFOCO_CALOR || null; }
  function fichaDe(nombre) {
    const c = calor();
    return c ? c.comunas.filter(function (x) { return x.nombre === nombre; })[0] || null : null;
  }

  /* ---------------------------------------------------------------------
     Arranque
     --------------------------------------------------------------------- */

  function iniciar(api, contenedor) {
    S.api = api || {};
    S.el = contenedor;
    S.mapa = S.api.instancia || null;
    S.detalle = S.api.detalle ? S.api.detalle('calor') : null;
    montarControles();
    if (!S.mapa || !S.detalle) return;
    contenedor.addEventListener('detalle:base', function (e) {
      if (!S.activa) return;
      if (e.detail && e.detail.nombre) preparar(e.detail.nombre);
    });
    contenedor.addEventListener('detalle:resumen', function (e) {
      if (S.activa && !e.detail) { S.c = null; quitarTodo(); pintarNota('elige una comuna en el mapa'); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.colocando) dejarDeColocar(); });
  }

  function montarControles() {
    const sel = $('svComuna'), c = calor();
    const disponibles = c ? c.comunas.map(function (x) { return x.nombre; }) : [];
    sel.innerHTML = disponibles.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
    sel.addEventListener('change', function () { abrir(sel.value); });
    const t = $('svTamano');
    t.max = TAMANOS.length - 1;
    t.value = TAMANOS.indexOf(S.tamano);
    t.addEventListener('input', function () { S.tamano = TAMANOS[+t.value]; pintarControles(); });
    $('svTipo').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-valor]');
      if (!b) return;
      S.tipo = b.getAttribute('data-valor');
      pintarControles();
    });
    $('svUbicar').addEventListener('click', function () { S.colocando ? dejarDeColocar() : colocar(); });
    $('svLimpiar').addEventListener('click', function () { quitarTodo(); pintarResultados(); });
    $('svParques').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-quitar]');
      if (b) quitarParque(+b.getAttribute('data-quitar'));
    });
    pintarControles();
  }

  function pintarControles() {
    const ha = S.tamano;
    $('svTamanoValor').textContent = GT.fmt(ha, ha < 1 ? 2 : 0) + ' ha · ' +
      (ha < 1 ? '≈ ' + GT.fmt(ha * 10000) + ' m²' : '≈ ' + GT.fmt(ha) + (ha === 1 ? ' manzana' : ' manzanas'));
    $('svTipo').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-valor') === S.tipo);
    });
  }

  function pintarNota(t) { $('svNota').textContent = t; }

  /* Entrar o salir de la pestaña. */
  function activar(si) {
    S.activa = si;
    $('simVerde').hidden = !si;
    document.querySelectorAll('[data-sin-simulacion]').forEach(function (el) { el.hidden = si; });
    if (!S.mapa) { pintarNota('necesita el mapa real'); return; }
    if (si) {
      const actual = S.api.seleccionada && S.api.seleccionada();
      const nombre = fichaDe(actual) ? actual : ($('svComuna').value || 'Rancagua');
      abrir(nombre);
    } else {
      dejarDeColocar();
      mostrarCapas(false);
    }
  }

  function abrir(nombre) {
    $('svComuna').value = nombre;
    const base = S.detalle.base();
    if (S.api.seleccionada && S.api.seleccionada() === nombre && base && base.nombre === nombre) {
      preparar(nombre);
    } else {
      pintarNota('abriendo ' + nombre + '…');
      S.api.abrirComuna(nombre);
    }
  }

  /* ---------------------------------------------------------------------
     Preparar la comuna
     --------------------------------------------------------------------- */

  function nombreZona(p) {
    const distrito = p.id_zona ? Math.floor(p.id_zona / 1000) % 100 : null;
    return (distrito ? 'Distrito ' + distrito + ' · zona ' : 'Zona ') + p.cod_zona;
  }

  function preparar(nombre) {
    const este = ++S.pedido;
    const ficha = fichaDe(nombre), base = S.detalle.base();
    if (S.c && S.c.nombre === nombre) { mostrarCapas(true); return; }
    quitarTodo();
    S.c = null;
    if (!ficha || !base || !base.original) {
      pintarNota(nombre + ' · sin temperatura por celda');
      $('svLocal').innerHTML = '<p class="small muted" style="margin:0">Hay temperatura a 70 m solo para Rancagua y ' +
        'sus comunas vecinas. Elige una de ellas.</p>';
      return;
    }
    $('svComuna').value = nombre;
    pintarNota(nombre + ' · preparando…');
    const g = GTSimCalor.grilla(base);
    const T = GTSimCalor.temperaturas(base, ficha, calor().cortes);
    Promise.all([
      GT.areasVerdesGeo(ficha.id_comuna),
      fetch(GT_api('/exposicion/poblacion', { comuna: ficha.id_comuna }), { signal: AbortSignal.timeout(15000) })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    ]).then(function (r) {
      if (este !== S.pedido) return;
      const geo = r[0], pobGeo = r[1];
      const urbano = new Uint8Array(g.N), zonas = new Uint16Array(g.N), parque = new Uint8Array(g.N);
      const plaza = new Uint8Array(g.N), celdasDe = new Map();
      const zonasInfo = [];
      if (geo && geo.zonas) {
        geo.zonas.features.forEach(function (f) {
          const p = f.properties;
          zonasInfo.push({ nombre: nombreZona(p), personas: p.personas || 0,
                           area: (p.m2_hab || 0) * (p.personas || 0) });
        });
        GTSimCalor.rasterizar(geo.zonas.features, g, function (i, k) { urbano[i] = 1; zonas[i] = k + 1; });
      }
      if (geo && geo.areas) {
        GTSimCalor.rasterizar(geo.areas.features, g, function (i, k, f) {
          parque[i] = 1;
          if (!celdasDe.has(k)) celdasDe.set(k, []);
          celdasDe.get(k).push(i);
          if (!f.properties.solo_pasto && (f.properties.area_m2 || 0) >= 450) plaza[i] = 1;
        });
        // Las plazas chicas no llenan una celda de 70 m: para la distancia a
        // la plaza más cercana cuenta también la celda donde está su centro.
        geo.areas.features.forEach(function (f) {
          if (f.properties.solo_pasto || (f.properties.area_m2 || 0) < 450) return;
          const c = centro(f);
          if (!c) return;
          const x = Math.floor(g.x(c[0])), y = Math.floor(g.y(c[1]));
          if (x >= 0 && y >= 0 && x < g.W && y < g.H) plaza[y * g.W + x] = 1;
        });
      }
      const perfil = GTSimCalor.perfilPorParque(T.t, geo && geo.areas ? geo.areas.features : [], celdasDe, g, urbano, parque);
      const pob = pobGeo && pobGeo.features && typeof GTCalculo !== 'undefined'
        ? GTCalculo.rasterizarManzanas(pobGeo, base).personas : null;
      S.c = {
        nombre: nombre, ficha: ficha, base: base, g: g, t: T.t, urbano: urbano, zonas: zonas, zonasInfo: zonasInfo,
        distPlaza: GTSimCalor.distancia(plaza, g), pob: pob, perfil: perfil, geo: geo,
        areaTipica: perfil.areaTipica,
      };
      pintarNota(nombre);
      pintarLocal();
      asegurarCapas();
      mostrarCapas(true);
      pintarLienzo(null);
      pintarResultados();
    });
  }

  function centro(f) {
    const g = f.geometry;
    const anillo = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : null;
    if (!anillo || !anillo.length) return null;
    let x = 0, y = 0;
    anillo.forEach(function (c) { x += c[0]; y += c[1]; });
    return [x / anillo.length, y / anillo.length];
  }

  /* "Lo que ya pasa": cuánto más frescos son hoy sus parques que su entorno. */
  function pintarLocal() {
    const p = S.c.perfil, n = S.c.nombre;
    if (!p.valido) {
      $('svLocal').innerHTML = '<strong>En ' + esc(n) + '</strong> hay ' + (p.parques.length || 'muy pocos') +
        ' parques de 1 ha o más que se puedan medir con celdas de 70 m: no alcanza para decir cuánto enfrían. ' +
        'La simulación usa ' + grados(-GTSimCalor.INTENSIDAD_RESPALDO) + ' para un parque típico, el orden que se mide en Rancagua.';
      return;
    }
    const max = Math.max.apply(null, p.parques.map(function (m) { return Math.abs(m.isla); })) || 1;
    $('svLocal').innerHTML = '<strong>Lo que ya pasa en ' + esc(n) + ':</strong> sus ' + p.parques.length +
      ' parques de 1 ha o más están en promedio <strong>' + grados(-p.intensidadMedida, 2) + '</strong> más frescos ' +
      'que su entorno de ' + GTSimCalor.ENTORNO[0] + ' a ' + GTSimCalor.ENTORNO[1] + ' m (' + p.masFrescos + ' de ' +
      p.parques.length + ' lo son). Es la base de la simulación. La temperatura promedia escenas de día y de noche: ' +
      'en las horas de sol la diferencia es mayor.' +
      '<div class="sv__perfil">' + p.parques.slice(0, 6).map(function (m) {
        return '<div class="sv__perfil-fila"><span>' + esc(m.nombre) + ' · ' + GT.fmt(m.ha, 1) + ' ha</span>' +
          '<span class="sv__perfil-barra"><i style="width:' + (100 * Math.max(0, m.isla) / max).toFixed(1) + '%"></i></span>' +
          '<span class="mono">' + grados(-m.isla, 2) + '</span></div>';
      }).join('') + '</div>';
  }

  /* ---------------------------------------------------------------------
     Colocar parques
     --------------------------------------------------------------------- */

  function colocar() {
    if (!S.c) return;
    S.colocando = true;
    $('svUbicar').textContent = 'Cancelar';
    $('svAyuda').textContent = 'Haz clic dentro de ' + S.c.nombre + ' donde iría el área verde (Esc para cancelar).';
    S.mapa.getCanvas().style.cursor = 'crosshair';
    S.el.classList.add('es-colocando');
  }

  function dejarDeColocar() {
    S.colocando = false;
    if ($('svUbicar')) $('svUbicar').textContent = 'Ubicar en el mapa';
    if ($('svAyuda')) $('svAyuda').textContent = '';
    if (S.mapa) S.mapa.getCanvas().style.cursor = '';
    if (S.el) S.el.classList.remove('es-colocando');
  }

  /* Clic dentro de la comuna abierta (mapa-real: alClicEnAbierta). */
  function alClic(lngLat) {
    if (!S.activa || !S.colocando || !S.c) return;
    dejarDeColocar();
    const g = S.c.g, x = g.x(lngLat.lng), y = g.y(lngLat.lat);
    if (x < 0 || y < 0 || x >= g.W || y >= g.H) return;
    const area = S.tamano * 10000;
    const parque = {
      x: x, y: y, lng: lngLat.lng, lat: lngLat.lat, area: area, tipo: S.tipo, ha: S.tamano,
      intensidad: GTSimCalor.intensidad(S.c.perfil.intensidad, area, S.tipo, S.c.areaTipica),
      urbano: !!S.c.urbano[Math.floor(y) * g.W + Math.floor(x)],
    };
    S.previo = GTSimCalor.efecto(S.parques, g);
    S.nuevo = GTSimCalor.efecto([parque], g);
    S.parques.push(parque);
    pintarFiguras();
    plantar(parque, S.parques.length - 1);
    animar();
  }

  function quitarParque(k) {
    S.parques.splice(k, 1);
    S.marcadores.filter(function (m) { return m.parque === k; }).forEach(function (m) { m.marcador.remove(); });
    S.marcadores = S.marcadores.filter(function (m) { return m.parque !== k; })
      .map(function (m) { return { marcador: m.marcador, parque: m.parque > k ? m.parque - 1 : m.parque }; });
    S.previo = null; S.nuevo = null;
    pintarFiguras();
    pintarLienzo(1);
    pintarResultados();
  }

  function quitarTodo() {
    if (S.cuadro) cancelAnimationFrame(S.cuadro);
    S.parques = []; S.previo = null; S.nuevo = null;
    S.marcadores.forEach(function (m) { m.marcador.remove(); });
    S.marcadores = [];
    if (S.mapa && S.mapa.getSource(ID_PARQUES)) pintarFiguras();
    if (S.c) pintarLienzo(null);
  }

  /* Los árboles: brotan escalonados dentro del círculo del parque. */
  function plantar(p, k) {
    const n = Math.max(5, Math.min(28, Math.round(4 + 6 * Math.sqrt(p.ha))));
    const R = Math.sqrt(p.area / Math.PI) * 0.82;
    const mLat = 1 / 110540, mLng = 1 / (111320 * Math.cos(p.lat * Math.PI / 180));
    for (let j = 0; j < n; j++) {
      // Espiral de ángulo áureo: reparte parejo, sin azar.
      const r = R * Math.sqrt((j + 0.5) / n), a = j * 2.39996;
      const el = document.createElement('div');
      el.className = 'arbol arbol--' + p.tipo;
      el.setAttribute('aria-hidden', 'true');
      const alto = p.tipo === 'pasto' ? 0.7 : 0.85 + 0.3 * ((j * 7) % 5) / 4;
      el.innerHTML = '<svg viewBox="0 0 24 32" style="animation-delay:' + (0.15 + 1.5 * j / n).toFixed(2) + 's;' +
        '--alto:' + alto.toFixed(2) + '"><rect class="arbol__tronco" x="10.6" y="18" width="2.8" height="12" rx="1"/>' +
        '<circle class="arbol__copa" cx="12" cy="13" r="9"/><circle class="arbol__brillo" cx="9" cy="10" r="3.2"/></svg>';
      const m = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([p.lng + r * Math.cos(a) * mLng, p.lat + r * Math.sin(a) * mLat]).addTo(S.mapa);
      S.marcadores.push({ marcador: m, parque: k });
    }
  }

  /* ---------------------------------------------------------------------
     Capas: temperatura simulada, contorno de los parques y su alcance
     --------------------------------------------------------------------- */

  function antesDeRotulos() {
    const s = S.mapa.getStyle().layers.filter(function (l) { return l.type === 'symbol'; })[0];
    return s ? s.id : undefined;
  }

  function asegurarCapas() {
    const b = S.c.base;
    if (!S.lienzo || S.lienzo.width !== b.ancho || S.lienzo.height !== b.alto) {
      S.lienzo = document.createElement('canvas');
      S.lienzo.width = b.ancho; S.lienzo.height = b.alto;
      S.ctx = S.lienzo.getContext('2d');
      S.imagen = S.ctx.createImageData(b.ancho, b.alto);
      S.px = new Uint32Array(S.imagen.data.buffer);
      quitarCapas();
    }
    const antes = antesDeRotulos();
    const esquinas = b.esquinas.map(function (c) { return [c[0], c[1]]; });
    if (!S.mapa.getSource(ID_FUENTE)) {
      S.mapa.addSource(ID_FUENTE, { type: 'canvas', canvas: S.lienzo, animate: false, coordinates: esquinas });
      S.mapa.addLayer({ id: ID_CAPA, type: 'raster', source: ID_FUENTE,
                        paint: { 'raster-opacity': 1, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, antes);
    } else {
      // Otra comuna con una grilla del mismo tamaño: el lienzo sirve, el lugar no.
      S.mapa.getSource(ID_FUENTE).setCoordinates(esquinas);
    }
    if (!S.mapa.getSource(ID_EXISTENTES)) {
      S.mapa.addSource(ID_EXISTENTES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      S.mapa.addLayer({ id: ID_EXISTENTES, type: 'line', source: ID_EXISTENTES,
                        paint: { 'line-color': PALETA.verde, 'line-width': 1, 'line-opacity': 0.85 } }, antes);
    }
    S.mapa.getSource(ID_EXISTENTES).setData(S.c.geo && S.c.geo.areas ? S.c.geo.areas : { type: 'FeatureCollection', features: [] });
    if (!S.mapa.getSource(ID_PARQUES)) {
      S.mapa.addSource(ID_PARQUES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      S.mapa.addSource(ID_ALCANCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      S.mapa.addLayer({ id: ID_ALCANCE, type: 'line', source: ID_ALCANCE,
                        paint: { 'line-color': PALETA.tinta, 'line-width': 1, 'line-opacity': 0.6, 'line-dasharray': [2, 3] } }, antes);
      S.mapa.addLayer({ id: ID_PARQUES, type: 'fill', source: ID_PARQUES,
                        paint: { 'fill-color': PALETA.verde, 'fill-opacity': 0.42, 'fill-outline-color': PALETA.verdeClaro } }, antes);
    }
  }

  function mostrarCapas(si) {
    if (!S.mapa) return;
    [ID_CAPA, ID_EXISTENTES, ID_PARQUES, ID_ALCANCE].forEach(function (id) {
      if (S.mapa.getLayer(id)) S.mapa.setLayoutProperty(id, 'visibility', si ? 'visible' : 'none');
    });
    S.marcadores.forEach(function (m) { m.marcador.getElement().style.display = si ? '' : 'none'; });
  }

  function quitarCapas() {
    [ID_CAPA, ID_EXISTENTES, ID_PARQUES, ID_ALCANCE].forEach(function (id) {
      if (S.mapa.getLayer(id)) S.mapa.removeLayer(id);
    });
    [ID_FUENTE, ID_EXISTENTES, ID_PARQUES, ID_ALCANCE].forEach(function (id) {
      if (S.mapa.getSource(id)) S.mapa.removeSource(id);
    });
  }

  function circulo(lng, lat, radio, n) {
    const mLat = 1 / 110540, mLng = 1 / (111320 * Math.cos(lat * Math.PI / 180)), puntos = [];
    for (let k = 0; k <= (n || 48); k++) {
      const a = 2 * Math.PI * k / (n || 48);
      puntos.push([lng + radio * Math.cos(a) * mLng, lat + radio * Math.sin(a) * mLat]);
    }
    return puntos;
  }

  function pintarFiguras() {
    const parques = S.parques.map(function (p) {
      return { type: 'Feature', properties: {},
               geometry: { type: 'Polygon', coordinates: [circulo(p.lng, p.lat, Math.sqrt(p.area / Math.PI))] } };
    });
    const alcance = S.parques.map(function (p) {
      return { type: 'Feature', properties: {},
               geometry: { type: 'LineString', coordinates: circulo(p.lng, p.lat, Math.sqrt(p.area / Math.PI) + GTSimCalor.alcance(p.area)) } };
    });
    S.mapa.getSource(ID_PARQUES).setData({ type: 'FeatureCollection', features: parques });
    S.mapa.getSource(ID_ALCANCE).setData({ type: 'FeatureCollection', features: alcance });
  }

  /* El halo de enfriamiento: azul, más opaco donde más baja. `e` es el
     avance del parque nuevo (0..1): el halo se abre desde su centro. */
  function pintarLienzo(e) {
    if (!S.c || !S.px) return;
    const g = S.c.g, px = S.px, N = g.N;
    const hex = PALETA.azulClaro || PALETA.azul;
    const n = parseInt(hex.slice(1), 16), rgb = ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255);
    const escala = Math.max(0.2, S.parques.reduce(function (m, q) { return Math.max(m, q.intensidad); }, 0));
    let de = null, frente = Infinity, nuevo = null;
    if (e !== null && S.parques.length) {
      if (S.previo && S.nuevo) {
        de = S.previo; nuevo = S.nuevo;
        const q = S.parques[S.parques.length - 1];
        frente = e * (Math.sqrt(q.area / Math.PI) + 1.5 * GTSimCalor.alcance(q.area));
      } else {
        de = GTSimCalor.efecto(S.parques, g);
      }
    }
    const q = S.parques[S.parques.length - 1];
    for (let i = 0; i < N; i++) {
      let v = de ? de[i] : 0;
      if (nuevo && nuevo[i] < v) {
        const x = i % g.W + 0.5, y = (i - i % g.W) / g.W + 0.5;
        if (Math.hypot((x - q.x) * g.dx, (y - q.y) * g.dy) <= frente) v = nuevo[i];
      }
      if (v > -0.03 || S.c.t[i] !== S.c.t[i]) { px[i] = 0; continue; }
      const a = Math.round(255 * Math.min(0.85, 0.12 + 0.73 * (-v) / escala));
      px[i] = (a << 24) | rgb;
    }
    S.ctx.putImageData(S.imagen, 0, 0);
    const f = S.mapa.getSource(ID_FUENTE);
    if (f) {
      f.play();
      S.mapa.once('render', function () { if (!S.cuadro) f.pause(); });
      S.mapa.triggerRepaint();
    }
  }

  function animar() {
    if (S.cuadro) cancelAnimationFrame(S.cuadro);
    const t0 = performance.now();
    const paso = function (ahora) {
      // El primer cuadro puede venir marcado antes de t0: piso en 0.
      const p = Math.max(0, Math.min(1, (ahora - t0) / DURACION)), e = 1 - Math.pow(1 - p, 3);
      S.cuadro = p < 1 ? requestAnimationFrame(paso) : null;
      pintarLienzo(e);
      if (!S.cuadro) { S.previo = null; S.nuevo = null; pintarResultados(); }
    };
    S.cuadro = requestAnimationFrame(paso);
  }

  /* ---------------------------------------------------------------------
     Cifras
     --------------------------------------------------------------------- */

  function cifra(valor, rotulo, sub) {
    return '<div class="cifra"><span class="cifra__valor">' + valor + '</span>' +
           '<span class="cifra__rotulo">' + rotulo + '</span>' +
           (sub ? '<span class="tiny muted">' + sub + '</span>' : '') + '</div>';
  }

  function pintarResultados() {
    const caja = $('svResultado'), lista = $('svParques');
    if (!S.c || !S.parques.length) {
      caja.innerHTML = S.c ? '<p class="small muted" style="margin:0">Aún no hay áreas verdes simuladas. Elige tamaño y ' +
        'tipo y aprieta <strong>Ubicar en el mapa</strong>.</p>' : '';
      lista.innerHTML = '';
      return;
    }
    const de = GTSimCalor.efecto(S.parques, S.c.g);
    const r = GTSimCalor.resumir(S.parques, de, S.c);
    const u = S.parques[S.parques.length - 1], rp = r.parque;
    let html = '<div class="cifras">' +
      cifra(grados(rp.despues - rp.antes, 2), 'en el área verde', 'de ' + grados(rp.antes, 2) + ' a ' + grados(rp.despues, 2)) +
      cifra(grados(rp.a100, 2), 'a 100 m del borde', grados(rp.a200, 2) + ' a 200 m · se nota hasta ~' + fmt(rp.alcance) + ' m') +
      cifra('≈ ' + GT.fmt(r.haFresca, r.haFresca < 10 ? 1 : 0) + ' ha', 'más frescas',
            'al menos ' + GT.fmt(GTSimCalor.UMBRAL_FRESCO, 2) + ' °C' + (S.parques.length > 1 ? ' · con los ' + S.parques.length + ' parques' : '')) +
      (S.c.pob ? cifra('≈ ' + fmt(r.personasFresca), 'personas viven ahí', 'Censo 2024') : '') +
      (S.c.pob ? cifra('≈ ' + fmt(r.gananPlaza), 'ganan una plaza a 400 m', 'hoy no tienen ninguna tan cerca') : '') +
      '</div>';
    if (r.zona) {
      const cumple = r.zona.despues >= 10, antes = r.zona.antes >= 10;
      html += '<div class="sim__maximo small">' + esc(r.zona.nombre) + ' (' + fmt(r.zona.personas) + ' personas): el área verde ' +
        'por habitante pasa de <strong>' + GT.fmt(r.zona.antes, 1) + '</strong> a <strong>' + GT.fmt(r.zona.despues, 1) +
        ' m²</strong>' + (cumple && !antes ? ' y <strong>alcanza el estándar</strong> de 10 m² (SIEDU).'
          : cumple ? '; ya cumplía el estándar de 10 m².' : '; el estándar SIEDU es 10 m².') + '</div>';
    } else if (!u.urbano) {
      html += '<p class="tiny muted" style="margin:8px 0 0">El último parque quedó fuera del área urbana del Censo: ' +
        'enfría el terreno, pero no cambia el área verde por habitante de ninguna zona censal.</p>';
    }
    caja.innerHTML = html;
    lista.innerHTML = '<div class="sim__lista-cab">Áreas verdes simuladas</div>' + S.parques.map(function (p, k) {
      return '<div class="sv__parque"><span>' + (k + 1) + '. ' + GTSimCalor.TIPOS[p.tipo].nombre + ' · ' +
        GT.fmt(p.ha, p.ha < 1 ? 2 : 0) + ' ha · ' + grados(-p.intensidad, 2) + '</span>' +
        '<button type="button" class="btn btn--chico" data-quitar="' + k + '" aria-label="Quitar">Quitar</button></div>';
    }).join('');
  }

  return { iniciar: iniciar, activar: activar, alClic: alClic };
})();
