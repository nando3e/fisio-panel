import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

/**
 * Cierres del centro (vacaciones, festivos…): rango de fechas + mensaje que el
 * bot usará para explicar el cierre. Fechas con to_char para esquivar la
 * conversión Date→UTC que corre las fechas un día.
 */

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const rows = await query(
    `SELECT id, to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta, motivo, mensaje
     FROM cierres WHERE hasta >= CURRENT_DATE - 30 ORDER BY desde`,
  )
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { desde, hasta, motivo, mensaje } = await req.json()
  if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
    return NextResponse.json({ error: 'Falta la fecha de inicio' }, { status: 400 })
  }
  const fin = hasta && /^\d{4}-\d{2}-\d{2}$/.test(hasta) ? hasta : desde
  if (fin < desde) {
    return NextResponse.json({ error: 'La fecha final es anterior a la inicial' }, { status: 400 })
  }
  const rows = await query(
    `INSERT INTO cierres (desde, hasta, motivo, mensaje) VALUES ($1::date, $2::date, $3, $4)
     RETURNING id, to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta, motivo, mensaje`,
    [desde, fin, motivo || null, mensaje || null],
  )
  return NextResponse.json(rows[0])
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })
  await query('DELETE FROM cierres WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
