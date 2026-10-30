# Spec 003: Hardening posterior a T-37/002 (H-5, H-6, H-7, H-8, H-9)

**Estado:** implementacion cerrada en staging (2026-10-30) — H-5, H-6, H-7, H-8 y H-9 implementadas y **PASS tester+reviewer**; **H-6** con evidencia en `h6-mp-firmas.md` y hardening del webhook MP. **T-38 pendiente y NO autorizado**; produccion sin cambios.
**Fecha:** 2026-10-30 (original 2026-10-29)
**Rama de implementacion:** `paypal-staging`.
**Relacionada con:** `specs/001-paypal-pagos/spec.md`, `specs/001-paypal-pagos/review.md` §4 (H-5..H-9), `specs/002-recibo-mp/spec.md` y `specs/constitution.md` §1 a §7.
**Gate:** T-38 sigue **despues** de este trabajo y **no esta autorizado**. No hay merge a `main` ni deploy a produccion antes de T-38.

## 1. Contexto y objetivo

### 1.1 Situacion actual

- T-37 quedo `PASS` con observaciones (staging, commit `139b8cb`, deploy `4c765526`). Produccion sigue en `cdafe04`, sin PayPal, sin el esquema PayPal y sin el recibo de Mercado Pago. T-38 (migracion/backfill + rollout) no fue autorizado.
- El recibo interno de Mercado Pago (002) esta implementado en `paypal-staging`, sin cambios de esquema ni envs, y espera el mismo gate T-38.
- El backlog acordado en `review.md` §7 incluye cinco hallazgos no bloqueantes: H-5 (estado publico en revision), H-6 (firmas de Mercado Pago), H-7 (hardening del webhook PayPal), H-8 (fallback de `NEXT_PUBLIC_URL`) y H-9 (`.railway/` en `.gitignore`).

Detalle de cada hallazgo:

- **H-5:** cuando una captura PayPal queda en `REVISION` (diferencia de monto o moneda), el link se marca `PAGADO` y el pago queda pendiente de revision. La pagina publica `/pago/paypal/estado` derivaba "Pago acreditado" solo del estado del link, de modo que el comprador veia un cobro acreditado cuando en realidad estaba en revision. El retorno ya informa `pendiente`, pero la pagina lo ignoraba cuando el link figuraba `PAGADO`. **Corregido en T-03; PASS tester+reviewer.**
- **H-7:** `POST /api/webhooks/paypal` es publico y no tenia limite de solicitudes. Cada intento con headers y cuerpo parseables disparaba una verificacion server-to-server contra PayPal; los rechazos por headers, cuerpo, evento o firma escribian un `EventoPasarela` tecnico. Un tercero podia generar carga, ruido y filas sin autenticarse. A la vez, PayPal necesita reintentar sin bloqueos permanentes. **Implementado en T-04; PASS tester+reviewer (rate limit PayPal).**
- **H-8:** `resolverBaseUrlPublica` ya rechaza una `NEXT_PUBLIC_URL` invalida y no cae al origin de la request. Sin embargo, los ayudantes de redireccion de `/pago/paypal/[token]`, `/pago/paypal/retorno` y `/pago/paypal/cancelado` hacian `?? req.url`; detras del proxy de Railway ese origin puede ser `http://0.0.0.0:8080`, inaccesible para el comprador. El link manual del admin ya falla cerrado. **Corregido en T-02; PASS tester+reviewer.**
- **H-9:** `.railway/` no estaba en `.gitignore`. Es estado local de la CLI de Railway y no debe versionarse; ademas, la evidencia de T-37 se apoyo en scripts que ya no estan en el repo. **Implementado en T-01; PASS tester+reviewer (`.gitignore`).**
- **H-6 (ampliado por decision del dueno, 2026-10-30):** ya no es solo investigacion. Incluye dos entregables:
  1. **Evidencia:** que la URL de webhook de Mercado Pago en staging es la correcta, que `MP_WEBHOOK_SECRET` esta presente y coincide con el panel (confirmado por el dueno, sin registrar el valor), que los warnings `Webhook MP con firma invalida` de las 08:35 y 08:51 no tienen pago asociado y son POSTs invalidos/ruido, y que los eventos validos de Coexistencia A/B del paso 11 de T-37 se procesaron correctamente. **Expediente creado (T-05) y PASS tester+reviewer; evidencia en `h6-mp-firmas.md`.**
  2. **Hardening del webhook MP:** limite de solicitudes y de firmas invalidas por origen, descarte de las notificaciones que no son `payment` (o que no traen `data.id`) **antes** de validar la firma, y log de firma invalida en `debug` sin `data.id`, firma, IP ni PII. La verificacion de firma se mantiene siempre activa; no se rota el secreto ni se toca el panel. **Implementado en T-06; PASS tester+reviewer (hardening MP).**

