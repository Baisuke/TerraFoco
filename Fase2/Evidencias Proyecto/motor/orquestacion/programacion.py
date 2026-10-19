# -*- coding: utf-8 -*-
"""
Lógica de programación de tareas.

Deliberadamente **sin acceso a la base de datos**: son funciones puras sobre
estructuras simples. Eso permite probarlas sin levantar PostgreSQL, que es donde
se esconden los errores de este tipo de código.

Las cadencias soportadas y su regla de vencimiento:

    unica       una sola vez en la vida del sistema
    semanal     si pasaron 7 días o más desde la última corrida exitosa
    mensual     una vez al mes, a partir del día indicado
    estacional  una vez al año, solo dentro de los meses válidos
    trimestral  una vez por trimestre calendario
    anual       una vez por año calendario
    manual      nunca vence sola; se dispara con --forzar
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta


@dataclass
class Tarea:
    codigo: str
    descripcion: str
    comando: str
    cadencia: str
    dia_del_mes: int = None
    meses_validos: list = field(default_factory=list)
    depende_de: str = None
    activa: bool = True
    ultima_ejecucion: datetime = None
    ultimo_estado: str = None


def trimestre(fecha):
    return (fecha.month - 1) // 3 + 1


CADENCIAS = {"unica", "semanal", "mensual", "estacional",
             "trimestral", "anual", "manual"}

# Tras un error se espera esto antes de reintentar. Sin espera, una tarea que
# falla por algo que no cambia solo —un archivo que se descarga a mano, como
# el de CR2MET— se reintentaba en cada revisión, cada hora, para siempre.
ESPERA_TRAS_ERROR = timedelta(hours=24)


def esta_vencida(tarea, ahora=None):
    """¿Corresponde ejecutar esta tarea en este momento?"""
    ahora = ahora or datetime.now()

    # Se valida ANTES de cualquier otra cosa: una cadencia mal escrita caía en
    # el camino de "nunca ejecutada" y devolvía True en silencio, con lo que la
    # tarea corría en cada ciclo para siempre.
    if tarea.cadencia not in CADENCIAS:
        raise ValueError(
            "Cadencia desconocida en '%s': %s. Válidas: %s"
            % (tarea.codigo, tarea.cadencia, ", ".join(sorted(CADENCIAS)))
        )

    if not tarea.activa or tarea.cadencia == "manual":
        return False

    ultima = tarea.ultima_ejecucion
    # La base guarda timestamptz y `ahora` llega sin zona: restarlos falla.
    # Se lleva la última ejecución a la hora local sin zona, como `ahora`.
    if ultima is not None and ultima.tzinfo is not None and ahora.tzinfo is None:
        ultima = ultima.astimezone().replace(tzinfo=None)

    # Solo cuenta como "ya hecha" si terminó bien. Un error vuelve a
    # intentarse, pero no antes de ESPERA_TRAS_ERROR.
    if tarea.ultimo_estado not in (None, "ok"):
        if ultima is not None and ahora - ultima < ESPERA_TRAS_ERROR:
            return False
        ultima = None

    if ultima is None:
        # Nunca corrió con éxito. Vence salvo que la ventana estacional no aplique.
        if tarea.cadencia == "estacional":
            return ahora.month in (tarea.meses_validos or [])
        return True

    if tarea.cadencia == "unica":
        return False

    if tarea.cadencia == "semanal":
        return ahora - ultima >= timedelta(days=7)

    if tarea.cadencia == "mensual":
        mismo_mes = (ultima.year, ultima.month) == (ahora.year, ahora.month)
        dia_alcanzado = ahora.day >= (tarea.dia_del_mes or 1)
        return not mismo_mes and dia_alcanzado

    if tarea.cadencia == "estacional":
        if ahora.month not in (tarea.meses_validos or []):
            return False
        return ultima.year != ahora.year

    if tarea.cadencia == "trimestral":
        return (ultima.year, trimestre(ultima)) != (ahora.year, trimestre(ahora))

    if tarea.cadencia == "anual":
        return ultima.year != ahora.year

    return False   # inalcanzable: la cadencia ya fue validada arriba


def ordenar_por_dependencia(tareas):
    """Ordena de forma que toda tarea aparezca después de aquella de la que depende.

    Lanza ValueError si hay un ciclo, en vez de colgarse.
    """
    por_codigo = {t.codigo: t for t in tareas}
    ordenadas, visitando, listas = [], set(), set()

    def visitar(codigo):
        if codigo in listas:
            return
        if codigo in visitando:
            raise ValueError("Dependencia circular en '%s'" % codigo)
        visitando.add(codigo)
        tarea = por_codigo.get(codigo)
        if tarea is not None:
            if tarea.depende_de:
                visitar(tarea.depende_de)
            ordenadas.append(tarea)
        visitando.discard(codigo)
        listas.add(codigo)

    for t in tareas:
        visitar(t.codigo)
    return ordenadas


def bloqueadas_por_dependencia(tareas, resultados):
    """Tareas que no deben correr porque aquello de lo que dependen no quedó bien.

    `resultados` es un dict {codigo: estado} de lo ejecutado en este ciclo.
    """
    bloqueadas = {}
    por_codigo = {t.codigo: t for t in tareas}
    for t in tareas:
        if not t.depende_de:
            continue
        estado = resultados.get(t.depende_de)
        if estado is None:
            padre = por_codigo.get(t.depende_de)
            estado = padre.ultimo_estado if padre else None
        if estado not in ("ok",):
            bloqueadas[t.codigo] = t.depende_de
    return bloqueadas
