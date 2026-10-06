#!/usr/bin/env bash
# Se ejecuta UNA vez, al crear el Codespace. Construye las imagenes para que
# el primer arranque no tenga que hacerlo.
#
# Por que la imagen es "universal" y no hay features: es la imagen por defecto
# de Codespaces, viene precargada en sus servidores y trae Docker, Python y gh
# listos. Con base:ubuntu mas la feature docker-in-docker la construccion
# fallo y Codespaces entrego un contenedor de recuperacion sin Docker. La
# universal no tiene nada que instalar, asi que no tiene por donde fallar.
#
# El devcontainer.json queda en lo estrictamente estandar. Todo lo demas
# —esperas, visibilidad de puertos, el porque— vive aqui, en bash.
set -e
cd "$(dirname "$0")/.."

# La imagen base no garantiza python3, y la semilla de comunas lo necesita.
if ! command -v python3 >/dev/null 2>&1; then
  sudo apt-get update -qq && sudo apt-get install -y -qq python3
fi

# El demonio de Docker (docker-in-docker) tarda unos segundos en estar listo.
for i in $(seq 1 30); do
  docker info >/dev/null 2>&1 && break
  sleep 2
done

docker compose build
