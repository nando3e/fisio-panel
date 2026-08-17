/**
 * Bucle del agente: un solo agente con TODAS las tools, sin router de intenciones.
 * El agente devuelve texto; el gateway entrega. Aquí viven los guardarraíles de
 * respuesta (huecos sin consultar, reintento con listado) y la traza del turno.
 */

import type { ClienteLlm, LlamadaTool, MensajeChat } from '../llm/tipos';
import type { PromptsRepo } from '../db/repos/prompts';
import type { ChatMemoryRepo } from '../db/repos/conversacion';
import type { DetalleTool } from '../db/repos/traces';
import { TOOLS } from './tools';
import { ejecutarTool, type DepsEjecutor, type ToolContext } from './ejecutor';
import { bloqueCatalogo, bloqueNegocio, bloquePaciente, bloqueTemporal } from './contexto';
import type { ContextoPaciente } from '../patient/turno';

const MAX_ITERACIONES = 8;

const AVISO_HUECOS =
  '[AVISO DEL SISTEMA] Tu respuesta contiene una lista de horas pero en este turno NO has consultado la disponibilidad. Consulta consultar_disponibilidad y responde solo con horas reales.';

export interface ResultadoTurno {
  texto: string;
  tools: string[];
  toolsDetalle: DetalleTool[];
  tokensIn: number;
  tokensOut: number;
  promptVersions: Record<string, number>;
  error: string | null;
}

export interface DepsAgente {
  llm: ClienteLlm;
  prompts: PromptsRepo;
  memoria: ChatMemoryRepo;
  ejecutor: DepsEjecutor;
}

/** ¿La respuesta ofrece una lista de horas? (≥3 líneas que son solo una hora) */
export function ofreceHuecos(texto: string): boolean {
  const lineas = texto.split('\n');
  let horas = 0;
  for (const linea of lineas) {
    if (/^\W{0,4}([01]?\d|2[0-3]):[0-5]\d\W{0,4}$/.test(linea.trim())) horas++;
  }
  return horas >= 3;
}

async function componerSystem(deps: DepsAgente, ctx: ToolContext): Promise<{ system: string; versiones: Record<string, number> }> {
  const { texto: versionados, versiones } = await deps.prompts.systemPrompt();
  const settings = await deps.ejecutor.config.settings();
  const catalogo = await deps.ejecutor.catalogo.catalogo();
  const reglasCentro = await deps.ejecutor.catalogo.reglasCentro();
  const [nombre, direccion, diasCalendario] = await Promise.all([
    deps.ejecutor.config.valor('nombre_negocio'),
    deps.ejecutor.config.valor('direccion_negocio'),
    deps.ejecutor.config.entero('dias_calendario'),
  ]);
  // Orden de más estable a más volátil (cacheo de prefijo).
  const system = [
    versionados,
    bloqueCatalogo(catalogo, settings.paso),
    bloqueNegocio({ nombre, direccion, telefono: settings.telefonoNegocio, reglasCentro }),
    bloquePaciente(ctx.paciente, ctx.continuidadModo),
    bloqueTemporal({ ahora: ctx.ahora, tz: settings.timezone, diasCalendario, reglasCentro, idioma: ctx.idioma }),
  ].join('\n\n---\n\n');
  return { system, versiones };
}

function historialAMensajes(historial: Awaited<ReturnType<ChatMemoryRepo['historial']>>): MensajeChat[] {
  const mensajes: MensajeChat[] = [];
  for (const m of historial) {
    if (m.rol === 'human') mensajes.push({ rol: 'usuario', contenido: m.contenido });
    else if (m.rol === 'humano_negocio') mensajes.push({ rol: 'asistente', contenido: `[respuesta escrita por el personal] ${m.contenido}` });
    else mensajes.push({ rol: 'asistente', contenido: m.contenido });
  }
  return mensajes;
}

