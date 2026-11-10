# Spec 004: Portal de propuestas y prospección asistida (admin-only)

**Estado:** aprobada (2026-11-10)
**Fecha:** 2026-11-10
**Relacionada con:** `specs/constitution.md` §1 a §7; `src/middleware.ts`; `src/lib/roles.ts`; `src/lib/auth.ts`; `src/lib/audit.ts`; `src/lib/resend.ts`; `prisma/schema.prisma`; specs 001, 002 y 003 (referencia de estilo y operación).
**Gate:** aprobada para planificación e implementación. El envío real queda detrás de un gate operativo (`PROPUESTAS_ENVIO_HABILITADO`), del checklist legal y del gate de staging definidos en `plan.md` y `tasks.md`. Las preguntas de §20 quedaron cerradas con los defaults del dueño; la validación del texto legal exacto y la inscripción AAIP siguen siendo requisitos previos a habilitar envíos, no bloqueos del plan.

---

## 1. Contexto y objetivo

### 1.1 Situación actual

- El CRM de PixelArch gestiona clientes, proyectos por hitos, soporte, pagos, cobros y recibos. No tiene ningún flujo de prospección: no hay registro de empresas investigadas, contactos, borradores ni seguimiento de propuestas enviadas.
- La prospección hoy es manual: buscar negocios, revisar sus webs, decidir si encajan, escribir un mensaje, enviarlo y recordar a quién no volver a contactar. Es lenta, inconsistente y no deja trazabilidad.
- Ya existen piezas reutilizables:
  - `src/lib/audit.ts` y `/api/audit`: normalización de URL, protección SSRF, scores de velocidad/SSL/SEO/seguridad y hallazgos.
  - `src/lib/resend.ts` y la cuenta de Resend con dominio verificado para emails transaccionales.
  - `GOOGLE_PLACES_API_KEY` para reseñas de Google; no hay hoy un flujo de búsqueda de prospectos.
  - Clerk con roles `admin` y `asistente`, y `requireAdmin()`/`requireStaff()`.
- Existe una página pública `/propuesta` (singular) de presentación de servicios. **No es este portal** y no debe confundirse ni romperse.

### 1.2 Problema

PixelArch necesita prospección B2B asistida sin convertir el CRM en una herramienta de spam ni exponer datos de clientes. El trabajo de buscar, deduplicar, enriquecer, puntuar y redactar consume tiempo; hacerlo a mano no escala y no deja evidencia de quién aprobó qué, cuándo y con qué texto. Al mismo tiempo, un flujo mal diseñado puede:

- Enviar mensajes sin aprobación humana.
- Contactar repetidamente a quien pidió no ser contactado.
- Guardar PII innecesaria o mezclarla con datos de clientes.
- Violar los términos de Google Places o de las webs consultadas.
- Generar costos variables sin control (Places, LLM, Resend).
- Convertirse en una puerta de entrada pública o accesible para la asistente.

### 1.3 Objetivo

Crear un portal interno `/propuestas`, separado del CRM y accesible solo para el rol `admin`, que permita:

1. Buscar empresas B2B con Google Places y webs públicas.
2. Deduplicar y enriquecer los resultados con datos publicados por el propio negocio.
3. Puntuar el encaje de forma determinista y explicable.
4. Redactar borradores personalizados usando la auditoría web existente.
5. Revisar y aprobar cada mensaje de forma explícita.
6. Enviar únicamente después de una confirmación humana, con Resend.
7. Respetar opt-out, supresión y límites diarios.
8. Dejar trazabilidad de fuentes, aprobaciones, envíos y bajas.
9. No tocar `Cliente`, `Pago` ni ningún modelo del CRM.

### 1.4 Resultado esperado

- Un admin entra a `/propuestas` y ve un portal propio, no el CRM.
- Puede lanzar una búsqueda acotada, ver candidatos deduplicados y con su fuente.
- Cada prospecto muestra el sitio, los datos públicos de contacto, la auditoría, el score y los motivos.
- El agente redacta un borrador; el admin lo edita y lo aprueba.
- Nada se envía al aprobar: el envío requiere una segunda confirmación explícita.
- Cada email sale con identificación, aviso legal, enlace de baja y encabezados de baja.
- Un opt-out bloquea de inmediato cualquier envío futuro a ese email (y, si se configura, a ese dominio de negocio).
- El portal no puede leer ni escribir datos del CRM, salvo que una decisión futura y explícita habilite una conversión manual.
- Los costos y cupos son visibles y se cortan en el tope configurado.

### 1.5 Principios y decisiones fijas

- **Admin-only:** solo `publicMetadata.role === 'admin'`. La asistente no entra, no lee y no aprueba. La única excepción es la página pública de baja por token.
- **Humano en el circuito:** el agente investiga y redacta; el dueño aprueba y envía. No hay envío automático, programado, por lote, por secuencia ni por reintento automático.
- **Aislamiento del CRM:** modelos propios y ninguna relación con `Cliente`, `Pago`, `Suscripcion`, `EnlacePago`, `Proyecto` o `Hito`. No se leen datos de clientes para personalizar.
- **B2B:** solo organizaciones con contacto profesional publicado. No se prospectan consumidores, menores ni datos sensibles.
- **Fuentes lícitas:** Google Places por API oficial y webs públicas del propio negocio. No se compran listas, no se scrapea Google Maps, buscadores ni redes sociales, y no se saltan logins, paywalls o CAPTCHAs.
- **Google Places:** se persiste `place_id`; el resto del contenido de Places no se almacena más allá de lo que permitan sus términos. Los datos del prospecto se guardan desde la web del negocio o por carga manual, con fuente y fecha.
- **Auditoría existente:** se reutiliza la lógica de `src/lib/audit.ts`; no se llama al endpoint público `/api/audit` ni se consume su rate limit de 8/hora.
- **Resend:** único canal de envío. Remitente `propuestas@pixelarch.dev`, reply-to `hola@pixelarch.dev`, dominio verificado con SPF/DKIM/DMARC; sin secretos en el cliente. Sin configuración válida, el envío queda deshabilitado.
- **v1 sin LLM:** los borradores se generan con plantillas deterministas + datos verificados + auditoría existente. El adaptador de LLM queda reservado para una mejora posterior; sin LLM configurado no hay borrador parcial (la plantilla sigue disponible).
- **Contacto:** solo se usa el email profesional publicado en el sitio del negocio (o cargado manualmente por el admin con fuente). Sin email público no se envía; no se adivinan patrones ni se usan directorios, formularios, data brokers o listas compradas.
- **Cupos iniciales:** 20 envíos/día, aprobación manual y supresión obligatoria. Los topes técnicos de Places, fetches, auditorías y borradores se fijan en `plan.md` como límites conservadores configurables.
- **Retención:** prospectos 12 meses; supresión permanente; logs 30 días. La supresión sobrevive al borrado del prospecto y a la retención.
- **Alcance organizacional:** `/propuestas` es solo admin; la asistente no entra ni lee. La conversión manual a `Cliente` queda fuera de esta spec, sin FK ni mezcla de datos.
- **Privacidad:** PII mínima, con procedencia, retención y derecho de acceso/rectificación/supresión. Nunca PII en logs, Sentry o analytics.
- **Supresión:** obligatoria, global y permanente para el email; no se borra al borrar el prospecto. La supresión por dominio solo aplica a dominios de negocio, nunca a proveedores de email público.
- **Cupos:** todo consumo externo tiene tope diario y tope duro. Sin sobreconsumo silencioso.
- **Fallar cerrado:** si falta Clerk, Prisma, Places, Resend, LLM o la configuración legal, la parte afectada se deshabilita con un mensaje claro; no se envía nada a medias.
- **Sin cambios en el CRM:** `Cliente` y `Pago` no se modifican; los tests existentes de CRM, PayPal y Mercado Pago siguen verdes.
- **Calidad:** TypeScript estricto, tests para cada AC, sin comandos interactivos ni watch.

### 1.6 Supuestos y dependencias

- El dominio de envío está verificado en Resend y tiene SPF/DKIM/DMARC correctos; el remitente es `propuestas@pixelarch.dev` y el reply-to `hola@pixelarch.dev` (Q-2).
- La cuenta de Google Cloud tiene Places API habilitada y facturación; se usa una clave server-only separada para prospección (`PROPUESTAS_PLACES_API_KEY`, Q-12).
- **v1 no usa LLM.** La redacción es determinista con plantillas y la auditoría existente. Se deja un puerto/adaptador server-only reservado para una mejora posterior; no se elige proveedor ni se agrega dependencia en esta spec.
- La base es PostgreSQL y los cambios de esquema se aplican con `db push` (o el CLI local si `npx` falla). Los modelos nuevos son aditivos; no hay backfill ni migración de datos existentes.
- El portal corre en Railway, detrás de Clerk. Las llamadas a Places y Resend son server-only; un futuro LLM también lo será.
- No hay Redis ni cola distribuida. Los limitadores son en memoria y best-effort, como el resto del proyecto; se documenta esa limitación.
- La suite no hace llamadas reales a Google, LLM ni Resend. Las pruebas manuales usan cuentas propias y direcciones controladas.

---

## 2. Alcance

### 2.1 Incluido

| Área | Incluido |
|------|----------|
| **Portal** | Ruta `/propuestas`, layout propio, navegación separada del CRM, solo admin. |
| **Búsqueda** | Campaña/búsqueda con consulta, zona, rubro, filtros, estado y límites. Búsqueda por Google Places (API oficial). |
| **Deduplicación** | `place_id`, email normalizado, dominio de negocio y detección de posibles duplicados. Sin fusión silenciosa. |
| **Enriquecimiento** | Visita acotada a webs públicas del negocio, extracción de datos profesionales publicados, auditoría web existente. |
| **Puntuación** | Score determinista 0-100 con desglose y motivos; datos faltantes no se inventan. |
| **Borradores** | Plantilla + datos verificados + hallazgos de auditoría; edición del admin; versionado; sin envío automático. |
| **Aprobación y envío** | Aprobación explícita con snapshot; confirmación separada de envío; Resend; idempotencia; registro de message id. |
| **Cumplimiento** | B2B, opt-out público, supresión global, encabezados `List-Unsubscribe`, aviso legal, `publicidad`, trazabilidad de fuente. |
| **Límites y costos** | Cupos diarios por proveedor y campaña, presupuesto, alertas, tope duro, consumo visible. |
| **Datos** | Modelos `Prospecto`, `CampanaProspeccion`, `PlantillaPropuesta`, `EnvioPropuesta`, `SupresionProspecto`; retención y ARCO. |
| **Operación** | Tests, typecheck, lint, build, documentación de runbook y checklist legal. |

### 2.2 Fuera de alcance

