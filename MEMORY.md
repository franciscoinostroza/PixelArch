# MEMORY.md — Memoria operativa del agente

> **AGENTS.md** = que es el proyecto y en que estado esta.
> **MEMORY.md** = como trabajar en el (workflow, comandos, gotchas, lecciones).
> Actualizar al final de cada sesion con lo aprendido.

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
- **Formato USD:** `formatearMonto` es-AR en CRM/recibos/digest (`US$100,50`, `US$1.000,50`); unica excepcion: plantilla EN con en-US (`US$100.50`). Centavos enteros; PayPal solo USD.
- **Evidencia y PII:** el registro manual acepta evidencia textual/URL (capture/order id, comprobante o nota), sin archivos ni storage. No se persisten email/nombre/direccion del pagador; el recibo usa los datos del cliente del CRM. Logs/Sentry solo ids, monto, moneda y estado; PII redactada.
- **Link publico:** `/pago/paypal/*` es publico, `no-store`, `no-referrer` y `noindex`; `/pago` y `/pago/(.*)` estan en `ROUTES.public` y los webhooks quedan fuera del matcher. El guest checkout depende de PayPal (`NO_PREFERENCE`).
- **Sin cambios de Dockerfile:** no hay `NEXT_PUBLIC_PAYPAL_*`; las envs PayPal son server-only y se inyectan en runtime. Solo haria falta `ARG`/`ENV` si algun dia se usa el JS SDK del lado cliente.
- **Estado de la BD / deploy:** las tablas `EnlacePago`, `EventoPasarela`, `AjustePago` y los campos nuevos de `Pago` **no estan migrados**. Correr `node node_modules\prisma\build\index.js db push` + `generate` y el backfill de `plan.md` §4.2. Faltan el sandbox en Railway staging con Postgres separado (T-36/T-37) y el rollout (T-38). **No deployar PayPal** hasta completar T-37/T-38; sin envs PayPal queda deshabilitado y MP sigue operativo.
- **Tests/verificacion:** `node node_modules\vitest\vitest.mjs run` (suite 1427/79 sin red; guard en `src/__tests__/setup.ts`), `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint` (deuda preexistente) y `node node_modules\next\dist\bin\next build` cuando se pida. No hay llamadas reales a PayPal en CI; el sandbox es manual en Railway staging.

## Entorno

- Sanity: projectId `g0wvbc4g`, dataset `production`; Studio en `/studio`.
- Envs en Railway + `.env.local` (nunca commitear; `.env.example` es la referencia).
- `CRON_SECRET` vive en Railway (servicio principal + functions); no esta en `.env.local`.
- Emails de alertas/digest: `ADMIN_EMAIL` o `CONTACT_EMAIL` (hoy el Gmail del dueno).
- WhatsApp: `5491132464045`; mensajes en `src/lib/contact.ts`.
- El **Sentry MCP no esta en opencode**; el plugin `@sentry/agent-plugin` quedo instalado para **Claude Code** (skills sentry-*).

## Sesion 19 oct 2026 — Flujo SDD

- Se porto el flujo SDD de `convertidor-pdf`: coordinator + planner/implementer/tester/reviewer, comandos `/specify`, `/plan`, `/implement`, `/verify`, constitucion y plantillas en `specs/`.
- `opencode.json` deja `coordinator` como agente por defecto; metodologia integrada en `AGENTS.md` y `MEMORY.md`.
- Pendiente: reiniciar opencode y validar el flujo con `/specify` en la proxima feature.

## Sesion 27 oct 2026 — PayPal (T-31..T-35)

- T-31..T-34 cerradas: `node node_modules\vitest\vitest.mjs run` da **1427/1427 tests en 79 archivos**, sin llamadas reales a PayPal (guard de red en `src/__tests__/setup.ts`).
- `node node_modules\typescript\bin\tsc --noEmit`: limpio. `npm run lint`: deuda preexistente de la app (18 errores, 18 warnings al 27 oct 2026); T-35 solo toca docs.
- T-35 deja `.env.example`, `AGENTS.md` y `MEMORY.md` con el flujo, modelos, estados y gotchas PayPal. No se toco codigo; en `specs/` solo se marcaron T-31..T-34.
- **BD sin migrar** (falta `db push` + backfill) y PayPal sin deploy: T-36 (runbook sandbox), T-37 (staging) y T-38 (rollout) siguen abiertas. No deployar PayPal antes.

## Sesion 1 oct 2026

- **Alertas de uptime + digest diario** implementados y verificados (emails reales): `uptime-alerts.ts`, `digest.ts`, `/api/cron/digest`, fallback de la function si el sitio entero cae.
- **Blog**: 6 articulos nuevos (15 en total) con portadas de fotos reales.
- **Sentry**: SDK v11 completo (3 runtimes, tunnel, replay, captureException en catch criticos) + **source maps con release por commit** (verificado en build).
- Pendientes: pasos manuales del dueno (Clerk registro/invitacion, webhook Polar); E2E de pago por hito pausado; descartados por ahora: newsletter, Umami, unificar Nosotros, MP preapproval.
