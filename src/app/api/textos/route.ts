import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const rows = await query('SELECT clave, idioma, contenido, updated_at FROM textos ORDER BY clave, idioma')
  return NextResponse.json(rows)
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { clave, idioma, contenido } = await req.json()
  if (!clave || !['es', 'ca'].includes(idioma) || typeof contenido !== 'string') {
    return NextResponse.json({ error: 'Campos inválidos' }, { status: 400 })
  }
  await query(
    `INSERT INTO textos (clave, idioma, contenido, updated_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (clave, idioma) DO UPDATE SET contenido = EXCLUDED.contenido, updated_at = NOW()`,
    [clave, idioma, contenido],
  )
  return NextResponse.json({ ok: true })
}
