# 19 · Despliegue en un servidor público

TerraFoco se publica en una máquina virtual con el mismo Docker que en
desarrollo, pero con otro compose: `despliegue/docker-compose.yml`.

## Qué corre en el servidor y qué no

| Pieza | Servidor | PC de desarrollo |
|---|---|---|
| Base PostGIS | ✅ sin puerto abierto a internet | ✅ |
| API | ✅ con 2 procesos, sin recarga automática y sin montar el código | ✅ |
| Sitio y HTTPS | ✅ Caddy, con certificado automático | — |
| Motor (rásteres, ingestas) | ❌ | ✅ |
| Credenciales de NASA y Copernicus | ❌ | ✅ |

El motor procesa gigabytes de rásteres y necesita las credenciales de las
fuentes. Se queda en el PC. Lo que produce, que es la base (60 MB) y las
teselas (90 MB), se sube con `despliegue/publicar.sh`.

La página y la API comparten dominio: el sitio queda en `https://dominio/` y
la API en `https://dominio/api/`. Por eso no hay CORS que configurar ni
`?api=` que pasar, porque `api-base.js` usa `/api` cuando no está en
`localhost`.

## 1. Crear la máquina (una vez, en el proveedor)

- **Opciones:** Azure for Students (100 USD sin tarjeta, con el correo de Duoc)
  o DigitalOcean con el GitHub Student Pack (200 USD). Una máquina en Google
  Cloud (Compute Engine) sirve exactamente igual.
- **Sistema:** Ubuntu 24.04 LTS, 2 vCPU y 2 a 4 GB de RAM.
- **Acceso por llave SSH.** Se crea en el PC y ahí se queda; al proveedor solo
  se le da la parte pública:
  `ssh-keygen -t ed25519 -C terrafoco`
- **Puertos abiertos en el proveedor:** 22, 80 y 443.
- **Dominio:** un registro A que apunte a la IP de la máquina. Puede ser un
  `.me` del Student Pack o un subdominio gratis de DuckDNS. Sin dominio no
  hay certificado HTTPS.
- **Alerta de gasto** en el proveedor.

## 2. Preparar y publicar (desde el PC, en Git Bash)

```bash
bash despliegue/publicar.sh usuario@IP --preparar mi-dominio.cl   # Docker, firewall, secretos, respaldo
bash despliegue/publicar.sh usuario@IP --base --teselas           # primera carga de datos
```

`--preparar` sube y corre `preparar_servidor.sh`, que hace esto:

- instala Docker y activa el firewall (22, 80 y 443);
- agrega 2 GB de swap;
- genera en el servidor el `.env` con la contraseña de la base y la clave de
  administración, que nunca pasan por el PC ni por el repositorio;
- programa un respaldo diario de la base, a las 03:30, y guarda los últimos
  14 días.

Para ver la clave de administración:

```bash
ssh usuario@IP sudo cat /opt/terrafoco/despliegue/.env
```

## 3. Actualizar

| Cambió | Comando |
|---|---|
| Código (API o prototipo) | `bash despliegue/publicar.sh usuario@IP` |
| Datos (después de correr el motor) | `bash despliegue/publicar.sh usuario@IP --base` |
| Teselas | `... --teselas` |

`--base` borra los cuatro esquemas del proyecto en el servidor y los restaura
desde la base local. El servidor es un espejo, así que lo que se edite allá (el
estado de las fuentes) se pierde en la siguiente publicación. Ese cambio se
hace en el PC.

## 4. Privacidad

El sitio es público. En la serie anual por comuna, los años con menos de 3
planes se publican reservados: sin monto, sin superficie y sin agricultores
(`MINIMO_PLANES_PUBLICABLE` en `api/rutas/comunas.py`). Son 52 combinaciones
de comuna y año.

La ficha las marca y el gráfico corta la línea en esos años, en vez de
dibujar un cero. Los totales 2012–2025 y el índice no cambian, porque la
comuna con menos planes suma 9. La copia local aplica la misma regla.

## 5. Verificado

Se levantó el compose de producción en el PC con `DOMINIO=localhost`, y se le
restauró la base como lo hace `publicar.sh --base`, dos veces seguidas. Con
eso se comprobó:

- las siete páginas cargan datos reales desde `/api`, sin `?api=`;
- las teselas se sirven por rangos (206);
- HTTP redirige a HTTPS;
- escribir sin la clave responde 401;
- las cabeceras `Strict-Transport-Security` y `no-cache` en el HTML están
  presentes.

Esa prueba dejó tres volúmenes Docker en el PC (`terrafoco_bd_prod`,
`terrafoco_caddy_datos` y `terrafoco_caddy_config`). Se pueden borrar con
`docker volume rm`.

## 6. Otras plataformas

- **Google Cloud Compute Engine:** es una VM igual a las anteriores. Sirve con
  estos mismos scripts.
- **Cloud Run o AWS Fargate:** corren contenedores sin servidor, pero
  necesitarían:
  - una base administrada aparte (Cloud SQL o RDS, las dos con PostGIS);
  - en AWS, un balanceador de carga;
  - separar Caddy o reemplazarlo por el balanceador del proveedor.

  Eso suma piezas y costo fijo mensual (la base administrada y el balanceador
  cobran aunque nadie visite el sitio), y no hay créditos de estudiante sin
  tarjeta. Para un sitio de consulta con una base de 60 MB, una VM es más
  simple y más barata.
