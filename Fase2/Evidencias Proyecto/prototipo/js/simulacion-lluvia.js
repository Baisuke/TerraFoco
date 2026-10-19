/* ==========================================================================
   TerraFoco — Simulación de lluvia: las cuentas

   Responde, para la comuna abierta: con ESTA lluvia —cuánta, en cuánto
   tiempo, sobre un suelo seco o saturado—, ¿cuánto terreno se anega, hora a
   hora, y qué queda bajo el agua?

   Es un modelo de ESCENARIO, no un modelo hidráulico: no calcula caudales
   ni velocidades, ni la crecida de un río que viene de la cordillera. Junta
   tres piezas conocidas y citables, y cada supuesto se declara:

   1. CUÁNTA LLUVIA ESCURRE. Método del Número de Curva (USDA-NRCS, 1986,
      TR-55). Cada celda de 30 m tiene un número de curva según lo que la
      cubre —cultivo y pradera de ESA WorldCover, zona poblada del Censo,
      vegetación del NDVI— y el grupo hidrológico del suelo. Se corrige por
      la humedad previa (condiciones I, II y III; Chow, Maidment y Mays,
      1988) y por la pendiente (Williams, 1995, la corrección de SWAT).
          S = 25400 / CN − 254        (mm)
          Q = (P − 0,2·S)² / (P + 0,8·S)   si P > 0,2·S

   2. CUÁNTA SE QUEDA. Lo que escurre entra a la red de drenaje, que lo
      evacúa como un embalse lineal (Nash, 1957): sale en cada hora una
      fracción de lo retenido, con una constante de vaciado k. Una lluvia
      corta e intensa deja más agua retenida a la vez que la misma lluvia
      repartida en días: así entra la intensidad, que el número de curva
      no ve.

   3. DÓNDE SE JUNTA. El volumen retenido cubre primero las celdas que el
      índice de susceptibilidad calibrado marca como más altas —las que
      concentran el agua: fondos de valle, zonas cóncavas, mucha
      acumulación de flujo— con una lámina media d. Es el orden validado
      contra los eventos históricos; la lluvia decide hasta dónde llega.

   Todo se calcula de una vez al apretar "Simular" (hora a hora), y la
   página solo reproduce: así se puede ir y volver en el tiempo.
   ========================================================================== */

