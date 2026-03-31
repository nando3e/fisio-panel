import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const rows = await query('SELECT * FROM professionals ORDER BY id')
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { name, calendar_id, is_blocker } = await req.json()
  const rows = await query(
    'INSERT INTO professionals (name, calendar_id, active, is_blocker) VALUES ($1,$2,true,$3) RETURNING *',
    [name, calendar_id, is_blocker ?? false]
  )
  return NextResponse.json(rows[0])
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { id, name, calendar_id, active, is_blocker } = await req.json()
  await query(
    'UPDATE professionals SET name=$1, calendar_id=$2, active=$3, is_blocker=$4, updated_at=NOW() WHERE id=$5',
    [name, calendar_id, active, is_blocker, id]
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { id } = await req.json()
  await query('DELETE FROM service_professionals WHERE professional_id=$1', [id])
  await query('DELETE FROM professionals WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