### 1.2 Problema

Cinco bordes de calidad y operacion quedaron abiertos despues de validar PayPal:

1. El comprador recibe una afirmacion incorrecta sobre el estado de su pago (H-5).
2. El webhook publico de PayPal es facil de inundar y de usar para amplificar llamadas y escrituras (H-7).
3. Una configuracion invalida puede mandar al comprador a un host interno (H-8).
4. El repo puede incorporar estado local de Railway por accidente (H-9).
5. El webhook publico de Mercado Pago validaba la firma de cualquier cuerpo parseable antes de saber si era un pago, gastaba trabajo en topics ajenos, acumulaba warnings sin contexto y no tenia evidencia que separara ruido de un fallo de cobro real (H-6).

### 1.3 Objetivo

Cerrar H-5, H-7, H-8 y H-9 con cambios acotados, tests automatizados y sin tocar produccion, esquema ni envs; y cerrar H-6 con el expediente de evidencia (URL/secreto correctos, warnings = ruido sin pago) mas el hardening acotado del webhook de Mercado Pago (rechazos tempranos, limite por origen, log en `debug`), sin cambiar la firma, el secreto, el panel ni el flujo de un pago valido.

### 1.4 Resultado esperado

- Un pago PayPal en `REVISION` nunca se muestra al comprador como "Pago acreditado"; se muestra "Pago en revision", sin PII ni estados internos, tanto al abrir el link como al volver del checkout.
- El webhook PayPal resiste rafagas de intentos no verificados con limites acotados, sin bloquear de forma permanente los reintentos legitimos ni cambiar la semantica de los eventos verificados.
- Una `NEXT_PUBLIC_URL` definida pero invalida no produce redirecciones a `0.0.0.0` ni a hosts internos; las redirecciones usan una ruta relativa segura y las URLs absolutas que se envian a PayPal fallan cerrado.
- `.railway/` queda ignorado por git, sin cambios de producto.
- H-6 queda documentado con evidencia redactada (URL de staging, secreto confirmado sin valor, warnings 08:35/08:51 sin pago, eventos validos A/B) y con un webhook MP que ignora topics que no son pago antes de la firma, limita solicitudes y firmas invalidas por origen, loguea en `debug` sin PII, y sigue procesando los eventos `payment` validos como hoy.
- La suite, el typecheck, el lint y el build quedan limpios; PayPal y Mercado Pago no sufren regresiones.

### 1.5 Decisiones fijas (constitucion)

- No se recogen datos nuevos del pagador ni del comprador. No se muestran ni registran PII en la pagina publica, en logs, en Sentry ni en el expediente de H-6.
- No se almacenan datos de tarjeta ni secretos en el repositorio. Los secretos viven en Railway o `.env.local`. El valor de `MP_WEBHOOK_SECRET` no se transcribe en specs, planes, tareas ni evidencia.
- Mercado Pago sigue siendo la pasarela principal en ARS; PayPal se usa para USD. No se cambia ningun flujo de cobro, monto, comision, estado ni idempotencia.
- Los montos siguen en centavos y se formatean con `formatearMonto`; esta spec no cambia montos ni conversiones.
- Todo cambio de esquema Prisma se sincroniza con `db push` y se documenta en el plan. **Esta spec no requiere cambios de esquema.**
- Cada criterio de aceptacion funcional tiene al menos un test automatizado. Los criterios documentales de H-6 (evidencia) se verifican con el checklist del expediente; el hardening de H-6 tiene tests de ruta.
- TypeScript estricto; lint, typecheck y build limpios antes de cerrar cada tarea, sin errores nuevos sobre el baseline conocido.
- No hay comandos interactivos ni watch en la verificacion.

