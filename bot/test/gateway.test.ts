import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidir } from '../src/gateway/decidir';
import { interpretarWebhook, ORIGEN_BOT } from '../src/gateway/chatwoot';
import { aE164, ultimos9 } from '../src/gateway/telefono';
import { huecoAvisable } from '../src/gateway/avisos';
import { instanteLocal } from '../src/booking/tiempo';

function webhookBase(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: 'message_created',
    message_type: 'incoming',
    content: 'hola',
    conversation: { id: 42, meta: { sender: { phone_number: '+34612345678', custom_attributes: {} } } },
    ...extra,
  };
}

test('el cliente se lee de conversation.meta.sender, no de sender', () => {
  const m = interpretarWebhook(webhookBase({ sender: { name: 'Agente Humano' } }));
  assert.equal(m.tipo, 'entrante');
  assert.equal(m.telefono, '+34612345678');
  assert.equal(m.conversationId, 42);
});

test('eco propio reconocido por source_id', () => {
  const m = interpretarWebhook(webhookBase({ source_id: ORIGEN_BOT, message_type: 'outgoing' }));
  assert.equal(m.tipo, 'eco_propio');
});

test('saliente humano (el dueño escribe a mano) se registra sin responder', () => {
  const m = interpretarWebhook(webhookBase({ message_type: 'outgoing', content: 'ya te atiendo yo' }));
  assert.equal(m.tipo, 'saliente_humano');
  const d = decidir({ mensaje: m, botActivoGlobal: true, telefonoSoporte: '' });
  assert.deepEqual(d, { accion: 'solo_registrar', rol: 'humano_negocio' });
});

test('kill-switch global y flag bot del contacto: registrar sin responder', () => {
  const entrante = interpretarWebhook(webhookBase());
  assert.deepEqual(decidir({ mensaje: entrante, botActivoGlobal: false, telefonoSoporte: '' }),
    { accion: 'solo_registrar', rol: 'human' });
  const conFlag = interpretarWebhook(webhookBase({
    conversation: { id: 42, meta: { sender: { phone_number: '+34612345678', custom_attributes: { bot: false } } } },
  }));
  assert.deepEqual(decidir({ mensaje: conFlag, botActivoGlobal: true, telefonoSoporte: '' }),
    { accion: 'solo_registrar', rol: 'human' });
});

test('comando de soporte: últimos 9 dígitos EXACTOS, no contains', () => {
  const m = interpretarWebhook(webhookBase({ content: 'desactivabot' }));
  assert.deepEqual(decidir({ mensaje: m, botActivoGlobal: true, telefonoSoporte: '612345678' }),
    { accion: 'comando', comando: 'desactivabot' });
  // otro número con esos dígitos DENTRO no cuela
  assert.deepEqual(decidir({ mensaje: m, botActivoGlobal: true, telefonoSoporte: '912345678' }).accion, 'responder');
});

test('normalización E.164 una sola vez en el borde', () => {
  assert.equal(aE164('612 34 56 78'), '+34612345678');
  assert.equal(aE164('34612345678'), '+34612345678');
  assert.equal(aE164('+34612345678'), '+34612345678');
  assert.equal(aE164('nada'), null);
  assert.equal(ultimos9('+34612345678'), '612345678');
});

test('huecoAvisable: hoy siempre; la vista amplía; pasado nunca', () => {
  const tz = 'Europe/Madrid';
  const ahora = instanteLocal('2026-08-17', 10 * 60, tz);
  assert.equal(huecoAvisable(instanteLocal('2026-08-17', 18 * 60, tz), ahora, tz, 0), true);
  assert.equal(huecoAvisable(instanteLocal('2026-08-18', 10 * 60, tz), ahora, tz, 0), false);
  assert.equal(huecoAvisable(instanteLocal('2026-08-18', 9 * 60, tz), ahora, tz, 24), true);
  assert.equal(huecoAvisable(instanteLocal('2026-08-17', 9 * 60, tz), ahora, tz, 24), false);
});
