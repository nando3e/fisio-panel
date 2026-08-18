import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ofreceHuecos, responder, type DepsAgente } from '../src/agent/agent';
import { bloqueTemporal, bloquePaciente } from '../src/agent/contexto';
import type { ToolContext } from '../src/agent/ejecutor';
import type { MensajeChat } from '../src/llm/tipos';
import type { ContextoPaciente } from '../src/patient/turno';
import type { ReglaHoraria } from '../src/db/repos/catalogo';

test('ofreceHuecos: tres líneas que son solo una hora disparan el guardarraíl', () => {
  assert.equal(ofreceHuecos('Tengo estos huecos:\n- 09:00\n- 09:30\n- 10:00\n¿Cuál te va bien?'), true);
  assert.equal(ofreceHuecos('Abrimos de 9:00 a 20:00 y los sábados de 9:00 a 12:00'), false);
  assert.equal(ofreceHuecos('Te va bien a las 10:30?'), false);
});

const centro: ReglaHoraria[] = [
  { startTime: '09:00', endTime: '20:00', lunchStart: null, lunchEnd: null, days: [1, 2, 3, 4, 5] },
];

test('tabla temporal: días cerrados MARCADOS (no omitidos) y ámbito declarado', () => {
  const bloque = bloqueTemporal({
    ahora: new Date('2026-08-17T08:00:00Z'), tz: 'Europe/Madrid', diasCalendario: 8, reglasCentro: centro, idioma: 'es',
  });
  assert.match(bloque, /lunes 2026-08-17 \[HOY\]/);
  assert.match(bloque, /martes 2026-08-18 \[mañana\]/);
  assert.match(bloque, /sábado 2026-08-22 — CERRADO/);
  assert.match(bloque, /domingo 2026-08-23 — CERRADO/);
  assert.match(bloque, /SOLO estos 8 días/); // ninguna afirmación absoluta sin su ámbito
});

test('tabla temporal con cierres del panel: días marcados y el RANGO completo con su mensaje', () => {
  const bloque = bloqueTemporal({
    ahora: new Date('2026-08-17T08:00:00Z'), tz: 'Europe/Madrid', diasCalendario: 8, reglasCentro: centro, idioma: 'es',
    cierres: [{ desde: '2026-08-19', hasta: '2026-08-21', motivo: 'Vacaciones', mensaje: 'Cerrados por vacaciones hasta el 21' }],
  });
  assert.match(bloque, /miércoles 2026-08-19 — CERRADO \(Vacaciones\)/);
  assert.match(bloque, /viernes 2026-08-21 — CERRADO \(Vacaciones\)/);
  // El rango entero, para "¿cuándo hacéis vacaciones?" sin reconstruir fechas.
  assert.match(bloque, /del 2026-08-19 al 2026-08-21 \(ambos incluidos\)/);
  assert.match(bloque, /«Cerrados por vacaciones hasta el 21»/);
  // El lunes siguiente NO está dentro del cierre.
  assert.match(bloque, /lunes 2026-08-24\n/);
});

function pacienteBase(): ContextoPaciente {
  return {
    telefono: '+34612345678',
    titular: { id: 1, nombre: 'Fernando', apellido: null, telefono: '+34612345678', titular: true, idiomaPreferido: 'es' },
    candidatos: [{ id: 1, nombre: 'Fernando', apellido: null, telefono: '+34612345678', titular: true, idiomaPreferido: 'es' }],
    idioma: 'es',
    recurrente: {
      pacienteId: 1, ultimoProfesionalId: 1, ultimoProfesionalNombre: 'Marta',
      ultimoServicioId: 2, ultimoServicioNombre: 'Sesión fisio', ultimaFecha: new Date(Date.now() - 6 * 86_400_000),
    },
    citasFuturas: [],
  };
}

test('bloque de paciente: reconocido, última visita calculada y sugerencia de repetición', () => {
  const bloque = bloquePaciente(pacienteBase(), 'preferida');
  assert.match(bloque, /Es Fernando/);
  assert.match(bloque, /Sesión fisio con Marta, hace 6 días/);
  assert.match(bloque, /repetir Sesión fisio con Marta/);
  assert.match(bloque, /PREFERIDA/);
});

