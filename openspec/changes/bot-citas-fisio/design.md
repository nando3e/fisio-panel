# Design: bot-citas-fisio

## Context

El panel Next.js ya existe y edita en `chatbot`: `services` (con `slots_required`), `professionals` (con `calendar_id` de Google y un calendario blocker "cierres"), `service_professionals`, `business_settings` (`slot_minutes` = rejilla de inicios, `timezone`, `last_assigned_professional_id`), `business_hour_rules` y `bot_estado`. El workflow n8n "citas - agendador" opera sobre esa base con slots fijos. Los proyectos de referencia están diseccionados: balta aporta el motor de disponibilidad sobre Google Calendar, la gestión de citas y los recordatorios; nubimed aporta la continuidad, la identificación de pacientes y la metodología. La guía PLANTILLA-CHATBOT.md fija la arquitectura común (agente único, reglas duras en ejecutor, dos pasos de escritura, config en BD, contexto dinámico).

## Goals / Non-Goals

**Goals:**
- Bot de reservas por WhatsApp que respete rejilla de inicios y duración por servicio configuradas en el panel, con multi-profesional real.
- Continuidad asistencial equivalente a nubimed, sin su hueco conocido (resolución del recurrente dependiente del LLM).
- Gestión de pacientes (titular y terceros por teléfono) con historial visible en el panel.
- Idioma ca/es con default en panel y detección por paciente.
- RAG y STT desde la fase 1, ambos gobernados desde el panel.
- Convivencia con n8n hasta un cutover reversible.

**Non-Goals:**
- No hay reservas de grupo (el encadenado de balta): cada cita es individual; "venimos dos" son dos reservas.
- No se integra la API de Nubimed: la fuente de agenda es Google Calendar.
- No se tocan los flujos de n8n existentes (solo lectura de `chatbot` para importar).
- Sin listas interactivas de Meta (canal Evolution, texto plano numerado).
- Sin pagos, sin recetas, sin historial clínico más allá del motivo de consulta.

## Decisions

### D1. Monorepo: `/bot` como servicio aparte; las migraciones viven en el bot
El panel Next.js queda en la raíz; `/bot` es un servicio Fastify + TypeScript con su `package.json`, Dockerfile y migraciones SQL numeradas e idempotentes. El panel deja de migrar esquema (se retira `/api/migrate`): una sola fuente de esquema. En Dokploy son dos aplicaciones del mismo repo con build path distinto.
- *Alternativa descartada:* bot como rutas API de Next.js. El debounce en memoria, el scheduler y el bucle del agente necesitan un proceso de larga vida; Next no lo garantiza.

### D2. `fisio1` como única base; `chatbot` intocada hasta el cutover
Bot y panel comparten `fisio1`. De `chatbot` solo se lee (importador de config, profesionales, servicios, clientes y citas futuras). Es el patrón de migración de la guía (§15): el workflow viejo sigue vivo, el corte es un cable.

### D3. Google Calendar como fuente de verdad de ocupación; `citas` como espejo local
Como balta: cualquier evento del calendario del fisio cuenta como ocupación (incluido lo apuntado a mano); el calendario "cierres" (blocker) anula el día/franja para todos. `citas` en `fisio1` es el espejo con `google_event_id` UNIQUE, `estado` (`confirmada`/`anulada`, soft delete), `motivo`, `paciente_id`, `professional_id`, `service_id` y columnas de recordatorio. Sincronización bidireccional periódica (borrados a mano → anular espejo; apuntes a mano → alta con parseo de teléfono del título).

### D4. Duración = `slots_required` × paso de la rejilla; el riesgo del preset se avisa en panel
La rejilla de inicios sale de `business_settings.slot_minutes` (p. ej. `00,30` → paso 30 min) y la duración de cada servicio es `slots_required × paso`. Cambiar el preset cambia TODAS las duraciones: el panel lo muestra en minutos calculados junto a cada servicio y pide confirmación al cambiar el preset. Un único módulo (`duracionServicio()`, `huecosDelDia()`) decide duración y huecos, como en balta.
- *Alternativa descartada:* duración en minutos por servicio desacoplada de la rejilla. Más robusta pero rompe el modelo mental ya desplegado del panel; se puede migrar después sin tocar el motor (solo la función de duración).

### D5. Horarios por profesional con herencia del centro
Tablas `professional_hour_rules` (mismo formato que `business_hour_rules` + `professional_id`) y `professional_exceptions` (`fecha` o rango, `tipo` `cerrado`|`horario`, `ventanas` jsonb, nota). Regla de composición: sin reglas propias → hereda el horario del centro; con reglas → **intersección** con el centro (el centro es el techo). Las excepciones del profesional mandan sobre sus reglas semanales. Los cierres del centro siguen en el calendario blocker (le funciona a la clínica y no se duplica fuente).
- *Alternativa descartada:* horario del profesional como override completo del centro. Permite que un fisio "abra" cuando el centro cierra — error más probable que caso de uso.

