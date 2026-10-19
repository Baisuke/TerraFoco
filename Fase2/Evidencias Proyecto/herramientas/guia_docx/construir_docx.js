// Arma "TerraFoco - Guía de estudio.docx" desde la bóveda de Obsidian.
// Uso: node construir_docx.js <bóveda> <carpeta de diagramas> <salida.docx>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow,
  TableCell, WidthType, BorderStyle, ShadingType, ImageRun, TableOfContents, Footer,
  PageNumber, LevelFormat, Bookmark, InternalHyperlink, ExternalHyperlink, PageBreak,
} = require('docx');

const BOVEDA = process.argv[2];
const DIAGRAMAS = process.argv[3];
const SALIDA = process.argv[4];
const MANIFIESTO = JSON.parse(fs.readFileSync(path.join(DIAGRAMAS, 'manifiesto.json'), 'utf8'));

// ---------------------------------------------------------------- medidas
const PAGINA = { ancho: 12240, alto: 15840, margen: 1134 };       // carta, 2 cm
const ANCHO = PAGINA.ancho - 2 * PAGINA.margen;                     // 9972 dxa
const FUENTE = 'Calibri', MONO = 'Consolas';
const TINTA = '1F2328', GRIS = '57606A', LINEA = 'D0D7DE';

const CALLOUT = {
  abstract:  { etiqueta: 'Resumen',      borde: '3B4252', fondo: 'F0F2F5' },
  summary:   { etiqueta: 'Resumen',      borde: '3B4252', fondo: 'F0F2F5' },
  tip:       { etiqueta: 'Consejo',      borde: '2E8B57', fondo: 'EEF7F1' },
  warning:   { etiqueta: 'Atención',     borde: 'C27C0E', fondo: 'FDF6E7' },
  important: { etiqueta: 'Importante',   borde: 'B23B3B', fondo: 'FBEEEE' },
  info:      { etiqueta: 'Información',  borde: '3D6FB4', fondo: 'EEF3FA' },
  note:      { etiqueta: 'Nota',         borde: '3D6FB4', fondo: 'EEF3FA' },
  example:   { etiqueta: 'Ejemplo',      borde: '6E56CF', fondo: 'F3F0FC' },
  question:  { etiqueta: 'Pregunta',     borde: '137A7F', fondo: 'ECF6F6' },
  quote:     { etiqueta: 'Cita',         borde: '6B7280', fondo: 'F3F4F6' },
  success:   { etiqueta: 'Listo',        borde: '2E8B57', fondo: 'EEF7F1' },
};

// ---------------------------------------------------------------- orden
const CURSO = '10 Curso';
const REFERENCIA = [
  ['00', 'Mapa de la bóveda', [['', '00 Inicio']]],
  ['01 Panorama', 'Panorama', ['Qué es TerraFoco', 'Arquitectura', 'Flujo de datos', 'Mapa del repositorio', 'Cómo correrlo']],
  ['02 Conceptos', 'Conceptos', ['RUSLE y erosión', 'Dominio de validez', 'Índice de pertinencia', 'SIRSD-S e INDAP',
    'Validación y Spearman', 'Susceptibilidad a inundación', 'Exposición', 'Teselas y PMTiles',
    'Copia local y modo sin API', 'Programador de tareas', 'Bitácora y catálogo de fuentes',
    'Áreas verdes y calor urbano', 'Privacidad y datos personales']],
  ['03 Base de datos', 'Base de datos', ['Esquema de la base', 'Migraciones', 'Semillas']],
  ['04 Motor', 'Motor', ['Motor - raíz', 'Motor - ingesta', 'Motor - indicadores', 'Motor - orquestación', 'Motor - pruebas']],
  ['05 API', 'API', ['API - núcleo', 'API - rutas', 'API - pruebas']],
  ['06 Visor', 'Visor', ['Visor - páginas', 'Visor - scripts base', 'Visor - mapas y módulos', 'Visor - estilos, datos y librerías']],
  ['07 Herramientas y despliegue', 'Herramientas y despliegue', ['Herramientas', 'Despliegue y Codespaces', 'Archivos de la raíz']],
  ['08 Documentación', 'Documentación del proyecto', ['Documentos del proyecto']],
  ['09 Estudio', 'Estudio', ['Ruta de estudio', 'Recorridos por el código', 'Preguntas de defensa', 'Glosario']],
];

