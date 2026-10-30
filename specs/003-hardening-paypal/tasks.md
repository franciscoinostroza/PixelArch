# Tareas 003: Hardening posterior a T-37/002 (H-5, H-6, H-7, H-8, H-9)

**Spec:** ./spec.md · **Plan:** ./plan.md · **Evidencia H-6:** ./h6-mp-firmas.md
**Rama:** `paypal-staging` · **Gate:** no merge a `main` ni deploy a produccion antes de T-38. T-38 no esta autorizado.
**Restricciones:** no se toca `prisma/schema.prisma`, envs, `Dockerfile`, `package.json` ni `railway.toml`.
No se rota `MP_WEBHOOK_SECRET`, no se desactiva la firma de MP y no se toca el panel de Mercado Pago.
H-6 incluye codigo acotado (hardening del webhook MP) ademas del expediente documental.

Formato: `- [ ] T-XX (AC-x) descripcion · archivos · dependencias`.
Una tarea = un cambio revisable (~1 commit). El implementer hace una por ciclo; tester y reviewer validan antes de marcar `[x]`.
H-6 se verifica con el checklist del expediente (evidencia) y con tests de ruta (hardening).

## Fase 1: Higiene y base publica

- [x] **T-01 (AC-H9-1, AC-H9-2, AC-H9-3, AC-H9-4) Ignorar `.railway/`**
  - **Estado:** PASS tester+reviewer — `.railway/` ignorado, sin archivos versionados y diff solo de repo/docs.
  - Agregar a `.gitignore`, en una seccion propia:
    ```gitignore
    # railway (estado local de la CLI)
    .railway/
    ```
  - Verificar que no haya archivos versionados: `git ls-files .railway` (debe estar vacio). Si devuelve algo, `git rm -r --cached .railway` en la misma tarea, sin borrar el directorio local.
  - Verificar: `git check-ignore -v .railway/config.json` (debe matchear `.railway/`), `git status --short` (no debe mostrar `.railway/`), y que el diff solo toque `.gitignore` y docs.
  - **Hecho cuando:** el chequeo de ignore pasa, no hay archivos versionados de `.railway/` y el diff no toca `src/**`, `Dockerfile`, `package.json`, `railway.toml` ni envs.
  - **Deps:** ninguna.
  - **Nota:** H-9 no dispara build (docs-only por watchPatterns). No se agrega test de repo; la evidencia es `git check-ignore` + `git status`.

- [x] **T-02 (AC-H8-1 a AC-H8-9) Redireccion segura con base publica invalida**
  - En `src/lib/paypal/utils.ts` agregar:
    - `LocationEstadoPublico` (`location: string`, `absoluta: boolean`);
    - `construirLocationEstado(configurada, requestUrl, token, estado)`:
      - usa `resolverBaseUrlPublica`;
      - con base valida construye la ruta absoluta con `new URL("/pago/paypal/estado", base)` (misma semantica que hoy) y setea `token`/`estado`;
      - sin base valida devuelve `/pago/paypal/estado?token=...&estado=...` relativa;
      - usa `URLSearchParams` para codificar el token; no acepta host/esquema/path del usuario.
  - Reemplazar el `urlEstado` local de `src/app/pago/paypal/[token]/route.ts`, `src/app/pago/paypal/retorno/route.ts` y `src/app/pago/paypal/cancelado/route.ts` por `construirLocationEstado`.
    - `redirigirEstado` debe devolver un 302 con `Location` manual (`new NextResponse(null, { status: 302, headers: { ...HEADERS_SEGURIDAD, Location: location } })`) para permitir el valor relativo.
    - Eliminar el `?? req.url` de los tres ayudantes.
  - En `[token]`, la creacion de la orden sigue usando `resolverBaseUrlPublica` sin fallback: si devuelve `null`, no llamar a `createOrder` y redirigir a `error` (ahora relativo).
  - `src/app/api/admin/paypal/link/route.ts` no requiere cambio de codigo: ya devuelve 400 si no hay base. Agregar test con env invalida.
  - Tests:
    - `src/__tests__/lib/paypal-utils.test.ts`: env valida, env invalida, env ausente + origin publico, env ausente + origin interno, credenciales/query/fragmento; `construirLocationEstado` absoluto/relativo; sin `0.0.0.0`.
    - `src/__tests__/api/paypal-public.test.ts`: extender el bloque "redirect a estado detras del proxy" con env invalida (`no-es-url`, `http://pixelarch.dev`, `https://user:pass@pixelarch.dev`) y origin interno; `[token]` sin checkout vigente no llama `createOrder`; retorno procesa y redirige relativo; cancelado registra el evento y redirige relativo. Actualizar el helper `redirect()` (`new URL(location)`) para aceptar `Location` relativo con una base ficticia; con `Location` absoluto el resultado no cambia.
    - `src/__tests__/api/admin/paypal-link.test.ts`: env invalida -> 400, sin crear enlace/orden.
  - **Hecho cuando:** los tests focalizados pasan, el `Location` no contiene `0.0.0.0` ni host interno, y una env valida sigue produciendo `Location` absoluto normalizado.
  - **Deps:** ninguna.
  - **Nota:** no tocar `sitemap.ts`, `robots.ts`, `rss.xml`, `cron/uptime`, `mercadopago.ts` ni `admin/entregar` (R-9 del plan).

