import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const rows = await query(
    `SELECT p.*,
            (SELECT COUNT(*)::int FROM citas c WHERE c.paciente_id = p.id AND c.estado = 'confirmada') AS total_citas,
            (SELECT MAX(c.start_time) FROM citas c WHERE c.paciente_id = p.id AND c.estado = 'confirmada' AND c.start_time <= NOW()) AS ultima_visita,
            (SELECT MIN(c.start_time) FROM citas c WHERE c.paciente_id = p.id AND c.estado = 'confirmada' AND c.start_time > NOW()) AS proxima_cita
     FROM pacientes p
     WHERE $1 = '' OR p.telefono ILIKE '%' || $1 || '%' OR p.nombre ILIKE '%' || $1 || '%' OR p.apellido ILIKE '%' || $1 || '%'
     ORDER BY p.updated_at DESC
     LIMIT 100`,
    [q],
  )
  return NextResponse.json(rows)
}