function leerNota(rel) {
  return fs.readFileSync(path.join(BOVEDA, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\t/g, '    ');
}

// Todas las notas, en orden, con su marcador para los enlaces internos.
const NOTAS = [];
for (const f of fs.readdirSync(path.join(BOVEDA, CURSO)).filter(f => f.endsWith('.md')).sort()) {
  NOTAS.push({ parte: 'curso', nombre: f.slice(0, -3), rel: path.join(CURSO, f) });
}
for (const [carpeta, , lista] of REFERENCIA) {
  for (const item of lista) {
    const nombre = Array.isArray(item) ? item[1] : item;
    const rel = Array.isArray(item) ? nombre + '.md' : path.join(carpeta, nombre + '.md');
    if (!fs.existsSync(path.join(BOVEDA, rel))) { console.warn('falta', rel); continue; }
    NOTAS.push({ parte: carpeta, nombre, rel });
  }
}
const MARCADOR = {};
NOTAS.forEach((n, i) => { n.marcador = 'nota_' + i; MARCADOR[n.nombre] = n.marcador; });

// ---------------------------------------------------------------- bloques
const RE_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const RE_FENCE = /^(\s*)```\s*([\w-]*)\s*$/;

function esInicioDeBloque(l) {
  return RE_ITEM.test(l) || RE_FENCE.test(l) || /^\s*\|/.test(l) || /^\s*>/.test(l) ||
         /^#{1,6}\s/.test(l) || /^\s*\$\$/.test(l) || /^\s*(-{3,}|\*{3,})\s*$/.test(l);
}

function parsear(lineas) {
  const out = [];
  let i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    if (!l.trim()) { i++; continue; }

    let m = l.match(RE_FENCE);
    if (m) {
      const sangria = m[1].length, lenguaje = m[2];
      const cuerpo = [];
      i++;
      while (i < lineas.length && !/^\s*```\s*$/.test(lineas[i])) {
        cuerpo.push(lineas[i].slice(Math.min(sangria, lineas[i].search(/\S|$/))));
        i++;
      }
      i++;
      out.push(lenguaje === 'mermaid' ? { t: 'mermaid', codigo: cuerpo.join('\n') }
                                      : { t: 'codigo', lineas: cuerpo });
      continue;
    }
    if (/^\s*\$\$/.test(l)) {
      const t = l.trim();
      if (t.length > 4 && t.endsWith('$$')) { out.push({ t: 'math', texto: t.slice(2, -2) }); i++; continue; }
      const cuerpo = [t.slice(2)];
      i++;
      while (i < lineas.length && !lineas[i].includes('$$')) cuerpo.push(lineas[i++].trim());
      if (i < lineas.length) cuerpo.push(lineas[i++].replace('$$', '').trim());
      out.push({ t: 'math', texto: cuerpo.join(' ') });
      continue;
    }
    m = l.match(/^(#{1,6})\s+(.*)$/);
    if (m) { out.push({ t: 'h', nivel: m[1].length, texto: m[2].trim() }); i++; continue; }
    if (/^#[^\s#]+(\s+#[^\s#]+)*\s*$/.test(l.trim())) { i++; continue; }          // etiquetas
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push({ t: 'hr' }); i++; continue; }

    if (/^\s*>/.test(l)) {
      const cuerpo = [];
      while (i < lineas.length && /^\s*>/.test(lineas[i])) {
        cuerpo.push(lineas[i].replace(/^\s*> ?/, ''));
        i++;
      }
      const c = cuerpo[0].match(/^\[!(\w+)\]([-+]?)\s*(.*)$/);
      if (c) {
        out.push({ t: 'callout', tipo: c[1].toLowerCase(), plegable: c[2] === '-',
                   titulo: c[3], bloques: parsear(cuerpo.slice(1)) });
      } else {
        out.push({ t: 'cita', bloques: parsear(cuerpo) });
      }
      continue;
    }
    if (/^\s*\|/.test(l)) {
      const filas = [];
      while (i < lineas.length && /^\s*\|/.test(lineas[i])) {
        const fila = lineas[i].trim();
        if (!/^\|?\s*:?-{2,}/.test(fila)) filas.push(celdas(fila));
        i++;
      }
      out.push({ t: 'tabla', filas });
      continue;
    }
    m = l.match(RE_ITEM);
    if (m) {
      const sangria = m[1].length;
      let texto = m[3];
      i++;
      while (i < lineas.length && lineas[i].trim() && !esInicioDeBloque(lineas[i])) {
        texto += ' ' + lineas[i].trim();
        i++;
      }
      const ordenado = /\d/.test(m[2]);
      let check = null;
      const k = texto.match(/^\[([ xX])\]\s+(.*)$/);
      if (k) { check = k[1] !== ' '; texto = k[2]; }
      out.push({ t: 'li', ordenado, numero: m[2], nivel: Math.min(3, Math.floor(sangria / 2.5)),
                 texto, check });
      continue;
    }
    if (l.includes('::') && !/^\s*[`|]/.test(l)) {
      const pares = [];
      while (i < lineas.length && lineas[i].includes('::') && lineas[i].trim()) {
        const p = lineas[i].trim().split('::');
        pares.push([p[0].trim(), p.slice(1).join('::').trim()]);
        i++;
      }
      out.push({ t: 'tarjetas', pares });
      continue;
    }
    // párrafo
    const sangria = l.search(/\S/) >= 2 ? 1 : 0;
    let texto = l.trim();
    i++;
    while (i < lineas.length && lineas[i].trim() && !esInicioDeBloque(lineas[i])) {
      texto += ' ' + lineas[i].trim();
      i++;
    }
    out.push({ t: 'p', texto, sangria });
  }
  return out;
}

function celdas(fila) {
  let f = fila.trim();
  if (f.startsWith('|')) f = f.slice(1);
  if (f.endsWith('|') && !f.endsWith('\\|')) f = f.slice(0, -1);
  const out = [];
  let actual = '', enCodigo = false;
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (ch === '`') enCodigo = !enCodigo;
    if (ch === '\\' && f[i + 1] === '|') { actual += '|'; i++; continue; }
    if (ch === '|' && !enCodigo) { out.push(actual.trim()); actual = ''; continue; }
    actual += ch;
  }
  out.push(actual.trim());
  return out;
}

// ---------------------------------------------------------------- en línea
const SIMBOLOS = {
  '\\times': '×', '\\approx': '≈', '\\cdot': '·', '\\sum': 'Σ', '\\max': 'max', '\\min': 'min',
  '\\ln': 'ln', '\\Rightarrow': '⇒', '\\gg': '≫', '\\ll': '≪', '\\le': '≤', '\\ge': '≥',
  '\\leq': '≤', '\\geq': '≥', '\\beta': 'β', '\\theta': 'θ', '\\lambda': 'λ', '\\rho': 'ρ',
  '\\Delta': 'Δ', '\\alpha': 'α', '\\pm': '±', '\\%': '%', '\\&': '&', '\\_': '_', '\\#': '#',
  '\\quad': '  ', '\\qquad': '   ', '\\;': ' ', '\\,': ' ', '\\!': '', '\\ ': ' ',
  '\\text': '', '\\mathrm': '', '\\left': '', '\\right': '',
};

function grupo(s, i) {         // contenido de {…} que empieza en s[i] === '{'
  let n = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') n++;
    else if (s[j] === '}') { n--; if (n === 0) return [s.slice(i + 1, j), j + 1]; }
  }
  return [s.slice(i + 1), s.length];
}

// LaTeX sencillo -> segmentos {texto, sup, sub}
function latex(s, nivel) {
  nivel = nivel || '';
  const segs = [];
  const emitir = (t, n) => { if (t) segs.push({ texto: t, nivel: n }); };
  let i = 0, buf = '';
  const vaciar = () => { emitir(buf, nivel); buf = ''; };
  while (i < s.length) {
    if (s.startsWith('{,}', i)) { buf += ','; i += 3; continue; }
    if (s.startsWith('\\frac', i)) {
      vaciar();
      let j = i + 5;
      while (s[j] === ' ') j++;
      const [a, j2] = s[j] === '{' ? grupo(s, j) : [s[j], j + 1];
      let k = j2; while (s[k] === ' ') k++;
      const [b, k2] = s[k] === '{' ? grupo(s, k) : [s[k], k + 1];
      emitir('(', nivel); segs.push(...latex(a, nivel)); emitir(') / (', nivel);
      segs.push(...latex(b, nivel)); emitir(')', nivel);
      i = k2; continue;
    }
    if (s[i] === '^' || s[i] === '_') {
      vaciar();
      const n = s[i] === '^' ? 'sup' : 'sub';
      const [g, j] = s[i + 1] === '{' ? grupo(s, i + 1) : [s[i + 1] || '', i + 2];
      segs.push(...latex(g, n));
      i = j; continue;
    }
    if (s[i] === '\\') {
      const m = s.slice(i).match(/^\\([A-Za-z]+|.)/);
      const cmd = '\\' + m[1];
      buf += (cmd in SIMBOLOS) ? SIMBOLOS[cmd] : m[1];
      i += m[0].length; continue;
    }
    if (s[i] === '{' || s[i] === '}') { i++; continue; }
    buf += s[i]; i++;
  }
  vaciar();
  return segs;
}

function runsMath(texto, base) {
  return latex(texto.trim()).map(sg => new TextRun(Object.assign({}, base, {
    text: sg.texto, italics: true, font: 'Cambria Math',
    superScript: sg.nivel === 'sup', subScript: sg.nivel === 'sub' })));
}

const RE_INLINE = /(`[^`]+`|\*\*|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)\s]+\)|\$[^$\n]+\$|<br\s*\/?>|(?<![\w*\\])\*(?=\S)|(?<=\S)\*(?![\w*]))/;

function inline(texto, base) {
  base = Object.assign({ font: FUENTE }, base || {});
  const partes = texto.split(RE_INLINE).filter(p => p !== undefined && p !== '');
  const out = [];
  let negrita = !!base.bold, cursiva = !!base.italics;
  for (const p of partes) {
    const estilo = Object.assign({}, base);
    if (negrita) estilo.bold = true; else delete estilo.bold;
    if (cursiva) estilo.italics = true; else delete estilo.italics;
    if (p === '**') { negrita = !negrita; continue; }
    if (p === '*') { cursiva = !cursiva; continue; }
    if (/^<br/.test(p)) { out.push(new TextRun({ text: '', break: 1 })); continue; }
    if (p.length > 1 && p.startsWith('`') && p.endsWith('`')) {
      out.push(new TextRun(Object.assign({}, estilo, { text: p.slice(1, -1), font: MONO,
        size: base.size ? base.size - 1 : 19,
        shading: { type: ShadingType.CLEAR, fill: 'EEF0F2', color: 'auto' } })));
      continue;
    }
    let m = p.match(/^\[\[([^\]|#]+)(#[^\]|]*)?(\|([^\]]*))?\]\]$/);
    if (m) {
      const nombre = m[1].trim();
      const visible = m[4] ? m[4] : nombre + (m[2] ? ' › ' + m[2].slice(1) : '');
      const run = new TextRun(Object.assign({}, estilo, { text: visible, color: '0B5CAD', underline: {} }));
      out.push(MARCADOR[nombre] ? new InternalHyperlink({ anchor: MARCADOR[nombre], children: [run] }) : run);
      continue;
    }
    m = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (m) {
      const run = new TextRun(Object.assign({}, estilo, { text: m[1], color: '0B5CAD', underline: {} }));
      out.push(/^https?:/.test(m[2]) ? new ExternalHyperlink({ link: m[2], children: [run] }) : run);
      continue;
    }
    if (p.length > 2 && p.startsWith('$') && p.endsWith('$')) { out.push(...runsMath(p.slice(1, -1), estilo)); continue; }
    out.push(new TextRun(Object.assign({}, estilo, { text: p })));
  }
  return out;
}

// ---------------------------------------------------------------- render
const SIN_BORDE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

function cajaSimple(hijos, ancho, opciones) {
  const o = Object.assign({ fondo: 'F6F8FA', borde: LINEA, grosor: 4, soloIzquierda: false }, opciones);
  const lado = { style: BorderStyle.SINGLE, size: o.grosor, color: o.borde };
  return new Table({
    width: { size: ancho, type: WidthType.DXA }, columnWidths: [ancho],
    borders: { top: SIN_BORDE, bottom: SIN_BORDE, left: SIN_BORDE, right: SIN_BORDE,
               insideHorizontal: SIN_BORDE, insideVertical: SIN_BORDE },
    rows: [new TableRow({ children: [new TableCell({
      width: { size: ancho, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: o.fondo, color: 'auto' },
      margins: { top: 100, bottom: 100, left: 180, right: 160 },
      borders: o.soloIzquierda
        ? { top: SIN_BORDE, bottom: SIN_BORDE, right: SIN_BORDE, left: lado }
        : { top: lado, bottom: lado, right: lado, left: lado },
      children: hijos.length ? hijos : [new Paragraph('')],
    })] })],
  });
}

function separador() { return new Paragraph({ spacing: { before: 0, after: 120 }, children: [] }); }

function anchosColumnas(filas, ancho) {
  const n = Math.max(...filas.map(f => f.length));
  const largo = new Array(n).fill(4);
  filas.forEach(f => f.forEach((c, k) => {
    const l = c.replace(/[`*]|\[\[|\]\]/g, '').length;
    largo[k] = Math.max(largo[k], Math.min(l, 60));
  }));
  const total = largo.reduce((a, b) => a + Math.sqrt(b), 0);
  let anchos = largo.map(l => Math.max(900, Math.round(ancho * Math.sqrt(l) / total)));
  const suma = anchos.reduce((a, b) => a + b, 0);
  anchos = anchos.map(a => Math.floor(a * ancho / suma));
  anchos[n - 1] += ancho - anchos.reduce((a, b) => a + b, 0);
  return anchos;
}

