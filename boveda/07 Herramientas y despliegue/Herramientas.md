# Herramientas

**Carpeta:** `herramientas/`. Scripts de apoyo que **no** son parte del sistema en producción: preparar entornos, servir el visor, generar la copia local, agregar datos de INDAP sin datos personales, armar la copia portable y repartir la entrega. Se corren desde el PC (Python del sistema o Git Bash), no dentro del motor.

| Para… | Script |
|---|---|
| Dejar una base nueva lista | [[#inicializar.sh]] · [[#sembrar_comunas.py]] · [[#sql.sh]] |
| Ver el visor en desarrollo | [[#servir_prototipo.py]] · [[#rangos.py]] |
| Copia local de indicadores | [[#sembrar_indicadores.py]] |
| Datos de INDAP sin datos personales | [[#agregar_entrega_indap.py]] |
| Demostrar escritura y lectura | [[#demostracion.py]] |
| Copia portable (pendrive) | [[#empaquetar_portable.py]] · [[#lanzador_portable.py]] · [[#base_portable.py]] |
| Entrega académica | [[#sincronizar.py]] · [[#dividir_entrega.py]] |

---

## inicializar.sh
- **Uso:** `bash herramientas/inicializar.sh` (con el compose arriba).
- **Qué hace:** espera a la base, aplica **todas las migraciones en orden** (`bd/migraciones/*.sql`), carga las 33 comunas (vía `sembrar_comunas.py`) y, si están vacías, carga las semillas del índice (`ingesta.sirsd_serie` e `indicadores.superficie_erosionada --desde-semilla`). Termina mostrando cuántas comunas tienen UF/ha y cuántas están en el dominio. Idempotente.
- **Por qué existe:** Postgres solo ejecuta automáticamente la raíz de `/docker-entrypoint-initdb.d` (el `esquema.sql`); las migraciones están en un subdirectorio. Sin ellas faltan `indicadores.factor`, `en_dominio`… y la pertinencia responde error. → [[Migraciones]]

## sembrar_comunas.py
- **Uso:** `python herramientas/sembrar_comunas.py | docker exec -i terrafoco-bd psql -U terrafoco -d terrafoco -v ON_ERROR_STOP=1`.
- **Qué hace:** genera el SQL que carga las 33 comunas desde `prototipo/datos/comunas.geojson` (copia de IDE Chile). El cargador oficial (`ingesta.vectorial`) exige un shapefile bajado a mano; esto levanta cualquier entorno (otro PC, un Codespace) sin descargar nada.

## sql.sh
- **Uso:** `bash herramientas/sql.sh "SELECT count(*) FROM territorio.comuna;"`.
- Consulta la base con una palabra, sin variables de entorno que se pierden al reanudar un Codespace.

## servir_prototipo.py
- **Uso:** `python herramientas/servir_prototipo.py prototipo 8081`.
- Servidor HTTP del visor **sin caché** (`Cache-Control: no-store`), **con peticiones de rango** (usa [[#rangos.py]]) y **con hilos** (`ThreadingHTTPServer`). `python -m http.server` no manda Cache-Control (el navegador se queda con el JS viejo: "costó dos tardes") ni soporta rangos; y un servidor de un solo hilo se queda esperando en una conexión que el navegador abre por adelantado y no usa, y la página no carga nunca.
- También se levanta desde la app de Claude con `.claude/launch.json` (configuración `visor`).

## rangos.py
- Clase `ConRangos` para `http.server`: atiende **una cabecera `Range` por petición** (206 Partial Content). Sin esto, el servidor de Python devuelve el archivo entero con 200, el lector de PMTiles lo rechaza y el visor cae a los PNG **sin avisar**. Lo usan `servir_prototipo.py` y el lanzador portable. → [[Teselas y PMTiles]]

## sembrar_indicadores.py
- **Uso:** `python herramientas/sembrar_indicadores.py [--origen TerraFoco]` (con la API arriba).
- Genera `prototipo/datos/indicadores.js`: los **últimos valores reales** (pertinencia de ambos orígenes, factores, serie SIRSD-S, focalización, inundación y eventos, urbano, áreas verdes) en JSON compacto. Usa `api/focalizacion.py` para las mismas cuentas que la API. → [[Copia local y modo sin API]]

## agregar_entrega_indap.py
- **Uso:** `python herramientas/agregar_entrega_indap.py "<carpeta con las planillas>" [--salida otro.csv]`.
- Agrega la entrega oficial de INDAP ("1- Solo Planes <año>.xlsx") por comuna y año. **Las planillas traen RUT, nombres, sexo, etnia, rol y nombre de predio**: la herramienta lee **solo columnas no personales, por nombre** (`COLUMNAS`), suma y escribe únicamente el agregado. Las planillas nunca se versionan ni se cargan.
- Misma definición que la serie: ejecutado = *Declaración Jurada* o *Traspasado a Tesorería*; año = el de la declaración; comuna del predio → código INE (`codigos_ine`).
- **Salida:** `bd/semillas/sirsd_complemento_oficial_2012_2025.csv`. → [[Semillas]] · [[Privacidad y datos personales]]

## demostracion.py
- **Uso:** `python herramientas/demostracion.py` · `--simular` · `--sin-motor`.
- Evidencia **reproducible** del ciclo escritura → lectura: escribe por la API (catálogo de fuentes, con la clave del `.env`, sin imprimirla) y por el motor (`python -m calcular`: recalcula la erosión desde los factores guardados), cuenta filas antes y después, lee por la API y muestra la bitácora. Muestra que **las dos vías de escritura son distintas a propósito**. → [[Documentos del proyecto#12-demo-en-codespaces.md]]

## empaquetar_portable.py
- **Uso:** `python herramientas/empaquetar_portable.py` (todo) · `--solo-datos` (recargar la base) · `--solo-exe` (recompilar el .exe).
- **Qué arma** en `dist/TerraFoco-portable/` (o en `TERRAFOCO_DIST`, útil si el repo está en OneDrive):
  - `TerraFoco.exe` — el lanzador compilado con **PyInstaller** (`--onefile`, ~20 MB);
  - `pgsql/` — PostgreSQL 16 + PostGIS 3.4 para Windows (binarios oficiales);
  - `datos/` — el **volcado** de la base (`terrafoco.sql.gz`, ~47 MB) y `version.txt`. Viaja siempre;
  - `base/` — el **cluster ya cargado** (~215 MB), si este equipo pudo armarlo: el primer arranque son segundos;
  - `api/` — la API en `.py` (se puede corregir sin recompilar);
  - `prototipo/` — el visor, con la copia local y las teselas.
- **Pasos:** descarga binarios → `revisar_datos` (que la base de desarrollo tenga el índice completo) → `volcar_desde_docker` (gzip) → si PostgreSQL corre aquí, arma el cluster en `base.nuevo` y **recién al final** reemplaza `base/` → copia la aplicación → venv de compilación → `compilar_exe`.
- **Si Windows no deja ejecutar PostgreSQL** (Control inteligente de aplicaciones), la copia sale solo con el volcado y avisa: el `.exe` crea la base en su primer arranque. Antes, un `initdb` fallido borraba la base anterior y dejaba la copia sin datos.
- **Requiere Docker arriba** (los datos salen de la base de desarrollo). La carpeta pesa ~860 MB; el `.zip` para compartir, menos de la mitad.

## lanzador_portable.py
- **Qué es:** el código de `TerraFoco.exe`. Levanta **PostgreSQL** (puerto 55432 o el siguiente libre, para no chocar con uno instalado), la **API** (uvicorn, 8000 o libre) y el **visor** (8081 o libre, con rangos), y abre el navegador con `?api=` apuntado. Al cerrar, apaga PostgreSQL limpio.
- **Detalles:** `puerto_libre` comprueba que nadie escuche (en Windows, enlazar `127.0.0.1:8000` funciona aunque Docker escuche en `0.0.0.0:8000`); si no hay clave, **genera una por sesión** (`secrets.token_urlsafe`) y la muestra en su ventana para pegarla en el panel de Fuentes (vale mientras la ventana esté abierta; la base solo escucha en 127.0.0.1); sin consola visible para los procesos hijos.
- **Antes de arrancar:** `comprobar` (carpetas, no administrador, permiso de escritura y que Windows deje ejecutar PostgreSQL, con un mensaje claro si no) y `preparar_base`: si `base/` falta o es de otro volcado, la crea desde `datos/terrafoco.sql.gz` (≈20 s a 2 min, una sola vez). → [[#base_portable.py]]
- Es el **respaldo de la demo** cuando no hay GitHub/Codespaces: corre en cualquier Windows sin instalar nada. Los mapas base siguen necesitando internet.

## base_portable.py
- **Qué es:** la lógica compartida por el empaquetador y el lanzador para **crear la base de la copia portable desde el volcado**.
- **Funciones:** `postgres_corre` (pregunta antes si Windows deja ejecutar `postgres.exe`; con Smart App Control termina con `0xC0E90002` sin decir nada), `construir` (initdb → arranque en 127.0.0.1 → base y extensiones `postgis`, `postgis_raster` → `restaurar` → `vacuumdb` → apagado; si algo falla, borra lo creado), `restaurar` (pasa el `.sql.gz` a psql por la entrada estándar, sin descomprimir a disco), `al_dia` (si `base/` salió del volcado que trae la copia: compara `base/terrafoco_version.txt` con `datos/version.txt`), `reemplazar` (el cluster nuevo pasa a ser `base/` solo cuando está completo).
- **Idea:** `base/` es un **cache** del volcado. El volcado es la fuente de verdad.

## sincronizar.py
- **Uso:** `python herramientas/sincronizar.py --simular` · sin bandera para copiar.
- Copia el código a la estructura de carpetas por fase que exige la entrega APT122 (`Fase 2/Evidencias Proyecto/...`). **Un solo sentido** (de aquí hacia la entrega; cada carpeta copiada lleva un `GENERADO.md` que lo advierte). **El `.env` nunca se copia.**

## dividir_entrega.py
- **Uso:**

```bash
python herramientas/dividir_entrega.py plan --destino ../TerraFoco --guardar [--markdown entrega.md]
python herramientas/dividir_entrega.py aplicar --persona carla --destino ../TerraFoco --sesion 1
python herramientas/dividir_entrega.py verificar --destino ../TerraFoco
```

- **Para qué:** el repo de desarrollo se trabajó en conjunto desde un PC, así que su historial no dice quién hizo qué. Para la entrega (`github.com/Baisuke/TerraFoco`, código en la raíz) cada integrante sube **un tercio** desde su cuenta, y **un poco de todo** (cada área repartida cerca de un tercio).
- **Reglas:** un archivo va **con su prueba**; reparto codicioso por área de mayor a menor y luego equilibrio global (`PISO_AREA = 0.20`: nadie queda con menos del 20 % de un área); binarios por cantidad; **determinista**. `boveda/` cuenta como documentación.
- **Compensa los commits previos:** lee cuántos commits tiene cada uno en el repo final (`IDENTIDADES`: usuario, nombre o correo de cada uno) y reparte los nuevos para que el total quede parejo (`objetivos_de`, `ajustar_commits` parte o junta lotes). Con 6/5/5 previos: 18/19/19 nuevos → 24 cada uno.
- **Plan congelado:** `--guardar` escribe `herramientas/reparto_entrega.json` con el **commit exacto** del repo de desarrollo y la lista de commits de cada uno. `aplicar` y `verificar` leen solo eso y toman el contenido **de ese commit** (no de la carpeta de trabajo): los tres suben lo mismo aunque el repo final o el de desarrollo cambien entremedio.
- **Tres sesiones:** `--sesion 1|2|3|todas`; exige las anteriores y salta lo que ya está aplicado, así que se puede repetir.
- **Control de identidad:** se niega si el `user.name`/`user.email` del clon no es el de la persona: nadie sube la parte de otro. También exige el clon limpio y al día con GitHub. **No hace push.**
- Fuera de la entrega: la herramienta, su plan, su instructivo y `.claude/launch.json`. Instructivo para el equipo: `herramientas/MIGRACION_ENTREGA.md`.

Ver también: [[Despliegue y Codespaces]] · [[Archivos de la raíz]]
