#!/usr/bin/env bash
# Consulta a la base con una sola palabra, sin definir variables que se pierden
# al reanudar el Codespace.
#
#   bash herramientas/sql.sh "\dn"
#   bash herramientas/sql.sh "SELECT count(*) FROM territorio.comuna;"
exec docker exec -i terrafoco-bd psql -U terrafoco -d terrafoco -tAc "$1"
