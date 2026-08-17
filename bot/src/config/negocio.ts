import type { Pool } from 'pg';

/**
 * Configuración de negocio en BD, editable en caliente desde el panel.
 * La AUSENCIA de una clave significa "valor por defecto": la tabla puede estar vacía.
 * Un valor corrupto no altera lo vigente: cae al default con log.
 */

export interface ClaveConfig {
  def: string;
  valida: (v: string) => boolean;
  descripcion: string;
}

export const CLAVES: Record<string, ClaveConfig> = {
  continuidad_modo: { def: 'preferida', valida: (v) => ['preferida', 'obligatoria'].includes(v), descripcion: 'Continuidad asistencial: preferida | obligatoria' },
  idioma_por_defecto: { def: 'es', valida: (v) => ['es', 'ca'].includes(v), descripcion: 'Idioma cuando no se detecta otro' },
  stt_activado: { def: 'false', valida: esBool, descripcion: 'Transcribir notas de voz' },
  recordatorios_activos: { def: 'false', valida: esBool, descripcion: 'Enviar recordatorios (false = dry-run: solo log)' },
  recordatorio_manana_hora: { def: '19:00', valida: esHora, descripcion: 'Hora del día ANTERIOR para recordar citas de mañana' },
  recordatorio_tarde_hora: { def: '09:30', valida: esHora, descripcion: 'Hora del MISMO día para recordar citas de tarde' },
  limite_franja_tarde: { def: '15:00', valida: esHora, descripcion: 'Desde esta hora una cita cuenta como "de tarde"' },
  nombre_negocio: { def: 'Clínica de Fisioterapia', valida: noVacio, descripcion: 'Nombre visible del negocio' },
  direccion_negocio: { def: '', valida: () => true, descripcion: 'Dirección que da el bot' },
  telefono_avisos: { def: '', valida: () => true, descripcion: 'WhatsApp del negocio para avisos de huecos' },
  telefono_soporte: { def: '', valida: () => true, descripcion: 'Número autorizado para comandos activabot/desactivabot' },
  horas_modificacion: { def: '2', valida: esEnteroEn(0, 168), descripcion: 'Antelación mínima (h) para modificar una cita' },
  horas_aviso_hueco: { def: '0', valida: esEnteroEn(0, 168), descripcion: 'Además de HOY, avisar huecos liberados con esta vista (h)' },
  dias_a_mostrar: { def: '3', valida: esEnteroEn(1, 10), descripcion: 'Días con servicio a ofrecer por consulta' },
  dias_calendario: { def: '21', valida: esEnteroEn(7, 60), descripcion: 'Días de la tabla de referencia del prompt' },
  segundos_agrupacion: { def: '5', valida: esEnteroEn(0, 60), descripcion: 'Ventana de agrupación de ráfagas' },
  segundos_confirmacion_pendiente: { def: '90', valida: esEnteroEn(30, 3600), descripcion: 'Aviso de propuesta sin respuesta' },
};

function esBool(v: string): boolean { return v === 'true' || v === 'false'; }
function esHora(v: string): boolean { return /^([01]\d|2[0-3]):[0-5]\d$/.test(v); }
function noVacio(v: string): boolean { return v.trim().length > 0; }
function esEnteroEn(min: number, max: number) {
  return (v: string) => /^\d+$/.test(v) && parseInt(v, 10) >= min && parseInt(v, 10) <= max;
}

export interface Settings {
  slotMinutes: number[];        // minutos de inicio válidos dentro de la hora
  paso: number;                 // minutos entre inicios consecutivos
  timezone: string;
  telefonoNegocio: string | null;
}

const TTL_MS = 45_000;

export class ConfigNegocio {
  private cacheConfig: { datos: Record<string, string>; hasta: number } | null = null;
  private cacheSettings: { datos: Settings; hasta: number } | null = null;

  constructor(private pool: Pool) {}

  invalidar(): void { this.cacheConfig = null; this.cacheSettings = null; }

  private async todas(): Promise<Record<string, string>> {
    if (this.cacheConfig && this.cacheConfig.hasta > Date.now()) return this.cacheConfig.datos;
    const res = await this.pool.query<{ clave: string; valor: string }>('SELECT clave, valor FROM bot_config');
    const datos: Record<string, string> = {};
    for (const fila of res.rows) datos[fila.clave] = fila.valor;
    this.cacheConfig = { datos, hasta: Date.now() + TTL_MS };
    return datos;
  }

  /** Valor validado de una clave; corrupto o ausente → default. */
  async valor(clave: keyof typeof CLAVES): Promise<string> {
    const def = CLAVES[clave as string];
    if (!def) throw new Error(`Clave de config desconocida: ${String(clave)}`);
    const guardado = (await this.todas())[clave as string];
    if (guardado === undefined) return def.def;
    if (!def.valida(guardado.trim())) {
      console.warn(`[config] valor inválido en ${String(clave)}: "${guardado}" — usando default "${def.def}"`);
      return def.def;
    }
    return guardado.trim();
  }

  async entero(clave: keyof typeof CLAVES): Promise<number> { return parseInt(await this.valor(clave), 10); }
  async booleano(clave: keyof typeof CLAVES): Promise<boolean> { return (await this.valor(clave)) === 'true'; }

  async continuidadModo(): Promise<'preferida' | 'obligatoria'> {
    const v = await this.valor('continuidad_modo');
    return v === 'obligatoria' ? 'obligatoria' : 'preferida';
  }

  async guardar(clave: string, valor: string): Promise<void> {
    const def = CLAVES[clave];
    if (!def) throw new Error(`Clave de config desconocida: ${clave}`);
    if (!def.valida(valor.trim())) throw new Error(`Valor inválido para ${clave}: "${valor}"`);
    await this.pool.query(
      `INSERT INTO bot_config (clave, valor, descripcion, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
      [clave, valor.trim(), def.descripcion],
    );
    this.invalidar();
  }

  /** business_settings: rejilla y zona horaria (las edita la página General del panel). */
  async settings(): Promise<Settings> {
    if (this.cacheSettings && this.cacheSettings.hasta > Date.now()) return this.cacheSettings.datos;
    const res = await this.pool.query<{ slot_minutes: string; timezone: string; telefono: string | null }>(
      'SELECT slot_minutes, timezone, telefono FROM business_settings WHERE id = 1',
    );
    const fila = res.rows[0];
    const minutos = (fila?.slot_minutes ?? '00,30')
      .split(',').map((x) => parseInt(x.trim(), 10))
      .filter((x) => Number.isInteger(x) && x >= 0 && x < 60)
      .sort((a, b) => a - b);
    const slotMinutes = minutos.length ? minutos : [0, 30];
    const datos: Settings = {
      slotMinutes,
      paso: 60 / slotMinutes.length,
      timezone: fila?.timezone ?? 'Europe/Madrid',
      telefonoNegocio: fila?.telefono ?? null,
    };
    this.cacheSettings = { datos, hasta: Date.now() + TTL_MS };
    return datos;
  }

  async botActivo(): Promise<boolean> {
    const res = await this.pool.query<{ activo: boolean }>('SELECT activo FROM bot_estado WHERE id = 1');
    return res.rows[0]?.activo ?? false;
  }

  async ponerBotActivo(activo: boolean): Promise<void> {
    await this.pool.query('UPDATE bot_estado SET activo = $1, fecha_modificacion = NOW() WHERE id = 1', [activo]);
  }
}
