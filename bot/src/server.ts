import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { cargarEnvLocal } from './config/cargarEnvLocal';
import { Aplicacion } from './aplicacion';

cargarEnvLocal();
import { CLAVES } from './config/negocio';

function igualSeguro(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function crearServidor(app: Aplicacion) {
  const server = Fastify({ logger: { level: 'info' } });

  const requiereAdmin = (token: string | undefined): boolean =>
    Boolean(app.env.adminToken && token && igualSeguro(token, app.env.adminToken));

  server.get('/salud', async () => ({ ok: true }));

  // El secreto en la ruta es la barrera: Chatwoot no firma sus webhooks.
  server.post('/webhook/chatwoot/:secreto', async (req, reply) => {
    const { secreto } = req.params as { secreto: string };
    if (!igualSeguro(secreto, app.env.webhookSecret)) return reply.code(404).send();
    // 200 inmediato: Chatwoot no espera al LLM ni reintenta duplicando el turno.
    void app.recibir(req.body as Record<string, unknown>).catch((err) =>
      server.log.error({ err }, 'recibir falló'));
    return { ok: true };
  });

  // Simulador (panel) y banco de pruebas: mismo agente, sin envíos ni escrituras reales.
  server.post('/admin/simular', async (req, reply) => {
    if (!requiereAdmin(req.headers['x-admin-token'] as string)) return reply.code(401).send({ error: 'no autorizado' });
    const { telefono, mensaje } = (req.body ?? {}) as { telefono?: string; mensaje?: string };
    if (!telefono || !mensaje) return reply.code(400).send({ error: 'faltan telefono y mensaje' });
    const respuesta = await app.simular(telefono, mensaje);
    return { respuesta };
  });

  server.get('/admin/config', async (req, reply) => {
    if (!requiereAdmin(req.headers['x-admin-token'] as string)) return reply.code(401).send({ error: 'no autorizado' });
    const resultado: Record<string, { efectivo: string; descripcion: string }> = {};
    for (const clave of Object.keys(CLAVES)) {
      resultado[clave] = { efectivo: await app.config.valor(clave), descripcion: CLAVES[clave]!.descripcion };
    }
    return resultado;
  });

  server.put('/admin/config', async (req, reply) => {
    if (!requiereAdmin(req.headers['x-admin-token'] as string)) return reply.code(401).send({ error: 'no autorizado' });
    const cuerpo = (req.body ?? {}) as Record<string, string>;
    for (const [clave, valor] of Object.entries(cuerpo)) {
      try {
        await app.config.guardar(clave, valor);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'valor inválido' });
      }
    }
    return { ok: true };
  });

  return server;
}

if (require.main === module) {
  (async () => {
    const app = new Aplicacion();
    await app.inicializar();
    const server = await crearServidor(app);
    await server.listen({ port: app.env.puerto, host: '0.0.0.0' });
  })().catch((err) => { console.error(err); process.exit(1); });
}
