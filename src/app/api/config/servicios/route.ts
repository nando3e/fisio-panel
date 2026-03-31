import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const rows = await query('SELECT * FROM services ORDER BY id')
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { name, code, slots_required } = await req.json()
  const rows = await query(
    'INSERT INTO services (name, code, slots_required, active) VALUES ($1,$2,$3,true) RETURNING *',
    [name, code.toUpperCase(), parseInt(slots_required)]
  )
  return NextResponse.json(rows[0])
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { id, name, code, slots_required, active } = await req.json()
  await query(
    'UPDATE services SET name=$1, code=$2, slots_required=$3, active=$4, updated_at=NOW() WHERE id=$5',
    [name, code.toUpperCase(), parseInt(slots_required), active, id]
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { id } = await req.json()
  await query('DELETE FROM service_professionals WHERE service_id=$1', [id])
  await query('DELETE FROM services WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
