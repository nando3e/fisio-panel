import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const rows = await query<{ activo: boolean }>('SELECT activo FROM bot_estado WHERE id = 1')
  return NextResponse.json({ activo: rows[0]?.activo ?? false })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { activo } = await req.json()
  await query(
    'UPDATE bot_estado SET activo = $1, fecha_modificacion = NOW() WHERE id = 1',
    [activo]
  )
  return NextResponse.json({ ok: true, activo })
}
