# MEMORY.md — Memoria operativa del agente

> **AGENTS.md** = que es el proyecto y en que estado esta.
> **MEMORY.md** = como trabajar en el (workflow, comandos, gotchas, lecciones).
> Actualizar al final de cada sesion con lo aprendido.

**Ultima actualizacion:** 2026-10-30

---

## Como trabaja el dueno (Franco)

- Habla **espanol**; respuestas concisas, sin relleno.
- Flujo preferido: **preview local** (`preview/*.html`) → aprueba → implementar → verificar → **commit + push** (siempre pushea).
- Las decisiones se aprueban con **opciones** (tool de preguntas), no con texto libre.
- Le gustan las **fotos reales** (no ilustraciones genericas), **ARS grande + US$ chico**, y revisar visualmente (el agente no puede ver imagenes: verificar con el).
- Commits en espanol, estilo `feat:`, `fix:`, `docs:`, `content:`, `chore:`.
- No commitear sin pedir. El push dispara deploy automatico en Railway.

## Flujo SDD (OpenCode)

- Agente por defecto: **coordinator** (`opencode.json`). Subagentes en `.opencode/agents/`: planner, implementer, tester, reviewer.
- Comandos: `/specify <idea>`, `/plan <NNN>`, `/implement <NNN>`, `/verify <NNN>`.
- Artefactos: `specs/NNN-slug/{spec,plan,tasks,review}.md`; plantillas en `specs/_templates/`; principios en `specs/constitution.md`.
- Nada se implementa sin spec aprobada. Una tarea por ciclo: implementer → tester → reviewer; `[x]` en `tasks.md` solo al aprobar.
- Permisos: coordinator no edita; planner solo `specs/**`; tester solo tests (`src/__tests__/`, `tests/**`, `*.test.*`, `*.spec.*`); reviewer read-only. El `review.md` lo guarda el planner.
- Permisos endurecidos: coordinator solo lectura + question; subagentes con task: deny; tester solo tests; reviewer solo lectura.
- Comandos de verificacion: `node node_modules\vitest\vitest.mjs run`, `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint`, `npm run build`.
- Verificacion 19 oct 2026: `npm test` 148/148; `npm run build` OK; typecheck limpio tras regenerar `.next` (el fallo previo era `.next/types/validator.ts` obsoleto por la ruta debug-sentry eliminada); `npm run lint` sigue con 20 errores preexistentes de la app.
- Tras cambiar agentes/`opencode.json` hay que **reiniciar opencode** para que tome `default_agent`.
- Limite del hardening (best-effort): los globs de OpenCode no son sandbox. Quedan teoricos: redireccion `>`/`<`/`&`, scripts via `npm run*` y `node node_modules*`, y `.env*` anidado con el patron actual. No usar el flujo como aislamiento de seguridad.

## Comandos que funcionan (en esta maquina `npx` esta roto)

```powershell
node node_modules\typescript\bin\tsc --noEmit          # Type check
node node_modules\vitest\vitest.mjs run                # Tests
node node_modules\next\dist\bin\next build             # Build local
node node_modules\tsx\dist\cli.mjs src/scripts/<x>.ts  # Scripts propios
npm install / npm uninstall                            # npm si funciona
```

- PowerShell: `$HOME` es de solo lectura (usar otro nombre); scripts con comillas → here-string piped a `node`; encadenar con `cmd1; if ($?) { cmd2 }`; evitar `$:` en strings dobles.
- Si el build local se cuelga o falla con `module-not-found` de Google Fonts: es **transitorio**, reintentar.

## Railway (operaciones)

- Proyecto **PixelArch-Plataforma** `1f0ad07e-c893-42f9-a152-13559641b7b9`; servicio principal **PixelArch** `871fb7fb-789f-447e-9a9d-49b7b47cea27`.
- Functions: **uptime-cron** `88d898dd-e393-451e-82ef-25df34a97e42` (`*/10 * * * *`) · **digest-cobros** `ee8e67db-8b15-4787-b18b-2b34daa50939` (`0 12 * * *`).
- **Verificar deploy**: esperar 3-4 min → `railway deployment list --json` (status/commit) → `https://pixelarch.dev/api/health`.
- Build fallido transitorio → `railway redeploy --from-source -y`.
- `railway.toml` tiene **watchPatterns**: cambios solo en docs (AGENTS.md, MEMORY.md) → deploy **SKIPPED**. Para forzar build, tocar `src/**`, `Dockerfile`, `package.json`, etc.
- **Cambios de envs NO invalidan la cache Docker** → para un rebuild real hace falta un cambio de codigo en un path vigilado.
- Las **Functions programadas no corren al deployar** (solo en su horario); al crearlas corren una vez.
- Monitoreo: **solo** la Railway Function `uptime-cron` (el workflow de GitHub Actions se elimino: corria cada ~2-5h por el throttling de GitHub, no servia como respaldo).
- Copiar secretos entre servicios: `railway variables --json` → variable de shell → `--set` con output redirigido (nunca exponer en chat).
- Logs de build de un deployment puntual: MCP `get-logs` con `types: ["build"]` (el CLI no combina `--deployment` con `--build`).
- Si el disco se llena (`No space left on device`): limpiar `Temp`, cache npm y `.next`.

