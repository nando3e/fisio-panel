import { cargarEnvLocal } from '../config/cargarEnvLocal';
cargarEnvLocal();

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { crearPool } from './pool';

/** Ejecuta las migraciones numeradas pendientes. Idempotente: registra en schema_migrations. */
export async function migrar(pool: Pool, dir?: string): Promise<string[]> {
  const carpeta = dir ?? join(__dirname, '..', '..', 'migrations');
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const hechas = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename),
  );
  const archivos = readdirSync(carpeta).filter((f) => f.endsWith('.sql')).sort();
  const aplicadas: string[] = [];
  for (const archivo of archivos) {
    if (hechas.has(archivo)) continue;
    const sql = readFileSync(join(carpeta, archivo), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [archivo]);
      await client.query('COMMIT');
      aplicadas.push(archivo);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migración ${archivo} falló: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }
  return aplicadas;
}

if (require.main === module) {
  (async () => {
    const pool = crearPool();
    const aplicadas = await migrar(pool);
    console.log(aplicadas.length ? `Aplicadas: ${aplicadas.join(', ')}` : 'Sin migraciones pendientes');
    await pool.end();
  })().catch((e) => { console.error(e); process.exit(1); });
}
