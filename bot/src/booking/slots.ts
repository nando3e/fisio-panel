/**
 * Motor de rejilla. ÚNICA fuente de la aritmética de inicios y duraciones.
 * Rejilla de inicios: business_settings.slot_minutes (p. ej. [0,30] → paso 30).
 * Duración de un servicio: slots_required × paso  (design.md D4).
 */

import { instanteLocal, minutosLocales, fechaLocal } from './tiempo';

export interface Ventana { desde: number; hasta: number } // minutos desde medianoche local
export interface Intervalo { inicio: number; fin: number } // epoch ms

export function duracionServicio(slotsRequired: number, paso: number): number {
  if (slotsRequired < 1) throw new Error(`slots_required inválido: ${slotsRequired}`);
  return slotsRequired * paso;
}

/** Intersección de dos listas de ventanas (en minutos locales). */
export function intersecarVentanas(a: Ventana[], b: Ventana[]): Ventana[] {
  const resultado: Ventana[] = [];
  for (const va of a) {
    for (const vb of b) {
      const desde = Math.max(va.desde, vb.desde);
      const hasta = Math.min(va.hasta, vb.hasta);
      if (desde < hasta) resultado.push({ desde, hasta });
    }
  }
  return resultado.sort((x, y) => x.desde - y.desde);
}

/** Fusiona intervalos de ocupación solapados o contiguos. */
export function fusionarIntervalos(intervalos: Intervalo[]): Intervalo[] {
  const orden = [...intervalos].sort((a, b) => a.inicio - b.inicio);
  const resultado: Intervalo[] = [];
  for (const i of orden) {
    const ultimo = resultado[resultado.length - 1];
    if (ultimo && i.inicio <= ultimo.fin) ultimo.fin = Math.max(ultimo.fin, i.fin);
    else resultado.push({ ...i });
  }
  return resultado;
}

export interface ArgsHuecos {
  fecha: string;               // 'YYYY-MM-DD'
  ventanas: Ventana[];         // ventanas efectivas del profesional ese día (ya intersecadas)
  slotMinutes: number[];       // minutos de inicio válidos (p. ej. [0,30])
  duracionMin: number;         // duración total del servicio
  ocupacion: Intervalo[];      // intervalos ocupados (Google del fisio + blocker), fusionados
  ahora: Date;
  tz: string;
}

/**
 * Huecos de un día por sustracción: rejilla teórica de las ventanas, descartando
 * (a) inicios pasados, (b) cadenas que no caben en la MISMA ventana, (c) solapes con ocupación.
 */
export function huecosDelDia(args: ArgsHuecos): Date[] {
  const { fecha, ventanas, slotMinutes, duracionMin, ocupacion, ahora, tz } = args;
  const huecos: Date[] = [];
  const esHoy = fechaLocal(ahora, tz) === fecha;
  const minutosAhora = esHoy ? minutosLocales(ahora, tz) : -1;

  for (const ventana of ventanas) {
    for (let min = ventana.desde; min + duracionMin <= ventana.hasta; min += 1) {
      if (!slotMinutes.includes(min % 60)) continue;
      if (esHoy && min <= minutosAhora) continue;
      const inicio = instanteLocal(fecha, min, tz);
      const fin = inicio.getTime() + duracionMin * 60_000;
      const pisado = ocupacion.some((o) => inicio.getTime() < o.fin && fin > o.inicio);
      if (!pisado) huecos.push(inicio);
    }
  }
  return huecos;
}

/** ¿Sigue reservable exactamente este instante? (revalidación antes de escribir) */
export function esReservable(inicio: Date, args: Omit<ArgsHuecos, 'fecha'> & { fecha?: string }): boolean {
  const fecha = args.fecha ?? fechaLocal(inicio, args.tz);
  const candidatos = huecosDelDia({ ...args, fecha });
  return candidatos.some((h) => h.getTime() === inicio.getTime());
}
