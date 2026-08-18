/**
 * Recordatorios por franja (design.md D14):
 *  - cita de MAÑANA → el día ANTERIOR a la hora recordatorio_manana_hora
 *  - cita de TARDE  → el MISMO día a la hora recordatorio_tarde_hora
 * Exactamente-una-vez: lease atómico + recordada_en + tope de intentos.
 * recordatorios_activos=false (default) = dry-run: solo log.
 */

import type { ConfigNegocio } from '../config/negocio';
import type { CatalogoRepo } from '../db/repos/catalogo';
import type { Cita, CitasRepo } from '../db/repos/citas';
import type { PacientesRepo } from '../db/repos/pacientes';
import type { TextosRepo } from '../db/repos/prompts';
import type { ChatMemoryRepo } from '../db/repos/conversacion';
import { aMinutos, fechaLocal, fechaLegible, horaLocal, instanteLocal, minutosLocales, sumarDias } from '../booking/tiempo';

export interface ConfigRecordatorio {
  mananaHora: string;      // 'HH:MM' del día anterior (citas de mañana)
  tardeHora: string;       // 'HH:MM' del mismo día (citas de tarde)
  limiteFranjaTarde: string;
  tz: string;
}

/** Momento a partir del cual toca enviar el recordatorio de una cita. */
export function momentoDeEnvio(inicioCita: Date, cfg: ConfigRecordatorio): Date {
  const fechaCita = fechaLocal(inicioCita, cfg.tz);
  const esTarde = minutosLocales(inicioCita, cfg.tz) >= aMinutos(cfg.limiteFranjaTarde);
  return esTarde
    ? instanteLocal(fechaCita, aMinutos(cfg.tardeHora), cfg.tz)
    : instanteLocal(sumarDias(fechaCita, -1), aMinutos(cfg.mananaHora), cfg.tz);
}

const MIN_ANTELACION_MIN = 45; // una cita reservada hace un momento no necesita recordatorio

export interface DepsRecordatorios {
  config: ConfigNegocio;
  catalogo: CatalogoRepo;
  citas: CitasRepo;
  pacientes: PacientesRepo;
  textos: TextosRepo;
  memoria: ChatMemoryRepo;
  entregar: (telefono: string, texto: string) => Promise<void>;
  sincronizarVentana: (desde: Date, hasta: Date) => Promise<void>;
}

export async function rondaRecordatorios(deps: DepsRecordatorios, ahora = new Date()): Promise<void> {
  const settings = await deps.config.settings();
  const cfg: ConfigRecordatorio = {
    mananaHora: await deps.config.valor('recordatorio_manana_hora'),
    tardeHora: await deps.config.valor('recordatorio_tarde_hora'),
    limiteFranjaTarde: await deps.config.valor('limite_franja_tarde'),
    tz: settings.timezone,
  };
  const activos = await deps.config.booleano('recordatorios_activos');

  const hasta = new Date(ahora.getTime() + 36 * 3_600_000);
  // Las citas apuntadas a mano también reciben recordatorio: sincronizar ANTES de decidir.
  try {
    await deps.sincronizarVentana(ahora, hasta);
  } catch (err) {
    console.error('[recordatorios] sincronización previa falló (la ronda sigue):', err);
  }

  const candidatas = await deps.citas.pendientesDeRecordar(new Date(ahora.getTime() + MIN_ANTELACION_MIN * 60_000), hasta);
  const vencidas = candidatas.filter((c) => momentoDeEnvio(c.startTime, cfg).getTime() <= ahora.getTime());
  if (!vencidas.length) return;

  if (!activos) {
    for (const c of vencidas) {
      console.log(`[recordatorios][dry-run] enviaría a ${c.telefono ?? '(sin tel)'} — cita ${fechaLocal(c.startTime, cfg.tz)} ${horaLocal(c.startTime, cfg.tz)}`);
    }
    return;
  }

  const reservadas = await deps.citas.reservarParaRecordar(vencidas.map((c) => c.id));
  for (const cita of reservadas) {
    try {
      if (!cita.telefono) { await deps.citas.confirmarRecordada(cita.id); continue; }
      const texto = await componerTexto(deps, cita, cfg);
      await deps.entregar(cita.telefono, texto);
      await deps.citas.confirmarRecordada(cita.id);
      // El recordatorio queda en el hilo: si contesta "no podré venir", el bot lo ve con contexto.
      await deps.memoria.registrar(cita.telefono, 'ai', texto).catch(() => {});
    } catch (err) {
      await deps.citas.liberarRecordatorio(cita.id, err instanceof Error ? err.message : String(err));
    }
  }
}

