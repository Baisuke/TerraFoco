/* ==========================================================================
   TerraFoco — Cálculos del visor de inundaciones

   Todo lo que el visor recalcula en el navegador, sin interfaz: el índice
   con otros pesos, su validación contra los eventos, las seis variables de
   una celda y la exposición (personas y equipamiento) sobre la grilla de
   30 m de la comuna abierta. Va separado de la página para poder leerlo —y
   probarlo— como las cuentas que son.

   Reproduce el motor, no lo aproxima:
     - la media comunal de una suma ponderada es la suma ponderada de las
       medias, y el motor promedia sobre las celdas donde existen las
       variables CON PESO; variables.json trae, por comuna, las sumas de
       cada variable por patrón de datos disponibles (motor/
       variables_inundacion.py). Con los pesos calibrados sale el mismo
       índice comunal que guarda la base (±0,0001) y el mismo Spearman;
     - los cortes por cuartiles de las celdas salen de una muestra de 40 mil
       celdas, filtrada igual que el motor filtra para cada juego de pesos;
     - percentiles con interpolación lineal, como numpy.
   ========================================================================== */

const GTCalculo = (function () {
  'use strict';

  const NVAR = 6;

  /* ---------------------------------------------------------------------
     Estadística mínima
     --------------------------------------------------------------------- */

  /* Percentil de un arreglo YA ORDENADO, interpolación lineal (numpy). */
  function percentil(ordenado, p) {
    const n = ordenado.length;
    if (!n) return NaN;
    const h = (n - 1) * p / 100, lo = Math.floor(h), hi = Math.ceil(h);
    return ordenado[lo] + (ordenado[hi] - ordenado[lo]) * (h - lo);
  }

  function ordenar(valores) {
    return Float64Array.from(valores).sort();
  }

  function cuartiles(valores) {
    const s = ordenar(valores);
    return [25, 50, 75].map(function (p) { return percentil(s, p); });
  }

  /* Fracción de un arreglo ordenado que queda bajo v (0..1). */
  function fraccionBajo(ordenado, v) {
    let lo = 0, hi = ordenado.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (ordenado[m] < v) lo = m + 1; else hi = m;
    }
    return ordenado.length ? lo / ordenado.length : 0;
  }

  /* Clase de un valor dados los cortes ascendentes: la primera cuyo corte
     lo supera (searchsorted a la derecha, como el motor). */
  function clasificar(v, cortes) {
    for (let i = 0; i < cortes.length; i++) if (v < cortes[i]) return i;
    return cortes.length;
  }

  /* Rangos con empates promediados. */
  function rangos(x) {
    const orden = x.map(function (_v, i) { return i; }).sort(function (a, b) { return x[a] - x[b]; });
    const r = new Array(x.length);
    let i = 0;
    while (i < orden.length) {
      let j = i;
      while (j + 1 < orden.length && x[orden[j + 1]] === x[orden[i]]) j++;
      for (let k = i; k <= j; k++) r[orden[k]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  }

  function spearman(x, y) {
    if (x.length < 3) return NaN;
    const rx = rangos(x), ry = rangos(y), n = x.length;
    const mx = rx.reduce(function (s, v) { return s + v; }, 0) / n;
    const my = ry.reduce(function (s, v) { return s + v; }, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      num += (rx[i] - mx) * (ry[i] - my);
      dx += (rx[i] - mx) * (rx[i] - mx);
      dy += (ry[i] - my) * (ry[i] - my);
    }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  }

  /* ---------------------------------------------------------------------
     Pesos
     --------------------------------------------------------------------- */

  /* A porcentajes que suman 100. null si todos son cero. */
  function normalizarPesos(pesos) {
    const s = pesos.reduce(function (a, b) { return a + Math.max(0, b); }, 0);
    if (!s) return null;
    return pesos.map(function (p) { return Math.max(0, p) * 100 / s; });
  }

  function mismosPesos(a, b) {
    return a && b && a.every(function (x, i) { return Math.abs(x - b[i]) < 0.05; });
  }

  function mascaraDe(pesos) {
    let m = 0;
    pesos.forEach(function (p, k) { if (p > 0) m |= 1 << k; });
    return m;
  }

  /* Media comunal del índice para un juego de pesos (ver motor:
     indice_comunal). null si ninguna celda tiene todas las variables. */
  function indiceComunal(grupos, pesos) {
    const mascara = mascaraDe(pesos);
    let celdas = 0, suma = 0;
    grupos.forEach(function (g) {
      if ((g.patron & mascara) !== mascara) return;
      celdas += g.celdas;
      pesos.forEach(function (p, k) { if (p > 0) suma += g.sumas[k] * p / 100; });
    });
    return celdas ? suma / celdas : null;
  }

  /* ---------------------------------------------------------------------
     El modelo: variables.json
     --------------------------------------------------------------------- */

  function Modelo(datos) {
    this.datos = datos;
    this.variables = datos.variables;
    this.pasos = datos.cuantizacion.pasos;
    this.calibrados = datos.variables.map(function (v) { return v.peso; });
    const bin = atob(datos.muestra.datos);
    const m = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) m[i] = bin.charCodeAt(i);
    this.muestra = m;
    this._ordenadas = {};
    this.base = this.evaluar(this.calibrados);
  }

  /* El índice de las celdas de la muestra para un juego, ordenado. Solo las
     celdas con todas las variables del juego, como el motor. */
  Modelo.prototype.muestraOrdenada = function (pesos) {
    const clave = pesos.map(function (p) { return p.toFixed(2); }).join(',');
    if (this._ordenadas[clave]) return this._ordenadas[clave];
    const m = this.muestra, n = m.length / NVAR, pasos = this.pasos;
    const usadas = [];
    pesos.forEach(function (p, k) { if (p > 0) usadas.push(k); });
    const salida = [];
    for (let i = 0; i < n; i++) {
      let s = 0, ok = true;
      for (let j = 0; j < usadas.length; j++) {
        const k = usadas[j], q = m[i * NVAR + k];
        if (!q) { ok = false; break; }
        s += pesos[k] / 100 * (q - 1) / pasos;
      }
      if (ok) salida.push(s);
    }
    const ordenada = ordenar(salida);
    // Pocas claves: el deslizador genera muchas, se guarda solo la última y la calibrada.
    const claves = Object.keys(this._ordenadas);
    if (claves.length > 4) delete this._ordenadas[claves[1]];
    this._ordenadas[clave] = ordenada;
    return ordenada;
  };

  /* Todo lo que cambia con los pesos: índice y clase de cada comuna, los
     cortes de las celdas y la validación. */
  Modelo.prototype.evaluar = function (pesosEntrada) {
    const pesos = normalizarPesos(pesosEntrada);
    if (!pesos) return null;
    const comunas = this.datos.comunas.map(function (c) {
      return { id: c.id_comuna, nombre: c.nombre, indice: indiceComunal(c.grupos, pesos),
               eventos: c.eventos, eventos82: c.eventos_sin_1982 };
    }).filter(function (c) { return c.indice !== null; });
    const cortesComuna = cuartiles(comunas.map(function (c) { return c.indice; }));
    comunas.forEach(function (c) { c.clase = clasificar(c.indice, cortesComuna); });

    const ordenada = this.muestraOrdenada(pesos);
    const cortesPixel = [25, 50, 75].map(function (p) { return percentil(ordenada, p); });

    // Validación: la misma cuenta que motor/indicadores/validar_inundacion.py.
    const altas = comunas.filter(function (c) { return c.clase >= 2; });
    const total = comunas.reduce(function (s, c) { return s + c.eventos; }, 0);
    const enAlta = altas.reduce(function (s, c) { return s + c.eventos; }, 0);
    const indices = comunas.map(function (c) { return c.indice; });

    if (this.base) {
      const antes = {};
      this.base.comunas.forEach(function (c) { antes[c.id] = c.clase; });
      comunas.forEach(function (c) { c.claseCalibrada = antes[c.id]; });
    }
    return {
      pesos: pesos, comunas: comunas, cortesComuna: cortesComuna, cortesPixel: cortesPixel,
      muestra: ordenada,
      minimo: ordenada[0], maximo: ordenada[ordenada.length - 1],
      eventos: total, enAlta: enAlta, comunasAlta: altas.length,
      fraccionEnAlta: total ? enAlta / total : null,
      azar: comunas.length ? altas.length / comunas.length : null,
      rho: spearman(indices, comunas.map(function (c) { return c.eventos; })),
      rhoSin1982: spearman(indices, comunas.map(function (c) { return c.eventos82; })),
    };
  };

  /* Cada variable sola, orientada: un ρ positivo es que ordena las comunas
     en el sentido que el modelo le supone. */
  Modelo.prototype.porVariable = function () {
    const self = this;
    if (this._porVariable) return this._porVariable;
    this._porVariable = this.variables.map(function (v, k) {
      const pesos = self.variables.map(function (_x, j) { return j === k ? 100 : 0; });
      const cs = self.datos.comunas.map(function (c) {
        return { i: indiceComunal(c.grupos, pesos), e: c.eventos };
      }).filter(function (c) { return c.i !== null; });
      return spearman(cs.map(function (c) { return c.i; }), cs.map(function (c) { return c.e; }));
    });
    return this._porVariable;
  };

  /* De normalizado (lo que entra a la suma) al valor en su unidad. En los
     extremos el recorte a percentiles solo permite decir "≤" o "≥". */
  Modelo.prototype.original = function (k, q) {
    const v = this.variables[k];
    if (!q) return null;
    let n = (q - 1) / this.pasos;
    if (v.sentido < 0) n = 1 - n;
    const bajo = v.escala[0], alto = v.escala[1];
    return { valor: bajo + n * (alto - bajo),
             limite: q === 1 ? (v.sentido < 0 ? 'mayor' : 'menor')
                   : q === this.pasos + 1 ? (v.sentido < 0 ? 'menor' : 'mayor') : null };
  };

  Modelo.prototype.idDeComuna = function (nombre) {
    const b = normalizar(nombre);
    const c = this.datos.comunas.filter(function (x) { return normalizar(x.nombre) === b; })[0];
    return c ? c.id_comuna : null;
  };

  function normalizar(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  /* ---------------------------------------------------------------------
     Las seis variables sobre la grilla de la comuna
     --------------------------------------------------------------------- */

  /* Lee las teselas de variables (512 x 1024: arriba R,G,B = variables
     0,1,2; abajo, 3,4,5) sobre la MISMA ventana de píxeles de la grilla del
     índice. Ambas son z11 del mismo esquema de teselas, así que la celda i
     de una es la celda i de la otra. */
  function grillaVariables(archivo, base, z) {
    z = z || 11;
    const T = 512, lado = Math.pow(2, z) * T;
    const gx = function (lng) { return (lng + 180) / 360 * lado; };
    const gy = function (lat) { return (1 - GTDetalle.mercY(lat) / Math.PI) / 2 * lado; };
    const px0 = Math.round(gx(base.esquinas[0][0])), py0 = Math.round(gy(base.esquinas[0][1]));
    const W = base.ancho, H = base.alto, N = W * H;
    const n = [];
    for (let k = 0; k < NVAR; k++) n.push(new Uint8Array(N));

    const pedidos = [];
    for (let ty = Math.floor(py0 / T); ty <= Math.floor((py0 + H - 1) / T); ty++) {
      for (let tx = Math.floor(px0 / T); tx <= Math.floor((px0 + W - 1) / T); tx++) {
        pedidos.push(decodificar(archivo, z, tx, ty, T).then(function (d) {
          if (!d) return;
          for (let y = 0; y < T; y++) {
            const fy = ty * T + y - py0;
            if (fy < 0 || fy >= H) continue;
            for (let x = 0; x < T; x++) {
              const fx = tx * T + x - px0;
              if (fx < 0 || fx >= W) continue;
              const i = (y * T + x) * 4, j = ((y + T) * T + x) * 4, c = fy * W + fx;
              n[0][c] = d[i]; n[1][c] = d[i + 1]; n[2][c] = d[i + 2];
              n[3][c] = d[j]; n[4][c] = d[j + 1]; n[5][c] = d[j + 2];
            }
          }
        }));
      }
    }
    return Promise.all(pedidos).then(function () {
      return { nombre: base.nombre, ancho: W, alto: H, n: n };
    });
  }

  function decodificar(archivo, z, x, y, T) {
    return archivo.getZxy(z, x, y).then(function (r) {
      if (!r || !r.data) return null;
      return createImageBitmap(new Blob([r.data]),
                               { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    }).then(function (bmp) {
      if (!bmp) return null;
      const lienzo = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(T, 2 * T)
        : Object.assign(document.createElement('canvas'), { width: T, height: 2 * T });
      const ctx = lienzo.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, T, 2 * T).data;
    }).catch(function () { return null; });
  }

  /* Cultivo y pradera de cada celda (ingesta.worldcover): R = 1 + % de
     cultivo, G = 1 + % de pradera, 0 fuera de las comunas. Misma ventana de
     píxeles z11 que la grilla del índice. */
  function grillaAgricola(archivo, base) {
    const z = 11, T = 512, lado = Math.pow(2, z) * T;
    const gx = function (lng) { return (lng + 180) / 360 * lado; };
    const gy = function (lat) { return (1 - GTDetalle.mercY(lat) / Math.PI) / 2 * lado; };
    const px0 = Math.round(gx(base.esquinas[0][0])), py0 = Math.round(gy(base.esquinas[0][1]));
    const W = base.ancho, H = base.alto;
    const cultivo = new Uint8Array(W * H), pradera = new Uint8Array(W * H);
    const pedidos = [];
    for (let ty = Math.floor(py0 / T); ty <= Math.floor((py0 + H - 1) / T); ty++) {
      for (let tx = Math.floor(px0 / T); tx <= Math.floor((px0 + W - 1) / T); tx++) {
        pedidos.push(decodificarCuadrada(archivo, z, tx, ty, T).then(function (d) {
          if (!d) return;
          for (let y = 0; y < T; y++) {
            const fy = ty * T + y - py0;
            if (fy < 0 || fy >= H) continue;
            for (let x = 0; x < T; x++) {
              const fx = tx * T + x - px0;
              if (fx < 0 || fx >= W) continue;
              const i = (y * T + x) * 4, c = fy * W + fx;
              cultivo[c] = d[i]; pradera[c] = d[i + 1];
            }
          }
        }));
      }
    }
    return Promise.all(pedidos).then(function () {
      return { nombre: base.nombre, cultivo: cultivo, pradera: pradera };
    });
  }

  function decodificarCuadrada(archivo, z, x, y, T) {
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

  /* Hectáreas de una celda de la grilla: el tamaño medio en el suelo. */
  function haPorCelda(base) {
    const e = base.esquinas, lat = (e[0][1] + e[2][1]) / 2 * Math.PI / 180;
    const ancho = (e[1][0] - e[0][0]) * 111320 * Math.cos(lat) / base.ancho;
    const alto = (e[0][1] - e[2][1]) * 110540 / base.alto;
    return ancho * alto / 10000;
  }

  /* Hectáreas de cultivo y pradera en la comuna y sobre el umbral. */
  function exposicionAgricola(agr, base) {
    const ha = haPorCelda(base) / 100;     // el canal viene en % + 1
    const r = { cultivo: 0, cultivoSobre: 0, pradera: 0, praderaSobre: 0 };
    const N = base.ancho * base.alto;
    for (let i = 0; i < N; i++) {
      if (base.original[i] === 255) continue;
      const c = agr.cultivo[i] ? agr.cultivo[i] - 1 : 0;
      const p = agr.pradera[i] ? agr.pradera[i] - 1 : 0;
      if (!c && !p) continue;
      const sobre = base.clases[i] !== 255;
      r.cultivo += c * ha; r.pradera += p * ha;
      if (sobre) { r.cultivoSobre += c * ha; r.praderaSobre += p * ha; }
    }
    return r;
  }

  /* El índice de cada celda con otros pesos. NaN donde falte una variable
     con peso o fuera de la comuna (`dentro`: la clase original, 255 fuera). */
  function valoresConPesos(g, pesos, pasos, dentro) {
    const N = g.ancho * g.alto, salida = new Float32Array(N).fill(NaN);
    const usadas = [], w = [];
    pesos.forEach(function (p, k) { if (p > 0) { usadas.push(g.n[k]); w.push(p / 100 / pasos); } });
    for (let i = 0; i < N; i++) {
      if (dentro && dentro[i] === 255) continue;
      let s = 0, ok = true;
      for (let j = 0; j < usadas.length; j++) {
        const q = usadas[j][i];
        if (!q) { ok = false; break; }
        s += w[j] * (q - 1);
      }
      if (ok) salida[i] = s;
    }
    return salida;
  }

  /* ---------------------------------------------------------------------
     Exposición: manzanas y equipamiento sobre la grilla
     --------------------------------------------------------------------- */

  /* ¿El punto (x, y) cae dentro de los anillos? Par-impar: los huecos de un
     polígono quedan fuera sin tratarlos aparte. */
  function dentroDe(anillos, x, y) {
    let dentro = false;
    for (let a = 0; a < anillos.length; a++) {
      const r = anillos[a];
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const yi = r[i][1], yj = r[j][1];
        if ((yi > y) !== (yj > y) &&
            x < (r[j][0] - r[i][0]) * (y - yi) / (yj - yi) + r[i][0]) dentro = !dentro;
      }
    }
    return dentro;
  }

  /* Personas y viviendas por celda. Cada manzana reparte las suyas por
     partes iguales entre las celdas cuyo centro cae dentro; una manzana más
     chica que una celda las deja en la celda de su centro. */
  function rasterizarManzanas(geo, base) {
    const e = base.esquinas, W = base.ancho, H = base.alto;
    const yN = GTDetalle.mercY(e[0][1]), yS = GTDetalle.mercY(e[2][1]);
    const fx = function (lng) { return (lng - e[0][0]) / (e[1][0] - e[0][0]) * W; };
    const fy = function (lat) { return (yN - GTDetalle.mercY(lat)) / (yN - yS) * H; };
    const personas = new Float32Array(W * H), viviendas = new Float32Array(W * H);
    // Fuera de la ciudad: aldeas y entidades rurales (Censo 2024). Con el
    // Censo 2017 urbano no hay nada aquí.
    const rurales = new Float32Array(W * H);
    let total = 0, totalViv = 0, totalRural = 0;
    (geo.features || []).forEach(function (f) {
      const p = f.properties || {};
      if (!f.geometry || (!p.personas && !p.viviendas)) return;
      const poligonos = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
      const anillos = [];
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, sx = 0, sy = 0, nv = 0;
      poligonos.forEach(function (pg) {
        pg.forEach(function (anillo, ia) {
          const r = anillo.map(function (c) {
            const x = fx(c[0]), y = fy(c[1]);
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            if (ia === 0) { sx += x; sy += y; nv++; }
            return [x, y];
          });
          anillos.push(r);
        });
      });
      const celdas = [];
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.floor(y1)); y++) {
        for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.floor(x1)); x++) {
          if (dentroDe(anillos, x + 0.5, y + 0.5)) celdas.push(y * W + x);
        }
      }
      if (!celdas.length && nv) {
        const cx = Math.floor(sx / nv), cy = Math.floor(sy / nv);
        if (cx >= 0 && cy >= 0 && cx < W && cy < H) celdas.push(cy * W + cx);
      }
      total += p.personas || 0; totalViv += p.viviendas || 0;
      const rural = !!p.tipo && p.tipo !== 'manzana_urbana';
      if (rural) totalRural += p.personas || 0;
      if (!celdas.length) return;
      const pp = (p.personas || 0) / celdas.length, vv = (p.viviendas || 0) / celdas.length;
      celdas.forEach(function (i) {
        personas[i] += pp; viviendas[i] += vv;
        if (rural) rurales[i] += pp;
      });
    });
    return { nombre: base.nombre, personas: personas, viviendas: viviendas, rurales: rurales,
             totalManzanas: total, totalViviendas: totalViv, totalRural: totalRural };
  }

  /* Cuánta gente hay sobre el umbral en la comuna y en cada localidad.
     `clases`: lo que pasa el umbral (255 no pasa); `original`: 255 fuera de
     la comuna; `zonas`: localidad k + 1 por celda. */
  function exposicion(pob, base, zonas, nLocalidades) {
    const N = base.ancho * base.alto;
    const r = { personas: 0, viviendas: 0, personasSobre: 0, viviendasSobre: 0,
                rurales: 0, ruralesSobre: 0, localidades: [] };
    const lp = new Float64Array(nLocalidades || 0), lps = new Float64Array(nLocalidades || 0);
    for (let i = 0; i < N; i++) {
      const p = pob.personas[i];
      if (!p && !pob.viviendas[i]) continue;
      if (base.original[i] === 255) continue;
      const sobre = base.clases[i] !== 255;
      r.personas += p; r.viviendas += pob.viviendas[i];
      const ru = pob.rurales ? pob.rurales[i] : 0;
      r.rurales += ru;
      if (sobre) { r.personasSobre += p; r.viviendasSobre += pob.viviendas[i]; r.ruralesSobre += ru; }
      const z = zonas ? zonas[i] : 0;
      if (z) { lp[z - 1] += p; if (sobre) lps[z - 1] += p; }
    }
    for (let k = 0; k < (nLocalidades || 0); k++) r.localidades.push({ personas: lp[k], personasSobre: lps[k] });
    return r;
  }

  /* Cada punto de equipamiento con la celda en que cae. */
  function evaluarEquipamiento(rasgos, detalle) {
    const base = detalle.base();
    if (!base) return [];
    return rasgos.map(function (f) {
      const c = f.geometry.coordinates;
      const i = detalle.indiceEn({ lng: c[0], lat: c[1] });
      const dentro = i >= 0 && base.original[i] !== 255;
      return {
        f: f, i: i, dentro: dentro,
        valor: dentro && base.valores ? base.valores[i] : null,
        clase: dentro ? base.original[i] : null,
        sobre: dentro && base.clases[i] !== 255,
      };
    });
  }

  /* Histograma del índice dentro de la comuna: `n` barras entre min y max. */
  function histograma(base, min, max, n) {
    const barras = new Array(n).fill(0);
    if (!base || !base.valores) return barras;
    const v = base.valores, o = base.original, paso = (max - min) / n;
    for (let i = 0; i < v.length; i++) {
      if (o[i] === 255) continue;
      const x = v[i];
      if (x !== x) continue;
      let k = Math.floor((x - min) / paso);
      if (k < 0) k = 0; else if (k >= n) k = n - 1;
      barras[k]++;
    }
    return barras;
  }

  return {
    percentil: percentil, cuartiles: cuartiles, fraccionBajo: fraccionBajo,
    clasificar: clasificar, spearman: spearman, rangos: rangos,
    normalizarPesos: normalizarPesos, mismosPesos: mismosPesos, indiceComunal: indiceComunal,
    Modelo: Modelo, normalizar: normalizar,
    grillaVariables: grillaVariables, valoresConPesos: valoresConPesos,
    grillaAgricola: grillaAgricola, exposicionAgricola: exposicionAgricola, haPorCelda: haPorCelda,
    dentroDe: dentroDe, rasterizarManzanas: rasterizarManzanas, exposicion: exposicion,
    evaluarEquipamiento: evaluarEquipamiento, histograma: histograma,
  };
})();

if (typeof module !== 'undefined') module.exports = GTCalculo;
