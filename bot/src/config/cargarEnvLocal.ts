import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Carga bot/.env en desarrollo local (Node ≥ 20.6, sin dependencias).
 * En Dokploy no existe el fichero: las variables llegan del entorno del contenedor.
 * Nunca pisa una variable ya definida en el entorno.
 */
export function cargarEnvLocal(): void {
  const ruta = resolve(process.cwd(), '.env');
  if (!existsSync(ruta)) return;
  const cargar = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (typeof cargar !== 'function') return; // Node antiguo: se usan solo las del entorno
  try {
    cargar(ruta);
  } catch (err) {
    console.warn(`[env] no se pudo leer ${ruta}:`, err instanceof Error ? err.message : err);
  }
}
