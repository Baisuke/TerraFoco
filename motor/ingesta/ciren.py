# -*- coding: utf-8 -*-
"""
Carga del Inventario Nacional de Erosión de CIREN como línea base.

CIREN ya calculó la erosión con RUSLE y publica el resultado por polígono, en
toneladas por hectárea y año. Cargarlo primero cumple dos funciones:

  1. Permite producir el índice de pertinencia SIN descargar imágenes
     satelitales, que es lo que destraba el proyecto.
  2. Es la vara contra la cual se valida el cálculo propio (UC-06).

NO hace falta bajar nada a mano. El inventario vive en un GeoNode con
GeoServer detrás, así que las capas se piden por WFS y entran directo a
PostGIS. Cada capa es una cuenca; O'Higgins tiene unas 50.

    https://inventarioerosion.ciren.cl

Campos que trae cada polígono:

    RUSLE      pérdida de suelo en ton/ha/año  <- el dato
    AREA_HA    superficie del polígono          <- el ponderador
    CLASEROS   clase de erosión de CIREN
    COD_REG    región (una cuenca puede cruzar dos)

Se procesa cuenca por cuenca y solo se conserva el agregado: los polígonos
crudos se descartan al terminar cada una. Son ~40.000 por cuenca y no aportan
nada una vez calculada la media comunal.

Uso:
    python -m ingesta.ciren --listar
    python -m ingesta.ciren --simular
    python -m ingesta.ciren --anio 2024
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

import config
from bd import Bitacora, conexion, obtener_region
from indicadores.rusle import clasificar

GEONODE = "https://inventarioerosion.ciren.cl"
API_CAPAS = GEONODE + "/api/layers/"
WFS = GEONODE + "/geoserver/wfs"

TABLA_CRUDA = "operacion.erosion_ciren_cruda"

# Polígonos que no son suelo -cuerpos de agua, roca, urbano- vienen con
# RUSLE = 0. Promediarlos hundiría la media de la comuna con superficie que
# nunca pudo erosionarse. Se excluyen del cálculo, no del registro.
CLASE_NO_SUELO = "NO SUELOS"


def capas_de_region(id_region, familia="rea"):
    """Capas del inventario para una región.

    familia: 'rea' = pérdida actual, 'rep' = potencial, 'grados' = clases.
    Se usa 'rea': el estado real del suelo, que es con lo que se compara la
    inversión. La potencial describe el riesgo si no hubiera cobertura.
    """
    filtro = "r%02d" % id_region
    url = API_CAPAS + "?" + urllib.parse.urlencode({
        "limit": 500, "alternate__icontains": filtro,
    })
    with urllib.request.urlopen(url, timeout=60) as r:
        datos = json.loads(r.read().decode("utf-8"))

    sufijo = "_%s_1ha" % familia if familia in ("rea", "rep") else "_grados_erosion"
    capas = []
    for o in datos.get("objects", []):
        alt = o.get("alternate") or ""
        if alt.endswith(sufijo):
            capas.append({"nombre": alt, "titulo": o.get("title") or ""})
    return sorted(capas, key=lambda c: c["nombre"])


def url_geojson(capa):
    return WFS + "?" + urllib.parse.urlencode({
        "service": "WFS", "version": "1.1.0", "request": "GetFeature",
        "typeName": capa, "outputFormat": "application/json",
        "srsName": "EPSG:%d" % config.EPSG_ALMACENAMIENTO,
    })


# El GeoServer de CIREN corta con 503 tras varias descargas seguidas. No es una
# caida: los fallos llegan en bloques consecutivos —14 a 23, 40 a 45— mientras
# las cuencas de alrededor responden. Es limitacion por rafaga, asi que se
# reintenta con espera creciente y se pausa entre cuencas.
REINTENTOS = 5
ESPERA_BASE = 20        # segundos; se multiplica por el numero de intento
PAUSA_ENTRE_CUENCAS = 3


def descargar(capa, destino):
    """Trae una cuenca completa a un archivo temporal, reintentando ante 503."""
    url = url_geojson(capa)
    ultimo = None

    for intento in range(1, REINTENTOS + 1):
        try:
            with urllib.request.urlopen(url, timeout=600) as r, \
                    open(destino, "wb") as f:
                total = 0
                while True:
                    trozo = r.read(1 << 20)
                    if not trozo:
                        break
                    f.write(trozo)
                    total += len(trozo)
            return total
        except urllib.error.HTTPError as e:
            ultimo = e
            if e.code not in (429, 500, 502, 503, 504):
                raise
        except Exception as e:
            ultimo = e

        if intento < REINTENTOS:
            espera = ESPERA_BASE * intento
            print("        reintento %d/%d en %ds (%s)"
                  % (intento, REINTENTOS - 1, espera,
                     getattr(ultimo, "code", type(ultimo).__name__)))
            sys.stdout.flush()
            time.sleep(espera)

    raise ultimo


def importar(archivo, tabla=TABLA_CRUDA):
    """Carga el GeoJSON en una tabla temporal, reemplazando la anterior."""
    subprocess.run([
        "ogr2ogr", "-f", "PostgreSQL", "PG:" + config.BD_URL, archivo,
        "-nln", tabla, "-t_srs", "EPSG:%d" % config.EPSG_ALMACENAMIENTO,
        "-nlt", "MULTIPOLYGON", "-lco", "GEOMETRY_NAME=geom", "-overwrite",
        "-lco", "SPATIAL_INDEX=GIST",
    ], check=True, capture_output=True)


def crear_mascara(referencia, destino, recrear=False):
    """Ráster vacío con la misma rejilla que el modelo de elevación.

    Debe compartir tamaño de celda, extensión y proyección con el DEM, porque
    después se combina celda a celda con los factores calculados sobre él.

    Si el archivo ya existe **no se toca**, salvo que se pida `recrear`. Eso
    permite reprocesar las cuencas que fallaron y sumarlas a la máscara que ya
    estaba, en vez de rehacer una hora de descargas por una capa caída.
    """
    import rasterio

    if os.path.exists(destino) and not recrear:
        with rasterio.open(destino) as m:
            print("[ciren] se continua sobre la mascara existente: %s (%d x %d)"
                  % (destino, m.width, m.height))
        return destino

    with rasterio.open(referencia) as ref:
        perfil = ref.profile.copy()
        perfil.update(dtype="uint8", count=1, nodata=0,
                      compress="DEFLATE", tiled=True)
        forma = (ref.height, ref.width)

    import numpy as np
    with rasterio.open(destino, "w", **perfil) as salida:
        salida.write(np.zeros(forma, dtype="uint8"), 1)
    print("[ciren] mascara creada: %s  (%d x %d)" % (destino, forma[1], forma[0]))
    return destino


def quemar_en_mascara(geojson, mascara, epsg_destino, campo_clase="CLASEROS"):
    """Marca con 1 las celdas que CIREN evaluó como suelo, en esta cuenca.

    Se excluyen los polígonos de 'NO SUELOS' —agua, roca, urbano—: son
    justamente los que no deben entrar al promedio.

    Se rasteriza en vez de unir geometrías en PostGIS. Un ST_Union sobre los
    ~40.000 polígonos de cada cuenca, cincuenta veces, tardaría mucho más y el
    resultado se usa igual como máscara sobre una rejilla.
    """
    filtrado = geojson + ".mask.gpkg"
    try:
        subprocess.run([
            "ogr2ogr", "-f", "GPKG", filtrado, geojson,
            "-t_srs", "EPSG:%d" % epsg_destino,
            "-where", "%s <> '%s'" % (campo_clase, CLASE_NO_SUELO),
            "-nln", "suelo", "-overwrite",
        ], check=True, capture_output=True)

        subprocess.run([
            "gdal_rasterize", "-l", "suelo", "-burn", "1",
            filtrado, mascara,
        ], check=True, capture_output=True)
    finally:
        if os.path.exists(filtrado):
            os.remove(filtrado)


SQL_AGREGAR = """
WITH recorte AS (
    SELECT c.id_comuna,
           c.id_region,
           e.rusle::numeric  AS rusle,
           -- No se usa AREA_HA del origen: ese es el area del poligono
           -- completo, y aqui interesa solo la parte que cae en la comuna.
           ST_Area(ST_Intersection(e.geom, c.geom)::geography) / 10000.0 AS ha
    FROM   {tabla} e
    JOIN   territorio.comuna c
           ON  c.id_region = %(region)s
           AND ST_Intersects(e.geom, c.geom)
    WHERE  e.rusle IS NOT NULL
      AND  upper(btrim(e.claseros)) <> %(no_suelo)s
)
SELECT id_comuna,
       id_region,
       SUM(rusle * ha) AS ponderado,
       SUM(ha)         AS ha