function tabla(filas, ancho, encabezados) {
  const n = Math.max(...filas.map(f => f.length));
  const anchos = anchosColumnas(filas, ancho);
  const borde = { style: BorderStyle.SINGLE, size: 4, color: LINEA };
  return new Table({
    width: { size: ancho, type: WidthType.DXA }, columnWidths: anchos,
    borders: { top: borde, bottom: borde, left: borde, right: borde,
               insideHorizontal: borde, insideVertical: borde },
    rows: filas.map((f, r) => new TableRow({
      tableHeader: r === 0 && encabezados !== false,
      children: Array.from({ length: n }, (_, k) => new TableCell({
        width: { size: anchos[k], type: WidthType.DXA },
        shading: r === 0 && encabezados !== false
          ? { type: ShadingType.CLEAR, fill: 'E9ECEF', color: 'auto' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ spacing: { before: 0, after: 0 },
          children: inline(f[k] || '', { size: 18, bold: r === 0 && encabezados !== false }) })],
      })),
    })),
  });
}

function imagenDiagrama(codigo, ancho) {
  const h = crypto.createHash('sha1').update(codigo.trim()).digest('hex').slice(0, 12);
  const d = MANIFIESTO[h];
  if (!d) return [new Paragraph({ children: [new TextRun({ text: '[diagrama no disponible]', italics: true, color: GRIS })] })];
  const maxAncho = Math.floor(ancho / 1440 * 96) - 4, maxAlto = 820;
  let w = d.ancho, a = d.alto;
  const k = Math.min(1, maxAncho / w, maxAlto / a);
  w = Math.round(w * k); a = Math.round(a * k);
  return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 160 },
    children: [new ImageRun({ type: 'png', data: fs.readFileSync(path.join(DIAGRAMAS, d.archivo)),
                              transformation: { width: w, height: a } })] })];
}

