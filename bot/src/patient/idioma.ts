/**
 * Detección de idioma ca/es por heurística léxica sobre los últimos mensajes del paciente.
 * Solo se actualiza la ficha con SEÑAL CLARA; un "ok"/"sí" nunca cambia el idioma (design.md D10).
 */

const MARCAS_CA = [
  'bon dia', 'bona tarda', 'vull', 'voldria', 'demà', 'dema', 'avui', 'hora', 'amb', 'demanar',
  'gràcies', 'gracies', 'si us plau', 'us ', 'puc', 'podria', 'quin', 'quina', 'dilluns', 'dimarts',
  'dimecres', 'dijous', 'divendres', 'dissabte', 'diumenge', 'tinc', 'anul·lar', 'anullar', 'canviar',
  'setmana', 'vinent', 'perquè', 'perque', 'també', 'tambe', 'què', 'això', 'aixo', 'em ', 'et ', 'doncs',
  'genoll', 'esquena', 'mal de', 'fisio',
];

const MARCAS_ES = [
  'buenos días', 'buenos dias', 'buenas tardes', 'quiero', 'querría', 'queria', 'mañana', 'hoy',
  'cita', 'con', 'pedir', 'gracias', 'por favor', 'puedo', 'podría', 'podria', 'cuál', 'cual',
  'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo',
  'tengo', 'anular', 'cambiar', 'semana', 'que viene', 'porque', 'también', 'tambien', 'esto',
  'me ', 'te ', 'pues', 'rodilla', 'espalda', 'dolor',
];

function puntuar(texto: string, marcas: string[]): number {
  let puntos = 0;
  for (const marca of marcas) if (texto.includes(marca)) puntos++;
  return puntos;
}

/** 'ca' | 'es' con señal clara; null si el texto es ambiguo o demasiado corto. */
export function detectarIdioma(mensajes: string[]): 'ca' | 'es' | null {
  const texto = ` ${mensajes.join(' ').toLowerCase()} `;
  if (texto.trim().length < 8) return null;
  const ca = puntuar(texto, MARCAS_CA);
  const es = puntuar(texto, MARCAS_ES);
  if (ca >= 2 && ca > es) return 'ca';
  if (es >= 2 && es > ca) return 'es';
  return null;
}
