/**
 * Las reglas duras se aplican AQUÍ, no en el prompt: continuidad, anclaje a hueco real,
 * revalidación antes de escribir, idempotencia, salvaguarda de nombre, sustitución declarada
 * y umbrales. Un prompt puede ignorarse; esto no.
 * Prueba de fuego: si el modelo ignorase el prompt entero, nada irreversible puede pasar.
 */

import type { Pool } from 'pg';
import type { ConfigNegocio } from '../config/negocio';
import type { CatalogoRepo, Profesional } from '../db/repos/catalogo';
import type { CalendarioPort } from '../calendar/google';
import { PacientesRepo, mismoNombreDePila } from '../db/repos/pacientes';
import type { CitasRepo, Cita } from '../db/repos/citas';
import type { ConfirmacionesRepo } from '../db/repos/conversacion';
import { registrarAnomalia } from '../db/repos/traces';
import { calcularDisponibilidad, type DepsDisponibilidad } from '../booking/disponibilidad';
import { decidirContinuidad } from '../booking/continuidad';
import { fechaLocal, horaLocal, fechaLegible, sumarDias } from '../booking/tiempo';
import { componerTitulo } from '../calendar/titulo';
import { huecoAvisable, mensajeAvisoHueco } from '../gateway/avisos';
import { esRelleno } from '../patient/nombres';
import { resolverRecurrente, type ContextoPaciente } from '../patient/turno';
import { buscarChunks, type ProveedorEmbeddings } from '../rag/rag';

export interface DepsEjecutor {
  pool: Pool;
  config: ConfigNegocio;
  catalogo: CatalogoRepo;
  calendario: CalendarioPort;
  pacientes: PacientesRepo;
  citas: CitasRepo;
  confirmaciones: ConfirmacionesRepo;
  embeddings: ProveedorEmbeddings | null;
  avisarNegocio: (texto: string) => Promise<void>;
  dryRun: boolean;
}

export interface ToolContext {
  /** Identidad del paciente (E.164). NUNCA lleva prefijos de sesión. */
  telefono: string;
  /** Clave de conversación: igual al teléfono, o `sim:<tel>` en el simulador. */
  sesion: string;
  ahora: Date;
  idioma: 'ca' | 'es';
  continuidadModo: 'preferida' | 'obligatoria';
  paciente: ContextoPaciente;
  /** Guardarraíl: ¿se consultó la agenda en este turno? */
  consultoDisponibilidad: boolean;
  rechazosSinDeclaracion: number;
  /** Simulador del panel: fuerza escrituras simuladas. */
  simulado?: boolean;
}

const MAX_RECHAZOS_SIN_DECLARACION = 2;
const MAX_HUECOS_POR_DIA = 12;
const VENTANA_EXPLORACION_DIAS = 30;

export async function ejecutarTool(deps: DepsEjecutor, ctx: ToolContext, nombre: string, args: Record<string, unknown>): Promise<unknown> {
  switch (nombre) {
    case 'consultar_disponibilidad': return consultarDisponibilidad(deps, ctx, args);
    case 'proponer_cita': return proponerCita(deps, ctx, args);
    case 'confirmar_cita': return confirmarCita(deps, ctx);
    case 'listar_mis_citas': return listarMisCitas(deps, ctx);
    case 'modificar_cita': return modificarCita(deps, ctx, args);
    case 'anular_cita': return anularCita(deps, ctx, args);
    case 'registrar_paciente': return registrarPaciente(deps, ctx, args);
    case 'consultar_info': return consultarInfo(deps, args);
    default: return { error: `Tool desconocida: ${nombre}` };
  }
}

// ── Candidatos según servicio + continuidad ──────────────────────────────────

