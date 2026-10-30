# Spec 003: Hardening posterior a T-37/002 (H-5, H-6, H-7, H-8, H-9)

**Estado:** borrador — H-6 bloqueado por datos del panel de Mercado Pago; H-5/H-7/H-8/H-9 listos para aprobacion con los defaults propuestos.
**Fecha:** 2026-10-29
**Rama de implementacion:** `paypal-staging`.
**Relacionada con:** `specs/001-paypal-pagos/spec.md`, `specs/001-paypal-pagos/review.md` §4 (H-5..H-9), `specs/002-recibo-mp/spec.md` y `specs/constitution.md` §1 a §7.
**Gate:** T-38 sigue **despues** de este trabajo y **no esta autorizado**. No hay merge a `main` ni deploy a produccion antes de T-38.

## 1. Contexto y objetivo

### 1.1 Situacion actual

- T-37 quedo `PASS` con observaciones (staging, commit `139b8cb`, deploy `4c765526`). Produccion sigue en `cdafe04`, sin PayPal, sin el esquema PayPal y sin el recibo de Mercado Pago. T-38 (migracion/backfill + rollout) no fue autorizado.
- El recibo interno de Mercado Pago (002) esta implementado en `paypal-staging`, sin cambios de esquema ni envs, y espera el mismo gate T-38.
- El backlog acordado en `review.md` §7 incluye cinco hallazgos no bloqueantes: H-5 (estado publico en revision), H-6 (firmas de Mercado Pago), H-7 (hardening del webhook PayPal), H-8 (fallback de `NEXT_PUBLIC_URL`) y H-9 (`.railway/` en `.gitignore`).

Detalle de cada hallazgo:

- **H-5:** cuando una captura PayPal queda en `REVISION` (diferencia de monto o moneda), el link se marca `PAGADO` y el pago queda pendiente de revision. La pagina publica `/pago/paypal/estado` deriva "Pago acreditado" solo del estado del link, de modo que el comprador ve un cobro acreditado cuando en realidad esta en revision. El retorno ya informa `pendiente`, pero la pagina lo ignora cuando el link figura `PAGADO`.
- **H-7:** `POST /api/webhooks/paypal` es publico y no tiene limite de solicitudes. Cada intento con headers y cuerpo parseables dispara una verificacion server-to-server contra PayPal; los rechazos por headers, cuerpo, evento o firma escriben un `EventoPasarela` tecnico. Un tercero puede generar carga, ruido y filas sin autenticarse. A la vez, PayPal necesita reintentar sin bloqueos permanentes.
- **H-8:** `resolverBaseUrlPublica` ya rechaza una `NEXT_PUBLIC_URL` invalida y no cae al origin de la request. Sin embargo, los ayudantes de redireccion de `/pago/paypal/[token]`, `/pago/paypal/retorno` y `/pago/paypal/cancelado` hacen `?? req.url`; detras del proxy de Railway ese origin puede ser `http://0.0.0.0:8080`, inaccesible para el comprador. El link manual del admin ya falla cerrado.
- **H-9:** `.railway/` no esta en `.gitignore`. Es estado local de la CLI de Railway y no debe versionarse; ademas, la evidencia de T-37 se apoyo en scripts que ya no estan en el repo.
- **H-6:** en staging aparecieron warnings `Webhook MP con firma invalida` durante el paso 11 de T-37 y una IPN vacia. No hay origen identificado ni evidencia suficiente. No se debe cambiar codigo, secreto ni panel hasta confirmar la causa.

### 1.2 Problema

Cinco bordes de calidad y operacion quedaron abiertos despues de validar PayPal:

1. El comprador recibe una afirmacion incorrecta sobre el estado de su pago (H-5).
2. El webhook publico de PayPal es facil de inundar y de usar para amplificar llamadas y escrituras (H-7).
3. Una configuracion invalida puede mandar al comprador a un host interno (H-8).
4. El repo puede incorporar estado local de Railway por accidente (H-9).
5. Los warnings de firma de Mercado Pago siguen sin explicacion y no se sabe si son configuracion, panel o codigo (H-6).

### 1.3 Objetivo

Cerrar H-5, H-7, H-8 y H-9 con cambios acotados, tests automatizados y sin tocar produccion, esquema ni envs; y producir para H-6 un expediente de evidencias que permita decidir con datos si el problema es de configuracion, de panel o de codigo, sin implementar una solucion antes de confirmar la causa.

### 1.4 Resultado esperado

- Un pago PayPal en `REVISION` nunca se muestra al comprador como "Pago acreditado"; se muestra "Pago en revision", sin PII ni estados internos, tanto al abrir el link como al volver del checkout.
- El webhook PayPal resiste rafagas de intentos no verificados con limites acotados, sin bloquear de forma permanente los reintentos legitimos ni cambiar la semantica de los eventos verificados.
- Una `NEXT_PUBLIC_URL` definida pero invalida no produce redirecciones a `0.0.0.0` ni a hosts internos; las redirecciones usan una ruta relativa segura y las URLs absolutas que se envian a PayPal fallan cerrado.
- `.railway/` queda ignorado por git, sin cambios de producto.
- H-6 queda documentado con evidencia redactada, hipotesis descartadas o confirmadas y una decision explicita; si hace falta un cambio de codigo, se abre una spec nueva.
- La suite, el typecheck, el lint y el build quedan limpios; PayPal y Mercado Pago no sufren regresiones.

