# -*- coding: utf-8 -*-
"""
Índice de susceptibilidad a inundación: la combinación de las seis variables.

Se calcula POR PÍXEL, a 30 m, y después se agrega por comuna. No al revés.
La razón es que dos de las variables no sobreviven al promedio comunal: la
curvatura media de 300.000 celdas es cero porque lo cóncavo y lo convexo se
cancelan, y la acumulación media la dominan las laderas. A nivel de celda
ambas discriminan; a nivel de comuna, no. Combinando primero y agregando
después, la comuna hereda la señal en vez de perderla.

Modelo: suma ponderada de las variables normalizadas a 0-1. Cada variable
tiene un sentido: DIRECTA si más valor es más susceptibilidad (acumulación,
TWI); INVERSA si es menos (pendiente, distancia a cauces, curvatura,
cobertura). Las inversas se voltean antes de sumar.

Los pesos son los CALIBRADOS en la iteración 2, no los a priori del
prototipo. La validación contra los 63 eventos de DesInventar mostró que,
a escala comunal, solo acumulación de flujo y curvatura correlacionan con
los eventos (Spearman +0,37 y -0,39); pendiente correlaciona al revés
(+0,28) y las otras tres no correlacionan. Con los pesos a priori el índice
ordenaba las comunas peor que el azar (rho -0,16). Con acumulación y
curvatura al 50/50, rho +0,41, y +0,46 sin el año 1982 que concentra la
mitad de los eventos. Los juegos intermedios se probaron y quedaron entre
ambos: cuanto menos peso llevan las cuatro sin señal, mejor ordena. El
banco de pruebas es indicadores.recalibrar_inundacion.

La pendiente no se pierde: está dentro del TWI y la curvatura es su segunda
derivada. No era información independiente.

La normalización recorta a los percentiles 2 y 98 antes de escalar. Sin eso
una celda con pendiente 443% —un acantilado del modelo de elevación— fija
el máximo y aplasta al resto del territorio contra el cero.

Las clases son CUARTILES, no intervalos fijos. Con los pesos calibrados las
medias comunales caen entre 0,34 y 0,38 y unos cortes en 0,25/0,50/0,75
meterían todo en "Media". A nivel de píxel cada clase es un cuarto del
territorio de la región; a nivel comunal, un cuarto de las comunas. Es una
clase relativa —"el cuarto más susceptible"— y se declara así. Los cortes
se guardan con el resultado.

    python -m indicadores.inundacion            # calcula, escribe y guarda
    python -m indicadores.inundacion --simular  # calcula y resume
    python -m indicadores.inundacion --revisar  # muestra el ranking guardado

El resultado por comuna va a `indicadores.susceptibilidad_inundacion` con
`calibrado = FALSE` hasta que se contraste con los eventos históricos de
DesInventar. Un índice no calibrado se muestra igual, y se declara.
"""
import argparse
import glob
import os
import sys

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.merge import merge
from rasterio.warp import Resampling, reproject

import config
from bd import Bitacora, conexion, obtener_region
from indicadores.almacen import INUNDACION
from ingesta.hidrologia import DIR_SALIDA, escribir
from ingesta.zonal import geometrias_comunas

# --------------------------------------------------------------------------
# El modelo
# --------------------------------------------------------------------------

# Pesos en porcentaje y sentido. Espejo de GT.variablesInundacion en el
# prototipo: si cambian aquí, cambian allá. +1 directa, -1 inversa.
# Las seis se calculan y se guardan siempre —son las capas del módulo—;
# el peso dice cuáles entran al índice.
VARIABLES = (
    #  nombre              peso  sentido  archivo
    ("pendiente",            0,   -1,    "pendiente.tif"),
    ("acumulacion",         50,   +1,    "acumulacion.tif"),
    ("distancia_cauces",     0,   -1,    "distancia_cauces.tif"),
    ("twi",                  0,   +1,    "twi.tif"),
    ("curvatura",           50,   -1,    "curvatura.tif"),
    ("cobertura",            0,   -1,    "cobertura.tif"),
)
assert sum(v[1] for v in VARIABLES) == 100, "los pesos deben sumar 100"

PESOS = {n: p for n, p, _s, _a in VARIABLES}
METODO = "cuartiles regionales"

PERCENTILES = (2, 98)

NOMBRES_CLASE = ("Baja", "Media", "Alta", "Muy alta")


def cortes_por_cuartiles(valores):
    """Los tres cortes que dividen los valores válidos en cuatro partes iguales."""
    v = np.asarray(valores, dtype="float64")
    v = v[~np.isnan(v)]
    return tuple(float(x) for x in np.percentile(v, (25, 50, 75)))


