# Guía de estudio en Word

Arma `boveda/TerraFoco - Guía de estudio.docx` desde la bóveda de Obsidian: el curso (`boveda/10 Curso`, lecciones L00 a L21) y todas las notas de referencia, en un solo documento para estudiar sin Obsidian.

Qué hace con el Markdown de la bóveda:

- los diagramas `mermaid` pasan a imágenes (con el Edge del equipo);
- los recuadros de Obsidian (`> [!tip]`, `> [!warning]`…) pasan a cajas con color;
- los enlaces `[[nota]]` pasan a enlaces internos del documento;
- las preguntas plegables (`> [!question]-`) se numeran y sus respuestas van al final de cada lección.

Requisitos (Windows): Node 20, Microsoft Edge y Microsoft Word (para rellenar el índice).

```bash
cd herramientas/guia_docx
npm install                                   # una vez; puppeteer-core usa el Edge instalado
node render_mermaid.js ../../boveda diagramas
node construir_docx.js ../../boveda diagramas guia.docx
powershell -NoProfile -ExecutionPolicy Bypass -File word_actualizar.ps1 -Entrada "$PWD\guia.docx" -Salida "$PWD\..\..\boveda\TerraFoco - Guía de estudio.docx" -Pdf "$PWD\guia.pdf"
```

`word_actualizar.ps1` abre el documento con Word, rellena el índice con los números de página, lo guarda en la bóveda y exporta un PDF de control. `diagramas/`, `guia.docx`, `guia.pdf` y `node_modules/` son temporales: no se versionan.

El orden de las notas de referencia está en `REFERENCIA`, al comienzo de `construir_docx.js`: una nota nueva en la bóveda hay que agregarla ahí.
