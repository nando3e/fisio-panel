import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cargarEnv } from '../src/config/env';

/** Las credenciales de Google deben poder llegar en cualquiera de las tres formas. */

const SA = {
  type: 'service_account', project_id: 'x', private_key_id: 'k',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  client_email: 'x@x.iam.gserviceaccount.com',
};

function conEntorno<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previo: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previo[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(previo)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const BASE = {
  DATABASE_URL: 'postgresql://u:p@h:5432/d',
  LLM_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'clave',
  GOOGLE_SERVICE_ACCOUNT_FILE: undefined,
  GOOGLE_SERVICE_ACCOUNT_JSON: undefined,
};

test('credenciales por RUTA a fichero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sa-'));
  const ruta = join(dir, 'sa.json');
  writeFileSync(ruta, JSON.stringify(SA));
  const env = conEntorno({ ...BASE, GOOGLE_SERVICE_ACCOUNT: ruta }, () => cargarEnv());
  assert.equal(JSON.parse(env.googleServiceAccountJson).client_email, SA.client_email);
});

test('credenciales por BASE64 (la forma para paneles de variables)', () => {
  const b64 = Buffer.from(JSON.stringify(SA), 'utf8').toString('base64');
  const env = conEntorno({ ...BASE, GOOGLE_SERVICE_ACCOUNT: b64 }, () => cargarEnv());
  assert.equal(JSON.parse(env.googleServiceAccountJson).client_email, SA.client_email);
});

test('credenciales por JSON en una línea', () => {
  const env = conEntorno({ ...BASE, GOOGLE_SERVICE_ACCOUNT: JSON.stringify(SA) }, () => cargarEnv());
  assert.equal(JSON.parse(env.googleServiceAccountJson).project_id, 'x');
});

test('sin credenciales no revienta: queda vacío (el doctor lo reporta)', () => {
  const env = conEntorno({ ...BASE, GOOGLE_SERVICE_ACCOUNT: undefined }, () => cargarEnv());
  assert.equal(env.googleServiceAccountJson, '');
});

test('una ruta inexistente falla con un mensaje que explica las tres formas', () => {
  assert.throws(
    () => conEntorno({ ...BASE, GOOGLE_SERVICE_ACCOUNT: './no-existe.json' }, () => cargarEnv()),
    /no es un JSON, ni base64 válido, ni un fichero existente/,
  );
});

test('un JSON multilínea mal pegado avisa de que debe ir en una línea', () => {
  assert.throws(
    () => conEntorno({ ...BASE, GOOGLE_SERVICE_ACCOUNT: '{\n  "type": "service_account"' }, () => cargarEnv()),
    /UNA sola línea/,
  );
});

test('el nombre antiguo GOOGLE_SERVICE_ACCOUNT_JSON sigue funcionando', () => {
  const env = conEntorno(
    { ...BASE, GOOGLE_SERVICE_ACCOUNT: undefined, GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(SA) },
    () => cargarEnv(),
  );
  assert.equal(JSON.parse(env.googleServiceAccountJson).project_id, 'x');
});

test('modo tolerante: sin clave de LLM carga igual (para el diagnóstico)', () => {
  assert.throws(() => conEntorno({ ...BASE, ANTHROPIC_API_KEY: undefined, GOOGLE_SERVICE_ACCOUNT: undefined }, () => cargarEnv()));
  const env = conEntorno({ ...BASE, ANTHROPIC_API_KEY: undefined, GOOGLE_SERVICE_ACCOUNT: undefined }, () => cargarEnv(true));
  assert.equal(env.anthropicApiKey, '');
});
