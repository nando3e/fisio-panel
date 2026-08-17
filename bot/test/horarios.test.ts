import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ventanasEfectivas, ventanasDeReglas } from '../src/booking/horarios';
import type { ReglaHoraria } from '../src/db/repos/catalogo';

const centro: ReglaHoraria[] = [
  { startTime: '09:00', endTime: '20:00', lunchStart: '13:30', lunchEnd: '15:00', days: [1, 2, 3, 4, 5] },
  { startTime: '09:00', endTime: '12:00', lunchStart: null, lunchEnd: null, days: [6] },
];

test('reglas del centro: pausa de comida parte la ventana', () => {
  const lunes = ventanasDeReglas(centro, 1);
  assert.deepEqual(lunes, [{ desde: 540, hasta: 810 }, { desde: 900, hasta: 1200 }]);
});

test('sin reglas propias el profesional hereda el centro', () => {
  const v = ventanasEfectivas({ fecha: '2026-08-17', reglasCentro: centro, reglasProfesional: [], excepcionesProfesional: [] });
  assert.deepEqual(v, ventanasDeReglas(centro, 1)); // 2026-08-17 es lunes
});

test('con reglas propias se interseca con el centro (el centro es el techo)', () => {
  const propias: ReglaHoraria[] = [{ startTime: '08:00', endTime: '14:00', lunchStart: null, lunchEnd: null, days: [1] }];
  const v = ventanasEfectivas({ fecha: '2026-08-17', reglasCentro: centro, reglasProfesional: propias, excepcionesProfesional: [] });
  assert.deepEqual(v, [{ desde: 540, hasta: 810 }]); // 09:00-13:30: el centro corta el 08:00 y la pausa corta a las 13:30
});

test('el fisio con reglas propias que no incluyen el día no trabaja ese día', () => {
  const propias: ReglaHoraria[] = [{ startTime: '09:00', endTime: '14:00', lunchStart: null, lunchEnd: null, days: [2, 4] }];
  const v = ventanasEfectivas({ fecha: '2026-08-17', reglasCentro: centro, reglasProfesional: propias, excepcionesProfesional: [] });
  assert.deepEqual(v, []);
});

test('excepción cerrado anula el día (y un rango cubre varios días)', () => {
  const v = ventanasEfectivas({
    fecha: '2026-08-18', reglasCentro: centro, reglasProfesional: [],
    excepcionesProfesional: [{ fecha: '2026-08-17', hasta: '2026-08-21', tipo: 'cerrado', ventanas: null }],
  });
  assert.deepEqual(v, []);
});

test('excepción horario sustituye las reglas del fisio y respeta el techo del centro', () => {
  const v = ventanasEfectivas({
    fecha: '2026-08-17', reglasCentro: centro, reglasProfesional: [],
    excepcionesProfesional: [{ fecha: '2026-08-17', hasta: null, tipo: 'horario', ventanas: [{ desde: '08:00', hasta: '11:00' }] }],
  });
  assert.deepEqual(v, [{ desde: 540, hasta: 660 }]); // el centro abre a las 09:00
});

test('cerrado manda sobre horario si coinciden el mismo día', () => {
  const v = ventanasEfectivas({
    fecha: '2026-08-17', reglasCentro: centro, reglasProfesional: [],
    excepcionesProfesional: [
      { fecha: '2026-08-17', hasta: null, tipo: 'horario', ventanas: [{ desde: '09:00', hasta: '11:00' }] },
      { fecha: '2026-08-17', hasta: null, tipo: 'cerrado', ventanas: null },
    ],
  });
  assert.deepEqual(v, []);
});

test('centro cerrado el domingo: sin ventanas para nadie', () => {
  const v = ventanasEfectivas({ fecha: '2026-08-23', reglasCentro: centro, reglasProfesional: [], excepcionesProfesional: [] });
  assert.deepEqual(v, []);
});

test('línea corrupta (inicio >= fin) se descarta sin tumbar el resto', () => {
  const conCorrupta: ReglaHoraria[] = [...centro, { startTime: '22:00', endTime: '10:00', lunchStart: null, lunchEnd: null, days: [1] }];
  assert.deepEqual(ventanasDeReglas(conCorrupta, 1), ventanasDeReglas(centro, 1));
});
