/* ==========================================================================
   TerraFoco — Colores del mapa a elección de quien lo usa

   Cada institución tiene su costumbre: hay quien lee la erosión en rojos,
   quien necesita una paleta apta para daltonismo o quien quiere las áreas
   verdes en su verde corporativo. Este módulo deja elegir, capa por capa,
   con qué colores se pintan las clases del mapa: una paleta preestablecida
   o cada clase a mano.

   Va justo después de js/paleta.js y antes que todo lo demás: reemplaza en
   PALETA.rampas (y en PALETA.mapa, para las plazas) los colores elegidos,
   y desde ahí los leen el mapa, las leyendas, los gráficos y las zonas que
   se descargan en KML. Igual que el tema, aplicar recarga la página: todo
   se arma con la paleta al cargar, y repintar en caliente sería un segundo
   camino de pintado que mantener sincronizado.

   No toca PALETA.codificacion: esos son los colores con que el motor
   escribió los PNG, y el visor los usa para recuperar la clase de cada
   píxel. Elegir otros colores cambia cómo se pinta, no cómo se lee.

   Las paletas preestablecidas se generaron en OKLCH copiando el perfil de
   luminosidad y croma de las rampas originales (validadas, ver paleta.js)
   y cambiando solo el tono: conservan los saltos entre clases y el
   contraste de la clase más tenue con el fondo del mapa. Cada una trae su
   versión para cada tema.

   Dónde se guarda: en este navegador (localStorage). Una paleta elegida
   vale para los dos temas; un color ajustado a mano, solo para el tema en
   que se ajustó, porque un tono pensado para fondo oscuro no se lee sobre
   el claro. Con ?colores=… en la URL se deja un enlace listo con la
   selección, como ?tema=claro.
   ========================================================================== */