## Fase 2: Estado publico

- [x] **T-03 (AC-H5-1 a AC-H5-8) "Pago en revision" en la pagina publica**
  - En `src/lib/paypal/utils.ts` agregar:
    - `EstadoPublicoPaypal` (`pendiente | pagado | revision | vencido | invalidado | error`);
    - `EnlaceEstadoPublico` (extiende `ConceptoEnlacePaypal` con `estado` y `expiraEn`);
    - `resolverEstadoPublicoEnlace(enlace, { pagoEnRevision? })`:
      - `pagoEnRevision === true` -> `"revision"` (primera regla);
      - reutiliza `resolverEstadoEnlace` y `evaluarConceptoEnlace` para el resto;
      - no duplica reglas ni conoce React/Prisma.
  - En `src/app/pago/paypal/estado/page.tsx`:
    - agregar `pagos: { estadoPago: string }[]` a `EnlacePublico`;
    - agregar al `select` de `prisma.enlacePago.findUnique` la relacion `pagos: { where: { estadoPago: "REVISION" }, select: { estadoPago: true }, take: 1 }`;
    - agregar `revision` a `ESTADOS` con titulo "Pago en revision", detalle "Estamos revisando el pago. No es necesario volver a pagar.", `Clock3` y color ambar (no `CheckCircle2`);
    - `ESTADOS_QUERY` no acepta `revision`; sigue aceptando solo `pendiente`, `pagado`, `vencido`, `invalidado`, `error`;
    - reemplazar el `switch` local por `resolverEstadoPublicoEnlace(enlace, { pagoEnRevision })`;
    - conservar `if (estadoQuery === "error") estado = "error"`;
    - no cambiar concepto, monto, markup, `role="status"`, metadata ni headers.
  - No tocar `/pago/paypal/retorno`: ya devuelve `pendiente` para `REVISION`. Cubrirlo con test de integracion.
  - Tests:
    - `src/__tests__/lib/paypal-utils.test.ts`: matriz de estados, `pagoEnRevision` gana sobre `PAGADO`, regresion de `ACTIVO`/hito/soporte/vencido/invalidado/fallido.
    - `src/__tests__/api/paypal-public.test.ts`:
      - actualizar el fixture `enlace()` con `pagos: []` por defecto;
      - actualizar el test exacto del `select` para incluir `pagos` filtrado;
      - `PAGADO` + `pagos: [{ estadoPago: "REVISION" }]` -> "Pago en revision", sin "Pago acreditado", sin `REVISION`, `revisionNota` ni PII;
      - `PAGADO` + `SUCCEEDED` -> "Pago acreditado";
      - `PAGADO` sin `pagos` -> "Pago acreditado";
      - `?estado=pagado` + `REVISION` -> "Pago en revision"; `?estado=error` -> error;
      - retorno `REVISION` -> `Location` con `estado=pendiente`; render posterior -> "Pago en revision";
      - `findUnique` llamado una vez; el select no trae cliente, notas ni revision; conserva `hitoId`/`suscripcionId` para el concepto y no agrega ids internos nuevos.
  - **Hecho cuando:** los tests focalizados pasan, la pagina muestra "Pago en revision" en el caso `REVISION` y conserva el resto de los estados.
  - **Deps:** T-02 (comparten `src/lib/paypal/utils.ts` y `src/__tests__/api/paypal-public.test.ts`).

