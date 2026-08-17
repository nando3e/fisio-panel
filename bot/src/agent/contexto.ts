/**
 * Bloques dinámicos del system prompt, compuestos EN CADA TURNO y ordenados de
 * estable a volátil (cacheo de prefijo). Todo lo que exija recorrer una lista y
 * aplicar condiciones se calcula aquí; el modelo copia (guía §8-9).
 */

import type { Catalogo, ReglaHoraria } from '../db/repos/catalogo';
import type { ContextoPaciente } from '../patient/turno';
import { instruccionContinuidad } from '../booking/continuidad';
import { ventanasDeReglas } from '../booking/horarios';
import { deMinutos, fechaLocal, fechaLegible, horaLocal, nombreDia, sumarDias, diaSemanaDe } from '../booking/tiempo';

export function bloqueCatalogo(catalogo: Catalogo, paso: number): string {
  const lineas: string[] = ['## Catálogo de servicios y profesionales'];
  for (const s of catalogo.servicios) {
    const pros = (catalogo.porServicio.get(s.id) ?? [])
      .map((id) => {
        const p = catalogo.profesionales.find((x) => x.id === id);
        return p ? `${p.name} (id ${p.id})` : null;
      })
      .filter(Boolean);
    lineas.push(`- ${s.name} (service_id ${s.id}, ${s.slotsRequired * paso} min) — profesionales: ${pros.length ? pros.join(', ') : 'SIN ASIGNAR'}`);
  }
  return lineas.join('\n');
}

export function bloqueNegocio(datos: {
  nombre: string; direccion: string; telefono: string | null; reglasCentro: ReglaHoraria[];
}): string {
  const lineas: string[] = ['## Datos del negocio (vigentes ahora)'];
  lineas.push(`- Nombre: ${datos.nombre}`);
  if (datos.direccion) lineas.push(`- Dirección: ${datos.direccion}`);
  if (datos.telefono) lineas.push(`- Teléfono: ${datos.telefono}`);
  const porDia: string[] = [];
  for (let dia = 1; dia <= 7; dia++) {
    const ventanas = ventanasDeReglas(datos.reglasCentro, dia);
    porDia.push(`  - ${nombreDia(dia)}: ${ventanas.length ? ventanas.map((v) => `${deMinutos(v.desde)}-${deMinutos(v.hasta)}`).join(' y ') : 'cerrado'}`);
  }
  lineas.push('- Horario semanal del centro (cada profesional puede tener el suyo; la agenda real la dan las tools):', ...porDia);
  return lineas.join('\n');
}

export function bloquePaciente(ctx: ContextoPaciente, modo: 'preferida' | 'obligatoria'): string {
  const lineas: string[] = ['## Quién escribe'];
  lineas.push(`- Idioma del paciente: ${ctx.idioma === 'ca' ? 'CATALÁN' : 'CASTELLANO'} — responde SIEMPRE en ese idioma.`);
  if (ctx.titular?.nombre) {
    lineas.push(`- Es ${ctx.titular.nombre}${ctx.titular.apellido ? ` ${ctx.titular.apellido}` : ''}, paciente registrado: salúdale por su nombre y NO le pidas datos que ya tienes.`);
  } else {
    lineas.push('- Número NO registrado: trátalo como paciente nuevo. Pide nombre (y apellido) SOLO cuando ya haya elegido hora.');
  }
  const terceros = ctx.candidatos.filter((p) => !p.titular && p.nombre);
  if (terceros.length) {
    lineas.push(`- Desde este número también se visita: ${terceros.map((p) => p.nombre).join(', ')}. Si hay ambigüedad, pregunta para quién es la cita.`);
  }
  if (ctx.recurrente) {
    const dias = Math.round((Date.now() - ctx.recurrente.ultimaFecha.getTime()) / 86_400_000);
    lineas.push(`- Última visita: ${ctx.recurrente.ultimoServicioNombre ?? 'servicio no registrado'} con ${ctx.recurrente.ultimoProfesionalNombre}, hace ${dias} día${dias === 1 ? '' : 's'}.`);
    lineas.push(`- Si expresa una molestia o no concreta el servicio, propón la continuación natural: repetir ${ctx.recurrente.ultimoServicioNombre ?? 'su último servicio'} con ${ctx.recurrente.ultimoProfesionalNombre}.`);
    lineas.push(`- ${instruccionContinuidad(modo, ctx.recurrente.ultimoProfesionalNombre, ctx.idioma)}`);
  } else if (ctx.titular) {
    lineas.push('- Sin visitas previas registradas: si pide cita y no concreta, oriéntale a Primera visita.');
  }
  if (ctx.citasFuturas.length) {
    lineas.push(`- Este número tiene ${ctx.citasFuturas.length} cita(s) futura(s): usa listar_mis_citas antes de gestionar cambios.`);
  }
  return lineas.join('\n');
}

export function bloqueTemporal(args: {
  ahora: Date; tz: string; diasCalendario: number; reglasCentro: ReglaHoraria[]; idioma: string;
}): string {
  const { ahora, tz, diasCalendario, reglasCentro } = args;
  const hoy = fechaLocal(ahora, tz);
  const lineas: string[] = ['## Fecha y calendario de referencia'];
  lineas.push(`- AHORA: ${fechaLegible(hoy)} de ${hoy.slice(0, 4)}, ${horaLocal(ahora, tz)} (${tz}).`);
  lineas.push(`- Tabla de los próximos ${diasCalendario} días. Para resolver "el martes que viene" LEE esta tabla, no cuentes días. "El X que viene" = la primera aparición futura de ese día, aunque caiga esta misma semana.`);
  lineas.push('- Los días CERRADO lo son por horario semanal del centro; un día lleno NO está cerrado. Puede haber cierres puntuales adicionales: la agenda real siempre la da consultar_disponibilidad.');
  for (let i = 0; i < diasCalendario; i++) {
    const fecha = sumarDias(hoy, i);
    const cerrado = ventanasDeReglas(reglasCentro, diaSemanaDe(fecha)).length === 0;
    const etiqueta = i === 0 ? ' [HOY]' : i === 1 ? ' [mañana]' : '';
    lineas.push(`  ${nombreDia(diaSemanaDe(fecha))} ${fecha}${etiqueta}${cerrado ? ' — CERRADO' : ''}`);
  }
  lineas.push(`- Ámbito: la tabla cubre SOLO estos ${diasCalendario} días; para fechas posteriores consulta disponibilidad con la fecha concreta, existen igualmente.`);
  return lineas.join('\n');
}
