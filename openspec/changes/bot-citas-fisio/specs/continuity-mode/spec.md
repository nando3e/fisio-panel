## ADDED Requirements

### Requirement: Modo de continuidad configurable

El sistema SHALL leer `continuidad_modo` ∈ {`preferida`, `obligatoria`} de la configuración (default y valores desconocidos → `preferida`; caché ≤ 45 s; editable desde el panel con efecto sin redeploy). El modo SHALL resolverse UNA vez por turno para que prompt y tools nunca transmitan modos distintos en el mismo turno.

#### Scenario: Cambio en caliente
- **WHEN** el negocio cambia el modo en el panel
- **THEN** el siguiente turno de cualquier conversación aplica el modo nuevo

### Requirement: Derivación del fisio habitual

"Su fisio" SHALL derivarse del historial real del PACIENTE (no del teléfono): última cita pasada con `estado='confirmada'` en los últimos 365 días. Las citas anuladas NO SHALL fijar continuidad. Si el profesional de esa cita ya no está activo, no hay continuidad. El recurrente SHALL poblarse en el contexto del turno SIEMPRE, en código, al inicio del turno.

#### Scenario: Sin dependencia del modelo
- **WHEN** un recurrente escribe "quiero cita el martes" y el modelo consulta disponibilidad sin invocar ninguna tool de identificación
- **THEN** la restricción de continuidad se aplica igualmente, porque el recurrente se resolvió al construir el turno

### Requirement: Efecto del modo `obligatoria` condicionado al servicio

En `obligatoria`, para un recurrente con fisio habitual conocido: si su fisio está asignado al servicio pedido (`service_professionals`), el sistema SHALL restringir consulta y reserva a ese fisio (sin ofrecer otros ni "cualquiera"; sin hueco → alternativas de SU fisio). Si su fisio NO está asignado al servicio y otro sí, el sistema SHALL abrir a los que sí lo hacen, explicando el motivo (excepción por servicio). La restricción SHALL vivir en código en la capa de reserva, no solo en el prompt.

#### Scenario: Servicio que su fisio hace
- **WHEN** modo `obligatoria`, el paciente de Marta pide fisioterapia y Marta la hace
- **THEN** solo se ofrecen y reservan huecos de Marta

#### Scenario: Excepción por servicio
- **WHEN** modo `obligatoria`, el paciente de Marta pide acupuntura y Marta no la hace pero Oscar sí
- **THEN** se ofrecen huecos de quienes hacen acupuntura, con la explicación de por qué no es con Marta

#### Scenario: Restricción reforzada en código
- **WHEN** el modelo intenta consultar o confirmar con un profesional distinto al forzado
- **THEN** la capa de reserva sobrescribe el candidato y añade la nota conversacional del motivo

#### Scenario: Paciente nuevo no afectado
- **WHEN** modo `obligatoria` y el paciente no tiene historial
- **THEN** flujo normal: profesionales del servicio con opción "cualquiera" y round-robin

### Requirement: Efecto del modo `preferida`

En `preferida`, el bot SHALL proponer por defecto huecos del fisio habitual sin ofrecer la lista de profesionales, y SHALL abrir a otros solo si el paciente lo pide o no hay hueco razonable (diciéndolo antes). Es guía de prompt, sin restricción dura — intencionado.

#### Scenario: Preferencia sin bloqueo
- **WHEN** modo `preferida` y el paciente de Marta pide explícitamente con Oscar
- **THEN** se le ofrece Oscar sin fricción
