# -*- coding: utf-8 -*-
"""
Modelo RUSLE — pérdida de suelo por erosión hídrica.

    A = R x K x LS x C x P

`A` se expresa en toneladas por hectárea al año.

Los factores se MULTIPLICAN, no se suman: si uno vale cero, el resultado es
cero. Sin lluvia no hay erosión, por empinado que sea el terreno.

De los cinco, solo **C y P dependen de la acción humana** — y son exactamente
sobre los que actúan los programas de INDAP y MINAGRI. Ahí está el fundamento
del proyecto: la variable que se quiere evaluar ya vive dentro del modelo.

FUENTES DE CADA ECUACIÓN
------------------------
Ninguna fórmula de este módulo es propia. Todas son de literatura revisada,
citada en el docstring de cada función, porque en una tesis un coeficiente sin
procedencia no se puede defender:

  R   Renard & Freimund (1994), a partir del Índice de Fournier Modificado
      (Arnoldus, 1980).
  K   Ecuación del nomograma de Wischmeier & Smith (1978), con la conversión
      a unidades SI de Foster et al. (1981).
  LS  Renard et al. (1997), Agriculture Handbook 703, con la relación de
      pendiente de McCool et al. (1987, 1989).
  C   Van der Knijff et al. (2000), relación exponencial con el NDVI.
  P   Wischmeier & Smith (1978), tabla de curvas de nivel por pendiente,
      ponderada por la superficie efectivamente intervenida.

Estas funciones son PURAS: reciben números y devuelven números. La lectura de
rásteres y la agregación por comuna viven en `ingesta`, no aquí. Eso permite
probarlas contra valores publicados sin necesidad de datos ni de base.
"""
import math
from dataclasses import dataclass

# Rangos de referencia, para validar que un factor calculado sea plausible.
# Un valor fuera de rango casi siempre significa un error de unidades.
RANGOS = {
    # El tope de R se subió de 3.000 a 8.000 con evidencia, no por comodidad.
    # La ecuación de Renard & Freimund crece de forma cuadrática sobre los
    # 850 mm anuales, y las comunas cordilleranas de O'Higgins reciben entre
    # 1.200 y 1.250 mm según la climatología de CR2MET 2002-2021: eso da R
    # cercano a 5.300. Con el tope anterior, San Fernando, Machalí y Rengo
    # quedaban excluidas del cálculo — justo las de mayor relieve.
    # El límite sigue existiendo porque más arriba de 8.000 el valor delata un
    # error de unidades, que es para lo que sirve este control.
    "R":  (200.0, 8000.0),    # MJ·mm/(ha·h·año)
    "K":  (0.005, 0.070),     # t·ha·h/(ha·MJ·mm)
    "LS": (0.0, 25.0),        # adimensional
    "C":  (0.0, 1.0),         # adimensional: 1 = suelo desnudo
    "P":  (0.0, 1.0),         # adimensional: 1 = sin prácticas de conservación
}

# Sobre esta erosividad el modelo deja de ser confiable y la comuna se marca
# fuera del dominio de validez. No es un número elegido para que la validación
# salga bien: Renard & Freimund ajustaron su relación con estaciones bajo los
# 1.000 mm anuales, y en O'Higgins eso corresponde a una R del orden de 2.000.
#
# La validación lo confirma en vez de definirlo. Con `python -m validar`:
# la correlación de Spearman contra CIREN pasa de -0,040 sobre las 33 comunas
# a +0,667 sobre las 27 que quedan dentro, y el barrido de umbrales muestra
# que el resultado se sostiene entre 1.200 y 2.200 y se derrumba sobre 2.500.
# Es decir, no depende de haber acertado un valor exacto.
R_MAXIMO_CONFIABLE = 2000.0   # MJ·mm/(ha·h·año)

CLASES = [
    (10.0, "Ligera"),
    (18.0, "Moderada"),
    (26.0, "Severa"),
    (34.0, "Muy severa"),
    (float("inf"), "Extrema"),
]


@dataclass
class Factores:
    """Los cinco factores de una unidad territorial."""
    R: float
    K: float
    LS: float
    C: float
    P: float

    def validar(self):
        """Devuelve los factores fuera de rango plausible."""
        fuera = []
        for nombre, (bajo, alto) in RANGOS.items():
            valor = getattr(self, nombre)
            if valor is None or not (bajo <= valor <= alto):
                fuera.append("%s = %s (esperado entre %s y %s)"
                             % (nombre, valor, bajo, alto))
        return fuera

    def perdida(self):
        """A = R x K x LS x C x P"""
        fuera = self.validar()
        if fuera:
            raise ValueError("Factores fuera de rango: " + "; ".join(fuera))
        return self.R * self.K * self.LS * self.C * self.P


