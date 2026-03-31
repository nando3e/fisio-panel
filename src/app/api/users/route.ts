import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'

async function requireSuperadmin() {
  const session = await getSession()
  if (!session?.isSuperadmin) return null
  return session
}

export async function GET() {
  if (!await requireSuperadmin()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const rows = await query('SELECT id, name, email, is_superadmin, active, created_at FROM app_users ORDER BY id')
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  if (!await requireSuperadmin()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const { name, email, password, is_superadmin } = await req.json()
  const hash = await bcrypt.hash(password, 12)
  try {
    const rows = await query(
      'INSERT INTO app_users (name, email, password_hash, is_superadmin) VALUES ($1,$2,$3,$4) RETURNING id, name, email, is_superadmin, active, created_at',
      [name, email, hash, is_superadmin ?? false]
    )
    return NextResponse.json(rows[0])
  } catch {
    return NextResponse.json({ error: 'El email ya existe' }, { status: 409 })
  }
}

export async function PUT(req: NextRequest) {
  if (!await requireSuperadmin()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const { id, name, email, password, is_superadmin, active } = await req.json()

  if (password) {
    const hash = await bcrypt.hash(password, 12)
    await query(
      'UPDATE app_users SET name=$1, email=$2, password_hash=$3, is_superadmin=$4, active=$5, updated_at=NOW() WHERE id=$6',
      [name, email, hash, is_superadmin, active, id]
    )
  } else {
    await query(
      'UPDATE app_users SET name=$1, email=$2, is_superadmin=$3, active=$4, updated_at=NOW() WHERE id=$5',
      [name, email, is_superadmin, active, id]
    )
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  if (!await requireSuperadmin()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const { id } = await req.json()
  await query('DELETE FROM app_users WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
