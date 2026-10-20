/* ==========================================================================
   TerraFoco — Prototipo no funcional
   Barra lateral y barra superior comunes a todas las pantallas
   ========================================================================== */

const ICONOS = {
  panel:   '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  visor:   '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
  diana:   '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  capas:   '<path d="M12 3 3 8l9 5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  agua:    '<path d="M12 3s6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 6-10 6-10z"/>',
  ciudad:  '<rect x="4" y="8" width="7" height="13" rx="1"/><rect x="13" y="3" width="7" height="18" rx="1"/><path d="M7 12h1M7 16h1M16 7h1M16 11h1M16 15h1"/>',
  datos:   '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  bajar:   '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  info:    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  ayuda:   '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.9M12 17h.01"/>',
  menu:    '<path d="M4 7h16M4 12h16M4 17h16"/>',
  buscar:  '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  pin:     '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  sol:     '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  luna:    '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  paleta:  '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2a1.7 1.7 0 0 1 1.3-2.8H17a4 4 0 0 0 4-4c0-4.6-4-8.3-9-8.3z"/><circle cx="7.5" cy="11.5" r="1.1"/><circle cx="10" cy="7.5" r="1.1"/><circle cx="14.5" cy="7.5" r="1.1"/><circle cx="17" cy="11.5" r="1.1"/>'
};

const MENU = [
  { grupo: 'General' },
  { id: 'index',        href: 'index.html',        nombre: 'Panel general',       icono: 'panel' },
  { id: 'visor',        href: 'visor.html',        nombre: 'Visor cartográfico',  icono: 'visor' },
  { id: 'predios',      href: 'predios.html',      nombre: 'Mis predios',         icono: 'pin' },
  { grupo: 'Módulo 1 — Suelos' },
  { id: 'pertinencia',  href: 'pertinencia.html',  nombre: 'Índice de pertinencia', icono: 'diana' },
  { id: 'comuna',       href: 'comuna.html',       nombre: 'Ficha de comuna',     icono: 'capas' },
  { grupo: 'Módulos 2 y 3' },
  { id: 'inundaciones', href: 'inundaciones.html', nombre: 'Inundaciones',        icono: 'agua' },
  { id: 'urbano',       href: 'urbano.html',       nombre: 'Ciudades',            icono: 'ciudad', etiqueta: 'complementario' },
  { grupo: 'Núcleo' },
  { id: 'fuentes',      href: 'fuentes.html',      nombre: 'Fuentes de datos',    icono: 'datos' },
  { id: 'ayuda',        href: 'ayuda.html',        nombre: 'Ayuda y glosario',    icono: 'ayuda' }
];

/* Fechas en la hora de Chile. La API entrega instantes en UTC, y cortar el
   texto ISO mostraba "03-10 00:49" cuando aquí todavía era el 2 de octubre;
   lo mismo pasaba con la fecha de los archivos exportados después de las
   21:00. */
const ZONA_HORARIA = 'America/Santiago';

/* Reloj de la barra superior, en la hora de Chile: la pantalla se lee como
   un tablero en vivo, y los datos "en vivo" del badge tienen contra qué
   compararse. */
function montarReloj() {
  const el = document.getElementById('reloj');
  if (!el) return;
  const formato = new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const pintar = function () {
    const p = {};
    formato.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    el.innerHTML = p.day + '.' + p.month + '.' + p.year + '<strong>' + p.hour + ':' + p.minute + '</strong>';
  };
  pintar();
  setInterval(pintar, 15000);
}

function GT_fecha(iso, conHora) {
  if (!iso) return '—';
  const f = new Date(iso);
  if (isNaN(f)) return String(iso).slice(0, 16).replace('T', ' ');
  const p = {};
  new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(f).forEach(function (x) { p[x.type] = x.value; });
  return p.day + '-' + p.month + '-' + p.year + (conHora === false ? '' : ' ' + p.hour + ':' + p.minute);
}

