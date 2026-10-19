/* ==========================================================================
   TerraFoco — Visor de inundaciones

   La página responde, para la comuna abierta, cuatro preguntas en orden:

     1. ¿Qué parte del territorio se marca como riesgo?  El umbral, con el
        histograma del índice dentro de la comuna.
     2. ¿Qué queda encima?  Ciudades y pueblos, personas y viviendas (Censo
        2017 por manzana) y equipamiento crítico (OpenStreetMap).
     3. ¿Por qué esta celda?  Al hacer clic dentro de la comuna, las seis
        variables de esa celda y cuánto aporta cada una a su índice.
     4. ¿Y con otros pesos?  El explorador recalcula el índice y su validación
        contra los eventos para cualquier juego, y lo puede pintar en el mapa.

   Además: la red hídrica y el equipamiento sobre el mapa, la lluvia
   pronosticada por comuna (Open-Meteo), un buscador de comunas y
   localidades, un enlace que reabre la vista tal cual y la exportación
   (informe imprimible, CSV, imagen del mapa).

   Las cuentas viven en inundacion-calculo.js; aquí solo la interfaz.
   ========================================================================== */

const GTInundacion = (function () {
  'use strict';

  const SIN = 255;
  const RUTA_VARIABLES = 'datos/inundacion/variables.json';
  const TESELAS_VARIABLES = 'datos/teselas/inundacion_variables.pmtiles';
  const TESELAS_AGRICOLA = 'datos/teselas/agricola.pmtiles';

  const CATEGORIAS = {
    educacion:  { nombre: 'Educación',  color: PALETA.ambar },
    salud:      { nombre: 'Salud',      color: PALETA.rojo },
    emergencia: { nombre: 'Emergencia', color: PALETA.tinta },
  };
  const TIPOS = {
    school: 'Escuela o colegio', kindergarten: 'Jardín infantil', college: 'Instituto',
    university: 'Universidad', hospital: 'Hospital', clinic: 'Centro de salud',
    doctors: 'Consulta médica', fire_station: 'Bomberos', police: 'Policía',
    ambulance_station: 'Base de ambulancias',
  };
  const CLASES = ['Baja', 'Media', 'Alta', 'Muy alta'];

  const S = {
    api: null, mapa: null, detalle: null, el: null,
    modelo: null, promesaModelo: null,
    archivoVars: null,
    grilla: null, dentro: null, pedido: 0,
    archivoAgr: null, agr: null, anioPoblacion: null,
    pob: null, cobertura: null,
    equipo: null, promesaEquipo: null, equipoComuna: [],
    resumen: null, info: null,
    pesos: null, pesosMapa: null, enMapa: false,
    celda: null, marcador: null,
    pronostico: null,
    capas: { cauces: false, equipamiento: false },
    botones: {},
    idComuna: null, nombreComuna: null,
    pendiente: null,          // lo que la URL pide aplicar al abrir la comuna
    pendienteLocalidad: null,
  };

  /* ---------------------------------------------------------------------
     Utilidades
     --------------------------------------------------------------------- */

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n, d) { return GT.fmt(n, d || 0); }
  function pct(f) { return fmt(100 * f, 0) + ' %'; }
  function norm(t) { return GTCalculo.normalizar(t); }
  function colorClase(k) { return PALETA.rampas.agua[k + 1]; }
  function redondear(u) { return u === undefined || u === null || u !== u ? undefined : Math.round(u * 100) / 100; }
  function conMapa() { return !!(S.mapa && S.detalle); }

  function traerJson(url, ms) {
    return fetch(url, { signal: AbortSignal.timeout(ms || 8000) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function nombreGT(nombre) {
    const b = norm(nombre);
    const c = GT.comunas.filter(function (x) { return norm(x.nombre) === b; })[0];
    return c ? c.nombre : null;
  }

  function idDeComuna(nombre) {
    return (S.promesaModelo || Promise.resolve(null)).then(function (m) {
      const id = m && m.idDeComuna(nombre);
      if (id) return id;
      return traerJson(GT_api('/comunas')).then(function (l) {
        const c = (l || []).filter(function (x) { return norm(x.nombre) === norm(nombre); })[0];
        return c ? c.id_comuna : null;
      });
    });
  }

  function aviso(texto) {
    let t = $('aviso');
    if (!t) {
      t = document.createElement('div');
      t.id = 'aviso'; t.className = 'aviso-flotante'; t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = texto;
    t.classList.add('es-visible');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('es-visible'); }, 2600);
  }

  /* ---------------------------------------------------------------------
     Arranque
     --------------------------------------------------------------------- */

  function iniciar(api, contenedor) {
    S.api = api || {};
    S.el = contenedor;
    S.mapa = S.api.instancia || null;
    S.detalle = S.api.detalle ? S.api.detalle('inundacion') : null;

    leerUrl();
    cargarModelo();
    montarExportar();
    cargarPronostico();
    pintarEventos();

    if (!conMapa()) {
      $('anNota').textContent = 'mapa esquemático: sin detalle por celda';
      return;
    }
    if (GTMapaReal.teselas) {
      GTMapaReal.teselas.disponible(TESELAS_VARIABLES).then(function (info) {
        if (info) S.archivoVars = GTMapaReal.teselas.archivo(TESELAS_VARIABLES);
      });
      GTMapaReal.teselas.disponible(TESELAS_AGRICOLA).then(function (info) {
        if (info) S.archivoAgr = GTMapaReal.teselas.archivo(TESELAS_AGRICOLA);
      });
    }
    S.el.addEventListener('detalle:umbral', function (e) { montarUmbral(e.detail); });
    S.el.addEventListener('detalle:resumen', function (e) { alResumen(e.detail); });
    S.el.addEventListener('detalle:base', function (e) { alAbrirComuna(e.detail); });

    const info = S.detalle.infoUmbral && S.detalle.infoUmbral();
    if (info) montarUmbral(info);
    montarBotones();
    montarBuscador();
    restaurarCuandoListo();
  }

  /* La URL se aplica cuando el detalle ya sabe si hay teselas (anuncia su
     umbral): abrir la comuna antes la dejaba en el modo por clases, sin
     grilla, y el panel quedaba sin cifras. */
  let urlAplicada = false;
  function restaurarCuandoListo() {
    if (urlAplicada || !S.info || !S.mapa) return;
    urlAplicada = true;
    restaurarUrl();
  }

  /* ---------------------------------------------------------------------
     Umbral e histograma
     --------------------------------------------------------------------- */

  let niveles = null;
  let umbralEscuchado = false;

  function valorUmbral() {
    const r = $('umbral');
    return S.info && S.info.continuo ? +r.value : niveles[+r.value];
  }

  function textoUmbral(u) {
    const info = S.info;
    if (info.continuo) return 'índice ≥ ' + GT.fmt(u, 2);
    if (u === -Infinity) return 'todas las clases';
    const k = info.cortes.indexOf(u);
    return 'clase ' + info.clases[k + 1] + (k + 1 < info.clases.length - 1 ? ' o más' : '');
  }

  function montarUmbral(info) {
    if (!info) return;
    S.info = info;
    const r = $('umbral');
    let pos;
    if (info.continuo) {
      r.min = info.minimo; r.max = info.maximo; r.step = 0.01; r.value = info.umbral;
      pos = function (c) { return (c - info.minimo) / (info.maximo - info.minimo); };
    } else {
      niveles = [-Infinity].concat(info.cortes);
      r.min = 0; r.max = niveles.length - 1; r.step = 1;
      r.value = Math.max(0, niveles.indexOf(info.umbral));
      pos = function (c) { return (info.cortes.indexOf(c) + 1) / (niveles.length - 1); };
    }
    $('umbralMarcas').innerHTML = info.cortes.map(function (c, k) {
      return '<span style="left:' + (100 * pos(c)).toFixed(1) + '%">' + info.clases[k + 1] + '</span>';
    }).join('');
    $('umbralAyuda').textContent = info.continuo
      ? 'Se marca como riesgo cada celda de 30 m con índice igual o mayor. Hacia la izquierda, más sensible: marca más territorio.'
      : 'Sin teselas el umbral sigue las clases del índice. Hacia la izquierda, más sensible.';
    $('umbralValor').textContent = textoUmbral(valorUmbral());
    $('umbralCaja').hidden = false;

    if (!umbralEscuchado) {
      umbralEscuchado = true;
      let pendiente = false;
      /* Una vez por cuadro: el deslizador dispara decenas de eventos por
         segundo y cada umbral nuevo vuelve a refinar lo que se ve. */
      r.addEventListener('input', function () {
        $('umbralValor').textContent = textoUmbral(valorUmbral());
        dibujarHistograma();
        if (pendiente) return;
        pendiente = true;
        requestAnimationFrame(function () {
          pendiente = false;
          if (S.detalle) S.detalle.fijarUmbral(valorUmbral());
        });
      });
    }
    dibujarHistograma();
    restaurarCuandoListo();
  }

  /* Cuántas celdas de la comuna hay en cada tramo del índice, con el color
     de su clase; lo que queda bajo el umbral, apagado. Es la forma de ver
     cuánto territorio se gana o se pierde al mover el umbral. */
  function dibujarHistograma() {
    const caja = $('histograma');
    const base = S.detalle && S.detalle.base();
    if (!caja) return;
    if (!base || !base.valores || !S.info || !S.info.continuo) { caja.hidden = true; return; }
    const N = 44, min = +S.info.minimo, max = +S.info.maximo;
    const barras = GTCalculo.histograma(base, min, max, N);
    const tope = Math.max.apply(null, barras) || 1, u = valorUmbral();
    const ancho = 300 / N, cortes = S.info.cortes;
    let svg = '';
    for (let k = 0; k < N; k++) {
      const centro = min + (k + 0.5) * (max - min) / N;
      const h = Math.max(barras[k] ? 1 : 0, 52 * barras[k] / tope);
      const clase = GTCalculo.clasificar(centro, cortes);
      svg += '<rect x="' + (k * ancho + 0.4).toFixed(2) + '" y="' + (56 - h).toFixed(2) +
             '" width="' + (ancho - 0.8).toFixed(2) + '" height="' + h.toFixed(2) +
             '" fill="' + colorClase(clase) + '" opacity="' + (centro >= u ? 1 : 0.28) + '"/>';
    }
    const xu = 300 * (u - min) / (max - min);
    svg += '<line x1="' + xu.toFixed(1) + '" x2="' + xu.toFixed(1) + '" y1="0" y2="56" ' +
           'stroke="' + PALETA.tinta + '" stroke-width="1.2" vector-effect="non-scaling-stroke"/>';
    caja.innerHTML = '<svg viewBox="0 0 300 56" preserveAspectRatio="none" role="img" ' +
      'aria-label="Distribución del índice dentro de la comuna; la línea es el umbral">' + svg + '</svg>' +
      '<div class="histograma__eje"><span>' + GT.fmt(min, 2) + '</span>' +
      '<span>celdas de la comuna por valor del índice</span><span>' + GT.fmt(max, 2) + '</span></div>';
    caja.hidden = false;
  }

  /* ---------------------------------------------------------------------
     Comuna abierta: variables, manzanas, equipamiento
     --------------------------------------------------------------------- */

  function alAbrirComuna(b) {
    const este = ++S.pedido;
    const base = S.detalle.base();
    S.grilla = null; S.pob = null; S.agr = null; S.pesosMapa = null;
    S.dentro = base ? base.original : null;
    S.nombreComuna = b.nombre;
    S.celda = null; quitarMarcador(); $('celda').hidden = true;
    pintarEventos();

    idDeComuna(b.nombre).then(function (id) {
      if (este !== S.pedido) return;
      S.idComuna = id;
      if (id) {
        traerJson(GT_api('/exposicion/poblacion', { comuna: id }), 15000).then(function (geo) {
          if (geo && geo.features && geo.features.length) return geo;
          return traerJson(GT_api('/exposicion/manzanas', { comuna: id }), 15000);
        }).then(function (geo) {
          if (este !== S.pedido || !geo || !S.detalle.base()) return;
          S.cobertura = geo.cobertura || null;
          S.anioPoblacion = geo.anio || 2017;
          S.pob = GTCalculo.rasterizarManzanas(geo, S.detalle.base());
          pintarResumen();
        });
      }
      traerEquipamiento().then(function () {
        if (este !== S.pedido) return;
        pintarEquipamiento();
        actualizarCapaEquipamiento();
      });
    });

    if (S.archivoAgr && base) {
      GTCalculo.grillaAgricola(S.archivoAgr, base).then(function (g) {
        if (este !== S.pedido) return;
        S.agr = g;
        pintarResumen();
        if (S.celda) pintarCelda();
      });
    }

    if (S.archivoVars && b.continuo && base) {
      GTCalculo.grillaVariables(S.archivoVars, base).then(function (g) {
        if (este !== S.pedido) return;
        S.grilla = g;
        if (S.enMapa) aplicarEscenarioMapa();
        if (S.celda) pintarCelda();
        pintarNotaMapa();
      });
    }

    // Lo que pidió la URL o el buscador, una vez.
    if (S.pendiente) {
      const p = S.pendiente; S.pendiente = null;
      if (p.umbral !== null && !isNaN(p.umbral) && S.info && S.info.continuo) {
        S.detalle.fijarUmbral(p.umbral);
        montarUmbral(S.detalle.infoUmbral());
      }
      if (p.loc) S.detalle.localidades(true);
    }
    if (S.pendienteLocalidad) {
      const id = S.pendienteLocalidad; S.pendienteLocalidad = null;
      S.detalle.localidades(true).then(function () { S.detalle.irALocalidad(id); });
    }
  }

  function alResumen(r) {
    S.resumen = r;
    if (!r) {
      S.pedido++;
      S.grilla = null; S.pob = null; S.agr = null; S.idComuna = null; S.nombreComuna = null; S.pesosMapa = null;
      S.celda = null; quitarMarcador(); $('celda').hidden = true;
      pintarEventos();
      actualizarCapaEquipamiento();
    }
    pintarResumen();
    pintarEquipamiento();
    if (r) actualizarCapaEquipamiento();
    if (S.celda) pintarCelda();
    dibujarHistograma();
    pintarNotaMapa();
    escribirUrl();
  }

  function eventosDe(nombre) {
    const b = norm(nombre);
    return (GT.eventosInundacion || []).filter(function (e) { return norm(e.lugar) === b; });
  }

  function lluviaDe(nombre) {
    if (!S.pronostico) return null;
    const b = norm(nombre);
    return S.pronostico.comunas.filter(function (c) { return norm(c.nombre) === b; })[0] || null;
  }

  function pintarResumen() {
    const r = S.resumen;
    const nota = $('anNota'), res = $('anResumen'), lista = $('anLocalidades'), ctx = $('anContexto');
    if (!r) {
      nota.textContent = 'elige una comuna en el mapa';
      res.innerHTML = '<span class="muted">Al elegir una comuna se muestra qué parte de ella supera el ' +
                      'umbral, cuánta gente vive ahí y en qué ciudades y pueblos está ese riesgo.</span>';
      lista.innerHTML = ''; ctx.innerHTML = '';
      return;
    }
    const base = S.detalle.base();
    const esc_ = S.detalle.escenario && S.detalle.escenario();
    nota.textContent = r.comuna + (esc_ ? ' · escenario de pesos' : '');

    const zonas = S.detalle.zonas();
    const exp = S.pob && base ? GTCalculo.exposicion(S.pob, base, zonas && zonas.indice,
                                                      zonas ? zonas.lista.length : 0) : null;
    const personasLoc = {};
    if (exp && zonas) zonas.lista.forEach(function (f, k) { personasLoc[f.properties.id_ciudad] = exp.localidades[k]; });

    const agr = S.agr && base ? GTCalculo.exposicionAgricola(S.agr, base) : null;
    const rural = exp && S.anioPoblacion >= 2024;
    res.innerHTML = '<div class="cifras">' +
      cifra(pct(r.fraccionSobre), 'de la comuna supera el umbral', '≈ ' + fmt(r.haSobre) + ' ha') +
      (agr ? cifra('≈ ' + fmt(agr.cultivoSobre) + ' ha', 'de cultivo sobre el umbral', 'de ' + fmt(agr.cultivo) + ' ha de cultivo') +
             cifra('≈ ' + fmt(agr.praderaSobre) + ' ha', 'de pradera sobre el umbral', 'de ' + fmt(agr.pradera) + ' ha de pradera')
           : S.archivoAgr ? cifra('…', 'superficie agrícola', 'cargando') : '') +
      (exp ? cifra('≈ ' + fmt(exp.personasSobre), 'personas viven ahí',
                   (rural ? 'de ellas ≈ ' + fmt(exp.ruralesSobre) + ' en el campo · ' : '') + 'de ' + fmt(exp.personas)) +
             cifra('≈ ' + fmt(exp.viviendasSobre), 'viviendas', 'de ' + fmt(exp.viviendas))
           : S.idComuna ? cifra('…', 'personas', 'cargando el Censo') : '') +
      '</div>' +
      lecturaIndap(r, agr, exp, rural) +
      ((exp || agr) ? '<div class="tiny muted" style="margin-top:6px">' +
        (agr ? 'Cultivo y pradera: ESA WorldCover 10 m (2021); los frutales densos pueden figurar como cobertura arbórea. ' : '') +
        (exp ? (rural ? 'Población del Censo 2024, urbana y rural, repartida en sus celdas de 30 m; en el campo la entidad es grande ' +
                        'y el reparto es aproximado.'
                      : 'Población urbana del Censo 2017 por manzana; la rural no se cuenta.') : '') +
        '</div>' : '');

    if (!r.localidades.length) {
      lista.innerHTML = '<p class="small muted" style="margin:10px 0 0">Esta comuna no tiene áreas urbanas ' +
                        'en el Límite Urbano Censal 2017.</p>';
    } else {
      const max = Math.max.apply(null, r.localidades.map(function (l) { return l.fraccionSobre; })) || 1;
      lista.innerHTML =
        '<div class="sep" style="margin:12px 0 10px"></div>' +
        '<div class="localidades__cab"><span>Ciudades y pueblos</span>' +
          '<span class="muted">% de su área sobre el umbral</span></div>' +
        (r.localidadesActivas ? '' :
          '<p class="tiny muted" style="margin:0 0 8px">Activa <strong>Localidades</strong> en el mapa para ' +
          'marcarlas y ver en qué sector de cada una está el riesgo.</p>') +
        '<div class="stack" style="gap:4px">' +
        r.localidades.map(function (l) {
          const p = personasLoc[l.id];
          return '<button type="button" class="localidad" data-id="' + l.id + '" ' +
                   'title="Acercar el mapa a ' + esc(l.nombre) + '">' +
                   '<span class="localidad__nombre">' + esc(l.nombre) +
                     '<span class="tiny muted"> · ' + esc(l.categoria) + '</span>' +
                     (p ? '<span class="localidad__sub">≈ ' + fmt(p.personasSobre) + ' personas sobre el umbral</span>' : '') +
                   '</span>' +
                   '<span class="bar-row__track"><span class="bar-row__fill" style="width:' +
                     (100 * l.fraccionSobre / max).toFixed(1) + '%;background:' + colorClase(2) + '"></span></span>' +
                   '<span class="localidad__valor mono">' + pct(l.fraccionSobre) + '</span>' +
                 '</button>';
        }).join('') + '</div>' +
        '<div class="tiny muted" style="margin-top:8px">Área urbana: INE, Límite Urbano Censal 2017 ' +
        '(copia del Observatorio de Ciudades UC, CC BY-NC 4.0).</div>';
      lista.querySelectorAll('.localidad').forEach(function (b) {
        b.addEventListener('click', function () {
          const id = +b.getAttribute('data-id');
          const r2 = S.detalle.resumen && S.detalle.resumen();
          Promise.resolve(r2 && r2.localidadesActivas ? true : S.detalle.localidades(true))
            .then(function () { S.detalle.irALocalidad(id); });
        });
      });
    }

    // Contexto: lo que pasó y lo que viene.
    const ev = eventosDe(r.comuna);
    const anios = ev.map(function (e) { return e.fecha.split(' ').pop(); })
      .filter(function (a, i, xs) { return xs.indexOf(a) === i; });
    const ll = lluviaDe(r.comuna);
    ctx.innerHTML = '<div class="sep" style="margin:12px 0 10px"></div><div class="contexto">' +
      '<div><span class="muted">Eventos registrados</span><strong>' + ev.length + '</strong>' +
        '<span class="tiny muted">' + (anios.length ? esc(anios.slice(0, 6).join(', ')) + (anios.length > 6 ? '…' : '') : 'DesInventar 1970–2014') + '</span></div>' +
      '<div><span class="muted">Lluvia próximas 72 h</span><strong>' +
        (ll ? GT.fmt(ll.total_72h, 0) + ' mm' : '—') + '</strong>' +
        '<span class="tiny muted">' + (ll ? 'máx. ' + GT.fmt(ll.max_diaria, 0) + ' mm en un día · Open-Meteo' : 'sin pronóstico') + '</span></div>' +
      '</div>';
  }

  /* Una frase con lo que importa para INDAP: hectáreas agrícolas y gente del
     campo sobre el umbral, y qué hacer con eso. */
  function lecturaIndap(r, agr, exp, rural) {
    if (!agr && !exp) return '';
    const partes = [];
    if (agr && agr.cultivoSobre + agr.praderaSobre >= 1) {
      partes.push('≈ ' + fmt(agr.cultivoSobre) + ' ha de cultivo y ' + fmt(agr.praderaSobre) + ' ha de pradera');
    }
    if (exp && rural && exp.ruralesSobre >= 1) partes.push('≈ ' + fmt(exp.ruralesSobre) + ' personas del campo');
    if (!partes.length) return '';
    return '<div class="lectura-indap"><strong>Para INDAP:</strong> en ' + esc(r.comuna) + ', ' +
      partes.join(' y ') + ' quedan en terreno susceptible con este umbral. Son las superficies y familias a ' +
      'considerar primero en el plan de emergencias agrícolas y al evaluar inversiones de riego o drenaje en la comuna.' +
      ' <a href="predios.html">Revisar predios propios →</a></div>';
  }

  function cifra(valor, rotulo, sub) {
    return '<div class="cifra"><span class="cifra__valor">' + valor + '</span>' +
           '<span class="cifra__rotulo">' + rotulo + '</span>' +
           (sub ? '<span class="tiny muted">' + sub + '</span>' : '') + '</div>';
  }

  /* ---------------------------------------------------------------------
     Equipamiento
     --------------------------------------------------------------------- */

  function traerEquipamiento() {
    if (!S.promesaEquipo) {
      S.promesaEquipo = traerJson(GT_api('/exposicion/equipamiento'), 10000).then(function (g) {
        S.equipo = g && g.features ? g : null;
        return S.equipo;
      });
    }
    return S.promesaEquipo;
  }

  function equipoDeComuna() {
    if (!S.equipo || !S.idComuna) return [];
    return S.equipo.features.filter(function (f) { return f.properties.id_comuna === S.idComuna; });
  }

  function pintarEquipamiento() {
    const nota = $('exNota'), cuerpo = $('exCuerpo');
    if (!S.resumen || !S.detalle) {
      S.equipoComuna = [];
      nota.textContent = 'elige una comuna';
      cuerpo.innerHTML = '<p class="small muted" style="margin:0">Los servicios que un plan de emergencia revisa primero: ' +
        'escuelas, jardines infantiles, centros de salud, ' +
        'bomberos y policía que quedan sobre celdas que superan el umbral.</p>';
      return;
    }
    if (!S.equipo) {
      nota.textContent = S.promesaEquipo ? 'cargando' : '';
      cuerpo.innerHTML = '<p class="small muted" style="margin:0">Sin datos de equipamiento: correr ' +
                         '<span class="mono">python -m ingesta.equipamiento</span>.</p>';
      return;
    }
    const ev = GTCalculo.evaluarEquipamiento(equipoDeComuna(), S.detalle).filter(function (e) { return e.dentro; });
    S.equipoComuna = ev;
    const sobre = ev.filter(function (e) { return e.sobre; })
      .sort(function (a, b) { return (b.valor || 0) - (a.valor || 0); });
    nota.textContent = sobre.length + ' de ' + ev.length + ' sobre el umbral';

    const porCat = Object.keys(CATEGORIAS).map(function (k) {
      const t = ev.filter(function (e) { return e.f.properties.categoria === k; });
      const s = t.filter(function (e) { return e.sobre; });
      return '<div class="equipo__cat"><i style="background:' + CATEGORIAS[k].color + '"></i>' +
             '<span>' + CATEGORIAS[k].nombre + '</span><strong>' + s.length + '</strong>' +
             '<span class="tiny muted">de ' + t.length + '</span></div>';
    }).join('');

    const filas = sobre.slice(0, 40).map(function (e) {
      const p = e.f.properties;
      return '<button type="button" class="equipo" data-id="' + p.id + '">' +
        '<i style="background:' + CATEGORIAS[p.categoria].color + '"></i>' +
        '<span class="equipo__nombre">' + esc(p.nombre || 'Sin nombre en OSM') +
          '<span class="tiny muted">' + esc(TIPOS[p.tipo] || p.tipo) + '</span></span>' +
        '<span class="equipo__valor mono">' + (e.valor !== null ? GT.fmt(e.valor, 2) : '') +
          '<span class="tiny" style="color:' + colorClase(e.clase) + '">' + CLASES[e.clase] + '</span></span>' +
      '</button>';
    }).join('');

    cuerpo.innerHTML = '<div class="equipo__cats">' + porCat + '</div>' +
      (sobre.length
        ? '<div class="stack" style="gap:2px;margin-top:10px">' + filas + '</div>' +
          (sobre.length > 40 ? '<div class="tiny muted">y ' + (sobre.length - 40) + ' más (ver CSV)</div>' : '')
        : '<p class="small muted" style="margin:10px 0 0">' +
          (ev.length ? 'Ninguno queda sobre el umbral actual.' : 'OpenStreetMap no registra escuelas, salud ni cuarteles en esta comuna.') + '</p>') +
      '<div class="tiny muted" style="margin-top:8px">Según OpenStreetMap (© colaboradores, ODbL): completo en las ciudades, ' +
      'con huecos en lo rural. Se evalúa la celda de 30 m donde cae cada punto.</div>';

    cuerpo.querySelectorAll('.equipo').forEach(function (b) {
      b.addEventListener('click', function () { irAEquipo(+b.getAttribute('data-id')); });
    });
  }

  function irAEquipo(id) {
    const e = S.equipoComuna.filter(function (x) { return x.f.properties.id === id; })[0];
    if (!e || !S.mapa) return;
    if (!S.capas.equipamiento) activarCapa('equipamiento', true);
    const c = e.f.geometry.coordinates;
    S.mapa.flyTo({ center: c, zoom: Math.max(S.mapa.getZoom(), 15.5), duration: 700 });
    inspeccionar({ lng: c[0], lat: c[1] });
    popupEquipo(e.f.properties, c);
  }

  /* ---------------------------------------------------------------------
     Capas del mapa: red hídrica y equipamiento
     --------------------------------------------------------------------- */

  function primeraEtiqueta() {
    const capas = S.mapa.getStyle().layers;
    for (let i = 0; i < capas.length; i++) if (capas[i].type === 'symbol') return capas[i].id;
    return undefined;
  }

  function fuenteDelEstilo() {
    const c = S.mapa.getStyle().layers.filter(function (x) {
      return x.type === 'symbol' && x.layout && x.layout['text-font'];
    })[0];
    return c ? c.layout['text-font'] : ['Open Sans Regular'];
  }

  function montarBotones() {
    const barra = S.el.querySelector('.mapbar');
    if (!barra) { setTimeout(montarBotones, 50); return; }
    [['cauces', 'Cauces', 'Ríos y esteros (IDE Chile, orden de Strahler 4 o más)'],
     ['equipamiento', 'Servicios', 'Escuelas, salud, bomberos y policía (OpenStreetMap)']].forEach(function (d) {
      const caja = document.createElement('div');
      caja.className = 'basectl';
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = d[1]; b.title = d[2];
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { activarCapa(d[0]); });
      caja.appendChild(b);
      barra.appendChild(caja);
      S.botones[d[0]] = b;
    });
  }

  function activarCapa(cual, v) {
    S.capas[cual] = v === undefined ? !S.capas[cual] : !!v;
    if (S.botones[cual]) S.botones[cual].setAttribute('aria-pressed', String(S.capas[cual]));
    if (cual === 'cauces') mostrarCauces();
    else actualizarCapaEquipamiento();
    escribirUrl();
  }

  let promesaCauces = null;
  function mostrarCauces() {
    const v = S.capas.cauces ? 'visible' : 'none';
    if (S.mapa.getLayer('cauces-linea')) {
      S.mapa.setLayoutProperty('cauces-linea', 'visibility', v);
      S.mapa.setLayoutProperty('cauces-nombre', 'visibility', v);
      return;
    }
    if (!S.capas.cauces || promesaCauces) return;
    promesaCauces = traerJson(GT_api('/inundacion/cauces'), 15000).then(function (geo) {
      if (!geo || !geo.features.length) {
        aviso('No hay red hídrica cargada en la base');
        promesaCauces = null; activarCapa('cauces', false);
        return;
      }
      S.mapa.addSource('cauces', { type: 'geojson', data: geo });
      const antes = primeraEtiqueta();
      S.mapa.addLayer({
        id: 'cauces-linea', type: 'line', source: 'cauces',
        layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
        paint: {
          'line-color': PALETA.turquesa, 'line-opacity': 0.9,
          'line-width': ['interpolate', ['linear'], ['get', 'strahler'], 4, 0.7, 6, 1.4, 8, 2.4, 10, 3.4],
        },
      }, antes);
      S.mapa.addLayer({
        id: 'cauces-nombre', type: 'symbol', source: 'cauces',
        filter: ['>=', ['get', 'strahler'], 6],
        layout: { visibility: 'none', 'symbol-placement': 'line', 'text-field': ['get', 'nombre'],
                  'text-font': fuenteDelEstilo(), 'text-size': 11, 'text-letter-spacing': 0.04 },
        paint: { 'text-color': PALETA.turquesa, 'text-halo-color': PALETA.mapa.halo, 'text-halo-width': 1.6 },
      });
      mostrarCauces();
    });
  }

  let capaEquipoLista = false;
  function actualizarCapaEquipamiento() {
    if (!S.mapa) return;
    if (!S.capas.equipamiento) {
      if (capaEquipoLista) ['equipamiento-punto'].forEach(function (id) {
        S.mapa.setLayoutProperty(id, 'visibility', 'none');
      });
      return;
    }
    traerEquipamiento().then(function (g) {
      if (!g) { aviso('No hay servicios cargados en la base'); activarCapa('equipamiento', false); return; }
      /* Con comuna abierta, los suyos con su estado frente al umbral; sin
         comuna, los de toda la región, apagados. */
      const datos = S.resumen && S.equipoComuna.length
        ? { type: 'FeatureCollection', features: S.equipoComuna.map(function (e) {
            return { type: 'Feature', geometry: e.f.geometry,
                     properties: Object.assign({}, e.f.properties, { sobre: e.sobre ? 1 : 0 }) };
          }) }
        : { type: 'FeatureCollection', features: g.features.map(function (f) {
            return { type: 'Feature', geometry: f.geometry,
                     properties: Object.assign({}, f.properties, { sobre: 0 }) };
          }) };
      if (!capaEquipoLista) {
        capaEquipoLista = true;
        S.mapa.addSource('equipamiento', { type: 'geojson', data: datos });
        S.mapa.addLayer({
          id: 'equipamiento-punto', type: 'circle', source: 'equipamiento',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['==', ['get', 'sobre'], 1], 3.5, 2.5],
                                                                  15, ['case', ['==', ['get', 'sobre'], 1], 8, 5.5]],
            'circle-color': ['match', ['get', 'categoria'],
                             'educacion', CATEGORIAS.educacion.color,
                             'salud', CATEGORIAS.salud.color, CATEGORIAS.emergencia.color],
            'circle-opacity': ['case', ['==', ['get', 'sobre'], 1], 1, 0.5],
            'circle-stroke-color': PALETA.mapa.halo,
            'circle-stroke-width': ['case', ['==', ['get', 'sobre'], 1], 2, 1],
          },
        });
        S.mapa.on('mouseenter', 'equipamiento-punto', function () { S.mapa.getCanvas().style.cursor = 'pointer'; });
        S.mapa.on('mouseleave', 'equipamiento-punto', function () { S.mapa.getCanvas().style.cursor = ''; });
        S.mapa.on('click', 'equipamiento-punto', function (e) {
          const f = e.features && e.features[0];
          if (f) popupEquipo(f.properties, f.geometry.coordinates);
        });
      } else {
        S.mapa.getSource('equipamiento').setData(datos);
        S.mapa.setLayoutProperty('equipamiento-punto', 'visibility', 'visible');
      }
    });
  }

  let popup = null;
  function popupEquipo(p, coords) {
    if (!S.mapa) return;
    const e = S.equipoComuna.filter(function (x) { return x.f.properties.id === p.id; })[0];
    const estado = e ? (e.sobre ? '<strong>Sobre el umbral</strong>' : 'bajo el umbral') +
      (e.valor !== null ? ' · índice ' + GT.fmt(e.valor, 2) + ' · ' + CLASES[e.clase] : '') : '';
    if (!popup) popup = new maplibregl.Popup({ closeButton: true, offset: 10, maxWidth: '260px' });
    popup.setLngLat(coords).setHTML(
      '<strong>' + esc(p.nombre || 'Sin nombre en OSM') + '</strong><br>' +
      '<span class="muted">' + esc(TIPOS[p.tipo] || p.tipo) + '</span>' +
      (estado ? '<div class="emergente__celda"><span>' + estado + '</span></div>' : '') +
      '<div class="tiny muted" style="margin-top:4px">© OpenStreetMap · ' + esc(p.osm || '') + '</div>'
    ).addTo(S.mapa);
  }

  /* ---------------------------------------------------------------------
     Por qué esta celda
     --------------------------------------------------------------------- */

  function inspeccionar(lngLat) {
    if (!S.detalle || !S.detalle.base()) return;
    S.celda = lngLat;
    ponerMarcador(lngLat);
    pintarCelda();
  }

  function ponerMarcador(ll) {
    if (!S.mapa) return;
    if (!S.marcador) {
      const el = document.createElement('div');
      el.className = 'marcador-celda';
      S.marcador = new maplibregl.Marker({ element: el });
    }
    S.marcador.setLngLat(ll).addTo(S.mapa);
  }

  function quitarMarcador() { if (S.marcador) S.marcador.remove(); }

  function textoVariable(v, o) {
    if (!o) return 'sin dato';
    const lim = o.limite === 'mayor' ? '≥ ' : o.limite === 'menor' ? '≤ ' : '';
    const x = o.valor;
    switch (v.clave) {
      case 'pendiente': return lim + GT.fmt(x, 1) + ' %';
      case 'acumulacion': return 'drena ' + lim + GT.fmt(Math.pow(10, x) * 0.09, x > 1.5 ? 0 : 1) + ' ha';
      case 'distancia_cauces': return lim + GT.fmt(x, 0) + ' m de un río o estero';
      case 'twi': return lim + GT.fmt(x, 1);
      case 'curvatura': return lim + GT.fmt(x, 2) + (x < -0.05 ? ' · cóncava' : x > 0.05 ? ' · convexa' : ' · plana');
      case 'cobertura': return 'NDVI ' + lim + GT.fmt(x, 2);
      default: return lim + GT.fmt(x, 2);
    }
  }

  function pintarCelda() {
    const card = $('celda'), cuerpo = $('celdaCuerpo');
    const base = S.detalle && S.detalle.base();
    if (!base || !S.celda) { card.hidden = true; return; }
    card.hidden = false;
    const i = S.detalle.indiceEn(S.celda);
    $('celdaNota').textContent = GT.fmt(S.celda.lat, 5) + ', ' + GT.fmt(S.celda.lng, 5);
    if (i < 0 || base.original[i] === SIN) {
      cuerpo.innerHTML = '<p class="small muted" style="margin:0">Esa celda está fuera de la comuna o sin dato.</p>';
      return;
    }
    const m = S.modelo;
    const v = base.valores ? base.valores[i] : null;
    const k = base.original[i];
    const sobre = base.clases[i] !== SIN;
    const pesos = S.pesosMapa || (m ? m.calibrados : null);
    const perc = (m && v !== null) ? GTCalculo.fraccionBajo(m.muestraOrdenada(GTCalculo.normalizarPesos(pesos)), v) : null;
    const zonas = S.detalle.zonas();
    const z = zonas && zonas.indice[i];
    const loc = z ? zonas.lista[z - 1].properties : null;
    const personas = S.pob ? S.pob.personas[i] : 0;
    const cultivo = S.agr && S.agr.cultivo[i] ? S.agr.cultivo[i] - 1 : null;
    const pradera = S.agr && S.agr.pradera[i] ? S.agr.pradera[i] - 1 : null;

    let filas = '', suma = 0;
    if (m && S.grilla) {
      filas = m.variables.map(function (va, kv) {
        const q = S.grilla.n[kv][i];
        const n = q ? (q - 1) / m.pasos : null;
        const w = pesos[kv] / 100;
        const aporte = n !== null ? w * n : 0;
        suma += aporte;
        return '<div class="var' + (w ? '' : ' var--sinpeso') + '">' +
          '<span class="var__nombre">' + esc(va.nombre) +
            '<span class="tiny muted">' + esc(textoVariable(va, m.original(kv, q))) + '</span></span>' +
          '<span class="var__barra" title="Normalizada: ' + (n !== null ? GT.fmt(n, 2) : '—') + '">' +
            '<i style="width:' + (n !== null ? 100 * n : 0).toFixed(1) + '%"></i></span>' +
          '<span class="var__peso mono">' + (w ? '× ' + GT.fmt(100 * w, 0) + ' %' : '—') + '</span>' +
          '<span class="var__aporte mono">' + (w && n !== null ? '+' + GT.fmt(aporte, 2) : '') + '</span>' +
        '</div>';
      }).join('');
    }

    cuerpo.innerHTML =
      '<div class="celda__cab">' +
        '<span class="celda__valor" style="border-color:' + colorClase(k) + '">' + (v !== null ? GT.fmt(v, 2) : '—') + '</span>' +
        '<span><strong>' + CLASES[k] + '</strong>' + (S.pesosMapa ? ' <span class="tiny muted">(escenario)</span>' : '') +
          '<br><span class="small muted">' +
          (perc !== null ? 'más alta que el ' + fmt(100 * perc) + ' % de las celdas de la región' : '') +
          '</span></span>' +
        '<span class="badge ' + (sobre ? 'badge--warn' : 'badge--ok') + '"><span class="dot"></span>' +
          (sobre ? 'sobre el umbral' : 'bajo el umbral') + '</span>' +
      '</div>' +
      (loc || personas > 0.05 ? '<div class="small muted" style="margin:8px 0 0">' +
        (loc ? 'En ' + esc(loc.nombre) + ' (' + esc(loc.categoria) + ')' : 'Fuera de las áreas urbanas') +
        (personas > 0.05 ? ' · ≈ ' + GT.fmt(personas, personas < 10 ? 1 : 0) + ' personas en esta celda' : '') + '</div>' : '') +
      (cultivo !== null ? '<div class="small muted" style="margin:4px 0 0">Cobertura de la celda: ' + cultivo + ' % cultivo · ' +
        pradera + ' % pradera (WorldCover)</div>' : '') +
      (filas
        ? '<div class="sep" style="margin:10px 0"></div>' +
          '<div class="var var--cab tiny muted"><span>Variable y valor en la celda</span><span>normalizada</span><span>peso</span><span>aporte</span></div>' +
          filas +
          '<div class="var var--total"><span>Índice = suma de los aportes</span><span></span><span></span>' +
            '<span class="mono">' + GT.fmt(suma, 2) + '</span></div>' +
          '<div class="tiny muted" style="margin-top:6px">Cada variable se lleva a 0–1 entre sus percentiles 2 y 98 de la región ' +
          'y se voltea si más valor es menos susceptibilidad (pendiente, distancia, curvatura, cobertura). ' +
          'Las que no tienen peso se muestran como contexto.</div>'
        : '<p class="tiny muted" style="margin:8px 0 0">' +
          (S.archivoVars ? 'Cargando las variables de la celda…' : 'Sin las teselas de variables no se puede desglosar la celda: ' +
            'generarlas con <span class="mono">python -m variables_inundacion</span>.') + '</p>');
  }

  /* ---------------------------------------------------------------------
     Explorador de pesos
     --------------------------------------------------------------------- */

  function cargarModelo() {
    S.promesaModelo = traerJson(RUTA_VARIABLES, 10000).then(function (d) {
      if (!d || !d.variables) {
        $('pesosCuerpo').innerHTML = '<p class="small muted">Sin <span class="mono">' + RUTA_VARIABLES +
          '</span>: generarlo con <span class="mono">python -m variables_inundacion</span>.</p>';
        return null;
      }
      S.modelo = new GTCalculo.Modelo(d);
      if (!S.pesos) S.pesos = S.modelo.calibrados.slice();
      montarPesos();
      return S.modelo;
    });
  }

  function juegos() {
    const m = S.modelo;
    const lista = [{ nombre: 'Calibrado (vigente)', pesos: m.calibrados }];
    const vistos = [m.calibrados.join(',')];
    m.datos.juegos.forEach(function (j) {
      const clave = j.pesos.join(',');
      if (vistos.indexOf(clave) >= 0) return;
      vistos.push(clave);
      lista.push({ nombre: j.nombre.charAt(0).toUpperCase() + j.nombre.slice(1), pesos: j.pesos });
    });
    lista.push({ nombre: 'Seis por igual', pesos: [1, 1, 1, 1, 1, 1] });
    return lista;
  }

  function montarPesos() {
    const m = S.modelo, rhos = m.porVariable();
    const cuerpo = $('pesosCuerpo');
    cuerpo.innerHTML =
      '<div class="pesos">' +
        '<div class="pesos__controles">' +
          '<div class="tiny muted" style="margin-bottom:6px">Juegos de pesos</div>' +
          '<div class="pesos__juegos" id="pesosJuegos">' + juegos().map(function (j, k) {
            return '<button type="button" class="chip" data-k="' + k + '">' + esc(j.nombre) + '</button>';
          }).join('') + '</div>' +
          '<div class="pesos__vars">' + m.variables.map(function (v, k) {
            const r = rhos[k];
            const lectura = Math.abs(r) < 0.15 ? 'sin señal' : r > 0 ? 'ordena bien' : 'al revés';
            return '<label class="peso">' +
              '<span class="peso__nombre">' + esc(v.nombre) +
                '<span class="tiny muted">ρ sola ' + (r >= 0 ? '+' : '−') + GT.fmt(Math.abs(r), 2) + ' · ' + lectura + '</span></span>' +
              '<input type="range" class="range" min="0" max="100" step="1" data-k="' + k + '" value="' + S.pesos[k] + '">' +
              '<span class="peso__valor mono" id="pesoValor' + k + '"></span>' +
            '</label>';
          }).join('') + '</div>' +
          '<label class="small pesos__mapa"><input type="checkbox" id="pesosMapa"> Ver este juego en el mapa de la comuna abierta</label>' +
          '<div class="tiny muted" id="pesosMapaNota"></div>' +
        '</div>' +
        '<div class="pesos__resultado" id="pesosResultado"></div>' +
      '</div>';

    cuerpo.querySelectorAll('input[type=range]').forEach(function (r) {
      r.addEventListener('input', function () {
        S.pesos[+r.getAttribute('data-k')] = +r.value;
        alCambiarPesos();
      });
    });
    const lista = juegos();
    cuerpo.querySelectorAll('.chip').forEach(function (b) {
      b.addEventListener('click', function () {
        S.pesos = lista[+b.getAttribute('data-k')].pesos.slice();
        cuerpo.querySelectorAll('input[type=range]').forEach(function (r, k) { r.value = S.pesos[k]; });
        alCambiarPesos();
      });
    });
    const chk = $('pesosMapa');
    chk.checked = S.enMapa;
    chk.addEventListener('change', function () {
      S.enMapa = chk.checked;
      aplicarEscenarioMapa();
      pintarNotaMapa();
      escribirUrl();
    });
    alCambiarPesos(true);
  }

  let esperaMapa = null;
  function alCambiarPesos(inicial) {
    const m = S.modelo;
    const pn = GTCalculo.normalizarPesos(S.pesos);
    m.variables.forEach(function (_v, k) {
      const e = $('pesoValor' + k);
      if (e) e.textContent = pn ? GT.fmt(pn[k], 0) + ' %' : '—';
    });
    const lista = juegos();
    document.querySelectorAll('#pesosJuegos .chip').forEach(function (b) {
      const j = lista[+b.getAttribute('data-k')];
      b.classList.toggle('is-active', !!pn && GTCalculo.mismosPesos(GTCalculo.normalizarPesos(j.pesos), pn));
    });
    pintarValidacion(pn ? m.evaluar(pn) : null);
    if (S.enMapa && !inicial) {
      clearTimeout(esperaMapa);
      esperaMapa = setTimeout(aplicarEscenarioMapa, 120);
    }
    if (!inicial) escribirUrl();
  }

  function signo(x) { return (x >= 0 ? '+' : '−') + GT.fmt(Math.abs(x), 2); }

  function pintarValidacion(r) {
    const caja = $('pesosResultado');
    if (!r) { caja.innerHTML = '<p class="small muted">Con todos los pesos en cero no hay índice.</p>'; return; }
    const b = S.modelo.base;
    const mejora = r.fraccionEnAlta - r.azar, mejoraB = b.fraccionEnAlta - b.azar;
    const d = r.rho - b.rho;
    let veredicto;
    if (GTCalculo.mismosPesos(r.pesos, b.pesos)) veredicto = 'Son los pesos vigentes: los que eligió la validación.';
    else if (Math.abs(d) < 0.15) veredicto = 'Ordena las comunas parecido a los pesos vigentes. Con 33 comunas, una diferencia de ρ menor a 0,15 es ruido.';
    else if (d < 0) veredicto = 'Ordena las comunas peor que los pesos vigentes: los eventos quedan más repartidos entre clases.';
    else veredicto = 'Ordena mejor que los pesos vigentes en esta muestra. Ojo: es la misma muestra con que se eligieron; ver los límites en la metodología.';

    const cambios = r.comunas.filter(function (c) { return c.clase !== c.claseCalibrada; })
      .sort(function (a, b2) { return (b2.clase - b2.claseCalibrada) - (a.clase - a.claseCalibrada); });

    caja.innerHTML =
      '<div class="cifras cifras--3">' +
        cifra(pct(r.fraccionEnAlta), 'de los ' + r.eventos + ' eventos cae en comunas Alta o Muy alta',
              'el azar daría ' + pct(r.azar) + ' · ' + (mejora >= 0 ? '+' : '−') + fmt(Math.abs(100 * mejora)) + ' puntos') +
        cifra('ρ ' + signo(r.rho), 'coincidencia entre el orden de las comunas y sus eventos (de −1 a +1)',
              'Spearman · sin el año 1982: ' + signo(r.rhoSin1982)) +
        cifra(String(cambios.length), 'comunas cambian de clase', 'frente a los pesos vigentes') +
      '</div>' +
      '<div class="pesos__barra" aria-hidden="true">' +
        '<span style="left:' + (50 + 50 * b.rho).toFixed(1) + '%" class="pesos__marca pesos__marca--base" title="vigente"></span>' +
        '<span style="left:' + (50 + 50 * r.rho).toFixed(1) + '%" class="pesos__marca"></span>' +
        '<em>−1</em><em>0</em><em>+1</em>' +
      '</div>' +
      '<p class="small" style="margin:10px 0 0">' + veredicto + '</p>' +
      (cambios.length
        ? '<div class="pesos__cambios">' + cambios.slice(0, 18).map(function (c) {
            return '<span class="cambio"><strong>' + esc(c.nombre) + '</strong> ' +
              '<i style="background:' + colorClase(c.claseCalibrada) + '"></i>' + CLASES[c.claseCalibrada] +
              ' → <i style="background:' + colorClase(c.clase) + '"></i>' + CLASES[c.clase] +
              (c.eventos ? ' <span class="muted">· ' + c.eventos + ' ev.</span>' : '') + '</span>';
          }).join('') + (cambios.length > 18 ? '<span class="muted small">y ' + (cambios.length - 18) + ' más</span>' : '') + '</div>'
        : '') +
      '<p class="tiny muted" style="margin:10px 0 0">Mismas cuentas que <span class="mono">validar_inundacion</span> del motor: ' +
      'medias comunales exactas para cualquier juego y clases por cuartiles. Explorar no recalibra: los pesos vigentes ' +
      'salieron de juegos declarados de antemano, no de optimizar contra los eventos ' +
      '(ver docs/13-modulo-inundaciones.md). Vigente: ' + pct(b.fraccionEnAlta) + ' en Alta, ρ ' + signo(b.rho) +
      ', ' + (mejoraB >= 0 ? '+' : '−') + fmt(Math.abs(100 * mejoraB)) + ' puntos sobre el azar.</p>';
  }

  function pintarNotaMapa() {
    const n = $('pesosMapaNota');
    if (!n) return;
    if (!S.enMapa) { n.textContent = ''; return; }
    const base = S.detalle && S.detalle.base();
    n.textContent = !conMapa() ? 'Sin mapa real no hay detalle por celda.'
      : !base ? 'Abre una comuna para verlo celda a celda.'
      : !base.valores ? 'Sin teselas el índice llega por clases y no se puede recalcular.'
      : !S.archivoVars ? 'Faltan las teselas de variables (python -m variables_inundacion).'
      : !S.grilla ? 'Cargando las variables de la comuna…'
      : S.pesosMapa ? 'El mapa, la ventana del cursor y las cifras de la comuna usan este juego.' : '';
  }

  /* Pinta en el mapa el índice con los pesos del explorador. El umbral se
     traslada por percentil: si marcaba el 30 % más alto de la región con
     los pesos anteriores, sigue marcando el 30 % más alto con los nuevos. */
  function aplicarEscenarioMapa() {
    const d = S.detalle, m = S.modelo;
    const base = d && d.base();
    if (!m || !base || !base.valores) { pintarNotaMapa(); return; }
    const pn = GTCalculo.normalizarPesos(S.pesos) || m.calibrados;
    const calibrado = !S.enMapa || GTCalculo.mismosPesos(pn, m.calibrados);
    const anterior = m.muestraOrdenada(S.pesosMapa || m.calibrados);
    const u0 = d.umbral();
    const mapear = function (nueva) {
      return u0 === null ? undefined
        : redondear(GTCalculo.percentil(nueva, 100 * GTCalculo.fraccionBajo(anterior, u0)));
    };
    if (calibrado) {
      if (d.escenario()) {
        const u = mapear(m.muestraOrdenada(m.calibrados));
        S.pesosMapa = null;
        d.fijarValores(null, null, { umbral: u });
      }
      pintarNotaMapa();
      return;
    }
    if (!S.grilla) { pintarNotaMapa(); return; }
    const r = m.evaluar(pn);
    const valores = GTCalculo.valoresConPesos(S.grilla, pn, m.pasos, S.dentro);
    const u = mapear(r.muestra);
    S.pesosMapa = pn;
    d.fijarValores(valores, r.cortesPixel, { umbral: u });
    if (S.celda) pintarCelda();
    pintarNotaMapa();
  }

  /* ---------------------------------------------------------------------
     Lluvia pronosticada
     --------------------------------------------------------------------- */

  function cargarPronostico() {
    const caja = $('lluviaTabla');
    fetch(GT_api('/inundacion/pronostico'), { signal: AbortSignal.timeout(25000) })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        S.pronostico = d;
        pintarPronostico();
        pintarResumen();
      })
      .catch(function () {
        caja.innerHTML = '<p class="small muted" style="padding:0 16px 16px;margin:0">No se pudo consultar el ' +
          'pronóstico (sin API o sin internet). El resto del módulo no depende de él.</p>';
      });
    const f = $('lluviaSoloAltas');
    if (f) f.addEventListener('change', pintarPronostico);
  }

  function pintarPronostico() {
    const d = S.pronostico, caja = $('lluviaTabla');
    if (!d) return;
    const solo = $('lluviaSoloAltas') && $('lluviaSoloAltas').checked;
    const comunas = d.comunas.filter(function (c) {
      return !solo || c.clase === 'Alta' || c.clase === 'Muy alta';
    });
    const tope = Math.max(10, Math.max.apply(null, d.comunas.map(function (c) { return c.max_diaria; })));
    const dias = d.dias.map(function (x) {
      const f = new Date(x + 'T12:00:00');
      return f.toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', '');
    });
    $('lluviaNota').textContent = (d.vencido ? 'copia anterior · ' : '') + 'consultado ' +
      new Date(d.consultado).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    caja.innerHTML = '<div class="table__wrap"><table class="table table--lluvia"><thead><tr>' +
      '<th>Comuna</th><th>Clase</th><th class="lluvia__dias">' + dias.map(function (x) { return '<span>' + x + '</span>'; }).join('') +
      '</th><th class="num">72 h</th><th class="num">7 días</th></tr></thead><tbody>' +
      comunas.map(function (c) {
        const k = CLASES.indexOf(c.clase);
        return '<tr data-nombre="' + esc(c.nombre) + '"' + (norm(c.nombre) === norm(S.nombreComuna) ? ' class="is-activa"' : '') + '>' +
          '<td><button type="button" class="enlace">' + esc(c.nombre) + '</button></td>' +
          '<td>' + (k >= 0 ? '<i class="punto" style="background:' + colorClase(k) + '"></i>' + c.clase : '—') + '</td>' +
          '<td class="lluvia__dias">' + c.precipitacion.map(function (mm, j) {
            return '<span title="' + dias[j] + ': ' + GT.fmt(mm, 1) + ' mm' +
              (c.probabilidad[j] !== null && c.probabilidad[j] !== undefined ? ' · prob. ' + c.probabilidad[j] + ' %' : '') + '">' +
              '<i style="height:' + Math.max(mm > 0 ? 2 : 0, 22 * Math.min(1, mm / tope)).toFixed(1) + 'px"></i></span>';
          }).join('') + '</td>' +
          '<td class="num mono">' + GT.fmt(c.total_72h, 0) + '</td>' +
          '<td class="num mono muted">' + GT.fmt(c.total_7d, 0) + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
    caja.querySelectorAll('tr[data-nombre] .enlace').forEach(function (b) {
      b.addEventListener('click', function () {
        const n = nombreGT(b.closest('tr').getAttribute('data-nombre'));
        if (n && S.api.abrirComuna) {
          S.api.abrirComuna(n);
          $('mapa').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  }

  /* ---------------------------------------------------------------------
     Eventos históricos
     --------------------------------------------------------------------- */

  /* Los eventos que hay van de 1972 a 2007, aunque la base de DesInventar
     cubra 1970–2014: decir "1970–2014" hacía creer que había datos recientes. */
  function periodoEventos() {
    const anios = (GT.eventosInundacion || []).map(function (e) { return +String(e.fecha).split(' ').pop(); })
      .filter(function (a) { return a > 1900; });
    if (!anios.length) return 'sin eventos';
    return 'eventos entre ' + Math.min.apply(null, anios) + ' y ' + Math.max.apply(null, anios);
  }

  function pintarEventos() {
    const cuerpo = $('eventos');
    if (!cuerpo) return;
    const reales = GT.origenInundacion === 'api' || GT.origenInundacion === 'copia';
    const todos = reales ? (GT.eventosInundacion || []) : [];
    const deLa = S.nombreComuna ? eventosDe(S.nombreComuna) : null;
    const mostrar = deLa && deLa.length ? deLa : todos.slice(0, 12);
    $('eventosNota').textContent = deLa
      ? (deLa.length ? deLa.length + ' en ' + S.nombreComuna : 'ninguno en ' + S.nombreComuna + ' · los más recientes')
      : todos.length + ' registros · los más recientes';
    cuerpo.innerHTML = mostrar.map(function (e) {
      return '<tr>' +
        '<td class="mono small">' + esc(e.fecha) + '</td>' +
        '<td>' + esc(e.lugar) + (e.tipo === 'Aluvion' ? ' <span class="tiny muted">aluvión</span>' : '') + '</td>' +
        '<td>' + esc(e.clase) + '</td>' +
        '<td>' + (e.acierto
          ? '<span class="badge badge--ok"><span class="dot"></span>En Alta</span>'
          : '<span class="badge badge--warn"><span class="dot"></span>Fuera</span>') + '</td>' +
      '</tr>';
    }).join('') + (reales
      ? '<tr><td colspan="4" class="tiny muted">' + (GT.eventosFuente || 'DesInventar') + ': ' +
        periodoEventos() + ', a nivel comunal. Registros de prensa: sobrerrepresentan las comunas pobladas.</td></tr>'
      : '<tr><td colspan="4" class="small muted">Sin conexión con la API: los eventos históricos no se pueden mostrar.</td></tr>');
  }

  /* ---------------------------------------------------------------------
     Buscador
     --------------------------------------------------------------------- */

  let buscables = [];
  function montarBuscador() {
    const input = $('buscar'), lista = $('buscables');
    if (!input) return;
    buscables = GT.comunas.map(function (c) {
      return { texto: c.nombre, tipo: 'comuna', comuna: c.nombre };
    });
    const pintar = function () {
      lista.innerHTML = buscables.map(function (b) {
        return '<option value="' + esc(b.texto) + '"></option>';
      }).join('');
    };
    pintar();
    Promise.all([S.detalle.listaLocalidades(), S.promesaModelo]).then(function (r) {
      const geo = r[0], m = r[1];
      if (!geo || !m) return;
      const nombrePorId = {};
      m.datos.comunas.forEach(function (c) { nombrePorId[c.id_comuna] = nombreGT(c.nombre); });
      geo.features.forEach(function (f) {
        const p = f.properties, comuna = nombrePorId[p.id_comuna];
        if (!comuna) return;
        buscables.push({ texto: p.nombre + ' · ' + p.categoria + ' de ' + comuna,
                         tipo: 'localidad', comuna: comuna, id: p.id_ciudad });
      });
      pintar();
    });
    const ir = function () {
      const v = norm(input.value);
      if (!v) return;
      const b = buscables.filter(function (x) { return norm(x.texto) === v; })[0] ||
                buscables.filter(function (x) { return norm(x.texto).indexOf(v) === 0; })[0] ||
                buscables.filter(function (x) { return norm(x.texto).indexOf(v) >= 0; })[0];
      if (!b) { aviso('No se encontró "' + input.value + '"'); return; }
      input.value = '';
      input.blur();
      irA(b);
    };
    input.addEventListener('change', ir);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ir(); } });
  }

  function irA(b) {
    if (b.tipo === 'localidad') {
      if (S.nombreComuna === b.comuna && S.detalle.base()) {
        S.detalle.localidades(true).then(function () { S.detalle.irALocalidad(b.id); });
        return;
      }
      S.pendienteLocalidad = b.id;
    }
    S.api.abrirComuna(b.comuna);
  }

  /* ---------------------------------------------------------------------
     Enlace: la URL guarda la vista
     --------------------------------------------------------------------- */

  let pedidoUrl = null;
  function leerUrl() {
    const p = new URLSearchParams(location.search);
    const pesos = p.get('pesos') ? p.get('pesos').split(',').map(Number) : null;
    if (pesos && pesos.length === 6 && pesos.every(function (x) { return x >= 0; })) {
      S.pesos = pesos;
      S.enMapa = p.get('escenario') === '1';
      const caja = $('pesos');
      if (caja) caja.open = true;
    }
    pedidoUrl = {
      comuna: p.get('comuna'),
      umbral: p.get('umbral') !== null ? parseFloat(p.get('umbral')) : null,
      loc: p.get('loc') === '1',
      cauces: p.get('cauces') === '1',
      equip: p.get('equip') === '1',
    };
  }

  function restaurarUrl() {
    const u = pedidoUrl;
    if (!u) return;
    if (u.cauces) activarCapa('cauces', true);
    if (u.equip) activarCapa('equipamiento', true);
    if (u.comuna) {
      const n = nombreGT(u.comuna);
      if (n) {
        S.pendiente = { umbral: u.umbral, loc: u.loc };
        S.api.abrirComuna(n);
      }
    }
  }

  let esperaUrl = null;
  function escribirUrl() {
    clearTimeout(esperaUrl);
    esperaUrl = setTimeout(function () {
      const p = new URLSearchParams(location.search);
      const poner = function (k, v) { if (v === null || v === undefined || v === '') p.delete(k); else p.set(k, v); };
      const r = S.resumen;
      poner('comuna', r ? r.comuna : null);
      poner('umbral', r && r.umbral !== null && r.umbral !== undefined && isFinite(r.umbral) ? r.umbral.toFixed(2) : null);
      poner('loc', r && r.localidadesActivas ? '1' : null);
      poner('cauces', S.capas.cauces ? '1' : null);
      poner('equip', S.capas.equipamiento ? '1' : null);
      const personalizados = S.modelo && S.pesos && !GTCalculo.mismosPesos(
        GTCalculo.normalizarPesos(S.pesos) || [], S.modelo.calibrados);
      poner('pesos', personalizados ? S.pesos.map(function (x) { return Math.round(x); }).join(',') : null);
      poner('escenario', personalizados && S.enMapa ? '1' : null);
      const q = p.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    }, 250);
  }

  /* ---------------------------------------------------------------------
     Exportar
     --------------------------------------------------------------------- */

  function montarExportar() {
    const boton = $('btnExportarInundacion'), menu = $('menuExportar');
    if (!boton || !menu) return;
    const acciones = [
      ['informe', 'Informe de la comuna', 'imprimible o PDF', true],
      ['localidades', 'Localidades y población', 'CSV', true],
      ['equipamiento', 'Escuelas, salud y emergencias', 'CSV', true],
      ['comunas', 'Comunas: índice, eventos y lluvia', 'CSV', false],
      ['kml', 'Zonas sobre el umbral · Google Earth', 'KML', true],
      ['geojson', 'Zonas sobre el umbral · QGIS', 'GeoJSON', true],
      ['imagen', 'Imagen del mapa', 'PNG', false],
      ['enlace', 'Copiar enlace a esta vista', '', false],
    ];
    menu.innerHTML = acciones.map(function (a) {
      return '<button type="button" role="menuitem" data-accion="' + a[0] + '"' + (a[3] ? ' data-comuna="1"' : '') + '>' +
        '<span>' + a[1] + '</span><span class="tiny muted">' + a[2] + '</span></button>';
    }).join('');
    const cerrar = function () { menu.hidden = true; boton.setAttribute('aria-expanded', 'false'); };
    boton.addEventListener('click', function (e) {
      e.stopPropagation();
      const abrir = menu.hidden;
      menu.hidden = !abrir;
      boton.setAttribute('aria-expanded', String(abrir));
      menu.querySelectorAll('[data-comuna]').forEach(function (b) {
        b.disabled = !S.resumen;
        b.title = S.resumen ? '' : 'Abre una comuna primero';
      });
    });
    document.addEventListener('click', function (e) { if (!menu.contains(e.target)) cerrar(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });
    menu.addEventListener('click', function (e) {
      const b = e.target.closest('button[data-accion]');
      if (!b || b.disabled) return;
      cerrar();
      ({ informe: informe, localidades: csvLocalidades, equipamiento: csvEquipamiento,
         comunas: csvComunas, imagen: pngMapa, enlace: copiarEnlace,
         kml: function () { zonasExportar('kml'); }, geojson: function () { zonasExportar('geojson'); } })[b.getAttribute('data-accion')]();
    });
  }

  function descargar(nombre, contenido, tipo) {
    const url = URL.createObjectURL(contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo }));
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function num(v, d) {
    if (v === null || v === undefined || isNaN(v)) return '';
    return Number(v).toFixed(d === undefined ? 2 : d).replace('.', ',');
  }
  function celdaCsv(v) {
    const s = String(v == null ? '' : v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(cabecera, filas, notas) {
    // Punto y coma y coma decimal: lo que Excel en español abre bien (ver shell.js).
    return '﻿' + (notas || []).map(function (n) { return '# ' + n; }).join('\n') + (notas ? '\n' : '') +
      [cabecera].concat(filas).map(function (f) { return f.map(celdaCsv).join(';'); }).join('\n') + '\n';
  }
  function hoy() { return GT_hoy(); }
  function archivo(base) { return 'terrafoco_' + base + '_' + norm(S.nombreComuna || 'region').replace(/[^a-z0-9]+/g, '-') + '_' + hoy(); }

  function notasComunes() {
    const r = S.resumen;
    return [
      'TerraFoco — susceptibilidad a inundación · exportado el ' + hoy(),
      'Comuna: ' + (r ? r.comuna : 'región') + (S.pesosMapa ? ' · escenario de pesos ' + S.pesosMapa.map(function (x) { return Math.round(x); }).join('/') : ' · índice calibrado'),
      r && r.umbral !== null ? 'Umbral: índice >= ' + num(r.umbral) : 'Umbral: por clases',
      'Índice estático de susceptibilidad (no predice cuándo). Ver docs/13-modulo-inundaciones.md.',
    ];
  }

  function exposicionActual() {
    const base = S.detalle && S.detalle.base(), zonas = S.detalle && S.detalle.zonas();
    return S.pob && base ? GTCalculo.exposicion(S.pob, base, zonas && zonas.indice, zonas ? zonas.lista.length : 0) : null;
  }

  function csvLocalidades() {
    const r = S.resumen;
    if (!r) return;
    const exp = exposicionActual(), zonas = S.detalle.zonas();
    const porId = {};
    if (exp && zonas) zonas.lista.forEach(function (f, k) { porId[f.properties.id_ciudad] = exp.localidades[k]; });
    const filas = [[r.comuna, 'comuna', '', num(r.fraccionSobre * 100, 1), num(r.haSobre, 1),
                    exp ? num(exp.personas, 0) : '', exp ? num(exp.personasSobre, 0) : '',
                    exp ? num(exp.viviendasSobre, 0) : '']]
      .concat(r.localidades.map(function (l) {
        const p = porId[l.id];
        return [l.nombre, l.categoria, num(l.haTotal, 1), num(l.fraccionSobre * 100, 1), num(l.haSobre, 1),
                p ? num(p.personas, 0) : '', p ? num(p.personasSobre, 0) : '', ''];
      }));
    descargar(archivo('localidades') + '.csv', csv(
      ['nombre', 'tipo', 'ha_totales', 'pct_area_sobre_umbral', 'ha_sobre_umbral', 'personas', 'personas_sobre_umbral', 'viviendas_sobre_umbral'],
      filas, notasComunes().concat([
        (S.anioPoblacion >= 2024
          ? 'Personas y viviendas: Censo 2024 (INE), urbano y rural, repartidas por celda de 30 m.'
          : 'Personas y viviendas: Censo 2017 por manzana (INE, copia OCUC), solo área urbana, repartidas por celda de 30 m.'),
        'Localidades: Límite Urbano Censal 2017 (INE, copia OCUC, CC BY-NC 4.0).'])), 'text/csv');
  }

  function csvEquipamiento() {
    if (!S.resumen) return;
    const filas = S.equipoComuna.slice().sort(function (a, b) { return (b.valor || 0) - (a.valor || 0); }).map(function (e) {
      const p = e.f.properties, c = e.f.geometry.coordinates;
      return [p.nombre || '', CATEGORIAS[p.categoria].nombre, TIPOS[p.tipo] || p.tipo,
              e.valor !== null ? num(e.valor, 3) : '', e.clase !== null ? CLASES[e.clase] : '',
              e.sobre ? 'sí' : 'no', num(c[1], 6), num(c[0], 6), p.osm];
    });
    descargar(archivo('servicios') + '.csv', csv(
      ['nombre', 'categoria', 'tipo', 'indice_celda', 'clase_celda', 'sobre_umbral', 'lat', 'lon', 'osm'],
      filas, notasComunes().concat(['Equipamiento: © colaboradores de OpenStreetMap (ODbL).'])), 'text/csv');
  }

  function csvComunas() {
    const m = S.modelo;
    const esc_ = m && S.pesos ? m.evaluar(S.pesos) : null;
    const porId = {};
    if (esc_) esc_.comunas.forEach(function (c) { porId[c.id] = c; });
    const ll = {};
    if (S.pronostico) S.pronostico.comunas.forEach(function (c) { ll[c.id_comuna] = c; });
    const filas = (m ? m.base.comunas : []).map(function (c) {
      const e = porId[c.id], l = ll[c.id];
      return [c.nombre, num(c.indice, 4), CLASES[c.clase], c.eventos, c.eventos82,
              e ? num(e.indice, 4) : '', e ? CLASES[e.clase] : '',
              l ? num(l.total_72h, 1) : '', l ? num(l.total_7d, 1) : ''];
    }).sort(function (a, b) { return parseFloat(b[1].replace(',', '.')) - parseFloat(a[1].replace(',', '.')); });
    descargar('terrafoco_inundacion_comunas_' + hoy() + '.csv', csv(
      ['comuna', 'indice_calibrado', 'clase_calibrada', 'eventos_1970_2014', 'eventos_sin_1982',
       'indice_escenario', 'clase_escenario', 'lluvia_72h_mm', 'lluvia_7d_mm'],
      filas, ['TerraFoco — susceptibilidad a inundación por comuna · exportado el ' + hoy(),
              'Escenario: pesos ' + (esc_ ? esc_.pesos.map(function (x) { return Math.round(x); }).join('/') : '—') +
              ' (pendiente/acumulación/distancia/TWI/curvatura/cobertura)',
              'Eventos: DesInventar (UNDRR/ONEMI). Lluvia: Open-Meteo, pronóstico en un punto de cada comuna.']), 'text/csv');
  }

  /* El lienzo de WebGL se borra después de cada cuadro: se lee dentro del
     evento 'render', cuando el cuadro recién se dibujó. */
  function capturarMapa() {
    return new Promise(function (res) {
      if (!S.mapa) { res(null); return; }
      S.mapa.once('render', function () {
        try { res(S.mapa.getCanvas().toDataURL('image/png')); } catch (e) { res(null); }
      });
      S.mapa.triggerRepaint();
    });
  }

  function pngMapa() {
    capturarMapa().then(function (url) {
      if (!url) { aviso('El navegador no dejó leer el mapa'); return; }
      fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
        descargar(archivo('mapa') + '.png', b);
      });
    });
  }

  /* Las zonas marcadas, con los servicios críticos sobre el umbral como
     puntos (en el KML). */
  function zonasExportar(formato) {
    if (!S.detalle || !S.detalle.exportarZonas) return;
    const puntos = S.equipoComuna.filter(function (e) { return e.sobre; }).map(function (e) {
      const p = e.f.properties, c = e.f.geometry.coordinates;
      return { nombre: p.nombre || 'Sin nombre en OSM', lng: c[0], lat: c[1],
               descripcion: (TIPOS[p.tipo] || p.tipo) + (e.valor !== null ? ' · índice ' + GT.fmt(e.valor, 2) : '') };
    });
    S.detalle.exportarZonas(formato, puntos);
  }

  function copiarEnlace() {
    escribirUrl();
    setTimeout(function () {
      const url = location.href;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
        .then(function () { aviso('Enlace copiado: reabre esta comuna, umbral y capas'); })
        .catch(function () { window.prompt('Copia el enlace:', url); });
    }, 300);
  }

  function informe() {
    if (!S.resumen) return;
    const w = window.open('', '_blank');
    if (!w) { aviso('El navegador bloqueó la ventana del informe'); return; }
    w.document.write('<p style="font:14px sans-serif;padding:24px">Preparando el informe…</p>');
    capturarMapa().then(function (img) {
      w.document.open();
      w.document.write(htmlInforme(img));
      w.document.close();
    });
  }

  function htmlInforme(img) {
    const r = S.resumen, m = S.modelo, exp = exposicionActual();
    const agr = S.agr && S.detalle.base() ? GTCalculo.exposicionAgricola(S.agr, S.detalle.base()) : null;
    const rural = exp && S.anioPoblacion >= 2024;
    const zonas = S.detalle.zonas();
    const porId = {};
    if (exp && zonas) zonas.lista.forEach(function (f, k) { porId[f.properties.id_ciudad] = exp.localidades[k]; });
    const sobre = S.equipoComuna.filter(function (e) { return e.sobre; })
      .sort(function (a, b) { return (b.valor || 0) - (a.valor || 0); });
    const ev = eventosDe(r.comuna), ll = lluviaDe(r.comuna);
    const b = m ? m.base : null;
    const comuna = b ? b.comunas.filter(function (c) { return norm(c.nombre) === norm(r.comuna); })[0] : null;
    const tabla = function (cab, filas) {
      return '<table><thead><tr>' + cab.map(function (c) { return '<th>' + c + '</th>'; }).join('') +
        '</tr></thead><tbody>' + filas.map(function (f) {
          return '<tr>' + f.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
    };
    const pesos = S.pesosMapa ? S.pesosMapa : (m ? m.calibrados : null);
    return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Informe de inundación · ' + esc(r.comuna) + '</title>' +
      '<style>' +
      'body{font:13px/1.5 Roboto,system-ui,sans-serif;color:#16232B;max-width:820px;margin:24px auto;padding:0 24px}' +
      'h1{font-size:22px;margin:0 0 2px}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #E2E7EC;padding-bottom:4px}' +
      '.sub{color:#5E6D75;margin:0 0 16px}.mapa{width:100%;border:1px solid #E2E7EC;border-radius:6px}' +
      '.cifras{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.cifras div{border:1px solid #E2E7EC;border-radius:6px;padding:8px 10px}' +
      '.cifras b{display:block;font-size:19px;font-weight:500}.cifras span{color:#5E6D75;font-size:12px}' +
      'table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #EDF1F3}' +
      'th{color:#5E6D75;font-weight:500}.nota{color:#5E6D75;font-size:11.5px}.barra{position:sticky;top:0;background:#fff;padding:8px 0;margin-bottom:8px}' +
      'button{font:inherit;padding:6px 12px;border:1px solid #9FACB8;border-radius:4px;background:#fff;cursor:pointer}' +
      '@media print{.barra{display:none}body{margin:0;max-width:none}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}' +
      '</style></head><body>' +
      '<div class="barra"><button onclick="window.print()">Imprimir o guardar como PDF</button></div>' +
      '<h1>Susceptibilidad a inundación · ' + esc(r.comuna) + '</h1>' +
      '<p class="sub">TerraFoco · Región de O\'Higgins · ' + new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }) +
        ' · ' + (S.pesosMapa ? 'escenario de pesos exploratorio' : 'índice calibrado') +
        (comuna ? ' · clase comunal <b>' + CLASES[comuna.clase] + '</b> (índice medio ' + GT.fmt(comuna.indice, 3) + ')' : '') + '</p>' +
      (img ? '<img class="mapa" src="' + img + '" alt="Mapa de la comuna">' : '') +
      '<p class="nota">Celdas de 30 m con índice ' + (r.umbral !== null ? '≥ ' + GT.fmt(r.umbral, 2) : 'en las clases marcadas') +
        '. Azul más intenso: más susceptible. Índice relativo a la región (clases por cuartiles).</p>' +
      '<h2>Lo que supera el umbral</h2><div class="cifras">' +
        '<div><b>' + pct(r.fraccionSobre) + '</b><span>de la comuna</span></div>' +
        '<div><b>≈ ' + fmt(r.haSobre) + ' ha</b><span>superficie</span></div>' +
        '<div><b>' + (agr ? '≈ ' + fmt(agr.cultivoSobre) + ' ha' : '—') + '</b><span>de cultivo' + (agr ? ' de ' + fmt(agr.cultivo) + ' ha' : '') + '</span></div>' +
        '<div><b>' + (agr ? '≈ ' + fmt(agr.praderaSobre) + ' ha' : '—') + '</b><span>de pradera' + (agr ? ' de ' + fmt(agr.pradera) + ' ha' : '') + '</span></div>' +
        '<div><b>' + (exp ? '≈ ' + fmt(exp.personasSobre) : '—') + '</b><span>personas' +
          (exp ? (rural ? ' (≈ ' + fmt(exp.ruralesSobre) + ' en el campo)' : ' urbanas') + ' de ' + fmt(exp.personas) : '') + '</span></div>' +
        '<div><b>' + sobre.length + '</b><span>escuelas, centros de salud y cuarteles de ' + S.equipoComuna.length + '</span></div>' +
      '</div>' +
      (r.localidades.length ? '<h2>Ciudades y pueblos</h2>' + tabla(
        ['Localidad', 'Tipo', '% del área sobre el umbral', 'ha sobre el umbral', 'Personas sobre el umbral'],
        r.localidades.map(function (l) {
          const p = porId[l.id];
          return [esc(l.nombre), esc(l.categoria), pct(l.fraccionSobre), fmt(l.haSobre), p ? '≈ ' + fmt(p.personasSobre) : '—'];
        })) : '') +
      '<h2>Escuelas, salud y emergencias sobre el umbral</h2>' + (sobre.length ? tabla(
        ['Nombre', 'Tipo', 'Índice de la celda', 'Clase'],
        sobre.map(function (e) {
          const p = e.f.properties;
          return [esc(p.nombre || 'Sin nombre'), esc(TIPOS[p.tipo] || p.tipo), e.valor !== null ? GT.fmt(e.valor, 2) : '', CLASES[e.clase]];
        })) : '<p>Ninguno según OpenStreetMap.</p>') +
      '<h2>Antecedentes y lluvia</h2><p>' + ev.length + ' eventos de inundación o aluvión registrados en DesInventar (1970–2014)' +
        (ev.length ? ': ' + esc(ev.map(function (e) { return e.fecha; }).join(', ')) : '') + '.' +
        (ll ? ' Lluvia pronosticada (Open-Meteo): ' + GT.fmt(ll.total_72h, 0) + ' mm en 72 h y ' + GT.fmt(ll.total_7d, 0) +
              ' mm en 7 días, máximo ' + GT.fmt(ll.max_diaria, 0) + ' mm en un día.' : '') + '</p>' +
      '<h2>Cómo se calculó</h2><p>Índice de susceptibilidad estática por celda de 30 m: suma ponderada de variables del terreno ' +
        'normalizadas a 0–1 entre sus percentiles 2 y 98 regionales' +
        (pesos && m ? ' (pesos: ' + m.variables.map(function (v, k) { return pesos[k] ? esc(v.nombre.toLowerCase()) + ' ' + fmt(pesos[k]) + ' %' : null; })
          .filter(Boolean).join(', ') + ')' : '') +
        '. Clases por cuartiles: cada clase es un cuarto del territorio de la región. ' +
        (b ? 'Validación con los eventos de DesInventar: ' + pct(b.fraccionEnAlta) + ' de los eventos cae en comunas Alta o Muy alta ' +
             '(el azar daría ' + pct(b.azar) + '), Spearman ' + signo(b.rho) + '. ' : '') +
        'No es un modelo hidrodinámico: dice dónde el terreno favorece la inundación, no cuándo ni con qué profundidad.</p>' +
      '<p class="nota">Fuentes: NASADEM (NASA); red hídrica IDE Chile; Sentinel-2 (ESA); DesInventar (UNDRR/ONEMI); ' +
        'Límite Urbano Censal 2017 (INE, copia Observatorio de Ciudades UC, CC BY-NC 4.0); población Censo 2024 (INE); ' +
        'cobertura del suelo ESA WorldCover 10 m 2021 (CC BY 4.0); ' +
        'equipamiento © colaboradores de OpenStreetMap (ODbL); pronóstico Open-Meteo (CC BY 4.0); mapa base © CARTO, © OpenStreetMap.</p>' +
      '</body></html>';
  }

  /* Lo que la simulación de lluvia (simulacion-inundacion.js) toma de la
     comuna abierta: las mismas grillas que usa esta página, sin copiarlas. */
  function contexto() {
    return {
      comuna: S.nombreComuna, idComuna: S.idComuna, grilla: S.grilla, agr: S.agr, pob: S.pob,
      anioPoblacion: S.anioPoblacion, equipo: S.equipoComuna, modelo: S.modelo,
      pronostico: S.pronostico, tipos: TIPOS,
    };
  }

  return {
    iniciar: iniciar,
    inspeccionar: inspeccionar,
    contexto: contexto,
  };
})();