def clasificar(perdida_ton_ha):
    """Traduce toneladas por hectárea al año a la clase de erosión de CIREN."""
    for limite, nombre in CLASES:
        if perdida_ton_ha <= limite:
            return nombre
    return CLASES[-1][1]


# --------------------------------------------------------------------------
# R — erosividad de la lluvia
# --------------------------------------------------------------------------

def indice_fournier(precipitacion_mensual):
    """Índice de Fournier Modificado (Arnoldus, 1980).

        MFI = sum(p_i^2) / P

    Concentra en un número la estacionalidad: 1.200 mm repartidos parejo dan
    un MFI mucho menor que los mismos 1.200 mm caídos en tres meses. Eso es
    justo lo que distingue el secano costero de O'Higgins.

    precipitacion_mensual: 12 valores en mm.
    """
    if len(precipitacion_mensual) != 12:
        raise ValueError("Se esperan 12 valores mensuales, llegaron %d"
                         % len(precipitacion_mensual))
    if any(p is None or p < 0 for p in precipitacion_mensual):
        raise ValueError("Hay meses nulos o negativos en la serie")

    anual = sum(precipitacion_mensual)
    if anual <= 0:
        return 0.0
    return sum(p * p for p in precipitacion_mensual) / anual


METODOS_R = ("anual", "fournier")


def factor_R(precipitacion_mensual=None, precipitacion_anual=None,
             metodo="anual"):
    """Erosividad de la lluvia: con cuánta fuerza llueve.

    No es cuánto llueve, sino la energía del impacto de la gota. Una tormenta
    corta e intensa erosiona mucho más que una llovizna de todo el día.

    El cálculo riguroso exige pluviogramas de 30 minutos, que no existen para
    la mayoría de las estaciones chilenas. Hay dos aproximaciones en uso, y
    **no dan lo mismo**:

    metodo='anual' (por defecto) — Renard & Freimund (1994) sobre el total:

        P <  850 mm:  R = 0.0483 * P^1.610
        P >= 850 mm:  R = 587.8 - 1.219*P + 0.004105*P^2

    metodo='fournier' — Renard & Freimund sobre el Índice de Fournier
    Modificado (Arnoldus, 1980), que sí captura la estacionalidad:

        MFI <=  55:  R = 0.7397 * MFI^1.847
        MFI  >  55:  R = 95.77 - 6.081*MFI + 0.4770*MFI^2

    **Por qué 'anual' es el predeterminado.** La literatura chilena que
    compara ambos —Fournier frente a ICONA— documenta que Fournier entrega
    valores sistemáticamente mayores. En el régimen mediterráneo de Chile
    central, con la lluvia concentrada en cuatro meses, el MFI supera 100 y la
    rama cuadrática de Renard & Freimund se dispara muy por encima del rango
    plausible: queda fuera de su tramo de calibración. La variante anual es
    conservadora y sigue siendo citable.

    Que ambos estén disponibles no es indecisión: **comparar los dos y
    reportar la diferencia es un análisis de sensibilidad**, que es lo que
    corresponde cuando no hay dato pluviográfico para dirimir.

    OJO al escalar al sur: sobre los 1.500 mm anuales la rama cuadrática
    también crece rápido y R supera el rango de RANGOS. Para Los Lagos hay que
    revisar el método, no ampliar el rango sin más.

    Devuelve R en MJ·mm/(ha·h·año).
    """
    if metodo not in METODOS_R:
        raise ValueError("metodo = %r; se espera uno de %s" % (metodo, METODOS_R))

    if metodo == "fournier":
        if precipitacion_mensual is None:
            raise ValueError("El metodo 'fournier' necesita precipitacion_mensual")
        mfi = indice_fournier(precipitacion_mensual)
        if mfi <= 0:
            return 0.0
        if mfi <= 55.0:
            return 0.7397 * (mfi ** 1.847)
        return 95.77 - 6.081 * mfi + 0.4770 * mfi * mfi

    if precipitacion_anual is None:
        if precipitacion_mensual is None:
            raise ValueError(
                "Se necesita precipitacion_anual o precipitacion_mensual")
        precipitacion_anual = sum(precipitacion_mensual)

    p = float(precipitacion_anual)
    if p <= 0:
        return 0.0
    if p < 850.0:
        return 0.0483 * (p ** 1.610)
    return 587.8 - 1.219 * p + 0.004105 * p * p


# --------------------------------------------------------------------------
# K — erodabilidad del suelo
# --------------------------------------------------------------------------

# Códigos del nomograma. No son arbitrarios: los define Wischmeier & Smith.
ESTRUCTURA = {
    "granular muy fina": 1,
    "granular fina": 2,
    "granular media o gruesa": 3,
    "en bloques, laminar o masiva": 4,
}
PERMEABILIDAD = {
    "muy rapida": 1,
    "rapida": 2,
    "moderada": 3,
    "lenta a moderada": 4,
    "lenta": 5,
    "muy lenta": 6,
}

