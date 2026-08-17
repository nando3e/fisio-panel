/**
 * Scheduler interno: sin cola externa. Cada tarea aislada (si una falla, las demás
 * siguen), guardia de solape, y ejecución también AL ARRANCAR cuando toca (un
 * despliegue a las 11:01 no puede callar la ronda hasta las 11:30).
 */

interface Tarea {
  nombre: string;
  intervaloMs: number;
  alArrancar: boolean;
  fn: () => Promise<void>;
  enCurso: boolean;
}

export class Scheduler {
  private tareas: Tarea[] = [];
  private timers: NodeJS.Timeout[] = [];

  registrar(nombre: string, intervaloMs: number, alArrancar: boolean, fn: () => Promise<void>): void {
    this.tareas.push({ nombre, intervaloMs, alArrancar, fn, enCurso: false });
  }

  private async ejecutar(tarea: Tarea): Promise<void> {
    if (tarea.enCurso) return;
    tarea.enCurso = true;
    try {
      await tarea.fn();
    } catch (err) {
      console.error(`[scheduler] tarea ${tarea.nombre} falló:`, err);
    } finally {
      tarea.enCurso = false;
    }
  }

  arrancar(): void {
    for (const tarea of this.tareas) {
      if (tarea.alArrancar) void this.ejecutar(tarea);
      const timer = setInterval(() => void this.ejecutar(tarea), tarea.intervaloMs);
      timer.unref();
      this.timers.push(timer);
    }
  }

  parar(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }
}
