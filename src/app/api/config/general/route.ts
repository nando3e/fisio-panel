import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const rows = await query('SELECT * FROM business_settings WHERE id = 1')
  return NextResponse.json(rows[0] ?? {})
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { slot_minutes, day_start_time, day_end_time, timezone, telefono } = await req.json()
  await query(
    `UPDATE business_settings SET slot_minutes=$1, day_start_time=$2, day_end_time=$3,
     timezone=$4, telefono=$5, updated_at=NOW() WHERE id=1`,
    [slot_minutes, day_start_time, day_end_time, timezone, telefono]
  )
  return NextResponse.json({ ok: true })
}
