# L00 · Cómo usar este curso

> [!abstract] Para quién es
> Para alguien que **no sabe cómo funciona el código** y tiene que **presentarlo de punta a punta** y responder preguntas de la comisión. No se da nada por sabido: cada lección parte de los conceptos y termina en el código real del repositorio, con las líneas que importan copiadas y explicadas.

El resto de la bóveda (carpetas 01 a 09) es una **referencia**: dice qué hace cada archivo. Este curso es un **camino**: te lleva en orden, de lo general a lo particular, y te deja listo para explicar. Cuando una lección termina un párrafo con "→" y un enlace, esa nota es la referencia para profundizar.

## El plan

| # | Lección | Qué vas a poder explicar | Tiempo |
|---|---|---|---|
| 0 | [[L01 Fundamentos previos]] | Qué es una API, una base de datos, un ráster, Docker, cómo leer Python y JavaScript | 2 h |
| 1 | [[L02 La historia del proyecto]] | El problema, la pregunta, la idea clave y los tres módulos | 45 min |
| 2 | [[L03 Arquitectura en concreto]] | Las cuatro piezas, cómo se hablan y por qué están separadas | 1 h |
| 3 | [[L04 Un dato de punta a punta]] | El recorrido completo de un número, del satélite a la pantalla | 1,5 h |
| 4 | [[L05 La base de datos por dentro]] | Esquemas, tablas, la vista de pertinencia línea por línea | 1,5 h |
| 5 | [[L06 El motor - anatomía de un módulo]] | El patrón que repiten todos los scripts del motor | 1 h |
| 6 | [[L07 El motor - erosión y RUSLE]] | Los cinco factores, el cálculo y la validación contra CIREN | 2 h |
| 7 | [[L08 El motor - inundaciones]] | Las seis variables, la suma por píxel, los cuartiles y la calibración | 1,5 h |
| 8 | [[L09 El motor - programador y teselas]] | Cómo el sistema se actualiza solo y cómo un valor viaja dentro de un color | 1,5 h |
| 9 | [[L10 La API por dentro]] | FastAPI, anatomía de un endpoint, la seguridad de la escritura | 1,5 h |
| 10 | [[L11 El visor - cómo arranca una página]] | Orden de scripts, hidratación, copia local, la barra superior | 1,5 h |
| 11 | [[L12 El visor - el mapa]] | MapLibre, capas, clics, teselas de valores y lectura bajo el cursor | 2 h |
| 12 | [[L13 El visor - las pantallas]] | Qué hace cada pantalla y con qué módulos | 1,5 h |
| 13 | [[L14 Las simulaciones]] | Lluvia (número de curva, embalse) y parque (isla fresca) | 1 h |
| 14 | [[L15 Pruebas y calidad]] | Qué se prueba, cómo y por qué | 45 min |
| 15 | [[L16 Despliegue y copias]] | Dónde corre: PC, Codespaces, servidor público, portable | 45 min |
| 16 | [[L17 Guion de la presentación]] | La demo minuto a minuto, con qué decir y qué hacer si algo falla | 1 h + ensayos |
| 17 | [[L18 Preguntas sobre el código]] | Las preguntas difíciles de la comisión, con respuesta y archivo | 1 h |
| 18 | [[L19 Autoevaluación final]] | Comprobar que lo sabes sin mirar | 1 h |
| 19 | [[L20 Tarjetas de repaso]] | Repaso espaciado de lo esencial | 15 min/día |
| 20 | [[L21 Chuleta]] | Una página con todo: cifras, fórmulas, archivos, comandos | — |

**Total:** unas 25 horas. Repartido en una semana de ~4 h diarias:

| Día | Lecciones |
|---|---|
| 1 | L00–L03 (fundamentos, historia, arquitectura) |
| 2 | L04–L05 (un dato de punta a punta, base de datos) |
| 3 | L06–L08 (motor) |
| 4 | L09–L10 (programador, teselas, API) |
| 5 | L11–L13 (visor) |
| 6 | L14–L16 (simulaciones, pruebas, despliegue) |
| 7 | L17–L19 (guion, preguntas, autoevaluación) + ensayo en voz alta |

