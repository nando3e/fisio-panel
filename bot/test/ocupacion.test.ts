import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventoAIntervalo, ocupacionDesdeEventos } from '../src/booking/ocupacion';
import { instanteLocal } from '../src/booking/tiempo';

const TZ = 'Europe/Madrid';

test('evento cancelado se ignora', () => {
  assert.equal(eventoAIntervalo({ id: 'x', status: 'cancelled', start: { dateTime: '2026-08-17T10:00:00+02:00' } }, TZ), null);
});

test('evento de día completo bloquea la jornada (end.date de Google es EXCLUSIVO)', () => {
  const intervalo = eventoAIntervalo({ id: 'x', start: { date: '2026-08-17' }, end: { date: '2026-08-18' } }, TZ)!;
  assert.equal(intervalo.inicio, instanteLocal('2026-08-17', 0, TZ).getTime());
  assert.equal(intervalo.fin, instanteLocal('2026-08-18', 0, TZ).getTime());
});

test('evento sin fin o con fin <= inicio asume 15 minutos', () => {
  const sinFin = eventoAIntervalo({ id: 'x', start: { dateTime: '2026-08-17T10:00:00+02:00' } }, TZ)!;
  assert.equal(sinFin.fin - sinFin.inicio, 15 * 60_000);
  const invertido = eventoAIntervalo({ id: 'x', start: { dateTime: '2026-08-17T10:00:00+02:00' }, end: { dateTime: '2026-08-17T09:00:00+02:00' } }, TZ)!;
  assert.equal(invertido.fin - invertido.inicio, 15 * 60_000);
});

test('ocupación fusiona solapes de eventos', () => {
  const ocupacion = ocupacionDesdeEventos([
    { id: 'a', start: { dateTime: '2026-08-17T10:00:00+02:00' }, end: { dateTime: '2026-08-17T11:00:00+02:00' } },
    { id: 'b', start: { dateTime: '2026-08-17T10:30:00+02:00' }, end: { dateTime: '2026-08-17T12:00:00+02:00' } },
  ], TZ);
  assert.equal(ocupacion.length, 1);
  assert.equal(ocupacion[0]!.fin - ocupacion[0]!.inicio, 2 * 60 * 60_000);
});
