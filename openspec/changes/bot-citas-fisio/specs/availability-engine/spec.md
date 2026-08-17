## ADDED Requirements

### Requirement: Rejilla de inicios y duración por servicio

El sistema SHALL ofrecer únicamente inicios de cita en los minutos definidos por `business_settings.slot_minutes` (p. ej. `00,30`) y SHALL calcular la duración de cada cita como `services.slots_required × paso de la rejilla`. Una única función SHALL decidir la duración y una única función SHALL generar los huecos; ningún otro módulo SHALL duplicar esa aritmética.

#### Scenario: Duración según servicio
- **WHEN** la rejilla es `00,30` (paso 30) y el servicio Fisioterapia tiene `slots_required = 3`
- **THEN** una cita de fisioterapia a las 09:00 ocupa 09:00–10:30 y el inicio 09:30 solo se ofrece si los 90 minutos siguientes están libres

#### Scenario: El hueco debe caber en la ventana
- **WHEN** la ventana de tarde del profesional termina a las 20:00 y el servicio dura 90 minutos
- **THEN** el último inicio ofrecido es 18:30; no se encadena a través del cierre ni de la pausa de comida

### Requirement: Horarios por profesional con herencia del centro

Cada profesional SHALL poder tener reglas de horario propias (franjas, pausa, días) y excepciones por fecha (cerrado u horario especial). Sin reglas propias, el profesional SHALL heredar el horario del centro. Con reglas propias, su disponibilidad efectiva SHALL ser la intersección de sus reglas con las del centro. Las excepciones por fecha del profesional SHALL prevalecer sobre sus reglas semanales.

#### Scenario: Fisio de solo mañanas
- **WHEN** el centro abre 9:00–20:00 y Marta tiene regla propia 9:00–14:00
- **THEN** solo se ofrecen huecos de Marta hasta la hora en que su cadena completa quepa antes de las 14:00

#### Scenario: Excepción puntual
- **WHEN** Oscar tiene una excepción `cerrado` el 2026-09-04
- **THEN** ese día no se ofrece ningún hueco suyo, aunque su regla semanal lo incluya, y los demás fisios no se ven afectados

#### Scenario: Sin reglas propias
- **WHEN** un profesional no tiene ninguna regla propia
- **THEN** su disponibilidad usa el horario del centro tal cual

### Requirement: Ocupación desde Google Calendar

La ocupación SHALL leerse del calendario de cada profesional en cada consulta (paginación completa; eventos de día entero bloquean la jornada con fin exclusivo; eventos cancelados se ignoran). Cualquier evento SHALL contar como ocupación, incluido lo apuntado a mano. Un evento en el calendario blocker ("cierres") SHALL anular la franja para TODOS los profesionales.

#### Scenario: Bloqueo manual desde el móvil
- **WHEN** un fisio crea a mano un evento en su calendario de Google
- **THEN** esos huecos dejan de ofrecerse en la siguiente consulta, sin ninguna acción en el panel

#### Scenario: Cierre del centro
- **WHEN** existe un evento de día completo en el calendario "cierres"
- **THEN** ese día no se ofrece ningún hueco de ningún profesional

### Requirement: Candidatos y reparto

Los profesionales candidatos SHALL limitarse a los asignados al servicio (`service_professionals`) y a lo que dicte la decisión de continuidad. Cuando el paciente diga "cualquiera" y varios tengan hueco en el mismo instante, la asignación SHALL usar round-robin persistente (`last_assigned_professional_id` con `SELECT ... FOR UPDATE`).

#### Scenario: Cualquiera sin repetir horas
- **WHEN** el paciente pide "cualquiera" y dos fisios tienen hueco a las 10:00
- **THEN** la hora se ofrece una sola vez sin nombre de profesional, y al confirmar se asigna por round-robin