async function candidatosPara(
  deps: DepsEjecutor, ctx: ToolContext, serviceId: number,
  pedido: { professionalId?: number; cualquiera?: boolean },
): Promise<{ candidatos: Profesional[]; nota: string | null; forzado: boolean }> {
  const deServicio = await deps.catalogo.profesionalesDeServicio(serviceId);
  if (!deServicio.length) return { candidatos: [], nota: null, forzado: false };

  const decision = await decidirContinuidad({
    modo: ctx.continuidadModo, recurrente: ctx.paciente.recurrente, serviceId, catalogo: deps.catalogo,
  });

  if (decision.kind === 'force') {
    // Ignora cualquier profesional distinto que proponga el modelo: la regla no es negociable.
    const suFisio = deServicio.find((p) => p.id === decision.professionalId);
    const nota = pedido.professionalId && pedido.professionalId !== decision.professionalId
      ? `Continuidad: en esta clínica el seguimiento es con su fisioterapeuta habitual (${decision.nombre}); se muestran sus huecos.`
      : null;
    return { candidatos: suFisio ? [suFisio] : [], nota, forzado: true };
  }

  if (decision.kind === 'exception') {
    const abiertos = deServicio.filter((p) => p.id !== decision.prevProfessionalId);
    return {
      candidatos: pedido.professionalId ? abiertos.filter((p) => p.id === pedido.professionalId) : abiertos,
      nota: `Su fisioterapeuta habitual (${decision.nombre}) no realiza este servicio; le atenderá otro profesional que sí lo hace.`,
      forzado: false,
    };
  }

  if (pedido.professionalId && !pedido.cualquiera) {
    const elegido = deServicio.filter((p) => p.id === pedido.professionalId);
    if (!elegido.length) {
      return { candidatos: deServicio, nota: 'El profesional pedido no realiza este servicio; se muestran los que sí lo hacen.', forzado: false };
    }
    return { candidatos: elegido, nota: null, forzado: false };
  }
  return { candidatos: deServicio, nota: null, forzado: false };
}

function depsDisponibilidad(deps: DepsEjecutor): DepsDisponibilidad {
  return { config: deps.config, catalogo: deps.catalogo, calendario: deps.calendario };
}

// ── consultar_disponibilidad ─────────────────────────────────────────────────

async function consultarDisponibilidad(deps: DepsEjecutor, ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> {
  ctx.consultoDisponibilidad = true;
  const serviceId = Number(args.service_id);
  const servicio = await deps.catalogo.servicio(serviceId);
  if (!servicio) {
    const cat = await deps.catalogo.catalogo();
    return { error: 'servicio_desconocido', servicios: cat.servicios.map((s) => ({ id: s.id, nombre: s.name })) };
  }
  const { candidatos, nota } = await candidatosPara(deps, ctx, serviceId, {
    professionalId: args.professional_id ? Number(args.professional_id) : undefined,
    cualquiera: args.cualquiera === true,
  });
  if (!candidatos.length) {
    return { error: 'sin_profesionales_disponibles', detalle: 'Ningún profesional asignado a este servicio puede atender. Revisa la configuración o deriva al teléfono.' };
  }

  const settings = await deps.config.settings();
  const hoy = fechaLocal(ctx.ahora, settings.timezone);
  const fechaPedida = typeof args.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.fecha) ? args.fecha : null;
  const desde = fechaPedida && fechaPedida >= hoy ? fechaPedida : hoy;
  const diasAMostrar = await deps.config.entero('dias_a_mostrar');

  // Si el arranque cae dentro de un cierre del panel, la ventana se alarga hasta
  // pasarlo: las "próximas disponibles" son los primeros días abiertos DESPUÉS
  // del cierre, no un mudo "sin huecos" (comportamiento de balta).
  let ventanaDias = VENTANA_EXPLORACION_DIAS;
  const cierreEnDesde = (await deps.catalogo.cierresDesde(desde)).find((c) => desde >= c.desde && desde <= c.hasta);
  if (cierreEnDesde) {
    const diasDeCierre = Math.round((Date.parse(cierreEnDesde.hasta) - Date.parse(desde)) / 86_400_000) + 1;
    ventanaDias = Math.min(diasDeCierre + VENTANA_EXPLORACION_DIAS, 90);
  }

  const disponibilidad = await calcularDisponibilidad(depsDisponibilidad(deps), {
    serviceId, candidatos, desdeFecha: desde, diasNaturales: ventanaDias, ahora: ctx.ahora,
  });

  const cualquiera = args.cualquiera === true || (!args.professional_id && candidatos.length > 1);
  const porNombre = new Map(candidatos.map((p) => [p.id, p.name]));
  const dias: unknown[] = [];
  let diasConHuecos = 0;
  let cierreYaIncluido = false; // unas vacaciones largas no deben desplazar a los días con hueco
  for (const dia of disponibilidad.dias) {
    const esPedido = fechaPedida === dia.fecha;
    const esCierre = dia.cierre !== undefined;
    if (!dia.huecos.length && !esPedido && (!esCierre || cierreYaIncluido)) continue;
    if (esCierre && !dia.huecos.length) cierreYaIncluido = true;
    dias.push({
      fecha: dia.fecha,
      dia: fechaLegible(dia.fecha, ctx.idioma),
      motivo: dia.motivo,
      ...(dia.motivo === 'sin_profesional'
        ? { detalle: 'La clínica SÍ abre ese día: es este profesional quien no pasa consulta. NO digas que la clínica está cerrada; di que ese día no está y ofrece su siguiente día disponible u otro profesional.' }
        : {}),
      ...(esCierre ? { cierre: dia.cierre ?? 'el centro cierra ese día (motivo sin indicar en el calendario)' } : {}),
      huecos: dia.huecos.slice(0, MAX_HUECOS_POR_DIA).map((h) => ({
        hora: horaLocal(h.inicio, settings.timezone),
        iso: h.inicio.toISOString(),
        ...(cualquiera ? {} : { profesionales: h.professionalIds.map((id) => porNombre.get(id)).filter(Boolean) }),
      })),
    });
    if (dia.huecos.length) diasConHuecos++;
    if (diasConHuecos >= diasAMostrar) break;
  }

  return {
    servicio: servicio.name,
    duracion_min: disponibilidad.duracionMin,
    profesionales: cualquiera ? 'cualquiera' : candidatos.map((p) => p.name),
    nota_continuidad: nota,
    ambito: `Huecos comprobados desde ${desde} (${ventanaDias} días). Para fechas posteriores, vuelve a consultar con esa fecha.`,
    dias,
    ...(dias.length === 0 ? { sin_huecos: 'No hay huecos en la ventana consultada. Ofrece otra franja o el teléfono de la clínica.' } : {}),
  };
}

