import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

/**
 * Identidad del despliegue que responde. PÚBLICO a propósito: sirve para detectar
 * en 2 segundos que el dominio lo está atendiendo otro contenedor (un despliegue
 * zombi con otro Environment), y eso hay que poder verlo SIN poder entrar.
 * No revela credenciales: solo el NOMBRE de la base y qué esquema ve.
 */
export async function GET() {
  const url = process.env.DATABASE_URL ?? ''
  let base = 'desconocida'
  try {
    base = new URL(url).pathname.replace(/^\//, '') || 'desconocida'
  } catch {
    /* URL ilegible: se queda en desconocida */
  }

  let esquema: 'bot' | 'legado' | 'sin-conexion' = 'sin-conexion'
  try {
    const r = await query<{ nuevo: boolean }>(
      `SELECT (to_regclass('public.pacientes') IS NOT NULL AND to_regclass('public.cierres') IS NOT NULL) AS nuevo`,
    )
    esquema = r[0]?.nuevo ? 'bot' : 'legado'
  } catch {
    /* la BD no responde: sin-conexion */
  }

  return NextResponse.json({
    ok: esquema === 'bot',
    app: 'panel',
    base,
    esquema,
    detalle:
      esquema === 'bot'
        ? 'Panel del bot de citas, esquema completo.'
        : esquema === 'legado'
          ? 'ATENCIÓN: conectado a una base sin el esquema del bot (¿despliegue antiguo atendiendo el dominio?).'
          : 'Sin conexión a la base de datos.',
  })
}
