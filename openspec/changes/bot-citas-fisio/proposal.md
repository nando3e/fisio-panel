# Proposal: bot-citas-fisio

## Why

Hoy las citas de la clínica de fisioterapia las gestiona el workflow n8n "citas - agendador" sobre la base `chatbot`, con las limitaciones ya conocidas de ese modelo (lógica atrapada en nodos, sin tests, motor de disponibilidad no versionable) y con una rigidez concreta: los slots son fijos, sin respetar la rejilla de inicio ni la duración por servicio que el panel ya configura. Los proyectos balta y nubimed demostraron que reescribir el bot como servicio en código es viable, más fiable y mantenible. Este cambio construye ese servicio para la clínica de fisio, combinando: el motor de disponibilidad y la gestión de citas de balta (Google Calendar como fuente de verdad), la continuidad asistencial y la identificación de pacientes de nubimed, y la configuración en caliente desde el panel Next.js existente.

## What Changes

- **BREAKING**: el workflow n8n "citas - agendador" deja de ser el runtime; se sustituye por un servicio Node/TypeScript en `/bot` (monorepo con el panel). n8n queda inactivo tras el cutover (crons desactivados).
- **BREAKING**: la base de datos operativa pasa de `chatbot` a `fisio1` (misma instancia Postgres, extensión pgvector). El panel se reapunta a `fisio1`. `chatbot` queda intacta como origen de importación hasta el cutover.
- **Esquema nuevo en `fisio1`** gobernado por migraciones numeradas en `/bot`: entidad `pacientes` (teléfono NO único: titular + terceros por número), `citas` con estado/motivo/columnas de recordatorio, horarios y excepciones por profesional, `prompts` versionados, `textos` por idioma, `agent_traces`, `confirmaciones_pendientes`, config clave-valor, chunks RAG con pgvector.
- **Gateway WhatsApp**: webhook de Chatwoot con gates, debounce por teléfono, kill-switch global + flag `bot` por contacto (Chatwoot como única fuente de verdad), registro del historial aunque el bot esté desactivado, entrega por Chatwoot con fallback Evolution.
- **Agente único** con todas las tools (consultar, proponer, confirmar, listar, modificar, anular, identificar, info RAG), contexto dinámico por turno (fecha, tabla de 21 días, bloque de negocio, bloque de paciente con última visita calculada), memoria limitada (10-15 pares y 6 h), idioma por defecto del panel + detección del idioma del paciente.
- **Motor de disponibilidad propio**: rejilla de inicios desde `business_settings.slot_minutes`, duración por servicio (`slots_required` × paso), horarios por profesional con herencia del centro, ocupación desde Google Calendar (calendario por fisio + blocker "cierres").
- **Continuidad asistencial** modo `preferida`/`obligatoria` como nubimed, con excepción por servicio y restricción reforzada en código, resuelta al inicio del turno.
- **Recordatorios**: citas de mañana → aviso el día anterior; citas de tarde → aviso esa misma mañana; horas configurables en el panel; envío exactamente-una-vez con lease; arranque en dry-run; sincronización bidireccional con Google Calendar.
- **RAG** sobre los documentos del panel con pgvector (no Qdrant) para preguntas generales de la clínica.
- **STT de notas de voz** con interruptor en el panel; si está desactivado, respuesta cortés como balta.
- **Panel ampliado**: página Pacientes (historial, quién es quién), horarios/excepciones por fisio, modo de continuidad, idioma por defecto, toggles (STT, dry-run recordatorios), textos, prompts versionados, trazas y simulador de conversación.
- **Infra**: Evolution API como instancia propia del cliente en el stack CITAS; Postgres se une a `dokploy-network` para que panel y bot accedan por hostname interno; base `fisio1` y `evolution` en el init del stack.

## Capabilities

### New Capabilities

- `whatsapp-gateway`: entrada por webhook de Chatwoot (gates, debounce, dedup de ecos, comandos de soporte), salida por Chatwoot con fallback Evolution, kill-switch global y por contacto con registro continuo del historial.
- `availability-engine`: cálculo de huecos por profesional y servicio — rejilla de inicios configurable, duración por servicio, horarios por profesional con herencia del centro y excepciones por fecha, ocupación real desde Google Calendar y calendario blocker.
- `appointment-booking`: flujo de reserva en dos pasos (proponer/confirmar) con motivo de consulta, anclaje a hueco real, idempotencia, reserva para otra persona y respeto de la continuidad.
- `appointment-management`: listar, modificar de una pieza (con `sustituye_a` como respaldo), anular sin restricciones y aviso al negocio de hueco liberado.
- `patient-registry`: entidad paciente independiente del teléfono (titular + terceros), reconocimiento por número, salvaguarda de nombre, historial por paciente y sugerencia de repetición del último servicio.
- `continuity-mode`: modo `preferida`/`obligatoria` global con excepción por servicio, derivado del historial real y reforzado en código.
- `conversation-agent`: agente LLM único con bucle de tool-calling, contexto dinámico, memoria limitada, idioma detectado y guardarraíles (huecos solo tras consultar, reintento con listado).
- `reminders`: recordatorios según franja (mañana/tarde), confirmación pendiente, sincronización con Google Calendar y poda de datos.
- `rag-answers`: ingesta de los documentos del panel a pgvector y tool de consulta para preguntas generales.
- `voice-transcription`: transcripción de notas de voz con interruptor en panel y degradación cortés.
- `agent-observability`: prompts versionados editables en caliente, trazas por turno con atribución y simulador.
- `admin-panel`: páginas y ajustes nuevos del panel Next.js sobre `fisio1`.

### Modified Capabilities

<!-- Ninguna: openspec/specs/ está vacío; es greenfield en código. -->

## Impact

- **Runtime nuevo**: contenedor `/bot` (Fastify) como segunda app Dokploy del mismo repo; el panel sigue siendo la primera. Ambos en el proyecto CITAS sobre `dokploy-network`.
- **Datos**: `fisio1` pasa a ser la única base operativa (bot + panel). Importador desde `chatbot` (config, profesionales, servicios, clientes, citas futuras). `chatbot` en solo-lectura desde el nuevo stack hasta su retirada.
- **Integraciones**: Chatwoot HTTP API (interno), Evolution API propia (instancia nueva del stack), Google Calendar v3 con service account (calendarios de los fisios + "cierres" compartidos con la SA — prerequisito operativo), proveedor LLM y proveedor de embeddings por env.
- **Migración/convivencia**: shadow inbox en Chatwoot contra el bot nuevo mientras n8n sigue en producción; cutover = reapuntar webhook + desactivar crons de n8n; rollback = revertir el webhook.
- **Cumplimiento**: el motivo de consulta es dato de salud — viaja en la descripción del evento (no en el título), y hay poda programada de trazas (90 días) e historial (30 días).
