import { fechaLocal, horaLocal } from '../booking/tiempo';

/**
 * ÚNICA definición de "¿este hueco liberado se avisa?" — la consultan los TRES
 * caminos que liberan hora (anular, modificar, sustituir). Un hueco de HOY avisa
 * siempre; horas_aviso_hueco amplía la vista por delante.
 */
export function huecoAvisable(inicio: Date, ahora: Date, tz: string, horasVista: number): boolean {
  if (inicio.getTime() <= ahora.getTime()) return false;
  if (fechaLocal(inicio, tz) === fechaLocal(ahora, tz)) return true;
  return horasVista > 0 && inicio.getTime() - ahora.getTime() <= horasVista * 60 * 60_000;
}

export interface DatosAvisoHueco {
  inicio: Date;
  tz: string;
  nombrePaciente: string | null;
  telefonoPaciente: string;
  servicio: string | null;
  profesional: string | null;
}

export function mensajeAvisoHueco(datos: DatosAvisoHueco): string {
  const dia = fechaLocal(datos.inicio, datos.tz);
  const hora = horaLocal(datos.inicio, datos.tz);
  const quien = datos.nombrePaciente ?? 'Un paciente';
  const tel = datos.telefonoPaciente.replace(/^\+34/, '');
  const extras = [datos.servicio, datos.profesional].filter(Boolean).join(' · ');
  return `🕐 Hueco libre: ${dia} a las ${hora}${extras ? ` (${extras})` : ''}. ${quien} (${tel}) ha liberado la hora.`;
}
