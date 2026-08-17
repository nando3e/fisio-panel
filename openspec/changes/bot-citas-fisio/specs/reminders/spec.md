## ADDED Requirements

### Requirement: Recordatorio según franja de la cita

Las citas de MAÑANA SHALL recordarse el día ANTERIOR a la hora `recordatorio_manana_hora`; las de TARDE SHALL recordarse el MISMO día a la hora `recordatorio_tarde_hora`. El límite entre franjas y ambas horas SHALL ser claves de configuración editables en el panel. El texto SHALL salir de `textos` en el idioma del paciente, con marcadores (nombre, día, hora, fisio, servicio).

#### Scenario: Cita de mañana
- **WHEN** hay cita el martes a las 09:30 y `recordatorio_manana_hora` = 19:00
- **THEN** el recordatorio sale el lunes a partir de las 19:00

#### Scenario: Cita de tarde
- **WHEN** hay cita el martes a las 17:00 y `recordatorio_tarde_hora` = 09:30
- **THEN** el recordatorio sale el martes a partir de las 09:30

### Requirement: Exactamente una vez

La selección de citas a recordar SHALL ser atómica (lease con `FOR UPDATE SKIP LOCKED` + contador de intentos): éxito → `recordada_en` definitivo; fallo → liberación y reintento hasta el máximo. Ni duplicados ni pérdidas ante reinicios o solapes. El scheduler SHALL ejecutar también al arrancar, no solo al cumplirse el intervalo, y SHALL arrancar en dry-run (`RECORDATORIOS_DRY_RUN=true`) hasta validación explícita.

#### Scenario: Reinicio en plena ronda
- **WHEN** el proceso se reinicia después de enviar un recordatorio y antes de terminar la ronda
- **THEN** ese recordatorio no se reenvía y los pendientes salen en la siguiente pasada

### Requirement: Recordatorio en el hilo y sincronización previa

El recordatorio SHALL ir por el mismo canal de la conversación (Chatwoot primero) y registrarse en el historial, para que la respuesta del cliente ("no podré venir") entre con contexto. Antes de decidir a quién avisar, la ronda SHALL sincronizar su ventana con Google Calendar: las citas apuntadas a mano con teléfono en el título también SHALL recibir recordatorio.

#### Scenario: Cita apuntada a mano
- **WHEN** el fisio apunta "Joan 666555444" en su calendario para mañana por la mañana
- **THEN** Joan recibe recordatorio hoy a la hora configurada

### Requirement: Aviso de confirmación pendiente

Una propuesta sin respuesta SHALL generar un único aviso ("¿te guardo la hora?") pasado el plazo configurable (~90 s). El aviso SHALL silenciarse —no borrarse la propuesta— en cuanto el cliente escriba.

#### Scenario: El "sí" no se pierde
- **WHEN** el cliente responde "sí" a una propuesta
- **THEN** la propuesta sigue viva para que `confirmar_cita` la lea; solo se cancela el aviso pendiente

### Requirement: Poda de datos

Un cron interno SHALL podar `agent_traces` a 90 días y `chat_memory` a 30 días.

#### Scenario: Retención acotada
- **WHEN** existen trazas de hace 4 meses
- **THEN** la ronda de poda las elimina sin intervención manual
