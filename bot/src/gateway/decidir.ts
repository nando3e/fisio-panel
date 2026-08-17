import { ultimos9 } from './telefono';
import type { MensajeEntrante } from './chatwoot';

export type Decision =
  | { accion: 'ignorar' }
  | { accion: 'solo_registrar'; rol: 'human' | 'humano_negocio' }
  | { accion: 'comando'; comando: 'activabot' | 'desactivabot' | 'consultabot' }
  | { accion: 'responder' };

/**
 * Decisión del turno: función PURA, sin efectos. Regla de fondo: el historial se
 * llena SIEMPRE (responda o no), para que al reactivar el bot tenga contexto.
 */
export function decidir(args: {
  mensaje: MensajeEntrante;
  botActivoGlobal: boolean;
  telefonoSoporte: string;   // '' si no configurado
}): Decision {
  const { mensaje, botActivoGlobal, telefonoSoporte } = args;

  if (mensaje.tipo === 'eco_propio' || mensaje.tipo === 'irrelevante') return { accion: 'ignorar' };
  if (mensaje.tipo === 'saliente_humano') {
    return mensaje.contenido ? { accion: 'solo_registrar', rol: 'humano_negocio' } : { accion: 'ignorar' };
  }
  if (!mensaje.contenido && !mensaje.esNotaDeVoz) return { accion: 'ignorar' };

  // Comando de soporte: comparación EXACTA de los últimos 9 dígitos, no "contains".
  if (telefonoSoporte && mensaje.telefono && ultimos9(mensaje.telefono) === ultimos9(telefonoSoporte)) {
    const texto = (mensaje.contenido ?? '').trim().toLowerCase();
    if (texto === 'activabot' || texto === 'desactivabot' || texto === 'consultabot') {
      return { accion: 'comando', comando: texto };
    }
  }

  if (!botActivoGlobal) return { accion: 'solo_registrar', rol: 'human' };
  if (mensaje.botDesactivadoContacto) return { accion: 'solo_registrar', rol: 'human' };
  return { accion: 'responder' };
}
