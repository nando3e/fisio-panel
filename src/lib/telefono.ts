/** Normalización a E.164, igual que la del bot: una sola vez, en el borde. */
export function aE164(bruto: string | null | undefined): string | null {
  if (!bruto) return null
  const digitos = bruto.replace(/[^\d+]/g, '')
  if (!digitos) return null
  if (digitos.startsWith('+')) {
    const resto = digitos.slice(1)
    return /^\d{9,15}$/.test(resto) ? `+${resto}` : null
  }
  if (/^34\d{9}$/.test(digitos)) return `+${digitos}`
  if (/^[679]\d{8}$/.test(digitos)) return `+34${digitos}`
  if (/^\d{9,15}$/.test(digitos)) return `+${digitos}`
  return null
}
