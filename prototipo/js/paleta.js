/* ==========================================================================
   TerraFoco — Paleta

   La familia es la de INDAP (https://www.indap.gob.cl):

     #2B9C68  verde institucional — botones, enlaces y títulos
     #001C41  azul marino — pie de página y titulares
     #18A299  turquesa    ·  #0F69C4 / #0192D0  azules
     #D75E24  naranja     ·  #E68E0C ámbar  ·  #DD2323 rojo

   Dos temas, oscuro y claro, con los mismos nombres de rol. El tema lo fija
   js/tema.js en <html data-tema> antes de que se pinte nada, y esta hoja lo
   lee al cargarse: cambiar de tema recarga la página, así que no hay dos
   caminos de pintado que mantener sincronizados.

   El oscuro no es el claro invertido: invertir deja la clase más baja de
   cada rampa como lo más brillante del mapa, al revés de lo que debe
   leerse. Sus rampas se generaron en OKLCH con el tono fijo y se validaron
   contra la superficie del mapa (#0B1626) con el validador de la guía de
   visualización (modo ordinal): un solo tono, luminosidad monótona, saltos
   de al menos 0,06 y la clase más tenue a más de 2:1 del fondo. Van de
   tenue a brillante. Las del claro son las originales del proyecto, de
   claro a oscuro.

   Este archivo es la única fuente de verdad del color: CSS lo replica en
   variables y los módulos de JavaScript lo consumen desde aquí.
   ========================================================================== */

const TEMA = (typeof document !== 'undefined' &&
              document.documentElement.getAttribute('data-tema') === 'claro')
  ? 'claro' : 'oscuro';

