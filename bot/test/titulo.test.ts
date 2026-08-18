import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componerTitulo, extraerContacto, parsearTituloLibre } from '../src/calendar/titulo';

test('título del bot: nombre apellido - código (ni motivo ni teléfono en el título)', () => {
  assert.equal(componerTitulo('Laura', 'Vidal', 'FISIO'), 'Laura Vidal - FISIO');
  assert.equal(componerTitulo('Joan', null, 'ACU'), 'Joan - ACU');
});

test('extraerContacto: el teléfono se recupera de la DESCRIPCIÓN si el título no lo lleva', () => {
  assert.deepEqual(
    extraerContacto({ summary: 'Laura Vidal - FISIO', description: 'Tel: +34612345678\nReservada por el asistente' }),
    { nombre: 'Laura Vidal - FISIO', telefono: '+34612345678' },
  );
  // El título manda si lo lleva (apuntes a mano de toda la vida).
  assert.deepEqual(
    extraerContacto({ summary: 'Joan 666555444', description: 'Tel: 699887766' }),
    { nombre: 'Joan', telefono: '+34666555444' },
  );
  assert.equal(extraerContacto({ summary: 'Reunión equipo', description: null }).telefono, null);
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
