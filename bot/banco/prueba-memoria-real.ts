import { cargarEnvLocal } from '../src/config/cargarEnvLocal';
cargarEnvLocal();

/**
 * Prueba puntual con LLM REAL (gasta tokens, poca cosa): valida que el simulador
 * mantiene la memoria entre turnos tras el fix de sesión. No toca Google (simulado)
 * ni Chatwoot. Limpia su rastro (chat_memory y trazas de la sesión sim).
 *
 *   npx tsx banco/prueba-memoria-real.ts
 */

import { Aplicacion } from '../src/aplicacion';
import { cargarEnv } from '../src/config/env';

const TELEFONO = '+34699000222';

async function main() {
  const app = new Aplicacion(cargarEnv());
  let fallos = 0;
  const ok = (cond: boolean, nombre: string) => {
    console.log(`${cond ? '✓' : '✗'} ${nombre}`);
    if (!cond) fallos++;
  };

  try {
    const t1 = await app.simular(TELEFONO, 'hola! nunca he venido, me duele el cuello. ¿Tenéis hueco mañana por la mañana? Me da igual el fisio');
    console.log('\n[T1]', t1, '\n');

    const t2 = await app.simular(TELEFONO, 'la primera hora que me has dicho me va bien');
    console.log('[T2]', t2, '\n');
    // El fallo original: el turno 2 arrancaba de cero y volvía a preguntar el servicio.
    ok(!/qué (tipo de )?(sesión|servicio|cita) (necesitas|quieres)/i.test(t2), 'T2 NO vuelve a preguntar el servicio (recuerda el turno 1)');

    const t3 = await app.simular(TELEFONO, 'sí, esa. Me llamo Andreu Vila');
    console.log('[T3]', t3, '\n');
    ok(/andreu/i.test(t3) || /reserv|confirm|anotad|apuntad/i.test(t3), 'T3 avanza hacia la confirmación con el nombre dado');
  } finally {
    await app.pool.query('DELETE FROM chat_memory WHERE session_id = $1', [`sim:${TELEFONO}`]);
    await app.pool.query('DELETE FROM agent_traces WHERE telefono = $1', [`sim:${TELEFONO}`]);
    await app.cerrar();
  }

  if (fallos) { console.error(`\n${fallos} aserciones fallidas`); process.exit(1); }
  console.log('\nMEMORIA OK');
}

void main();