/* AAAA-MM-DD de hoy en Chile, para nombres de archivo. */
function GT_hoy() {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit',
                                     day: '2-digit' })
    .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
  return p.year + '-' + p.month + '-' + p.day;
}

function svgIcono(nombre, tam) {
  return '<svg width="' + (tam || 16) + '" height="' + (tam || 16) + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    ICONOS[nombre] + '</svg>';
}

/* Cambio de tema: muestra el ícono del tema al que se pasa, y lo dice. */
function botonTema() {
  const claro = document.documentElement.getAttribute('data-tema') === 'claro';
  const destino = claro ? 'oscuro' : 'claro';
  return '<button type="button" class="btn-icono" id="btnTema" ' +
           'title="Cambiar a modo ' + destino + '" aria-label="Cambiar a modo ' + destino + '">' +
           svgIcono(claro ? 'luna' : 'sol', 16) +
         '</button>';
}

/* Colores del mapa a elección (js/colores-mapa.js). Sin ese módulo en la
   página, no hay botón. */
function botonColores() {
  if (typeof GTColores === 'undefined') return '';
  return '<button type="button" class="btn-icono" id="btnColores" ' +
           'title="Colores del mapa" aria-label="Elegir los colores del mapa" aria-haspopup="dialog">' +
           svgIcono('paleta', 16) +
         '</button>';
}

/* El grupo del menú al que pertenece una página, para la ruta de la barra. */
function grupoDe(pagina) {
  let grupo = '';
  for (let i = 0; i < MENU.length; i++) {
    if (MENU[i].grupo) grupo = MENU[i].grupo;
    else if (MENU[i].id === pagina) return grupo;
  }
  return '';
}