async function componerTexto(deps: DepsRecordatorios, cita: Cita, cfg: ConfigRecordatorio): Promise<string> {
  const paciente = cita.pacienteId ? await deps.pacientes.porId(cita.pacienteId) : null;
  const idioma = paciente?.idiomaPreferido ?? (await deps.config.valor('idioma_por_defecto'));
  const plantilla = (await deps.textos.texto('recordatorio', idioma)) ??
    'Hola {nombre}, te recordamos tu cita {dia} a las {hora} en {negocio}.';
  const pro = cita.professionalId ? await deps.catalogo.profesional(cita.professionalId) : null;
  const servicio = cita.serviceId ? await deps.catalogo.servicio(cita.serviceId) : null;
  const esHoy = fechaLocal(cita.startTime, cfg.tz) === fechaLocal(new Date(), cfg.tz);
  const dia = esHoy
    ? (idioma === 'ca' ? 'avui' : 'hoy')
    : `${idioma === 'ca' ? 'el' : 'el'} ${fechaLegible(fechaLocal(cita.startTime, cfg.tz), idioma)}`;
  return plantilla
    .replaceAll('{nombre}', cita.nombre ?? paciente?.nombre ?? '')
    .replaceAll('{dia}', dia)
    .replaceAll('{hora}', horaLocal(cita.startTime, cfg.tz))
    .replaceAll('{profesional}', pro?.name ?? '')
    .replaceAll('{servicio}', servicio?.name ?? (idioma === 'ca' ? 'fisioteràpia' : 'fisioterapia'))
    .replaceAll('{negocio}', await deps.config.valor('nombre_negocio'))
    .replace(/\s{2,}/g, ' ');
}

/** Aviso de propuesta sin respuesta: una sola vez, silenciada si el cliente ya escribió. */
export async function rondaConfirmacionesPendientes(deps: {
  config: ConfigNegocio;
  confirmaciones: {
    pendientesDeAviso(seg: number): Promise<Array<{ telefono: string }>>;
    marcarAvisada(t: string): Promise<void>;
    purgarSimuladas(horas?: number): Promise<number>;
  };
  pacientes: PacientesRepo;
  textos: TextosRepo;
  memoria: ChatMemoryRepo;
  entregar: (telefono: string, texto: string) => Promise<void>;
}): Promise<void> {
  await deps.confirmaciones.purgarSimuladas().catch(() => {});
  const segundos = await deps.config.entero('segundos_confirmacion_pendiente');
  const pendientes = await deps.confirmaciones.pendientesDeAviso(segundos);
  for (const p of pendientes) {
    try {
      const titular = await deps.pacientes.titular(p.telefono);
      const idioma = titular?.idiomaPreferido ?? (await deps.config.valor('idioma_por_defecto'));
      const texto = (await deps.textos.texto('confirmacion_pendiente', idioma)) ?? '¿Te guardo la hora propuesta?';
      await deps.entregar(p.telefono, texto);
      await deps.memoria.registrar(p.telefono, 'ai', texto).catch(() => {});
      await deps.confirmaciones.marcarAvisada(p.telefono);
    } catch (err) {
      console.error(`[confirmaciones] aviso a ${p.telefono} falló:`, err);
    }
  }
}
