import Anthropic from '@anthropic-ai/sdk';
import { ErrorLlm, type ClienteLlm, type DefTool, type MensajeChat, type RespuestaLlm } from './tipos';

export function crearClienteAnthropic(apiKey: string, modelo: string): ClienteLlm {
  const cliente = new Anthropic({ apiKey });

  return {
    modelo,
    async completar({ system, mensajes, tools }): Promise<RespuestaLlm> {
      // Mensajes de usuario consecutivos (ráfagas del historial) se fusionan en uno:
      // la API exige roles alternados.
      const mensajesApi: Anthropic.MessageParam[] = [];
      const anexar = (role: 'user' | 'assistant', bloques: Anthropic.ContentBlockParam[]) => {
        const ultimo = mensajesApi[mensajesApi.length - 1];
        if (ultimo && ultimo.role === role && Array.isArray(ultimo.content)) {
          (ultimo.content as Anthropic.ContentBlockParam[]).push(...bloques);
        } else {
          mensajesApi.push({ role, content: bloques });
        }
      };
      for (const m of mensajes) {
        if (m.rol === 'usuario') {
          anexar('user', [{ type: 'text', text: m.contenido }]);
        } else if (m.rol === 'asistente') {
          const contenido: Anthropic.ContentBlockParam[] = [];
          if (m.contenido) contenido.push({ type: 'text', text: m.contenido });
          for (const t of m.tools ?? []) contenido.push({ type: 'tool_use', id: t.id, name: t.nombre, input: t.args });
          anexar('assistant', contenido.length ? contenido : [{ type: 'text', text: '…' }]);
        } else {
          anexar('user', m.resultados.map((r): Anthropic.ToolResultBlockParam => ({
            type: 'tool_result', tool_use_id: r.id, content: r.contenido,
          })));
        }
      }

      try {
        const res = await cliente.messages.create({
          model: modelo,
          max_tokens: 1500,
          system,
          messages: mensajesApi,
          tools: tools.map((t): Anthropic.Tool => ({
            name: t.nombre, description: t.descripcion,
            input_schema: t.parametros as Anthropic.Tool.InputSchema,
          })),
        });
        let texto = '';
        const llamadas: RespuestaLlm['tools'] = [];
        for (const bloque of res.content) {
          if (bloque.type === 'text') texto += bloque.text;
          else if (bloque.type === 'tool_use') {
            llamadas.push({ id: bloque.id, nombre: bloque.name, args: bloque.input as Record<string, unknown> });
          }
        }
        return { texto: texto.trim(), tools: llamadas, tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens };
      } catch (err) {
        throw new ErrorLlm(`Anthropic: ${err instanceof Error ? err.message : String(err)}`, err);
      }
    },
  };
}