- Cualquier cambio a `Cliente`, `Pago`, `Suscripcion`, `EnlacePago`, `Proyecto`, `Hito`, CRM, cobros, recibos o dashboard.
- Portal de clientes, autenticación nueva, roles nuevos o permitir a la asistente.
- Envío automático, programado (`scheduledAt`), en lote, secuencias, campañas de newsletter o follow-ups automáticos.
- Compra de listas, scraping de Google Maps/buscadores/redes sociales, automatización de LinkedIn, WhatsApp o llamadas.
- Formularios de contacto como canal de salida; el canal es email vía Resend.
- Datos de consumidores, menores, salud, ideología, religión, sindicato, vida sexual, origen racial/étnico, biometría o cualquier dato sensible.
- Múltiples contactos por empresa en el MVP: un prospecto tiene un contacto principal.
- Reutilizar un prospecto en varias campañas simultáneas o gestionar una bandeja de respuestas entrante; el MVP registra respuestas manualmente.
- Seguimiento automático de aperturas/clics, píxeles de tracking, adjuntos, A/B testing o analítica de deliverability avanzada.
- Verificación de emails con un proveedor externo: no se usa; solo cuenta el email publicado en el sitio o cargado manualmente con fuente (Q-3).
- Conversión automática a `Cliente` o creación de proyectos/pagos desde el portal.
- Panel de administración de Google Cloud, Resend o el proveedor de LLM.
- Rate limiting distribuido, Redis, WAF o colas persistentes.
- Tests E2E contra Google, LLM o Resend reales dentro de la suite.
- Cambios en la landing pública, sitemap, robots, RSS, `/propuesta` (singular) o las páginas legales existentes.

---

## 3. Actores y permisos

| Actor | Puede | No puede |
|-------|-------|----------|
| **Admin / dueño** | Entrar a `/propuestas`, buscar, enriquecer, puntuar, redactar, editar, aprobar, enviar, suprimir, ver consumo y atender ARCO. | Saltar la aprobación, enviar sin confirmación, ver datos del CRM desde el portal, borrar una supresión sin motivo. |
| **Asistente** | Nada en este portal. | Entrar a `/propuestas`, leer prospectos, aprobar, enviar, suprimir ni llamar a las APIs. |
| **Visitante / anónimo** | Abrir el enlace público de baja de un email y confirmar la baja. | Ver prospectos, campañas, borradores, envíos, datos de contacto ni información interna. |
| **Prospecto / titular del dato** | Recibir el email, pedir baja/bloqueo, ejercer acceso, rectificación o supresión. | Acceder al portal, ver la base, aprobar o modificar contenido. |
| **Google Places** | Proveer resultados de búsqueda y place IDs por API oficial. | Ser scrapeado, cacheado fuera de sus términos o usado para enriquecer con datos no permitidos. |
| **Webs públicas** | Proveer información publicada por el propio negocio. | Ser accedidas tras login/paywall, ignorando robots o con evasión de controles. |
| **Proveedor LLM (mejora posterior; no en v1)** | Redactar borradores a partir de datos acotados, si se habilita en el futuro. | Enviar emails, acceder a herramientas, navegar o recibir PII innecesaria. |
| **Resend** | Entregar emails aprobados y reportar message IDs. | Enviar sin aprobación, programar envíos o aceptar un remitente no verificado. |
| **Clerk** | Autenticar y aportar el rol. | Autorizar por sí solo: el portal revalida el rol en cada página y API. |

---

## 4. Historias de usuario

- **HU-1:** Como dueño, quiero buscar empresas B2B por rubro y zona, para obtener una lista acotada de candidatos sin revisar manualmente cientos de resultados.
- **HU-2:** Como dueño, quiero que el sistema deduplique y me marque posibles duplicados, para no contactar dos veces a la misma empresa ni mezclar sucursales.
- **HU-3:** Como dueño, quiero ver qué datos son públicos, de dónde salieron y cuándo, para decidir con evidencia y cumplir la ley.
- **HU-4:** Como dueño, quiero un score explicable, para priorizar el tiempo en los prospectos con mejor encaje y no depender de una caja negra.
- **HU-5:** Como dueño, quiero borradores personalizados con hallazgos reales de la web del prospecto, para escribir mensajes útiles sin inventar métricas.
- **HU-6:** Como dueño, quiero revisar, editar y aprobar cada mensaje antes de enviarlo, para no mandar nada de forma automática ni arrepentirme después.
- **HU-7:** Como dueño, quiero que un opt-out o un rebote duro bloqueen de inmediato futuros envíos, para proteger la reputación del dominio y cumplir la ley.
- **HU-8:** Como dueño, quiero ver el consumo y los topes de Places, LLM y Resend, para evitar sorpresas de costo.
- **HU-9:** Como titular de un dato, quiero darme de baja en un clic y saber que no me van a contactar más, sin tener que crear una cuenta.
- **HU-10:** Como responsable del proyecto, quiero que este portal no toque el CRM, para no exponer datos de clientes ni romper pagos y cobros.

---

## 5. Flujo end-to-end

1. **Crear campaña/búsqueda.** El admin define consulta, zona, rubro, filtros, cupo y plantilla base. La campaña nace en `BORRADOR`; no se envía nada.
2. **Buscar en Google Places.** El sistema consulta la API oficial con los campos mínimos y guarda `place_id` y el estado de la búsqueda. Los demás datos de Places se usan de forma transitoria y no se persisten fuera de lo permitido.
3. **Deduplicar.** Por `place_id`, email normalizado y dominio de negocio. Los duplicados exactos se reutilizan; los posibles duplicados se marcan para decisión del admin.
4. **Enriquecer.** Se visita la web pública del negocio (con guard SSRF, robots, timeout y límites) y se extraen solo datos profesionales publicados. Se registra fuente y fecha por campo.
5. **Auditar.** Se reutiliza la lógica de auditoría existente sobre el sitio del prospecto. Se guarda un resumen con scores, hallazgos y fecha; no el HTML.
6. **Puntuar.** Un score determinista 0-100, con desglose y motivos. Los datos faltantes bajan el score; no se inventan.
7. **Redactar.** Se combina la plantilla con los datos verificados y los hallazgos de auditoría. El resultado es un borrador editable, nunca un envío.
8. **Revisar y aprobar.** El admin ve destinatario, asunto, cuerpo, fuentes, score, auditoría y versión de plantilla. Aprueba con una acción explícita; se guarda un snapshot y quién aprobó.
9. **Confirmar envío.** Una segunda acción explícita envía por Resend. Se revalidan aprobación, supresión, email, cupo y hash del contenido. Se usa una clave de idempotencia.
10. **Registrar resultado.** Se guarda message ID, estado, fecha y error sanitizado. Un fallo queda `FALLIDO` sin reintento automático.
11. **Baja o rebote.** Un opt-out, rebote duro o queja crea/actualiza la supresión, cancela borradores pendientes y bloquea cualquier envío futuro.
12. **Cierre y retención.** El admin puede marcar respondido/descartado. La retención configurada elimina o anonimiza prospectos, pero conserva la supresión.

**Flujos excepcionales:**

- Si Places falla a mitad de la búsqueda, se conservan los resultados ya obtenidos y la campaña queda `PARCIAL`; no se inventan prospectos.
- Si una web bloquea, tarda o no es HTML, se marca `SIN_ENRIQUECER` con el motivo; el prospecto puede seguir existiendo, pero no se envía sin datos suficientes.
- Si la auditoría falla, el borrador se puede redactar sin hallazgos técnicos, marcado como tal; no se inventan métricas.
- Si el LLM falla o no está configurado, no se crea un borrador parcial; el score y la ficha siguen disponibles.
- Si el admin edita después de aprobar, la aprobación se invalida y hay que aprobar de nuevo.
- Si se alcanza el cupo, se bloquea la acción; no se encola para el día siguiente.

---

## 6. Fuentes y límites

### 6.1 Fuentes permitidas

| Fuente | Uso permitido | Límites |
|--------|---------------|---------|
| **Google Places API (oficial)** | Descubrir negocios por consulta/zona/rubro; obtener `place_id` y datos transitorios para ubicar la web. | Solo API oficial; field masks mínimos; sin scraping de Maps; sin persistir contenido fuera de los términos; atribución si se muestra contenido de Google. |
| **Web pública del negocio** | Extraer nombre comercial, rubro, ciudad, email/teléfono profesionales publicados, señales para personalizar. | Solo HTTP/HTTPS público; sin login, paywall ni CAPTCHA; respetar robots y términos; timeout, tamaño y content-type acotados; guard SSRF. |
| **Auditoría existente** | Scores de velocidad/SSL/SEO/seguridad y hallazgos para personalizar. | Reutilizar `src/lib/audit.ts`; no llamar a `/api/audit`; una auditoría por prospecto/campaña; sin HTML crudo persistido. |
| **Carga manual del admin** | Corregir o completar datos con fuente y nota. | No importar listas compradas; no pegar datos sensibles; validar formato. |
| **Resend** | Enviar el mensaje aprobado y registrar message ID. | Dominio verificado; remitente/reply-to configurados; sin envío programado; sin lote automático. |

### 6.2 Google Places: reglas específicas

- Usar exclusivamente la API oficial (Places API / Text Search / Place Details según el plan). No se scrapea Google Maps, la SERP de Google ni servicios no oficiales.
- Pedir solo los campos necesarios (field mask). No pedir fotos, reseñas, horarios ni campos que no se usen.
- Persistir `place_id` (permitido indefinidamente). El resto del contenido de Google Maps/Places no se persiste más allá de lo que permitan los términos vigentes; si se muestra, se hace en vivo y con atribución.
- Los datos canónicos del prospecto (nombre, email, teléfono, ciudad) se guardan desde la web del negocio o carga manual, con `fuenteUrl` y `fechaFuente`. Si un dato solo existe en Places y no se puede persistir, se muestra en vivo o se marca como no disponible.
- No usar Places para inferir datos personales, opiniones, salud, religión, origen étnico ni ninguna categoría sensible.
- Respetar cuotas, errores `429` y facturación. Un `429` de Google no se reintenta en bucle: se informa y se corta la corrida.
- La clave es server-only. Si se reutiliza `GOOGLE_PLACES_API_KEY` de reseñas, el plan debe confirmar cuotas, restricciones de API y facturación; si no, se usa una clave separada.
- Cualquier excepción a la regla de no persistir contenido de Places requiere revisión legal/técnica y queda documentada en el plan.

### 6.3 Webs públicas: reglas específicas

- Solo URLs `http`/`https` públicas. Se reutiliza `normalizeUrl` e `isBlockedHost` de `src/lib/audit.ts`; se resuelve DNS y se rechazan IPs privadas, loopback, link-local, multicast, `.local`, `.internal` y puertos no estándar.
- Máximo de redirecciones, timeout y tamaño de respuesta definidos en el plan. Solo se procesa HTML; no se ejecuta JavaScript, no se aceptan cookies, credenciales ni certificados inválidos.
- Respetar `robots.txt` y los términos del sitio. No se accede a áreas autenticadas, paneles, intranets ni contenido detrás de paywall.
- User-Agent identificable de PixelArch con URL de contacto. No se oculta la identidad del crawler.
- No se extraen datos de terceros que aparezcan en la página (testimonios, empleados, clientes) salvo que sean el contacto profesional publicado del propio negocio.
- No se siguen enlaces a redes sociales, PDFs, imágenes, formularios ni descargas. Solo páginas HTML del dominio del negocio (y subdominios razonables).
- Si el sitio bloquea o no permite el acceso, se registra el motivo y no se insiste con evasión.