## Fase 3: Webhooks PayPal y Mercado Pago

- [x] **T-04 (AC-H7-1 a AC-H7-10) Limite y hardening del webhook PayPal**
  - **Estado:** PASS tester+reviewer — 429/413/401 tempranos sin verificar ni escribir, 503 no consume presupuesto, eventos verificados intactos y logs sin IP/PII.
  - **Recomendaciones no bloqueantes:** evaluar `debug` para el `429` de PayPal (hoy `warn`, en linea con MP); la lectura de IP (`x-forwarded-for`/`x-real-ip`) esta duplicada con MP y podria compartirse en un helper.
  - Crear `src/lib/paypal/webhook-limit.ts`:
    - constantes `WEBHOOK_SOLICITUDES_MAX = 300`, `WEBHOOK_SOLICITUDES_VENTANA_MS = 60_000`, `WEBHOOK_FALLOS_MAX = 20`, `WEBHOOK_FALLOS_VENTANA_MS = 10 * 60_000`, `WEBHOOK_CUERPO_MAX_BYTES = 256 * 1024`, `WEBHOOK_MAX_CLAVES = 10_000`;
    - `ResultadoLimiteWebhook`, `LimitadorWebhook`, `crearLimitadorWebhook({ ahora?, ... })` con ventanas inyectables;
    - `permitir(clave)`: revisa fallos, incrementa solicitudes y devuelve `motivo` + `retryAfterSegundos`;
    - `registrarFallo(clave)`, `registrarExito(clave)` (limpia fallos, no solicitudes);
    - mapa acotado a `WEBHOOK_MAX_CLAVES` con evacuacion de la entrada mas antigua;
    - singleton `limitadorWebhookPaypal` y `reiniciarLimitadorWebhookPaypal()` (solo tests);
    - `cuerpoExcedeLimite(contentLength, cuerpo)`: header valido que supera el maximo, o cuerpo ya leido cuyo `Buffer.byteLength(cuerpo, "utf8")` supera el maximo.
  - Modificar `src/app/api/webhooks/paypal/route.ts` en este orden:
    1. `paypalConfig()` -> 503 si no esta disponible (sin limite).
    2. `ipDe(req)` local (`x-forwarded-for` primera, `x-real-ip`, `"desconocida"`); no loguear la IP.
    3. `limitadorWebhookPaypal.permitir(ip)` -> 429 con `Retry-After` y `no-store`, sin verificar ni escribir evento.
    4. `Content-Length` > maximo -> 413, sin leer, verificar ni escribir evento.
    5. Headers faltantes -> 401 + `registrarFirmaInvalida(HEADERS_INCOMPLETOS)` + `registrarFallo(ip)`.
    6. Leer cuerpo; si excede el maximo -> 413 (sin evento ni fallo); si falla la lectura -> 401 + `CUERPO_INVALIDO` + `registrarFallo(ip)`.
    7. JSON/evento invalido -> 401 + evento + `registrarFallo(ip)`.
    8. Verificacion:
       - `VALIDACION` -> 401 + evento + fallo;
       - error de red/timeout/HTTP -> 503 sin evento ni fallo;
       - `!verificado` -> 401 + evento + fallo;
       - verificado -> `registrarExito(ip)`.
    9. Procesar -> 200/500 sin contar fallo.
  - Mantener `json()` con `no-store` y extenderlo para headers extra o agregar un helper de 429/413.
  - Tests:
    - `src/__tests__/lib/paypal-webhook-limit.test.ts`: 300/301 solicitudes; 20/21 fallos; reinicio de ventana; exito limpia fallos; `retryAfterSegundos`; `Content-Length` y bytes UTF-8; mapa acotado.
    - `src/__tests__/api/webhooks/paypal.test.ts`: 429 sin `verifyWebhookSignature` ni `eventoCreate`; 401 dentro del presupuesto con evento; 503 por timeout no consume fallo; 413 sin parseo/verify/evento; sin headers -> 401 antes de verificar; verificado -> 200/500 como hoy; IP A bloqueada no afecta a IP B.
    - `src/__tests__/api/webhooks/paypal-resiliencia.test.ts`: revisar que los casos de timeout/error sigan verdes.
    - `src/__tests__/api/mercadopago-coexistencia.test.ts` y `mercadopago.test.ts`: sin cambios, como regresion.
  - **Hecho cuando:** los tests focalizados pasan; el webhook conserva 200/401/500/503 verificados; el 429/413 no escribe eventos ni toca pagos.
  - **Deps:** ninguna (puede ir en paralelo con T-02/T-03/T-06).
  - **Nota:** no se agregan envs; los umbrales viven en codigo. El limitador es best-effort (R-5).

