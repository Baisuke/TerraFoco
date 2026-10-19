# -*- coding: utf-8 -*-
"""
Validación del índice de susceptibilidad contra los eventos históricos.

Es la fase de evaluación de CRISP-DM, y la que decide si el índice se
declara calibrado. Tres preguntas, en orden de exigencia:

  1. ¿Qué fracción de los eventos cae en comunas Alta o Muy alta?
     Es el criterio de éxito declarado en el perfil: "una proporción
     mayoritaria". Pero solo, engaña: si 20 de 33 comunas son Alta, el azar
     ya da un 60%. Por eso se informa junto a lo que daría una asignación al
     azar, y lo que importa es la diferencia.

  2. ¿Ordena el índice las comunas como las ordenan los eventos?
     Correlación de rangos (Spearman) entre índice y número de eventos. Es
     la medida honesta: no depende de dónde se pongan los cortes de clase.

  3. ¿Qué variable aporta y cuál estorba?
     Spearman de cada variable con los eventos, comparado con el signo que
     el modelo le supone. Una variable con el signo contrario está restando.
     Esto es lo que permite revisar los pesos con evidencia y no a ojo.

Con 33 comunas, una correlación de ±0,35 es sugerente, no concluyente.
Los eventos vienen de prensa y sobrerrepresentan las comunas pobladas.
Ambas cosas se imprimen con el resultado, no se dejan en el código.

    python -m indicadores.validar_inundacion
    python -m indicadores.validar_inundacion --marcar-calibrado   # marca sin preguntar
    python -m indicadores.validar_inundacion --marcar-si-pasa     # solo si cumple el criterio

--marcar-si-pasa es lo que usa el programador después de recalcular el índice:
cada recálculo deja el índice "no calibrado", y sin esto la pantalla lo
habría declarado así hasta que alguien validara a mano. El criterio es el
declarado en docs/13: la mayoría de los eventos en Alta o Muy alta, al menos
MEJORA_MINIMA sobre lo que daría el azar, y el orden de las comunas en el
sentido de los eventos (rho positivo).
"""
import argparse
import sys

import config
from bd import conexion, obtener_region
from indicadores.almacen import INUNDACION
from indicadores.inundacion import VARIABLES

SQL_INDICE = """
SELECT DISTINCT ON (s.id_comuna) s.id_comuna, c.nombre, s.susceptibilidad, s.clase
FROM   indicadores.susceptibilidad_inundacion s
JOIN   territorio.comuna c USING (id_comuna)
WHERE  s.id_region = %s
ORDER  BY s.id_comuna, s.calculado_en DESC
"""

SQL_EVENTOS = """
SELECT id_comuna, count(*) FROM indicadores.evento_inundacion
WHERE  id_region = %s AND id_comuna IS NOT NULL
GROUP  BY id_comuna
"""

SQL_MARCAR = """
UPDATE indicadores.susceptibilidad_inundacion s
SET    calibrado = TRUE
WHERE  id_region = %s
  AND  calculado_en = (SELECT max(calculado_en) FROM indicadores.susceptibilidad_inundacion
                       WHERE id_region = s.id_region AND id_comuna = s.id_comuna)
"""

ALTAS = ("Alta", "Muy alta")

MEJORA_MINIMA = 0.10        # 10 puntos sobre el azar


def pasa_criterio(r):
    """(pasa, motivo) según el criterio de calibración declarado."""
    if r["frac_alta"] <= 0.5:
        return False, "menos de la mitad de los eventos cae en Alta o Muy alta"
    if r["frac_alta"] - r["azar"] < MEJORA_MINIMA:
        return False, "no mejora al azar en %d puntos" % round(100 * MEJORA_MINIMA)
    if not r["rho"] > 0:
        return False, "el índice ordena las comunas al revés de los eventos"
    return True, "cumple: %d%% en Alta frente a %d%% del azar, rho %+.2f" % (
        round(100 * r["frac_alta"]), round(100 * r["azar"]), r["rho"])


# --------------------------------------------------------------------------
# Estadística mínima, sin dependencias
# --------------------------------------------------------------------------

def rangos(valores):
    """Rangos con empates promediados, como Spearman exige."""
    orden = sorted(range(len(valores)), key=lambda i: valores[i])
    r = [0.0] * len(valores)
    i = 0
    while i < len(orden):
        j = i
        while j + 1 < len(orden) and valores[orden[j + 1]] == valores[orden[i]]:
            j += 1
        for k in range(i, j + 1):
            r[orden[k]] = (i + j) / 2.0
        i = j + 1
    return r


def spearman(x, y):
    if len(x) < 3:
        return float("nan")
    rx, ry = rangos(x), rangos(y)
    n = len(x)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return num / den if den else 0.0


# --------------------------------------------------------------------------
# Validación
# --------------------------------------------------------------------------