### 6.4 Auditoría existente

- Se reutiliza la lógica pura (`normalizeUrl`, `isBlockedHost`, `computeScores`, `buildFindings`) y el mismo enfoque de fetch/TLS de `/api/audit`.
- No se llama al endpoint público `/api/audit`: eso consumiría el rate limit de 8/hora por IP y mezclaría el tráfico interno con el público.
- La auditoría interna tiene su propio cupo y timeout. Se ejecuta sobre el sitio del prospecto, no sobre URLs arbitrarias del admin.
- Se guarda un resumen (`scores`, `findings`, `finalUrl`, `fecha`) y no el HTML ni datos de certificados completos.
- Si el sitio no es HTTPS o el certificado falla, se registra como hallazgo; no se intenta «arreglar» ni saltar TLS.

### 6.5 Redacción y LLM (v1 sin LLM)

- **v1 no usa LLM.** Los borradores se generan con una plantilla determinista, datos verificados del prospecto y hallazgos de la auditoría existente. El adaptador de LLM queda como puerto reservado para una mejora posterior, con su propia spec si se adopta.
- El contenido de la web es **dato no confiable**: se trata como texto, se escapa y se ignora cualquier instrucción embebida. La redacción determinista no ejecuta acciones, no navega, no lee archivos y no puede enviar emails.
- La salida es estructurada (asunto, cuerpo texto/HTML, variables usadas y fuentes). Se valida y sanitiza antes de guardar; no admite HTML arbitrario del admin ni saltos de línea en el asunto.
- Los límites de longitud, timeout y cupo por borrador se definen en el plan. Un fallo no se reintenta automáticamente.
- Si más adelante se configura un LLM, este recibe solo datos del negocio y hallazgos de auditoría (nunca datos del CRM, secretos, headers, cookies, HTML completo ni PII innecesaria), no tiene herramientas y su salida se valida igual. Sin configuración válida, la redacción por LLM se deshabilita con un mensaje claro y la plantilla determinista sigue funcionando.

### 6.6 Resend

- Solo se envía desde un dominio verificado en Resend, con SPF/DKIM/DMARC correctos. No se usa `onboarding@resend.dev` ni un remitente inventado.
- Valores fijos: `from` = `propuestas@pixelarch.dev` (nombre visible PixelArch) y `reply-to` = `hola@pixelarch.dev`, configurables por entorno server-only y visibles al admin antes de aprobar.
- Se envía una sola vez por aprobación, con `Idempotency-Key` y clave única de envío. No se usa `scheduledAt`.
- Se incluyen versión texto y HTML, enlace de baja, identificación y aviso legal. Sin píxeles de tracking ni adjuntos.
- Se usan encabezados `List-Unsubscribe` y `List-Unsubscribe-Post` (RFC 8058) además del enlace visible.
- Si el plan de Resend lo permite, se integran webhooks de rebote/queja con firma e idempotencia. Si no, el admin puede registrar rebote/queja manualmente.
- Un error de Resend no se reintenta automáticamente. El envío queda `FALLIDO` y el admin decide si corregir y reintentar.

---

## 7. Datos y PII

### 7.1 Categorías de datos

| Categoría | Ejemplos | Finalidad | Origen | Regla |
|-----------|----------|-----------|--------|-------|
| **Identidad del negocio** | Nombre comercial, sitio, ciudad, rubro, `place_id` | Identificar y deduplicar | Places (solo `place_id`), web del negocio, carga manual | Datos de negocio; `place_id` persistible; el resto con fuente. |
| **Contacto profesional** | Email de contacto publicado, teléfono comercial, nombre y cargo del contacto si son públicos | Escribir la propuesta | Web del negocio, carga manual | Solo datos publicados por el negocio; sin adivinar emails; sin datos personales innecesarios. |
| **Enriquecimiento** | Score, motivos, resumen de auditoría, hallazgos, fecha | Priorizar y personalizar | Cálculo propio y auditoría | Sin HTML crudo; sin datos sensibles; con fecha. |
| **Borrador** | Asunto, cuerpo, versión de plantilla, fuentes usadas | Revisión y aprobación | Plantilla + datos + auditoría (v1; LLM solo futuro) | Snapshot por versión; no se envía sin aprobación. |
| **Envío** | Destinatario, from/reply-to, asunto/cuerpo final, message ID, estado, aprobador, fecha | Trazabilidad y soporte | Resend y admin | PII mínima; no logs; retención definida. |
| **Supresión** | Hash del email normalizado, email enmascarado, dominio de negocio, motivo, fecha | No volver a contactar | Opt-out, rebote, queja, manual | Hash + mínimo; nunca proveedor de email público como dominio suprimido. |
| **Técnico** | IDs, estados, códigos de error, latencias, consumo | Operación y auditoría | Sistema | Sin PII, sin cuerpos, sin secretos. |

### 7.2 Reglas de datos

- **Minimización:** solo los datos necesarios para identificar al negocio, contactarlo y demostrar cumplimiento.
- **Procedencia:** cada dato relevante guarda `fuenteTipo`, `fuenteUrl` (si aplica) y `fechaFuente`. Un dato sin fuente no se usa para personalizar.
- **Exactitud:** el admin puede corregir; se guarda la corrección y la fuente. No se completa un email por patrón (`nombre@dominio`) ni por combinación de fuentes.
- **Datos sensibles:** prohibidos. Si aparecen, se descartan y no se guardan.
- **B2B:** solo contacto profesional de una organización. Si la fuente sugiere consumidor, menor o uso personal, se descarta.
- **Aislamiento:** ningún dato del CRM se copia al portal; ninguna escritura del portal toca el CRM.
- **PII en logs:** prohibido email completo, nombre, teléfono, cuerpo, HTML de la web, tokens de baja y secretos. Solo IDs internos, estados, códigos y métricas.
- **Sentry/analytics:** misma regla; redacción y scrubbing si corresponde. No se agrega analytics de marketing al portal.
- **Acceso:** solo admin autenticado. No hay API pública de lectura. La baja pública no revela datos.
- **Cifrado/secretos:** TLS en tránsito; secretos en envs de Railway/`.env.local`; nada en el repo. La base no guarda secretos de proveedores.
- **Supresión:** se guarda un hash determinista del email normalizado (con secreto server-side si el plan lo define) y, opcionalmente, un email enmascarado para la UI. No se necesita el email en claro para bloquear un futuro envío.
- **Dominios:** la supresión por dominio solo aplica a dominios de negocio. Nunca a `gmail.com`, `hotmail.com`, `outlook.com`, `yahoo.com`, `icloud.com` ni proveedores públicos equivalentes.

### 7.3 Retención y derechos

- **Retención aprobada:** prospectos 12 meses desde la última interacción; borradores, snapshots, auditorías y envíos asociados se eliminan con el prospecto; supresión permanente; logs técnicos 30 días. La purga se ejecuta por cron y también puede ejecutarla el admin, con registro del resultado.
- Al vencer la retención, el prospecto se elimina; los borradores y snapshots se eliminan en cascada; la supresión se conserva mientras sea necesaria para no volver a contactar.
- Las solicitudes de acceso, rectificación y supresión (ARCO) tienen un canal público y un procedimiento interno. El admin puede exportar los datos del prospecto y eliminar/anonimizar.
- La supresión no se borra por una solicitud de eliminación: se conserva el hash y el motivo para cumplir la baja.
- La baja de un email no elimina automáticamente todos los datos del prospecto; el admin decide si corresponde una eliminación adicional, dejando constancia.
- No se promete un plazo legal en esta spec; el plazo y el texto exacto se validan con revisión legal.

---

## 8. Cumplimiento: Ley 25.326 y anti-spam

> Esta sección fija requisitos de producto, no asesoramiento legal. La licitud del contacto en frío B2B, la base legal aplicable y los textos exactos deben validarse con un abogado antes de habilitar envíos.

### 8.1 Requisitos de cumplimiento

- **Base legal documentada:** cada campaña/prospecto registra la base legal invocada y la fuente. No se asume que «dato público» implica consentimiento; se requiere revisión legal.
- **Información al titular:** el email identifica a PixelArch, el fin (propuesta de servicios), la fuente de los datos y el canal para ejercer derechos.
- **Derecho de retiro/bloqueo:** en toda comunicación publicitaria se indica de forma expresa y destacada la posibilidad de solicitar el retiro o bloqueo total o parcial, con un mecanismo operativo.
- **Disposición DNPDP 4/2009:** el mensaje incluye el aviso, el mecanismo y la transcripción del art. 27, inc. 3, de la Ley 25.326 y del párrafo tercero del art. 27 del Anexo I del Decreto 1558/01. Para publicidad directa no requerida o consentida, se advierte destacadamente que se trata de publicidad y se inserta el término «publicidad» en el encabezado, según la interpretación legal que se apruebe.
- **Fuente de los datos:** a pedido del titular, se informa el nombre del responsable/usuario de la base que proveyó la información. El portal debe poder responder con la fuente registrada.
- **Capacidad operativa:** el mecanismo de baja debe funcionar sin login, sin costo y con respuesta efectiva. El sistema bloquea futuros envíos de inmediato; no se espera a un proceso manual.
- **B2B y datos sensibles:** solo contacto profesional de organizaciones; se excluyen consumidores, menores y datos sensibles.
- **Listas:** no se compran listas ni se usan bases de terceros sin verificar origen y base legal.
- **Asuntos y encabezados:** veraces, sin engaño, sin falsa urgencia, sin suplantación. Sin «Re:» o «Fwd:» falsos.
- **Contenido:** sin afirmaciones inventadas, sin métricas no auditadas, sin garantías absolutas, sin presión desmedida.
- **Registro:** se guarda quién aprobó, cuándo, qué texto exacto, a quién y con qué fuente. La supresión y las solicitudes ARCO tienen trazabilidad.
- **Registro de base de datos / AAIP:** si corresponde inscribir la base o actualizar la inscripción, se resuelve antes de habilitar envíos (§20.1).
- **Transferencia internacional:** Google, Resend y cualquier futuro LLM pueden procesar datos fuera de Argentina. Se documenta en el runbook y, si corresponde, se informa/obtiene base legal antes del primer envío (§20.1).
- **Retención:** limitada a la finalidad; la supresión se conserva para cumplir la baja.

### 8.2 Contenido mínimo del email

