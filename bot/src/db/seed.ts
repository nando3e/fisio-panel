import { cargarEnvLocal } from '../config/cargarEnvLocal';
cargarEnvLocal();

import { crearPool } from './pool';
import { PromptsRepo, TextosRepo } from './repos/prompts';
import { DEFAULT_PROMPTS, DEFAULT_TEXTOS } from '../agent/defaultPrompts';
import type { Pool } from 'pg';

/** Semilla idempotente: inserta SOLO lo que falta. Nunca pisa lo editado en el panel. */
export async function sembrar(pool: Pool): Promise<{ prompts: string[]; textos: number }> {
  const prompts = new PromptsRepo(pool);
  const textos = new TextosRepo(pool);
  const rolesSembrados = await prompts.sembrar(DEFAULT_PROMPTS);
  const textosSembrados = await textos.sembrar(DEFAULT_TEXTOS);
  return { prompts: rolesSembrados, textos: textosSembrados };
}

if (require.main === module) {
  (async () => {
    const pool = crearPool();
    const res = await sembrar(pool);
    console.log(`Prompts sembrados: ${res.prompts.join(', ') || '(ninguno, ya existían)'} · textos nuevos: ${res.textos}`);
    await pool.end();
  })().catch((e) => { console.error(e); process.exit(1); });
}
