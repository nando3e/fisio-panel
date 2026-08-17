/**
 * Resolución del paciente AL INICIO del turno, en código, SIEMPRE (design.md D6):
 * la continuidad no depende de que el modelo llame a ninguna tool.
 */

import type { Paciente, PacientesRepo } from '../db/repos/pacientes';
import type { Cita, CitasRepo } from '../db/repos/citas';
import type { ChatMemoryRepo } from '../db/repos/conversacion';
import type { ConfigNegocio } from '../config/negocio';
import type { CatalogoRepo } from '../db/repos/catalogo';
import { detectarIdioma } from './idioma';

export interface Recurrente {
  pacienteId: number;
  ultimoProfesionalId: number;
  ultimoProfesionalNombre: string;
  ultimoServicioId: number | null;
  ultimoServicioNombre: string | null;
  ultimaFecha: Date;
}

export interface ContextoPaciente {
  telefono: string;
  titular: Paciente | null;
  candidatos: Paciente[];
  idioma: 'ca' | 'es';
  recurrente: Recurrente | null;   // del titular; los terceros se resuelven al reservar para ellos
  citasFuturas: Cita[];            // de todas las fichas del teléfono
}

export interface DepsTurno {
  pacientes: PacientesRepo;
  citas: CitasRepo;
  memoria: ChatMemoryRepo;
  config: ConfigNegocio;
  catalogo: CatalogoRepo;
}

export async function resolverRecurrente(
  deps: Pick<DepsTurno, 'citas' | 'catalogo'>, pacienteId: number, ahora: Date,
): Promise<Recurrente | null> {
  try {
    const ultima = await deps.citas.ultimaPasada(pacienteId, ahora);
    if (!ultima || !ultima.professionalId) return null;
    const pro = await deps.catalogo.profesional(ultima.professionalId);
    if (!pro) return null; // profesional ya no activo → no hay continuidad
    const servicio = ultima.serviceId ? await deps.catalogo.servicio(ultima.serviceId) : null;
    return {
      pacienteId,
      ultimoProfesionalId: pro.id,
      ultimoProfesionalNombre: pro.name,
      ultimoServicioId: servicio?.id ?? null,
      ultimoServicioNombre: servicio?.name ?? null,
      ultimaFecha: ultima.startTime,
    };
  } catch (err) {
    console.error('[turno] resolverRecurrente falló (se degrada a sin continuidad):', err);
    return null; // un fallo de BD no rompe la reserva
  }
}

export async function resolverContextoPaciente(deps: DepsTurno, telefono: string, ahora: Date): Promise<ContextoPaciente> {
  const candidatos = await deps.pacientes.porTelefono(telefono);
  const titular = candidatos.find((p) => p.titular) ?? null;

  // Idioma: ficha si existe; si no, detección; si no, default del panel.
  let idioma = (titular?.idiomaPreferido as 'ca' | 'es' | null) ?? null;
  const detectado = detectarIdioma(await deps.memoria.ultimosDelCliente(telefono));
  if (detectado && detectado !== idioma) {
    idioma = detectado;
    if (titular) await deps.pacientes.ponerIdioma(titular.id, detectado).catch(() => {});
  }
  if (!idioma) idioma = (await deps.config.valor('idioma_por_defecto')) as 'ca' | 'es';

  const recurrente = titular ? await resolverRecurrente(deps, titular.id, ahora) : null;
  const citasFuturas = await deps.citas.futurasDePacientes(candidatos.map((p) => p.id), ahora);

  return { telefono, titular, candidatos, idioma, recurrente, citasFuturas };
}
