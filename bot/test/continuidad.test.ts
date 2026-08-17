import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirContinuidad, instruccionContinuidad } from '../src/booking/continuidad';
import type { CatalogoRepo, Profesional } from '../src/db/repos/catalogo';
import type { Recurrente } from '../src/patient/turno';

// Catálogo espejo del caso real: Marta (1) hace FISIO(2); Oscar (3) hace FISIO(2) y ACU(1).
function catalogoFalso(): CatalogoRepo {
  const pros: Profesional[] = [
    { id: 1, name: 'Marta', calendarId: 'cal-marta' },
    { id: 3, name: 'Oscar', calendarId: 'cal-oscar' },
  ];
  const porServicio = new Map<number, number[]>([[2, [1, 3]], [1, [3]]]);
  return {
    async ofreceServicio(proId: number, servicioId: number) { return (porServicio.get(servicioId) ?? []).includes(proId); },
    async profesionalesDeServicio(servicioId: number) { return pros.filter((p) => (porServicio.get(servicioId) ?? []).includes(p.id)); },
  } as unknown as CatalogoRepo;
}

const pacienteDeMarta: Recurrente = {
  pacienteId: 10, ultimoProfesionalId: 1, ultimoProfesionalNombre: 'Marta',
  ultimoServicioId: 2, ultimoServicioNombre: 'Sesión fisio', ultimaFecha: new Date('2026-08-10T09:00:00Z'),
};

test('obligatoria + su fisio hace el servicio → force con su fisio', async () => {
  const d = await decidirContinuidad({ modo: 'obligatoria', recurrente: pacienteDeMarta, serviceId: 2, catalogo: catalogoFalso() });
  assert.deepEqual(d, { kind: 'force', professionalId: 1, nombre: 'Marta' });
});

test('obligatoria + su fisio NO hace el servicio y otro sí → exception', async () => {
  const d = await decidirContinuidad({ modo: 'obligatoria', recurrente: pacienteDeMarta, serviceId: 1, catalogo: catalogoFalso() });
  assert.deepEqual(d, { kind: 'exception', prevProfessionalId: 1, nombre: 'Marta' });
});

test('preferida → sin restricción dura (none), aunque haya recurrente', async () => {
  const d = await decidirContinuidad({ modo: 'preferida', recurrente: pacienteDeMarta, serviceId: 2, catalogo: catalogoFalso() });
  assert.deepEqual(d, { kind: 'none' });
});

test('paciente nuevo (sin recurrente) → none también en obligatoria', async () => {
  const d = await decidirContinuidad({ modo: 'obligatoria', recurrente: null, serviceId: 2, catalogo: catalogoFalso() });
  assert.deepEqual(d, { kind: 'none' });
});

test('servicio que no hace nadie → none (error de config visible aguas abajo, no bloqueo mudo)', async () => {
  const d = await decidirContinuidad({ modo: 'obligatoria', recurrente: pacienteDeMarta, serviceId: 99, catalogo: catalogoFalso() });
  assert.deepEqual(d, { kind: 'none' });
});

test('la redacción de cada modo es única y coherente con el idioma', () => {
  assert.match(instruccionContinuidad('obligatoria', 'Marta', 'es'), /OBLIGATORIA/);
  assert.match(instruccionContinuidad('obligatoria', 'Marta', 'ca'), /OBLIGATÒRIA/);
  assert.match(instruccionContinuidad('preferida', 'Marta', 'es'), /PREFERIDA/);
  assert.match(instruccionContinuidad('preferida', 'Marta', 'es'), /Marta/);
});
