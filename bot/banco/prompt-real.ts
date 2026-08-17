import { cargarEnvLocal } from '../src/config/cargarEnvLocal';
cargarEnvLocal();

/**
 * Reconstruye el system prompt REAL contra la base y comprueba que los datos llegan
 * dentro. Es la prueba de las COSTURAS, no de las piezas: en balta, `bloqueNegocio`
 * tenía tests y aun así el horario no llegaba al prompt porque nadie llamaba a la función.
 *
 *   DATABASE_URL=... npx tsx banco/prompt-real.ts
 */

import { Aplicacion } from '../src/aplicacion';
import { cargarEnv } from '../src/config/env';
import { resolverContextoPaciente } from '../src/patient/turno';
import { bloqueCatalogo, bloqueNegocio, bloquePaciente, bloqueTemporal } from '../src/agent/contexto';
import { fechaLocal } from '../src/booking/tiempo';

const TELEFONO = '+34699000222';

function afirmar(condicion: boolean, mensaje: string): void {
  console.log(`${condicion ? '✓' : '✗'} ${mensaje}`);
  if (!condicion) process.exitCode = 1;
}

async function main(): Promise<void> {
  const app = new Aplicacion({ ...cargarEnv(true) });
  try {
    await app.inicializar();
    const ahora = new Date();
    const settings = await app.config.settings();
    const catalogo = await app.catalogo.catalogo();
    const reglasCentro = await app.catalogo.reglasCentro();
    const paciente = await resolverContextoPaciente(
      { pacientes: app.pacientes, citas: app.citas, memoria: app.memoria, config: app.config, catalogo: app.catalogo },
      TELEFONO, ahora,
    );
    const { texto: versionados, versiones } = await app.prompts.systemPrompt();
    const [nombre, direccion, diasCalendario] = await Promise.all([
      app.config.valor('nombre_negocio'),
      app.config.valor('direccion_negocio'),
      app.config.entero('dias_calendario'),
    ]);

    // El MISMO orden y las MISMAS funciones que usa el agente en cada turno.
    const system = [
      versionados,
      bloqueCatalogo(catalogo, settings.paso),
      bloqueNegocio({ nombre, direccion, telefono: settings.telefonoNegocio, reglasCentro }),
      bloquePaciente(paciente, await app.config.continuidadModo()),
      bloqueTemporal({ ahora, tz: settings.timezone, diasCalendario, reglasCentro, idioma: paciente.idioma }),
    ].join('\n\n---\n\n');

    console.log(`\n--- System prompt real: ${system.length} caracteres, ${Object.keys(versiones).length} roles ---`);

    afirmar(Object.keys(versiones).length === 5, `los 5 roles de prompt están activos (hay ${Object.keys(versiones).length})`);
    afirmar(system.includes(nombre), `el nombre del negocio ("${nombre}") llega al prompt`);
    afirmar(settings.telefonoNegocio === null || system.includes(settings.telefonoNegocio), 'el teléfono del negocio llega al prompt');

    // Horario: al menos una franja real de la BD tiene que aparecer escrita.
    const primeraRegla = reglasCentro[0];
    if (primeraRegla) {
      const hhmm = primeraRegla.startTime.slice(0, 5);
      afirmar(system.includes(hhmm), `el horario del centro llega al prompt (busco "${hhmm}")`);
    } else {
      console.log('· sin reglas de horario en la BD: nada que comprobar');
    }

    // Catálogo: cada servicio activo, con su duración calculada.
    for (const s of catalogo.servicios) {
      const minutos = s.slotsRequired * settings.paso;
      afirmar(system.includes(`${s.name} (service_id ${s.id}, ${minutos} min)`), `el servicio "${s.name}" aparece con ${minutos} min`);
    }
    const sinProfesional = catalogo.servicios.filter((s) => !(catalogo.porServicio.get(s.id) ?? []).length);
    afirmar(sinProfesional.length === 0, `todos los servicios tienen profesional asignado${sinProfesional.length ? ` (sin asignar: ${sinProfesional.map((s) => s.name).join(', ')})` : ''}`);

    // Bloque temporal: fecha de hoy y ámbito declarado.
    afirmar(system.includes(fechaLocal(ahora, settings.timezone)), 'la fecha de HOY llega al prompt');
    afirmar(system.includes('[HOY]') && system.includes('[mañana]'), 'la tabla de días marca HOY y mañana');
    afirmar(/SOLO estos \d+ días/.test(system), 'la afirmación del calendario declara su ámbito');
    const cerrados = (system.match(/— CERRADO/g) ?? []).length;
    afirmar(cerrados > 0, `los días cerrados van MARCADOS, no omitidos (${cerrados} en la tabla)`);

    // Idioma e instrucciones de identidad del paciente.
    afirmar(/Idioma del paciente: (CASTELLANO|CATAL)/.test(system), 'el prompt indica el idioma del paciente');
    afirmar(system.includes('NO registrado'), 'un número desconocido se declara como paciente nuevo');

    // Reglas duras: las que sostienen el flujo.
    for (const marca of ['consultar_disponibilidad', 'confirmar_cita', 'sustituye_a', 'PROHIBIDO']) {
      afirmar(system.includes(marca), `las reglas mencionan "${marca}"`);
    }
  } finally {
    await app.pool.query('DELETE FROM chat_memory WHERE session_id = $1', [TELEFONO]).catch(() => {});
    await app.cerrar();
  }
  console.log(process.exitCode ? '\nPROMPT CON FALLOS' : '\nPROMPT OK');
}

main().catch((e) => { console.error('PROMPT FALLÓ:', e); process.exit(1); });