def clasificar(valor, cortes):
    """Clase de un valor dados los tres cortes (ascendentes)."""
    for i, corte in enumerate(cortes):
        if valor < corte:
            return NOMBRES_CLASE[i]
    return NOMBRES_CLASE[-1]


def clasificar_arreglo(a, cortes):
    """Índice 0..3 de clase por celda; -1 donde no hay dato."""
    clase = np.full(a.shape, -1, dtype="int8")
    valido = np.isfinite(a)
    clase[valido] = np.searchsorted(np.asarray(cortes), a[valido], side="right")
    return clase


def normalizar(arreglo, sentido, dominio=None, percentiles=PERCENTILES):
    """A 0-1 recortando a los percentiles, y volteado si la variable es inversa.

    La escala se calcula sobre `dominio`: las celdas donde las seis variables
    son válidas, que en la práctica es el territorio de las comunas. NO sobre
    todo el bbox: el recorte del DEM incluye Maule, Metropolitana y la
    cordillera hasta Argentina, y con eso la distancia a cauces llegaba a
    29 km y la pendiente a 94% —escalas que ninguna comuna alcanza— y todo
    el territorio real quedaba aplastado hacia un extremo.

    Es regional, no comunal: un mismo valor significa lo mismo en dos
    comunas distintas.
    """
    v = np.asarray(arreglo, dtype="float64")
    if dominio is None:
        dominio = ~np.isnan(v)
    validas = v[dominio & ~np.isnan(v)]
    if validas.size == 0:
        raise ValueError("variable sin celdas válidas")
    bajo, alto = np.percentile(validas, percentiles)
    if alto <= bajo:
        raise ValueError("variable constante: percentiles %s iguales" % (percentiles,))
    n = np.clip((v - bajo) / (alto - bajo), 0.0, 1.0)
    if sentido < 0:
        n = 1.0 - n
    n[np.isnan(v)] = np.nan
    return n, (float(bajo), float(alto))


def combinar(capas):
    """Suma ponderada. NaN donde falte cualquiera: nada se rellena."""
    indice = np.zeros_like(next(iter(capas.values())), dtype="float64")
    for nombre, peso, _sentido, _archivo in VARIABLES:
        if peso:
            indice += capas[nombre] * (peso / 100.0)
    return indice


# --------------------------------------------------------------------------
# Entrada
# --------------------------------------------------------------------------

def leer_en_rejilla(ruta, perfil_destino):
    """Lee un ráster y, si no comparte rejilla con el destino, lo remuestrea."""
    with rasterio.open(ruta) as d:
        misma = (d.transform == perfil_destino["transform"]
                 and d.width == perfil_destino["width"]
                 and d.height == perfil_destino["height"])
        if misma:
            a = d.read(1).astype("float64")
            if d.nodata is not None:
                a[a == d.nodata] = np.nan
            return a
        destino = np.full((perfil_destino["height"], perfil_destino["width"]),
                          np.nan, dtype="float64")
        reproject(rasterio.band(d, 1), destino,
                  dst_transform=perfil_destino["transform"],
                  dst_crs=perfil_destino["crs"],
                  src_nodata=d.nodata, dst_nodata=np.nan,
                  resampling=Resampling.bilinear)
        return destino


def mosaico_ndvi(carpeta, perfil_destino, salida):
    """Une los NDVI por comuna de Sentinel en un solo ráster en la rejilla.

    Sentinel entrega un archivo por comuna, a 60 m. Aquí se unen y se
    remuestrean a la rejilla del DEM, y se guarda el resultado para que el
    cálculo sea repetible sin volver a unir.
    """
    archivos = sorted(glob.glob(os.path.join(carpeta, "ndvi_*.tif")))
    if not archivos:
        raise SystemExit(
            "No hay NDVI por píxel en %s. Generarlo con:\n"
            "  python -m ingesta.sentinel --raster-dir %s" % (carpeta, carpeta))
    fuentes = [rasterio.open(a) for a in archivos]
    try:
        unido, transform = merge(fuentes, nodata=fuentes[0].nodata)
        perfil = fuentes[0].profile.copy()
        perfil.update(height=unido.shape[1], width=unido.shape[2], transform=transform)
        temporal = salida + ".tmp.tif"
        with rasterio.open(temporal, "w", **perfil) as d:
            d.write(unido[0], 1)
    finally:
        for f in fuentes:
            f.close()
    ndvi = leer_en_rejilla(temporal, perfil_destino)
    os.remove(temporal)
    escribir(salida, ndvi, perfil_destino["transform"], perfil_destino["crs"])
    print("[inundacion] %d NDVI unidos -> %s" % (len(archivos), salida))
    return ndvi


