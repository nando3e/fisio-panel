import type { Pool } from 'pg';

export interface Cita {
  id: number;
  googleEventId: string | null;
  pacienteId: number | null;
  professionalId: number | null;
  serviceId: number | null;
  telefono: string | null;
  nombre: string | null;
  startTime: Date;
  endTime: Date;
  estado: 'confirmada' | 'anulada';
  motivo: string | null;
}

function aCita(r: Record<string, unknown>): Cita {
  return {
    id: r.id as number,
    googleEventId: (r.google_event_id as string) ?? null,
    pacienteId: (r.paciente_id as number) ?? null,
    professionalId: (r.professional_id as number) ?? null,
    serviceId: (r.service_id as number) ?? null,
    telefono: (r.telefono as string) ?? null,
    nombre: (r.nombre as string) ?? null,
    startTime: new Date(r.start_time as string),
    endTime: new Date(r.end_time as string),
    estado: r.estado as Cita['estado'],
    motivo: (r.motivo as string) ?? null,
  };
}

export class CitasRepo {
  constructor(private pool: Pool) {}

  async guardar(datos: {
    googleEventId: string; pacienteId: number; professionalId: number; serviceId: number;
    telefono: string; nombre: string | null; inicio: Date; fin: Date; motivo: string | null;
  }): Promise<Cita> {
    const res = await this.pool.query(
      `INSERT INTO citas (google_event_id, paciente_id, professional_id, service_id, telefono, nombre, start_time, end_time, estado, motivo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmada',$9)
       ON CONFLICT (google_event_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [datos.googleEventId, datos.pacienteId, datos.professionalId, datos.serviceId,
       datos.telefono, datos.nombre, datos.inicio, datos.fin, datos.motivo],
    );
    return aCita(res.rows[0]);
  }

  async porEventId(googleEventId: string): Promise<Cita | null> {
    const res = await this.pool.query('SELECT * FROM citas WHERE google_event_id = $1', [googleEventId]);
    return res.rows[0] ? aCita(res.rows[0]) : null;
  }

  /** Citas futuras confirmadas de un conjunto de pacientes (las que el bot puede gestionar). */
  async futurasDePacientes(pacienteIds: number[], ahora: Date): Promise<Cita[]> {
    if (!pacienteIds.length) return [];
    const res = await this.pool.query(
      `SELECT * FROM citas WHERE paciente_id = ANY($1) AND estado = 'confirmada' AND start_time > $2 ORDER BY start_time`,
      [pacienteIds, ahora],
    );
    return res.rows.map(aCita);
  }

  /** Última cita PASADA confirmada de un paciente (≤ ventana). Deriva la continuidad (design.md D6). */
  async ultimaPasada(pacienteId: number, ahora: Date, ventanaDias = 365): Promise<Cita | null> {
    const desde = new Date(ahora.getTime() - ventanaDias * 24 * 60 * 60_000);
    const res = await this.pool.query(
      `SELECT * FROM citas WHERE paciente_id = $1 AND estado = 'confirmada'
         AND start_time <= $2 AND start_time >= $3
       ORDER BY start_time DESC LIMIT 1`,
      [pacienteId, ahora, desde],
    );
    return res.rows[0] ? aCita(res.rows[0]) : null;
  }

  /** Idempotencia: ¿ya existe cita confirmada de este paciente en este instante? */
  async duplicada(pacienteId: number, inicio: Date): Promise<Cita | null> {
    const res = await this.pool.query(
      `SELECT * FROM citas WHERE paciente_id = $1 AND start_time = $2 AND estado = 'confirmada' LIMIT 1`,
      [pacienteId, inicio],
    );
    return res.rows[0] ? aCita(res.rows[0]) : null;
  }

  async anular(googleEventId: string): Promise<void> {
    await this.pool.query(`UPDATE citas SET estado = 'anulada', updated_at = NOW() WHERE google_event_id = $1`, [googleEventId]);
  }

  async reprogramar(googleEventId: string, inicio: Date, fin: Date): Promise<void> {
    await this.pool.query(
      `UPDATE citas SET start_time = $2, end_time = $3, recordada_en = NULL, recordatorio_intentos = 0,
         recordatorio_lease_hasta = NULL, updated_at = NOW()
       WHERE google_event_id = $1`,
      [googleEventId, inicio, fin],
    );
  }

  /** El evento apareció en el calendario de OTRO profesional (arrastrado a mano). */
  async reasignarProfesional(googleEventId: string, professionalId: number): Promise<void> {
    await this.pool.query(
      `UPDATE citas SET professional_id = $2, estado = 'confirmada', updated_at = NOW()
       WHERE google_event_id = $1`,
      [googleEventId, professionalId],
    );
  }

  /** Alta desde sincronización (evento apuntado a mano en Google). */
  async altaSincronizada(datos: {
    googleEventId: string; professionalId: number; pacienteId: number | null;
    telefono: string | null; nombre: string | null; inicio: Date; fin: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO citas (google_event_id, professional_id, paciente_id, telefono, nombre, start_time, end_time, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmada')
       ON CONFLICT (google_event_id) DO UPDATE SET
         start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, updated_at = NOW()`,
      [datos.googleEventId, datos.professionalId, datos.pacienteId, datos.telefono, datos.nombre, datos.inicio, datos.fin],
    );
  }

