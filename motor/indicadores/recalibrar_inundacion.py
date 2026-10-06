# -*- coding: utf-8 -*-
"""
Banco de pruebas para recalibrar el índice de susceptibilidad.

La validación de la iteración 1 dijo que el índice con los pesos a priori no
ordena las comunas mejor que el azar (Spearman -0,16 con los eventos). Antes
de cambiar pesos a ojo, esto responde dos preguntas por separado, porque la
validación las mezcla:

  1. ¿Cómo se agrega el píxel a la comuna? La MEDIA del índice diluye: toda
     comuna mezcla valle y cerro, y los eventos ocurren donde están los
     peores píxeles —el pueblo junto al río—, no en el píxel promedio. Se
     prueban también el percentil 90 y la fracción del territorio en Alta.

  2. ¿Qué pesos? Se comparan juegos de pesos declarados de antemano, no
     ajustados por optimización: con 33 comunas, optimizar seis pesos contra
     63 eventos de prensa daría un ajuste perfecto y falso.

Cada combinación (pesos, agregado) se evalúa con Spearman contra el número
de eventos por comuna y con la fracción de eventos que caen en comunas Alta
o Muy alta, comparada con el azar. Todo es EN MUESTRA: los mismos eventos
que se usan para elegir son los que miden. Se dice en la salida. Con 33
comunas, una diferencia de Spearman menor a 0,15 es ruido.

    python -m indicadores.recalibrar_inundacion
"""
import argparse
import os
import sys

import numpy as np
import rasterio
from rasterio.features import rasterize

import config
from bd import conexion, obtener_region
from indicadores.inundacion import (PERCENTILES, VARIABLES, cortes_por_cuartiles,
                                    leer_en_rejilla, normalizar)
from indicadores.validar_inundacion import SQL_EVENTOS, spearman
from ingesta.hidrologia import DIR_SALIDA
from ingesta.zonal import geometrias_comunas

# Juegos de pesos, en porcentaje, en el orden de VARIABLES:
# pendiente, acumulacion, distancia_cauces, twi, curvatura, cobertura.
# Declarados aquí, no ajustados: cada uno tiene una razón que se puede leer.
CANDIDATOS = {
    "a priori (prototipo)":
        (24, 21, 19, 16, 11, 9),
    # La pendiente correlaciona al revés a escala comunal y la cobertura no
    # aporta: bajan al mínimo. Acumulación y curvatura, las dos que sí
    # correlacionan, suben. Las otras quedan como estaban.
    "evidencia, seis variables":
        (5, 30, 19, 16, 25, 5),
    # Sin pendiente: su peso se reparte entre las dos que funcionan.
    "sin pendiente":
        (0, 33, 19, 16, 23, 9),
    # Las que no aportan quedan como afinado fino, 20% entre las cuatro.
    "dominante 80/20":
        (2, 40, 8, 6, 40, 4),
    # Idem, 10% entre las cuatro.
    "dominante 90/10":
        (0, 45, 5, 5, 45, 0),
    # Solo lo que la validación respaldó. Es el extremo: dos variables.
    "solo acumulacion y curvatura":
        (0, 50, 0, 0, 50, 0),
}

# 31 de los 63 eventos son de junio de 1982. Un juego de pesos que solo
# acierte 1982 no vale: se mide también sin ese año.
SQL_EVENTOS_SIN_1982 = SQL_EVENTOS.replace("AND id_comuna IS NOT NULL",
                                           "AND id_comuna IS NOT NULL AND anio <> 1982")

AGREGADOS = ("media", "p90", "fraccion_alta")


def cargar_capas(datos):
    """Las seis variables normalizadas, y el dominio donde las seis existen."""
    with rasterio.open(os.path.join(datos, "acumulacion.tif")) as ref:
        perfil = {"transform": ref.transform, "crs": ref.crs,
                  "width": ref.width, "height": ref.height}
    crudas = {n: leer_en_rejilla(os.path.join(datos, a), perfil) for n, _p, _s, a in VARIABLES}
    dominio = np.ones((perfil["height"], perfil["width"]), dtype=bool)
    for a in crudas.values():
        dominio &= ~np.isnan(a)
    capas = {}
    for nombre, _peso, sentido, _archivo in VARIABLES:
        capas[nombre], _ = normalizar(crudas[nombre], sentido, dominio)
    return capas, dominio, perfil


def etiquetar_comunas(geometrias, perfil):
    """Ráster con el id de comuna en cada celda: agrega en un solo paso."""
    return rasterize(((geo, i) for i, _n, geo in geometrias),
                     out_shape=(perfil["height"], perfil["width"]),
                     transform=perfil["transform"], fill=0, dtype="int32")


