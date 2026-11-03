/* ==========================================================================
   TerraFoco — Cuánto combustible gasta un viaje (el modelo)

   Una visita a terreno no cuesta lo mismo por la Ruta 5 que por un camino
   de ripio en la precordillera, aunque los kilómetros sean los mismos. Este
   módulo estima el combustible de un recorrido a partir de lo que de verdad
   lo gasta: rodar, empujar el aire, subir, frenar y volver a acelerar, y
   mantener el motor encendido.

   El cálculo es físico y va tramo a tramo, cada 30 m, que es cada cuánto
   viene la altura del camino:

     fuerza en las ruedas = rodadura + aire + pendiente
       rodadura  = m·g·Crr·cos θ        Crr sube con la superficie: el ripio
                                        cuesta el doble que el asfalto
       aire      = ½·ρ·CdA·(v + vₓ)²    ρ baja con la altura y con el calor;
                                        vₓ es el viento de frente (o de cola)
       pendiente = m·g·sen θ            negativa en bajada
     trabajo del motor = fuerza·distancia / ηtransmisión
                         + pérdidas internas y accesorios · tiempo
     combustible = trabajo / ηmotor / energía de un litro (o de un kWh)

   En bajada el trabajo puede salir negativo. Un motor a combustión corta la
   inyección y no gasta, pero tampoco recupera; un híbrido o un eléctrico
   recuperan una parte en la batería. Cada detención (cruces, semáforos,
   curvas cerradas) obliga a volver a acelerar y deja el motor en ralentí
   unos segundos, salvo en los que se apagan solos.

   La escala la pone el rendimiento del vehículo, "tomando un promedio": el
   modelo se calibra para que en un ciclo mixto plano (ciudad, camino y
   carretera) dé exactamente el rendimiento elegido. La física reparte el
   gasto entre los tramos; el rendimiento promedio fija cuánto es en total.

   Sin DOM y sin red: lo usan viajes.js y viajes-extras.js, y se prueba con
   node. Los campos se llaman "litros" también en un eléctrico, donde son
   kWh: la unidad la dice el combustible.
   ========================================================================== */

