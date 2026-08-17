import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const id = parseInt(params.id, 10)
  const pacientes = await query('SELECT * FROM pacientes WHERE id = $1', [id])
  if (!pacientes.length) return NextResponse.json({ error: 'No existe' }, { status: 404 })

  const historial = await query(
    `SELECT c.id, c.start_time, c.end_time, c.estado, c.motivo,
            p.name AS profesional, s.name AS servicio
     FROM citas c
     LEFT JOIN professionals p ON p.id = c.professional_id
     LEFT JOIN services s ON s.id = c.service_id
     WHERE c.paciente_id = $1
     ORDER BY c.start_time DESC
     LIMIT 100`,
    [id],
  )
  const mismoTelefono = await query(
    'SELECT id, nombre, apellido, titular FROM pacientes WHERE telefono = (SELECT telefono FROM pacientes WHERE id = $1) AND id <> $1',
    [id],
  )
  return NextResponse.json({ paciente: pacientes[0], historial, mismo_telefono: mismoTelefono })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const id = parseInt(params.id, 10)
  const { nombre, apellido, idioma_preferido } = await req.json()
  if (idioma_preferido && !['es', 'ca'].includes(idioma_preferido)) {
    return NextResponse.json({ error: 'Idioma inválido' }, { status: 400 })
  }
  await query(
    `UPDATE pacientes SET nombre = COALESCE($2, nombre), apellido = $3,
       idioma_preferido = COALESCE($4, idioma_preferido), updated_at = NOW()
     WHERE id = $1`,
    [id, nombre?.trim() || null, apellido?.trim() || null, idioma_preferido || null],
  )
  return NextResponse.json({ ok: true })
}