## Gotchas del codigo

- **Dockerfile**: toda var `NEXT_PUBLIC_*` debe declararse como `ARG` + `ENV` en el stage builder para llegar al build (leccion: el DSN de Sentry no llegaba al cliente por esto).
- **Sentry v11**: `withSentryConfig` se importa de `@sentry/nextjs/config` (no del root); `enableLogs` ya no existe; tunnel `/monitoring` (excluido del middleware); **release = `RAILWAY_GIT_COMMIT_SHA`** (ARG en builder + runner); source maps requieren `SENTRY_AUTH_TOKEN` (scope `project:releases`); `silent: false` deja los logs visibles en build.
- **Middleware** (`src/middleware.ts`): agregar toda pagina publica nueva a `ROUTES.public` o redirige al gate de Clerk; excluir `/monitoring` y rutas `api/*` en el matcher.
- **ISR ~60s**: cambios de Sanity tardan; revalidar al toque con `POST /api/revalidate` (header `x-revalidate-secret`).
- **Sanity covers**: `upload.wikimedia.org` bloquea (usar `thumb.wikimedia.org` + User-Agent); Unsplash (`images.unsplash.com`) funciona; verificar cada URL con fetch antes de usarla.
- **Montos en centavos** (`10000` = US$100); formatear con `formatearMonto`; precios publicos ARS primero.
- **Modelo de negocio**: proyectos por hitos + soporte mensual (no suscripciones por producto); links MP recordados 30 dias (`mpLink`/`mpLinkExpira`); webhook idempotente por `Pago.externalId`; eliminar hito solo si esta pendiente y sin pagos.
- **Clerk**: solo admin/asistente; `/admin` → rewrite a `/gate/admin` con modal (card primero, `openSignIn` al clic); sin registro publico.
- **CSS**: usar `@layer` para estilos base (leccion de sesiones previas: sin layer pisan todo).
- **Chat demo (PixelBot)**: intents en `src/lib/chat.ts`; cuidado con raices de regex (`cancel` root, no `cuanto` en precios).

## Gotchas PayPal (Oct 2026)

