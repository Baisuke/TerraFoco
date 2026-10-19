/* ==========================================================================
   TerraFoco — Simulación de un área verde: las cuentas

   Responde: si se pone una plaza o un parque AQUÍ, ¿cuánto baja la
   temperatura superficial, hasta dónde se nota y a quién le llega?

   Parte de lo que ya pasa en la misma ciudad, no de un número genérico:
   1. MIDE el efecto de los parques que existen, como se mide en la
      literatura (Cao et al., 2010): cada parque de 1 ha o más que no es solo
      pasto, contra su propio entorno urbano de 100 a 500 m (sin otras áreas
      verdes), con la temperatura de ECOSTRESS a 70 m. El promedio, ponderado
      por celdas, es la "isla fresca" de la ciudad.
      Compararlos con los barrios lejos de toda área verde no sirve: en
      Rancagua esos barrios quedan en el borde, junto a campos regados más
      frescos, y las áreas de OSM son sobre todo bandejones de pasto; así
      medidos, los parques salían 0,3 °C MÁS cálidos. Por parque, contra su
      entorno, los 20 de 1 ha o más salen 0,44 °C más frescos (los más grandes,
      cerca de 1 °C). Es poco porque la temperatura promedia escenas de día y
      de noche, y de noche el efecto casi desaparece.
   2. La APLICA al parque nuevo, escalada por:
        - el tamaño: la isla fresca crece con el logaritmo del área del
          parque (Cao et al., 2010), relativo al parque típico de la ciudad;
        - el tipo: pasto 0,7 · mixto 1 · arbolado 1,3, porque los árboles
          dan sombra además de evapotranspiración (Bowler et al., 2010);
        - la distancia: fuera del parque el efecto decae como exp(−3d/L),
          con L igual al ancho del parque entre 60 y 400 m, el orden de las
          distancias de enfriamiento informadas (Aram et al., 2019).
   Varios parques no se suman: cada celda toma el más fuerte.

   Es temperatura de la SUPERFICIE (lo que mide el satélite), no del aire:
   las diferencias de aire son del orden de un tercio a la mitad. Y es un
   escenario: el resultado real depende del riego, la especie y el diseño.
   ========================================================================== */