// ── proponer_cita ────────────────────────────────────────────────────────────

/** Nunca se reserva el instante que teclee el modelo: se re-ancla a un hueco real. */
async function resolverInicio(
  deps: DepsEjecutor, ctx: ToolContext, serviceId: number, candidatos: Profesional[], inicioStr: string,
): Promise<{ inicio: Date; disponibles: number[] } | null> {
  const parseado = new Date(inicioStr);
  if (Number.isNaN(parseado.getTime())) return null;
  const settings = await deps.config.settings();
  const hoy = fechaLocal(ctx.ahora, settings.timezone);

  let fecha = fechaLocal(parseado, settings.timezone);
  // Tolerancia de año: el modelo teclea el año de su entrenamiento.
  while (fecha < hoy) {
    const [a, resto] = [parseInt(fecha.slice(0, 4), 10), fecha.slice(4)];
    const bump = `${a + 1}${resto}`;
    if (bump <= fecha) return null;
    fecha = bump;
  }

  const disponibilidad = await calcularDisponibilidad(depsDisponibilidad(deps), {
    serviceId, candidatos, desdeFecha: fecha, diasNaturales: 1, ahora: ctx.ahora,
  });
  const huecos = disponibilidad.dias[0]!.huecos;

  const exacto = huecos.find((h) => h.inicio.getTime() === parseado.getTime());
  if (exacto) return { inicio: exacto.inicio, disponibles: exacto.professionalIds };

  // Tolerancia por hora de pared, SOLO si es inequívoca.
  const horaPedida = horaLocal(parseado, settings.timezone);
  const coincidentes = huecos.filter((h) => horaLocal(h.inicio, settings.timezone) === horaPedida);
  if (coincidentes.length === 1) {
    return { inicio: coincidentes[0]!.inicio, disponibles: coincidentes[0]!.professionalIds };
  }
  return null;
}

