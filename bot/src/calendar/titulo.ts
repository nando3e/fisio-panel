/**
 * Formato del título de los eventos que crea el bot, y parseo tolerante de los
 * títulos que el negocio escribe a mano ("Joan 666555444", "Marta tel. 666 55 54 44").
 * El MOTIVO va SIEMPRE en la descripción, nunca en el título (dato de salud).
 */

export function componerTitulo(nombre: string, apellido: string | null, telefonoE164: string, codigoServicio: string): string {
  const nacional = telefonoE164.replace(/^\+34/, '');
  const completo = [nombre, apellido].filter(Boolean).join(' ');
  return `${completo} - ${nacional} - ${codigoServicio}`;
}

export interface TituloParseado { nombre: string | null; telefono: string | null }

/** Extrae teléfono (9 dígitos españoles, con o sin prefijo/espacios) y nombre de un título libre. */
export function parsearTituloLibre(titulo: string): TituloParseado {
  const limpio = titulo.trim();
  const matchTel = limpio.replace(/[.\-]/g, ' ').match(/(?:\+?34[\s]?)?((?:\d[\s]?){9})(?!\d)/);
  let telefono: string | null = null;
  if (matchTel?.[1]) {
    const digitos = matchTel[1].replace(/\s/g, '');
    if (/^[679]\d{8}$/.test(digitos)) telefono = `+34${digitos}`;
  }
  let nombre: string | null = null;
  const sinTelefono = limpio
    .replace(/(?:\+?34[\s]?)?(?:\d[\s.\-]?){9,}/g, ' ')
    .replace(/\b(?:tel|tlf|telf|teléfono|telefono|mòbil|movil|móvil)\b\.?:?/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[-–—,]+\s*$/, '')
    .trim();
  if (sinTelefono.length >= 2) nombre = sinTelefono;
  return { nombre, telefono };
}