function pintarShell(paginaActiva, titulo, subtitulo, acciones, explicacion) {
  const nav = MENU.map(function (m) {
    if (m.grupo) return '<div class="nav__label">' + m.grupo + '</div>';
    const activo = m.id === paginaActiva ? ' nav__item--active' : '';
    return '<a class="nav__item' + activo + '" href="' + m.href + '">' +
             svgIcono(m.icono) + '<span>' + m.nombre +
             (m.etiqueta ? ' <em class="nav__etiqueta">' + m.etiqueta + '</em>' : '') + '</span></a>';
  }).join('');

  const sidebar =
    '<aside class="sidebar" id="menuLateral">' +
      '<div class="sidebar__brand">' +
        '<div class="sidebar__mark">' + '<span></span>'.repeat(9) + '</div>' +
        '<div>' +
          '<div class="sidebar__name">TerraFoco</div>' +
          '<div class="sidebar__tag">Focalización territorial</div>' +
        '</div>' +
      '</div>' +
      '<nav class="nav">' + nav + '</nav>' +
      '<div class="sidebar__foot">' +
        /* Decía "Prototipo no funcional": dejó de serlo cuando la API y la
           base empezaron a responder, y al pie de un sistema que escribe
           datos reales contradecía lo que la pantalla mostraba. */
        'Proyecto APT · Capstone 2026<br>' +
        'Duoc UC' +
      '</div>' +
    '</aside>';

  /* Barra superior: dónde estoy y qué dato estoy mirando. Nada más: los
     filtros tienen su propia fila bajo el encabezado. Con siete controles
     aquí, la barra se partía en tres líneas. */
  const topbar =
    '<header class="topbar">' +
      '<button type="button" class="btn-icono topbar__menu" id="btnMenu" aria-label="Abrir el menú" ' +
        'aria-expanded="false" aria-controls="menuLateral">' + svgIcono('menu', 18) + '</button>' +
      '<nav class="migas" aria-label="Ubicación">' +
        '<span>' + grupoDe(paginaActiva) + '</span>' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>' +
        '<span aria-current="page">' + titulo + '</span>' +
      '</nav>' +
      '<div class="topbar__spacer"></div>' +
      /* Ir a una comuna desde cualquier pantalla: es la pregunta más común
         ("¿y mi comuna?") y antes había que entrar a la ficha y buscarla en
         un selector. */
      '<label class="buscador buscador--global" title="Ir a la ficha de una comuna">' +
        svgIcono('buscar', 14) +
        '<input type="search" id="buscarComuna" list="listaComunas" placeholder="Ir a una comuna" ' +
               'aria-label="Ir a la ficha de una comuna" autocomplete="off">' +
        '<datalist id="listaComunas"></datalist>' +
      '</label>' +
      '<span class="badge badge--proto"><span class="dot"></span>Prototipo · datos de ejemplo</span>' +
      '<span class="reloj" id="reloj" title="Hora de Chile"></span>' +
      botonColores() +
      botonTema() +
    '</header>';

  document.getElementById('sidebar').outerHTML = sidebar;
  document.getElementById('topbar').outerHTML = topbar;
  montarReloj();

  /* Encabezado de la página y fila de filtros, al inicio del contenido. Las
     páginas siguen pasando sus controles en un solo texto; aquí se reparten:
     los botones son acciones y van junto al título, el resto filtra y va en
     su fila. Los ids no cambian, así que el JS que los monta tampoco. */
  const piezas = document.createElement('div');
  piezas.innerHTML = acciones || '';
  const botones = [], filtros = [];
  Array.from(piezas.children).forEach(function (el) {
    (el.classList.contains('btn') || el.classList.contains('menu') ? botones : filtros).push(el);
  });

  const cabecera = document.createElement('section');
  cabecera.className = 'cabecera';
  cabecera.innerHTML =
    '<div class="encabezado">' +
      '<div class="encabezado__texto">' +
        (subtitulo ? '<div class="encabezado__eyebrow">' + subtitulo + '</div>' : '') +
        '<h1 class="encabezado__titulo">' + titulo + '</h1>' +
        (explicacion ? '<p class="encabezado__desc">' + explicacion + '</p>' : '') +
      '</div>' +
      '<div class="encabezado__acciones"></div>' +
    '</div>';
  const zonaAcciones = cabecera.querySelector('.encabezado__acciones');
  botones.forEach(function (b) { zonaAcciones.appendChild(b); });
  if (filtros.length) {
    const fila = document.createElement('div');
    fila.className = 'filtros';
    filtros.forEach(function (f) { fila.appendChild(f); });
    cabecera.appendChild(fila);
  }
  const contenido = document.querySelector('.content');
  if (contenido) contenido.insertBefore(cabecera, contenido.firstChild);

  /* El badge de origen se rotula AQUI y no al terminar la hidratación: la
     barra superior se pinta después, así que en aquel momento el elemento
     todavía no existe en el DOM y el aviso se perdía. */
  if (typeof GT !== 'undefined' && GT.rotularOrigen) GT.rotularOrigen();

  /* Igual que el badge: los controles se montan aquí porque recién ahora la
     barra superior existe en el DOM. */
  montarSelectorOrigen();
  montarControlesRegion(paginaActiva);

  const btnTema = document.getElementById('btnTema');
  if (btnTema && window.GT_cambiarTema) btnTema.addEventListener('click', window.GT_cambiarTema);
  const btnColores = document.getElementById('btnColores');
  if (btnColores) btnColores.addEventListener('click', function () { GTColores.abrir(paginaActiva); });

  /* Cada página puede definir qué exporta (window.GT_exportar): en Fuentes
     el botón descargaba los indicadores de las comunas, que no es lo que se
     está mirando ahí. */
  const btn = document.getElementById('btnExportar');
  if (btn) btn.addEventListener('click', function () { (window.GT_exportar || exportarCSV)(); });

  montarMenuLateral();
  montarBuscadorGlobal();
}

/* Bajo 1024 px la barra lateral se esconde y se abre con el botón de menú:
   fija, se comía dos tercios de la pantalla del teléfono. */
