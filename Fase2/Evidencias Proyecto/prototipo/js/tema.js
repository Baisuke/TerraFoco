/* ==========================================================================
   TerraFoco — Tema de la interfaz: oscuro (por omisión) o claro

   Va en <head>, antes de la hoja de estilos: fija <html data-tema> antes de
   que se pinte nada. Cargado al final del <body>, la página aparecía un
   instante en oscuro y saltaba al claro.

   El tema se elige con el botón de la barra superior y se recuerda en este
   navegador. También se puede fijar por la URL —?tema=claro— para dejar un
   enlace listo, por ejemplo, para proyectar: en un proyector el tema oscuro
   suele verse lavado.

   Cambiar de tema recarga la página. El mapa base, las rampas de datos y
   los gráficos se arman con el tema al cargar; repintarlos en caliente
   sería un segundo camino de pintado que mantener sincronizado.
   ========================================================================== */

(function () {
  var CLAVE = 'terrafoco_tema';
  var tema = 'oscuro';

  try {
    if (localStorage.getItem(CLAVE) === 'claro') tema = 'claro';
  } catch (e) { /* almacenamiento bloqueado: queda el de omisión */ }

  try {
    var pedido = new URLSearchParams(window.location.search).get('tema');
    if (pedido === 'claro' || pedido === 'oscuro') {
      tema = pedido;
      try { localStorage.setItem(CLAVE, pedido); } catch (e) { /* se usa igual */ }
    }
  } catch (e) { /* navegador sin URLSearchParams */ }

  document.documentElement.setAttribute('data-tema', tema);

  /* Por la URL y no solo por localStorage: si el almacenamiento está
     bloqueado, el cambio igual sobrevive a la recarga. */
  window.GT_cambiarTema = function () {
    var nuevo = document.documentElement.getAttribute('data-tema') === 'claro'
      ? 'oscuro' : 'claro';
    try { localStorage.setItem(CLAVE, nuevo); } catch (e) { /* va por la URL */ }
    var u = new URL(window.location.href);
    u.searchParams.set('tema', nuevo);
    window.location.href = u.toString();
  };
})();