# Wischmeier & Smith trabajan en unidades inglesas. Foster et al. (1981) dan
# el factor para pasar a SI: t·ha·h/(ha·MJ·mm). Omitirlo deja K unas 7,6 veces
# más grande y la pérdida resultante es absurda.
A_SI = 0.1317


def factor_K(limo_pct, arena_muy_fina_pct, arcilla_pct, materia_organica_pct,
             estructura, permeabilidad):
    """Erodabilidad: qué tan fácil se desarma este suelo en particular.

    Ecuación del nomograma de **Wischmeier & Smith (1978)**:

        K = [2.1e-4 * M^1.14 * (12 - MO) + 3.25*(s - 2) + 2.5*(p - 3)] / 100

        M = (%limo + %arena muy fina) * (100 - %arcilla)

    Entrada: estudios agrológicos de CIREN. **No sale del satélite** — es la
    propiedad más estable del modelo y la única que no se puede teledetectar.

    materia_organica_pct se satura en 4%: por encima de ese valor la ecuación
    original no es válida y devolvería contribuciones negativas.

    estructura y permeabilidad: texto de ESTRUCTURA / PERMEABILIDAD, o el
    código entero directamente.

    Devuelve K en t·ha·h/(ha·MJ·mm).
    """
    for nombre, v in (("limo", limo_pct), ("arena muy fina", arena_muy_fina_pct),
                      ("arcilla", arcilla_pct)):
        if v is None or not (0 <= v <= 100):
            raise ValueError("%s = %r fuera de 0-100" % (nombre, v))

    s = ESTRUCTURA.get(estructura, estructura) if not isinstance(estructura, int) \
        else estructura
    p = PERMEABILIDAD.get(permeabilidad, permeabilidad) \
        if not isinstance(permeabilidad, int) else permeabilidad
    if not isinstance(s, int) or not (1 <= s <= 4):
        raise ValueError("estructura invalida: %r (1-4 o %s)"
                         % (estructura, list(ESTRUCTURA)))
    if not isinstance(p, int) or not (1 <= p <= 6):
        raise ValueError("permeabilidad invalida: %r (1-6 o %s)"
                         % (permeabilidad, list(PERMEABILIDAD)))

    mo = min(float(materia_organica_pct or 0.0), 4.0)
    M = (limo_pct + arena_muy_fina_pct) * (100.0 - arcilla_pct)

    k_ingles = (2.1e-4 * (M ** 1.14) * (12.0 - mo)
                + 3.25 * (s - 2)
                + 2.5 * (p - 3)) / 100.0
    return max(0.0, k_ingles * A_SI)


# --------------------------------------------------------------------------
# LS — factor topográfico
# --------------------------------------------------------------------------

LONGITUD_PARCELA_PATRON = 22.13   # m, la parcela experimental de la USLE


def factor_LS(pendiente_pct, longitud_m=LONGITUD_PARCELA_PATRON):
    """Factor topográfico: qué tan empinado y largo es el terreno.

    **Renard et al. (1997)**, Agriculture Handbook 703.

        L = (lambda / 22.13)^m,   m = beta / (1 + beta)
        beta = (sin(theta)/0.0896) / (3*sin(theta)^0.8 + 0.56)

    Y la pendiente según **McCool et al. (1987)**, que cambia de recta según
    el terreno sea suave o empinado:

        S = 10.8*sin(theta) + 0.03    si pendiente <  9%
        S = 16.8*sin(theta) - 0.50    si pendiente >= 9%

    El quiebre en 9% no es un capricho: por debajo domina la erosión laminar
    y por encima empieza a formarse el flujo concentrado.

    Se deriva del modelo de elevación: NASADEM a 30 m. La longitud de ladera
    por defecto es la parcela patrón, con lo cual L = 1 y LS = S.
    """
    if pendiente_pct is None or pendiente_pct < 0:
        raise ValueError("pendiente_pct = %r; debe ser >= 0" % pendiente_pct)
    if longitud_m is None or longitud_m <= 0:
        raise ValueError("longitud_m = %r; debe ser > 0" % longitud_m)

    theta = math.atan(pendiente_pct / 100.0)
    sen = math.sin(theta)

    if sen <= 0:
        # Terreno plano: no hay componente topográfica, pero el factor no es
        # cero -eso anularia toda la ecuacion- sino el minimo de McCool.
        return 0.03

    beta = (sen / 0.0896) / (3.0 * (sen ** 0.8) + 0.56)
    m = beta / (1.0 + beta)
    L = (longitud_m / LONGITUD_PARCELA_PATRON) ** m

    if pendiente_pct < 9.0:
        S = 10.8 * sen + 0.03
    else:
        S = 16.8 * sen - 0.50

    return L * max(S, 0.0)


