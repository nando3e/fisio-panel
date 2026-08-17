import Anthropic from '@anthropic-ai/sdk';
import { ErrorLlm, type ClienteLlm, type DefTool, type MensajeChat, type RespuestaLlm } from './tipos';

export function crearClienteAnthropic(apiKey: string, modelo: string): ClienteLlm {
  const cliente = new Anthropic({ apiKey });

  return {
    modelo,
    async completar({ system, mensajes, tools }): Promise<RespuestaLlm> {
      const mensajesApi: Anthropic.MessageParam[] = mensajes.map((m) => {
        if (m.rol === 'usuario') return { role: 'user', content: m.contenido };
        if (m.rol === 'asistente') {
          const contenido: Anthropic.ContentBlockParam[] = [];
          if (m.contenido) contenido.push({ type: 'text', text: m.contenido });
          for (const t of m.tools ?? []) contenido.push({ type: 'tool_use', id: t.id, name: t.nombre, input: t.args });
          return { role: 'assistant', content: contenido.length ? contenido : [{ type: 'text', text: '…' }] };
        }
        return {
          role: 'user',
          content: m.resultados.map((r): Anthropic.ToolResultBlockParam => ({
            type: 'tool_result', tool_use_id: r.id, content: r.contenido,
          })),
        };
      });

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
