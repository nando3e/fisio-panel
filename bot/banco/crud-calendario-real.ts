import { cargarEnvLocal } from '../src/config/cargarEnvLocal';
cargarEnvLocal();

/**
 * CRUD REAL contra Google Calendar: crea un evento de prueba en el calendario
 * de Marta FUERA de horario (21:00, el centro cierra a las 20:00, no roba
 * huecos), lo verifica, lo mueve, y lo borra. Deja el calendario como estaba.
 *
 *   npx tsx banco/crud-calendario-real.ts
 */

import { crearCalendarioGoogle } from '../src/calendar/google';
import { cargarEnv } from '../src/config/env';

const CAL_MARTA = 'be54a6f89d91fb88deec05023ba13843efbad056bf752b728d5b732da85a92f3@group.calendar.google.com';

async function main() {
  const env = cargarEnv();
  if (!env.googleServiceAccountJson) throw new Error('Sin GOOGLE_SERVICE_ACCOUNT');
  const cal = crearCalendarioGoogle(env.googleServiceAccountJson);

  let fallos = 0;
  const ok = (cond: boolean, nombre: string) => { console.log(`${cond ? '✓' : '✗'} ${nombre}`); if (!cond) fallos++; };

  // Mañana a las 21:00 hora local (19:00Z en agosto, CEST)
  const inicio = new Date('2026-08-19T19:00:00Z');
  const fin = new Date('2026-08-19T19:30:00Z');
  const ventana = { desde: new Date('2026-08-19T18:00:00Z'), hasta: new Date('2026-08-19T21:00:00Z') };

  console.log('1. CREAR evento de prueba (21:00-21:30 local, fuera de horario)…');
  const id = await cal.crearEvento(CAL_MARTA, {
    titulo: 'PRUEBA BOT - borrar si me ves',
    descripcion: 'Evento de verificación del CRUD del bot. Se borra solo.',
    inicio, fin,
  });
  ok(!!id, `evento creado (id ${id.slice(0, 12)}…)`);

  try {
    let eventos = await cal.listarEventos(CAL_MARTA, ventana.desde, ventana.hasta);
    const creado = eventos.find((e) => e.id === id);
    ok(!!creado, 'el evento aparece al listar');
    ok(creado?.start?.dateTime?.startsWith('2026-08-19T21:00') || Date.parse(creado?.start?.dateTime ?? '') === inicio.getTime(), 'con el inicio correcto');

    console.log('2. MOVER a las 21:30…');
    const inicio2 = new Date('2026-08-19T19:30:00Z');
    const fin2 = new Date('2026-08-19T20:00:00Z');
    await cal.moverEvento(CAL_MARTA, id, inicio2, fin2);
    eventos = await cal.listarEventos(CAL_MARTA, ventana.desde, ventana.hasta);
    const movido = eventos.find((e) => e.id === id);
    ok(Date.parse(movido?.start?.dateTime ?? '') === inicio2.getTime(), 'el evento quedó movido a las 21:30');
  } finally {
    console.log('3. BORRAR…');
    await cal.borrarEvento(CAL_MARTA, id);
    const eventos = await cal.listarEventos(CAL_MARTA, ventana.desde, ventana.hasta);
    ok(!eventos.some((e) => e.id === id && e.status !== 'cancelled'), 'el evento ya no está (calendario limpio)');
    console.log('4. BORRAR de nuevo (idempotencia)…');
    await cal.borrarEvento(CAL_MARTA, id);
    ok(true, 'borrar dos veces no lanza error (404/410 tolerados)');
  }

  if (fallos) { console.error(`\n${fallos} fallos`); process.exit(1); }
  console.log('\nCRUD REAL OK');
}

void main();