const GTSimCalor = (function () {
  'use strict';

  const TIPOS = {
    pasto:    { nombre: 'Pasto',    factor: 0.7 },
    mixto:    { nombre: 'Mixto',    factor: 1.0 },
    arbolado: { nombre: 'Arbolado', factor: 1.3 },
  };
  const PARQUE_MINIMO = 10000;         // m²: menos de una celda de 70 m no se puede medir
  const ENTORNO = [100, 500];          // m: el anillo con que se compara cada parque
  /* °C, si la comuna no tiene parques suficientes para medirlo: el orden que
     dan los de Rancagua con estos mismos datos (0,44 °C). */
  const INTENSIDAD_RESPALDO = 0.5;
  const UMBRAL_FRESCO = 0.25;          // °C desde el que una celda cuenta como "más fresca"

  function mercY(lat) { const r = lat * Math.PI / 180; return Math.log(Math.tan(Math.PI / 4 + r / 2)); }
  function latDeMerc(m) { return (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180 / Math.PI; }

  /* Geometría de la grilla de una comuna: esquinas en lng/lat, filas en
     Mercator (igual que la imagen que pone MapLibre). */
  function grilla(base) {
    const e = base.esquinas, W = base.ancho, H = base.alto;
    const yN = mercY(e[0][1]), yS = mercY(e[2][1]);
    const latMedia = (e[0][1] + e[2][1]) / 2 * Math.PI / 180;
    const dx = (e[1][0] - e[0][0]) * 111320 * Math.cos(latMedia) / W;
    const dy = (e[0][1] - e[2][1]) * 110540 / H;
    return {
      W: W, H: H, N: W * H, dx: dx, dy: dy, haCelda: dx * dy / 10000,
      x: function (lng) { return (lng - e[0][0]) / (e[1][0] - e[0][0]) * W; },
      y: function (lat) { return (yN - mercY(lat)) / (yN - yS) * H; },
      lng: function (x) { return e[0][0] + x / W * (e[1][0] - e[0][0]); },
      lat: function (y) { return latDeMerc(yN - y / H * (yN - yS)); },
    };
  }

  /* °C de cada celda desde su clase (PNG por comuna: solo hay clases). Cada
     clase toma su punto medio, y el conjunto se corre para que la media de la
     comuna sea la que midió el motor (ficha.media, sobre las mismas celdas). */
  function temperaturas(base, ficha, cortes) {
    const n = cortes.length + 1, rep = [];
    for (let k = 0; k < n; k++) {
      const lo = k === 0 ? cortes[0] - (cortes[1] - cortes[0]) : cortes[k - 1];
      const hi = k === n - 1 ? cortes[n - 2] + (cortes[n - 2] - cortes[n - 3]) : cortes[k];
      rep.push((lo + hi) / 2);
    }
    const o = base.original, N = o.length, t = new Float32Array(N).fill(NaN);
    let s = 0, c = 0;
    for (let i = 0; i < N; i++) if (o[i] < n) { s += rep[o[i]]; c++; }
    const corrimiento = ficha && typeof ficha.media === 'number' && c ? ficha.media - s / c : 0;
    for (let i = 0; i < N; i++) if (o[i] < n) t[i] = rep[o[i]] + corrimiento;
    return { t: t, representativos: rep.map(function (r) { return r + corrimiento; }), corrimiento: corrimiento };
  }

  /* Punto en polígono (par-impar) con anillos en coordenadas de grilla. */
  function dentroDe(anillos, x, y) {
    let dentro = false;
    for (let a = 0; a < anillos.length; a++) {
      const r = anillos[a];
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dentro = !dentro;
      }
    }
    return dentro;
  }

  /* Recorre las celdas cuyo centro cae dentro de cada polígono. */
  function rasterizar(features, g, alCelda) {
    (features || []).forEach(function (f, k) {
      if (!f.geometry) return;
      const polis = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates
                  : f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : [];
      polis.forEach(function (pg) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        const anillos = pg.map(function (anillo) {
          return anillo.map(function (c) {
            const x = g.x(c[0]), y = g.y(c[1]);
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            return [x, y];
          });
        });
        for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(g.H - 1, Math.floor(y1)); y++) {
          for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(g.W - 1, Math.floor(x1)); x++) {
            if (dentroDe(anillos, x + 0.5, y + 0.5)) alCelda(y * g.W + x, k, f);
          }
        }
      });
    });
  }

  /* Distancia (m) de cada celda a la celda marcada más cercana: chaflán de
     dos pasadas con el tamaño real de la celda; 0 en las marcadas. */
  function distancia(marca, g) {
    const W = g.W, H = g.H, d = new Float32Array(g.N).fill(Infinity);
    const a = g.dx, b = g.dy, c = Math.sqrt(a * a + b * b);
    for (let i = 0; i < g.N; i++) if (marca[i]) d[i] = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + a);
        if (y > 0) {
          v = Math.min(v, d[i - W] + b);
          if (x > 0) v = Math.min(v, d[i - W - 1] + c);
          if (x < W - 1) v = Math.min(v, d[i - W + 1] + c);
        }
        d[i] = v;
      }
    }
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        let v = d[i];
        if (x < W - 1) v = Math.min(v, d[i + 1] + a);
        if (y < H - 1) {
          v = Math.min(v, d[i + W] + b);
          if (x < W - 1) v = Math.min(v, d[i + W + 1] + c);
          if (x > 0) v = Math.min(v, d[i + W - 1] + c);
        }
        d[i] = v;
      }
    }
    return d;
  }

  /* Lo que ya pasa: cada parque de 1 ha o más (sin los de solo pasto)
     contra su propio entorno urbano de 100 a 500 m, sin otras áreas verdes.
     celdasDe: Map índice de área -> celdas; areas: sus features. */
  function perfilPorParque(t, areas, celdasDe, g, urbano, verde) {
    const medidos = [];
    areas.forEach(function (f, k) {
      const p = f.properties || {};
      if (p.solo_pasto || (p.area_m2 || 0) < PARQUE_MINIMO) return;
      const celdas = (celdasDe.get(k) || []).filter(function (i) { return t[i] === t[i]; });
      if (celdas.length < 2) return;
      const marca = new Uint8Array(g.N);
      celdas.forEach(function (i) { marca[i] = 1; });
      const d = distancia(marca, g);
      let s = 0, n = 0;
      for (let i = 0; i < g.N; i++) {
        if (d[i] > ENTORNO[0] && d[i] <= ENTORNO[1] && urbano[i] && !verde[i] && t[i] === t[i]) { s += t[i]; n++; }
      }
      if (n < 10) return;
      const dentro = celdas.reduce(function (a, i) { return a + t[i]; }, 0) / celdas.length;
      medidos.push({ nombre: p.nombre || (p.tipo === 'parque' ? 'Parque sin nombre' : 'Plaza sin nombre'),
                     ha: p.area_m2 / 10000, celdas: celdas.length, isla: s / n - dentro });
    });
    const celdas = medidos.reduce(function (a, m) { return a + m.celdas; }, 0);
    const intensidad = celdas ? medidos.reduce(function (a, m) { return a + m.isla * m.celdas; }, 0) / celdas : NaN;
    // El parque "típico" de la medición: la mediana del área, contando cada celda.
    const areasPorCelda = [];
    medidos.forEach(function (m) { for (let j = 0; j < m.celdas; j++) areasPorCelda.push(m.ha * 10000); });
    areasPorCelda.sort(function (a, b) { return a - b; });
    const valido = medidos.length >= 4 && intensidad > 0.1;
    medidos.sort(function (a, b) { return b.ha - a.ha; });
    return {
      parques: medidos, intensidadMedida: intensidad, valido: valido,
      intensidad: valido ? intensidad : INTENSIDAD_RESPALDO,
      areaTipica: areasPorCelda.length ? areasPorCelda[Math.floor(areasPorCelda.length / 2)] : 30000,
      masFrescos: medidos.filter(function (m) { return m.isla > 0; }).length,
    };
  }

  /* Intensidad de un parque nuevo (°C de enfriamiento dentro de él). */
  function intensidad(base, areaM2, tipo, areaTipica) {
    const tam = Math.max(0.4, Math.min(1.6, 1 + 0.3 * Math.log(areaM2 / Math.max(500, areaTipica || 10000))));
    return base * tam * (TIPOS[tipo] || TIPOS.mixto).factor;
  }

  /* Ancho del parque como distancia de enfriamiento, entre 60 y 400 m. */
  function alcance(areaM2) { return Math.max(60, Math.min(400, Math.sqrt(areaM2))); }

  /* Enfriamiento (°C, negativo) de cada celda con los parques dados.
     parque: { x, y (en celdas), area (m²), tipo, intensidad } */
  function efecto(parques, g) {
    const de = new Float32Array(g.N);
    parques.forEach(function (p) {
      const R = Math.sqrt(p.area / Math.PI), L = alcance(p.area);
      const alc = R + L * 1.5;
      const x0 = Math.max(0, Math.floor(p.x - alc / g.dx)), x1 = Math.min(g.W - 1, Math.ceil(p.x + alc / g.dx));
      const y0 = Math.max(0, Math.floor(p.y - alc / g.dy)), y1 = Math.min(g.H - 1, Math.ceil(p.y + alc / g.dy));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dm = Math.hypot((x + 0.5 - p.x) * g.dx, (y + 0.5 - p.y) * g.dy);
          const borde = dm - R;
          const v = borde <= 0 ? -p.intensidad : -p.intensidad * Math.exp(-3 * borde / L);
          const i = y * g.W + x;
          if (v < de[i]) de[i] = v;
        }
      }
    });
    return de;
  }

  /* Cifras de un escenario. ctx: { t, g, urbano, pob (personas por celda),
     distPlaza (m a la plaza o parque existente más cercano), zonas (índice
     de zona censal por celda, 1..n), zonasInfo [{personas, area}] } */
  function resumir(parques, de, ctx) {
    const g = ctx.g, t = ctx.t;
    let antes = 0, despues = 0, n = 0, haFresca = 0, personasFresca = 0, ganan = 0;
    const ultimo = parques[parques.length - 1];
    const R = ultimo ? Math.sqrt(ultimo.area / Math.PI) : 0;
    for (let i = 0; i < g.N; i++) {
      const v = t[i];
      if (v !== v) continue;
      if (de[i] <= -UMBRAL_FRESCO) {
        haFresca += g.haCelda;
        if (ctx.pob) personasFresca += ctx.pob[i];
      }
      if (ultimo) {
        const x = i % g.W + 0.5, y = Math.floor(i / g.W) + 0.5;
        const dm = Math.hypot((x - ultimo.x) * g.dx, (y - ultimo.y) * g.dy);
        if (dm <= Math.max(R, 0.6 * Math.max(g.dx, g.dy))) { antes += v; despues += v + de[i]; n++; }
      }
    }
    // Quién gana una plaza a 400 m: vive a más de 400 m de cualquiera y a
    // menos de 400 m del borde de alguno de los parques nuevos.
    if (ctx.pob && ctx.distPlaza) {
      for (let i = 0; i < g.N; i++) {
        const p = ctx.pob[i];
        if (!p || ctx.distPlaza[i] <= 400) continue;
        const x = i % g.W + 0.5, y = Math.floor(i / g.W) + 0.5;
        for (let k = 0; k < parques.length; k++) {
          const q = parques[k];
          const borde = Math.hypot((x - q.x) * g.dx, (y - q.y) * g.dy) - Math.sqrt(q.area / Math.PI);
          if (borde <= 400) { ganan += p; break; }
        }
      }
    }
    // La zona censal del último parque: su área verde por habitante.
    let zona = null;
    if (ultimo && ctx.zonas && ctx.zonasInfo) {
      const i = Math.floor(ultimo.y) * g.W + Math.floor(ultimo.x);
      const z = ctx.zonas[i];
      if (z) {
        const info = ctx.zonasInfo[z - 1];
        const agregada = parques.filter(function (q) {
          const j = Math.floor(q.y) * g.W + Math.floor(q.x);
          return ctx.zonas[j] === z;
        }).reduce(function (s, q) { return s + q.area; }, 0);
        if (info && info.personas > 0) {
          zona = { nombre: info.nombre, personas: info.personas,
                   antes: info.area / info.personas, despues: (info.area + agregada) / info.personas };
        }
      }
    }
    return {
      parque: ultimo ? { antes: n ? antes / n : NaN, despues: n ? despues / n : NaN,
                         a100: -ultimo.intensidad * Math.exp(-3 * 100 / alcance(ultimo.area)),
                         a200: -ultimo.intensidad * Math.exp(-3 * 200 / alcance(ultimo.area)),
                         alcance: alcance(ultimo.area) } : null,
      haFresca: haFresca, personasFresca: personasFresca, gananPlaza: ganan, zona: zona,
    };
  }

  return {
    TIPOS: TIPOS, UMBRAL_FRESCO: UMBRAL_FRESCO, INTENSIDAD_RESPALDO: INTENSIDAD_RESPALDO, ENTORNO: ENTORNO,
    grilla: grilla, temperaturas: temperaturas, dentroDe: dentroDe, rasterizar: rasterizar,
    distancia: distancia, perfilPorParque: perfilPorParque, intensidad: intensidad, alcance: alcance,
    efecto: efecto, resumir: resumir,
  };
})();

if (typeof module !== 'undefined') module.exports = GTSimCalor;
