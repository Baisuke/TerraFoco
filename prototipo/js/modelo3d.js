/* ==========================================================================
   TerraFoco — Modelo 3D de una comuna

   La comuna elegida como un bloque sólido, recortado por su límite, que se
   puede girar en todas direcciones —también por debajo—, como una maqueta.
   En el mapa 3D el relieve sigue más allá del límite y la cámara no pasa del
   horizonte; aquí la comuna queda sola y se ve entera.

   La forma sale del modelo de elevación (teselas `relieve`, NASADEM, ~63 m
   en z10) y el color, de la pendiente (teselas `pendiente`, ~31 m en z11):
   lo mismo que pinta el visor, con las mismas clases. Las paredes y la base
   cierran el bloque para que se lea como un objeto y no como una sábana.

   Se dibuja con three.js (prototipo/vendor), que se carga recién al abrir el
   primer modelo: quien no lo usa no lo descarga.

   Controles: botón izquierdo o rueda (apretada) para girar, derecho para
   desplazar, rueda para acercar. En pantalla táctil, un dedo gira y dos
   acercan.
   ========================================================================== */

const GTModelo3D = (function () {
  'use strict';

  const RUTA_RELIEVE = 'datos/teselas/relieve.pmtiles';
  const RUTA_PENDIENTE = 'datos/teselas/pendiente.pmtiles';
  const T = 512;                       // px por tesela
  const Z_RELIEVE = 10, Z_PENDIENTE = 11;
  const MAX_VERTICES = 360000;         // sobre esto se promedia en bloques
  const MAX_TEXTURA = 2048;
  const CORTES_PENDIENTE = [5, 15, 30, 50];
  const NOMBRES_PENDIENTE = ['Plana', 'Suave', 'Moderada', 'Fuerte', 'Muy fuerte'];
  const RANGOS_PENDIENTE = ['< 5 %', '5 – 15 %', '15 – 30 %', '30 – 50 %', '50 % +'];
  /* Hipsométrica, de valle a cumbre: verde, ocre, café y nieve. */
  const HIPSOMETRICA = [[0, [47, 93, 58]], [0.25, [107, 143, 71]], [0.5, [185, 166, 107]],
                        [0.78, [140, 106, 74]], [1, [240, 240, 236]]];

  let libs = null;
  let abierto = null;                  // el visor activo, para cerrarlo

  function cargarThree() {
    if (!libs) {
      const base = new URL('vendor/', document.baseURI).href;
      libs = Promise.all([import(base + 'three.module.min.js'), import(base + 'OrbitControls.js')])
        .then(function (m) { return { THREE: m[0], OrbitControls: m[1].OrbitControls }; });
    }
    return libs;
  }

  /* ---------------------------------------------------------------------
     Teselas
     --------------------------------------------------------------------- */

  function mercY(lat) {
    const r = lat * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + r / 2));
  }
  function pxDe(lng, z) { return (lng + 180) / 360 * Math.pow(2, z) * T; }
  function pyDe(lat, z) { return (1 - mercY(lat) / Math.PI) / 2 * Math.pow(2, z) * T; }

  /* Píxeles RGBA de una tesela, sin conversión de color: el color es el dato. */
  function decodificar(archivo, z, x, y) {
    return archivo.getZxy(z, x, y).then(function (r) {
      if (!r || !r.data) return null;
      return createImageBitmap(new Blob([r.data]),
                               { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    }).then(function (bmp) {
      if (!bmp) return null;
      const lienzo = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(T, T) : Object.assign(document.createElement('canvas'), { width: T, height: T });
      const ctx = lienzo.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, T, T).data;
    }).catch(function () { return null; });
  }

  /* Valores (codificación terrain-RGB del motor) sobre la ventana de píxeles
     [x0, x0 + W) × [y0, y0 + H) del zoom z. NaN donde no hay dato. */
  function ventana(archivo, z, x0, y0, W, H, escala) {
    const v = new Float32Array(W * H).fill(NaN);
    const pedidos = [];
    for (let ty = Math.floor(y0 / T); ty <= Math.floor((y0 + H - 1) / T); ty++) {
      for (let tx = Math.floor(x0 / T); tx <= Math.floor((x0 + W - 1) / T); tx++) {
        pedidos.push(decodificar(archivo, z, tx, ty).then(function (d) {
          if (!d) return;
          for (let y = 0; y < T; y++) {
            const fy = ty * T + y - y0;
            if (fy < 0 || fy >= H) continue;
            for (let x = 0; x < T; x++) {
              const fx = tx * T + x - x0;
              if (fx < 0 || fx >= W) continue;
              const i = (y * T + x) * 4;
              const codigo = d[i] * 65536 + d[i + 1] * 256 + d[i + 2];
              if (codigo) v[fy * W + fx] = (-10000 + codigo * 0.1) / escala;
            }
          }
        }));
      }
    }
    return Promise.all(pedidos).then(function () { return v; });
  }

  /* Promedio en bloques de paso x paso, ignorando NaN. */
  function reducir(v, W, H, paso) {
    if (paso === 1) return { v: v, W: W, H: H };
    const W2 = Math.floor(W / paso), H2 = Math.floor(H / paso);
    const s = new Float32Array(W2 * H2).fill(NaN);
    for (let j = 0; j < H2; j++) {
      for (let i = 0; i < W2; i++) {
        let suma = 0, n = 0;
        for (let b = 0; b < paso; b++) {
          for (let a = 0; a < paso; a++) {
            const x = v[(j * paso + b) * W + i * paso + a];
            if (x === x) { suma += x; n++; }
          }
        }
        if (n) s[j * W2 + i] = suma / n;
      }
    }
    return { v: s, W: W2, H: H2 };
  }

  /* El polígono de la comuna sobre una grilla: 1 dentro, 0 fuera.
     `aGrilla(lng, lat)` da la posición en celdas. */
  function mascara(geometria, W, H, aGrilla) {
    const lienzo = document.createElement('canvas');
    lienzo.width = W; lienzo.height = H;
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    ctx.beginPath();
    const poligonos = geometria.type === 'MultiPolygon' ? geometria.coordinates : [geometria.coordinates];
    poligonos.forEach(function (pg) {
      pg.forEach(function (anillo) {
        anillo.forEach(function (p, k) {
          const q = aGrilla(p[0], p[1]);
          if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
        });
      });
    });
    ctx.fill('evenodd');
    const a = ctx.getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = a[i * 4 + 3] >= 128 ? 1 : 0;
    return m;
  }

  function limites(geometria) {
    let o = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
    const poligonos = geometria.type === 'MultiPolygon' ? geometria.coordinates : [geometria.coordinates];
    poligonos.forEach(function (pg) {
      pg[0].forEach(function (p) {
        if (p[0] < o) o = p[0]; if (p[0] > e) e = p[0];
        if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1];
      });
    });
    return { oeste: o, este: e, sur: s, norte: n };
  }

  /* Elevación y pendiente de la comuna, ya en sus grillas. */
  function leerDatos(geometria) {
    const lim = limites(geometria);
    const zr = Z_RELIEVE, zp = Z_PENDIENTE;
    // Una celda de margen alrededor del recuadro.
    const x0 = Math.floor(pxDe(lim.oeste, zr)) - 1, x1 = Math.ceil(pxDe(lim.este, zr)) + 1;
    const y0 = Math.floor(pyDe(lim.norte, zr)) - 1, y1 = Math.ceil(pyDe(lim.sur, zr)) + 1;
    const W = x1 - x0, H = y1 - y0;
    const paso = Math.max(1, Math.ceil(Math.sqrt(W * H / MAX_VERTICES)));

    const arch = GTMapaReal.teselas;
    const relieve = arch.archivo(RUTA_RELIEVE), pendiente = arch.archivo(RUTA_PENDIENTE);
    // La pendiente en z11 cubre la misma ventana con el doble de píxeles.
    const factor = Math.pow(2, zp - zr);
    const pasoTex = Math.max(1, Math.ceil(Math.max(W * factor, H * factor) / MAX_TEXTURA));

    return Promise.all([
      ventana(relieve, zr, x0, y0, W, H, 1),
      ventana(pendiente, zp, x0 * factor, y0 * factor, W * factor, H * factor, 1),
    ]).then(function (r) {
      const g = reducir(r[0], W, H, paso);
      const p = reducir(r[1], W * factor, H * factor, pasoTex);
      const enGrilla = function (lng, lat) {
        return [(pxDe(lng, zr) - x0) / paso, (pyDe(lat, zr) - y0) / paso];
      };
      const enTextura = function (lng, lat) {
        return [(pxDe(lng, zp) - x0 * factor) / pasoTex, (pyDe(lat, zp) - y0 * factor) / pasoTex];
      };
      const latMedia = (lim.norte + lim.sur) / 2;
      // Metros por celda de la grilla, en el suelo.
      const mpp = 40075016.686 / (T * Math.pow(2, zr)) * Math.cos(latMedia * Math.PI / 180) * paso;
      return {
        W: g.W, H: g.H, elev: g.v, dentro: mascara(geometria, g.W, g.H, enGrilla), mpp: mpp,
        pend: p.v, Wp: p.W, Hp: p.H, dentroP: mascara(geometria, p.W, p.H, enTextura),
      };
    });
  }

  /* ---------------------------------------------------------------------
     Geometría
     --------------------------------------------------------------------- */

  function estadisticas(d) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < d.elev.length; i++) {
      if (!d.dentro[i]) continue;
      const e = d.elev[i];
      if (e === e) { if (e < min) min = e; if (e > max) max = e; }
    }
    const pend = [];
    for (let i = 0; i < d.pend.length; i++) if (d.dentroP[i] && d.pend[i] === d.pend[i]) pend.push(d.pend[i]);
    pend.sort(function (a, b) { return a - b; });
    const conteo = [0, 0, 0, 0, 0];
    pend.forEach(function (x) { conteo[clasePendiente(x)]++; });
    return { min: min, max: max, mediana: pend.length ? pend[pend.length >> 1] : null,
             fracciones: conteo.map(function (n) { return pend.length ? n / pend.length : 0; }) };
  }

  function clasePendiente(v) {
    for (let k = 0; k < CORTES_PENDIENTE.length; k++) if (v < CORTES_PENDIENTE[k]) return k;
    return CORTES_PENDIENTE.length;
  }

  /* El bloque: superficie, paredes y base, en kilómetros, con y hacia arriba
     y z hacia el sur. La exageración vertical se aplica después escalando el
     grupo, así cambiarla no rearma nada. */
  function construir(THREE, d, est) {
    const W = d.W, H = d.H, km = d.mpp / 1000;
    const cx = W / 2, cz = H / 2;
    const idx = new Int32Array(W * H).fill(-1);
    const pos = [], uv = [];
    let n = 0;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i, e = d.elev[k];
        if (!d.dentro[k] || e !== e) continue;
        idx[k] = n++;
        pos.push((i + 0.5 - cx) * km, (e - est.min) / 1000, (j + 0.5 - cz) * km);
        uv.push((i + 0.5) / W, 1 - (j + 0.5) / H);
      }
    }
    const tri = [], bordes = new Map();
    const borde = function (a, b) {
      const clave = a < b ? a + '_' + b : b + '_' + a;
      const x = bordes.get(clave);
      if (x) x.n++; else bordes.set(clave, { a: a, b: b, n: 1 });
    };
    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = idx[j * W + i], b = idx[j * W + i + 1], c = idx[(j + 1) * W + i], e = idx[(j + 1) * W + i + 1];
        if (a < 0 || b < 0 || c < 0 || e < 0) continue;
        tri.push(a, c, b, b, c, e);                // hacia arriba (y+)
        borde(a, b); borde(b, e); borde(e, c); borde(c, a);
      }
    }

    // El espesor de la base: un poco del relieve, para que el bloque se lea.
    const espesor = Math.max(0.12, (est.max - est.min) / 1000 * 0.12, Math.max(W, H) * km * 0.012);
    const grupo = new THREE.Group();

    const sup = new THREE.BufferGeometry();
    sup.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sup.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    sup.setIndex(tri);
    sup.computeVertexNormals();
    const matSup = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    grupo.add(new THREE.Mesh(sup, matSup));

    // Paredes: un cuadrilátero por cada arista que solo usa un cuadro.
    const pared = [], color = [], linea = [];
    const tierra = new THREE.Color('#8a6a4e'), fondo = new THREE.Color('#5a4434');
    bordes.forEach(function (x) {
      if (x.n !== 1) return;
      const a = x.a * 3, b = x.b * 3;
      const ya = pos[a + 1], yb = pos[b + 1], base = -espesor;
      pared.push(pos[a], ya, pos[a + 2], pos[b], yb, pos[b + 2], pos[b], base, pos[b + 2],
                 pos[a], ya, pos[a + 2], pos[b], base, pos[b + 2], pos[a], base, pos[a + 2]);
      [tierra, tierra, fondo, tierra, fondo, fondo].forEach(function (c) { color.push(c.r, c.g, c.b); });
      linea.push(pos[a], ya, pos[a + 2], pos[b], yb, pos[b + 2]);
    });
    const geoPared = new THREE.BufferGeometry();
    geoPared.setAttribute('position', new THREE.Float32BufferAttribute(pared, 3));
    geoPared.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    geoPared.computeVertexNormals();
    grupo.add(new THREE.Mesh(geoPared, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, side: THREE.DoubleSide })));

    // Base: la misma malla, plana y mirando hacia abajo.
    const posBase = pos.slice();
    for (let k = 1; k < posBase.length; k += 3) posBase[k] = -espesor;
    const triBase = [];
    for (let k = 0; k < tri.length; k += 3) triBase.push(tri[k], tri[k + 2], tri[k + 1]);
    const geoBase = new THREE.BufferGeometry();
    geoBase.setAttribute('position', new THREE.Float32BufferAttribute(posBase, 3));
    geoBase.setIndex(triBase);
    geoBase.computeVertexNormals();
    // Más clara que la pared: vista desde abajo tiene que leerse, no ser un hueco negro.
    grupo.add(new THREE.Mesh(geoBase, new THREE.MeshStandardMaterial({ color: '#8a6f58', roughness: 1 })));

    // El límite comunal en el borde superior, para que la silueta se lea.
    const geoLinea = new THREE.BufferGeometry();
    geoLinea.setAttribute('position', new THREE.Float32BufferAttribute(linea, 3));
    grupo.add(new THREE.LineSegments(geoLinea, new THREE.LineBasicMaterial({ color: '#f4efe6' })));

    return { grupo: grupo, materialSuperficie: matSup, ancho: W * km, largo: H * km, espesor: espesor };
  }

  /* ---------------------------------------------------------------------
     Texturas
     --------------------------------------------------------------------- */

  function hexARgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function texturaPendiente(THREE, d) {
    const rampa = PALETA.rampas.pendiente.map(hexARgb);
    const lienzo = document.createElement('canvas');
    lienzo.width = d.Wp; lienzo.height = d.Hp;
    const ctx = lienzo.getContext('2d');
    const img = ctx.createImageData(d.Wp, d.Hp);
    for (let i = 0; i < d.pend.length; i++) {
      const v = d.pend[i];
      const c = v === v ? rampa[clasePendiente(v)] : [120, 120, 120];
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return lienzoATextura(THREE, lienzo);
  }

  function colorHipsometrico(f) {
    for (let k = 1; k < HIPSOMETRICA.length; k++) {
      if (f <= HIPSOMETRICA[k][0]) {
        const a = HIPSOMETRICA[k - 1], b = HIPSOMETRICA[k];
        const t = (f - a[0]) / (b[0] - a[0]);
        return [0, 1, 2].map(function (c) { return Math.round(a[1][c] + t * (b[1][c] - a[1][c])); });
      }
    }
    return HIPSOMETRICA[HIPSOMETRICA.length - 1][1];
  }

  function texturaElevacion(THREE, d, est) {
    const lienzo = document.createElement('canvas');
    lienzo.width = d.W; lienzo.height = d.H;
    const ctx = lienzo.getContext('2d');
    const img = ctx.createImageData(d.W, d.H);
    const rango = Math.max(1, est.max - est.min);
    for (let i = 0; i < d.elev.length; i++) {
      const e = d.elev[i];
      const c = e === e ? colorHipsometrico(Math.max(0, Math.min(1, (e - est.min) / rango))) : [120, 120, 120];
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return lienzoATextura(THREE, lienzo);
  }

  function lienzoATextura(THREE, lienzo) {
    const t = new THREE.CanvasTexture(lienzo);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  /* ---------------------------------------------------------------------
     Visor
     --------------------------------------------------------------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmt(v, d) { return typeof GT !== 'undefined' && GT.fmt ? GT.fmt(v, d || 0) : String(Math.round(v)); }

  function marco(contenedor, nombre) {
    const caja = document.createElement('section');
    caja.className = 'modelo3d';
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-label', 'Modelo 3D de ' + nombre);
    caja.innerHTML =
      '<div class="modelo3d__lienzo"></div>' +
      '<div class="modelo3d__cab">' +
        '<div><div class="modelo3d__titulo">' + esc(nombre) + '</div>' +
        '<div class="tiny muted">modelo 3D del relieve · pendiente a 30 m</div></div>' +
        '<div class="modelo3d__acciones">' +
          '<button type="button" class="btn btn--chico" id="m3Opciones" aria-pressed="true" title="Mostrar u ocultar las opciones">Opciones</button>' +
          '<button type="button" class="btn btn--chico modelo3d__cerrar" title="Volver al mapa (Esc)">Volver al mapa</button>' +
        '</div>' +
      '</div>' +
      '<div class="modelo3d__panel" hidden>' +
        '<div class="tabs modelo3d__color" role="group" aria-label="Colorear por">' +
          '<button type="button" class="is-active" data-color="pendiente">Pendiente</button>' +
          '<button type="button" data-color="elevacion">Elevación</button>' +
        '</div>' +
        '<label class="modelo3d__fila"><span>Exageración vertical</span><strong id="m3Exag">×1,5</strong></label>' +
        '<input type="range" class="range" min="1" max="5" step="0.5" value="1.5" id="m3ExagRango">' +
        '<div class="modelo3d__botones">' +
          '<button type="button" class="btn btn--chico" data-vista="oblicua">Oblicua</button>' +
          '<button type="button" class="btn btn--chico" data-vista="arriba">Desde arriba</button>' +
          '<button type="button" class="btn btn--chico" data-vista="abajo">Desde abajo</button>' +
          '<button type="button" class="btn btn--chico" id="m3Girar" aria-pressed="false">Girar solo</button>' +
          '<button type="button" class="btn btn--chico" id="m3Imagen">Imagen</button>' +
        '</div>' +
        '<div class="modelo3d__leyenda" id="m3Leyenda"></div>' +
        '<div class="tiny muted" id="m3Datos"></div>' +
      '</div>' +
      '<div class="modelo3d__brujula" title="Norte"><span>N</span><i></i></div>' +
      '<div class="modelo3d__ayuda tiny">Arrastra con el botón izquierdo o la rueda para girar · derecho para mover · rueda para acercar</div>' +
      '<div class="modelo3d__estado">Armando el modelo…</div>';
    contenedor.appendChild(caja);
    return caja;
  }

  function leyendaPendiente(est) {
    return PALETA.rampas.pendiente.map(function (c, k) {
      return '<div class="modelo3d__clase"><i style="background:' + c + '"></i><span>' + NOMBRES_PENDIENTE[k] +
             ' <span class="muted">' + RANGOS_PENDIENTE[k] + '</span></span>' +
             '<span class="mono">' + Math.round(100 * est.fracciones[k]) + ' %</span></div>';
    }).join('');
  }

  function leyendaElevacion(est) {
    const paradas = HIPSOMETRICA.map(function (p) {
      return 'rgb(' + p[1].join(',') + ') ' + (100 * p[0]) + '%';
    }).join(', ');
    return '<div class="modelo3d__rampa" style="background:linear-gradient(90deg,' + paradas + ')"></div>' +
           '<div class="modelo3d__fila tiny muted"><span>' + fmt(est.min) + ' m</span><span>' + fmt(est.max) + ' m</span></div>';
  }

  /* Abre el modelo de una comuna sobre `contenedor` (el mapa). */
  function abrir(opciones) {
    cerrar();
    const contenedor = opciones.contenedor;
    const caja = marco(contenedor, opciones.nombre);
    const estado = caja.querySelector('.modelo3d__estado');
    const vivo = { caja: caja, cerrado: false, limpiar: [] };
    abierto = vivo;

    const salir = function () { cerrar(); if (opciones.alCerrar) opciones.alCerrar(); };
    caja.querySelector('.modelo3d__cerrar').addEventListener('click', salir);
    const teclas = function (e) { if (e.key === 'Escape') salir(); };
    document.addEventListener('keydown', teclas);
    vivo.limpiar.push(function () { document.removeEventListener('keydown', teclas); });

    if (typeof GTMapaReal === 'undefined' || !GTMapaReal.teselas) {
      estado.textContent = 'El modelo necesita las teselas de relieve: abre TerraFoco desde su servidor, no desde el disco.';
      return;
    }

    Promise.all([cargarThree(), leerDatos(opciones.geometria)]).then(function (r) {
      if (vivo.cerrado) return;
      const THREE = r[0].THREE, OrbitControls = r[0].OrbitControls, d = r[1];
      const est = estadisticas(d);
      if (!isFinite(est.min)) { estado.textContent = 'No hay relieve para esta comuna.'; return; }
      const modelo = construir(THREE, d, est);
      const texturas = { pendiente: texturaPendiente(THREE, d), elevacion: texturaElevacion(THREE, d, est) };
      modelo.materialSuperficie.map = texturas.pendiente;
      modelo.materialSuperficie.needsUpdate = true;

      const lienzo = caja.querySelector('.modelo3d__lienzo');
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      lienzo.appendChild(renderer.domElement);

      const escena = new THREE.Scene();
      escena.background = new THREE.Color(PALETA.mapaFondo);
      escena.add(new THREE.HemisphereLight(0xf2f6ff, 0x6b5a4a, 1.15));
      // Una luz baja desde abajo, para la vista inferior.
      const bajo = new THREE.DirectionalLight(0xffffff, 0.45);
      bajo.position.set(0.3, -1, 0.4);
      escena.add(bajo);
      // En el hemisferio sur el sol viene del norte: desde el noroeste y alto.
      const sol = new THREE.DirectionalLight(0xffffff, 1.6);
      sol.position.set(-0.6, 1.1, -0.9);
      escena.add(sol);
      escena.add(modelo.grupo);

      const exagInicial = 1.5;
      modelo.grupo.scale.y = exagInicial;

      const camara = new THREE.PerspectiveCamera(38, 1, 0.01, 2000);
      const controles = new OrbitControls(camara, renderer.domElement);
      controles.enableDamping = true;
      controles.dampingFactor = 0.08;
      controles.screenSpacePanning = true;
      controles.minPolarAngle = 0;
      controles.maxPolarAngle = Math.PI;            // también por debajo
      controles.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
      controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      controles.autoRotateSpeed = 1.2;

      const radio = 0.5 * Math.sqrt(modelo.ancho * modelo.ancho + modelo.largo * modelo.largo);
      controles.minDistance = radio * 0.15;
      controles.maxDistance = radio * 6;
      const centro = new THREE.Vector3(0, (est.max - est.min) / 1000 * exagInicial * 0.35, 0);

      function vista(cual) {
        const dist = radio * 2.1;
        controles.target.copy(centro);
        if (cual === 'arriba') camara.position.set(0, dist * 1.1, 0.0001);
        else if (cual === 'abajo') camara.position.set(0, -dist * 1.1, 0.0001);
        else camara.position.set(-dist * 0.45, dist * 0.62, dist * 0.85);   // desde el suroeste
        camara.lookAt(centro);
        controles.update();
      }
      vista('oblicua');

      /* El panel de opciones flota abajo a la izquierda: el modelo se corre a
         la derecha la mitad de su ancho para que no quede debajo. */
      const panel = caja.querySelector('.modelo3d__panel');
      function medir() {
        const w = lienzo.clientWidth || 1, h = lienzo.clientHeight || 1;
        renderer.setSize(w, h, false);
        camara.aspect = w / h;
        const corrimiento = !panel.hidden && w > 720 ? (panel.offsetWidth + 14) / 2 : 0;
        if (corrimiento) camara.setViewOffset(w, h, -corrimiento, 0, w, h);
        else camara.clearViewOffset();
        camara.updateProjectionMatrix();
      }
      medir();
      const observador = new ResizeObserver(medir);
      observador.observe(lienzo);

      const brujula = caja.querySelector('.modelo3d__brujula');
      let cuadro = 0;
      (function dibujar() {
        if (vivo.cerrado) return;
        cuadro = requestAnimationFrame(dibujar);
        controles.update();
        // El norte en pantalla gira con la cámara (azimut 0 = mirando al norte).
        brujula.style.transform = 'rotate(' + (controles.getAzimuthalAngle() * 180 / Math.PI) + 'deg)';
        renderer.render(escena, camara);
      })();

      // --- Panel ---
      const leyenda = caja.querySelector('#m3Leyenda');
      leyenda.innerHTML = leyendaPendiente(est);
      caja.querySelector('#m3Datos').innerHTML =
        'Elevación ' + fmt(est.min) + '–' + fmt(est.max) + ' m · desnivel ' + fmt(est.max - est.min) + ' m' +
        (est.mediana !== null ? ' · pendiente mediana ' + fmt(est.mediana) + ' %' : '') +
        '<br>Relieve NASADEM (celda ~' + fmt(d.mpp) + ' m) · pendiente a 30 m. ' +
        fmt(modelo.ancho, 1) + ' × ' + fmt(modelo.largo, 1) + ' km.';
      panel.hidden = false;
      medir();
      const opciones3d = caja.querySelector('#m3Opciones');
      opciones3d.addEventListener('click', function () {
        panel.hidden = !panel.hidden;
        opciones3d.setAttribute('aria-pressed', String(!panel.hidden));
        medir();
      });

      caja.querySelectorAll('[data-color]').forEach(function (b) {
        b.addEventListener('click', function () {
          caja.querySelectorAll('[data-color]').forEach(function (x) { x.classList.toggle('is-active', x === b); });
          const c = b.getAttribute('data-color');
          modelo.materialSuperficie.map = texturas[c];
          modelo.materialSuperficie.needsUpdate = true;
          leyenda.innerHTML = c === 'pendiente' ? leyendaPendiente(est) : leyendaElevacion(est);
          caja.querySelector('.modelo3d__cab .tiny').textContent =
            'modelo 3D del relieve · ' + (c === 'pendiente' ? 'pendiente a 30 m' : 'elevación');
        });
      });
      const rango = caja.querySelector('#m3ExagRango');
      rango.addEventListener('input', function () {
        modelo.grupo.scale.y = +rango.value;
        caja.querySelector('#m3Exag').textContent = '×' + fmt(+rango.value, 1);
      });
      caja.querySelectorAll('[data-vista]').forEach(function (b) {
        b.addEventListener('click', function () { vista(b.getAttribute('data-vista')); });
      });
      const girar = caja.querySelector('#m3Girar');
      girar.addEventListener('click', function () {
        controles.autoRotate = !controles.autoRotate;
        girar.setAttribute('aria-pressed', String(controles.autoRotate));
      });
      caja.querySelector('#m3Imagen').addEventListener('click', function () {
        renderer.render(escena, camara);
        const a = document.createElement('a');
        a.href = renderer.domElement.toDataURL('image/png');
        a.download = 'terrafoco_modelo3d_' + String(opciones.nombre).normalize('NFD')
          .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png';
        document.body.appendChild(a); a.click(); a.remove();
      });
      // La rueda apretada no debe abrir el desplazamiento automático de Windows.
      renderer.domElement.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });

      estado.remove();
      vivo.limpiar.push(function () {
        cancelAnimationFrame(cuadro);
        observador.disconnect();
        controles.dispose();
        modelo.grupo.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        texturas.pendiente.dispose(); texturas.elevacion.dispose();
        renderer.dispose();
      });
    }).catch(function (e) {
      console.warn('[modelo3d]', e);
      if (!vivo.cerrado) estado.textContent = 'No se pudo armar el modelo: ' + e.message;
    });
  }

  function cerrar() {
    if (!abierto) return;
    abierto.cerrado = true;
    abierto.limpiar.forEach(function (f) { try { f(); } catch (e) { /* ya cerrado */ } });
    abierto.caja.remove();
    abierto = null;
  }

  return { abrir: abrir, cerrar: cerrar };
})();
