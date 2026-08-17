/** Contrato propio de LLM (design.md D12). El agente no conoce al proveedor. */

export interface LlamadaTool { id: string; nombre: string; args: Record<string, unknown> }
export interface ResultadoTool { id: string; contenido: string }

export type MensajeChat =
  | { rol: 'usuario'; contenido: string }
  | { rol: 'asistente'; contenido: string; tools?: LlamadaTool[] }
  | { rol: 'tools'; resultados: ResultadoTool[] };

export interface DefTool {
  nombre: string;
  descripcion: string;
  parametros: Record<string, unknown>; // JSON Schema
}

export interface RespuestaLlm {
  texto: string;
  tools: LlamadaTool[];
  tokensIn: number;
  tokensOut: number;
}

export interface ClienteLlm {
  modelo: string;
  completar(args: { system: string; mensajes: MensajeChat[]; tools: DefTool[] }): Promise<RespuestaLlm>;
}

export class ErrorLlm extends Error {
  constructor(mensaje: string, public causa?: unknown) { super(mensaje); this.name = 'ErrorLlm'; }
}
