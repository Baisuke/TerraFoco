# -*- coding: utf-8 -*-
"""
Lectura y escritura de valores calculados por comuna.

Hay dos almacenes con la misma disciplina y distinta tabla:

  * los FACTORES de RUSLE (R, K, LS, C, P) en `indicadores.factor`, que
    alimentan el cálculo de pérdida de suelo;
  * las VARIABLES del índice de susceptibilidad a inundación en
    `indicadores.variable_inundacion`.

Cada proceso de ingesta escribe lo que sabe calcular; el cálculo lee lo que
haya. Nada se sobrescribe: cada recálculo inserta una versión nueva y la más
reciente gana.

La diferencia que importa entre ambos es el signo. En RUSLE un factor en cero
anula el producto entero, así que allí un valor no positivo se descarta. En
el índice de inundación el modelo es aditivo y el signo es señal: la
curvatura negativa marca las concavidades donde se junta el agua. Por eso
cada almacén declara si exige positivos, y no se decide en el llamador.
"""
import json

from bd import conexion


class Almacen(object):
    """Un almacén de valores por comuna, sobre una tabla concreta."""

    def __init__(self, tabla, columna, nombres, exige_positivo):
        self.tabla = tabla
        self.columna = columna
        self.nombres = tuple(nombres)
        self.exige_positivo = exige_positivo

        self.sql_guardar = """
        INSERT INTO %(t)s (id_region, id_comuna, %(c)s, valor, anio, fuente, detalle)
        VALUES (%%(id_region)s, %%(id_comuna)s, %%(nombre)s, %%(valor)s, %%(anio)s,
                %%(fuente)s, %%(detalle)s)
        """ % {"t": tabla, "c": columna}

        self.sql_leer = """
        SELECT DISTINCT ON (id_comuna, %(c)s)
               id_comuna, %(c)s, valor, anio, fuente
        FROM   %(t)s
        WHERE  id_region = %%(region)s
          -- El cast no es adorno: sin el, Postgres no puede inferir el tipo
          -- del parametro cuando llega en NULL y falla con AmbiguousParameter.
          AND  (%%(anio)s::smallint IS NULL OR anio <= %%(anio)s::smallint)
        ORDER  BY id_comuna, %(c)s, anio DESC, calculado_en DESC
        """ % {"t": tabla, "c": columna}

    def guardar(self, id_region, valores, nombre, anio, fuente, detalles=None):
        """Guarda un valor para varias comunas.

        valores:  {id_comuna: numero}
        detalles: {id_comuna: dict} opcional, para la trazabilidad.

        Devuelve (guardados, descartados). Se descarta lo que es None y, si el
        almacén exige positivos, lo que no lo es. Los descartes vuelven al
        llamador para que los informe en vez de perderlos.
        """
        detalles = detalles or {}
        if nombre not in self.nombres:
            raise ValueError("%r desconocido en %s; se esperan %s"
                             % (nombre, self.tabla, self.nombres))

        guardados, descartados = 0, []
        with conexion() as con:
            for id_comuna, valor in sorted(valores.items()):
                if valor is None or (self.exige_positivo and valor <= 0):
                    descartados.append((id_comuna, valor))
                    continue
                d = detalles.get(id_comuna)
                con.execute(self.sql_guardar, {
                    "id_region": id_region, "id_comuna": id_comuna,
                    "nombre": nombre, "valor": float(valor), "anio": anio,
                    "fuente": fuente,
                    "detalle": json.dumps(d, ensure_ascii=False) if d else None,
                })
                guardados += 1
        return guardados, descartados

    def leer(self, id_region, anio=None):
        """Último valor de cada nombre por comuna.

        Devuelve {id_comuna: {"R": valor, ...}}, solo con lo que exista. El
        llamador decide qué hacer con lo que falte; aquí no se rellena nada
        por cuenta propia.
        """
        with conexion() as con:
            filas = con.execute(self.sql_leer,
                                {"region": id_region, "anio": anio}).fetchall()
        por_comuna = {}
        for id_comuna, nombre, valor, anio_f, fuente in filas:
            d = por_comuna.setdefault(id_comuna, {})
            d[nombre] = float(valor)
            d.setdefault("_fuentes", {})[nombre] = "%s (%s)" % (fuente, anio_f)
        return por_comuna

    def cobertura(self, id_region, anio=None):
        """Cuántas comunas tienen cada nombre. Para saber qué falta."""
        datos = self.leer(id_region, anio)
        return {n: sum(1 for d in datos.values() if n in d) for n in self.nombres}


# --------------------------------------------------------------------------
# Los dos almacenes del proyecto
# --------------------------------------------------------------------------

FACTORES = ("R", "K", "LS", "C", "P")

RUSLE = Almacen("indicadores.factor", "factor", FACTORES, exige_positivo=True)

VARIABLES_INUNDACION = ("pendiente", "acumulacion", "distancia_cauces",
                        "twi", "curvatura", "cobertura")

INUNDACION = Almacen("indicadores.variable_inundacion", "variable",
                     VARIABLES_INUNDACION, exige_positivo=False)


def almacen_de(nombre):
    """El almacén que corresponde a un nombre, o ValueError si no es de ninguno."""
    if nombre in FACTORES:
        return RUSLE
    if nombre in VARIABLES_INUNDACION:
        return INUNDACION
    raise ValueError("%r no es factor de RUSLE (%s) ni variable de inundacion (%s)"
                     % (nombre, FACTORES, VARIABLES_INUNDACION))


# Las funciones de siempre siguen apuntando a RUSLE: calcular.py, las
# ingestas de factores y mapa_erosion.py las usan tal cual.

def guardar(id_region, valores, factor, anio, fuente, detalles=None):
    return RUSLE.guardar(id_region, valores, factor, anio, fuente, detalles)


def leer(id_region, anio=None):
    return RUSLE.leer(id_region, anio)


def cobertura(id_region, anio=None):
    return RUSLE.cobertura(id_region, anio)