- Identificación clara de PixelArch y del servicio.
- Motivo del contacto y fuente de los datos.
- Un solo llamado a la acción, claro y honesto.
- Enlace visible de baja y, además, encabezados `List-Unsubscribe` / `List-Unsubscribe-Post`.
- Aviso de privacidad y canal ARCO.
- Texto legal exigido por la Disposición 4/2009 (a validar).
- Etiqueta «publicidad» cuando corresponda por ser publicidad directa no solicitada.
- Versión texto plano equivalente.
- Sin píxeles de apertura, sin adjuntos y sin enlaces de tracking personalizados.

### 8.3 Opt-out, supresión y rebotes

- La baja se puede pedir desde el enlace del email, por respuesta al correo o por el canal ARCO. El admin registra las bajas por respuesta; el enlace es automático.
- El enlace de baja es público, opaco, no contiene el email ni datos personales y no requiere sesión.
- Al confirmar la baja se crea una supresión global por email y se cancelan borradores/envíos pendientes de ese prospecto.
- La supresión se verifica al importar/crear el prospecto, antes de aprobar y antes de enviar. No alcanza con verificarla una vez.
- Un rebote duro o una queja suprimen el email. Una queja puede marcar el dominio para revisión; la supresión por dominio solo aplica a dominios de negocio.
- La supresión no se elimina automáticamente. Cualquier excepción requiere acción explícita del admin, motivo y registro; no se ofrece como flujo normal.

---

## 9. Auth, middleware y aislamiento

### 9.1 Regla de acceso

- `/propuestas` y todas sus subrutas internas son **solo admin**.
- La asistente recibe denegación (redirect a su inicio o `403`) tanto en páginas como en APIs, sin datos en la respuesta.
- Cada página y cada route handler revalida el rol con `requireAdmin()`/Clerk en el servidor. El middleware es una capa adicional, no la única.
- Sin sesión, el usuario ve el gate de Clerk o un redirect; nunca contenido parcial.
- Si Clerk falla o falta configuración, se falla cerrado (sin datos, sin acciones).

### 9.2 Colisión de rutas existente (crítica)

Hoy `src/middleware.ts` declara en `ROUTES.public` el patrón `/propuesta(.*)`. Ese patrón también hace match con `/propuestas` (plural) y se evalúa antes del control de admin. Por lo tanto, **agregar `/propuestas` a una lista de rutas protegidas no alcanza**: el portal podría quedar público.

Requisitos:

- La página pública `/propuesta` (singular) debe seguir pública y sin cambios.
- `/propuestas` (plural) y sus subrutas internas deben quedar protegidas para admin.
- El matcher debe distinguir de forma exacta `/propuesta` de `/propuestas` (o evaluar primero la protección de `/propuestas`).
- Debe existir un test de middleware que cubra ambos casos: `/propuesta` público y `/propuestas` no público.
- La única excepción pública dentro del portal es `/propuestas/baja/[token]` (y su API de confirmación), que debe quedar fuera de la protección admin y tener rate limit propio.

### 9.3 APIs

- APIs internas: `/api/propuestas/**` (o el prefijo que defina el plan). Requieren sesión admin, método POST/PATCH cuando corresponda y validación Zod.
- APIs públicas: solo la baja (`POST` de confirmación) y, si se implementan, webhooks de Resend con firma. No hay APIs públicas de lectura.
- Las APIs internas no aceptan `GET` para mutar, no confían en el rol enviado por el cliente y no devuelven PII innecesaria.
- Rate limit por admin y por IP para las APIs internas; rate limit por IP y por token para la baja.
- `Cache-Control: no-store` en respuestas con datos; `noindex` en páginas internas.
- Errores genéricos: no revelar si un email existe, si está suprimido o si un prospecto pertenece a otra campaña.

### 9.4 CSRF, sesión y aislamiento

- Las mutaciones usan POST/PATCH con verificación de origen/sitio y sesión Clerk; no se aceptan mutaciones por `GET`.
- No se exponen tokens de proveedores, claves de Places, claves de LLM ni secretos de Resend al cliente.
- El portal no comparte cookies ni estado con el CRM más allá de Clerk. No lee `Cliente` ni `Pago`.
- Un cambio de rol en Clerk debe reflejarse en la siguiente request; no se cachea el rol en el cliente.
- Los enlaces de baja usan tokens opacos; no se registran en logs ni en analytics.

### 9.5 Middleware: requisitos verificables

- `/propuesta` → público (regresión).
- `/propuestas` → admin; sin sesión, gate/redirect; con asistente, denegado.
- `/propuestas/baja/<token>` → público, `noindex`, `no-store`, rate limit.
- `/api/propuestas/**` → admin; sin sesión/asistente, `401/403`.
- `/api/opt-out` (o el nombre que defina el plan) → público, `POST`, rate limit, sin lectura de datos.
- `/admin/**` → comportamiento actual sin cambios.
- `/pago/**`, `/api/webhooks/**`, `/monitoring` y el resto del matcher actual → sin cambios.

---

## 10. Rutas y layout

### 10.1 Rutas propuestas

| Ruta | Función | Acceso |
|------|---------|--------|
| `/propuestas` | Panel: campañas recientes, cola de aprobación, consumo del día, supresiones. | Admin |
| `/propuestas/buscar` | Nueva campaña/búsqueda: consulta, zona, rubro, filtros y cupo. | Admin |
| `/propuestas/campanas/[id]` | Estado, resultados, duplicados, enriquecimiento, score y acciones. | Admin |
| `/propuestas/prospectos/[id]` | Ficha, fuentes, auditoría, score, borrador, aprobación y envío. | Admin |
| `/propuestas/bandeja` | Cola de borradores pendientes de revisión/aprobación. | Admin |
| `/propuestas/plantillas` | Plantillas, versiones, variables permitidas y vista previa. | Admin |
| `/propuestas/envios` | Historial de envíos, estados, message IDs y errores sanitizados. | Admin |
| `/propuestas/supresiones` | Lista de supresiones, motivo, fecha y origen; alta manual. | Admin |
| `/propuestas/baja/[token]` | Página pública de baja en un clic. | Público |
| `/api/propuestas/**` | APIs internas del portal. | Admin |
| `/api/opt-out` | Confirmación pública de baja. | Público, rate limit |

El plan puede ajustar nombres y agrupar rutas, pero debe mantener: portal separado, baja pública, APIs internas protegidas y ninguna ruta pública de lectura.

### 10.2 Layout

- Shell propio del portal, separado del layout de `/admin`: sidebar/header con marca, sección activa, identidad del admin, medidor de cupo del día y enlace de vuelta al CRM.
- No muestra navegación de clientes, cobros, pagos, servicios, blog ni datos del CRM.
- Estados vacíos claros («todavía no hay campañas», «no hay borradores pendientes»), loading y error.
- Mobile-first y accesibilidad: navegación por teclado, foco visible, contraste, labels, `aria-current`, mensajes de error asociados a campos.
- Acciones destructivas o sensibles (aprobar, enviar, suprimir, borrar) con confirmación explícita y texto de consecuencia.
- El botón de enviar no se habilita si falta aprobación, hay supresión, no hay email, se alcanzó el cupo o el contenido cambió.
- No hay auto-refresh que dispare envíos; el refresco de estados es solo lectura.

---

## 11. Integraciones

| Integración | Uso | Requisitos |
|-------------|-----|------------|
| **Clerk** | Autenticación y rol `admin`. | Revalidar en servidor; no confiar en el cliente; asistente denegada. |
| **Prisma / PostgreSQL** | Modelos nuevos del portal. | Cambios aditivos; `db push`; sin tocar modelos existentes; sin backfill. |
| **Google Places API** | Descubrimiento de negocios. | API oficial; field masks; `place_id`; cuotas; sin scraping; atribución si se muestra contenido. |
| **Webs públicas** | Enriquecimiento y auditoría. | Guard SSRF; robots; timeout/tamaño; solo HTML público; User-Agent identificable. |
| **Auditoría existente** | Scores y hallazgos. | Reutilizar lógica; no endpoint público; cupo propio; resumen, no HTML. |
| **LLM (mejora posterior; no en v1)** | Redacción opcional futura; v1 usa plantillas deterministas. | Adaptador server-only; salida estructurada; sin herramientas; límites; modo degradado. No se elige proveedor ni se agrega dependencia en v1. |
| **Resend** | Envío y message ID. | Dominio verificado; from/reply-to; idempotencia; `List-Unsubscribe`; sin scheduling; errores sanitizados. |
| **Logs / Sentry** | Diagnóstico. | Sin PII, cuerpos, HTML, tokens ni secretos; IDs y códigos. |
| **Railway** | Deploy y envs. | Envs server-only; `db push` antes de habilitar; sin `NEXT_PUBLIC_*` nuevos; documentar rollback. |

### 11.1 Variables de entorno

- Las envs nuevas se definen en el plan y en `.env.example`. Deben ser server-only.
- No se agregan variables `NEXT_PUBLIC_*` para Places, LLM, Resend ni tokens de baja.
- Si falta una env crítica:
  - Sin Places: búsqueda deshabilitada.
  - Sin Resend o sin remitente válido: envío deshabilitado.
  - Sin LLM (mejora posterior): la redacción por LLM se deshabilita; la plantilla determinista sigue funcionando.
  - Sin secreto de supresión: la supresión por hash no se habilita hasta configurarlo.
- Los valores reales no se commitean ni se muestran en la UI.

### 11.2 Despliegue y esquema

- Los modelos nuevos se crean con `prisma db push` (o el CLI local). No hay migración de datos existentes ni backfill.
- El orden recomendado: aplicar esquema → desplegar código → verificar salud → habilitar envíos tras el checklist legal.
- Si el esquema no está aplicado, el portal debe fallar cerrado y mostrar un error operativo, no crear datos a medias.
- No se toca `Dockerfile` salvo que el plan agregue una env de build; no se prevé ninguna `NEXT_PUBLIC_*`.
- Rollback: deshabilitar envío/portal, conservar tablas y datos; no borrar supresiones. Documentar en el plan.

---

## 12. Modelos propios (conceptuales)

> Los nombres y campos exactos se definen en el plan. Lo importante es el aislamiento y las invariantes.

### 12.1 `Prospecto`

- Identidad: `id`, `nombreNegocio`, `sitioWeb`, `dominioNormalizado`, `ciudad`, `rubro`, `placeId` (único cuando existe).
- Contacto: `email` (opcional, único normalizado cuando existe), `telefono` (opcional), `contactoNombre`/`contactoCargo` (solo si son públicos).
- Enriquecimiento: `estado`, `score`, `scoreDetalle` (JSON con motivos), `auditoriaResumen` (JSON), `auditoriaFecha`.
- Procedencia: `fuenteTipo`, `fuenteUrl`, `fechaFuente`, `baseLegal`/`notaLegal` cuando corresponda.
- Gestión: `campanaOrigenId`, `notas`, `creadoEn`, `actualizadoEn`.
- Invariantes:
  - Sin FK a `Cliente`, `Pago`, `Suscripcion`, `EnlacePago`, `Proyecto` o `Hito`.
  - `placeId` único; `email` normalizado único cuando existe.
  - Un contacto principal por prospecto; múltiples contactos quedan fuera de alcance.
  - El prospecto pertenece a una campaña de origen; la reutilización multi-campaña se decide en el plan.
  - No se guarda HTML crudo, datos sensibles ni PII innecesaria.

