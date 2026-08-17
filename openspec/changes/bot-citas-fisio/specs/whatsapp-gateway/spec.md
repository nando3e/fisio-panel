## ADDED Requirements

### Requirement: Entrada por webhook de Chatwoot

El sistema SHALL recibir los mensajes por `POST /webhook/chatwoot`, responder 200 de inmediato y procesar en background. SHALL identificar al cliente desde `conversation.meta.sender` (no `sender`), normalizar el teléfono a E.164 una sola vez en el borde, reconocer sus propios mensajes salientes por `source_id` propio y detectar mensajes sin texto utilizable (media, notas de voz).

#### Scenario: Ráfaga de mensajes como un turno
- **WHEN** el cliente envía tres mensajes seguidos dentro de la ventana de agrupación
- **THEN** el bot los procesa como un único turno concatenado y responde una sola vez

#### Scenario: Intervención manual del negocio
- **WHEN** una persona del negocio escribe a mano desde Chatwoot en la conversación
- **THEN** el mensaje se registra en el historial con rol propio (humano del negocio) y el bot no responde a ese mensaje

### Requirement: Kill-switches con registro continuo

El sistema SHALL respetar dos interruptores: el global (`bot_estado.activo`, editable en panel) y el flag `bot` por contacto, cuya única fuente de verdad SHALL ser el atributo del contacto en Chatwoot. Con cualquiera de los dos desactivado, el sistema SHALL seguir registrando TODOS los mensajes en el historial de conversación, sin responder.

#### Scenario: Reactivación con contexto
- **WHEN** el flag `bot` de un contacto estuvo desactivado mientras un humano atendía, y luego se reactiva
- **THEN** el siguiente turno del bot incluye en su memoria lo hablado durante la desactivación (dentro de los cortes de memoria vigentes)

#### Scenario: Comando de soporte
- **WHEN** llega `activabot`/`desactivabot`/`consultabot` desde el número de soporte (comparación por los últimos 9 dígitos exactos)
- **THEN** se ejecuta el comando sobre el estado global sin invocar al agente

### Requirement: Salida por Chatwoot con fallback Evolution

El agente SHALL devolver texto sin enviarlo; el gateway SHALL entregarlo por la API de Chatwoot (para que quede en el hilo del cliente) y, si el contacto no tiene conversación abierta, por Evolution directo. El indicador "escribiendo" SHALL enviarse vía Evolution durante el procesamiento.

#### Scenario: Recordatorio en el hilo
- **WHEN** se envía un mensaje proactivo (recordatorio) a un cliente con conversación en Chatwoot
- **THEN** el mensaje sale por Chatwoot, queda en el hilo, y se registra en el historial como mensaje del bot