### 1.5 Decisiones fijas (constitucion)

- No se recogen datos nuevos del pagador ni del comprador. No se muestran ni registran PII en la pagina publica, en logs, en Sentry ni en el expediente de H-6.
- No se almacenan datos de tarjeta ni secretos en el repositorio. Los secretos viven en Railway o `.env.local`.
- Mercado Pago sigue siendo la pasarela principal en ARS; PayPal se usa para USD. No se cambia ningun flujo de cobro, monto, comision, estado ni idempotencia.
- Los montos siguen en centavos y se formatean con `formatearMonto`; esta spec no cambia montos ni conversiones.
- Todo cambio de esquema Prisma se sincroniza con `db push` y se documenta en el plan. **Esta spec no requiere cambios de esquema.**
- Cada criterio de aceptacion funcional tiene al menos un test automatizado. La excepcion justificada es H-6: es una investigacion sin cambio de codigo y se verifica con un checklist documental y evidencia del panel.
- TypeScript estricto; lint, typecheck y build limpios antes de cerrar cada tarea, sin errores nuevos sobre el baseline conocido.
- No hay comandos interactivos ni watch en la verificacion.

### 1.6 Supuestos y dependencias

- El trabajo se hace en `paypal-staging`, que ya tiene el esquema PayPal aplicado y los datos de staging. Produccion no se toca.
- H-5 lee la relacion `EnlacePago.pagos` y el estado `Pago.estadoPago`, que existen en el esquema validado en staging. No agrega columnas ni backfill; viaja con T-38.
- H-7 y H-8 son cambios de codigo en rutas publicas y no dependen de datos nuevos. H-9 es higiene de repositorio.
- H-6 depende de datos que solo el dueno puede obtener del panel de Mercado Pago (cuenta/aplicacion, URL de webhook por entorno, secreto, eventos, muestras redactadas). Sin esos datos, H-6 queda abierto; no se inventa la causa.
- No se agregan dependencias ni librerias. El limitador es en memoria, best-effort, igual que el resto del proyecto; no hay Redis ni storage nuevo.
- La suite no hace llamadas reales a PayPal ni a Mercado Pago. El sandbox/staging se valida a mano cuando corresponda.

## 2. Alcance

### 2.1 Incluido

| Item | Incluido |
|------|----------|
| **H-5** | Estado publico "Pago en revision" cuando el link tiene un pago asociado en `REVISION`; cobertura del link `PAGADO` y del retorno; precedencia de `?estado=error`; sin PII ni estados internos. |
| **H-7** | Limite por origen de solicitudes, presupuesto de fallos de verificacion, rechazo de cuerpos excesivos, orden de rechazos baratos y tests; sin cambios en la semantica de eventos verificados. |
| **H-8** | Redireccion relativa segura cuando no hay base publica valida; fallo cerrado en la creacion de ordenes que necesitan URL absoluta; tests de `resolverBaseUrlPublica` y de las rutas. |
| **H-9** | `.railway/` en `.gitignore` y verificacion de que no haya archivos versionados de ese directorio. |
| **H-6** | Investigacion documental y operativa: recoleccion de evidencia, matriz de entornos, hipotesis y decision. Sin codigo. |
| **Transversal** | Tests, typecheck, lint y build; compatibilidad PayPal/MP; documentacion de cierre. |

### 2.2 Fuera de alcance

- Cambios de esquema Prisma, migraciones, `db push` o backfill. Esta spec no agrega columnas.
- Cambios de variables de entorno, `Dockerfile`, `package.json`, `railway.toml` o `next.config`.
- Merge a `main`, deploy a produccion, ejecucion de T-38 o cualquier cambio en el panel de PayPal/Mercado Pago.
- Implementar una correccion para H-6 (codigo, secreto o panel). Solo se investiga y se decide.
- Cambiar la verificacion de firma de PayPal, la idempotencia, el procesamiento de capturas, los montos, el gross-up o los links.
- Cambiar el webhook de Mercado Pago, su firma o su idempotencia.
- Rediseñar `/pago/paypal/estado`, cambiar el concepto o el monto que hoy muestra, o agregar detalle de la revision (diferencias, notas, acciones).
- Mostrar al comprador datos del CRM, del pagador, de la revision o enlaces al admin.
- Un portal de clientes, notificaciones nuevas, emails nuevos o cambios al recibo.
- Cambiar sitemap, robots, RSS, cron de uptime, digest o `mercadopago.ts` por H-8; solo se documenta el riesgo si usan `NEXT_PUBLIC_URL` con otro patron.
- Rate limit distribuido, Redis, WAF, allowlist de IPs de PayPal o bloqueo permanente.
- Tests E2E contra PayPal/MP reales en la suite.

## 3. Actores y permisos

