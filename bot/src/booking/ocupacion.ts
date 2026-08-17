/**
 * De eventos de Google a intervalos de ocupación. El paso que suele romperse en silencio,
 * aislado y con tests propios (lecciones de balta, HANDOFF §4).
 */

import { fusionarIntervalos, type Intervalo } from './slots';
import { instanteLocal, sumarDias } from './tiempo';
import type { EventoCal } from '../calendar/google';

const DURACION_ASUMIDA_MIN = 15;

export function eventoAIntervalo(evento: EventoCal, tz: string): Intervalo | null {
  if (evento.status === 'cancelled') return null;

  // Evento de día completo: end.date de Google es EXCLUSIVO.
  if (evento.start?.date) {
    const inicio = instanteLocal(evento.start.date, 0, tz).getTime();
    const finFecha = evento.end?.date ?? sumarDias(evento.start.date, 1);
    const fin = instanteLocal(finFecha, 0, tz).getTime();
    return fin > inicio ? { inicio, fin } : { inicio, fin: inicio + 24 * 60 * 60_000 };
  }

  if (!evento.start?.dateTime) return null;
  const inicio = Date.parse(evento.start.dateTime);
  if (Number.isNaN(inicio)) return null;
  let fin = evento.end?.dateTime ? Date.parse(evento.end.dateTime) : NaN;
  if (Number.isNaN(fin) || fin <= inicio) fin = inicio + DURACION_ASUMIDA_MIN * 60_000;
  return { inicio, fin };
}

export function ocupacionDesdeEventos(eventos: EventoCal[], tz: string): Intervalo[] {
  const intervalos: Intervalo[] = [];
  for (const e of eventos) {
    const intervalo = eventoAIntervalo(e, tz);
    if (intervalo) intervalos.push(intervalo);
  }
  return fusionarIntervalos(intervalos);
}
