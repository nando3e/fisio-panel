/** STT de notas de voz (endpoint compatible OpenAI). El catálogo sesga la transcripción. */

export interface DepsStt { url: string; apiKey: string; modelo: string }

export async function transcribir(deps: DepsStt, urlAudio: string, promptSesgo: string): Promise<string> {
  const audio = await fetch(urlAudio);
  if (!audio.ok) throw new Error(`Descarga de audio: HTTP ${audio.status}`);
  const blob = await audio.blob();

  const form = new FormData();
  form.append('file', blob, 'nota.ogg');
  form.append('model', deps.modelo);
  form.append('prompt', promptSesgo.slice(0, 800));

  const res = await fetch(deps.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deps.apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`STT: HTTP ${res.status}`);
  const datos = (await res.json()) as { text?: string };
  const texto = (datos.text ?? '').trim();
  if (!texto) throw new Error('STT: transcripción vacía');
  return texto;
}

export function promptSesgoDesdeCatalogo(servicios: string[], profesionales: string[]): string {
  return `Conversación de WhatsApp con una clínica de fisioterapia. Servicios: ${servicios.join(', ')}. Profesionales: ${profesionales.join(', ')}. Puede estar en catalán o castellano.`;
}