  /** Marca como anuladas las citas del rango cuyo evento ya no existe en Google. */
  async sincronizarBorrados(professionalId: number, idsVigentes: string[], desde: Date, hasta: Date): Promise<number> {
    const res = await this.pool.query(
      `UPDATE citas SET estado = 'anulada', updated_at = NOW()
       WHERE professional_id = $1 AND estado = 'confirmada' AND google_event_id IS NOT NULL
         AND start_time >= $2 AND start_time < $3
         AND NOT (google_event_id = ANY($4))`,
      [professionalId, desde, hasta, idsVigentes],
    );
    return res.rowCount ?? 0;
  }

  // ── Recordatorios: lease atómico (exactamente-una-vez) ─────────────────────

  /** Selecciona, reserva (lease) e incrementa intentos de forma atómica. */
  async reservarParaRecordar(ids: number[], leaseSegundos = 180, maxIntentos = 5): Promise<Cita[]> {
    if (!ids.length) return [];
    const res = await this.pool.query(
      `UPDATE citas SET recordatorio_lease_hasta = NOW() + make_interval(secs => $2),
                        recordatorio_intentos = recordatorio_intentos + 1
       WHERE id IN (
         SELECT id FROM citas
         WHERE id = ANY($1) AND recordada_en IS NULL AND estado = 'confirmada'
           AND (recordatorio_lease_hasta IS NULL OR recordatorio_lease_hasta < NOW())
           AND recordatorio_intentos < $3
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [ids, leaseSegundos, maxIntentos],
    );
    return res.rows.map(aCita);
  }

  async confirmarRecordada(id: number): Promise<void> {
    await this.pool.query('UPDATE citas SET recordada_en = NOW(), recordatorio_error = NULL WHERE id = $1', [id]);
  }

  async liberarRecordatorio(id: number, error: string): Promise<void> {
    await this.pool.query(
      'UPDATE citas SET recordatorio_lease_hasta = NULL, recordatorio_error = $2 WHERE id = $1',
      [id, error.slice(0, 500)],
    );
  }

  /** Candidatas a recordatorio en una ventana temporal (la selección fina la hace reminders.ts). */
  async pendientesDeRecordar(desde: Date, hasta: Date): Promise<Cita[]> {
    const res = await this.pool.query(
      `SELECT * FROM citas WHERE recordada_en IS NULL AND estado = 'confirmada'
         AND start_time >= $1 AND start_time < $2`,
      [desde, hasta],
    );
    return res.rows.map(aCita);
  }
}
