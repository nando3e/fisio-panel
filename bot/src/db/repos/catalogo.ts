import type { Pool } from 'pg';

export interface Profesional { id: number; name: string; calendarId: string }
export interface Servicio { id: number; name: string; code: string; slotsRequired: number }
export interface ReglaHoraria {
  startTime: string; endTime: string; lunchStart: string | null; lunchEnd: string | null; days: number[];
}
export interface Excepcion {
  fecha: string; hasta: string | null; tipo: 'cerrado' | 'horario';
  ventanas: Array<{ desde: string; hasta: string }> | null;
}

export interface Catalogo {
  profesionales: Profesional[];             // activos, no blocker
  blockerCalendarIds: string[];             // calendarios "cierres"
  servicios: Servicio[];                    // activos
  porServicio: Map<number, number[]>;       // service_id -> professional_ids
}

const TTL_MS = 60_000;

export class CatalogoRepo {
  private cache: { datos: Catalogo; hasta: number } | null = null;

  constructor(private pool: Pool) {}

  invalidar(): void { this.cache = null; }

  async catalogo(): Promise<Catalogo> {
    if (this.cache && this.cache.hasta > Date.now()) return this.cache.datos;
    const [pros, servs, cruces] = await Promise.all([
      this.pool.query<{ id: number; name: string; calendar_id: string; is_blocker: boolean }>(
        'SELECT id, name, calendar_id, is_blocker FROM professionals WHERE active = TRUE',
      ),
      this.pool.query<{ id: number; name: string; code: string; slots_required: number }>(
        'SELECT id, name, code, slots_required FROM services WHERE active = TRUE',
      ),
      this.pool.query<{ service_id: number; professional_id: number }>(
        'SELECT service_id, professional_id FROM service_professionals',
      ),
    ]);
    const porServicio = new Map<number, number[]>();
    for (const c of cruces.rows) {
      const lista = porServicio.get(c.service_id) ?? [];
      lista.push(c.professional_id);
      porServicio.set(c.service_id, lista);
    }
    const datos: Catalogo = {
      profesionales: pros.rows.filter((p) => !p.is_blocker).map((p) => ({ id: p.id, name: p.name, calendarId: p.calendar_id })),
      blockerCalendarIds: pros.rows.filter((p) => p.is_blocker).map((p) => p.calendar_id),
      servicios: servs.rows.map((s) => ({ id: s.id, name: s.name, code: s.code, slotsRequired: s.slots_required })),
      porServicio,
    };
    this.cache = { datos, hasta: Date.now() + TTL_MS };
    return datos;
  }

  async servicio(id: number): Promise<Servicio | null> {
    return (await this.catalogo()).servicios.find((s) => s.id === id) ?? null;
  }

  async profesional(id: number): Promise<Profesional | null> {
    return (await this.catalogo()).profesionales.find((p) => p.id === id) ?? null;
  }

  /** Profesionales activos asignados a un servicio. Vacío = error de configuración (visible, no silencioso). */
  async profesionalesDeServicio(serviceId: number): Promise<Profesional[]> {
    const cat = await this.catalogo();
    const ids = cat.porServicio.get(serviceId) ?? [];
    return cat.profesionales.filter((p) => ids.includes(p.id));
  }

  /** ¿El profesional realiza el servicio? Con datos locales el test es determinista (design.md D6). */
  async ofreceServicio(professionalId: number, serviceId: number): Promise<boolean> {
    const cat = await this.catalogo();
    return (cat.porServicio.get(serviceId) ?? []).includes(professionalId);
  }

  // ── Horarios ────────────────────────────────────────────────────────────────

  async reglasCentro(): Promise<ReglaHoraria[]> {
    const res = await this.pool.query<{ start_time: string; end_time: string; lunch_start: string | null; lunch_end: string | null; days: string }>(
      'SELECT start_time, end_time, lunch_start, lunch_end, days FROM business_hour_rules',
    );
    return res.rows.map(aRegla);
  }

  async reglasProfesional(professionalId: number): Promise<ReglaHoraria[]> {
    const res = await this.pool.query<{ start_time: string; end_time: string; lunch_start: string | null; lunch_end: string | null; days: string }>(
      'SELECT start_time, end_time, lunch_start, lunch_end, days FROM professional_hour_rules WHERE professional_id = $1',
      [professionalId],
    );
    return res.rows.map(aRegla);
  }

  async excepcionesProfesional(professionalId: number, desde: string, hasta: string): Promise<Excepcion[]> {
    const res = await this.pool.query<{ fecha: string; hasta: string | null; tipo: string; ventanas: unknown }>(
      `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hasta, 'YYYY-MM-DD') AS hasta, tipo, ventanas
       FROM professional_exceptions
       WHERE professional_id = $1 AND fecha <= $3::date AND COALESCE(hasta, fecha) >= $2::date`,
      [professionalId, desde, hasta],
    );
    return res.rows.map((r) => ({
      fecha: r.fecha, hasta: r.hasta, tipo: r.tipo as 'cerrado' | 'horario',
      ventanas: (r.ventanas as Excepcion['ventanas']) ?? null,
    }));
  }

  /** Round-robin persistente para "cualquiera": devuelve el siguiente candidato y avanza el puntero. */
  async siguienteProfesional(candidatos: number[]): Promise<number> {
    if (!candidatos.length) throw new Error('siguienteProfesional sin candidatos');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<{ last_assigned_professional_id: number | null }>(
        'SELECT last_assigned_professional_id FROM business_settings WHERE id = 1 FOR UPDATE',
      );
      const ultimo = res.rows[0]?.last_assigned_professional_id ?? null;
      const orden = [...candidatos].sort((a, b) => a - b);
      const idx = ultimo === null ? -1 : orden.findIndex((id) => id > ultimo);
      const elegido = orden[idx === -1 ? 0 : idx] ?? orden[0]!;
      await client.query('UPDATE business_settings SET last_assigned_professional_id = $1, updated_at = NOW() WHERE id = 1', [elegido]);
      await client.query('COMMIT');
      return elegido;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

function aRegla(r: { start_time: string; end_time: string; lunch_start: string | null; lunch_end: string | null; days: string }): ReglaHoraria {
  return {
    startTime: r.start_time, endTime: r.end_time, lunchStart: r.lunch_start, lunchEnd: r.lunch_end,
    days: r.days.split(',').map((d) => parseInt(d.trim(), 10)).filter((d) => d >= 1 && d <= 7),
  };
}
