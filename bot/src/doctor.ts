/**
 * Diagnóstico de despliegue: comprueba pieza por pieza qué está listo y qué falta,
 * con el motivo concreto. Pensado para ejecutarse tras cada paso de la puesta en marcha.
 *
 *   npm run doctor
 *
 * No escribe nada: solo lee. Seguro de ejecutar en producción.
 */

import { cargarEnvLocal } from './config/cargarEnvLocal';
import { cargarEnv, type Env } from './config/env';

cargarEnvLocal();
import { crearPool } from './db/pool';
import { ConfigNegocio } from './config/negocio';
import { CatalogoRepo } from './db/repos/catalogo';
import { crearCalendarioGoogle } from './calendar/google';

type Estado = 'ok' | 'aviso' | 'falta';
const MARCA: Record<Estado, string> = { ok: '✓', aviso: '!', falta: '✗' };

const resultados: Array<{ estado: Estado; area: string; mensaje: string }> = [];

function anotar(estado: Estado, area: string, mensaje: string): void {
  resultados.push({ estado, area, mensaje });
  console.log(`${MARCA[estado]} [${area}] ${mensaje}`);
}

async function revisarEntorno(): Promise<Env | null> {
  try {
    const env = cargarEnv(true); // tolerante: informar de lo que falta, no morir por ello
    anotar('ok', 'entorno', `variables cargadas · LLM ${env.llmProvider}/${env.llmModel}`);
    const claveLlm = env.llmProvider === 'anthropic' ? env.anthropicApiKey : env.openaiApiKey;
    if (!claveLlm) {
      anotar('falta', 'entorno', `sin clave para ${env.llmProvider}: define ${env.llmProvider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} (el bot no arrancará)`);
    }
    if (env.dryRun) anotar('aviso', 'entorno', 'DRY_RUN=true: el bot conversa pero NO escribe citas reales (correcto hasta validar)');
    else anotar('aviso', 'entorno', 'DRY_RUN=false: las reservas SÍ se escriben en Google Calendar');
    if (env.webhookSecret === 'cambiame') anotar('falta', 'entorno', 'WEBHOOK_SECRET sigue con el valor de ejemplo: cámbialo antes de exponer el webhook');
    if (!env.adminToken || env.adminToken === 'cambiame') anotar('falta', 'entorno', 'ADMIN_TOKEN sin definir o de ejemplo: /admin quedaría abierto o inutilizable');
    return env;
  } catch (err) {
    anotar('falta', 'entorno', `${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function revisarBaseDatos(env: Env) {
  const pool = crearPool(env.databaseUrl);
  try {
    const db = await pool.query<{ db: string; usuario: string }>('SELECT current_database() AS db, current_user AS usuario');
    anotar('ok', 'base de datos', `conectado a ${db.rows[0]!.db} como ${db.rows[0]!.usuario}`);

    const migraciones = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename');
    anotar(migraciones.rowCount ? 'ok' : 'falta', 'base de datos',
      migraciones.rowCount ? `migraciones aplicadas: ${migraciones.rows.map((m) => m.filename).join(', ')}` : 'sin migraciones: ejecuta npm run migrate');

    const vector = await pool.query<{ existe: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS existe`);
    anotar(vector.rows[0]!.existe ? 'ok' : 'aviso', 'base de datos',
      vector.rows[0]!.existe ? 'extensión pgvector disponible (RAG)' : 'sin pgvector: el RAG no funcionará');

    const prompts = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM prompts WHERE activo');
    anotar(Number(prompts.rows[0]!.n) === 5 ? 'ok' : 'falta', 'base de datos',
      `prompts activos: ${prompts.rows[0]!.n}/5${Number(prompts.rows[0]!.n) === 5 ? '' : ' — ejecuta npm run seed'}`);

    const textos = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM textos');
    anotar(Number(textos.rows[0]!.n) > 0 ? 'ok' : 'falta', 'base de datos', `textos fijos: ${textos.rows[0]!.n}`);
    return pool;
  } catch (err) {
    anotar('falta', 'base de datos', `${err instanceof Error ? err.message : err}`);
    await pool.end().catch(() => {});
    return null;
  }
}