function montarMenuLateral() {
  const boton = document.getElementById('btnMenu');
  const app = document.querySelector('.app');
  if (!boton || !app) return;
  let velo = document.querySelector('.app__velo');
  if (!velo) {
    velo = document.createElement('div');
    velo.className = 'app__velo';
    app.appendChild(velo);
  }
  const fijar = function (abierto) {
    app.classList.toggle('menu-abierto', abierto);
    boton.setAttribute('aria-expanded', String(abierto));
    boton.setAttribute('aria-label', abierto ? 'Cerrar el menú' : 'Abrir el menú');
  };
  boton.addEventListener('click', function () { fijar(!app.classList.contains('menu-abierto')); });
  velo.addEventListener('click', function () { fijar(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fijar(false); });
}

function montarBuscadorGlobal() {
  const input = document.getElementById('buscarComuna');
  const lista = document.getElementById('listaComunas');
  if (!input || typeof GT === 'undefined' || !GT.comunas) return;
  const nombres = GT.comunas.map(function (c) { return c.nombre; }).sort(function (a, b) {
    return a.localeCompare(b, 'es');
  });
  lista.innerHTML = nombres.map(function (n) { return '<option value="' + n + '"></option>'; }).join('');
  const quitar = function (t) {
    return String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  };
  const ir = function () {
    const v = quitar(input.value);
    if (!v) return;
    const c = GT.comunas.filter(function (x) { return quitar(x.nombre) === v; })[0] ||
              GT.comunas.filter(function (x) { return quitar(x.nombre).indexOf(v) === 0; })[0];
    if (!c) { input.setCustomValidity('No hay una comuna con ese nombre'); input.reportValidity(); return; }
    input.setCustomValidity('');
    window.location.href = 'comuna.html?id=' + encodeURIComponent(c.id);
  };
  input.addEventListener('change', ir);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); ir(); }
    else input.setCustomValidity('');
  });
}

/* Controles reutilizables de la barra superior.

   Los dos selectores del prototipo no funcional eran decorativos: nadie
   escuchaba su cambio y las llamadas a la API nunca pasaban region ni anio.
   El de region ademas traia Maule y Coquimbo escritas a mano, y el de anio
   ofrecia 2026, 2020, 2015 y 2010 —ninguno con dato: lo que hay es erosion
   2024, inversion 2021 y termico 2025—.

   Ahora la region se llena desde /regiones y filtra de verdad; el anio deja
   de ser un selector y pasa a ser lo que siempre fue en realidad, una
   etiqueta del periodo del dato que se esta mirando. Un control que no
   filtra es peor que no tenerlo, porque promete. */
const CONTROLES_REGION =
  '<select class="select" id="selRegion" hidden></select>' +
  '<span class="periodo" id="periodoDatos" hidden></span>';

/* Que periodos importan en cada pagina. La clave es la misma que devuelve
   /regiones en `periodos`. */
const PERIODOS_POR_PAGINA = {
  index:        ['erosion', 'inversion'],
  pertinencia:  ['erosion', 'inversion'],
  visor:        ['erosion'],
  comuna:       ['erosion', 'inversion'],
  inundaciones: ['inundacion'],
  urbano:       ['urbano'],
};

const ETIQUETA_PERIODO = {
  erosion: 'erosión', inversion: 'inversión',
  urbano: 'térmico', inundacion: 'eventos',
};

function textoPeriodo(p) {
  return p.desde === p.hasta ? String(p.hasta) : p.desde + '–' + p.hasta;
}

/* Llena el selector de region y la etiqueta de periodo desde la API. Si la
   API no responde, ambos quedan ocultos: sin dato no hay nada que rotular,
   y una region escrita a mano seria volver al problema anterior. */
