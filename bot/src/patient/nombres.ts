/**
 * Nombres de relleno que el modelo intenta colar cuando se salta la pregunta.
 * Lista DELIBERADAMENTE corta: un falso positivo deja a una persona real sin
 * poder reservar nunca y sin síntoma (lección de balta, "Marc Prova").
 */

const RELLENOS = new Set([
  'client', 'clienta', 'cliente', 'client whatsapp', 'cliente whatsapp',
  'whatsapp', 'usuario', 'usuari', 'paciente', 'pacient',
  'pendent', 'pendiente', 'desconegut', 'desconocido', 'desconocida',
  'anonim', 'anónimo', 'anonimo', 'sense nom', 'sin nombre',
  'nou', 'nueva', 'nuevo', 'n/a', 'na', 'no', 'si', 'sí', 'ok',
  '-', '.', '--', '?', 'x', 'xx',
]);

export function esRelleno(nombre: string): boolean {
  const limpio = nombre.trim().toLowerCase();
  if (!limpio || limpio.length < 2) return true;
  if (/[([{<]/.test(limpio)) return true; // "(pendent)", "[nombre]"
  return RELLENOS.has(limpio);
}
