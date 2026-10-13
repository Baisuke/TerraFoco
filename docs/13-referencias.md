# Referencias

Fuentes citables del proyecto, en norma APA 7ª edición. Se incluyen solo las
que efectivamente sustentan una decisión del sistema: cada ecuación
implementada, cada conjunto de datos cargado y cada estándar metodológico
aplicado.

Todas están citadas también en el docstring del módulo que las usa, de modo
que quien lea el código sepa de dónde salió cada coeficiente.

---

## Modelo de erosión hídrica

**Renard, K. G., Foster, G. R., Weesies, G. A., McCool, D. K., & Yoder, D. C.
(1997).** *Predicting soil erosion by water: A guide to conservation planning
with the Revised Universal Soil Loss Equation (RUSLE)* (Agriculture Handbook
No. 703). United States Department of Agriculture.

> Fuente del modelo completo y de la formulación del factor topográfico.
> Implementado en `motor/indicadores/rusle.py`, función `factor_LS`.

**Wischmeier, W. H., & Smith, D. D. (1978).** *Predicting rainfall erosion
losses: A guide to conservation planning* (Agriculture Handbook No. 537).
United States Department of Agriculture.

> Nomograma de erodabilidad del suelo y tabla de prácticas de conservación por
> pendiente. Implementado en `factor_K` y `factor_P`.

**McCool, D. K., Brown, L. C., Foster, G. R., Mutchler, C. K., & Meyer, L. D.
(1987).** Revised slope steepness factor for the Universal Soil Loss Equation.
*Transactions of the ASAE, 30*(5), 1387–1396.

> Relación de pendiente con el quiebre en 9 %, que separa el dominio de la
> erosión laminar del flujo concentrado.

**Foster, G. R., McCool, D. K., Renard, K. G., & Moldenhauer, W. C. (1981).**
Conversion of the Universal Soil Loss Equation to SI metric units. *Journal of
Soil and Water Conservation, 36*(6), 355–359.

> Factor de conversión a unidades del Sistema Internacional. Omitirlo deja el
> factor K unas 7,6 veces mayor sin que nada falle.

---

## Erosividad de la lluvia

**Renard, K. G., & Freimund, J. R. (1994).** Using monthly precipitation data
to estimate the R-factor in the revised USLE. *Journal of Hydrology, 157*(1–4),
287–306.

> Estimación del factor R a partir de totales mensuales o anuales, ante la
> ausencia de registros pluviográficos de treinta minutos. **La validación del
> proyecto determinó que esta ecuación sobreestima en regímenes sobre los 1.000
> mm anuales**, lo que motivó declarar seis comunas precordilleranas fuera del
> dominio de validez del sistema.

**Arnoldus, H. M. J. (1980).** An approximation of the rainfall factor in the
Universal Soil Loss Equation. En M. De Boodt & D. Gabriels (Eds.), *Assessment
of erosion* (pp. 127–132). John Wiley & Sons.

> Índice de Fournier Modificado, que incorpora la estacionalidad de las
> precipitaciones. Disponible en el sistema como método alternativo.

---

## Cobertura vegetal

**Van der Knijff, J. M., Jones, R. J. A., & Montanarella, L. (2000).** *Soil
erosion risk assessment in Europe* (EUR 19044 EN). European Soil Bureau,
Joint Research Centre.

> Relación exponencial entre el índice de vegetación normalizado y el factor de
> cobertura. Implementada en `factor_C`.

**Rouse, J. W., Haas, R. H., Schell, J. A., & Deering, D. W. (1974).**
Monitoring vegetation systems in the Great Plains with ERTS. En *Third Earth
Resources Technology Satellite-1 Symposium* (Vol. 1, pp. 309–317). NASA.

> Definición original del índice de vegetación de diferencia normalizada.

---

## Conjuntos de datos

**Centro de Información de Recursos Naturales. (2024).** *Inventario Nacional
de Erosión de los Suelos de Chile* [Conjunto de datos].
https://inventarioerosion.ciren.cl

> Línea base contra la cual se valida el cálculo propio. Cubre desde la Región
> de Coquimbo hasta la de Los Lagos, lo que constituye el techo de
> escalabilidad del módulo de suelos.

**Ministerio de Agricultura de Chile. (2024).** *Infraestructura de Datos
Espaciales — Programa de Recuperación de Suelos Degradados* [Conjunto de
datos]. https://ide.minagri.gob.cl

> Ejecución del programa SIRSD-S por predio, con superficie bonificada y monto.
> Se carga agregada por comuna, sin datos personales.

**Boisier, J. P., Alvarez-Garreton, C., Cordero, R. R., Damiani, A., Gallardo,
L., Garreaud, R. D., Lambert, F., Ramallo, C., Rojas, M., & Rondanelli, R.
(2018).** Anthropogenic drying in central-southern Chile evidenced by
long-term observations and climate model simulations. *Elementa: Science of
the Anthropocene, 6*, 74.

> Producto climático CR2MET, del cual se obtiene la precipitación mensual
> grillada para el factor R. Versión 2.5, período 1960–2021.

