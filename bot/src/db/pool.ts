import { Pool } from 'pg';

export function crearPool(connectionString?: string): Pool {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no definida');
  return new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30000 });
}

export type Db = Pool;