- **Link 30 d vs orden 3 h:** el link que se envia es `/pago/paypal/<token>` (30 dias, token opaco). Al abrirlo se crea o reutiliza una orden PayPal de 3 h; el checkout de PayPal nunca se envia al cliente y se renueva sin cambiar el link. El vencimiento del link se resuelve de forma perezosa.
- **Gross-up configurable:** `total = ceil((acordado + fijo) * 10000 / (10000 - bps))`; default **540 bps + 30 centavos = 5,40% + US$0,30** (`PAYPAL_FEE_BPS`/`PAYPAL_FEE_FIXED_CENTS`). La tarifa se snapshottea por link y por pago; no recalcular pagos historicos. Validar la tarifa real en sandbox.
- **Webhook:** `PAYPAL_WEBHOOK_ID` obligatorio; firma server-to-server con timeout de 4 s por llamada. Sin config 503; headers/firma invalidos 401 (evento tecnico sin PII); error de procesamiento 500 para reintento; duplicado/ignorado 200. Idempotencia por `EventoPasarela.eventoId` + `Pago.externalId`/`paypalOrderId`; refunds/reversiones/disputas solo marcan `requiereAccion` (sin automatismo).
- **Rol `asistente`:** existe solo como `publicMetadata.role = "asistente"` (sin alias `assistant`). `requireStaff()` habilita link/envio; la asistente solo entra a `/admin/clientes`, `/admin/cobros` y `/admin/pagos` (detalle y recibo incluidos) y `/admin` la manda a `/admin/cobros`. Registro manual, ajustes/reembolsos y revision quedan con `requireAdmin()`.
- **Rate limits:** APIs PayPal admin 20/min por IP; rutas publicas de pago 30/min por IP y 5/min por token. El limiter es en memoria (best-effort, no distribuido).
- **Hardening webhooks (spec 003):** PayPal 300/min + 20 fallos de autenticidad/10 min por IP + cuerpo maximo 256 KiB (`413`); MP 300/min + 20 firmas invalidas/10 min, topics que no son `payment`/sin `data.id` se ignoran con `200` **antes** de la firma y el log de firma invalida es `debug` sin PII. Los `429` son temporales/reintentables; sin envs nuevas.
- **Formato USD:** `formatearMonto` es-AR en CRM/recibos/digest (`US$100,50`, `US$1.000,50`); unica excepcion: plantilla EN con en-US (`US$100.50`). Centavos enteros; PayPal solo USD.
- **Evidencia y PII:** el registro manual acepta evidencia textual/URL (capture/order id, comprobante o nota), sin archivos ni storage. No se persisten email/nombre/direccion del pagador; el recibo usa los datos del cliente del CRM. Logs/Sentry solo ids, monto, moneda y estado; PII redactada.
- **Link publico:** `/pago/paypal/*` es publico, `no-store`, `no-referrer` y `noindex`; `/pago` y `/pago/(.*)` estan en `ROUTES.public` y los webhooks quedan fuera del matcher. El guest checkout depende de PayPal (`NO_PREFERENCE`).
- **Sin cambios de Dockerfile:** no hay `NEXT_PUBLIC_PAYPAL_*`; las envs PayPal son server-only y se inyectan en runtime. Solo haria falta `ARG`/`ENV` si algun dia se usa el JS SDK del lado cliente.
- **Estado de la BD / deploy:** staging ya tiene aplicado `db push` + backfill (`Postgres-gdmt`, separado de produccion) y quedo **validado en T-37** (PASS con observaciones, commit `139b8cb`, deploy `4c765526`; evidencia en `specs/001-paypal-pagos/review.md`). El hardening H-5..H-9 (spec 003) quedo **PASS tester+reviewer** en `paypal-staging`, sin schema/envs; T-09 (smoke de staging) pendiente. **Produccion no cambio**: sigue en `cdafe04` (`main` sin PayPal), sin migracion ni deploy. T-38 **no autorizado**: el orden obligatorio es `db push` + backfill en produccion **antes** del merge a `main`/auto-deploy (H-2), luego deploy con PayPal deshabilitado, envs/webhook live y smoke. FF-merge de `paypal-staging` para conservar `139b8cb`. Sin envs PayPal queda deshabilitado y MP sigue operativo.
- **Tests/verificacion:** `node node_modules\vitest\vitest.mjs run` (suite 1644/1644 en 85 archivos al 30 oct 2026, sin red; guard en `src/__tests__/setup.ts`), `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint` (18 errores/18 warnings preexistentes) y `node node_modules\next\dist\bin\next build` cuando se pida. No hay llamadas reales a PayPal/MP en CI; el sandbox es manual en Railway staging. El flake ocasional de `registrar-pago-paypal` no aparecio en la corrida de cierre.

## Gotchas recibo MP (Oct 2026)

