## ADDED Requirements

### Requirement: Agente único con todas las tools

El sistema SHALL usar un solo agente LLM con todas las tools disponibles en todo momento (sin router de intenciones), con bucle de tool-calling y tope explícito de iteraciones. Un error de tool SHALL devolverse al modelo como resultado con instrucciones, sin tumbar el turno. El agente SHALL devolver texto; el gateway entrega.

#### Scenario: Cambio de intención a mitad
- **WHEN** el cliente en pleno flujo de reserva pregunta "¿dónde estáis?"
- **THEN** el bot responde la pregunta y retoma la reserva en el mismo turno

#### Scenario: Anular y reagendar en un turno
- **WHEN** el cliente dice "mañana no puedo, pásame al viernes"
- **THEN** el modelo encadena las tools necesarias en un solo turno sin dejar al cliente sin cita ni con dos

### Requirement: Contexto dinámico compuesto por turno

El system prompt SHALL componerse en cada turno, de estable a volátil: prompts versionados de BD + bloque de negocio (nombre, dirección, teléfono, horario derivado de la config) + bloque de paciente (idioma, nombre si se conoce, última visita, instrucción de continuidad) + bloque temporal (fecha/hora actuales, tabla de 21 días con los cerrados MARCADOS —no omitidos—, cierres con fechas resueltas en código). Todo lo que requiera recorrer una lista y aplicar condiciones SHALL calcularse en código; el modelo copia.

#### Scenario: Horario cambiado en el panel
- **WHEN** el negocio cambia una franja horaria en el panel
- **THEN** el siguiente turno anuncia el horario nuevo sin redeploy ni publicación de prompts

#### Scenario: "El miércoles que viene"
- **WHEN** el cliente usa una fecha relativa
- **THEN** el modelo la resuelve leyendo la tabla de días, no contando

### Requirement: Memoria con doble corte

El historial del turno SHALL limitarse a los últimos ~25 mensajes (10-15 pares) Y a un máximo de 6 horas de antigüedad, lo que corte antes.

#### Scenario: Conversación de hace días
- **WHEN** un cliente escribe "Reserva" tres días después de una conversación con lista de horas
- **THEN** el modelo no ve aquella lista y consulta disponibilidad de nuevo

### Requirement: Guardarraíles de respuesta

Si una respuesta contiene una lista de horas y en ese turno no se consultó disponibilidad, el bucle SHALL inyectar un aviso de sistema y repetir el turno (una vez; si insiste, se envía y se registra). Cuando el ejecutor no identifique una cita por fallo del modelo, el bucle SHALL ejecutar el listado por su cuenta e inyectarlo con la instrucción de no volver a preguntar al cliente (máx. 2 reintentos).

#### Scenario: Horas sin consultar
- **WHEN** el modelo redacta tres horas sin haber llamado a `consultar_disponibilidad` en el turno
- **THEN** el turno se repite con el aviso y la respuesta final sale de una consulta real

### Requirement: Proveedor LLM intercambiable

El agente SHALL operar sobre un contrato propio de LLM con adaptadores Anthropic y OpenAI, seleccionados por `LLM_PROVIDER`/`LLM_MODEL` sin cambios de código.

#### Scenario: Cambio de proveedor
- **WHEN** se cambia `LLM_PROVIDER` en el entorno y se reinicia
- **THEN** el bot funciona igual con el otro proveedor, mismo comportamiento de tools
