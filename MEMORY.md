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

## Entorno

- Sanity: projectId `g0wvbc4g`, dataset `production`; Studio en `/studio`.
- Envs en Railway + `.env.local` (nunca commitear; `.env.example` es la referencia).
- `CRON_SECRET` vive en Railway (servicio principal + functions); no esta en `.env.local`.
- Emails de alertas/digest: `ADMIN_EMAIL` o `CONTACT_EMAIL` (hoy el Gmail del dueno).
- WhatsApp: `5491132464045`; mensajes en `src/lib/contact.ts`.
- El **Sentry MCP no esta en opencode**; el plugin `@sentry/agent-plugin` quedo instalado para **Claude Code** (skills sentry-*).

## Ultima sesion (1 oct 2026)

- **Alertas de uptime + digest diario** implementados y verificados (emails reales): `uptime-alerts.ts`, `digest.ts`, `/api/cron/digest`, fallback de la function si el sitio entero cae.
- **Blog**: 6 articulos nuevos (15 en total) con portadas de fotos reales.
- **Sentry**: SDK v11 completo (3 runtimes, tunnel, replay, captureException en catch criticos) + **source maps con release por commit** (verificado en build).
- Pendientes: pasos manuales del dueno (Clerk registro/invitacion, webhook Polar); E2E de pago por hito pausado; descartados por ahora: newsletter, Umami, unificar Nosotros, MP preapproval.
