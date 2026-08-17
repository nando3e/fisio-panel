import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esRelleno } from '../src/patient/nombres';
import { mismoNombreDePila, claveNombre } from '../src/db/repos/pacientes';

test('nombres de relleno rechazados', () => {
  for (const malo of ['Client WhatsApp', '(pendent)', 'cliente', '-', '.', '[nombre]', 'x']) {
    assert.equal(esRelleno(malo), true, malo);
  }
});

test('nombres reales pasan (la lista es deliberadamente corta)', () => {
  for (const bueno of ['Marc', 'Laura', 'Marc Prova', 'Núria', 'José Luis']) {
    assert.equal(esRelleno(bueno), false, bueno);
  }
});

test('salvaguarda de nombre: solo el nombre de pila, sin tildes ni mayúsculas', () => {
  assert.equal(mismoNombreDePila('jose luis', 'José Luis García'), true);
  assert.equal(mismoNombreDePila('Núria', 'nuria'), true);
  assert.equal(mismoNombreDePila('Laura', 'Fernando'), false);
});

test('conservadora: si falta un dato, coincide (no bloquear por falta de dato)', () => {
  assert.equal(mismoNombreDePila(null, 'Fernando'), true);
  assert.equal(mismoNombreDePila('Laura', null), true);
});

test('claveNombre toma el primer token normalizado', () => {
  assert.equal(claveNombre('José Luis'), 'jose');
});
