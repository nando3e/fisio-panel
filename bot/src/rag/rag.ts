import type { Pool } from 'pg';

export interface ProveedorEmbeddings {
  embeber(texto: string): Promise<number[]>;
}

export function crearProveedorEmbeddings(apiUrl: string, apiKey: string, modelo: string): ProveedorEmbeddings {
  return {
    async embeber(texto: string): Promise<number[]> {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelo, input: texto.slice(0, 8000) }),
      });
      if (!res.ok) throw new Error(`Embeddings: HTTP ${res.status}`);
      const datos = (await res.json()) as { data: Array<{ embedding: number[] }> };
      const embedding = datos.data[0]?.embedding;
      if (!embedding) throw new Error('Embeddings: respuesta vacía');
      return embedding;
    },
  };
}

export interface ChunkRelevante { chunk: string; documento: string; distancia: number }

/** Top-k por similitud coseno. Umbral: sin resultado relevante el bot deriva, no inventa. */
export async function buscarChunks(
  pool: Pool, embeddings: ProveedorEmbeddings, pregunta: string, k = 5, umbral = 0.6,
): Promise<ChunkRelevante[]> {
  const vector = await embeddings.embeber(pregunta);
  const res = await pool.query<{ chunk: string; original_name: string; distancia: number }>(
    `SELECT c.chunk, d.original_name, c.embedding <=> $1::vector AS distancia
     FROM document_chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.embedding IS NOT NULL
     ORDER BY c.embedding <=> $1::vector
     LIMIT $2`,
    [`[${vector.join(',')}]`, k],
  );
  return res.rows
    .filter((r) => r.distancia <= umbral)
    .map((r) => ({ chunk: r.chunk, documento: r.original_name, distancia: r.distancia }));
}

/** Troceado simple por párrafos con tope de caracteres (compartido con la ingesta del panel). */
export function trocear(texto: string, maxChars = 1200): string[] {
  const parrafos = texto.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let actual = '';
  for (const p of parrafos) {
    if ((actual + '\n\n' + p).length > maxChars && actual) { chunks.push(actual); actual = p; }
    else actual = actual ? `${actual}\n\n${p}` : p;
    while (actual.length > maxChars) { chunks.push(actual.slice(0, maxChars)); actual = actual.slice(maxChars); }
  }
  if (actual) chunks.push(actual);
  return chunks;
}