| Actor | Puede | No puede |
|-------|-------|----------|
| **Comprador / publico** | Abrir el link publico y ver el estado real del pago (pendiente, en revision, pagado, vencido, invalido o error), sin PII. | Ver datos del CRM, notas de revision, diferencias de monto, estados internos, ids internos ni acciones de admin. |
| **Admin / asistente** | Operar el CRM como hoy; no gana permisos nuevos con esta spec. | Ver en la pagina publica datos internos o resolver revisiones desde el link publico. |
| **PayPal** | Entregar webhooks firmados y reintentar ante 5xx/429. | Saltar la verificacion de firma o la idempotencia. |
| **Tercero no autenticado** | Nada. Sus intentos quedan limitados y no crean pagos ni cambios de estado. | Inundar el webhook sin tope, forzar escrituras ilimitadas o bloquear a PayPal de forma permanente. |
| **Mercado Pago** | Entregar notificaciones a su webhook como hoy. | Verse afectado por los cambios de H-5, H-7, H-8 o H-9. |
| **Dueno / responsable del panel MP** | Aportar la configuracion y muestras redactadas para H-6; decidir acciones de panel. | Delegar en el agente una conclusion sin evidencia. |
| **Mantenimiento del repo** | Ignorar `.railway/` y verificar que no se versione. | Cambiar codigo de producto para H-9. |

## 4. Historias de usuario

- **HU-H5:** Como comprador, quiero ver que mi pago esta en revision cuando todavia no esta acreditado, para no creer que ya se cobro y no volver a pagar.
- **HU-H7:** Como responsable del sitio, quiero que el webhook de PayPal resista intentos no verificados sin bloquear de forma permanente los eventos legitimos ni sus reintentos, para no perder cobros ni permitir abuso.
- **HU-H8:** Como comprador, quiero que el retorno del checkout me lleve a una pagina publica valida aunque la configuracion de URL este mal, para no terminar en un host interno.
- **HU-H9:** Como responsable del repo, quiero que el estado local de Railway quede fuera de git, para no versionar configuracion local por accidente.
- **HU-H6:** Como dueno, quiero saber por que Mercado Pago reporta firmas invalidas o IPN vacias en staging, para decidir si es configuracion, panel o codigo con evidencia y sin adivinar.

## 5. Requisitos funcionales

### 5.1 H-5 — Estado publico en revision

- **RF-H5-1:** La pagina `/pago/paypal/estado` debe mostrar "Pago en revision" cuando el link PayPal tenga un pago asociado en estado `REVISION`. Nunca debe mostrar "Pago acreditado" en ese caso.
- **RF-H5-2:** El estado debe surgir del link y de su pago asociado, no solo del query string. Un `?estado=pagado` no puede convertir en acreditado un pago en revision; `?estado=error` conserva la prioridad actual para no ocultar un fallo informado por el retorno.
- **RF-H5-3:** El retorno `/pago/paypal/retorno` debe seguir informando `pendiente` cuando la captura queda en `REVISION`, y la pagina debe mostrar el mismo estado "Pago en revision" al abrirse inmediatamente despues.
- **RF-H5-4:** Si la revision se resuelve y el pago deja de estar en `REVISION`, la proxima apertura de la pagina debe reflejar el estado resultante (por ejemplo, "Pago acreditado" si quedo confirmado), sin cache.
- **RF-H5-5:** La pagina no debe mostrar nombre, email, telefono, direccion ni ningun dato del pagador o del cliente del CRM; tampoco debe mostrar `REVISION`, `revisionNota`, `revisionEstado`, ids internos, importes de la diferencia ni enlaces al admin.
- **RF-H5-6:** Un link `PAGADO` sin pago asociado (dato historico) conserva el comportamiento actual "Pago acreditado". Los estados pendiente, vencido, invalidado y error no cambian.
- **RF-H5-7:** La pagina sigue siendo publica, `no-store`, `no-referrer` y `noindex`; el token sigue siendo opaco y no se registra en logs.
- **RF-H5-8:** La consulta debe ser minima y de solo lectura: estado del link, concepto, monto/moneda, vencimiento, relaciones de concepto y existencia de un pago en revision. No debe traer notas, PII ni datos de revision.

### 5.2 H-7 — Hardening del webhook PayPal