FROM   recorte
WHERE  ha > 0
GROUP  BY id_comuna, id_region
"""


def agregar(con, id_region, tabla=TABLA_CRUDA):
    filas = con.execute(
        SQL_AGREGAR.format(tabla=tabla),
        {"region": id_region, "no_suelo": CLASE_NO_SUELO},
    ).fetchall()
    return {f[0]: {"id_region": f[1], "ponderado": float(f[2]), "ha": float(f[3])}
            for f in filas}


def acumular(total, parcial):
    """Suma los aportes de una cuenca a lo que ya se llevaba.

    Una comuna recibe polígonos de varias cuencas; el promedio final se calcula
    al terminar todas, sobre la suma de numeradores y denominadores. Promediar
    promedios por cuenca daría un valor distinto y equivocado.
    """
    for id_comuna, d in parcial.items():
        acc = total.setdefault(id_comuna, {"id_region": d["id_region"],
                                           "ponderado": 0.0, "ha": 0.0})
        acc["ponderado"] += d["ponderado"]
        acc["ha"] += d["ha"]


SQL_INSERTAR = """
INSERT INTO indicadores.erosion
    (id_region, id_comuna, anio, factor_r, factor_k, factor_ls, factor_c,
     factor_p, perdida_ton_ha, clase, origen)