def agregar(indice, etiquetas, ids):
    """Media, p90 y fracción en Alta por comuna, sobre las celdas válidas."""
    valido = ~np.isnan(indice) & (etiquetas > 0)
    v = indice[valido]
    e = etiquetas[valido]
    salida = {}
    for i in ids:
        celdas = v[e == i]
        if celdas.size == 0:
            salida[i] = None
            continue
        salida[i] = {"media": float(celdas.mean()),
                     "p90": float(np.percentile(celdas, 90)),
                     "fraccion_alta": float((celdas >= 0.5).mean())}
    return salida


def evaluar(agregado, eventos, clave):
    """Spearman y aciertos sobre el azar para un agregado dado."""
    ids = [i for i in agregado if agregado[i] is not None]
    x = [agregado[i][clave] for i in ids]
    y = [eventos.get(i, 0) for i in ids]
    rho = spearman(x, y)

    # "Alta o Muy alta" es la mitad superior de las comunas por el agregado,
    # igual que clasifica el indice (cuartiles). Asi el azar es siempre 50%
    # y lo que se lee es cuanto mejor que eso ordena cada juego de pesos.
    mediana = cortes_por_cuartiles(x)[1]
    alta = {i: agregado[i][clave] >= mediana for i in ids}
    total = sum(y)
    en_alta = sum(eventos.get(i, 0) for i in ids if alta[i])
    frac = en_alta / total if total else float("nan")
    azar = sum(alta.values()) / len(ids)
    return rho, frac, azar, sum(alta.values())


def main():
    p = argparse.ArgumentParser(description="Comparar pesos y agregados contra los eventos")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--datos", default=DIR_SALIDA)
    args = p.parse_args()

    region = obtener_region(args.region)
    print("[recalibrar] %s" % region.nombre)

    with conexion() as con:
        eventos = dict(con.execute(SQL_EVENTOS, (region.id_region,)).fetchall())
        sin_1982 = dict(con.execute(SQL_EVENTOS_SIN_1982, (region.id_region,)).fetchall())
    if not eventos:
        raise SystemExit("No hay eventos. Correr primero ingesta.desinventar")
    print("[recalibrar] %d eventos en %d comunas; sin 1982: %d eventos en %d comunas"
          % (sum(eventos.values()), len(eventos), sum(sin_1982.values()), len(sin_1982)))

    print("[recalibrar] cargando y normalizando las seis capas")
    capas, dominio, perfil = cargar_capas(args.datos)
    geometrias = geometrias_comunas(region.id_region, region.epsg_trabajo)
    etiquetas = etiquetar_comunas(geometrias, perfil)
    ids = [i for i, _n, _g in geometrias]

    print("\n  %-30s %-14s %7s %9s   %8s %6s" %
          ("pesos", "agregado", "rho", "rho s/82", "en Alta", "azar"))
    print("  " + "-" * 80)
    resultados = []
    for etiqueta, pesos in CANDIDATOS.items():
        assert sum(pesos) == 100, etiqueta
        indice = np.zeros_like(next(iter(capas.values())))
        for (nombre, _p, _s, _a), peso in zip(VARIABLES, pesos):
            if peso:
                indice += capas[nombre] * (peso / 100.0)
        indice[~dominio] = np.nan
        agregado = agregar(indice, etiquetas, ids)
        # Distribución de las medias comunales, para ver si los cortes de
        # clase siguen teniendo sentido con estos pesos.
        medias = [a["media"] for a in agregado.values() if a]
        for clave in AGREGADOS:
            rho, frac, azar, n_alta = evaluar(agregado, eventos, clave)
            rho82, _f, _a, _n = evaluar(agregado, sin_1982, clave)
            resultados.append((etiqueta, clave, rho, rho82, frac, azar))
            print("  %-30s %-14s %+7.3f %+9.3f   %7.0f%% %5.0f%%" %
                  (etiqueta, clave, rho, rho82, 100 * frac, 100 * azar))
        print("  %-30s medias comunales: %.3f .. %.3f" % ("", min(medias), max(medias)))
        print()

    mejor = max(resultados, key=lambda r: r[2])
    print("  Mejor Spearman: %s / %s, rho %+.3f (sin 1982: %+.3f)"
          % (mejor[0], mejor[1], mejor[2], mejor[3]))
    print("\n  Todo esto es EN MUESTRA: los eventos que eligen son los que miden.")
    print("  Con %d comunas, una diferencia de rho menor a 0,15 es ruido." % len(ids))
    print("  Pesos: pendiente, acumulacion, distancia_cauces, twi, curvatura, cobertura.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
