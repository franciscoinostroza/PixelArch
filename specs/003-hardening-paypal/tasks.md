# Tareas 003: Hardening posterior a T-37/002 (H-5, H-6, H-7, H-8, H-9)

**Spec:** ./spec.md · **Plan:** ./plan.md
**Rama:** `paypal-staging` · **Gate:** no merge a `main` ni deploy a produccion antes de T-38. T-38 no esta autorizado.
**Restricciones:** no se toca `prisma/schema.prisma`, envs, `Dockerfile`, `package.json` ni `railway.toml`. No se cambia el webhook de Mercado Pago. H-6 no implementa codigo.

Formato: `- [ ] T-XX (AC-x) descripcion · archivos · dependencias`.
Una tarea = un cambio revisable (~1 commit). El implementer hace una por ciclo; tester y reviewer validan antes de marcar `[x]`.
H-6 es una investigacion: su "test" es el checklist documental del expediente, no un test automatizado.

## Fase 1: Higiene y base publica

- [ ] **T-01 (AC-H9-1, AC-H9-2, AC-H9-3, AC-H9-4) Ignorar `.railway/`**
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

## Fase 3: Webhook PayPal

- [ ] **T-04 (AC-H7-1 a AC-H7-10) Limite y hardening del webhook PayPal**
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
  - **Deps:** ninguna (puede ir en paralelo con T-02/T-03).
  - **Nota:** no se agregan envs; los umbrales viven en codigo. El limitador es best-effort (R-5).

## Fase 4: Investigacion

- [ ] **T-05 (AC-H6-1 a AC-H6-6) Expediente de firmas de Mercado Pago**
  - Crear `specs/003-hardening-paypal/h6-mp-firmas.md` con las secciones del plan §2.5:
    1. alcance y metodo;
    2. matriz staging/produccion (cuenta/aplicacion, URL de webhook, eventos, secreto presente/rotado, aislamiento);
    3. 3-5 muestras redactadas por tipo (firma invalida e IPN vacia), con fecha/hora, entorno, URL sin secretos, headers relevantes, `data.id`, respuesta HTTP y real vs prueba;
    4. verificacion de firma contra docs/SDK (`mercadopago`), `ts`, `v1`, origen de `data.id`, reloj;
    5. hipotesis confirmadas/rechazadas/evidencia insuficiente (secreto distinto, otra cuenta/aplicacion, notificacion de prueba, IPN legacy, SDK/algoritmo, reloj);
    6. conclusion y decision (configuracion, codigo con spec nueva/enmienda, o no accionar);
    7. datos faltantes;
    8. anexo de comandos/consultas sin secretos.
  - No cambiar `MP_WEBHOOK_SECRET`, no desactivar la validacion, no tocar el panel, no tocar `src/**`.
  - Redactar PII/secretos: sin nombre, email, telefono, direccion, tarjeta, CBU/CVU, firma completa ni credencial.
  - **Hecho cuando:** el expediente permite decidir o, si falta evidencia, lista exactamente que debe aportar el dueno y H-6 queda abierto. Si la decision requiere codigo, se abre una spec nueva; no se implementa en 003.
  - **Deps:** datos del panel del dueno (no bloquea T-01..T-04; T-06/T-07 pueden cerrar documentando H-6 abierto).
  - **Nota:** H-6 no lleva test automatizado; se verifica con el checklist del expediente.

## Fase 5: Cierre

- [ ] **T-06 (transversal) Documentacion y trazabilidad**
  - Actualizar `AGENTS.md` y `MEMORY.md`:
    - H-5/H-7/H-8/H-9 cerrados o en curso segun corresponda;
    - H-6 con su estado (abierto/decidido) y el enlace al expediente;
    - sin cambios de esquema/envs; gate T-38 intacto;
    - limitador best-effort y redireccion relativa como gotchas.
  - Revisar que cada AC de `spec.md` tenga al menos una tarea/test en este archivo; anotar desvios.
  - **Hecho cuando:** docs coherentes y matriz AC -> tarea completa.
  - **Deps:** T-01..T-05.

