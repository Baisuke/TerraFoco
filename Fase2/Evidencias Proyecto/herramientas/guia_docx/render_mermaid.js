// Busca los bloques ```mermaid de la bóveda y los convierte en PNG con Edge.
// Uso: node render_mermaid.js <carpeta de la bóveda> <carpeta de salida>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer-core');

const BOVEDA = process.argv[2];
const SALIDA = process.argv[3];
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

function notas(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(notas(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function hash(t) { return crypto.createHash('sha1').update(t).digest('hex').slice(0, 12); }

(async () => {
  fs.mkdirSync(SALIDA, { recursive: true });
  const bloques = new Map();
  for (const f of notas(BOVEDA)) {
    const t = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const re = /```mermaid\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(t))) bloques.set(hash(m[1].trim()), m[1].trim());
  }
  console.log('diagramas:', bloques.size);

  const navegador = await puppeteer.launch({ executablePath: EDGE, headless: true,
                                             args: ['--no-sandbox'] });
  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
  await pagina.setContent('<html><body style="margin:0;background:#fff"><div id="c" style="display:inline-block;padding:16px;background:#fff"></div></body></html>');
  await pagina.addScriptTag({ path: path.join(__dirname, 'node_modules/mermaid/dist/mermaid.min.js') });
  await pagina.evaluate(() => {
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose',
                         fontFamily: 'Segoe UI, Arial, sans-serif',
                         flowchart: { htmlLabels: true, curve: 'basis' } });
  });

  const manifiesto = {};
  let i = 0;
  for (const [h, codigo] of bloques) {
    i++;
    try {
      const svg = await pagina.evaluate(async (id, c) => {
        const r = await mermaid.render(id, c);
        document.getElementById('c').innerHTML = r.svg;
        const s = document.querySelector('#c svg');
        // ancho natural del diagrama, sin el max-width ni el 100 % que lo encogen
        const vb = (s.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
        s.style.maxWidth = 'none';
        if (vb.length === 4) {
          s.setAttribute('width', vb[2]);
          s.setAttribute('height', vb[3]);
          s.style.width = vb[2] + 'px';
          s.style.height = vb[3] + 'px';
        }
        return true;
      }, 'd' + h, codigo);
      const el = await pagina.$('#c');
      const caja = await el.boundingBox();
      const archivo = path.join(SALIDA, h + '.png');
      await el.screenshot({ path: archivo });
      manifiesto[h] = { archivo: h + '.png', ancho: Math.round(caja.width), alto: Math.round(caja.height) };
      console.log(i, h, Math.round(caja.width) + 'x' + Math.round(caja.height));
    } catch (e) {
      console.log(i, h, 'ERROR', e.message.slice(0, 200));
    }
  }
  fs.writeFileSync(path.join(SALIDA, 'manifiesto.json'), JSON.stringify(manifiesto, null, 1));
  await navegador.close();
})();
