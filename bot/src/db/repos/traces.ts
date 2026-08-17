import type { Pool } from 'pg';

export interface DetalleTool { nombre: string; args: unknown; resultado: string }

export interface Traza {
  telefono: string;
  mensaje: string | null;
  respuesta: string | null;
  tools: string[];
  toolsDetalle: DetalleTool[];
  modelo: string | null;
  promptVersions: Record<string, number> | null;
  tokensIn: number | null;
  tokensOut: number | null;
  duracionMs: number | null;
  error: string | null;
}

export class TracesRepo {
  constructor(private pool: Pool) {}

  /** La traza se escribe SIEMPRE, también (sobre todo) cuando algo falla. */
  async escribir(t: Traza): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_traces (telefono, mensaje, respuesta, tools, tools_detalle, modelo, prompt_versions, tokens_in, tokens_out, duracion_ms, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [t.telefono, t.mensaje, t.respuesta, JSON.stringify(t.tools), JSON.stringify(t.toolsDetalle),
       t.modelo, t.promptVersions ? JSON.stringify(t.promptVersions) : null,
       t.tokensIn, t.tokensOut, t.duracionMs, t.error],
    );
  }

  async podar(dias = 90): Promise<number> {
    const res = await this.pool.query('DELETE FROM agent_traces WHERE created_at < NOW() - make_interval(days => $1)', [dias]);
    return res.rowCount ?? 0;
  }
}

/** Anomalías: fallos de negocio silenciosos, con marca buscable en logs. */
export function registrarAnomalia(tipo: string, detalle: Record<string, unknown>): void {
  console.warn(`[anomalia] ${tipo} ${JSON.stringify(detalle)}`);
}