const NIVELES = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
                 HeadingLevel.HEADING_4, HeadingLevel.HEADING_5];

function render(bloques, ctx, ancho, padre) {
  const out = [];
  for (const b of bloques) {
    switch (b.t) {
      case 'h': {
        const nivel = Math.min(5, Math.max(3, b.nivel + 1));     // ## -> H3, ### -> H4
        out.push(new Paragraph({ heading: NIVELES[nivel - 1], keepNext: true, children: inline(b.texto) }));
        break;
      }
      case 'p':
        out.push(new Paragraph({ spacing: { after: 120 }, indent: b.sangria ? { left: 420 } : undefined,
                                 children: inline(b.texto) }));
        break;
      case 'li': {
        const prefijo = b.check === null ? [] : [new TextRun({ text: b.check ? '☑ ' : '☐ ', font: FUENTE })];
        if (b.ordenado) {
          out.push(new Paragraph({ spacing: { after: 60 },
            indent: { left: 420 + 360 * b.nivel, hanging: 360 },
            children: [new TextRun({ text: b.numero.replace(')', '.') + '\t', font: FUENTE })]
              .concat(prefijo, inline(b.texto)),
            tabStops: [{ type: 'left', position: 420 + 360 * b.nivel }] }));
        } else {
          out.push(new Paragraph({ spacing: { after: 60 }, numbering: { reference: 'vinetas', level: b.nivel },
                                   children: prefijo.concat(inline(b.texto)) }));
        }
        break;
      }
      case 'tabla':
        out.push(tabla(b.filas, ancho), separador());
        break;
      case 'tarjetas':
        out.push(tabla([['Pregunta', 'Respuesta']].concat(b.pares), ancho), separador());
        break;
      case 'codigo':
        out.push(cajaSimple(b.lineas.map(l => new Paragraph({ spacing: { before: 0, after: 0 },
          children: [new TextRun({ text: l.length ? l : ' ', font: MONO, size: 16, color: '24292F' })] })),
          ancho, { fondo: 'F6F8FA', borde: 'D0D7DE' }), separador());
        break;
      case 'mermaid':
        out.push(...imagenDiagrama(b.codigo, ancho));
        break;
      case 'math':
        out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 160 },
                                 children: runsMath(b.texto, { size: 24 }) }));
        break;
      case 'hr':
        out.push(new Paragraph({ spacing: { before: 120, after: 200 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINEA, space: 1 } }, children: [] }));
        break;
      case 'cita':
        out.push(cajaSimple(render(b.bloques, ctx, ancho - 400, padre), ancho,
                            { fondo: 'F6F8FA', borde: '8C959F', grosor: 18, soloIzquierda: true }), separador());
        break;
      case 'callout': {
        const c = CALLOUT[b.tipo] || CALLOUT.note;
        const hijos = [];
        if (b.tipo === 'question' && b.plegable) {
          const n = ctx.respuestas.length + 1;
          let titulo = (b.titulo || '').replace(/^\d+\.\s+/, '');
          const anidada = /^respuesta$/i.test(titulo.trim()) || !titulo.trim();
          ctx.respuestas.push({ n, titulo: anidada ? (padre || 'Ejercicio') : titulo, bloques: b.bloques });
          if (!anidada) {
            hijos.push(new Paragraph({ spacing: { after: 40 }, children:
              [new TextRun({ text: 'Pregunta ' + n + '  ', bold: true, color: c.borde, font: FUENTE })]
                .concat(inline(titulo, { bold: true })) }));
          }
          hijos.push(new Paragraph({ spacing: { after: 0 }, children: [new TextRun({
            text: anidada ? 'Respuesta n.º ' + n + ' al final de la lección.'
                          : 'Respóndela en voz alta. Respuesta n.º ' + n + ' al final de la lección.',
            italics: true, size: 18, color: anidada ? c.borde : GRIS, font: FUENTE })] }));
        } else {
          hijos.push(new Paragraph({ spacing: { after: 60 }, keepNext: true, children:
            [new TextRun({ text: c.etiqueta + (b.titulo ? ' · ' : ''), bold: true, color: c.borde, font: FUENTE })]
              .concat(b.titulo ? inline(b.titulo, { bold: true }) : []) }));
          hijos.push(...render(b.bloques, ctx, ancho - 400, b.titulo || padre));
        }
        out.push(cajaSimple(hijos, ancho, { fondo: c.fondo, borde: c.borde, grosor: 24, soloIzquierda: true }),
                 separador());
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- notas
function renderNota(nota) {
  const lineas = leerNota(nota.rel).split('\n');
  let titulo = nota.nombre, desde = 0;
  const primera = lineas.findIndex(l => l.trim());
  if (primera >= 0 && /^#\s+/.test(lineas[primera])) {
    titulo = lineas[primera].replace(/^#\s+/, '').trim();
    desde = primera + 1;
  }
  const ctx = { respuestas: [] };
  const hijos = [new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: true,
    children: [new Bookmark({ id: nota.marcador, children: inline(titulo) })] })];
  if (nota.parte !== 'curso') {
    hijos.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({
      text: 'Nota de la bóveda: ' + nota.rel.replace(/\\/g, '/'), size: 17, color: GRIS, font: FUENTE })] }));
  }
  hijos.push(...render(parsear(lineas.slice(desde)), ctx, ANCHO));
  if (ctx.respuestas.length) {
    hijos.push(new Paragraph({ heading: HeadingLevel.HEADING_3, pageBreakBefore: false,
      spacing: { before: 360 }, children: [new TextRun('Respuestas')] }));
    for (const r of ctx.respuestas) {
      hijos.push(new Paragraph({ spacing: { before: 120, after: 60 }, keepNext: true, children:
        [new TextRun({ text: r.n + '. ', bold: true, font: FUENTE })].concat(inline(r.titulo || '', { bold: true })) }));
      const sub = { respuestas: [] };
      hijos.push(...render(r.bloques, sub, ANCHO));
    }
  }
  return hijos;
}

