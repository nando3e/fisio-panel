import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { ingerirDocumento } from '@/lib/rag'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'

function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })
}

function nombreArchivo(original: string): string {
  const ext = original.split('.').pop()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const rows = await query('SELECT * FROM documents ORDER BY created_at DESC')
  return NextResponse.json(rows)
}

/** Alta: guarda el archivo, registra el documento e indexa sus chunks para el RAG del bot. */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const formData = await req.formData()
  const files = formData.getAll('files') as File[]
  if (!files.length) return NextResponse.json({ error: 'No hay archivos' }, { status: 400 })

  ensureUploadDir()
  const saved = []
  for (const file of files) {
    const filename = nombreArchivo(file.name)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(join(UPLOAD_DIR, filename), buffer)
    const rows = await query(
      'INSERT INTO documents (filename, original_name, mimetype, size, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [filename, file.name, file.type, file.size, session.email],
    )
    const doc = rows[0] as { id: number }
    try {
      await ingerirDocumento(doc.id, buffer, file.type, file.name)
    } catch (err) {
      await query('UPDATE documents SET ingest_error = $2, updated_at = NOW() WHERE id = $1',
        [doc.id, err instanceof Error ? err.message : String(err)])
    }
    const final = await query('SELECT * FROM documents WHERE id = $1', [doc.id])
    saved.push(final[0])
  }
  return NextResponse.json(saved)
}

/**
 * Reemplazo por documento (p. ej. precios actualizados): se ingiere la versión nueva
 * y los chunks viejos desaparecen en la MISMA transacción. Si la ingesta falla,
 * la versión anterior sigue íntegra y operativa.
 */
export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const formData = await req.formData()
  const id = parseInt(String(formData.get('id') ?? ''), 10)
  const file = formData.get('file') as File | null
  if (!id || !file) return NextResponse.json({ error: 'Faltan id y file' }, { status: 400 })

  const existente = await query<{ filename: string }>('SELECT filename FROM documents WHERE id = $1', [id])
  if (!existente.length) return NextResponse.json({ error: 'No existe' }, { status: 404 })

  ensureUploadDir()
  const buffer = Buffer.from(await file.arrayBuffer())
  const filename = nombreArchivo(file.name)
  await writeFile(join(UPLOAD_DIR, filename), buffer)

  try {
    await ingerirDocumento(id, buffer, file.type, file.name) // atómico: borra chunks viejos + inserta nuevos
  } catch (err) {
    await unlink(join(UPLOAD_DIR, filename)).catch(() => {})
    return NextResponse.json(
      { error: `La ingesta falló y el documento anterior sigue vigente: ${err instanceof Error ? err.message : err}` },
      { status: 422 },
    )
  }

  await query(
    'UPDATE documents SET filename=$2, original_name=$3, mimetype=$4, size=$5, uploaded_by=$6, updated_at=NOW() WHERE id=$1',
    [id, filename, file.name, file.type, file.size, session.email],
  )
  await unlink(join(UPLOAD_DIR, existente[0].filename)).catch(() => {})
  const final = await query('SELECT * FROM documents WHERE id = $1', [id])
  return NextResponse.json(final[0])
}

/** Borrar arrastra sus chunks (ON DELETE CASCADE) y el archivo. */
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await req.json()
  const rows = await query<{ filename: string }>('SELECT filename FROM documents WHERE id=$1', [id])
  if (rows.length) {
    try { await unlink(join(UPLOAD_DIR, rows[0].filename)) } catch { /* ya no existe */ }
  }
  await query('DELETE FROM documents WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
