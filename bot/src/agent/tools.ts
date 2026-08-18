import type { DefTool } from '../llm/tipos';

/**
 * Las citas se referencian por FECHA+HORA, nunca por ID: los resultados de tools
 * no persisten entre turnos y el modelo se inventaría los IDs (lección de balta).
 * Reservar son DOS tools; confirmar_cita no tiene parámetros a propósito.
 */
export const TOOLS: DefTool[] = [
  {
    nombre: 'consultar_disponibilidad',
    descripcion: 'Huecos reales para un servicio. Úsala SIEMPRE antes de ofrecer horas. Devuelve cada hueco con su campo iso: cópialo tal cual en proponer_cita.',
    parametros: {
      type: 'object',
      properties: {
        service_id: { type: 'integer', description: 'ID del servicio (catálogo del system prompt)' },
        fecha: { type: 'string', description: 'YYYY-MM-DD si el paciente pidió un día concreto; omitir para "lo antes posible"' },
        professional_id: { type: 'integer', description: 'Solo si el paciente pidió un profesional concreto' },
        cualquiera: { type: 'boolean', description: 'true si el paciente dijo que le da igual el profesional' },
      },
      required: ['service_id'],
    },
  },
  {
    nombre: 'proponer_cita',
    descripcion: 'Aparta una hora y devuelve el resumen para enseñar al paciente. NO reserva: la reserva la hace confirmar_cita tras el sí explícito.',
    parametros: {
      type: 'object',
      properties: {
        service_id: { type: 'integer' },
        inicio: { type: 'string', description: 'Campo iso EXACTO de un hueco devuelto por consultar_disponibilidad' },
        professional_id: { type: 'integer', description: 'Omitir si el paciente dijo "cualquiera"' },
        motivo: { type: 'string', description: 'Motivo de consulta si lo ha contado (p. ej. "dolor de rodilla"). Opcional.' },
        nombre: { type: 'string', description: 'Nombre de pila del paciente que se va a visitar' },
        apellido: { type: 'string', description: 'Apellido del paciente que se visita. OBLIGATORIO para reservar (identifica al paciente en la agenda); si no lo sabes, pídelo.' },
        para_otra_persona: { type: 'boolean', description: 'true si la cita es para otra persona distinta del titular del número' },
        sustituye_a: { type: 'string', description: 'Si el paciente ya tiene cita: "YYYY-MM-DD HH:MM" de la cita que esta sustituye, o "ninguna" si quiere conservar las dos' },
      },
      required: ['service_id', 'inicio'],
    },
  },
  {
    nombre: 'confirmar_cita',
    descripcion: 'Reserva la propuesta pendiente tras el SÍ explícito del paciente. Sin parámetros: confirma exactamente lo propuesto.',
    parametros: { type: 'object', properties: {} },
  },
  {
    nombre: 'listar_mis_citas',
    descripcion: 'Citas futuras del paciente (todas las personas de este número), con se_puede_anular y se_puede_modificar ya resueltos.',
    parametros: { type: 'object', properties: {} },
  },
  {
    nombre: 'modificar_cita',
    descripcion: 'Mueve una cita existente de una pieza a un nuevo inicio. NUNCA modifiques reservando una nueva y anulando después.',
    parametros: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'YYYY-MM-DD de la cita actual' },
        hora: { type: 'string', description: 'HH:MM de la cita actual' },
        nuevo_inicio: { type: 'string', description: 'Campo iso de un hueco devuelto por consultar_disponibilidad' },
      },
      required: ['fecha', 'hora', 'nuevo_inicio'],
    },
  },
  {
    nombre: 'anular_cita',
    descripcion: 'Anula una cita. Se puede siempre, incluidas las de hoy.',
    parametros: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'YYYY-MM-DD de la cita' },
        hora: { type: 'string', description: 'HH:MM de la cita' },
      },
      required: ['fecha', 'hora'],
    },
  },
  {
    nombre: 'registrar_paciente',
    descripcion: 'Guarda nombre y apellido del titular del número cuando se presenta.',
    parametros: {
      type: 'object',
      properties: { nombre: { type: 'string' }, apellido: { type: 'string' } },
      required: ['nombre'],
    },
  },
  {
    nombre: 'consultar_info',
    descripcion: 'Busca en los documentos de la clínica (tarifas, tratamientos, preparación, normas). Responde SOLO con lo que devuelva.',
    parametros: {
      type: 'object',
      properties: { pregunta: { type: 'string' } },
      required: ['pregunta'],
    },
  },
];
