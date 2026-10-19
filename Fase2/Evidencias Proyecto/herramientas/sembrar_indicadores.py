# -*- coding: utf-8 -*-
"""
Genera el respaldo de indicadores que usa el prototipo cuando no hay API.

El prototipo trae en js/data.js 33 comunas con cifras de ejemplo, escritas a
mano en la fase del prototipo no funcional. Cuando la API no responde el
visor cae a esas cifras, y aunque el badge lo declara, lo que se ve son
numeros inventados: Litueche aparecia con 38,4 t/ha cuando el dato real es
4,64.

Este archivo reemplaza ese respaldo por los ultimos valores reales conocidos.
Sigue siendo una copia y el badge lo sigue diciendo, pero deja de ser
ficcion.

Se sirve como <script> y no como JSON por la misma razon que comunas.js:
abrir el prototipo con doble clic usa file://, donde fetch() de un archivo
local esta bloqueado.

Uso:
    python herramientas/sembrar_indicadores.py
    python herramientas/sembrar_indicadores.py --origen TerraFoco
"""
import argparse
import json
import os
import subprocess
import sys

DESTINO = os.path.join(os.path.dirname(__file__), "..",
                       "prototipo", "datos", "indicadores.js")
CONTENEDOR = "terrafoco-bd"

# Los nombres de campo son los de la API, no unos propios.
#
# El respaldo lo consume la misma funcion que la respuesta en vivo, asi que
# tiene que tener exactamente su forma. Con nombres propios todo salia
# undefined y la pantalla reventaba en un .toFixed() sobre un indice que no
# existia: el respaldo se cargaba "bien" y rompia la pagina.
# El NDVI y la pendiente van con los mismos criterios que /comunas/terreno
# (api/rutas/comunas.py): sin ellos, abrir el prototipo sin API volvía a
# pintar las capas de cobertura y pendiente con valores de ejemplo.
SQL = """
SELECT json_agg(f ORDER BY f.nombre)
FROM (
  SELECT p.id_comuna, p.nombre, p.provincia, p.superficie_km2,
         p.perdida_ton_ha, p.clase,
         p.ha_bonificadas, p.monto_total, p.beneficiarios,
         p.pertinencia, p.precision_dato, p.en_dominio,
         -- La inversión del índice desde la migración 013.
         p.planes, round(p.incentivo_uf::numeric, 1) AS incentivo_uf,
         round(p.ha_erosion_severa::numeric, 1) AS ha_erosion_severa,
         round(p.inversion_uf_ha::numeric, 4) AS inversion_uf_ha,
         p.anio_desde, p.anio_hasta,
         round(n.ndvi::numeric, 3) AS ndvi_mediana,
         round(t.valor::numeric, 1) AS pendiente_media,
         -- Las dos erosiones, como /comunas/erosion: sin ellas la
         -- comparación CIREN / cálculo propio volvía a ser de ejemplo.
         round(ci.perdida_ton_ha::numeric, 2) AS erosion_ciren,
         ci.clase AS clase_ciren, ci.anio AS anio_ciren,
         round(tf.perdida_ton_ha::numeric, 2) AS erosion_terrafoco,
         tf.clase AS clase_terrafoco, tf.anio AS anio_terrafoco,
         tf.en_dominio AS terrafoco_en_dominio
  FROM   indicadores.v_pertinencia p
  LEFT   JOIN LATERAL (
           SELECT e.perdida_ton_ha, e.clase, e.anio FROM indicadores.erosion e
           WHERE  e.id_comuna = p.id_comuna AND e.origen = 'CIREN'
           ORDER  BY e.anio DESC, e.calculado_en DESC LIMIT 1) ci ON true
  LEFT   JOIN LATERAL (
           SELECT e.perdida_ton_ha, e.clase, e.anio, e.en_dominio FROM indicadores.erosion e
           WHERE  e.id_comuna = p.id_comuna AND e.origen = 'TerraFoco'
           ORDER  BY e.anio DESC, e.calculado_en DESC LIMIT 1) tf ON true
  LEFT   JOIN LATERAL (
           SELECT (f.detalle->>'ndvi_mediana')::float AS ndvi
           FROM   indicadores.factor f
           WHERE  f.id_comuna = p.id_comuna AND f.factor = 'C'
             AND  f.detalle->>'ndvi_mediana' IS NOT NULL
           ORDER  BY (f.detalle->>'resolucion_m') = '30' DESC, f.calculado_en DESC
           LIMIT  1) n ON true
  LEFT   JOIN LATERAL (
           SELECT v.valor
           FROM   indicadores.variable_inundacion v
           WHERE  v.id_comuna = p.id_comuna AND v.variable = 'pendiente'
           ORDER  BY v.calculado_en DESC
           LIMIT  1) t ON true
  WHERE  p.id_region = %(region)s AND p.origen = %(origen)s
) f
"""

