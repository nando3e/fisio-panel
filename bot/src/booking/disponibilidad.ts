/**
 * Servicio de disponibilidad: una sola lectura de Google por profesional y rango,
 * huecos por sustracción, candidatos por servicio y continuidad.
 */

import { huecosDelDia, duracionServicio, type Intervalo } from './slots';
import { ventanasEfectivas } from './horarios';
import { ocupacionDesdeEventos } from './ocupacion';
import { fechaLocal, instanteLocal, sumarDias } from './tiempo';
import type { CalendarioPort } from '../calendar/google';
import type { CatalogoRepo, Profesional } from '../db/repos/catalogo';
import type { ConfigNegocio } from '../config/negocio';

export interface Hueco { inicio: Date; professionalIds: number[] }
export interface DiaDisponibilidad {
  fecha: string;
  huecos: Hueco[];
  motivo: 'ok' | 'cerrado' | 'completo';
}
export interface Disponibilidad {
  dias: DiaDisponibilidad[];
  duracionMin: number;
  candidatos: Profesional[];
}

export interface DepsDisponibilidad {
  config: ConfigNegocio;
  catalogo: CatalogoRepo;
  calendario: CalendarioPort;
}

export interface ArgsDisponibilidad {
  serviceId: number;
  candidatos: Profesional[];    // ya filtrados por servicio y continuidad
  desdeFecha: string;           // 'YYYY-MM-DD'
  diasNaturales: number;        // ventana a explorar
  ahora?: Date;
}

export async function calcularDisponibilidad(deps: DepsDisponibilidad, args: ArgsDisponibilidad): Promise<Disponibilidad> {
  const { config, catalogo, calendario } = deps;
  const ahora = args.ahora ?? new Date();
  const settings = await config.settings();
  const servicio = await catalogo.servicio(args.serviceId);
  if (!servicio) throw new Error(`Servicio ${args.serviceId} no existe`);
  const duracionMin = duracionServicio(servicio.slotsRequired, settings.paso);

  const hastaFecha = sumarDias(args.desdeFecha, args.diasNaturales - 1);
  const desde = instanteLocal(args.desdeFecha, 0, settings.timezone);
  const hasta = instanteLocal(sumarDias(hastaFecha, 1), 0, settings.timezone);

  const reglasCentro = await catalogo.reglasCentro();
  const cat = await catalogo.catalogo();

  // Ocupación del blocker (cierres del centro): una lectura por calendario blocker.
  const blocker: Intervalo[] = [];
  for (const calId of cat.blockerCalendarIds) {
    try {
      const eventos = await calendario.listarEventos(calId, desde, hasta);
      blocker.push(...ocupacionDesdeEventos(eventos, settings.timezone));
    } catch (err) {
      // Un blocker ilegible no puede abrir el centro por accidente: se bloquea todo el rango.
      console.error(`[disponibilidad] error leyendo blocker ${calId}:`, err);
      blocker.push({ inicio: desde.getTime(), fin: hasta.getTime() });
    }
  }

  // Por profesional candidato: reglas, excepciones y ocupación (una lectura de Google cada uno).
  const porProfesional = new Map<number, { ocupacion: Intervalo[]; reglas: Awaited<ReturnType<CatalogoRepo['reglasProfesional']>>; excepciones: Awaited<ReturnType<CatalogoRepo['excepcionesProfesional']>> }>();
  for (const pro of args.candidatos) {
    const [reglas, excepciones] = await Promise.all([
      catalogo.reglasProfesional(pro.id),
      catalogo.excepcionesProfesional(pro.id, args.desdeFecha, hastaFecha),
    ]);
    let ocupacion: Intervalo[] = [];
    try {
      const eventos = await calendario.listarEventos(pro.calendarId, desde, hasta);
      ocupacion = ocupacionDesdeEventos(eventos, settings.timezone);
    } catch (err) {
      // Un profesional con calendario caído no bloquea al resto, pero él no ofrece huecos.
      console.error(`[disponibilidad] error leyendo calendario de ${pro.name}:`, err);
      ocupacion = [{ inicio: desde.getTime(), fin: hasta.getTime() }];
    }
    porProfesional.set(pro.id, { ocupacion: [...ocupacion, ...blocker], reglas, excepciones });
  }

  const dias: DiaDisponibilidad[] = [];
  for (let i = 0; i < args.diasNaturales; i++) {
    const fecha = sumarDias(args.desdeFecha, i);
    const porInicio = new Map<number, Hueco>();
    let algunaVentana = false;
    for (const pro of args.candidatos) {
      const datos = porProfesional.get(pro.id)!;
      const ventanas = ventanasEfectivas({
        fecha, reglasCentro, reglasProfesional: datos.reglas, excepcionesProfesional: datos.excepciones,
      });
      if (ventanas.length) algunaVentana = true;
      const huecos = huecosDelDia({
        fecha, ventanas, slotMinutes: settings.slotMinutes, duracionMin,
        ocupacion: datos.ocupacion, ahora, tz: settings.timezone,
      });
      for (const inicio of huecos) {
        const clave = inicio.getTime();
        const existente = porInicio.get(clave);
        if (existente) existente.professionalIds.push(pro.id);
        else porInicio.set(clave, { inicio, professionalIds: [pro.id] });
      }
    }
    const huecos = [...porInicio.values()].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
    dias.push({ fecha, huecos, motivo: huecos.length ? 'ok' : algunaVentana ? 'completo' : 'cerrado' });
  }

  return { dias, duracionMin, candidatos: args.candidatos };
}

/** ¿Sigue disponible exactamente este inicio para este profesional? Revalidación antes de escribir. */
export async function sigueDisponible(
  deps: DepsDisponibilidad,
  args: { serviceId: number; professionalId: number; inicio: Date; ahora?: Date },
): Promise<boolean> {
  const settings = await deps.config.settings();
  const pro = await deps.catalogo.profesional(args.professionalId);
  if (!pro) return false;
  const fecha = fechaLocal(args.inicio, settings.timezone);
  const disponibilidad = await calcularDisponibilidad(deps, {
    serviceId: args.serviceId, candidatos: [pro], desdeFecha: fecha, diasNaturales: 1, ahora: args.ahora,
  });
  return disponibilidad.dias[0]!.huecos.some((h) => h.inicio.getTime() === args.inicio.getTime());
}
