# Demostrar el sistema sin el computador de nadie

Cómo presentar TerraFoco —modelo de datos, lectura y **escritura** a la base—
desde cualquier navegador, con GitHub Codespaces. Pensado para la entrega del
20% funcionando.

---

## 1. Por qué Codespaces y no otra cosa

La API es solo lectura: no tiene ningún endpoint que escriba. **Toda la
escritura la hace el motor**, con `docker exec`, descargando de fuentes
externas. Por eso "mostrar escritura" significa correr una ingesta en vivo, y
eso exige un sitio que ejecute el `docker-compose` completo.

De las opciones gratis, Codespaces es la única que:

- corre el compose tal cual, sin adaptar nada;
- se abre desde cualquier navegador con la cuenta de GitHub;
- no pide tarjeta: 120 horas-core al mes con cuenta personal (60 h con la
  máquina de 2 núcleos que usa este repo);
- **conserva los volúmenes de Docker al detenerse**, así que los datos que se
  cargan una vez se quedan.

La configuración está en `.devcontainer/`. Al crear el Codespace se construyen
las imágenes; al arrancar, se levanta el compose y se sirve el prototipo.

---

## 2. Preparación — una sola vez, antes del día

**Hacerlo con dos días de margen.** La carga de CIREN tarda una hora y hay
que dejarla terminar.

1. **Subir la rama** a GitHub (`git push`).

2. **Crear el Codespace**: en el repo, `Code → Codespaces → Create codespace
   on <rama>`. La primera vez tarda 10–15 minutos: baja la imagen de GDAL y
   construye el motor. Las siguientes, uno o dos minutos.

   Si la terminal dice `docker: command not found`, el Codespace quedó en
   **modo de recuperación**: la construcción falló y entregó un contenedor
   mínimo. Ver la causa en `Ctrl+Shift+P → Codespaces: View Creation Log`,
   corregir, y `Ctrl+Shift+P → Codespaces: Rebuild Container`. Si el repo
   cambió después de crearlo, hacer `git pull` antes de reconstruir.

   Al arrancar, el script intenta hacer públicos los puertos 8000 y 8081. Si
   avisa que no pudo, hacerlo a mano: panel **Ports** → clic derecho en el
   puerto → *Port Visibility* → *Public*. Sin eso el visor no puede llamar a
   la API.

3. **Subir el tiempo de inactividad.** Por defecto el Codespace se detiene a
   los 30 minutos sin actividad del navegador, y eso mata una ingesta a medias.
   En `github.com → Settings → Codespaces → Default idle timeout`, poner
   **240 minutos**. Hacerlo ANTES de cargar CIREN.

4. **Inicializar la base**, en la terminal del Codespace:

   ```bash
   bash herramientas/inicializar.sh
   ```

   Aplica las migraciones y carga las 33 comunas. Es idempotente.

5. **Cargar la línea base de CIREN** (una hora, no cerrar la pestaña):

   ```bash
   docker exec -i terrafoco-programador python -m ingesta.ciren
   ```

   El módulo acumula 50 cuencas en memoria y escribe **al final**: si se
   interrumpe, no queda nada y hay que repetirlo.

6. **Cargar el SIRSD-S** (medio minuto):

   ```bash
   docker exec -i terrafoco-programador python -m ingesta.sirsd_ide
   ```

7. **Comprobar**:

   ```bash
   docker exec -i terrafoco-programador python -m estado
   ```

   Debe decir 33 comunas, erosión CIREN 2024 en 33 comunas y SIRSD-S con 17.

8. **Abrir el visor** con el enlace que imprime la terminal al arrancar. Tiene
   la forma:

   ```
   https://<codespace>-8081.app.github.dev/visor.html?api=https://<codespace>-8000.app.github.dev
   ```

   El parámetro `?api=` le dice al prototipo dónde está la API —en el
   navegador del público `localhost:8000` no existe—. Se guarda solo; las
   demás páginas lo reutilizan.

9. **Ensayar el guion de abajo completo**, el día anterior. Sirve para
   confirmar que IDE MINAGRI responde ese día.

---

## 3. El guion de la escritura — tres minutos

El estado de partida tiene comunas, erosión y SIRSD-S cargados. La demo borra
el SIRSD-S y lo vuelve a cargar **en vivo**, de modo que la escritura tiene una
consecuencia visible en el análisis: el índice de pertinencia cambia.

En la terminal del Codespace, definir un atajo:

```bash
P="docker exec -i terrafoco-bd psql -U terrafoco -d terrafoco -tAc"
```

