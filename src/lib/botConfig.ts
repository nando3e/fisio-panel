/**
 * Claves de bot_config editables desde el panel. Espejo de bot/src/config/negocio.ts
 * (la validación dura vive también en el bot: un valor corrupto cae al default con log).
 */

export interface ClavePanel {
  clave: string
  etiqueta: string
  tipo: 'select' | 'bool' | 'hora' | 'texto' | 'entero'
  opciones?: string[]
  def: string
  ayuda: string
}

export const CLAVES_BOT: ClavePanel[] = [
  { clave: 'continuidad_modo', etiqueta: 'Continuidad asistencial', tipo: 'select', opciones: ['preferida', 'obligatoria'], def: 'preferida', ayuda: 'Preferida: se sugiere su fisio habitual. Obligatoria: solo su fisio (salvo servicio que no realice).' },
  { clave: 'idioma_por_defecto', etiqueta: 'Idioma por defecto', tipo: 'select', opciones: ['es', 'ca'], def: 'es', ayuda: 'Cuando no se detecta el idioma del paciente. El bot responde en el idioma que detecte en sus mensajes.' },
  { clave: 'stt_activado', etiqueta: 'Transcribir notas de voz', tipo: 'bool', def: 'false', ayuda: 'Apagado: el bot pide amablemente el mensaje por escrito.' },
  { clave: 'recordatorios_activos', etiqueta: 'Enviar recordatorios', tipo: 'bool', def: 'false', ayuda: 'Apagado = modo pruebas: los recordatorios solo se registran en los logs.' },
  { clave: 'recordatorio_manana_hora', etiqueta: 'Recordatorio citas de mañana (hora del día ANTERIOR)', tipo: 'hora', def: '19:00', ayuda: 'Las citas de por la mañana se recuerdan el día antes a esta hora.' },
  { clave: 'recordatorio_tarde_hora', etiqueta: 'Recordatorio citas de tarde (hora del MISMO día)', tipo: 'hora', def: '09:30', ayuda: 'Las citas de por la tarde se recuerdan esa misma mañana a esta hora.' },
  { clave: 'limite_franja_tarde', etiqueta: 'Una cita es "de tarde" a partir de', tipo: 'hora', def: '15:00', ayuda: '' },
  { clave: 'nombre_negocio', etiqueta: 'Nombre del negocio', tipo: 'texto', def: 'Clínica de Fisioterapia', ayuda: '' },
  { clave: 'direccion_negocio', etiqueta: 'Dirección', tipo: 'texto', def: '', ayuda: 'La que da el bot cuando preguntan dónde estáis.' },
  { clave: 'telefono_avisos', etiqueta: 'WhatsApp de avisos al negocio', tipo: 'texto', def: '', ayuda: 'Recibe los avisos de huecos liberados (anulaciones de hoy).' },
  { clave: 'telefono_soporte', etiqueta: 'Número de soporte (comandos)', tipo: 'texto', def: '', ayuda: 'Puede enviar activabot / desactivabot / consultabot por WhatsApp.' },
  { clave: 'horas_modificacion', etiqueta: 'Antelación mínima para modificar (h)', tipo: 'entero', def: '2', ayuda: '' },
  { clave: 'horas_aviso_hueco', etiqueta: 'Vista extra de avisos de hueco (h)', tipo: 'entero', def: '0', ayuda: '0 = solo huecos de hoy.' },
  { clave: 'dias_a_mostrar', etiqueta: 'Días con hueco a ofrecer', tipo: 'entero', def: '3', ayuda: '' },
  { clave: 'dias_calendario', etiqueta: 'Días de la tabla de referencia', tipo: 'entero', def: '21', ayuda: '' },
  { clave: 'segundos_agrupacion', etiqueta: 'Ventana de agrupación de mensajes (s)', tipo: 'entero', def: '5', ayuda: '' },
  { clave: 'segundos_confirmacion_pendiente', etiqueta: 'Aviso de propuesta sin respuesta (s)', tipo: 'entero', def: '90', ayuda: '' },
]

export function validarClave(clave: string, valor: string): string | null {
  const def = CLAVES_BOT.find((c) => c.clave === clave)
  if (!def) return `Clave desconocida: ${clave}`
  const v = valor.trim()
  if (def.tipo === 'select' && !def.opciones!.includes(v)) return `Valor inválido para ${clave}`
  if (def.tipo === 'bool' && !['true', 'false'].includes(v)) return `Valor inválido para ${clave}`
  if (def.tipo === 'hora' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return `Hora inválida (HH:MM)`
  if (def.tipo === 'entero' && !/^\d+$/.test(v)) return `Debe ser un número entero`
  return null
}
