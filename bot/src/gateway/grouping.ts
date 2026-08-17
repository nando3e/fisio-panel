/**
 * Agrupación de ráfagas por teléfono (debounce): tres WhatsApps seguidos = un turno.
 * Estado en memoria del proceso: asumido (una sola instancia); un reinicio pierde
 * ráfagas en vuelo, y es aceptable.
 */

interface Rafaga { mensajes: string[]; timer: NodeJS.Timeout }

export class Agrupador {
  private rafagas = new Map<string, Rafaga>();

  constructor(private procesar: (telefono: string, mensajeAgrupado: string) => Promise<void>) {}

  agrupar(telefono: string, mensaje: string, ventanaMs: number): void {
    const existente = this.rafagas.get(telefono);
    if (existente) {
      existente.mensajes.push(mensaje);
      existente.timer.refresh();
      return;
    }
    const rafaga: Rafaga = {
      mensajes: [mensaje],
      timer: setTimeout(() => {
        this.rafagas.delete(telefono);
        void this.procesar(telefono, rafaga.mensajes.join('\n')).catch((err) =>
          console.error(`[agrupador] turno de ${telefono} falló:`, err));
      }, ventanaMs),
    };
    rafaga.timer.unref();
    this.rafagas.set(telefono, rafaga);
  }
}
