/* ==========================================================================
   TerraFoco — Viajes a terreno: la ruta, el combustible y el autito

   Se marca una salida, una llegada y, si se quiere, paradas en medio (una
   gira de visitas a predios), siempre dentro de la región. La pantalla busca
   el camino, lo corta en tramos de 30 m con su tipo de vía, superficie,
   velocidad, pendiente y rumbo, y estima con viaje-calculo.js cuánto
   combustible y cuántos pesos cuesta. Después un autito recorre la ruta con
   el estanque bajando.

   De dónde sale el camino, en orden:
     1. Valhalla (FOSSGIS, sobre OpenStreetMap): ruta, alternativas (solo
        con dos puntos), altura cada 30 m, indicaciones en español y, con
        trace_attributes, clase, superficie, velocidad y densidad urbana de
        cada arco. Ordena las paradas con optimized_route. Sin clave.
     2. OSRM (FOSSGIS), si Valhalla no responde: forma y velocidad; la
        altura se lee de las teselas de elevación públicas (Terrarium).
     3. Sin red: línea recta alargada, advertida como aproximación.
   El viento y la temperatura del día vienen de Open-Meteo. Ninguno pide
   clave ni datos personales: solo viajan las coordenadas.

   Cambiar el vehículo, la carga, el estilo o el precio no vuelve a pedir la
   ruta: el cálculo es local y se rehace al instante.

   El buscador, las descargas, el informe y "Mis viajes" están en
   viajes-extras.js, que usa la interfaz pública de este módulo.
   ========================================================================== */

