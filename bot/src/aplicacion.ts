/**
 * Raíz de composición: aquí se cablea todo. El agente devuelve texto; ESTA capa entrega.
 */

import type { Pool } from 'pg';
import { cargarEnv, type Env } from './config/env';
import { crearPool } from './db/pool';
import { migrar } from './db/migrate';
import { sembrar } from './db/seed';
import { ConfigNegocio } from './config/negocio';
import { CatalogoRepo } from './db/repos/catalogo';
import { PacientesRepo } from './db/repos/pacientes';
import { CitasRepo } from './db/repos/citas';
import { ChatMemoryRepo, ConfirmacionesRepo } from './db/repos/conversacion';
import { PromptsRepo, TextosRepo } from './db/repos/prompts';
import { TracesRepo } from './db/repos/traces';
import { crearCalendarioGoogle, type CalendarioPort } from './calendar/google';
import { crearClienteChatwoot, interpretarWebhook, type ClienteChatwoot } from './gateway/chatwoot';
import { crearClienteEvolution, type ClienteEvolution } from './gateway/evolution';
import { Agrupador } from './gateway/grouping';
import { decidir } from './gateway/decidir';
import { crearClienteLlm } from './llm/factory';
import type { ClienteLlm } from './llm/tipos';
import { responder, type DepsAgente } from './agent/agent';
import type { ToolContext } from './agent/ejecutor';
import { resolverContextoPaciente } from './patient/turno';
import { crearProveedorEmbeddings, type ProveedorEmbeddings } from './rag/rag';
import { transcribir, promptSesgoDesdeCatalogo } from './stt/transcribe';
import { Scheduler } from './reminders/scheduler';
import { rondaRecordatorios, rondaConfirmacionesPendientes } from './reminders/reminders';
import { sincronizarCalendario } from './reminders/sincronizar';

/** Calendario nulo para desarrollo sin service account: lee vacío, no escribe. */
function calendarioNulo(): CalendarioPort {
  return {
    async listarEventos() { return []; },
    async crearEvento() { throw new Error('Google Calendar no configurado (GOOGLE_SERVICE_ACCOUNT)'); },
    async moverEvento() { throw new Error('Google Calendar no configurado'); },
    async borrarEvento() { throw new Error('Google Calendar no configurado'); },
  };
}

/**
 * Sustituciones para pruebas: permiten ejercitar el turno completo contra la BD real
 * sin tocar Google ni el LLM (mismo patrón de inyección que balta/nubimed).
 */
export interface Overrides {
  calendario?: CalendarioPort;
  llm?: ClienteLlm;
}

export class Aplicacion {
  readonly env: Env;
  readonly pool: Pool;
  readonly config: ConfigNegocio;
  readonly catalogo: CatalogoRepo;
  readonly pacientes: PacientesRepo;
  readonly citas: CitasRepo;
  readonly memoria: ChatMemoryRepo;
  readonly confirmaciones: ConfirmacionesRepo;
  readonly prompts: PromptsRepo;
  readonly textos: TextosRepo;
  readonly traces: TracesRepo;
  readonly calendario: CalendarioPort;
  readonly chatwoot: ClienteChatwoot | null;
  readonly evolution: ClienteEvolution | null;
  readonly embeddings: ProveedorEmbeddings | null;
  private readonly agrupador: Agrupador;
  private readonly scheduler = new Scheduler();
  /** Última conversación de Chatwoot vista por teléfono (para responder en el hilo). */
  private conversaciones = new Map<string, number>();

  constructor(env?: Env, private overrides: Overrides = {}) {
    this.env = env ?? cargarEnv();
    this.pool = crearPool(this.env.databaseUrl);
    this.config = new ConfigNegocio(this.pool);
    this.catalogo = new CatalogoRepo(this.pool);
    this.pacientes = new PacientesRepo(this.pool);
    this.citas = new CitasRepo(this.pool);
    this.memoria = new ChatMemoryRepo(this.pool);
    this.confirmaciones = new ConfirmacionesRepo(this.pool);
    this.prompts = new PromptsRepo(this.pool);
    this.textos = new TextosRepo(this.pool);
    this.traces = new TracesRepo(this.pool);
    this.calendario = overrides.calendario
      ?? (this.env.googleServiceAccountJson ? crearCalendarioGoogle(this.env.googleServiceAccountJson) : calendarioNulo());
    this.chatwoot = this.env.chatwootUrl && this.env.chatwootToken
      ? crearClienteChatwoot(this.env.chatwootUrl, this.env.chatwootAccountId, this.env.chatwootToken)
      : null;
    this.evolution = this.env.evolutionUrl && this.env.evolutionToken
      ? crearClienteEvolution(this.env.evolutionUrl, this.env.evolutionInstance, this.env.evolutionToken)
      : null;
    this.embeddings = this.env.embeddingsApiKey
      ? crearProveedorEmbeddings(this.env.embeddingsApiUrl, this.env.embeddingsApiKey, this.env.embeddingsModel)
      : null;
    this.agrupador = new Agrupador(async (telefono, mensaje) => { await this.turno(telefono, mensaje); });
  }

