## ADDED Requirements

### Requirement: Reserva en dos pasos con estado comprobable

Reservar SHALL ser dos tools: `proponer_cita` (valida disponibilidad, guarda la propuesta en `confirmaciones_pendientes` con PK teléfono, devuelve el resumen) y `confirmar_cita` SIN parámetros (lee la propuesta viva, revalida disponibilidad, crea el evento en Google y lo refleja en `citas`). Sin propuesta viva, `confirmar_cita` SHALL negarse a escribir. Proponer de nuevo SHALL sobrescribir la propuesta anterior.

#### Scenario: Sin propuesta no hay escritura
- **WHEN** el modelo invoca `confirmar_cita` sin que exista una propuesta viva para ese teléfono
- **THEN** no se escribe nada y se pide al modelo retomar el flujo de propuesta

#### Scenario: Cambio de parámetros a mitad
- **WHEN** el cliente cambia de día, servicio o persona después de ver el resumen
- **THEN** la propuesta anterior queda sustituida y la confirmación posterior reserva exactamente lo último propuesto

### Requirement: Anclaje a hueco real e idempotencia

El sistema NUNCA SHALL reservar el instante que teclee el modelo: el inicio SHALL re-resolverse contra los huecos reales vigentes (match exacto de ISO; tolerancia de año/zona por hora de pared solo si es inequívoca; si nada casa, se re-ofrecen huecos sin escribir). Antes de crear, el sistema SHALL comprobar que el mismo paciente no tiene ya una cita confirmada en el mismo inicio (idempotencia por paciente + instante).

#### Scenario: El modelo se equivoca de año
- **WHEN** el modelo propone `2025-09-03T10:00` y el único hueco real a esa hora de pared es `2026-09-03T10:00+02:00`
- **THEN** se ancla al hueco real de 2026 sin pedir nada al cliente

#### Scenario: Doble "sí"
- **WHEN** el cliente confirma dos veces seguidas la misma propuesta
- **THEN** existe una sola cita; la segunda confirmación devuelve la cita ya creada sin duplicar

### Requirement: Motivo de consulta

`proponer_cita` SHALL aceptar un `motivo` opcional (p. ej. "dolor de rodilla") que SHALL persistirse en `citas.motivo` y en la DESCRIPCIÓN del evento de Google (nunca en el título). La ausencia de motivo NO SHALL bloquear la reserva.

#### Scenario: Motivo visible para el fisio
- **WHEN** un paciente reserva indicando "me duele la zona lumbar"
- **THEN** el evento de Google lleva el motivo en la descripción y la ficha de la cita lo muestra en el panel

### Requirement: Reserva para otra persona

Si el paciente se identificó solo por teléfono y el nombre de pila dado no coincide con la ficha del titular, el sistema NO SHALL reservar sin preguntar si la cita es para el titular o para otra persona. Con `para_otra_persona`, la cita SHALL asociarse a la ficha del tercero (creándola si no existe, mismo teléfono de contacto) sin modificar la ficha del titular.

#### Scenario: La pareja reserva desde el mismo número
- **WHEN** el número es de Fernando y quien reserva dice llamarse Laura
- **THEN** el bot pregunta para quién es; si es para Laura, se crea/usa su ficha con ese teléfono y la cita cuelga de ella; el historial y la continuidad de Fernando no cambian

### Requirement: Respeto de la continuidad al escribir

`confirmar_cita` SHALL aplicar la misma decisión de continuidad que `consultar_disponibilidad`: en `force`, el profesional SHALL ser el habitual del paciente aunque el modelo proponga otro; en `exception`, la agenda previa SHALL descartarse.

#### Scenario: Modelo desobediente
- **WHEN** el modo es `obligatoria`, su fisio ofrece el servicio, y el modelo intenta confirmar con otro profesional
- **THEN** la cita se crea con su fisio habitual, no con el propuesto
