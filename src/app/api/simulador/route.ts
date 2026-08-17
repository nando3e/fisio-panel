import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

/**
 * Proxy al simulador del bot: misma función del agente con las escrituras
 * interceptadas. El bot vive en la red interna (BOT_URL) y exige ADMIN_TOKEN.
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const botUrl = process.env.BOT_URL
  const adminToken = process.env.BOT_ADMIN_TOKEN
  if (!botUrl || !adminToken) {
    return NextResponse.json({ error: 'Simulador no configurado (BOT_URL / BOT_ADMIN_TOKEN)' }, { status: 503 })
  }

  const { telefono, mensaje } = await req.json()
  if (!telefono || !mensaje) return NextResponse.json({ error: 'Faltan telefono y mensaje' }, { status: 400 })

  try {
    const res = await fetch(`${botUrl.replace(/\/$/, '')}/admin/simular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ telefono, mensaje }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) return NextResponse.json({ error: `Bot HTTP ${res.status}` }, { status: 502 })
    return NextResponse.json(await res.json())
  } catch (err) {
    return NextResponse.json({ error: `No se pudo contactar con el bot: ${err instanceof Error ? err.message : err}` }, { status: 502 })
  }
}
