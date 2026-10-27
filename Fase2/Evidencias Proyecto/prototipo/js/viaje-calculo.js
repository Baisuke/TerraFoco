/* ==========================================================================
   TerraFoco — Cuánto combustible gasta un viaje (el modelo)

   Una visita a terreno no cuesta lo mismo por la Ruta 5 que por un camino
   de ripio en la precordillera, aunque los kilómetros sean los mismos. Este
   módulo estima los litros de un recorrido a partir de lo que de verdad
   los gasta: rodar, empujar el aire, subir, frenar y volver a acelerar, y
   mantener el motor encendido.

   El cálculo es físico y va tramo a tramo, cada 30 m, que es cada cuánto
   viene la altura del camino:

     fuerza en las ruedas = rodadura + aire + pendiente
       rodadura  = m·g·Crr·cos θ     Crr sube con la superficie: el ripio
                                     cuesta el doble que el asfalto
       aire      = ½·ρ·CdA·v²        ρ baja con la altura
       pendiente = m·g·sen θ         negativa en bajada
     trabajo del motor = fuerza·distancia / ηtransmisión
                         + pérdidas internas y accesorios · tiempo
     litros = trabajo / ηmotor / energía de un litro

   En bajada el trabajo puede salir negativo: el motor corta la inyección y
   no gasta, pero tampoco recupera. Cada detención (cruces, semáforos,
   curvas cerradas) obliga a volver a acelerar el auto y deja el motor en
   ralentí unos segundos; cuántas hay por kilómetro depende del tipo de
   camino y de cuán urbana es la zona.

   La escala la pone el rendimiento del vehículo, "tomando un promedio": el
   modelo se calibra para que en un ciclo mixto plano (ciudad, camino y
   carretera) dé exactamente el rendimiento elegido. La física reparte el
   gasto entre los tramos; el rendimiento promedio fija cuánto es en total.
   Así una subida larga o un tramo de ripio pesan lo que deben, y un
   vehículo conocido rinde lo que su dueño sabe que rinde.

   Sin DOM y sin red: lo usan viajes.js y se puede probar con node.
   ========================================================================== */