const GTColores = (function () {
  'use strict';

  const CLAVE = 'terrafoco_colores';
  const PARAM = 'colores';
  const HEX = /^#[0-9A-F]{6}$/i;
  const TEMA = PALETA.tema;

  /* Las capas que se pueden repintar. `sentido` dice qué extremo es el
     malo: con él las paletas "de lo bueno a lo malo" (semáforo y las
     divergentes) se orientan solas. Sin sentido —pendiente, inversión— no
     hay bueno ni malo y solo se ofrecen las secuenciales. `css`: el prefijo
     de las variables con que styles.css replica la rampa. */
  const CAPAS = [
    { id: 'erosion', grupo: 'Suelos', nombre: 'Erosión del suelo', css: 'ero',
      sentido: 'malo-alto',
      clases: ['Ligera', 'Moderada', 'Severa', 'Muy severa', 'Extrema'] },
    { id: 'pendiente', grupo: 'Suelos', nombre: 'Pendiente', sentido: null,
      clases: ['Plana', 'Suave', 'Moderada', 'Fuerte', 'Muy fuerte'] },
    { id: 'vegetacion', grupo: 'Suelos', nombre: 'Vegetación (NDVI)', sentido: 'bueno-alto',
      clases: ['Sin vegetación', 'Escasa', 'Moderada', 'Densa', 'Muy densa'] },
    { id: 'pertinencia', grupo: 'Suelos', nombre: 'Índice de pertinencia', css: 'pert',
      sentido: 'malo-alto', soloDivergentes: true,
      clases: ['Sobre-cobertura', 'Cobertura adecuada', 'Alineación parcial',
               'Brecha alta', 'Brecha crítica'] },
    { id: 'inversion', grupo: 'Suelos', nombre: 'Inversión SIRSD-S por ha', sentido: null,
      clases: ['Muy baja', 'Baja', 'Media', 'Alta', 'Muy alta'] },
    /* El primer tono del agua es fondo, no clase (rampaDesde: 1 en
       detalle-comuna.js): no se ofrece para editar, pero viaja con la paleta. */
    { id: 'agua', grupo: 'Inundaciones', nombre: 'Susceptibilidad a inundación', css: 'agua',
      sentido: 'malo-alto',
      clases: [null, 'Baja', 'Media', 'Alta', 'Muy alta'] },
    { id: 'calor', grupo: 'Ciudades', nombre: 'Temperatura de superficie', css: 'calor',
      sentido: 'malo-alto',
      clases: ['Fresca', 'Templada', 'Cálida', 'Muy cálida', 'Extrema'] },
    { id: 'areaVerde', grupo: 'Ciudades', nombre: 'Área verde por habitante', sentido: 'bueno-alto',
      clases: ['Muy bajo', 'Bajo', 'Medio', 'Cerca', 'Cumple'] },
    /* Las plazas no son una rampa sino dos colores sueltos de PALETA.mapa. */
    { id: 'plazas', grupo: 'Ciudades', nombre: 'Plazas y parques', mapa: ['plaza', 'pasto'],
      clases: ['Plaza o parque', 'Solo pasto'] },
  ];

  /* Secuenciales: de la clase baja a la alta. */
  const SECUENCIALES = [
    { id: 'naranjas', nombre: 'Naranjas',
      claro:  ['#FFF1E6', '#FFD6B7', '#F2A96B', '#C66E00', '#874902'],
      oscuro: ['#764515', '#A25901', '#CC7200', '#F48A0B', '#FDB67B'] },
    { id: 'rojos', nombre: 'Rojos',
      claro:  ['#FEF0EF', '#FED4CF', '#FE9D95', '#DA5652', '#9A3331'],
      oscuro: ['#7D3C38', '#AD4C47', '#D9615B', '#FF7B74', '#FEB0A9'] },
    { id: 'azules', nombre: 'Azules',
      claro:  ['#EDF5FE', '#C8E2FF', '#84C1FF', '#1C8BE7', '#035DA1'],
      oscuro: ['#275582', '#2872B5', '#3490E4', '#5CAEFF', '#9CCCFF'] },
    { id: 'verdes', nombre: 'Verdes',
      claro:  ['#EAF8EC', '#C1ECC9', '#82D193', '#15A24D', '#006E30'],
      oscuro: ['#276037', '#278344', '#34A557', '#45C66C', '#91DCA1'] },
    { id: 'turquesas', nombre: 'Turquesas',
      claro:  ['#E3F9F7', '#ADEEE9', '#4BD3CC', '#099C96', '#066965'],
      oscuro: ['#065F5C', '#067F7A', '#04A19B', '#07C2BB', '#62DED7'] },
    { id: 'purpuras', nombre: 'Púrpuras',
      claro:  ['#F7F1FE', '#E8D6FF', '#CDA8F8', '#A069D7', '#6E4298'],
      oscuro: ['#5E447A', '#8059AA', '#A271D5', '#C28AFE', '#D7B6FF'] },
    { id: 'grises', nombre: 'Grises',
      claro:  ['#F4F4F4', '#DFDFDF', '#BBBBBB', '#888888', '#5B5B5B'],
      oscuro: ['#525252', '#6E6E6E', '#8C8C8C', '#A9A9A9', '#C7C7C7'] },
    /* Multitono: el tono viaja con la luminosidad, como en viridis. */
    { id: 'viridis', nombre: 'Viridis (multitono)',
      claro:  ['#FDF8A8', '#ACF69C', '#49D4C5', '#438CD3', '#6346A0'],
      oscuro: ['#593F91', '#3A70B3', '#11A195', '#72C061', '#D7CC37'] },
    { id: 'fuego', nombre: 'Fuego (multitono)',
      claro:  ['#FFF4CB', '#FFD7B2', '#FE9F86', '#D64F8D', '#734095'],
      oscuro: ['#6A368B', '#B53873', '#E8513F', '#EC8F36', '#E0C666'] },
    /* Azul y amarillo: se distinguen con las tres formas de daltonismo. */
    { id: 'cividis', nombre: 'Cividis (apta para daltonismo)',
      claro:  ['#FFF6BE', '#E8E1B3', '#BFBCAD', '#748AA6', '#3C5B8D'],
      oscuro: ['#38527E', '#5B708C', '#908C7F', '#B5AB6F', '#D9C968'] },
  ];

  /* Divergentes: de lo bueno a lo malo, con el centro neutro. En las capas
     donde lo alto es lo bueno se dan vuelta. */
  const DIVERGENTES = [
    { id: 'turquesaNaranja', nombre: 'Turquesa a naranja',
      claro:  ['#0B7A72', '#62BE8E', '#C3CCD4', '#EFA13A', '#C2451A'],
      oscuro: ['#3ADFD7', '#36A15D', '#505963', '#A97515', '#FE9372'] },
    { id: 'azulRojo', nombre: 'Azul a rojo',
      claro:  ['#3F6D9B', '#6EADED', '#C7CBD0', '#FF9084', '#C34039'],
      oscuro: ['#96C9FE', '#3C8DDB', '#55585C', '#BE6158', '#FF9085'] },
    { id: 'verdePurpura', nombre: 'Verde a púrpura',
      claro:  ['#41784E', '#71BC82', '#C7CBD0', '#DD94ED', '#9E4CB0'],
      oscuro: ['#83DC97', '#3CA15A', '#55585C', '#A067AD', '#DB96EA'] },
    /* El que suelen pedir. Verde y rojo se confunden en deuteranopía: el
       editor lo advierte. */
    { id: 'semaforo', nombre: 'Semáforo (verde a rojo)', advertencia: true,
      claro:  ['#1C8742', '#8FBC4C', '#F0CF4C', '#ED8725', '#C93029'],
      oscuro: ['#3FC168', '#A0D157', '#F0CF4C', '#F0903C', '#EC5B57'] },
  ];

  const PRESETS = {};
  SECUENCIALES.forEach(function (p) { p.tipo = 'secuencial'; PRESETS[p.id] = p; });
  DIVERGENTES.forEach(function (p) { p.tipo = 'divergente'; PRESETS[p.id] = p; });

  const CAPA = {};
  CAPAS.forEach(function (c) { CAPA[c.id] = c; });

  /* Lo que trae paleta.js, antes de aplicar nada: es el "Original". */
  const ORIGINAL = {};
  CAPAS.forEach(function (c) {
    ORIGINAL[c.id] = c.mapa
      ? c.mapa.map(function (k) { return PALETA.mapa[k]; })
      : PALETA.rampas[c.id].slice();
  });

  function presetsDe(capa) {
    if (capa.mapa) return [];
    const div = capa.sentido ? DIVERGENTES : [];
    return capa.soloDivergentes ? div : SECUENCIALES.concat(div);
  }

  /* --------------------------------------------------------------------------
     Preferencias: { capas: { erosion: { preset: 'rojos', oscuro: [...] } } }
     -------------------------------------------------------------------------- */

  /* Solo pasa lo que se reconoce: capas que existen, paletas que existen y
     colores #RRGGBB. Llega desde localStorage o desde la URL, y termina en
     atributos style y en el mapa. */
  function limpiar(bruto) {
    const out = { capas: {} };
    const capas = bruto && typeof bruto === 'object' && bruto.capas;
    if (!capas || typeof capas !== 'object') return out;
    Object.keys(capas).forEach(function (id) {
      const capa = CAPA[id], v = capas[id];
      if (!capa || !v || typeof v !== 'object') return;
      const e = {};
      if (typeof v.preset === 'string' && PRESETS[v.preset] &&
          presetsDe(capa).indexOf(PRESETS[v.preset]) >= 0) e.preset = v.preset;
      ['oscuro', 'claro'].forEach(function (t) {
        const a = v[t];
        if (Array.isArray(a) && a.length === ORIGINAL[id].length &&
            a.every(function (h) { return typeof h === 'string' && HEX.test(h); })) {
          e[t] = a.map(function (h) { return h.toUpperCase(); });
        }
      });
      if (Object.keys(e).length) out.capas[id] = e;
    });
    return out;
  }

  function vacio(prefs) { return !Object.keys(prefs.capas).length; }

  /* base64url del JSON: cabe en la URL sin escapar nada. */
  function codificar(prefs) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(prefs))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodificar(texto) {
    try {
      const b = texto.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (e) { return null; }
  }

  function leer() {
    try {
      const u = new URL(window.location.href);
      const pedido = u.searchParams.get(PARAM);
      if (pedido) {
        const prefs = pedido === 'original' ? { capas: {} } : limpiar(decodificar(pedido));
        /* Guardada, la selección sigue en las demás páginas y el parámetro
           sobra en la barra de direcciones. Si el almacenamiento está
           bloqueado, se deja: es lo único que la conserva al recargar. */
        try {
          if (vacio(prefs)) localStorage.removeItem(CLAVE);
          else localStorage.setItem(CLAVE, JSON.stringify(prefs));
          u.searchParams.delete(PARAM);
          window.history.replaceState(window.history.state, '', u.toString());
        } catch (e) { /* queda en la URL */ }
        return prefs;
      }
    } catch (e) { /* navegador sin URL: se lee lo guardado */ }
    try { return limpiar(JSON.parse(localStorage.getItem(CLAVE))); }
    catch (e) { return { capas: {} }; }
  }

  /* Los colores de una capa en el tema actual: lo ajustado a mano, la
     paleta elegida o el original, en ese orden. */
  function coloresDe(id, prefs) {
    const e = prefs.capas[id];
    if (e && e[TEMA]) return e[TEMA].slice();
    if (e && e.preset) {
      const p = PRESETS[e.preset];
      const c = p[TEMA].slice();
      return (p.tipo === 'divergente' && CAPA[id].sentido === 'bueno-alto') ? c.reverse() : c;
    }
    return ORIGINAL[id].slice();
  }

  function aplicar(prefs) {
    const raiz = document.documentElement;
    CAPAS.forEach(function (capa) {
      if (!prefs.capas[capa.id]) return;
      const colores = coloresDe(capa.id, prefs);
      if (capa.mapa) {
        capa.mapa.forEach(function (k, i) { PALETA.mapa[k] = colores[i]; });
        return;
      }
      PALETA.rampas[capa.id] = colores;
      if (capa.css) {
        colores.forEach(function (c, i) { raiz.style.setProperty('--' + capa.css + '-' + (i + 1), c); });
      }
    });
  }

  const ACTUALES = leer();
  aplicar(ACTUALES);

  function urlCon(prefs) {
    const u = new URL(window.location.href);
    u.searchParams.set(PARAM, vacio(prefs) ? 'original' : codificar(prefs));
    return u;
  }

  function guardarYRecargar(prefs) {
    let u = new URL(window.location.href);
    u.searchParams.delete(PARAM);
    try {
      if (vacio(prefs)) localStorage.removeItem(CLAVE);
      else localStorage.setItem(CLAVE, JSON.stringify(prefs));
    } catch (e) {
      u = urlCon(prefs);   // sin almacenamiento, la selección viaja en la URL
    }
    /* Con un #ancla en la URL, asignar la misma dirección solo desplaza la
       página: hay que pedir la recarga explícitamente. */
    if (u.toString() === window.location.href) window.location.reload();
    else window.location.href = u.toString();
  }

  /* --------------------------------------------------------------------------
     Distinguibilidad: dos clases vecinas casi iguales se pintan como una.
     Distancia en OKLab; bajo 0,03 el ojo ya no las separa en el mapa.
     -------------------------------------------------------------------------- */

  function oklab(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    const l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2]);
    const m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2]);
    const s = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2]);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }

  function parecidas(capa, colores) {
    const pares = [];
    let previo = null;
    capa.clases.forEach(function (nombre, i) {
      if (!nombre) return;
      if (previo !== null) {
        const a = oklab(colores[previo]), b = oklab(colores[i]);
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d < 0.03) pares.push(capa.clases[previo] + ' y ' + nombre);
      }
      previo = i;
    });
    return pares;
  }

  /* --------------------------------------------------------------------------
     Editor
     -------------------------------------------------------------------------- */

  const GRUPO_DE_PAGINA = { inundaciones: 'Inundaciones', urbano: 'Ciudades' };

  let dialogo = null;
  let borrador = null;

  function clonar(prefs) { return JSON.parse(JSON.stringify(prefs)); }

  function escapar(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function opciones(capa) {
    const lista = presetsDe(capa);
    if (!lista.length) return '';
    const grupo = function (rotulo, tipo) {
      const items = lista.filter(function (p) { return p.tipo === tipo; });
      if (!items.length) return '';
      return '<optgroup label="' + rotulo + '">' + items.map(function (p) {
        return '<option value="' + p.id + '">' + escapar(p.nombre) + '</option>';
      }).join('') + '</optgroup>';
    };
    return '<option value="">Original</option>' +
           '<option value="__personal" hidden>Personalizada</option>' +
           grupo('Secuenciales', 'secuencial') +
           grupo(capa.sentido === 'bueno-alto' ? 'De lo malo a lo bueno' : 'De lo bueno a lo malo',
                 'divergente');
  }

  function filaCapa(capa) {
    const n = capa.clases.filter(Boolean).length;
    const clases = capa.clases.map(function (nombre, i) {
      if (!nombre) return '';
      return '<label class="colores__clase" title="' + escapar(nombre) + '">' +
               '<input type="color" data-i="' + i + '" aria-label="' +
                 escapar(capa.nombre + ': ' + nombre) + '">' +
               '<span>' + escapar(nombre) + '</span>' +
             '</label>';
    }).join('');
    const sel = presetsDe(capa).length
      ? '<select class="colores__paleta" aria-label="Paleta de ' + escapar(capa.nombre) + '">' +
          opciones(capa) + '</select>'
      : '';
    return '<div class="colores__capa" data-capa="' + capa.id + '">' +
             '<div class="colores__cabeza">' +
               '<span class="colores__nombre">' + escapar(capa.nombre) + '</span>' +
               sel +
               '<button type="button" class="colores__original" data-original ' +
                 'title="Volver a los colores originales de ' + escapar(capa.nombre) + '">Original</button>' +
             '</div>' +
             '<div class="colores__clases" style="--n:' + n + '">' + clases + '</div>' +
             '<p class="colores__aviso" hidden></p>' +
           '</div>';
  }

  function construir() {
    const grupos = [];
    CAPAS.forEach(function (c) { if (grupos.indexOf(c.grupo) < 0) grupos.push(c.grupo); });

    dialogo = document.createElement('dialog');
    dialogo.className = 'dialogo dialogo--colores';
    dialogo.setAttribute('aria-labelledby', 'dlgColoresTitulo');
    dialogo.innerHTML =
      '<form method="dialog">' +
        '<div class="colores__intro">' +
          '<div class="card__title" id="dlgColoresTitulo">Colores del mapa</div>' +
          '<p class="small muted">Elige una paleta para cada capa, o haz clic en el color de ' +
            'una clase para cambiarlo. Se guarda en este navegador: las paletas valen para ' +
            'los dos temas y los colores ajustados a mano, solo para el tema ' + TEMA + '.</p>' +
        '</div>' +
        '<div class="colores__lista">' +
          grupos.map(function (g) {
            return '<section class="colores__grupo" data-grupo="' + g + '">' +
                     '<h3 class="colores__grupo-titulo">' + g + '</h3>' +
                     CAPAS.filter(function (c) { return c.grupo === g; }).map(filaCapa).join('') +
                   '</section>';
          }).join('') +
        '</div>' +
        '<div class="colores__pie">' +
          '<button type="button" class="btn btn--chico" data-todo-original>Todo original</button>' +
          '<button type="button" class="btn btn--chico" data-copiar ' +
            'title="Copia un enlace que abre TerraFoco con estos colores">Copiar enlace</button>' +
          '<span class="colores__estado tiny muted" role="status"></span>' +
          '<span class="colores__espacio"></span>' +
          '<button type="button" class="btn" data-cancelar>Cancelar</button>' +
          '<button type="button" class="btn btn--primary" data-aplicar>Aplicar</button>' +
        '</div>' +
      '</form>';
    document.body.appendChild(dialogo);

    dialogo.addEventListener('change', function (ev) {
      const fila = ev.target.closest('.colores__capa');
      if (!fila || !ev.target.classList.contains('colores__paleta')) return;
      const id = fila.dataset.capa, v = ev.target.value;
      if (v === '__personal') return;
      if (v) borrador.capas[id] = { preset: v };
      else delete borrador.capas[id];
      pintarFila(fila);
    });

    /* 'input' y no 'change': el color se ve mientras se arrastra el selector. */
    dialogo.addEventListener('input', function (ev) {
      if (ev.target.type !== 'color') return;
      const fila = ev.target.closest('.colores__capa');
      const id = fila.dataset.capa;
      const colores = coloresDe(id, borrador);
      colores[+ev.target.dataset.i] = ev.target.value.toUpperCase();
      const e = borrador.capas[id] || {};
      e[TEMA] = colores;
      borrador.capas[id] = e;
      pintarFila(fila, ev.target);
    });

    dialogo.addEventListener('click', function (ev) {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-original')) {
        const fila = b.closest('.colores__capa');
        delete borrador.capas[fila.dataset.capa];
        pintarFila(fila);
      } else if (b.hasAttribute('data-todo-original')) {
        borrador = { capas: {} };
        pintarTodo();
      } else if (b.hasAttribute('data-copiar')) {
        copiarEnlace();
      } else if (b.hasAttribute('data-cancelar')) {
        dialogo.close();
      } else if (b.hasAttribute('data-aplicar')) {
        if (JSON.stringify(limpiar(borrador)) === JSON.stringify(ACTUALES)) dialogo.close();
        else guardarYRecargar(limpiar(borrador));
      }
    });
  }

  function pintarFila(fila, salvo) {
    const id = fila.dataset.capa, capa = CAPA[id];
    const colores = coloresDe(id, borrador);
    fila.querySelectorAll('input[type="color"]').forEach(function (inp) {
      if (inp !== salvo) inp.value = colores[+inp.dataset.i].toLowerCase();
    });
    const e = borrador.capas[id];
    const sel = fila.querySelector('.colores__paleta');
    if (sel) sel.value = e && e[TEMA] ? '__personal' : (e && e.preset) || '';
    fila.querySelector('[data-original]').disabled = !e;

    const avisos = parecidas(capa, colores).map(function (par) {
      return par + ' casi no se distinguen en el mapa.';
    });
    if (e && e.preset && !e[TEMA] && PRESETS[e.preset].advertencia) {
      avisos.push('Verde y rojo se confunden con el daltonismo más común; ' +
                  'Cividis se lee con todos.');
    }
    const aviso = fila.querySelector('.colores__aviso');
    aviso.textContent = avisos.join(' ');
    aviso.hidden = !avisos.length;
  }

  function pintarTodo() {
    dialogo.querySelectorAll('.colores__capa').forEach(function (f) { pintarFila(f); });
  }

  function estado(texto) {
    const el = dialogo.querySelector('.colores__estado');
    el.textContent = texto;
    clearTimeout(estado.t);
    estado.t = setTimeout(function () { el.textContent = ''; }, 4000);
  }

  function copiarEnlace() {
    const url = urlCon(limpiar(borrador)).toString();
    const listo = function () { estado('Enlace copiado.'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(listo, function () { window.prompt('Copia este enlace:', url); });
    } else {
      window.prompt('Copia este enlace:', url);
    }
  }

  function abrir(pagina) {
    if (!dialogo) construir();
    borrador = clonar(ACTUALES);
    pintarTodo();
    dialogo.showModal();
    const grupo = GRUPO_DE_PAGINA[pagina];
    const lista = dialogo.querySelector('.colores__lista');
    const seccion = grupo && dialogo.querySelector('[data-grupo="' + grupo + '"]');
    lista.scrollTop = seccion ? seccion.offsetTop - lista.offsetTop : 0;
  }

  return { abrir: abrir, capas: CAPAS, presets: PRESETS, original: ORIGINAL,
           actuales: function () { return clonar(ACTUALES); } };
})();
