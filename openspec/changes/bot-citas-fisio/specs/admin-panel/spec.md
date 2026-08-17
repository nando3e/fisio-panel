## ADDED Requirements

### Requirement: Panel sobre `fisio1`

El panel SHALL operar íntegramente sobre `fisio1` por hostname interno de la red Docker. El endpoint `/api/migrate` SHALL retirarse: el esquema lo gobiernan las migraciones del bot.

#### Scenario: Config compartida
- **WHEN** el panel edita un servicio o un horario
- **THEN** el bot lo aplica en el siguiente mensaje sin redeploy

### Requirement: Página de pacientes

El panel SHALL ofrecer una página Pacientes con: búsqueda por nombre y teléfono, ficha (datos, idioma, titular/tercero, teléfono compartido visible), historial de citas (fecha, servicio, profesional, estado, motivo) y edición de datos básicos.

#### Scenario: Quién viene mañana y por qué
- **WHEN** el fisio consulta la ficha de un paciente con cita mañana
- **THEN** ve su historial y el motivo de consulta de cada cita

### Requirement: Horarios por profesional

El panel SHALL permitir crear reglas semanales y excepciones por fecha para cada profesional, mostrando el horario efectivo resultante (intersección con el centro). Al cambiar el preset de rejilla, el panel SHALL mostrar la duración en minutos resultante de cada servicio y pedir confirmación.

#### Scenario: Cambio de preset con aviso
- **WHEN** el negocio cambia la rejilla de "cada 30" a "cada 15"
- **THEN** el panel muestra que Fisioterapia pasaría de 90 a 45 minutos y pide confirmación antes de guardar

### Requirement: Ajustes del bot

El panel SHALL exponer: modo de continuidad, idioma por defecto (ca/es), toggle STT, dry-run de recordatorios, horas de recordatorio (mañana/tarde y límite de franja), teléfono de avisos, textos por idioma, kill-switch global y —vía Chatwoot— el flag por contacto. Todos con efecto en caliente.

#### Scenario: Continuidad conmutada
- **WHEN** el negocio pasa la continuidad a `obligatoria` en el panel
- **THEN** el siguiente turno de cualquier recurrente aplica la restricción dura
