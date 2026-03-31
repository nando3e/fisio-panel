import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { signToken } from '@/lib/auth'
import { query } from '@/lib/db'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  // Superadmin hardcodeado en env
  const superEmail = process.env.SUPERADMIN_EMAIL
  const superPassword = process.env.SUPERADMIN_PASSWORD

  if (email === superEmail && password === superPassword) {
    const token = await signToken({
      userId: 'superadmin',
      email: superEmail!,
      name: 'Super Admin',
      isSuperadmin: true,
    })
    const res = NextResponse.json({ ok: true, name: 'Super Admin', isSuperadmin: true })
    res.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    })
    return res
  }

  // Usuarios de la BD
  const users = await query<{ id: number; name: string; email: string; password_hash: string; is_superadmin: boolean; active: boolean }>(
    'SELECT * FROM app_users WHERE email = $1 AND active = true', [email]
  )

  if (!users.length) {
    return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 })
  }

  const user = users[0]
  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 })
  }

  const token = await signToken({
    userId: String(user.id),
    email: user.email,
    name: user.name,
    isSuperadmin: user.is_superadmin,
  })

  const res = NextResponse.json({ ok: true, name: user.name, isSuperadmin: user.is_superadmin })
  res.cookies.set('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  })
  return res
}