test('bloque de paciente en obligatoria lleva la instrucción dura', () => {
  assert.match(bloquePaciente(pacienteBase(), 'obligatoria'), /OBLIGATORIA/);
});

test('número desconocido: pedir nombre solo tras elegir hora', () => {
  const nuevo: ContextoPaciente = { ...pacienteBase(), titular: null, candidatos: [], recurrente: null };
  const bloque = bloquePaciente(nuevo, 'preferida');
  assert.match(bloque, /NO registrado/);
  assert.match(bloque, /SOLO cuando ya haya elegido hora/);
});

// ── Memoria del turno: por SESIÓN y sin duplicar el mensaje en curso ─────────

function depsResponder(historial: { rol: string; contenido: string; fecha: Date }[], capturas: { clave?: string; mensajes?: MensajeChat[] }): DepsAgente {
  return {
    llm: {
      modelo: 'guionizado',
      completar: async ({ mensajes }: { mensajes: MensajeChat[] }) => {
        capturas.mensajes = mensajes;
        return { texto: 'vale', tools: [], tokensIn: 0, tokensOut: 0 };
      },
    },
    prompts: { systemPrompt: async () => ({ texto: 'SYSTEM', versiones: { identidad: 1 } }) },
    memoria: { historial: async (clave: string) => { capturas.clave = clave; return historial; } },
    ejecutor: {
      config: {
        settings: async () => ({ slotMinutes: [0, 30], paso: 30, timezone: 'Europe/Madrid', telefonoNegocio: null }),
        valor: async () => '',
        entero: async () => 8,
      },
      catalogo: {
        catalogo: async () => ({ servicios: [], profesionales: [], porServicio: new Map(), blockerCalendarIds: [] }),
        reglasCentro: async () => centro,
        cierresDesde: async () => [],
      },
    },
  } as unknown as DepsAgente;
}

function ctxResponder(): ToolContext {
  return {
    telefono: '+34612345678', sesion: 'sim:+34612345678', ahora: new Date('2026-08-18T08:00:00Z'),
    idioma: 'es', continuidadModo: 'preferida', paciente: pacienteBase(),
    consultoDisponibilidad: false, rechazosSinDeclaracion: 0, simulado: true,
  } as ToolContext;
}

test('responder carga el historial por SESIÓN (regresión: el simulador leía por teléfono)', async () => {
  const capturas: { clave?: string; mensajes?: MensajeChat[] } = {};
  const historial = [
    { rol: 'human', contenido: 'hola', fecha: new Date() },
    { rol: 'ai', contenido: '¡Hola! ¿Qué necesitas?', fecha: new Date() },
    { rol: 'human', contenido: 'quiero cita', fecha: new Date() },
  ];
  await responder(depsResponder(historial, capturas), ctxResponder(), 'quiero cita');
  assert.equal(capturas.clave, 'sim:+34612345678');
  // El mensaje en curso ya viene en el historial: NO se añade otra vez.
  assert.equal(capturas.mensajes!.length, 3);
  const ultimo = capturas.mensajes![capturas.mensajes!.length - 1]!;
  assert.equal(ultimo.rol, 'usuario');
  assert.equal((ultimo as { contenido: string }).contenido, 'quiero cita');
  // Y el turno anterior es visible para el modelo.
  assert.ok(capturas.mensajes!.some((m) => m.rol === 'asistente' && (m as { contenido?: string }).contenido?.includes('¿Qué necesitas?')));
});

test('responder añade el mensaje solo si el historial no termina en él (red de seguridad)', async () => {
  const capturas: { clave?: string; mensajes?: MensajeChat[] } = {};
  await responder(depsResponder([], capturas), ctxResponder(), 'quiero cita');
  assert.equal(capturas.mensajes!.length, 1);
  assert.equal((capturas.mensajes![0] as { contenido: string }).contenido, 'quiero cita');
});