const GTSimLluvia = (function () {
  'use strict';

  /* Número de curva en condición de humedad II, por grupo hidrológico del
     suelo A, B, C y D. USDA-NRCS (1986), TR-55, tabla 2-2, condición
     hidrológica buena. */
  const CN = {
    cultivo:  [67, 78, 85, 89],   // cultivos en hilera
    pradera:  [39, 61, 74, 80],   // pradera o pastizal
    arbolado: [30, 55, 70, 77],   // bosque, frutal denso
    matorral: [30, 48, 65, 73],   // matorral
    urbano:   [77, 85, 90, 92],   // residencial denso (~65 % impermeable)
    desnudo:  [77, 86, 91, 94],   // suelo desnudo, barbecho
  };
  const GRUPOS = ['A', 'B', 'C', 'D'];
  /* Constante de vaciado de la red de drenaje (horas). */
  const DRENAJE = { rapido: 6, normal: 24, lento: 72 };
  /* Viviendas por celda de 30 m desde las que la celda cuenta como ciudad
     (Rancagua centro tiene ~4 por celda). */
  const VIVIENDAS_URBANO = 3;
  const HORAS_MAXIMAS = 240;

  /* ---------------------------------------------------------------------
     Número de curva
     --------------------------------------------------------------------- */

  /* Condición de humedad previa: I seco, II normal, III saturado. */
  function cnHumedad(cn2, humedad) {
    if (humedad === 'seco') return 4.2 * cn2 / (10 - 0.058 * cn2);
    if (humedad === 'saturado') return 23 * cn2 / (10 + 0.13 * cn2);
    return cn2;
  }

  /* Corrección por pendiente (Williams, 1995), con la pendiente en m/m:
     baja el número en lo plano (< 5 %) y lo sube en lo empinado. */
  function cnPendiente(cn2, pendiente) {
    const cn3 = 23 * cn2 / (10 + 0.13 * cn2);
    const cn = (cn3 - cn2) / 3 * (1 - 2 * Math.exp(-13.86 * pendiente)) + cn2;
    return Math.max(1, Math.min(99, cn));
  }

  /* Escorrentía acumulada (mm) para una lluvia acumulada P (mm). */
  function escorrentia(P, cn) {
    if (cn >= 99.5) return P;
    const S = 25400 / cn - 254, Ia = 0.2 * S;
    return P > Ia ? (P - Ia) * (P - Ia) / (P - Ia + S) : 0;
  }

  /* Valor original de una variable del índice desde su canal normalizado
     (0 sin dato; 1..255 = 0..1, ya volteada si es inversa). */
  function original(q, variable, pasos) {
    if (!q) return NaN;
    let n = (q - 1) / pasos;
    if (variable.sentido < 0) n = 1 - n;
    return variable.escala[0] + n * (variable.escala[1] - variable.escala[0]);
  }

  /* Número de curva de cada celda de la comuna.
     ctx: { N, dentro (Uint8Array: 1 dentro), grilla ({n: [6 x Uint8Array]}),
            variables (las de variables.json), pasos, agr ({cultivo, pradera}),
            pob ({viviendas}) }
     Lo que falte se reemplaza por una mezcla típica del valle y se avisa. */
  function numerosDeCurva(ctx, opciones) {
    const g = Math.max(0, GRUPOS.indexOf(opciones.suelo || 'B'));
    const humedad = opciones.humedad || 'normal';
    const N = ctx.N, cn = new Float32Array(N);
    const vars = ctx.variables || [];
    const kPend = vars.findIndex(function (v) { return v.clave === 'pendiente'; });
    const kNdvi = vars.findIndex(function (v) { return v.clave === 'cobertura'; });
    const conGrilla = !!(ctx.grilla && kPend >= 0 && kNdvi >= 0);
    const conAgr = !!ctx.agr, conPob = !!ctx.pob;
    // Mezcla típica para celdas sin dato: valle agrícola con algo de matorral.
    const tipico = 0.45 * CN.cultivo[g] + 0.35 * CN.pradera[g] + 0.2 * CN.matorral[g];
    const mezcla = { cultivo: 0, pradera: 0, urbano: 0, arbolado: 0, matorral: 0, desnudo: 0, sinDato: 0 };
    let celdas = 0;
    for (let i = 0; i < N; i++) {
      if (!ctx.dentro[i]) continue;
      celdas++;
      let c = 0, p = 0, u = 0, resto, cnResto;
      if (conAgr) {
        c = ctx.agr.cultivo[i] ? (ctx.agr.cultivo[i] - 1) / 100 : 0;
        p = ctx.agr.pradera[i] ? (ctx.agr.pradera[i] - 1) / 100 : 0;
      }
      if (conPob) u = Math.min(1, (ctx.pob.viviendas[i] || 0) / VIVIENDAS_URBANO);
      resto = Math.max(0, 1 - c - p);
      u = Math.min(u, resto);
      resto -= u;
      let ndvi = NaN, pend = NaN;
      if (conGrilla) {
        ndvi = original(ctx.grilla.n[kNdvi][i], vars[kNdvi], ctx.pasos);
        pend = original(ctx.grilla.n[kPend][i], vars[kPend], ctx.pasos);
      }
      let tipoResto;
      if (ndvi !== ndvi) tipoResto = null;
      else if (ndvi >= 0.45) tipoResto = 'arbolado';
      else if (ndvi >= 0.2) tipoResto = 'matorral';
      else tipoResto = 'desnudo';
      cnResto = tipoResto ? CN[tipoResto][g] : tipico;
      let v;
      if (!conAgr && !conPob && !tipoResto) {
        v = tipico;
        mezcla.sinDato++;
      } else {
        v = c * CN.cultivo[g] + p * CN.pradera[g] + u * CN.urbano[g] + resto * cnResto;
        mezcla.cultivo += c; mezcla.pradera += p; mezcla.urbano += u;
        if (tipoResto) mezcla[tipoResto] += resto; else mezcla.sinDato += resto;
      }
      if (pend === pend) v = cnPendiente(v, pend / 100);
      cn[i] = cnHumedad(v, humedad);
    }
    Object.keys(mezcla).forEach(function (k) { mezcla[k] = celdas ? mezcla[k] / celdas : 0; });
    return { cn: cn, celdas: celdas, mezcla: mezcla,
             completo: conAgr && conPob && conGrilla,
             falta: [conAgr ? null : 'cultivo y pradera', conPob ? null : 'población',
                     conGrilla ? null : 'pendiente y vegetación'].filter(Boolean) };
  }

  /* ---------------------------------------------------------------------
     La lluvia en el tiempo
     --------------------------------------------------------------------- */

  /* Lluvia de cada hora (mm), que suma `total`.
       pareja      la misma intensidad todo el tiempo
       chubascos   pulsos cada 6 horas, separados por ratos más débiles
       concentrada una tormenta: la mitad de la lluvia en un quinto del tiempo
       diaria      `diarios` (mm por día, p. ej. el pronóstico), repartidos
                   en las horas de cada día con un máximo en la tarde */
  function hietograma(total, horas, patron, diarios) {
    let w;
    if (patron === 'diaria' && diarios && diarios.length) {
      w = [];
      diarios.forEach(function (mm) {
        const dia = [];
        for (let h = 0; h < 24; h++) dia.push(1 + 0.6 * Math.sin(Math.PI * (h - 4) / 24) ** 2);
        const s = dia.reduce(function (a, b) { return a + b; }, 0);
        dia.forEach(function (x) { w.push(Math.max(0, mm) * x / s); });
      });
      // Se recorta el final seco: la simulación no espera días sin lluvia.
      while (w.length > 1 && w[w.length - 1] === 0) w.pop();
      return w;
    }
    horas = Math.max(1, Math.round(horas));
    w = new Array(horas);
    for (let t = 0; t < horas; t++) {
      const x = (t + 0.5) / horas;
      if (patron === 'chubascos') w[t] = 0.25 + Math.sin(Math.PI * (t + 0.5) / 6) ** 4;
      else if (patron === 'concentrada') w[t] = 0.08 + Math.exp(-0.5 * ((x - 0.4) / 0.085) ** 2);
      else w[t] = 1;
    }
    const s = w.reduce(function (a, b) { return a + b; }, 0);
    return w.map(function (x) { return total * x / s; });
  }

  /* ---------------------------------------------------------------------
     Dónde se junta el agua: las celdas en el orden del índice
     --------------------------------------------------------------------- */

  /* Celdas de la comuna de mayor a menor índice. Por conteo sobre el índice
     cuantizado en 65.536 niveles: lineal, aunque la comuna tenga millones
     de celdas (un sort con comparador tardaba segundos). */
  function ordenarCeldas(valores, dentro) {
    const NIV = 65536, N = valores.length;
    const nivel = new Uint16Array(N), cuenta = new Uint32Array(NIV + 1);
    let validas = 0;
    for (let i = 0; i < N; i++) {
      const v = valores[i];
      if (!dentro[i] || v !== v) continue;
      const q = NIV - 1 - Math.max(0, Math.min(NIV - 1, Math.floor(v * (NIV - 1))));
      nivel[i] = q;
      cuenta[q + 1]++;
      validas++;
    }
    for (let q = 0; q < NIV; q++) cuenta[q + 1] += cuenta[q];
    const orden = new Int32Array(validas);
    for (let i = 0; i < N; i++) {
      const v = valores[i];
      if (!dentro[i] || v !== v) continue;
      orden[cuenta[nivel[i]]++] = i;
    }
    return orden;
  }

  /* Suma lo expuesto en las primeras k celdas del orden, moviéndose de a
     poco: al reproducir, k cambia unas pocas celdas por cuadro. */
  function Acumulador(orden, capas, haCelda, zonas, nZonas, equipos) {
    this.orden = orden; this.capas = capas; this.ha = haCelda;
    this.zonas = zonas || null; this.nZonas = nZonas || 0; this.equipos = equipos || null;
    this.k = 0;
    this.suma = {};
    const self = this;
    Object.keys(capas).forEach(function (c) { self.suma[c] = 0; });
    this.porZona = new Float64Array(this.nZonas);
    this.dentroEquipos = new Set();
  }
  Acumulador.prototype._celda = function (i, signo) {
    const caps = this.capas, s = this.suma;
    for (const c in caps) s[c] += signo * caps[c](i);
    if (this.zonas) { const z = this.zonas[i]; if (z) this.porZona[z - 1] += signo; }
    if (this.equipos && this.equipos.has(i)) {
      const lista = this.equipos.get(i);
      for (let j = 0; j < lista.length; j++) {
        if (signo > 0) this.dentroEquipos.add(lista[j]); else this.dentroEquipos.delete(lista[j]);
      }
    }
  };
  Acumulador.prototype.mover = function (k) {
    k = Math.max(0, Math.min(this.orden.length, Math.round(k)));
    while (this.k < k) this._celda(this.orden[this.k++], 1);
    while (this.k > k) this._celda(this.orden[--this.k], -1);
    return this.estado();
  };
  Acumulador.prototype.estado = function () {
    const r = { celdas: this.k, ha: this.k * this.ha, zonas: this.porZona,
                equipos: Array.from(this.dentroEquipos) };
    for (const c in this.suma) r[c] = Math.max(0, this.suma[c]);
    return r;
  };

  /* ---------------------------------------------------------------------
     La simulación
     --------------------------------------------------------------------- */

  /* entrada:
       cn        Float32Array (numerosDeCurva().cn), con `dentro`
       dentro    Uint8Array
       haCelda   superficie de una celda (ha)
       celdasValidas  cuántas celdas pueden anegarse (las del orden)
       lluvia    mm por hora (hietograma)
       drenaje   'rapido' | 'normal' | 'lento' (o horas)
       lamina    lámina media de agua sobre lo anegado (m)
     Devuelve los pasos hora a hora. */
  function simular(entrada) {
    const cn = entrada.cn, dentro = entrada.dentro, N = cn.length;
    const areaCelda = entrada.haCelda * 10000;          // m²
    const lamina = Math.max(0.05, entrada.lamina || 0.5);
    const k = typeof entrada.drenaje === 'number' ? entrada.drenaje : (DRENAJE[entrada.drenaje] || DRENAJE.normal);
    const lluvia = entrada.lluvia;

    // Las celdas se agrupan por número de curva (medio punto): la lluvia es
    // la misma en toda la comuna, así que basta con sumar por grupo.
    const grupos = new Float64Array(201);
    let celdas = 0;
    for (let i = 0; i < N; i++) {
      if (!dentro[i]) continue;
      grupos[Math.max(0, Math.min(200, Math.round(cn[i] * 2)))]++;
      celdas++;
    }
    const usados = [];
    for (let b = 0; b < 201; b++) if (grupos[b]) usados.push(b);
    const areaTotal = celdas * areaCelda;
    function escorrentiaTotal(P) {           // m³ escurridos con P mm acumulados
      let v = 0;
      for (let j = 0; j < usados.length; j++) {
        const b = usados[j];
        v += grupos[b] * escorrentia(P, Math.max(1, b / 2));
      }
      return v / 1000 * areaCelda;
    }

    const pasos = [];
    const decae = Math.exp(-1 / k);
    let P = 0, Qprev = 0, W = 0, evacuada = 0, maximo = null;
    const horasLluvia = lluvia.length;
    for (let t = 0; t < HORAS_MAXIMAS; t++) {
      const mm = t < horasLluvia ? lluvia[t] : 0;
      P += mm;
      const Q = escorrentiaTotal(P);
      const entra = Math.max(0, Q - Qprev);     // m³ que escurren en esta hora
      Qprev = Q;
      // Embalse lineal con entrada constante durante la hora (solución exacta).
      const W1 = W * decae + entra * (1 - decae) * k;
      evacuada += W + entra - W1;
      W = W1;
      const anegadas = Math.min(entrada.celdasValidas || celdas, Math.floor(W / (lamina * areaCelda)));
      const paso = { hora: t + 1, lluvia: mm, acumulada: P, escurrida: Q,
                     escurridaMm: areaTotal ? Q / areaTotal * 1000 : 0,
                     retenida: W, evacuada: evacuada, celdas: anegadas };
      pasos.push(paso);
      if (!maximo || anegadas > maximo.celdas) maximo = paso;
      // Pasada la lluvia, se sigue hasta que el agua baja del 2 % del máximo.
      if (t >= horasLluvia && (!maximo.celdas || anegadas <= 0.02 * maximo.celdas) && t > horasLluvia + 2) break;
    }
    return { pasos: pasos, maximo: maximo, horasLluvia: horasLluvia, k: k, lamina: lamina,
             areaTotal: areaTotal, celdas: celdas, total: P,
             intensidadMaxima: lluvia.reduce(function (a, b) { return Math.max(a, b); }, 0) };
  }

  /* Profundidad estimada (m) de la celda en el lugar r del orden, con k
     celdas anegadas: más en las primeras (las más susceptibles), lámina
     media igual a `lamina`. */
  function profundidad(r, k, lamina) {
    return k > 0 ? 2 * lamina * (1 - (r + 0.5) / k) : 0;
  }

  return {
    CN: CN, GRUPOS: GRUPOS, DRENAJE: DRENAJE,
    cnHumedad: cnHumedad, cnPendiente: cnPendiente, escorrentia: escorrentia, original: original,
    numerosDeCurva: numerosDeCurva, hietograma: hietograma, ordenarCeldas: ordenarCeldas,
    Acumulador: Acumulador, simular: simular, profundidad: profundidad,
  };
})();

if (typeof module !== 'undefined') module.exports = GTSimLluvia;