function encabezadoParte(titulo, bajada) {
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(titulo)] }),
    new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: bajada, color: GRIS, size: 22, font: FUENTE })] }),
  ];
}

// ---------------------------------------------------------------- documento
const portada = [
  new Paragraph({ spacing: { before: 2600, after: 120 }, children: [new TextRun({ text: 'TerraFoco', bold: true, size: 72, font: FUENTE, color: TINTA })] }),
  new Paragraph({ spacing: { after: 480 }, children: [new TextRun({ text: 'Guía de estudio y documentación del sistema', size: 36, font: FUENTE, color: GRIS })] }),
  new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: TINTA, space: 1 } }, spacing: { after: 360 }, children: [] }),
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Curso de punta a punta para entender y presentar el código, y referencia de cada archivo del repositorio.', size: 24, font: FUENTE })] }),
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Sistema de Análisis Geoespacial Multipropósito para la Evaluación Territorial y de Política Pública', size: 21, font: FUENTE, color: GRIS })] }),
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Proyecto APT · Capstone 2026 · Ingeniería en Informática · Duoc UC', size: 21, font: FUENTE, color: GRIS })] }),
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Equipo: Bastián Cárcamo · Carla Morales · Antonio Lankin', size: 21, font: FUENTE, color: GRIS })] }),
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Versión del 12 de octubre de 2026', size: 21, font: FUENTE, color: GRIS })] }),
];

