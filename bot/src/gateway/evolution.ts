export interface ClienteEvolution {
  enviarTexto(telefono: string, texto: string): Promise<void>;
  escribiendo(telefono: string, segundos: number): Promise<void>;
}

export function crearClienteEvolution(baseUrl: string, instancia: string, token: string): ClienteEvolution {
  const api = baseUrl.replace(/\/$/, '');
  const numero = (telefono: string) => telefono.replace(/^\+/, '');

  return {
    async enviarTexto(telefono, texto) {
      const res = await fetch(`${api}/message/sendText/${instancia}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: token },
        body: JSON.stringify({ number: numero(telefono), text: texto }),
      });
      if (!res.ok) throw new Error(`Evolution HTTP ${res.status}`);
    },

    async escribiendo(telefono, segundos) {
      try {
        await fetch(`${api}/chat/sendPresence/${instancia}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: token },
          body: JSON.stringify({ number: numero(telefono), presence: 'composing', delay: segundos * 1000 }),
        });
      } catch { /* el "escribiendo" nunca es crítico */ }
    },
  };
}