const GTViaje = (function () {
  'use strict';

  const G = 9.81;
  const PASO = 30;             // m, la resolución del perfil de alturas
  const ETA_TRANSMISION = 0.9;
  const CRR_ASFALTO = 0.011;   // neumático de auto sobre asfalto liso
  const ESPERA_DETENCION = 10; // s en ralentí por detención, en promedio
  const MASA_PASAJERO = 75;    // kg
  /* El viento se mide a 10 m de altura; a la altura de un auto, en terreno
     abierto, es cerca del 70 % (perfil logarítmico del viento). */
  const VIENTO_A_RAS = 0.7;

  /* Motor: qué parte de la energía llega al eje en uso real (a carga parcial,
     no en su mejor punto), las pérdidas que se pagan solo por girar —crecen
     con el tamaño del vehículo—, el gasto en ralentí, qué fracción del
     frenado recupera y si se apaga solo en las detenciones. Con estos
     valores la calibración de los vehículos de la lista queda cerca de 1:
     la física sola ya explica casi todo el rendimiento. */
  const MOTORES = {
    bencina:   { eta: 0.28, perdidaW: function (m) { return 1800 + 1.5 * m; },
                 ralentiH: function (m) { return 0.5 + 0.0003 * m; }, regen: 0, apagaSolo: false },
    diesel:    { eta: 0.33, perdidaW: function (m) { return 2200 + 1.6 * m; },
                 ralentiH: function (m) { return 0.4 + 0.00025 * m; }, regen: 0, apagaSolo: false },
    /* El motor trabaja más cerca de su mejor punto, la batería recupera parte
       del frenado y en las detenciones el motor se apaga. */
    hibrido:   { eta: 0.35, perdidaW: function (m) { return 1100 + 0.9 * m; },
                 ralentiH: function () { return 0; }, regen: 0.35, apagaSolo: true },
    /* De la batería a la rueda se pierde poco, recupera buena parte del
       frenado y de las bajadas, y detenido no gasta. */
    electrico: { eta: 0.88, perdidaW: function (m) { return 250 + 0.15 * m; },
                 ralentiH: function () { return 0; }, regen: 0.6, apagaSolo: true },
  };

  /* Precios de referencia en pesos por unidad: se editan en la pantalla con
     los de la bencinera (bencinaenlinea.cl) o la tarifa eléctrica. CO₂ por
     unidad: en la electricidad, el factor de emisión del sistema eléctrico
     nacional (~0,27 kg/kWh, a la baja con la solar). */
  const COMBUSTIBLES = {
    b93:    { nombre: 'Bencina 93', tipo: 'bencina', mj: 32.0, co2: 2.31, precio: 1290, unidad: 'L' },
    b95:    { nombre: 'Bencina 95', tipo: 'bencina', mj: 32.0, co2: 2.31, precio: 1340, unidad: 'L' },
    b97:    { nombre: 'Bencina 97', tipo: 'bencina', mj: 32.0, co2: 2.31, precio: 1400, unidad: 'L' },
    diesel: { nombre: 'Diésel', tipo: 'diesel', mj: 35.9, co2: 2.68, precio: 1010, unidad: 'L' },
    kwh:    { nombre: 'Electricidad', tipo: 'electricidad', mj: 3.6, co2: 0.27, precio: 200, unidad: 'kWh' },
  };

  /* Qué combustibles carga cada motor. */
  const COMBUSTIBLE_DE_MOTOR = { bencina: 'bencina', hibrido: 'bencina', diesel: 'diesel', electrico: 'electricidad' };

  /* Rendimiento mixto REAL típico (km por litro, o por kWh), no el de la
     etiqueta, que se mide en laboratorio y suele quedar 15 a 25 % arriba.
     Masa en orden de marcha, sin ocupantes. CdA: área frontal por coeficiente
     aerodinámico. `estanque`: litros, o kWh de batería. `forma`: el dibujo
     del autito. */
  const VEHICULOS = [
    { id: 'pequeno', nombre: 'Auto pequeño', masa: 1000, cda: 0.62, rendimiento: 15,
      motor: 'bencina', estanque: 37, forma: 'auto' },
    { id: 'sedan', nombre: 'Sedán', masa: 1300, cda: 0.64, rendimiento: 13,
      motor: 'bencina', estanque: 50, forma: 'auto' },
    { id: 'hibrido', nombre: 'Auto híbrido', masa: 1400, cda: 0.60, rendimiento: 21,
      motor: 'hibrido', estanque: 43, forma: 'auto' },
    { id: 'electrico', nombre: 'Auto eléctrico', masa: 1750, cda: 0.60, rendimiento: 6.5,
      motor: 'electrico', estanque: 60, forma: 'electrico' },
    { id: 'suv', nombre: 'SUV', masa: 1550, cda: 0.92, rendimiento: 10.5,
      motor: 'bencina', estanque: 55, forma: 'suv' },
    { id: 'camioneta', nombre: 'Camioneta doble cabina (bencina)', masa: 1800, cda: 1.10,
      rendimiento: 8.5, motor: 'bencina', estanque: 75, forma: 'camioneta' },
    { id: 'camionetaDiesel', nombre: 'Camioneta 4x4 (diésel)', masa: 2050, cda: 1.15,
      rendimiento: 10.5, motor: 'diesel', estanque: 80, forma: 'camioneta' },
    { id: 'furgon', nombre: 'Furgón de pasajeros (diésel)', masa: 2150, cda: 1.30,
      rendimiento: 9.5, motor: 'diesel', estanque: 75, forma: 'furgon' },
  ];

  /* Estilo de manejo: cuánto más rápido va en carretera (sobre 50 km/h; en
     la ciudad manda el tráfico) y cuán fuerte acelera después de detenerse. */
  const ESTILOS = {
    suave:    { nombre: 'Suave', velocidad: 0.94, aceleracion: 0.75 },
    normal:   { nombre: 'Normal', velocidad: 1, aceleracion: 1 },
    agresivo: { nombre: 'Agresivo', velocidad: 1.06, aceleracion: 1.35 },
  };

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

  function vehiculo(id) {
    return VEHICULOS.find(function (v) { return v.id === id; }) || VEHICULOS[1];
  }

  function combustiblesDe(veh) {
    const tipo = COMBUSTIBLE_DE_MOTOR[veh.motor];
    return Object.keys(COMBUSTIBLES).filter(function (k) { return COMBUSTIBLES[k].tipo === tipo; });
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
    if (d >= cum[n]) return { p: coords[n], i: Math.max(0, n - 1) };
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

  function armarPerfil(coords, alturas, atributos, fuente, alargue) {
    const cum = acumulada(coords);
    const largo = cum[cum.length - 1];
    const n = Math.max(1, Math.ceil(largo / PASO));
    const paso = largo / n;
    const f = alargue || 1;   // la línea recta se alarga: el camino no es recto
    /* Las alturas vienen cada 30 m del largo que midió el servicio; se
       reparten sobre el largo medido aquí. */
    const h = alturas && alturas.length > 1 ? suavizar(alturas) : null;
    const alturaEn = function (d) {
      if (!h) return 0;
      const x = (d / (largo || 1)) * (h.length - 1);
      const i = Math.min(h.length - 2, Math.floor(x));
      return h[i] + (h[i + 1] - h[i]) * (x - i);
    };

    const piezas = [];
    for (let k = 0; k < n; k++) {
      const desde = k * paso, hasta = (k + 1) * paso;
      const a = atributos((desde + hasta) / 2);
      const h0 = alturaEn(desde), h1 = alturaEn(hasta);
      const s = Math.max(-0.25, Math.min(0.25, (h1 - h0) / (paso * f || 1)));
      piezas.push({
        desde: desde * f, hasta: hasta * f, d: paso * f,
        v: Math.max(5, a.velocidad) / 3.6,
        s: s, h: (h0 + h1) / 2,
        rumbo: rumbo(puntoEn(coords, cum, desde).p, puntoEn(coords, cum, hasta).p),
        tipo: tipoDe(a.clase, a.sinPavimento, a.densidad || 0),
        crr: SUPERFICIE[a.superficie] || (a.sinPavimento ? SUPERFICIE.gravel : 1),
        detencionesKm: (DETENCIONES_KM[a.clase] !== undefined ? DETENCIONES_KM[a.clase] : 0.3) +
                       (a.clase === 'motorway' ? 0 : 0.06 * (a.densidad || 0)) +
                       (a.sinPavimento ? 0.2 : 0),
        nombre: a.nombre || '', peaje: !!a.peaje, tramo: 0,
      });
    }
    return { coords: coords, cum: cum, largo: largo, piezas: piezas, fuente: fuente,
             conPendiente: !!h, tramos: 1, indicaciones: [] };
  }

  /* Junta los perfiles de cada tramo (A→B, B→C…) en uno solo. Las
     distancias de las piezas y de las indicaciones siguen corriendo. */
  function unirPerfiles(perfiles) {
    if (perfiles.length === 1) return perfiles[0];
    const coords = [], piezas = [], indicaciones = [];
    let desplazamiento = 0;
    perfiles.forEach(function (p, t) {
      p.coords.forEach(function (c, i) { if (i > 0 || !coords.length) coords.push(c); });
      p.piezas.forEach(function (x) {
        piezas.push(Object.assign({}, x, { desde: x.desde + desplazamiento,
                                          hasta: x.hasta + desplazamiento, tramo: t }));
      });
      p.indicaciones.forEach(function (x) {
        indicaciones.push(Object.assign({}, x, { d: x.d + desplazamiento, tramo: t }));
      });
      desplazamiento += p.piezas.length ? p.piezas[p.piezas.length - 1].hasta : 0;
    });
    const cum = acumulada(coords);
    return { coords: coords, cum: cum, largo: cum[cum.length - 1], piezas: piezas,
             fuente: perfiles[0].fuente, tramos: perfiles.length, indicaciones: indicaciones,
             conPendiente: perfiles.every(function (p) { return p.conPendiente; }) };
  }

  /* Valhalla: cada tramo trae su forma, su altura cada 30 m y sus
     indicaciones; trace_attributes, la clase, la superficie, la velocidad y
     la densidad de cada arco. `rastros[i]` es el del tramo i (o null). */
  function perfilDesdeValhalla(viaje, rastros) {
    return unirPerfiles(viaje.legs.map(function (tramo, t) {
      const coords = decodificar(tramo.shape, 6);
      const cum = acumulada(coords);
      const arcos = (rastros && rastros[t] && rastros[t].edges) || [];
      // Cada arco cubre hasta su último vértice: se pasa a metros.
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
      const p = armarPerfil(coords, tramo.elevation, atributos, 'valhalla');
      p.indicaciones = (tramo.maneuvers || []).map(function (m) {
        return { texto: m.instruction, tipo: m.type, largo: (m.length || 0) * 1000,
                 d: cum[Math.min(cum.length - 1, m.begin_shape_index || 0)],
                 p: coords[Math.min(coords.length - 1, m.begin_shape_index || 0)] };
      });
      return p;
    }));
  }

  /* OSRM, el respaldo: no da clase ni superficie. La clase se deduce de la
     velocidad del tramo y la superficie se supone pavimentada; la altura la
     pone la página desde un modelo de elevación, si lo consigue. */
  function perfilDesdeOsrm(ruta, alturas) {
    const r = ruta.routes[0];
    const coords = r.geometry.coordinates;
    const cum = acumulada(coords);
    const vel = [];
    r.legs.forEach(function (l) { (l.annotation && l.annotation.speed || []).forEach(function (v) { vel.push(v); }); });
    const atributos = function (d) {
      const i = puntoEn(coords, cum, d).i;
      const kmh = (vel[i] || 14) * 3.6;
      const clase = kmh >= 95 ? 'motorway' : kmh >= 70 ? 'primary' : kmh >= 42 ? 'secondary' : 'residential';
      return { clase: clase, superficie: 'paved_smooth', velocidad: kmh,
               densidad: clase === 'residential' ? 8 : 0 };
    };
    const p = armarPerfil(coords, alturas, atributos, 'osrm');
    // Tramo de cada pieza según dónde termina cada pierna de OSRM.
    let corte = 0;
    const cortes = r.legs.map(function (l) { corte += l.distance; return corte; });
    const escala = p.largo / (corte || p.largo);
    p.piezas.forEach(function (x) {
      let t = 0;
      while (t < cortes.length - 1 && x.desde >= cortes[t] * escala) t++;
      x.tramo = t;
    });
    p.tramos = r.legs.length;
    return p;
  }

  /* Sin red vial: línea recta alargada un 35 %, que es lo que se desvía en
     promedio un camino rural de la recta, a 60 km/h. Solo para no dejar la
     pantalla en blanco; la página lo advierte. */
  function perfilRecto(puntos) {
    const perfiles = [];
    for (let i = 1; i < puntos.length; i++) {
      perfiles.push(armarPerfil([puntos[i - 1], puntos[i]], null, function () {
        return { clase: 'secondary', superficie: 'paved', velocidad: 60, densidad: 2 };
      }, 'recta', 1.35));
    }
    return unirPerfiles(perfiles);
  }

  /* La vuelta por el mismo camino: las subidas pasan a ser bajadas y el
     viento que venía de frente, de cola. */
  function invertir(perfil) {
    const L = perfil.piezas.length ? perfil.piezas[perfil.piezas.length - 1].hasta : 0;
    const piezas = perfil.piezas.slice().reverse().map(function (x) {
      return Object.assign({}, x, { s: -x.s, desde: L - x.hasta, hasta: L - x.desde,
                                    rumbo: (x.rumbo + 180) % 360 });
    });
    const coords = perfil.coords.slice().reverse();
    return Object.assign({}, perfil, { coords: coords, cum: acumulada(coords), piezas: piezas,
                                       indicaciones: [] });
  }

  /* ------------------------------------------------------------------------
     El cálculo
     ------------------------------------------------------------------------ */

  /* Velocidad con que se recorre la pieza: la de la vía, corregida por el
     estilo en carretera y por el tope que el conductor se pone. */
  function velocidadEn(p, o) {
    let v = p.v;
    const e = ESTILOS[o.estilo] || ESTILOS.normal;
    if (v > 50 / 3.6) v *= e.velocidad;
    if (o.maxKmh) v = Math.min(v, o.maxKmh / 3.6);
    return v;
  }

  /* Trabajo del motor en una pieza, en joules, separado por causa. */
  function trabajo(p, v, m, veh, motor, o) {
    const raiz = Math.sqrt(1 + p.s * p.s);
    const temp = typeof o.temperatura === 'number' ? o.temperatura : 15;
    const rho = 1.225 * Math.exp(-p.h / 8434) * 288.15 / (273.15 + temp);
    // Viento de frente (positivo) o de cola, a la altura del auto.
    let frente = 0;
    if (o.viento && o.viento.ms) {
      frente = o.viento.ms * VIENTO_A_RAS * Math.cos((o.viento.desde - p.rumbo) * Math.PI / 180);
    }
    const aire = v + frente;
    const t = p.d / v;
    const c = {
      rodadura: m * G * CRR_ASFALTO * p.crr / raiz * p.d / ETA_TRANSMISION,
      aire: 0.5 * rho * veh.cda * aire * Math.abs(aire) * p.d / ETA_TRANSMISION,
      pendiente: m * G * p.s / raiz * p.d / ETA_TRANSMISION,
      motor: (motor.perdidaW(veh.masa) + (o.aire ? 1200 : 0)) * t,
      detenciones: 0,
    };
    const suma = c.rodadura + c.aire + c.pendiente + c.motor;
    /* Bajada que se paga sola: la combustión corta la inyección y lo que
       sobra se pierde en los frenos; un híbrido o un eléctrico guardan una
       parte en la batería (trabajo negativo). */
    if (suma < 0) c.pendiente += -suma * (1 - motor.regen);
    // Volver a acelerar después de cada detención (inercia de ruedas: +5 %).
    const n = p.detencionesKm * p.d / 1000;
    const e = ESTILOS[o.estilo] || ESTILOS.normal;
    c.detenciones = n * 0.5 * 1.05 * m * v * v * e.aceleracion * (1 - motor.regen) / ETA_TRANSMISION;
    return { c: c, t: t, n: n };
  }

  /* Ciclo mixto plano de referencia, con el que se calibra: 35 % ciudad a
     30 km/h, 35 % camino a 70 km/h y 30 % carretera a 100 km/h. */
  const CICLO = [
    { d: 3500, v: 30 / 3.6, s: 0, h: 300, crr: 1, detencionesKm: 1.5, rumbo: 0 },
    { d: 3500, v: 70 / 3.6, s: 0, h: 300, crr: 1, detencionesKm: 0.3, rumbo: 0 },
    { d: 3000, v: 100 / 3.6, s: 0, h: 300, crr: 1, detencionesKm: 0, rumbo: 0 },
  ];

  function consumoCrudo(piezas, veh, comb, extraKg, o) {
    const motor = MOTORES[veh.motor];
    const m = veh.masa + extraKg;
    const desglose = { rodadura: 0, aire: 0, pendiente: 0, motor: 0, detenciones: 0 };
    const porPieza = [];
    const jPorUnidad = comb.mj * 1e6 * motor.eta;
    const ralentiS = motor.ralentiH(veh.masa) / 3600;
    let segundos = 0, total = 0;
    piezas.forEach(function (p) {
      const v = velocidadEn(p, o);
      const r = trabajo(p, v, m, veh, motor, o);
      let l = 0;
      Object.keys(r.c).forEach(function (k) {
        const lk = r.c[k] / jPorUnidad;
        desglose[k] += lk; l += lk;
      });
      const espera = r.n * ESPERA_DETENCION;
      desglose.detenciones += espera * ralentiS;
      l += espera * ralentiS;
      segundos += r.t + espera;
      total += l;
      porPieza.push({ l: l, t: r.t + espera, v: v });
    });
    return { total: total, desglose: desglose, porPieza: porPieza, segundos: segundos };
  }

  /* Factor que lleva el modelo al rendimiento elegido (km por unidad). */
  function calibracion(veh, comb, rendimiento) {
    const ref = consumoCrudo(CICLO, veh, comb, MASA_PASAJERO, {});
    const km = CICLO.reduce(function (s, p) { return s + p.d; }, 0) / 1000;
    return (km / rendimiento) / ref.total;
  }

  /* opciones: { vehiculo, combustible, rendimiento, precio, ocupantes,
                 cargaKg, aire, estilo, maxKmh, viento: { ms, desde },
                 temperatura } */
  function calcular(perfil, o) {
    const veh = o.vehiculo, comb = o.combustible;
    const extra = (o.ocupantes || 1) * MASA_PASAJERO + (o.cargaKg || 0);
    const k = calibracion(veh, comb, o.rendimiento || veh.rendimiento);
    const r = consumoCrudo(perfil.piezas, veh, comb, extra, o);

    const porTipo = {};
    Object.keys(TIPOS).forEach(function (t) { porTipo[t] = { m: 0, litros: 0 }; });
    const porTramo = [];
    for (let t = 0; t < (perfil.tramos || 1); t++) {
      porTramo.push({ m: 0, litros: 0, segundos: 0, subida: 0, bajada: 0 });
    }
    let subida = 0, bajada = 0, peajeM = 0, lAcum = 0, tAcum = 0, maxSubida = 0;
    const acum = [];
    perfil.piezas.forEach(function (p, i) {
      const x = r.porPieza[i];
      const tr = porTramo[p.tramo] || porTramo[0];
      porTipo[p.tipo].m += p.d;
      porTipo[p.tipo].litros += x.l * k;
      tr.m += p.d; tr.litros += x.l * k; tr.segundos += x.t;
      const dh = p.s * p.d;
      if (dh > 0) { subida += dh; tr.subida += dh; } else { bajada -= dh; tr.bajada -= dh; }
      if (p.s > maxSubida) maxSubida = p.s;
      if (p.peaje) peajeM += p.d;
      lAcum += x.l * k; tAcum += x.t;
      acum.push({ l: lAcum, t: tAcum, v: x.v, intensidad: 100 * x.l * k / (p.d / 1000) });
    });

    const metros = perfil.piezas.reduce(function (s, p) { return s + p.d; }, 0);
    const litros = r.total * k;
    const desglose = {};
    Object.keys(r.desglose).forEach(function (c) { desglose[c] = r.desglose[c] * k; });
    return {
      litros: litros,
      costo: Math.max(0, litros) * (o.precio || comb.precio),
      km: metros / 1000,
      segundos: r.segundos,
      rendimiento: litros > 0 ? (metros / 1000) / litros : null,
      co2: Math.max(0, litros) * comb.co2,
      desglose: desglose, porTipo: porTipo, porTramo: porTramo,
      subida: subida, bajada: bajada, maxSubida: maxSubida, peajeKm: peajeM / 1000,
      ripioKm: porTipo.ripio.m / 1000,
      estanque: litros / veh.estanque,
      acum: acum, calibracion: k, unidad: comb.unidad,
    };
  }

  const api = {
    VEHICULOS: VEHICULOS, COMBUSTIBLES: COMBUSTIBLES, TIPOS: TIPOS, ESTILOS: ESTILOS,
    MOTORES: MOTORES, PASO: PASO,
    vehiculo: vehiculo, combustiblesDe: combustiblesDe,
    perfilDesdeValhalla: perfilDesdeValhalla, perfilDesdeOsrm: perfilDesdeOsrm,
    perfilRecto: perfilRecto, unirPerfiles: unirPerfiles, invertir: invertir,
    calcular: calcular, calibracion: calibracion,
    decodificar: decodificar, distancia: distancia, rumbo: rumbo, puntoEn: puntoEn,
    acumulada: acumulada,
  };
  return api;
})();

// Para probar el modelo fuera del navegador: node -e "require('./viaje-calculo.js')"
if (typeof module !== 'undefined' && module.exports) module.exports = GTViaje;