const comoUsar = [
  new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun('Cómo usar este documento')] }),
  ...render(parsear([
    'Este documento reúne **toda la bóveda de Obsidian** del proyecto (`boveda/` en el repositorio) para estudiarla sin depender de Obsidian. Tiene dos partes:',
    '',
    '- **Curso de punta a punta** (22 lecciones, L00 a L21): un camino de estudio desde cero. Explica los conceptos previos, recorre el código real con fragmentos comentados, sigue un dato desde el satélite hasta la pantalla, y termina con el guion de la presentación, las preguntas difíciles, una autoevaluación, tarjetas de repaso y una chuleta.',
    '- **Referencia** (el resto de la bóveda): qué hace cada archivo del repositorio, dónde está y para qué se usa, ordenado por capa (panorama, conceptos, base de datos, motor, API, visor, herramientas, documentación y estudio).',
    '',
    '> [!tip] Cómo estudiar con él',
    '> Sigue el curso en orden (el plan día por día está en la lección L00). Cada pregunta de autoevaluación lleva un número y **su respuesta está al final de la misma lección**, en la sección "Respuestas": responde en voz alta antes de mirarla. Los textos en azul son enlaces a otras notas del documento.',
    '',
    'Los fragmentos de código son reales y vienen del repositorio; a veces están recortados con `...`. Las cifras salen de los datos cargados al 12 de octubre de 2026 (CIREN 2024, cálculo propio 2025, serie SIRSD-S 2012–2025): si se recalcula algo, pueden cambiar, así que confírmalas en el visor antes de presentar.',
  ]), { respuestas: [] }, ANCHO),
];

