/* ==========================================================================
   TerraFoco — Dónde está la API

   El prototipo asume http://localhost:8000, que es lo correcto en el
   computador de quien desarrolla. Deja de serlo en cuanto el sistema corre
   en otra parte —un Codespace, una VM—: ahí "localhost" es el computador
   del público, donde no hay nada.

   Se resuelve con un parámetro en la URL, una sola vez:

       visor.html?api=https://mi-codespace-8000.app.github.dev

   Queda guardado en localStorage y las demás páginas lo reutilizan sin
   repetirlo. Para volver al valor por defecto: ?api=

   Va en su propio archivo y se carga PRIMERO porque lo leen dos módulos
   distintos (datos-api.js y mapa-real.js) y no todas las páginas cargan
   ambos.
   ========================================================================== */

var GT_API_BASE = (function () {
  /* En el servidor público (despliegue/Caddyfile) la API vive en /api del
     mismo dominio, y así el sitio funciona sin ?api=. En el PC de desarrollo,
     con file:// o en Codespaces, se sigue asumiendo localhost:8000. */
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname) ||
              window.location.protocol === 'file:' ||
              /\.app\.github\.dev$/.test(window.location.hostname);
  var POR_DEFECTO = local ? 'http://localhost:8000' : window.location.origin + '/api';
  var CLAVE = 'terrafoco_api';

  var guardar = function (v) {
    try {
      if (v) localStorage.setItem(CLAVE, v); else localStorage.removeItem(CLAVE);
    } catch (e) { /* almacenamiento bloqueado: se sigue sin recordar */ }
  };

  var parametro = null;
  try {
    var q = new URLSearchParams(window.location.search);
    if (q.has('api')) parametro = q.get('api').replace(/\/+$/, '');
  } catch (e) { /* navegador sin URLSearchParams: se ignora */ }

  if (parametro !== null) {
    guardar(parametro);
    return parametro || POR_DEFECTO;
  }

  try {
    return localStorage.getItem(CLAVE) || POR_DEFECTO;
  } catch (e) {
    return POR_DEFECTO;
  }
})();


/* ==========================================================================
   Región activa

   Mismo mecanismo que la dirección de la API: un parámetro en la URL que se
   recuerda. El selector de la barra superior recarga la página con
   ?region=N en vez de repintar a medias, que es lo que obliga a mantener
   dos caminos —carga inicial y cambio— sincronizados para siempre.

   La lista de regiones NO vive aquí: se pide a /regiones. Agregar una
   región es insertar una fila, también para el front.
   ========================================================================== */

var GT_REGION = (function () {
  var POR_DEFECTO = 6;                    // O'Higgins, la región piloto
  var CLAVE = 'terrafoco_region';

  var leer = function () {
    try { return parseInt(localStorage.getItem(CLAVE), 10) || null; }
    catch (e) { return null; }
  };
  var guardar = function (v) {
    try {
      if (v) localStorage.setItem(CLAVE, String(v)); else localStorage.removeItem(CLAVE);
    } catch (e) { /* almacenamiento bloqueado: se sigue sin recordar */ }
  };

  try {
    var q = new URLSearchParams(window.location.search);
    if (q.has('region')) {
      var n = parseInt(q.get('region'), 10);
      guardar(n || null);
      return n || POR_DEFECTO;
    }
  } catch (e) { /* navegador sin URLSearchParams */ }

  return leer() || POR_DEFECTO;
})();


/* Arma la URL de un endpoint con la región activa ya puesta. Se usa en todas
   las llamadas para que cambiar de región no dependa de acordarse de añadir
   el parámetro en cada sitio. */
function GT_api(ruta, extra) {
  var url = GT_API_BASE + ruta;
  var partes = ['region=' + GT_REGION];
  if (extra) {
    Object.keys(extra).forEach(function (k) {
      if (extra[k] !== undefined && extra[k] !== null) {
        partes.push(encodeURIComponent(k) + '=' + encodeURIComponent(extra[k]));
      }
    });
  }
  return url + (url.indexOf('?') === -1 ? '?' : '&') + partes.join('&');
}
