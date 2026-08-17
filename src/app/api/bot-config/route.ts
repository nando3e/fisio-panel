import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { CLAVES_BOT, validarClave } from '@/lib/botConfig'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const rows = await query<{ clave: string; valor: string }>('SELECT clave, valor FROM bot_config')
  const guardadas = new Map(rows.map((r) => [r.clave, r.valor]))
  return NextResponse.json(CLAVES_BOT.map((def) => ({
    ...def,
    valor: guardadas.get(def.clave) ?? def.def,
  })))
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const cuerpo = (await req.json()) as Record<string, string>
  for (const [clave, valor] of Object.entries(cuerpo)) {
    const error = validarClave(clave, String(valor))
    if (error) return NextResponse.json({ error }, { status: 400 })
  }
  for (const [clave, valor] of Object.entries(cuerpo)) {
    await query(
      `INSERT INTO bot_config (clave, valor, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
      [clave, String(valor).trim()],
    )
  }
  return NextResponse.json({ ok: true })
}