- **RF-H7-1:** El webhook debe aplicar un limite de solicitudes por origen antes del trabajo costoso. Superado el limite, debe responder `429` con `Retry-After` y `Cache-Control: no-store`, sin verificar firma, sin escribir `EventoPasarela` y sin tocar pagos.
- **RF-H7-2:** El webhook debe llevar un presupuesto de fallos de verificacion por origen. Superado el umbral en la ventana, debe responder `429` antes de llamar a PayPal. Solo cuentan los fallos de autenticidad (headers, cuerpo, evento o firma invalida); no cuentan el `503` por verificacion no disponible ni el `500` de procesamiento.
- **RF-H7-3:** Una verificacion exitosa debe limpiar el presupuesto de fallos de ese origen. Un evento verificado de otro origen no debe verse afectado por los fallos de un tercero.
- **RF-H7-4:** El `429` debe ser temporal y reintentable; no debe existir un bloqueo permanente. La idempotencia y la semantica de los eventos verificados no cambian: `200` para procesado, duplicado o ignorado; `500` para reintento.
- **RF-H7-5:** El webhook debe rechazar cuerpos que superen un maximo documentado con `413`, antes de parsear y verificar, sin escribir eventos. El limite debe ser lo bastante amplio para los payloads reales de PayPal.
- **RF-H7-6:** Los rechazos baratos deben ocurrir antes de la verificacion server-to-server cuando sea posible. Los headers faltantes, el cuerpo invalido y el evento invalido consumen el presupuesto de fallos; el cuerpo excesivo (`413`) no lo consume y queda acotado por el limite de solicitudes.
- **RF-H7-7:** Los logs, eventos y respuestas de limite no deben contener payload crudo, PII, firma, certificado, secretos ni la IP completa. El `429` debe ser generico.
- **RF-H7-8:** Sin configuracion de PayPal se conserva el `503` actual. Sin headers o con firma invalida se conserva el `401` mientras no se alcance el limite. Un error de procesamiento sigue siendo `500`.
- **RF-H7-9:** No se agregan variables de entorno ni esquema. Los umbrales viven en codigo y se documentan. El limitador es en memoria y best-effort; se acepta que no sea distribuido y que se reinicie con el proceso.

### 5.3 H-8 — Base publica invalida

- **RF-H8-1:** Si `NEXT_PUBLIC_URL` esta definida, debe validarse. Si es invalida, no se puede usar `req.url` ni el origin interno como base publica.
- **RF-H8-2:** Para las redirecciones a la pagina de estado (`[token]`, `retorno`, `cancelado`), si no hay base publica valida, la respuesta debe usar un `Location` relativo y seguro (`/pago/paypal/estado?...`). El navegador lo resuelve contra el origen publico real.
- **RF-H8-3:** Para las URLs absolutas que se envian a PayPal (`return_url` y `cancel_url`), si no hay base publica valida, la operacion debe fallar cerrado: no se crea la orden, no se llama a PayPal y se informa un estado de error. Una URL relativa no es valida para PayPal.
- **RF-H8-4:** Sin `NEXT_PUBLIC_URL`, se conserva el comportamiento actual: se usa el origin de la request solo si es publico y seguro (HTTPS, o HTTP local/loopback). Si el origin es interno, se usa la redireccion relativa.
- **RF-H8-5:** La creacion manual de link del admin debe fallar cerrado ante una base invalida, sin crear enlace ni orden y sin caer a `req.url`.
- **RF-H8-6:** La redireccion relativa debe apuntar siempre a una ruta fija del sitio con token validado; no se acepta un host, esquema o path provisto por el usuario. No hay open redirect.
- **RF-H8-7:** No se registra el valor invalido de la env si pudiera contener credenciales, query o fragmento. Los logs solo indican que la base publica no es valida.
- **RF-H8-8:** Los demas consumidores de `NEXT_PUBLIC_URL` (sitemap, robots, RSS, cron, `mercadopago.ts`) quedan fuera de alcance; si usan otro patron de fallback, se documenta como riesgo separado.

### 5.4 H-9 — Higiene del repositorio

- **RF-H9-1:** `.railway/` debe estar ignorado por git, incluido su contenido.
- **RF-H9-2:** No debe haber archivos de `.railway/` versionados. Si existieran, se quitan del indice en la misma tarea, sin borrar el archivo local.
- **RF-H9-3:** El cambio es solo de repositorio: no modifica codigo de producto, runtime, build, deploy ni variables.
- **RF-H9-4:** La verificacion debe poder repetirse con `git check-ignore` y `git status`.

### 5.5 H-6 — Investigacion de firmas de Mercado Pago

- **RF-H6-1:** Se debe reunir evidencia redactada de los warnings `Webhook MP con firma invalida` y de la IPN vacia: fecha/hora, entorno, URL de notificacion (sin secretos), tipo de evento, headers relevantes (`x-signature`, `x-request-id`), query y body redactados, `data.id`, respuesta HTTP y si la notificacion fue real o de prueba.
- **RF-H6-2:** Se debe construir una matriz de entornos (staging y produccion) con: cuenta/aplicacion de Mercado Pago, URL de webhook configurada, eventos habilitados, presencia y fecha de rotacion del secreto, y confirmacion de que produccion no apunta a staging.
- **RF-H6-3:** Se debe verificar la construccion de la firma contra la documentacion y la version del SDK usada, incluyendo el origen de `data.id`, el `ts` y el `x-request-id`. No se asume la causa.
- **RF-H6-4:** Cada hipotesis debe quedar confirmada, rechazada o marcada como evidencia insuficiente, con la evidencia que la discrimina. Las hipotesis iniciales incluyen, sin afirmarlas: secreto distinto entre panel y entorno, notificacion de otra cuenta/aplicacion, notificacion de prueba sin firma valida, IPN legacy vacia, diferencia de algoritmo/SDK y reloj fuera de ventana.
- **RF-H6-5:** El resultado debe terminar en una decision: accion de configuracion del dueno, cambio de codigo (que requiere spec nueva o enmienda) o no accionar. Si se requiere codigo, no se implementa en esta spec.
- **RF-H6-6:** El expediente no debe contener PII del pagador, secretos, firmas completas ni credenciales. Las muestras se redactan.
- **RF-H6-7:** Si la evidencia no alcanza, el expediente debe listar exactamente que falta y H-6 queda abierto; no se inventa una causa ni se cambia el secreto o el panel a ciegas.

