/* ==========================================================================
   TerraFoco — Hidratación de los indicadores desde la API

   Mismo criterio que mapa-real.js: si la API responde, las pantallas muestran
   datos reales; si no, siguen funcionando con los de ejemplo y lo DECLARAN.
   El prototipo nunca queda en blanco y nunca miente sobre lo que muestra.

   Uso en cada página — envolver el script de la página:

       GT.hidratar().then(function () {
           ...codigo de la pagina, sin cambios...
       });

   La promesa nunca se rechaza: si la API no está, se resuelve igual con los
   datos de ejemplo. Una pantalla en blanco por un backend apagado sería peor
   que un dato ilustrativo bien rotulado.
   ========================================================================== */

(function () {

  /* La resuelve api-base.js, que se carga antes: admite ?api= en la URL y
     lo recuerda, para cuando la API no está en localhost. */
  GT.API = (typeof GT_API_BASE !== 'undefined') ? GT_API_BASE : 'http://localhost:8000';

  /* 'api' cuando los indicadores vienen del motor; 'ejemplo' si son los de
     data.js. Lo consultan las pantallas para rotular lo que muestran. */
  GT.origenDatos = 'ejemplo';
  GT.origenErosion = null;     // 'CIREN' | 'TerraFoco'
  GT.anioErosion = null;

  /* ------------------------------------------------------------------
     Qué origen de erosión se está mirando — UC-06.

     La API acepta ?origen= desde el principio y expone /pertinencia/origenes
     para poblar un selector, pero ese selector no existía: todas las
     pantallas llamaban hidratar() sin argumento y veían siempre CIREN. Sin
     esto, comparar el cálculo propio contra la línea base oficial —que es el
     argumento central del proyecto— no se podía hacer desde la interfaz.

     La elección se guarda para que sobreviva al navegar entre pantallas: de
     poco sirve comparar si el visor y la ficha de comuna muestran orígenes
     distintos.
     ------------------------------------------------------------------ */
  var CLAVE_ORIGEN = 'terrafoco_origen';
  var ORIGEN_POR_DEFECTO = 'CIREN';

  GT.origenElegido = (function () {
    try {
      return localStorage.getItem(CLAVE_ORIGEN) || ORIGEN_POR_DEFECTO;
    } catch (e) {
      return ORIGEN_POR_DEFECTO;   // almacenamiento bloqueado
    }
  })();

  /* Qué orígenes hay cargados. Devuelve [] si la API no responde, para que
     quien llame pueda simplemente no mostrar el selector. */
  GT.origenesDisponibles = function () {
    return fetch(GT_api('/pertinencia/origenes'),
                 { signal: AbortSignal.timeout(4000) })
      .then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; });
  };

  /* ------------------------------------------------------------------
     Si se incluyen las comunas fuera del dominio de validez — UC-16.

     La API acepta incluir_fuera_de_dominio desde el principio y su docstring
     dice que cada fila trae `en_dominio` "para que la interfaz pueda
     advertirlo". La interfaz no lo advertía porque no existía el control.

     Por defecto van excluidas: mostrar un valor que el propio sistema sabe
     que sobreestima, sin decirlo, es la clase de error que no se detecta
     mirando el mapa. Quien quiera verlas lo pide explícitamente.
     ------------------------------------------------------------------ */
  var CLAVE_DOMINIO = 'terrafoco_fuera_de_dominio';

  GT.incluirFueraDeDominio = (function () {
    try { return localStorage.getItem(CLAVE_DOMINIO) === '1'; }
    catch (e) { return false; }
  })();

  GT.cambiarDominio = function (incluir) {
    try {
      localStorage.setItem(CLAVE_DOMINIO, incluir ? '1' : '0');
    } catch (e) { /* nada */ }
    location.reload();
  };

  /* Cambiar de origen recarga la pantalla en vez de repintarla.

     Cada página se dibuja una sola vez, dentro del .then() de hidratar, y no
     expone forma de volver a dibujarse. Recargar garantiza que todo quede
     consistente; intentar repintar a mano dejaría partes con el origen viejo,
     que es peor que esperar un segundo. */
  GT.cambiarOrigen = function (origen) {
    try { localStorage.setItem(CLAVE_ORIGEN, origen); } catch (e) { /* nada */ }
    location.reload();
  };

  function normalizar(t) {
    return String(t || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /* El índice del prototipo va de 0 a 1; el de la API, de -1 a 1, porque es
     una resta entre dos valores normalizados. Se reescala conservando el
     orden: 1 = mucha necesidad y ninguna inversión, 0 = lo contrario. */
  function aEscalaCero(pertinencia) {
    if (pertinencia === null || pertinencia === undefined) return null;
    return Math.min(1, Math.max(0, (pertinencia + 1) / 2));
  }

  /* Hay serie del SIRSD-S (planes) pero ninguna comuna con UF/ha: falta la
     superficie con erosión severa en la base. Sin ella la vista deja todo
     fuera del dominio y la pantalla de pertinencia queda vacía sin decir
     por qué. Lo lee pertinencia.html para explicarlo. */
  GT.faltaDenominador = false;
  function revisarDenominador(filas) {
    var conPlanes = filas.some(function (f) { return f.planes > 0; });
    var conUF = filas.some(function (f) { return typeof f.inversion_uf_ha === 'number'; });
    GT.faltaDenominador = conPlanes && !conUF;
    if (GT.faltaDenominador) {
      console.warn('[datos-api] hay serie del SIRSD-S pero ninguna UF/ha: falta ' +
                   'indicadores.superficie_erosionada (bash herramientas/inicializar.sh)');
    }
  }

  function aplicar(filas) {
    var porNombre = {};
    GT.comunas.forEach(function (c) {
      porNombre[normalizar(c.nombre)] = c;
      /* Se marcan todas como sin dato y se va limpiando la marca con lo que
         llegue. Sin esto, una comuna ausente de la respuesta se quedaba con
         su valor de ejemplo y se veia igual que una real.

         Pasa de verdad: con origen=TerraFoco la API devuelve 27 comunas, no
         33, porque las seis precordilleranas estan fuera del dominio de
         validez. Seis comunas inventadas mezcladas con 27 medidas, sin nada
         que las distinga, es peor que no mostrar nada. */
      c.sinDatoEnOrigen = true;
    });

    var aplicadas = 0, sinPar = [];
    filas.forEach(function (f) {
      var c = porNombre[normalizar(f.nombre)];
      if (!c) { sinPar.push(f.nombre); return; }
      c.sinDatoEnOrigen = false;

      if (f.perdida_ton_ha !== null) c.erosion = f.perdida_ton_ha;
      if (f.superficie_km2 !== null) c.sup = f.superficie_km2;
      c.idComuna = f.id_comuna;
      // La API entrega pesos; el prototipo muestra millones.
      c.haBonif = f.ha_bonificadas || 0;
      c.monto = f.monto_total ? Math.round(f.monto_total / 1e6) : 0;
      c.benef = f.beneficiarios || 0;
      /* Desde la migración 013: la serie 2012-2025 y la inversión del índice,
         UF por hectárea con erosión Severa o superior. `planes` no repite a
         nadie; `benef` suma agricultores de cada año y sí repite. */
      c.planes = f.planes || 0;
      c.incentivoUF = f.incentivo_uf;
      c.haErosionSevera = f.ha_erosion_severa;
      c.inversionUFha = f.inversion_uf_ha;
      if (f.anio_desde) GT.periodoInversion = [f.anio_desde, f.anio_hasta];
      /* Lo que le falta para llegar a la mediana regional de UF/ha (la API la
         calcula solo con las comunas del dominio). null fuera del dominio. */
      c.brechaUF = (typeof f.brecha_uf === 'number') ? f.brecha_uf : null;
      if (typeof f.mediana_uf_ha === 'number') GT.medianaUFha = f.mediana_uf_ha;

      c.precision = f.precision_dato;
      /* Viene en cada fila justamente para esto: si se pidieron las comunas
         fuera de dominio, hay que poder distinguirlas en pantalla. */
      c.fueraDeDominio = (f.en_dominio === false);

      /* Las comunas fuera de dominio llegan siempre, porque su erosión y su
         serie del SIRSD-S son datos reales que la ficha y el mapa deben
         mostrar. Lo que no llega es su índice, salvo que se pida: se deja en
         null y cada vista del índice las filtra con GT.enIndice. Antes no se
         pedían, se quedaban con el índice de ejemplo de data.js y aparecían
         en el ranking como si fueran medidas. */
      var i = aEscalaCero(f.pertinencia);
      c.indice = (c.fueraDeDominio && !GT.incluirFueraDeDominio) ? null : i;
      // La copia local trae también terreno y erosiones; la API los da aparte.
      aplicarTerrenoA(c, f);
      aplicarErosionesA(c, f);
      aplicadas++;
    });

    if (sinPar.length) {
      console.warn('[datos-api] %d comunas de la API sin par en el prototipo: %s',
                   sinPar.length, sinPar.slice(0, 5).join(', '));
    }
    return aplicadas;
  }

  /* NDVI y pendiente medidos. Hasta que llegan, las capas del visor que los
     usan no tienen valor real: mapa.js pinta "sin dato" en vez del número
     de ejemplo, que salía de la erosión y no de ninguna medición. */
  function aplicarTerrenoA(c, f) {
    if (typeof f.ndvi_mediana === 'number') c.ndvi = f.ndvi_mediana;
    if (typeof f.pendiente_media === 'number') c.pendiente = f.pendiente_media;
  }

  /* Las dos erosiones por comuna, para compararlas (UC-06): el inventario
     de CIREN y el cálculo propio. `c.erosion` sigue siendo la del origen
     elegido, la que alimenta el índice. Hasta ahora la "línea base CIREN
     2010" que se comparaba en el visor, el panel y la ficha era la erosión
     multiplicada por un factor ilustrativo: no existía ese dato. */
  function aplicarErosionesA(c, f) {
    if (typeof f.erosion_ciren === 'number') {
      c.erosionCiren = f.erosion_ciren;
      if (f.anio_ciren) GT.anioCiren = f.anio_ciren;
    }
    if (typeof f.erosion_terrafoco === 'number') {
      c.erosionPropia = f.erosion_terrafoco;
      c.propiaEnDominio = f.terrafoco_en_dominio !== false;
      if (f.anio_terrafoco) GT.anioPropia = f.anio_terrafoco;
    }
  }

  /* Los nombres de las dos capas de erosión llevan el año del dato real, no
     uno fijo: decían "CIREN 2010" y "2026" y ninguno de los dos corresponde a
     lo que hay cargado. */
  function rotularCapasDeErosion() {
    (GT.capas || []).forEach(function (capa) {
      if (capa.id === 'erosion10' && GT.anioCiren) capa.fuente = 'Inventario CIREN · ' + GT.anioCiren;
      if (capa.id === 'erosion26' && GT.anioPropia) capa.fuente = 'Cálculo propio · ' + GT.anioPropia;
    });
  }

  function traerErosiones() {
    return fetch(GT_api('/comunas/erosion'), { signal: AbortSignal.timeout(4000) })
      .then(function (r) {
        if (!r.ok) throw new Error('la API respondió ' + r.status);
        return r.json();
      })
      .then(function (filas) {
        var porNombre = {};
        GT.comunas.forEach(function (c) { porNombre[normalizar(c.nombre)] = c; });
        var n = 0;
        filas.forEach(function (f) {
          var c = porNombre[normalizar(f.nombre)];
          if (c) { aplicarErosionesA(c, f); n++; }
        });
        console.info('[datos-api] erosión CIREN y cálculo propio de %d comunas', n);
      })
      .catch(function (e) {
        console.info('[datos-api] sin la comparación de erosiones (%s)', e.message);
      });
  }

  function traerTerreno() {
    return fetch(GT_api('/comunas/terreno'), { signal: AbortSignal.timeout(4000) })
      .then(function (r) {
        if (!r.ok) throw new Error('la API respondió ' + r.status);
        return r.json();
      })
      .then(function (filas) {
        var porNombre = {};
        GT.comunas.forEach(function (c) { porNombre[normalizar(c.nombre)] = c; });
        var n = 0;
        filas.forEach(function (f) {
          var c = porNombre[normalizar(f.nombre)];
          if (c) { aplicarTerrenoA(c, f); n++; }
        });
        console.info('[datos-api] NDVI y pendiente de %d comunas', n);
      })
      .catch(function (e) {
        console.info('[datos-api] sin NDVI ni pendiente por comuna (%s)', e.message);
      });
  }

  function rotular() {
    var badge = document.querySelector('.badge--proto');
    if (!badge) return;

    if (GT.origenDatos === 'api') {
      var fuente = GT.origenErosion === 'CIREN'
        ? 'erosión CIREN' : 'cálculo propio';
      /* Cuando el origen no cubre todas las comunas se dice cuántas trae.
         Es el caso del cálculo propio: seis comunas quedan fuera del dominio
         de validez, y eso tiene que verse, no esconderse. */
      var enIndice = GT.comunas.filter(GT.enIndice).length;
      var fuera = GT.incluirFueraDeDominio ? GT.comunas.filter(function (c) {
        return c.fueraDeDominio;
      }).length : 0;

      badge.innerHTML = '<span class="dot"></span>Datos reales · ' + fuente +
                        (GT.anioErosion ? ' ' + GT.anioErosion : '') +
                        (enIndice < GT.comunas.length
                          ? ' · ' + enIndice + ' de ' + GT.comunas.length +
                            ' comunas en el índice' : '') +
                        (fuera ? ' · incluye ' + fuera +
                                 ' fuera de dominio' : '');
      /* Con comunas fuera de dominio a la vista el aviso cambia de color: se
         está mostrando algo que el modelo sobreestima, y eso no puede tener
         el mismo verde que un dato validado. */
      if (typeof estadoBadge === 'function') estadoBadge(badge, fuera ? 'aviso' : 'vivo');
    } else if (GT.origenDatos === 'copia') {
      /* Ni verde ni naranja: es dato real pero no en vivo, y confundirlo con
         cualquiera de los dos seria enganoso. */
      badge.innerHTML = '<span class="dot"></span>Copia local · ' +
                        (GT.origenErosion || 'sin conexión');
      if (typeof estadoBadge === 'function') estadoBadge(badge, 'copia');
    } else {
      badge.innerHTML = '<span class="dot"></span>Prototipo · datos de ejemplo';
      if (typeof estadoBadge === 'function') estadoBadge(badge, null);
    }
  }

  /* La llama pintarShell cuando la barra superior ya existe. */
  GT.rotularOrigen = rotular;

  /* Cómo se repartió el incentivo cada año (/pertinencia/evolucion): qué
     parte fue a las comunas más erosionadas frente a la que les tocaría por
     su superficie severa. Sin API, la copia local, que es del origen con que
     se generó; si no coincide con el elegido, null antes que mezclar. */
  var promesaEvolucion = null;
  GT.evolucionFocalizacion = function () {
    if (promesaEvolucion) return promesaEvolucion;
    var desdeCopia = function () {
      var copia = window.TERRAFOCO_INDICADORES;
      var e = copia && copia.evolucion;
      return (e && e.origen === GT.origenErosion) ? e : null;
    };
    promesaEvolucion = GT.origenDatos !== 'api'
      ? Promise.resolve(desdeCopia())
      : fetch(GT_api('/pertinencia/evolucion', { origen: GT.origenErosion || GT.origenElegido }),
              { signal: AbortSignal.timeout(4000) })
          .then(function (r) {
            if (!r.ok) throw new Error('la API respondió ' + r.status);
            return r.json();
          })
          .catch(function (e) {
            console.info('[datos-api] evolución sin API (%s); copia local', e.message);
            return desdeCopia();
          });
    return promesaEvolucion;
  };

  /* Factores RUSLE medidos del cálculo propio, de toda la región
     (/comunas/factores): la ficha necesita los de la comuna y la mediana
     regional para compararlos. Sin API salen de la copia local; sin ninguna
     de las dos, null, y la ficha vuelve a los ilustrativos y lo dice. */
  var promesaFactores = null;
  GT.factoresRusle = function () {
    if (promesaFactores) return promesaFactores;
    var desdeCopia = function () {
      var copia = window.TERRAFOCO_INDICADORES;
      return (copia && copia.factores && copia.factores.comunas) ? copia.factores : null;
    };
    promesaFactores = GT.origenDatos !== 'api'
      ? Promise.resolve(desdeCopia())
      : fetch(GT_api('/comunas/factores'), { signal: AbortSignal.timeout(4000) })
          .then(function (r) {
            if (!r.ok) throw new Error('la API respondió ' + r.status);
            return r.json();
          })
          .catch(function (e) {
            console.info('[datos-api] factores RUSLE sin API (%s); copia local', e.message);
            return desdeCopia();
          });
    return promesaFactores;
  };

  /* Serie anual del SIRSD-S de una comuna, 2012-2025 (/comunas/{id}/sirsd).
     Sin API sale de la copia local, que la trae desde la migración 013; sin
     ninguna de las dos se resuelve en null y la ficha lo dice, en vez de
     repartir el monto total en siete años con una fórmula, que es lo que
     hacía. Los años sin planes no vienen en la tabla: se rellenan con cero
     para que el gráfico no una 2013 con 2016 como si fueran seguidos. */
  GT.serieSirsd = function (c) {
    var desdeCopia = function () {
      var copia = window.TERRAFOCO_INDICADORES;
      var filas = copia && copia.sirsd && copia.sirsd[c.idComuna];
      return filas ? filas.map(function (f) {
        return { anio: f[0], reservado: f[1] === null, planes: f[1], agricultores: f[2],
                 incentivo: f[3], incentivo_uf: f[4], ha_reales: f[5] };
      }) : null;
    };
    var rellenar = function (filas) {
      if (!filas) return null;
      var p = GT.periodoInversion || [2012, 2025];
      var por = {};
      filas.forEach(function (f) { por[f.anio] = f; });
      var serie = [];
      for (var a = p[0]; a <= p[1]; a++) {
        serie.push(por[a] || { anio: a, planes: 0, agricultores: 0, incentivo: 0,
                               incentivo_uf: 0, ha_reales: 0 });
      }
      return serie;
    };
    if (!c || !c.idComuna) return Promise.resolve(null);
    if (GT.origenDatos !== 'api') return Promise.resolve(rellenar(desdeCopia()));
    return fetch(GT_api('/comunas/' + c.idComuna + '/sirsd'),
                 { signal: AbortSignal.timeout(4000) })
      .then(function (r) {
        if (!r.ok) throw new Error('la API respondió ' + r.status);
        return r.json();
      })
      .then(rellenar)
      .catch(function (e) {
        console.info('[datos-api] serie SIRSD-S sin API (%s); copia local', e.message);
        return rellenar(desdeCopia());
      });
  };

  /* ---- Módulo 2: susceptibilidad a inundación -------------------------
     Misma idea que la pertinencia: si la API responde, cada comuna recibe su
     índice real, su clase, si está calibrado y cuántos eventos históricos
     registra; los eventos de ejemplo se reemplazan por los de DesInventar.
     Si no responde, la página sigue con los de ejemplo y lo declara. */
  GT.origenInundacion = 'ejemplo';
  GT.inundacionCalibrada = null;

  var MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
               'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  function aplicarInundacion(filas) {
    var porNombre = {};
    GT.comunas.forEach(function (c) { porNombre[normalizar(c.nombre)] = c; });
    var n = 0;
    filas.forEach(function (f) {
      var c = porNombre[normalizar(f.nombre)];
      if (!c) return;
      c.susceptibilidad = f.susceptibilidad;
      c.claseInundacion = f.clase;
      c.eventosInundacion = f.eventos;
      c.inundacionCalibrada = f.calibrado;
      n++;
    });
    return n;
  }

  /* Los eventos reales toman la forma que ya usa la tabla de la página, y
     "acierto" pasa a significar lo que la validación mide: que el evento
     cayó en una comuna clasificada Alta o Muy alta. */
  function eventosReales(datos) {
    var clasePor = {};
    GT.comunas.forEach(function (c) {
      if (c.claseInundacion) clasePor[normalizar(c.nombre)] = c.claseInundacion;
    });
    return datos.eventos.map(function (e) {
      var clase = clasePor[normalizar(e.comuna)] || null;
      return {
        fecha: (e.mes ? MESES[e.mes - 1] + ' ' : '') + e.anio,
        lugar: e.comuna || (e.lugar || '').slice(0, 40) || 'sin comuna',
        tipo: e.tipo,
        clase: clase || 'sin índice',
        acierto: clase === 'Alta' || clase === 'Muy alta',
        muertos: e.muertos, afectados: e.afectados,
      };
    });
  }

  /* ---- Módulo 3: condición térmica urbana ----------------------------
     La ingesta de ECOSTRESS deja temperatura superficial por comuna. La
     conurbación de ejemplo (GT.conurbacion) recibe el dato real donde lo
     hay; el mapa lee de ahí. Área verde y NDVI aún no se calculan: se
     quedan como ejemplo y la página lo rotula. */
  GT.origenUrbano = 'ejemplo';
  GT.urbanoFuente = null;
  GT.urbanoAnio = null;
  GT.urbanoRango = null;      // [min, max] de temperatura real, para la escala

  function aplicarUrbano(datos) {
    var porNombre = {};
    GT.conurbacion.forEach(function (c) { porNombre[normalizar(c.nombre)] = c; });
    var n = 0, temps = [];
    datos.comunas.forEach(function (f) {
      if (f.temp_superficial === null) return;
      temps.push(f.temp_superficial);
      var c = porNombre[normalizar(f.nombre)];
      if (!c) return;
      c.temp = f.temp_superficial;
      c.tempMax = f.temp_maxima;
      c.tempMin = f.temp_minima;
      c.escenas = f.escenas;
      c.tempReal = true;
      n++;
    });
    if (temps.length) {
      GT.urbanoRango = [Math.min.apply(null, temps), Math.max.apply(null, temps)];
    }
    return n;
  }

  var promesaUrbano = null;

  /* ---- Áreas verdes (objetivo 7): Censo 2024 + OpenStreetMap ----------
     Reemplaza el área verde de ejemplo de GT.conurbacion por la real, a
     escala comunal, y deja en GT.areasVerdes el detalle por zona censal. */
  GT.origenAreasVerdes = 'ejemplo';
  GT.areasVerdes = null;
  var promesaAreasVerdes = null;

  function aplicarAreasVerdes(d) {
    var porNombre = {};
    d.comunas.forEach(function (c) { porNombre[normalizar(c.nombre)] = c; });
    GT.conurbacion.forEach(function (c) {
      var real = porNombre[normalizar(c.nombre)];
      if (!real || typeof real.m2_hab !== 'number') return;
      c.verde = real.m2_hab;
      c.verdeReal = true;
      c.idComuna = real.id_comuna;
      c.areaVerde = real;
    });
    GT.areasVerdes = d;
  }

  GT.hidratarAreasVerdes = function () {
    if (promesaAreasVerdes) return promesaAreasVerdes;
    promesaAreasVerdes = fetch(GT_api('/urbano/areas-verdes'), { signal: AbortSignal.timeout(6000) })
      .then(function (r) {
        if (!r.ok) throw new Error('la API respondió ' + r.status);
        return r.json();
      })
      .then(function (d) {
        aplicarAreasVerdes(d);
        GT.origenAreasVerdes = 'api';
        console.info('[datos-api] áreas verdes de %d comunas y %d zonas censales',
                     d.comunas.length, d.zonas.length);
      })
      .catch(function (e) {
        /* Sin API, la copia generada desde la base (sembrar_indicadores.py)
           antes que las unidades vecinales de ejemplo. */
        var copia = window.TERRAFOCO_INDICADORES && window.TERRAFOCO_INDICADORES.areas_verdes;
        if (copia && copia.comunas) {
          aplicarAreasVerdes(copia);
          GT.origenAreasVerdes = 'copia';
          console.info('[datos-api] áreas verdes sin API (%s); copia local', e.message);
          return;
        }
        console.info('[datos-api] áreas verdes sin API (%s); datos de ejemplo', e.message);
      });
    return promesaAreasVerdes;
  };

  /* Zonas censales de una comuna con su indicador, y sus plazas y parques. */
  var geoAreasVerdes = {};
  GT.areasVerdesGeo = function (idComuna) {
    if (!geoAreasVerdes[idComuna]) {
      geoAreasVerdes[idComuna] = fetch(GT_api('/urbano/areas-verdes/geojson', { comuna: idComuna }),
                                       { signal: AbortSignal.timeout(8000) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return geoAreasVerdes[idComuna];
  };

  GT.hidratarUrbano = function () {
    if (promesaUrbano) return promesaUrbano;
    promesaUrbano = fetch(GT_api('/urbano'), { signal: AbortSignal.timeout(4000) })
      .then(function (r) {
        if (!r.ok) throw new Error('la API respondió ' + r.status);
        return r.json();
      })
      .then(function (datos) {
        if (!datos || !datos.comunas || !datos.comunas.length) throw new Error('sin filas');
        var n = aplicarUrbano(datos);
        if (!n) throw new Error('ninguna comuna de la conurbación coincidió');
        GT.origenUrbano = 'api';
        GT.urbanoFuente = datos.fuente;
        GT.urbanoAnio = datos.anio;
        console.info('[datos-api] %d comunas de la conurbación con temperatura desde la API', n);
      })
      .catch(function (e) {
        var copia = window.TERRAFOCO_INDICADORES && window.TERRAFOCO_INDICADORES.urbano;
        if (copia && copia.comunas && aplicarUrbano(copia)) {
          GT.origenUrbano = 'copia';
          GT.urbanoFuente = copia.fuente;
          GT.urbanoAnio = copia.anio;
          console.info('[datos-api] urbano sin API (%s); copia local', e.message);
          return;
        }
        console.info('[datos-api] urbano sin API (%s); datos de ejemplo', e.message);
      });
    return promesaUrbano;
  };

  var promesaInundacion = null;

  GT.hidratarInundacion = function () {
    if (promesaInundacion) return promesaInundacion;
    promesaInundacion = fetch(GT_api('/inundacion'), { signal: AbortSignal.timeout(4000) })
      .then(function (r) {
        if (!r.ok) throw new Error('la API respondió ' + r.status);
        return r.json();
      })
      .then(function (filas) {
        if (!Array.isArray(filas) || !filas.length) throw new Error('sin filas');
        var n = aplicarInundacion(filas);
        if (!n) throw new Error('ninguna comuna coincidió por nombre');
        GT.origenInundacion = 'api';
        GT.inundacionCalibrada = filas.every(function (f) { return f.calibrado; });
        console.info('[datos-api] %d comunas con susceptibilidad desde la API', n);
        return fetch(GT_api('/inundacion/eventos'), { signal: AbortSignal.timeout(4000) });
      })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (datos) {
        if (datos && datos.eventos) {
          GT.eventosInundacion = eventosReales(datos);
          GT.eventosFuente = datos.fuente;
          console.info('[datos-api] %d eventos históricos desde la API', datos.total);
        }
      })
      .catch(function (e) {
        if (GT.origenInundacion === 'api') return;     // falló solo la lista de eventos
        var copia = window.TERRAFOCO_INDICADORES || {};
        if (copia.inundacion && aplicarInundacion(copia.inundacion)) {
          GT.origenInundacion = 'copia';
          GT.inundacionCalibrada = copia.inundacion.every(function (f) { return f.calibrado; });
          if (copia.eventos_inundacion) {
            GT.eventosInundacion = eventosReales(copia.eventos_inundacion);
            GT.eventosFuente = copia.eventos_inundacion.fuente;
          }
          console.info('[datos-api] inundación sin API (%s); copia local', e.message);
          return;
        }
        console.info('[datos-api] inundación sin API (%s); datos de ejemplo', e.message);
      });
    return promesaInundacion;
  };

  var promesa = null;

  GT.hidratar = function (origen) {
    if (promesa) return promesa;

    var url = GT_api('/pertinencia', {
      origen: origen || GT.origenElegido,
      // Siempre: la casilla decide si entran al índice, no si se cargan.
      incluir_fuera_de_dominio: 'true',
    });

    promesa = fetch(url, { signal: AbortSignal.timeout(4000) })
      .then(function (r) {
        if (!r.ok) throw new Error('la API respondió ' + r.status);
        return r.json();
      })
      .then(function (filas) {
        if (!Array.isArray(filas) || !filas.length) throw new Error('sin filas');
        var n = aplicar(filas);
        if (!n) throw new Error('ninguna comuna coincidió por nombre');
        revisarDenominador(filas);
        GT.origenDatos = 'api';
        GT.origenErosion = filas[0].origen;
        GT.anioErosion = filas[0].anio_erosion;
        console.info('[datos-api] %d comunas hidratadas desde la API (%s)',
                     n, GT.origenErosion);
        return Promise.all([traerTerreno(), traerErosiones()]);
      })
      .catch(function (e) {
        /* Sin API se usa el respaldo generado desde la base, si esta. Antes
           se caia a las cifras de data.js, escritas a mano en la fase del
           prototipo no funcional: Litueche aparecia con 38,4 t/ha cuando el
           dato real es 4,64. Sigue siendo una copia y el badge lo declara,
           pero deja de ser ficcion. */
        var copia = window.TERRAFOCO_INDICADORES;
        if (copia && copia.comunas && copia.comunas.length) {
          var n = aplicar(copia.comunas);
          revisarDenominador(copia.comunas);
          if (n) {
            GT.origenDatos = 'copia';
            GT.origenErosion = copia.origen;
            console.info('[datos-api] sin API (%s); %d comunas desde la ' +
                         'copia local de %s', e.message, n, copia.origen);
            return;
          }
        }
        console.info('[datos-api] sin API (%s) ni copia local; se usan ' +
                     'los datos de ejemplo', e.message);
        GT.origenDatos = 'ejemplo';
      })
      .then(rotularCapasDeErosion)
      .then(rotular);

    return promesa;
  };

})();