async function proponerCita(deps: DepsEjecutor, ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> {
  const serviceId = Number(args.service_id);
  const servicio = await deps.catalogo.servicio(serviceId);
  if (!servicio) return { error: 'servicio_desconocido' };

  const paraOtraPersona = args.para_otra_persona === true;
  const nombre = typeof args.nombre === 'string' ? args.nombre.trim() : null;
  const apellido = typeof args.apellido === 'string' ? args.apellido.trim() : null;
  const titular = ctx.paciente.titular;

  // Salvaguarda de identidad: el match por teléfono identifica al TITULAR, no a quien escribe.
  if (!paraOtraPersona && titular?.nombre && nombre && !mismoNombreDePila(nombre, titular.nombre)) {
    return {
      pregunta_para_quien: true,
      detalle: `La ficha de este número es de ${titular.nombre}. Pregunta si la cita es para ${titular.nombre} o para otra persona; si es para otra persona, repite proponer_cita con para_otra_persona=true.`,
    };
  }
  if (!titular && !nombre) {
    return { falta_nombre: true, detalle: 'Este número no está registrado. Pide nombre (y apellido) y repite proponer_cita con esos datos.' };
  }
  if (paraOtraPersona && !nombre) {
    return { falta_nombre: true, detalle: 'Para reservar a otra persona necesito su nombre. Pídelo y repite proponer_cita.' };
  }
  if (nombre && esRelleno(nombre)) {
    return { nombre_invalido: true, detalle: 'Ese nombre no es válido. Pide el nombre real del paciente; no inventes ninguno.' };
  }

  // Continuidad del paciente que SE VISITA: para un tercero manda su propio historial.
  let ctxContinuidad = ctx;
  if (paraOtraPersona && nombre) {
    const candidatosTel = ctx.paciente.candidatos;
    const tercero = candidatosTel.find((p) => !p.titular && p.nombre && mismoNombreDePila(nombre, p.nombre));
    const recurrenteTercero = tercero ? await resolverRecurrente({ citas: deps.citas, catalogo: deps.catalogo }, tercero.id, ctx.ahora) : null;
    ctxContinuidad = { ...ctx, paciente: { ...ctx.paciente, recurrente: recurrenteTercero } };
  }

  const { candidatos, nota } = await candidatosPara(deps, ctxContinuidad, serviceId, {
    professionalId: args.professional_id ? Number(args.professional_id) : undefined,
  });
  if (!candidatos.length) return { error: 'sin_profesionales_disponibles' };

  const resuelto = await resolverInicio(deps, ctx, serviceId, candidatos, String(args.inicio ?? ''));
  if (!resuelto) {
    ctx.consultoDisponibilidad = true;
    return {
      hueco_no_disponible: true,
      detalle: 'Esa hora ya no está disponible o no existe. Vuelve a consultar_disponibilidad y ofrece las horas vigentes; no des la cita por hecha.',
    };
  }

  // Sustitución declarada: si ya hay cita futura, hay que decir qué pasa con ella.
  const futuras = await deps.citas.futurasDePacientes(ctx.paciente.candidatos.map((p) => p.id), ctx.ahora);
  let sustituyeEventId: string | null = null;
  const declaracion = typeof args.sustituye_a === 'string' ? args.sustituye_a.trim().toLowerCase() : null;
  if (futuras.length) {
    if (!declaracion) {
      ctx.rechazosSinDeclaracion++;
      if (ctx.rechazosSinDeclaracion <= MAX_RECHAZOS_SIN_DECLARACION) {
        return {
          falta_sustituye_a: true,
          citas_existentes: await mapearCitas(deps, futuras, ctx),
          detalle: 'El paciente ya tiene cita. Declara en sustituye_a la fecha y hora de la que se cambia ("YYYY-MM-DD HH:MM") o "ninguna" si quiere conservarlas todas.',
        };
      }
      registrarAnomalia('propuesta_sin_declaracion', { telefono: ctx.telefono });
    } else if (declaracion !== 'ninguna' && declaracion !== 'cap') {
      // Resolución ESTRICTA: esto es una anulación implícita; si no casa, se pregunta, no se borra.
      const settings = await deps.config.settings();
      const match = futuras.find((c) =>
        `${fechaLocal(c.startTime, settings.timezone)} ${horaLocal(c.startTime, settings.timezone)}` === declaracion);
      if (!match) {
        return {
          sustituye_a_no_encontrada: true,
          citas_existentes: await mapearCitas(deps, futuras, ctx),
          detalle: 'La cita declarada en sustituye_a no coincide con ninguna. Confirma con el paciente cuál quiere cambiar.',
        };
      }
      sustituyeEventId = match.googleEventId;
    }
  }

  const settings = await deps.config.settings();
  const professionalId = args.professional_id ? Number(args.professional_id) : null;
  const proFijado = professionalId && resuelto.disponibles.includes(professionalId) ? professionalId
    : candidatos.length === 1 ? candidatos[0]!.id
    : null; // null = "cualquiera": round-robin al confirmar
  const nombreFisio = proFijado ? (await deps.catalogo.profesional(proFijado))?.name ?? null : null;

  const motivo = typeof args.motivo === 'string' && args.motivo.trim() ? args.motivo.trim().slice(0, 300) : null;
  const quien = nombre ?? titular?.nombre ?? null;
  const resumen = [
    quien ? `Paciente: ${quien}${apellido ? ` ${apellido}` : ''}` : null,
    `Servicio: ${servicio.name}`,
    `Día: ${fechaLegible(fechaLocal(resuelto.inicio, settings.timezone), ctx.idioma)}`,
    `Hora: ${horaLocal(resuelto.inicio, settings.timezone)}`,
    nombreFisio ? `Profesional: ${nombreFisio}` : 'Profesional: el que tenga hueco (se asigna al confirmar)',
    motivo ? `Motivo: ${motivo}` : null,
    sustituyeEventId ? 'Sustituye a su cita anterior (se anulará al confirmar)' : null,
  ].filter(Boolean).join('\n');

  await deps.confirmaciones.proponer({
    telefono: ctx.sesion,
    pacienteId: paraOtraPersona ? null : titular?.id ?? null,
    professionalId: proFijado,
    serviceId,
    inicio: resuelto.inicio,
    motivo,
    paraNombre: nombre,
    paraApellido: apellido,
    paraOtraPersona,
    resumen,
    sustituyeEventId,
  });

  return {
    propuesta_guardada: true,
    resumen,
    nota_continuidad: nota,
    detalle: 'Enseña el resumen al paciente y pide confirmación explícita. Solo tras un SÍ claro, llama a confirmar_cita.',
  };
}

// ── confirmar_cita ───────────────────────────────────────────────────────────

async function confirmarCita(deps: DepsEjecutor, ctx: ToolContext): Promise<unknown> {
  const propuesta = await deps.confirmaciones.viva(ctx.sesion);
  if (!propuesta) {
    return { error: 'sin_propuesta', detalle: 'No hay ninguna propuesta pendiente. Retoma el flujo: consulta disponibilidad y propón una hora.' };
  }
  const servicio = await deps.catalogo.servicio(propuesta.serviceId);
  if (!servicio) return { error: 'servicio_desconocido' };
  const settings = await deps.config.settings();

  const nombreDeclarado = propuesta.paraNombre ?? ctx.paciente.titular?.nombre ?? null;
  if (!nombreDeclarado) {
    return { falta_nombre: true, detalle: 'Falta el nombre del paciente. Pídelo y vuelve a proponer la cita con nombre.' };
  }

  // En modo pruebas se corta ANTES de tocar la ficha del paciente: el simulador
  // del panel no debe dejar rastro en `pacientes` ni en `citas`.
  const simulacion = deps.dryRun || ctx.simulado;

  // Ficha del paciente que se visita (solo cuando la reserva es real).
  let pacienteId: number | null = null;
  let nombrePaciente: string | null = nombreDeclarado;
  if (!simulacion) {
    if (propuesta.paraOtraPersona) {
      const tercero = await deps.pacientes.tercero(ctx.telefono, nombreDeclarado, propuesta.paraApellido);
      pacienteId = tercero.id; nombrePaciente = tercero.nombre;
    } else {
      const titular = await deps.pacientes.guardarTitular(ctx.telefono, {
        nombre: propuesta.paraNombre, apellido: propuesta.paraApellido, idioma: ctx.idioma,
      });
      if (!titular.nombre) {
        return { falta_nombre: true, detalle: 'Falta el nombre del paciente. Pídelo y vuelve a proponer la cita con nombre.' };
      }
      pacienteId = titular.id; nombrePaciente = titular.nombre;
    }
  }

  // Idempotencia: el doble "sí" no duplica.
  const duplicada = pacienteId ? await deps.citas.duplicada(pacienteId, propuesta.inicio) : null;
  if (duplicada) {
    await deps.confirmaciones.borrar(ctx.sesion);
    return {
      ya_reservada: true,
      fecha: fechaLegible(fechaLocal(duplicada.startTime, settings.timezone), ctx.idioma),
      hora: horaLocal(duplicada.startTime, settings.timezone),
      detalle: 'La cita ya estaba reservada; confirma al paciente los datos, sin crear otra.',
    };
  }

  // Revalidación: entre proponer y confirmar pasa tiempo real y el hueco puede irse.
  const { candidatos } = await candidatosPara(deps, ctx, propuesta.serviceId, {
    professionalId: propuesta.professionalId ?? undefined,
  });
  const candidatosFinales = propuesta.professionalId
    ? candidatos.filter((p) => p.id === propuesta.professionalId)
    : candidatos;
  const resuelto = candidatosFinales.length
    ? await resolverInicio(deps, ctx, propuesta.serviceId, candidatosFinales, propuesta.inicio.toISOString())
    : null;
  if (!resuelto) {
    await deps.confirmaciones.borrar(ctx.sesion);
    ctx.consultoDisponibilidad = true;
    return {
      hueco_perdido: true,
      detalle: 'La hora propuesta ya no está libre. Discúlpate, consulta disponibilidad de nuevo y ofrece alternativas.',
    };
  }

  const proId = propuesta.professionalId ?? await deps.catalogo.siguienteProfesional(resuelto.disponibles);
  const pro = await deps.catalogo.profesional(proId);
  if (!pro) return { error: 'profesional_no_disponible' };

  const fin = new Date(resuelto.inicio.getTime() + (await duracionDe(deps, servicio.id)) * 60_000);
  const respuesta = {
    confirmada: true,
    fecha: fechaLegible(fechaLocal(resuelto.inicio, settings.timezone), ctx.idioma),
    hora: horaLocal(resuelto.inicio, settings.timezone),
    profesional: pro.name,
    servicio: servicio.name,
    paciente: nombrePaciente,
  };

  if (simulacion || pacienteId === null) {
    await deps.confirmaciones.borrar(ctx.sesion);
    return { ...respuesta, simulada: true, detalle: 'MODO PRUEBAS: la cita NO se ha escrito en la agenda real.' };
  }

  const titulo = componerTitulo(nombrePaciente ?? 'Paciente', propuesta.paraApellido, ctx.telefono, servicio.code);
  const descripcion = [
    `Tel: ${ctx.telefono}`,
    propuesta.motivo ? `Motivo: ${propuesta.motivo}` : null, // dato de salud: descripción, nunca título
    'Reservada por el asistente de WhatsApp',
  ].filter(Boolean).join('\n');
  const eventId = await deps.calendario.crearEvento(pro.calendarId, {
    titulo, descripcion, inicio: resuelto.inicio, fin,
  });
  await deps.citas.guardar({
    googleEventId: eventId, pacienteId, professionalId: pro.id, serviceId: servicio.id,
    telefono: ctx.telefono, nombre: nombrePaciente, inicio: resuelto.inicio, fin, motivo: propuesta.motivo,
  });
  await deps.confirmaciones.borrar(ctx.sesion);

  // La sustituida se anula DESPUÉS de crear: "tiene las dos" es recuperable; "no tiene ninguna" no.
  let sustitucion: string | null = null;
  if (propuesta.sustituyeEventId) {
    sustitucion = await anularPorEventId(deps, ctx, propuesta.sustituyeEventId)
      ? 'anulada' : 'ha_fallado';
    if (sustitucion === 'ha_fallado') {
      registrarAnomalia('sustitucion_fallida', { telefono: ctx.telefono, eventId: propuesta.sustituyeEventId });
    }
  }

  const futurasTras = await deps.citas.futurasDePacientes([pacienteId], ctx.ahora);
  if (futurasTras.length > 1 && !propuesta.sustituyeEventId) {
    registrarAnomalia('citas_futuras_multiples', { telefono: ctx.telefono, pacienteId, total: futurasTras.length });
  }

  return {
    ...respuesta,
    ...(sustitucion === 'ha_fallado'
      ? { sustitucion: 'ha_fallado', detalle: 'La cita nueva está reservada pero la antigua NO se ha podido anular. Dile al paciente que su hora nueva está guardada, que la antigua no se ha podido quitar y que llame a la clínica.' }
      : sustitucion ? { sustitucion: 'anulada' } : {}),
  };
}

async function duracionDe(deps: DepsEjecutor, serviceId: number): Promise<number> {
  const [servicio, settings] = await Promise.all([deps.catalogo.servicio(serviceId), deps.config.settings()]);
  if (!servicio) throw new Error(`Servicio ${serviceId} no existe`);
  return servicio.slotsRequired * settings.paso;
}

/** Anula por event id (sustitución): borra en Google, soft delete local, aviso de hueco. */
async function anularPorEventId(deps: DepsEjecutor, ctx: ToolContext, eventId: string): Promise<boolean> {
  try {
    const cita = await deps.citas.porEventId(eventId);
    if (!cita || cita.estado === 'anulada') return true;
    const pro = cita.professionalId ? await deps.catalogo.profesional(cita.professionalId) : null;
    if (pro) await deps.calendario.borrarEvento(pro.calendarId, eventId);
    await deps.citas.anular(eventId);
    await avisarHuecoSiToca(deps, ctx, cita, pro?.name ?? null);
    return true;
  } catch (err) {
    console.error('[ejecutor] anularPorEventId falló:', err);
    return false;
  }
}

async function avisarHuecoSiToca(deps: DepsEjecutor, ctx: ToolContext, cita: Cita, nombrePro: string | null): Promise<void> {
  try {
    const settings = await deps.config.settings();
    const horasVista = await deps.config.entero('horas_aviso_hueco');
    if (!huecoAvisable(cita.startTime, ctx.ahora, settings.timezone, horasVista)) return;
    const servicio = cita.serviceId ? await deps.catalogo.servicio(cita.serviceId) : null;
    await deps.avisarNegocio(mensajeAvisoHueco({
      inicio: cita.startTime, tz: settings.timezone, nombrePaciente: cita.nombre,
      telefonoPaciente: cita.telefono ?? ctx.telefono, servicio: servicio?.name ?? null, profesional: nombrePro,
    }));
  } catch (err) {
    console.error('[ejecutor] aviso de hueco falló (no bloquea):', err);
  }
}

// ── Gestión ──────────────────────────────────────────────────────────────────

async function mapearCitas(deps: DepsEjecutor, citas: Cita[], ctx: ToolContext): Promise<unknown[]> {
  const settings = await deps.config.settings();
  const horasModificacion = await deps.config.entero('horas_modificacion');
  const resultado: unknown[] = [];
  for (const c of citas) {
    const horasPara = (c.startTime.getTime() - ctx.ahora.getTime()) / 3_600_000;
    const pro = c.professionalId ? await deps.catalogo.profesional(c.professionalId) : null;
    const servicio = c.serviceId ? await deps.catalogo.servicio(c.serviceId) : null;
    resultado.push({
      fecha: fechaLocal(c.startTime, settings.timezone),
      dia: fechaLegible(fechaLocal(c.startTime, settings.timezone), ctx.idioma),
      hora: horaLocal(c.startTime, settings.timezone),
      profesional: pro?.name ?? null,
      servicio: servicio?.name ?? null,
      para: c.nombre,
      se_puede_anular: true,
      se_puede_modificar: horasPara >= horasModificacion,
      motivo_no_modificable: horasPara >= horasModificacion ? null
        : `Faltan menos de ${horasModificacion} h: para cambiarla, propon una hora nueva declarando sustituye_a, u ofrece llamar a la clínica.`,
    });
  }
  return resultado;
}

async function listarMisCitas(deps: DepsEjecutor, ctx: ToolContext): Promise<unknown> {
  const futuras = await deps.citas.futurasDePacientes(ctx.paciente.candidatos.map((p) => p.id), ctx.ahora);
  if (!futuras.length) return { citas: [], detalle: 'Este número no tiene citas futuras.' };
  return { citas: await mapearCitas(deps, futuras, ctx) };
}

type CitaResuelta = { ok: true; cita: Cita } | { ok: false; motivo: 'sin_citas' | 'no_reconocida' | 'ambigua' };

/** Nunca adivina entre varias. */
async function resolverCita(deps: DepsEjecutor, ctx: ToolContext, fecha: string, hora: string): Promise<CitaResuelta> {
  const futuras = await deps.citas.futurasDePacientes(ctx.paciente.candidatos.map((p) => p.id), ctx.ahora);
  if (!futuras.length) return { ok: false, motivo: 'sin_citas' };
  const settings = await deps.config.settings();
  const match = futuras.filter((c) =>
    fechaLocal(c.startTime, settings.timezone) === fecha && horaLocal(c.startTime, settings.timezone) === hora);
  if (match.length === 1) return { ok: true, cita: match[0]! };
  if (match.length > 1) return { ok: false, motivo: 'ambigua' }; // dos personas a la misma hora: preguntar para quién
  if (futuras.length === 1) return { ok: true, cita: futuras[0]! }; // una sola futura: es esa
  return { ok: false, motivo: 'no_reconocida' };
}

function falloResolucion(motivo: 'sin_citas' | 'no_reconocida' | 'ambigua'): unknown {
  if (motivo === 'sin_citas') return { sin_citas: true, detalle: 'Este número no tiene citas futuras que gestionar.' };
  if (motivo === 'ambigua') return { ambigua: true, detalle: 'Hay más de una cita que encaja. Pregunta al paciente cuál (o para quién) es.' };
  return { no_reconocida: true, reintentar_con_listado: true };
}

async function modificarCita(deps: DepsEjecutor, ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> {
  const resolucion = await resolverCita(deps, ctx, String(args.fecha ?? ''), String(args.hora ?? ''));
  if (!resolucion.ok) return falloResolucion(resolucion.motivo);
  const cita = resolucion.cita;
  if (cita.estado !== 'confirmada') return { ya_anulada: true };
  if (!cita.googleEventId || !cita.professionalId || !cita.serviceId) {
    return { no_gestionable: true, detalle: 'Esta cita se apuntó a mano y no puede moverla el bot: ofrece el teléfono de la clínica.' };
  }

  const settings = await deps.config.settings();
  const horasModificacion = await deps.config.entero('horas_modificacion');
  const horasPara = (cita.startTime.getTime() - ctx.ahora.getTime()) / 3_600_000;
  if (horasPara < horasModificacion) {
    return {
      demasiado_proxima: true,
      cita_actual: (await mapearCitas(deps, [cita], ctx))[0],
      detalle: `Faltan menos de ${horasModificacion} h. Ofrece: proponer una hora nueva declarando sustituye_a, o llamar a la clínica (${settings.telefonoNegocio ?? ''}).`,
    };
  }

  const pro = await deps.catalogo.profesional(cita.professionalId);
  if (!pro) return { no_gestionable: true };
  // Mismo servicio y mismo profesional: solo cambia la hora.
  const resuelto = await resolverInicio(deps, ctx, cita.serviceId, [pro], String(args.nuevo_inicio ?? ''));
  if (!resuelto) {
    ctx.consultoDisponibilidad = true;
    return {
      original_intacta: true,
      cita_actual: (await mapearCitas(deps, [cita], ctx))[0],
      detalle: 'La hora nueva no está libre. La cita original SIGUE VIGENTE: dilo con sus datos exactos (no de memoria) y ofrece alternativas reales.',
    };
  }

  if (deps.dryRun || ctx.simulado) {
    return { modificada: true, simulada: true, nueva_hora: horaLocal(resuelto.inicio, settings.timezone) };
  }

  const avisar = { ...cita }; // el hueco que queda libre se evalúa con los datos de ANTES de mover
  const fin = new Date(resuelto.inicio.getTime() + (cita.endTime.getTime() - cita.startTime.getTime()));
  await deps.calendario.moverEvento(pro.calendarId, cita.googleEventId, resuelto.inicio, fin);
  await deps.citas.reprogramar(cita.googleEventId, resuelto.inicio, fin);
  await avisarHuecoSiToca(deps, ctx, avisar, pro.name);

  return {
    modificada: true,
    fecha: fechaLegible(fechaLocal(resuelto.inicio, settings.timezone), ctx.idioma),
    hora: horaLocal(resuelto.inicio, settings.timezone),
    profesional: pro.name,
    para: cita.nombre,
  };
}

async function anularCita(deps: DepsEjecutor, ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> {
  const resolucion = await resolverCita(deps, ctx, String(args.fecha ?? ''), String(args.hora ?? ''));
  if (!resolucion.ok) return falloResolucion(resolucion.motivo);
  const cita = resolucion.cita;
  if (cita.estado !== 'confirmada') return { ya_anulada: true };

  const settings = await deps.config.settings();
  const datos = {
    anulada: true,
    cita_anulada: {
      dia: fechaLegible(fechaLocal(cita.startTime, settings.timezone), ctx.idioma),
      hora: horaLocal(cita.startTime, settings.timezone),
      para: cita.nombre,
    },
    era_de_hoy: fechaLocal(cita.startTime, settings.timezone) === fechaLocal(ctx.ahora, settings.timezone),
  };

  if (deps.dryRun || ctx.simulado) return { ...datos, simulada: true };

  // Anular se puede SIEMPRE, también hoy: impedirlo solo consigue que no avisen.
  if (cita.googleEventId && cita.professionalId) {
    const pro = await deps.catalogo.profesional(cita.professionalId);
    if (pro) await deps.calendario.borrarEvento(pro.calendarId, cita.googleEventId);
    await deps.citas.anular(cita.googleEventId);
    await avisarHuecoSiToca(deps, ctx, cita, pro?.name ?? null);
  } else {
    await deps.pool.query(`UPDATE citas SET estado = 'anulada', updated_at = NOW() WHERE id = $1`, [cita.id]);
  }
  return datos;
}

async function registrarPaciente(deps: DepsEjecutor, ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> {
  const nombre = String(args.nombre ?? '').trim();
  if (!nombre || esRelleno(nombre)) {
    return { nombre_invalido: true, detalle: 'Ese nombre no es válido. Pide el nombre real; no registres nada inventado.' };
  }
  const ficha = await deps.pacientes.guardarTitular(ctx.telefono, {
    nombre, apellido: typeof args.apellido === 'string' ? args.apellido : null, idioma: ctx.idioma,
  });
  return { registrado: true, nombre: ficha.nombre, apellido: ficha.apellido };
}

async function consultarInfo(deps: DepsEjecutor, args: Record<string, unknown>): Promise<unknown> {
  if (!deps.embeddings) {
    return { sin_datos: true, detalle: 'La búsqueda en documentos no está configurada. Responde solo con los datos del negocio del contexto o deriva al teléfono.' };
  }
  const pregunta = String(args.pregunta ?? '').trim();
  if (!pregunta) return { sin_datos: true };
  try {
    const chunks = await buscarChunks(deps.pool, deps.embeddings, pregunta);
    if (!chunks.length) {
      return { sin_datos: true, detalle: 'Ningún documento cubre esta pregunta. Dilo y ofrece el teléfono de la clínica; NO inventes la respuesta.' };
    }
    return {
      fragmentos: chunks.map((c) => ({ documento: c.documento, texto: c.chunk })),
      detalle: 'Responde SOLO con esta información. Si no basta, dilo y deriva al teléfono.',
    };
  } catch (err) {
    console.error('[ejecutor] consultar_info falló:', err);
    return { sin_datos: true, detalle: 'La búsqueda ha fallado. Ofrece el teléfono de la clínica.' };
  }
}
