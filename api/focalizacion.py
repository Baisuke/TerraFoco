# -*- coding: utf-8 -*-
"""
Cuentas de la brecha y de la focalización, sin base de datos.

Van aparte de las rutas para poder probarlas con números escritos a mano, y
para que herramientas/sembrar_indicadores.py use exactamente las mismas al
armar la copia local.

BRECHA EN UF
------------
Cuánto incentivo le falta a una comuna para que su inversión por hectárea
erosionada llegue a la mediana regional:

    brecha_uf = max(0, mediana_uf_ha - uf_ha) * ha_erosion_severa

La referencia es la mediana y no el máximo, porque el máximo es San Vicente
(34 UF/ha): tomarlo como meta daría una brecha que nadie podría pagar y que
no diría nada. La mediana es "lo que recibe la comuna típica de la región":
una meta que ya se cumple en la mitad de ellas.

FOCALIZACIÓN POR AÑO
--------------------
Qué parte del incentivo de cada año fue a las comunas más erosionadas (tasa
sobre la mediana del índice), frente a la parte que les tocaría si el
incentivo se repartiera según la superficie con erosión severa. Es la
pregunta del proyecto hecha año por año, y se lee sin estadística: "tienen
el 61 % del problema y recibieron el 41 %".

Se acompaña del ρ de Spearman entre la erosión y la inversión por hectárea
de cada año, para quien quiera la medida clásica. No es la principal porque
con 27 comunas y años con pocos planes es ruidosa, y porque "correlación de
rangos" no se explica en una frase.
"""
import statistics


def mediana(valores):
    v = [x for x in valores if x is not None]
    return statistics.median(v) if v else None


def brecha_uf(uf_ha, ha_severa, mediana_uf_ha):
    """UF que faltan para llegar a la mediana; 0 si ya está sobre ella."""
    if uf_ha is None or ha_severa is None or mediana_uf_ha is None:
        return None
    return max(0.0, (mediana_uf_ha - uf_ha) * ha_severa)


def rangos(valores):
    """Rangos con empates promediados, como los usa Spearman."""
    orden = sorted(range(len(valores)), key=lambda i: valores[i])
    r = [0.0] * len(valores)
    i = 0
    while i < len(orden):
        j = i
        while j + 1 < len(orden) and valores[orden[j + 1]] == valores[orden[i]]:
            j += 1
        for k in range(i, j + 1):
            r[orden[k]] = (i + j) / 2.0 + 1
        i = j + 1
    return r


def spearman(x, y):
    """ρ de Spearman; None si alguna serie no varía (no hay orden que comparar)."""
    if len(x) != len(y) or len(x) < 3:
        return None
    rx, ry = rangos(x), rangos(y)
    mx, my = statistics.mean(rx), statistics.mean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return num / den if den else None


def focalizacion(comunas, anios):
    """Participación del incentivo de cada año en las comunas más erosionadas.

    comunas: [{"id_comuna", "nombre", "erosion", "ha_severa",
               "uf": {anio: incentivo_uf}}], solo las que entran al índice.
    anios:   los años a informar, en orden.
    """
    if not comunas:
        return None
    corte = mediana([c["erosion"] for c in comunas])
    altas = [c for c in comunas if c["erosion"] > corte]
    ha_total = sum(c["ha_severa"] for c in comunas)
    referencia = (sum(c["ha_severa"] for c in altas) / ha_total) if ha_total else None
    ids_altas = {c["id_comuna"] for c in altas}

    serie = []
    for a in anios:
        uf = [c["uf"].get(a, 0.0) or 0.0 for c in comunas]
        total = sum(uf)
        a_altas = sum(u for u, c in zip(uf, comunas) if c["id_comuna"] in ids_altas)
        serie.append({
            "anio": a,
            "incentivo_uf": round(total, 1),
            "incentivo_uf_mas_erosionadas": round(a_altas, 1),
            "participacion": (a_altas / total) if total else None,
            "rho": spearman([c["erosion"] for c in comunas],
                            [u / c["ha_severa"] if c["ha_severa"] else 0.0
                             for u, c in zip(uf, comunas)]),
            "comunas_sin_planes": sum(1 for u in uf if not u),
        })

    def periodo(desde, hasta):
        """Participación del período con el incentivo sumado, no el promedio
        de los porcentajes: un año de 17 mil UF no pesa lo mismo que uno de 80."""
        tramo = [s for s in serie if desde <= s["anio"] <= hasta]
        total = sum(s["incentivo_uf"] for s in tramo)
        return {"desde": desde, "hasta": hasta,
                "incentivo_uf": round(total, 1),
                "participacion": (sum(s["incentivo_uf_mas_erosionadas"] for s in tramo) / total)
                                 if total else None}

    mitad = anios[len(anios) // 2] if anios else None
    return {
        "corte_erosion": corte,
        "comunas_mas_erosionadas": sorted(c["nombre"] for c in altas),
        "comunas_en_el_indice": len(comunas),
        # Lo que les tocaría si el incentivo siguiera a la superficie severa.
        "referencia": referencia,
        "serie": serie,
        "periodos": [periodo(anios[0], mitad - 1), periodo(mitad, anios[-1])] if mitad else [],
    }
