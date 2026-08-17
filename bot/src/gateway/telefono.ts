/**
 * Normalización de teléfono a E.164, UNA sola vez, en el borde. A partir del
 * gateway nadie vuelve a tocar el formato (en n8n convivían tres normalizaciones
 * y los recordatorios no encontraban al cliente).
 */

export function aE164(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const digitos = bruto.replace(/[^\d+]/g, '');
  if (!digitos) return null;
  if (digitos.startsWith('+')) {
    const resto = digitos.slice(1);
    return /^\d{9,15}$/.test(resto) ? `+${resto}` : null;
  }
  if (/^34\d{9}$/.test(digitos)) return `+${digitos}`;
  if (/^[679]\d{8}$/.test(digitos)) return `+34${digitos}`;
  if (/^\d{9,15}$/.test(digitos)) return `+${digitos}`; // internacional sin '+'
  return null;
}

/** Últimos 9 dígitos, para comparar con números de config (soporte/avisos). */
export function ultimos9(telefono: string): string {
  return telefono.replace(/\D/g, '').slice(-9);
}
