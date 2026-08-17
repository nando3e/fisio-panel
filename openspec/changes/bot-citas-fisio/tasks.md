# Tasks: bot-citas-fisio

## 1. Infraestructura y esqueleto

- [x] 1.1 Compose del stack CITAS: añadir Postgres a `dokploy-network`; `fisio1` y `evolution` al init-db; servicio `evolution` (instancia propia, Redis existente, hostname `${CLIENT_KEY}-evolution`, dominio para el manager)
- [x] 1.2 Esqueleto `/bot`: Node ≥ 20 + TypeScript estricto, Fastify, `pg`, estructura `config/ db/ agent/ gateway/ llm/ booking/ patient/ reminders/ rag/`, scripts dev/build/test (`node:test` vía `tsx`)
- [x] 1.3 Carga y validación de env con fallo temprano (`DATABASE_URL`, `LLM_PROVIDER`, `LLM_MODEL`, claves LLM/embeddings, `CHATWOOT_URL/ACCOUNT_ID/TOKEN`, `EVOLUTION_URL/INSTANCE/TOKEN`, `GOOGLE_SERVICE_ACCOUNT`, `ADMIN_TOKEN`, `DRY_RUN`, `RECORDATORIOS_DRY_RUN`, `STT_URL/API_KEY` opcionales)
- [x] 1.4 Servidor con `GET /salud`, `POST /webhook/chatwoot` (200 inmediato, proceso en background), `POST /webhook/test`
- [x] 1.5 Dockerfile de `/bot` y alta de la segunda app en Dokploy (mismo repo, build path `/bot`)

## 2. Esquema `fisio1` e importación

- [x] 2.1 Migraciones numeradas e idempotentes: `pacientes` (teléfono NO único, titular), `citas` (paciente_id, professional_id, service_id, estado, motivo, google_event_id UNIQUE, columnas de recordatorio), `professional_hour_rules`, `professional_exceptions`, `bot_config` clave-valor con validador por clave, `prompts`, `textos` por idioma, `agent_traces`, `confirmaciones_pendientes`, `chat_memory`, `document_chunks` con pgvector, más las tablas que el panel ya usa (services, professionals, service_professionals, business_settings, business_hour_rules, bot_estado, app_users, documents)
- [x] 2.2 Semilla idempotente (no pisa lo editado): prompts por defecto, textos ca/es, claves de config con defaults
- [x] 2.3 Importador desde `chatbot` (solo SELECT): config, profesionales, servicios, cruces, clientes → pacientes titulares, citas futuras con `google_event_id`; normalización de teléfonos a E.164 en el borde
- [x] 2.4 Reapuntar el panel a `fisio1` y retirar `/api/migrate`; verificación funcional completa del panel

## 3. Motor de disponibilidad (`availability-engine`)

- [x] 3.1 `duracionServicio()` y rejilla de inicios desde `slot_minutes`; única fuente de duración
- [x] 3.2 Ventanas efectivas por día y profesional: reglas del centro ∩ reglas del profesional (herencia si no tiene), excepciones por fecha del profesional
- [x] 3.3 Cliente Google Calendar (service account, paginación completa, eventos de día entero, cancelados, fin exclusivo) + ocupación fusionada por profesional + calendario blocker
- [x] 3.4 `huecosDelDia()` por sustracción y `siguesDisponible()` puntual; candidatos por servicio (`service_professionals`) y por decisión de continuidad; round-robin persistente para "cualquiera"
- [x] 3.5 Tests sin red del motor completo (rejilla, duraciones, herencia, excepciones, blocker, bordes de ventana)

## 4. Gateway (`whatsapp-gateway`)

- [x] 4.1 Parseo del webhook (cliente desde `conversation.meta.sender`), dedup de ecos por `source_id` propio, detección de media/notas de voz
- [x] 4.2 `decidir()` puro: eco → sin texto → saliente humano (`solo_registrar` como rol propio) → comandos de soporte (últimos 9 dígitos exactos) → kill-switch global → flag `bot` del contacto en Chatwoot → responder; el historial se registra SIEMPRE
- [x] 4.3 Debounce por teléfono (ventana configurable) + presencia "escribiendo" vía Evolution
- [x] 4.4 Entrega: Chatwoot primero (hilo del cliente), fallback Evolution directo; el agente nunca envía
- [x] 4.5 Normalización E.164 una sola vez en el borde

