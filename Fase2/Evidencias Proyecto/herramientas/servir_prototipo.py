# -*- coding: utf-8 -*-
"""
Sirve el prototipo por HTTP, sin caché.

El prototipo funciona con doble clic, pero al desarrollar conviene servirlo:
`fetch()` no puede leer archivos locales desde file://. `python -m http.server`
sirve, salvo por un detalle que ya costó dos tardes: no manda Cache-Control,
y el navegador se queda con la versión vieja de un .js editado hace un minuto.

Uso:
    python herramientas/servir_prototipo.py prototipo 8081
"""
import functools
import http.server
import sys

from rangos import ConRangos


# Con rangos: sin ellos las teselas PMTiles no cargan (ver rangos.py).
class SinCache(ConRangos):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, *_):
        pass    # una línea por petición ensucia la terminal de la demo


def main():
    raiz = sys.argv[1] if len(sys.argv) > 1 else "prototipo"
    puerto = int(sys.argv[2]) if len(sys.argv) > 2 else 8081
    manejador = functools.partial(SinCache, directory=raiz)
    # Con hilos: el navegador abre conexiones por adelantado que a veces no
    # usa, y un servidor de un solo hilo se queda esperando en una de ellas
    # sin atender a nadie más (la página "carga" para siempre). El visor
    # además pide decenas de teselas a la vez.
    servidor = http.server.ThreadingHTTPServer
    servidor.daemon_threads = True
    servidor.allow_reuse_address = True
    with servidor(("0.0.0.0", puerto), manejador) as s:
        print("prototipo en http://localhost:%d  (Ctrl+C para detener)" % puerto)
        s.serve_forever()


if __name__ == "__main__":
    main()
