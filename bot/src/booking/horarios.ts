/**
 * Ventanas de apertura efectivas por día y profesional (design.md D5):
 *  - sin reglas propias → hereda el horario del centro
 *  - con reglas propias → INTERSECCIÓN con el centro (el centro es el techo)
 *  - excepción 'cerrado' del profesional → sin ventanas ese día
 *  - excepción 'horario' → sustituye sus reglas semanales ese día (y se interseca con el centro)
 * Los cierres del CENTRO van por el calendario blocker (capa de ocupación, no de horario).
 */

import { aMinutos } from './tiempo';
import { diaSemanaDe } from './tiempo';
import { intersecarVentanas, type Ventana } from './slots';
import type { Excepcion, ReglaHoraria } from '../db/repos/catalogo';

export function ventanasDeReglas(reglas: ReglaHoraria[], diaSemana: number): Ventana[] {
  const ventanas: Ventana[] = [];
  for (const regla of reglas) {
    if (!regla.days.includes(diaSemana)) continue;
    const desde = aMinutos(regla.startTime);
    const hasta = aMinutos(regla.endTime);
    if (desde >= hasta) continue; // línea corrupta: se descarta, el resto se aplica
    if (regla.lunchStart && regla.lunchEnd) {
      const l1 = aMinutos(regla.lunchStart);
      const l2 = aMinutos(regla.lunchEnd);
      if (desde < l1 && l1 < l2 && l2 < hasta) {
        ventanas.push({ desde, hasta: l1 }, { desde: l2, hasta });
        continue;
      }
    }
    ventanas.push({ desde, hasta });
  }
  return ventanas.sort((a, b) => a.desde - b.desde);
}

function excepcionDelDia(excepciones: Excepcion[], fecha: string): Excepcion | null {
  // 'cerrado' manda sobre 'horario' si coinciden
  const delDia = excepciones.filter((e) => e.fecha <= fecha && (e.hasta ?? e.fecha) >= fecha);
  return delDia.find((e) => e.tipo === 'cerrado') ?? delDia.find((e) => e.tipo === 'horario') ?? null;
}

export interface ArgsVentanas {
  fecha: string;
  reglasCentro: ReglaHoraria[];
  reglasProfesional: ReglaHoraria[];
  excepcionesProfesional: Excepcion[];
}

export function ventanasEfectivas(args: ArgsVentanas): Ventana[] {
  const { fecha, reglasCentro, reglasProfesional, excepcionesProfesional } = args;
  const diaSemana = diaSemanaDe(fecha);
  const centro = ventanasDeReglas(reglasCentro, diaSemana);
  if (!centro.length) return [];

  const excepcion = excepcionDelDia(excepcionesProfesional, fecha);
  if (excepcion?.tipo === 'cerrado') return [];
  if (excepcion?.tipo === 'horario') {
    const propias: Ventana[] = (excepcion.ventanas ?? [])
      .map((v) => ({ desde: aMinutos(v.desde), hasta: aMinutos(v.hasta) }))
      .filter((v) => v.desde < v.hasta);
    return intersecarVentanas(centro, propias);
  }

  if (!reglasProfesional.length) return centro; // herencia
  const propias = ventanasDeReglas(reglasProfesional, diaSemana);
  if (!propias.length) return []; // tiene reglas pero no trabaja ese día
  return intersecarVentanas(centro, propias);
}