## Fase 4: H-6 — firmas MP

- [x] **T-05 (AC-H6-1, AC-H6-2, AC-H6-3) Expediente de evidencia de firmas MP**
  - **Estado:** PASS tester+reviewer (checklist documental) — URL/endpoint staging, secreto confirmado sin valor, warnings 08:35/08:51 sin pago, eventos A/B y decision de hardening; sin PII ni secretos.
  - **Recomendacion no bloqueante:** completar en la matriz el identificador de cuenta/aplicacion MP de staging cuando el dueno lo aporte (hoy queda sin registrar).
  - Crear `h6-mp-firmas.md` con:
    1. alcance y metodo;
    2. entorno staging: `https://staging.pixelarch.dev`, endpoint `https://staging.pixelarch.dev/api/webhooks/mercadopago`, evento `Pagos`, secreto presente y coincidente (confirmado por el dueno, sin valor);
    3. warnings `Webhook MP con firma invalida` de 08:35 y 08:51 sin pago asociado (sin `Pago`, sin cambio de hito/soporte) y la IPN vacia como ruido/legacy;
    4. eventos validos de Coexistencia A/B del paso 11 procesados (prueba de que URL/secreto funcionan);
    5. matriz staging/produccion y verificacion de firma contra el SDK `mercadopago` 3.6.1;
    6. hipotesis confirmadas/rechazadas/no determinadas (secreto, otra cuenta/aplicacion, prueba del panel, IPN legacy, SDK/algoritmo, reloj);
    7. decision y datos faltantes (fecha/zona exacta y emisor de los POSTs);
    8. anexo de fuentes y comandos sin secretos.
  - No cambiar `MP_WEBHOOK_SECRET`, no desactivar la validacion, no tocar el panel.
  - Redactar PII/secretos: sin nombre, email, telefono, direccion, tarjeta, CBU/CVU, firma completa, certificado ni credencial.
  - **Hecho cuando:** el expediente contiene la URL/endpoint, la confirmacion del secreto sin valor, los warnings con/sin pago, los eventos A/B y la decision, y no hay PII ni secretos.
  - **Deps:** ninguna (la decision del dueno ya esta registrada).
  - **Nota:** los AC documentales se verifican con el checklist del expediente; no llevan test automatizado.

- [x] **T-06 (AC-H6-4 a AC-H6-8) Hardening del webhook de Mercado Pago**
  - **Estado:** PASS tester+reviewer — rechazos tempranos sin firma/consulta/escritura, `debug` sin PII, reset en firma valida y pago valido intacto.
  - **Recomendaciones no bloqueantes:** los tests de ruta de MP mockean `@/lib/rate-limit`, por lo que los umbrales reales 300/20 no se ejercitan a nivel ruta (si conviene, agregar un caso con umbrales reducidos inyectados); dejar explicita la precedencia `no-payment` -> `200 ignored` aun sin secreto; unificar con PayPal la lectura de headers de IP.
  - Modificar `src/app/api/webhooks/mercadopago/route.ts` reutilizando `src/lib/rate-limit.ts`:
    1. `rateLimitDetalle("webhook-mp:ip:<ip>", 300, 60_000)` al inicio; si no esta permitido -> `429` con `Retry-After` y `no-store`, sin parsear, sin firma, sin consultar MP y sin escribir.
    2. Parsear JSON como hoy (`400` si es invalido).
    3. `dataId = query data.id || body.data.id`.
    4. Si `body.type !== "payment"` o falta `dataId` -> `200 { ok: true, ignored: true }` **antes** de la firma (topics plan/merchant order e IPN vacia), sin validar, sin consultar MP y sin escribir.
    5. Sin secreto: conservar `503` en produccion y el aviso en desarrollo.
    6. `rateLimitEstado("webhook-mp:firma:<ip>", 20, 10 * 60_000)`; si esta excedido -> `429` antes de validar la siguiente firma.
    7. `WebhookSignatureValidator.validate(...)`; en `InvalidWebhookSignatureError`: `rateLimit(...)`, `logger.debug("Webhook MP con firma invalida")` sin `data.id`/firma/IP/PII y `401 { error: "Firma invalida" }`.
    8. Firma valida: `resetRateLimit("webhook-mp:firma:<ip>")` y continuar con el procesamiento actual sin cambios.
  - No agregar tope de cuerpo (`413`), envs ni modulos nuevos. No tocar la firma, la idempotencia, los montos, los meses, los links ni los emails.
  - Tests:
    - `src/__tests__/api/webhooks/mercadopago.test.ts`: topic ajeno y `payment` sin `data.id` ignorados antes de la firma; `429` por limite sin validar/consultar/escribir; `401` dentro del presupuesto con log `debug` sin PII; `20/21` firmas invalidas -> `429`; otro origen no se ve afectado; firma valida limpia (`resetRateLimit`) y consulta MP como hoy.
    - `src/__tests__/lib/rate-limit.test.ts`: cubre la semantica de `rateLimitDetalle`/`rateLimitEstado`/`resetRateLimit` (ya existente).
    - Regresion: `src/__tests__/api/mercadopago-coexistencia.test.ts` y `mercadopago.test.ts` verdes; el camino de un `payment` valido no cambia.
  - **Hecho cuando:** los tests focalizados pasan; el 429 y el 200 ignorado no validan/consultan/escriben; el `payment` valido conserva `200`, un solo `Pago` y el reset del presupuesto.
  - **Deps:** ninguna (puede ir en paralelo con T-04).
  - **Nota:** el limitador es best-effort (R-15/R-17) y la firma sigue siendo obligatoria (D-H6-1).