### 5.6 Compatibilidad y no regresion

- **RF-COMP-1:** PayPal conserva la verificacion de firma, la idempotencia por `EventoPasarela.eventoId` y `Pago.externalId`/`paypalOrderId`, el procesamiento de capturas, los estados, los montos y los links. H-7 solo agrega rechazos previos.
- **RF-COMP-2:** Mercado Pago no cambia: webhook, firma, links, montos, idempotencia y emails quedan igual. H-6 es solo investigacion.
- **RF-COMP-3:** Las paginas publicas de pago siguen siendo `no-store`, `no-referrer` y `noindex`; no se agregan rutas publicas ni se toca el middleware.

## 6. Requisitos no funcionales

- **RNF-1 (privacidad):** La pagina publica no muestra PII ni estados internos. H-7 usa la IP de origen solo en memoria para el limite, sin persistirla ni loguearla, y no loguea payloads, PII, firmas ni secretos. H-6 se redacta. No se agregan datos al CRM.
- **RNF-2 (seguridad):** H-8 no introduce open redirect; la ruta relativa es fija y el token se valida. H-7 no confia en headers ni body sin firma. No se agregan secretos al repo.
- **RNF-3 (disponibilidad):** H-7 no debe bloquear permanentemente a PayPal; los `429` son temporales y reintentables. Un fallo de la pagina de estado debe mostrar `error`, no un estado acreditado.
- **RNF-4 (rendimiento):** H-5 resuelve la pagina con una sola consulta Prisma (link + existencia de pago en revision), sin N+1. H-7 usa estructuras O(1) y memoria acotada; no hay timers por request.
- **RNF-5 (tests):** Cada AC funcional tiene al menos un test automatizado. H-6 se verifica con checklist documental por ser investigacion sin codigo. La suite no hace llamadas reales a PayPal/MP.
- **RNF-6 (operacion):** Sin cambios de envs, `Dockerfile`, `package.json`, `railway.toml` ni esquema. Sin deploy a produccion antes de T-38. H-9 no dispara build por ser docs-only.
- **RNF-7 (calidad):** TypeScript estricto; suite, typecheck, lint y build limpios antes de cerrar, sin errores nuevos sobre el baseline.
- **RNF-8 (compatibilidad):** La suite PayPal/MP existente sigue verde; los cambios de H-7 no alteran el resultado de eventos verificados y los de H-8 no alteran montos ni checkout.
- **RNF-9 (idioma):** La copia publica nueva esta en espanol, sin jerga interna, y usa el mismo estilo visual y de accesibilidad que la pagina actual.
- **RNF-10 (trazabilidad):** H-6 deja evidencia reproducible y redactada; H-7 deja un motivo de limite sin PII; H-5 no registra nada nuevo.

## 7. Criterios de aceptacion

### 7.1 H-5

- **AC-H5-1:** Dado un link `PAGADO` con un pago asociado en `REVISION`, cuando el comprador abre `/pago/paypal/estado`, entonces ve "Pago en revision", no ve "Pago acreditado" y no aparecen `REVISION`, `revisionNota`, nombre, email ni ids internos.
- **AC-H5-2:** Dado un link `PAGADO` con un pago `SUCCEEDED`, cuando el comprador abre la pagina, entonces ve "Pago acreditado" (regresion).
- **AC-H5-3:** Dado un link `PAGADO` sin pago asociado (historico), cuando el comprador abre la pagina, entonces ve "Pago acreditado" (comportamiento actual).
- **AC-H5-4:** Dado un retorno de PayPal cuya captura queda en `REVISION`, cuando el retorno redirige a la pagina de estado, entonces el `Location` informa `pendiente` y la pagina muestra "Pago en revision", nunca "Pago acreditado".
- **AC-H5-5:** Dado un pago en `REVISION`, cuando se abre la pagina con `?estado=pagado`, entonces sigue mostrando "Pago en revision"; cuando se abre con `?estado=error`, entonces muestra el error informado por el retorno.
- **AC-H5-6:** Dada la pagina, cuando se inspecciona la consulta, entonces hay una sola llamada a Prisma, el `select` solo trae los campos necesarios para evaluar el concepto y la existencia de un pago en `REVISION`, y no trae cliente, notas, revision ni ids internos adicionales; los ids de concepto existentes (`hitoId`, `suscripcionId`) no se renderizan.
- **AC-H5-7:** Dado un pago que deja de estar en `REVISION` (revision resuelta), cuando el comprador vuelve a abrir la pagina, entonces ve el estado resultante y no una copia cacheada del estado anterior.
- **AC-H5-8:** Dados los estados pendiente, vencido, invalidado y error, cuando se abren sus links, entonces la pagina se comporta como hoy y conserva `no-store`, `no-referrer` y `noindex`.

