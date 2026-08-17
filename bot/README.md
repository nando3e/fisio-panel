# fisio-bot

Bot de citas por WhatsApp para la clínica de fisioterapia. Cadena: **WhatsApp → Evolution API (instancia propia) → Chatwoot → este servicio → Google Calendar**. Especificación completa en `../openspec/changes/bot-citas-fisio/` (proposal, design D1–D17, specs, compliance).

## Arranque

```bash
npm install
cp .env.example .env        # rellenar credenciales
npm run migrate             # idempotente (también se ejecuta al arrancar)
npm run seed                # prompts y textos por defecto (nunca pisa lo editado)
npm run importar            # una vez: IMPORT_SOURCE_URL = base chatbot legada (solo lectura)
npm run dev
```

Puesta en marcha paso a paso: `../PUESTA-EN-MARCHA.md`. Tras cada paso, `npm run doctor` dice qué falta y por qué (solo lee; seguro en producción).

Verificación en tres niveles:

```bash
npm test              # 65 unitarios, sin red ni BD
npm run banco         # integración: turno completo contra la BD real, LLM guionizado y calendario en memoria
npm run banco:prompt  # reconstruye el system prompt REAL y comprueba que los datos llegan dentro
```

El banco contra el modelo real (con claves y coste) es el paso siguiente: mismo esqueleto de `banco/flujo-reserva.ts`, sustituyendo el LLM guionizado por el cliente real.

## Puntos de entrada

| Ruta | Auth | Qué hace |
|---|---|---|
| `GET /salud` | — | sonda |
| `POST /webhook/chatwoot/<WEBHOOK_SECRET>` | secreto en ruta | webhook de Chatwoot (200 inmediato, proceso en background) |
| `POST /admin/simular` | `x-admin-token` | simulador: mismo agente, escrituras interceptadas, sin envíos |
| `GET/PUT /admin/config` | `x-admin-token` | claves de `bot_config` (el panel usa la BD directamente) |

## Operación

- **`DRY_RUN=true`** (default): el agente conversa pero ninguna escritura llega a Google. Primer despliegue SIEMPRE así.
- **Recordatorios**: `recordatorios_activos=false` (default) = solo log. Se activan desde el panel cuando lo logueado sea correcto. Citas de mañana → día antes (`recordatorio_manana_hora`); citas de tarde → esa mañana (`recordatorio_tarde_hora`).
- **Kill-switch**: global en el panel (`bot_estado`); por contacto, atributo `bot=false` en Chatwoot. En ambos casos el historial se sigue registrando.
- **Comandos de soporte** (desde `telefono_soporte`): `activabot` / `desactivabot` / `consultabot`.
- **Prompts**: editables/publicables desde el panel (versionados; publicar nunca pisa el histórico). Si cambias tools en código, despliega ANTES de publicar prompts que las mencionen.
- **Trazas**: una por turno en `agent_traces` (args + extracto de resultado por tool). Poda automática: trazas 90 días, historial 30.

## Prerequisitos externos

1. Compartir los calendarios de cada fisio Y el calendario "cierres" con la service account (permiso *Hacer cambios en eventos*).
2. Instancia Evolution del stack CITAS creada y conectada al número.
3. Webhook de Chatwoot apuntando a `http://<host-bot>:3000/webhook/chatwoot/<WEBHOOK_SECRET>` con evento `message_created`.
4. En el cutover: **desactivar los crons del workflow n8n viejo** (el kill-switch no los para).

## Checklist de cutover

Ver `../openspec/changes/bot-citas-fisio/compliance.md` §5 — incluye la remediación de seguridad §0, la batería §1 y el UAT del negocio antes de reapuntar el webhook productivo.