**Poggio, L., de Sousa, L. M., Batjes, N. H., Heuvelink, G. B. M., Kempen, B.,
Ribeiro, E., & Rossiter, D. (2021).** SoilGrids 2.0: Producing soil information
for the globe with quantified spatial uncertainty. *SOIL, 7*(1), 217–240.

> Textura y carbono orgánico del suelo a 250 metros, empleados en el factor K
> ante la ausencia de estudios agrológicos con textura para la región.

**NASA JPL. (2020).** *NASADEM Merged DEM Global 1 arc second V001* [Conjunto
de datos]. NASA EOSDIS Land Processes DAAC.
https://doi.org/10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001

> Modelo digital de elevación del que se derivan la pendiente y el factor
> topográfico. Se prefiere sobre el SRTM original por tener los vacíos
> rellenados y mejor georreferenciación.

**European Space Agency. (2021).** *Sentinel-2 MSI Level-2A* [Conjunto de
datos]. Copernicus Data Space Ecosystem. https://dataspace.copernicus.eu

> Reflectancia de superficie corregida atmosféricamente, con máscara de
> clasificación de escena. Base del índice de vegetación para el factor C.

**Instituto Nacional de Estadísticas. (2022).** *VIII Censo Nacional
Agropecuario y Forestal* [Conjunto de datos]. https://www.ine.gob.cl

**Instituto Geográfico Militar. (2023).** *División Político-Administrativa de
Chile* [Conjunto de datos]. Infraestructura de Datos Geoespaciales de Chile.
https://www.geoportal.cl

---

## Simulaciones de escenario

**U.S. Department of Agriculture, Natural Resources Conservation Service.
(1986).** *Urban hydrology for small watersheds* (Technical Release 55, 2.ª
ed.).

> Método del Número de Curva y su tabla por cobertura y grupo hidrológico del
> suelo: cuánta lluvia escurre en la simulación de inundaciones.

**Chow, V. T., Maidment, D. R., & Mays, L. W. (1988).** *Applied hydrology.*
McGraw-Hill.

> Conversión del número de curva entre condiciones de humedad previa I, II y III.

**Williams, J. R. (1995).** The EPIC model. En V. P. Singh (Ed.), *Computer
models of watershed hydrology* (pp. 909–1000). Water Resources Publications.

> Corrección del número de curva por pendiente (la que usa SWAT).

**Nash, J. E. (1957).** The form of the instantaneous unit hydrograph.
*International Association of Scientific Hydrology Publication, 45*(3),
114–121.

> Embalse lineal: cómo la red de drenaje evacúa el agua retenida.

**Cao, X., Onishi, A., Chen, J., & Imura, H. (2010).** Quantifying the cool
island intensity of urban parks using ASTER and IKONOS data. *Landscape and
Urban Planning, 96*(4), 224–231.

> La isla fresca de un parque crece con el logaritmo de su área.

**Bowler, D. E., Buyung-Ali, L., Knight, T. M., & Pullin, A. S. (2010).**
Urban greening to cool towns and cities: A systematic review of the empirical
evidence. *Landscape and Urban Planning, 97*(3), 147–155.

> Los parques son más frescos que su entorno, y más con árboles.

**Aram, F., Higueras García, E., Solgi, E., & Mansournia, S. (2019).** Urban
green space cooling effect in cities. *Heliyon, 5*(4), e01339.

> Orden de magnitud de la distancia hasta la que se nota el enfriamiento.

---

## Metodología

**Chapman, P., Clinton, J., Kerber, R., Khabaza, T., Reinartz, T., Shearer, C.,
& Wirth, R. (2000).** *CRISP-DM 1.0: Step-by-step data mining guide.* SPSS Inc.

> Estructura del ciclo analítico del proyecto, en particular la exigencia de
> evaluar los resultados contra una referencia independiente antes de
> considerarlos válidos.

**Schwaber, K., & Sutherland, J. (2020).** *The Scrum Guide: The definitive
guide to Scrum — The rules of the game.* https://scrumguides.org

> Marco de gestión del trabajo. El proyecto declara dos adaptaciones: reuniones
> diarias tres veces por semana y un Product Owner interno al equipo.

---

## Marco institucional

**Instituto de Desarrollo Agropecuario. (2024).** *Sistema de Incentivos para
la Sustentabilidad Agroambiental de los Suelos Agropecuarios (SIRSD-S).*
https://www.indap.gob.cl

**Ministerio de Agricultura de Chile. (2010).** *Ley N° 20.412: Establece un
sistema de incentivos para la sustentabilidad agroambiental de los suelos
agropecuarios.* Biblioteca del Congreso Nacional de Chile.

> Marco legal del programa cuya ejecución territorial evalúa el proyecto.

---

## Nota sobre el uso de estas fuentes

Ninguna ecuación del sistema es de elaboración propia. El aporte del proyecto
no está en el modelo físico —que proviene de literatura validada— sino en el
**cruce entre la degradación medida y la ejecución del programa**, que hasta
ahora no se había realizado con estas fuentes.

Las decisiones de implementación que se apartan de la fuente original están
documentadas en el código, con la razón que las motivó. El caso más relevante
es el dominio de validez del factor R, determinado empíricamente al contrastar
el cálculo propio contra el inventario de CIREN.
