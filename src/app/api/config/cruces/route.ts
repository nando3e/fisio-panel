import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const rows = await query('SELECT * FROM service_professionals')
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { service_id, professional_id } = await req.json()
  await query(
    'INSERT INTO service_professionals (service_id, professional_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [service_id, professional_id]
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { service_id, professional_id } = await req.json()
  await query(
    'DELETE FROM service_professionals WHERE service_id=$1 AND professional_id=$2',
    [service_id, professional_id]
  )
  return NextResponse.json({ ok: true })
}
