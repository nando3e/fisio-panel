import { cargarEnvLocal } from '../config/cargarEnvLocal';
cargarEnvLocal();

/**
 * Importador desde la base legada `chatbot` (workflow n8n). SOLO lectura del origen.
 * Idempotente: se puede repetir; los conflictos se ignoran o se actualizan.
 * Uso: IMPORT_SOURCE_URL=postgres://... DATABASE_URL=postgres://.../fisio1 npm run importar
 */

import { Pool } from 'pg';
import { crearPool } from './pool';
import { aE164 } from '../gateway/telefono';

async function importar(): Promise<void> {
  const origenUrl = process.env.IMPORT_SOURCE_URL;
  if (!origenUrl) throw new Error('Falta IMPORT_SOURCE_URL (base chatbot de origen)');
  const origen = new Pool({ connectionString: origenUrl, max: 2 });
  const destino = crearPool();

  const resumen: Record<string, number> = {};

  // 1. Configuración general
  const settings = await origen.query('SELECT * FROM business_settings WHERE id = 1');
  if (settings.rows[0]) {
    const s = settings.rows[0];
    await destino.query(
      `UPDATE business_settings SET slot_minutes=$1, day_start_time=$2, day_end_time=$3, timezone=$4, telefono=$5, updated_at=NOW() WHERE id=1`,
      [s.slot_minutes, s.day_start_time, s.day_end_time, s.timezone, s.telefono],
    );
    resumen.business_settings = 1;
  }

  // 2. Horario del centro
  const reglas = await origen.query('SELECT * FROM business_hour_rules ORDER BY id');
  const hayReglas = await destino.query('SELECT COUNT(*)::int AS n FROM business_hour_rules');
  if (hayReglas.rows[0].n === 0) {
    for (const r of reglas.rows) {
      await destino.query(
        'INSERT INTO business_hour_rules (start_time, end_time, lunch_start, lunch_end, days) VALUES ($1,$2,$3,$4,$5)',
        [r.start_time, r.end_time, r.lunch_start, r.lunch_end, r.days],
      );
    }
    resumen.business_hour_rules = reglas.rows.length;
  }

  // 3. Profesionales y servicios (conservando ids: las citas importadas los referencian)
  const pros = await origen.query('SELECT * FROM professionals ORDER BY id');
  for (const p of pros.rows) {
    await destino.query(
      `INSERT INTO professionals (id, name, calendar_id, active, is_blocker)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, calendar_id=EXCLUDED.calendar_id, active=EXCLUDED.active, is_blocker=EXCLUDED.is_blocker, updated_at=NOW()`,
      [p.id, p.name, p.calendar_id, p.active, p.is_blocker],
    );
  }
  resumen.professionals = pros.rows.length;

  const servicios = await origen.query(`SELECT * FROM services WHERE code <> 'DEFAULT' ORDER BY id`);
  for (const s of servicios.rows) {
    await destino.query(
      `INSERT INTO services (id, name, code, slots_required, active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, code=EXCLUDED.code, slots_required=EXCLUDED.slots_required, active=EXCLUDED.active, updated_at=NOW()`,
      [s.id, s.name, s.code, s.slots_required, s.active],
    );
  }
  resumen.services = servicios.rows.length;

  const cruces = await origen.query('SELECT * FROM service_professionals');
  for (const c of cruces.rows) {
    await destino.query(
      `INSERT INTO service_professionals (service_id, professional_id) VALUES ($1,$2)
       ON CONFLICT (service_id, professional_id) DO NOTHING`,
      [c.service_id, c.professional_id],
    ).catch(() => {}); // cruce hacia servicio DEFAULT descartado
  }

  await destino.query(`SELECT setval('professionals_id_seq', (SELECT COALESCE(MAX(id),1) FROM professionals))`);
  await destino.query(`SELECT setval('services_id_seq', (SELECT COALESCE(MAX(id),1) FROM services))`);

  // 4. Clientes → pacientes titulares
  const clientes = await origen.query('SELECT * FROM clientes ORDER BY id');
  const pacientePorClienteId = new Map<number, number>();
  let pacientesImportados = 0;
  for (const c of clientes.rows) {
    const telefono = aE164(c.telefono);
    if (!telefono) continue;
    const existente = await destino.query('SELECT id FROM pacientes WHERE telefono = $1 AND titular', [telefono]);
    if (existente.rows[0]) { pacientePorClienteId.set(c.id, existente.rows[0].id); continue; }
    const ins = await destino.query(
      `INSERT INTO pacientes (nombre, apellido, telefono, titular, idioma_preferido, created_at)
       VALUES ($1,$2,$3,TRUE,$4,$5) RETURNING id`,
      [c.nombre || null, c.apellido || null, telefono, c.idioma_preferido || null, c.fecha_primera_interaccion ?? new Date()],
    );
    pacientePorClienteId.set(c.id, ins.rows[0].id);
    pacientesImportados++;
  }
  resumen.pacientes = pacientesImportados;

  // 5. Citas futuras (para que el bot nazca sabiendo quién es quién y qué hay en la agenda)
  const citas = await origen.query('SELECT * FROM citas WHERE start_time > NOW() ORDER BY start_time');
  let citasImportadas = 0;
  for (const c of citas.rows) {
    if (!c.google_event_id) continue;
    const pacienteId = c.cliente_id ? pacientePorClienteId.get(c.cliente_id) ?? null : null;
    const cliente = clientes.rows.find((x) => x.id === c.cliente_id);
    await destino.query(
      `INSERT INTO citas (google_event_id, paciente_id, professional_id, service_id, telefono, nombre, start_time, end_time, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmada')
       ON CONFLICT (google_event_id) DO NOTHING`,
      [c.google_event_id, pacienteId, c.professional_id, c.service_id === 100 ? null : c.service_id,
       cliente ? aE164(cliente.telefono) : null, cliente?.nombre ?? null, c.start_time, c.end_time],
    );
    citasImportadas++;
  }
  resumen.citas_futuras = citasImportadas;

  console.log('Importación completada:', JSON.stringify(resumen));
  await origen.end();
  await destino.end();
}

if (require.main === module) {
  importar().catch((e) => { console.error(e); process.exit(1); });
}