### 1.6 Supuestos y dependencias

- El trabajo se hace en `paypal-staging`, que ya tiene el esquema PayPal aplicado y los datos de staging. Produccion no se toca.
- H-5 lee la relacion `EnlacePago.pagos` y el estado `Pago.estadoPago`, que existen en el esquema validado en staging. No agrega columnas ni backfill; viaja con T-38.
- H-7 y H-8 son cambios de codigo en rutas publicas y no dependen de datos nuevos. H-9 es higiene de repositorio.
- H-6 se apoya en la decision del dueno (2026-10-30), en la confirmacion de la URL de webhook y del secreto de staging (sin valor) y en la evidencia del paso 11 de T-37 (Coexistencia A/B). El webhook MP de produccion ya opera; esta spec no lo reconfigura ni lo migra.
- No se agregan dependencias ni librerias. Los limitadores son en memoria, best-effort, igual que el resto del proyecto; no hay Redis ni storage nuevo.
- La suite no hace llamadas reales a PayPal ni a Mercado Pago. El sandbox/staging se valida a mano cuando corresponda.

## 2. Alcance

### 2.1 Incluido

| Item | Incluido |
|------|----------|
| **H-5** | Estado publico "Pago en revision" cuando el link tiene un pago asociado en `REVISION`; cobertura del link `PAGADO` y del retorno; precedencia de `?estado=error`; sin PII ni estados internos. |
| **H-7** | Limite por origen de solicitudes, presupuesto de fallos de verificacion, rechazo de cuerpos excesivos, orden de rechazos baratos y tests; sin cambios en la semantica de eventos verificados. |
| **H-8** | Redireccion relativa segura cuando no hay base publica valida; fallo cerrado en la creacion de ordenes que necesitan URL absoluta; tests de `resolverBaseUrlPublica` y de las rutas. |
| **H-9** | `.railway/` en `.gitignore` y verificacion de que no haya archivos versionados de ese directorio. |
| **H-6** | Expediente `h6-mp-firmas.md` con la evidencia redactada y el hardening del webhook MP: limite de solicitudes y de firmas invalidas por origen, descarte de topics que no son pago antes de la firma, log de firma invalida en `debug` y tests de ruta. Sin rotar el secreto, sin tocar el panel y sin desactivar la firma. |
| **Transversal** | Tests, typecheck, lint y build; compatibilidad PayPal/MP; documentacion de cierre. |

### 2.2 Fuera de alcance

- Cambios de esquema Prisma, migraciones, `db push` o backfill. Esta spec no agrega columnas.
- Cambios de variables de entorno, `Dockerfile`, `package.json`, `railway.toml` o `next.config`.
- Merge a `main`, deploy a produccion, ejecucion de T-38 o cualquier cambio en el panel de PayPal/Mercado Pago.
- Rotar `MP_WEBHOOK_SECRET`, cambiar la cuenta/aplicacion o la URL de webhook de Mercado Pago, o desactivar la validacion de firma. La decision de H-6 es hardening, no reconfiguracion.
- Cambiar la construccion o verificacion de la firma de Mercado Pago, la idempotencia por `Pago.externalId`, el procesamiento de hito/soporte, los montos, los meses, los links, los emails o los estados de un pago valido.
- Agregar un tope de cuerpo (`413`) al webhook MP: no forma parte de la decision y el limite de solicitudes ya acota el abuso trivial.
- Implementar una correccion de configuracion para H-6 (rotacion de secreto o accion de panel). Solo se documenta y se recomienda si hiciera falta.
- Cambiar la verificacion de firma de PayPal, la idempotencia, el procesamiento de capturas, los montos, el gross-up o los links.
- Rediseñar `/pago/paypal/estado`, cambiar el concepto o el monto que hoy muestra, o agregar detalle de la revision (diferencias, notas, acciones).
- Mostrar al comprador datos del CRM, del pagador, de la revision o enlaces al admin.
- Un portal de clientes, notificaciones nuevas, emails nuevos o cambios al recibo.
- Cambiar sitemap, robots, RSS, cron de uptime, digest o `mercadopago.ts` por H-8; solo se documenta el riesgo si usan `NEXT_PUBLIC_URL` con otro patron.
- Rate limit distribuido, Redis, WAF, allowlist de IPs de PayPal/MP o bloqueo permanente.
- Tests E2E contra PayPal/MP reales en la suite.

