import type { Env } from '../config/env';
import type { ClienteLlm } from './tipos';
import { crearClienteAnthropic } from './anthropic';
import { crearClienteOpenAi } from './openai';

export function crearClienteLlm(env: Env): ClienteLlm {
  if (env.llmProvider === 'anthropic') return crearClienteAnthropic(env.anthropicApiKey, env.llmModel);
  return crearClienteOpenAi(env.openaiApiKey, env.llmModel);
}