const indice = [
  new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun('Índice')] }),
  new TableOfContents('Índice', { hyperlink: true, headingStyleRange: '1-2' }),
];

const cuerpo = [...comoUsar, ...indice];
cuerpo.push(...encabezadoParte('Parte I · Curso de punta a punta',
  'Veintidós lecciones, desde los conceptos previos hasta el guion de la presentación.'));
NOTAS.filter(n => n.parte === 'curso').forEach(n => { console.log('·', n.nombre); cuerpo.push(...renderNota(n)); });

let numeroParte = 2;
const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
for (const [carpeta, titulo] of REFERENCIA) {
  const notas = NOTAS.filter(n => n.parte === carpeta);
  if (!notas.length) continue;
  cuerpo.push(...encabezadoParte('Parte ' + ROMANOS[numeroParte++] + ' · Referencia: ' + titulo,
    carpeta === '00' ? 'La portada de la bóveda: qué hay en cada carpeta y las reglas del proyecto.'
                     : 'Notas de la carpeta ' + carpeta + ' de la bóveda.'));
  notas.forEach(n => { console.log('·', n.nombre); cuerpo.push(...renderNota(n)); });
}

const estiloTitulo = (id, nombre, tam, nivel, extra) => Object.assign({
  id, name: nombre, basedOn: 'Normal', next: 'Normal', quickFormat: true,
  run: { font: FUENTE, size: tam, bold: true, color: TINTA },
  paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: nivel, keepNext: true },
}, extra || {});

