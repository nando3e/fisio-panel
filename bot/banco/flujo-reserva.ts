import { cargarEnvLocal } from '../src/config/cargarEnvLocal';
cargarEnvLocal();

/**
 * Banco de integración: turno completo contra la BD real (fisio1) con LLM guionizado
 * y calendario en memoria. Verifica QUÉ tools se usan y QUÉ se escribe, sin tocar
 * Google ni gastar tokens. Limpia sus datos en `finally`.
 *
 *   DATABASE_URL=... npx tsx banco/flujo-reserva.ts
 *
 * El banco contra el modelo REAL (con claves) es el paso siguiente: mismo esqueleto,
 * sustituyendo el LLM guionizado por el cliente real.
 */

import { Aplicacion } from '../src/aplicacion';
import type { CalendarioPort, DatosEvento, EventoCal } from '../src/calendar/google';
import type { ClienteLlm, DefTool, MensajeChat, RespuestaLlm } from '../src/llm/tipos';
import { cargarEnv } from '../src/config/env';
import { fechaLocal, instanteLocal, sumarDias } from '../src/booking/tiempo';

const TELEFONO = '+34699000111';
const TZ = 'Europe/Madrid';

/** Calendario en memoria: registra lo que se escribe y lo devuelve como ocupación. */
function calendarioMemoria() {
  const eventos = new Map<string, { calendarId: string; datos: DatosEvento }>();
  let contador = 0;
  const port: CalendarioPort = {
    async listarEventos(calendarId, desde, hasta) {
      const salida: EventoCal[] = [];
      for (const [id, e] of eventos) {
        if (e.calendarId !== calendarId) continue;
        if (e.datos.fin <= desde || e.datos.inicio >= hasta) continue;
        salida.push({
          id, summary: e.datos.titulo, description: e.datos.descripcion,
          start: { dateTime: e.datos.inicio.toISOString() }, end: { dateTime: e.datos.fin.toISOString() },
        });
      }
      return salida;
    },
    async crearEvento(calendarId, datos) {
      const id = `banco-${++contador}`;
      eventos.set(id, { calendarId, datos });
      return id;
    },
    async moverEvento(calendarId, eventId, inicio, fin) {
      const e = eventos.get(eventId);
      if (!e) throw new Error(`evento ${eventId} no existe`);
      eventos.set(eventId, { calendarId, datos: { ...e.datos, inicio, fin } });
    },
    async borrarEvento(_calendarId, eventId) { eventos.delete(eventId); },
  };
  return { port, eventos };
}

/** LLM guionizado: cada turno ejecuta la secuencia de tools indicada y luego habla. */
function llmGuionizado(guion: Array<Array<{ nombre: string; args: Record<string, unknown> }>>, textoFinal: string): ClienteLlm {
  let turno = -1;
  return {
    modelo: 'guionizado',
    async completar({ mensajes }: { system: string; mensajes: MensajeChat[]; tools: DefTool[] }): Promise<RespuestaLlm> {
      // Cuenta cuántos bloques de resultados de tools ya hay en este turno.
      const yaEjecutadas = mensajes.filter((m) => m.rol === 'tools').length;
      if (yaEjecutadas === 0) turno++;
      const pasos = guion[turno] ?? [];
      if (yaEjecutadas < pasos.length) {
        const paso = pasos[yaEjecutadas]!;
        // Los args pueden depender del resultado anterior: se resuelven por callback.
        const ultimo = [...mensajes].reverse().find((m) => m.rol === 'tools');
        const previo = ultimo && ultimo.rol === 'tools' ? ultimo.resultados[0]?.contenido : undefined;
        const args = typeof paso.args.__desde === 'function'
          ? (paso.args.__desde as (p: string | undefined) => Record<string, unknown>)(previo)
          : paso.args;
        return { texto: '', tools: [{ id: `t${yaEjecutadas}`, nombre: paso.nombre, args }], tokensIn: 0, tokensOut: 0 };
      }
      return { texto: textoFinal, tools: [], tokensIn: 0, tokensOut: 0 };
    },
  };
}

function afirmar(condicion: boolean, mensaje: string): void {
  console.log(`${condicion ? '✓' : '✗'} ${mensaje}`);
  if (!condicion) process.exitCode = 1;
}