async function revisarCatalogo(pool: Awaited<ReturnType<typeof crearPool>>) {
  const config = new ConfigNegocio(pool);
  const catalogo = new CatalogoRepo(pool);
  const settings = await config.settings();
  const cat = await catalogo.catalogo();

  anotar('ok', 'configuración', `rejilla de inicios: ${settings.slotMinutes.map((m) => String(m).padStart(2, '0')).join(',')} (paso ${settings.paso} min) · zona ${settings.timezone}`);

  const reglas = await catalogo.reglasCentro();
  anotar(reglas.length ? 'ok' : 'falta', 'configuración',
    reglas.length ? `horario del centro: ${reglas.length} regla(s)` : 'sin horario del centro: no habrá ningún hueco');

  anotar(cat.profesionales.length ? 'ok' : 'falta', 'catálogo', `profesionales activos: ${cat.profesionales.map((p) => p.name).join(', ') || 'ninguno'}`);
  anotar(cat.blockerCalendarIds.length ? 'ok' : 'aviso', 'catálogo',
    cat.blockerCalendarIds.length ? 'calendario de cierres configurado' : 'sin calendario de cierres (is_blocker): los cierres del centro no bloquearán');

  for (const s of cat.servicios) {
    const pros = (cat.porServicio.get(s.id) ?? []).length;
    anotar(pros ? 'ok' : 'falta', 'catálogo',
      `servicio ${s.name}: ${s.slotsRequired * settings.paso} min · ${pros} profesional(es)${pros ? '' : ' — sin asignar, el bot no podrá ofrecerlo'}`);
  }

  // Ajustes que deciden si el bot actúa o solo ensaya.
  for (const clave of ['continuidad_modo', 'idioma_por_defecto', 'recordatorios_activos', 'stt_activado'] as const) {
    anotar('ok', 'configuración', `${clave} = ${await config.valor(clave)}`);
  }
  const avisos = await config.valor('telefono_avisos');
  anotar(avisos ? 'ok' : 'aviso', 'configuración', avisos ? `avisos de hueco a ${avisos}` : 'sin telefono_avisos: no se avisará de huecos liberados');
  const activo = await config.botActivo();
  anotar(activo ? 'ok' : 'aviso', 'configuración', `interruptor global: bot ${activo ? 'ACTIVO' : 'DESACTIVADO'}`);

  return { catalogo, settings };
}

async function revisarGoogle(env: Env, catalogo: CatalogoRepo) {
  if (!env.googleServiceAccountJson) {
    anotar('falta', 'google', 'GOOGLE_SERVICE_ACCOUNT sin definir (ruta al JSON o el JSON en una línea): sin agenda no hay disponibilidad ni reservas');
    return;
  }
  let email = '';
  try {
    email = (JSON.parse(env.googleServiceAccountJson) as { client_email: string }).client_email;
    anotar('ok', 'google', `service account: ${email}`);
  } catch {
    anotar('falta', 'google', 'las credenciales de Google no son un JSON válido');
    return;
  }

  const cal = crearCalendarioGoogle(env.googleServiceAccountJson);
  const cat = await catalogo.catalogo();
  const desde = new Date();
  const hasta = new Date(desde.getTime() + 24 * 3_600_000);
  const aRevisar = [
    ...cat.profesionales.map((p) => ({ nombre: p.name, calendarId: p.calendarId })),
    ...cat.blockerCalendarIds.map((c, i) => ({ nombre: `cierres${i ? ` ${i + 1}` : ''}`, calendarId: c })),
  ];
  for (const item of aRevisar) {
    try {
      const eventos = await cal.listarEventos(item.calendarId, desde, hasta);
      anotar('ok', 'google', `calendario de ${item.nombre}: accesible (${eventos.length} evento(s) en 24 h)`);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      const proyecto = /project (\d+)/.exec(motivo)?.[1];
      // Distinguir la causa: la acción a tomar es completamente distinta en cada caso.
      if (/has not been used in project|accessNotConfigured|API has not been used/i.test(motivo)) {
        anotar('falta', 'google',
          `la Google Calendar API NO está habilitada en el proyecto${proyecto ? ` ${proyecto}` : ''}. Actívala aquí y espera 1-2 min: https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview${proyecto ? `?project=${proyecto}` : ''}`);
        return; // el resto de calendarios dará el mismo error: no repetirlo
      }
      if (/notFound|404/i.test(motivo)) {
        anotar('falta', 'google',
          `calendario de ${item.nombre}: no encontrado. O el calendar_id de la tabla professionals es incorrecto, o no está compartido con ${email}.`);
      } else if (/forbidden|403|insufficient/i.test(motivo)) {
        anotar('falta', 'google',
          `calendario de ${item.nombre}: sin permiso. Compártelo con ${email} y dale "Hacer cambios en los eventos".`);
      } else {
        anotar('falta', 'google', `calendario de ${item.nombre}: ${motivo.slice(0, 120)}`);
      }
    }
  }
}

