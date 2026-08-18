/**
 * Sincronización bidireccional con Google Calendar:
 *  - borrados a mano → estado 'anulada' en el espejo
 *  - apuntes a mano → alta con parseo de teléfono del título o de la descripción
 *    (y reciben recordatorio)
 * Sin teléfono en ninguno de los dos, el evento se ignora aquí: sigue ocupando
 * hueco, que es lo importante.
 */

import type { CalendarioPort } from '../calendar/google';
import type { CatalogoRepo } from '../db/repos/catalogo';
import type { CitasRepo } from '../db/repos/citas';
import type { PacientesRepo } from '../db/repos/pacientes';
import { extraerContacto } from '../calendar/titulo';

export interface DepsSincronizar {
  calendario: CalendarioPort;
  catalogo: CatalogoRepo;
  citas: CitasRepo;
  pacientes: PacientesRepo;
}

export async function sincronizarCalendario(deps: DepsSincronizar, desde: Date, hasta: Date): Promise<void> {
  const cat = await deps.catalogo.catalogo();
  for (const pro of cat.profesionales) {
    try {
      const eventos = await deps.calendario.listarEventos(pro.calendarId, desde, hasta);
      const vigentes = eventos.filter((e) => e.status !== 'cancelled');
      await deps.citas.sincronizarBorrados(pro.id, vigentes.map((e) => e.id), desde, hasta);

      for (const evento of vigentes) {
        if (!evento.start?.dateTime || !evento.end?.dateTime) continue; // día completo: solo ocupa

        // Ya registrado: detectar MOVIMIENTOS a mano (hora o calendario). Sin esto,
        // el recordatorio saldría con la hora vieja (lección de balta).
        const existente = await deps.citas.porEventId(evento.id);
        if (existente) {
          const inicio = new Date(evento.start.dateTime);
          const fin = new Date(evento.end.dateTime);
          if (existente.startTime.getTime() !== inicio.getTime() || existente.endTime.getTime() !== fin.getTime()) {
            // reprogramar resetea el recordatorio: la hora nueva recibe su aviso.
            await deps.citas.reprogramar(evento.id, inicio, fin);
          }
          if (existente.professionalId !== pro.id) {
            await deps.citas.reasignarProfesional(evento.id, pro.id);
          }
          continue;
        }

        const { nombre, telefono } = extraerContacto(evento);
        let pacienteId: number | null = null;
        if (telefono) {
          const titular = await deps.pacientes.guardarTitular(telefono, { nombre });
          pacienteId = titular.id;
        }
        await deps.citas.altaSincronizada({
          googleEventId: evento.id,
          professionalId: pro.id,
          pacienteId,
          telefono,
          nombre,
          inicio: new Date(evento.start.dateTime),
          fin: new Date(evento.end.dateTime),
        });
      }
    } catch (err) {
      // Un calendario caído no bloquea la sincronización del resto.
      console.error(`[sincronizar] calendario de ${pro.name} falló:`, err);
    }
  }
}