### 12.2 `CampanaProspeccion` (campaña/búsqueda)

- `id`, `nombre`, `consulta`, `zona`, `rubro`, `filtros` (JSON), `estado`.
- `limiteDiario`/`limiteCorrida` (según plan), `consumo` (JSON: Places, fetches, auditorías, borradores, envíos, costo estimado).
- `creadaPor`, `creadoEn`, `actualizadoEn`, `ultimoError` (sanitizado).
- Invariantes:
  - Estados: `BORRADOR`, `EN_CURSO`, `COMPLETADA`, `PARCIAL`, `CANCELADA`, `FALLIDA`.
  - Una corrida no se duplica por doble clic (idempotencia).
  - No se envía nada desde la campaña; el envío vive en `EnvioPropuesta`.

### 12.3 `PlantillaPropuesta`

- `id`, `nombre`, `idioma`, `asunto`, `cuerpo`, `variablesPermitidas` (JSON), `version`, `activa`.
- `creadaPor`, `creadoEn`, `actualizadoEn`.
- Invariantes:
  - Variables con lista blanca; sin código ejecutable ni HTML arbitrario.
  - El cuerpo se sanitiza; el asunto no admite saltos de línea ni inyección de headers.
  - Cambiar una plantilla no modifica borradores ya aprobados: cada envío guarda su snapshot y versión.
  - La plantilla no contiene datos de clientes ni secretos.

### 12.4 `EnvioPropuesta`

- `id`, `prospectoId`, `campanaId`, `plantillaId`, `plantillaVersion`, `secuencia`.
- `destinatario`, `from`, `replyTo`, `asunto`, `cuerpoHtml`, `cuerpoTexto` (snapshot al aprobar).
- `estado`, `aprobadoPor`, `aprobadoEn`, `enviadoPor`, `enviadoEn`.
- `proveedorMessageId` (único), `idempotencyKey` (único), `error` (sanitizado), `intentos`, `creadoEn`, `actualizadoEn`.
- Invariantes:
  - Sin FK a `Pago` ni a `Cliente`.
  - Un envío por aprobación; secuencia única por prospecto/campaña.
  - `proveedorMessageId` e `idempotencyKey` únicos para evitar duplicados.
  - El snapshot es inmutable; una edición crea otra versión/envío.
  - El estado `ENVIADO` solo existe si Resend devolvió message ID.

### 12.5 `SupresionProspecto`

- `id`, `ambito` (`EMAIL`/`DOMINIO`), `emailHash` (obligatorio para `EMAIL`), `emailEnmascarado` (opcional), `dominioNegocio` (obligatorio para `DOMINIO`, normalizado), `motivo`, `origen`, `creadaPor`, `creadaEn`, `notas`.
- Invariantes:
  - Se guarda hash, no email en claro.
  - `ambito = DOMINIO` solo para dominios de negocio; nunca proveedores públicos.
  - La unicidad se define por ámbito: email hash para `EMAIL` y dominio normalizado para `DOMINIO`.
  - Es global e idempotente: repetir la baja no duplica ni falla.
  - No se elimina al borrar prospecto/campaña.
  - No se elimina automáticamente por retención.

### 12.6 Reglas transversales de esquema

- Modelos y enums nuevos; no se alteran columnas existentes de CRM.
- Índices para búsquedas por estado, fecha, campaña, email hash y `placeId`.
- Fechas en UTC; la UI muestra es-AR.
- Importes/costos en centavos si se persisten; formateo con `formatearMonto` si aplica. En este portal no se mueve dinero.
- No se guardan datos de tarjetas, credenciales de pago ni secretos.
- `db push` y verificación de que no hay relaciones accidentales con `Cliente`/`Pago`.

---

## 13. Estados y errores

### 13.1 Estados

| Entidad | Estados | Transiciones clave |
|---------|---------|--------------------|
| **Prospecto** | `NUEVO`, `SIN_ENRIQUECER`, `ENRIQUECIDO`, `PUNTUADO`, `BORRADOR`, `APROBADO`, `ENVIADO`, `RESPONDIO`, `DESCARTADO`, `SUPRIMIDO` | `NUEVO` → enriquecido/sin enriquecer → puntuado → borrador → aprobado → enviado; opt-out/rebote → suprimido. |
| **Campaña** | `BORRADOR`, `EN_CURSO`, `COMPLETADA`, `PARCIAL`, `CANCELADA`, `FALLIDA` | Doble clic no duplica; fallo parcial conserva resultados; cancelar detiene nuevas llamadas. |
| **Envío** | `BORRADOR`, `APROBADO`, `ENVIANDO`, `ENVIADO`, `FALLIDO`, `REBOTADO`, `QUEJA`, `RESPONDIDO`, `CANCELADO` | Aprobar no envía; enviar revalida; fallo no reintenta; opt-out cancela pendientes. |
| **Supresión** | `ACTIVA` (única) | Alta idempotente; sin baja automática; excepción solo admin con motivo. |

### 13.2 Errores y comportamiento

| Situación | Comportamiento | Reintento |
|-----------|----------------|-----------|
| Sin sesión / rol no admin | Redirect/gate o `403`; sin datos. | No aplica. |
| Asistente | Denegado en página y API; sin datos. | No aplica. |
| Campaña duplicada por doble clic | Se reutiliza la existente; no se crea otra. | No aplica. |
| Google Places sin configurar | Búsqueda deshabilitada con mensaje claro. | Manual, tras configurar. |
| Google `403/429/5xx` o timeout | Campaña `PARCIAL`/`FALLIDA`; se conserva lo obtenido; error sanitizado. | Manual, respetando cupo; sin bucle. |
| Web bloqueada, no HTML, timeout, demasiado grande, robots | Prospecto `SIN_ENRIQUECER` o parcial; motivo visible; no se evade. | Manual. |
| Auditoría falla | Se guarda el fallo; el borrador puede redactarse sin hallazgos, marcado. | Manual. |
| Modo LLM solicitado sin proveedor/falla/timeout | No se crea borrador parcial; se informa; la plantilla sigue disponible; score intacto. | Manual; sin auto-retry. |
| Borrador sin aprobación | No se envía; `409`. | Aprobar primero. |
| Contenido editado tras aprobar | Aprobación invalidada; requiere nueva aprobación. | Editar/aprobar de nuevo. |
| Email suprimido | No se aprueba ni envía; motivo visible sin revelar datos a terceros. | Solo si el admin resuelve la supresión con motivo. |
| Sin email | No se aprueba ni envía; se puede completar manualmente con fuente. | Manual. |
| Cupo diario alcanzado | `429`/bloqueo; no se encola para mañana. | Día siguiente o subir cupo aprobado. |
| Resend error de validación | `FALLIDO`; error sanitizado; no se envía. | Corregir y reintentar manual. |
| Resend `429/5xx` | `FALLIDO`; no auto-retry. | Manual, respetando cupo. |
| Doble clic en enviar | Idempotencia; un solo email. | No aplica. |
| Token de baja inválido/usado | Página genérica; no revela si existía; idempotente. | No aplica. |
| Solicitud ARCO | Exportar/eliminar/anonimizar; conservar supresión; registrar. | Manual. |

---

## 14. Costos y límites

### 14.1 Costos

| Proveedor | Costo variable | Control |
|-----------|----------------|---------|
| **Google Places** | Por request de Text Search/Place Details, según SKU y field mask. | Field mask mínimo; una búsqueda por acción; cupo diario; sin fotos/reseñas; sin reintentos en bucle; consumo registrado. |
| **Webs públicas / auditoría** | Egress, tiempo de CPU y TLS; indirecto. | Máximo de páginas por prospecto; timeout/tamaño; una auditoría por prospecto/campaña; resumen cacheado. |
| **LLM (solo si se habilita en el futuro)** | Tokens de entrada/salida. | Input acotado; output máximo; un borrador por solicitud; sin auto-retry; cupo diario; presupuesto por proveedor. En v1 no se usa. |
| **Resend** | Por email enviado (plan contratado). | Un envío por aprobación; cupo diario; sin lotes automáticos; sin follow-ups automáticos. |
| **Base de datos** | Almacenamiento y operaciones. | Retención; no guardar HTML; snapshots acotados; índices. |
| **Tiempo humano** | Revisión/aprobación. | Cola priorizada por score; aprobación por mensaje; sin volumen masivo. |

### 14.2 Límites y presupuesto

- Cada campaña y el portal tienen cupos diarios configurables para: búsquedas Places, Place Details, páginas web, auditorías, borradores y envíos.
- Los cupos son globales y por campaña; el admin ve consumo y restante antes de ejecutar.
- Hay umbrales de aviso y un tope duro por proveedor/día. Al llegar al tope, la acción se bloquea; no hay sobreconsumo silencioso ni cola automática.
- El costo estimado se registra por campaña/prospecto/proveedor y se muestra en el panel.
- **Cupo inicial aprobado:** 20 envíos/día, aprobación manual y supresión obligatoria. Los demás topes técnicos (Places, fetches, auditorías, borradores) se fijan en `plan.md` como defaults conservadores configurables por entorno; no amplían el cupo de envíos ni habilitan automatismos.
- El portal no se habilita para envíos reales hasta que el dueño confirme el checklist legal y el gate de staging.

### 14.3 Rate limits técnicos propuestos

| Acción | Límite propuesto | Nota |
|--------|------------------|------|
| APIs internas | 30/min por admin | En memoria, best-effort; documentar que no es distribuido. |
| Corridas de búsqueda | 1 concurrente por admin | Sin worker en background; sin doble clic. |
| Places | 1 request a la vez + backoff acotado en `429` | Sin reintentos infinitos. |
| Fetch web | Máx. páginas por prospecto (definir en plan), timeout y tamaño | Solo HTML; sin assets. |
| Auditoría | 1 por prospecto/campaña | Reutiliza timeout existente (~12 s). |
| LLM (futuro, no v1) | 1 borrador por solicitud, timeout y tokens máximos | Sin auto-retry. |
| Envío | 1 por aprobación; cupo diario | Idempotencia; sin scheduling. |
| Baja pública | 10/min por IP y 5/min por token (propuesto) | Respuesta genérica; sin enumeración. |

Los números exactos se validan en el plan; los AC usan «el cupo configurado», no valores hardcodeados.

---

## 15. Requisitos funcionales

### 15.1 Portal, acceso y aislamiento