def validar(region):
    with conexion() as con:
        indice = con.execute(SQL_INDICE, (region.id_region,)).fetchall()
        eventos = dict(con.execute(SQL_EVENTOS, (region.id_region,)).fetchall())
    if not indice:
        raise SystemExit("No hay índice calculado. Correr primero indicadores.inundacion")
    if not eventos:
        raise SystemExit("No hay eventos cargados. Correr primero ingesta.desinventar")

    comunas = [(i, n, float(s), c) for i, n, s, c in indice]
    n_ev = {i: eventos.get(i, 0) for i, _n, _s, _c in comunas}
    total_ev = sum(n_ev.values())

    # 1. Criterio de éxito, y lo que daría el azar
    en_alta = sum(n_ev[i] for i, _n, _s, c in comunas if c in ALTAS)
    frac_alta = en_alta / total_ev
    comunas_alta = sum(1 for _i, _n, _s, c in comunas if c in ALTAS)
    azar = comunas_alta / len(comunas)

    # 2. Orden
    rho = spearman([s for _i, _n, s, _c in comunas], [n_ev[i] for i, _n, _s, _c in comunas])

    # 3. Por variable
    medias = INUNDACION.leer(region.id_region)
    por_variable = []
    for nombre, peso, sentido, _archivo in VARIABLES:
        xs, ys = [], []
        for i, _n, _s, _c in comunas:
            if nombre in medias.get(i, {}):
                xs.append(medias[i][nombre]); ys.append(n_ev[i])
        r = spearman(xs, ys) if xs else float("nan")
        if abs(r) < 0.15:
            veredicto = "nula"
        elif (r < 0) == (sentido < 0):
            veredicto = "coincide"
        else:
            veredicto = "CONTRARIA"
        por_variable.append((nombre, peso, sentido, r, veredicto, len(xs)))

    return {
        "comunas": comunas, "eventos": n_ev, "total_eventos": total_ev,
        "en_alta": en_alta, "frac_alta": frac_alta, "azar": azar,
        "comunas_alta": comunas_alta, "rho": rho, "por_variable": por_variable,
    }


def informe(r):
    print("\n=== 1. Criterio de éxito: eventos en comunas Alta o Muy alta ===")
    print("  %d de %d eventos = %.0f%%" % (r["en_alta"], r["total_eventos"], 100 * r["frac_alta"]))
    print("  Pero %d de %d comunas son Alta o Muy alta: el azar daría %.0f%%."
          % (r["comunas_alta"], len(r["comunas"]), 100 * r["azar"]))
    dif = 100 * (r["frac_alta"] - r["azar"])
    print("  Diferencia sobre el azar: %+.0f puntos.%s"
          % (dif, "  <- no mejor que el azar" if dif < 10 else ""))

    print("\n=== 2. Orden: Spearman índice vs. número de eventos ===")
    print("  rho = %+.3f   (con %d comunas, |rho| < 0,35 no es concluyente)"
          % (r["rho"], len(r["comunas"])))

    print("\n=== 3. Por variable: ¿aporta o estorba? ===")
    print("  %-18s %5s %-9s %7s  %s" % ("variable", "peso", "sentido", "rho", "veredicto"))
    for nombre, peso, sentido, rho, veredicto, n in r["por_variable"]:
        print("  %-18s %4d%% %-9s %+7.3f  %s"
              % (nombre, peso, "inversa" if sentido < 0 else "directa", rho, veredicto))

    print("\n=== Comunas: índice y eventos ===")
    print("  %-20s %7s %-9s %s" % ("comuna", "índice", "clase", "eventos"))
    for i, n, s, c in sorted(r["comunas"], key=lambda t: -t[2]):
        print("  %-20s %7.3f %-9s %s" % (n[:20], s, c, "#" * r["eventos"][i] or "-"))

    print("\n  Los eventos vienen de prensa (1970-2014) y sobrerrepresentan las")
    print("  comunas pobladas. Con 33 comunas, ninguna correlación aquí es")
    print("  concluyente por sí sola; sí lo es la dirección del conjunto.")


def main():
    p = argparse.ArgumentParser(description="Validar el índice de inundación contra eventos")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--marcar-calibrado", action="store_true",
                   help="marcar la última versión del índice como calibrada")
    p.add_argument("--marcar-si-pasa", action="store_true",
                   help="marcarla solo si cumple el criterio declarado")
    args = p.parse_args()

    region = obtener_region(args.region)
    print("[validar] %s" % region.nombre)
    r = validar(region)
    informe(r)

    marcar = args.marcar_calibrado
    if args.marcar_si_pasa:
        pasa, motivo = pasa_criterio(r)
        print("\n[validar] %s" % motivo)
        if not pasa:
            print("[validar] el índice queda como no calibrado.")
            return 1
        marcar = True
    if marcar:
        with conexion() as con:
            con.execute(SQL_MARCAR, (region.id_region,))
        print("\n[validar] índice marcado como calibrado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
