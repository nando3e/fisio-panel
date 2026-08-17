import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarIdioma } from '../src/patient/idioma';

test('catalán claro', () => {
  assert.equal(detectarIdioma(['bon dia, voldria hora per demà amb la Marta']), 'ca');
});

test('castellano claro', () => {
  assert.equal(detectarIdioma(['hola, quiero cita para mañana por la tarde si puede ser']), 'es');
});

test('mensaje ambiguo NO cambia nada', () => {
  assert.equal(detectarIdioma(['ok']), null);
  assert.equal(detectarIdioma(['sí']), null);
  assert.equal(detectarIdioma(['👍']), null);
  assert.equal(detectarIdioma(['']), null);
});

test('varios mensajes suman señal', () => {
  assert.equal(detectarIdioma(['puc venir dijous?', 'gràcies!']), 'ca');
});
