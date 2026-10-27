/* ==========================================================================
   TerraFoco — Viajes a terreno: la ruta, el combustible y el autito

   Se marca una salida (A) y una llegada (B) dentro de la región, y la
   pantalla busca el camino, lo corta en tramos de 30 m con su tipo de vía,
   superficie, velocidad y pendiente, y estima con viaje-calculo.js cuántos
   litros y cuántos pesos cuesta llegar. Después, si se quiere, un autito
   recorre la ruta con el estanque bajando.

   De dónde sale el camino, en orden:
     1. Valhalla (FOSSGIS, sobre OpenStreetMap): ruta, alternativas, altura
        cada 30 m y, con trace_attributes, clase, superficie, velocidad y
        densidad urbana de cada arco. Sin clave y con CORS abierto.
     2. OSRM (FOSSGIS), si Valhalla no responde: solo forma y velocidad; la
        altura se lee de las teselas de elevación públicas (Terrarium).
     3. Sin red: línea recta alargada, advertida como aproximación.
   Ninguno pide clave ni datos personales: solo viajan las dos coordenadas.

   Cambiar el vehículo, la carga o el precio no vuelve a pedir la ruta: el
   cálculo es local y se rehace al instante.
   ========================================================================== */

const GTViajes = (function () {
  'use strict';

  const VALHALLA = 'https://valhalla1.openstreetmap.de';
  const OSRM = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';
  const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/';
  const CLAVE = 'terrafoco_viaje';
  const V = GTViaje;

  /* Un ejemplo para ver la pantalla andando sin saber dónde hacer clic:
     del centro de Rancagua a un predio ficticio de la precordillera
     (datos/predios_ejemplo.csv), con subida larga y camino rural. */
  const EJEMPLO = { a: [-70.7444, -34.1708], b: [-70.46112, -34.32402] };

  const $ = function (id) { return document.getElementById(id); };
  const pesos = function (n) { return '$' + GT.fmt(Math.round(n)); };
  const esc = function (t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  const S = {
    api: null, mapa: null,
    puntos: { a: null, b: null },   // { p: [lon, lat], comuna }
    marcas: { a: null, b: null },
    rutas: [],                      // { perfil, ida, vuelta, fuente, avisos }
    elegida: 0,
    modo: 'consumo',
    ritmo: 1,
    pedido: 0,
    anim: null,
  };

  /* ------------------------------------------------------------------------
     Preferencias del vehículo: se recuerdan en este navegador
     ------------------------------------------------------------------------ */

  function leerGuardado() {
    try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch (e) { return {}; }
  }

  function guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({
        vehiculo: $('vjVehiculo').value, combustible: $('vjCombustible').value,
        precios: S.precios, rendimiento: S.rendimientoPropio,
        ocupantes: +$('vjOcupantes').value, carga: +$('vjCarga').value,
        aire: $('vjAire').checked, vuelta: $('vjVuelta').checked,
        peajes: $('vjPeajes').checked, ripio: $('vjRipio').checked,
      }));
    } catch (e) { /* sin almacenamiento: se usa igual */ }
  }

  function vehiculo() {
    return V.VEHICULOS.find(function (v) { return v.id === $('vjVehiculo').value; }) || V.VEHICULOS[1];
  }

  function combustible() { return V.COMBUSTIBLES[$('vjCombustible').value]; }

  function opcionesCalculo() {
    const veh = vehiculo();
    const r = parseFloat(String($('vjRendimiento').value).replace(',', '.'));
    const precio = parseFloat(String($('vjPrecio').value).replace(/\./g, '').replace(',', '.'));
    return {
      vehiculo: veh, combustible: combustible(),
      rendimiento: r > 1 && r < 40 ? r : veh.rendimiento,
      precio: precio > 0 ? precio : combustible().precio,
      ocupantes: +$('vjOcupantes').value || 1,
      cargaKg: +$('vjCarga').value || 0,
      aire: $('vjAire').checked,
    };
  }

  /* El combustible depende del motor: una camioneta diésel no carga 95. */
  function llenarCombustibles(elegido) {
    const motor = vehiculo().motor;
    const sel = $('vjCombustible');
    const ids = Object.keys(V.COMBUSTIBLES).filter(function (k) { return V.COMBUSTIBLES[k].motor === motor; });
    sel.innerHTML = ids.map(function (k) {
      return '<option value="' + k + '">' + V.COMBUSTIBLES[k].nombre + '</option>';
    }).join('');
    sel.value = ids.indexOf(elegido) >= 0 ? elegido : ids[0];
    mostrarPrecio();
  }

  function mostrarPrecio() {
    const k = $('vjCombustible').value;
    $('vjPrecio').value = GT.fmt(S.precios[k] || V.COMBUSTIBLES[k].precio);
  }

  function montarControles() {
    const g = leerGuardado();
    S.precios = g.precios || {};
    S.rendimientoPropio = g.rendimiento || null;

    $('vjVehiculo').innerHTML = V.VEHICULOS.map(function (v) {
      return '<option value="' + v.id + '">' + v.nombre + '</option>';
    }).join('');
    $('vjVehiculo').value = V.VEHICULOS.some(function (v) { return v.id === g.vehiculo; }) ? g.vehiculo : 'sedan';
    llenarCombustibles(g.combustible);
    $('vjRendimiento').value = GT.fmt(S.rendimientoPropio || vehiculo().rendimiento, 1);
    $('vjOcupantes').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) {
      return '<option value="' + n + '">' + n + (n === 1 ? ' persona' : ' personas') + '</option>';
    }).join('');
    $('vjOcupantes').value = g.ocupantes || 1;
    $('vjCarga').value = g.carga || 0;
    $('vjAire').checked = !!g.aire;
    $('vjVuelta').checked = g.vuelta !== false;
    $('vjPeajes').checked = !!g.peajes;
    $('vjRipio').checked = !!g.ripio;
    rotularCarga();

    $('vjVehiculo').addEventListener('change', function () {
      // Otro vehículo, otro promedio: el rendimiento propio era del anterior.
      S.rendimientoPropio = null;
      $('vjRendimiento').value = GT.fmt(vehiculo().rendimiento, 1);
      llenarCombustibles($('vjCombustible').value);
      cambio();
    });
    $('vjCombustible').addEventListener('change', function () { mostrarPrecio(); cambio(); });
    $('vjPrecio').addEventListener('change', function () {
      const v = parseFloat(String($('vjPrecio').value).replace(/\./g, '').replace(',', '.'));
      if (v > 0) S.precios[$('vjCombustible').value] = v;
      mostrarPrecio();
      cambio();
    });
    $('vjRendimiento').addEventListener('change', function () {
      const v = parseFloat(String($('vjRendimiento').value).replace(',', '.'));
      S.rendimientoPropio = v > 1 && v < 40 ? v : null;
      $('vjRendimiento').value = GT.fmt(S.rendimientoPropio || vehiculo().rendimiento, 1);
      cambio();
    });
    $('vjOcupantes').addEventListener('change', cambio);
    $('vjCarga').addEventListener('input', function () { rotularCarga(); cambio(); });
    $('vjAire').addEventListener('change', cambio);
    $('vjVuelta').addEventListener('change', cambio);
    // Estas dos cambian el camino: hay que volver a pedirlo.
    $('vjPeajes').addEventListener('change', function () { guardar(); buscarRuta(); });
    $('vjRipio').addEventListener('change', function () { guardar(); buscarRuta(); });
  }

  function rotularCarga() {
    const v = +$('vjCarga').value;
    $('vjCargaValor').textContent = v ? GT.fmt(v) + ' kg' : 'sin carga';
  }

  function cambio() { guardar(); recalcular(); }

  /* ------------------------------------------------------------------------
     Salida y llegada
     ------------------------------------------------------------------------ */

  function dentroDeAnillo(p, anillo) {
    let dentro = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const a = anillo[i], b = anillo[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) &&
          p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) dentro = !dentro;
    }
    return dentro;
  }

  function dentroDePoligono(p, anillos) {
    if (!dentroDeAnillo(p, anillos[0])) return false;
    for (let k = 1; k < anillos.length; k++) if (dentroDeAnillo(p, anillos[k])) return false;
    return true;
  }

  /* La comuna donde cae un punto; null fuera de la zona de estudio. */
  function comunaEn(p) {
    const geo = window.TERRAFOCO_COMUNAS;
    if (!geo) return '';
    for (let i = 0; i < geo.features.length; i++) {
      const g = geo.features[i].geometry;
      const poligonos = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      if (poligonos.some(function (anillos) { return dentroDePoligono(p, anillos); })) {
        return geo.features[i].properties.nombre;
      }
    }
    return null;
  }

  function avisar(texto, tipo) {
    const el = $('vjAviso');
    el.innerHTML = texto ? '<span>' + texto + '</span>' : '';
    el.className = 'notice' + (tipo === 'alerta' ? ' notice--alerta' : '');
    el.hidden = !texto;
  }

  function marca(cual) {
    const el = document.createElement('div');
    el.className = 'viaje__marca viaje__marca--' + cual;
    el.textContent = cual.toUpperCase();
    el.title = (cual === 'a' ? 'Salida' : 'Llegada') + ': arrástrala para moverla';
    const m = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' });
    m.on('dragend', function () {
      const ll = m.getLngLat();
      if (!fijarPunto(cual, [ll.lng, ll.lat])) {
        // Fuera de la zona: vuelve a donde estaba.
        m.setLngLat(S.puntos[cual].p);
      }
    });
    return m;
  }

  function fijarPunto(cual, p, sinBuscar) {
    const comuna = comunaEn(p);
    if (comuna === null) {
      avisar('Ese punto queda fuera de la zona de estudio. Marque la salida y la llegada dentro de ' +
             'las 33 comunas de la región.', 'alerta');
      return false;
    }
    avisar('');
    S.puntos[cual] = { p: [+p[0].toFixed(6), +p[1].toFixed(6)], comuna: comuna };
    if (S.mapa) {
      if (!S.marcas[cual]) S.marcas[cual] = marca(cual).setLngLat(p).addTo(S.mapa);
      else S.marcas[cual].setLngLat(p);
    }
    pintarPuntos();
    guardarEnUrl();
    if (!sinBuscar) buscarRuta();
    return true;
  }

  function pintarPuntos() {
    ['a', 'b'].forEach(function (cual) {
      const x = S.puntos[cual];
      $(cual === 'a' ? 'vjA' : 'vjB').innerHTML = x
        ? '<strong>' + esc(x.comuna || 'Punto marcado') + '</strong>' +
          '<span class="tiny muted">' + GT.fmt(x.p[1], 4) + ', ' + GT.fmt(x.p[0], 4) + '</span>'
        : '<span class="muted">' + (cual === 'a' ? 'Haga clic en el mapa para marcar la salida'
                                                 : (S.puntos.a ? 'Ahora haga clic donde quiere llegar'
                                                               : 'Después, la llegada')) + '</span>';
    });
    const ambos = S.puntos.a && S.puntos.b;
    $('vjNota').textContent = !S.puntos.a ? 'Haga clic en el mapa para marcar la salida'
      : !ambos ? 'Haga clic donde quiere llegar'
      : 'Clic en el mapa para cambiar la llegada · arrastre A o B para moverlas';
    $('vjIntercambiar').disabled = !ambos;
    $('vjBorrar').disabled = !S.puntos.a && !S.puntos.b;
  }

  /* El viaje queda en la dirección: se puede compartir o guardar. */
  function guardarEnUrl() {
    try {
      const u = new URL(window.location.href);
      ['a', 'b'].forEach(function (cual) {
        const x = S.puntos[cual], k = cual === 'a' ? 'desde' : 'hasta';
        if (x) u.searchParams.set(k, x.p[1].toFixed(5) + ',' + x.p[0].toFixed(5));
        else u.searchParams.delete(k);
      });
      window.history.replaceState(window.history.state, '', u.toString());
    } catch (e) { /* sin URL: el viaje no se comparte, pero funciona */ }
  }

  function leerDeUrl() {
    const out = {};
    try {
      const q = new URLSearchParams(window.location.search);
      [['a', 'desde'], ['b', 'hasta']].forEach(function (par) {
        const t = (q.get(par[1]) || '').split(',').map(Number);
        if (t.length === 2 && t.every(isFinite) && Math.abs(t[0]) <= 90 && Math.abs(t[1]) <= 180) {
          out[par[0]] = [t[1], t[0]];
        }
      });
    } catch (e) { /* nada que leer */ }
    return out;
  }

  function borrar() {
    detener();
    ['a', 'b'].forEach(function (c) {
      S.puntos[c] = null;
      if (S.marcas[c]) { S.marcas[c].remove(); S.marcas[c] = null; }
    });
    S.rutas = [];
    S.pedido++;
    pintarPuntos(); guardarEnUrl(); pintarTodo();
    avisar('');
  }

  function intercambiar() {
    if (!S.puntos.a || !S.puntos.b) return;
    const a = S.puntos.a.p, b = S.puntos.b.p;
    fijarPunto('a', b, true);
    fijarPunto('b', a);
  }

  /* ------------------------------------------------------------------------
     El camino
     ------------------------------------------------------------------------ */

  function errorDeRuta(texto) { const e = new Error(texto); e.sinRuta = true; return e; }

  function pedirJson(url, opciones, plazo) {
    return fetch(url, Object.assign({ signal: AbortSignal.timeout(plazo || 20000) }, opciones))
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, estado: r.status, d: d }; }); });
  }

  function valhalla(a, b, op) {
    const auto = {};
    if (op.evitarPeajes) auto.use_tolls = 0;
    if (op.evitarRipio) auto.exclude_unpaved = true;
    const consulta = {
      locations: [{ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] }],
      costing: 'auto', costing_options: { auto: auto },
      elevation_interval: V.PASO, alternates: 2, units: 'kilometers', directions_type: 'none',
    };
    return pedirJson(VALHALLA + '/route?json=' + encodeURIComponent(JSON.stringify(consulta)))
      .then(function (r) {
        if (!r.ok || r.d.error) {
          const codigo = r.d && r.d.error_code;
          /* Solo por pavimento a veces no se llega: el predio está en un
             camino de ripio. Se repite sin la restricción y se avisa. */
          if (op.evitarRipio && codigo === 442) {
            return valhalla(a, b, Object.assign({}, op, { evitarRipio: false })).then(function (rs) {
              rs.forEach(function (x) { x.avisos.push('No hay ruta solo por pavimento hasta ese punto: el camino incluye ripio o tierra.'); });
              return rs;
            });
          }
          if (codigo === 170 || codigo === 171) {
            throw errorDeRuta('No hay un camino cerca de uno de los puntos. Acérquelo a una calle o camino visible en el mapa.');
          }
          if (codigo === 442 || codigo === 443) {
            throw errorDeRuta('No se encontró un camino entre esos dos puntos.');
          }
          throw new Error('Valhalla respondió ' + r.estado);
        }
        const viajes = [r.d.trip].concat((r.d.alternates || []).map(function (x) { return x.trip; }));
        return Promise.all(viajes.map(function (viaje, i) {
          return atributos(viaje).then(function (rastro) {
            const tramo = viaje.legs[0];
            const avisos = [];
            if (!rastro) avisos.push('No llegó el tipo de cada tramo: se supuso camino pavimentado.');
            const conAltura = tramo.elevation && tramo.elevation.length > 1
              ? Promise.resolve(tramo.elevation)
              : alturasTerrarium(V.decodificar(tramo.shape, 6));
            return conAltura.then(function (alt) {
              tramo.elevation = alt;
              if (!alt) avisos.push('Sin altura del camino: el cálculo supone terreno plano.');
              return { perfil: V.perfilDesdeValhalla({ trip: viaje }, rastro), fuente: 'valhalla', avisos: avisos };
            });
          }).catch(function (e) {
            if (i === 0) throw e;
            return null;   // una alternativa que falla se omite
          });
        })).then(function (rs) { return rs.filter(Boolean); });
      });
  }

  /* Clase, superficie, velocidad y densidad de cada arco de la ruta. */
  function atributos(viaje) {
    const consulta = {
      encoded_polyline: viaje.legs[0].shape, costing: 'auto', shape_match: 'edge_walk',
      filters: { action: 'include', attributes: [
        'edge.road_class', 'edge.surface', 'edge.unpaved', 'edge.speed', 'edge.density',
        'edge.end_shape_index', 'edge.names', 'edge.toll'] },
    };
    return pedirJson(VALHALLA + '/trace_attributes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(consulta),
    }).then(function (r) { return r.ok && r.d.edges ? r.d : null; })
      .catch(function () { return null; });
  }

  function osrm(a, b) {
    const url = OSRM + a[0] + ',' + a[1] + ';' + b[0] + ',' + b[1] +
                '?overview=full&geometries=geojson&annotations=speed';
    return pedirJson(url, {}, 15000).then(function (r) {
      if (!r.ok || r.d.code !== 'Ok') {
        if (r.d && r.d.code === 'NoRoute') throw errorDeRuta('No se encontró un camino entre esos dos puntos.');
        throw new Error('OSRM respondió ' + r.estado);
      }
      return alturasTerrarium(r.d.routes[0].geometry.coordinates).then(function (alt) {
        const avisos = ['La ruta salió del servicio de respaldo (OSRM): no informa la superficie, ' +
                        'así que se supuso todo pavimentado y el tipo de camino se dedujo de la velocidad.'];
        if (!alt) avisos.push('Sin altura del camino: el cálculo supone terreno plano.');
        return [{ perfil: V.perfilDesdeOsrm(r.d, alt), fuente: 'osrm', avisos: avisos }];
      });
    });
  }

  /* Altura cada 30 m leída de las teselas Terrarium (zoom 12, ~30 m por
     píxel en esta latitud). Resuelve con null si falta alguna tesela. */
  const teselas = {};
  function tesela(x, y) {
    const k = x + '/' + y;
    if (!teselas[k]) {
      teselas[k] = new Promise(function (ok) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
          try {
            const c = document.createElement('canvas');
            c.width = c.height = 256;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            ok(ctx.getImageData(0, 0, 256, 256).data);
          } catch (e) { ok(null); }
        };
        img.onerror = function () { ok(null); };
        img.src = TERRARIUM + '12/' + x + '/' + y + '.png';
      });
    }
    return teselas[k];
  }

  function alturasTerrarium(coords) {
    const cum = V.acumulada(coords);
    const largo = cum[cum.length - 1];
    const n = Math.max(2, Math.ceil(largo / V.PASO) + 1);
    const z = Math.pow(2, 12);
    const muestras = [];
    for (let i = 0; i < n; i++) {
      const p = V.puntoEn(coords, cum, largo * i / (n - 1)).p;
      const lat = p[1] * Math.PI / 180;
      const x = (p[0] + 180) / 360 * z;
      const y = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * z;
      muestras.push({ tx: Math.floor(x), ty: Math.floor(y),
                      px: Math.min(255, Math.floor((x % 1) * 256)), py: Math.min(255, Math.floor((y % 1) * 256)) });
    }
    return Promise.all(muestras.map(function (m) { return tesela(m.tx, m.ty); }))
      .then(function (datos) {
        if (datos.some(function (d) { return !d; })) return null;
        return muestras.map(function (m, i) {
          const o = (m.py * 256 + m.px) * 4, d = datos[i];
          return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
        });
      })
      .catch(function () { return null; });
  }

  function buscarRuta() {
    if (!S.puntos.a || !S.puntos.b) { S.rutas = []; pintarTodo(); return; }
    detener();
    const pedido = ++S.pedido;
    const a = S.puntos.a.p, b = S.puntos.b.p;
    const op = { evitarPeajes: $('vjPeajes').checked, evitarRipio: $('vjRipio').checked };
    $('vjNota').textContent = 'Buscando el camino…';
    $('mapa').classList.add('viaje--buscando');

    valhalla(a, b, op)
      .catch(function (e) {
        if (e.sinRuta) throw e;
        console.warn('[viajes] Valhalla no respondió, se usa OSRM:', e.message);
        return osrm(a, b);
      })
      .catch(function (e) {
        if (e.sinRuta) throw e;
        console.warn('[viajes] sin servicio de rutas, se usa la recta:', e.message);
        return [{ perfil: V.perfilRecto(a, b), fuente: 'recta',
                  avisos: ['Sin conexión con los servicios de rutas: es una aproximación en línea recta ' +
                           'alargada un 35 %, a 60 km/h y sin pendientes. Tómela solo como orden de magnitud.'] }];
      })
      .then(function (rutas) {
        if (pedido !== S.pedido) return;
        S.rutas = rutas;
        S.elegida = 0;
        avisar('');
        recalcular(true);
      })
      .catch(function (e) {
        if (pedido !== S.pedido) return;
        S.rutas = [];
        pintarTodo();
        avisar(e.message, 'alerta');
      })
      .then(function () {
        if (pedido !== S.pedido) return;
        $('mapa').classList.remove('viaje--buscando');
        pintarPuntos();
      });
  }

  /* ------------------------------------------------------------------------
     Cálculo y panel
     ------------------------------------------------------------------------ */

  function recalcular(encuadrar) {
    if (!S.rutas.length) { pintarTodo(); return; }
    const o = opcionesCalculo();
    const vuelta = $('vjVuelta').checked;
    S.rutas.forEach(function (r) {
      r.ida = V.calcular(r.perfil, o);
      r.vuelta = vuelta ? V.calcular(V.invertir(r.perfil), o) : null;
    });
    if (S.anim) detener();
    pintarTodo();
    if (encuadrar) encuadrarRuta();
  }

  function total(r) {
    const x = { litros: r.ida.litros, costo: r.ida.costo, km: r.ida.km, segundos: r.ida.segundos, co2: r.ida.co2 };
    if (r.vuelta) ['litros', 'costo', 'km', 'segundos', 'co2'].forEach(function (k) { x[k] += r.vuelta[k]; });
    return x;
  }

  function duracion(s) {
    const m = Math.round(s / 60);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
  }

  function pintarTodo() {
    const hay = S.rutas.length > 0;
    $('vjResultado').hidden = !hay;
    $('vjDetalle').hidden = !hay;
    $('vjPerfilCaja').hidden = !hay;
    $('vjPlay').disabled = !hay;
    $('vjLeyenda').hidden = !hay;
    pintarRutasMapa();
    if (!hay) return;
    pintarResultado();
    pintarDesglose();
    pintarTipos();
    pintarAlternativas();
    pintarNotas();
    pintarPerfil();
    pintarLeyenda();
  }

  function pintarResultado() {
    const r = S.rutas[S.elegida], t = total(r), o = opcionesCalculo();
    const vuelta = !!r.vuelta;
    $('vjLitros').textContent = GT.fmt(t.litros, 1);
    $('vjCosto').textContent = pesos(t.costo);
    $('vjTramo').textContent = vuelta ? 'ida y vuelta' : 'solo ida';
    $('vjCifras').innerHTML = [
      [GT.fmt(t.km, 1) + ' km', 'distancia' + (vuelta ? ' total' : '')],
      [duracion(t.segundos), 'manejando'],
      [GT.fmt(t.km / t.litros, 1) + ' km/L', 'rendimiento en esta ruta'],
      [GT.fmt(t.co2, 1) + ' kg', 'CO₂ emitido'],
      [GT.fmt(100 * t.litros / o.vehiculo.estanque, 0) + ' %', 'de un estanque de ' + o.vehiculo.estanque + ' L'],
      ['↑' + GT.fmt(r.ida.subida, 0) + ' · ↓' + GT.fmt(r.ida.bajada, 0) + ' m', 'desnivel de la ida'],
    ].map(function (c) {
      return '<div class="cifra"><span class="cifra__valor">' + c[0] + '</span>' +
             '<span class="cifra__rotulo">' + c[1] + '</span></div>';
    }).join('');
    $('vjIdaVuelta').innerHTML = vuelta
      ? 'Ida <strong>' + GT.fmt(r.ida.litros, 1) + ' L</strong> · vuelta <strong>' + GT.fmt(r.vuelta.litros, 1) +
        ' L</strong>' + (Math.abs(r.ida.litros - r.vuelta.litros) / r.ida.litros > 0.08
          ? ': ' + (r.vuelta.litros > r.ida.litros ? 'la vuelta gasta más porque sube ' + GT.fmt(r.ida.bajada, 0)
                                                     : 'la ida gasta más porque sube ' + GT.fmt(r.ida.subida, 0)) + ' m'
          : '') + '.'
      : 'Solo la ida. Marque "ida y vuelta" para sumar el regreso por el mismo camino.';
  }

  const CAUSAS = [
    ['rodadura', 'Rodar', 'la resistencia de los neumáticos; sube en ripio y tierra'],
    ['aire', 'Empujar el aire', 'crece con el cuadrado de la velocidad'],
    ['motor', 'Motor encendido', 'pérdidas internas y accesorios mientras anda'],
    ['detenciones', 'Detenerse y arrancar', 'cruces, semáforos y curvas; más en la ciudad'],
    ['pendiente', 'Subidas y bajadas', 'lo que cuesta subir menos lo que ahorran las bajadas'],
  ];

  function coloresCausas() {
    return { rodadura: PALETA.serie1, aire: PALETA.turquesa, motor: PALETA.gris,
             detenciones: PALETA.ambar, pendiente: PALETA.naranja };
  }

  function pintarDesglose() {
    const r = S.rutas[S.elegida];
    const d = {};
    Object.keys(r.ida.desglose).forEach(function (k) {
      d[k] = r.ida.desglose[k] + (r.vuelta ? r.vuelta.desglose[k] : 0);
    });
    const col = coloresCausas();
    const positivo = CAUSAS.reduce(function (s, c) { return s + Math.max(0, d[c[0]]); }, 0);
    const litros = CAUSAS.reduce(function (s, c) { return s + d[c[0]]; }, 0);
    $('vjBarra').innerHTML = CAUSAS.filter(function (c) { return d[c[0]] > 0; }).map(function (c) {
      return '<span style="flex:' + d[c[0]].toFixed(4) + ';background:' + col[c[0]] + '" title="' +
             c[1] + ': ' + GT.fmt(d[c[0]], 2) + ' L"></span>';
    }).join('');
    $('vjCausas').innerHTML = CAUSAS.map(function (c) {
      const v = d[c[0]];
      const pct = Math.round(100 * v / litros);
      return '<div class="viaje__causa">' +
               '<i style="background:' + col[c[0]] + (v < 0 ? ';opacity:.35' : '') + '"></i>' +
               '<span><strong>' + c[1] + '</strong><span class="tiny muted">' + c[2] + '</span></span>' +
               '<span class="viaje__causa-valor">' + (v < 0 ? '−' : '') + GT.fmt(Math.abs(v), 2) + ' L' +
                 '<span class="tiny muted">' + (v < 0 ? 'ahorro' : pct + ' %') + '</span></span>' +
             '</div>';
    }).join('');
    $('vjBarra').title = positivo > litros ? 'Las bajadas descuentan ' + GT.fmt(positivo - litros, 2) + ' L' : '';
  }

  function coloresTipo() {
    return { autopista: PALETA.azul, ruta: PALETA.turquesa, local: PALETA.verde,
             urbano: PALETA.ambar, ripio: PALETA.rojo };
  }

  function pintarTipos() {
    const r = S.rutas[S.elegida], col = coloresTipo();
    const km = r.ida.km;
    $('vjTipos').innerHTML = Object.keys(V.TIPOS).filter(function (t) { return r.ida.porTipo[t].m > 0; })
      .map(function (t) {
        const x = r.ida.porTipo[t];
        const k = x.m / 1000;
        return '<div class="viaje__tipo">' +
                 '<span class="viaje__tipo-nombre"><i style="background:' + col[t] + '"></i>' + V.TIPOS[t] + '</span>' +
                 '<span class="viaje__tipo-barra"><span style="width:' + (100 * k / km).toFixed(1) + '%;background:' + col[t] + '"></span></span>' +
                 '<span class="viaje__tipo-cifra">' + GT.fmt(k, 1) + ' km</span>' +
                 '<span class="viaje__tipo-cifra">' + (k > 0.3 ? GT.fmt(k / x.litros, 1) + ' km/L' : '—') + '</span>' +
               '</div>';
      }).join('');
  }

  function pintarAlternativas() {
    const caja = $('vjAlternativas');
    if (S.rutas.length < 2) { caja.hidden = true; return; }
    caja.hidden = false;
    const tots = S.rutas.map(total);
    const barata = tots.reduce(function (m, t, i) { return t.litros < tots[m].litros ? i : m; }, 0);
    const rapida = tots.reduce(function (m, t, i) { return t.segundos < tots[m].segundos ? i : m; }, 0);
    $('vjAltLista').innerHTML = S.rutas.map(function (r, i) {
      const t = tots[i];
      const sellos = (i === barata ? '<em class="viaje__sello">gasta menos</em>' : '') +
                     (i === rapida ? '<em class="viaje__sello">más rápida</em>' : '');
      return '<button type="button" class="viaje__alt' + (i === S.elegida ? ' is-active' : '') + '" data-i="' + i + '">' +
               '<span class="viaje__alt-nombre">Ruta ' + (i + 1) + sellos + '</span>' +
               '<span>' + GT.fmt(t.km, 1) + ' km · ' + duracion(t.segundos) + '</span>' +
               '<strong>' + GT.fmt(t.litros, 1) + ' L · ' + pesos(t.costo) + '</strong>' +
             '</button>';
    }).join('');
    $('vjAltNota').textContent = barata !== rapida
      ? 'La ruta más rápida no es la que menos gasta: la diferencia es de ' +
        GT.fmt(tots[rapida].litros - tots[barata].litros, 1) + ' L (' +
        pesos(tots[rapida].costo - tots[barata].costo) + ').'
      : 'La ruta más rápida es también la que menos gasta.';
  }

  function elegir(i) {
    if (i === S.elegida || !S.rutas[i]) return;
    detener();
    S.elegida = i;
    pintarTodo();
  }

  function pintarNotas() {
    const r = S.rutas[S.elegida];
    const notas = r.avisos.slice();
    if (r.ida.peajeKm > 0.05 && !$('vjPeajes').checked) {
      notas.push('La ruta pasa por tramos con peaje; su costo no está sumado.');
    }
    const fuente = { valhalla: 'Valhalla (FOSSGIS) sobre OpenStreetMap',
                     osrm: 'OSRM (FOSSGIS) sobre OpenStreetMap, alturas de AWS Terrain Tiles',
                     recta: 'línea recta, sin servicio de rutas' }[r.fuente];
    $('vjNotas').innerHTML = notas.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') +
      '<li>Camino: ' + fuente + '. Ajuste del modelo al rendimiento elegido: ×' +
      GT.fmt(r.ida.calibracion, 2) + '.</li>' +
      (r.vuelta ? '<li>La vuelta se calcula por el mismo camino, en sentido contrario.</li>' : '');
  }

  /* ------------------------------------------------------------------------
     Colores de la ruta
     ------------------------------------------------------------------------ */

  function colorPieza(p, a, modo, rendimiento) {
    if (modo === 'tipo') return coloresTipo()[p.tipo];
    if (modo === 'pendiente') {
      const ag = PALETA.rampas.agua, ca = PALETA.rampas.calor;
      return p.s < -0.06 ? ag[4] : p.s < -0.02 ? ag[2] : p.s <= 0.02 ? PALETA.gris
           : p.s <= 0.06 ? ca[2] : ca[4];
    }
    // Consumo del tramo frente al promedio del vehículo.
    const x = a.intensidad / (100 / rendimiento);
    const r = PALETA.rampas.calor;
    return x < 0.7 ? r[0] : x < 0.9 ? r[1] : x < 1.15 ? r[2] : x < 1.5 ? r[3] : r[4];
  }

  function leyendaDe(modo) {
    if (modo === 'tipo') {
      const c = coloresTipo();
      return Object.keys(V.TIPOS).map(function (t) { return [c[t], V.TIPOS[t]]; });
    }
    if (modo === 'pendiente') {
      const ag = PALETA.rampas.agua, ca = PALETA.rampas.calor;
      return [[ca[4], 'Subida fuerte (más de 6 %)'], [ca[2], 'Subida (2 a 6 %)'], [PALETA.gris, 'Plano'],
              [ag[2], 'Bajada (2 a 6 %)'], [ag[4], 'Bajada fuerte (más de 6 %)']];
    }
    const r = PALETA.rampas.calor;
    return [[r[4], 'Mucho más que su promedio'], [r[3], 'Más que su promedio'], [r[2], 'Cerca de su promedio'],
            [r[1], 'Menos que su promedio'], [r[0], 'Mucho menos']];
  }

  function pintarLeyenda() {
    $('vjLeyenda').innerHTML = '<div class="legend">' + leyendaDe(S.modo).map(function (f) {
      return '<div class="legend__row"><span class="legend__swatch" style="background:' + f[0] + '"></span>' +
             '<span>' + f[1] + '</span></div>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------------
     Mapa
     ------------------------------------------------------------------------ */

  const VACIO = { type: 'FeatureCollection', features: [] };

  /* Coordenadas del recorrido entre dos distancias, con los vértices de en
     medio: así la línea sigue las curvas. */
  function tramoEntre(perfil, d0, d1) {
    const esc = perfil.largo / perfil.piezas[perfil.piezas.length - 1].hasta;
    const x0 = d0 * esc, x1 = d1 * esc;
    const a = V.puntoEn(perfil.coords, perfil.cum, x0), b = V.puntoEn(perfil.coords, perfil.cum, x1);
    const out = [a.p];
    for (let i = a.i + 1; i <= b.i; i++) out.push(perfil.coords[i]);
    out.push(b.p);
    return out;
  }

  function featuresRuta(r) {
    const o = opcionesCalculo();
    const piezas = r.perfil.piezas;
    const feats = [];
    let ini = 0, color = colorPieza(piezas[0], r.ida.acum[0], S.modo, o.rendimiento);
    for (let i = 1; i <= piezas.length; i++) {
      const c = i < piezas.length ? colorPieza(piezas[i], r.ida.acum[i], S.modo, o.rendimiento) : null;
      if (c !== color) {
        feats.push({ type: 'Feature', properties: { c: color },
                     geometry: { type: 'LineString', coordinates: tramoEntre(r.perfil, piezas[ini].desde, piezas[i - 1].hasta) } });
        ini = i; color = c;
      }
    }
    return { type: 'FeatureCollection', features: feats };
  }

  /* El autito, visto desde arriba y mirando al norte: MapLibre lo gira con
     el rumbo. Lleva los focos encendidos hacia adelante; el lienzo es
     simétrico para que el centro del auto sea el centro de la imagen. */
  function dibujarAutito() {
    const R = 2, W = 40, H = 132, C = 30;   // C: margen arriba (focos) y abajo
    const lienzo = document.createElement('canvas');
    lienzo.width = W * R; lienzo.height = H * R;
    const x = lienzo.getContext('2d');
    x.scale(R, R);
    const caja = function (px, py, w, h, r) {
      x.beginPath();
      x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
      x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
    };
    // Haz de los focos.
    const haz = x.createLinearGradient(0, C, 0, 0);
    haz.addColorStop(0, 'rgba(255, 236, 170, .55)');
    haz.addColorStop(1, 'rgba(255, 236, 170, 0)');
    x.fillStyle = haz;
    x.beginPath(); x.moveTo(8, C + 2); x.lineTo(32, C + 2); x.lineTo(40, 0); x.lineTo(0, 0); x.closePath(); x.fill();
    // Sombra y carrocería.
    x.save();
    x.shadowColor = 'rgba(0, 0, 0, .45)'; x.shadowBlur = 5; x.shadowOffsetY = 2;
    x.fillStyle = PALETA.rojo;
    caja(5, C, 30, 72, 11); x.fill();
    x.restore();
    x.lineWidth = 1.2; x.strokeStyle = 'rgba(255, 255, 255, .85)';
    caja(5, C, 30, 72, 11); x.stroke();
    // Parabrisas, techo y luneta.
    x.fillStyle = 'rgba(12, 18, 28, .85)';
    caja(9, C + 17, 22, 13, 4); x.fill();
    caja(10, C + 52, 20, 9, 3); x.fill();
    x.fillStyle = 'rgba(255, 255, 255, .16)';
    caja(10, C + 31, 20, 20, 3); x.fill();
    // Espejos.
    x.fillStyle = PALETA.rojo;
    caja(2, C + 22, 4, 5, 1.5); x.fill(); caja(34, C + 22, 4, 5, 1.5); x.fill();
    // Focos y luces traseras.
    x.fillStyle = '#FFF4C4';
    caja(8, C + 1, 7, 4, 2); x.fill(); caja(25, C + 1, 7, 4, 2); x.fill();
    x.fillStyle = '#B3001B';
    caja(8, C + 67, 7, 3.5, 1.5); x.fill(); caja(25, C + 67, 7, 3.5, 1.5); x.fill();
    return { imagen: x.getImageData(0, 0, W * R, H * R), proporcion: R };
  }

  function prepararMapa(api) {
    S.api = api;
    const m = S.mapa = api.instancia;
    /* Las comunas son la zona de interés: se ven sus límites y un velo
       parejo, sin dato encima que distraiga de la ruta. */
    m.setPaintProperty('comunas-relleno', 'fill-color', PALETA.tinta);
    api.cambiarOpacidad(0.05);

    const simbolo = (m.getStyle().layers || []).find(function (l) { return l.type === 'symbol'; });
    const antes = simbolo ? simbolo.id : undefined;
    m.addSource('vj-alt', { type: 'geojson', data: VACIO });
    m.addSource('vj-ruta', { type: 'geojson', data: VACIO });
    m.addSource('vj-hecho', { type: 'geojson', data: VACIO });
    m.addSource('vj-cursor', { type: 'geojson', data: VACIO });
    m.addSource('vj-auto', { type: 'geojson', data: VACIO });
    m.addLayer({ id: 'vj-alt', type: 'line', source: 'vj-alt',
                 layout: { 'line-cap': 'round', 'line-join': 'round' },
                 paint: { 'line-color': PALETA.gris, 'line-width': 4, 'line-opacity': 0.7,
                          'line-dasharray': [1.2, 1.4] } }, antes);
    m.addLayer({ id: 'vj-ruta-casco', type: 'line', source: 'vj-ruta',
                 layout: { 'line-cap': 'round', 'line-join': 'round' },
                 paint: { 'line-color': PALETA.mapa.casco, 'line-width': 8.5 } }, antes);
    m.addLayer({ id: 'vj-ruta', type: 'line', source: 'vj-ruta',
                 layout: { 'line-cap': 'round', 'line-join': 'round' },
                 paint: { 'line-color': ['get', 'c'], 'line-width': 5 } }, antes);
    m.addLayer({ id: 'vj-hecho', type: 'line', source: 'vj-hecho',
                 layout: { 'line-cap': 'round', 'line-join': 'round' },
                 paint: { 'line-color': PALETA.mapa.seleccion, 'line-width': 2.2, 'line-opacity': 0.95 } });
    m.addLayer({ id: 'vj-cursor', type: 'circle', source: 'vj-cursor',
                 paint: { 'circle-radius': 6, 'circle-color': PALETA.mapa.seleccion,
                          'circle-stroke-color': PALETA.mapa.casco, 'circle-stroke-width': 3 } });
    const auto = dibujarAutito();
    m.addImage('vj-autito', auto.imagen, { pixelRatio: auto.proporcion });
    m.addLayer({ id: 'vj-auto', type: 'symbol', source: 'vj-auto', layout: {
      'icon-image': 'vj-autito', 'icon-rotate': ['get', 'rumbo'],
      'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.42, 12, 0.62, 16, 0.95],
    } });

    m.on('click', function (e) {
      const alt = m.queryRenderedFeatures(e.point, { layers: ['vj-alt'] });
      if (alt.length) { elegir(alt[0].properties.i); return; }
      if (S.anim && S.anim.corriendo) return;
      fijarPunto(!S.puntos.a ? 'a' : 'b', [e.lngLat.lng, e.lngLat.lat]);
    });
    m.on('mouseenter', 'vj-alt', function () { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'vj-alt', function () { m.getCanvas().style.cursor = ''; });
    m.getCanvas().style.cursor = 'crosshair';
  }

  function pintarRutasMapa() {
    const m = S.mapa;
    if (!m || !m.getSource('vj-ruta')) return;
    if (!S.rutas.length) {
      ['vj-alt', 'vj-ruta', 'vj-hecho', 'vj-auto', 'vj-cursor'].forEach(function (id) { m.getSource(id).setData(VACIO); });
      return;
    }
    m.getSource('vj-alt').setData({ type: 'FeatureCollection', features: S.rutas.map(function (r, i) {
      return i === S.elegida ? null : { type: 'Feature', properties: { i: i },
                                        geometry: { type: 'LineString', coordinates: r.perfil.coords } };
    }).filter(Boolean) });
    m.getSource('vj-ruta').setData(featuresRuta(S.rutas[S.elegida]));
    if (!S.anim) {
      m.getSource('vj-hecho').setData(VACIO);
      const r = S.rutas[S.elegida];
      ponerAuto(r.perfil.coords[0], V.rumbo(r.perfil.coords[0], r.perfil.coords[Math.min(3, r.perfil.coords.length - 1)]));
    }
  }

  function ponerAuto(p, rumbo) {
    S.mapa.getSource('vj-auto').setData({ type: 'Feature', properties: { rumbo: rumbo },
                                          geometry: { type: 'Point', coordinates: p } });
  }

  function encuadrarRuta() {
    const m = S.mapa;
    if (!m || !S.rutas.length) return;
    const b = new maplibregl.LngLatBounds();
    S.rutas.forEach(function (r) { r.perfil.coords.forEach(function (c) { b.extend(c); }); });
    m.fitBounds(b, { padding: { top: 70, bottom: 60, left: 60, right: 60 }, maxZoom: 13.5, duration: 700,
                     pitch: 0, bearing: 0 });
  }

  /* ------------------------------------------------------------------------
     Perfil de alturas
     ------------------------------------------------------------------------ */

  const ALTO = 150, IZQ = 46, DER = 12, ARR = 12, ABA = 22;

  function escalasPerfil() {
    const r = S.rutas[S.elegida], piezas = r.perfil.piezas;
    const ancho = Math.max(280, $('vjPerfil').clientWidth);
    let min = Infinity, max = -Infinity;
    piezas.forEach(function (p) { min = Math.min(min, p.h); max = Math.max(max, p.h); });
    if (max - min < 60) { const c = (max + min) / 2; min = c - 30; max = c + 30; }
    const pad = (max - min) * 0.12;
    min -= pad; max += pad;
    const largo = piezas[piezas.length - 1].hasta;
    return {
      ancho: ancho, min: min, max: max, largo: largo,
      x: function (d) { return IZQ + (ancho - IZQ - DER) * d / largo; },
      y: function (h) { return ARR + (ALTO - ARR - ABA) * (1 - (h - min) / (max - min)); },
      d: function (px) { return Math.max(0, Math.min(largo, (px - IZQ) / (ancho - IZQ - DER) * largo)); },
    };
  }

  function pintarPerfil() {
    const caja = $('vjPerfil');
    const r = S.rutas[S.elegida], piezas = r.perfil.piezas, o = opcionesCalculo();
    const e = escalasPerfil();
    // Una muestra cada pocos tramos alcanza para dibujar; más es peso muerto.
    const paso = Math.max(1, Math.floor(piezas.length / 700));
    let area = 'M' + e.x(0) + ',' + e.y(piezas[0].h);
    const lineas = [];
    let actual = null;
    for (let i = 0; i < piezas.length; i += paso) {
      const p = piezas[i];
      const px = e.x(p.hasta).toFixed(1), py = e.y(p.h).toFixed(1);
      area += 'L' + px + ',' + py;
      const c = colorPieza(p, r.ida.acum[i], S.modo, o.rendimiento);
      if (!actual || actual.c !== c) {
        const previo = actual ? actual.puntos[actual.puntos.length - 1] : e.x(0).toFixed(1) + ',' + e.y(p.h).toFixed(1);
        actual = { c: c, puntos: [previo] };
        lineas.push(actual);
      }
      actual.puntos.push(px + ',' + py);
    }
    area += 'L' + e.x(e.largo) + ',' + e.y(e.min) + 'L' + e.x(0) + ',' + e.y(e.min) + 'Z';

    const km = e.largo / 1000;
    const marcas = [0, 0.25, 0.5, 0.75, 1].map(function (f) {
      return '<text x="' + e.x(f * e.largo).toFixed(1) + '" y="' + (ALTO - 6) + '" text-anchor="' +
             (f === 0 ? 'start' : f === 1 ? 'end' : 'middle') + '">' + GT.fmt(f * km, km < 10 ? 1 : 0) + ' km</text>';
    }).join('');
    const ejeY = [e.min + (e.max - e.min) * 0.1, e.max - (e.max - e.min) * 0.1].map(function (h) {
      return '<text x="' + (IZQ - 6) + '" y="' + (e.y(h) + 3).toFixed(1) + '" text-anchor="end">' +
             GT.fmt(h, 0) + ' m</text>' +
             '<line x1="' + IZQ + '" x2="' + (e.ancho - DER) + '" y1="' + e.y(h).toFixed(1) + '" y2="' + e.y(h).toFixed(1) +
             '" class="viaje__rejilla"/>';
    }).join('');

    caja.innerHTML =
      '<svg width="' + e.ancho + '" height="' + ALTO + '" viewBox="0 0 ' + e.ancho + ' ' + ALTO + '" role="img" ' +
           'aria-label="Perfil de alturas de la ruta: de ' + GT.fmt(piezas[0].h, 0) + ' a ' +
           GT.fmt(piezas[piezas.length - 1].h, 0) + ' metros">' +
        ejeY +
        '<path d="' + area + '" class="viaje__area"/>' +
        lineas.map(function (l) {
          return '<polyline points="' + l.puntos.join(' ') + '" fill="none" stroke="' + l.c +
                 '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
        }).join('') +
        '<g class="viaje__ejes">' + marcas + '</g>' +
        '<g id="vjPerfilAuto" class="viaje__perfil-auto" style="display:none">' +
          '<line y1="' + ARR + '" y2="' + (ALTO - ABA) + '"/><circle r="5"/></g>' +
        '<g id="vjPerfilGuia" class="viaje__perfil-guia" style="display:none">' +
          '<line y1="' + ARR + '" y2="' + (ALTO - ABA) + '"/><circle r="4"/></g>' +
        '<rect x="' + IZQ + '" y="0" width="' + (e.ancho - IZQ - DER) + '" height="' + ALTO +
          '" fill="transparent" id="vjPerfilZona"/>' +
      '</svg>' +
      '<div class="viaje__punta" id="vjPunta" hidden></div>';
    S.escalas = e;
    if (S.anim) moverMarcaPerfil(S.anim.ultimoEstado);

    const zona = $('vjPerfilZona');
    zona.addEventListener('mousemove', function (ev) {
      const rect = caja.querySelector('svg').getBoundingClientRect();
      mostrarEnPerfil(e.d(ev.clientX - rect.left));
    });
    zona.addEventListener('mouseleave', ocultarGuia);
  }

  function piezaEn(d) {
    const piezas = S.rutas[S.elegida].perfil.piezas;
    let lo = 0, hi = piezas.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (piezas[m].hasta < d) lo = m + 1; else hi = m; }
    return lo;
  }

  function mostrarEnPerfil(d) {
    const r = S.rutas[S.elegida], e = S.escalas;
    const i = piezaEn(d), p = r.perfil.piezas[i];
    const g = $('vjPerfilGuia');
    g.style.display = '';
    g.setAttribute('transform', 'translate(' + e.x(d).toFixed(1) + ',0)');
    g.querySelector('circle').setAttribute('cy', e.y(p.h).toFixed(1));
    const punta = $('vjPunta');
    punta.hidden = false;
    punta.innerHTML = '<strong>km ' + GT.fmt(d / 1000, 1) + '</strong> · ' + GT.fmt(p.h, 0) + ' m · ' +
      (p.s >= 0 ? '+' : '−') + GT.fmt(Math.abs(p.s * 100), 1) + ' %<br>' +
      V.TIPOS[p.tipo] + (p.nombre ? ' · ' + esc(p.nombre) : '') + '<br>' +
      GT.fmt(r.ida.acum[i].intensidad, 1) + ' L/100 km en este tramo';
    const x = e.x(d);
    punta.style.left = Math.min(e.ancho - 200, Math.max(0, x - 100)) + 'px';
    if (!S.mapa) return;
    const pos = V.puntoEn(r.perfil.coords, r.perfil.cum, d * r.perfil.largo / e.largo).p;
    S.mapa.getSource('vj-cursor').setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pos } });
  }

  function ocultarGuia() {
    $('vjPerfilGuia').style.display = 'none';
    $('vjPunta').hidden = true;
    if (S.mapa) S.mapa.getSource('vj-cursor').setData(VACIO);
  }

  function moverMarcaPerfil(est) {
    const g = $('vjPerfilAuto');
    if (!g || !est || !S.escalas) return;
    g.style.display = '';
    g.setAttribute('transform', 'translate(' + S.escalas.x(est.d).toFixed(1) + ',0)');
    g.querySelector('circle').setAttribute('cy', S.escalas.y(est.pieza.h).toFixed(1));
  }

  /* ------------------------------------------------------------------------
     El autito
     ------------------------------------------------------------------------ */

  /* Estado del viaje a los `t` segundos reales: dónde va, qué tramo pisa y
     cuánto lleva gastado. */
  function estadoEn(r, t) {
    const acum = r.ida.acum, piezas = r.perfil.piezas;
    let lo = 0, hi = acum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (acum[m].t < t) lo = m + 1; else hi = m; }
    const t0 = lo ? acum[lo - 1].t : 0, l0 = lo ? acum[lo - 1].l : 0;
    const f = Math.max(0, Math.min(1, (t - t0) / ((acum[lo].t - t0) || 1)));
    const p = piezas[lo];
    return { i: lo, pieza: p, d: p.desde + f * p.d, litros: l0 + f * (acum[lo].l - l0), t: t };
  }

  function alternarRecorrido() {
    if (!S.rutas.length) return;
    if (S.anim && S.anim.corriendo) { pausar(); return; }
    if (S.anim && !S.anim.terminado) { reanudar(); return; }
    iniciar();
  }

  function iniciar() {
    const r = S.rutas[S.elegida];
    const T = r.ida.acum[r.ida.acum.length - 1].t;
    S.anim = {
      r: r, T: T,
      // Duración en pantalla a ritmo ×1: entre 12 y 40 s, según el largo.
      D: Math.max(12, Math.min(40, T / 150)),
      t: 0, ultimo: null, corriendo: true, terminado: false,
      escala: r.perfil.largo / r.perfil.piezas[r.perfil.piezas.length - 1].hasta,
      rumboCamara: null,
    };
    $('vjHud').hidden = false;
    if ($('vjSeguir').checked && !$('vjConductor').checked && S.mapa.getZoom() < 11.5) {
      S.mapa.jumpTo({ zoom: 12, center: r.perfil.coords[0] });
    }
    botonRecorrer();
    requestAnimationFrame(cuadro);
  }

  function pausar() { S.anim.corriendo = false; botonRecorrer(); }

  function reanudar() {
    S.anim.corriendo = true; S.anim.ultimo = null;
    botonRecorrer();
    requestAnimationFrame(cuadro);
  }

  function detener() {
    if (!S.anim) return;
    const conductor = S.anim.conductor;
    S.anim = null;
    $('vjHud').hidden = true;
    const g = $('vjPerfilAuto');
    if (g) g.style.display = 'none';
    botonRecorrer();
    if (S.mapa && S.mapa.getSource('vj-hecho')) S.mapa.getSource('vj-hecho').setData(VACIO);
    if (conductor) encuadrarRuta();
  }

  function botonRecorrer() {
    const b = $('vjPlay');
    const a = S.anim;
    b.innerHTML = a && a.corriendo ? '❚❚ Pausa' : a && !a.terminado ? '▶ Seguir' : a ? '↺ Otra vez' : '▶ Recorrer';
    b.setAttribute('aria-pressed', String(!!(a && a.corriendo)));
  }

  function cuadro(ahora) {
    const a = S.anim;
    if (!a || !a.corriendo) return;
    if (a.ultimo !== null) a.t += (ahora - a.ultimo) / 1000 * (a.T / a.D) * S.ritmo;
    a.ultimo = ahora;
    if (a.t >= a.T) { a.t = a.T; a.corriendo = false; a.terminado = true; }
    dibujarCuadro(a);
    if (a.terminado) {
      botonRecorrer();
      if (a.conductor) {
        a.conductor = false;
        setTimeout(function () { if (S.anim === a) encuadrarRuta(); }, 900);
      }
      return;
    }
    requestAnimationFrame(cuadro);
  }

  function dibujarCuadro(a) {
    const r = a.r, per = r.perfil;
    const est = estadoEn(r, a.t);
    a.ultimoEstado = est;
    const x = est.d * a.escala;
    const pos = V.puntoEn(per.coords, per.cum, x);
    const atras = V.puntoEn(per.coords, per.cum, Math.max(0, x - 20)).p;
    const adelante = V.puntoEn(per.coords, per.cum, Math.min(per.largo, x + 25)).p;
    const rumbo = V.rumbo(atras, adelante);
    ponerAuto(pos.p, rumbo);
    S.mapa.getSource('vj-hecho').setData({ type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: per.coords.slice(0, pos.i + 1).concat([pos.p]) } });

    if ($('vjSeguir').checked) {
      if ($('vjConductor').checked) {
        // El giro de la cámara se suaviza: seguir cada curva marea.
        if (a.rumboCamara === null) a.rumboCamara = rumbo;
        a.rumboCamara += (((rumbo - a.rumboCamara + 540) % 360) - 180) * 0.06;
        a.conductor = true;
        S.mapa.jumpTo({ center: pos.p, bearing: a.rumboCamara, pitch: 62, zoom: 15 });
      } else {
        S.mapa.jumpTo({ center: pos.p });
      }
    }
    moverMarcaPerfil(est);
    pintarTablero(a, est);
  }

  /* El tablero: dónde va, cómo es el camino y el estanque bajando. */
  function pintarTablero(a, est) {
    const r = a.r, o = opcionesCalculo(), p = est.pieza;
    $('hudKm').textContent = GT.fmt(est.d / 1000, 1);
    $('hudTotal').textContent = GT.fmt(r.ida.km, 1);
    $('hudVel').textContent = GT.fmt(p.v * 3.6, 0) + ' km/h';
    $('hudVia').textContent = (p.nombre ? p.nombre + ' · ' : '') + V.TIPOS[p.tipo];
    $('hudAlt').textContent = GT.fmt(p.h, 0) + ' m';
    $('hudPend').textContent = (p.s >= 0 ? '+' : '−') + GT.fmt(Math.abs(p.s * 100), 1) + ' %';
    $('hudLitros').textContent = GT.fmt(est.litros, 2) + ' L';
    $('hudCosto').textContent = pesos(est.litros * o.precio);
    $('hudHora').textContent = duracion(est.t);
    // Aguja: de lleno (derecha) a vacío (izquierda), con el estanque lleno al salir.
    const queda = Math.max(0, 1 - est.litros / o.vehiculo.estanque);
    $('hudAguja').setAttribute('transform', 'rotate(' + (-90 + 180 * queda).toFixed(1) + ' 50 50)');
  }

  /* ------------------------------------------------------------------------
     Arranque
     ------------------------------------------------------------------------ */

  function montarBotones() {
    $('vjIntercambiar').addEventListener('click', intercambiar);
    $('vjBorrar').addEventListener('click', borrar);
    $('vjEjemplo').addEventListener('click', function () {
      fijarPunto('a', EJEMPLO.a, true);
      fijarPunto('b', EJEMPLO.b);
    });
    $('vjPlay').addEventListener('click', alternarRecorrido);
    $('vjModo').addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      S.modo = b.dataset.valor;
      $('vjModo').querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      pintarRutasMapa(); pintarLeyenda();
      if (S.rutas.length) pintarPerfil();
    });
    $('vjRitmo').addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      S.ritmo = +b.dataset.valor;
      $('vjRitmo').querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
    });
    $('vjConductor').addEventListener('change', function () {
      if ($('vjConductor').checked) $('vjSeguir').checked = true;
      else if (S.anim) {
        S.anim.conductor = false; S.anim.rumboCamara = null;
        S.mapa.easeTo({ pitch: 0, bearing: 0, zoom: 12, duration: 600 });
      }
    });
    $('vjAltLista').addEventListener('click', function (e) {
      const b = e.target.closest('.viaje__alt');
      if (b) elegir(+b.dataset.i);
    });
    if (window.ResizeObserver) {
      let ancho = 0;
      new ResizeObserver(function (en) {
        const w = Math.round(en[0].contentRect.width);
        if (w && w !== ancho && S.rutas.length) { ancho = w; pintarPerfil(); }
      }).observe($('vjPerfil'));
    }
  }

  /* El mapa llega después que el panel. Lo marcado antes —por la dirección
     o con el ejemplo— ya tiene su punto y quizás su ruta, pero todavía no
     sus marcadores. Si la ruta sigue en camino, se dibuja al llegar. */
  function montar(api) {
    prepararMapa(api);
    ['a', 'b'].forEach(function (c) {
      if (S.puntos[c] && !S.marcas[c]) S.marcas[c] = marca(c).setLngLat(S.puntos[c].p).addTo(S.mapa);
    });
    if (S.rutas.length) { pintarTodo(); encuadrarRuta(); }
    else if (S.puntos.b && !S.puntos.a) {
      // Llegó desde "Mis predios" con solo el destino: se pide la salida.
      $('vjNota').textContent = 'Haga clic en el mapa para marcar desde dónde sale';
      S.mapa.flyTo({ center: S.puntos.b.p, zoom: 10, duration: 800 });
    }
  }

  /* El panel y la búsqueda del camino no esperan al mapa: con un enlace
     compartido, el resultado puede estar listo antes que las teselas. */
  function iniciarPantalla() {
    montarControles();
    montarBotones();
    const pedidos = leerDeUrl();
    if (pedidos.a) fijarPunto('a', pedidos.a, true);
    if (pedidos.b) fijarPunto('b', pedidos.b, true);
    pintarPuntos();
    pintarTodo();
    if (S.puntos.a && S.puntos.b) buscarRuta();
  }

  return { iniciar: iniciarPantalla, montar: montar, comunaEn: comunaEn };
})();
