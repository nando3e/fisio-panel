import type { Pool } from 'pg';

export const ROLES_PROMPT = ['identidad', 'reglas', 'reserva', 'gestion', 'general'] as const;
export type RolPrompt = (typeof ROLES_PROMPT)[number];

export interface VersionPrompt { id: number; rol: string; version: number; contenido: string; activo: boolean }

const TTL_MS = 45_000;

export class PromptsRepo {
  private cache: { porRol: Record<string, VersionPrompt>; hasta: number } | null = null;

  constructor(private pool: Pool) {}

  invalidar(): void { this.cache = null; }

  async activos(): Promise<Record<string, VersionPrompt>> {
    if (this.cache && this.cache.hasta > Date.now()) return this.cache.porRol;
    const res = await this.pool.query<VersionPrompt>('SELECT id, rol, version, contenido, activo FROM prompts WHERE activo');
    const porRol: Record<string, VersionPrompt> = {};
    for (const fila of res.rows) porRol[fila.rol] = fila;
    this.cache = { porRol, hasta: Date.now() + TTL_MS };
    return porRol;
  }

  /** Concatena los roles en orden fijo. Falta un rol → se omite (la semilla lo repone). */
  async systemPrompt(): Promise<{ texto: string; versiones: Record<string, number> }> {
    const porRol = await this.activos();
    const partes: string[] = [];
    const versiones: Record<string, number> = {};
    for (const rol of ROLES_PROMPT) {
      const p = porRol[rol];
      if (p) { partes.push(p.contenido); versiones[rol] = p.version; }
    }
    return { texto: partes.join('\n\n---\n\n'), versiones };
  }

  /** Publica versión nueva y la activa. NO pisa el histórico. */
  async publicar(rol: string, contenido: string, nota?: string): Promise<VersionPrompt> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<{ max: number | null }>('SELECT MAX(version) AS max FROM prompts WHERE rol = $1', [rol]);
      const version = (res.rows[0]?.max ?? 0) + 1;
      await client.query('UPDATE prompts SET activo = FALSE WHERE rol = $1 AND activo', [rol]);
      const ins = await client.query<VersionPrompt>(
        'INSERT INTO prompts (rol, version, contenido, activo, nota) VALUES ($1,$2,$3,TRUE,$4) RETURNING id, rol, version, contenido, activo',
        [rol, version, contenido, nota ?? null],
      );
      await client.query('COMMIT');
      this.invalidar();
      return ins.rows[0]!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Siembra: inserta SOLO los roles sin versión activa. Nunca pisa lo editado. */
  async sembrar(defaults: Record<string, string>): Promise<string[]> {
    const activos = await this.activos();
    const sembrados: string[] = [];
    for (const [rol, contenido] of Object.entries(defaults)) {
      if (activos[rol]) continue;
      await this.publicar(rol, contenido, 'semilla');
      sembrados.push(rol);
    }
    this.invalidar();
    return sembrados;
  }
}

export class TextosRepo {
  private cache: { datos: Map<string, string>; hasta: number } | null = null;

  constructor(private pool: Pool) {}

  invalidar(): void { this.cache = null; }

  async texto(clave: string, idioma: string): Promise<string | null> {
    if (!this.cache || this.cache.hasta <= Date.now()) {
      const res = await this.pool.query<{ clave: string; idioma: string; contenido: string }>('SELECT clave, idioma, contenido FROM textos');
      const datos = new Map<string, string>();
      for (const fila of res.rows) datos.set(`${fila.clave}:${fila.idioma}`, fila.contenido);
      this.cache = { datos, hasta: Date.now() + TTL_MS };
    }
    return this.cache.datos.get(`${clave}:${idioma}`) ?? this.cache.datos.get(`${clave}:es`) ?? null;
  }

  async guardar(clave: string, idioma: string, contenido: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO textos (clave, idioma, contenido, updated_at) VALUES ($1,$2,$3,NOW())
       ON CONFLICT (clave, idioma) DO UPDATE SET contenido = EXCLUDED.contenido, updated_at = NOW()`,
      [clave, idioma, contenido],
    );
    this.invalidar();
  }

  async sembrar(defaults: Array<{ clave: string; idioma: string; contenido: string }>): Promise<number> {
    let sembrados = 0;
    for (const t of defaults) {
      const res = await this.pool.query(
        'INSERT INTO textos (clave, idioma, contenido) VALUES ($1,$2,$3) ON CONFLICT (clave, idioma) DO NOTHING',
        [t.clave, t.idioma, t.contenido],
      );
      sembrados += res.rowCount ?? 0;
    }
    this.invalidar();
    return sembrados;
  }
}
