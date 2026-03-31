import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'

function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const rows = await query('SELECT * FROM documents ORDER BY created_at DESC')
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const formData = await req.formData()
  const files = formData.getAll('files') as File[]

  if (!files.length) return NextResponse.json({ error: 'No hay archivos' }, { status: 400 })

  ensureUploadDir()
  const saved = []

  for (const file of files) {
    const ext = file.name.split('.').pop()
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(join(UPLOAD_DIR, filename), buffer)

    const rows = await query(
      'INSERT INTO documents (filename, original_name, mimetype, size, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [filename, file.name, file.type, file.size, session.email]
    )
    saved.push(rows[0])
  }

  return NextResponse.json(saved)
}

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