### 7.2 H-7

- **AC-H7-1:** Dado un origen que supera el limite de solicitudes de la ventana, cuando llega la siguiente solicitud, entonces recibe `429` con `Retry-After` y `no-store`, no se verifica la firma, no se escribe `EventoPasarela` y no cambia ningun pago.
- **AC-H7-2:** Dado un origen con fallos de verificacion suficientes para agotar el presupuesto, cuando llega otro intento no verificado, entonces recibe `429` antes de llamar a PayPal y no deja una fila nueva; al reiniciarse la ventana, la verificacion vuelve a intentarse.
- **AC-H7-3:** Dado un origen bloqueado por fallos, cuando llega un evento valido desde otro origen, entonces se verifica y procesa con `200`, sin verse afectado por el bloqueo ajeno.
- **AC-H7-4:** Dado un origen dentro del presupuesto, cuando envia una firma invalida, entonces recibe `401` y se registra un evento tecnico sin PII, como hoy.
- **AC-H7-5:** Dado que la verificacion no esta disponible (timeout/red/HTTP), cuando llega el webhook, entonces recibe `503`, el fallo no consume el presupuesto de firma y un intento posterior valido sigue funcionando.
- **AC-H7-6:** Dado un cuerpo mayor al maximo documentado, cuando llega el webhook, entonces recibe `413`, no se parsea, no se verifica, no se escribe evento y no se toca ningun pago.
- **AC-H7-7:** Dado un webhook sin headers de transmision, cuando llega, entonces recibe `401` con evento `HEADERS_INCOMPLETOS` mientras haya presupuesto, y el rechazo ocurre antes de la verificacion.
- **AC-H7-8:** Dado un evento verificado, cuando es procesado, duplicado, ignorado o falla el procesamiento, entonces conserva `200` o `500` respectivamente y la idempotencia actual.
- **AC-H7-9:** Dados los logs y eventos de H-7, cuando se inspeccionan, entonces no contienen payload crudo, PII, firma, certificado, secreto ni IP completa; el `429` es generico.
- **AC-H7-10:** Dado el webhook de Mercado Pago, cuando se ejecuta la suite, entonces sus tests y su comportamiento no cambian.

### 7.3 H-8

- **AC-H8-1:** Dada una `NEXT_PUBLIC_URL` invalida (HTTP publica, credenciales, query, fragmento o texto no URL), cuando se resuelve la base publica, entonces devuelve `null` y nunca el origin de la request.
- **AC-H8-2:** Dada una `NEXT_PUBLIC_URL` invalida y una request con origin interno, cuando el comprador abre `/pago/paypal/[token]`, entonces el `Location` es relativo a `/pago/paypal/estado` y no contiene `0.0.0.0`, `http://` interno ni puerto interno.
- **AC-H8-3:** Dada una `NEXT_PUBLIC_URL` invalida y un link que necesitaria crear una orden, cuando el comprador abre el link, entonces no se llama a `createOrder`, se informa error y la redireccion es relativa.
- **AC-H8-4:** Dada una `NEXT_PUBLIC_URL` invalida, cuando PayPal vuelve al retorno con una orden valida, entonces la captura se procesa como hoy y la redireccion al estado es relativa, sin host interno.
- **AC-H8-5:** Dada una `NEXT_PUBLIC_URL` invalida, cuando PayPal vuelve a la cancelacion, entonces el evento de cancelacion se registra como hoy y la redireccion es relativa.
- **AC-H8-6:** Dada una `NEXT_PUBLIC_URL` invalida, cuando el admin intenta crear un link PayPal, entonces recibe un error controlado, no se crea enlace ni orden y no se usa `req.url`.
- **AC-H8-7:** Dada una `NEXT_PUBLIC_URL` valida, cuando se redirige o se crea una orden, entonces se usa la base normalizada como hoy (regresion).
- **AC-H8-8:** Dada una request sin `NEXT_PUBLIC_URL` con origin publico seguro, entonces se usa el origin absoluto; con origin interno, entonces se usa la redireccion relativa.
- **AC-H8-9:** Dada cualquier redireccion de H-8, cuando se inspecciona el `Location`, entonces apunta a una ruta fija del sitio con token validado, no acepta host del usuario y no hay open redirect; los logs no exponen el valor invalido de la env.

### 7.4 H-9

- **AC-H9-1:** Dado el `.gitignore`, cuando se busca `.railway/`, entonces la entrada existe y cubre el directorio.
- **AC-H9-2:** Dado un archivo dentro de `.railway/`, cuando se ejecuta `git check-ignore`, entonces git lo ignora; `git status` no lo muestra.
- **AC-H9-3:** Dado el indice de git, cuando se lista `.railway/`, entonces no hay archivos versionados; si los hubiera, se quitan del indice en la misma tarea sin borrar el archivo local.
- **AC-H9-4:** Dado el commit de H-9, cuando se revisa el diff, entonces solo cambia `.gitignore` (y la evidencia), sin `src/**`, `Dockerfile`, `package.json`, `railway.toml` ni envs.