const doc = new Document({
  creator: 'Equipo TerraFoco', title: 'TerraFoco · Guía de estudio y documentación',
  description: 'Curso de punta a punta y referencia del repositorio TerraFoco',
  styles: {
    default: { document: { run: { font: FUENTE, size: 21, color: TINTA }, paragraph: { spacing: { line: 276 } } } },
    paragraphStyles: [
      estiloTitulo('Heading1', 'Heading 1', 40, 0, { paragraph: { spacing: { before: 0, after: 200 }, outlineLevel: 0,
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: TINTA, space: 4 } } } }),
      estiloTitulo('Heading2', 'Heading 2', 32, 1, { paragraph: { spacing: { before: 0, after: 200 }, outlineLevel: 1 } }),
      estiloTitulo('Heading3', 'Heading 3', 26, 2),
      estiloTitulo('Heading4', 'Heading 4', 23, 3),
      estiloTitulo('Heading5', 'Heading 5', 21, 4),
    ],
  },
  numbering: { config: [{ reference: 'vinetas', levels: [0, 1, 2, 3].map(n => ({
    level: n, format: LevelFormat.BULLET, text: ['•', '◦', '▪', '–'][n], alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 420 + 360 * n, hanging: 280 } } } })) }] },
  sections: [
    { properties: { page: { size: { width: PAGINA.ancho, height: PAGINA.alto },
        margin: { top: PAGINA.margen, bottom: PAGINA.margen, left: PAGINA.margen, right: PAGINA.margen } } },
      children: portada },
    { properties: { page: { size: { width: PAGINA.ancho, height: PAGINA.alto },
        margin: { top: PAGINA.margen, bottom: PAGINA.margen, left: PAGINA.margen, right: PAGINA.margen } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
        new TextRun({ children: ['TerraFoco · Guía de estudio · ', PageNumber.CURRENT], size: 16, color: GRIS, font: FUENTE })] })] }) },
      children: cuerpo },
  ],
});

Packer.toBuffer(doc).then(b => {
  fs.writeFileSync(SALIDA, b);
  console.log('escrito', SALIDA, Math.round(b.length / 1024), 'KB', NOTAS.length, 'notas');
});
