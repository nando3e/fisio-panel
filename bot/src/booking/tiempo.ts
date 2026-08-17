/** Utilidades de zona horaria. Toda fecha "local" se calcula aquí y solo aquí. */

export interface ParteLocal {
  anio: number; mes: number; dia: number; hora: number; minuto: number;
  /** 1=lunes ... 7=domingo */
  diaSemana: number;
}

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(tz: string): Intl.DateTimeFormat {
  let f = formateadores.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short',
    });
    formateadores.set(tz, f);
  }
  return f;
}

const DIAS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function parteLocal(instante: Date, tz: string): ParteLocal {
  const partes = formateador(tz).formatToParts(instante);
  const p: Record<string, string> = {};
  for (const parte of partes) p[parte.type] = parte.value;
  return {
    anio: parseInt(p.year!, 10), mes: parseInt(p.month!, 10), dia: parseInt(p.day!, 10),
    hora: parseInt(p.hour!, 10) % 24, minuto: parseInt(p.minute!, 10),
    diaSemana: DIAS[p.weekday!] ?? 0,
  };
}

/** 'YYYY-MM-DD' de un instante visto en la zona. */
export function fechaLocal(instante: Date, tz: string): string {
  const l = parteLocal(instante, tz);
  return `${l.anio}-${String(l.mes).padStart(2, '0')}-${String(l.dia).padStart(2, '0')}`;
}

export function horaLocal(instante: Date, tz: string): string {
  const l = parteLocal(instante, tz);
  return `${String(l.hora).padStart(2, '0')}:${String(l.minuto).padStart(2, '0')}`;
}

/** Minutos desde medianoche local. */
export function minutosLocales(instante: Date, tz: string): number {
  const l = parteLocal(instante, tz);
  return l.hora * 60 + l.minuto;
}

/** Instante (Date) que corresponde a las hh:mm locales de una fecha 'YYYY-MM-DD' en la zona. */
export function instanteLocal(fecha: string, minutosDesdeMedianoche: number, tz: string): Date {
  const [a, m, d] = fecha.split('-').map((x) => parseInt(x, 10));
  const hh = Math.floor(minutosDesdeMedianoche / 60);
  const mm = minutosDesdeMedianoche % 60;
  // Doble pasada: estimar en UTC y corregir por el offset real de la zona.
  let utc = Date.UTC(a!, m! - 1, d!, hh, mm, 0);
  for (let i = 0; i < 2; i++) {
    const visto = parteLocal(new Date(utc), tz);
    const deltaMin =
      (Date.UTC(visto.anio, visto.mes - 1, visto.dia, visto.hora, visto.minuto) -
        Date.UTC(a!, m! - 1, d!, hh, mm)) / 60000;
    if (deltaMin === 0) break;
    utc -= deltaMin * 60000;
  }
  return new Date(utc);
}

/** Suma días naturales a una fecha 'YYYY-MM-DD'. */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(a!, m! - 1, d! + dias));
  return dt.toISOString().slice(0, 10);
}

/** Día de la semana (1=lunes..7=domingo) de una fecha 'YYYY-MM-DD'. */
export function diaSemanaDe(fecha: string): number {
  const [a, m, d] = fecha.split('-').map((x) => parseInt(x, 10));
  const js = new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay(); // 0=domingo
  return js === 0 ? 7 : js;
}

/** 'HH:MM' o 'HH:MM:SS' → minutos desde medianoche. */
export function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map((x) => parseInt(x, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

export function deMinutos(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

const NOMBRES_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const NOMBRES_DIA_CA = ['', 'dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte', 'diumenge'];
const NOMBRES_MES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function nombreDia(diaSemana: number, idioma = 'es'): string {
  return (idioma === 'ca' ? NOMBRES_DIA_CA : NOMBRES_DIA)[diaSemana] ?? '';
}

/** 'martes 3 de septiembre' a partir de 'YYYY-MM-DD'. */
export function fechaLegible(fecha: string, idioma = 'es'): string {
  const [, m, d] = fecha.split('-').map((x) => parseInt(x, 10));
  const dia = nombreDia(diaSemanaDe(fecha), idioma);
  const de = idioma === 'ca' ? 'de' : 'de';
  return `${dia} ${d} ${de} ${NOMBRES_MES[m!] ?? ''}`;
}