const TEMAS_PALETA = {

  oscuro: {
    /* --- Institucionales, en su paso para fondo oscuro --- */
    verde:        '#3FAE7C',
    verdeClaro:   '#6CCB9C',
    verdeOscuro:  '#6CCB9C',
    verdeTinte:   'rgba(63, 174, 124, .12)',
    azul:         '#4F8CC9',
    azulClaro:    '#5AA9D6',
    azulTinte:    'rgba(79, 140, 201, .14)',
    turquesa:     '#3CBFB4',
    naranja:      '#E8956A',
    ambar:        '#E0B254',
    rojo:         '#EC7A80',

    /* --- Tinta: lo que se lee. Los gráficos usan estos roles, no nombres
       de marca: antes el texto de los ejes iba en azulMarino, que sobre
       fondo oscuro es invisible. Contraste medido en styles.css. --- */
    tinta:        '#E6EBF0',
    tinta2:       '#A7B3C0',
    gris:         '#8593A1',   // ejes y rótulos secundarios; también lo neutro
    grisFondo:    '#111820',

    /* --- Interfaz --- */
    superficie:   '#111820',   // anillo alrededor de marcas que se superponen
    texto:        '#E6EBF0',
    borde:        '#1F2A36',
    borde2:       '#3A4A5E',
    textoSuave:   '#A7B3C0',
    rejilla:      '#1C2631',
    mapaFondo:    '#0C1219',
    sinDato:      '#44484C',   // neutro, tenue, sin tono: no se confunde con una clase

    /* --- Dos series que se comparan (CIREN frente al cálculo propio). Pasos
       centrales de las rampas de agua y vegetación: dentro de la banda de
       luminosidad para series en oscuro y separados ΔE 18,6 en
       deuteranopía. */
    serie1:       '#3093DB',
    serie2:       '#2FA465',

    /* --- Rampas de datos (de menor a mayor) --- */
    rampas: {
      erosion:     ['#774418', '#A45803', '#CE7005', '#F68918', '#FEB57D'],
      agua:        ['#1F5781', '#2274AF', '#3093DB', '#52B1FB', '#95CEFE'],
      calor:       ['#803B2A', '#B14A31', '#E05D3D', '#FF7E5E', '#FFB19D'],
      vegetacion:  ['#285F3F', '#2D8152', '#2FA465', '#3CC67B', '#61E599'],
      neutra:      ['#4E5359', '#6A6F76', '#878D93', '#A4AAB1', '#C2C8CF'],
      /* Pendiente. Índigo, de la familia del azul marino institucional y
         distinto del azul del agua: en grises se confundía con la sombra
         del relieve. */
      pendiente:   ['#4A4D7E', '#6366AD', '#7D82D9', '#9A9FF9', '#BCC2FF'],
      /* Inversión por ha erosionada. En oscuro la clase baja es un azul
         tenue y el sin dato es gris sin tono: no se confunden. */
      inversion:   ['#025884', '#0676AE', '#1A95D8', '#45B4F8', '#8ED0FF'],
      /* Área verde por habitante, de lejos del estándar a cumplirlo: cálida
         abajo y verde arriba. En oscuro la clase que cumple es la más
         brillante, y las plazas encima van en verde claro (urbano.html). */
      areaVerde:   ['#C2451A', '#E08A1E', '#C9A640', '#3CA86B', '#61E599'],
      /* Divergente: del territorio bien cubierto a la brecha crítica. Dos
         familias con el centro gris y tenue; los extremos, los más
         brillantes. Brecha alta y brecha crítica se separan por
         LUMINOSIDAD y no solo por tono: ámbar y naranja colapsan en
         deuteranopía, y son justo las dos clases que más importan (ΔE 14,9
         protan, 18,9 normal entre vecinas). */
      pertinencia: ['#3ADFD7', '#36A15D', '#505963', '#A97515', '#FE9372']
    },

    /* --- El mapa (mapa-real.js) --- */
    mapa: {
      estilo: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      detalle: 'CARTO Dark Matter',
      /* Dark Matter es gris neutro: se tiñen el fondo y el agua con los
         tonos de los paneles, para que mapa e interfaz sean una superficie. */
      entintar: { fondo: '#0C1219', agua: '#0F1924', cauces: '#1A2A3A' },
      borde: 'rgba(225, 233, 241, 0.42)', bordeImagen: 'rgba(255, 255, 255, 0.72)',
      seleccion: '#FFFFFF', casco: 'rgba(0, 0, 0, 0.6)',
      halo: 'rgba(4, 12, 24, 0.85)', haloImagen: 'rgba(2, 8, 16, 0.92)',
      /* En oscuro la sombra es negra y la luz apenas perceptible: con luz
         blanca las laderas soleadas se leían como otra clase. */
      relieve: { sombra: 'rgba(0, 3, 8, 0.6)', luz: 'rgba(200, 215, 230, 0.08)',
                 acento: 'rgba(0, 3, 8, 0.2)' },
      cielo: { 'sky-color': '#0A0F15', 'horizon-color': '#243241',
               'fog-color': '#0E151D', 'sky-horizon-blend': 0.5,
               'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.8 },
    },
  },

  claro: {
    verde:        '#2B9C68',
    verdeClaro:   '#4FC98C',
    verdeOscuro:  '#166B45',
    verdeTinte:   '#EAF5EF',
    azul:         '#0F69C4',
    azulClaro:    '#0192D0',
    azulTinte:    '#E9F2FB',
    turquesa:     '#18A299',
    naranja:      '#B84E1C',   // 5,1:1 como texto; el #D75E24 daba 3,8
    ambar:        '#C77A06',
    rojo:         '#C62828',

    tinta:        '#16232B',
    tinta2:       '#48585F',
    gris:         '#5E6D75',
    grisFondo:    '#F4F6F8',

    superficie:   '#FFFFFF',
    texto:        '#16232B',
    borde:        '#E2E7EC',
    borde2:       '#9FACB8',
    textoSuave:   '#48585F',
    rejilla:      '#EDF1F3',
    mapaFondo:    '#EEF2F5',
    sinDato:      '#E4E8EA',

    /* Azul y verde institucionales: ΔE 22,8 en protanopía, 23,5 normal. */
    serie1:       '#0F69C4',
    serie2:       '#2B9C68',

    /* Las originales del proyecto, de claro a oscuro. */
    rampas: {
      erosion:     ['#FBF3E3', '#F5DCAE', '#EBAE63', '#D75E24', '#98380F'],
      agua:        ['#E9F2FB', '#BCD8EE', '#7FB6DE', '#0F69C4', '#0A3A73'],
      calor:       ['#FDF4E0', '#F8D48A', '#EFA43C', '#D75E24', '#9B2F12'],
      vegetacion:  ['#EAF5EF', '#BFE2CE', '#7DC69F', '#2B9C68', '#166B45'],
      neutra:      ['#F5F5F5', '#DEDEDE', '#B8B8B8', '#8A8A8A', '#5C5C5C'],
      pendiente:   ['#EEF0F7', '#C6CBE3', '#8E97C7', '#4E5C9E', '#1E2A5E'],
      /* 'agua' sin su primer tono: aquel casi blanco se confundía con el
         gris de "sin dato", y la clase más baja es justo la que hay que ver. */
      inversion:   ['#BCD8EE', '#7FB6DE', '#3F8FD2', '#0F69C4', '#0A3A73'],
      /* Área verde por habitante, de lejos del estándar a cumplirlo. Cálida
         abajo y verde arriba, y no toda en verdes: encima se dibujan las
         plazas y parques en verde oscuro, y con una rampa verde se perdían. */
      areaVerde:   ['#C4521F', '#E68E0C', '#F2C46B', '#9FD3B4', '#2B9C68'],
      /* La divergente original tenía Sobre-cobertura (#18A299) y Cobertura
         adecuada (#2B9C68) a ΔE 6,7: casi el mismo color incluso con visión
         normal. Se separan por luminosidad, como en oscuro: 10,6 en
         protanopía y 15,8 normal entre vecinas. */
      pertinencia: ['#0B7A72', '#62BE8E', '#C3CCD4', '#EFA13A', '#C2451A']
    },

    mapa: {
      estilo: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      detalle: 'CARTO Positron',
      entintar: null,
      borde: 'rgba(255, 255, 255, 0.95)', bordeImagen: 'rgba(255, 255, 255, 0.85)',
      seleccion: '#16232B', casco: 'rgba(255, 255, 255, 0.9)',
      halo: 'rgba(255, 255, 255, 0.75)', haloImagen: '#FFFFFF',
      relieve: { sombra: 'rgba(0, 28, 65, 0.42)', luz: 'rgba(255, 255, 255, 0.28)',
                 acento: 'rgba(0, 28, 65, 0.12)' },
      cielo: { 'sky-color': '#BFD7EA', 'horizon-color': '#EEF3F6',
               'fog-color': '#F5F6F7', 'sky-horizon-blend': 0.55,
               'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85 },
    },
  },
};

const PALETA = Object.assign({
  tema: TEMA,

  /* Institucionales que no cambian con el tema: se usan como fondo. */
  azulMarino:   '#001C41',   // fondo; nunca como tinta
  azulMarino2:  '#0A2C56',
  azulMarino3:  '#143A6B',

  /* --- Codificación de los PNG del motor. NO son colores de pantalla. ---
     mapa_erosion.py, mapa_inundacion.py y mapa_calor.py escriben cada
     clase con un color exacto, y el visor recupera la clase de cada celda
     leyendo ese color de vuelta (detalle-comuna.js, leerClases). Es un
     código, como un número: por eso no sigue al tema. Si la clase se
     leyera con los colores de pantalla, en oscuro cada píxel "Ligera"
     —casi blanco— calzaba con el tono más claro de la rampa oscura, que es
     "Extrema", y una comuna con mediana de 4,7 t/ha/año salía 92 %
     extrema. Cambiar estos valores exige volver a generar los PNG en el
     motor con los mismos. */
  codificacion: {
    erosion: ['#FBF3E3', '#F5DCAE', '#EBAE63', '#D75E24', '#98380F'],
    agua:    ['#E9F2FB', '#BCD8EE', '#7FB6DE', '#0F69C4', '#0A3A73'],
    calor:   ['#FDF4E0', '#F8D48A', '#EFA43C', '#D75E24', '#9B2F12']
  }
}, TEMAS_PALETA[TEMA]);
