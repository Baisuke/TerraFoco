# -*- coding: utf-8 -*-
"""
Peticiones de rango HTTP para el servidor estático de Python.

Las teselas del visor viven en un archivo PMTiles por capa, y el navegador
pide de ese archivo solo los bytes de las teselas que tiene en pantalla
(cabecera `Range`). nginx y GitHub Pages lo hacen solos; `http.server` no:
ignora la cabecera y devuelve el archivo entero con 200. El lector de
PMTiles lo rechaza, y el visor vuelve a los PNG por comuna sin avisar.

Aquí se agrega para un rango por petición, que es lo único que pide el
lector. Lo usan servir_prototipo.py y el lanzador de la copia portable.
"""
import http.server
import os
import re

_RANGO = re.compile(r"bytes=(\d*)-(\d*)$")


class ConRangos(http.server.SimpleHTTPRequestHandler):

    def send_head(self):
        self._restante = None
        cabecera = self.headers.get("Range")
        ruta = self.translate_path(self.path)
        m = _RANGO.match(cabecera.strip()) if cabecera else None
        if not m or os.path.isdir(ruta):
            return super().send_head()
        try:
            f = open(ruta, "rb")
        except OSError:
            self.send_error(404, "no encontrado")
            return None

        tamano = os.fstat(f.fileno()).st_size
        desde, hasta = m.groups()
        if desde == "":                          # "bytes=-N": los últimos N
            inicio, fin = max(0, tamano - int(hasta or 0)), tamano - 1
        else:
            inicio = int(desde)
            fin = min(int(hasta), tamano - 1) if hasta else tamano - 1
        if inicio >= tamano or inicio > fin:
            f.close()
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % tamano)
            self.end_headers()
            return None

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(ruta))
        self.send_header("Content-Range", "bytes %d-%d/%d" % (inicio, fin, tamano))
        self.send_header("Content-Length", str(fin - inicio + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        f.seek(inicio)
        self._restante = fin - inicio + 1
        return f

    def copyfile(self, source, outputfile):
        restante = getattr(self, "_restante", None)
        if restante is None:
            return super().copyfile(source, outputfile)
        while restante > 0:
            trozo = source.read(min(64 * 1024, restante))
            if not trozo:
                break
            outputfile.write(trozo)
            restante -= len(trozo)