- [ ] **T-07 (AC-H5-8, AC-H7-8, AC-H7-10, AC-H8-7, AC-H9-4) Verificacion final**
  - Ejecutar `node node_modules\vitest\vitest.mjs run` (suite completa, sin watch).
  - Ejecutar `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint` (sin errores nuevos sobre el baseline) y `node node_modules\next\dist\bin\next build`.
  - Confirmar que los tests PayPal (webhook, proceso, idempotencia, links, recibo, pagina publica) y MP (webhook, coexistencia, links, recibo) siguen verdes y que no hay llamadas reales a PayPal/MP.
  - Revisar que H-6 no cambio codigo y que H-9 no disparo build.
  - **Hecho cuando:** suite/typecheck/build limpios; lint sin errores nuevos; resultados anotados para el reviewer.
  - **Deps:** T-01..T-06.

- [ ] **T-08 (AC-H5-1, AC-H5-4, AC-H7-1, AC-H8-2, AC-H9-2, AC-H9-3) Gate de staging (sin produccion)**
  - En `paypal-staging` (esquema ya aplicado):
    - abrir el link de un pago en `REVISION` de T-37 (paso 10) y verificar "Pago en revision", sin "Pago acreditado", sin PII ni estados internos;
    - verificar el retorno de un pago en revision (si hay un caso de staging) y que la pagina coincide;
    - enviar un webhook PayPal con firma invalida a staging y confirmar 401 y, tras agotar el presupuesto de prueba, 429 sin escritura de eventos (usar un origen de prueba; no afecta a PayPal real);
    - verificar `git check-ignore` de `.railway/`;
    - H-8 se valida con los tests de la suite (no cambiar `NEXT_PUBLIC_URL` de staging).
  - **No mergear a `main` ni deployar a produccion antes de T-38.**
  - **Hecho cuando:** checklist de staging completo y sin cambios de envs/schema.
  - **Deps:** T-07.

- [ ] **T-09 (sin AC de producto; gate operativo) T-38 (no autorizado)**
  - No es un commit. Solo se ejecuta con autorizacion explicita del dueno.
  - Orden obligatorio: `db push` + backfill en produccion **antes** del merge a `main`/auto-deploy; FF-merge de `paypal-staging` para conservar `139b8cb`; deploy con PayPal deshabilitado; envs/webhook live; smoke (health, admin, link MP, link PayPal de bajo monto si se aprueba, recibo MP, recibo PayPal, pagina de estado en revision); monitoreo.
  - Rollback: quitar envs PayPal y revertir el deploy.
  - **Hecho cuando:** T-38 autorizado y ejecutado en ese orden; hasta entonces queda `[ ]`.
  - **Deps:** T-08 + autorizacion del dueno.

## Cobertura AC -> tarea y test

