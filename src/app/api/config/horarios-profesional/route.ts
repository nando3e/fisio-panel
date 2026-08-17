import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

/** Reglas semanales y excepciones por profesional. Sin reglas = hereda el horario del centro. */

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const professionalId = req.nextUrl.searchParams.get('professional_id')
  const filtro = professionalId ? parseInt(professionalId, 10) : null
  const [reglas, excepciones] = await Promise.all([
    query(
      `SELECT * FROM professional_hour_rules WHERE $1::int IS NULL OR professional_id = $1 ORDER BY professional_id, id`,
      [filtro],
    ),
    query(
      `SELECT id, professional_id, to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hasta, 'YYYY-MM-DD') AS hasta, tipo, ventanas, nota
       FROM professional_exceptions
       WHERE ($1::int IS NULL OR professional_id = $1) AND COALESCE(hasta, fecha) >= CURRENT_DATE - 30
       ORDER BY fecha`,
      [filtro],
    ),
  ])
  return NextResponse.json({ reglas, excepciones })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await req.json()
  if (body.tipo_registro === 'regla') {
    const { professional_id, start_time, end_time, lunch_start, lunch_end, days } = body
    if (!professional_id || !start_time || !end_time || !days) {
      return NextResponse.json({ error: 'Faltan campos' }, { status: 400 })
    }
    const rows = await query(
      `INSERT INTO professional_hour_rules (professional_id, start_time, end_time, lunch_start, lunch_end, days)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [professional_id, start_time, end_time, lunch_start || null, lunch_end || null, days],
    )
    return NextResponse.json(rows[0])
  }
  if (body.tipo_registro === 'excepcion') {
    const { professional_id, fecha, hasta, tipo, ventanas, nota } = body
    if (!professional_id || !fecha || !['cerrado', 'horario'].includes(tipo)) {
      return NextResponse.json({ error: 'Faltan campos' }, { status: 400 })
    }
    const rows = await query(
      `INSERT INTO professional_exceptions (professional_id, fecha, hasta, tipo, ventanas, nota)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [professional_id, fecha, hasta || null, tipo, ventanas ? JSON.stringify(ventanas) : null, nota || null],
    )
    return NextResponse.json(rows[0])
  }
  return NextResponse.json({ error: 'tipo_registro debe ser regla o excepcion' }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { tipo_registro, id } = await req.json()
  const tabla = tipo_registro === 'regla' ? 'professional_hour_rules' : 'professional_exceptions'
  await query(`DELETE FROM ${tabla} WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
