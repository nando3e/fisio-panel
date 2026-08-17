-- 001_base.sql — esquema completo de fisio1. Idempotente.
-- Única fuente de esquema del proyecto (panel incluido); ver openspec/changes/bot-citas-fisio/design.md D1.

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Usuarios del panel ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_superadmin BOOLEAN DEFAULT FALSE,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Configuración general (rejilla, TZ) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_settings (
  id                            INTEGER PRIMARY KEY DEFAULT 1,
  slot_minutes                  TEXT NOT NULL DEFAULT '00,30',
  day_start_time                TIME NOT NULL DEFAULT '08:00',
  day_end_time                  TIME NOT NULL DEFAULT '21:00',
  timezone                      TEXT NOT NULL DEFAULT 'Europe/Madrid',
  telefono                      TEXT,
  last_assigned_professional_id INTEGER,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO business_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Horario del centro ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_hour_rules (
  id          SERIAL PRIMARY KEY,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  lunch_start TIME,
  lunch_end   TIME,
  days        TEXT NOT NULL,          -- '1,2,3,4,5' (1=lunes ... 7=domingo)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Profesionales y servicios ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS professionals (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_blocker  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS services (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  code           TEXT NOT NULL UNIQUE,
  slots_required INTEGER NOT NULL CHECK (slots_required >= 1),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_professionals (
  id              SERIAL PRIMARY KEY,
  service_id      INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  UNIQUE (service_id, professional_id)
);

-- ── Horarios por profesional (D5): herencia del centro + intersección ───────
CREATE TABLE IF NOT EXISTS professional_hour_rules (
  id              SERIAL PRIMARY KEY,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  lunch_start     TIME,
  lunch_end       TIME,
  days            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_phr_professional ON professional_hour_rules (professional_id);

CREATE TABLE IF NOT EXISTS professional_exceptions (
  id              SERIAL PRIMARY KEY,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  fecha           DATE NOT NULL,           -- inicio (inclusive)
  hasta           DATE,                    -- fin (inclusive); NULL = solo `fecha`
  tipo            TEXT NOT NULL CHECK (tipo IN ('cerrado', 'horario')),
  ventanas        JSONB,                   -- [{"desde":"09:00","hasta":"13:00"}] cuando tipo='horario'
  nota            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pex_professional_fecha ON professional_exceptions (professional_id, fecha);

-- ── Pacientes (D7): el teléfono es contacto, NO identidad ───────────────────
CREATE TABLE IF NOT EXISTS pacientes (
  id               SERIAL PRIMARY KEY,
  nombre           TEXT,
  apellido         TEXT,
  telefono         TEXT NOT NULL,           -- E.164 (+34...), NO único: titular + terceros
  titular          BOOLEAN NOT NULL DEFAULT TRUE,
  idioma_preferido TEXT,                    -- 'ca' | 'es' | NULL (usa default del panel)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pacientes_telefono ON pacientes (telefono);
-- Un solo titular por teléfono
CREATE UNIQUE INDEX IF NOT EXISTS idx_pacientes_titular ON pacientes (telefono) WHERE titular;

-- ── Citas: espejo local de Google Calendar ──────────────────────────────────
CREATE TABLE IF NOT EXISTS citas (
  id                       SERIAL PRIMARY KEY,
  google_event_id          TEXT UNIQUE,
  paciente_id              INTEGER REFERENCES pacientes(id),
  professional_id          INTEGER REFERENCES professionals(id),
  service_id               INTEGER REFERENCES services(id),
  telefono                 TEXT,             -- redundante para citas importadas sin paciente
  nombre                   TEXT,
  start_time               TIMESTAMPTZ NOT NULL,
  end_time                 TIMESTAMPTZ NOT NULL,
  estado                   TEXT NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada', 'anulada')),
  motivo                   TEXT,             -- dato de salud: nunca en títulos ni logs
  recordada_en             TIMESTAMPTZ,
  recordatorio_intentos    INTEGER NOT NULL DEFAULT 0,
  recordatorio_lease_hasta TIMESTAMPTZ,
  recordatorio_error       TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_citas_pendientes_recordar ON citas (start_time) WHERE recordada_en IS NULL AND estado = 'confirmada';
CREATE INDEX IF NOT EXISTS idx_citas_paciente ON citas (paciente_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_citas_telefono ON citas (telefono, start_time DESC);

-- ── Estado y configuración del bot ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_estado (
  id                 INTEGER PRIMARY KEY,
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_modificacion TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO bot_estado (id, activo) VALUES (1, TRUE) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS bot_config (
  clave       TEXT PRIMARY KEY,
  valor       TEXT NOT NULL,
  descripcion TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Conversación ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_memory (
  id         BIGSERIAL PRIMARY KEY,
  session_id VARCHAR(32) NOT NULL,      -- teléfono E.164
  message    JSONB NOT NULL,            -- {type: 'human'|'ai'|'humano_negocio', content}
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_memory_session ON chat_memory (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS confirmaciones_pendientes (
  telefono           TEXT PRIMARY KEY,
  paciente_id        INTEGER REFERENCES pacientes(id),
  professional_id    INTEGER,            -- NULL = "cualquiera" (round-robin al confirmar)
  service_id         INTEGER NOT NULL,
  inicio             TIMESTAMPTZ NOT NULL,
  motivo             TEXT,
  para_nombre        TEXT,
  para_apellido      TEXT,
  para_otra_persona  BOOLEAN NOT NULL DEFAULT FALSE,
  resumen            TEXT,
  sustituye_event_id TEXT,
  avisado            BOOLEAN NOT NULL DEFAULT FALSE,
  silenciado         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Prompts versionados y textos fijos ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS prompts (
  id         SERIAL PRIMARY KEY,
  rol        TEXT NOT NULL,
  version    INTEGER NOT NULL,
  contenido  TEXT NOT NULL,
  activo     BOOLEAN NOT NULL DEFAULT FALSE,
  nota       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rol, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_activo ON prompts (rol) WHERE activo;

CREATE TABLE IF NOT EXISTS textos (
  clave      TEXT NOT NULL,
  idioma     TEXT NOT NULL,
  contenido  TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clave, idioma)
);

-- ── Trazas ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_traces (
  id             BIGSERIAL PRIMARY KEY,
  telefono       TEXT NOT NULL,
  mensaje        TEXT,
  respuesta      TEXT,
  tools          JSONB,       -- nombres
  tools_detalle  JSONB,       -- [{nombre, args, resultado(<=400 chars)}]
  modelo         TEXT,
  prompt_versions JSONB,
  tokens_in      INTEGER,
  tokens_out     INTEGER,
  duracion_ms    INTEGER,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_traces_telefono ON agent_traces (telefono, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_created ON agent_traces (created_at);

-- ── Documentos RAG (panel sube; bot consulta) ───────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id            SERIAL PRIMARY KEY,
  filename      TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mimetype      TEXT,
  size          INTEGER,
  uploaded_by   TEXT,
  chunks_count  INTEGER NOT NULL DEFAULT 0,
  ingest_error  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id          SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk       TEXT NOT NULL,
  embedding   vector(1536),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks (document_id);
