# -*- coding: utf-8 -*-
"""
Copia el codigo de este repositorio a la estructura de entrega APT122.

Se trabaja aqui, con todo a la vista en la raiz. La entrega academica exige
una estructura de carpetas por fase que es incomoda para desarrollar, asi que
se genera desde aqui antes de cada entrega.

    terrafoco/                 ->  TERRAFOCO-APT122/Fase 2/Evidencias Proyecto/
      motor/                         Evidencias de sistema/Aplicacion/motor/
      api/                           Evidencias de sistema/Aplicacion/api/
      prototipo/                     Evidencias de sistema/Aplicacion/prototipo/
      bd/                            Evidencias de sistema/Base de datos/
      docs/                          Evidencias de documentacion/docs/

LA COPIA VA EN UN SOLO SENTIDO
------------------------------
De aqui hacia la entrega, nunca al reves. Editar en el destino y sincronizar
despues borraria ese trabajo sin aviso. Por eso cada carpeta copiada recibe un
archivo GENERADO.md que lo dice.

El .env NUNCA se copia: tiene credenciales y no debe salir de este equipo.

Uso:
    python herramientas/sincronizar.py --simular
    python herramientas/sincronizar.py
"""
import argparse
import os
import shutil
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DESTINO_POR_DEFECTO = os.path.join(
    os.path.expanduser("~"), "OneDrive", "Desktop", "Capstone", "TERRAFOCO-APT122")

APLICACION = os.path.join("Fase 2", "Evidencias Proyecto",
                          "Evidencias de sistema", "Aplicación")
SISTEMA = os.path.join("Fase 2", "Evidencias Proyecto", "Evidencias de sistema")
DOCUMENTACION = os.path.join("Fase 2", "Evidencias Proyecto",
                             "Evidencias de documentación")

# origen relativo -> destino relativo dentro del repositorio de entrega
CARPETAS = [
    ("motor",     os.path.join(APLICACION, "motor")),
    ("api",       os.path.join(APLICACION, "api")),
    ("prototipo", os.path.join(APLICACION, "prototipo")),
    ("bd",        os.path.join(SISTEMA, "Base de datos")),
    ("docs",      os.path.join(DOCUMENTACION, "docs")),
]

ARCHIVOS = [
    ("docker-compose.yml", os.path.join(APLICACION, "docker-compose.yml")),
    (".env.ejemplo",       os.path.join(APLICACION, ".env.ejemplo")),
]

# Nunca se copian: credenciales, artefactos de ejecucion y basura de editor.
EXCLUIR = shutil.ignore_patterns(
    ".env", "__pycache__", "*.pyc", ".pytest_cache", ".ruff_cache",
    "*.tif", "*.tiff", "*.zip", "*.nc", "*.hgt",
    ".DS_Store", "Thumbs.db", "desktop.ini",
)

AVISO = """<!-- GENERADO AUTOMATICAMENTE -->

# No editar aqui

El contenido de esta carpeta se copia desde el repositorio de desarrollo
`terrafoco` con `python herramientas/sincronizar.py`.

Cualquier cambio hecho directamente aqui **se pierde** en la siguiente
sincronizacion. Editar alla y volver a sincronizar.
"""


def medir(ruta):
    total = archivos = 0
    for base, _dirs, nombres in os.walk(ruta):
        for n in nombres:
            try:
                total += os.path.getsize(os.path.join(base, n))
                archivos += 1
            except OSError:
                pass
    return archivos, total


def main():
    p = argparse.ArgumentParser(
        description="Sincroniza el codigo hacia la entrega APT122")
    p.add_argument("--destino", default=DESTINO_POR_DEFECTO)
    p.add_argument("--simular", action="store_true",
                   help="mostrar que se copiaria, sin tocar nada")
    args = p.parse_args()

    if not os.path.isdir(args.destino):
        raise SystemExit(
            "No existe el repositorio de entrega:\n  %s\n"
            "Indicar la ruta con --destino." % args.destino)

    print("origen : %s" % RAIZ)
    print("destino: %s" % args.destino)
    print("modo   : %s\n" % ("simulacion" if args.simular else "copia real"))

    for origen_rel, destino_rel in CARPETAS:
        origen = os.path.join(RAIZ, origen_rel)
        destino = os.path.join(args.destino, destino_rel)
        if not os.path.isdir(origen):
            print("  %-12s FALTA en el origen, se omite" % origen_rel)
            continue

        n, bytes_ = medir(origen)
        print("  %-12s %4d archivos  %7.1f MB  ->  %s"
              % (origen_rel, n, bytes_ / 1e6, destino_rel))

        if args.simular:
            continue

        # Se borra el destino antes de copiar: si no, los archivos que se
        # eliminaron en el origen sobrevivirian ahi para siempre.
        if os.path.isdir(destino):
            shutil.rmtree(destino)
        shutil.copytree(origen, destino, ignore=EXCLUIR)
        with open(os.path.join(destino, "GENERADO.md"), "w",
                  encoding="utf-8") as f:
            f.write(AVISO)

    for origen_rel, destino_rel in ARCHIVOS:
        origen = os.path.join(RAIZ, origen_rel)
        if not os.path.isfile(origen):
            continue
        destino = os.path.join(args.destino, destino_rel)
        print("  %-12s %31s  ->  %s"
              % (origen_rel, "", os.path.basename(destino_rel)))
        if not args.simular:
            os.makedirs(os.path.dirname(destino), exist_ok=True)
            shutil.copy2(origen, destino)

    if args.simular:
        print("\nNada se copio. Quitar --simular para hacerlo.")
    else:
        print("\nListo. Revisar con 'git status' en el repositorio de entrega")
        print("antes de hacer commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
