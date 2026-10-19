# -*- coding: utf-8 -*-
"""
Genera el SQL que carga las 33 comunas desde la copia estática del prototipo.

El circuito base -> API -> visor necesita comunas en territorio.comuna, y el
cargador oficial (ingesta.vectorial) exige un shapefile descargado a mano. Para
levantar un entorno nuevo —otro computador, un Codespace— basta con la misma
copia de IDE Chile que el prototipo ya trae en datos/comunas.geojson.

Uso:
    python herramientas/sembrar_comunas.py \
      | docker exec -i terrafoco-bd psql -U terrafoco -d terrafoco -v ON_ERROR_STOP=1
"""
import json
import os
import sys

RUTA = os.path.join(os.path.dirname(__file__), "..", "prototipo", "datos", "comunas.geojson")


def main():
    # En Windows la salida estándar va en la página de códigos de la consola
    # (cp1252) y la ü de Marchigüe llega a psql como un byte inválido. Se
    # fuerza UTF-8 para que el mismo script sirva en Windows y en Linux.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    with open(RUTA, encoding="utf-8") as f:
        datos = json.load(f)

    print("-- 33 comunas de O'Higgins, copia estatica de IDE Chile")
    print("BEGIN;")
    for rasgo in datos["features"]:
        p = rasgo["properties"]
        geom = json.dumps(rasgo["geometry"])
        sup = "NULL" if p.get("superficie_km2") is None else p["superficie_km2"]
        print(
            "INSERT INTO territorio.comuna "
            "(id_comuna, id_region, nombre, provincia, superficie_km2, geom) VALUES "
            "(%d, 6, '%s', '%s', %s, "
            "ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON('%s'), 4326)))) "
            "ON CONFLICT (id_comuna) DO NOTHING;"
            % (p["id_comuna"], p["nombre"].replace("'", "''"),
               p["provincia"].replace("'", "''"), sup, geom)
        )
    print("COMMIT;")
    print("-- %d comunas" % len(datos["features"]), file=sys.stderr)


if __name__ == "__main__":
    main()