- **RF-1:** Debe existir un portal `/propuestas` separado del CRM, con layout propio.
- **RF-2:** El portal y sus APIs son solo para rol `admin`; la asistente no accede ni lee datos.
- **RF-3:** El middleware debe proteger `/propuestas` y `/api/propuestas/**`, mantener público `/propuesta` (singular) y habilitar solo la baja pública.
- **RF-4:** Cada página y API debe revalidar el rol en el servidor; el middleware es defensa adicional.
- **RF-5:** Las páginas internas deben ser `noindex` y `no-store`; los errores no deben revelar datos.
- **RF-6:** El portal no debe leer ni escribir `Cliente`, `Pago`, `Suscripcion`, `EnlacePago`, `Proyecto` o `Hito`, ni tener FKs hacia ellos.
- **RF-7:** Todas las llamadas a Places, LLM y Resend deben ser server-only; ninguna clave se expone al cliente.
- **RF-8:** Sin sesión válida o configuración crítica, el portal debe fallar cerrado.

### 15.2 Búsqueda, fuentes y enriquecimiento

- **RF-9:** El admin debe poder crear una campaña/búsqueda con consulta, zona, rubro, filtros, plantilla y cupo.
- **RF-10:** La búsqueda debe usar exclusivamente Google Places API oficial; no se scrapea Google.
- **RF-11:** Se deben usar field masks mínimos y persistir `place_id`; el resto del contenido de Places no se persiste fuera de los términos.
- **RF-12:** La creación/ejecución de una búsqueda debe ser idempotente ante doble clic.
- **RF-13:** El enriquecimiento web debe aplicar guard SSRF, límites de redirección, timeout, tamaño, content-type HTML, robots y User-Agent identificable.
- **RF-14:** Solo se extraen datos profesionales publicados por el negocio; no se adivinan emails ni se recogen datos sensibles.
- **RF-15:** Cada dato relevante debe registrar fuente, URL y fecha.
- **RF-16:** Los fallos parciales deben conservar resultados y marcar el motivo; no se inventan prospectos.
- **RF-17:** Debe haber cupos para Places, fetches, auditorías, borradores y envíos; al alcanzarlos, se corta la acción.
- **RF-18:** El admin debe poder agregar o corregir un prospecto manualmente con fuente y nota; no se importan listas compradas.
- **RF-19:** Se prohíbe scraping de Google Maps, buscadores, redes sociales, data brokers y cualquier evasión de login/CAPTCHA/paywall.
- **RF-20:** No debe existir un crawler en background; toda corrida es iniciada por el admin y acotada.

### 15.3 Deduplicación, datos y supresión

- **RF-21:** Debe existir `Prospecto` con identidad, contacto, enriquecimiento, procedencia y estado.
- **RF-22:** La deduplicación debe usar `place_id` exacto, email normalizado exacto y dominio de negocio como señal; no se fusiona silenciosamente ni se deduplica por proveedor de email público.
- **RF-23:** La supresión se debe verificar al crear/importar, antes de aprobar y antes de enviar.
- **RF-24:** La supresión debe guardar hash del email normalizado, motivo, origen y fecha; opcionalmente dominio de negocio; nunca proveedores públicos.
- **RF-25:** La supresión debe sobrevivir al borrado del prospecto/campaña y bloquear una reimportación.
- **RF-26:** Un opt-out debe cancelar borradores/envíos pendientes y bloquear futuros envíos.
- **RF-27:** Rebotes duros y quejas deben suprimir; si no hay webhook, el admin debe poder registrarlos manualmente.
- **RF-28:** La supresión manual requiere motivo y registra quién/cuándo.
- **RF-29:** El portal es B2B; debe rechazar consumidores, menores y datos sensibles.
- **RF-30:** Debe existir retención configurada y un procedimiento ARCO de exportación/eliminación que conserve la supresión.

### 15.4 Puntuación y borradores

- **RF-31:** La auditoría debe reutilizar la lógica existente, no el endpoint público ni su rate limit.
- **RF-32:** La auditoría se ejecuta solo sobre el sitio del prospecto, con cupo y timeout; se guarda resumen y fecha, no HTML.
- **RF-33:** El score debe ser determinista, 0-100, con desglose y motivos; datos faltantes no se inventan.
- **RF-34:** El borrador debe combinar plantilla, datos verificados y hallazgos auditados; sin métricas, garantías ni claims inventados.
- **RF-35:** El LLM debe ser opcional, server-only, con salida estructurada, límites y sin herramientas/navegación.
- **RF-36:** El contenido web debe tratarse como no confiable y resistir prompt injection; la salida se sanitiza.
- **RF-37:** Las plantillas deben tener variables con lista blanca, escape y prevención de inyección de headers/HTML.
- **RF-38:** El borrador nace como `BORRADOR`; editarlo crea versión nueva e invalida la aprobación anterior.
- **RF-39:** Sin LLM o ante fallo, no se crea borrador parcial; se informa y el score sigue disponible.

### 15.5 Aprobación y envío

- **RF-40:** La cola de revisión debe mostrar destinatario, asunto, cuerpo, fuentes, score, auditoría y versión de plantilla.
- **RF-41:** La aprobación debe ser explícita, del admin, con snapshot exacto y registro de quién/cuándo.
- **RF-42:** El envío debe requerir una segunda confirmación explícita; no se programa.
- **RF-43:** No debe existir envío automático, por lote, por secuencia, follow-up automático ni reintento automático.
- **RF-44:** Antes de enviar se debe revalidar aprobación, supresión, email, cupo y hash del contenido.
- **RF-45:** Cada aprobación produce un solo envío; clave de idempotencia y secuencia única evitan duplicados.
- **RF-46:** Resend debe usar dominio verificado, from/reply-to configurables y SPF/DKIM/DMARC verificados antes de habilitar.
- **RF-47:** El email debe incluir texto y HTML, enlace de baja, identificación, aviso legal; sin tracking pixel ni adjuntos.
- **RF-48:** Se debe registrar message ID, estado, fecha y error sanitizado; sin PII en logs.
- **RF-49:** Un fallo queda `FALLIDO`; el reintento es manual y respeta cupo/supresión.
- **RF-50:** Un follow-up requiere nuevo borrador y nueva aprobación; hay un máximo de mensajes por prospecto.

### 15.6 Cumplimiento y baja

- **RF-51:** Debe existir una página pública de baja por token, sin login y sin exponer datos.
- **RF-52:** Se deben enviar `List-Unsubscribe` y `List-Unsubscribe-Post`; el POST de un clic responde 200/202 y detiene envíos.
- **RF-53:** El email debe incluir el aviso, mecanismo, transcripción legal y etiqueta «publicidad» cuando corresponda.
- **RF-54:** A pedido del titular, se debe informar la fuente de los datos; debe haber capacidad operativa de respuesta.
- **RF-55:** Se prohíben listas compradas, encabezados engañosos, claims falsos y presión desmedida.
- **RF-56:** Opt-out, rebote duro y queja deben quedar registrados y reflejados en la supresión global.

### 15.7 Operación, costos y despliegue

- **RF-57:** Se debe registrar consumo/costo por proveedor, campaña y día; el admin debe verlo.
- **RF-58:** Debe haber umbrales de aviso y tope duro de presupuesto; sin sobreconsumo silencioso.
- **RF-59:** Las APIs internas y la baja pública deben tener rate limit; el limitador en memoria se documenta como best-effort.
- **RF-60:** Timeouts y reintentos deben ser acotados; sin reintentos automáticos de envío ni de LLM; sin bucles.
- **RF-61:** Logs y Sentry deben ser estructurados y redactados; sin email, nombre, teléfono, cuerpo, HTML, tokens ni secretos.
- **RF-62:** El esquema debe ser aditivo, con tablas nuevas, índices/unique y sin cambios a modelos existentes; `db push` sin backfill.
- **RF-63:** Las envs nuevas deben ser server-only, documentadas en `.env.example`; sin `NEXT_PUBLIC_*`.
- **RF-64:** El orden de despliegue debe aplicar el esquema antes de habilitar el portal; si falta, fallar cerrado.
- **RF-65:** Debe existir runbook operativo y checklist legal previo a habilitar envíos.
- **RF-66:** No debe haber regresión en CRM, pagos, PayPal, Mercado Pago, auth ni landing pública.

---

## 16. Requisitos no funcionales

- **RNF-1 (privacidad):** PII mínima, con procedencia, retención y supresión. Sin PII en logs, Sentry, analytics ni URLs. La baja pública no revela datos.
- **RNF-2 (seguridad):** Admin-only con doble validación (middleware + servidor). Guard SSRF, sanitización de HTML, lista blanca de variables, prevención de inyección de headers, tokens opacos, rate limit y secretos server-only.
- **RNF-3 (disponibilidad):** Un fallo de Places, web, LLM o Resend no debe corromper datos ni enviar a medias. El portal debe informar el estado y permitir reintento manual.
- **RNF-4 (rendimiento):** Operaciones acotadas; sin crawlers infinitos ni N+1. Índices para listas y búsquedas. El portal debe seguir usable en mobile.
- **RNF-5 (costos):** Todo consumo externo tiene cupo, presupuesto, alerta y tope duro. Sin sobreconsumo silencioso ni reintentos en bucle.
- **RNF-6 (calidad):** TypeScript estricto; suite, typecheck, lint y build limpios antes de cerrar, sin errores nuevos sobre el baseline.
- **RNF-7 (accesibilidad):** Navegación por teclado, foco visible, contraste, labels, mensajes de error y confirmaciones accesibles.
- **RNF-8 (trazabilidad):** Aprobaciones, envíos, supresiones y ARCO con quién/cuándo/qué; fuentes por dato; errores sanitizados.
- **RNF-9 (mantenibilidad):** Lógica pura separada de Prisma/proveedores; adaptadores mockeables; sin acoplar el portal al CRM.
- **RNF-10 (despliegue):** Esquema aditivo, `db push`, sin backfill; envs server-only; rollback documentado; sin `NEXT_PUBLIC_*` nuevos.

---

## 17. Criterios de aceptación

### 17.1 Acceso y aislamiento

- **AC-1:** Dado un visitante sin sesión, cuando abre `/propuestas` o cualquier subruta interna, entonces no ve datos del portal y recibe el gate de Clerk o un redirect; la respuesta no incluye prospectos, campañas ni borradores.
- **AC-2:** Dado un usuario autenticado con rol `asistente`, cuando abre una página de `/propuestas` o llama a una API interna, entonces se le deniega el acceso (redirect o `403`) sin datos y sin posibilidad de aprobar o enviar.
- **AC-3:** Dado un admin autenticado, cuando abre `/propuestas`, entonces ve el layout propio del portal, sin navegación de CRM y sin datos de `Cliente`/`Pago`.
- **AC-4:** Dado el middleware, cuando se prueba `/propuesta` sin sesión, entonces sigue siendo pública; cuando se prueba `/propuestas` sin sesión, entonces no es pública y no muestra datos.
- **AC-5:** Dadas las páginas internas y las respuestas con datos, cuando se inspeccionan headers y logs, entonces son `noindex`/`no-store` y no contienen email, nombre, teléfono, cuerpo, tokens ni secretos.
- **AC-6:** Dado el portal y su esquema, cuando se revisan dependencias y writes, entonces no hay FK ni escrituras a `Cliente`, `Pago`, `Suscripcion`, `EnlacePago`, `Proyecto` o `Hito`.

