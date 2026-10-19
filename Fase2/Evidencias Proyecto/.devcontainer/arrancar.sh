#!/usr/bin/env bash
# Se ejecuta cada vez que el Codespace arranca o se reanuda: levanta el
# compose, sirve el prototipo y deja impreso el enlace de la demo con la API
# ya apuntada. Sin el parametro ?api= el visor buscaria localhost:8000, que en
# el navegador del publico no existe.
set -e
cd "$(dirname "$0")/.."

for i in $(seq 1 30); do
  docker info >/dev/null 2>&1 && break
  sleep 2
done

docker compose up -d

# El prototipo es estatico. Se sirve desde un contenedor nginx para no
# depender de python en el host; los archivos se montan, no se copian, asi
# que un cambio en el JS se ve al recargar.
docker rm -f terrafoco-visor >/dev/null 2>&1 || true
docker run -d --name terrafoco-visor -p 8081:80 \
  -v "$PWD/prototipo:/usr/share/nginx/html:ro" nginx:alpine >/dev/null

# El visor (8081) llama a la API (8000) desde el navegador. Un puerto privado
# exige la cookie de GitHub y ese fetch entre origenes no la lleva: la API
# tiene que ser publica. Se intenta por gh; si no esta, se indica a mano.
if [ -n "$CODESPACE_NAME" ]; then
  if command -v gh >/dev/null 2>&1; then
    gh codespace ports visibility 8000:public 8081:public -c "$CODESPACE_NAME" \
      >/dev/null 2>&1 || echo "AVISO: no se pudo hacer publicos los puertos; hacerlo en el panel Ports."
  else
    echo "AVISO: panel Ports -> puerto 8000 -> Port Visibility -> Public"
  fi
  DOM="$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"
  API="https://${CODESPACE_NAME}-8000.${DOM}"
  VISOR="https://${CODESPACE_NAME}-8081.${DOM}"
  echo
  echo "=============================================================="
  echo " TerraFoco en Codespaces"
  echo "   API   : $API/docs"
  echo "   Visor : $VISOR/visor.html?api=$API"
  echo
  echo " Abre el visor con ese enlace UNA vez: el parametro ?api= queda"
  echo " guardado en el navegador y las demas paginas lo reutilizan."
  echo "=============================================================="
fi