## 3. Actores y permisos

| Actor | Puede | No puede |
|-------|-------|----------|
| **Comprador / publico** | Abrir el link publico y ver el estado real del pago (pendiente, en revision, pagado, vencido, invalido o error), sin PII. | Ver datos del CRM, notas de revision, diferencias de monto, estados internos, ids internos ni acciones de admin. |
| **Admin / asistente** | Operar el CRM como hoy; no gana permisos nuevos con esta spec. | Ver en la pagina publica datos internos o resolver revisiones desde el link publico. |
| **PayPal** | Entregar webhooks firmados y reintentar ante 5xx/429. | Saltar la verificacion de firma o la idempotencia. |
| **Mercado Pago** | Entregar notificaciones a su webhook como hoy; sus eventos `payment` firmados siguen procesandose igual. | Saltar la firma, forzar un cobro sin pago valido ni bloquear a otros origenes. |
| **Tercero no autenticado** | Nada. Sus intentos quedan limitados y no crean pagos ni cambios de estado, ni en PayPal ni en Mercado Pago. | Inundar los webhooks sin tope, forzar escrituras ilimitadas o bloquear a PayPal/MP de forma permanente. |
| **Dueno / responsable de los paneles** | Confirmar la URL y el secreto de MP (sin exponer el valor), aportar muestras redactadas y decidir acciones de panel. | Delegar en el agente una conclusion sin evidencia ni pedir que se registre el secreto. |
| **Mantenimiento del repo** | Ignorar `.railway/` y verificar que no se versione. | Cambiar codigo de producto para H-9. |

## 4. Historias de usuario

- **HU-H5:** Como comprador, quiero ver que mi pago esta en revision cuando todavia no esta acreditado, para no creer que ya se cobro y no volver a pagar.
- **HU-H7:** Como responsable del sitio, quiero que el webhook de PayPal resista intentos no verificados sin bloquear de forma permanente los eventos legitimos ni sus reintentos, para no perder cobros ni permitir abuso.
- **HU-H8:** Como comprador, quiero que el retorno del checkout me lleve a una pagina publica valida aunque la configuracion de URL este mal, para no terminar en un host interno.
- **HU-H9:** Como responsable del repo, quiero que el estado local de Railway quede fuera de git, para no versionar configuracion local por accidente.
- **HU-H6:** Como dueno, quiero la evidencia de que la URL y el secreto de Mercado Pago estan bien y que los warnings de firma fueron ruido sin pago, y quiero que el webhook MP ignore los topics que no son pago, limite el abuso y loguee en `debug`, para no confundir ruido con fallos de cobro y no perder pagos validos.

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

### 5.5 H-6 — Firmas de Mercado Pago: evidencia y hardening del webhook

#### 5.5.1 Evidencia

