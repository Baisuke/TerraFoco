# L21 · Chuleta

> [!abstract] Todo en una página
> Para repasar la mañana de la presentación.

## La pregunta y la idea

- **Pregunta:** ¿la inversión del SIRSD-S (INDAP) llega a las comunas donde la erosión es más grave?
- **Idea clave:** RUSLE = R·K·LS·**C**·**P**; C y P son lo que financia el programa → el cruce tiene mecanismo.
- **Región piloto:** O'Higgins, 33 comunas, 16.347 km², a 30 m.

## Cifras

| | |
|---|---|
| Incentivo 2012–2025 | $19.854 MM ≈ 729 mil UF · 22.449 planes · 97.569 ha |
| Comunas en el índice | 27 de 33 (6 precordilleranas fuera: Machalí, San Fernando, Mostazal, Requínoa, Codegua, Rengo) |
| Mayor brecha | Navidad: 25,9 t/ha/año · 0,32 UF/ha (mediana 2,42) · brecha ≈ 17.500 UF |
| Erosión propia vs CIREN | ρ ≈ −0,04 (33) → **+0,67** (27 del dominio) |
| Inundación vs eventos | **43/63 = 68 %** en Alta/Muy alta vs **52 %** del azar · ρ ≈ +0,36 |
| Pesos de inundación | a priori ρ −0,16 → acumulación 50 + curvatura 50 |
| Focalización | más erosionadas: 61 % del problema, ≈ 46–47 % del incentivo |
| Isla fresca Rancagua | 0,44 °C · diferencia térmica 6 °C (Graneros 26,4 / Machalí 20,4) |
| Pruebas | ~270 motor + ~96 API |

## Fórmulas

| | |
|---|---|
| RUSLE | A = R × K × LS × C × P |
| Pertinencia | necesidad_norm − inversión_norm (−1..1; visor: (p+1)/2) |
| Inversión | Σ(incentivo / UF del año) / ha con erosión > 18 t/ha/año, en log |
| Brecha | max(0, mediana − uf_ha) × ha severas |
| Índice inundación | 0,5 · acumulación_n + 0,5 · (1 − curvatura_n), por píxel; clases por cuartiles |
| Calibrado si | > 50 % eventos en Alta/Muy alta · ≥ +10 pts sobre azar · ρ > 0 |
| Teselas | n = round((v·escala + 10000)·10); R = n>>16, G = (n>>8)&255, B = n&255 |
| Número de curva | S = 25400/CN − 254 · Q = (P − 0,2S)² / (P + 0,8S) |
| Parque | ΔT = 0,44 · tamaño · tipo · e^(−3d/L) |

## Categorías del visor (0–1)

< 0,25 Sobre-cobertura · 0,25–0,40 Cobertura adecuada · 0,40–0,60 Alineación parcial · 0,60–0,75 Brecha alta · ≥ 0,75 Brecha crítica

Erosión: ≤ 10 Ligera · ≤ 18 Moderada · ≤ 26 Severa · ≤ 34 Muy severa · > 34 Extrema

## Archivos clave

| Capa | Archivos |
|---|---|
| Base | `bd/esquema.sql` · `bd/migraciones/013_…sql` (vista) · `herramientas/inicializar.sh` |
| Motor común | `motor/config.py` · `motor/bd.py` (conexion, obtener_region, Bitacora) |
| Erosión | `indicadores/rusle.py` · `indicadores/terreno.py` · `ingesta/zonal.py` · `calcular.py` · `validar.py` · `ingesta/ciren.py` |
| Inundación | `ingesta/hidrologia.py` · `indicadores/inundacion.py` · `indicadores/validar_inundacion.py` |
| Operación | `orquestacion/programacion.py` · `orquestacion/orquestador.py` · `teselas.py` |
| API | `api/main.py` · `api/seguridad.py` · `api/focalizacion.py` · `api/rutas/pertinencia.py` |
| Visor base | `js/api-base.js` · `js/paleta.js` · `js/data.js` · `js/datos-api.js` · `js/shell.js` |
| Visor mapa | `js/mapa-real.js` · `js/detalle-comuna.js` · `js/mapa.js` |
| Pantallas | `js/inundacion.js` + `inundacion-calculo.js` · `js/predios.js` · `js/simulacion-*.js` |

## Comandos

```bash
docker compose up -d && bash herramientas/inicializar.sh
python herramientas/servir_prototipo.py prototipo 8081
docker exec -i terrafoco-programador python -m estado
docker exec -i terrafoco-programador python -m orquestacion.orquestador --listar
docker exec -i terrafoco-motor python -m calcular --simular
docker exec -i terrafoco-motor python -m validar
docker exec -i terrafoco-programador python -m pytest tests -q
python herramientas/sembrar_indicadores.py
```

URLs: visor `localhost:8081/index.html` · API `localhost:8000/docs` · `localhost:8000/salud`

## Seis reglas del proyecto

1. Nada se inventa.
2. Ninguna coordenada, región ni credencial en el código.
3. Cada número sabe de dónde salió.
4. El visor declara lo que muestra (en vivo, copia, ejemplo).
5. Los límites se declaran, no se esconden.
6. Sin datos personales.

## Ocho decisiones de arquitectura

Motor fuera de HTTP · solo el catálogo se escribe por HTTP, con clave · GDAL de OSGeo · orquestador propio · teselas de valores sin servidor de mapas · mejora progresiva · funciones puras · la región es un dato.

## Si algo falla en vivo

API caída → "Copia local" (es una virtud: lo declara) · sin Docker → portable `TerraFoco.cmd` · sin internet → los datos funcionan, el mapa base no · todo falla → Codespaces o servidor público.

← Volver al inicio del curso: [[L00 Cómo usar este curso]]