### 7.5 H-6

- **AC-H6-1:** Dado el expediente de H-6, cuando se revisa, entonces contiene al menos 3 muestras redactadas por tipo de warning (firma invalida e IPN vacia), con fecha/hora, entorno, URL sin secretos, headers relevantes, `data.id`, respuesta HTTP y si fue real o de prueba.
- **AC-H6-2:** Dado el expediente, cuando se revisa la matriz de entornos, entonces indica cuenta/aplicacion, URL de webhook, eventos, secreto (presencia/rotacion) y confirma que produccion no apunta a staging.
- **AC-H6-3:** Dado el expediente, cuando se revisan las hipotesis, entonces cada una esta confirmada, rechazada o marcada como evidencia insuficiente, con la evidencia que la discrimina.
- **AC-H6-4:** Dado el expediente, cuando se revisa la conclusion, entonces hay una decision explicita (configuracion, codigo o no accionar). Si requiere codigo, se abre una spec nueva o enmienda y no se implementa en 003.
- **AC-H6-5:** Dado el expediente, cuando se busca PII o secretos, entonces no hay nombre, email, telefono, direccion, firma completa, certificado ni credencial; las muestras estan redactadas.
- **AC-H6-6:** Dada evidencia insuficiente, cuando se cierra la investigacion, entonces H-6 queda abierto con la lista exacta de datos que debe aportar el dueno y no se registra una causa inventada.

## 8. Tests esperados

La estrategia detallada esta en el plan; esta seccion fija el minimo.

| Area | Tipo | Casos clave | AC |
|------|------|-------------|----|
| H-5 estados publicos | unitaria pura + pagina con Prisma mockeado | `PAGADO` + `REVISION`; `PAGADO` + `SUCCEEDED`; `PAGADO` sin pago; `?estado=pagado` no asciende; `?estado=error` conserva prioridad; sin PII/estados internos; un solo `findUnique`; select minimo | AC-H5-1 a AC-H5-8 |
| H-5 retorno | ruta con PayPal/proceso mockeados | captura `REVISION` -> `Location` con `estado=pendiente`; pagina posterior "Pago en revision" | AC-H5-4 |
| H-7 limitador | unitaria pura con reloj inyectado | ventana, limite, fallos, exito limpia, reinicio, cuerpo por `Content-Length` y por bytes, memoria acotada | AC-H7-1, AC-H7-2, AC-H7-3, AC-H7-9 |
| H-7 webhook | ruta con PayPal/Prisma/logger mockeados | 300/301 solicitudes; 20/21 fallos; 429 sin verify ni evento; 401 dentro del presupuesto; 503 no cuenta; 413 sin parseo; headers faltantes; 200/500 verificados; MP intacto | AC-H7-1 a AC-H7-10 |
| H-8 resolver | unitaria pura | env valida; env invalida; env ausente + origin publico; env ausente + origin interno; normalizacion; credenciales/query/fragmento | AC-H8-1, AC-H8-7, AC-H8-8 |
| H-8 rutas | ruta con Prisma/PayPal mockeados | `[token]`, retorno y cancelado con env invalida -> `Location` relativo sin host interno; `[token]` no llama `createOrder`; admin link 400 sin crear | AC-H8-2 a AC-H8-6, AC-H8-9 |
| H-9 repo | comando de verificacion | `git check-ignore` sobre `.railway/`; `git status`; `git ls-files`; diff solo docs | AC-H9-1 a AC-H9-4 |
| H-6 investigacion | checklist documental | muestras, matriz de entornos, hipotesis, decision, redaccion, datos faltantes | AC-H6-1 a AC-H6-6 |
| Regresion | suite existente | PayPal (webhook, proceso, idempotencia, links, recibo, pagina publica), MP (webhook, coexistencia, links), recibo MP | AC-H5-2, AC-H5-3, AC-H5-8, AC-H7-10, AC-H8-7 |

Ademas:

- Los tests de H-7 deben usar IPs unicas o un reset del limitador para no contaminar casos; no deben hacer llamadas reales a PayPal.
- Los tests de H-5 deben actualizar el fixture de la pagina para incluir `pagos` y ajustar la asercion exacta del `select`.
- Los tests de H-8 deben cubrir `Location` relativo; no deben asumir que `NextResponse.redirect` acepta URLs relativas.
- H-6 no lleva test automatizado: es una investigacion sin cambio de codigo. Se acepta como excepcion justificada de RNF-5 y se verifica con el checklist del expediente.

## 9. Decisiones propuestas

Estas decisiones son defaults recomendados. Salvo H-6, no bloquean la implementacion si el dueno las aprueba en bloque.

