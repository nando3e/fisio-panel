## ADDED Requirements

### Requirement: Paciente como entidad, teléfono como contacto

El sistema SHALL modelar `pacientes` como entidad propia: el teléfono SHALL ser un dato de contacto indexado NO único, con un titular por número y terceros posibles. Las citas SHALL referenciar `paciente_id`; el historial, la continuidad y el idioma SHALL ser por paciente, no por teléfono.

#### Scenario: Dos personas, un número
- **WHEN** Fernando (titular) y Laura comparten número y ambos tienen citas
- **THEN** cada uno tiene su ficha, su historial y su fisio habitual propios; el bot no los mezcla

### Requirement: Reconocimiento al inicio del turno

En cada turno el sistema SHALL resolver en código (sin depender de tools del LLM): los pacientes candidatos del teléfono, el titular presunto, y su última cita real (fecha, servicio, profesional). Ese contexto SHALL inyectarse en el system prompt (saludar por nombre, no pedir datos que ya se tienen) y en el `ToolContext` para las reglas duras.

#### Scenario: Paciente conocido
- **WHEN** escribe un número con titular registrado
- **THEN** el bot le saluda por su nombre y no le pide nombre ni teléfono en ningún punto del flujo

#### Scenario: Número desconocido
- **WHEN** escribe un número sin ficha
- **THEN** se trata como paciente nuevo: se le ofrece Primera visita y se le piden nombre y apellido solo cuando ya eligió hora

### Requirement: Protección de la ficha

El sistema SHALL rechazar nombres de relleno (lista corta de placeholders, doble barrera: ejecutor y repositorio), SHALL hacer prevalecer los datos guardados sobre lo que aporte el modelo (salvo que la ficha ya sea de relleno) y SHALL usar upserts con `COALESCE` para que un nulo nunca borre un dato.

#### Scenario: Alucinación de nombre
- **WHEN** el modelo intenta registrar "Cliente WhatsApp" o reescribir el nombre de una ficha existente
- **THEN** el registro se rechaza o se ignora en favor del dato guardado; la reserva pide el nombre real

### Requirement: Sugerencia de repetición para recurrentes

Cuando un paciente recurrente exprese una intención vaga, el bot SHALL proponer la continuación natural usando el dato calculado de su última visita (servicio + profesional + fecha relativa), sin deducirlo el modelo.

#### Scenario: "Me duele la rodilla, vine la semana pasada"
- **WHEN** la última cita del paciente fue Fisioterapia con Marta hace 6 días
- **THEN** el bot propone seguimiento de fisioterapia con Marta; si la última fue Acupuntura, propone acupuntura

### Requirement: Idioma por paciente

El idioma efectivo del turno SHALL ser `pacientes.idioma_preferido` si existe, o el `idioma_por_defecto` del panel (ca/es). El sistema SHALL detectar el idioma de los últimos mensajes del paciente por heurística en código y SHALL actualizar `idioma_preferido` solo con señal clara; un mensaje ambiguo ("ok", "sí") NUNCA SHALL cambiarlo. El bot SHALL responder siempre en el idioma efectivo, y los textos fijos (recordatorios, avisos) SHALL salir de `textos` en ese idioma.

#### Scenario: Cambio de idioma detectado
- **WHEN** un paciente con default castellano escribe dos mensajes claramente en catalán
- **THEN** el bot pasa a responder en catalán y su recordatorio posterior llega en catalán

#### Scenario: Mensaje ambiguo
- **WHEN** un paciente con idioma catalán registrado responde "ok"
- **THEN** el idioma registrado no cambia y la respuesta sigue en catalán
