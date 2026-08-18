/**
 * FLUJO REAL de punta a punta: LLM real + BD real + Google Calendar REAL
 * (DRY_RUN=false forzado). La ENTREGA de mensajes está anulada por código:
 * nada sale hacia Chatwoot/Evolution — las respuestas y avisos se capturan.
 * Número inventado con prefijo internacional inexistente (+990).
 *
 * Ciclo: reservar → verificar en Google → MODIFICAR (mismo evento, movido,
 * no borrado+creado) → aviso de hueco → ANULAR → evento borrado → aviso.
 * Limpia todo su rastro en `finally` (BD y calendario).
 *
 *   npx tsx banco/flujo-real.ts
 */

process.env.DRY_RUN = 'false';

import { cargarEnvLocal } from '../src/config/cargarEnvLocal';
cargarEnvLocal();

import { Aplicacion } from '../src/aplicacion';
import { cargarEnv } from '../src/config/env';

const TEL = '+990000000101';
const PAUSA_MS = 15_000; // para poder VER los movimientos en el calendario

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hhmm = () => new Date().toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid' });

async function main() {
  const app = new Aplicacion(cargarEnv());

  // ── Cinturones: NADA sale hacia fuera ──────────────────────────────────────
  const alPaciente: string[] = [];
  const alNegocio: string[] = [];
  (app as unknown as { entregar: unknown }).entregar = async (tel: string, texto: string) => { alPaciente.push(texto); };
  (app as unknown as { avisarNegocio: unknown }).avisarNegocio = async (texto: string) => { alNegocio.push(texto); };

  let fallos = 0;
  const ok = (cond: boolean, nombre: string) => { console.log(`${cond ? '✓' : '✗'} ${nombre}`); if (!cond) fallos++; };

  const turno = async (mensaje: string) => {
    await app.memoria.registrar(TEL, 'human', mensaje);
    const respuesta = await (app as unknown as { turno: (t: string, m: string) => Promise<string> }).turno(TEL, mensaje);
    console.log(`\n[${hhmm()}] > ${mensaje}`);
    console.log(`[${hhmm()}] < ${respuesta.replace(/\n/g, '\n    ')}`);
    return respuesta;
  };

  const citaViva = async () => {
    const r = await app.pool.query(
      `SELECT c.*, p.name AS fisio, p.calendar_id FROM citas c JOIN professionals p ON p.id = c.professional_id
       WHERE c.telefono = $1 AND c.estado = 'confirmada' ORDER BY c.id DESC LIMIT 1`, [TEL]);
    return r.rows[0] ?? null;
  };

  const eventoEnGoogle = async (calendarId: string, eventId: string) => {
    const desde = new Date(Date.now() - 24 * 3_600_000);
    const hasta = new Date(Date.now() + 72 * 3_600_000);
    const eventos = await app.calendario.listarEventos(calendarId, desde, hasta);
    return eventos.find((e) => e.id === eventId && e.status !== 'cancelled') ?? null;
  };

  // Aviso de huecos también para mañana durante la prueba (default 0 = solo hoy)
  await app.pool.query(`INSERT INTO bot_config (clave, valor) VALUES ('horas_aviso_hueco', '48')
    ON CONFLICT (clave) DO UPDATE SET valor = '48'`);

  let calId: string | null = null;
  let eventId: string | null = null;

  try {
    console.log(`\n═══ 1. RESERVAR (real) ═══`);
    await turno('hola! quiero una sesión de fisio mañana por la mañana, la primera hora que tengáis, me da igual el fisio. Me llamo Prueba Uno');
    await turno('sí, confírmamela');
    let cita = await citaViva();
    // Elección delegada ("la primera que tengáis"): el modelo puede pedir un sí más sobre el resumen.
    if (!cita) { await turno('sí'); cita = await citaViva(); }
    ok(!!cita, 'la cita existe en la BD como confirmada');
    ok(!!cita?.google_event_id, `con google_event_id (${cita?.google_event_id?.slice(0, 12)}…)`);
    calId = cita?.calendar_id ?? null;
    eventId = cita?.google_event_id ?? null;
    const evento1 = calId && eventId ? await eventoEnGoogle(calId, eventId) : null;
    ok(!!evento1, `el evento está en el calendario REAL de ${cita?.fisio}`);
    ok(Date.parse(evento1?.start?.dateTime ?? '') === new Date(cita.start_time).getTime(), 'con el mismo inicio que la BD');
    ok(!/(cuello|hombro|espalda|dolor)/i.test(evento1?.summary ?? ''), 'el título NO contiene el motivo (dato de salud)');
    console.log(`   → evento: "${evento1?.summary}" ${evento1?.start?.dateTime} (id ${eventId?.slice(0, 12)}…)`);

    console.log(`\n[pausa ${PAUSA_MS / 1000}s — míralo en el calendario de ${cita?.fisio}]`);
    await espera(PAUSA_MS);

    console.log(`\n═══ 2. MODIFICAR (debe MOVER el mismo evento, no borrar y crear) ═══`);
    await turno('¿me la puedes mover una hora más tarde, si hay hueco?');
    let citaMod = await citaViva();
    // Si el modelo dejó la modificación propuesta pero sin ejecutar, empújala:
    if (citaMod && new Date(citaMod.start_time).getTime() === new Date(cita.start_time).getTime()) {
      await turno('sí, a esa hora, cámbiala');
      citaMod = await citaViva();
    }
    ok(!!citaMod, 'la cita sigue confirmada tras modificar');
    ok(citaMod?.google_event_id === eventId, 'MISMO google_event_id: movida, no recreada');
    ok(new Date(citaMod?.start_time).getTime() > new Date(cita.start_time).getTime(), 'el inicio en BD es más tarde que el original');
    const evento2 = calId && eventId ? await eventoEnGoogle(calId, eventId) : null;
    ok(Date.parse(evento2?.start?.dateTime ?? '') === new Date(citaMod?.start_time).getTime(), 'Google refleja la nueva hora en el MISMO evento');
    const soloUno = (await app.calendario.listarEventos(calId!, new Date(Date.now() - 24 * 3_600_000), new Date(Date.now() + 72 * 3_600_000)))
      .filter((e) => e.status !== 'cancelled' && (e.summary ?? '').includes('Prueba Uno'));
    ok(soloUno.length === 1, `hay UN solo evento de la prueba en el calendario (hay ${soloUno.length})`);
    ok(alNegocio.length >= 1, `saltó el aviso de hueco liberado por la modificación: "${alNegocio[0] ?? ''}"`);
    console.log(`   → evento movido a ${evento2?.start?.dateTime}`);

    console.log(`\n[pausa ${PAUSA_MS / 1000}s — comprueba que se ha MOVIDO, no duplicado]`);
    await espera(PAUSA_MS);

    console.log(`\n═══ 3. ANULAR (debe borrar el evento) ═══`);
    await turno('al final no podré ir, anúlamela por favor');
    const anulada = await app.pool.query(`SELECT estado FROM citas WHERE telefono = $1 ORDER BY id DESC LIMIT 1`, [TEL]);
    ok(anulada.rows[0]?.estado === 'anulada', 'la cita queda "anulada" en la BD (no se borra la fila: historial)');
    const evento3 = calId && eventId ? await eventoEnGoogle(calId, eventId) : null;
    ok(!evento3, 'el evento ya NO está en el calendario de Google');
    ok(alNegocio.length >= 2, `saltó el segundo aviso de hueco (anulación): "${alNegocio[1] ?? ''}"`);

    console.log(`\n─── Mensajes capturados (ninguno salió de verdad) ───`);
    console.log(`  al paciente (+990…): ${alPaciente.length} respuestas`);
    for (const a of alNegocio) console.log(`  al negocio: ${a}`);
  } finally {
    // Rastro fuera: BD, config y calendario como estaban.
    if (calId && eventId) await app.calendario.borrarEvento(calId, eventId).catch(() => {});
    await app.pool.query('DELETE FROM citas WHERE telefono = $1', [TEL]);
    await app.pool.query('DELETE FROM confirmaciones_pendientes WHERE telefono = $1', [TEL]); // FK a pacientes: antes que ellas
    await app.pool.query('DELETE FROM pacientes WHERE telefono = $1', [TEL]);
    await app.pool.query('DELETE FROM chat_memory WHERE session_id = $1', [TEL]);
    await app.pool.query('DELETE FROM agent_traces WHERE telefono = $1', [TEL]);
    await app.pool.query(`DELETE FROM bot_config WHERE clave = 'horas_aviso_hueco'`);
    await app.cerrar();
  }

  if (fallos) { console.error(`\n${fallos} aserciones fallidas`); process.exit(1); }
  console.log('\nFLUJO REAL OK — calendario y BD limpios');
}

void main();
