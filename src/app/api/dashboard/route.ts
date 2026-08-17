import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const [citasHoy, citasSemana, citasMes, porProfesional, botEstado, proximas] = await Promise.all([
    query<{ count: string }>(`
      SELECT COUNT(*) FROM citas
      WHERE estado = 'confirmada'
        AND DATE(start_time AT TIME ZONE 'Europe/Madrid') = CURRENT_DATE
    `),
    query<{ count: string }>(`
      SELECT COUNT(*) FROM citas
      WHERE estado = 'confirmada'
        AND start_time >= date_trunc('week', NOW())
        AND start_time < date_trunc('week', NOW()) + interval '7 days'
    `),
    query<{ count: string }>(`
      SELECT COUNT(*) FROM citas
      WHERE estado = 'confirmada' AND start_time >= date_trunc('month', NOW())
    `),
    query<{ name: string; count: string }>(`
      SELECT p.name, COUNT(c.id) as count
      FROM professionals p
      LEFT JOIN citas c ON c.professional_id = p.id
        AND c.estado = 'confirmada'
        AND c.start_time >= date_trunc('week', NOW())
        AND c.start_time < date_trunc('week', NOW()) + interval '7 days'
      WHERE p.is_blocker = false AND p.active = true
      GROUP BY p.id, p.name
      ORDER BY count DESC
    `),
    query<{ activo: boolean }>('SELECT activo FROM bot_estado WHERE id = 1'),
    // LEFT JOIN en servicio y paciente: las citas importadas o apuntadas a mano
    // no tienen servicio asignado y no deben desaparecer del panel.
    query<{ start_time: string; end_time: string; paciente: string | null; professional_name: string | null; service_name: string | null }>(`
      SELECT c.start_time, c.end_time,
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', pa.nombre, pa.apellido)), ''), c.nombre) AS paciente,
             p.name as professional_name, s.name as service_name
      FROM citas c
      LEFT JOIN professionals p ON p.id = c.professional_id
      LEFT JOIN services s ON s.id = c.service_id
      LEFT JOIN pacientes pa ON pa.id = c.paciente_id
      WHERE c.estado = 'confirmada' AND c.start_time >= NOW()
      ORDER BY c.start_time ASC
      LIMIT 8
    `),
  ])

  return NextResponse.json({
    citasHoy: parseInt(citasHoy[0]?.count ?? '0'),
    citasSemana: parseInt(citasSemana[0]?.count ?? '0'),
    citasMes: parseInt(citasMes[0]?.count ?? '0'),
    porProfesional,
    botActivo: botEstado[0]?.activo ?? false,
    proximas,
  })
}
