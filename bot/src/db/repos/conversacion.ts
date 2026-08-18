import type { Pool } from 'pg';

export type RolMensaje = 'human' | 'ai' | 'humano_negocio';
export interface MensajeMemoria { rol: RolMensaje; contenido: string; fecha: Date }

/** Doble corte de memoria (design.md D11): ~25 mensajes Y 6 horas. */
export const MAX_MENSAJES = 25;
export const HORAS_CONVERSACION = 6;

export class ChatMemoryRepo {
  constructor(private pool: Pool) {}

  async registrar(telefono: string, rol: RolMensaje, contenido: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO chat_memory (session_id, message) VALUES ($1, $2)',
      [telefono, JSON.stringify({ type: rol, content: contenido })],
    );
  }

  async historial(telefono: string): Promise<MensajeMemoria[]> {
    const res = await this.pool.query<{ message: { type: RolMensaje; content: string }; created_at: string }>(
      `SELECT message, created_at FROM chat_memory
       WHERE session_id = $1 AND created_at > NOW() - make_interval(hours => $2)
       ORDER BY created_at DESC LIMIT $3`,
      [telefono, HORAS_CONVERSACION, MAX_MENSAJES],
    );
    return res.rows.reverse().map((r) => ({
      rol: r.message.type, contenido: r.message.content, fecha: new Date(r.created_at),
    }));
  }

  /** Últimos mensajes del PACIENTE (para detección de idioma). */
  async ultimosDelCliente(telefono: string, n = 5): Promise<string[]> {
    const res = await this.pool.query<{ message: { type: string; content: string } }>(
      `SELECT message FROM chat_memory WHERE session_id = $1 AND message->>'type' = 'human'
       ORDER BY created_at DESC LIMIT $2`,
      [telefono, n],
    );
    return res.rows.map((r) => r.message.content);
  }

  async podar(dias = 30): Promise<number> {
    const res = await this.pool.query('DELETE FROM chat_memory WHERE created_at < NOW() - make_interval(days => $1)', [dias]);
    return res.rowCount ?? 0;
  }
}

export interface Confirmacion {
  telefono: string;
  pacienteId: number | null;
  professionalId: number | null;   // null = "cualquiera" (round-robin al confirmar)
  serviceId: number;
  inicio: Date;
  motivo: string | null;
  paraNombre: string | null;
  paraApellido: string | null;
  paraOtraPersona: boolean;
  resumen: string | null;
  sustituyeEventId: string | null;
  avisado: boolean;
  silenciado: boolean;
  createdAt: Date;
}

function aConfirmacion(r: Record<string, unknown>): Confirmacion {
  return {
    telefono: r.telefono as string,
    pacienteId: (r.paciente_id as number) ?? null,
    professionalId: (r.professional_id as number) ?? null,
    serviceId: r.service_id as number,
    inicio: new Date(r.inicio as string),
    motivo: (r.motivo as string) ?? null,
    paraNombre: (r.para_nombre as string) ?? null,
    paraApellido: (r.para_apellido as string) ?? null,
    paraOtraPersona: r.para_otra_persona as boolean,
    resumen: (r.resumen as string) ?? null,
    sustituyeEventId: (r.sustituye_event_id as string) ?? null,
    avisado: r.avisado as boolean,
    silenciado: r.silenciado as boolean,
    createdAt: new Date(r.created_at as string),
  };
}

export class ConfirmacionesRepo {
  constructor(private pool: Pool) {}

  /** PK = teléfono: proponer otra hora SUSTITUYE la propuesta anterior y reinicia su plazo. */
  async proponer(datos: Omit<Confirmacion, 'avisado' | 'silenciado' | 'createdAt'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO confirmaciones_pendientes
         (telefono, paciente_id, professional_id, service_id, inicio, motivo, para_nombre, para_apellido, para_otra_persona, resumen, sustituye_event_id, avisado, silenciado, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,FALSE,NOW())
       ON CONFLICT (telefono) DO UPDATE SET
         paciente_id=$2, professional_id=$3, service_id=$4, inicio=$5, motivo=$6, para_nombre=$7,
         para_apellido=$8, para_otra_persona=$9, resumen=$10, sustituye_event_id=$11,
         avisado=FALSE, silenciado=FALSE, created_at=NOW()`,
      [datos.telefono, datos.pacienteId, datos.professionalId, datos.serviceId, datos.inicio, datos.motivo,
       datos.paraNombre, datos.paraApellido, datos.paraOtraPersona, datos.resumen, datos.sustituyeEventId],
    );
  }

  async viva(telefono: string): Promise<Confirmacion | null> {
    const res = await this.pool.query('SELECT * FROM confirmaciones_pendientes WHERE telefono = $1', [telefono]);
    return res.rows[0] ? aConfirmacion(res.rows[0]) : null;
  }

  async borrar(telefono: string): Promise<void> {
    await this.pool.query('DELETE FROM confirmaciones_pendientes WHERE telefono = $1', [telefono]);
  }

  /**
   * SILENCIAR, no borrar, cuando el cliente escribe: decir "sí" también es escribir,
   * y la propuesta tiene que seguir viva para que confirmar_cita la lea (lección de balta).
   */
  async silenciar(telefono: string): Promise<void> {
    await this.pool.query('UPDATE confirmaciones_pendientes SET silenciado = TRUE WHERE telefono = $1', [telefono]);
  }

  /**
   * Propuestas sin respuesta que toca avisar (una sola vez por propuesta).
   * Las sesiones del simulador (sim:) se excluyen: no hay nadie a quien enviar,
   * y la entrega fallida las reintentaría cada ronda para siempre.
   */
  async pendientesDeAviso(segundos: number): Promise<Confirmacion[]> {
    const res = await this.pool.query(
      `SELECT * FROM confirmaciones_pendientes
       WHERE avisado = FALSE AND silenciado = FALSE AND telefono NOT LIKE 'sim:%'
         AND created_at < NOW() - make_interval(secs => $1)`,
      [segundos],
    );
    return res.rows.map(aConfirmacion);
  }

  /** Limpieza de propuestas del simulador: caducan con la ventana de conversación. */
  async purgarSimuladas(horas = 6): Promise<number> {
    const res = await this.pool.query(
      `DELETE FROM confirmaciones_pendientes WHERE telefono LIKE 'sim:%' AND created_at < NOW() - make_interval(hours => $1)`,
      [horas],
    );
    return res.rowCount ?? 0;
  }

  async marcarAvisada(telefono: string): Promise<void> {
    await this.pool.query('UPDATE confirmaciones_pendientes SET avisado = TRUE WHERE telefono = $1', [telefono]);
  }
}