## Fase 5: Cierre

- [ ] **T-07 (transversal) Documentacion y trazabilidad**
  - Actualizar `AGENTS.md` y `MEMORY.md`:
    - H-5/H-7/H-8/H-9 cerrados o en curso segun corresponda;
    - H-6 con su estado (evidencia + hardening) y el enlace al expediente;
    - sin cambios de esquema/envs; gate T-38 intacto;
    - limitadores best-effort, redireccion relativa y rechazos tempranos de MP como gotchas.
  - Revisar que cada AC de `spec.md` tenga al menos una tarea/test en este archivo; anotar desvios.
  - **Hecho cuando:** docs coherentes y matriz AC -> tarea completa.
  - **Deps:** T-01..T-06.

- [ ] **T-08 (AC-H5-8, AC-H6-9, AC-H7-8, AC-H7-10, AC-H8-7, AC-H9-4) Verificacion final**
  - Ejecutar `node node_modules\vitest\vitest.mjs run` (suite completa, sin watch).
  - Ejecutar `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint` (sin errores nuevos sobre el baseline) y `node node_modules\next\dist\bin\next build`.
  - Confirmar que los tests PayPal (webhook, proceso, idempotencia, links, recibo, pagina publica) y MP (webhook, Coexistencia A/B, links, recibo) siguen verdes y que no hay llamadas reales a PayPal/MP.
  - Revisar que H-6 no rota el secreto ni toca el panel, y que H-9 no disparo build.
  - **Hecho cuando:** suite/typecheck/build limpios; lint sin errores nuevos; resultados anotados para el reviewer.
  - **Deps:** T-01..T-07.

- [ ] **T-09 (AC-H5-1, AC-H5-4, AC-H6-5, AC-H7-1, AC-H8-2, AC-H9-2, AC-H9-3) Gate de staging (sin produccion)**
  - En `paypal-staging` (esquema ya aplicado):
    - abrir el link de un pago en `REVISION` de T-37 (paso 10) y verificar "Pago en revision", sin "Pago acreditado", sin PII ni estados internos;
    - verificar el retorno de un pago en revision (si hay un caso de staging) y que la pagina coincide;
    - enviar un webhook PayPal con firma invalida a staging y confirmar 401 y, tras agotar el presupuesto de prueba, 429 sin escritura de eventos (usar un origen de prueba; no afecta a PayPal real);
    - enviar al webhook MP un topic ajeno (`type: "plan"`) y confirmar `200` ignorado sin firma ni pago; opcionalmente, un POST con firma invalida de prueba y confirmar `401`/`429` sin crear `Pago`;
    - verificar `git check-ignore` de `.railway/`;
    - H-8 se valida con los tests de la suite (no cambiar `NEXT_PUBLIC_URL` de staging).
  - **No mergear a `main` ni deployar a produccion antes de T-38.**
  - **Hecho cuando:** checklist de staging completo y sin cambios de envs/schema.
  - **Deps:** T-08.

