## ADDED Requirements

### Requirement: Identificación de citas por fecha y hora

Las tools de gestión SHALL identificar la cita por fecha+hora declaradas (con la tolerancia: si el paciente tiene una sola cita futura, es esa), NUNCA por IDs que el modelo deba recordar entre turnos. Ante varias candidatas sin concreción, el sistema SHALL distinguir `no_reconocida` (el modelo falló: reintentar con el listado inyectado, máx. 2) de `ambigua` (falta concreción del cliente: preguntar).

#### Scenario: Una sola cita futura
- **WHEN** el cliente con una única cita futura dice "no podré venir"
- **THEN** el bot resuelve esa cita sin pedirle fecha y hora

### Requirement: Modificación de una pieza

`modificar_cita` SHALL mover la cita existente (mismo evento de Google, `events.patch`) tras validar: estado confirmada, antelación mínima configurable (`horas_modificacion`) y disponibilidad real del nuevo inicio para el MISMO servicio y según continuidad. Si el nuevo inicio no está libre, la original SHALL quedar intacta y comunicarse cuál sigue vigente. El procedimiento "reserva la nueva y luego anula la vieja" en dos turnos SHALL estar prohibido en los prompts.

#### Scenario: Cambio de día en un turno
- **WHEN** el cliente dice "mañana no podré venir, ¿me cambias al viernes?"
- **THEN** en el mismo turno se consulta disponibilidad del viernes, se mueve la cita y el cliente no queda ni sin cita ni con dos

#### Scenario: Demasiado próxima
- **WHEN** faltan menos horas que el umbral configurado
- **THEN** no se mueve; se ofrece la vía `sustituye_a` (nueva propuesta declarando la cita a sustituir) o el teléfono de la clínica

### Requirement: Sustitución declarada

Cuando un paciente con cita futura proponga una nueva, el sistema SHALL exigir declarar en `sustituye_a` la cita que reemplaza (o "ninguna" explícito). La resolución SHALL ser estricta (sin adivinar) y el ID resuelto SHALL persistirse en la propuesta. Al confirmar, la antigua SHALL anularse DESPUÉS de crear la nueva; si esa anulación falla, el sistema SHALL avisar de que la nueva existe y la antigua sigue viva, y registrar anomalía. Tras un tope de rechazos sin declaración, la propuesta SHALL pasar marcada con anomalía en vez de bloquear la reserva.

#### Scenario: Las dos citas nunca se pierden a la vez
- **WHEN** al confirmar una sustitución falla la anulación de la cita antigua
- **THEN** el cliente conserva las dos citas (estado recuperable), se le comunica y queda anomalía registrada

### Requirement: Anulación sin restricciones

`anular_cita` SHALL funcionar siempre, incluidas citas de hoy. SHALL ser idempotente (`ya_anulada` si repite), hacer soft delete (`estado='anulada'`) tras borrar el evento de Google (404/410 no es error) y devolver CUÁL cita se anuló.

#### Scenario: Anular el mismo día
- **WHEN** el cliente anula una cita de esta tarde
- **THEN** se anula sin fricción y el negocio recibe el aviso de hueco liberado

### Requirement: Aviso de hueco liberado

Una única función SHALL decidir si un hueco liberado se avisa (hoy siempre; `horas_aviso_hueco` amplía la vista), y los TRES caminos que liberan hora (anular, modificar, sustituir) SHALL consultarla. El aviso SHALL ir por Evolution a `telefono_avisos` con nombre, teléfono, fecha/hora y servicio.

#### Scenario: Hueco de hoy
- **WHEN** se libera una hora de hoy por cualquiera de los tres caminos
- **THEN** el negocio recibe el aviso una vez, con los datos para rellenar la hora
