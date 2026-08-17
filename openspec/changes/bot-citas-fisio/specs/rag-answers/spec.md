## ADDED Requirements

### Requirement: Ingesta de documentos a pgvector

Al subir un documento desde la página Documentos del panel, el sistema SHALL extraer su texto, trocearlo y almacenar los chunks con su embedding en `document_chunks` (pgvector, en `fisio1`), vinculados al registro de `documents`. Al borrar un documento SHALL eliminarse sus chunks. El proveedor y modelo de embeddings SHALL configurarse por entorno.

#### Scenario: Documento nuevo disponible
- **WHEN** el negocio sube un PDF con tarifas y preparación de las sesiones
- **THEN** en la siguiente pregunta relevante el bot ya puede recuperar su contenido

### Requirement: Actualización de documentos sin trazas de la versión anterior

La página Documentos SHALL ofrecer "reemplazar archivo" sobre un documento existente. El reemplazo SHALL ejecutarse por documento y de forma atómica: ingerir los chunks de la versión nueva y, en la misma transacción, eliminar TODOS los chunks de la versión anterior (`DELETE ... WHERE document_id`), de modo que ninguna consulta pueda mezclar versiones ni recuperar contenido obsoleto. NO SHALL ser necesario resubir el resto de documentos. Borrar un documento SHALL eliminar sus chunks y su archivo.

#### Scenario: Tarifas actualizadas
- **WHEN** el negocio reemplaza el PDF de precios por la versión nueva
- **THEN** la siguiente pregunta sobre precios responde solo con los nuevos; ningún chunk de la versión anterior sobrevive

#### Scenario: Reemplazo fallido a mitad
- **WHEN** la ingesta de la versión nueva falla (extracción o embeddings)
- **THEN** la versión anterior sigue íntegra y operativa; no queda un documento a medias

### Requirement: Tool de consulta con respuesta acotada

El agente SHALL disponer de una tool `consultar_info(pregunta)` que devuelve los k chunks más similares. El modelo SHALL responder únicamente con lo recuperado; sin resultado relevante, SHALL decirlo y ofrecer el teléfono de la clínica, sin inventar.

#### Scenario: Pregunta cubierta por documentos
- **WHEN** el cliente pregunta "¿qué llevo para la primera sesión?" y hay documento que lo cubre
- **THEN** el bot responde con esa información y puede retomar el flujo de reserva

#### Scenario: Pregunta sin cobertura
- **WHEN** el cliente pregunta algo que ningún documento cubre
- **THEN** el bot lo reconoce y deriva al teléfono, sin improvisar una respuesta