| ID | Decision propuesta | Alternativas descartadas | Impacto |
|----|--------------------|--------------------------|---------|
| **D-H5-1** | Detectar la revision por la existencia de un `Pago` asociado al link en `REVISION`, en la misma consulta de la pagina. | Confiar en `?estado=pendiente` (falsificable y no persistente); guardar un estado publico en el link (requiere esquema). | H-5, AC-H5-1, AC-H5-6. |
| **D-H5-2** | Copia publica "Pago en revision" y detalle "Estamos revisando el pago. No es necesario volver a pagar." Sin cambiar concepto ni monto existentes. | "Pago pendiente" (se confunde con checkout no iniciado); mostrar la diferencia (expone datos internos). | H-5, AC-H5-1, AC-H5-8. |
| **D-H5-3** | El query string solo puede conservar el error; nunca asciende a pagado. La base manda. | Confiar en el query para el estado (inseguro). | H-5, AC-H5-5. |
| **D-H7-1** | Dos capas: limite de solicitudes por IP y presupuesto de fallos de verificacion; no hay allowlist de IPs. | Allowlist de PayPal (rangos cambian y son operativamente fragiles); limite global antes de verificar (bloquea reintentos legitimos). | H-7, AC-H7-1 a AC-H7-3. |
| **D-H7-2** | Defaults: 300 solicitudes/min por IP; 20 fallos/10 min por IP; cuerpo maximo 256 KiB. Configurables en codigo, sin envs. | Limites mas bajos (riesgo de bloquear reintentos); sin limite de cuerpo (DoS). | H-7, AC-H7-1, AC-H7-2, AC-H7-6. |
| **D-H7-3** | Responder `429`/`413` genericos, con `Retry-After`; no persistir intentos bloqueados. | `401` para todo (oculta la causa); `200` para descartar (PayPal no reintenta y se pierde el evento). | H-7, AC-H7-1, AC-H7-6. |
| **D-H7-4** | Limitador en memoria, best-effort, con mapa acotado; se documenta que no es distribuido y se reinicia con el proceso. | Redis/DB (infra y esquema nuevos); WAF (fuera de alcance). | H-7, RNF-4, RNF-6. |
| **D-H8-1** | Si no hay base publica valida, redirigir con `Location` relativo a la ruta fija de estado. | `503` (peor UX); hardcodear `pixelarch.dev` (incorrecto en staging); confiar en `X-Forwarded-Host` (falsificable). | H-8, AC-H8-2, AC-H8-4, AC-H8-5, AC-H8-9. |
| **D-H8-2** | Para `return_url`/`cancel_url` de PayPal, fallar cerrado si no hay base absoluta valida. | Relativo (PayPal no lo acepta); usar el origin interno (inaccesible). | H-8, AC-H8-3. |
| **D-H8-3** | Mantener el contrato de `resolverBaseUrlPublica`; no cambiar la validacion global de envs. | Validar `NEXT_PUBLIC_URL` al startup (rompe otros consumidores y el build). | H-8, AC-H8-1, AC-H8-7. |
| **D-H9-1** | Ignorar el directorio completo con `.railway/`. | `.railway/*` (no cubre subdirectorios en todos los casos); ignorar archivo por archivo (se olvida). | H-9, AC-H9-1. |
| **D-H6-1** | No cambiar codigo, secreto ni panel antes de tener evidencia y decision. | Rotar el secreto a ciegas (puede romper produccion); desactivar la validacion (inseguro); ignorar warnings (sin trazabilidad). | H-6, AC-H6-3 a AC-H6-6. |

## 10. Preguntas abiertas

- **[NECESITA ACLARACION] H-6 (bloqueante):** se necesita que el dueno aporte, del panel de Mercado Pago: cuenta/aplicacion usada en staging y produccion, URL de webhook configurada en cada una, eventos habilitados, si el secreto es el mismo entre entornos y cuando se roto, y 3 a 5 muestras redactadas de notificaciones (headers `x-signature`/`x-request-id`, query, body, `data.id`, hora y respuesta). Sin esto no se puede concluir la causa.
- **[NECESITA ACLARACION] H-6 (bloqueante):** confirmar si los warnings del paso 11 vinieron de pagos reales de sandbox, de la funcion "Probar" del panel o de una IPN legacy separada, y si la IPN vacia tenia URL propia.
- **[NECESITA ACLARACION] H-7 (no bloqueante):** aprobar los defaults 300 solicitudes/min, 20 fallos/10 min y cuerpo de 256 KiB. Si el volumen esperado de PayPal es mayor, se ajustan antes de implementar.
- **[NECESITA ACLARACION] H-5 (no bloqueante):** confirmar la copia "Pago en revision" y aceptar que el concepto y el monto del link se sigan mostrando como hoy. Cambiar el monto o la etiqueta queda fuera de alcance.
- **[NECESITA ACLARACION] H-8 (no bloqueante):** confirmar que la redireccion relativa es aceptable para la pagina de estado, en lugar de un `503` cuando la configuracion es invalida.

## 11. Cierre

- H-5, H-7, H-8 y H-9 pueden implementarse y probarse en `paypal-staging` sin produccion, sin esquema y sin envs.
- H-6 no se implementa ni se corrige en esta spec; solo se investiga y se documenta. Cualquier cambio derivado requiere spec nueva o enmienda.
- T-38 sigue sin autorizacion. No hay merge a `main` ni deploy a produccion antes de completar el orden de T-38 (`db push` + backfill antes del merge).