function montarControlesRegion(pagina) {
  const sel = document.getElementById('selRegion');
  const eti = document.getElementById('periodoDatos');
  if (!sel || typeof GT_api === 'undefined') return;

  fetch(GT_api('/regiones'), { signal: AbortSignal.timeout(4000) })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (regiones) {
      if (!regiones || !regiones.length) throw new Error('sin regiones');

      /* Si la region pedida por URL no existe, el selector mostraba la
         primera y el visor caia a la copia local: el control decia una cosa
         y el dato era otra. Se declara. */
      const conocida = regiones.some(function (r) { return r.id_region === GT_REGION; });
      const desconocida = conocida ? '' :
        '<option value="' + GT_REGION + '" selected>Región ' + GT_REGION +
        ' · sin datos</option>';

      sel.innerHTML = desconocida + regiones.map(function (r) {
        return '<option value="' + r.id_region + '"' +
               (r.id_region === GT_REGION ? ' selected' : '') + '>' +
               /* El nombre va tal cual lo da la base. Recortarlo con una
                  expresion regular convertia "Region del Libertador" en
                  "Region de Libertador": el ancho se resuelve en el CSS, no
                  mutilando el dato. */
               r.nombre + '</option>';
      }).join('');
      sel.hidden = false;
      /* Con una sola región el selector no elige nada y cortaba el nombre
         ("Región del Libertador General Bernar..."): se muestra como texto. */
      if (regiones.length === 1 && conocida) {
        const fijo = document.createElement('span');
        fijo.className = 'region-fija';
        fijo.textContent = regiones[0].nombre;
        fijo.title = sel.title || '';
        sel.hidden = true;
        sel.insertAdjacentElement('afterend', fijo);
      }
      if (!conocida) {
        console.info('[shell] la región %s no existe; elegir otra en el selector',
                     GT_REGION);
      }
      sel.title = regiones.length > 1
        ? 'Región sobre la que se calculan los indicadores'
        : 'Única región cargada. Agregar otra es insertar una fila en '
          + 'territorio.region y correr la ingesta, no tocar código.';

      /* Recargar con ?region=N en vez de repintar a medias: asi hay un solo
         camino de carga y no dos que mantener sincronizados. */
      sel.addEventListener('change', function () {
        const u = new URL(window.location.href);
        u.searchParams.set('region', sel.value);
        window.location.href = u.toString();
      });

      const activa = regiones.filter(function (r) { return r.id_region === GT_REGION; })[0];
      const quiere = PERIODOS_POR_PAGINA[pagina] || [];
      const partes = quiere
        .filter(function (k) { return activa && activa.periodos[k]; })
        .map(function (k) {
          return ETIQUETA_PERIODO[k] + ' ' + textoPeriodo(activa.periodos[k]);
        });
      if (eti && partes.length) {
        eti.textContent = partes.join(' · ');
        eti.title = 'Período de los datos en pantalla, leído de la base';
        eti.hidden = false;
      }
    })
    .catch(function (e) {
      console.info('[shell] sin /regiones (%s); no se rotula región ni período',
                   e.message);
    });
}

/* Estado del badge de origen de los datos: 'vivo', 'aviso', 'copia' o nada
   (datos de ejemplo). El color lo decide la hoja de estilos según la clase;
   antes cada página escribía sus propios hex claros desde el JS, y con el
   tema oscuro quedaban como parches blancos en la barra. La clase base
   .badge--proto no se toca: todas las páginas buscan el badge por ella. */
function estadoBadge(badge, estado) {
  if (!badge) return;
  badge.classList.remove('es-vivo', 'es-aviso', 'es-copia');
  badge.style.background = '';
  badge.style.color = '';
  if (estado) badge.classList.add('es-' + estado);
}

const BOTON_EXPORTAR =
  '<button class="btn" id="btnExportar">' + svgIcono('bajar', 15) +
  'Exportar</button>';

/* Casilla para ver las comunas fuera del dominio de validez — UC-16.
   Se monta junto al selector de origen y solo si ese aparece: sin API no hay
   nada que incluir ni que excluir. */
const CASILLA_DOMINIO =
  '<label class="small" id="lblDominio" hidden ' +
         'style="display:none;align-items:center;gap:6px;cursor:pointer">' +
    '<input type="checkbox" id="chkDominio"> fuera de dominio' +
  '</label>';