const GTViajes = (function () {
  'use strict';

  const VALHALLA = 'https://valhalla1.openstreetmap.de';
  const OSRM = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';
  const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/';
  const METEO = 'https://api.open-meteo.com/v1/forecast';
  const CLAVE = 'terrafoco_viaje';
  const MAX_PARADAS = 8;
  const V = GTViaje;

  /* Una gira para ver la pantalla andando: desde Rancagua a tres predios
     ficticios (datos/predios_ejemplo.csv) en un orden a propósito malo, y
     de vuelta. "Ordenar para gastar menos" muestra cuánto se ahorra. */
  const EJEMPLO = [
    { p: [-70.7444, -34.1708], nombre: 'Rancagua, plaza de armas' },
    { p: [-71.04780, -34.38142], nombre: 'Lote La Vega (predio de ejemplo)' },
    { p: [-70.76447, -34.07924], nombre: 'Parcela Las Acacias (predio de ejemplo)' },
    { p: [-71.00469, -34.28759], nombre: 'Parcela El Estero (predio de ejemplo)' },
  ];

  const $ = function (id) { return document.getElementById(id); };
  const pesos = function (n) { return (n < 0 ? '−$' : '$') + GT.fmt(Math.abs(Math.round(n))); };
  const esc = function (t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  const letra = function (i) { return String.fromCharCode(65 + i); };

  const S = {
    api: null, mapa: null,
    paradas: [],        // { p: [lon, lat], comuna, nombre }
    marcas: [],
    marcasKm: [],
    armado: false,      // el próximo clic agrega una parada
    rutas: [],          // { perfil, perfilVuelta, ida, vuelta, fuente, avisos }
    elegida: 0,
    modo: 'consumo',
    ritmo: 1,
    pedido: 0,
    anim: null,
    clima: null,        // { ms, desde, temperatura }
    ordenPrevio: null,
  };

  /* ------------------------------------------------------------------------
     Preferencias: se recuerdan en este navegador
     ------------------------------------------------------------------------ */

  function leerGuardado() {
    try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch (e) { return {}; }
  }

  function guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({
        vehiculo: $('vjVehiculo').value, combustible: $('vjCombustible').value,
        precios: S.precios, rendimientos: S.rendimientos,
        ocupantes: +$('vjOcupantes').value, carga: +$('vjCarga').value,
        aire: $('vjAire').checked, vuelta: $('vjVuelta').checked,
        peajes: $('vjPeajes').checked, ripio: $('vjRipio').checked,
        estilo: S.estilo, maxKmh: $('vjMaxKmh').value, clima: $('vjClima').checked,
        peajesMonto: numero($('vjPeajesMonto').value) || 0,
        frecuencia: numero($('vjFrecuencia').value) || 0,
      }));
    } catch (e) { /* sin almacenamiento: se usa igual */ }
  }

  function numero(t) {
    const v = parseFloat(String(t || '').replace(/\./g, '').replace(',', '.'));
    return isFinite(v) ? v : NaN;
  }

  function decimal(t) {
    const v = parseFloat(String(t || '').replace(',', '.'));
    return isFinite(v) ? v : NaN;
  }

  function vehiculo() { return V.vehiculo($('vjVehiculo').value); }
  function combustible() { return V.COMBUSTIBLES[$('vjCombustible').value]; }
  function precioDe(k) { return S.precios[k] || V.COMBUSTIBLES[k].precio; }
  function rendimientoDe(veh) { return S.rendimientos[veh.id] || veh.rendimiento; }

  /* Las opciones del cálculo. `veh` y `comb` permiten calcular "y si fuera
     en otro vehículo" con su propio rendimiento y su combustible. */
  function opcionesCalculo(veh, comb) {
    veh = veh || vehiculo();
    comb = comb || combustible();
    const max = +$('vjMaxKmh').value;
    return {
      vehiculo: veh, combustible: comb,
      rendimiento: rendimientoDe(veh),
      precio: precioDe(Object.keys(V.COMBUSTIBLES).find(function (k) { return V.COMBUSTIBLES[k] === comb; })),
      ocupantes: +$('vjOcupantes').value || 1,
      cargaKg: +$('vjCarga').value || 0,
      aire: $('vjAire').checked,
      estilo: S.estilo,
      maxKmh: max > 0 ? max : null,
      viento: $('vjClima').checked && S.clima ? { ms: S.clima.ms, desde: S.clima.desde } : null,
      temperatura: $('vjClima').checked && S.clima ? S.clima.temperatura : null,
    };
  }

  /* El combustible depende del motor: una camioneta diésel no carga 95 y un
     eléctrico carga kWh. */
  function llenarCombustibles(elegido) {
    const ids = V.combustiblesDe(vehiculo());
    $('vjCombustible').innerHTML = ids.map(function (k) {
      return '<option value="' + k + '">' + V.COMBUSTIBLES[k].nombre + '</option>';
    }).join('');
    $('vjCombustible').value = ids.indexOf(elegido) >= 0 ? elegido : ids[0];
    mostrarUnidades();
  }

  function mostrarUnidades() {
    const c = combustible();
    $('vjPrecio').value = GT.fmt(precioDe($('vjCombustible').value));
    $('vjPrecioRotulo').textContent = 'Precio por ' + (c.unidad === 'kWh' ? 'kWh' : 'litro');
    $('vjRendimiento').value = GT.fmt(rendimientoDe(vehiculo()), 1);
    $('vjRendUnidad').textContent = 'km/' + c.unidad;
  }

  function montarControles() {
    const g = leerGuardado();
    S.precios = g.precios || {};
    S.rendimientos = g.rendimientos || {};
    S.estilo = V.ESTILOS[g.estilo] ? g.estilo : 'normal';

    $('vjVehiculo').innerHTML = V.VEHICULOS.map(function (v) {
      return '<option value="' + v.id + '">' + v.nombre + '</option>';
    }).join('');
    $('vjVehiculo').value = V.VEHICULOS.some(function (v) { return v.id === g.vehiculo; }) ? g.vehiculo : 'sedan';
    llenarCombustibles(g.combustible);
    $('vjOcupantes').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) {
      return '<option value="' + n + '">' + n + (n === 1 ? ' persona' : ' personas') + '</option>';
    }).join('');
    $('vjOcupantes').value = g.ocupantes || 1;
    $('vjCarga').value = g.carga || 0;
    $('vjAire').checked = !!g.aire;
    $('vjVuelta').checked = g.vuelta !== false;
    $('vjPeajes').checked = !!g.peajes;
    $('vjRipio').checked = !!g.ripio;
    $('vjClima').checked = g.clima !== false;
    $('vjMaxKmh').value = g.maxKmh || '';
    $('vjPeajesMonto').value = g.peajesMonto ? GT.fmt(g.peajesMonto) : '';
    $('vjFrecuencia').value = g.frecuencia || '';
    marcarEstilo();
    rotularCarga();

    $('vjVehiculo').addEventListener('change', function () {
      llenarCombustibles($('vjCombustible').value);
      cambiarAutito();
      cambio();
    });
    $('vjCombustible').addEventListener('change', function () { mostrarUnidades(); cambio(); });
    $('vjPrecio').addEventListener('change', function () {
      const v = numero($('vjPrecio').value);
      if (v > 0) S.precios[$('vjCombustible').value] = v;
      mostrarUnidades();
      cambio();
    });
    $('vjRendimiento').addEventListener('change', function () {
      const v = decimal($('vjRendimiento').value), veh = vehiculo();
      if (v > 1 && v < 60) S.rendimientos[veh.id] = v; else delete S.rendimientos[veh.id];
      mostrarUnidades();
      cambio();
    });
    ['vjOcupantes', 'vjAire', 'vjMaxKmh'].forEach(function (id) { $(id).addEventListener('change', cambio); });
    $('vjCarga').addEventListener('input', function () { rotularCarga(); cambio(); });
    ['vjPeajesMonto', 'vjFrecuencia'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        const v = numero($(id).value);
        $(id).value = v > 0 ? GT.fmt(v) : '';
        cambio();
      });
    });
    $('vjEstilo').addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      S.estilo = b.dataset.valor;
      marcarEstilo();
      cambio();
    });
    $('vjClima').addEventListener('change', function () {
      guardar();
      if ($('vjClima').checked) pedirClima(); else { pintarClima(); recalcular(); }
    });
    $('vjVuelta').addEventListener('change', function () {
      guardar();
      pintarMarcas();
      pintarParadas();
      // Con paradas la vuelta es un tramo más del camino: hay que pedirlo.
      if (S.paradas.length > 2) buscarRuta(); else recalcular();
      guardarEnUrl();
    });
    // Estas dos cambian el camino: hay que volver a pedirlo.
    $('vjPeajes').addEventListener('change', function () { guardar(); buscarRuta(); });
    $('vjRipio').addEventListener('change', function () { guardar(); buscarRuta(); });
  }

  function marcarEstilo() {
    $('vjEstilo').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.valor === S.estilo);
    });
  }

  function rotularCarga() {
    const v = +$('vjCarga').value;
    $('vjCargaValor').textContent = v ? GT.fmt(v) + ' kg' : 'sin carga';
  }

  function cambio() { guardar(); recalcular(); }

  /* ------------------------------------------------------------------------
     Paradas
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

  function rol(i, n) {
    n = n === undefined ? S.paradas.length : n;
    if (soloLlegada()) return 'llegada';
    // Con paradas y vuelta al inicio, la llegada es la salida: todas las demás son paradas.
    const vuelve = n > 2 && $('vjVuelta') && $('vjVuelta').checked;
    return i === 0 ? 'salida' : (i === n - 1 && n > 1 && !vuelve ? 'llegada' : 'parada');
  }

  /* Desde "Mis predios" se llega con el predio de destino y sin salida: ese
     único punto es la llegada (B) hasta que se marque de dónde se sale. */
  function soloLlegada() { return !!S.desdePredio && S.paradas.length === 1; }
  function letraDe(i) { return letra(i + (soloLlegada() ? 1 : 0)); }

  const ROTULO = { salida: 'Salida', parada: 'Parada', llegada: 'Llegada' };

  /* Un punto nuevo desde el mapa, el buscador o la ubicación. Con menos de
     dos puntos se agrega; con el botón "Agregar parada" se mete antes de la
     llegada; si no, cambia la llegada. `op.comoSalida` (mi ubicación) lo
     pone de salida; `op.centrar` lleva el mapa hasta él. */
  function agregarPunto(p, nombre, op) {
    op = op || {};
    const comuna = comunaEn(p);
    if (comuna === null) {
      avisar('Ese punto queda fuera de la zona de estudio. Marque los puntos dentro de las 33 comunas ' +
             'de la región.', 'alerta');
      return false;
    }
    avisar('');
    const x = { p: [+p[0].toFixed(6), +p[1].toFixed(6)], comuna: comuna, nombre: nombre || '' };
    if (soloLlegada()) {
      S.paradas.unshift(x);
    } else if (op.comoSalida && S.paradas.length) {
      S.paradas[0] = x;
    } else if (S.armado && S.paradas.length >= 2) {
      S.paradas.splice(S.paradas.length - 1, 0, x);
      armar(false);
    } else if (S.paradas.length < 2) {
      S.paradas.push(x);
    } else {
      S.paradas[S.paradas.length - 1] = x;
    }
    if (!nombre) nombrar(x);
    cambioDeParadas();
    // Con un solo punto la ruta no encuadra nada: se lleva el mapa hasta él.
    if (op.centrar && S.mapa && S.paradas.length < 2) {
      S.mapa.flyTo({ center: x.p, zoom: Math.max(S.mapa.getZoom(), 12), duration: 800 });
    }
    return true;
  }

  /* Nombre de un punto marcado en el mapa: la calle o la localidad más
     cercana. Si no llega, queda la comuna. */
  function nombrar(x) {
    if (typeof GTViajesExtras === 'undefined') return;
    GTViajesExtras.nombreDe(x.p).then(function (n) {
      if (n && S.paradas.indexOf(x) >= 0) { x.nombre = n; pintarParadas(); }
    });
  }

  function cambioDeParadas(sinBuscar) {
    S.ordenPrevio = null;
    if (S.paradas.length !== 1) S.desdePredio = false;
    pintarMarcas();
    pintarParadas();
    guardarEnUrl();
    if (!sinBuscar) buscarRuta();
  }

  function armar(v) {
    S.armado = v;
    $('vjAgregar').classList.toggle('is-active', v);
    $('vjAgregar').textContent = v ? 'Cancelar' : '+ Agregar parada';
    pintarNota();
    if (S.mapa) S.mapa.getCanvas().style.cursor = 'crosshair';
  }

  function moverParada(i, p) {
    const comuna = comunaEn(p);
    if (comuna === null) {
      avisar('Ese punto queda fuera de la zona de estudio.', 'alerta');
      pintarMarcas();
      return;
    }
    S.paradas[i] = { p: [+p[0].toFixed(6), +p[1].toFixed(6)], comuna: comuna, nombre: '' };
    nombrar(S.paradas[i]);
    cambioDeParadas();
  }

  function accionParada(accion, i) {
    const ps = S.paradas;
    if (accion === 'quitar') ps.splice(i, 1);
    else if (accion === 'subir' && i > 0) ps.splice(i - 1, 0, ps.splice(i, 1)[0]);
    else if (accion === 'bajar' && i < ps.length - 1) ps.splice(i + 1, 0, ps.splice(i, 1)[0]);
    else if (accion === 'ir') { if (S.mapa) S.mapa.flyTo({ center: ps[i].p, zoom: 14, duration: 700 }); return; }
    else return;
    cambioDeParadas();
  }

  function pintarMarcas() {
    S.marcas.forEach(function (m) { m.remove(); });
    S.marcas = [];
    if (!S.mapa) return;
    S.paradas.forEach(function (x, i) {
      const el = document.createElement('div');
      el.className = 'viaje__marca viaje__marca--' + rol(i);
      el.textContent = letraDe(i);
      el.title = ROTULO[rol(i)] + (x.nombre ? ': ' + x.nombre : '') + ' · arrástrela para moverla';
      const m = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' })
        .setLngLat(x.p).addTo(S.mapa);
      m.on('dragend', function () { const ll = m.getLngLat(); moverParada(i, [ll.lng, ll.lat]); });
      S.marcas.push(m);
    });
  }

  function pintarParadas() {
    const ps = S.paradas;
    const filas = ps.map(function (x, i) {
      const r = rol(i);
      return '<div class="viaje__parada">' +
               '<button type="button" class="viaje__marca viaje__marca--' + r + ' viaje__marca--fija" data-accion="ir" data-i="' + i +
                 '" title="Ver en el mapa">' + letraDe(i) + '</button>' +
               '<div class="viaje__parada-texto"><strong>' + esc(x.nombre || x.comuna || 'Punto marcado') + '</strong>' +
                 '<span class="tiny muted">' + ROTULO[r] + ' · ' + esc(x.comuna || '') + ' · ' +
                 GT.fmt(x.p[1], 4) + ', ' + GT.fmt(x.p[0], 4) + '</span></div>' +
               '<div class="viaje__parada-acciones">' +
                 (i > 0 ? '<button type="button" data-accion="subir" data-i="' + i + '" title="Antes" aria-label="Mover antes">↑</button>' : '') +
                 (i < ps.length - 1 ? '<button type="button" data-accion="bajar" data-i="' + i + '" title="Después" aria-label="Mover después">↓</button>' : '') +
                 '<button type="button" data-accion="quitar" data-i="' + i + '" title="Quitar" aria-label="Quitar ' + letra(i) + '">✕</button>' +
               '</div>' +
             '</div>';
    });
    // Los que faltan, para que se entienda qué sigue.
    if (soloLlegada()) filas.unshift(vacia(0, 'salida', 'Haga clic en el mapa o busque desde dónde sale'));
    else {
      if (ps.length === 0) filas.push(vacia(0, 'salida', 'Haga clic en el mapa o busque un lugar para la salida'));
      if (ps.length <= 1) filas.push(vacia(1, 'llegada', ps.length === 0 ? 'Después, la llegada' : 'Ahora marque la llegada'));
    }
    if ($('vjVuelta').checked && ps.length >= 2) {
      filas.push('<div class="viaje__parada viaje__parada--vuelta"><span class="viaje__marca viaje__marca--salida viaje__marca--fija">A</span>' +
                 '<div class="viaje__parada-texto"><span class="muted">Vuelta al punto de partida</span></div></div>');
    }
    $('vjParadas').innerHTML = filas.join('');

    const n = ps.length;
    $('vjAgregar').disabled = n < 2 || n >= MAX_PARADAS;
    $('vjInvertir').disabled = n < 2;
    $('vjBorrar').disabled = n === 0;
    $('vjOrdenar').hidden = intermedias() < 2;
    pintarNota();
  }

  function vacia(i, r, texto) {
    return '<div class="viaje__parada viaje__parada--vacia"><span class="viaje__marca viaje__marca--' + r +
           ' viaje__marca--fija">' + letra(i) + '</span><div class="viaje__parada-texto"><span class="muted">' +
           texto + '</span></div></div>';
  }

  /* Paradas cuyo orden se puede cambiar: todas menos la salida y, si no se
     vuelve al inicio, la llegada. */
  function intermedias() {
    const n = S.paradas.length;
    return n < 2 ? 0 : $('vjVuelta').checked ? n - 1 : n - 2;
  }

  function pintarNota() {
    const n = S.paradas.length;
    $('vjNota').textContent = S.armado ? 'Haga clic en el mapa donde quiere agregar la parada'
      : soloLlegada() ? 'Haga clic en el mapa o busque desde dónde sale'
      : n === 0 ? 'Haga clic en el mapa o busque un lugar para marcar la salida'
      : n === 1 ? 'Ahora marque la llegada'
      : 'Clic en el mapa para cambiar la llegada · arrastre los puntos para moverlos';
  }

  /* El viaje queda en la dirección: se puede compartir o guardar. */
  function guardarEnUrl() {
    try {
      const u = new URL(window.location.href);
      ['desde', 'hasta'].forEach(function (k) { u.searchParams.delete(k); });
      if (S.paradas.length) {
        u.searchParams.set('p', S.paradas.map(function (x) {
          return x.p[1].toFixed(5) + ',' + x.p[0].toFixed(5);
        }).join(';'));
      } else u.searchParams.delete('p');
      if (S.paradas.length >= 2) u.searchParams.set('vuelta', $('vjVuelta').checked ? '1' : '0');
      else u.searchParams.delete('vuelta');
      window.history.replaceState(window.history.state, '', u.toString());
    } catch (e) { /* sin URL: el viaje no se comparte, pero funciona */ }
  }

  function leerDeUrl() {
    const out = { puntos: [] };
    try {
      const q = new URLSearchParams(window.location.search);
      const par = function (t) {
        const x = String(t || '').split(',').map(Number);
        return x.length === 2 && x.every(isFinite) && Math.abs(x[0]) <= 90 && Math.abs(x[1]) <= 180
          ? [x[1], x[0]] : null;
      };
      if (q.get('p')) q.get('p').split(';').slice(0, MAX_PARADAS).forEach(function (t) {
        const p = par(t); if (p) out.puntos.push(p);
      });
      else {
        // Enlaces anteriores (y "Mis predios"): ?desde=lat,lon&hasta=lat,lon
        const a = par(q.get('desde')), b = par(q.get('hasta'));
        if (a) out.puntos.push(a);
        if (b) out.puntos.push(b);
        out.soloLlegada = !a && !!b;
      }
      if (q.get('vuelta') === '0' || q.get('vuelta') === '1') out.vuelta = q.get('vuelta') === '1';
      if (q.get('v') && V.VEHICULOS.some(function (v) { return v.id === q.get('v'); })) out.vehiculo = q.get('v');
    } catch (e) { /* nada que leer */ }
    return out;
  }

  /* Carga un viaje completo (de "Mis viajes" o del ejemplo). */
  function cargar(viaje) {
    detener();
    S.paradas = viaje.paradas.map(function (x) {
      return { p: x.p.slice(), comuna: comunaEn(x.p), nombre: x.nombre || '' };
    }).filter(function (x) { return x.comuna !== null; });
    if (typeof viaje.vuelta === 'boolean') $('vjVuelta').checked = viaje.vuelta;
    if (viaje.vehiculo && V.VEHICULOS.some(function (v) { return v.id === viaje.vehiculo; })) {
      $('vjVehiculo').value = viaje.vehiculo;
      llenarCombustibles(viaje.combustible || $('vjCombustible').value);
      cambiarAutito();
    }
    guardar();
    armar(false);
    cambioDeParadas();
  }

  function borrar() {
    detener();
    S.paradas = [];
    S.rutas = [];
    S.pedido++;
    armar(false);
    cambioDeParadas(true);
    pintarTodo();
    avisar('');
  }

  /* ------------------------------------------------------------------------
     El camino
     ------------------------------------------------------------------------ */

  function errorDeRuta(texto) { const e = new Error(texto); e.sinRuta = true; return e; }

  function pedirJson(url, opciones, plazo) {
    return fetch(url, Object.assign({ signal: AbortSignal.timeout(plazo || 25000) }, opciones))
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, estado: r.status, d: d }; }); });
  }

  /* Los puntos en el orden en que se recorren. Con paradas, la vuelta es un
     tramo más; con solo A y B, la vuelta se calcula invirtiendo la ida
     (así se conservan las rutas alternativas). */
  function ubicaciones() {
    const locs = S.paradas.map(function (x) { return x.p; });
    if ($('vjVuelta').checked && S.paradas.length > 2) locs.push(S.paradas[0].p);
    return locs;
  }

  function vueltaInvertida() { return $('vjVuelta').checked && S.paradas.length === 2; }

  function errorValhalla(r, op, reintentar) {
    const codigo = r.d && r.d.error_code;
    /* Solo por pavimento a veces no se llega: el predio está en un camino de
       ripio. Se repite sin la restricción y se avisa. */
    if (op.evitarRipio && codigo === 442) {
      return reintentar(Object.assign({}, op, { evitarRipio: false })).then(function (rs) {
        rs.forEach(function (x) { x.avisos.push('No hay ruta solo por pavimento hasta alguno de los puntos: el camino incluye ripio o tierra.'); });
        return rs;
      });
    }
    if (codigo === 170 || codigo === 171) {
      throw errorDeRuta('No hay un camino cerca de uno de los puntos. Acérquelo a una calle o camino visible en el mapa.');
    }
    if (codigo === 442 || codigo === 443) throw errorDeRuta('No se encontró un camino entre esos puntos.');
    if (codigo === 150 || codigo === 154 || codigo === 155) {
      throw errorDeRuta('El recorrido es demasiado largo para el servicio de rutas.');
    }
    throw new Error('Valhalla respondió ' + r.estado);
  }

  function opcionesValhalla(op) {
    const auto = {};
    if (op.evitarPeajes) auto.use_tolls = 0;
    if (op.evitarRipio) auto.exclude_unpaved = true;
    return auto;
  }

  function valhalla(locs, op) {
    const consulta = {
      locations: locs.map(function (p) { return { lat: p[1], lon: p[0] }; }),
      costing: 'auto', costing_options: { auto: opcionesValhalla(op) },
      elevation_interval: V.PASO, units: 'kilometers',
      directions_type: 'instructions', language: 'es-ES',
    };
    if (locs.length === 2) consulta.alternates = 2;
    return pedirJson(VALHALLA + '/route?json=' + encodeURIComponent(JSON.stringify(consulta)))
      .then(function (r) {
        if (!r.ok || r.d.error) return errorValhalla(r, op, function (o2) { return valhalla(locs, o2); });
        const viajes = [r.d.trip].concat((r.d.alternates || []).map(function (x) { return x.trip; }));
        return Promise.all(viajes.map(function (viaje, i) {
          return Promise.all(viaje.legs.map(function (tramo) {
            const alt = tramo.elevation && tramo.elevation.length > 1
              ? Promise.resolve(tramo.elevation)
              : alturasTerrarium(V.decodificar(tramo.shape, 6));
            return Promise.all([atributos(tramo.shape), alt]);
          })).then(function (partes) {
            const avisos = [];
            partes.forEach(function (x, t) { viaje.legs[t].elevation = x[1]; });
            if (partes.some(function (x) { return !x[0]; })) avisos.push('No llegó el tipo de algunos tramos: ahí se supuso camino pavimentado.');
            if (partes.some(function (x) { return !x[1]; })) avisos.push('Sin altura en algún tramo: ahí el cálculo supone terreno plano.');
            return { perfil: V.perfilDesdeValhalla(viaje, partes.map(function (x) { return x[0]; })),
                     fuente: 'valhalla', avisos: avisos };
          }).catch(function (e) {
            if (i === 0) throw e;
            return null;   // una alternativa que falla se omite
          });
        })).then(function (rs) { return rs.filter(Boolean); });
      });
  }

  /* Clase, superficie, velocidad y densidad de cada arco de un tramo. */
  function atributos(forma) {
    const consulta = {
      encoded_polyline: forma, costing: 'auto', shape_match: 'edge_walk',
      filters: { action: 'include', attributes: [
        'edge.road_class', 'edge.surface', 'edge.unpaved', 'edge.speed', 'edge.density',
        'edge.end_shape_index', 'edge.names', 'edge.toll'] },
    };
    return pedirJson(VALHALLA + '/trace_attributes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(consulta),
    }).then(function (r) { return r.ok && r.d.edges ? r.d : null; })
      .catch(function () { return null; });
  }

  function osrm(locs) {
    const url = OSRM + locs.map(function (p) { return p[0] + ',' + p[1]; }).join(';') +
                '?overview=full&geometries=geojson&annotations=speed';
    return pedirJson(url, {}, 15000).then(function (r) {
      if (!r.ok || r.d.code !== 'Ok') {
        if (r.d && r.d.code === 'NoRoute') throw errorDeRuta('No se encontró un camino entre esos puntos.');
        throw new Error('OSRM respondió ' + r.estado);
      }
      return alturasTerrarium(r.d.routes[0].geometry.coordinates).then(function (alt) {
        const avisos = ['La ruta salió del servicio de respaldo (OSRM): no informa la superficie ni da indicaciones, ' +
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
    if (S.paradas.length < 2) { S.rutas = []; S.pedido++; pintarTodo(); return; }
    detener();
    const pedido = ++S.pedido;
    const locs = ubicaciones();
    const op = { evitarPeajes: $('vjPeajes').checked, evitarRipio: $('vjRipio').checked };
    $('vjNota').textContent = 'Buscando el camino…';
    $('mapa').classList.add('viaje--buscando');

    valhalla(locs, op)
      .catch(function (e) {
        if (e.sinRuta) throw e;
        console.warn('[viajes] Valhalla no respondió, se usa OSRM:', e.message);
        return osrm(locs);
      })
      .catch(function (e) {
        if (e.sinRuta) throw e;
        console.warn('[viajes] sin servicio de rutas, se usa la recta:', e.message);
        return [{ perfil: V.perfilRecto(locs), fuente: 'recta',
                  avisos: ['Sin conexión con los servicios de rutas: es una aproximación en línea recta ' +
                           'alargada un 35 %, a 60 km/h y sin pendientes. Tómela solo como orden de magnitud.'] }];
      })
      .then(function (rutas) {
        if (pedido !== S.pedido) return;
        S.rutas = rutas;
        S.elegida = 0;
        avisar('');
        recalcular(true);
        if ($('vjClima').checked) pedirClima();
        if (S.ordenPrevio) informarOrden();
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
        pintarNota();
      });
  }

  /* Ordena las paradas intermedias para recorrerlas en el menor tiempo
     (optimized_route de Valhalla). Suele ser también el orden que menos
     gasta; la pantalla lo comprueba y lo dice. */
  function ordenar() {
    if (intermedias() < 2) return;
    const locs = ubicaciones();
    const vuelta = $('vjVuelta').checked;
    if (vuelta && S.paradas.length === 2) return;
    const boton = $('vjOrdenar');
    boton.disabled = true; boton.textContent = 'Ordenando…';
    const consulta = { locations: locs.map(function (p) { return { lat: p[1], lon: p[0] }; }),
                       costing: 'auto', units: 'kilometers', directions_type: 'none' };
    pedirJson(VALHALLA + '/optimized_route?json=' + encodeURIComponent(JSON.stringify(consulta)))
      .then(function (r) {
        if (!r.ok || r.d.error) throw new Error(r.d && r.d.error || 'sin respuesta');
        const orden = r.d.trip.locations.map(function (l) { return l.original_index; })
          .filter(function (i) { return i < S.paradas.length; });
        // Con vuelta, el último índice es la salida repetida.
        const unicos = orden.filter(function (i, k) { return orden.indexOf(i) === k; });
        if (unicos.length !== S.paradas.length) throw new Error('orden incompleto');
        if (unicos.every(function (i, k) { return i === k; })) {
          avisar('El orden actual ya es el más corto.');
          return;
        }
        const t = S.rutas.length ? total(S.rutas[S.elegida]) : null;
        const previo = S.paradas.slice();
        S.paradas = unicos.map(function (i) { return previo[i]; });
        cambioDeParadas(true);
        S.ordenPrevio = t;
        buscarRuta();
      })
      .catch(function (e) {
        avisar('No se pudo ordenar las paradas (' + esc(e.message) + '). Puede moverlas con las flechas.', 'alerta');
      })
      .then(function () { boton.disabled = false; boton.textContent = 'Ordenar para gastar menos'; });
  }

  function informarOrden() {
    const antes = S.ordenPrevio, ahora = total(S.rutas[S.elegida]);
    S.ordenPrevio = null;
    if (!antes) return;
    const dkm = antes.km - ahora.km, dl = antes.litros - ahora.litros;
    const u = combustible().unidad;
    avisar('Nuevo orden: <strong>' + esc(nombreViaje()) + '</strong>. ' +
           (dl > 0.01 ? 'Ahorra ' + (dkm > 0.05 ? GT.fmt(dkm, 1) + ' km, ' : '') + GT.fmt(dl, 1) + ' ' + u + ' y ' +
                        pesos(antes.costo - ahora.costo) + '.'
                      : 'Es más corto en tiempo, aunque gasta casi lo mismo.'));
  }

  /* ------------------------------------------------------------------------
     El clima del día: viento y temperatura en el centro del recorrido
     ------------------------------------------------------------------------ */

  const climas = {};
  function pedirClima() {
    const r = S.rutas[S.elegida];
    if (!r) { pintarClima(); return; }
    const c = V.puntoEn(r.perfil.coords, r.perfil.cum, r.perfil.largo / 2).p;
    const k = c[1].toFixed(1) + ',' + c[0].toFixed(1);
    const vigente = climas[k] && Date.now() - climas[k].hora < 30 * 60000;
    (vigente ? Promise.resolve(climas[k]) :
      pedirJson(METEO + '?latitude=' + c[1].toFixed(3) + '&longitude=' + c[0].toFixed(3) +
                '&current=wind_speed_10m,wind_direction_10m,temperature_2m&wind_speed_unit=ms', {}, 10000)
        .then(function (x) {
          if (!x.ok || !x.d.current) throw new Error('sin clima');
          climas[k] = { ms: x.d.current.wind_speed_10m, desde: x.d.current.wind_direction_10m,
                        temperatura: x.d.current.temperature_2m, hora: Date.now() };
          return climas[k];
        }))
      .then(function (clima) {
        S.clima = clima;
        pintarClima();
        recalcular();
      })
      .catch(function () { S.clima = null; pintarClima('No se pudo consultar el clima: se calcula sin viento.'); });
  }

  const RUMBOS = ['el norte', 'el noreste', 'el este', 'el sureste', 'el sur', 'el suroeste', 'el oeste', 'el noroeste'];
  function rumboTexto(g) { return RUMBOS[Math.round(((g % 360) + 360) % 360 / 45) % 8]; }

  function pintarClima(error) {
    const el = $('vjClimaDato');
    if (!$('vjClima').checked) { el.textContent = 'Sin viento y a 15 °C'; return; }
    if (error) { el.textContent = error; return; }
    if (!S.clima) { el.textContent = S.rutas.length ? 'Consultando el clima…' : 'Se consulta al calcular la ruta'; return; }
    el.textContent = 'Ahora: viento de ' + GT.fmt(S.clima.ms * 3.6, 0) + ' km/h desde ' + rumboTexto(S.clima.desde) +
                     ' · ' + GT.fmt(S.clima.temperatura, 0) + ' °C (Open-Meteo)';
  }

  /* ------------------------------------------------------------------------
     Cálculo
     ------------------------------------------------------------------------ */

  function recalcular(encuadrar) {
    if (!S.rutas.length) { pintarTodo(); return; }
    const o = opcionesCalculo();
    const vuelta = vueltaInvertida();
    S.rutas.forEach(function (r) {
      r.ida = V.calcular(r.perfil, o);
      if (vuelta) {
        r.perfilVuelta = r.perfilVuelta || V.invertir(r.perfil);
        r.vuelta = V.calcular(r.perfilVuelta, o);
      } else r.vuelta = null;
    });
    if (S.anim) detener();
    pintarTodo();
    if (encuadrar) encuadrarRuta();
  }

  /* Litros (o kWh) de una ruta con otras opciones: para los consejos y la
     comparación de vehículos. */
  function consumoCon(r, o) {
    const ida = V.calcular(r.perfil, o);
    const x = { litros: ida.litros, costo: ida.costo, co2: ida.co2, segundos: ida.segundos, km: ida.km };
    if (r.vuelta) {
      const v = V.calcular(r.perfilVuelta, o);
      x.litros += v.litros; x.costo += v.costo; x.co2 += v.co2; x.segundos += v.segundos; x.km += v.km;
    }
    return x;
  }

  function peajes() { return numero($('vjPeajesMonto').value) || 0; }

  function total(r) {
    const x = { litros: r.ida.litros, costo: r.ida.costo, km: r.ida.km, segundos: r.ida.segundos,
                co2: r.ida.co2, subida: r.ida.subida, bajada: r.ida.bajada };
    if (r.vuelta) ['litros', 'costo', 'km', 'segundos', 'co2'].forEach(function (k) { x[k] += r.vuelta[k]; });
    x.combustible = x.costo;
    x.peajes = peajes();
    x.costo += x.peajes;
    return x;
  }

  function duracion(s) {
    const m = Math.round(s / 60);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
  }

  /* El nombre del viaje: "Rancagua → Rengo → Rancagua". */
  function nombreViaje() {
    const ps = S.paradas.map(function (x) { return x.comuna || x.nombre || '?'; });
    if ($('vjVuelta').checked && ps.length >= 2) ps.push(ps[0]);
    return ps.join(' → ');
  }

  /* El destino de cada tramo, para rotularlos (A → B, B → C, C → A). */
  function rotuloTramo(t) {
    if (vueltaInvertida()) return t === 0 ? 'A → B' : 'B → A';
    const n = S.paradas.length;
    return letra(t) + ' → ' + (t + 1 < n ? letra(t + 1) : 'A');
  }

  /* ------------------------------------------------------------------------
     Panel de resultados
     ------------------------------------------------------------------------ */

  function pintarTodo() {
    const hay = S.rutas.length > 0;
    ['vjResultado', 'vjDetalle', 'vjPerfilCaja', 'vjLeyenda'].forEach(function (id) { $(id).hidden = !hay; });
    $('vjPlay').disabled = !hay;
    $('vjLinea').disabled = !hay;
    pintarRutasMapa();
    pintarMarcasKm();
    if (typeof GTViajesExtras !== 'undefined') GTViajesExtras.alCambiar(hay);
    if (!hay) return;
    pintarResultado();
    pintarDesglose();
    pintarConsejos();
    pintarComparacion();
    pintarTramos();
    pintarTipos();
    pintarAlternativas();
    pintarIndicaciones();
    pintarNotas();
    pintarPerfil();
    pintarLeyenda();
    pintarClima();
  }

  function pintarResultado() {
    const r = S.rutas[S.elegida], t = total(r), o = opcionesCalculo();
    const u = o.combustible.unidad, electrico = u === 'kWh';
    const vuelta = $('vjVuelta').checked;
    $('vjLitros').textContent = GT.fmt(t.litros, 1);
    $('vjUnidad').textContent = electrico ? 'kWh' : 'litros';
    $('vjCosto').textContent = pesos(t.costo);
    $('vjCostoRotulo').textContent = t.peajes ? 'pesos, con peajes' : 'pesos';
    $('vjTramo').textContent = S.paradas.length > 2
      ? (S.paradas.length - (vuelta ? 1 : 2)) + ' paradas' + (vuelta ? ' y vuelta' : '')
      : (vuelta ? 'ida y vuelta' : 'solo ida');
    $('vjCifras').innerHTML = [
      [GT.fmt(t.km, 1) + ' km', 'distancia'],
      [duracion(t.segundos), 'manejando'],
      [t.litros > 0 ? GT.fmt(t.km / t.litros, 1) + ' km/' + u : '—', 'rendimiento en esta ruta'],
      [GT.fmt(t.co2, 1) + ' kg', 'CO₂ emitido'],
      [GT.fmt(Math.max(0, 100 * t.litros / o.vehiculo.estanque), 0) + ' %',
       (electrico ? 'de una batería de ' : 'de un estanque de ') + o.vehiculo.estanque + ' ' + u],
      ['↑' + GT.fmt(r.ida.subida, 0) + ' · ↓' + GT.fmt(r.ida.bajada, 0) + ' m', 'desnivel' + (r.vuelta ? ' de la ida' : '')],
    ].map(function (c) {
      return '<div class="cifra"><span class="cifra__valor">' + c[0] + '</span>' +
             '<span class="cifra__rotulo">' + c[1] + '</span></div>';
    }).join('');

    const extra = [];
    if (t.peajes) extra.push((electrico ? 'Electricidad ' : 'Combustible ') + pesos(t.combustible) + ' + peajes ' + pesos(t.peajes));
    const personas = o.ocupantes;
    if (personas > 1) extra.push(pesos(t.costo / personas) + ' por persona (' + personas + ')');
    const veces = numero($('vjFrecuencia').value) || 0;
    if (veces > 0) {
      extra.push(veces + (veces === 1 ? ' vez' : ' veces') + ' al mes: <strong>' + pesos(t.costo * veces) +
                 '</strong> al mes · ' + pesos(t.costo * veces * 12) + ' al año · ' +
                 GT.fmt(t.co2 * veces * 12 / 1000, 1) + ' t de CO₂ al año');
    }
    $('vjExtra').innerHTML = extra.map(function (x) { return '<div>' + x + '</div>'; }).join('');
    $('vjExtra').hidden = !extra.length;

    $('vjIdaVuelta').innerHTML = r.vuelta
      ? 'Ida <strong>' + GT.fmt(r.ida.litros, 1) + ' ' + u + '</strong> · vuelta <strong>' + GT.fmt(r.vuelta.litros, 1) +
        ' ' + u + '</strong>' + (Math.abs(r.ida.litros - r.vuelta.litros) / Math.abs(r.ida.litros || 1) > 0.08
          ? ': ' + (r.vuelta.litros > r.ida.litros ? 'la vuelta gasta más porque sube ' + GT.fmt(r.ida.bajada, 0)
                                                     : 'la ida gasta más porque sube ' + GT.fmt(r.ida.subida, 0)) + ' m'
          : '') + '.'
      : S.paradas.length > 2 ? 'Detalle de cada tramo, más abajo.'
      : 'Solo la ida. Marque "volver al punto de partida" para sumar el regreso.';
  }

  const CAUSAS = [
    ['rodadura', 'Rodar', 'la resistencia de los neumáticos; sube en ripio y tierra'],
    ['aire', 'Empujar el aire', 'crece con el cuadrado de la velocidad; el viento suma o resta'],
    ['motor', 'Motor encendido', 'pérdidas internas y accesorios mientras anda'],
    ['detenciones', 'Detenerse y arrancar', 'cruces, semáforos y curvas; más en la ciudad'],
    ['pendiente', 'Subidas y bajadas', 'lo que cuesta subir menos lo que ahorran (o recuperan) las bajadas'],
  ];

  function coloresCausas() {
    return { rodadura: PALETA.serie1, aire: PALETA.turquesa, motor: PALETA.gris,
             detenciones: PALETA.ambar, pendiente: PALETA.naranja };
  }

  function pintarDesglose() {
    const r = S.rutas[S.elegida], u = combustible().unidad;
    const d = {};
    Object.keys(r.ida.desglose).forEach(function (k) {
      d[k] = r.ida.desglose[k] + (r.vuelta ? r.vuelta.desglose[k] : 0);
    });
    const col = coloresCausas();
    const suma = CAUSAS.reduce(function (s, c) { return s + d[c[0]]; }, 0);
    const positivo = CAUSAS.reduce(function (s, c) { return s + Math.max(0, d[c[0]]); }, 0);
    $('vjBarra').innerHTML = CAUSAS.filter(function (c) { return d[c[0]] > 0; }).map(function (c) {
      return '<span style="flex:' + d[c[0]].toFixed(4) + ';background:' + col[c[0]] + '" title="' +
             c[1] + ': ' + GT.fmt(d[c[0]], 2) + ' ' + u + '"></span>';
    }).join('');
    $('vjCausas').innerHTML = CAUSAS.map(function (c) {
      const v = d[c[0]];
      return '<div class="viaje__causa">' +
               '<i style="background:' + col[c[0]] + (v < 0 ? ';opacity:.35' : '') + '"></i>' +
               '<span><strong>' + c[1] + '</strong><span class="tiny muted">' + c[2] + '</span></span>' +
               '<span class="viaje__causa-valor">' + (v < 0 ? '−' : '') + GT.fmt(Math.abs(v), 2) + ' ' + u +
                 '<span class="tiny muted">' + (v < 0 ? 'ahorro' : Math.round(100 * v / (positivo || 1)) + ' %') + '</span></span>' +
             '</div>';
    }).join('');
    $('vjBarra').title = positivo > suma ? 'Las bajadas descuentan ' + GT.fmt(positivo - suma, 2) + ' ' + u : '';
  }

  /* Consejos calculados, no genéricos: cada uno vuelve a correr el modelo
     con un cambio y dice cuánto ahorra en este viaje. */
  function pintarConsejos() {
    const r = S.rutas[S.elegida], o = opcionesCalculo(), base = consumoCon(r, o);
    const u = o.combustible.unidad;
    const lista = [];
    const probar = function (texto, cambios, detalle) {
      const x = consumoCon(r, Object.assign({}, o, cambios));
      const ahorro = base.litros - x.litros;
      if (ahorro / Math.max(0.01, Math.abs(base.litros)) < 0.015) return;
      lista.push({ texto: texto, ahorro: ahorro, pesos: base.costo - x.costo,
                   detalle: typeof detalle === 'function' ? detalle(x) : detalle });
    };
    // Diez km/h menos que lo más rápido de la ruta, en tramos de 10.
    const vmax = r.ida.acum.reduce(function (m, a) { return Math.max(m, a.v * 3.6); }, 0);
    const tope = Math.floor((vmax - 1) / 10) * 10;
    if (tope >= 80) {
      probar('Ir a ' + tope + ' km/h por carretera', { maxKmh: tope }, function (x) {
        return 'el aire frena con el cuadrado de la velocidad · llega ' + duracion(x.segundos - base.segundos) + ' después';
      });
    }
    if (S.estilo !== 'suave') probar('Manejar suave', { estilo: 'suave' }, 'acelerar con calma y anticipar las frenadas');
    if (o.aire) probar('Apagar el aire acondicionado', { aire: false }, 'abrir apenas las ventanas en ciudad');
    if (o.cargaKg > 0) probar('Viajar sin los ' + GT.fmt(o.cargaKg) + ' kg de carga', { cargaKg: 0 }, 'el peso se paga en cada subida y cada arranque');
    S.rutas.forEach(function (otra, i) {
      if (i === S.elegida) return;
      const t = total(otra), b = total(r);
      if (b.litros - t.litros > 0.05) {
        lista.push({ texto: 'Tomar la ruta ' + (i + 1), ahorro: b.litros - t.litros, pesos: b.costo - t.costo,
                     detalle: GT.fmt(t.km, 1) + ' km · ' + duracion(t.segundos), ruta: i });
      }
    });
    if (r.ida.ripioKm > 1 && !$('vjRipio').checked) {
      lista.push({ texto: 'Probar "evitar ripio y tierra"', ahorro: null,
                   detalle: 'hay ' + GT.fmt(r.ida.ripioKm, 1) + ' km sin pavimento en la ida; si hay otro camino, suele gastar menos', ripio: true });
    }
    lista.sort(function (a, b) { return (b.ahorro || 0) - (a.ahorro || 0); });
    $('vjConsejos').innerHTML = lista.length ? lista.slice(0, 5).map(function (c) {
      return '<div class="viaje__consejo">' +
               '<span><strong>' + c.texto + '</strong><span class="tiny muted">' + c.detalle + '</span></span>' +
               (c.ahorro !== null ? '<span class="viaje__consejo-ahorro">−' + GT.fmt(c.ahorro, 1) + ' ' + u +
                 '<span class="tiny">' + pesos(-c.pesos) + '</span></span>' : '') +
               (c.ruta !== undefined ? '<button type="button" class="btn btn--chico" data-ruta="' + c.ruta + '">Usar</button>' : '') +
               (c.ripio ? '<button type="button" class="btn btn--chico" data-ripio="1">Probar</button>' : '') +
             '</div>';
    }).join('') : '<p class="small muted" style="margin:0">Con estas opciones el viaje ya va bien: no hay un cambio simple que ahorre más de un 1,5 %.</p>';
  }

  /* El mismo viaje en cada vehículo de la lista, con su combustible y su
     rendimiento (el propio, si el usuario lo escribió). */
  function pintarComparacion() {
    const r = S.rutas[S.elegida], actual = vehiculo().id, o0 = opcionesCalculo();
    const filas = V.VEHICULOS.map(function (veh) {
      const ids = V.combustiblesDe(veh);
      const k = ids.indexOf($('vjCombustible').value) >= 0 ? $('vjCombustible').value : ids[0];
      const x = consumoCon(r, opcionesCalculo(veh, V.COMBUSTIBLES[k]));
      return { veh: veh, comb: V.COMBUSTIBLES[k], x: x };
    });
    const max = Math.max.apply(null, filas.map(function (f) { return f.x.costo; }));
    const barato = filas.reduce(function (m, f) { return f.x.costo < m.x.costo ? f : m; }, filas[0]);
    $('vjComparar').innerHTML = filas.map(function (f) {
      return '<button type="button" class="viaje__vehiculo' + (f.veh.id === actual ? ' is-active' : '') + '" data-veh="' + f.veh.id + '">' +
               '<span class="viaje__vehiculo-nombre">' + f.veh.nombre +
                 (f === barato ? ' <em class="viaje__sello">el más barato</em>' : '') + '</span>' +
               '<span class="viaje__vehiculo-barra"><span style="width:' + (100 * f.x.costo / (max || 1)).toFixed(1) + '%"></span></span>' +
               '<span class="viaje__vehiculo-cifra">' + GT.fmt(f.x.litros, 1) + ' ' + f.comb.unidad + '</span>' +
               '<strong class="viaje__vehiculo-cifra">' + pesos(f.x.costo) + '</strong>' +
               '<span class="viaje__vehiculo-cifra muted">' + GT.fmt(f.x.co2, 1) + ' kg</span>' +
             '</button>';
    }).join('');
    $('vjCompararNota').textContent = 'Cada uno con su rendimiento promedio y su combustible, a los precios del panel' +
      (o0.ocupantes > 1 || o0.cargaKg ? ', con la misma gente y carga' : '') + '. Sin peajes.';
  }

  function coloresTipo() {
    return { autopista: PALETA.azul, ruta: PALETA.turquesa, local: PALETA.verde,
             urbano: PALETA.ambar, ripio: PALETA.rojo };
  }

  function pintarTipos() {
    const r = S.rutas[S.elegida], col = coloresTipo(), u = combustible().unidad;
    const km = r.ida.km;
    $('vjTipos').innerHTML = Object.keys(V.TIPOS).filter(function (t) { return r.ida.porTipo[t].m > 0; })
      .map(function (t) {
        const x = r.ida.porTipo[t];
        const k = x.m / 1000;
        return '<div class="viaje__tipo">' +
                 '<span class="viaje__tipo-nombre"><i style="background:' + col[t] + '"></i>' + V.TIPOS[t] + '</span>' +
                 '<span class="viaje__tipo-barra"><span style="width:' + (100 * k / km).toFixed(1) + '%;background:' + col[t] + '"></span></span>' +
                 '<span class="viaje__tipo-cifra">' + GT.fmt(k, 1) + ' km</span>' +
                 '<span class="viaje__tipo-cifra">' + (k > 0.3 && x.litros > 0 ? GT.fmt(k / x.litros, 1) + ' km/' + u : '—') + '</span>' +
               '</div>';
      }).join('');
    $('vjTiposNota').textContent = r.vuelta ? '· la ida' : '';
  }

  function pintarTramos() {
    const r = S.rutas[S.elegida], u = combustible().unidad, precio = opcionesCalculo().precio;
    const filas = r.vuelta
      ? [r.ida, r.vuelta].map(function (x, t) {
          return { rotulo: rotuloTramo(t), km: x.km, segundos: x.segundos, litros: x.litros, subida: x.subida };
        })
      : r.ida.porTramo.map(function (x, t) {
          return { rotulo: rotuloTramo(t), km: x.m / 1000, segundos: x.segundos, litros: x.litros, subida: x.subida };
        });
    $('vjTramosCaja').hidden = filas.length < 2;
    if (filas.length < 2) return;
    $('vjTramos').innerHTML = '<table class="table viaje__tabla"><thead><tr><th>Tramo</th><th>km</th><th>Tiempo</th>' +
      '<th>Sube</th><th>' + u + '</th><th>Pesos</th></tr></thead><tbody>' +
      filas.map(function (f) {
        return '<tr><td><strong>' + f.rotulo + '</strong></td><td>' + GT.fmt(f.km, 1) + '</td><td>' + duracion(f.segundos) +
               '</td><td>' + GT.fmt(f.subida, 0) + ' m</td><td>' + GT.fmt(f.litros, 2) + '</td><td>' +
               pesos(Math.max(0, f.litros) * precio) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function pintarAlternativas() {
    const caja = $('vjAlternativas');
    if (S.rutas.length < 2) { caja.hidden = true; return; }
    caja.hidden = false;
    const u = combustible().unidad;
    const tots = S.rutas.map(total);
    const barata = tots.reduce(function (m, t, i) { return t.litros < tots[m].litros ? i : m; }, 0);
    const rapida = tots.reduce(function (m, t, i) { return t.segundos < tots[m].segundos ? i : m; }, 0);
    $('vjAltLista').innerHTML = S.rutas.map(function (r, i) {
      const t = tots[i];
      const sellos = (i === barata ? '<em class="viaje__sello">gasta menos</em>' : '') +
                     (i === rapida ? '<em class="viaje__sello">más rápida</em>' : '');
      return '<button type="button" class="viaje__alt' + (i === S.elegida ? ' is-active' : '') + '" data-i="' + i + '">' +
               '<span class="viaje__alt-nombre">Ruta ' + (i + 1) + sellos + '</span>' +
               '<span>' + GT.fmt(t.km, 1) + ' km · ' + duracion(t.segundos) +
                 (r.ida.ripioKm > 0.5 ? ' · ' + GT.fmt(r.ida.ripioKm, 1) + ' km de ripio' : '') + '</span>' +
               '<strong>' + GT.fmt(t.litros, 1) + ' ' + u + ' · ' + pesos(t.costo) + '</strong>' +
             '</button>';
    }).join('');
    $('vjAltNota').textContent = barata !== rapida
      ? 'La ruta más rápida no es la que menos gasta: la diferencia es de ' +
        GT.fmt(tots[rapida].litros - tots[barata].litros, 1) + ' ' + u + ' (' +
        pesos(tots[rapida].costo - tots[barata].costo) + ').'
      : 'La ruta más rápida es también la que menos gasta.';
  }

  function elegir(i) {
    if (i === S.elegida || !S.rutas[i]) return;
    detener();
    S.elegida = i;
    pintarTodo();
  }

  const ICONO_MANIOBRA = {
    1: '▶', 2: '▶', 3: '▶', 4: '⚑', 5: '⚑', 6: '⚑', 7: '↑', 8: '↑', 9: '↗', 10: '↱', 11: '↪', 12: '↶',
    13: '↶', 14: '↰', 15: '↰', 16: '↖', 17: '↑', 18: '↗', 19: '↖', 20: '↗', 21: '↖', 22: '↑', 23: '↗',
    24: '↖', 25: '⇉', 26: '⟳', 27: '⟳', 37: '↗', 38: '↖',
  };

  function pintarIndicaciones() {
    const r = S.rutas[S.elegida], lista = r.perfil.indicaciones;
    $('vjIndicacionesCaja').hidden = !lista.length;
    if (!lista.length) return;
    let tramo = -1;
    $('vjIndicaciones').innerHTML = lista.map(function (x, i) {
      let cab = '';
      if (x.tramo !== undefined && x.tramo !== tramo && r.perfil.tramos > 1) {
        tramo = x.tramo;
        cab = '<li class="viaje__paso-tramo">' + rotuloTramo(tramo) + '</li>';
      }
      return cab + '<li><button type="button" class="viaje__paso" data-i="' + i + '">' +
               '<span class="viaje__paso-icono" aria-hidden="true">' + (ICONO_MANIOBRA[x.tipo] || '•') + '</span>' +
               '<span>' + esc(x.texto) + '</span>' +
               '<span class="viaje__paso-km">' + (x.largo > 0 ? GT.fmt(x.largo / 1000, x.largo < 10000 ? 1 : 0) + ' km' : '') + '</span>' +
             '</button></li>';
    }).join('');
    $('vjIndicacionesNota').textContent = lista.length + ' indicaciones' +
      (r.vuelta ? ' de la ida; la vuelta es el mismo camino al revés' : '');
  }

  function pintarNotas() {
    const r = S.rutas[S.elegida], o = opcionesCalculo();
    const notas = r.avisos.slice();
    if (r.ida.peajeKm > 0.05 && !$('vjPeajes').checked && !peajes()) {
      notas.push('La ruta pasa por tramos con peaje: puede sumar su costo en "Peajes del viaje".');
    }
    if (S.clima && $('vjClima').checked && S.clima.temperatura >= 27 && !o.aire) {
      notas.push('Hoy hace ' + GT.fmt(S.clima.temperatura, 0) + ' °C: si va a usar el aire acondicionado, márquelo.');
    }
    const fuente = { valhalla: 'Valhalla (FOSSGIS) sobre OpenStreetMap',
                     osrm: 'OSRM (FOSSGIS) sobre OpenStreetMap, alturas de AWS Terrain Tiles',
                     recta: 'línea recta, sin servicio de rutas' }[r.fuente];
    $('vjNotas').innerHTML = notas.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') +
      '<li>Camino: ' + fuente + '. Ajuste del modelo al rendimiento elegido: ×' + GT.fmt(r.ida.calibracion, 2) + '.</li>' +
      (r.vuelta ? '<li>La vuelta se calcula por el mismo camino, en sentido contrario.</li>' : '') +
      '<li>Es una estimación: el tráfico, la presión de los neumáticos y el estado del vehículo pueden moverla un 10 a 20 %.</li>';
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

  function escalaDe(perfil) {
    return perfil.largo / (perfil.piezas[perfil.piezas.length - 1].hasta || 1);
  }

  /* Coordenadas del recorrido entre dos distancias, con los vértices de en
     medio: así la línea sigue las curvas. */
  function tramoEntre(perfil, d0, d1) {
    const e = escalaDe(perfil);
    const a = V.puntoEn(perfil.coords, perfil.cum, d0 * e), b = V.puntoEn(perfil.coords, perfil.cum, d1 * e);
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
     el rumbo. Uno por forma de vehículo, con los focos encendidos hacia
     adelante; el lienzo es simétrico para que el centro del vehículo sea el
     centro de la imagen. */
  const FORMAS = {
    auto:      { ancho: 30, largo: 72, color: function () { return PALETA.rojo; } },
    electrico: { ancho: 30, largo: 72, color: function () { return PALETA.turquesa; } },
    suv:       { ancho: 33, largo: 76, color: function () { return PALETA.azul; } },
    camioneta: { ancho: 34, largo: 86, color: function () { return PALETA.ambar; } },
    furgon:    { ancho: 34, largo: 88, color: function () { return PALETA.gris; } },
  };

  function dibujarAutito(forma) {
    const f = FORMAS[forma] || FORMAS.auto;
    const R = 2, W = 44, C = 30, H = f.largo + 2 * C;
    const x0 = (W - f.ancho) / 2, L = f.largo, A = f.ancho;
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
    x.beginPath(); x.moveTo(x0 + 3, C + 2); x.lineTo(x0 + A - 3, C + 2); x.lineTo(W, 0); x.lineTo(0, 0); x.closePath(); x.fill();
    // Sombra y carrocería.
    const color = f.color();
    x.save();
    x.shadowColor = 'rgba(0, 0, 0, .45)'; x.shadowBlur = 5; x.shadowOffsetY = 2;
    x.fillStyle = color;
    caja(x0, C, A, L, forma === 'furgon' ? 7 : 11); x.fill();
    x.restore();
    x.lineWidth = 1.2; x.strokeStyle = 'rgba(255, 255, 255, .85)';
    caja(x0, C, A, L, forma === 'furgon' ? 7 : 11); x.stroke();
    const vidrio = 'rgba(12, 18, 28, .85)';
    x.fillStyle = vidrio;
    if (forma === 'camioneta') {
      // Cabina adelante y pickup atrás, abierta.
      caja(x0 + 4, C + 15, A - 8, 12, 4); x.fill();
      x.fillStyle = 'rgba(255, 255, 255, .16)'; caja(x0 + 5, C + 28, A - 10, 14, 3); x.fill();
      x.fillStyle = 'rgba(0, 0, 0, .28)'; caja(x0 + 3, C + 46, A - 6, L - 50, 3); x.fill();
      x.strokeStyle = 'rgba(255, 255, 255, .5)'; x.lineWidth = 1;
      caja(x0 + 3, C + 46, A - 6, L - 50, 3); x.stroke();
    } else if (forma === 'furgon') {
      caja(x0 + 4, C + 10, A - 8, 11, 3); x.fill();
      x.fillStyle = 'rgba(255, 255, 255, .14)'; caja(x0 + 4, C + 24, A - 8, L - 30, 3); x.fill();
    } else {
      caja(x0 + 4, C + 17, A - 8, 13, 4); x.fill();
      caja(x0 + 5, C + L - 20, A - 10, 9, 3); x.fill();
      x.fillStyle = 'rgba(255, 255, 255, .16)';
      caja(x0 + 5, C + 31, A - 10, L - 52, 3); x.fill();
    }
    if (forma === 'electrico') {
      // Un rayo en el techo.
      x.fillStyle = '#FFF4C4';
      x.beginPath(); x.moveTo(W / 2 + 2, C + 32); x.lineTo(W / 2 - 4, C + 44); x.lineTo(W / 2, C + 44);
      x.lineTo(W / 2 - 2, C + 54); x.lineTo(W / 2 + 4, C + 41); x.lineTo(W / 2, C + 41); x.closePath(); x.fill();
    }
    // Espejos.
    x.fillStyle = color;
    caja(x0 - 3, C + 21, 4, 5, 1.5); x.fill(); caja(x0 + A - 1, C + 21, 4, 5, 1.5); x.fill();
    // Focos y luces traseras.
    x.fillStyle = '#FFF4C4';
    caja(x0 + 3, C + 1, 7, 4, 2); x.fill(); caja(x0 + A - 10, C + 1, 7, 4, 2); x.fill();
    x.fillStyle = '#B3001B';
    caja(x0 + 3, C + L - 5, 7, 3.5, 1.5); x.fill(); caja(x0 + A - 10, C + L - 5, 7, 3.5, 1.5); x.fill();
    return { imagen: x.getImageData(0, 0, W * R, H * R), proporcion: R };
  }

  function cambiarAutito() {
    if (!S.mapa || !S.mapa.getLayer('vj-auto')) return;
    S.mapa.setLayoutProperty('vj-auto', 'icon-image', 'vj-auto-' + (vehiculo().forma || 'auto'));
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
    ['vj-alt', 'vj-ruta', 'vj-hecho', 'vj-cursor', 'vj-auto'].forEach(function (id) {
      m.addSource(id, { type: 'geojson', data: VACIO });
    });
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
    Object.keys(FORMAS).forEach(function (forma) {
      const a = dibujarAutito(forma);
      m.addImage('vj-auto-' + forma, a.imagen, { pixelRatio: a.proporcion });
    });
    m.addLayer({ id: 'vj-auto', type: 'symbol', source: 'vj-auto', layout: {
      'icon-image': 'vj-auto-' + (vehiculo().forma || 'auto'), 'icon-rotate': ['get', 'rumbo'],
      'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.42, 12, 0.62, 16, 0.95],
    } });

    m.on('click', function (e) {
      const alt = m.queryRenderedFeatures(e.point, { layers: ['vj-alt'] });
      if (alt.length) { elegir(alt[0].properties.i); return; }
      if (S.anim && S.anim.corriendo) return;
      agregarPunto([e.lngLat.lng, e.lngLat.lat]);
    });
    m.on('mouseenter', 'vj-alt', function () { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'vj-alt', function () { m.getCanvas().style.cursor = 'crosshair'; });
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
      const c = S.rutas[S.elegida].perfil.coords;
      ponerAuto(c[0], V.rumbo(c[0], c[Math.min(3, c.length - 1)]));
    }
  }

  /* Hitos de kilómetro a lo largo de la ruta: unos diez, en números redondos. */
  function pintarMarcasKm() {
    S.marcasKm.forEach(function (m) { m.remove(); });
    S.marcasKm = [];
    if (!S.mapa || !S.rutas.length) return;
    const per = S.rutas[S.elegida].perfil;
    const km = per.piezas[per.piezas.length - 1].hasta / 1000;
    const paso = [1, 2, 5, 10, 20, 25, 50, 100].find(function (p) { return km / p <= 10; }) || 100;
    for (let k = paso; k < km - paso * 0.3; k += paso) {
      const el = document.createElement('div');
      el.className = 'viaje__km';
      el.textContent = k + ' km';
      const p = V.puntoEn(per.coords, per.cum, k * 1000 * escalaDe(per)).p;
      S.marcasKm.push(new maplibregl.Marker({ element: el }).setLngLat(p).addTo(S.mapa));
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
    S.paradas.forEach(function (x) { b.extend(x.p); });
    m.fitBounds(b, { padding: { top: 70, bottom: 60, left: 60, right: 60 }, maxZoom: 13.5, duration: 700,
                     pitch: 0, bearing: 0 });
  }

  /* Encuadra la ruta y avisa cuando el mapa terminó de dibujarla: para la
     foto del informe. */
  function encuadrarYEsperar() {
    return new Promise(function (ok) {
      if (!S.mapa || !S.rutas.length) { ok(); return; }
      if (S.anim) detener();
      S.mapa.once('idle', function () { ok(); });
      encuadrarRuta();
      setTimeout(ok, 3000);
    });
  }

  /* ------------------------------------------------------------------------
     Perfil de alturas
     ------------------------------------------------------------------------ */

  const ALTO = 150, IZQ = 46, DER = 12, ARR = 16, ABA = 22;

  function escalasPerfil() {
    const piezas = S.rutas[S.elegida].perfil.piezas;
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

    // Dónde termina cada tramo: las paradas.
    const cortes = [];
    for (let i = 1; i < piezas.length; i++) {
      if (piezas[i].tramo !== piezas[i - 1].tramo) cortes.push({ d: piezas[i].desde, t: piezas[i].tramo });
    }
    const paradas = cortes.map(function (c) {
      const x = e.x(c.d).toFixed(1);
      return '<line x1="' + x + '" x2="' + x + '" y1="' + ARR + '" y2="' + (ALTO - ABA) + '" class="viaje__perfil-parada"/>' +
             '<text x="' + x + '" y="' + (ARR - 4) + '" text-anchor="middle" class="viaje__perfil-letra">' + letra(c.t) + '</text>';
    }).join('');

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
        paradas +
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
    if (S.anim && S.anim.ultimoEstado) moverMarcaPerfil(S.anim.ultimoEstado);

    const zona = $('vjPerfilZona');
    zona.addEventListener('mousemove', function (ev) {
      const rect = caja.querySelector('svg').getBoundingClientRect();
      mostrarEnPerfil(e.d(ev.clientX - rect.left));
    });
    zona.addEventListener('mouseleave', ocultarGuia);
    // Un clic en el perfil lleva al autito a ese punto.
    zona.addEventListener('click', function (ev) {
      const rect = caja.querySelector('svg').getBoundingClientRect();
      saltarA(e.d(ev.clientX - rect.left));
    });
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
      GT.fmt(r.ida.acum[i].intensidad, 1) + ' ' + combustible().unidad + '/100 km en este tramo';
    const x = e.x(d);
    punta.style.left = Math.min(e.ancho - 200, Math.max(0, x - 100)) + 'px';
    mostrarCursor(V.puntoEn(r.perfil.coords, r.perfil.cum, d * escalaDe(r.perfil)).p);
  }

  function mostrarCursor(p) {
    if (!S.mapa) return;
    S.mapa.getSource('vj-cursor').setData(p ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } } : VACIO);
  }

  function ocultarGuia() {
    $('vjPerfilGuia').style.display = 'none';
    $('vjPunta').hidden = true;
    mostrarCursor(null);
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
    return { i: lo, pieza: p, d: p.desde + f * p.d, litros: l0 + f * (acum[lo].l - l0), t: t, v: acum[lo].v };
  }

  function nuevaAnimacion() {
    const r = S.rutas[S.elegida];
    const T = r.ida.acum[r.ida.acum.length - 1].t;
    // Cuándo se llega a cada parada: ahí el autito se detiene un momento.
    const pausas = [];
    r.perfil.piezas.forEach(function (p, i) {
      const sig = r.perfil.piezas[i + 1];
      if (sig && sig.tramo !== p.tramo) pausas.push({ t: r.ida.acum[i].t, letra: letra(sig.tramo) });
    });
    return {
      r: r, T: T, pausas: pausas, espera: 0,
      // Duración en pantalla a ritmo ×1: entre 14 y 45 s, según el largo.
      D: Math.max(14, Math.min(45, T / 150)),
      t: 0, ultimo: null, corriendo: false, terminado: false,
      escala: escalaDe(r.perfil), rumboCamara: null,
    };
  }

  function alternarRecorrido() {
    if (!S.rutas.length) return;
    if (S.anim && S.anim.corriendo) { pausar(); return; }
    if (!S.anim || S.anim.terminado) {
      S.anim = nuevaAnimacion();
      $('vjHud').hidden = false;
      if ($('vjSeguir').checked && !$('vjConductor').checked && S.mapa.getZoom() < 11.5) {
        S.mapa.jumpTo({ zoom: 12, center: S.anim.r.perfil.coords[0] });
      }
    }
    S.anim.corriendo = true; S.anim.ultimo = null;
    botonRecorrer();
    requestAnimationFrame(cuadro);
  }

  function pausar() { S.anim.corriendo = false; botonRecorrer(); }

  function detener() {
    if (!S.anim) return;
    const conductor = S.anim.conductor;
    S.anim = null;
    $('vjHud').hidden = true;
    $('vjLinea').value = 0;
    const g = $('vjPerfilAuto');
    if (g) g.style.display = 'none';
    botonRecorrer();
    if (S.mapa && S.mapa.getSource('vj-hecho')) S.mapa.getSource('vj-hecho').setData(VACIO);
    if (conductor) encuadrarRuta();
  }

  /* La barra de tiempo y el clic en el perfil: llevan el autito a un punto
     sin reproducir. */
  function saltarA(d) {
    if (!S.rutas.length) return;
    if (!S.anim) { S.anim = nuevaAnimacion(); $('vjHud').hidden = false; }
    const a = S.anim, r = a.r;
    a.corriendo = false;
    const i = piezaEn(d);
    a.t = r.ida.acum[i].t;
    a.terminado = a.t >= a.T;
    dibujarCuadro(a);
    botonRecorrer();
  }

  function botonRecorrer() {
    const b = $('vjPlay');
    const a = S.anim;
    b.textContent = a && a.corriendo ? '❚❚ Pausa' : a && !a.terminado && a.t > 0 ? '▶ Seguir' : a && a.terminado ? '↺ Otra vez' : '▶ Recorrer';
    b.setAttribute('aria-pressed', String(!!(a && a.corriendo)));
  }

  function cuadro(ahora) {
    const a = S.anim;
    if (!a || !a.corriendo) return;
    if (a.espera > ahora) { requestAnimationFrame(cuadro); return; }
    if (a.ultimo !== null) {
      const antes = a.t;
      a.t += (ahora - Math.max(a.ultimo, a.espera)) / 1000 * (a.T / a.D) * S.ritmo;
      const p = a.pausas.find(function (x) { return x.t > antes && x.t <= a.t; });
      if (p) { a.t = p.t; a.espera = ahora + 1100; a.evento = 'Parada ' + p.letra; }
    }
    a.ultimo = ahora;
    if (a.t >= a.T) { a.t = a.T; a.corriendo = false; a.terminado = true; a.evento = 'Llegada'; }
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

    if ($('vjSeguir').checked && a.corriendo) {
      if ($('vjConductor').checked) {
        // El giro de la cámara se suaviza: seguir cada curva marea.
        if (a.rumboCamara === null) a.rumboCamara = rumbo;
        a.rumboCamara += (((rumbo - a.rumboCamara + 540) % 360) - 180) * 0.06;
        a.conductor = true;
        S.mapa.jumpTo({ center: pos.p, bearing: a.rumboCamara, pitch: 62, zoom: 15 });
      } else {
        S.mapa.jumpTo({ center: pos.p });
      }
    } else if (!a.corriendo) {
      S.mapa.easeTo({ center: pos.p, duration: 300 });
    }
    $('vjLinea').value = Math.round(1000 * a.t / (a.T || 1));
    moverMarcaPerfil(est);
    pintarTablero(a, est);
  }

  /* El tablero: dónde va, cómo es el camino y el estanque bajando. */
  function pintarTablero(a, est) {
    const r = a.r, o = opcionesCalculo(), p = est.pieza;
    const u = o.combustible.unidad, electrico = u === 'kWh';
    $('hudKm').textContent = GT.fmt(est.d / 1000, 1);
    $('hudTotal').textContent = GT.fmt(r.ida.km, 1);
    $('hudVel').textContent = GT.fmt(est.v * 3.6, 0) + ' km/h';
    $('hudVia').textContent = (p.nombre ? p.nombre + ' · ' : '') + V.TIPOS[p.tipo];
    $('hudAlt').textContent = GT.fmt(p.h, 0) + ' m';
    $('hudPend').textContent = (p.s >= 0 ? '+' : '−') + GT.fmt(Math.abs(p.s * 100), 1) + ' %';
    $('hudLitros').textContent = GT.fmt(est.litros, 2) + ' ' + u;
    $('hudCosto').textContent = pesos(Math.max(0, est.litros) * o.precio);
    $('hudHora').textContent = duracion(est.t);
    $('hudE').textContent = electrico ? '0' : 'E';
    $('hudF').textContent = electrico ? '100' : 'F';
    // Lo que pasa ahora: una parada, ripio, una subida o bajada fuerte.
    let evento = '';
    if (a.espera > performance.now() || a.terminado) evento = a.evento;
    else if (p.tipo === 'ripio') evento = 'Ripio o tierra';
    else if (p.s > 0.06) evento = 'Subida fuerte';
    else if (p.s < -0.06) evento = electrico ? 'Bajada: recupera carga' : 'Bajada fuerte';
    const ev = $('hudEvento');
    ev.textContent = evento || '';
    ev.hidden = !evento;
    // Aguja: de lleno (derecha) a vacío (izquierda), con el estanque lleno al salir.
    const queda = Math.max(0, Math.min(1, 1 - est.litros / o.vehiculo.estanque));
    $('hudAguja').setAttribute('transform', 'rotate(' + (-90 + 180 * queda).toFixed(1) + ' 50 50)');
  }

  /* ------------------------------------------------------------------------
     Arranque
     ------------------------------------------------------------------------ */

  function montarBotones() {
    $('vjAgregar').addEventListener('click', function () { armar(!S.armado); });
    $('vjOrdenar').addEventListener('click', ordenar);
    $('vjInvertir').addEventListener('click', function () {
      if (S.paradas.length < 2) return;
      S.paradas.reverse();
      cambioDeParadas();
    });
    $('vjBorrar').addEventListener('click', borrar);
    $('vjEjemplo').addEventListener('click', function () {
      cargar({ paradas: EJEMPLO, vuelta: true });
      avisar('Gira de ejemplo: tres predios ficticios en un orden malo a propósito. Pruebe "Ordenar para gastar menos".');
    });
    $('vjParadas').addEventListener('click', function (e) {
      const b = e.target.closest('[data-accion]');
      if (b) accionParada(b.dataset.accion, +b.dataset.i);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.armado) armar(false); });
    $('vjPlay').addEventListener('click', alternarRecorrido);
    $('vjLinea').addEventListener('input', function () {
      if (!S.rutas.length) return;
      const r = S.rutas[S.elegida];
      const t = r.ida.acum[r.ida.acum.length - 1].t * $('vjLinea').value / 1000;
      if (!S.anim) { S.anim = nuevaAnimacion(); $('vjHud').hidden = false; }
      S.anim.corriendo = false;
      S.anim.t = t; S.anim.terminado = t >= S.anim.T;
      dibujarCuadro(S.anim);
      botonRecorrer();
    });
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
    $('vjConsejos').addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.ruta !== undefined) elegir(+b.dataset.ruta);
      if (b.dataset.ripio) { $('vjRipio').checked = true; guardar(); buscarRuta(); }
    });
    $('vjComparar').addEventListener('click', function (e) {
      const b = e.target.closest('[data-veh]');
      if (!b) return;
      $('vjVehiculo').value = b.dataset.veh;
      $('vjVehiculo').dispatchEvent(new Event('change'));
    });
    $('vjIndicaciones').addEventListener('click', function (e) {
      const b = e.target.closest('.viaje__paso');
      if (!b || !S.mapa) return;
      const x = S.rutas[S.elegida].perfil.indicaciones[+b.dataset.i];
      S.mapa.flyTo({ center: x.p, zoom: 15.5, duration: 800 });
      mostrarCursor(x.p);
    });
    if (window.ResizeObserver) {
      let ancho = 0;
      new ResizeObserver(function (en) {
        const w = Math.round(en[0].contentRect.width);
        if (w && w !== ancho && S.rutas.length) { ancho = w; pintarPerfil(); }
      }).observe($('vjPerfil'));
    }
    // Quien pide menos movimiento ve el recorrido más corto.
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      S.ritmo = 4;
      $('vjRitmo').querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-active', x.dataset.valor === '4'); });
    }
  }

  /* El mapa llega después que el panel. Lo marcado antes —por la dirección
     o con el ejemplo— ya tiene su punto y quizás su ruta, pero todavía no
     sus marcadores. Si la ruta sigue en camino, se dibuja al llegar. */
  function montar(api) {
    prepararMapa(api);
    pintarMarcas();
    if (S.rutas.length) { pintarTodo(); encuadrarRuta(); }
    else if (S.desdePredio) {
      // Llegó desde "Mis predios" con solo el destino: se pide la salida.
      $('vjNota').textContent = 'Haga clic en el mapa o busque desde dónde sale';
      S.mapa.flyTo({ center: S.paradas[0].p, zoom: 10, duration: 800 });
    }
  }

  /* El panel y la búsqueda del camino no esperan al mapa: con un enlace
     compartido, el resultado puede estar listo antes que las teselas. */
  function iniciarPantalla() {
    montarControles();
    montarBotones();
    const u = leerDeUrl();
    if (typeof u.vuelta === 'boolean') $('vjVuelta').checked = u.vuelta;
    if (u.vehiculo) { $('vjVehiculo').value = u.vehiculo; llenarCombustibles($('vjCombustible').value); }
    u.puntos.forEach(function (p) {
      const comuna = comunaEn(p);
      if (comuna !== null) S.paradas.push({ p: p, comuna: comuna, nombre: '' });
    });
    if (u.soloLlegada && S.paradas.length === 1) {
      // Desde "Mis predios": ese punto es la llegada; falta la salida.
      S.desdePredio = true;
      S.paradas[0].nombre = 'Predio de llegada';
    }
    S.paradas.forEach(function (x) { if (!x.nombre) nombrar(x); });
    pintarParadas();
    pintarClima();
    pintarTodo();
    if (S.paradas.length >= 2) buscarRuta();
  }

  /* Lo que viajes-extras.js necesita: el viaje armado y cómo cambiarlo. */
  function datos() {
    const r = S.rutas[S.elegida];
    if (!r) return null;
    const o = opcionesCalculo();
    return {
      paradas: S.paradas.map(function (x, i) { return Object.assign({ letra: letra(i), rol: ROTULO[rol(i)] }, x); }),
      vuelta: $('vjVuelta').checked, vueltaInvertida: vueltaInvertida(),
      ruta: r, total: total(r), opciones: o, nombre: nombreViaje(),
      estilo: V.ESTILOS[S.estilo].nombre, clima: $('vjClima').checked ? S.clima : null,
      tramos: (r.vuelta ? [r.ida, r.vuelta].map(function (x, t) {
        return { rotulo: rotuloTramo(t), km: x.km, segundos: x.segundos, litros: x.litros };
      }) : r.ida.porTramo.map(function (x, t) {
        return { rotulo: rotuloTramo(t), km: x.m / 1000, segundos: x.segundos, litros: x.litros };
      })),
      mapa: S.mapa, duracion: duracion, pesos: pesos,
    };
  }

  return {
    iniciar: iniciarPantalla, montar: montar, comunaEn: comunaEn,
    agregarPunto: agregarPunto, cargar: cargar, datos: datos, avisar: avisar,
    encuadrar: encuadrarYEsperar,
    combustible: combustible,
  };
})();