# --------------------------------------------------------------------------
# Agregación por comuna
# --------------------------------------------------------------------------

def agregar(indice, transform, geometrias, cortes_pixel):
    """Media del índice y fracción de celdas en las dos clases superiores."""
    resultado = {}
    for id_comuna, nombre, geo in geometrias:
        dentro = geometry_mask([geo], out_shape=indice.shape, transform=transform,
                               invert=True)
        v = indice[dentro]
        v = v[~np.isnan(v)]
        if v.size == 0:
            resultado[id_comuna] = {"nombre": nombre, "media": None, "celdas": 0}
            continue
        resultado[id_comuna] = {
            "nombre": nombre,
            "media": float(v.mean()),
            "fraccion_alta": float((v >= cortes_pixel[1]).mean()),
            "celdas": int(v.size),
        }
    # La clase comunal es relativa entre comunas: cuartiles de las medias.
    medias = [d["media"] for d in resultado.values() if d["media"] is not None]
    cortes_comuna = cortes_por_cuartiles(medias)
    for d in resultado.values():
        if d["media"] is not None:
            d["clase"] = clasificar(d["media"], cortes_comuna)
    return resultado, cortes_comuna


SQL_GUARDAR = """
INSERT INTO indicadores.susceptibilidad_inundacion
    (id_region, id_comuna, pendiente_media, acum_flujo, dist_cauce_m, indice_twi,
     susceptibilidad, clase, calibrado, pesos, metodo, fraccion_alta)
VALUES
    (%(id_region)s, %(id_comuna)s, %(pendiente)s, %(acumulacion)s,
     %(distancia_cauces)s, %(twi)s, %(susceptibilidad)s, %(clase)s, FALSE,
     %(pesos)s, %(metodo)s, %(fraccion_alta)s)
"""

SQL_REVISAR = """
SELECT DISTINCT ON (s.id_comuna)
       c.nombre, s.susceptibilidad, s.clase, s.calibrado, s.calculado_en::date
FROM   indicadores.susceptibilidad_inundacion s
JOIN   territorio.comuna c USING (id_comuna)
WHERE  s.id_region = %s
ORDER  BY s.id_comuna, s.calculado_en DESC
"""


def guardar(region, agregado, cortes_pixel, cortes_comuna):
    """Una fila por comuna. La tabla guarda además las medias de cuatro
    variables, y con qué pesos y cortes se calculó, para que la fila se
    explique sola sin cruzar con otra."""
    import json
    medias = INUNDACION.leer(region.id_region)
    metodo = json.dumps({"clases": METODO,
                         "cortes_pixel": [round(c, 4) for c in cortes_pixel],
                         "cortes_comuna": [round(c, 4) for c in cortes_comuna]})
    n = 0
    with conexion() as con:
        for id_comuna, d in sorted(agregado.items()):
            if d["media"] is None:
                continue
            m = medias.get(id_comuna, {})
            con.execute(SQL_GUARDAR, {
                "id_region": region.id_region, "id_comuna": id_comuna,
                "pendiente": m.get("pendiente"), "acumulacion": m.get("acumulacion"),
                "distancia_cauces": m.get("distancia_cauces"), "twi": m.get("twi"),
                "susceptibilidad": round(d["media"], 6),
                "clase": d["clase"],
                "pesos": json.dumps(PESOS), "metodo": metodo[:60],
                "fraccion_alta": round(d["fraccion_alta"], 3),
            })
            n += 1
    return n


def informe(agregado):
    print("\n  %-22s %8s %10s  %s" % ("comuna", "indice", "% alta+", "clase"))
    for _k, d in sorted(agregado.items(), key=lambda x: -(x[1]["media"] or 0)):
        if d["media"] is None:
            print("  %-22s %8s" % (d["nombre"][:22], "sin dato"))
            continue
        print("  %-22s %8.3f %9.0f%%  %s"
              % (d["nombre"][:22], d["media"], 100 * d["fraccion_alta"], d["clase"]))


def revisar(region):
    with conexion() as con:
        filas = con.execute(SQL_REVISAR, (region.id_region,)).fetchall()
    filas.sort(key=lambda f: -f[1])
    print("\n  %-22s %8s  %-9s %-11s %s" % ("comuna", "indice", "clase", "calibrado", "fecha"))
    for nombre, s, clase, cal, fecha in filas:
        print("  %-22s %8.3f  %-9s %-11s %s" % (nombre[:22], s, clase, "si" if cal else "no", fecha))