- [ ] **T-10 (sin AC de producto; gate operativo) T-38 (no autorizado)**
  - No es un commit. Solo se ejecuta con autorizacion explicita del dueno.
  - Orden obligatorio: `db push` + backfill en produccion **antes** del merge a `main`/auto-deploy; FF-merge de `paypal-staging` para conservar `139b8cb`; deploy con PayPal deshabilitado; envs/webhook live; smoke (health, admin, link MP, link PayPal de bajo monto si se aprueba, recibo MP, recibo PayPal, pagina de estado en revision); monitoreo.
  - Rollback: quitar envs PayPal y revertir el deploy.
  - **Hecho cuando:** T-38 autorizado y ejecutado en ese orden; hasta entonces queda `[ ]`.
  - **Deps:** T-09 + autorizacion del dueno.

## Cobertura AC -> tarea y test

| AC | Tareas | Test principal |
|----|--------|----------------|
| AC-H5-1 | T-03, T-09 | `paypal-utils.test.ts` + `paypal-public.test.ts` (PAGADO + REVISION) |
| AC-H5-2 | T-03 | `paypal-public.test.ts` (PAGADO + SUCCEEDED) |
| AC-H5-3 | T-03 | `paypal-public.test.ts` (PAGADO sin pago) |
| AC-H5-4 | T-03, T-09 | `paypal-public.test.ts` (retorno REVISION + pagina) |
| AC-H5-5 | T-03 | `paypal-public.test.ts` (`?estado=pagado` / `?estado=error`) |
| AC-H5-6 | T-03 | `paypal-public.test.ts` (select exacto, sin PII ni ids adicionales) |
| AC-H5-7 | T-03 | `paypal-public.test.ts` (sin REVISION -> estado resultante) |
| AC-H5-8 | T-03, T-08 | `paypal-public.test.ts` (estados existentes) + suite |
| AC-H6-1 | T-05 | checklist: URL/endpoint, secreto sin valor, warnings 08:35/08:51 sin pago, eventos A/B |
| AC-H6-2 | T-05 | checklist: warnings clasificados con evidencia, sin causa inventada |
| AC-H6-3 | T-05 | checklist: decision de hardening, sin rotar secreto/panel/firma, sin PII |
| AC-H6-4 | T-06 | `mercadopago.test.ts` (topic ajeno / sin `data.id`) |
| AC-H6-5 | T-06, T-09 | `mercadopago.test.ts` (429 por solicitudes) |
| AC-H6-6 | T-06 | `mercadopago.test.ts` (20/21 firmas, otro origen) |
| AC-H6-7 | T-06 | `mercadopago.test.ts` (401 + `debug` sin PII) |
| AC-H6-8 | T-06 | `mercadopago.test.ts` (firma valida limpia y procesa) |
| AC-H6-9 | T-06, T-08 | `mercadopago-coexistencia.test.ts` + suite (A/B, links, montos, recibo, 503 sin secreto) |
| AC-H7-1 | T-04, T-09 | `paypal-webhook-limit.test.ts` + `paypal.test.ts` (300/301) |
| AC-H7-2 | T-04 | `paypal-webhook-limit.test.ts` + `paypal.test.ts` (20/21) |
| AC-H7-3 | T-04 | `paypal.test.ts` (IP A/IP B) |
| AC-H7-4 | T-04 | `paypal.test.ts` (401 + evento) |
| AC-H7-5 | T-04 | `paypal.test.ts` (503 no cuenta) |
| AC-H7-6 | T-04 | `paypal-webhook-limit.test.ts` + `paypal.test.ts` (413) |
| AC-H7-7 | T-04 | `paypal.test.ts` (headers faltantes) |
| AC-H7-8 | T-04, T-08 | `paypal.test.ts` + `paypal-resiliencia.test.ts` (200/500) |
| AC-H7-9 | T-04 | `paypal.test.ts` (logs sin PII/IP) |
| AC-H7-10 | T-04, T-06, T-08 | `mercadopago*.test.ts` (un pago valido no cambia) |
| AC-H8-1 | T-02 | `paypal-utils.test.ts` (env invalida -> null) |
| AC-H8-2 | T-02, T-09 | `paypal-public.test.ts` (`Location` relativo) |
| AC-H8-3 | T-02 | `paypal-public.test.ts` (sin `createOrder`) |
| AC-H8-4 | T-02 | `paypal-public.test.ts` (retorno) |
| AC-H8-5 | T-02 | `paypal-public.test.ts` (cancelado) |
| AC-H8-6 | T-02 | `admin/paypal-link.test.ts` (400) |
| AC-H8-7 | T-02, T-08 | `paypal-utils.test.ts` + `paypal-public.test.ts` (env valida) |
| AC-H8-8 | T-02 | `paypal-utils.test.ts` (sin env publico/interno) |
| AC-H8-9 | T-02 | `paypal-utils.test.ts` + rutas (ruta fija, token codificado) |
| AC-H9-1 | T-01 | `git check-ignore` / contenido de `.gitignore` |
| AC-H9-2 | T-01, T-09 | `git check-ignore` + `git status` |
| AC-H9-3 | T-01, T-09 | `git ls-files .railway` |
| AC-H9-4 | T-01, T-08 | diff del commit + suite |

