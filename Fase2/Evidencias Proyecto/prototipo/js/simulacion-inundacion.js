/* ==========================================================================
   TerraFoco — Simulación de lluvia en el visor de inundaciones

   La pestaña "Simulación de lluvia": se elige cuánto llueve, en cuánto
   tiempo, cómo cae y cómo estaba el suelo, y el mapa muestra hora a hora el
   agua que se acumula en la comuna abierta, con una nube que llueve encima
   mientras dura la lluvia. Las cifras —hectáreas bajo el agua, cultivo,
   personas, servicios— siguen a la animación.

   Las cuentas están en simulacion-lluvia.js. Aquí: los controles, la capa de
   agua (un lienzo del tamaño de la grilla de 30 m, puesto sobre el mapa por
   sus cuatro esquinas), la nube y el gráfico.
   ========================================================================== */

const GTSimInundacion = (function () {
  'use strict';

  const DURACIONES = [1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60, 72, 96, 120, 144, 168];
  const ESCENARIOS = [
    { id: 'moderada', nombre: 'Lluvia moderada', total: 30, horas: 24, patron: 'pareja', humedad: 'normal' },
    { id: 'temporal', nombre: 'Temporal', total: 80, horas: 24, patron: 'chubascos', humedad: 'normal' },
    { id: 'frontal', nombre: 'Sistema frontal intenso', total: 150, horas: 48, patron: 'chubascos', humedad: 'saturado' },
    { id: 'tormenta', nombre: 'Tormenta concentrada', total: 60, horas: 6, patron: 'concentrada', humedad: 'normal' },
    { id: 'extremo', nombre: 'Evento extremo', total: 250, horas: 72, patron: 'chubascos', humedad: 'saturado' },
  ];
  const ID_FUENTE = 'sim-agua-fuente', ID_CAPA = 'sim-agua-capa';
  const GOTAS = 28;
  const SEGUNDOS_ANIMACION = 22;      // lo que dura la reproducción a velocidad 1

  const P = {                         // parámetros elegidos
    total: 80, horas: 24, patron: 'chubascos', humedad: 'normal',
    suelo: 'B', drenaje: 'normal', lamina: 0.5, diarios: null, escenario: 'temporal',
  };
  const S = {
    api: null, mapa: null, detalle: null, el: null,
    preparado: null,                  // por comuna: cn, orden, acumulador...
    sim: null, t: 0, reproduciendo: false, velocidad: 1, ultimo: 0, cuadro: null,
    lienzo: null, ctx: null, imagen: null, pixeles: null, pintadas: 0,
    nube: null, marcadorNube: null, visible: true, activa: false,
  };

  function $(id) { return document.getElementById(id); }
  function fmt(n, d) { return GT.fmt(n, d || 0); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function textoHoras(h) {
    if (h < 24) return h + ' h';
    const d = h / 24;
    return (Number.isInteger(d) ? d : GT.fmt(d, 1)) + (d === 1 ? ' día' : ' días');
  }
  function reloj(hora) {
    const dia = Math.floor((hora - 1) / 24) + 1, h = (hora - 1) % 24;
    return 'Día ' + dia + ' · ' + String(h).padStart(2, '0') + ':00';
  }
  function m3(v) {
    return v >= 1e6 ? fmt(v / 1e6, 1) + ' millones de m³' : fmt(v) + ' m³';
  }

  /* ---------------------------------------------------------------------
     Arranque
     --------------------------------------------------------------------- */

  function iniciar(api, contenedor) {
    S.api = api || {};
    S.el = contenedor;
    S.mapa = S.api.instancia || null;
    S.detalle = S.api.detalle ? S.api.detalle('inundacion') : null;
    montarPestanas();
    montarControles();
    if (!S.mapa || !S.detalle) {
      $('simNota').textContent = 'necesita el mapa real';
      $('simIniciar').disabled = true;
      return;
    }
    contenedor.addEventListener('detalle:base', function () { S.preparado = null; limpiar(); pintarEstado(); });
    contenedor.addEventListener('detalle:resumen', function (e) {
      if (!e.detail) { S.preparado = null; limpiar(); }
      pintarEstado();
    });
    pintarEstado();
  }

  /* Pestañas "Riesgo | Simulación" de la columna junto al mapa. */
  function montarPestanas() {
    const barra = $('pestanas');
    if (!barra) return;
    barra.addEventListener('click', function (e) {
      const b = e.target.closest('button[data-pestana]');
      if (!b) return;
      const cual = b.getAttribute('data-pestana');
      barra.querySelectorAll('button').forEach(function (x) {
        const si = x === b;
        x.classList.toggle('is-active', si);
        x.setAttribute('aria-selected', si ? 'true' : 'false');
      });
      document.querySelectorAll('[data-panel]').forEach(function (p) {
        p.hidden = p.getAttribute('data-panel') !== cual;
      });
      // Fuera de la pestaña, el agua y la nube se esconden (no se pierden).
      mostrar(cual === 'simulacion');
    });
  }

  /* ---------------------------------------------------------------------
     Controles
     --------------------------------------------------------------------- */

  function montarControles() {
    const caja = $('simEscenarios');
    caja.innerHTML = ESCENARIOS.map(function (e) {
      return '<button type="button" class="chip-boton" data-escenario="' + e.id + '" title="' +
             e.total + ' mm en ' + textoHoras(e.horas) + '">' + esc(e.nombre) +
             '<span>' + e.total + ' mm · ' + textoHoras(e.horas) + '</span></button>';
    }).join('') +
      '<button type="button" class="chip-boton" data-escenario="pronostico" disabled ' +
      'title="La lluvia pronosticada para los próximos 7 días en esta comuna (Open-Meteo)">' +
      'Pronóstico de esta semana<span id="simPronosticoMm">sin datos</span></button>';
    caja.addEventListener('click', function (e) {
      const b = e.target.closest('button[data-escenario]');
      if (!b || b.disabled) return;
      elegirEscenario(b.getAttribute('data-escenario'));
    });

    const total = $('simTotal'), dur = $('simDuracion'), lam = $('simLamina');
    dur.max = DURACIONES.length - 1;
    total.addEventListener('input', function () { P.total = +total.value; P.diarios = null; marcarManual(); pintarEntrada(); });
    dur.addEventListener('input', function () { P.horas = DURACIONES[+dur.value]; P.diarios = null; marcarManual(); pintarEntrada(); });
    lam.addEventListener('input', function () { P.lamina = +lam.value; pintarEntrada(); });
    [['simPatron', 'patron'], ['simHumedad', 'humedad'], ['simSuelo', 'suelo'], ['simDrenaje', 'drenaje']]
      .forEach(function (par) {
        $(par[0]).addEventListener('click', function (e) {
          const b = e.target.closest('button[data-valor]');
          if (!b) return;
          P[par[1]] = b.getAttribute('data-valor');
          if (par[1] === 'patron') { P.diarios = null; marcarManual(); }
          pintarEntrada();
        });
      });
    $('simIniciar').addEventListener('click', function () { simular(); });
    $('simPausa').addEventListener('click', function () { S.reproduciendo ? pausar() : reproducir(); });
    $('simVelocidad').addEventListener('click', function () {
      S.velocidad = S.velocidad >= 4 ? 1 : S.velocidad * 2;
      $('simVelocidad').textContent = '×' + S.velocidad;
    });
    $('simLimpiar').addEventListener('click', function () { limpiar(); pintarEstado(); });
    $('simCsv').addEventListener('click', descargarCsv);
    elegirEscenario('temporal');
  }

  function elegirEscenario(id) {
    P.escenario = id;
    if (id === 'pronostico') {
      const p = lluviaPronosticada();
      if (!p) return;
      P.diarios = p.precipitacion.slice();
      P.total = Math.round(p.total_7d);
      P.patron = 'diaria';
    } else {
      const e = ESCENARIOS.filter(function (x) { return x.id === id; })[0];
      P.total = e.total; P.horas = e.horas; P.patron = e.patron; P.humedad = e.humedad; P.diarios = null;
    }
    pintarEntrada();
  }

  function marcarManual() { P.escenario = null; if (P.patron === 'diaria') P.patron = 'pareja'; }

  function lluviaPronosticada() {
    const ctx = GTInundacion.contexto();
    if (!ctx.pronostico || !ctx.comuna) return null;
    const b = GTCalculo.normalizar(ctx.comuna);
    return ctx.pronostico.comunas.filter(function (c) { return GTCalculo.normalizar(c.nombre) === b; })[0] || null;
  }

  function lluviaPorHora() {
    return GTSimLluvia.hietograma(P.total, P.horas, P.patron, P.diarios);
  }

  /* Refleja los parámetros en los controles y dice qué lluvia resulta. */
  function pintarEntrada() {
    const lluvia = lluviaPorHora();
    const horas = lluvia.length, maxima = Math.max.apply(null, lluvia);
    $('simTotal').value = Math.min(400, P.total);
    $('simTotalValor').textContent = fmt(P.total) + ' mm';
    const k = DURACIONES.reduce(function (m, h, i) {
      return Math.abs(h - horas) < Math.abs(DURACIONES[m] - horas) ? i : m;
    }, 0);
    $('simDuracion').value = k;
    $('simDuracion').disabled = P.patron === 'diaria';
    $('simDuracionValor').textContent = textoHoras(horas);
    $('simLamina').value = P.lamina;
    $('simLaminaValor').textContent = GT.fmt(P.lamina, 1) + ' m';
    [['simPatron', 'patron'], ['simHumedad', 'humedad'], ['simSuelo', 'suelo'], ['simDrenaje', 'drenaje']]
      .forEach(function (par) {
        $(par[0]).querySelectorAll('button[data-valor]').forEach(function (b) {
          b.classList.toggle('is-active', b.getAttribute('data-valor') === P[par[1]]);
        });
      });
    document.querySelectorAll('#simEscenarios button[data-escenario]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-escenario') === P.escenario);
    });
    $('simEntrada').innerHTML = 'Intensidad máxima <strong>' + GT.fmt(maxima, 1) + ' mm/h</strong> · ' +
      'promedio ' + GT.fmt(P.total / horas, 1) + ' mm/h' +
      (P.patron === 'diaria' ? ' · repartida según el pronóstico de cada día' : '');
  }

  /* Qué se puede hacer según lo que haya cargado. */
  function pintarEstado() {
    const ctx = GTInundacion.contexto();
    const base = S.detalle && S.detalle.base();
    const p = lluviaPronosticada();
    const bp = document.querySelector('#simEscenarios [data-escenario="pronostico"]');
    if (bp) {
      bp.disabled = !p;
      $('simPronosticoMm').textContent = p ? fmt(p.total_7d) + ' mm · 7 días' : 'sin datos';
    }
    if (!ctx.comuna || !base) {
      $('simNota').textContent = 'elige una comuna en el mapa';
      $('simIniciar').disabled = true;
      return;
    }
    if (!base.valores) {
      $('simNota').textContent = ctx.comuna + ' · sin el índice continuo';
      $('simIniciar').disabled = true;
      $('simCifras').innerHTML = '<p class="small muted" style="margin:0">La simulación necesita las teselas ' +
        'del índice a 30 m (datos/teselas/inundacion.pmtiles); sin ellas el mapa usa imágenes por comuna.</p>';
      return;
    }
    $('simNota').textContent = ctx.comuna;
    $('simIniciar').disabled = false;
  }

  /* ---------------------------------------------------------------------
     Preparar la comuna y simular
     --------------------------------------------------------------------- */

  function preparar() {
    const ctx = GTInundacion.contexto();
    const base = S.detalle.base();
    const N = base.ancho * base.alto;
    const dentro = new Uint8Array(N);
    for (let i = 0; i < N; i++) dentro[i] = base.original[i] !== 255 && base.valores[i] === base.valores[i] ? 1 : 0;
    const haCelda = GTCalculo.haPorCelda(base);
    const modelo = ctx.modelo;
    const cn = GTSimLluvia.numerosDeCurva({
      N: N, dentro: dentro, grilla: ctx.grilla, agr: ctx.agr, pob: ctx.pob,
      variables: modelo ? modelo.variables : null, pasos: modelo ? modelo.pasos : 254,
    }, P);
    const orden = GTSimLluvia.ordenarCeldas(base.valores, dentro);

    // Lo expuesto en cada celda, para sumarlo a medida que el agua avanza.
    const capas = {};
    if (ctx.agr) {
      const c = ctx.agr.cultivo, p = ctx.agr.pradera, f = haCelda / 100;
      capas.cultivo = function (i) { return c[i] ? (c[i] - 1) * f : 0; };
      capas.pradera = function (i) { return p[i] ? (p[i] - 1) * f : 0; };
    }
    if (ctx.pob) {
      const pe = ctx.pob.personas, vi = ctx.pob.viviendas, ru = ctx.pob.rurales;
      capas.personas = function (i) { return pe[i]; };
      capas.viviendas = function (i) { return vi[i]; };
      if (ru) capas.rurales = function (i) { return ru[i]; };
    }
    const equipos = new Map();
    (ctx.equipo || []).forEach(function (e, k) {
      if (!e.dentro) return;
      if (!equipos.has(e.i)) equipos.set(e.i, []);
      equipos.get(e.i).push(k);
    });
    const zonas = S.detalle.zonas();
    const nZonas = zonas ? zonas.lista.length : 0;
    const totalZona = new Float64Array(nZonas);
    if (zonas) for (let i = 0; i < N; i++) { const z = zonas.indice[i]; if (z && dentro[i]) totalZona[z - 1]++; }

    return {
      comuna: ctx.comuna, base: base, N: N, dentro: dentro, haCelda: haCelda, cn: cn, orden: orden,
      capas: capas, equipos: equipos, equipo: ctx.equipo || [], zonas: zonas, totalZona: totalZona,
      completo: !!(ctx.agr && ctx.pob && ctx.grilla), anioPoblacion: ctx.anioPoblacion,
      acumulador: new GTSimLluvia.Acumulador(orden, capas, haCelda, zonas && zonas.indice, nZonas, equipos),
      clave: [ctx.comuna, !!ctx.agr, !!ctx.pob, !!ctx.grilla, (ctx.equipo || []).length, P.suelo, P.humedad].join('|'),
    };
  }

  function simular() {
    const ctx = GTInundacion.contexto();
    if (!ctx.comuna || !S.detalle.base() || !S.detalle.base().valores) return;
    const clave = [ctx.comuna, !!ctx.agr, !!ctx.pob, !!ctx.grilla, (ctx.equipo || []).length, P.suelo, P.humedad].join('|');
    if (!S.preparado || S.preparado.clave !== clave) S.preparado = preparar();
    const pr = S.preparado;
    const sim = GTSimLluvia.simular({
      cn: pr.cn.cn, dentro: pr.dentro, haCelda: pr.haCelda, celdasValidas: pr.orden.length,
      lluvia: lluviaPorHora(), drenaje: P.drenaje, lamina: P.lamina,
    });
    // Lo expuesto en cada hora, para el gráfico y el máximo.
    sim.pasos.forEach(function (p) { p.exp = pr.acumulador.mover(p.celdas); });
    sim.parametros = Object.assign({}, P);
    S.sim = sim;
    S.activa = true;
    asegurarCapa();
    asegurarNube();
    S.detalle.opacidad(0.18);
    mostrar(true);
    dibujarGrafico();
    pintarMaximo();
    $('simResultado').hidden = false;
    S.t = 0;
    irA(0);
    reproducir();
  }

  /* ---------------------------------------------------------------------
     Reproducción
     --------------------------------------------------------------------- */

  function reproducir() {
    if (!S.sim) return;
    if (S.t >= S.sim.pasos.length - 1) S.t = 0;
    S.reproduciendo = true;
    $('simPausa').textContent = 'Pausa';
    $('simPausa').disabled = false;
    S.ultimo = performance.now();
    if (S.lienzo && S.mapa.getSource(ID_FUENTE)) S.mapa.getSource(ID_FUENTE).play();
    const paso = function (ahora) {
      if (!S.reproduciendo) return;
      // La marca del cuadro puede ser anterior al performance.now() que se
      // tomó al apretar Iniciar: sin el piso en 0, el primer paso iba a la
      // hora −0,01 y no había paso que mostrar.
      const dt = Math.max(0, Math.min(0.25, (ahora - S.ultimo) / 1000));
      S.ultimo = ahora;
      const porSegundo = S.sim.pasos.length / SEGUNDOS_ANIMACION * S.velocidad;
      S.t = Math.min(S.sim.pasos.length - 1, S.t + dt * porSegundo);
      irA(S.t);
      if (S.t >= S.sim.pasos.length - 1) { pausar(); return; }
      S.cuadro = requestAnimationFrame(paso);
    };
    S.cuadro = requestAnimationFrame(paso);
  }

  function pausar() {
    S.reproduciendo = false;
    if (S.cuadro) cancelAnimationFrame(S.cuadro);
    $('simPausa').textContent = S.sim && S.t >= S.sim.pasos.length - 1 ? 'Repetir' : 'Seguir';
    refrescarLienzo();
  }

  /* Muestra el instante t (en horas desde el inicio, fraccionario). */
  function irA(t) {
    const sim = S.sim;
    if (!sim || !sim.pasos.length) return;
    t = Math.max(0, Math.min(sim.pasos.length - 1, t || 0));
    const a = sim.pasos[Math.floor(t)], b = sim.pasos[Math.min(sim.pasos.length - 1, Math.floor(t) + 1)];
    const f = t - Math.floor(t);
    const celdas = Math.round(a.celdas + (b.celdas - a.celdas) * f);
    const exp = S.preparado.acumulador.mover(celdas);
    pintarAgua(celdas);
    pintarNube(a);
    pintarCifras(a, exp);
    moverCursor(t);
  }

  /* ---------------------------------------------------------------------
     La capa de agua
     --------------------------------------------------------------------- */

  function colorAgua() {
    // Los cuatro tonos más intensos de la rampa del agua: el último es lo
    // más hondo en los dos temas.
    const r = PALETA.rampas.agua;
    return [r[1], r[2], r[3], r[4]].map(function (hex, k) {
      const n = parseInt(hex.slice(1), 16);
      const alfa = [150, 185, 215, 235][k];
      return (alfa << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255);
    });
  }

  function asegurarCapa() {
    const base = S.preparado.base;
    if (!S.lienzo || S.lienzo.width !== base.ancho || S.lienzo.height !== base.alto) {
      S.lienzo = document.createElement('canvas');
      S.lienzo.width = base.ancho; S.lienzo.height = base.alto;
      S.ctx = S.lienzo.getContext('2d');
      S.imagen = S.ctx.createImageData(base.ancho, base.alto);
      S.pixeles = new Uint32Array(S.imagen.data.buffer);
      S.pintadas = 0;
      quitarCapa();
    }
    S.pixeles.fill(0);
    S.pintadas = 0;
    S.colores = colorAgua();
    if (!S.mapa.getSource(ID_FUENTE)) {
      S.mapa.addSource(ID_FUENTE, { type: 'canvas', canvas: S.lienzo, animate: false,
                                    coordinates: base.esquinas.map(function (c) { return [c[0], c[1]]; }) });
      const capas = S.mapa.getStyle().layers;
      const rotulos = capas.filter(function (l) { return l.type === 'symbol'; })[0];
      S.mapa.addLayer({ id: ID_CAPA, type: 'raster', source: ID_FUENTE,
                        paint: { 'raster-opacity': 0.95, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } },
                      rotulos ? rotulos.id : undefined);
    }
  }

  function pintarAgua(celdas) {
    if (!S.pixeles) return;
    const orden = S.preparado.orden, px = S.pixeles, col = S.colores;
    // Las primeras celdas del orden son las más hondas; el tono va por
    // cuartos de lo anegado.
    for (let r = 0; r < celdas; r++) {
      const q = r / celdas;
      px[orden[r]] = col[q < 0.25 ? 3 : q < 0.5 ? 2 : q < 0.75 ? 1 : 0];
    }
    for (let r = celdas; r < S.pintadas; r++) px[orden[r]] = 0;
    S.pintadas = celdas;
    S.ctx.putImageData(S.imagen, 0, 0);
    if (!S.reproduciendo) refrescarLienzo();
  }

  /* La fuente de lienzo solo sube la imagen a la tarjeta de video mientras
     "reproduce": fuera de la animación se le da un cuadro y se detiene. */
  function refrescarLienzo() {
    const f = S.mapa && S.mapa.getSource(ID_FUENTE);
    if (!f) return;
    f.play();
    S.mapa.once('render', function () { if (!S.reproduciendo) f.pause(); });
    S.mapa.triggerRepaint();
  }

  function quitarCapa() {
    if (!S.mapa) return;
    if (S.mapa.getLayer(ID_CAPA)) S.mapa.removeLayer(ID_CAPA);
    if (S.mapa.getSource(ID_FUENTE)) S.mapa.removeSource(ID_FUENTE);
  }

  /* ---------------------------------------------------------------------
     La nube
     --------------------------------------------------------------------- */

  function asegurarNube() {
    if (S.marcadorNube) S.marcadorNube.remove();
    const el = document.createElement('div');
    el.className = 'nube';
    el.setAttribute('aria-hidden', 'true');
    let gotas = '';
    for (let k = 0; k < GOTAS; k++) {
      gotas += '<i style="left:' + (8 + (k * 37) % 84) + '%;animation-delay:-' +
               ((k * 0.137) % 1).toFixed(2) + 's"></i>';
    }
    el.innerHTML = '<div class="nube__cuerpo">' +
      '<div class="nube__lluvia">' + gotas + '</div>' +
      '<svg class="nube__forma" viewBox="0 0 120 62" aria-hidden="true">' +
        '<path d="M30 58h62a20 20 0 0 0 2-39.9A26 26 0 0 0 45.5 12 18 18 0 0 0 28 26.5 16 16 0 0 0 30 58z"/>' +
      '</svg>' +
      '<div class="nube__rotulo"></div></div>';
    S.nube = el;
    const lugar = lugarNube();
    S.marcadorNube = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(lugar).addTo(S.mapa);
  }

  /* Sobre la comuna: el punto representativo del pronóstico (siempre cae
     dentro) o, si no está, el centro de lo que se anega primero. */
  function lugarNube() {
    const p = lluviaPronosticada();
    if (p && p.lon && p.lat) return [p.lon, p.lat];
    const pr = S.preparado, b = pr.base, n = Math.min(pr.orden.length, 2000);
    let sx = 0, sy = 0;
    for (let r = 0; r < n; r++) { sx += pr.orden[r] % b.ancho; sy += Math.floor(pr.orden[r] / b.ancho); }
    const x = sx / Math.max(1, n) / b.ancho, y = sy / Math.max(1, n) / b.alto;
    const e = b.esquinas, yN = GTDetalle.mercY(e[0][1]), yS = GTDetalle.mercY(e[2][1]);
    return [e[0][0] + x * (e[1][0] - e[0][0]), GTDetalle.latDeMerc(yN - y * (yN - yS))];
  }

  function pintarNube(paso) {
    const el = S.nube;
    if (!el) return;
    const sim = S.sim, i = paso.lluvia;
    const f = sim.intensidadMaxima ? Math.min(1, i / Math.max(4, sim.intensidadMaxima)) : 0;
    const llueve = i > 0.05;
    el.classList.toggle('nube--seca', !llueve);
    el.style.setProperty('--fuerza', f.toFixed(2));
    el.style.setProperty('--caida', (0.9 - 0.45 * f).toFixed(2) + 's');
    const visibles = llueve ? Math.max(4, Math.round(GOTAS * (0.25 + 0.75 * f))) : 0;
    const gotas = el.querySelectorAll('.nube__lluvia i');
    for (let k = 0; k < gotas.length; k++) gotas[k].style.display = k < visibles ? '' : 'none';
    el.querySelector('.nube__rotulo').textContent = llueve ? GT.fmt(i, 1) + ' mm/h' : 'escurriendo';
  }

  /* ---------------------------------------------------------------------
     Cifras, gráfico y resumen
     --------------------------------------------------------------------- */

  function cifra(valor, rotulo, sub) {
    return '<div class="cifra"><span class="cifra__valor">' + valor + '</span>' +
           '<span class="cifra__rotulo">' + rotulo + '</span>' +
           (sub ? '<span class="tiny muted">' + sub + '</span>' : '') + '</div>';
  }

  function pintarCifras(paso, exp) {
    const sim = S.sim, pr = S.preparado;
    const llueve = paso.hora <= sim.horasLluvia;
    $('simReloj').innerHTML = '<strong>' + reloj(paso.hora) + '</strong>' +
      '<span class="muted"> · ' + (llueve ? 'lloviendo ' + GT.fmt(paso.lluvia, 1) + ' mm/h' :
        'paró de llover hace ' + (paso.hora - sim.horasLluvia) + ' h') + '</span>';
    const fr = pr.orden.length ? exp.celdas / pr.orden.length : 0;
    let html = '<div class="cifras">' +
      cifra(fmt(paso.acumulada) + ' mm', 'de lluvia caída', 'de ' + fmt(sim.total) + ' mm') +
      cifra('≈ ' + fmt(exp.ha) + ' ha', 'bajo el agua', GT.fmt(100 * fr, 1) + ' % de la comuna');
    if (exp.cultivo !== undefined) {
      html += cifra('≈ ' + fmt(exp.cultivo) + ' ha', 'de cultivo anegado') +
              cifra('≈ ' + fmt(exp.pradera) + ' ha', 'de pradera anegada');
    }
    if (exp.personas !== undefined) {
      html += cifra('≈ ' + fmt(exp.personas), 'personas con agua en su sector',
                    exp.rurales !== undefined ? '≈ ' + fmt(exp.rurales) + ' en el campo' : '') +
              cifra('≈ ' + fmt(exp.viviendas), 'viviendas');
    }
    html += cifra(fmt(paso.escurridaMm, 1) + ' mm', 'escurrieron', 'lo demás se infiltró') +
            cifra(m3(paso.retenida), 'de agua retenida', m3(paso.evacuada) + ' ya evacuados');
    html += '</div>';
    // Servicios y localidades: lo que queda bajo el agua en este momento.
    const equipos = exp.equipos.map(function (k) { return pr.equipo[k]; }).filter(Boolean);
    if (equipos.length) {
      html += '<div class="sim__lista"><div class="sim__lista-cab">Servicios con agua alrededor</div>' +
        equipos.slice(0, 6).map(function (e) {
          const p = e.f.properties || {};
          const tipos = GTInundacion.contexto().tipos || {};
          return '<div>' + esc(p.nombre || 'sin nombre') + ' <span class="muted">· ' + esc(tipos[p.tipo] || p.tipo || '') + '</span></div>';
        }).join('') + (equipos.length > 6 ? '<div class="muted">y ' + (equipos.length - 6) + ' más</div>' : '') + '</div>';
    }
    if (pr.zonas && pr.zonas.lista.length) {
      const loc = [];
      pr.zonas.lista.forEach(function (f, k) {
        if (exp.zonas[k] > 0 && pr.totalZona[k]) loc.push({ nombre: f.properties.nombre, f: exp.zonas[k] / pr.totalZona[k] });
      });
      loc.sort(function (a, b) { return b.f - a.f; });
      if (loc.length) {
        html += '<div class="sim__lista"><div class="sim__lista-cab">Ciudades y pueblos con agua</div>' +
          loc.slice(0, 5).map(function (l) {
            return '<div>' + esc(l.nombre) + ' <span class="muted">· ' + GT.fmt(100 * l.f, 1) + ' % de su área</span></div>';
          }).join('') + '</div>';
      }
    }
    $('simCifras').innerHTML = html;
  }

  function pintarMaximo() {
    const sim = S.sim, m = sim.maximo, e = m.exp, pr = S.preparado;
    const partes = ['el agua llega a su máximo en la <strong>hora ' + m.hora + '</strong> (' + reloj(m.hora).toLowerCase() + '): ' +
                    '<strong>≈ ' + fmt(e.ha) + ' ha</strong> bajo el agua'];
    if (e.cultivo !== undefined) partes.push(fmt(e.cultivo) + ' ha de cultivo y ' + fmt(e.pradera) + ' de pradera');
    if (e.personas !== undefined) partes.push('≈ ' + fmt(e.personas) + ' personas en los sectores con agua');
    if (e.equipos.length) partes.push(e.equipos.length + ' servicios (escuelas, salud o emergencia)');
    const cn = pr.cn, mz = cn.mezcla;
    $('simMaximo').innerHTML = 'Con ' + fmt(sim.total) + ' mm en ' + textoHoras(sim.horasLluvia) + ', ' +
      partes.join(', ') + '. El agua demora ' + (sim.pasos.length - m.hora) + ' h más en escurrir.' +
      '<div class="tiny muted" style="margin-top:4px">Número de curva medio ' +
        GT.fmt(media(cn.cn, pr.dentro), 0) + ' (suelo ' + sim.parametros.suelo + ', ' +
        ({ seco: 'seco', normal: 'humedad normal', saturado: 'saturado' })[sim.parametros.humedad] + '): ' +
        GT.fmt(100 * mz.cultivo, 0) + ' % cultivo, ' + GT.fmt(100 * mz.pradera, 0) + ' % pradera, ' +
        GT.fmt(100 * mz.urbano, 0) + ' % ciudad, ' + GT.fmt(100 * (mz.arbolado + mz.matorral), 0) + ' % vegetación.' +
        (cn.falta.length ? ' Faltó ' + cn.falta.join(' y ') + ': esa parte usa una mezcla típica del valle.' : '') +
      '</div>';
  }

  function media(arr, dentro) {
    let s = 0, n = 0;
    for (let i = 0; i < arr.length; i++) if (dentro[i]) { s += arr[i]; n++; }
    return n ? s / n : 0;
  }

  /* Gráfico: la lluvia cae desde arriba (mm/h) y el área anegada sube desde
     abajo (ha). Clic o arrastre para ir a una hora. */
  function dibujarGrafico() {
    const sim = S.sim, n = sim.pasos.length, W = 320, H = 110, arriba = 38, abajo = 66;
    const maxLluvia = Math.max(1, sim.intensidadMaxima), maxHa = Math.max(1, sim.maximo.exp.ha);
    const ancho = W / n;
    let barras = '', linea = '';
    sim.pasos.forEach(function (p, k) {
      const h = arriba * p.lluvia / maxLluvia;
      if (h > 0.2) barras += '<rect x="' + (k * ancho).toFixed(2) + '" y="0" width="' + Math.max(0.6, ancho - 0.3).toFixed(2) +
                             '" height="' + h.toFixed(2) + '"/>';
      const y = H - abajo * p.exp.ha / maxHa;
      linea += (k ? 'L' : 'M') + ((k + 0.5) * ancho).toFixed(2) + ' ' + y.toFixed(2);
    });
    const area = linea + 'L' + ((n - 0.5) * ancho).toFixed(2) + ' ' + H + 'L' + (0.5 * ancho).toFixed(2) + ' ' + H + 'Z';
    const dias = [];
    for (let d = 24; d < n; d += 24) dias.push('<line class="sim__dia" x1="' + (d * ancho).toFixed(1) + '" x2="' + (d * ancho).toFixed(1) + '" y1="0" y2="' + H + '"/>');
    $('simGrafico').innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" ' +
      'aria-label="Lluvia por hora y área bajo el agua durante la simulación">' + dias.join('') +
      '<g class="sim__barras">' + barras + '</g>' +
      '<path class="sim__area" d="' + area + '"/><path class="sim__linea" d="' + linea + '"/>' +
      '<line id="simCursor" class="sim__cursor" x1="0" x2="0" y1="0" y2="' + H + '"/></svg>' +
      '<div class="sim__eje"><span>lluvia · máx ' + GT.fmt(sim.intensidadMaxima, 1) + ' mm/h</span>' +
      '<span>' + textoHoras(n) + '</span><span>bajo el agua · máx ' + fmt(maxHa) + ' ha</span></div>';
    const svg = $('simGrafico').querySelector('svg');
    const ir = function (e) {
      const r = svg.getBoundingClientRect();
      const t = Math.max(0, Math.min(n - 1, (e.clientX - r.left) / r.width * n - 0.5));
      pausar();
      S.t = t;
      irA(t);
    };
    svg.addEventListener('pointerdown', function (e) {
      ir(e);
      const mover = function (ev) { ir(ev); };
      svg.addEventListener('pointermove', mover);
      window.addEventListener('pointerup', function () { svg.removeEventListener('pointermove', mover); }, { once: true });
    });
  }

  function moverCursor(t) {
    const c = $('simCursor');
    if (!c || !S.sim) return;
    const x = (t + 0.5) / S.sim.pasos.length * 320;
    c.setAttribute('x1', x.toFixed(2)); c.setAttribute('x2', x.toFixed(2));
  }

  /* ---------------------------------------------------------------------
     Mostrar, esconder, limpiar, exportar
     --------------------------------------------------------------------- */

  function mostrar(si) {
    S.visible = si;
    if (!S.activa) return;
    if (S.mapa.getLayer(ID_CAPA)) S.mapa.setLayoutProperty(ID_CAPA, 'visibility', si ? 'visible' : 'none');
    if (S.nube) S.nube.style.display = si ? '' : 'none';
    S.detalle.opacidad(si ? 0.18 : 1);
    if (!si && S.reproduciendo) pausar();
  }

  function limpiar() {
    if (S.reproduciendo) pausar();
    S.sim = null;
    if (S.activa && S.detalle) S.detalle.opacidad(1);
    S.activa = false;
    quitarCapa();
    S.lienzo = null; S.pixeles = null; S.pintadas = 0;
    if (S.marcadorNube) { S.marcadorNube.remove(); S.marcadorNube = null; S.nube = null; }
    if ($('simResultado')) $('simResultado').hidden = true;
    if ($('simPausa')) { $('simPausa').disabled = true; $('simPausa').textContent = 'Pausa'; }
  }

  function descargarCsv() {
    const sim = S.sim;
    if (!sim) return;
    const P2 = sim.parametros;
    const num = function (v, d) { return v === undefined ? '' : GT.fmt(v, d || 0).replace(/\./g, ''); };
    const filas = ['hora;lluvia_mm;lluvia_acumulada_mm;escorrentia_mm;agua_retenida_m3;agua_evacuada_m3;' +
                   'ha_bajo_agua;ha_cultivo;ha_pradera;personas;viviendas;servicios'];
    sim.pasos.forEach(function (p) {
      const e = p.exp;
      filas.push([p.hora, num(p.lluvia, 2), num(p.acumulada, 1), num(p.escurridaMm, 2), num(p.retenida),
                  num(p.evacuada), num(e.ha, 1), num(e.cultivo, 1), num(e.pradera, 1), num(e.personas),
                  num(e.viviendas), e.equipos.length].join(';'));
    });
    const notas = ['# TerraFoco · simulación de lluvia · ' + S.preparado.comuna,
                   '# ' + fmt(sim.total) + ' mm en ' + textoHoras(sim.horasLluvia) + ', lluvia ' + P2.patron +
                   ', suelo ' + P2.suelo + ' ' + P2.humedad + ', drenaje ' + P2.drenaje + ' (k = ' + sim.k + ' h), lámina ' +
                   GT.fmt(sim.lamina, 1) + ' m',
                   '# Escenario: número de curva (USDA-NRCS TR-55) + embalse lineal + orden del índice de susceptibilidad. ' +
                   'No es un pronóstico ni un modelo hidráulico.'];
    const texto = '﻿' + notas.join('\n') + '\n' + filas.join('\r\n');
    GTZonas.descargar('simulacion_lluvia_' + GTZonas.archivo(S.preparado.comuna) + '.csv', texto, 'text/csv;charset=utf-8');
  }

  return { iniciar: iniciar, simular: simular, limpiar: limpiar, parametros: P };
})();