const GTViaje = (function () {
  'use strict';

  const G = 9.81;
  const PASO = 30;            // m, la resolución del perfil de alturas
  const ETA_TRANSMISION = 0.9;
  const CRR_ASFALTO = 0.011;  // neumático de auto sobre asfalto liso
  const ESPERA_DETENCION = 10; // s en ralentí por detención, en promedio
  const MASA_PASAJERO = 75;    // kg

  /* Motor: qué parte de la energía del combustible llega al cigüeñal en uso
     real (a carga parcial, no en su mejor punto), las pérdidas internas que
     se pagan solo por girar —crecen con el tamaño del vehículo— y el gasto
     en ralentí. El diésel convierte mejor la energía y cada litro trae más.
     Con estos valores la calibración de los vehículos de la lista queda
     entre 1,0 y 1,15: la física sola ya explica casi todo el rendimiento. */
  const MOTORES = {
    bencina: { eta: 0.28, perdidaW: function (m) { return 1800 + 1.5 * m; },
               ralentiLh: function (m) { return 0.5 + 0.0003 * m; } },
    diesel:  { eta: 0.33, perdidaW: function (m) { return 2200 + 1.6 * m; },
               ralentiLh: function (m) { return 0.4 + 0.00025 * m; } },
  };

  /* Precios de referencia en pesos por litro: se editan en la pantalla con
     los de la bencinera (bencinaenlinea.cl). CO₂ por litro quemado. */
  const COMBUSTIBLES = {
    b93:    { nombre: 'Bencina 93', motor: 'bencina', mj: 32.0, co2: 2.31, precio: 1290 },
    b95:    { nombre: 'Bencina 95', motor: 'bencina', mj: 32.0, co2: 2.31, precio: 1340 },
    b97:    { nombre: 'Bencina 97', motor: 'bencina', mj: 32.0, co2: 2.31, precio: 1400 },
    diesel: { nombre: 'Diésel',     motor: 'diesel',  mj: 35.9, co2: 2.68, precio: 1010 },
  };

  /* Rendimiento mixto REAL típico (km/L), no el de la etiqueta, que se mide
     en laboratorio y suele quedar 15 a 25 % arriba. Masa en orden de marcha,
     sin ocupantes. CdA: área frontal por coeficiente aerodinámico. */
  const VEHICULOS = [
    { id: 'pequeno', nombre: 'Auto pequeño', masa: 1000, cda: 0.62, rendimiento: 15,
      motor: 'bencina', estanque: 37 },
    { id: 'sedan', nombre: 'Sedán', masa: 1300, cda: 0.64, rendimiento: 13,
      motor: 'bencina', estanque: 50 },
    { id: 'suv', nombre: 'SUV', masa: 1550, cda: 0.92, rendimiento: 10.5,
      motor: 'bencina', estanque: 55 },
    { id: 'camioneta', nombre: 'Camioneta doble cabina (bencina)', masa: 1800, cda: 1.10,
      rendimiento: 8.5, motor: 'bencina', estanque: 75 },
    { id: 'camionetaDiesel', nombre: 'Camioneta 4x4 (diésel)', masa: 2050, cda: 1.15,
      rendimiento: 10.5, motor: 'diesel', estanque: 80 },
    { id: 'furgon', nombre: 'Furgón de pasajeros (diésel)', masa: 2150, cda: 1.30,
      rendimiento: 9.5, motor: 'diesel', estanque: 75 },
  ];

  /* Tipos de camino que se muestran. La clase de OpenStreetMap se agrupa
     así; cualquier tramo sin pavimento es "ripio o tierra", sea cual sea su
     clase, porque es lo que más cambia el gasto. */
  const TIPOS = {
    autopista: 'Autopista',
    ruta:      'Ruta principal',
    local:     'Camino secundario',
    urbano:    'Calle urbana',
    ripio:     'Ripio o tierra',
  };

  /* Resistencia a la rodadura relativa al asfalto liso, por superficie. */
  const SUPERFICIE = {
    paved_smooth: 1.0, paved: 1.12, paved_rough: 1.35, compacted: 1.7,
    gravel: 2.3, dirt: 2.8, path: 3.5, impassable: 4.0,
  };

  /* Detenciones por kilómetro según la clase del camino; se suman más en
     zonas densas (Valhalla da la densidad de 0 a 15). */
  const DETENCIONES_KM = {
    motorway: 0, trunk: 0.05, primary: 0.25, secondary: 0.3, tertiary: 0.35,
    unclassified: 0.2, residential: 1.2, service_other: 1.5,
  };

  function tipoDe(clase, sinPavimento, densidad) {
    if (sinPavimento) return 'ripio';
    if (clase === 'motorway') return 'autopista';
    if (clase === 'residential' || clase === 'service_other' || densidad >= 9) return 'urbano';
    if (clase === 'trunk' || clase === 'primary') return 'ruta';
    return 'local';
  }

  /* ------------------------------------------------------------------------
     Geometría
     ------------------------------------------------------------------------ */

  function distancia(a, b) {   // [lon, lat] -> m
    const r = Math.PI / 180;
    const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 +
              Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function rumbo(a, b) {      // grados desde el norte, en sentido horario
    const r = Math.PI / 180;
    const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
    const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) -
              Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  /* Polilínea codificada de Valhalla (precisión 6) -> [[lon, lat], ...] */
  function decodificar(texto, precision) {
    const f = Math.pow(10, precision || 6);
    const puntos = [];
    let i = 0, lat = 0, lon = 0;
    while (i < texto.length) {
      for (let k = 0; k < 2; k++) {
        let b, desplazamiento = 0, resultado = 0;
        do {
          b = texto.charCodeAt(i++) - 63;
          resultado |= (b & 0x1f) << desplazamiento;
          desplazamiento += 5;
        } while (b >= 0x20);
        const d = (resultado & 1) ? ~(resultado >> 1) : (resultado >> 1);
        if (k === 0) lat += d; else lon += d;
      }
      puntos.push([lon / f, lat / f]);
    }
    return puntos;
  }

  function acumulada(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distancia(coords[i - 1], coords[i]));
    return cum;
  }

  /* El punto a `d` metros del inicio, y el índice del vértice anterior. */
  function puntoEn(coords, cum, d) {
    if (d <= 0) return { p: coords[0], i: 0 };
    const n = cum.length - 1;
    if (d >= cum[n]) return { p: coords[n], i: n - 1 };
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
    const t = (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
    const a = coords[lo], b = coords[hi];
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], i: lo };
  }

  /* Media móvil de 5 muestras (150 m): el modelo de elevación trae saltos de
     un par de metros —puentes, cortes— que, leídos como pendiente, inventan
     subidas que nadie sube. */
  function suavizar(h) {
    return h.map(function (_, i) {
      let s = 0, n = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(h.length - 1, i + 2); k++) { s += h[k]; n++; }
      return s / n;
    });
  }

  /* ------------------------------------------------------------------------
     Perfil: el recorrido cortado en piezas de 30 m, cada una con lo que el
     modelo necesita. `atributos(d)` dice qué camino hay a d metros.
     ------------------------------------------------------------------------ */

  function armarPerfil(coords, alturas, atributos, fuente) {
    const cum = acumulada(coords);
    const largo = cum[cum.length - 1];
    const n = Math.max(1, Math.ceil(largo / PASO));
    const paso = largo / n;
    /* Las alturas vienen cada 30 m del largo que midió el servicio; se
       reparten sobre el largo medido aquí. */
    const h = alturas && alturas.length > 1 ? suavizar(alturas) : null;
    const alturaEn = function (d) {
      if (!h) return 0;
      const x = (d / largo) * (h.length - 1);
      const i = Math.min(h.length - 2, Math.floor(x));
      return h[i] + (h[i + 1] - h[i]) * (x - i);
    };

    const piezas = [];
    for (let k = 0; k < n; k++) {
      const desde = k * paso, hasta = (k + 1) * paso;
      const a = atributos((desde + hasta) / 2);
      const h0 = alturaEn(desde), h1 = alturaEn(hasta);
      const s = Math.max(-0.25, Math.min(0.25, (h1 - h0) / paso));
      piezas.push({
        desde: desde, hasta: hasta, d: paso,
        v: Math.max(5, a.velocidad) / 3.6,
        s: s, h: (h0 + h1) / 2,
        tipo: tipoDe(a.clase, a.sinPavimento, a.densidad || 0),
        crr: SUPERFICIE[a.superficie] || (a.sinPavimento ? SUPERFICIE.gravel : 1),
        detencionesKm: (DETENCIONES_KM[a.clase] !== undefined ? DETENCIONES_KM[a.clase] : 0.3) +
                       (a.clase === 'motorway' ? 0 : 0.06 * (a.densidad || 0)) +
                       (a.sinPavimento ? 0.2 : 0),
        nombre: a.nombre || '', peaje: !!a.peaje,
      });
    }
    return { coords: coords, cum: cum, largo: largo, piezas: piezas, fuente: fuente,
             conPendiente: !!h };
  }

  /* Valhalla: la ruta trae la forma y la altura cada 30 m; trace_attributes,
     la clase, la superficie, la velocidad y la densidad de cada arco. */
  function perfilDesdeValhalla(ruta, rastro) {
    const tramo = ruta.trip.legs[0];
    const coords = decodificar(tramo.shape, 6);
    const cum = acumulada(coords);
    const arcos = (rastro && rastro.edges) || [];
    // Cada arco cubre de su primer a su último vértice: se pasa a metros.
    const limites = arcos.map(function (e) {
      return cum[Math.min(cum.length - 1, e.end_shape_index)];
    });
    const atributos = function (d) {
      let lo = 0, hi = limites.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (limites[m] < d) lo = m + 1; else hi = m; }
      const e = arcos[lo] || {};
      return {
        clase: e.road_class || 'secondary', superficie: e.surface,
        sinPavimento: !!e.unpaved, velocidad: e.speed || 50, densidad: e.density,
        nombre: (e.names && e.names[0]) || '', peaje: e.toll,
      };
    };
    return armarPerfil(coords, tramo.elevation, atributos, 'valhalla');
  }

  /* OSRM, el respaldo: no da clase ni superficie. La clase se deduce de la
     velocidad del tramo y la superficie se supone pavimentada; la altura la
     pone la página desde un modelo de elevación, si lo consigue. */
  function perfilDesdeOsrm(ruta, alturas) {
    const r = ruta.routes[0];
    const coords = r.geometry.coordinates;
    const cum = acumulada(coords);
    const vel = (r.legs[0].annotation && r.legs[0].annotation.speed) || [];
    const atributos = function (d) {
      const i = puntoEn(coords, cum, d).i;
      const kmh = (vel[i] || 14) * 3.6;
      const clase = kmh >= 95 ? 'motorway' : kmh >= 70 ? 'primary' : kmh >= 42 ? 'secondary' : 'residential';
      return { clase: clase, superficie: 'paved_smooth', velocidad: kmh,
               densidad: clase === 'residential' ? 8 : 0 };
    };
    const p = armarPerfil(coords, alturas, atributos, 'osrm');
    return p;
  }

  /* Sin red vial: línea recta alargada un 35 %, que es lo que se desvía en
     promedio un camino rural de la recta, a 60 km/h. Solo para no dejar la
     pantalla en blanco; la página lo advierte. */
  function perfilRecto(a, b) {
    const largo = distancia(a, b) * 1.35;
    const coords = [a, b];
    const p = armarPerfil(coords, null, function () {
      return { clase: 'secondary', superficie: 'paved', velocidad: 60, densidad: 2 };
    }, 'recta');
    const factor = largo / p.largo;
    p.piezas.forEach(function (x) { x.d *= factor; x.desde *= factor; x.hasta *= factor; });
    p.largoReal = largo;
    return p;
  }

  /* La vuelta por el mismo camino: las subidas pasan a ser bajadas. */
  function invertir(perfil) {
    const L = perfil.piezas.length ? perfil.piezas[perfil.piezas.length - 1].hasta : 0;
    const piezas = perfil.piezas.slice().reverse().map(function (x) {
      return Object.assign({}, x, { s: -x.s, desde: L - x.hasta, hasta: L - x.desde });
    });
    const coords = perfil.coords.slice().reverse();
    return Object.assign({}, perfil, { coords: coords, cum: acumulada(coords), piezas: piezas });
  }

  /* ------------------------------------------------------------------------
     El cálculo
     ------------------------------------------------------------------------ */

  /* Trabajo del motor en una pieza, en joules, separado por causa.
     `aux`: potencia de accesorios (aire acondicionado) en W. */
  function trabajo(p, m, veh, motor, aux) {
    const raiz = Math.sqrt(1 + p.s * p.s);
    const rho = 1.225 * Math.exp(-p.h / 8434);
    const t = p.d / p.v;
    const c = {
      rodadura: m * G * CRR_ASFALTO * p.crr / raiz * p.d / ETA_TRANSMISION,
      aire: 0.5 * rho * veh.cda * p.v * p.v * p.d / ETA_TRANSMISION,
      pendiente: m * G * p.s / raiz * p.d / ETA_TRANSMISION,
      motor: (motor.perdidaW(veh.masa) + aux) * t,
      detenciones: 0,
    };
    const suma = c.rodadura + c.aire + c.pendiente + c.motor;
    /* Bajada que se paga sola: inyección cortada. Lo que la pendiente "regala"
       de más se pierde en los frenos. */
    if (suma < 0) c.pendiente -= suma;
    // Volver a acelerar después de cada detención (inercia de ruedas: +5 %).
    const n = p.detencionesKm * p.d / 1000;
    c.detenciones = n * 0.5 * 1.05 * m * p.v * p.v / ETA_TRANSMISION;
    return { c: c, t: t, n: n };
  }

  /* Ciclo mixto plano de referencia, con el que se calibra: 35 % ciudad a
     30 km/h, 35 % camino a 70 km/h y 30 % carretera a 100 km/h. */
  const CICLO = [
    { d: 3500, v: 30 / 3.6, s: 0, h: 300, crr: 1, detencionesKm: 1.5 },
    { d: 3500, v: 70 / 3.6, s: 0, h: 300, crr: 1, detencionesKm: 0.3 },
    { d: 3000, v: 100 / 3.6, s: 0, h: 300, crr: 1, detencionesKm: 0 },
  ];

  function litrosCrudos(piezas, veh, comb, extraKg, aux) {
    const motor = MOTORES[veh.motor];
    const m = veh.masa + extraKg;
    const desglose = { rodadura: 0, aire: 0, pendiente: 0, motor: 0, detenciones: 0 };
    const porPieza = [];
    const jPorLitro = comb.mj * 1e6 * motor.eta;
    const ralentiLs = motor.ralentiLh(veh.masa) / 3600;
    let segundos = 0;
    piezas.forEach(function (p) {
      const r = trabajo(p, m, veh, motor, aux);
      let l = 0;
      Object.keys(r.c).forEach(function (k) {
        const lk = r.c[k] / jPorLitro;
        desglose[k] += lk; l += lk;
      });
      const espera = r.n * ESPERA_DETENCION;
      desglose.detenciones += espera * ralentiLs;
      l += espera * ralentiLs;
      segundos += r.t + espera;
      porPieza.push({ l: l, t: r.t + espera });
    });
    const total = porPieza.reduce(function (s, x) { return s + x.l; }, 0);
    return { total: total, desglose: desglose, porPieza: porPieza, segundos: segundos };
  }

  /* Factor que lleva el modelo al rendimiento elegido (km/L). */
  function calibracion(veh, comb, rendimiento) {
    const ref = litrosCrudos(CICLO, veh, comb, MASA_PASAJERO, 0);
    const km = CICLO.reduce(function (s, p) { return s + p.d; }, 0) / 1000;
    return (km / rendimiento) / ref.total;
  }

  /* opciones: { vehiculo, combustible, rendimiento, precio, ocupantes,
                 cargaKg, aire } */
  function calcular(perfil, o) {
    const veh = o.vehiculo, comb = o.combustible;
    const extra = (o.ocupantes || 1) * MASA_PASAJERO + (o.cargaKg || 0);
    const k = calibracion(veh, comb, o.rendimiento || veh.rendimiento);
    const r = litrosCrudos(perfil.piezas, veh, comb, extra, o.aire ? 1200 : 0);

    const porTipo = {};
    Object.keys(TIPOS).forEach(function (t) { porTipo[t] = { m: 0, litros: 0 }; });
    let subida = 0, bajada = 0, peajeM = 0, lAcum = 0, tAcum = 0;
    const acum = [];
    perfil.piezas.forEach(function (p, i) {
      const x = r.porPieza[i];
      porTipo[p.tipo].m += p.d;
      porTipo[p.tipo].litros += x.l * k;
      const dh = p.s * p.d;
      if (dh > 0) subida += dh; else bajada -= dh;
      if (p.peaje) peajeM += p.d;
      lAcum += x.l * k; tAcum += x.t;
      acum.push({ l: lAcum, t: tAcum, intensidad: 100 * x.l * k / (p.d / 1000) });
    });

    const metros = perfil.piezas.reduce(function (s, p) { return s + p.d; }, 0);
    const litros = r.total * k;
    const desglose = {};
    Object.keys(r.desglose).forEach(function (c) { desglose[c] = r.desglose[c] * k; });
    return {
      litros: litros,
      costo: litros * (o.precio || comb.precio),
      km: metros / 1000,
      segundos: r.segundos,
      rendimiento: litros > 0 ? (metros / 1000) / litros : null,
      co2: litros * comb.co2,
      desglose: desglose, porTipo: porTipo,
      subida: subida, bajada: bajada, peajeKm: peajeM / 1000,
      estanque: litros / veh.estanque,
      acum: acum, calibracion: k,
    };
  }

  const api = {
    VEHICULOS: VEHICULOS, COMBUSTIBLES: COMBUSTIBLES, TIPOS: TIPOS, PASO: PASO,
    perfilDesdeValhalla: perfilDesdeValhalla, perfilDesdeOsrm: perfilDesdeOsrm,
    perfilRecto: perfilRecto, invertir: invertir, calcular: calcular,
    calibracion: calibracion, decodificar: decodificar, distancia: distancia,
    rumbo: rumbo, puntoEn: puntoEn, acumulada: acumulada,
  };
  return api;
})();

// Para probar el modelo fuera del navegador: node -e "require('./viaje-calculo.js')"
if (typeof module !== 'undefined' && module.exports) module.exports = GTViaje;