  async inicializar(): Promise<void> {
    const migraciones = await migrar(this.pool);
    if (migraciones.length) console.log(`[app] migraciones aplicadas: ${migraciones.join(', ')}`);
    const semilla = await sembrar(this.pool);
    if (semilla.prompts.length) console.log(`[app] prompts sembrados: ${semilla.prompts.join(', ')}`);

    this.scheduler.registrar('recordatorios', 5 * 60_000, true, () => rondaRecordatorios(this.depsRecordatorios()));
    this.scheduler.registrar('confirmaciones-pendientes', 60_000, true, () => rondaConfirmacionesPendientes(this.depsRecordatorios()));
    this.scheduler.registrar('sincronizar-calendario', 15 * 60_000, true, async () => {
      const ahora = new Date();
      await sincronizarCalendario(this, new Date(ahora.getTime() - 24 * 3_600_000), new Date(ahora.getTime() + 60 * 24 * 3_600_000));
    });
    this.scheduler.registrar('poda', 6 * 3_600_000, false, async () => {
      const trazas = await this.traces.podar(90);
      const memoria = await this.memoria.podar(30);
      if (trazas || memoria) console.log(`[poda] trazas: ${trazas}, memoria: ${memoria}`);
    });
    this.scheduler.arrancar();
    console.log(`[app] lista. DRY_RUN=${this.env.dryRun} LLM=${this.env.llmProvider}/${this.env.llmModel}`);
  }

  private depsRecordatorios() {
    return {
      config: this.config, catalogo: this.catalogo, citas: this.citas, pacientes: this.pacientes,
      textos: this.textos, memoria: this.memoria, confirmaciones: this.confirmaciones,
      entregar: (telefono: string, texto: string) => this.entregar(telefono, texto),
      sincronizarVentana: (desde: Date, hasta: Date) => sincronizarCalendario(this, desde, hasta),
    };
  }

  /** Entrega: Chatwoot primero (queda en el hilo del cliente); Evolution como fallback. */
  async entregar(telefono: string, texto: string): Promise<void> {
    if (this.chatwoot) {
      try {
        const conversacion = this.conversaciones.get(telefono) ?? await this.chatwoot.buscarConversacion(telefono);
        if (conversacion) {
          this.conversaciones.set(telefono, conversacion);
          await this.chatwoot.enviarTexto(conversacion, texto);
          return;
        }
      } catch (err) {
        console.error(`[entrega] Chatwoot falló para ${telefono}, probando Evolution:`, err);
      }
    }
    if (this.evolution) { await this.evolution.enviarTexto(telefono, texto); return; }
    console.log(`[entrega][sin canal] ${telefono}: ${texto}`);
  }

  async avisarNegocio(texto: string): Promise<void> {
    const telefono = await this.config.valor('telefono_avisos');
    if (!telefono) { console.log(`[aviso-negocio][sin telefono_avisos] ${texto}`); return; }
    if (this.evolution) await this.evolution.enviarTexto(telefono.startsWith('+') ? telefono : `+34${telefono}`, texto);
    else console.log(`[aviso-negocio][sin evolution] ${texto}`);
  }

