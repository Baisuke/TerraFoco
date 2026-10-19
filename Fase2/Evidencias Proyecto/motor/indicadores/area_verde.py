# -*- coding: utf-8 -*-
"""
Déficit de áreas verdes por comuna y zona censal — objetivo específico 7.

Tres medidas, las del SIEDU (INE / CNDU), sobre la población urbana del
Censo 2024 y las áreas verdes públicas de OpenStreetMap:

  1. m² de área verde pública por habitante. Estándar: 10.
     El déficit es lo que falta para llegar: max(0, 10 x personas - área).
  2. Personas con una plaza o parque a no más de 400 m.
  3. Personas con un parque (2 ha o más) a no más de 3 km.

Para 2 y 3 se mide desde un punto interior de cada manzana, en línea recta, y
no cuentan los bandejones de pasto (solo_pasto): son área verde, pero no un
lugar al que se va caminando. La línea recta es más corta que el camino por
la calle, así que el acceso queda sobreestimado. El SIEDU usa la red vial;
aquí se declara la diferencia, no se esconde.

El acceso no respeta límites comunales, igual que las personas: una manzana
de Machalí a 300 m de una plaza de Rancagua tiene plaza.

    python -m indicadores.area_verde             # calcula y guarda
    python -m indicadores.area_verde --simular   # calcula y muestra
"""
import argparse

import config
from bd import Bitacora, conexion, obtener_region

ESTANDAR_M2_HAB = 10.0
DISTANCIA_PLAZA_M = 400
DISTANCIA_PARQUE_M = 3000
ANIO_POBLACION = 2024


def deficit_m2(personas, area_m2, estandar=ESTANDAR_M2_HAB):
    """Lo que falta para llegar al estándar; 0 si ya se cumple."""
    return max(0.0, estandar * personas - area_m2)


def m2_por_habitante(personas, area_m2):
    return area_m2 / personas if personas else None


# Acceso por manzana: una sola pasada, que después se agrupa por zona y comuna.
SQL_ACCESO = """
CREATE TEMP TABLE acceso ON COMMIT DROP AS
SELECT m.id_manzana, m.id_comuna, m.id_zona, m.personas,
       EXISTS (SELECT 1 FROM territorio.area_verde a
               WHERE NOT a.solo_pasto
                 AND ST_DWithin(a.geom_utm, m.punto_utm, %(plaza)s)) AS con_plaza,
       EXISTS (SELECT 1 FROM territorio.area_verde a
               WHERE NOT a.solo_pasto AND a.tipo = 'parque'
                 AND ST_DWithin(a.geom_utm, m.punto_utm, %(parque)s)) AS con_parque
FROM   territorio.manzana_censal m
JOIN   territorio.comuna c USING (id_comuna)
WHERE  c.id_region = %(region)s
"""

# El área verde de la comuna es la ya recortada a su límite urbano. La de la
# zona se recorta a la zona: un parque que cruza dos zonas se reparte.
SQL_COMUNAS = """
SELECT a.id_comuna, sum(a.personas)::int,
       COALESCE(v.area, 0), sum(a.personas) FILTER (WHERE a.con_plaza)::int,
       sum(a.personas) FILTER (WHERE a.con_parque)::int,
       COALESCE(v.plazas, 0), COALESCE(v.parques, 0), v.fecha
FROM   acceso a
LEFT   JOIN (SELECT id_comuna, sum(area_m2) AS area,
                    count(*) FILTER (WHERE tipo = 'plaza' AND NOT solo_pasto) AS plazas,
                    count(*) FILTER (WHERE tipo = 'parque' AND NOT solo_pasto) AS parques,
                    max(fecha_osm) AS fecha
             FROM   territorio.area_verde GROUP BY id_comuna) v USING (id_comuna)
GROUP  BY a.id_comuna, v.area, v.plazas, v.parques, v.fecha
"""