- **RF-H6-1:** Se debe producir `specs/003-hardening-paypal/h6-mp-firmas.md` con: URL publica de staging, endpoint de webhook de MP, confirmacion del dueno de que la URL y el secreto son los correctos (sin registrar el valor), eventos observados y resultado de los eventos validos de Coexistencia A/B del paso 11 de T-37.
- **RF-H6-2:** El expediente debe registrar los warnings `Webhook MP con firma invalida` de las 08:35 y 08:51 como POSTs invalidos/ruido **sin pago asociado**, y sostenerlo con la evidencia: no hay `Pago` ni cambio de hito/soporte, y los eventos validos A/B se procesaron. Si un dato no alcanza, debe marcarse como no determinado; no se inventa la causa.
- **RF-H6-3:** El expediente debe incluir la matriz de entornos (staging y produccion) con cuenta/aplicacion, URL de webhook, eventos habilitados y presencia del secreto (sin valor), y aclarar que produccion no se reconfigura en esta spec.
- **RF-H6-4:** El expediente no debe contener PII del pagador, secretos, firmas completas, certificados, credenciales ni payload crudo. Las muestras se redactan.

#### 5.5.2 Hardening del webhook

- **RF-H6-5:** El webhook MP debe aplicar un limite de solicitudes por origen (300 por minuto) al inicio. Superado el limite, debe responder `429` con `Retry-After` y `Cache-Control: no-store`, sin validar firma, sin consultar Mercado Pago y sin escribir en la base.
- **RF-H6-6:** El webhook MP debe llevar un presupuesto de firmas invalidas por origen (20 en 10 minutos). Agotado el presupuesto, debe responder `429` antes de validar la firma. Una firma valida debe limpiar el presupuesto de ese origen; un origen bloqueado no debe afectar a otro.
- **RF-H6-7:** El webhook MP debe descartar las notificaciones que no son de pago (`body.type !== "payment"`) y las que no traen `data.id` **antes** de validar la firma: `200` con `{ ok: true, ignored: true }`, sin validar firma, sin consultar Mercado Pago y sin escribir en la base. Esto cubre topics de plan/merchant order y la IPN vacia/legacy.
- **RF-H6-8:** Una firma invalida dentro del presupuesto sigue devolviendo `401` y se registra con `logger.debug`, sin `data.id`, firma, IP, payload crudo ni PII.
- **RF-H6-9:** La verificacion de firma de MP se mantiene siempre activa cuando el topic es `payment` y hay `data.id`; no se desactiva, no se rota el secreto y no se cambia la URL del webhook. La idempotencia por `Pago.externalId`, los estados, montos, meses, links, emails y la coexistencia con PayPal no cambian.
- **RF-H6-10:** Sin `MP_WEBHOOK_SECRET` se conserva el comportamiento actual: `503` en produccion y aviso en desarrollo. No se agregan envs, umbrales configurables ni esquema; los limites viven en codigo y se documentan. El limitador es en memoria y best-effort.

### 5.6 Compatibilidad y no regresion

- **RF-COMP-1:** PayPal conserva la verificacion de firma, la idempotencia por `EventoPasarela.eventoId` y `Pago.externalId`/`paypalOrderId`, el procesamiento de capturas, los estados, los montos y los links. H-7 solo agrega rechazos previos.
- **RF-COMP-2:** Mercado Pago no cambia en firma, links, montos, meses, idempotencia, emails ni procesamiento de un pago valido. H-6 solo agrega rechazos tempranos (limite, topics ajenos) y un log en `debug`; los eventos `payment` firmados siguen el mismo camino.
- **RF-COMP-3:** Las paginas publicas de pago siguen siendo `no-store`, `no-referrer` y `noindex`; no se agregan rutas publicas ni se toca el middleware.

## 6. Requisitos no funcionales