**Paso 1 — Comprobar la red antes de tocar nada.** Correr la simulación:

```bash
docker exec -i terrafoco-programador python -m ingesta.sirsd_ide --simular
```

Si baja los datos y termina en `--simular: no se escribio nada`, la fuente
responde y se sigue. **Si falla, no seguir con el paso 2**: ir a la sección 4.

**Paso 2 — Vaciar y leer.** Ahora sí, quitar el SIRSD-S y mostrar el vacío:

```bash
$P "DELETE FROM programas.ejecucion;"
$P "SELECT count(*) FROM programas.ejecucion;"          # 0
$P "SELECT count(*) FROM operacion.ejecucion_proceso;"  # anotar: N
```

Recargar `pertinencia.html`: todas las comunas quedan con brecha máxima,
porque no hay inversión registrada.

> Qué decir: *"La base tiene erosión pero no inversión. El índice no puede
> calcularse bien. Vamos a cargar la ejecución del programa desde la fuente
> oficial, en vivo."*

**Paso 3 — Mostrar que el sistema no escribe a ciegas.**

```bash
docker exec -i terrafoco-programador python -m ingesta.sirsd_ide --simular
$P "SELECT count(*) FROM programas.ejecucion;"          # sigue en 0
```

> Qué decir: *"Todos los cargadores tienen `--simular`: procesan, resumen y no
> escriben. Es la regla del proyecto: primero se mira, después se escribe."*

**Paso 4 — Escribir.**

```bash
docker exec -i terrafoco-programador python -m ingesta.sirsd_ide
```

Termina con `17 filas cargadas, 0 en ejecucion_rechazada`.

**Paso 5 — Leer lo escrito, por tres vías.**

```bash
$P "SELECT count(*), count(DISTINCT id_comuna), round(sum(superficie_ha)) FROM programas.ejecucion;"
#  17 | 17 | 1260

$P "SELECT inicio::timestamp(0), estado, registros, proceso FROM operacion.ejecucion_proceso ORDER BY id_proceso DESC LIMIT 1;"
#  la bitácora tiene una fila nueva: N+1, estado ok, 17 registros

docker exec -i terrafoco-programador python -m estado
#  Programas: SIRSD-S INDAP  17 filas, 17 comunas, 1260 ha
```

Recargar `pertinencia.html`: el ranking se reordena y 17 comunas pasan a
tener inversión.

> Qué decir: *"La escritura queda en la tabla de ejecución, en la bitácora
> —qué proceso corrió, cuándo y cuántos registros— y se refleja en el índice
> sin recalcular nada, porque la vista lo computa en consulta."*

Para el modelo de datos, en ese mismo momento:

```bash
$P "\dn"                       # los cuatro esquemas
$P "\dt territorio.* indicadores.* programas.* operacion.*"
```

---

## 4. Si algo falla

**IDE MINAGRI no responde en el paso 1.** No borrar nada. La escritura se
demuestra con lo que ya está: la bitácora tiene el historial completo de
ingestas con fecha, estado y registros, y la tabla de factores guarda una
versión por cada recálculo (nunca sobrescribe). Mostrar ambas con:

```bash
$P "SELECT inicio::timestamp(0), estado, registros, proceso FROM operacion.ejecucion_proceso ORDER BY id_proceso DESC LIMIT 8;"
$P "SELECT factor, count(*), min(calculado_en)::date, max(calculado_en)::date FROM indicadores.factor GROUP BY factor;"
```

**El Codespace no arranca o GitHub está caído.** Llevar el guion grabado en
video desde el ensayo del día anterior. Ninguna demo en vivo debe ser el único
plan de una presentación calificada.

**El visor dice "Prototipo · datos de ejemplo".** El navegador no encontró la
API. Abrir el visor otra vez con el enlace completo, con `?api=`.

---

## 5. Límites que conviene saber

- **Horas.** 60 al mes con esta máquina. La carga inicial consume unas dos; la
  demo, una fracción. Detener el Codespace al terminar cada sesión.
- **Puerto 8000 público.** La API queda accesible a quien tenga la URL mientras
  el Codespace esté encendido. Es solo lectura y no expone nada sensible, pero
  es una razón más para detenerlo al terminar.
- **Credenciales satelitales.** No hacen falta para esta demo. Si se quisieran
  cargar factores por Sentinel, van como *Codespaces secrets* del repo, nunca
  en un `.env` versionado.
- **Inactividad.** Se borra un Codespace tras 30 días sin usarse. Entrar una
  vez a la semana lo mantiene.