### 17.2 Búsqueda y fuentes

- **AC-7:** Dado un admin en `/propuestas/buscar`, cuando crea una campaña con consulta, zona, rubro y cupo, entonces se guarda en `BORRADOR` con creador y límites, y no se envía ningún email.
- **AC-8:** Dada una campaña, cuando se ejecuta la búsqueda, entonces solo se llama a Google Places API oficial, se usa un field mask mínimo, se persiste `place_id` y no se scrapea Google Maps ni la SERP.
- **AC-9:** Dado un resultado con sitio web, cuando se enriquece, entonces se aplican guard SSRF, solo HTTP/HTTPS público, límite de redirecciones, timeout, tamaño, content-type HTML, robots y User-Agent identificable; un host privado o un login se rechazan.
- **AC-10:** Dado un sitio con texto que intenta inyectar instrucciones al LLM, cuando se enriquece y redacta, entonces el texto se trata como dato, no se ejecutan acciones, no se filtran secretos y solo se produce un borrador para revisión.
- **AC-11:** Dada una campaña con más resultados que el cupo configurado, cuando se ejecuta, entonces se detiene en el cupo, muestra el consumo y no realiza llamadas extra.
- **AC-12:** Dado un fallo de Google (credenciales, cuota, `429`, `5xx` o timeout), cuando ocurre, entonces la campaña queda `PARCIAL` o `FALLIDA`, conserva lo ya obtenido, muestra un error comprensible y no inventa prospectos ni reintenta en bucle.
- **AC-13:** Dado un prospecto agregado o corregido a mano, cuando se guarda, entonces exige fuente/nota, no importa listas compradas y registra la procedencia.

### 17.3 Deduplicación, datos y supresión

- **AC-14:** Dado un negocio ya existente por `place_id` o email normalizado, cuando se busca/importa de nuevo, entonces se reutiliza el prospecto y no se duplica; un mismo dominio con distinto `place_id` se marca como posible duplicado y no se fusiona solo; nunca se deduplica por `gmail.com` u otro proveedor público.
- **AC-15:** Dado un email o dominio de negocio suprimido, cuando se crea/importa un prospecto, entonces no queda contactable y no se puede aprobar ni enviar; se muestra el motivo sin revelar datos a terceros.
- **AC-16:** Dado un prospecto con borrador y una baja posterior, cuando se registra el opt-out, entonces se cancelan los pendientes y cualquier intento de aprobar/enviar se bloquea.
- **AC-17:** Dado un prospecto suprimido, cuando se borra el prospecto o la campaña, entonces la supresión sigue activa; un nuevo intento con el mismo email normalizado se bloquea por hash aunque no quede el email en claro.
- **AC-18:** Dado un admin, cuando registra una supresión manual, entonces exige motivo y guarda quién/cuándo; la supresión por dominio de negocio se rechaza para proveedores de email público.

### 17.4 Enriquecimiento, score y borradores

- **AC-19:** Dado un prospecto con web, cuando se busca email, entonces solo se acepta un email profesional publicado por el negocio o cargado manualmente; no se adivina por patrón; sin email queda «sin contacto» y no se puede enviar.
- **AC-20:** Dado un prospecto con sitio, cuando se audita, entonces se reutiliza la lógica existente (SSRF, timeout, scores, findings), se guarda un resumen con fecha y no HTML crudo; no se llama a `/api/audit` ni se consume su rate limit público.
- **AC-21:** Dados los mismos datos de entrada, cuando se calcula el score, entonces es determinista, está entre 0 y 100, incluye desglose y motivos, y los datos faltantes no se inventan.
- **AC-22:** Dado un prospecto puntuado, cuando el agente redacta, entonces usa plantilla, datos verificados y hallazgos auditados; no inventa métricas ni garantías; el resultado queda en `BORRADOR` y no se envía.
- **AC-23:** Dado que el LLM no está configurado o falla, cuando se intenta redactar, entonces no se crea un borrador parcial, se muestra un error claro y el score/ficha siguen disponibles.
- **AC-24:** Dado un borrador aprobado, cuando el admin lo edita, entonces se crea una versión nueva y la aprobación anterior queda invalidada; no se puede enviar hasta aprobar de nuevo.

### 17.5 Aprobación y envío

- **AC-25:** Dado un borrador listo, cuando el admin lo aprueba, entonces se registra quién/cuándo y un snapshot exacto de destinatario, from, reply-to, asunto, HTML y texto; no se llama a Resend.
- **AC-26:** Dado un envío aprobado, cuando el admin confirma el envío, entonces se hace una sola llamada a Resend con `Idempotency-Key`; un doble clic o reintento no genera un segundo email.
- **AC-27:** Dado un envío sin aprobación, suprimido, sin email, sobre cupo o con contenido distinto al aprobado, cuando se intenta enviar, entonces se rechaza con error y no se llama a Resend.
- **AC-28:** Dado un error de Resend, cuando responde, entonces el envío queda `FALLIDO` con error sanitizado, sin reintento automático y sin cambiar la aprobación.
- **AC-29:** Dado un envío exitoso, cuando se registra, entonces queda `ENVIADO` con message ID, fecha y snapshots; no se duplica y no se guarda PII en logs.
- **AC-30:** Dado un envío aprobado, cuando nadie confirma el envío, entonces no se envía nada; no hay scheduler, cola de envío, `scheduledAt`, secuencia ni follow-up automático.
- **AC-31:** Dado un prospecto ya contactado, cuando se quiere un follow-up, entonces se requiere un borrador nuevo, una aprobación nueva y se respeta el máximo de mensajes; el cupo diario bloquea sin encolar.

### 17.6 Cumplimiento, baja y supresión

- **AC-32:** Dado un email generado, cuando se inspecciona, entonces identifica a PixelArch, tiene asunto veraz, incluye enlace de baja, aviso, mecanismo y la transcripción legal aprobada; cuando es publicidad directa no solicitada, incluye la etiqueta «publicidad» según la interpretación legal aprobada.
- **AC-33:** Dado el enlace de baja, cuando el destinatario lo abre sin sesión, entonces puede confirmar la baja en un clic; la página no requiere login, no revela si el email existía, usa token opaco y es idempotente.
- **AC-34:** Dado un email enviado, cuando se inspeccionan sus headers, entonces incluye `List-Unsubscribe` y `List-Unsubscribe-Post` además del enlace visible; el POST de un clic responde 200/202 y no requiere sesión.
- **AC-35:** Dado un opt-out confirmado, cuando se revisan los pendientes y el próximo envío, entonces no se envía nada más a ese email, la supresión es global y el bloqueo es inmediato.
- **AC-36:** Dado un rebote duro o una queja registrada (por webhook o manual), cuando se procesa, entonces el email queda suprimido, no se reintenta y se conserva la trazabilidad.
- **AC-37:** Dado un pedido ARCO, cuando el admin lo atiende, entonces puede exportar los datos del prospecto y eliminar/anonimizar; la supresión por hash se conserva y la acción queda registrada.

### 17.7 Costos, datos y operación

- **AC-38:** Dado un consumo de Places, fetch, auditoría, LLM o Resend, cuando se ejecuta, entonces se registra por campaña/prospecto/proveedor y el admin ve el consumo y el restante.
- **AC-39:** Dado un umbral de presupuesto configurado, cuando se alcanza el aviso o el tope duro, entonces se alerta y/o se bloquea la acción; no hay sobreconsumo silencioso ni cola automática.
- **AC-40:** Dada la retención configurada, cuando vence, entonces el prospecto se elimina o anonimiza, los borradores/snapshots se eliminan y la supresión se conserva; no hay retención indefinida.
- **AC-41:** Dados los logs, Sentry y errores de proveedores, cuando se inspeccionan, entonces no contienen email completo, nombre, teléfono, cuerpo, HTML de la web, token de baja ni secretos; solo IDs, estados, códigos y métricas.
- **AC-42:** Dado que falta Places, Resend o LLM, cuando se usa la parte afectada, entonces se deshabilita con mensaje claro y falla cerrado; no se envía un email a medias ni se crea un borrador parcial.
- **AC-43:** Dado el esquema, cuando se aplica `db push`, entonces solo se crean tablas, enums e índices nuevos, no se alteran datos existentes, no hay backfill y no hay FKs a `Cliente`/`Pago`.
- **AC-44:** Dados los criterios AC-1 a AC-43, cuando se ejecuta la suite, entonces cada uno tiene al menos un test automatizado (unitario, ruta o middleware) y no se hacen llamadas reales a Google, LLM ni Resend.
- **AC-45:** Dada la suite existente, cuando se ejecuta completa, entonces CRM, clientes, cobros, pagos, PayPal, Mercado Pago, auth y landing siguen verdes; no hay errores nuevos de typecheck/lint/build sobre el baseline.

---

## 18. Tests esperados

La estrategia detallada se define en el plan; esta sección fija el mínimo.