- **RNF-1 (privacidad):** La pagina publica no muestra PII ni estados internos. H-7 usa la IP de origen solo en memoria para el limite, sin persistirla ni loguearla, y no loguea payloads, PII, firmas ni secretos. H-6 tampoco loguea `data.id`, firma ni IP y se redacta. No se agregan datos al CRM.
- **RNF-2 (seguridad):** H-8 no introduce open redirect; la ruta relativa es fija y el token se valida. H-7 no confia en headers ni body sin firma. La firma de MP sigue siendo obligatoria para todo `payment`; H-6 no la desactiva ni relaja. No se agregan secretos al repo.
- **RNF-3 (disponibilidad):** H-7 y H-6 no deben bloquear permanentemente a PayPal ni a Mercado Pago; los `429` son temporales y reintentables. Un fallo de la pagina de estado debe mostrar `error`, no un estado acreditado.
- **RNF-4 (rendimiento):** H-5 resuelve la pagina con una sola consulta Prisma (link + existencia de pago en revision), sin N+1. H-7 y H-6 usan estructuras O(1) y memoria acotada; no hay timers por request.
- **RNF-5 (tests):** Cada AC funcional tiene al menos un test automatizado. Los AC documentales de H-6 (evidencia y redaccion) se verifican con el checklist del expediente; el hardening de H-6 se verifica con tests de ruta. La suite no hace llamadas reales a PayPal/MP.
- **RNF-6 (operacion):** Sin cambios de envs, `Dockerfile`, `package.json`, `railway.toml` ni esquema. Sin deploy a produccion antes de T-38. H-9 no dispara build por ser docs-only; H-6 toca `src/**` y si dispara build.
- **RNF-7 (calidad):** TypeScript estricto; suite, typecheck, lint y build limpios antes de cerrar, sin errores nuevos sobre el baseline.
- **RNF-8 (compatibilidad):** La suite PayPal/MP existente sigue verde; los cambios de H-7 no alteran el resultado de eventos verificados, los de H-6 no alteran el resultado de un `payment` valido y los de H-8 no alteran montos ni checkout.
- **RNF-9 (idioma):** La copia publica nueva esta en espanol, sin jerga interna, y usa el mismo estilo visual y de accesibilidad que la pagina actual.
- **RNF-10 (trazabilidad):** H-6 deja evidencia reproducible y redactada y un rechazo temprano sin PII; H-7 deja un motivo de limite sin PII; H-5 no registra nada nuevo.

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
- **AC-H7-10:** Dado el webhook de Mercado Pago, cuando se ejecuta la suite, entonces sus tests y su comportamiento de un pago valido no cambian (los rechazos tempranos de H-6 son la unica adicion).

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

- **AC-H6-1:** Dado el expediente `h6-mp-firmas.md`, cuando se revisa, entonces contiene la URL de staging, el endpoint de webhook de MP, la confirmacion del dueno de que la URL y el secreto son correctos (sin el valor), los warnings de las 08:35 y 08:51 sin pago asociado y el resultado de los eventos validos de Coexistencia A/B.
- **AC-H6-2:** Dado el expediente, cuando se revisan los warnings, entonces cada uno esta clasificado como POST invalido/ruido sin pago o como no determinado, con la evidencia que lo discrimina (sin `Pago`, sin cambio de hito/soporte, eventos A/B procesados) y sin una causa inventada.
- **AC-H6-3:** Dado el expediente, cuando se revisa la decision y la redaccion, entonces consta el hardening (limite de solicitudes, presupuesto de firmas, descarte de topics ajenos, log en `debug`), que no se rota el secreto ni se toca el panel ni se desactiva la firma, y no hay PII, secretos, firmas completas ni payload crudo.
- **AC-H6-4:** Dado un POST con `body.type` distinto de `payment` o sin `data.id`, cuando se recibe, entonces responde `200` ignorado, no valida la firma, no consulta Mercado Pago y no escribe en la base.
- **AC-H6-5:** Dado un origen que supera el limite de solicitudes, cuando llega la siguiente, entonces recibe `429` con `Retry-After` y `no-store`, sin validar firma, sin consultar Mercado Pago y sin escribir en la base.
- **AC-H6-6:** Dado un origen con 20 firmas invalidas en la ventana, cuando llega el intento 21, entonces recibe `429` antes de validar; un evento valido de otro origen se procesa con `200`.
- **AC-H6-7:** Dado un origen dentro del presupuesto con firma invalida, cuando llega, entonces recibe `401` y el log de firma invalida es `debug` y no incluye `data.id`, la firma, la IP, payload crudo ni PII.
- **AC-H6-8:** Dado un `payment` firmado valido, cuando se procesa, entonces conserva `200`, un solo `Pago`, la idempotencia por `externalId` y el mismo efecto en hito/soporte; la firma valida limpia el presupuesto del origen.
- **AC-H6-9:** Dada la suite, cuando se ejecuta, entonces la coexistencia A/B, los links MP, los montos, los meses y el recibo MP siguen verdes, el `503` sin secreto en produccion se conserva y no hay llamadas reales a Mercado Pago.

