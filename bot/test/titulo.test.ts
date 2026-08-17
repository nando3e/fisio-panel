import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componerTitulo, parsearTituloLibre } from '../src/calendar/titulo';

test('título del bot: nombre - teléfono nacional - código (el motivo NUNCA va aquí)', () => {
  assert.equal(componerTitulo('Laura', 'Vidal', '+34612345678', 'FISIO'), 'Laura Vidal - 612345678 - FISIO');
  assert.equal(componerTitulo('Joan', null, '+34699887766', 'ACU'), 'Joan - 699887766 - ACU');
});

test('parseo tolerante de títulos escritos a mano', () => {
  assert.deepEqual(parsearTituloLibre('Joan 666555444'), { nombre: 'Joan', telefono: '+34666555444' });
  assert.deepEqual(parsearTituloLibre('Pere tel. 666 55 54 44'), { nombre: 'Pere', telefono: '+34666555444' });
  assert.deepEqual(parsearTituloLibre('Marta +34 612 345 678'), { nombre: 'Marta', telefono: '+34612345678' });
});

test('sin teléfono en el título: nombre sí, teléfono null (el evento sigue ocupando)', () => {
  const r = parsearTituloLibre('Reunión equipo');
  assert.equal(r.telefono, null);
  assert.equal(r.nombre, 'Reunión equipo');
});
