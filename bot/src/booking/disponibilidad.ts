/**
 * Servicio de disponibilidad: una sola lectura de Google por profesional y rango,
 * huecos por sustracción, candidatos por servicio y continuidad.
 */

import { huecosDelDia, duracionServicio, fusionarIntervalos, type Intervalo } from './slots';
import { ventanasEfectivas } from './horarios';
import { eventoAIntervalo, ocupacionDesdeEventos } from './ocupacion';
import { fechaLocal, instanteLocal, sumarDias } from './tiempo';
import type { CalendarioPort } from '../calendar/google';
import type { CatalogoRepo, Profesional } from '../db/repos/catalogo';
import type { ConfigNegocio } from '../config/negocio';

export interface Hueco { inicio: Date; professionalIds: number[] }
export interface DiaDisponibilidad {
  fecha: string;
  huecos: Hueco[];
  motivo: 'ok' | 'cerrado' | 'completo';
  /** Presente si el día lo tapa un evento del calendario de cierres; el valor es su título (o null si no tiene). */
  cierre?: string | null;
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

  // Cierres del panel: mandan sobre todo lo demás. Un día dentro de un cierre
  // no se calcula siquiera (ni Google ni horarios): cerrado, con su mensaje.
  const cierres = await catalogo.cierresDesde(args.desdeFecha);
  const cierreDe = (fecha: string) => cierres.find((c) => fecha >= c.desde && fecha <= c.hasta) ?? null;

  // Ocupación del blocker (cierres del centro): una lectura por calendario blocker.
  // Se conservan también los eventos con su título, para poder explicar el MOTIVO del cierre.
  const blocker: Intervalo[] = [];
  const eventosCierre: { intervalo: Intervalo; nota: string | null }[] = [];
  for (const calId of cat.blockerCalendarIds) {
    try {
      const eventos = await calendario.listarEventos(calId, desde, hasta);
      blocker.push(...ocupacionDesdeEventos(eventos, settings.timezone));
      for (const e of eventos) {
        const intervalo = eventoAIntervalo(e, settings.timezone);
        if (intervalo) eventosCierre.push({ intervalo, nota: e.summary?.trim() || null });
      }
    } catch (err) {
      // Un blocker ilegible no puede abrir el centro por accidente: se bloquea todo el rango.
      console.error(`[disponibilidad] error leyendo blocker ${calId}:`, err);
      blocker.push({ inicio: desde.getTime(), fin: hasta.getTime() });
    }
  }
  const blockerFusionado = fusionarIntervalos(blocker);

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

    const cierrePanel = cierreDe(fecha);
    if (cierrePanel) {
      dias.push({ fecha, huecos: [], motivo: 'cerrado', cierre: cierrePanel.mensaje ?? cierrePanel.motivo ?? null });
      continue;
    }

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

    // Cierre del centro: si el blocker tapa TODAS las ventanas del centro ese día,
    // el día no está "completo" sino CERRADO (vacaciones/festivo), con su motivo.
    let cierre: string | null | undefined;
    if (!huecos.length) {
      const ventanasCentro = ventanasEfectivas({ fecha, reglasCentro, reglasProfesional: [], excepcionesProfesional: [] });
      if (ventanasCentro.length) {
        const cubierto = ventanasCentro.every((v) => {
          const i = instanteLocal(fecha, v.desde, settings.timezone).getTime();
          const f = instanteLocal(fecha, v.hasta, settings.timezone).getTime();
          return blockerFusionado.some((b) => b.inicio <= i && b.fin >= f);
        });
        if (cubierto) {
          const diaIni = instanteLocal(fecha, 0, settings.timezone).getTime();
          const diaFin = instanteLocal(sumarDias(fecha, 1), 0, settings.timezone).getTime();
          cierre = eventosCierre.find((c) => c.nota && c.intervalo.inicio < diaFin && c.intervalo.fin > diaIni)?.nota ?? null;
        }
      }
    }

    dias.push({
      fecha, huecos,
      motivo: huecos.length ? 'ok' : cierre !== undefined || !algunaVentana ? 'cerrado' : 'completo',
      ...(cierre !== undefined ? { cierre } : {}),
    });
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
