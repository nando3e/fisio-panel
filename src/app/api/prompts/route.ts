import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { pool, query } from '@/lib/db'

const ROLES = ['identidad', 'reglas', 'reserva', 'gestion', 'general']

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const rol = req.nextUrl.searchParams.get('rol')
  if (rol) {
    const versiones = await query(
      'SELECT id, rol, version, contenido, activo, nota, created_at FROM prompts WHERE rol = $1 ORDER BY version DESC LIMIT 20',
      [rol],
    )
    return NextResponse.json(versiones)
  }
  const activos = await query(
    'SELECT id, rol, version, contenido, activo, created_at FROM prompts WHERE activo ORDER BY rol',
  )
  return NextResponse.json({ roles: ROLES, activos })
}

/** Publicar = versión NUEVA activa. El histórico no se pisa nunca. */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { rol, contenido, nota } = await req.json()
  if (!ROLES.includes(rol) || !contenido?.trim()) {
    return NextResponse.json({ error: 'rol o contenido inválidos' }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const max = await client.query('SELECT COALESCE(MAX(version),0)::int AS v FROM prompts WHERE rol = $1', [rol])
    await client.query('UPDATE prompts SET activo = FALSE WHERE rol = $1 AND activo', [rol])
    const ins = await client.query(
      'INSERT INTO prompts (rol, version, contenido, activo, nota) VALUES ($1,$2,$3,TRUE,$4) RETURNING id, rol, version',
      [rol, max.rows[0].v + 1, contenido, nota || `editado por ${session.email}`],
    )
    await client.query('COMMIT')
    return NextResponse.json(ins.rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}

/** Reactivar una versión anterior (rollback). */
export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await req.json()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const fila = await client.query('SELECT rol FROM prompts WHERE id = $1', [id])
    if (!fila.rows[0]) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'No existe' }, { status: 404 }) }
    await client.query('UPDATE prompts SET activo = FALSE WHERE rol = $1 AND activo', [fila.rows[0].rol])
    await client.query('UPDATE prompts SET activo = TRUE WHERE id = $1', [id])
    await client.query('COMMIT')
    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
