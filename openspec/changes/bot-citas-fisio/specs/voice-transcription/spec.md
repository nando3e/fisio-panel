## ADDED Requirements

### Requirement: Transcripción con interruptor en panel

Con `stt_activado` (clave de config editable en panel) activo, las notas de voz SHALL transcribirse vía endpoint compatible configurado por entorno, usando el catálogo de servicios y los nombres de los fisios como prompt de sesgo, y el texto resultante SHALL entrar al turno como un mensaje más.

#### Scenario: Audio con nombre de servicio
- **WHEN** un paciente manda un audio pidiendo "hora per acupuntura amb l'Oscar"
- **THEN** la transcripción respeta "acupuntura" y "Oscar" y el flujo continúa como si fuera texto

### Requirement: Degradación cortés

Con `stt_activado` desactivado, o ante fallo de transcripción, el bot SHALL responder con un mensaje cortés pidiendo el mensaje por escrito (texto de `textos`, en el idioma del paciente), sin romper el turno ni perder el estado de la conversación.

#### Scenario: STT apagado
- **WHEN** el toggle está desactivado y llega una nota de voz
- **THEN** el bot pide amablemente texto y la conversación puede continuar donde estaba
