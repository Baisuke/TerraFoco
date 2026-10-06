# -*- coding: utf-8 -*-
"""
Planificador de tareas de TerraFoco.

Lee la programación desde `operacion.tarea_programada`, decide qué está vencido,
lo ordena por dependencias y lo ejecuta. Cada corrida queda en la bitácora.

El orquestador **no sabe nada del dominio**: solo sabe qué comando invocar,
cuándo, y de qué depende. Por eso migrar a Airflow o Prefect después es escribir
DAGs que llamen los mismos comandos, sin tocar el motor.

Uso:
    python -m orquestacion.orquestador --listar
    python -m orquestacion.orquestador --ejecutar
    python -m orquestacion.orquestador --forzar ingesta.senapred
    python -m orquestacion.orquestador --demonio --intervalo 3600
"""
import argparse
import shlex
import subprocess
import sys
import time
from datetime import datetime

from bd import conexion
from orquestacion.programacion import (
    Tarea, bloqueadas_por_dependencia, esta_vencida, ordenar_por_dependencia,
)

SQL_TAREAS = """
    SELECT codigo, descripcion, comando, cadencia, dia_del_mes,
           meses_validos, depende_de, activa, ultima_ejecucion, ultimo_estado
    FROM   operacion.tarea_programada
    ORDER  BY codigo
"""

SQL_ACTUALIZAR = """
    UPDATE operacion.tarea_programada
    SET    ultima_ejecucion = %s, ultimo_estado = %s
    WHERE  codigo = %s
"""


def cargar_tareas():
    with conexion() as con:
        filas = con.execute(SQL_TAREAS).fetchall()
    return [
        Tarea(codigo=f[0], descripcion=f[1], comando=f[2], cadencia=f[3],
              dia_del_mes=f[4], meses_validos=list(f[5] or []), depende_de=f[6],
              activa=f[7], ultima_ejecucion=f[8], ultimo_estado=f[9])
        for f in filas
    ]


def registrar(codigo, estado):
    with conexion() as con:
        con.execute(SQL_ACTUALIZAR, (datetime.now(), estado, codigo))


def ejecutar_tarea(tarea):
    """Ejecuta el comando de la tarea y devuelve 'ok' o 'error'."""
    print("  -> %s : %s" % (tarea.codigo, tarea.comando))
    try:
        subprocess.run(shlex.split(tarea.comando), check=True)
        estado = "ok"
    except subprocess.CalledProcessError as e:
        estado = "error"
        print("     falló con código %s" % e.returncode)
    except FileNotFoundError:
        estado = "error"
        print("     el comando no existe todavía (tarea aún no implementada)")
    registrar(tarea.codigo, estado)
    return estado


def listar(ahora=None):
    tareas = cargar_tareas()
    ahora = ahora or datetime.now()
    print("Programación al %s\n" % ahora.strftime("%d-%m-%Y %H:%M"))
    print("  %-26s %-12s %-10s %s" % ("TAREA", "CADENCIA", "ESTADO", "¿VENCIDA?"))
    print("  " + "-" * 68)
    for t in tareas:
        vencida = "SI" if esta_vencida(t, ahora) else "no"
        ultimo = t.ultima_ejecucion.strftime("%d-%m-%Y") if t.ultima_ejecucion else "nunca"
        print("  %-26s %-12s %-10s %-4s  (última: %s)"
              % (t.codigo, t.cadencia, t.ultimo_estado or "-", vencida, ultimo))
    return 0


def ejecutar_pendientes(ahora=None):
    ahora = ahora or datetime.now()
    tareas = cargar_tareas()
    vencidas = [t for t in tareas if esta_vencida(t, ahora)]

    if not vencidas:
        print("No hay tareas vencidas.")
        return 0

    print("%d tarea(s) vencida(s)\n" % len(vencidas))
    resultados = {}

    for tarea in ordenar_por_dependencia(vencidas):
        # Con TODAS las tareas, no solo la vencida: si la dependencia no tocaba
        # en este ciclo, su estado es el último guardado. Pasando [tarea] la
        # dependencia no se encontraba, quedaba "sin estado" y bloqueaba
        # siempre: hidrología nunca corría aunque NASADEM estaba "ok".
        bloqueo = bloqueadas_por_dependencia(tareas, resultados).get(tarea.codigo)
        if bloqueo:
            print("  -- %s : se salta, '%s' no terminó bien"
                  % (tarea.codigo, bloqueo))
            continue
        resultados[tarea.codigo] = ejecutar_tarea(tarea)

    fallidas = [c for c, e in resultados.items() if e != "ok"]
    print("\nEjecutadas %d | con error %d" % (len(resultados), len(fallidas)))
    return 1 if fallidas else 0


def forzar(codigo):
    """Ejecuta una tarea ignorando su cadencia.

    Es la respuesta al caso de SENAPRED: cuando ocurre un evento conocido no hay
    que esperar al ciclo semanal.
    """
    tarea = next((t for t in cargar_tareas() if t.codigo == codigo), None)
    if tarea is None:
        print("No existe la tarea '%s'" % codigo)
        return 1
    return 0 if ejecutar_tarea(tarea) == "ok" else 1


def demonio(intervalo):
    print("Planificador activo. Revisión cada %d s. Ctrl+C para detener." % intervalo)
    while True:
        try:
            ejecutar_pendientes()
        except Exception as e:            # nunca morir por una tarea
            print("[planificador] error no controlado: %s" % e)
        time.sleep(intervalo)


def main():
    p = argparse.ArgumentParser(description="Planificador de tareas de TerraFoco")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--listar", action="store_true", help="muestra qué está vencido")
    g.add_argument("--ejecutar", action="store_true", help="ejecuta lo vencido")
    g.add_argument("--forzar", metavar="CODIGO", help="ejecuta una tarea concreta")
    g.add_argument("--demonio", action="store_true", help="revisa cada cierto tiempo")
    p.add_argument("--intervalo", type=int, default=3600)
    args = p.parse_args()

    if args.listar:
        return listar()
    if args.ejecutar:
        return ejecutar_pendientes()
    if args.forzar:
        return forzar(args.forzar)
    if args.demonio:
        demonio(args.intervalo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