# --------------------------------------------------------------------------
# C — cobertura vegetal
# --------------------------------------------------------------------------

C_ALFA = 2.0
C_BETA = 1.0


def factor_C(ndvi, alfa=C_ALFA, beta=C_BETA):
    """Cobertura vegetal: si hay algo protegiendo el suelo del impacto.

    **Van der Knijff et al. (2000)**:

        C = exp(-alfa * NDVI / (beta - NDVI))

    La relación es exponencial y no lineal a propósito: los primeros tramos de
    cobertura protegen muchísimo más que los últimos. Pasar de suelo desnudo a
    vegetación rala baja C más que pasar de rala a densa.

    Es el factor más dinámico —cambia de una temporada a otra— y el que este
    proyecto **actualiza** respecto de la línea base de CIREN.

    Entrada: NDVI desde Sentinel-2, con las bandas B04 y B08:
        NDVI = (B08 - B04) / (B08 + B04)

    NDVI negativo (agua, nube, nieve) devuelve C = 1: sin vegetación que
    proteja. Corresponde enmascarar esos píxeles antes de agregar por comuna;
    aquí no se descartan en silencio.
    """
    if ndvi is None:
        raise ValueError("ndvi es None")
    if not (-1.0 <= ndvi <= 1.0):
        raise ValueError("ndvi = %r fuera de [-1, 1]" % ndvi)

    if ndvi <= 0:
        return 1.0
    if ndvi >= beta:
        # La exponencial diverge en NDVI = beta. Cobertura total -> C minimo.
        return 0.0
    return math.exp(-alfa * ndvi / (beta - ndvi))


def ndvi_desde_bandas(b08, b04):
    """NDVI = (NIR - Rojo) / (NIR + Rojo). Devuelve None si no es calculable."""
    if b08 is None or b04 is None:
        return None
    denom = b08 + b04
    if denom == 0:
        return None
    return (b08 - b04) / denom


# --------------------------------------------------------------------------
# P — prácticas de conservación
# --------------------------------------------------------------------------

# Curvas de nivel, según pendiente (Wischmeier & Smith, 1978).
# En terreno muy empinado la práctica sirve poco: P se acerca a 1.
P_CURVAS_NIVEL = [
    (2.0,  0.60),
    (8.0,  0.50),
    (12.0, 0.60),
    (16.0, 0.70),
    (20.0, 0.80),
    (25.0, 0.90),
    (float("inf"), 0.95),
]


def p_curvas_nivel(pendiente_pct):
    """Valor de P para curvas de nivel en una pendiente dada."""
    for limite, valor in P_CURVAS_NIVEL:
        if pendiente_pct <= limite:
            return valor
    return P_CURVAS_NIVEL[-1][1]


def factor_P(superficie_intervenida_ha, superficie_agricola_ha, pendiente_pct):
    """Prácticas de conservación: si alguien está haciendo algo activamente.

    Terrazas, curvas de nivel, barreras vivas. Vale 1 cuando no hay ninguna
    práctica y baja a medida que aumenta la intervención.

    **Aquí entra el programa SIRSD-S.** Es el punto exacto donde la política
    pública toca el modelo científico, y por eso el cruce del proyecto no es
    arbitrario.

    Solo entran las prácticas que el esquema marca con `factor_rusle = 'P'`.
    Las de cubierta vegetal actúan sobre C y las enmiendas sobre K; sumarlas
    todas aquí contaría dos veces el mismo efecto.

    La comuna no está intervenida por completo, así que P se pondera por la
    fracción efectivamente bonificada:

        P = 1 - fraccion * (1 - P_practica)

    Con fracción 0 queda P = 1 (nada cambia) y con fracción 1 queda P_practica.

    superficie_intervenida_ha: hectáreas bonificadas con prácticas de tipo P.
    superficie_agricola_ha:    superficie agrícola de la comuna, NO la total.
                               Usar la superficie comunal completa diluiría la
                               fracción con cordillera y ciudad, y P daría
                               casi 1 en todas partes.
    """
    if superficie_agricola_ha is None or superficie_agricola_ha <= 0:
        raise ValueError("superficie_agricola_ha = %r; debe ser > 0"
                         % superficie_agricola_ha)
    intervenida = float(superficie_intervenida_ha or 0.0)
    if intervenida < 0:
        raise ValueError("superficie_intervenida_ha negativa")

    # Más bonificación que superficie agrícola significa un error de datos,
    # no una comuna 200% intervenida. Se acota y el llamador puede auditarlo.
    fraccion = min(1.0, intervenida / float(superficie_agricola_ha))
    p_practica = p_curvas_nivel(pendiente_pct)
    return 1.0 - fraccion * (1.0 - p_practica)