VALUES
    (%(id_region)s, %(id_comuna)s, %(anio)s, 1, 0.00001, 1, 1, 1,
     %(perdida)s, %(clase)s, 'CIREN')
"""


def guardar(con, resultados, anio):
    """Inserta la línea base.

    Los factores van en 1 -y K en su mínimo positivo- porque CIREN publica el
    resultado agregado, no la descomposición; el CHECK del esquema exige que
    sean positivos. Lo que distingue estas filas es origen='CIREN'.

    La clase se deriva del valor con la MISMA función que usa el cálculo
    propio, en vez de copiar la etiqueta de CIREN. Así ambos orígenes quedan
    en una sola escala y compararlos (UC-06) significa algo.
    """
    n = 0
    for id_comuna, d in sorted(resultados.items()):
        if d["ha"] <= 0:
            continue
        perdida = round(d["ponderado"] / d["ha"], 2)
        con.execute(SQL_INSERTAR, {
            "id_region": d["id_region"], "id_comuna": id_comuna, "anio": anio,
            "perdida": perdida, "clase": clasificar(perdida),
        })
        n += 1
    return n


def main():
    p = argparse.ArgumentParser(description="Carga la línea base de erosión de CIREN")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--anio", type=int, default=2024,
                   help="año que se atribuye al inventario cargado")
    p.add_argument("--familia", default="rea", choices=("rea", "rep"),
                   help="rea = pérdida actual (por defecto), rep = potencial")
    p.add_argument("--listar", action="store_true",
                   help="solo mostrar las capas disponibles y salir")
    p.add_argument("--limite", type=int, default=0,
                   help="procesar solo las primeras N cuencas (para probar)")
    p.add_argument("--aceptar-parcial", action="store_true",
                   help="guardar aunque falle alguna cuenca (por defecto no se guarda)")
    p.add_argument("--simular", action="store_true",
                   help="calcula y muestra, pero no escribe el resultado")
    p.add_argument("--mascara", default=None,
                   help="ruta del raster de mascara a construir (opcional)")
    p.add_argument("--referencia", default="/datos/srtm/dem_utm.tif",
                   help="raster cuya rejilla hereda la mascara")
    p.add_argument("--recrear-mascara", action="store_true",
                   help="empezar la mascara de cero en vez de continuarla")
    p.add_argument("--capas", default=None,
                   help="procesar solo estas capas, separadas por coma")
    args = p.parse_args()

    capas = capas_de_region(args.region, args.familia)
    if not capas:
        raise SystemExit("No se encontraron capas '%s' para la region %d"
                         % (args.familia, args.region))

    if args.listar:
        print("%d capas para la region %d:" % (len(capas), args.region))
        for c in capas:
            print("   %-30s %s" % (c["nombre"], c["titulo"][:70]))
        return 0

    if args.capas:
        pedidas = {c.strip() for c in args.capas.split(",") if c.strip()}
        capas = [c for c in capas if c["nombre"] in pedidas
                 or c["nombre"].split(":")[-1] in pedidas]
        if not capas:
            raise SystemExit("Ninguna capa coincide con: %s" % args.capas)
    if args.limite:
        capas = capas[:args.limite]

    region = obtener_region(args.region)
    total = {}
    fallidas = []

    if args.mascara:
        if not os.path.exists(args.referencia):
            raise SystemExit(
                "No existe el raster de referencia: %s"
                " — generarlo con: python -m ingesta.srtm --solo-preparar"
                % args.referencia)
        crear_mascara(args.referencia, args.mascara, args.recrear_mascara)

    with Bitacora("Ingesta CIREN — %s" % region.nombre, fuente="ciren") as b:
        for i, capa in enumerate(capas, 1):
            print("\n[ciren] %d/%d  %s" % (i, len(capas), capa["nombre"]))
            tmp = os.path.join(tempfile.gettempdir(), "ciren.geojson")
            try:
                mb = descargar(capa["nombre"], tmp) / 1e6
                print("        descargado %.1f MB" % mb)
                importar(tmp)
                with conexion() as con:
                    parcial = agregar(con, args.region)
                acumular(total, parcial)
                print("        %d comunas con aporte" % len(parcial))
                if args.mascara:
                    quemar_en_mascara(tmp, args.mascara, region.epsg_trabajo)
            except Exception as e:
                # Una cuenca caída no puede tumbar la carga completa: se anota
                # y se sigue. Al final se informa cuáles faltaron.
                print("        FALLO: %s: %s" % (type(e).__name__, e))
                fallidas.append(capa["nombre"])
            finally:
                if os.path.exists(tmp):
                    os.remove(tmp)
            # Respiro entre cuencas: sin esto el servidor vuelve a cortar
            # aunque cada descarga individual haya funcionado.
            if i < len(capas):
                time.sleep(PAUSA_ENTRE_CUENCAS)

        # Cobertura: el inventario no cubre toda la comuna -deja fuera alta
        # cordillera y zonas no agricolas-, asi que el promedio se calcula
        # sobre una fraccion. Con cobertura baja el valor no es representativo
        # y hay que decirlo, no promediar y callar.
        with conexion() as con:
            nombres = dict(con.execute(
                "SELECT id_comuna, nombre FROM territorio.comuna "
                "WHERE id_region = %s", (args.region,)).fetchall())
            superficies = dict(con.execute(
                "SELECT id_comuna, superficie_km2 * 100 FROM territorio.comuna "
                "WHERE id_region = %s", (args.region,)).fetchall())

        print("\n[ciren] %d de %d comunas con erosion agregada"
              % (len(total), len(nombres)))
        print("\n        %-20s %10s %10s %8s" % ("comuna", "t/ha/anio", "ha", "cobert."))
        escasas = []
        for id_comuna, d in sorted(total.items(),
                                   key=lambda x: -x[1]["ponderado"] / x[1]["ha"]):
            total_ha = float(superficies.get(id_comuna) or 0)
            cob = (100.0 * d["ha"] / total_ha) if total_ha else 0.0
            if cob < 20.0:
                escasas.append((nombres.get(id_comuna, id_comuna), cob))
            print("        %-20s %10.2f %10.1f %7.0f%%"
                  % (nombres.get(id_comuna, id_comuna)[:20],
                     d["ponderado"] / d["ha"], d["ha"], cob))

        faltantes = sorted(set(nombres) - set(total))
        if faltantes:
            print("\n[ciren] %d comunas SIN dato: %s"
                  % (len(faltantes),
                     ", ".join(nombres[i] for i in faltantes[:6])))
        if escasas:
            print("\n[ciren] %d comunas con menos del 20%% de cobertura; su "
                  "promedio no es representativo:" % len(escasas))
            for nom, cob in escasas:
                print("          %-24s %.0f%%" % (nom, cob))
        if fallidas:
            print("\n[ciren] %d cuencas fallidas: %s"
                  % (len(fallidas), ", ".join(fallidas[:5])))

        if args.simular:
            print("\n[ciren] --simular: no se escribio nada.")
            b.simulada = True
            b.registros = 0
        elif fallidas and not args.aceptar_parcial:
            # Cada corrida inserta filas nuevas y la vista toma la más
            # reciente: una corrida con una cuenca caída reemplazaba en
            # silencio a una completa. San Vicente tenía 12,5 t/ha/año y la
            # corrida completa del 25-09 lo dejó en 16,0. El programador la
            # relanza sola, así que aquí se prefiere fallar y conservar lo que
            # había; el error queda en la bitácora de Fuentes.
            raise SystemExit("[ciren] no se guarda: %d cuencas fallaron (%s). La línea "
                             "base anterior se conserva. Reintentar, o --aceptar-parcial."
                             % (len(fallidas), ", ".join(fallidas[:5])))
        else:
            with conexion() as con:
                b.registros = guardar(con, total, args.anio)
            print("\n[ciren] %d filas insertadas con origen='CIREN'" % b.registros)

    return 0


if __name__ == "__main__":
    sys.exit(main())