# --------------------------------------------------------------------------
# Punto de entrada
# --------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Índice de susceptibilidad a inundación")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--datos", default=DIR_SALIDA)
    p.add_argument("--ndvi-dir", default=os.path.join(DIR_SALIDA, "ndvi"))
    p.add_argument("--simular", action="store_true")
    p.add_argument("--revisar", action="store_true", help="mostrar lo guardado y salir")
    args = p.parse_args()

    region = obtener_region(args.region)
    print("[inundacion] %s" % region.nombre)
    if args.revisar:
        revisar(region)
        return 0

    with Bitacora("Índice de susceptibilidad a inundación — %s" % region.nombre) as b:
        # La rejilla la fija el DEM recortado, a través de la acumulación.
        with rasterio.open(os.path.join(args.datos, "acumulacion.tif")) as ref:
            perfil = {"transform": ref.transform, "crs": ref.crs,
                      "width": ref.width, "height": ref.height}
        print("[inundacion] rejilla %d x %d" % (perfil["width"], perfil["height"]))

        crudas = {}
        for nombre, _peso, _sentido, archivo in VARIABLES:
            ruta = os.path.join(args.datos, archivo)
            if nombre == "cobertura" and not os.path.exists(ruta):
                crudas[nombre] = mosaico_ndvi(args.ndvi_dir, perfil, ruta)
            else:
                crudas[nombre] = leer_en_rejilla(ruta, perfil)

        # Dominio: donde las seis existen. La cobertura solo existe dentro de
        # las comunas, asi que esto recorta la escala al territorio real.
        dominio = np.ones((perfil["height"], perfil["width"]), dtype=bool)
        for a in crudas.values():
            dominio &= ~np.isnan(a)
        print("[inundacion] dominio: %d celdas con las seis variables (%.0f%% del bbox)"
              % (dominio.sum(), 100.0 * dominio.mean()))

        print("[inundacion] normalizando (percentiles %d-%d sobre el dominio)" % PERCENTILES)
        capas, escalas = {}, {}
        for nombre, peso, sentido, _archivo in VARIABLES:
            capas[nombre], escalas[nombre] = normalizar(crudas[nombre], sentido, dominio)
            print("  %-18s peso %2d%%  %s  escala %.3f .. %.3f"
                  % (nombre, peso, "inversa" if sentido < 0 else "directa ", *escalas[nombre]))
        del crudas

        indice = combinar(capas)
        del capas
        v = indice[~np.isnan(indice)]
        cortes_pixel = cortes_por_cuartiles(v)
        print("[inundacion] pesos: %s"
              % ", ".join("%s %d%%" % (n, p) for n, p in PESOS.items() if p))
        print("[inundacion] indice: min %.3f  mediana %.3f  max %.3f  (%d celdas)"
              % (v.min(), np.median(v), v.max(), v.size))
        print("[inundacion] cortes por cuartiles del pixel: %.3f | %.3f | %.3f"
              % cortes_pixel)
        del v

        geometrias = geometrias_comunas(region.id_region, region.epsg_trabajo)
        agregado, cortes_comuna = agregar(indice, perfil["transform"], geometrias,
                                          cortes_pixel)
        print("[inundacion] cortes por cuartiles de las comunas: %.3f | %.3f | %.3f"
              % cortes_comuna)
        informe(agregado)

        if args.simular:
            print("\n[inundacion] --simular: no se escribió nada.")
            b.simulada = True
            b.registros = 0
            return 0

        ruta = os.path.join(args.datos, "susceptibilidad.tif")
        escribir(ruta, indice, perfil["transform"], perfil["crs"])
        print("\n[inundacion] -> %s (%.1f MB)" % (ruta, os.path.getsize(ruta) / 1e6))
        # El método va junto al ráster: mapa_inundacion colorea con estos
        # mismos cortes, y quien lea el .tif sabe cómo se hizo.
        import json
        with open(os.path.join(args.datos, "susceptibilidad.json"), "w", encoding="utf-8") as f:
            json.dump({"pesos": PESOS, "metodo": METODO, "percentiles": PERCENTILES,
                       "clases": list(NOMBRES_CLASE),
                       "cortes_pixel": [round(c, 4) for c in cortes_pixel],
                       "cortes_comuna": [round(c, 4) for c in cortes_comuna],
                       "escalas": {k: [round(x, 4) for x in e] for k, e in escalas.items()}},
                      f, ensure_ascii=False, indent=1)
        b.registros = guardar(region, agregado, cortes_pixel, cortes_comuna)
        print("[inundacion] %d comunas guardadas en susceptibilidad_inundacion (calibrado = no)"
              % b.registros)
    return 0


if __name__ == "__main__":
    sys.exit(main())
