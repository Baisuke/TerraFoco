# Despliegue y Codespaces

Tres formas de mostrar TerraFoco fuera del PC de desarrollo:

| Forma | Archivos | Para qué |
|---|---|---|
| **GitHub Codespaces** | `.devcontainer/` | Demo desde cualquier navegador, con escritura en vivo |
| **Servidor público** (VM Ubuntu) | `despliegue/` | Sitio con dominio y HTTPS |
| **Copia portable** | `herramientas/empaquetar_portable.py` + `lanzador_portable.py` | Pendrive, sin internet para la base ni Docker → [[Herramientas#empaquetar_portable.py]] |

---

## .devcontainer

### devcontainer.json
- Imagen `mcr.microsoft.com/devcontainers/universal:2` (la de Codespaces por defecto: trae Docker, Python y `gh`, viene precargada y no tiene nada que instalar → no tiene por dónde fallar; con `base:ubuntu` + docker-in-docker la construcción falló y entregó un contenedor de recuperación sin Docker).
- Requisitos: 2 CPU, 8 GB, 32 GB. Puertos 8000 (API) y 8081 (visor). `postCreateCommand` → `construir.sh`; `postStartCommand` → `arrancar.sh`.

### construir.sh
- Se ejecuta **una vez** al crear el Codespace: instala `python3` si falta, espera al demonio de Docker y hace `docker compose build` para que el primer arranque no tenga que construir.

### arrancar.sh
- Cada vez que el Codespace arranca o se reanuda: `docker compose up -d`, sirve el visor en un contenedor **nginx:alpine** (el `prototipo/` montado de solo lectura, puerto 8081), hace **públicos** los puertos 8000 y 8081 con `gh` (un puerto privado exige la cookie de GitHub, que el `fetch` entre orígenes no lleva) e imprime el enlace del visor **con `?api=` ya apuntado**.
- Guion de la demo: [[Documentos del proyecto#12-demo-en-codespaces.md]].

---

## despliegue/
Documento: [[Documentos del proyecto#19-despliegue.md]].

### docker-compose.yml (producción)
- Es un compose **aparte**, no una capa sobre el de desarrollo: allá la base publica el 5432, la API monta el código y se recarga, y el motor lleva credenciales de NASA y Copernicus. Nada de eso debe llegar a un servidor expuesto, y un *override* no puede quitar un puerto ya publicado.
- **Servicios:**
  - `bd` (`tf-bd`): PostGIS 16-3.4, **sin puerto publicado**, volumen `terrafoco_bd_prod`, `restart: unless-stopped`.
  - `api` (`tf-api`): construida desde `../api`, **2 workers**, sin `--reload`, `--proxy-headers`; CORS solo para `https://${DOMINIO}`.
  - `web` (`tf-web`): **Caddy 2** en 80/443, sirve `../prototipo` y hace de proxy a la API.
- **El motor no corre aquí:** procesa rásteres en el PC y el resultado se sube con `publicar.sh`.
- Variables obligatorias en `despliegue/.env` (`BD_PASSWORD`, `TERRAFOCO_CLAVE_ADMIN`, `DOMINIO`): si falta una, el compose se niega a arrancar (`${VAR:?mensaje}`).

### Caddyfile
- `{$DOMINIO}`: Caddy **pide y renueva el certificado HTTPS solo**.
- `/api/*` → `reverse_proxy api:8000` quitando el prefijo (FastAPI sigue viendo `/pertinencia`).
- El resto → `file_server` del prototipo (atiende rangos de bytes: PMTiles funciona).
- Compresión zstd/gzip; encabezados de seguridad (HSTS, `nosniff`, `Referrer-Policy`, sin `Server`); los HTML con `Cache-Control: no-cache`.

### preparar_servidor.sh
- **Una vez**, en una Ubuntu 22.04/24.04 recién creada (`sudo bash preparar_servidor.sh mi-dominio.cl`, o vía `publicar.sh --preparar`):
  1. Docker y el plugin compose desde el repositorio oficial;
  2. firewall: solo SSH, HTTP y HTTPS;
  3. `/opt/terrafoco/despliegue/.env` con contraseña de base y clave de administración **generadas en el servidor** (no viajan por la red ni quedan en el repo);
  4. respaldo diario de la base (últimos 14 días);
  5. 2 GB de swap si no hay (con 2 GB de RAM, construir la API con PostGIS arriba puede no alcanzar).
- Se puede repetir: no pisa un `.env` existente.

### publicar.sh
- Corre en Git Bash, Linux o macOS; solo necesita `ssh` y `tar`.

```bash
bash despliegue/publicar.sh usuario@IP --preparar mi-dominio.cl   # la primera vez
bash despliegue/publicar.sh usuario@IP --base --teselas           # primera carga de datos
bash despliegue/publicar.sh usuario@IP                            # solo código
```

- **El servidor no clona el repositorio:** recibe por `tar | ssh` solo `api/`, `bd/`, `prototipo/` y los archivos de `despliegue/` (sin `.env` ni `bd/respaldo`). No necesita credenciales de GitHub y nada del motor sale del PC.
- `--base`: vuelca la base local y la restaura en `tf-bd` (`pg_restore --no-owner --no-privileges`), creando antes las extensiones.
- `--teselas`: sube `prototipo/datos/teselas` (~150 MB, no están en git).

Ver también: [[Arquitectura#Dónde corre cada cosa]] · [[Privacidad y datos personales]]