  /** Punto de entrada del webhook. Responde rápido; el trabajo va en background. */
  async recibir(body: Record<string, unknown>): Promise<void> {
    const mensaje = interpretarWebhook(body);
    if (mensaje.conversationId && mensaje.telefono) this.conversaciones.set(mensaje.telefono, mensaje.conversationId);

    const decision = decidir({
      mensaje,
      botActivoGlobal: await this.config.botActivo(),
      telefonoSoporte: await this.config.valor('telefono_soporte'),
    });

    if (decision.accion === 'ignorar') return;
    const telefono = mensaje.telefono!;

    if (decision.accion === 'comando') {
      if (decision.comando !== 'consultabot') await this.config.ponerBotActivo(decision.comando === 'activabot');
      const activo = await this.config.botActivo();
      await this.entregar(telefono, `Bot ${activo ? 'ACTIVADO ✅' : 'DESACTIVADO ⛔'}`);
      return;
    }

    // El historial se llena SIEMPRE, responda o no.
    let contenido = mensaje.contenido;
    if (decision.accion === 'solo_registrar') {
      if (contenido) await this.memoria.registrar(telefono, decision.rol, contenido);
      return;
    }

    // El cliente ha escrito: silencia el aviso de confirmación pendiente (sin borrar la propuesta).
    await this.confirmaciones.silenciar(telefono).catch(() => {});

    // Nota de voz: transcribir o cortesía.
    if (mensaje.esNotaDeVoz && !contenido) {
      const sttActivado = await this.config.booleano('stt_activado');
      if (sttActivado && this.env.sttUrl && mensaje.urlAdjunto) {
        try {
          const cat = await this.catalogo.catalogo();
          contenido = await transcribir(
            { url: this.env.sttUrl, apiKey: this.env.sttApiKey, modelo: this.env.sttModel },
            mensaje.urlAdjunto,
            promptSesgoDesdeCatalogo(cat.servicios.map((s) => s.name), cat.profesionales.map((p) => p.name)),
          );
        } catch (err) {
          console.error('[stt] transcripción falló:', err);
        }
      }
      if (!contenido) {
        const titular = await this.pacientes.titular(telefono);
        const idioma = titular?.idiomaPreferido ?? (await this.config.valor('idioma_por_defecto'));
        const cortesia = (await this.textos.texto('nota_voz_no_soportada', idioma)) ?? '¿Me lo escribes en un mensaje?';
        await this.memoria.registrar(telefono, 'human', '[nota de voz]');
        await this.entregar(telefono, cortesia);
        await this.memoria.registrar(telefono, 'ai', cortesia);
        return;
      }
    }
    if (!contenido) return;

    await this.memoria.registrar(telefono, 'human', contenido);
    const ventana = await this.config.entero('segundos_agrupacion');
    this.agrupador.agrupar(telefono, contenido, ventana * 1000);
  }

  /** Un turno completo: contexto → agente → traza → entrega. */
  private async turno(telefono: string, mensaje: string, opciones?: { simulado?: boolean; sesion?: string }): Promise<string> {
    const inicioMs = Date.now();
    const ahora = new Date();
    const sesion = opciones?.sesion ?? telefono;
    if (this.evolution && !opciones?.simulado) void this.evolution.escribiendo(telefono, 3);

    const paciente = await resolverContextoPaciente(
      { pacientes: this.pacientes, citas: this.citas, memoria: this.memoria, config: this.config, catalogo: this.catalogo },
      telefono, ahora, sesion,
    );
    const ctx: ToolContext = {
      telefono,     // identidad del paciente: siempre el número real
      sesion,       // clave de conversación: `sim:<tel>` en el simulador
      ahora,
      idioma: paciente.idioma,
      continuidadModo: await this.config.continuidadModo().catch(() => 'preferida' as const),
      paciente,
      consultoDisponibilidad: false,
      rechazosSinDeclaracion: 0,
      simulado: opciones?.simulado,
    };

    const depsAgente: DepsAgente = {
      llm: this.overrides.llm ?? crearClienteLlm(this.env),
      prompts: this.prompts,
      memoria: this.memoria,
      ejecutor: {
        pool: this.pool, config: this.config, catalogo: this.catalogo, calendario: this.calendario,
        pacientes: this.pacientes, citas: this.citas, confirmaciones: this.confirmaciones,
        embeddings: this.embeddings,
        avisarNegocio: (texto) => opciones?.simulado ? Promise.resolve() : this.avisarNegocio(texto),
        dryRun: this.env.dryRun,
      },
    };

    const resultado = await responder(depsAgente, ctx, mensaje);

    // La traza se escribe SIEMPRE, antes de la entrega: si el envío peta, la prueba queda.
    await this.traces.escribir({
      telefono: sesion, mensaje, respuesta: resultado.texto,
      tools: resultado.tools, toolsDetalle: resultado.toolsDetalle,
      modelo: depsAgente.llm.modelo, promptVersions: resultado.promptVersions,
      tokensIn: resultado.tokensIn, tokensOut: resultado.tokensOut,
      duracionMs: Date.now() - inicioMs, error: resultado.error,
    }).catch((err) => console.error('[traza] escritura falló:', err));

    await this.memoria.registrar(sesion, 'ai', resultado.texto).catch(() => {});
    if (!opciones?.simulado) await this.entregar(telefono, resultado.texto);
    return resultado.texto;
  }

  /** Simulador: misma función del agente, escrituras interceptadas, sin envíos. */
  async simular(telefono: string, mensaje: string): Promise<string> {
    const sesion = `sim:${telefono}`;
    await this.memoria.registrar(sesion, 'human', mensaje);
    return this.turno(telefono, mensaje, { simulado: true, sesion });
  }

  async cerrar(): Promise<void> {
    this.scheduler.parar();
    await this.pool.end();
  }
}
