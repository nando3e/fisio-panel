import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { aE164 } from '@/lib/telefono'

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

/** Edición completa: todos los campos de la ficha. */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const id = parseInt(params.id, 10)
  const { nombre, apellido, telefono, titular, idioma_preferido } = await req.json()
  if (idioma_preferido && !['es', 'ca'].includes(idioma_preferido)) {
    return NextResponse.json({ error: 'Idioma inválido' }, { status: 400 })
  }
  let tel: string | null = null
  if (telefono !== undefined) {
    tel = aE164(String(telefono ?? ''))
    if (!tel) return NextResponse.json({ error: 'Teléfono no válido' }, { status: 400 })
  }
  try {
    await query(
      `UPDATE pacientes SET nombre = COALESCE($2, nombre), apellido = $3,
         telefono = COALESCE($4, telefono),
         titular = COALESCE($5, titular),
         idioma_preferido = COALESCE($6, idioma_preferido), updated_at = NOW()
       WHERE id = $1`,
      [id, nombre?.trim() || null, apellido?.trim() || null, tel, typeof titular === 'boolean' ? titular : null, idioma_preferido || null],
    )
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Ese número ya tiene un titular. Márcalo como Tercero o cambia antes al otro.' }, { status: 409 })
    }
    throw err
  }
  return NextResponse.json({ ok: true })
}

/** Borrado protegido: con citas en el historial no se elimina (trazabilidad). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const id = parseInt(params.id, 10)
  const citas = await query(`SELECT COUNT(*)::int AS n FROM citas WHERE paciente_id = $1`, [id])
  const n = (citas[0] as { n: number } | undefined)?.n ?? 0
  if (n > 0) {
    return NextResponse.json(
      { error: `Tiene ${n} cita${n === 1 ? '' : 's'} en el historial: no se puede eliminar la ficha.` },
      { status: 409 },
    )
  }
  await query('UPDATE confirmaciones_pendientes SET paciente_id = NULL WHERE paciente_id = $1', [id])
  await query('DELETE FROM pacientes WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
