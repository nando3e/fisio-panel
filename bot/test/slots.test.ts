import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duracionServicio, huecosDelDia, intersecarVentanas, fusionarIntervalos } from '../src/booking/slots';
import { instanteLocal, horaLocal } from '../src/booking/tiempo';

const TZ = 'Europe/Madrid';
const ayer = new Date('2026-08-16T10:00:00Z');

test('duración = slots_required × paso (rejilla del panel)', () => {
  assert.equal(duracionServicio(3, 30), 90);  // FISIO con preset "cada 30"
  assert.equal(duracionServicio(2, 30), 60);  // ACU
  assert.equal(duracionServicio(3, 15), 45);  // FISIO si el panel pasa a "cada 15"
  assert.equal(duracionServicio(1, 10), 10);
});

test('rejilla 00,30: solo inicios en punto y y-media dentro de la ventana', () => {
  const huecos = huecosDelDia({
    fecha: '2026-08-17', ventanas: [{ desde: 9 * 60, hasta: 12 * 60 }],
    slotMinutes: [0, 30], duracionMin: 60, ocupacion: [], ahora: ayer, tz: TZ,
  });
  assert.deepEqual(huecos.map((h) => horaLocal(h, TZ)), ['09:00', '09:30', '10:00', '10:30', '11:00']);
});

test('la cadena debe caber en la MISMA ventana (no atraviesa la pausa de comida)', () => {
  const huecos = huecosDelDia({
    fecha: '2026-08-17', ventanas: [{ desde: 9 * 60, hasta: 13.5 * 60 }, { desde: 15 * 60, hasta: 20 * 60 }],
    slotMinutes: [0, 30], duracionMin: 90, ocupacion: [], ahora: ayer, tz: TZ,
  });
  const horas = huecos.map((h) => horaLocal(h, TZ));
  assert.ok(horas.includes('12:00'));       // 12:00–13:30 cabe
  assert.ok(!horas.includes('12:30'));      // 12:30–14:00 atraviesa la pausa
  assert.ok(horas.includes('18:30'));       // último de la tarde con fin 20:00
  assert.ok(!horas.includes('19:00'));
});

test('la ocupación pisa el hueco aunque el solape sea parcial', () => {
  const ocupado = {
    inicio: instanteLocal('2026-08-17', 10 * 60 + 15, TZ).getTime(),
    fin: instanteLocal('2026-08-17', 10 * 60 + 45, TZ).getTime(),
  };
  const huecos = huecosDelDia({
    fecha: '2026-08-17', ventanas: [{ desde: 9 * 60, hasta: 12 * 60 }],
    slotMinutes: [0, 30], duracionMin: 30, ocupacion: [ocupado], ahora: ayer, tz: TZ,
  });
  const horas = huecos.map((h) => horaLocal(h, TZ));
  assert.ok(!horas.includes('10:00'));
  assert.ok(!horas.includes('10:30'));
  assert.ok(horas.includes('11:00'));
});

test('hoy no se ofrecen inicios pasados', () => {
  const ahora = instanteLocal('2026-08-17', 10 * 60 + 5, TZ);
  const huecos = huecosDelDia({
    fecha: '2026-08-17', ventanas: [{ desde: 9 * 60, hasta: 12 * 60 }],
    slotMinutes: [0, 30], duracionMin: 30, ocupacion: [], ahora, tz: TZ,
  });
  assert.deepEqual(huecos.map((h) => horaLocal(h, TZ)), ['10:30', '11:00', '11:30']);
});

test('intersección de ventanas (centro como techo del profesional)', () => {
  const efectivas = intersecarVentanas(
    [{ desde: 9 * 60, hasta: 20 * 60 }],
    [{ desde: 8 * 60, hasta: 14 * 60 }],
  );
  assert.deepEqual(efectivas, [{ desde: 9 * 60, hasta: 14 * 60 }]);
});

test('fusión de intervalos solapados', () => {
  const fusion = fusionarIntervalos([
    { inicio: 100, fin: 200 }, { inicio: 150, fin: 300 }, { inicio: 400, fin: 500 },
  ]);
  assert.deepEqual(fusion, [{ inicio: 100, fin: 300 }, { inicio: 400, fin: 500 }]);
});
