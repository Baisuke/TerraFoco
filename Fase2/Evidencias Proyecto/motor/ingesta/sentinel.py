# -*- coding: utf-8 -*-
"""
NDVI por comuna desde Sentinel-2, calculado en el servidor de Copernicus.

El factor C de RUSLE necesita el NDVI. La vía obvia —descargar las escenas
completas y procesarlas acá— significa varios gigabytes por fecha para cubrir
la región, y mucho más para una serie temporal. En un equipo de estudiante eso
son días de descarga.

La **Process API** de Sentinel Hub calcula el índice del lado del servidor y
devuelve una imagen ya recortada a la comuna, de unos cientos de kilobytes.
Se compone el mosaico, se descartan las nubes y se calcula el NDVI allá; acá
solo se promedia. Minutos en vez de días.

POR QUÉ NO LA STATISTICAL API
-----------------------------
Sería más directa —devuelve el promedio sin imagen de por medio— pero en esta
cuenta responde `{"data": []}` con estado 200 para consultas que sí tienen
escenas disponibles: se verificó contra el Catalog API que había 5 escenas con
menos de 4% de nubes en el mismo período y área. Al no dar error, el fallo es
silencioso. La Process API sí responde, así que se usa esa y se agrega acá.

DECISIONES DEL CÁLCULO
----------------------
· **Nubes.** Se descartan con la máscara de escena (SCL) del producto L2A. Una
  nube tiene NDVI bajo y, sin enmascarar, se confundiría con suelo desnudo:
  el error apuntaría justo hacia donde el proyecto mira.
· **Mediana, no promedio.** Una nube que sobrevive al filtro arrastra el
  promedio, pero casi no mueve la mediana.
· **Mosaico por menor nubosidad.** De todas las escenas del período, el
  servidor compone la menos nublada por píxel.

Credenciales: SH_CLIENT_ID y SH_CLIENT_SECRET, del panel de CDSE.

Uso:
    python -m ingesta.sentinel --probar
    python -m ingesta.sentinel --desde 2024-11-01 --hasta 2025-02-28
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

import numpy as np

import config
from bd import Bitacora, obtener_region
from indicadores.rusle import factor_C
from ingesta.zonal import geometrias_comunas

TOKEN_URL = ("https://identity.dataspace.copernicus.eu"
             "/auth/realms/CDSE/protocol/openid-connect/token")
PROCESO_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"

# Sentinel Hub no entrega imagenes de mas de 2500 px por lado.
LADO_MAXIMO = 2500

# Clases de la mascara de escena de Sentinel-2 L2A que NO son suelo observable.
# Se conservan solo 4 (vegetacion), 5 (suelo sin vegetacion) y 7 (sin clasificar):
#
#   0  sin dato            2  sombra de relieve    3  sombra de nube
#   1  saturado            6  AGUA                 8  nube probable
#   9  nube alta prob.    10  cirros              11  nieve y hielo
#
# El 6 y el 2 se agregaron despues de ver NDVI de -1,00 en los rasteres: son
# agua y sombra. Un pixel de agua tiene NDVI negativo y `factor_C` lo lee como
# suelo desnudo, es decir erosion maxima sobre un embalse. La mascara de CIREN
# tapaba el problema donde se aplicaba, pero el error estaba en la fuente.
SCL_DESCARTADAS = (0, 1, 2, 3, 6, 8, 9, 10, 11)

EVALSCRIPT = """//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    output: { bands: 2, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(s) {
  // Banda 1: NDVI.  Banda 2: 1 si el pixel sirve, 0 si no.
  var malo = %(descartadas)s.indexOf(s.SCL) >= 0;
  var ok = (s.dataMask === 1 && !malo) ? 1 : 0;
  var d = s.B08 + s.B04;
  return [ d === 0 ? 0 : (s.B08 - s.B04) / d, ok ];
}
""" % {"descartadas": json.dumps(list(SCL_DESCARTADAS))}


def obtener_token():
    """Token OAuth2 por client_credentials. Dura unos minutos."""
    config.exigir("sentinel_hub")
    datos = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": config.SH_CLIENT_ID,
        "client_secret": config.SH_CLIENT_SECRET,
    }).encode()
    pet = urllib.request.Request(TOKEN_URL, data=datos)
    with urllib.request.urlopen(pet, timeout=60) as r:
        return json.loads(r.read().decode())["access_token"]


def limites(geometria):
    """Envolvente de un Polygon o MultiPolygon GeoJSON."""
    xs, ys = [], []

    def recorrer(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        else:
            for sub in c:
                recorrer(sub)

    recorrer(geometria["coordinates"])
    return min(xs), min(ys), max(xs), max(ys)


def dimensiones(bbox, resolucion_m):
    """Ancho y alto en pixeles, respetando el tope del servicio.

    Si la comuna es tan grande que a la resolucion pedida superaria el limite,
    se degrada la resolucion en vez de fallar: para un promedio comunal, 100 m
    en lugar de 60 no cambia la conclusion, y quedarse sin dato sí.
    """
    minx, miny, maxx, maxy = bbox
    ancho = max(1, int(round((maxx - minx) / resolucion_m)))
    alto = max(1, int(round((maxy - miny) / resolucion_m)))
    if max(ancho, alto) > LADO_MAXIMO:
        escala = LADO_MAXIMO / float(max(ancho, alto))
        ancho = max(1, int(ancho * escala))
        alto = max(1, int(alto * escala))
    return ancho, alto


def peticion(bbox, epsg, ancho, alto, desde, hasta):
    return {
        "input": {
            "bounds": {
                "bbox": list(bbox),
                "properties": {
                    "crs": "http://www.opengis.net/def/crs/EPSG/0/%d" % epsg},
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {"from": desde + "T00:00:00Z",
                                  "to": hasta + "T23:59:59Z"},
                    "mosaickingOrder": "leastCC",
                },
            }],
        },
        "output": {
            "width": ancho, "height": alto,
            "responses": [{"identifier": "default",
                           "format": {"type": "image/tiff"}}],
        },
        "evalscript": EVALSCRIPT,
    }


def pedir_imagen(token, cuerpo):
    pet = urllib.request.Request(
        PROCESO_URL, data=json.dumps(cuerpo).encode(),
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(pet, timeout=300) as r:
        return r.read()


def remuestrear_mascara(ruta_mascara, bbox, epsg, forma, transform):
    """Trae la máscara de CIREN a la rejilla de la imagen de Sentinel.

    Las dos rejillas no coinciden: la máscara está a 30 m heredada del modelo
    de elevación y la imagen se pide a 60 m sobre la envolvente de la comuna.
    Se remuestrea por vecino más cercano, que es lo correcto para una máscara:
    interpolar valores 0/1 produciría fracciones sin significado.
    """
    import rasterio
    from rasterio.warp import Resampling, reproject

    destino = np.zeros(forma, dtype="uint8")
    with rasterio.open(ruta_mascara) as m:
        reproject(source=rasterio.band(m, 1), destination=destino,
                  src_transform=m.transform, src_crs=m.crs,
                  dst_transform=transform, dst_crs=m.crs,
                  resampling=Resampling.nearest)
    return destino == 1


NODATO = -9999.0

# Por debajo de esto el pixel no es suelo: es agua, sombra profunda o un
# artefacto del sensor. No se promedia ni se guarda.
UMBRAL_NDVI = -0.05


def guardar_ndvi(ruta, ndvi, util, epsg, transform):
    """Escribe el NDVI por píxel, con nodato donde no hay dato válido.

    Se guarda el NDVI y no el factor C: C se deriva de él con una fórmula fija,
    así que conservar la medición deja la puerta abierta a recalcular C con
    otros coeficientes sin volver a pedir las imágenes.

    Esta es la pieza que habilita el detalle intracomunal. Hasta ahora la
    imagen se pedía, se promediaba y se descartaba: el promedio de una comuna
    esconde justamente lo que hay que focalizar, porque el programa bonifica
    predios y no comunas.
    """
    import rasterio

    salida = np.where(util, ndvi, NODATO).astype("float32")
    perfil = {
        "driver": "GTiff", "height": salida.shape[0], "width": salida.shape[1],
        "count": 1, "dtype": "float32", "crs": "EPSG:%d" % epsg,
        "transform": transform, "nodata": NODATO,
        "compress": "DEFLATE", "tiled": True,
    }
    with rasterio.open(ruta, "w", **perfil) as d:
        d.write(salida, 1)
    return os.path.getsize(ruta)


def ndvi_de_comuna(token, geometria, epsg, desde, hasta, resolucion_m,
                   ruta_mascara=None, guardar_en=None):
    """NDVI mediano dentro de la comuna. Devuelve None si no quedan pixeles."""
    from rasterio.io import MemoryFile
    from rasterio.features import geometry_mask
    from rasterio.transform import from_bounds

    bbox = limites(geometria)
    ancho, alto = dimensiones(bbox, resolucion_m)
    datos = pedir_imagen(token, peticion(bbox, epsg, ancho, alto, desde, hasta))

    with MemoryFile(datos) as m, m.open() as ds:
        banda = ds.read()

    ndvi, valido = banda[0], banda[1]

    # El servicio devuelve el rectangulo envolvente; hay que recortar a la
    # comuna o entrarian pixeles de las vecinas. La transformacion se arma
    # desde el bbox pedido, que es exactamente el del rectangulo devuelto.
    transform = from_bounds(bbox[0], bbox[1], bbox[2], bbox[3], ancho, alto)
    dentro = geometry_mask([geometria], out_shape=ndvi.shape,
                           transform=transform, invert=True)
    celdas_comuna = int(dentro.sum())

    # Restringe a la superficie que CIREN evalua como suelo, para que el factor
    # C describa el mismo territorio que el LS y que la linea base.
    if ruta_mascara:
        dentro = dentro & remuestrear_mascara(ruta_mascara, bbox, epsg,
                                              ndvi.shape, transform)

    # Un NDVI negativo sobre suelo no existe: el suelo desnudo mas seco ronda
    # 0,05. Los -1,00 que aparecen son artefactos -infrarrojo en cero- o agua
    # que la mascara de escena no alcanzo a clasificar. Descartarlos importa
    # porque `factor_C` los leeria como suelo desnudo, o sea erosion maxima
    # justo donde no hay suelo.
    util = dentro & (valido == 1) & np.isfinite(ndvi) & (ndvi > UMBRAL_NDVI)
    n = int(util.sum())
    if n == 0:
        return None

    peso = None
    if guardar_en:
        peso = guardar_ndvi(guardar_en, ndvi, util, epsg, transform)

    v = ndvi[util]
    return {"mediana": float(np.median(v)),
            "media": float(v.mean()),
            "pixeles": n,
            "cobertura": float(n) / max(1, celdas_comuna),
            "resolucion_m": abs(transform.a),
            "raster_bytes": peso}


def main():
    p = argparse.ArgumentParser(description="NDVI por comuna desde Sentinel-2")
    p.add_argument("--desde", default="2024-11-01")
    p.add_argument("--hasta", default="2025-02-28")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--limite", type=int, default=0,
                   help="procesar solo las primeras N comunas")
    p.add_argument("--resolucion", type=int, default=60,
                   help="metros por pixel; 60 basta para el promedio comunal")
    p.add_argument("--raster-dir", default=None,
                   help="carpeta donde guardar el NDVI por pixel de cada comuna; "
                        "habilita el detalle intracomunal")
    p.add_argument("--mascara", default=None,
                   help="raster de mascara; limita el calculo a esa superficie")
    p.add_argument("--cobertura-minima", type=float, default=0.30,
                   help="fraccion minima de la comuna para guardar el valor")
    p.add_argument("--guardar", action="store_true",
                   help="escribir el factor C en indicadores.factor")
    p.add_argument("--probar", action="store_true",
                   help="solo pedir el token y salir")
    args = p.parse_args()

    if args.probar:
        obtener_token()
        print("[sentinel] token obtenido: las credenciales de Sentinel Hub sirven.")
        return 0

    region = obtener_region(args.region)
    # Geometria PROYECTADA: en grados, la resolucion se interpreta en grados.
    geometrias = geometrias_comunas(args.region, region.epsg_trabajo)
    if args.limite:
        geometrias = geometrias[:args.limite]

    print("[sentinel] %s — %d comunas, periodo %s a %s, %d m/pixel"
          % (region.nombre, len(geometrias), args.desde, args.hasta,
             args.resolucion))

    token = obtener_token()
    resultados, fallidas = {}, []

    with Bitacora("Ingesta NDVI Sentinel-2 — %s" % region.nombre, fuente="sentinel2") as b:
        for i, (id_comuna, nombre, geo) in enumerate(geometrias, 1):
            try:
                destino = None
                if args.raster_dir:
                    os.makedirs(args.raster_dir, exist_ok=True)
                    destino = os.path.join(args.raster_dir,
                                           "ndvi_%d.tif" % id_comuna)
                d = ndvi_de_comuna(token, geo, region.epsg_trabajo,
                                   args.desde, args.hasta, args.resolucion,
                                   args.mascara, destino)
            except urllib.error.HTTPError as e:
                print("  %2d/%d  %-20s FALLO %s: %s"
                      % (i, len(geometrias), nombre[:20], e.code,
                         e.read().decode()[:120]))
                fallidas.append(nombre)
                continue
            except Exception as e:
                print("  %2d/%d  %-20s FALLO %s: %s"
                      % (i, len(geometrias), nombre[:20], type(e).__name__,
                         str(e)[:80]))
                fallidas.append(nombre)
                continue

            if d is None:
                print("  %2d/%d  %-20s sin pixeles utiles (nubosidad total)"
                      % (i, len(geometrias), nombre[:20]))
                fallidas.append(nombre)
                continue

            d["nombre"] = nombre
            d["C"] = factor_C(max(-1.0, min(1.0, d["mediana"])))
            resultados[id_comuna] = d
            print("  %2d/%d  %-20s NDVI %.3f -> C %.3f  (%d px, %.0f%% util)"
                  % (i, len(geometrias), nombre[:20], d["mediana"], d["C"],
                     d["pixeles"], 100 * d["cobertura"]))
            sys.stdout.flush()

        b.registros = len(resultados)

    if resultados:
        cs = sorted(d["C"] for d in resultados.values())
        print("\n[sentinel] %d comunas — C entre %.3f y %.3f (mediana %.3f)"
              % (len(cs), cs[0], cs[-1], cs[len(cs) // 2]))
        pobres = [d["nombre"] for d in resultados.values() if d["cobertura"] < 0.5]
        if pobres:
            print("[sentinel] %d comunas con menos del 50%% de pixeles utiles: %s"
                  % (len(pobres), ", ".join(pobres[:6])))
    if fallidas:
        print("[sentinel] %d fallidas: %s" % (len(fallidas), ", ".join(fallidas[:6])))

    if args.guardar and resultados:
        from indicadores.almacen import guardar
        aptos = {k: d for k, d in resultados.items()
                 if d["cobertura"] >= args.cobertura_minima}
        pobres = {k: d for k, d in resultados.items() if k not in aptos}
        if pobres:
            print("[sentinel] %d comunas NO se guardan por cobertura baja:"
                  % len(pobres))
            for d in sorted(pobres.values(), key=lambda x: x["cobertura"]):
                print("             %-22s %.1f%%" % (d["nombre"][:22],
                                                    100 * d["cobertura"]))
        if not aptos:
            print("[sentinel] ninguna comuna supera la cobertura minima.")
            return 1
        resultados = aptos
        valores = {k: d["C"] for k, d in resultados.items()}
        detalles = {k: {"ndvi_mediana": round(d["mediana"], 4),
                        "pixeles": d["pixeles"],
                        "cobertura": round(d["cobertura"], 3),
                        "periodo": "%s/%s" % (args.desde, args.hasta),
                        "resolucion_m": args.resolucion}
                    for k, d in resultados.items()}
        anio = int(args.hasta[:4])
        n, descartados = guardar(args.region, valores, "C", anio,
                                 "Sentinel-2 L2A", detalles)
        print("[sentinel] %d factores C guardados" % n)
        if descartados:
            # C = 0 ocurre con NDVI = 1, que en la practica no pasa; si pasa,
            # es un pixel anomalo y hay que verlo, no guardarlo en silencio.
            print("[sentinel] %d descartados por C no positivo: %s"
                  % (len(descartados), descartados[:5]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
