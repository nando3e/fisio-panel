import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export async function POST() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Tabla de usuarios de la app
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_superadmin BOOLEAN DEFAULT FALSE,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // Horarios por día de la semana
    await client.query(`
      CREATE TABLE IF NOT EXISTS business_hours (
        id SERIAL PRIMARY KEY,
        day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        is_open BOOLEAN DEFAULT TRUE,
        start_time TIME,
        end_time TIME,
        lunch_start TIME,
        lunch_end TIME,
        UNIQUE (day_of_week)
      )
    `)

    // Insertar horarios por defecto si la tabla está vacía
    const existing = await client.query('SELECT COUNT(*) FROM business_hours')
    if (parseInt(existing.rows[0].count) === 0) {
      for (let day = 0; day <= 6; day++) {
        const isWeekend = day === 0 || day === 6
        await client.query(`
          INSERT INTO business_hours (day_of_week, is_open, start_time, end_time, lunch_start, lunch_end)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [day, !isWeekend, '09:00', '20:00', null, null])
      }
    }

    // Tabla de documentos RAG
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mimetype TEXT,
        size INTEGER,
        uploaded_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await client.query('COMMIT')
    return NextResponse.json({ ok: true, message: 'Migración completada' })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
