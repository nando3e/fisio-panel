import { google, type calendar_v3 } from 'googleapis';

export interface EventoCal {
  id: string;
  status?: string | null;
  summary?: string | null;
  description?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
}

export interface DatosEvento {
  titulo: string;
  descripcion?: string;
  inicio: Date;
  fin: Date;
}

/** Puerto del calendario: la implementación real habla con Google; los tests usan un doble. */
export interface CalendarioPort {
  listarEventos(calendarId: string, desde: Date, hasta: Date): Promise<EventoCal[]>;
  crearEvento(calendarId: string, datos: DatosEvento): Promise<string>;
  moverEvento(calendarId: string, eventId: string, inicio: Date, fin: Date): Promise<void>;
  borrarEvento(calendarId: string, eventId: string): Promise<void>;
}

export function crearCalendarioGoogle(serviceAccountJson: string): CalendarioPort {
  const credenciales = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string };
  const auth = new google.auth.JWT({
    email: credenciales.client_email,
    key: credenciales.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const api = google.calendar({ version: 'v3', auth });

  return {
    async listarEventos(calendarId, desde, hasta) {
      const eventos: EventoCal[] = [];
      let pageToken: string | undefined;
      do {
        // Paginación completa: un evento perdido = ofrecer una hora ocupada.
        const res = await api.events.list({
          calendarId,
          timeMin: desde.toISOString(),
          timeMax: hasta.toISOString(),
          singleEvents: true,
          maxResults: 2500,
          pageToken,
        });
        for (const e of res.data.items ?? []) {
          if (!e.id) continue;
          eventos.push({ id: e.id, status: e.status, summary: e.summary, description: e.description, start: e.start, end: e.end });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return eventos;
    },

    async crearEvento(calendarId, datos) {
      const cuerpo: calendar_v3.Schema$Event = {
        summary: datos.titulo,
        description: datos.descripcion,
        start: { dateTime: datos.inicio.toISOString() },
        end: { dateTime: datos.fin.toISOString() },
      };
      const res = await api.events.insert({ calendarId, requestBody: cuerpo });
      if (!res.data.id) throw new Error('Google no devolvió id de evento');
      return res.data.id;
    },

    async moverEvento(calendarId, eventId, inicio, fin) {
      await api.events.patch({
        calendarId, eventId,
        requestBody: { start: { dateTime: inicio.toISOString() }, end: { dateTime: fin.toISOString() } },
      });
    },

    async borrarEvento(calendarId, eventId) {
      try {
        await api.events.delete({ calendarId, eventId });
      } catch (err) {
        const codigo = (err as { code?: number }).code;
        if (codigo !== 404 && codigo !== 410) throw err; // ya no existe = objetivo cumplido
      }
    },
  };
}