async function revisarChatwoot(env: Env) {
  if (!env.chatwootUrl || !env.chatwootToken) {
    anotar('falta', 'chatwoot', 'CHATWOOT_URL o CHATWOOT_TOKEN sin definir: el bot no podrá responder');
    return;
  }
  try {
    const res = await fetch(`${env.chatwootUrl.replace(/\/$/, '')}/api/v1/accounts/${env.chatwootAccountId}/inboxes`, {
      headers: { api_access_token: env.chatwootToken },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      anotar('falta', 'chatwoot', `HTTP ${res.status} al listar inboxes: revisa token, account_id y URL interna`);
      return;
    }
    const datos = (await res.json()) as { payload?: Array<{ id: number; name: string; channel_type?: string }> };
    const inboxes = datos.payload ?? [];
    anotar('ok', 'chatwoot', `accesible · ${inboxes.length} inbox(es): ${inboxes.map((i) => `${i.name} (id ${i.id})`).join(', ') || 'ninguno'}`);
    if (!inboxes.length) anotar('aviso', 'chatwoot', 'sin inboxes: crea el inbox de API conectado a Evolution');
  } catch (err) {
    anotar('falta', 'chatwoot', `no se pudo contactar: ${err instanceof Error ? err.message : err}`);
  }
}

async function revisarEvolution(env: Env) {
  if (!env.evolutionUrl || !env.evolutionToken) {
    anotar('aviso', 'evolution', 'EVOLUTION_URL o EVOLUTION_TOKEN sin definir: sin "escribiendo…" ni entrega de respaldo');
    return;
  }
  try {
    const res = await fetch(`${env.evolutionUrl.replace(/\/$/, '')}/instance/fetchInstances`, {
      headers: { apikey: env.evolutionToken },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      anotar('falta', 'evolution', `HTTP ${res.status} al listar instancias: revisa URL y AUTHENTICATION_API_KEY`);
      return;
    }
    const datos = (await res.json()) as unknown;
    const lista = Array.isArray(datos) ? datos : [];
    const nombres = lista.map((i) => {
      const inst = (i as { instance?: { instanceName?: string; state?: string }; name?: string; connectionStatus?: string });
      return { nombre: inst.instance?.instanceName ?? inst.name ?? '?', estado: inst.instance?.state ?? inst.connectionStatus ?? '?' };
    });
    anotar('ok', 'evolution', `accesible · instancias: ${nombres.map((n) => `${n.nombre} [${n.estado}]`).join(', ') || 'ninguna'}`);
    const mia = nombres.find((n) => n.nombre === env.evolutionInstance);
    if (!mia) {
      anotar('falta', 'evolution', `la instancia "${env.evolutionInstance}" no existe: créala y conecta el número por QR`);
    } else if (!/open|connected/i.test(mia.estado)) {
      anotar('falta', 'evolution', `la instancia "${env.evolutionInstance}" está en estado "${mia.estado}": escanea el QR para conectar el número`);
    } else {
      anotar('ok', 'evolution', `instancia "${env.evolutionInstance}" conectada`);
    }
  } catch (err) {
    anotar('falta', 'evolution', `no se pudo contactar: ${err instanceof Error ? err.message : err}`);
  }
}

async function revisarLlm(env: Env) {
  const claveLlm = env.llmProvider === 'anthropic' ? env.anthropicApiKey : env.openaiApiKey;
  if (!claveLlm) {
    anotar('aviso', 'llm', 'sin clave: no se puede comprobar el modelo (ya avisado arriba)');
  } else try {
    if (env.llmProvider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': env.anthropicApiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: env.llmModel, max_tokens: 4, messages: [{ role: 'user', content: 'ping' }] }),
        signal: AbortSignal.timeout(20_000),
      });
      anotar(res.ok ? 'ok' : 'falta', 'llm', res.ok ? `Anthropic responde con ${env.llmModel}` : `Anthropic HTTP ${res.status}: revisa ANTHROPIC_API_KEY y LLM_MODEL`);
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.openaiApiKey}` },
        body: JSON.stringify({ model: env.llmModel, max_tokens: 4, messages: [{ role: 'user', content: 'ping' }] }),
        signal: AbortSignal.timeout(20_000),
      });
      anotar(res.ok ? 'ok' : 'falta', 'llm', res.ok ? `OpenAI responde con ${env.llmModel}` : `OpenAI HTTP ${res.status}: revisa OPENAI_API_KEY y LLM_MODEL`);
    }
  } catch (err) {
    anotar('falta', 'llm', `sin respuesta: ${err instanceof Error ? err.message : err}`);
  }

  if (!env.embeddingsApiKey) {
    anotar('aviso', 'rag', 'EMBEDDINGS_API_KEY sin definir: los documentos no se indexarán y consultar_info no responderá');
    return;
  }
  try {
    const res = await fetch(env.embeddingsApiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.embeddingsApiKey}` },
      body: JSON.stringify({ model: env.embeddingsModel, input: 'ping' }),
      signal: AbortSignal.timeout(20_000),
    });
    anotar(res.ok ? 'ok' : 'falta', 'rag', res.ok ? `embeddings OK (${env.embeddingsModel})` : `embeddings HTTP ${res.status}`);
  } catch (err) {
    anotar('falta', 'rag', `embeddings sin respuesta: ${err instanceof Error ? err.message : err}`);
  }
}

async function main(): Promise<void> {
  console.log('=== Diagnóstico del bot de citas ===\n');
  const env = await revisarEntorno();
  if (!env) { console.log('\nSin entorno válido no se puede continuar.'); process.exit(1); }

  const pool = await revisarBaseDatos(env);
  if (pool) {
    const { catalogo } = await revisarCatalogo(pool);
    await revisarGoogle(env, catalogo);
    await pool.end();
  }
  await revisarChatwoot(env);
  await revisarEvolution(env);
  await revisarLlm(env);

  const faltan = resultados.filter((r) => r.estado === 'falta');
  const avisos = resultados.filter((r) => r.estado === 'aviso');
  console.log(`\n=== ${resultados.length - faltan.length - avisos.length} correctos · ${avisos.length} avisos · ${faltan.length} bloqueantes ===`);
  if (faltan.length) {
    console.log('\nPendiente antes de dar servicio:');
    for (const f of faltan) console.log(`  · [${f.area}] ${f.mensaje}`);
  }
  process.exit(faltan.length ? 1 : 0);
}

main().catch((e) => { console.error('El diagnóstico falló:', e); process.exit(1); });
