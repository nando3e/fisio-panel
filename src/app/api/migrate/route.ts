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

    // Reglas de horario (reemplaza business_hours por día)
    await client.query(`
      CREATE TABLE IF NOT EXISTS business_hour_rules (
        id SERIAL PRIMARY KEY,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        lunch_start TIME,
        lunch_end TIME,
        days TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // Insertar regla por defecto si la tabla está vacía
    const existing = await client.query('SELECT COUNT(*) FROM business_hour_rules')
    if (parseInt(existing.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO business_hour_rules (start_time, end_time, lunch_start, lunch_end, days)
        VALUES ('09:00', '20:00', NULL, NULL, '1,2,3,4,5')
      `)
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
