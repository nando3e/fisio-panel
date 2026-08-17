import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ofreceHuecos } from '../src/agent/agent';
import { bloqueTemporal, bloquePaciente } from '../src/agent/contexto';
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
