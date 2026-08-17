/** Credenciales e infraestructura. Lo que cambia porque el negocio decide vive en BD (config/negocio.ts). */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export interface Env {
  puerto: number;
  databaseUrl: string;
  llmProvider: 'anthropic' | 'openai';
  llmModel: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  embeddingsApiUrl: string;
  embeddingsApiKey: string;
  embeddingsModel: string;
  chatwootUrl: string;
  chatwootAccountId: string;
  chatwootToken: string;
  webhookSecret: string;
  evolutionUrl: string;
  evolutionInstance: string;
  evolutionToken: string;
  googleServiceAccountJson: string;
  sttUrl: string;
  sttApiKey: string;
  sttModel: string;
  adminToken: string;
  dryRun: boolean;
  recordatoriosDryRun: boolean;
}

function req(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`Variable de entorno requerida ausente: ${nombre}`);
  return v;
}

const opt = (nombre: string, def = ''): string => process.env[nombre] ?? def;
const esTrue = (v: string): boolean => v.trim().toLowerCase() === 'true';

/**
 * Credenciales de Google en UNA sola variable, `GOOGLE_SERVICE_ACCOUNT`, que acepta
 * tres formas según dónde corra el servicio:
 *   - RUTA al fichero descargado → local (`./fisios-serviceaccount.json`)
 *   - BASE64 del fichero         → Dokploy y cualquier panel de variables: es la forma
 *     segura, porque no lleva comillas, ni `$`, ni saltos de línea que se puedan romper
 *   - JSON en UNA línea          → sirve, pero es frágil en paneles de variables
 * Se aceptan los nombres antiguos como alias para no romper despliegues existentes.
 */
function cargarServiceAccount(): string {
  const valor = (opt('GOOGLE_SERVICE_ACCOUNT') || opt('GOOGLE_SERVICE_ACCOUNT_FILE') || opt('GOOGLE_SERVICE_ACCOUNT_JSON')).trim();
  if (!valor) return '';

  if (valor.startsWith('{')) {
    try {
      JSON.parse(valor);
    } catch {
      throw new Error(
        'GOOGLE_SERVICE_ACCOUNT parece un JSON pero no es válido: en un .env o en un panel de ' +
        'variables debe ir en UNA sola línea. Más robusto: usa el valor en base64.',
      );
    }
    return valor;
  }

  // Base64: sin comillas ni saltos de línea, a prueba de paneles de variables.
  if (/^[A-Za-z0-9+/=\s]+$/.test(valor) && valor.length > 100) {
    let decodificado = '';
    try {
      decodificado = Buffer.from(valor.replace(/\s/g, ''), 'base64').toString('utf8');
    } catch { /* no era base64: se intenta como ruta */ }
    if (decodificado.trimStart().startsWith('{')) {
      try {
        JSON.parse(decodificado);
        return decodificado;
      } catch {
        throw new Error('GOOGLE_SERVICE_ACCOUNT en base64 decodifica a algo que no es un JSON válido.');
      }
    }
  }

  const absoluta = isAbsolute(valor) ? valor : resolve(process.cwd(), valor);
  if (!existsSync(absoluta)) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT no es un JSON, ni base64 válido, ni un fichero existente: ${absoluta}`,
    );
  }
  const contenido = readFileSync(absoluta, 'utf8');
  try {
    JSON.parse(contenido);
  } catch {
    throw new Error(`El fichero de credenciales no contiene un JSON válido: ${absoluta}`);
  }
  return contenido;
}

/**
 * @param tolerante El diagnóstico necesita cargar el entorno AUNQUE falten claves:
 * su trabajo es justamente informar de lo que falta, no morir por ello.
 */
export function cargarEnv(tolerante = false): Env {
  const llmProvider = (opt('LLM_PROVIDER', 'anthropic') as Env['llmProvider']);
  if (llmProvider !== 'anthropic' && llmProvider !== 'openai') {
    throw new Error(`LLM_PROVIDER inválido: ${llmProvider}`);
  }
  const env: Env = {
    puerto: parseInt(opt('PORT', '3000'), 10),
    databaseUrl: req('DATABASE_URL'),
    llmProvider,
    llmModel: opt('LLM_MODEL', llmProvider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4.1'),
    anthropicApiKey: opt('ANTHROPIC_API_KEY'),
    openaiApiKey: opt('OPENAI_API_KEY'),
    embeddingsApiUrl: opt('EMBEDDINGS_API_URL', 'https://api.openai.com/v1/embeddings'),
    embeddingsApiKey: opt('EMBEDDINGS_API_KEY'),
    embeddingsModel: opt('EMBEDDINGS_MODEL', 'text-embedding-3-small'),
    chatwootUrl: opt('CHATWOOT_URL'),
    chatwootAccountId: opt('CHATWOOT_ACCOUNT_ID', '1'),
    chatwootToken: opt('CHATWOOT_TOKEN'),
    webhookSecret: opt('WEBHOOK_SECRET', 'cambiame'),
    evolutionUrl: opt('EVOLUTION_URL'),
    evolutionInstance: opt('EVOLUTION_INSTANCE'),
    evolutionToken: opt('EVOLUTION_TOKEN'),
    googleServiceAccountJson: cargarServiceAccount(),
    sttUrl: opt('STT_URL'),
    sttApiKey: opt('STT_API_KEY'),
    sttModel: opt('STT_MODEL', 'whisper-1'),
    adminToken: opt('ADMIN_TOKEN'),
    dryRun: esTrue(opt('DRY_RUN', 'true')),
    recordatoriosDryRun: esTrue(opt('RECORDATORIOS_DRY_RUN', 'true')),
  };
  if (!tolerante) {
    if (llmProvider === 'anthropic' && !env.anthropicApiKey) throw new Error('Falta ANTHROPIC_API_KEY');
    if (llmProvider === 'openai' && !env.openaiApiKey) throw new Error('Falta OPENAI_API_KEY');
  }
  return env;
}
