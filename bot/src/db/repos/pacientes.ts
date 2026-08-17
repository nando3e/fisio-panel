import type { Pool } from 'pg';
import { esRelleno } from '../../patient/nombres';

export interface Paciente {
  id: number;
  nombre: string | null;
  apellido: string | null;
  telefono: string;
  titular: boolean;
  idiomaPreferido: string | null;
}

function aPaciente(r: Record<string, unknown>): Paciente {
  return {
    id: r.id as number, nombre: (r.nombre as string) ?? null, apellido: (r.apellido as string) ?? null,
    telefono: r.telefono as string, titular: r.titular as boolean,
    idiomaPreferido: (r.idioma_preferido as string) ?? null,
  };
}

export class PacientesRepo {
  constructor(private pool: Pool) {}

  async porTelefono(telefono: string): Promise<Paciente[]> {
    const res = await this.pool.query('SELECT * FROM pacientes WHERE telefono = $1 ORDER BY titular DESC, id', [telefono]);
    return res.rows.map(aPaciente);
  }

  async titular(telefono: string): Promise<Paciente | null> {
    const res = await this.pool.query('SELECT * FROM pacientes WHERE telefono = $1 AND titular LIMIT 1', [telefono]);
    return res.rows[0] ? aPaciente(res.rows[0]) : null;
  }

  async porId(id: number): Promise<Paciente | null> {
    const res = await this.pool.query('SELECT * FROM pacientes WHERE id = $1', [id]);
    return res.rows[0] ? aPaciente(res.rows[0]) : null;
  }

  /**
   * Crea o completa la ficha del TITULAR del teléfono.
   * Última línea de defensa: nombres de relleno no entran; los datos guardados mandan
   * sobre lo que aporte el modelo (salvo ficha ya de relleno); un null nunca borra.
   */
  async guardarTitular(telefono: string, datos: { nombre?: string | null; apellido?: string | null; idioma?: string | null }): Promise<Paciente> {
    const nombre = datos.nombre && !esRelleno(datos.nombre) ? datos.nombre.trim() : null;
    const apellido = datos.apellido && !esRelleno(datos.apellido) ? datos.apellido.trim() : null;
    const existente = await this.titular(telefono);
    if (existente) {
      const fichaDeRelleno = !existente.nombre || esRelleno(existente.nombre);
      await this.pool.query(
        `UPDATE pacientes SET
           nombre = CASE WHEN $2::text IS NOT NULL AND ($4 OR nombre IS NULL) THEN $2 ELSE nombre END,
           apellido = CASE WHEN $3::text IS NOT NULL AND ($4 OR apellido IS NULL) THEN $3 ELSE apellido END,
           idioma_preferido = COALESCE($5, idioma_preferido),
           updated_at = NOW()
         WHERE id = $1`,
        [existente.id, nombre, apellido, fichaDeRelleno, datos.idioma ?? null],
      );
      return (await this.porId(existente.id))!;
    }
    const res = await this.pool.query(
      `INSERT INTO pacientes (nombre, apellido, telefono, titular, idioma_preferido)
       VALUES ($1, $2, $3, TRUE, $4) RETURNING *`,
      [nombre, apellido, telefono, datos.idioma ?? null],
    );
    return aPaciente(res.rows[0]);
  }

  /** Ficha de un TERCERO del mismo teléfono (para_otra_persona). No toca la del titular. */
  async tercero(telefono: string, nombre: string, apellido: string | null): Promise<Paciente> {
    if (esRelleno(nombre)) throw new Error(`Nombre de relleno rechazado: "${nombre}"`);
    const candidatos = await this.porTelefono(telefono);
    const clave = claveNombre(nombre);
    const existente = candidatos.find((p) => !p.titular && p.nombre && claveNombre(p.nombre) === clave);
    if (existente) return existente;
    const res = await this.pool.query(
      `INSERT INTO pacientes (nombre, apellido, telefono, titular) VALUES ($1, $2, $3, FALSE) RETURNING *`,
      [nombre.trim(), apellido?.trim() ?? null, telefono],
    );
    return aPaciente(res.rows[0]);
  }

  async ponerIdioma(id: number, idioma: string): Promise<void> {
    await this.pool.query('UPDATE pacientes SET idioma_preferido = $1, updated_at = NOW() WHERE id = $2', [idioma, id]);
  }
}

/** Nombre de pila normalizado para comparar (sin tildes, minúsculas, primer token). */
export function claveNombre(nombre: string): string {
  const primero = nombre.trim().split(/\s+/)[0] ?? '';
  return primero.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * ¿Coincide el nombre de pila dado con el de la ficha? Conservadora: si falta
 * alguno de los dos, se trata como coincidencia (no bloquear por falta de dato).
 */
export function mismoNombreDePila(dado: string | null | undefined, ficha: string | null | undefined): boolean {
  if (!dado || !ficha) return true;
  return claveNombre(dado) === claveNombre(ficha);
}
