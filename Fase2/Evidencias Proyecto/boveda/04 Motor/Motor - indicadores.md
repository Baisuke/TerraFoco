# Motor · indicadores

**Carpeta:** `motor/indicadores/`. Aquí viven **los modelos**: las ecuaciones puras, la combinación de variables y la validación. La ingesta trae datos; esto los convierte en indicadores. `__init__.py` está vacío (marca el paquete).

---

## rusle.py
- **Qué es:** el modelo RUSLE en **funciones puras** (reciben números, devuelven números; no leen archivos). Se prueban sin datos.
- **Contenido:**
  - `Factores` (dataclass) y su producto `A = R·K·LS·C·P`; `RANGOS` plausibles de cada factor (R 200–8.000; K 0,005–0,07; LS 0–25; C y P 0–1): un factor fuera de rango casi siempre es un **error de unidades**, el más caro porque no falla.
  - `CLASES` y `clasificar` (Ligera < 10, Moderada < 18, Severa < 26, Muy severa < 34, Extrema).
  - `indice_fournier`, `factor_R` (Renard & Freimund 1994; rama potencial bajo 850 mm y cuadrática sobre), `factor_K` (Wischmeier & Smith 1978 en SI), `factor_LS` (Renard et al. 1997, McCool), `factor_C` (Van der Knijff 2000, α = 2, β = 1), `ndvi_desde_bandas`, `p_curvas_nivel` (tabla por pendiente), `factor_P`.
  - `R_MAXIMO_CONFIABLE = 2000` → [[Dominio de validez]].
- **Cada función cita su fuente en el docstring:** en una tesis, un coeficiente sin procedencia no se defiende. → [[RUSLE y erosión]] · [[Motor - pruebas#test_factores.py]]

## terreno.py
- **Qué hace:** del DEM a la pendiente y de la pendiente a LS, sobre arreglos numpy.
  - `pendiente_horn` (Horn 1981, la de GDAL), `curvatura`, `ls_desde_pendiente`, `media_ponderada` (ignora NaN, respeta máscara, pondera por superficie de celda), `ls_de_comuna`.
- **Limitación declarada:** usa el tamaño de celda como longitud de ladera (L ≈ 1), lo que subestima LS en laderas largas. `ls_desde_pendiente` ya acepta un arreglo de longitudes para enchufar la acumulación de flujo.
- **Probado contra un plano inclinado** de pendiente conocida. → [[Motor - pruebas#test_terreno.py]]

## almacen.py
- **Qué hace:** lectura y escritura de valores por comuna en dos almacenes con la misma disciplina:
  - **factores RUSLE** → `indicadores.factor` (exige positivos: un cero anula el producto);
  - **variables de inundación** → `indicadores.variable_inundacion` (admite negativos: la curvatura negativa es señal).
- **Nada se sobrescribe:** cada recálculo inserta una versión; la más reciente gana.
- **API:** `Almacen`, `almacen_de(tipo)`, `guardar`, `leer`, `cobertura`. Lo usan `calcular.py`, las ingestas de factores y `inundacion.py`.

## inundacion.py
- **Uso:** `python -m indicadores.inundacion` · `--revisar` · `--simular`.
- **Qué hace:** combina las seis variables **por píxel** (suma ponderada de variables normalizadas, las inversas volteadas), escribe `/datos/inundacion/susceptibilidad.tif` y `susceptibilidad.json` (cortes, pesos, método), **agrega por comuna** y guarda en `indicadores.susceptibilidad_inundacion` con `calibrado = FALSE` (hasta que la validación lo marque).
- **`VARIABLES`:** `(nombre, peso, sentido, archivo)` → pendiente 0, acumulación **50**, distancia 0, TWI 0, curvatura **50**, cobertura 0.
- **Funciones:** `normalizar` (percentiles 2–98 sobre el dominio donde existen), `combinar` (propaga NaN, ignora las de peso 0), `cortes_por_cuartiles`, `clasificar`, `clasificar_arreglo`, `leer_en_rejilla`, `mosaico_ndvi`, `agregar`, `guardar`, `informe`.
- → [[Susceptibilidad a inundación]] · [[Motor - pruebas#test_inundacion.py]]

## recalibrar_inundacion.py
- **Uso:** `python -m indicadores.recalibrar_inundacion`.
- **Qué hace:** **banco de pruebas** de la iteración 2. Separa dos preguntas: ¿cómo se agrega el píxel a la comuna (media, percentil 90, fracción en Alta)? y ¿qué pesos? Compara **juegos de pesos declarados de antemano** (no optimizados: con 33 comunas sería un ajuste perfecto y falso) con Spearman y fracción de eventos en Alta frente al azar.
- **Advierte en la salida:** todo es en muestra y una diferencia de ρ < 0,15 es ruido.
- **Funciones:** `cargar_capas`, `etiquetar_comunas`, `agregar`, `evaluar`. La reutiliza `variables_inundacion.py`.

## validar_inundacion.py
- **Uso:** `python -m indicadores.validar_inundacion` · `--marcar-calibrado` · `--marcar-si-pasa` (lo usa el programador).
- **Qué hace:** fase de **evaluación de CRISP-DM**. Tres preguntas: fracción de eventos en Alta/Muy alta **frente al azar**, Spearman índice vs. eventos, Spearman por variable vs. su signo esperado.
- **`pasa_criterio`:** > 50 % de eventos en Alta/Muy alta, mejora ≥ `MEJORA_MINIMA = 0.10` sobre el azar y ρ > 0. Con `--marcar-si-pasa`, marca `calibrado = TRUE` solo si cumple.
- **Funciones:** `rangos`, `spearman`, `validar`, `informe`. → [[Validación y Spearman]] · [[Motor - pruebas#test_criterio_calibracion.py]]

## superficie_erosionada.py
- **Qué hace:** hectáreas con erosión **> 18 t/ha/año** por comuna: el **denominador** de la inversión en el índice de pertinencia (migración 013). Escribe `indicadores.superficie_erosionada` con `en_dominio`.
- **Tres modos:**
  1. **Rásteres** (`/datos/erosion/erosion_*.tif`) — el cálculo original (`medir`, `hectareas`).
  2. **`--desde-semilla`** — carga `bd/semillas/superficie_erosionada.csv` (respaldo automático cuando no hay rásteres). `exportar_semilla` la regenera.
  3. **`--desde-png DIR`** — cuenta celdas por color en los PNG del visor (`medir_png`, `rutas_png`).
- **Por qué del cálculo propio y no de CIREN:** la ingesta de CIREN conserva solo la media por comuna, no la superficie por clase.
- → [[Semillas#bd/semillas/superficie_erosionada.csv]] · [[Motor - pruebas#test_superficie_png.py]]

## area_verde.py
- **Uso:** `python -m indicadores.area_verde` · `--simular`.
- **Qué hace:** las tres medidas del SIEDU por comuna y por zona censal: m²/hab (`m2_por_habitante`), déficit (`deficit_m2` = `max(0, 10·personas − área)`), personas con plaza a ≤ 400 m y con parque a ≤ 3 km (desde un punto interior de cada manzana, en línea recta, sin respetar límites comunales; no cuentan los bandejones). **Escribe:** `indicadores.area_verde`.
- → [[Áreas verdes y calor urbano]]

Ver también: [[Motor - raíz]] · [[Motor - ingesta]]
