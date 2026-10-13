#!/usr/bin/env bash
# =============================================================================
# TerraFoco — preparar el servidor. UNA vez, en una máquina Ubuntu 22.04/24.04
# recién creada. Lo sube y lo corre despliegue/publicar.sh --preparar; también
# se puede correr a mano:
#
#   sudo bash preparar_servidor.sh mi-dominio.cl
#
# Qué hace:
#   1. Docker y el plugin compose, desde el repositorio oficial.
#   2. Firewall: solo SSH, HTTP y HTTPS.
#   3. /opt/terrafoco/despliegue/.env con una contraseña de base y una clave
#      de administración GENERADAS AQUÍ. No viajan por la red ni quedan en el
#      repositorio; para verlas: sudo cat /opt/terrafoco/despliegue/.env
#   4. Respaldo diario de la base, con los últimos 14 días.
#   5. 2 GB de swap si la máquina no tiene: con 2 GB de RAM, construir la
#      imagen de la API y tener PostGIS arriba a la vez puede no alcanzar.
#
# Se puede correr de nuevo: no pisa un .env que ya exista.
# =============================================================================
set -euo pipefail

DOMINIO="${1:?uso: sudo bash preparar_servidor.sh <dominio>}"
DESTINO=/opt/terrafoco
USUARIO="${SUDO_USER:-$(whoami)}"

echo "-> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$USUARIO" || true

echo "-> Firewall (22, 80, 443)"
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

echo "-> Swap"
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "-> Carpeta y secretos"
mkdir -p "$DESTINO/despliegue" "$DESTINO/respaldos"
chown -R "$USUARIO" "$DESTINO"
ENV="$DESTINO/despliegue/.env"
if [ ! -f "$ENV" ]; then
  genera() { python3 -c "import secrets; print(secrets.token_urlsafe($1))"; }
  umask 077
  cat > "$ENV" <<EOF
# Generado por preparar_servidor.sh el $(date -I). No se versiona.
DOMINIO=$DOMINIO
BD_PASSWORD=$(genera 24)
TERRAFOCO_CLAVE_ADMIN=$(genera 32)
EOF
  chown "$USUARIO" "$ENV"
  echo "   creado $ENV (sudo cat $ENV para ver la clave de administración)"
else
  sed -i "s/^DOMINIO=.*/DOMINIO=$DOMINIO/" "$ENV"
  echo "   $ENV ya existía: solo se actualizó el dominio"
fi

echo "-> Respaldo diario (03:30, 14 días)"
cat > /etc/cron.d/terrafoco-respaldo <<EOF
30 3 * * * root docker exec tf-bd pg_dump -U terrafoco -Fc terrafoco > $DESTINO/respaldos/terrafoco-\$(date +\%F).dump && find $DESTINO/respaldos -name '*.dump' -mtime +14 -delete
EOF

echo "listo. Siguiente paso, desde el PC: bash despliegue/publicar.sh"
