/**
 * Formato del título de los eventos que crea el bot, y parseo tolerante de los
 * títulos que el negocio escribe a mano ("Joan 666555444", "Marta tel. 666 55 54 44").
 * El MOTIVO va SIEMPRE en la descripción, nunca en el título (dato de salud).
 * El TELÉFONO tampoco va en el título (no cabe y estorba): vive en la descripción,
 * de donde lo recupera la sincronización si hace falta.
 */

export function componerTitulo(nombre: string, apellido: string | null, codigoServicio: string): string {
  const completo = [nombre, apellido].filter(Boolean).join(' ');
  return `${completo} - ${codigoServicio}`;
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

/**
 * Contacto de un evento: nombre del título; teléfono del título o, si no está,
 * de la descripción (los eventos del bot llevan ahí su "Tel: +34…", y un apunte
 * a mano puede ponerlo donde prefiera).
 */
export function extraerContacto(evento: { summary?: string | null; description?: string | null }): TituloParseado {
  const delTitulo = parsearTituloLibre(evento.summary ?? '');
  if (delTitulo.telefono) return delTitulo;
  const deDescripcion = parsearTituloLibre(evento.description ?? '');
  return { nombre: delTitulo.nombre, telefono: deDescripcion.telefono };
}
