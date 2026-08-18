import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularDisponibilidad, type DepsDisponibilidad } from '../src/booking/disponibilidad';
import type { EventoCal } from '../src/calendar/google';

const settings = { slotMinutes: [0, 30], paso: 30, timezone: 'Europe/Madrid', telefonoNegocio: null };
const reglasCentro = [
  { startTime: '09:00', endTime: '20:00', lunchStart: null, lunchEnd: null, days: [1, 2, 3, 4, 5] },
];
const marta = { id: 1, name: 'Marta', calendarId: 'cal-marta' };

function deps(eventosPorCalendario: Record<string, EventoCal[]>): DepsDisponibilidad {
  return {
    config: { settings: async () => settings },
    catalogo: {
      servicio: async (id: number) => ({ id, name: 'Sesión fisio', slotsRequired: 3 }),
      reglasCentro: async () => reglasCentro,
      catalogo: async () => ({ servicios: [], profesionales: [], porServicio: new Map(), blockerCalendarIds: ['cal-cierres'] }),
      reglasProfesional: async () => [],
      excepcionesProfesional: async () => [],
    },
    calendario: {
      listarEventos: async (calId: string) => eventosPorCalendario[calId] ?? [],
      crearEvento: async () => { throw new Error('no'); },
      moverEvento: async () => { throw new Error('no'); },
      borrarEvento: async () => { throw new Error('no'); },
    },
  } as unknown as DepsDisponibilidad;
}

const args = {
  serviceId: 2,
  candidatos: [marta] as never,
  desdeFecha: '2026-08-19', // miércoles
  diasNaturales: 2,
  ahora: new Date('2026-08-19T06:00:00Z'),
};

test('cierre del centro: evento de día completo en el blocker → motivo cerrado CON su título', async () => {
  const d = await calcularDisponibilidad(deps({
    'cal-cierres': [{ id: 'v1', summary: 'Vacaciones hasta el 30', start: { date: '2026-08-19' }, end: { date: '2026-08-20' } }],
  }), args);
  assert.equal(d.dias[0]!.huecos.length, 0);
  assert.equal(d.dias[0]!.motivo, 'cerrado');
  assert.equal(d.dias[0]!.cierre, 'Vacaciones hasta el 30');
  // El día siguiente no lo tapa el cierre: abierto y con huecos.
  assert.equal(d.dias[1]!.motivo, 'ok');
  assert.equal(d.dias[1]!.cierre, undefined);
  assert.ok(d.dias[1]!.huecos.length > 0);
});

test('cierre sin título: motivo cerrado con cierre null (el ejecutor pone el texto genérico)', async () => {
  const d = await calcularDisponibilidad(deps({
    'cal-cierres': [{ id: 'v2', summary: null, start: { date: '2026-08-19' }, end: { date: '2026-08-20' } }],
  }), args);
  assert.equal(d.dias[0]!.motivo, 'cerrado');
  assert.equal(d.dias[0]!.cierre, null);
});

test('día lleno por citas normales (sin blocker) sigue siendo "completo", nunca "cerrado"', async () => {
  const d = await calcularDisponibilidad(deps({
    'cal-marta': [{ id: 'e1', summary: 'ocupado', start: { dateTime: '2026-08-19T09:00:00+02:00' }, end: { dateTime: '2026-08-19T20:00:00+02:00' } }],
  }), args);
  assert.equal(d.dias[0]!.huecos.length, 0);
  assert.equal(d.dias[0]!.motivo, 'completo');
  assert.equal(d.dias[0]!.cierre, undefined);
});

test('cierre parcial (solo unas horas) NO marca el día como cerrado', async () => {
  const d = await calcularDisponibilidad(deps({
    'cal-cierres': [{ id: 'p1', summary: 'formación', start: { dateTime: '2026-08-19T09:00:00+02:00' }, end: { dateTime: '2026-08-19T13:00:00+02:00' } }],
  }), args);
  assert.equal(d.dias[0]!.motivo, 'ok');
  assert.equal(d.dias[0]!.cierre, undefined);
  // Y por la mañana no ofrece nada: el primer hueco es a partir de las 13:00.
  const primera = d.dias[0]!.huecos[0]!.inicio.toISOString();
  assert.ok(primera >= '2026-08-19T11:00:00.000Z', `primer hueco inesperado: ${primera}`);
});