/** Una tool que lanza excepción NO tumba el turno: el error vuelve al modelo con instrucciones. */
async function ejecutarConSeguridad(deps: DepsAgente, ctx: ToolContext, llamada: LlamadaTool): Promise<string> {
  try {
    let resultado = await ejecutarTool(deps.ejecutor, ctx, llamada.nombre, llamada.args);
    // Reintento con listado: el paciente ya dijo qué quiere; el modelo se equivocó de cita.
    if (resultado && typeof resultado === 'object' && (resultado as Record<string, unknown>).reintentar_con_listado) {
      const listado = await ejecutarTool(deps.ejecutor, ctx, 'listar_mis_citas', {});
      resultado = {
        no_reconocida: true,
        citas_del_paciente: listado,
        aviso: 'Estas son las citas REALES del paciente. Identifica la correcta con estos datos y repite la operación. NO le vuelvas a preguntar lo que ya ha contestado.',
      };
    }
    return JSON.stringify(resultado);
  } catch (err) {
    console.error(`[agente] tool ${llamada.nombre} falló:`, err);
    return JSON.stringify({
      error: 'La operación ha fallado por un problema técnico.',
      detalle: 'Informa al paciente con una disculpa breve y ofrécele llamar a la clínica. NO inventes horas ni des ninguna cita por hecha.',
    });
  }
}

export async function responder(deps: DepsAgente, ctx: ToolContext, mensaje: string): Promise<ResultadoTurno> {
  const inicioMs = Date.now();
  const toolsUsadas: string[] = [];
  const toolsDetalle: DetalleTool[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let versiones: Record<string, number> = {};

  try {
    const { system, versiones: v } = await componerSystem(deps, ctx);
    versiones = v;
    const historial = historialAMensajes(await deps.memoria.historial(ctx.telefono));
    const mensajes: MensajeChat[] = [...historial, { rol: 'usuario', contenido: mensaje }];

    let avisoHuecosEnviado = false;
    for (let iteracion = 1; iteracion <= MAX_ITERACIONES; iteracion++) {
      const respuesta = await deps.llm.completar({ system, mensajes, tools: TOOLS });
      tokensIn += respuesta.tokensIn;
      tokensOut += respuesta.tokensOut;

      if (!respuesta.tools.length) {
        // Guardarraíl: lista de horas sin haber consultado la agenda en este turno.
        if (!ctx.consultoDisponibilidad && !avisoHuecosEnviado && ofreceHuecos(respuesta.texto)) {
          avisoHuecosEnviado = true;
          mensajes.push({ rol: 'asistente', contenido: respuesta.texto });
          mensajes.push({ rol: 'usuario', contenido: AVISO_HUECOS });
          continue;
        }
        return {
          texto: respuesta.texto || '...', tools: toolsUsadas, toolsDetalle,
          tokensIn, tokensOut, promptVersions: versiones,
          error: null,
        };
      }

      mensajes.push({ rol: 'asistente', contenido: respuesta.texto, tools: respuesta.tools });
      const resultados = [];
      for (const llamada of respuesta.tools) {
        toolsUsadas.push(llamada.nombre);
        const contenido = await ejecutarConSeguridad(deps, ctx, llamada);
        toolsDetalle.push({ nombre: llamada.nombre, args: llamada.args, resultado: contenido.slice(0, 400) });
        resultados.push({ id: llamada.id, contenido });
      }
      mensajes.push({ rol: 'tools', resultados });
    }

    // Tope de iteraciones agotado: cerrar con cortesía, sin dejar al modelo en bucle.
    return {
      texto: ctx.idioma === 'ca'
        ? 'Perdona, no me’n surto amb això per aquí. Truca’ns i t’ho arreglem de seguida 🙂'
        : 'Perdona, no consigo resolverlo por aquí. Llámanos y te lo arreglamos enseguida 🙂',
      tools: toolsUsadas, toolsDetalle, tokensIn, tokensOut, promptVersions: versiones,
      error: 'max_iteraciones',
    };
  } catch (err) {
    const mensajeError = err instanceof Error ? err.message : String(err);
    console.error('[agente] turno falló:', mensajeError);
    return {
      texto: ctx.idioma === 'ca'
        ? 'Ara mateix tinc un problema tècnic 🙏 Torna-ho a provar en una estona o truca’ns.'
        : 'Ahora mismo tengo un problema técnico 🙏 Vuelve a intentarlo en un rato o llámanos.',
      tools: toolsUsadas, toolsDetalle, tokensIn, tokensOut, promptVersions: versiones,
      error: mensajeError,
    };
  } finally {
    void inicioMs;
  }
}
