import { pool } from './db'

/**
 * Ingesta RAG del panel: extraer texto, trocear, embeber y guardar chunks en fisio1.
 * El reemplazo es ATÓMICO por documento: los chunks viejos se borran en la misma
 * transacción que inserta los nuevos; si algo falla antes, la versión anterior queda íntegra.
 */

const EMBEDDINGS_API_URL = process.env.EMBEDDINGS_API_URL || 'https://api.openai.com/v1/embeddings'
const EMBEDDINGS_API_KEY = process.env.EMBEDDINGS_API_KEY || ''
const EMBEDDINGS_MODEL = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small'

export function ragConfigurado(): boolean {
  return Boolean(EMBEDDINGS_API_KEY)
}

export async function extraerTexto(buffer: Buffer, mimetype: string, nombre: string): Promise<string> {
  const ext = nombre.split('.').pop()?.toLowerCase() ?? ''
  if (mimetype === 'application/pdf' || ext === 'pdf') {
    const pdfParse = (await import('pdf-parse')).default
    const datos = await pdfParse(buffer)
    return datos.text
  }
  if (mimetype.startsWith('text/') || ['txt', 'md', 'csv'].includes(ext)) {
    return buffer.toString('utf8')
  }
  throw new Error(`Formato no soportado para RAG: ${mimetype || ext}. Usa PDF, TXT o MD.`)
}

export function trocear(texto: string, maxChars = 1200): string[] {
  const parrafos = texto.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let actual = ''
  for (const p of parrafos) {
    if ((actual + '\n\n' + p).length > maxChars && actual) { chunks.push(actual); actual = p }
    else actual = actual ? `${actual}\n\n${p}` : p
    while (actual.length > maxChars) { chunks.push(actual.slice(0, maxChars)); actual = actual.slice(maxChars) }
  }
  if (actual) chunks.push(actual)
  return chunks
}

async function embeber(textos: string[]): Promise<number[][]> {
  const res = await fetch(EMBEDDINGS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EMBEDDINGS_API_KEY}` },
    body: JSON.stringify({ model: EMBEDDINGS_MODEL, input: textos.map((t) => t.slice(0, 8000)) }),
  })
  if (!res.ok) throw new Error(`Embeddings: HTTP ${res.status}`)
  const datos = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> }
  const orden = [...datos.data].sort((a, b) => a.index - b.index)
  return orden.map((d) => d.embedding)
}

/**
 * Ingesta (alta o reemplazo). Fases:
 *  1. Fuera de transacción: extraer + trocear + embeber (lo que puede fallar).
 *  2. En UNA transacción: borrar chunks anteriores + insertar nuevos + actualizar contador.
 */
export async function ingerirDocumento(documentId: number, buffer: Buffer, mimetype: string, nombre: string): Promise<number> {
  if (!ragConfigurado()) {
    await pool.query('UPDATE documents SET ingest_error = $2, updated_at = NOW() WHERE id = $1',
      [documentId, 'EMBEDDINGS_API_KEY no configurada: documento guardado sin indexar'])
    return 0
  }
  const texto = await extraerTexto(buffer, mimetype, nombre)
  const chunks = trocear(texto)
  if (!chunks.length) throw new Error('El documento no contiene texto extraíble')
  const embeddings: number[][] = []
  for (let i = 0; i < chunks.length; i += 64) {
    embeddings.push(...await embeber(chunks.slice(i, i + 64)))
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId])
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        'INSERT INTO document_chunks (document_id, chunk, embedding) VALUES ($1, $2, $3::vector)',
        [documentId, chunks[i], `[${embeddings[i]!.join(',')}]`],
      )
    }
    await client.query('UPDATE documents SET chunks_count = $2, ingest_error = NULL, updated_at = NOW() WHERE id = $1',
      [documentId, chunks.length])
    await client.query('COMMIT')
    return chunks.length
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