function montarCasillaDominio() {
  const lbl = document.getElementById('lblDominio');
  const chk = document.getElementById('chkDominio');
  if (!lbl || !chk || typeof GT === 'undefined' || !GT.cambiarDominio) return;

  chk.checked = GT.incluirFueraDeDominio;
  lbl.hidden = false;
  lbl.style.display = 'inline-flex';
  lbl.title = 'Las comunas precordilleranas, donde la ecuación de erosividad '
            + 'sobreestima. Se muestran señaladas.';
  chk.addEventListener('change', function () {
    GT.cambiarDominio(chk.checked);
  });
}

/* Una tabla de la pantalla a CSV, tal como se ve: lo que usan las páginas
   cuyo contenido es una tabla (Fuentes, Ciudades). De un selector se toma la
   opción elegida; las filas de nota (una celda que abarca todas) se omiten. */
function GT_exportarTabla(tabla, base, notas) {
  if (!tabla) return;
  const texto = function (celda) {
    const sel = celda.querySelector('select');
    const t = sel ? sel.options[sel.selectedIndex].text : celda.innerText;
    return t.replace(/\s+/g, ' ').trim();
  };
  const csv = function (t) { return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const filas = Array.from(tabla.querySelectorAll('tr'))
    .filter(function (tr) { return !tr.querySelector('td[colspan]'); })
    .map(function (tr) {
      return Array.from(tr.children).map(function (c) { return csv(texto(c)); }).join(';');
    });
  const cuerpo = '\ufeff' + (notas || []).map(function (n) { return '# ' + n; }).join('\n') +
                 (notas && notas.length ? '\n' : '') + filas.join('\n') + '\n';
  const url = URL.createObjectURL(new Blob([cuerpo], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = base + '_' + GT_hoy() + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

/* Exportar la región a CSV — UC-04.

   El boton existia desde el prototipo no funcional y no tenia manejador: un
   boton que no hace nada es peor que no tenerlo, porque promete algo.

   CSV y no PDF porque la historia pide "incluirlo en mis informes de
   gestion": un CSV se abre en Excel y se pega en un informe; un PDF hay que
   volver a teclearlo. Se exporta lo que la pantalla esta mostrando, con una
   cabecera que declara de donde salio. */
function exportarCSV() {
  if (typeof GT === 'undefined' || !GT.comunas) return;

  const hoy = GT_hoy();
  const origen = GT.origenDatos === 'api'
    ? (GT.origenErosion || '?') + ' ' + (GT.anioErosion || '')
    : 'datos de ejemplo (sin conexión con la API)';

  /* Coma decimal y punto y coma de separador: es la combinacion que Excel en
     español entiende. Con punto decimal, 300.67 se lee como treinta mil. */
  const num = function (v, dec) {
    if (v === null || v === undefined || isNaN(v)) return '';
    return Number(v).toFixed(dec === undefined ? 2 : dec).replace('.', ',');
  };

  const lineas = [
    '# TerraFoco — indicadores por comuna',
    '# Región de O\'Higgins · exportado el ' + hoy,
    '# Origen de la erosión: ' + origen,
    '#',
    '# Erosión: toneladas por hectárea al año.',
    '# Programa: SIRSD-S ' + (GT.periodoInversion ? GT.periodoInversion.join('-') : '') +
      ', planes ejecutados, por año de la declaración jurada.',
    '#   incentivo_millones: pesos nominales. incentivo_uf: cada año a su UF promedio.',
    '#   agricultores: suma de cada año; quien tuvo planes en varios años cuenta varias veces.',
    '#   ha_erosion_severa: superficie sobre 18 t/ha/año del cálculo propio.',
    '#   uf_por_ha_erosionada: incentivo_uf / ha_erosion_severa, la inversión del índice.',
    '#   brecha_uf: UF que faltan para llegar a la mediana regional de uf_por_ha_erosionada.',
    '# Índice: de 0 a 1. Cerca de 1 es mucha erosión y poca inversión.',
    '#',
    '# Las comunas fuera del dominio de validez van sin índice, salvo que se',
    '# marque la casilla. Si se marca, se normalizan por separado y los dos',
    '# grupos NO son comparables entre sí: la columna "comparable" lo indica y',
    '# las filas vienen con las comparables primero.',
    '#',
    '# Donde la precisión dice "sin informacion" no hay datos de inversión,',
    '# y el índice se calcula como si la comuna no hubiera recibido nada.',
    '# Ese índice mide la falta de dato, no la falta de inversión.',
    '',
    ['comuna', 'provincia', 'erosion_ton_ha', 'planes', 'ha_intervenidas',
     'incentivo_millones', 'incentivo_uf', 'agricultores', 'ha_erosion_severa',
     'uf_por_ha_erosionada', 'brecha_uf', 'indice', 'comparable',
     'precision_dato', 'superficie_km2'].join(';')
  ];

  /* Las comparables primero y por indice descendente: asi la primera fila es
     la de mayor brecha entre las que el modelo sí puede sostener. */
  const filas = GT.comunas.filter(function (c) {
    return !(c.sinDatoEnOrigen && GT.origenDatos === 'api');
  }).slice().sort(function (a, b) {
    if (GT.enIndice(a) !== GT.enIndice(b)) return GT.enIndice(a) ? -1 : 1;
    if (!!a.fueraDeDominio !== !!b.fueraDeDominio) return a.fueraDeDominio ? 1 : -1;
    return (b.indice || 0) - (a.indice || 0);
  });

  filas.forEach(function (c) {
    lineas.push([
      c.nombre, c.prov, num(c.erosion), c.planes || 0,
      num(c.haBonif || 0), num(c.monto || 0, 0), num(c.incentivoUF, 1), c.benef || 0,
      num(c.haErosionSevera, 1), num(c.inversionUFha, 4),
      typeof c.brechaUF === 'number' ? num(c.brechaUF, 0) : '',
      GT.enIndice(c) ? num(c.indice, 3) : '',
      !GT.enIndice(c) ? 'no — ' + GT.motivoSinIndice(c).toLowerCase()
        : c.fueraDeDominio ? 'no — fuera de dominio' : 'si',
      c.precision || '', num(c.sup, 0)
    ].join(';'));
  });

  /* El BOM hace que Excel en español reconozca UTF-8; sin el, los nombres
     con tilde llegan rotos y el archivo parece defectuoso. */
  const blob = new Blob(['﻿' + lineas.join('\r\n')],
                        { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'terrafoco-ohiggins-' + hoy + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* Selector de origen de la erosión — UC-06.

   Nace oculto y solo aparece si la API responde con dos orígenes o más.
   Mostrarlo siempre seria peor: sin API no hay nada que elegir, y un
   desplegable que no hace nada confunde mas de lo que ayuda. */
const SELECTOR_ORIGEN = '<select class="select" id="selOrigen" hidden></select>';

function montarSelectorOrigen() {
  const sel = document.getElementById('selOrigen');
  if (!sel || typeof GT === 'undefined' || !GT.origenesDisponibles) return;

  GT.origenesDisponibles().then(function (origenes) {
    if (origenes.length < 2) return;     // nada que comparar

    sel.innerHTML = origenes.map(function (o) {
      const etiqueta = o.origen === 'CIREN'
        ? 'Línea base CIREN' : 'Cálculo propio';
      return '<option value="' + o.origen + '"' +
             (o.origen === GT.origenElegido ? ' selected' : '') + '>' +
             etiqueta + ' ' + o.anio + '</option>';
    }).join('');
    sel.hidden = false;
    sel.title = 'Origen de la erosión: la línea base oficial o el cálculo ' +
                'del motor';
    sel.addEventListener('change', function () {
      GT.cambiarOrigen(sel.value);
    });
    montarCasillaDominio();
  });
}
