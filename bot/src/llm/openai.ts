import { ErrorLlm, type ClienteLlm, type MensajeChat, type RespuestaLlm } from './tipos';

interface MensajeApi {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export function crearClienteOpenAi(apiKey: string, modelo: string, baseUrl = 'https://api.openai.com/v1'): ClienteLlm {
  return {
    modelo,
    async completar({ system, mensajes, tools }): Promise<RespuestaLlm> {
      const mensajesApi: MensajeApi[] = [];
      for (const m of mensajes) {
        if (m.rol === 'usuario') mensajesApi.push({ role: 'user', content: m.contenido });
        else if (m.rol === 'asistente') {
          mensajesApi.push({
            role: 'assistant',
            content: m.contenido || null,
            tool_calls: m.tools?.length
              ? m.tools.map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.nombre, arguments: JSON.stringify(t.args) } }))
              : undefined,
          });
        } else {
          for (const r of m.resultados) mensajesApi.push({ role: 'tool', content: r.contenido, tool_call_id: r.id });
        }
      }

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: modelo,
            temperature: 0.3,
            messages: [{ role: 'system', content: system }, ...mensajesApi],
            tools: tools.map((t) => ({ type: 'function', function: { name: t.nombre, description: t.descripcion, parameters: t.parametros } })),
          }),
        });
      } catch (err) {
        throw new ErrorLlm(`OpenAI: fallo de red`, err);
      }
      if (!res.ok) throw new ErrorLlm(`OpenAI: HTTP ${res.status}`);
      const datos = (await res.json()) as {
        choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const msg = datos.choices[0]?.message;
      const llamadas: RespuestaLlm['tools'] = [];
      for (const tc of msg?.tool_calls ?? []) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* args ilegibles → objeto vacío */ }
        llamadas.push({ id: tc.id, nombre: tc.function.name, args });
      }
      return {
        texto: (msg?.content ?? '').trim(),
        tools: llamadas,
        tokensIn: datos.usage?.prompt_tokens ?? 0,
        tokensOut: datos.usage?.completion_tokens ?? 0,
      };
    },
  };
}
