# -*- coding: utf-8 -*-
"""
Del modelo de elevación a la pendiente, y de la pendiente al factor LS.

Es el puente entre el ráster que baja de NASA y el número que entra en RUSLE.
Las funciones trabajan sobre arreglos de numpy y no leen archivos: eso permite
probarlas contra superficies cuya pendiente se conoce de forma analítica, sin
descargar un solo modelo de elevación.

    dem (m)  ->  pendiente (%)  ->  LS  ->  media ponderada por comuna

SOBRE LA LONGITUD DE LADERA
---------------------------
El cálculo estricto de L necesita el área de captación de cada celda, y eso
exige acumulación de flujo (D8 o D-infinito). Aquí se usa como longitud el
tamaño de la celda, que es la simplificación habitual cuando se trabaja a
resolución media y la que hace que L quede cercano a 1.

Es una limitación real y hay que declararla en el informe, no esconderla:
subestima LS en laderas largas y uniformes. La vía de mejora es RichDEM
—ya previsto en la arquitectura para el módulo de inundaciones— y por eso
`ls_desde_pendiente` acepta un arreglo de longitudes: cuando exista la
acumulación de flujo, se enchufa sin tocar el resto.
"""
import numpy as np

from indicadores.rusle import LONGITUD_PARCELA_PATRON


def pendiente_horn(dem, dx, dy=None):
    """Pendiente en porcentaje, por el método de Horn (1981).

    Es el mismo que usan GDAL y ArcGIS: pondera las ocho celdas vecinas dando
    doble peso a las cuatro ortogonales. Frente a una diferencia central
    simple, suaviza el ruido del modelo de elevación, que en NASADEM es real y
    se amplifica al derivar.

    dem: arreglo 2D de elevaciones en metros, con el norte arriba.
    dx, dy: tamaño de celda en metros. dy toma el valor de dx si se omite.

    Los bordes se resuelven replicando la fila o columna exterior, de modo que
    la salida conserva la forma de la entrada. Ese borde es aproximado: al
    agregar por comuna pesa poco, pero conviene recortar con holgura.
    """
    if dy is None:
        dy = dx
    z = np.asarray(dem, dtype="float64")
    if z.ndim != 2:
        raise ValueError("El DEM debe ser 2D, llego %dD" % z.ndim)
    if dx <= 0 or dy <= 0:
        raise ValueError("Tamano de celda invalido: dx=%r dy=%r" % (dx, dy))

    p = np.pad(z, 1, mode="edge")

    # Ventana 3x3: a b c / d e f / g h i
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, f = p[1:-1, :-2], p[1:-1, 2:]
    g, h, i = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]

    # El signo no importa: enseguida se eleva al cuadrado.
    dz_dx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8.0 * dx)
    dz_dy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8.0 * dy)

    return np.hypot(dz_dx, dz_dy) * 100.0


def curvatura(dem, dx, dy=None):
    """Curvatura general del terreno, por Zevenbergen & Thorne (1987).

    Es la que calcula la herramienta Curvature de ArcGIS: la segunda derivada
    de la superficie, ajustando una cuadrica a la ventana 3x3. Se expresa en
    1/100 de metro para que los valores queden en un rango legible (en un DEM
    de 30 m, casi todo cae entre -4 y 4).

    El signo es lo que importa para inundaciones: NEGATIVO es concavo —el
    fondo de un valle, una hondonada—, que es donde el agua se junta.
    POSITIVO es convexo —una loma, una cresta—, de donde el agua escurre.
    Por eso el almacen de variables de inundacion no rechaza negativos.

    dem: arreglo 2D de elevaciones en metros, con el norte arriba.
    dx, dy: tamano de celda en metros. dy toma el valor de dx si se omite.
    """
    if dy is None:
        dy = dx
    z = np.asarray(dem, dtype="float64")
    if z.ndim != 2:
        raise ValueError("El DEM debe ser 2D, llego %dD" % z.ndim)
    if dx <= 0 or dy <= 0:
        raise ValueError("Tamano de celda invalido: dx=%r dy=%r" % (dx, dy))

    p = np.pad(z, 1, mode="edge")

    # Ventana 3x3: a b c / d e f / g h i. Solo hacen falta las ortogonales.
    b, h = p[:-2, 1:-1], p[2:, 1:-1]     # norte, sur
    d, f = p[1:-1, :-2], p[1:-1, 2:]     # oeste, este
    e = p[1:-1, 1:-1]

    # D y E son las segundas derivadas en x y en y de la cuadrica ajustada.
    D = ((d + f) / 2.0 - e) / (dx * dx)
    E = ((b + h) / 2.0 - e) / (dy * dy)

    return -2.0 * (D + E) * 100.0


