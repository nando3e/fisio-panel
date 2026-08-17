# Puesta en marcha

Orden por dependencias. Tras **cada** paso, ejecuta el diagnóstico desde `bot/`:

```bash
npm run doctor
```

Te dirá qué está listo, qué falta y por qué. Nada de esto escribe en la agenda: `DRY_RUN=true` y `recordatorios_activos=false` vienen por defecto.

---

## ⚠️ Antes de empezar: el número de WhatsApp

El número productivo de la clínica está hoy conectado a la Evolution que usa el workflow n8n. **Un número solo puede estar en una instancia a la vez**: si lo escaneas en la instancia nueva, se desconecta de la vieja y el bot actual deja de responder — un cutover accidental, sin vuelta atrás inmediata.

Por eso, para todo lo que viene hasta el paso 7, **usa un segundo número de pruebas** (una SIM prepago o un número virtual). El productivo se mueve solo en el cutover, con todo verificado.

---

## 1. Cuenta de servicio de Google (empieza por aquí: es lo que más tarda)

1. En Google Cloud Console: crea un proyecto (o usa uno existente) → **Habilitar API** → *Google Calendar API*.
2. **IAM y administración → Cuentas de servicio → Crear**. No hace falta darle roles del proyecto.
3. Dentro de la cuenta creada: **Claves → Agregar clave → Crear nueva → JSON**. Se descarga el fichero; ahí está `client_email`.
4. En **Google Calendar**, para *cada* calendario de fisioterapeuta **y** para el calendario de cierres: Configuración → *Compartir con determinadas personas* → añade el `client_email` con permiso **"Hacer cambios en los eventos"**.
5. El JSON completo, en una sola línea, va a `GOOGLE_SERVICE_ACCOUNT`.

Verificación: `npm run doctor` comprueba **uno a uno** los calendarios de la tabla `professionals` y te dice cuál no está compartido. Este es el fallo más habitual y el más silencioso: un calendario sin compartir no da error, simplemente no ofrece huecos.

## 2. Actualizar el stack CITAS en Dokploy

Sustituye el compose del stack por `infra/docker-compose.citas.yml`. Cambia tres cosas respecto al actual:

- **Postgres entra en `dokploy-network`**: sin esto, el panel y el bot (que son apps aparte) no pueden llegar a la base por hostname interno.
- **Servicio `evolution` nuevo**, con su base `evolution` en el mismo Postgres y el Redis existente como caché.
- Imágenes con versión fijada en vez de `latest`, para que un redeploy no cambie de versión sin avisar.

Variables nuevas del stack: `EVOLUTION_URL` (dominio público del manager) y `EVOLUTION_TOKEN` (invéntate una clave larga: es la `apikey` de administración).

Ojo: el `init-db` solo corre en el primer arranque. Como el volumen ya existe, crea las bases a mano una vez:

```sql
CREATE DATABASE evolution;   -- fisio1 ya está creada
```

## 3. Instancia de Evolution y número

En el manager de Evolution (`EVOLUTION_URL`, con `EVOLUTION_TOKEN`):

1. Crea una instancia — su **nombre** es el `EVOLUTION_INSTANCE` del bot.
2. Escanea el QR con **el número de pruebas** (ver el aviso de arriba).
3. Comprueba que queda en estado `open`/`connected`.

Las tres variables, sin confusión (Evolution llama "apikey" a dos cosas distintas):

- `EVOLUTION_INSTANCE` → el **nombre** de la instancia, el que tú escribes al crearla (p. ej. `fisio`). Va en la URL de cada llamada, nunca es un token.
- `EVOLUTION_TOKEN` → la clave **global del servidor**: el `AUTHENTICATION_API_KEY` que TÚ defines en las variables del stack. El mismo valor exacto va en el stack y en el bot — es un secreto compartido, no dos.
- El token que Evolution muestra al crear la instancia (el "hash" por-instancia) → **ignóralo**: aquí no se usa en ningún env.

`npm run doctor` valida la instancia por nombre y te dice su estado real de conexión.

## 4. Inbox de Chatwoot conectado a Evolution

1. En Chatwoot: **Configuración → Bandejas de entrada → Añadir → API**, nómbralo (p. ej. "WhatsApp Fisio"). Al crearlo te da el `inbox_id` y el webhook de Chatwoot.
2. En Evolution, configura la integración con Chatwoot para esa instancia (URL interna de Chatwoot, token de la cuenta, `account_id`, el inbox creado).
3. Envía un WhatsApp al número de pruebas y comprueba que la conversación aparece en Chatwoot. **Hasta aquí no interviene el bot**: si esto no funciona, el bot tampoco lo hará.

Necesitas también un **token de acceso de Chatwoot** (Perfil → Access Token) para `CHATWOOT_TOKEN`.

## 5. Envs y despliegue de las dos apps

Dos aplicaciones en Dokploy, mismo repositorio:

| App | Build path | Compose |
|---|---|---|
| Panel | raíz | `docker-compose.yml` |
| Bot | `/bot` | `bot/docker-compose.yml` |

Los ficheros `.env` locales **no se suben** (están en `.gitignore`): son solo para desarrollo en tu máquina. En producción, cada variable se pega en el apartado **Environment** de su aplicación en Dokploy.

Dos diferencias entre local y Dokploy, y son la fuente habitual de errores:

- **`DATABASE_URL`**: en local va por IP pública y puerto publicado (`91.99.128.20:5404`); en Dokploy, por hostname interno y puerto estándar (`<CLIENT_KEY>-postgres:5432`).
- **Credenciales de Google**: en local, la ruta al fichero; en Dokploy **el valor en base64** (ver más abajo).

### Variables del PANEL

| Variable | Valor en Dokploy |
|---|---|
| `DATABASE_URL` | `postgresql://usuario:clave@<CLIENT_KEY>-postgres:5432/fisio1` |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | los de acceso al panel (contraseña fuerte, no `admin123`) |
| `JWT_SECRET` | cadena aleatoria larga |
| `UPLOAD_DIR` | `/app/uploads` |
| `EMBEDDINGS_API_URL` / `EMBEDDINGS_API_KEY` / `EMBEDDINGS_MODEL` | proveedor de embeddings para indexar documentos |
| `BOT_URL` | `http://<nombre-app-bot>:3000` (hostname interno) |
| `BOT_ADMIN_TOKEN` | **el mismo valor** que `ADMIN_TOKEN` del bot, o el simulador no funcionará |

### Variables del BOT

| Variable | Valor en Dokploy |
|---|---|
| `DATABASE_URL` | la misma que el panel |
| `LLM_PROVIDER` / `LLM_MODEL` | `anthropic` / `claude-sonnet-5` |
| `ANTHROPIC_API_KEY` (u `OPENAI_API_KEY`) | según el proveedor elegido |
| `EMBEDDINGS_*` | los mismos que el panel |
| `GOOGLE_SERVICE_ACCOUNT` | **el base64** (ver abajo) |
| `CHATWOOT_URL` / `CHATWOOT_ACCOUNT_ID` / `CHATWOOT_TOKEN` | URL interna de Chatwoot y su token |
| `WEBHOOK_SECRET` | el secreto de la ruta del webhook |
| `EVOLUTION_URL` / `EVOLUTION_INSTANCE` / `EVOLUTION_TOKEN` | del paso 3 |
| `ADMIN_TOKEN` | protege `/admin` del bot |
| `DRY_RUN` | `true` en el primer despliegue |
| `RECORDATORIOS_DRY_RUN` | `true` hasta validar |
| `PORT` | `3000` |

`IMPORT_SOURCE_URL` **no** va a Dokploy: solo se usa para el `npm run importar` puntual desde tu máquina.

### El fichero de la cuenta de servicio

No se sube a ningún sitio. En Dokploy no hay fichero, así que su contenido viaja **en base64** dentro de la propia variable: una sola línea, sin comillas, sin `$` ni saltos de línea que los paneles de variables suelen romper.

```bash
# genera el valor (desde bot/)
node -e "console.log(require('fs').readFileSync('./fisios-serviceaccount.json').toString('base64'))"
```

Pega el resultado en `GOOGLE_SERVICE_ACCOUNT`. El bot detecta solo si le has dado una ruta, un base64 o un JSON en línea, así que la misma variable sirve en los dos entornos.

El bot aplica migraciones y semilla al arrancar: no hay paso manual.

## 6. Webhook de Chatwoot → bot

En el inbox de Chatwoot, añade el webhook con el evento **`message_created`** apuntando a:

```
http://<app-bot>:3000/webhook/chatwoot/<WEBHOOK_SECRET>
```

El secreto en la ruta es la única barrera: Chatwoot no firma sus webhooks. Que sea largo y aleatorio.

## 7. Verificación antes del cutover

1. `npm run doctor` sin bloqueantes.
2. **Simulador del panel** (pestaña Bot): conversa sin tocar la agenda ni enviar nada. Prueba reservar, cambiar de idea a mitad, preguntar por precios, cambiar y anular.
3. **Shadow con el número de pruebas**, `DRY_RUN=true`: el bot conversa de verdad por WhatsApp pero no escribe. Revisa las trazas en el panel: ¿qué tools usó, con qué argumentos, qué devolvieron?
4. `DRY_RUN=false` y reserva una cita real de prueba; compruébala en Google Calendar y anúlala.
5. Sube los documentos de la clínica (tarifas, preparación) y comprueba que el bot responde con ellos.
6. **Que lo pruebe el dueño del negocio.** Es lo que encuentra lo que ningún test ve.
7. Recordatorios: déjalos en `recordatorios_activos=false` un día, mira en los logs a quién *habría* avisado y a qué hora, y solo entonces actívalos.

## 8. Cutover

1. Conecta el **número productivo** a la instancia nueva de Evolution (esto desconecta el bot viejo).
2. **Desactiva los crons del workflow n8n.** El interruptor del panel no los para: si te lo saltas, los pacientes reciben dos recordatorios.
3. Vigila las trazas y las anomalías (`[anomalia]` en los logs) los primeros días.

**Rollback**: reapuntar el número y el webhook a n8n. Mantenlo viable varias semanas y no borres la base `chatbot` hasta jubilar el workflow viejo.

---

## Antes de dar servicio real

Está todo en `openspec/changes/bot-citas-fisio/compliance.md`: la remediación de credenciales (§0), el checklist de seguridad (§2) y las obligaciones RGPD (§4) — contrato de encargado del tratamiento con la clínica, texto informativo en el primer mensaje del bot y plazos de conservación.
