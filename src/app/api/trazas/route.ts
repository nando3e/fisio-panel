import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const telefono = req.nextUrl.searchParams.get('telefono')?.trim() || null
  const soloErrores = req.nextUrl.searchParams.get('errores') === 'true'
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10) || 50, 200)

  const rows = await query(
    `SELECT id, telefono, mensaje, respuesta, tools, tools_detalle, modelo, prompt_versions,
            tokens_in, tokens_out, duracion_ms, error, created_at
     FROM agent_traces
     WHERE ($1::text IS NULL OR telefono ILIKE '%' || $1 || '%')
       AND ($2::boolean = FALSE OR error IS NOT NULL)
     ORDER BY created_at DESC
     LIMIT $3`,
    [telefono, soloErrores, limit],
  )
  return NextResponse.json(rows)
}