def ls_desde_pendiente(pendiente_pct, longitud_m=None):
    """Factor LS sobre un arreglo, con las mismas ecuaciones que `factor_LS`.

    Se reimplementa vectorizado en lugar de aplicar la función escalar celda a
    celda: un ráster regional tiene millones de celdas y el bucle en Python
    tarda minutos donde numpy tarda milisegundos. `test_terreno` verifica que
    ambas versiones coincidan, para que no puedan divergir en silencio.

    Renard et al. (1997) para L, McCool et al. (1987) para S.
    """
    s_pct = np.asarray(pendiente_pct, dtype="float64")
    if np.any(s_pct < 0):
        raise ValueError("Hay pendientes negativas en el arreglo")

    if longitud_m is None:
        longitud_m = LONGITUD_PARCELA_PATRON
    lam = np.asarray(longitud_m, dtype="float64")
    if np.any(lam <= 0):
        raise ValueError("Hay longitudes de ladera <= 0")

    theta = np.arctan(s_pct / 100.0)
    sen = np.sin(theta)

    # beta y m no estan definidos en pendiente cero; se calculan sobre las
    # celdas con relieve y el resto toma el minimo de McCool.
    con_relieve = sen > 0
    sen_seguro = np.where(con_relieve, sen, 1e-9)

    beta = (sen_seguro / 0.0896) / (3.0 * sen_seguro ** 0.8 + 0.56)
    m = beta / (1.0 + beta)
    L = (lam / LONGITUD_PARCELA_PATRON) ** m

    S = np.where(s_pct < 9.0,
                 10.8 * sen + 0.03,
                 16.8 * sen - 0.50)
    S = np.maximum(S, 0.0)

    ls = L * S
    return np.where(con_relieve, ls, 0.03)


def media_ponderada(valores, mascara=None, pesos=None):
    """Media de un arreglo sobre las celdas válidas.

    Devuelve (media, n_celdas). Ignora NaN y, si se da, todo lo que quede
    fuera de la máscara. Sin celdas válidas devuelve (None, 0) en vez de NaN:
    el llamador debe poder distinguir "no hay dato" de "el dato es cero".

    pesos permite ponderar por superficie real de celda, que importa al
    trabajar en coordenadas geográficas, donde una celda de 30 m en latitud
    -34 no cubre la misma área que en el ecuador.
    """
    v = np.asarray(valores, dtype="float64")
    valido = ~np.isnan(v)
    if mascara is not None:
        valido &= np.asarray(mascara, dtype=bool)

    n = int(valido.sum())
    if n == 0:
        return None, 0

    if pesos is None:
        return float(v[valido].mean()), n

    w = np.asarray(pesos, dtype="float64")[valido]
    total = w.sum()
    if total <= 0:
        return None, 0
    return float((v[valido] * w).sum() / total), n


def ls_de_comuna(dem, dx, mascara=None, dy=None, longitud_m=None):
    """Atajo para el caso habitual: del DEM recortado al LS medio de la comuna.

    Se promedia el LS, no la pendiente. No es lo mismo: la relación entre
    ambos no es lineal, y promediar la pendiente primero subestima el factor
    en terreno heterogéneo, que es justo el del secano costero.
    """
    pend = pendiente_horn(dem, dx, dy)
    ls = ls_desde_pendiente(pend, longitud_m)
    return media_ponderada(ls, mascara)
