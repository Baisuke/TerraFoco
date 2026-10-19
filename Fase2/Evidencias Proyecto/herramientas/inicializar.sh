#!/usr/bin/env bash
# =============================================================================
# Deja una base recién creada lista para el circuito completo:
# migraciones aplicadas y las 33 comunas cargadas.
#
# Es idempotente: se puede correr de nuevo sin romper nada. Las migraciones
# usan IF NOT EXISTS / DROP IF EXISTS y la semilla hace ON CONFLICT DO NOTHING.
#
# Uso, con el compose ya levantado:
#     bash herramientas/inicializar.sh
# =============================================================================
set -e
cd "$(dirname "$0")/.."

PSQL="docker exec -i terrafoco-bd psql -U terrafoco -d terrafoco -v ON_ERROR_STOP=1 -q"

echo "-> esperando a la base"
for i in $(seq 1 30); do
  if docker exec terrafoco-bd pg_isready -U terrafoco -d terrafoco >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "-> migraciones"
for f in bd/migraciones/*.sql; do
  echo "   $(basename "$f")"
  $PSQL < "$f"
done

echo "-> comunas"
python3 herramientas/sembrar_comunas.py 2>/dev/null | $PSQL
$PSQL -tAc "SELECT '   '||count(*)||' comunas, '||count(*) FILTER (WHERE ST_IsValid(geom))||' validas' FROM territorio.comuna;"

# El índice de pertinencia necesita dos tablas que no salen de las
# migraciones: la serie del SIRSD-S y la superficie con erosión severa. Las
# dos están versionadas en bd/semillas. Sin ellas la vista deja las 33
# comunas fuera del índice y la página se ve vacía, que es lo que pasaba en
# cualquier equipo distinto del que corrió el motor (y en la copia portable
# armada ahí). Se cargan solo si faltan.
echo "-> datos del índice"
contar() { $PSQL -tAc "SELECT count(*) FROM $1" 2>/dev/null | tr -d '[:space:]'; }
MOTOR="docker compose run --rm -T motor python -m"
if [ "$(contar programas.sirsd_anual)" = "0" ]; then
  echo "   serie SIRSD-S: cargando la semilla"
  $MOTOR ingesta.sirsd_serie
fi
if [ "$(contar indicadores.superficie_erosionada)" = "0" ]; then
  echo "   superficie con erosión severa: cargando la semilla"
  $MOTOR indicadores.superficie_erosionada --desde-semilla
fi
$PSQL -tAc "SELECT '   '||count(*) FILTER (WHERE inversion_uf_ha IS NOT NULL)||' comunas con UF/ha, '||count(*) FILTER (WHERE en_dominio)||' en el dominio' FROM indicadores.v_pertinencia WHERE origen = 'CIREN';"

echo "-> listo. Ver estado:  docker exec -i terrafoco-programador python -m estado"
