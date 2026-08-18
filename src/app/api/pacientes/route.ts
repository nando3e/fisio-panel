import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { aE164 } from '@/lib/telefono'

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

/** Alta manual desde el panel. Un solo titular por teléfono (índice parcial). */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { nombre, apellido, telefono, titular, idioma_preferido } = await req.json()
  if (!nombre?.trim()) return NextResponse.json({ error: 'Falta el nombre' }, { status: 400 })
  const tel = aE164(String(telefono ?? ''))
  if (!tel) return NextResponse.json({ error: 'Teléfono no válido' }, { status: 400 })
  if (idioma_preferido && !['es', 'ca'].includes(idioma_preferido)) {
    return NextResponse.json({ error: 'Idioma inválido' }, { status: 400 })
  }
  try {
    const rows = await query(
      `INSERT INTO pacientes (nombre, apellido, telefono, titular, idioma_preferido)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nombre.trim(), apellido?.trim() || null, tel, titular !== false, idioma_preferido || null],
    )
    return NextResponse.json(rows[0])
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Ese número ya tiene un titular. Crea este paciente como Tercero.' }, { status: 409 })
    }
    throw err
  }
}