- **Ruta y alcance:** `/admin/pagos/[id]/recibo` sirve PayPal y Mercado Pago. "Ver recibo" aparece en `/admin/pagos` y en el detalle del cliente para MP elegible; no se agrega a `/admin/cobros` (D-10). La asistente puede abrirlo; sigue siendo solo lectura (sin registro manual, ajustes ni revision).
- **Identificador derivado:** `MP-AAAAMMDD-<32 hex>` = SHA-256 de `externalId` con `trim()` recortado a 128 bits (32 hex, mayusculas) + fecha UTC (`reciboEmitidoEn ?? creadoEn`). No se persiste, no requiere backfill, no usa PII ni ids internos y no usa el prefijo `PAY-`. Misma referencia + misma fecha = mismo id; `Pago.externalId` es `@unique`.
- **Elegibilidad:** usar `pasarelaEfectivaPago` (`pasarela` manda; `metodo` como respaldo historico; si no, `MANUAL`). MP exige estado `SUCCEEDED`, `REVISION`, `REFUNDED` o `CONTRACARGO`, `externalId` no vacio (<=128) y montos que reconcilien (`montoAcordado + comision === monto`, `montoAcordado ?? monto`, `comision ?? 0`, moneda `ars`/`usd`). `FAILED`, `PENDING`, desconocidos y manual sin `externalId` no tienen recibo. Si falta un dato o no reconcilia: `notFound`, nunca recibo a medias.
- **Separacion server-only:** `mp-utils.ts` es browser-safe (estados, montos, moneda, fecha, tipo `ReciboMercadoPago`); `mp-recibo.ts` usa `node:crypto` y solo lo importan la pagina y sus tests. `paypal/view.ts` y los componentes cliente no deben importar `mp-recibo.ts` en runtime (`ReciboMercadoPago` usa `import type`).
- **A4:** `@page { size: A4; margin: 12mm }` vive en `admin.css` y aplica a ambos recibos; el boton "Imprimir recibo" y "Volver a pagos" usan `print:hidden`. La fecha se formatea con `Intl.DateTimeFormat("es-AR", { timeZone: "UTC" })` para que servidor/cliente/impresiones coincidan.
- **Sin red, email ni mutaciones:** la pagina hace una sola `findUnique` con `select` minimo (sin notas, evidencia, revision, origen, `registradoPor` ni `mpLink`), no llama a la API de MP, no ejecuta `sendPaymentReceipt` y no actualiza pago/hito/soporte/enlace. Solo muestra cliente del CRM; nunca PII del pagador, tarjeta ni cuenta MP.
- **Desvios menores:** `ReciboPago` acepta `reciboIdClassName` para que PayPal conserve su clase historica y MP use el default con `break-words`; el concepto MP se trunca por code points (200) en la pagina en lugar de rechazarse; el helper de concepto se comparte con PayPal (trim del enlace). El guard de tests bloquea `*.mercadopago.com` y `*.paypal.com` solo en `fetch`; no cubre `mercadopago.com.ar` ni otros clientes HTTP.
- **Gate T-38:** no mergear a `main` ni deployar a produccion antes del `db push` + backfill de T-38. La feature no agrega schema/migracion/envs; viaja en el mismo deploy y el rollback es revertir el commit.

## Backlog abierto (2026-10-30)

- **T-38 (no autorizado):** PayPal + recibo MP + hardening a produccion. `db push` + backfill **antes** del merge a `main`; FF-merge de `paypal-staging` para conservar `139b8cb`; envs/webhook live y smoke. Produccion sigue en `cdafe04`.
- **T-09 (spec 003):** smoke manual de staging — link en `REVISION`, webhook PayPal con firma invalida (`401`/`429`), topic ajeno a MP (`200` ignorado) y `git check-ignore` de `.railway/`.
- No bloqueante: completar el identificador de cuenta/aplicacion MP en el expediente H-6; unificar el helper de IP (PayPal/MP) y evaluar `debug` para el `429` de PayPal; R-9: otros consumidores de `NEXT_PUBLIC_URL` con `env || default`.

## Entorno

- Sanity: projectId `g0wvbc4g`, dataset `production`; Studio en `/studio`.
- Envs en Railway + `.env.local` (nunca commitear; `.env.example` es la referencia).
- `CRON_SECRET` vive en Railway (servicio principal + functions); no esta en `.env.local`.
- Emails de alertas/digest: `ADMIN_EMAIL` o `CONTACT_EMAIL` (hoy el Gmail del dueno).
- WhatsApp: `5491132464045`; mensajes en `src/lib/contact.ts`.
- El **Sentry MCP no esta en opencode**; el plugin `@sentry/agent-plugin` quedo instalado para **Claude Code** (skills sentry-*).

## Sesion 30 oct 2026 — Cierre spec 003 (hardening PayPal/MP)

- H-5..H-9 implementados en `paypal-staging` y **PASS tester+reviewer**: "Pago en revision" (H-5), expediente + hardening del webhook MP (H-6), limites y rechazos tempranos del webhook PayPal (H-7), `Location` relativo y fallo cerrado (H-8), `.railway/` ignorado (H-9). **Sin cambios de schema, envs, `Dockerfile`, `package.json` ni `railway.toml`.**
- T-07 (docs) y T-08 (verificacion) cerradas: suite **1644/1644 en 85 archivos**, `tsc --noEmit` 0 errores, `npm run lint` 18 errores/18 warnings preexistentes y `next build` PASS. T-09 (smoke de staging) queda pendiente; **T-38 sigue no autorizado**.
- `spec.md`/`plan.md` aun dicen "pendiente de tester/reviewer" para H-6/H-7: el implementer no puede editar `specs/**` salvo `tasks.md`; el planner/coordinator debe reflejar el PASS (el alcance no cambia).

## Sesion 29 oct 2026 — Recibo MP (T-01..T-07)