## 8. Tests esperados

La estrategia detallada esta en el plan; esta seccion fija el minimo.

| Area | Tipo | Casos clave | AC |
|------|------|-------------|----|
| H-5 estados publicos | unitaria pura + pagina con Prisma mockeado | `PAGADO` + `REVISION`; `PAGADO` + `SUCCEEDED`; `PAGADO` sin pago; `?estado=pagado` no asciende; `?estado=error` conserva prioridad; sin PII/estados internos; un solo `findUnique`; select minimo | AC-H5-1 a AC-H5-8 |
| H-5 retorno | ruta con PayPal/proceso mockeados | captura `REVISION` -> `Location` con `estado=pendiente`; pagina posterior "Pago en revision" | AC-H5-4 |
| H-7 limitador | unitaria pura con reloj inyectado | ventana, limite, fallos, exito limpia, reinicio, cuerpo por `Content-Length` y por bytes, memoria acotada | AC-H7-1, AC-H7-2, AC-H7-3, AC-H7-9 |
| H-7 webhook | ruta con PayPal/Prisma/logger mockeados | 300/301 solicitudes; 20/21 fallos; 429 sin verify ni evento; 401 dentro del presupuesto; 503 no cuenta; 413 sin parseo; headers faltantes; 200/500 verificados; MP intacto | AC-H7-1 a AC-H7-10 |
| H-6 evidencia | checklist documental | URL/endpoint staging, secreto confirmado sin valor, warnings 08:35/08:51 sin pago, eventos A/B, matriz y redaccion | AC-H6-1 a AC-H6-3 |
| H-6 webhook MP | ruta MP con Prisma/SDK/rate limit/logger mockeados | topic ajeno y sin `data.id` ignorados antes de la firma; 429 por solicitudes; 20/21 firmas; 429 no afecta a otro origen; 401 en `debug` sin PII; firma valida limpia y procesa como hoy | AC-H6-4 a AC-H6-8 |
| H-8 resolver | unitaria pura | env valida; env invalida; env ausente + origin publico; env ausente + origin interno; normalizacion; credenciales/query/fragmento | AC-H8-1, AC-H8-7, AC-H8-8 |
| H-8 rutas | ruta con Prisma/PayPal mockeados | `[token]`, retorno y cancelado con env invalida -> `Location` relativo sin host interno; `[token]` no llama `createOrder`; admin link 400 sin crear | AC-H8-2 a AC-H8-6, AC-H8-9 |
| H-9 repo | comando de verificacion | `git check-ignore` sobre `.railway/`; `git status`; `git ls-files`; diff solo docs | AC-H9-1 a AC-H9-4 |
| Regresion | suite existente | PayPal (webhook, proceso, idempotencia, links, recibo, pagina publica), MP (webhook, Coexistencia A/B, links, recibo) | AC-H5-2, AC-H5-3, AC-H5-8, AC-H6-9, AC-H7-10, AC-H8-7 |

Ademas:

- Los tests de H-7 y H-6 deben usar IPs unicas o un reset del limitador para no contaminar casos; no deben hacer llamadas reales a PayPal/MP.
- Los tests de H-5 deben actualizar el fixture de la pagina para incluir `pagos` y ajustar la asercion exacta del `select`.
- Los tests de H-8 deben cubrir `Location` relativo; no deben asumir que `NextResponse.redirect` acepta URLs relativas.
- H-6 combina un checklist documental (evidencia) con tests de ruta (hardening); ambos son obligatorios.

## 9. Decisiones propuestas

