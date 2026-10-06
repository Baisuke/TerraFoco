# -*- coding: utf-8 -*-
"""
Factor P: el punto donde la política pública entra en el modelo físico.

P vale 1 cuando no hay prácticas de conservación y baja a medida que aumenta la
intervención. Las obras que bonifica el SIRSD-S —curvas de nivel, obras de
conservación— actúan justamente sobre ese factor.

    P = 1 - fraccion_intervenida * (1 - P_practica)

Esto es lo que hace que el cruce del proyecto no sea una correlación forzada:
la variable que se quiere evaluar **ya vive dentro de la ecuación**.

DE DONDE SALE CADA PIEZA
------------------------
superficie intervenida   `programas.ejecucion`, cargado desde IDE MINAGRI
superficie agricola      area de la mascara de CIREN dentro de la comuna
pendiente media          NASADEM, promediada sobre esa misma mascara

TRES SUPUESTOS QUE HAY QUE DECLARAR
-----------------------------------
1. **La superficie agricola se aproxima por el area que CIREN evalua.** El
   inventario cubre suelos susceptibles de erosion y excluye cordillera, agua y
   urbano, asi que se parece a la superficie objetivo del programa. No es el
   dato del Censo Agropecuario, que seria mejor; se usa este porque comparte
   huella exacta con LS, C y la linea base, y esa consistencia importa mas que
   la precision absoluta para un factor acotado entre 0 y 1.

2. **Toda la superficie bonificada se atribuye al factor P.** El esquema
   distingue practicas que actuan sobre C, P y K (`practica.factor_rusle`),
   pero el servicio de IDE MINAGRI no informa la practica de cada bonificacion.
   Atribuirlas todas a P **sobreestima** su efecto. Cuando llegue el detalle de
   INDAP, este supuesto se levanta sin tocar el resto.

3. **Se usa la tabla de curvas de nivel de Wischmeier & Smith**, que es la
   practica mas comun del programa.

Uso:
    python -m ingesta.practicas --mascara /datos/mascara_ciren.tif --simular
    python -m ingesta.practicas --mascara /datos/mascara_ciren.tif --guardar
"""
import argparse
import sys

import config
from bd import Bitacora, conexion, obtener_region
from indicadores.rusle import factor_P, p_curvas_nivel
from ingesta.zonal import (agregar_por_comuna, geometrias_comunas,
                           transformacion_pendiente)

SQL_BONIFICADO = """
SELECT id_comuna, SUM(superficie_ha) AS ha, count(*) AS filas
FROM   programas.ejecucion
WHERE  superficie_ha IS NOT NULL
  AND  (%(anio)s::smallint IS NULL OR anio = %(anio)s::smallint)
GROUP  BY id_comuna
"""


def bonificado_por_comuna(anio=None):
    with conexion() as con:
        filas = con.execute(SQL_BONIFICADO, {"anio": anio}).fetchall()
    return {f[0]: {"ha": float(f[1]), "filas": int(f[2])} for f in filas}


def main():
    p = argparse.ArgumentParser(description="Factor P desde el SIRSD-S")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--raster", default="/datos/srtm/dem_utm.tif")
    p.add_argument("--mascara", default="/datos/mascara_ciren.tif")
    p.add_argument("--anio", type=int, default=None,
                   help="año de ejecución a considerar; por defecto, todos")
    p.add_argument("--anio-factor", type=int, default=2025)
    p.add_argument("--guardar", action="store_true")
    p.add_argument("--simular", action="store_true")
    args = p.parse_args()

    region = obtener_region(args.region)
    geometrias = geometrias_comunas(args.region, region.epsg_trabajo)

    print("[practicas] %s — pendiente media y superficie evaluada" % region.nombre)
    terreno = agregar_por_comuna(args.raster, geometrias,
                                 transformacion_pendiente(), 1, args.mascara)

    # El area sale del conteo de celdas dentro de la mascara: mismo recorte que
    # uso el calculo de LS y C, asi que las tres hablan del mismo territorio.
    import rasterio
    with rasterio.open(args.raster) as d:
        celda_ha = abs(d.transform.a) * abs(d.transform.e) / 10000.0

    bonificado = bonificado_por_comuna(args.anio)
    print("[practicas] %d comunas con ejecucion registrada" % len(bonificado))

    resultados, sin_terreno = {}, []
    for id_comuna, d in terreno.items():
        if d["valor"] is None or not d["celdas"]:
            sin_terreno.append(d["nombre"])
            continue
        agricola_ha = d["celdas"] * celda_ha
        b = bonificado.get(id_comuna, {"ha": 0.0, "filas": 0})
        pend = float(d["valor"])
        try:
            valor = factor_P(b["ha"], agricola_ha, pend)
        except ValueError:
            sin_terreno.append(d["nombre"])
            continue
        resultados[id_comuna] = {
            "nombre": d["nombre"], "P": valor, "pendiente": pend,
            "agricola_ha": agricola_ha, "bonificado_ha": b["ha"],
            "fraccion": min(1.0, b["ha"] / agricola_ha) if agricola_ha else 0.0,
            "predios": b["filas"],
        }

    print("\n  %-22s %8s %11s %11s %8s %7s"
          % ("comuna", "pend %", "agricola ha", "bonif. ha", "fraccion", "P"))
    for _k, d in sorted(resultados.items(), key=lambda x: x[1]["P"]):
        print("  %-22s %8.1f %11.0f %11.1f %7.3f%% %7.4f"
              % (d["nombre"][:22], d["pendiente"], d["agricola_ha"],
                 d["bonificado_ha"], 100 * d["fraccion"], d["P"]))

    con_intervencion = [d for d in resultados.values() if d["bonificado_ha"] > 0]
    print("\n  %d de %d comunas con intervencion registrada"
          % (len(con_intervencion), len(resultados)))
    if con_intervencion:
        menor = min(d["P"] for d in con_intervencion)
        print("  P mas bajo alcanzado: %.4f  (1 = sin practicas)" % menor)
        print("  La fraccion intervenida es pequena, asi que P se mueve poco:")
        print("  con un ano de programa eso es lo esperable, no un error.")
    if sin_terreno:
        print("  %d comunas sin terreno evaluable: %s"
              % (len(sin_terreno), ", ".join(sin_terreno[:6])))

    if args.simular or not args.guardar:
        print("\n[practicas] no se escribio nada (usar --guardar).")
        return 0

    from indicadores.almacen import guardar
    with Bitacora("Factor P — %s" % region.nombre) as b:
        valores = {i: d["P"] for i, d in resultados.items()}
        detalles = {i: {"pendiente_media_pct": round(d["pendiente"], 2),
                        "superficie_agricola_ha": round(d["agricola_ha"]),
                        "bonificado_ha": round(d["bonificado_ha"], 2),
                        "fraccion_intervenida": round(d["fraccion"], 5),
                        "p_practica": p_curvas_nivel(d["pendiente"]),
                        "supuesto": "toda la superficie bonificada se atribuye a P"}
                    for i, d in resultados.items()}
        n, _desc = guardar(args.region, valores, "P", args.anio_factor,
                           "SIRSD-S / IDE MINAGRI", detalles)
        b.registros = n
    print("\n[practicas] %d factores P guardados" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