async function main(): Promise<void> {
  const env = { ...cargarEnv(true), dryRun: false }; // el banco SÍ escribe (en su calendario de memoria)
  const cal = calendarioMemoria();

  // Guion: turno 1 consulta y propone; turno 2 confirma.
  const primerHueco = (previo: string | undefined): Record<string, unknown> => {
    const datos = JSON.parse(previo ?? '{}') as { dias?: Array<{ huecos: Array<{ iso: string }> }> };
    const iso = datos.dias?.find((d) => d.huecos.length)?.huecos[0]?.iso;
    if (!iso) throw new Error('el banco no encontró ningún hueco: revisa horarios/servicios en fisio1');
    return { service_id: SERVICIO_ID, inicio: iso, nombre: 'Banco', apellido: 'Pruebas' };
  };

  let SERVICIO_ID = 0;
  const app0 = new Aplicacion(env, { calendario: cal.port });
  const cat = await app0.catalogo.catalogo();
  const servicio = cat.servicios.find((s) => s.code === 'FISIO') ?? cat.servicios[0]!;
  SERVICIO_ID = servicio.id;
  const manana = sumarDias(fechaLocal(new Date(), TZ), 1);
  await app0.cerrar();

  const app = new Aplicacion(env, {
    calendario: cal.port,
    llm: llmGuionizado([
      [
        { nombre: 'consultar_disponibilidad', args: { service_id: SERVICIO_ID, fecha: manana } },
        { nombre: 'proponer_cita', args: { __desde: primerHueco } },
      ],
      [{ nombre: 'confirmar_cita', args: {} }],
      [{ nombre: 'listar_mis_citas', args: {} }],
      [{ nombre: 'confirmar_cita', args: {} }],
    ], 'Listo 🙂'),
  });

  try {
    await app.inicializar();
    console.log(`\n--- Banco de reserva (servicio ${servicio.name}, día ${manana}) ---`);

    const t1 = await app.simular(TELEFONO, 'hola, quiero hora para mañana');
    afirmar(t1.length > 0, 'turno 1 responde (consultar + proponer)');
    const propuesta = await app.confirmaciones.viva(`sim:${TELEFONO}`);
    afirmar(propuesta !== null, 'la propuesta queda guardada como estado comprobable');
    afirmar(propuesta?.serviceId === SERVICIO_ID, 'la propuesta lleva el servicio pedido');

    // El simulador NO debe escribir: es la garantía del panel.
    await app.simular(TELEFONO, 'sí, perfecto');
    afirmar(cal.eventos.size === 0, 'el simulador NO escribe en la agenda (escrituras interceptadas)');
    const fichasTrasSimular = await app.pool.query('SELECT telefono FROM pacientes WHERE telefono LIKE $1', [`%${TELEFONO}%`]);
    afirmar(fichasTrasSimular.rowCount === 0, `el simulador NO crea fichas de pacientes (hay ${fichasTrasSimular.rowCount})`);
    const citasTrasSimular = await app.pool.query('SELECT id FROM citas WHERE telefono LIKE $1', [`%${TELEFONO}%`]);
    afirmar(citasTrasSimular.rowCount === 0, 'el simulador NO crea citas en el espejo local');

    // Ahora el flujo real (sin simular): consultar+proponer, luego confirmar.
    const appReal = new Aplicacion(env, {
      calendario: cal.port,
      llm: llmGuionizado([
        [
          { nombre: 'consultar_disponibilidad', args: { service_id: SERVICIO_ID, fecha: manana } },
          { nombre: 'proponer_cita', args: { __desde: primerHueco } },
        ],
        [{ nombre: 'confirmar_cita', args: {} }],
        [{ nombre: 'confirmar_cita', args: {} }],
      ], 'Reservado 🙂'),
    });
    await appReal.inicializar();
    // El debounce real es de segundos_agrupacion (5 s por defecto): en el banco lo bajamos
    // a 1 s para no depender de esperas largas, y se restaura al final.
    const agrupacionOriginal = await appReal.config.valor('segundos_agrupacion');
    await appReal.config.guardar('segundos_agrupacion', '1');
    try {
      await appReal.recibir(webhook(TELEFONO, 'hola, quiero hora para mañana'));
      await esperar(2500);
      await appReal.recibir(webhook(TELEFONO, 'sí'));
      await esperar(2500);

      afirmar(cal.eventos.size === 1, `se creó UNA cita en el calendario (hay ${cal.eventos.size})`);
      const evento = [...cal.eventos.values()][0];
      afirmar(Boolean(evento && !/motivo/i.test(evento.datos.titulo)), 'el título no contiene el motivo (dato de salud)');

      const pacientes = await appReal.pacientes.porTelefono(TELEFONO);
      afirmar(pacientes.length === 1 && pacientes[0]!.titular, 'se creó la ficha del titular');
      const citas = await appReal.citas.futurasDePacientes(pacientes.map((p) => p.id), new Date());
      afirmar(citas.length === 1, `el espejo local tiene UNA cita (hay ${citas.length})`);
      afirmar(typeof citas[0]?.professionalId === 'number', 'la cita tiene profesional asignado');
      afirmar(citas[0]?.googleEventId === [...cal.eventos.keys()][0], 'el espejo apunta al evento real del calendario');

      // Idempotencia: un segundo "sí" no puede duplicar.
      await appReal.recibir(webhook(TELEFONO, 'sí'));
      await esperar(2500);
      const citasTras = await appReal.citas.futurasDePacientes(pacientes.map((p) => p.id), new Date());
      afirmar(citasTras.length === 1, `el doble "sí" no duplica (hay ${citasTras.length})`);
      afirmar(cal.eventos.size === 1, `el calendario sigue con UNA cita (hay ${cal.eventos.size})`);
    } finally {
      await appReal.config.guardar('segundos_agrupacion', agrupacionOriginal);
      await limpiar(appReal, TELEFONO);
      await appReal.cerrar();
    }
  } finally {
    await limpiar(app, TELEFONO);
    await app.cerrar();
  }
  console.log(process.exitCode ? '\nBANCO CON FALLOS' : '\nBANCO OK');
}

function webhook(telefono: string, contenido: string): Record<string, unknown> {
  return {
    event: 'message_created', message_type: 'incoming', content: contenido, id: Math.random(),
    conversation: { id: 1, meta: { sender: { phone_number: telefono, custom_attributes: {} } } },
  };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function limpiar(app: Aplicacion, telefono: string): Promise<void> {
  await app.pool.query('DELETE FROM citas WHERE telefono = $1', [telefono]);
  await app.pool.query('DELETE FROM pacientes WHERE telefono = $1', [telefono]);
  await app.pool.query('DELETE FROM chat_memory WHERE session_id LIKE $1', [`%${telefono}%`]);
  await app.pool.query('DELETE FROM confirmaciones_pendientes WHERE telefono LIKE $1', [`%${telefono}%`]);
  await app.pool.query('DELETE FROM agent_traces WHERE telefono LIKE $1', [`%${telefono}%`]);
}

void instanteLocal; // reservado para escenarios con hora fija

main().catch((e) => { console.error('BANCO FALLÓ:', e); process.exit(1); });
