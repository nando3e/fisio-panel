import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ejecutarTool, type DepsEjecutor, type ToolContext } from '../src/agent/ejecutor';
import type { ConfigNegocio } from '../src/config/negocio';
import type { CatalogoRepo, Profesional } from '../src/db/repos/catalogo';
import type { CalendarioPort } from '../src/calendar/google';
import type { ContextoPaciente } from '../src/patient/turno';

/**
 * Espejo de los tests 11.x de nubimed: la restricción de continuidad vive en el
 * ejecutor y se aplica AUNQUE el modelo pida otra cosa. Sin red ni BD.
 */

const MARTA: Profesional = { id: 1, name: 'Marta', calendarId: 'cal-marta' };
const OSCAR: Profesional = { id: 3, name: 'Oscar', calendarId: 'cal-oscar' };

function configFalsa(): ConfigNegocio {
  return {
    async settings() { return { slotMinutes: [0, 30], paso: 30, timezone: 'Europe/Madrid', telefonoNegocio: null }; },
    async entero(clave: string) { return clave === 'dias_a_mostrar' ? 3 : clave === 'horas_modificacion' ? 2 : 0; },
    async valor(clave: string) { return clave === 'idioma_por_defecto' ? 'es' : ''; },
    async booleano() { return false; },
    async continuidadModo() { return 'obligatoria'; },
  } as unknown as ConfigNegocio;
}

function catalogoFalso(): CatalogoRepo {
  const porServicio = new Map<number, number[]>([[2, [1, 3]], [1, [3]]]); // FISIO: Marta y Oscar · ACU: solo Oscar
  const pros = [MARTA, OSCAR];
  return {
    async catalogo() {
      return {
        profesionales: pros, blockerCalendarIds: [],
        servicios: [
          { id: 2, name: 'Sesión fisio', code: 'FISIO', slotsRequired: 3 },
          { id: 1, name: 'Acupuntura', code: 'ACU', slotsRequired: 2 },
        ],
        porServicio,
      };
    },
    async servicio(id: number) { return (await this.catalogo()).servicios.find((s: { id: number }) => s.id === id) ?? null; },
    async profesional(id: number) { return pros.find((p) => p.id === id) ?? null; },
    async profesionalesDeServicio(id: number) { return pros.filter((p) => (porServicio.get(id) ?? []).includes(p.id)); },
    async ofreceServicio(proId: number, servicioId: number) { return (porServicio.get(servicioId) ?? []).includes(proId); },
    async reglasCentro() { return [{ startTime: '09:00', endTime: '20:00', lunchStart: null, lunchEnd: null, days: [1, 2, 3, 4, 5] }]; },
    async reglasProfesional() { return []; },
    async excepcionesProfesional() { return []; },
    async siguienteProfesional(candidatos: number[]) { return candidatos[0]!; },
  } as unknown as CatalogoRepo;
}

const calendarioVacio: CalendarioPort = {
  async listarEventos() { return []; },
  async crearEvento() { throw new Error('no debería escribir'); },
  async moverEvento() { throw new Error('no debería escribir'); },
  async borrarEvento() { throw new Error('no debería escribir'); },
};

function depsFalsas(): DepsEjecutor {
  return {
    pool: {} as never,
    config: configFalsa(),
    catalogo: catalogoFalso(),
    calendario: calendarioVacio,
    pacientes: {} as never,
    citas: { async futurasDePacientes() { return []; } } as never,
    confirmaciones: {} as never,
    embeddings: null,
    avisarNegocio: async () => {},
    dryRun: true,
  };
}