# La serie anual del SIRSD-S por comuna, para la ficha sin API. Como listas
# y no como objetos: son 425 filas y con nombres de campo el archivo pesaba
# el triple. El orden de las columnas es el de GT.serieSirsd (datos-api.js).
# Con la misma reserva que /comunas/{id}/sirsd: menos de 3 planes, solo el
# año y todo lo demás en null (la copia también se publica).
SQL_SIRSD = """
SELECT json_object_agg(id_comuna, filas)
FROM (
  SELECT s.id_comuna,
         json_agg(CASE WHEN s.planes < 3 THEN json_build_array(s.anio, NULL, NULL, NULL, NULL, NULL)
                  ELSE json_build_array(s.anio, s.planes, s.agricultores,
                                   s.incentivo,
                                   round((s.incentivo / u.uf_promedio)::numeric, 1),
                                   s.ha_reales) END ORDER BY s.anio) AS filas
  FROM   programas.sirsd_anual s
  JOIN   territorio.comuna c USING (id_comuna)
  LEFT   JOIN programas.uf_anual u USING (anio)
  WHERE  c.id_region = %(region)s
  GROUP  BY s.id_comuna
) t
"""


def desde_api(modulo, funcion, argumentos, que):
    """Una respuesta de la API, con la MISMA función que la sirve.

    Se ejecuta dentro del contenedor de la API en vez de repetir aquí su
    consulta: los factores arman su procedencia y la brecha y la evolución
    sus cuentas (api/focalizacion.py) con reglas que no conviene tener
    escritas dos veces. Si la API no está levantada, la copia sale sin esa
    parte y cada pantalla lo rotula.
    """
    r = subprocess.run(
        ["docker", "exec", "-i", "terrafoco-api", "python", "-c",
         "import json; from %s import %s; print(json.dumps(%s(%s), ensure_ascii=False))"
         % (modulo, funcion, funcion, argumentos)],
        capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        print("   (sin %s: %s)" % (que, r.stderr.strip().splitlines()[-1:]))
        return None
    return json.loads(r.stdout)


def consultar(sql):
    """Se consulta por docker exec para no exigir psycopg en el equipo.

    La herramienta la corre quien prepara el entorno, no el motor, y pedirle
    que instale el cliente de PostgreSQL solo para esto seria un estorbo.
    """
    r = subprocess.run(
        ["docker", "exec", "-i", CONTENEDOR, "psql", "-U", "terrafoco",
         "-d", "terrafoco", "-tAc", sql],
        capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        sys.exit("psql fallo: %s" % r.stderr.strip())
    return r.stdout.strip()


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    p.add_argument("--region", type=int, default=6)
    p.add_argument("--origen", default="CIREN")
    args = p.parse_args()

    salida = consultar(SQL.replace("%(region)s", str(args.region))
                          .replace("%(origen)s", "'%s'" % args.origen))
    if not salida or salida == "":
        sys.exit("Sin filas para origen=%s. Hay datos cargados?" % args.origen)

    filas = json.loads(salida)
    serie = json.loads(consultar(SQL_SIRSD.replace("%(region)s", str(args.region)))
                       or "{}")
    factores = desde_api("rutas.comunas", "factores", args.region, "factores RUSLE")

    # La brecha en UF por comuna, de /pertinencia: se agrega a cada fila con
    # los mismos nombres de campo, para que la copia tenga la forma de la
    # respuesta en vivo.
    pert = desde_api("rutas.pertinencia", "listar",
                     "%d, %r, True, 0" % (args.region, args.origen), "brecha en UF")
    if pert:
        por_id = {f["id_comuna"]: f for f in pert}
        for fila in filas:
            v = por_id.get(fila["id_comuna"], {})
            fila["mediana_uf_ha"] = v.get("mediana_uf_ha")
            fila["brecha_uf"] = v.get("brecha_uf")
    evolucion = desde_api("rutas.pertinencia", "evolucion",
                          "%d, %r" % (args.region, args.origen), "evolución de la focalización")

    # Los módulos 2 y 3 también: sin esto, abrir el prototipo sin API volvía
    # a mostrar eventos de inundación y unidades vecinales inventadas.
    inundacion = desde_api("rutas.inundacion", "listar", args.region, "índice de inundación")
    eventos = desde_api("rutas.inundacion", "eventos", args.region, "eventos de inundación")
    urbano = desde_api("rutas.urbano", "listar", args.region, "temperatura urbana")
    verdes = desde_api("rutas.urbano", "areas_verdes", "%d, None" % args.region, "áreas verdes")

    cuerpo = json.dumps({"origen": args.origen, "comunas": filas,
                         "sirsd": serie, "factores": factores,
                         "evolucion": evolucion,
                         "inundacion": inundacion, "eventos_inundacion": eventos,
                         "urbano": urbano, "areas_verdes": verdes},
                        # Compacto: es un dato generado, no algo que se lea
                        # a mano. Indentado pesaba un tercio más y eran
                        # 13 mil líneas en cada diff.
                        ensure_ascii=False, separators=(",", ":"), default=str)

    with open(DESTINO, "w", encoding="utf-8") as f:
        f.write(
            "/* TerraFoco - Respaldo de indicadores, generado por\n"
            "   herramientas/sembrar_indicadores.py el %s.\n"
            "\n"
            "   Son los ultimos valores REALES conocidos, no cifras de\n"
            "   ejemplo. El prototipo los usa cuando la API no responde, y el\n"
            "   badge sigue declarando que es una copia y no una consulta en\n"
            "   vivo.\n"
            "\n"
            "   Se sirve como <script> porque al abrir el prototipo con doble\n"
            "   clic la pagina viene de file://, donde fetch() de un archivo\n"
            "   local esta bloqueado. */\n"
            "window.TERRAFOCO_INDICADORES = %s;\n"
            % (consultar("SELECT to_char(now(), 'DD-MM-YYYY')"), cuerpo))

    print("OK %s" % os.path.relpath(DESTINO))
    print("   %d comunas, origen %s" % (len(filas), args.origen))
    print("   serie SIRSD-S de %d comunas" % len(serie))
    if factores:
        print("   factores RUSLE de %d comunas"
              % sum(1 for c in factores["comunas"] if c["factores"]))
    if pert:
        print("   brecha en UF de %d comunas"
              % sum(1 for f in filas if f.get("brecha_uf")))
    if evolucion:
        print("   focalizacion %d-%d" % (evolucion["serie"][0]["anio"],
                                        evolucion["serie"][-1]["anio"]))
    if inundacion:
        print("   inundación de %d comunas, %d eventos"
              % (len(inundacion), (eventos or {}).get("total", 0)))
    if urbano:
        print("   temperatura de %d comunas" % len(urbano.get("comunas", [])))
    if verdes:
        print("   áreas verdes de %d comunas y %d zonas" % (len(verdes["comunas"]), len(verdes["zonas"])))
    print("   %.1f KB" % (os.path.getsize(DESTINO) / 1024.0))


if __name__ == "__main__":
    main()