| Área | Tipo | Casos clave | AC |
|------|------|-------------|----|
| **Acceso y middleware** | middleware con Clerk mockeado + páginas/API | anónimo, asistente, admin; `/propuesta` público vs `/propuestas` protegido; baja pública; `noindex`/`no-store`; sin PII en errores | AC-1 a AC-5 |
| **Aislamiento de esquema** | inspección de `schema.prisma` + tests de repositorio | sin FK a CRM; sin writes a `Cliente`/`Pago`; modelos nuevos | AC-6, AC-43 |
| **Campaña y Places** | unitaria + ruta con Places mockeado | crear campaña; field mask; `place_id`; doble clic; `429/5xx`; cupo; sin scraping | AC-7, AC-8, AC-11, AC-12 |
| **Fetch público / SSRF** | unitaria pura + ruta con fetch mockeado | host privado, loopback, `.local`, puerto, redirect, timeout, tamaño, no HTML, robots, User-Agent | AC-9 |
| **Prompt injection** | unitaria de sanitización + modo LLM no configurado | texto hostil no ejecuta acciones; salida sanitizada; sin secretos | AC-10 |
| **Carga manual / procedencia** | ruta admin | fuente obligatoria; corrección; lista comprada rechazada | AC-13 |
| **Deduplicación** | unitaria pura | `place_id`, email exacto, dominio; sucursales; proveedor público; no fusión automática | AC-14 |
| **Supresión** | unitaria pura + ruta | hash; email/dominio; proveedor público rechazado; borrado de prospecto; reimportación; manual con motivo | AC-15 a AC-18 |
| **Enriquecimiento / auditoría** | unitaria + ruta con fetch/TLS mockeados | email solo publicado; auditoría interna; resumen; sin HTML; sin `/api/audit` | AC-19, AC-20 |
| **Score** | unitaria pura | determinismo, rango, desglose, datos faltantes, mismos inputs | AC-21 |
| **Borrador** | unitaria + ruta con modo LLM no configurado | grounding; sin claims; estado BORRADOR; edición invalida aprobación; fallo sin LLM | AC-22 a AC-24 |
| **Aprobación** | ruta admin | snapshot; aprobador; no envía; sin aprobación no hay envío; contenido cambiado se rechaza | AC-25, AC-27 |
| **Envío** | ruta con Resend mockeado | idempotencia; doble clic; error; éxito; message ID; sin scheduler; cupo; sin auto-retry | AC-26, AC-28 a AC-31 |
| **Cumplimiento** | unitaria de render + ruta de baja + headers | aviso/transcripción; «publicidad»; `List-Unsubscribe`; baja one-click; opt-out global; rebote/queja | AC-32 a AC-36 |
| **ARCO** | ruta admin | exportar; eliminar/anonimizar; conservar supresión; registro | AC-37 |
| **Costos / retención** | unitaria + ruta | contadores; umbral/tope; retención; supresión conservada | AC-38 a AC-40 |
| **Privacidad** | spies de logger/Sentry + ruta | sin PII/cuerpos/HTML/tokens/secretos; errores sanitizados | AC-41 |
| **Configuración** | ruta con envs faltantes | Places/Resend/LLM deshabilitados; fallo cerrado; sin envío parcial | AC-42 |
| **Regresión** | suite existente | CRM, pagos, PayPal, MP, auth, landing | AC-45 |
| **Meta** | matriz de trazabilidad | AC-1 a AC-44 con al menos un test; suite sin red | AC-44 |

Además:

- Los tests de Places/Resend y del modo LLM no configurado usan mocks; no hay llamadas reales ni gasto en la suite.
- Los tests de supresión deben usar emails ficticios y verificar que no queda email en claro.
- Los tests de middleware deben cubrir la colisión `/propuesta` vs `/propuestas`; si el matcher se factoriza, probar la función pura además de la integración.
- Los tests de envío deben verificar que `Idempotency-Key` y la secuencia única impiden duplicados.
- Los tests de prompt injection deben incluir un fixture con instrucciones maliciosas y comprobar que no se ejecutan acciones ni se filtran secretos.
- La verificación manual (fuera de la suite) incluye una prueba con una cuenta propia de Resend, una búsqueda acotada de Places y la revisión legal de los textos.

---

## 19. Decisiones propuestas

Estas decisiones quedaron confirmadas con la aprobación de la spec (2026-11-10). Las decisiones cerradas de §20 mandan sobre cualquier default anterior.

| ID | Decisión propuesta | Alternativas descartadas | Impacto |
|----|--------------------|--------------------------|---------|
| **D-1** | Portal en `/propuestas`, con route group y layout propios, fuera del layout de `/admin`. | Colgarlo de `/admin/propuestas` (se mezcla con CRM); reutilizar el layout admin (arrastra navegación y datos). | AC-1, AC-3 |
| **D-2** | Solo `admin`; la asistente no tiene acceso ni lectura. | Asistente con lectura o aprobación (no pedido y amplía riesgo). | AC-2 |
| **D-3** | Aprobar y enviar son dos acciones separadas, ambas explícitas y registradas. | Un solo botón «aprobar y enviar» (más riesgo de error); envío automático al aprobar (prohibido). | AC-25, AC-26, AC-30 |
| **D-4** | Sin píxeles de tracking, adjuntos ni analytics de marketing en el MVP. | Tracking de aperturas/clics (más PII y complejidad). | AC-32, AC-41 |
| **D-5** | Persistir solo `place_id` de Google Places; datos canónicos desde la web del negocio o carga manual. | Guardar nombre/dirección/teléfono/rating de Places (choca con sus términos). | AC-8, AC-43 |
| **D-6** | Supresión por hash determinista del email normalizado; dominio opcional solo para dominios de negocio. | Guardar email en claro (más PII); suprimir por dominio de proveedor público (bloqueo masivo incorrecto). | AC-15, AC-17, AC-18 |
| **D-7** | Sin reintentos automáticos de envío ni de LLM; sin follow-up automático. | Reintentos/retries automáticos (pueden duplicar o enviar sin control). | AC-28, AC-30, AC-31 |
| **D-8** | Sin envío por lote; una aprobación = un email. | Batch de aprobados (más riesgo de error y de duplicados). | AC-26, AC-31 |
| **D-9** | Baja pública en `/propuestas/baja/[token]`, con precedencia sobre la protección admin. | Baja dentro de `/admin` (requiere login); ruta separada sin relación con el portal (más fricción). | AC-33, AC-34 |
| **D-10** | Reutilizar la lógica de auditoría existente como helper interno, no el endpoint público. | Llamar a `/api/audit` (consume 8/h y mezcla tráfico). | AC-20 |
| **D-11** | Score determinista y explicable; el LLM solo redacta, no puntúa. | Score por LLM (no reproducible, difícil de testear). | AC-21, AC-22 |
| **D-12** | Si falta configuración crítica, deshabilitar la parte afectada y fallar cerrado. | Valores por defecto silenciosos (riesgo de envío/costo no controlado). | AC-42 |

---

## 20. Decisiones cerradas (2026-11-10)

El dueño aprobó la spec y cerró las preguntas con estos defaults. Las decisiones son vinculantes para `plan.md` y `tasks.md`.

| ID | Pregunta | Decisión aprobada | Impacto |
|----|----------|-------------------|---------|
| **Q-1** | LLM | **v1 sin LLM:** plantillas deterministas + auditoría existente. El LLM queda como mejora posterior, con adaptador reservado y su propia spec si se adopta. | AC-22, AC-23; sin dependencia ni costo de LLM en v1. |
| **Q-2** | Remitente | `from` = `propuestas@pixelarch.dev` (PixelArch); `reply-to` = `hola@pixelarch.dev`. Resend con SPF/DKIM/DMARC verificados antes de habilitar. | AC-25, AC-32, AC-34. |
| **Q-3** | Email público | Solo el email profesional **publicado en el sitio del negocio** o cargado manualmente con fuente. Sin email público no se envía; no se adivinan patrones, no se usan directorios, formularios, verificadores externos ni listas compradas. | AC-19; AC-29/30. |
| **Q-4** | Cupos | **20 envíos/día iniciales**, aprobación manual y supresión obligatoria. Topes técnicos de Places/fetches/auditorías/borradores: defaults conservadores en `plan.md`, configurables por entorno. Sin envío por lote ni cola. | AC-11, AC-26, AC-31, AC-38, AC-39. |
| **Q-5** | Retención | Prospectos **12 meses**; supresión **permanente**; logs **30 días**. La purga elimina prospecto, borradores, snapshots y envíos; conserva la supresión. | AC-17, AC-37, AC-40. |
| **Q-6** | Rol asistente | **Cero acceso.** `/propuestas` y sus APIs son solo `admin`; la asistente recibe redirect/403 sin datos. | AC-2. |
| **Q-7** | Conversión a Cliente | **Fuera de esta spec.** Sin FK, sin lectura/escritura de `Cliente` y sin botón de conversión. Si se quiere, será una acción explícita en otra spec. | AC-6, AC-43. |
| **Q-8** | Cumplimiento B2B | Contacto profesional B2B, opt-out visible y one-click, `List-Unsubscribe`/`List-Unsubscribe-Post`, supresión global por email/hash (dominio solo para dominios de negocio), sin listas compradas ni datos sensibles. | AC-15 a AC-18, AC-32 a AC-36. |
| **Q-9** | Rebotes/quejas | **v1: registro manual** de rebote duro, queja y respuesta por el admin. Webhooks de Resend quedan como mejora posterior; si se agregan, requieren firma e idempotencia. Una queja suprime el email; el dominio de negocio solo se suprime por acción manual. | AC-27, AC-36. |
| **Q-10** | Follow-up | **Máximo 2 mensajes por prospecto** (inicial + un follow-up manual), sin automatismo. Cada uno exige borrador nuevo y aprobación nueva. El límite es configurable y se valida en el servidor. | AC-31. |
| **Q-11** | Canal ARCO | `hola@pixelarch.dev` como canal de acceso/rectificación/supresión; el admin atiende y registra. El email incluye el canal. | AC-32, AC-37. |
| **Q-12** | Google Places | Solo se persiste `place_id`; el resto del contenido de Places es transitorio y no se guarda. Clave server-only separada para prospección (`PROPUESTAS_PLACES_API_KEY`), con cupo y facturación propios; no se asume reutilizar la clave de reseñas. | AC-8, AC-43. |
| **Q-13** | Baja pública | `/propuestas/baja/[token]` público, token opaco sin PII, `noindex`/`no-store`, rate limit; el POST one-click vive en `/api/opt-out`. | AC-33, AC-34. |

### 20.1 Validaciones previas a habilitar envíos (no bloquean el plan)

- **Texto legal exacto:** la transcripción de la Ley 25.326 art. 27 inc. 3 y del Decreto 1558/01, la ubicación del término «publicidad» y el aviso de privacidad deben ser aprobados por el abogado. Hasta entonces, `PROPUESTAS_ENVIO_HABILITADO` queda en `false`; el portal funciona en seco (búsqueda, enriquecimiento, score, borradores, aprobación simulada).
- **AAIP / transferencia internacional:** si corresponde inscribir o actualizar la base, se resuelve antes del primer envío real. Google, Resend y cualquier futuro LLM procesan datos fuera de Argentina; el runbook debe documentarlo.
- **SPF/DKIM/DMARC:** se verifican en Resend y DNS antes del primer envío; el código falla cerrado si el remitente, reply-to o la URL pública no son válidos.
- **Retención de logs:** los 30 días dependen de la retención configurada en Railway; el runbook verifica el valor y deja la evidencia durable en la base (campañas, prospectos, envíos y supresiones), no en logs.

---

## 21. Cierre de esta spec

- Esta spec define **qué** y **por qué**; no incluye plan técnico, tareas ni código. No se creó ningún archivo fuera de `specs/004-propuestas/`.
- El portal `/propuestas` queda como una feature separada del CRM, admin-only, con modelos propios y sin tocar `Cliente`/`Pago`.
- La spec está **aprobada**. El plan técnico y las tareas están en `./plan.md` y `./tasks.md` (arquitectura, esquema Prisma exacto, contratos de API, estrategia de tests, runbook y orden de despliegue).
- La implementación de código puede comenzar; el **envío real** queda detrás del gate de staging y del checklist legal de §20.1. Sin esos requisitos, el portal se despliega con `PROPUESTAS_ENVIO_HABILITADO=false`.
- Si el dueño decide no avanzar con la implementación, la spec queda aprobada como referencia y no se modifica el CRM ni el sitio público.