function ctxRecurrenteDeMarta(modo: 'preferida' | 'obligatoria'): ToolContext {
  const paciente: ContextoPaciente = {
    telefono: '+34600000001',
    titular: { id: 10, nombre: 'Fernando', apellido: null, telefono: '+34600000001', titular: true, idiomaPreferido: 'es' },
    candidatos: [{ id: 10, nombre: 'Fernando', apellido: null, telefono: '+34600000001', titular: true, idiomaPreferido: 'es' }],
    idioma: 'es',
    recurrente: {
      pacienteId: 10, ultimoProfesionalId: 1, ultimoProfesionalNombre: 'Marta',
      ultimoServicioId: 2, ultimoServicioNombre: 'Sesión fisio', ultimaFecha: new Date('2026-08-10T09:00:00Z'),
    },
    citasFuturas: [],
  };
  return {
    telefono: '+34600000001', sesion: '+34600000001', ahora: new Date('2026-08-17T06:00:00Z'), idioma: 'es',
    continuidadModo: modo, paciente, consultoDisponibilidad: false, rechazosSinDeclaracion: 0,
  };
}

interface RespuestaDisponibilidad {
  profesionales: string[] | string;
  nota_continuidad: string | null;
  dias: Array<{ huecos: Array<{ profesionales?: string[] }> }>;
  error?: string;
}

test('obligatoria: el modelo pide a Oscar y el ejecutor fuerza a Marta (su fisio), con nota', async () => {
  const ctx = ctxRecurrenteDeMarta('obligatoria');
  const r = (await ejecutarTool(depsFalsas(), ctx, 'consultar_disponibilidad', { service_id: 2, professional_id: 3 })) as RespuestaDisponibilidad;
  assert.deepEqual(r.profesionales, ['Marta']);
  assert.match(r.nota_continuidad!, /habitual \(Marta\)/);
  for (const dia of r.dias) for (const h of dia.huecos) assert.deepEqual(h.profesionales, ['Marta']);
  assert.equal(ctx.consultoDisponibilidad, true);
});

test('obligatoria + servicio que su fisio NO hace: excepción hacia quien sí lo hace, explicada', async () => {
  const r = (await ejecutarTool(depsFalsas(), ctxRecurrenteDeMarta('obligatoria'), 'consultar_disponibilidad', { service_id: 1 })) as RespuestaDisponibilidad;
  assert.deepEqual(r.profesionales, ['Oscar']);
  assert.match(r.nota_continuidad!, /no realiza este servicio/);
});

test('preferida: sin restricción dura, el paciente puede pedir a Oscar', async () => {
  const r = (await ejecutarTool(depsFalsas(), ctxRecurrenteDeMarta('preferida'), 'consultar_disponibilidad', { service_id: 2, professional_id: 3 })) as RespuestaDisponibilidad;
  assert.deepEqual(r.profesionales, ['Oscar']);
  assert.equal(r.nota_continuidad, null);
});

test('paciente nuevo en obligatoria: flujo normal con todos los del servicio', async () => {
  const ctx = ctxRecurrenteDeMarta('obligatoria');
  ctx.paciente = { ...ctx.paciente, recurrente: null };
  const r = (await ejecutarTool(depsFalsas(), ctx, 'consultar_disponibilidad', { service_id: 2 })) as RespuestaDisponibilidad;
  assert.equal(r.profesionales, 'cualquiera'); // varios candidatos sin elección → horas sin nombre
  assert.equal(r.nota_continuidad, null);
});

test('servicio desconocido: error con el catálogo, no silencio', async () => {
  const r = (await ejecutarTool(depsFalsas(), ctxRecurrenteDeMarta('obligatoria'), 'consultar_disponibilidad', { service_id: 99 })) as RespuestaDisponibilidad & { servicios: unknown[] };
  assert.equal(r.error, 'servicio_desconocido');
  assert.equal(r.servicios.length, 2);
});

test('confirmar sin propuesta viva se niega a escribir', async () => {
  const deps = depsFalsas();
  (deps.confirmaciones as { viva: () => Promise<null> }).viva = async () => null;
  const r = (await ejecutarTool(deps, ctxRecurrenteDeMarta('obligatoria'), 'confirmar_cita', {})) as { error?: string };
  assert.equal(r.error, 'sin_propuesta');
});
