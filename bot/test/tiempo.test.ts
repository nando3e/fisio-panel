import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instanteLocal, fechaLocal, horaLocal, diaSemanaDe, sumarDias, aMinutos, fechaLegible } from '../src/booking/tiempo';

const TZ = 'Europe/Madrid';

test('instanteLocal respeta el offset de verano e invierno', () => {
  assert.equal(instanteLocal('2026-08-17', 10 * 60, TZ).toISOString(), '2026-08-17T08:00:00.000Z'); // CEST +2
  assert.equal(instanteLocal('2026-01-19', 10 * 60, TZ).toISOString(), '2026-01-19T09:00:00.000Z'); // CET +1
});

test('fechaLocal no desplaza el día al este de Greenwich (bug clásico de toISOString)', () => {
  // 23:30 hora local de Madrid en verano = 21:30Z del mismo día; medianoche pasada en UTC del siguiente.
  const instante = new Date('2026-08-17T22:30:00Z'); // 00:30 del 18 en Madrid
  assert.equal(fechaLocal(instante, TZ), '2026-08-18');
  assert.equal(instante.toISOString().slice(0, 10), '2026-08-17'); // el error que se evita
});

test('horaLocal y día de la semana', () => {
  assert.equal(horaLocal(new Date('2026-08-17T08:00:00Z'), TZ), '10:00');
  assert.equal(diaSemanaDe('2026-08-17'), 1); // lunes
  assert.equal(diaSemanaDe('2026-08-23'), 7); // domingo
});

test('sumarDias cruza meses y años', () => {
  assert.equal(sumarDias('2026-08-30', 3), '2026-09-02');
  assert.equal(sumarDias('2026-12-30', 3), '2027-01-02');
  assert.equal(sumarDias('2026-08-17', -1), '2026-08-16');
});

test('aMinutos acepta HH:MM y HH:MM:SS', () => {
  assert.equal(aMinutos('13:30'), 810);
  assert.equal(aMinutos('09:00:00'), 540);
});

test('fechaLegible en los dos idiomas', () => {
  assert.equal(fechaLegible('2026-08-17', 'es'), 'lunes 17 de agosto');
  assert.equal(fechaLegible('2026-08-17', 'ca'), 'dilluns 17 de agosto');
});