Estas decisiones son defaults recomendados. No bloquean la implementacion: las dudas documentales de H-6 (fecha/zona y emisor de los POSTs) se cierran despues, sin tocar el panel.

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
| **D-H6-1** | La firma de Mercado Pago se mantiene siempre activa; no se rota `MP_WEBHOOK_SECRET`, no se cambia la URL ni se toca el panel. El problema se trata como ruido/abuso, no como secreto roto. | Rotar el secreto a ciegas (puede romper produccion); desactivar la validacion (inseguro); ignorar los warnings (sin trazabilidad). | H-6, AC-H6-1 a AC-H6-3, AC-H6-9. |
| **D-H6-2** | Reutilizar el limitador en memoria de `src/lib/rate-limit.ts`: 300 solicitudes/min por origen y 20 firmas invalidas/10 min por origen, con `429` + `Retry-After` y reset al validar. | Crear un limitador nuevo (duplica logica); Redis/WAF (infra nueva); sin limite (abuso). | H-6, AC-H6-5, AC-H6-6, RNF-4. |
| **D-H6-3** | Descartar antes de la firma todo lo que no sea `payment` o no traiga `data.id`, con `200` ignorado. | Validar la firma primero (gasta trabajo y warnings en topics ajenos); `401` para topics ajenos (rompe la semantica de MP y genera reintentos). | H-6, AC-H6-4, AC-H6-8. |
| **D-H6-4** | Log de firma invalida en `debug`, sin `data.id`, firma, IP ni PII. | `warn`/`info` (inunda produccion); loguear `data.id` (dato de pago y ruido). | H-6, AC-H6-7, RNF-1. |

## 10. Preguntas abiertas (no bloqueantes para el cierre)

- **[NECESITA ACLARACION] H-6 (no bloqueante):** confirmar la fecha exacta y la zona horaria de los warnings de las 08:35 y 08:51 para la trazabilidad completa del expediente. La evidencia los registra con la hora del log de staging y deja la fecha/zona como dato a confirmar.
- **[NECESITA ACLARACION] H-6 (no bloqueante):** confirmar si los warnings corresponden a la funcion "Probar" del panel, a un escaneo externo o a una IPN legacy de otra integracion. La evidencia actual prueba que no hubo pago ni cambio de estado; no alcanza para atribuir el origen.
- **[NECESITA ACLARACION] H-7 (no bloqueante):** los defaults 300 solicitudes/min, 20 fallos/10 min y cuerpo de 256 KiB ya estan implementados; confirmar si el volumen esperado de PayPal los excede para ajustarlos antes de T-38.
- **[NECESITA ACLARACION] H-5 (no bloqueante):** confirmar la copia "Pago en revision" y aceptar que el concepto y el monto del link se sigan mostrando como hoy. Cambiar el monto o la etiqueta queda fuera de alcance (T-03 ya implementada).
- **[NECESITA ACLARACION] H-8 (no bloqueante):** confirmar que la redireccion relativa es aceptable para la pagina de estado, en lugar de un `503` cuando la configuracion es invalida (T-02 ya implementada).

## 11. Cierre

- **H-5, H-7, H-8 y H-9 quedan implementadas y con PASS tester+reviewer en `paypal-staging`**, sin produccion, sin cambios de esquema ni de envs. H-9 queda como higiene de repositorio.
- **H-6 queda cerrado con dos entregables y PASS tester+reviewer:** el expediente `h6-mp-firmas.md` (URL/secreto correctos sin valor, warnings 08:35/08:51 = ruido sin pago, eventos A/B procesados) y el hardening del webhook MP (limite de solicitudes y firmas, descarte de topics ajenos antes de la firma, log en `debug`). No se rota el secreto, no se toca el panel y no se desactiva la validacion.
- **T-38 sigue pendiente y NO autorizado.** No hay merge a `main` ni deploy a produccion antes de completar el orden de T-38 (`db push` + backfill antes del merge). Produccion no cambia en esta spec.
- **Verificacion de cierre (T-07/T-08, 2026-10-30):** suite 1644/1644 tests en 85 archivos, `tsc --noEmit` 0 errores, lint 18 errores/18 warnings (baseline preexistente) y `next build` PASS. El smoke manual de staging (T-09) queda pendiente y no altera el PASS de implementacion.