### D6. Continuidad como nubimed, con el recurrente resuelto en código al inicio del turno
Clave `continuidad_modo` (`preferida` default | `obligatoria`) en config, caché 45 s, editable en panel. "Su fisio" = profesional de la última cita pasada con `estado='confirmada'` (la exclusión de canceladas es nativa aquí: las anuladas tienen estado propio). Excepción por servicio vía `service_professionals` (dato local y completo: no existe el caso `sin-datos` de nubimed; si un servicio no tiene profesionales asignados es un error de config que el panel debe impedir). Decisión tri-estado en la capa de reserva (`none`/`force`/`exception`) aplicada en `consultar_disponibilidad` y `confirmar_cita`. **Corrección sobre nubimed:** el recurrente (`pacienteId`, `ultimoFisio`, `ultimoServicio`) se resuelve SIEMPRE al construir el contexto del turno, desde `fisio1`, sin depender de que el modelo llame a una tool. En `preferida` la guía es de prompt (como nubimed, intencionado).

### D7. `pacientes` como entidad; el teléfono es contacto, no identidad
Tabla `pacientes` (`id`, `nombre`, `apellido`, `telefono` indexado NO único, `titular` boolean, `idioma_preferido`, `created_at`, `updated_at`). Un número puede tener al titular y a terceros; `citas.paciente_id` referencia a la persona; historial y continuidad son POR PACIENTE. Resolución en el turno: teléfono → candidatos; el titular es el presunto; si el nombre de pila dado no coincide con la ficha del titular (comparación normalizada, conservadora ante ausencia de dato), NO se reserva sin preguntar "¿es para ti o para otra persona?". `para_otra_persona` en la propuesta crea/usa la ficha del tercero sin pisar la del titular. Protecciones de balta: lista de nombres de relleno, los datos guardados mandan sobre lo que diga el modelo, `COALESCE` en upserts.
- *Alternativa descartada:* `clientes` con teléfono UNIQUE (balta/nubimed). Imposibilita historial y continuidad correctos para la pareja/hijo que reserva desde el mismo número — requisito explícito.

### D8. Primera visita como servicio; sugerencia de repetición calculada en código
"Primera visita" es una fila de `services` con sus profesionales y duración; es lo que se ofrece a pacientes sin historial. Para el recurrente con intención vaga, el bloque de paciente del system prompt lleva ya calculado: fecha, servicio y fisio de su última cita ("Última visita: fisioterapia con Marta, hace 6 días"). El prompt instruye proponer la continuación natural. El modelo copia, no deduce.

### D9. Escrituras en dos pasos; citas referenciadas por fecha+hora
`proponer_cita` (valida, guarda en `confirmaciones_pendientes`, PK teléfono, revalida disponibilidad) y `confirmar_cita` **sin parámetros** (lee la propuesta, revalida, escribe en Google, refleja en `citas`, anula la sustituida DESPUÉS de crear). Anclaje anti-alucinación: nunca se reserva el instante que teclee el modelo; se re-resuelve contra huecos reales con tolerancia de año/zona (patrón `resolveBookingSlot` de nubimed). Idempotencia por `(paciente, inicio)`. Las tools de gestión identifican citas por fecha+hora, nunca por ID (los resultados de tools no persisten entre turnos).

### D10. Idioma: default de panel + detección por mensajes; textos fijos por idioma
Ajuste `idioma_por_defecto` (`ca`|`es`) en config. El idioma efectivo del turno: `pacientes.idioma_preferido` si existe; si no, el default. Detección: heurística en código sobre los últimos mensajes del paciente (marcadores léxicos ca/es), actualiza `idioma_preferido` cuando hay señal clara. El system prompt lleva un bloque "idioma del paciente: X — responde SIEMPRE en X". Prompts en un solo idioma (castellano); los `textos` que no pasan por el LLM (recordatorios, avisos) se almacenan por `(clave, idioma)` y salen en el idioma del paciente.

### D11. Memoria: 10-15 pares y 6 horas
Historial recuperado con doble corte: últimos ~25 mensajes Y máximo 6 h de antigüedad. El corte temporal es la lección del fallo 19 de balta (horas caducadas copiadas de una conversación de hace días).

### D12. Contrato LLM propio con dos adaptadores desde el día 1
`LLM_PROVIDER`/`LLM_MODEL` por env, adaptadores Anthropic y OpenAI sobre una interfaz común (~60 líneas). Tope explícito de iteraciones del bucle. El dominio no sabe que existe un LLM.

### D13. RAG con pgvector en `fisio1`, no Qdrant
La imagen de Postgres del stack ya es pgvector. Tabla `document_chunks` (`document_id` → `documents` del panel, `chunk`, `embedding vector`, índice ivfflat/hnsw). Ingesta al subir documento desde el panel (extraer texto, trocear, embeber — proveedor de embeddings por env). Tool `consultar_info(pregunta)`: top-k por similitud, el modelo responde solo con lo recuperado y deriva al teléfono si no hay resultado relevante. Qdrant queda en el stack para n8n legado, sin uso por el bot.