| AC | Tareas | Test principal |
|----|--------|----------------|
| AC-H5-1 | T-03, T-08 | `paypal-utils.test.ts` + `paypal-public.test.ts` (PAGADO + REVISION) |
| AC-H5-2 | T-03 | `paypal-public.test.ts` (PAGADO + SUCCEEDED) |
| AC-H5-3 | T-03 | `paypal-public.test.ts` (PAGADO sin pago) |
| AC-H5-4 | T-03, T-08 | `paypal-public.test.ts` (retorno REVISION + pagina) |
| AC-H5-5 | T-03 | `paypal-public.test.ts` (`?estado=pagado` / `?estado=error`) |
| AC-H5-6 | T-03 | `paypal-public.test.ts` (select exacto, sin PII ni ids adicionales) |
| AC-H5-7 | T-03 | `paypal-public.test.ts` (sin REVISION -> estado resultante) |
| AC-H5-8 | T-03, T-07 | `paypal-public.test.ts` (estados existentes) + suite |
| AC-H7-1 | T-04, T-08 | `paypal-webhook-limit.test.ts` + `paypal.test.ts` (300/301) |
| AC-H7-2 | T-04 | `paypal-webhook-limit.test.ts` + `paypal.test.ts` (20/21) |
| AC-H7-3 | T-04 | `paypal.test.ts` (IP A/IP B) |
| AC-H7-4 | T-04 | `paypal.test.ts` (401 + evento) |
| AC-H7-5 | T-04 | `paypal.test.ts` (503 no cuenta) |
| AC-H7-6 | T-04 | `paypal-webhook-limit.test.ts` + `paypal.test.ts` (413) |
| AC-H7-7 | T-04 | `paypal.test.ts` (headers faltantes) |
| AC-H7-8 | T-04, T-07 | `paypal.test.ts` + `paypal-resiliencia.test.ts` (200/500) |
| AC-H7-9 | T-04 | `paypal.test.ts` (logs sin PII/IP) |
| AC-H7-10 | T-04, T-07 | `mercadopago*.test.ts` (regresion) |
| AC-H8-1 | T-02 | `paypal-utils.test.ts` (env invalida -> null) |
| AC-H8-2 | T-02, T-08 | `paypal-public.test.ts` (`Location` relativo) |
| AC-H8-3 | T-02 | `paypal-public.test.ts` (sin `createOrder`) |
| AC-H8-4 | T-02 | `paypal-public.test.ts` (retorno) |
| AC-H8-5 | T-02 | `paypal-public.test.ts` (cancelado) |
| AC-H8-6 | T-02 | `admin/paypal-link.test.ts` (400) |
| AC-H8-7 | T-02, T-07 | `paypal-utils.test.ts` + `paypal-public.test.ts` (env valida) |
| AC-H8-8 | T-02 | `paypal-utils.test.ts` (sin env publico/interno) |
| AC-H8-9 | T-02 | `paypal-utils.test.ts` + rutas (ruta fija, token codificado) |
| AC-H9-1 | T-01 | `git check-ignore` / contenido de `.gitignore` |
| AC-H9-2 | T-01, T-08 | `git check-ignore` + `git status` |
| AC-H9-3 | T-01, T-08 | `git ls-files .railway` |
| AC-H9-4 | T-01, T-07 | diff del commit + suite |
| AC-H6-1 | T-05 | checklist: muestras redactadas |
| AC-H6-2 | T-05 | checklist: matriz de entornos |
| AC-H6-3 | T-05 | checklist: hipotesis |
| AC-H6-4 | T-05 | checklist: decision / spec nueva |
| AC-H6-5 | T-05 | checklist: redaccion |
| AC-H6-6 | T-05 | checklist: datos faltantes |

## Notas de ejecucion

- Comandos: `node node_modules\vitest\vitest.mjs run`, `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint`, `node node_modules\next\dist\bin\next build`.
- Tests focalizados sugeridos:
  - H-9: `git check-ignore -v .railway/config.json`.
  - H-8: `node node_modules\vitest\vitest.mjs run src/__tests__/lib/paypal-utils.test.ts src/__tests__/api/paypal-public.test.ts src/__tests__/api/admin/paypal-link.test.ts`.
  - H-5: `node node_modules\vitest\vitest.mjs run src/__tests__/lib/paypal-utils.test.ts src/__tests__/api/paypal-public.test.ts`.
  - H-7: `node node_modules\vitest\vitest.mjs run src/__tests__/lib/paypal-webhook-limit.test.ts src/__tests__/api/webhooks/paypal.test.ts src/__tests__/api/webhooks/paypal-resiliencia.test.ts`.
- No usar `npm test` en watch; no tocar la base real; mockear Prisma, PayPal y navegacion.
- Marcar `[x]` solo despues de tester + reviewer. Si un AC cambia, actualizar spec/plan/tasks en el mismo cambio.
- H-6 no se marca `[x]` hasta tener el expediente y la decision (o el cierre como "abierto con datos faltantes").
- **No mergear a `main` ni deployar a produccion antes de T-38.** T-38 no esta autorizado en esta sesion.
- PASS tester+reviewer: 122 tests, tsc 0; revisionEstado=RECHAZADO sigue mostrando "Pago en revision" (coherente con el plan); T-02 pendiente por construirLocationEstado/retorno.
- PASS tester+reviewer (T-02/H-8): 190 tests, tsc 0; Location relativo seguro, sin 0.0.0.0 ni open redirect; admin/paypal/link falla cerrado.