## 5. Registro de pacientes (`patient-registry`)

- [x] 5.1 Repos de `pacientes`: candidatos por teléfono, titular presunto, upsert con `COALESCE`, filtro de nombres de relleno (doble barrera: ejecutor + repo)
- [x] 5.2 Resolución del turno: paciente + última cita (fecha, servicio, fisio) calculadas en código e inyectadas al contexto y al `ToolContext`
- [x] 5.3 Salvaguarda de nombre: match por teléfono + nombre de pila distinto → preguntar antes de escribir; `para_otra_persona` crea/usa ficha del tercero sin tocar la del titular
- [x] 5.4 Detección de idioma (heurística ca/es sobre últimos mensajes, actualización solo con señal clara) y persistencia en `idioma_preferido`

## 6. Continuidad (`continuity-mode`)

- [x] 6.1 Clave `continuidad_modo` con caché 45 s y normalización tolerante; edición desde panel
- [x] 6.2 Derivación de "su fisio" y "su último servicio" desde `citas` (`estado='confirmada'`, pasada, ≤ 365 días), por paciente
- [x] 6.3 Decisión `none`/`force`/`exception` en la capa de reserva; sobrescritura del profesional propuesto por el modelo en `consultar_disponibilidad` y `confirmar_cita`, con nota conversacional del porqué
- [x] 6.4 Redacción única por modo (una función), inyectada coherente en tool y system prompt en el mismo turno
- [x] 6.5 Tests espejo de los 11.x de nubimed: force, exception, preferida sin restricción dura, nuevo sin restricción, modelo desobediente ignorado, sin hueco con su fisio

## 7. Reserva y gestión (`appointment-booking`, `appointment-management`)

- [x] 7.1 Tools: `consultar_disponibilidad`, `proponer_cita` (con `motivo`, `para_otra_persona`, `sustituye_a`), `confirmar_cita` SIN parámetros, `listar_mis_citas` (con `se_puede_*` resueltos), `modificar_cita`, `anular_cita`, `identificar_paciente`, `consultar_info`
- [x] 7.2 Ejecutor con las reglas duras: anclaje a hueco real (tolerancia año/zona), revalidación antes de escribir, idempotencia por (paciente, inicio), no pasado/no cerrado/no pisado, umbral de modificación, resolución de citas por fecha+hora sin adivinar, `sustituye_a` estricto con tope de rechazos, anulación de la sustituida DESPUÉS de crear
- [x] 7.3 Motivo → `citas.motivo` + descripción del evento (nunca el título); título `Nombre Apellido - teléfono - servicio`
- [x] 7.4 Aviso de hueco liberado (`huecoAvisable()` única, tres caminos) por Evolution a `telefono_avisos`
- [x] 7.5 Anular siempre permitido, `ya_anulada` idempotente, devolver CUÁL se anuló

## 8. Agente (`conversation-agent`)

- [x] 8.1 Contrato LLM + adaptadores Anthropic/OpenAI; tope de iteraciones; errores de tool devueltos al modelo sin tumbar el turno
- [x] 8.2 Composición del system prompt de estable a volátil: prompts BD + bloque negocio + bloque paciente (idioma, última visita, continuidad) + bloque temporal (fecha/hora + tabla 21 días con cerrados MARCADOS + cierres resueltos en código)
- [x] 8.3 Memoria con doble corte (~25 mensajes y 6 h)
- [x] 8.4 Guardarraíles: `ofreceHuecos` (lista de horas sin consulta previa → repetir turno), reintento con listado inyectado (`no_reconocida` vs `ambigua`, máx. 2)
- [x] 8.5 Prompts por defecto en castellano (identidad, reglas duras, reserva, gestión, general) adaptados de balta/nubimed al dominio fisio

