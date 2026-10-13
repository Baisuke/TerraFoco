#!/usr/bin/env bash
# =============================================================================
# TerraFoco — publicar desde el PC de desarrollo al servidor.
# Corre en Git Bash (Windows), Linux o macOS; solo necesita ssh y tar.
#
#   bash despliegue/publicar.sh usuario@IP --preparar mi-dominio.cl   # la primera vez
#   bash despliegue/publicar.sh usuario@IP --base --teselas           # primera carga de datos
#   bash despliegue/publicar.sh usuario@IP                            # solo código
#
#   --preparar DOMINIO  sube y corre preparar_servidor.sh (Docker, firewall, .env)
#   --base              reemplaza los datos del servidor por los de la base local
#   --teselas           sube prototipo/datos/teselas (≈150 MB; no están en git)
#
# El servidor no clona el repositorio: recibe solo api/, bd/, prototipo/ y
# despliegue/. Así no necesita credenciales de GitHub, y nada del motor ni
# del .env de desarrollo sale del PC.
# =============================================================================
set -euo pipefail

SERVIDOR="${1:?uso: bash despliegue/publicar.sh usuario@servidor [--preparar DOMINIO] [--base] [--teselas]}"
shift
PREPARAR="" ; BASE=0 ; TESELAS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --preparar) PREPARAR="${2:?--preparar necesita el dominio}"; shift 2 ;;
    --base)     BASE=1; shift ;;
    --teselas)  TESELAS=1; shift ;;
    *) echo "opción desconocida: $1"; exit 2 ;;
  esac
done

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DESTINO=/opt/terrafoco
COMPOSE="docker compose -f despliegue/docker-compose.yml --env-file despliegue/.env"
cd "$RAIZ"

if [ -n "$PREPARAR" ]; then
  echo "== Preparando el servidor para $PREPARAR"
  scp -q despliegue/preparar_servidor.sh "$SERVIDOR:/tmp/"
  ssh -t "$SERVIDOR" "sudo bash /tmp/preparar_servidor.sh $PREPARAR"
fi

echo "== Código"
# Se borra lo publicado antes, menos las teselas y el .env: un archivo que se
# eliminó en el repositorio no debe seguir sirviéndose.
ssh "$SERVIDOR" "cd $DESTINO && rm -rf api bd despliegue/*.yml despliegue/Caddyfile && \
  if [ -d prototipo ]; then find prototipo -mindepth 1 -maxdepth 1 ! -name datos -exec rm -rf {} +; \
  find prototipo/datos -mindepth 1 -maxdepth 1 ! -name teselas -exec rm -rf {} +; fi"
EXCLUIR=(--exclude='__pycache__' --exclude='.pytest_cache' --exclude='*.pyc'
         --exclude='despliegue/.env' --exclude='bd/respaldo')
[ "$TESELAS" -eq 1 ] || EXCLUIR+=(--exclude='prototipo/datos/teselas')
tar czf - "${EXCLUIR[@]}" api bd prototipo despliegue/docker-compose.yml despliegue/Caddyfile \
  | ssh "$SERVIDOR" "tar xzf - -C $DESTINO"

echo "== Contenedores"
ssh "$SERVIDOR" "cd $DESTINO && $COMPOSE up -d --build --remove-orphans"

if [ "$BASE" -eq 1 ]; then
  echo "== Base: esquemas del proyecto desde la base local"
  # Solo los esquemas propios. public trae PostGIS, que la imagen del servidor
  # ya instala; volcarlo haría chocar la extensión al restaurar.
  ssh "$SERVIDOR" "until docker exec tf-bd pg_isready -U terrafoco -q; do sleep 2; done"
  # Las mismas extensiones que la base local (operacion.cobertura_raster usa
  # el tipo raster, que no viene en la imagen por defecto).
  for ext in $(docker exec terrafoco-bd psql -U terrafoco -d terrafoco -Atc \
                 "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'"); do
    ssh "$SERVIDOR" "docker exec tf-bd psql -U terrafoco -d terrafoco -qc 'CREATE EXTENSION IF NOT EXISTS $ext'"
  done
  # Se borran los esquemas y se restaura desde cero. --clean no sirve: al
  # restaurar por segunda vez falla con las tablas particionadas (erosion,
  # susceptibilidad), cuyas llaves heredadas no se pueden soltar una a una.
  # El servidor es un espejo de la base local; lo único que se escribe allá
  # es el estado del catálogo de fuentes, y eso también viene del PC.
  ssh "$SERVIDOR" "docker exec tf-bd psql -U terrafoco -d terrafoco -qc \
      'DROP SCHEMA IF EXISTS territorio, indicadores, programas, operacion CASCADE'"
  docker exec terrafoco-bd pg_dump -U terrafoco -Fc \
      -n territorio -n indicadores -n programas -n operacion terrafoco \
    | ssh "$SERVIDOR" "docker exec -i tf-bd pg_restore -U terrafoco -d terrafoco \
        --no-owner --no-privileges --exit-on-error"
  ssh "$SERVIDOR" "docker exec tf-bd psql -U terrafoco -d terrafoco -Atc \
      \"SELECT 'comunas: ' || count(*) FROM territorio.comuna\""
fi

DOMINIO=$(ssh "$SERVIDOR" "grep ^DOMINIO= $DESTINO/despliegue/.env | cut -d= -f2")
echo "== Comprobación"
sleep 3
curl -fsS -o /dev/null -w "   https://$DOMINIO/            %{http_code}\n" "https://$DOMINIO/" || true
curl -fsS -o /dev/null -w "   https://$DOMINIO/api/salud   %{http_code}\n" "https://$DOMINIO/api/salud" || true
echo "listo: https://$DOMINIO/"