- Implementado el recibo interno de Mercado Pago en `paypal-staging`: dominio (`mp-utils.ts`/`mp-recibo.ts`), elegibilidad y links en el historial (`paypal/view.ts`), `ReciboPago` generico + adaptadores PayPal/MP, pagina generalizada y bordes (estados, sin referencia, sin red/email, A4). **Sin cambios de schema, migracion, backfill ni envs.**
- Identificador `MP-AAAAMMDD-<32 hex>` derivado de `externalId` + fecha UTC; no se persiste. Elegibilidad MP: `SUCCEEDED`/`REVISION`/`REFUNDED`/`CONTRACARGO` + `externalId` + montos/moneda/fecha validos. Links en `/admin/pagos` y detalle; nunca en `/admin/cobros`.
- Docs al dia (`AGENTS.md`, `MEMORY.md`, `specs/002-recibo-mp/tasks.md`); **T-07 `[x]`**. Desvios anotados en `tasks.md`: `reciboIdClassName`, concepto por code points, guard MP solo `fetch`/`*.mercadopago.com`, select least-privilege, concepto PayPal compartido y spy de email.
- Suite: **1582 tests en 83 archivos** (1580 verdes + 2 timeouts intermitentes preexistentes de `registrar-pago-paypal`, a confirmar en T-08); `tsc --noEmit` limpio. **T-08/T-09 pendientes.** Gate T-38 sigue sin autorizar: no merge a `main` ni deploy a produccion antes de `db push` + backfill.

## Sesion 29 oct 2026 — Cierre documental T-37

- T-37 queda `[x]` en `tasks.md`: **PASS con observaciones**; evidencia en `specs/001-paypal-pagos/review.md`; **T-38 no autorizado** en esta sesion.
- Suite al cerrar T-37 (antes de 002): **1431/1431 tests en 79 archivos**; `tsc --noEmit` 0 errores; build `PASS` en `139b8cb`.
- Staging validado: commit `139b8cb`, deploy `4c765526`, health `ok`; 14/14 pasos `PASS` (pasos 5, 11 y 14 con limitacion/observacion).
- Produccion intacta: deploy `554f70d7-4ebd-47db-9812-b831052c9a32`, commit `cdafe04` (`main` sin PayPal), sin migracion ni deploy. No se toco `src/**`, `prisma/**` ni `railway.toml`.

## Sesion 19 oct 2026 — Flujo SDD

- Se porto el flujo SDD de `convertidor-pdf`: coordinator + planner/implementer/tester/reviewer, comandos `/specify`, `/plan`, `/implement`, `/verify`, constitucion y plantillas en `specs/`.
- `opencode.json` deja `coordinator` como agente por defecto; metodologia integrada en `AGENTS.md` y `MEMORY.md`.
- Pendiente: reiniciar opencode y validar el flujo con `/specify` en la proxima feature.

## Sesion 27 oct 2026 — PayPal (T-31..T-35)

- T-31..T-34 cerradas: `node node_modules\vitest\vitest.mjs run` da **1427/1427 tests en 79 archivos** (al 27 oct; hoy 1582/83 tras el recibo MP), sin llamadas reales a PayPal/MP (guard de red en `src/__tests__/setup.ts`).
- `node node_modules\typescript\bin\tsc --noEmit`: limpio. `npm run lint`: deuda preexistente de la app (18 errores, 18 warnings al 27 oct 2026); T-35 solo toca docs.
- T-35 deja `.env.example`, `AGENTS.md` y `MEMORY.md` con el flujo, modelos, estados y gotchas PayPal. No se toco codigo; en `specs/` solo se marcaron T-31..T-34.
- **BD sin migrar** (falta `db push` + backfill) y PayPal sin deploy: T-36 (runbook sandbox), T-37 (staging) y T-38 (rollout) siguen abiertas. No deployar PayPal antes.

## Sesion 1 oct 2026

- **Alertas de uptime + digest diario** implementados y verificados (emails reales): `uptime-alerts.ts`, `digest.ts`, `/api/cron/digest`, fallback de la function si el sitio entero cae.
- **Blog**: 6 articulos nuevos (15 en total) con portadas de fotos reales.
- **Sentry**: SDK v11 completo (3 runtimes, tunnel, replay, captureException en catch criticos) + **source maps con release por commit** (verificado en build).
- Pendientes: pasos manuales del dueno (Clerk registro/invitacion, webhook Polar); E2E de pago por hito pausado; descartados por ahora: newsletter, Umami, unificar Nosotros, MP preapproval.
