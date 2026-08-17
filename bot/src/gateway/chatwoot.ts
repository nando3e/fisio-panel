import { aE164 } from './telefono';

/** Marca de los mensajes salientes propios, para reconocer el eco. */
export const ORIGEN_BOT = 'fisio_bot';

export interface MensajeEntrante {
  tipo: 'entrante' | 'saliente_humano' | 'eco_propio' | 'irrelevante';
  telefono: string | null;
  contenido: string | null;
  esNotaDeVoz: boolean;
  urlAdjunto: string | null;
  conversationId: number | null;
  botDesactivadoContacto: boolean;
}

/**
 * Interpreta el webhook de Chatwoot. El cliente está en conversation.meta.sender,
 * NO en sender: en mensajes salientes, sender es el agente humano (lección de balta).
 */
export function interpretarWebhook(body: Record<string, unknown>): MensajeEntrante {
  const irrelevante: MensajeEntrante = {
    tipo: 'irrelevante', telefono: null, contenido: null, esNotaDeVoz: false,
    urlAdjunto: null, conversationId: null, botDesactivadoContacto: false,
  };
  if (body.event !== 'message_created') return irrelevante;

  const conversation = (body.conversation ?? {}) as Record<string, unknown>;
  const meta = (conversation.meta ?? {}) as Record<string, unknown>;
  const sender = (meta.sender ?? {}) as Record<string, unknown>;
  const telefono = aE164((sender.phone_number as string) ?? null);
  const conversationId = typeof conversation.id === 'number' ? conversation.id : null;
  const atributos = (sender.custom_attributes ?? {}) as Record<string, unknown>;
  const botAttr = atributos.bot;
  const botDesactivadoContacto = botAttr === false || botAttr === 'false';

  if (body.source_id === ORIGEN_BOT) {
    return { ...irrelevante, tipo: 'eco_propio', telefono, conversationId, botDesactivadoContacto };
  }

  const adjuntos = (body.attachments ?? []) as Array<Record<string, unknown>>;
  const nota = adjuntos.find((a) => a.file_type === 'audio');
  const contenido = typeof body.content === 'string' ? body.content.trim() : null;
  const messageType = body.message_type; // 0/'incoming' | 1/'outgoing'
  const esEntrante = messageType === 0 || messageType === 'incoming';
  const esSaliente = messageType === 1 || messageType === 'outgoing';

  if (esSaliente) {
    return {
      tipo: 'saliente_humano', telefono, contenido, esNotaDeVoz: false,
      urlAdjunto: null, conversationId, botDesactivadoContacto,
    };
  }
  if (!esEntrante || !telefono) return { ...irrelevante, telefono, conversationId };
  return {
    tipo: 'entrante', telefono, contenido,
    esNotaDeVoz: Boolean(nota),
    urlAdjunto: (nota?.data_url as string) ?? null,
    conversationId, botDesactivadoContacto,
  };
}

export interface ClienteChatwoot {
  enviarTexto(conversationId: number, texto: string): Promise<void>;
  buscarConversacion(telefono: string): Promise<number | null>;
}

export function crearClienteChatwoot(baseUrl: string, accountId: string, token: string): ClienteChatwoot {
  const api = baseUrl.replace(/\/$/, '');
  const cabeceras = { 'Content-Type': 'application/json', api_access_token: token };

  async function pedir(ruta: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${api}/api/v1/accounts/${accountId}${ruta}`, { headers: cabeceras, ...init });
    if (!res.ok) throw new Error(`Chatwoot HTTP ${res.status} en ${ruta.split('?')[0]}`);
    return res;
  }

  return {
    async enviarTexto(conversationId, texto) {
      await pedir(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: texto, message_type: 'outgoing', source_id: ORIGEN_BOT }),
      });
    },

    async buscarConversacion(telefono) {
      const res = await pedir(`/contacts/search?q=${encodeURIComponent(telefono)}`);
      const datos = (await res.json()) as { payload?: Array<{ id: number; phone_number?: string }> };
      const contacto = datos.payload?.find((c) => c.phone_number === telefono) ?? datos.payload?.[0];
      if (!contacto) return null;
      const conv = await pedir(`/contacts/${contacto.id}/conversations`);
      const convs = (await conv.json()) as { payload?: Array<{ id: number }> };
      return convs.payload?.[0]?.id ?? null;
    },
  };
}
