import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const rows = await query('SELECT * FROM business_hour_rules ORDER BY id')
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { start_time, end_time, lunch_start, lunch_end, days } = await req.json()
  const rows = await query(
    `INSERT INTO business_hour_rules (start_time, end_time, lunch_start, lunch_end, days)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [start_time, end_time, lunch_start || null, lunch_end || null, days]
  )
  return NextResponse.json(rows[0])
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id, start_time, end_time, lunch_start, lunch_end, days } = await req.json()
  await query(
    `UPDATE business_hour_rules SET start_time=$1, end_time=$2, lunch_start=$3, lunch_end=$4, days=$5 WHERE id=$6`,
    [start_time, end_time, lunch_start || null, lunch_end || null, days, id]
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await req.json()
  await query('DELETE FROM business_hour_rules WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
