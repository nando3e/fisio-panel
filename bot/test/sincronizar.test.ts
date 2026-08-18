import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sincronizarCalendario, type DepsSincronizar } from '../src/reminders/sincronizar';
import type { EventoCal } from '../src/calendar/google';

const MARTA = { id: 1, name: 'Marta', calendarId: 'cal-marta' };
const OSCAR = { id: 3, name: 'Oscar', calendarId: 'cal-oscar' };

interface Registro { reprogramadas: unknown[]; reasignadas: unknown[]; altas: unknown[]; borradosPorPro: unknown[] }

function deps(
  eventosPorCal: Record<string, EventoCal[]>,
  registradas: Record<string, { startTime: Date; endTime: Date; professionalId: number }>,
  reg: Registro,
): DepsSincronizar {
  return {
    catalogo: { catalogo: async () => ({ profesionales: [MARTA, OSCAR], blockerCalendarIds: [], servicios: [], porServicio: new Map() }) },
    calendario: {
      listarEventos: async (calId: string) => eventosPorCal[calId] ?? [],
      crearEvento: async () => { throw new Error('no'); },
      moverEvento: async () => { throw new Error('no'); },
      borrarEvento: async () => { throw new Error('no'); },
    },
    citas: {
      sincronizarBorrados: async (proId: number, ids: string[]) => { reg.borradosPorPro.push({ proId, ids }); return 0; },
      porEventId: async (id: string) => registradas[id] ?? null,
      reprogramar: async (id: string, inicio: Date, fin: Date) => { reg.reprogramadas.push({ id, inicio, fin }); },
      reasignarProfesional: async (id: string, proId: number) => { reg.reasignadas.push({ id, proId }); },
      altaSincronizada: async (datos: unknown) => { reg.altas.push(datos); },
    },
    pacientes: { guardarTitular: async (tel: string, datos: { nombre: string | null }) => ({ id: 99, telefono: tel, ...datos }) },
  } as unknown as DepsSincronizar;
}

const rango = [new Date('2026-08-18T00:00:00Z'), new Date('2026-08-25T00:00:00Z')] as const;

test('cita del bot MOVIDA a mano en Google: el espejo se reprograma (y el recordatorio se recalcula)', async () => {
  const reg: Registro = { reprogramadas: [], reasignadas: [], altas: [], borradosPorPro: [] };
  await sincronizarCalendario(deps(
    { 'cal-marta': [{ id: 'ev1', summary: 'Ana Costa - FISIO', start: { dateTime: '2026-08-19T11:00:00+02:00' }, end: { dateTime: '2026-08-19T12:30:00+02:00' } }] },
    { ev1: { startTime: new Date('2026-08-19T09:00:00+02:00'), endTime: new Date('2026-08-19T10:30:00+02:00'), professionalId: 1 } },
    reg,
  ), ...rango);
  assert.equal(reg.reprogramadas.length, 1);
  assert.equal((reg.reprogramadas[0] as { inicio: Date }).inicio.toISOString(), '2026-08-19T09:00:00.000Z');
  assert.equal(reg.reasignadas.length, 0);
  assert.equal(reg.altas.length, 0);
});

test('cita ARRASTRADA al calendario de otro fisio: se reasigna el profesional', async () => {
  const reg: Registro = { reprogramadas: [], reasignadas: [], altas: [], borradosPorPro: [] };
  await sincronizarCalendario(deps(
    { 'cal-oscar': [{ id: 'ev1', summary: 'Ana Costa - FISIO', start: { dateTime: '2026-08-19T09:00:00+02:00' }, end: { dateTime: '2026-08-19T10:30:00+02:00' } }] },
    { ev1: { startTime: new Date('2026-08-19T09:00:00+02:00'), endTime: new Date('2026-08-19T10:30:00+02:00'), professionalId: 1 } },
    reg,
  ), ...rango);
  assert.deepEqual(reg.reasignadas, [{ id: 'ev1', proId: 3 }]);
  assert.equal(reg.reprogramadas.length, 0);
});

test('cita sin cambios: no se toca nada', async () => {
  const reg: Registro = { reprogramadas: [], reasignadas: [], altas: [], borradosPorPro: [] };
  await sincronizarCalendario(deps(
    { 'cal-marta': [{ id: 'ev1', summary: 'Ana - FISIO', start: { dateTime: '2026-08-19T09:00:00+02:00' }, end: { dateTime: '2026-08-19T10:30:00+02:00' } }] },
    { ev1: { startTime: new Date('2026-08-19T09:00:00+02:00'), endTime: new Date('2026-08-19T10:30:00+02:00'), professionalId: 1 } },
    reg,
  ), ...rango);
  assert.equal(reg.reprogramadas.length + reg.reasignadas.length + reg.altas.length, 0);
});

test('apunte a mano nuevo con teléfono: alta sincronizada (y recibirá recordatorio)', async () => {
  const reg: Registro = { reprogramadas: [], reasignadas: [], altas: [], borradosPorPro: [] };
  await sincronizarCalendario(deps(
    { 'cal-marta': [{ id: 'nuevo1', summary: 'Pepa 666555444', start: { dateTime: '2026-08-20T10:00:00+02:00' }, end: { dateTime: '2026-08-20T11:00:00+02:00' } }] },
    {},
    reg,
  ), ...rango);
  assert.equal(reg.altas.length, 1);
  assert.equal((reg.altas[0] as { telefono: string }).telefono, '+34666555444');
});
