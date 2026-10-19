# Privacidad y datos personales

El proyecto declaró ante INDAP que trabaja **solo con agregados comunales**. La promesa se cumple **en el código**, no solo en el correo. Marco legal: Ley 19.628 sobre protección de la vida privada.

## Qué nunca entra

| Dato | Dónde aparece | Qué se hace |
|---|---|---|
| RUT, nombre, sexo, etnia del beneficiario; rol y nombre del predio | Planillas oficiales de INDAP ("1- Solo Planes <año>.xlsx") | **No se versionan ni se cargan.** `agregar_entrega_indap.py` lee solo columnas no personales, **por nombre**, y escribe el agregado comuna-año. → [[Herramientas#agregar_entrega_indap.py]] |
| `nom_operad` (nombre del agricultor), `rol_4` (rol de la propiedad) | Servicio público de IDE MINAGRI | `sirsd_ide.py` los **descarta explícitamente** y agrega por comuna antes de escribir. Que la fuente los publique no obliga a replicarlos. → [[Motor - ingesta#sirsd_ide.py]] |
| Datos por persona del Censo | — | Nunca se leen: la base del INE ya viene agregada por manzana/entidad; se toman solo totales de personas y viviendas. → [[Motor - ingesta#poblacion_censal.py]] |
| Los predios del usuario | Mis predios (`predios.html`) | **Todo ocurre en el navegador**: el CSV se lee ahí, se cruza con las teselas y se olvida al cerrar la pestaña. No se sube a ningún servidor. → [[Visor - mapas y módulos#predios.js]] |

## Credenciales y secretos

- El `.env` (contraseñas de NASA, Copernicus, clave de administración) **nunca se versiona** (`.gitignore`) ni se copia a la entrega (`sincronizar.py` lo excluye). → [[Archivos de la raíz#.env.ejemplo]]
- En el servidor público, la contraseña de la base y la clave de administración **se generan en el servidor** (`preparar_servidor.sh`): no viajan por la red. → [[Despliegue y Codespaces#preparar_servidor.sh]]
- La clave de administración **no se imprime ni se repite** en documentos ni conversaciones.

## Seguridad de la API

- Lectura pública por diseño (RF-29): los indicadores son para quien quiera consultarlos.
- La única escritura (catálogo de fuentes) exige `Authorization: Bearer <clave>`; **cerrada por defecto** (sin clave configurada o con una corta responde 503); comparación en **tiempo constante**. → [[API - núcleo#seguridad.py]]
- En producción la base **no expone puerto** a internet. → [[Despliegue y Codespaces#docker-compose.yml (producción)]]

Documento: [[Documentos del proyecto#19-despliegue.md]] (sección Privacidad).