## 9. Recordatorios (`reminders`)

- [x] 9.1 Scheduler interno (tareas aisladas, guardia de solape, ejecución al arrancar): recordatorios 5 min, sincronización Google 15 min, poda 6 h
- [x] 9.2 Selección por franja: mañana → día antes a `recordatorio_manana_hora`; tarde → mismo día a `recordatorio_tarde_hora`; límite de franja configurable
- [x] 9.3 Lease atómico (`FOR UPDATE SKIP LOCKED`) + `recordada_en` + intentos máx. 5; dry-run por defecto
- [x] 9.4 Confirmación pendiente a ~90 s, una vez, silenciada al escribir el cliente (no borrada)
- [x] 9.5 Sincronización bidireccional con Google (borrados y apuntes a mano, parseo de teléfono del título) + repetición en la ventana de recordatorio
- [x] 9.6 Poda: trazas 90 días, `chat_memory` 30 días

## 10. RAG y STT (`rag-answers`, `voice-transcription`)

- [x] 10.1 Extensión pgvector + `document_chunks`; pipeline de ingesta al subir documento en el panel (extraer, trocear, embeber); reemplazo por documento atómico (borra chunks viejos en la misma transacción) y borrado en cascada
- [x] 10.2 Tool `consultar_info`: top-k por similitud, respuesta solo con lo recuperado, derivación cortés sin resultado
- [x] 10.3 STT por endpoint compatible con toggle `stt_activado` en panel; catálogo como sesgo; degradación cortés por idioma si está apagado o falla

## 11. Observabilidad y panel (`agent-observability`, `admin-panel`)

- [x] 11.1 `agent_traces` por turno (args + extracto de resultado por tool, tokens, ms, error), escritas aunque falle el envío; `registrarAnomalia()`
- [x] 11.2 Endpoints admin del bot autenticados: `/config`, `/prompts`, `/traces`
- [x] 11.3 Panel: página Pacientes (búsqueda, ficha, historial con servicio/fisio/estado/motivo, edición)
- [x] 11.4 Panel: horarios y excepciones por fisio; aviso de minutos calculados al cambiar preset de rejilla
- [x] 11.5 Panel: modo continuidad, idioma por defecto, toggles STT y dry-run de recordatorios, horas de recordatorio, teléfono de avisos, textos por idioma, prompts versionados (editar/publicar con diff), visor de trazas
- [x] 11.6 Simulador de conversación en el panel (tools de escritura interceptadas)

## 12. Verificación y cutover

- [x] 12.1 Tests unitarios sin red (motor, contexto, ejecutor, idioma, franjas de recordatorio)
- [x] 12.2 Banco contra el modelo real: reserva completa, cambio de intención a mitad, "mañana no puedo venir" en un turno sin dejar dos citas vivas, continuidad force/exception, para_otra_persona, no escribe sin el sí
- [x] 12.3 Reconstrucción del system prompt real contra producción (buscar horario, dirección, idioma dentro)
- [ ] 12.4 Shadow inbox con teléfono real y `DRY_RUN` el primer día; prueba del dueño del negocio antes del corte
- [ ] 12.5 Cutover: reapuntar webhook productivo, DESACTIVAR crons de n8n, activar recordatorios tras validar dry-run; documentar rollback

## 13. Cumplimiento (ver compliance.md)

- [ ] 13.0 **URGENTE, previo a todo**: remediación de credenciales expuestas (compliance.md §0: rotación, firewall, limpiar repo, evaluación de brecha)
- [ ] 13.1 Batería completa §1 implementada y en verde (esperados, alternativos, edges, banco, UAT)
- [ ] 13.2 Checklist de seguridad §2 revisado punto a punto antes del shadow
- [ ] 13.3 Obligaciones RGPD §4 en marcha: textos de información, DPAs, registro de actividades, retención, procedimiento de derechos y de brechas
- [ ] 13.4 Puertas de calidad §5 verificadas antes del cutover
