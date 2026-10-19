# -*- coding: utf-8 -*-
"""
Estado del sistema de un vistazo: qué hay cargado y qué falta.

Pensado para el desarrollo diario y para la demostración: responde en un
segundo si la base está poblada, qué fuentes entraron, cuánto cubre cada una y
qué queda pendiente. Evita tener que recordar seis consultas distintas.

Uso:
    python -m estado
"""
import sys

import config
from bd import conexion

CONSULTAS = [
    ("Territorio", """
        SELECT 'comunas cargadas', count(*)::text
        FROM   territorio.comuna WHERE id_region = %(region)s
        UNION ALL
        SELECT 'geometrias validas',
               count(*) FILTER (WHERE ST_IsValid(geom))::text
        FROM   territorio.comuna WHERE id_region = %(region)s
    """),
    # Se toma la ULTIMA version de cada comuna, no todas las filas: la tabla es
    # historica y contar filas daba "99 comunas" en una region de 33.
    ("Erosion", """
        WITH ultima AS (
            SELECT DISTINCT ON (id_comuna, origen)
                   id_comuna, origen, anio, perdida_ton_ha, en_dominio
            FROM   indicadores.erosion
            ORDER  BY id_comuna, origen, anio DESC, calculado_en DESC
        )
        SELECT origen || ' ' || anio,
               count(*)::text || ' comunas, ' ||
               round(min(perdida_ton_ha), 1)::text || ' a ' ||
               round(max(perdida_ton_ha), 1)::text || ' t/ha/anio' ||
               ' (media ' || round(avg(perdida_ton_ha), 1)::text || ')' ||
               CASE WHEN count(*) FILTER (WHERE NOT en_dominio) > 0
                    THEN ', ' || count(*) FILTER (WHERE NOT en_dominio)::text
                         || ' fuera de dominio'
                    ELSE '' END
        FROM   ultima
        GROUP  BY origen, anio ORDER BY origen, anio
    """),
    ("Programas", """
        SELECT p.codigo || ' ' || p.organismo,
               count(*)::text || ' filas, ' ||
               count(DISTINCT e.id_comuna)::text || ' comunas, ' ||
               coalesce(round(sum(e.superficie_ha))::text, '0') || ' ha'
        FROM   programas.ejecucion e
        JOIN   programas.programa p USING (id_programa)
        GROUP  BY p.codigo, p.organismo
    """),
    ("Rechazos", """
        SELECT 'filas no asociadas', count(*)::text
        FROM   programas.ejecucion_rechazada
        HAVING count(*) > 0
    """),
    ("Ultimas ejecuciones", """
        SELECT to_char(inicio, 'DD/MM HH24:MI') || '  ' || estado,
               proceso || coalesce(' — ' || registros::text || ' registros', '')
        FROM   operacion.ejecucion_proceso
        ORDER  BY id_proceso DESC LIMIT 5
    """),
]

# Qué se necesita para calcular cada factor con datos propios.
FACTORES = [
    ("R  erosividad de la lluvia", "precipitacion mensual por comuna (DMC / CR2)"),
    ("K  erodabilidad del suelo", "estudios agrologicos de CIREN"),
    ("LS topografia", "NASADEM — necesita credenciales de NASA Earthdata"),
    ("C  cobertura vegetal", "NDVI de Sentinel-2 — credenciales listas"),
    ("P  practicas de conservacion", "SIRSD-S + superficie agricola del Censo"),
]


def bloque(titulo, sql, region):
    with conexion() as con:
        filas = con.execute(sql, {"region": region}).fetchall()
    print("\n%s" % titulo)
    print("  " + "-" * 62)
    if not filas:
        print("  (sin datos)")
        return
    for etiqueta, valor in filas:
        print("  %-28s %s" % (etiqueta, valor))


def main():
    region = config.ID_REGION
    print("\nTerraFoco — estado del sistema   (region %d)" % region)
    print("=" * 66)

    for titulo, sql in CONSULTAS:
        try:
            bloque(titulo, sql, region)
        except Exception as e:
            print("\n%s\n  ERROR: %s: %s" % (titulo, type(e).__name__, e))

    print("\nFactores propios de RUSLE")
    print("  " + "-" * 62)
    try:
        estado = config.credenciales_faltantes()
    except Exception:
        estado = []
    for nombre, necesita in FACTORES:
        print("  %-30s %s" % (nombre, necesita))

    print("\nCredenciales")
    print("  " + "-" * 62)
    for grupo in config.GRUPOS:
        falta = config.falta(grupo)
        print("  %-30s %s" % (grupo, "pendiente" if falta else "configurada"))

    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
