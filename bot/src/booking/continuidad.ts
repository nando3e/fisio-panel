/**
 * Decisión de continuidad (design.md D6). El prompt guía la conversación;
 * la restricción dura vive AQUÍ y se aplica en consultar_disponibilidad y confirmar_cita.
 */

import type { CatalogoRepo } from '../db/repos/catalogo';
import type { Recurrente } from '../patient/turno';

export type DecisionContinuidad =
  | { kind: 'none' }
  | { kind: 'force'; professionalId: number; nombre: string }
  | { kind: 'exception'; prevProfessionalId: number; nombre: string };

export async function decidirContinuidad(args: {
  modo: 'preferida' | 'obligatoria';
  recurrente: Recurrente | null;
  serviceId: number;
  catalogo: CatalogoRepo;
}): Promise<DecisionContinuidad> {
  const { modo, recurrente, serviceId, catalogo } = args;
  if (modo !== 'obligatoria') return { kind: 'none' };      // preferida = solo prompt (intencionado)
  if (!recurrente) return { kind: 'none' };                 // nuevo o no resuelto

  const suFisio = recurrente.ultimoProfesionalId;
  const ofrece = await catalogo.ofreceServicio(suFisio, serviceId);
  if (ofrece) return { kind: 'force', professionalId: suFisio, nombre: recurrente.ultimoProfesionalNombre };

  // Excepción por servicio: su fisio no lo hace — solo si OTRO sí lo hace.
  const otros = (await catalogo.profesionalesDeServicio(serviceId)).filter((p) => p.id !== suFisio);
  if (otros.length) return { kind: 'exception', prevProfessionalId: suFisio, nombre: recurrente.ultimoProfesionalNombre };

  // Nadie hace el servicio: error de configuración; se degrada a none y la capa de
  // disponibilidad devolverá "sin profesionales asignados" de forma visible.
  return { kind: 'none' };
}

/** Redacción ÚNICA por modo (una sola fuente de texto; el system prompt remite a ella). */
export function instruccionContinuidad(
  modo: 'preferida' | 'obligatoria', nombreFisio: string, idioma: string,
): string {
  if (modo === 'obligatoria') {
    return idioma === 'ca'
      ? `CONTINUÏTAT OBLIGATÒRIA: aquest pacient es visita SEMPRE amb ${nombreFisio}. Pregunta primer per a quin servei vol la cita. Si ${nombreFisio} fa aquest servei, ofereix i reserva NOMÉS amb ell/a (no ofereixis canviar de professional ni l'opció "qualsevol"). Si no hi ha forat, ofereix només altres forats seus. EXCEPCIÓ: si el servei demanat NO el fa ${nombreFisio}, s'obre als professionals que sí que el fan, explicant el motiu. El sistema aplica aquesta regla també pel seu compte.`
      : `CONTINUIDAD OBLIGATORIA: este paciente se visita SIEMPRE con ${nombreFisio}. Pregunta primero para qué servicio quiere la cita. Si ${nombreFisio} realiza ese servicio, ofrece y reserva SOLO con él/ella (no ofrezcas cambiar de profesional ni la opción "cualquiera"). Si no hay hueco, ofrece solo otros huecos suyos. EXCEPCIÓN: si el servicio pedido NO lo realiza ${nombreFisio}, se abre a los profesionales que sí lo hacen, explicando el motivo. El sistema aplica esta regla también por su cuenta.`;
  }
  return idioma === 'ca'
    ? `CONTINUÏTAT PREFERIDA: proposa per defecte forats amb ${nombreFisio} (el seu fisioterapeuta habitual), sense oferir la llista de professionals. Només canvia de professional (o ofereix "qualsevol") si el pacient ho demana o si no hi ha forat raonable amb ${nombreFisio} — i digues-ho abans d'obrir a altres.`
    : `CONTINUIDAD PREFERIDA: propón por defecto huecos con ${nombreFisio} (su fisioterapeuta habitual), sin ofrecer la lista de profesionales. Solo cambia de profesional (u ofrece "cualquiera") si el paciente lo pide o si no hay hueco razonable con ${nombreFisio} — y dilo antes de abrir a otros.`;
}