## Notas de ejecucion

- Comandos: `node node_modules\vitest\vitest.mjs run`, `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint`, `node node_modules\next\dist\bin\next build`.
- Tests focalizados sugeridos:
  - H-9: `git check-ignore -v .railway/config.json`.
  - H-8: `node node_modules\vitest\vitest.mjs run src/__tests__/lib/paypal-utils.test.ts src/__tests__/api/paypal-public.test.ts src/__tests__/api/admin/paypal-link.test.ts`.
  - H-5: `node node_modules\vitest\vitest.mjs run src/__tests__/lib/paypal-utils.test.ts src/__tests__/api/paypal-public.test.ts`.
  - H-7: `node node_modules\vitest\vitest.mjs run src/__tests__/lib/paypal-webhook-limit.test.ts src/__tests__/api/webhooks/paypal.test.ts src/__tests__/api/webhooks/paypal-resiliencia.test.ts`.
  - H-6: `node node_modules\vitest\vitest.mjs run src/__tests__/api/webhooks/mercadopago.test.ts src/__tests__/lib/rate-limit.test.ts src/__tests__/api/mercadopago-coexistencia.test.ts`.
- No usar `npm test` en watch; no tocar la base real; mockear Prisma, PayPal, MP y navegacion.
- Marcar `[x]` solo despues de tester + reviewer. Si un AC cambia, actualizar spec/plan/tasks en el mismo cambio.
- T-05 y T-06 se marcan `[x]` solo con el checklist del expediente y los tests de ruta aprobados por tester/reviewer.
- **No mergear a `main` ni deployar a produccion antes de T-38.** T-38 no esta autorizado en esta sesion.
- PASS tester+reviewer (T-03/H-5): 122 tests, tsc 0; revisionEstado=RECHAZADO sigue mostrando "Pago en revision" (coherente con el plan); en ese momento T-02 seguia pendiente por construirLocationEstado/retorno.
- PASS tester+reviewer (T-02/H-8): 190 tests, tsc 0; Location relativo seguro, sin 0.0.0.0 ni open redirect; admin/paypal/link falla cerrado.
- PASS tester+reviewer (T-04/H-7): 429/413/401 tempranos sin verificar ni escribir, 503 no consume presupuesto, eventos verificados 200/500 intactos y logs sin IP/PII. No bloqueante: `429` PayPal en `warn` (evaluar `debug`) y helper de IP compartido con MP.
- PASS tester+reviewer (T-05/H-6 evidencia): checklist completo (URL/endpoint, secreto sin valor, warnings 08:35/08:51 sin pago, A/B, decision) y sin PII ni secretos. No bloqueante: completar el identificador de cuenta/aplicacion MP en la matriz.
- PASS tester+reviewer (T-06/H-6 hardening MP): topic ajeno/sin `data.id` ignorados antes de la firma, 429 sin validar/consultar/escribir, `401` con `debug` sin PII, reset en firma valida y pago valido intacto. No bloqueante: umbrales reales de MP no ejercitados a nivel ruta (rate limit mockeado), precedencia `no-payment` sin secreto y helper de IP compartido.
- PASS tester+reviewer (T-01/H-9): `.railway/` ignorado, `git ls-files .railway` vacio y diff solo de repo/docs.
