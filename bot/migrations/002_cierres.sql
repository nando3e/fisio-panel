-- Cierres del centro programados desde el panel (vacaciones, festivos, obras…).
-- El bot no ofrece esos días aunque el calendario de Google esté libre, y usa
-- `mensaje` para explicar el motivo al paciente.
CREATE TABLE IF NOT EXISTS cierres (
  id         SERIAL PRIMARY KEY,
  desde      DATE NOT NULL,
  hasta      DATE NOT NULL,
  motivo     TEXT,               -- etiqueta corta: "Vacaciones", "Festivo local"…
  mensaje    TEXT,               -- lo que el bot dice al paciente, tal cual
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (hasta >= desde)
);
CREATE INDEX IF NOT EXISTS idx_cierres_hasta ON cierres (hasta);