> [!tip] Si tienes un solo día
> L02 → L03 → L04 → L17 → L21. Con eso puedes presentar; el resto es para responder preguntas.

## Cómo está escrita cada lección

Todas siguen el mismo orden:

1. **En una frase:** lo que tienes que poder decir de memoria.
2. **Conceptos:** lo mínimo para entender, con una analogía cuando ayuda.
3. **El código:** fragmentos **reales** del repositorio (a veces recortados con `...`), con la ruta del archivo y qué hace cada parte.
4. **Pruébalo:** algo para hacer con el sistema levantado: un comando, un clic, una consulta.
5. **Cómo decirlo en la presentación:** la versión corta, en palabras de expositor.
6. **Autoevaluación:** preguntas con la respuesta **plegada**. Ábrela solo después de responder en voz alta.

> [!question]- Así se ve una pregunta plegada (haz clic)
> La respuesta aparece aquí. En Obsidian, las respuestas están dentro de un recuadro que se abre con un clic. Si las lees antes de intentar responder, no sirven.

En el **documento de Word** (`boveda/TerraFoco - Guía de estudio.docx`) no se pueden plegar: cada pregunta lleva un número y **las respuestas están al final de cada lección**, en la sección "Respuestas".

## Cómo leer código cuando no sabes programar

No hace falta entender cada línea. Hace falta saber **qué entra, qué sale y qué decisión se toma**. Un método que funciona:

1. **Lee primero el comentario de arriba del archivo** (el *docstring* en Python, el bloque `/* === */` en JavaScript). En este proyecto están escritos para explicar **por qué**: muchas veces la respuesta a una pregunta de la comisión está ahí, literal.
2. **Busca la función principal.** En Python es `main()`; en JavaScript, lo que se llama al final del archivo o lo que se exporta (`return { ... }`).
3. **Sigue los nombres.** El código está en español y los nombres dicen lo que hacen: `calcular`, `guardar`, `normalizar`, `pintarResumen`.
4. **Ignora el manejo de errores al principio** (`try`, `except`, `catch`): es el "qué pasa si falla". Vuelve a él cuando entiendas el camino feliz.
5. **Pregúntate por los datos:** ¿de dónde viene este número?, ¿a dónde va?

> [!example] Prueba ahora
> Abre `motor/indicadores/rusle.py` y lee solo el comentario de arriba (las primeras 35 líneas). Ya sabes la fórmula de RUSLE, de dónde sale cada factor y por qué las funciones no leen archivos. Eso es la mitad de lo que hay que saber de ese archivo.

## Cómo abrir los archivos

- **En Obsidian:** esta bóveda. Los enlaces `[[...]]` llevan a otras notas.
- **En VS Code:** abre la carpeta del repositorio. `Ctrl+P` y escribe el nombre del archivo (`rusle`, `datos-api`) para abrirlo. `Ctrl+Shift+F` busca un texto en todo el repositorio: es la forma más rápida de encontrar "dónde se usa esto".
- **Mapa del repositorio:** [[Mapa del repositorio]].

## Para practicar con el sistema

Casi todas las secciones *Pruébalo* necesitan el sistema levantado. Lo mínimo:

```bash
docker compose up -d
bash herramientas/inicializar.sh
python herramientas/servir_prototipo.py prototipo 8081
```

Y abrir `http://localhost:8081/index.html` (visor) y `http://localhost:8000/docs` (API). Detalle y problemas típicos: [[Cómo correrlo]].

> [!warning] Dos reglas que no se rompen
> - **Nunca** usar "Reset to factory defaults" en Docker Desktop: borra los volúmenes con los datos.
> - La clave de administración (`TERRAFOCO_CLAVE_ADMIN`) vive solo en el `.env`. No se muestra en la presentación ni se copia a ningún documento.

Siguiente: [[L01 Fundamentos previos]]
