# Handoff — 17/08/2026, noche

Estado al cierre de la sesión en que se construyó y desplegó todo el sistema.

## Qué hay funcionando AHORA

- **Bot en producción (modo shadow)**: `https://bot.citas.rbimprove.app` — `/salud` OK, webhook protegido por secreto (404 sin él). **`DRY_RUN=true`**: conversa de verdad por WhatsApp pero NO escribe en la agenda. Ya mantuvo su primera conversación real (reconoció a Fernando por teléfono, consultó disponibilidad real y ofreció horas correctas).
- **Panel nuevo**: `https://fisiopanel.rbimprove.com` — login OK. Páginas: Dashboard, Configuración (servicios con minutos, horarios del centro y POR FISIO, rejilla con aviso), Pacientes (historial+motivo), Bot (ajustes/prompts con diff/textos/trazas/simulador), Documentos (RAG), Usuarios.
- **Despliegue**: UNA app de Dokploy, Compose Path `./docker-compose.yml`, dos servicios (`app` panel, `bot`) del mismo commit. Sin puertos publicados: todo entra por dominio (Traefik). Ambos dominios → puerto 3000 de su servicio.
- **Cadena de mensajería**: WhatsApp (número de PRUEBAS) ↔ Evolution `evolution.test.rbimprove.app` (instancia `fisio-bot`, token de instancia como apikey) ↔ Chatwoot cuenta 3, inbox `fisio-bot` (id 7) ↔ webhook → bot.
- **Base**: `fisio1` en el Postgres 5404. Migrada, sembrada (5 prompts, 6 textos) e importada de `chatbot` (3 fisios + blocker "cierres", 3 servicios, 13 pacientes).
- **Google**: service account `fisios@fisios.iam.gserviceaccount.com`, los 4 calendarios compartidos y verificados.
- **El bot n8n viejo sigue atendiendo el número PRODUCTIVO.** Sus crons siguen activos. El panel viejo quedó sin dominio (solo puerto 3150 interno).

## Verificación disponible

- `cd bot && npm run doctor` — 28 comprobaciones contra todo (BD, catálogo, Google calendario a calendario, Chatwoot, Evolution+instancia, LLM, embeddings). Última pasada: 28 ✓ / 0 bloqueantes.
- `npm test` (73 unitarios) · `npm run banco` (flujo reserva end-to-end, 14 aserciones) · `npm run banco:prompt` (18 aserciones del system prompt real).
- Trazas de cada turno: panel → pestaña Bot → Trazas (o tabla `agent_traces`).

## Plan de MAÑANA: casos de uso

Batería definida en `openspec/changes/bot-citas-fisio/compliance.md` §1. Orden sugerido:

1. **Antes de nada, en el panel**: crear el servicio **"Primera visita"** (duración en slots + fisios asignados) — hoy no existe y el bot lo esquivó usando Sesión fisio. Rellenar `telefono_avisos` en Ajustes del bot. Subir algún documento (tarifas) para probar el RAG.
2. **Simulador** (panel → Bot → Simulador): reservar, cambiar de intención a mitad, "¿dónde estáis?", precios (RAG), para otra persona.
3. **WhatsApp real (shadow, DRY_RUN)**: los esperados E1-E13 y alternativos A1-A15 de compliance §1 — reserva completa, modificar, anular, idioma catalán, recurrente vago ("me duele X, vine la semana pasada").
4. Revisar cada turno en Trazas: qué tools, qué argumentos, qué devolvieron.
5. Cuando el guion convenza: `DRY_RUN=false` en el Environment de Dokploy + redeploy → una reserva real de prueba → verla en Google Calendar → anularla.
6. Recordatorios: siguen en dry-run (`recordatorios_activos=false`); mirar en logs a quién *habría* avisado antes de activarlos desde el panel.

## Pendientes que NO son de mañana

- **19/08 (recordatorio cloud programado, 9:00)**: (a) seguridad — rotar `citas_admin` y `sigmadental_admin`, firewall 5404/5410, usuarios de mínimo privilegio, purgar historial o repo privado, evaluación de brecha RGPD (compliance §0); (b) **estandarizar despliegues** — plantilla por cliente a partir de `infra/docker-compose.citas.yml`, el compose unificado, `doctor.ts` y `PUESTA-EN-MARCHA.md`.
- Stack CITAS propio: Postgres a `dokploy-network`, Evolution dedicada (token `0c2fd14a...` reservado), migrar `DATABASE_URL` a hostname interno.
- Antes del cutover: compliance §5 entero (UAT del dueño, textos RGPD, contrato encargado, desactivar crons n8n).

## Secretos y dónde viven

Todos locales e ignorados por git: `.env` (panel local), `bot/.env` (fuente del Environment de Dokploy, incluye bloque del panel al final), `bot/fisios-serviceaccount.json` + sus `sa-*.PEGAR-EN-DOKPLOY.txt` (borrables, se regeneran), `.mcp.json`. Credenciales de acceso al panel nuevo: en `bot/.env` (`SUPERADMIN_*`).