SQL_ZONAS = """
SELECT z.id_zona, z.id_comuna, sum(a.personas)::int,
       COALESCE((SELECT sum(ST_Area(ST_Intersection(v.geom_utm, z.geom_utm)))
                 FROM territorio.area_verde v
                 WHERE ST_Intersects(v.geom_utm, z.geom_utm)), 0),
       sum(a.personas) FILTER (WHERE a.con_plaza)::int,
       sum(a.personas) FILTER (WHERE a.con_parque)::int,
       (SELECT count(*) FROM territorio.area_verde v
        WHERE v.tipo = 'plaza' AND NOT v.solo_pasto
          AND ST_Within(ST_PointOnSurface(v.geom_utm), z.geom_utm)),
       (SELECT count(*) FROM territorio.area_verde v
        WHERE v.tipo = 'parque' AND NOT v.solo_pasto
          AND ST_Within(ST_PointOnSurface(v.geom_utm), z.geom_utm))
FROM   territorio.zona_censal z
JOIN   acceso a USING (id_zona)
GROUP  BY z.id_zona, z.id_comuna, z.geom_utm
"""

SQL_INSERTAR = """
INSERT INTO indicadores.area_verde
    (escala, id_comuna, id_zona, personas, area_verde_m2, m2_hab, deficit_m2,
     pob_plaza_400, pob_parque_3km, plazas, parques, anio_poblacion, fecha_osm)
VALUES (%(escala)s, %(id_comuna)s, %(id_zona)s, %(personas)s, %(area)s, %(m2_hab)s,
        %(deficit)s, %(plaza)s, %(parque)s, %(plazas)s, %(parques)s, %(anio)s, %(fecha)s)
"""


def fila(escala, id_comuna, id_zona, personas, area, plaza, parque, plazas, parques, fecha):
    area = float(area or 0)
    m2 = m2_por_habitante(personas, area)
    return {"escala": escala, "id_comuna": id_comuna, "id_zona": id_zona,
            "personas": personas, "area": round(area, 1),
            "m2_hab": round(m2, 2) if m2 is not None else None,
            "deficit": round(deficit_m2(personas, area), 1),
            "plaza": plaza or 0, "parque": parque or 0,
            "plazas": plazas, "parques": parques, "anio": ANIO_POBLACION, "fecha": fecha}


def calcular(id_region):
    with conexion() as con:
        con.execute(SQL_ACCESO, {"region": id_region, "plaza": DISTANCIA_PLAZA_M,
                                 "parque": DISTANCIA_PARQUE_M})
        comunas = con.execute(SQL_COMUNAS).fetchall()
        zonas = con.execute(SQL_ZONAS).fetchall()
    fecha = max((c[7] for c in comunas if c[7]), default=None)
    filas = [fila("comuna", c[0], None, c[1], c[2], c[3], c[4], c[5], c[6], fecha) for c in comunas]
    filas += [fila("zona", z[1], z[0], z[2], z[3], z[4], z[5], z[6], z[7], fecha) for z in zonas]
    return filas


def guardar(filas):
    with conexion() as con:
        with con.cursor() as cur:
            cur.executemany(SQL_INSERTAR, filas)
    return len(filas)


def resumir(filas, nombres):
    comunas = sorted((f for f in filas if f["escala"] == "comuna"),
                     key=lambda f: -f["personas"])
    print("  %-16s %9s %8s %9s %8s %8s" % ("comuna", "personas", "m2/hab", "déficit ha",
                                          "plaza400", "parque3k"))
    for f in comunas[:12]:
        print("  %-16s %9d %8.1f %9.1f %7.0f%% %7.0f%%" % (
            nombres.get(f["id_comuna"], f["id_comuna"])[:16], f["personas"], f["m2_hab"] or 0,
            f["deficit"] / 10000, 100.0 * f["plaza"] / f["personas"],
            100.0 * f["parque"] / f["personas"]))
    zonas = [f for f in filas if f["escala"] == "zona"]
    print("  %d comunas y %d zonas censales" % (len(comunas), len(zonas)))


def main():
    p = argparse.ArgumentParser(description="Déficit de áreas verdes (SIEDU)")
    p.add_argument("--region", type=int, default=config.ID_REGION)
    p.add_argument("--simular", action="store_true")
    args = p.parse_args()

    region = obtener_region(args.region)
    print("\nÁreas verdes por habitante — %s" % region.nombre)
    filas = calcular(args.region)
    with conexion() as con:
        nombres = dict(con.execute("SELECT id_comuna, nombre FROM territorio.comuna").fetchall())
    resumir(filas, nombres)
    if args.simular:
        print("  (simulación: no se escribe)")
        return
    with Bitacora("Déficit de áreas verdes — %s" % region.nombre, fuente="osm_areas_verdes") as b:
        b.registros = guardar(filas)


if __name__ == "__main__":
    main()