### D14. Recordatorios por franja, configurables, exactamente-una-vez
Regla: cita de mañana → recordatorio el día ANTERIOR a la hora `recordatorio_manana_hora` (p. ej. 19:00); cita de tarde → el MISMO día a la hora `recordatorio_tarde_hora` (p. ej. 09:30). El límite mañana/tarde también es clave de config. Mecanismo de balta: `UPDATE ... FOR UPDATE SKIP LOCKED` con lease + contador de intentos + `recordada_en`; ronda cada 5 min que sincroniza su ventana con Google antes de decidir; arranque en `RECORDATORIOS_DRY_RUN=true`; entrega por el mismo canal de la conversación (Chatwoot primero). Aviso de confirmación pendiente a los ~90 s de una propuesta sin respuesta, silenciado (no borrado) cuando el cliente escribe.

### D15. Aviso al negocio de hueco liberado
Una única función `huecoAvisable()` consultada por los tres caminos que liberan hora (anular, modificar, sustituir): hueco de HOY avisa siempre; `horas_aviso_hueco` amplía la vista. Envío por Evolution a `telefono_avisos`.

### D16. Infra: Evolution propia; todo por red interna
Servicio `evolution` en el stack CITAS (base `evolution` en el mismo Postgres, Redis existente como caché, hostname `${CLIENT_KEY}-evolution`, dominio público solo para el manager). Postgres se añade a `dokploy-network` para que panel y bot conecten por hostname interno; el puerto público 5404 queda solo para desarrollo. `fisio1` y `evolution` entran en el init-db del stack para reproducibilidad.

### D17. STT con interruptor en panel
Clave `stt_activado` en config. Activado: transcripción por endpoint compatible (env `STT_URL`/`STT_API_KEY`), con el catálogo de servicios y nombres de fisios como prompt de sesgo. Desactivado o fallo: respuesta cortés pidiendo texto (texto por idioma en `textos`), sin romper el turno.

## Risks / Trade-offs

- **[Cambio de preset de rejilla altera todas las duraciones]** → Mitigación D4: minutos calculados visibles y confirmación en el panel. Si duele en la práctica, migrar a duración en minutos (cambio local a `duracionServicio()`).
- **[Debounce y scheduler en memoria → una sola instancia]** → Asumido (igual que balta en producción). Documentado; el lease de recordatorios ya tolera réplicas si algún día las hay.
- **[Latencia/cuota de Google Calendar en cada consulta]** → Una sola lectura por rango y profesional candidato; candidatos limitados por servicio y continuidad. Sin caché en v1 (frescura > velocidad, como balta).
- **[Ambigüedad de persona con teléfono compartido]** → D7: presunción del titular + salvaguarda de nombre + pregunta explícita. Conservador: ante duda no se escribe.
- **[Detección de idioma con mensajes cortos ("ok", "sí")]** → Solo se actualiza `idioma_preferido` con señal clara; sin señal, se mantiene el último conocido o el default. Nunca se cambia por un mensaje ambiguo.
- **[Motivo de consulta = dato de salud]** → Solo en descripción del evento y en `citas.motivo`; poda de trazas 90 días e historial 30; sin motivo en títulos ni logs.
- **[Doble fuente de cierres (blocker calendar + excepciones por fisio)]** → Ámbitos distintos y documentados: blocker = centro entero; excepciones = un profesional. El panel los presenta separados.
- **[Cutover]** → Shadow inbox primero; checklist con desactivación de crons n8n (fallo conocido de la guía §15); rollback = reapuntar webhook, válido durante semanas.

## Migration Plan

1. Esquema `fisio1` por migraciones del bot + importador desde `chatbot` (config, profesionales, servicios, service_professionals, clientes→pacientes titulares, citas futuras con su `google_event_id`).
2. Panel reapuntado a `fisio1` (env `DATABASE_URL`); verificación funcional del panel completo antes de tocar el bot.
3. Bot en shadow: inbox de pruebas de Chatwoot → `/bot`, teléfono real, `DRY_RUN` global el primer día.
4. Cutover: reapuntar webhook del inbox productivo, desactivar crons de n8n, activar recordatorios tras validar dry-run.
5. Rollback: reapuntar webhook a n8n (mantener viable ≥ 4 semanas). `chatbot` no se borra hasta jubilar n8n.

## Open Questions

_(Resueltas por el usuario, 2026-08-17.)_

- ~~¿Horario único del centro o por profesional?~~ → **Por profesional** con herencia e intersección (D5).
- ~~¿Ámbito de la continuidad?~~ → **Global, exactamente como nubimed** (D6).
- ~~¿Primera visita: servicio o flag?~~ → **Servicio** + sugerencia de repetición calculada (D8).
- ~~¿Reservas para dos personas?~~ → **Sin flujo de grupo; como nubimed** (`para_otra_persona`, D7/Non-Goals).
- ~~¿Qdrant o pgvector?~~ → **pgvector** (D13).
- ~~¿Cuándo recordar?~~ → **Mañana → día antes; tarde → esa mañana; configurable** (D14).
- ~~¿STT?~~ → **Sí, con toggle en panel y omisión cordial** (D17).
- ~~¿Aviso de hueco liberado?~~ → **Sí** (D15).

Pendiente menor (no bloquea): compartir los calendarios de los fisios y el de cierres con la service account de Google (tarea operativa del negocio); redacción final de textos de recordatorio con la clínica.
