## ADDED Requirements

### Requirement: Prompts versionados editables en caliente

Los prompts SHALL vivir en la tabla `prompts` por rol, con versiones y una sola activa por rol (índice único parcial). Publicar SHALL crear versión nueva sin sobrescribir el histórico. El registro SHALL resolver la versión activa con caché de TTL corto (≤ 45 s). La semilla SHALL insertar solo lo que falta, sin pisar ediciones. El panel SHALL mostrar diff entre versiones antes de publicar.

#### Scenario: Ajuste de tono sin desplegar
- **WHEN** el negocio edita el prompt de identidad desde el panel
- **THEN** el cambio se aplica en menos de un minuto y queda la versión anterior recuperable

### Requirement: Traza por turno

Cada turno SHALL registrar en `agent_traces`: teléfono, mensaje, respuesta, tools con argumentos y extracto del resultado (~400 chars), modelo, versiones de prompt implicadas, tokens, duración y error. La traza SHALL escribirse aunque falle el envío. Las anomalías de negocio (p. ej. cliente con dos citas futuras) SHALL registrarse con marca buscable.

#### Scenario: Investigar una mala respuesta
- **WHEN** el negocio reporta "ayer contestó una tontería"
- **THEN** la traza permite ver qué tools se llamaron con qué argumentos, qué devolvieron y qué versión de prompt produjo el texto

### Requirement: Simulador para el negocio

El panel SHALL ofrecer un simulador de conversación que use la misma función del agente con las tools de escritura interceptadas y marcadas como simuladas, sin enviar mensajes ni tocar la agenda.

#### Scenario: Probar sin riesgo
- **WHEN** el negocio escribe "vull hora demà" en el simulador
- **THEN** ve la respuesta real del bot (huecos reales) sin que se cree ninguna cita ni salga ningún WhatsApp
