import { test } from 'node:test';
import assert from 'node:assert/strict';
import { momentoDeEnvio, type ConfigRecordatorio } from '../src/reminders/reminders';
import { instanteLocal } from '../src/booking/tiempo';

const cfg: ConfigRecordatorio = {
  mananaHora: '19:00', tardeHora: '09:30', limiteFranjaTarde: '15:00', tz: 'Europe/Madrid',
};

test('cita de MAÑANA → recordatorio el día ANTERIOR a la hora configurada', () => {
  const cita = instanteLocal('2026-08-18', 9 * 60 + 30, cfg.tz); // martes 09:30
  assert.equal(momentoDeEnvio(cita, cfg).getTime(), instanteLocal('2026-08-17', 19 * 60, cfg.tz).getTime());
});

test('cita de TARDE → recordatorio el MISMO día por la mañana', () => {
  const cita = instanteLocal('2026-08-18', 17 * 60, cfg.tz); // martes 17:00
  assert.equal(momentoDeEnvio(cita, cfg).getTime(), instanteLocal('2026-08-18', 9 * 60 + 30, cfg.tz).getTime());
});

test('el límite de franja es configurable y es inclusivo hacia la tarde', () => {
  const justoEnElLimite = instanteLocal('2026-08-18', 15 * 60, cfg.tz); // 15:00 = tarde
  assert.equal(momentoDeEnvio(justoEnElLimite, cfg).getTime(), instanteLocal('2026-08-18', 9 * 60 + 30, cfg.tz).getTime());
  const cfgTemprano = { ...cfg, limiteFranjaTarde: '14:00' };
  const cita1430 = instanteLocal('2026-08-18', 14 * 60 + 30, cfg.tz);
  assert.equal(momentoDeEnvio(cita1430, cfgTemprano).getTime(), instanteLocal('2026-08-18', 9 * 60 + 30, cfg.tz).getTime());
});
