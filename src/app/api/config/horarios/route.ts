import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const rows = await query('SELECT * FROM business_hours ORDER BY day_of_week')
  return NextResponse.json(rows)
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const hours: Array<{
    day_of_week: number
    is_open: boolean
    start_time: string | null
    end_time: string | null
    lunch_start: string | null
    lunch_end: string | null
  }> = await req.json()

  for (const h of hours) {
    await query(
      `INSERT INTO business_hours (day_of_week, is_open, start_time, end_time, lunch_start, lunch_end)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (day_of_week) DO UPDATE SET
         is_open=$2, start_time=$3, end_time=$4, lunch_start=$5, lunch_end=$6`,
      [h.day_of_week, h.is_open, h.start_time || null, h.end_time || null, h.lunch_start || null, h.lunch_end || null]
    )
  }
  return NextResponse.json({ ok: true })
}
