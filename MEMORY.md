# MEMORY.md — Memoria operativa del agente

> **AGENTS.md** = que es el proyecto y en que estado esta.
> **MEMORY.md** = como trabajar en el (workflow, comandos, gotchas, lecciones).
> Actualizar al final de cada sesion con lo aprendido.

**Ultima actualizacion:** 2026-11-14

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
- **Estado de la BD / deploy:** staging quedo validado en T-37 (commit `139b8cb`, deploy `4c765526`; evidencia en `specs/001-paypal-pagos/review.md`). **Produccion tiene PayPal Live desde T-38 (2026-11-03):** `db push` + backfill aplicados (`UPDATE 0`, sin filas a migrar), deploy `f1185f76` en el commit `de64b50`, health OK, 33 variables y webhook `https://pixelarch.dev/api/webhooks/paypal` (`401` sin firma); admin y Mercado Pago operativos. **Sin pago real de smoke por decision del dueno:** el primer cobro real es la primera validacion live (firma, captura, hito, recibo, sin duplicado); monitorearlo con prioridad. Hardening H-5..H-9 PASS tester+reviewer; T-09 (smoke de staging) queda como deuda documental y no bloquea produccion. Rollback: quitar envs PayPal + deshabilitar webhook Live + redeploy, sin borrar datos ni revertir el esquema aditivo.
- **Tests/verificacion:** `node node_modules\vitest\vitest.mjs run` (sin red; guard en `src/__tests__/setup.ts`). **Baseline vigente: 3031/3031 en 114 archivos (T-25, 13 nov 2026; PASS tester, pendiente cierre reviewer)**; la corrida 1644/1644 en 85 archivos del 30 oct 2026 es historica (cierre PayPal). Ademas `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint` (18 errores/18 warnings preexistentes) y `node node_modules\next\dist\bin\next build` cuando se pida. No hay llamadas reales a PayPal/MP en CI; el sandbox es manual en Railway staging. El flake ocasional de `registrar-pago-paypal` no aparecio en la corrida de cierre.

## Gotchas recibo MP (Oct 2026)

- **Ruta y alcance:** `/admin/pagos/[id]/recibo` sirve PayPal y Mercado Pago. "Ver recibo" aparece en `/admin/pagos` y en el detalle del cliente para MP elegible; no se agrega a `/admin/cobros` (D-10). La asistente puede abrirlo; sigue siendo solo lectura (sin registro manual, ajustes ni revision).
- **Identificador derivado:** `MP-AAAAMMDD-<32 hex>` = SHA-256 de `externalId` con `trim()` recortado a 128 bits (32 hex, mayusculas) + fecha UTC (`reciboEmitidoEn ?? creadoEn`). No se persiste, no requiere backfill, no usa PII ni ids internos y no usa el prefijo `PAY-`. Misma referencia + misma fecha = mismo id; `Pago.externalId` es `@unique`.
- **Elegibilidad:** usar `pasarelaEfectivaPago` (`pasarela` manda; `metodo` como respaldo historico; si no, `MANUAL`). MP exige estado `SUCCEEDED`, `REVISION`, `REFUNDED` o `CONTRACARGO`, `externalId` no vacio (<=128) y montos que reconcilien (`montoAcordado + comision === monto`, `montoAcordado ?? monto`, `comision ?? 0`, moneda `ars`/`usd`). `FAILED`, `PENDING`, desconocidos y manual sin `externalId` no tienen recibo. Si falta un dato o no reconcilia: `notFound`, nunca recibo a medias.
- **Separacion server-only:** `mp-utils.ts` es browser-safe (estados, montos, moneda, fecha, tipo `ReciboMercadoPago`); `mp-recibo.ts` usa `node:crypto` y solo lo importan la pagina y sus tests. `paypal/view.ts` y los componentes cliente no deben importar `mp-recibo.ts` en runtime (`ReciboMercadoPago` usa `import type`).
- **A4:** `@page { size: A4; margin: 12mm }` vive en `admin.css` y aplica a ambos recibos; el boton "Imprimir recibo" y "Volver a pagos" usan `print:hidden`. La fecha se formatea con `Intl.DateTimeFormat("es-AR", { timeZone: "UTC" })` para que servidor/cliente/impresiones coincidan.
- **Sin red, email ni mutaciones:** la pagina hace una sola `findUnique` con `select` minimo (sin notas, evidencia, revision, origen, `registradoPor` ni `mpLink`), no llama a la API de MP, no ejecuta `sendPaymentReceipt` y no actualiza pago/hito/soporte/enlace. Solo muestra cliente del CRM; nunca PII del pagador, tarjeta ni cuenta MP.
- **Desvios menores:** `ReciboPago` acepta `reciboIdClassName` para que PayPal conserve su clase historica y MP use el default con `break-words`; el concepto MP se trunca por code points (200) en la pagina en lugar de rechazarse; el helper de concepto se comparte con PayPal (trim del enlace). El guard de tests bloquea `*.mercadopago.com` y `*.paypal.com` solo en `fetch`; no cubre `mercadopago.com.ar` ni otros clientes HTTP.
- **Gate T-38 (cerrado 2026-11-03):** produccion ya tiene el esquema/backfill y PayPal Live (deploy `f1185f76` en `de64b50`). No hubo pago real de smoke; la validacion end-to-end queda para el primer cobro real. Rollback: quitar envs PayPal + deshabilitar webhook Live + redeploy, sin borrar datos.

## Gotchas portal de propuestas (Nov 2026)

- **Produccion (14 nov 2026):** deploy `02a5ca66` (commit `700eaf1` + docs posteriores), health OK y `/api/propuestas/**` `401` sin sesion; esquema aplicado (6 tablas + 8 enums, verificado con una Function temporal ya eliminada) y 52 variables con `PROPUESTAS_*` (`PROPUESTAS_SECRETO` generado). `PROPUESTAS_ENVIO_HABILITADO=false` y `PROPUESTAS_TEXTO_LEGAL`/`PROPUESTAS_BASE_LEGAL` sin cargar: aprobar/enviar sigue bloqueado. T-26/T-27 no ejecutados.
- **`reservarCupo` dentro de `prisma.$transaction`:** si se le pasa el singleton, `pg_advisory_xact_lock` no protege (la transaccion no es la misma) y dos corridas pueden sobreconsumir. Las rutas de ejecutar/analizar/enviar ya lo envuelven; mantenerlo asi.
- **Locks de presupuesto global:** `reservarCupo` toma primero `pg_advisory_xact_lock(hashtext('PROPUESTAS_PRESUPUESTO'))` (si el presupuesto efectivo es > 0) y despues el lock diario `(proveedor, fecha)`. El orden es fijo para evitar deadlocks; no invertirlo. `PROPUESTAS_PRESUPUESTO_MENSUAL_CENTAVOS=0` = sin tope.
- **`PROPUESTAS_SECRETO` no se rota a la ligera:** invalida tokens de baja ya emitidos, hashes de supresion y aprobaciones; v1 no tiene doble secreto ni rehash (la tabla no guarda el email en claro). Planificar ventana y pausar envios (runbook §10.5).
- **Tokens de baja con puntos:** el token `v1.<prospecto>.<emailHash>.<hmac>` no pasa por el matcher general de middleware (excluye rutas con extension). Hace falta el matcher explicito `/propuestas/baja/:path*`; sin el, la baja no recibe `X-Robots-Tag`/`Cache-Control`.
- **`Referrer-Policy: no-referrer`:** `next.config.ts` lo fija para `/propuestas/baja/:path*` y `/api/opt-out` porque el header global es `strict-origin-when-cross-origin`. Next aplica despues la entrada especifica; no quitarla.
- **`List-Unsubscribe` one-click:** el email debe salir con `List-Unsubscribe` (link visible + mailto) y `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; Resend se llama con `Idempotency-Key`, sin tracking ni adjuntos y sin retry automatico.
- **Cron de retencion:** `GET /api/cron/propuestas-retencion` usa `Authorization: Bearer $CRON_SECRET`, **no** `x-cron-secret` (uptime/digest usan ese otro header). Copiar el patron equivocado da `401`.
- **Sentry:** `redactSentryEventPropuestas` se compone en server, edge y cliente; oculta `/propuestas/baja/<token>` y `?token=` de `/api/opt-out`, ademas de PII/cuerpos. No loguear URLs de baja ni tokens aunque Sentry este apagado.
- **Guard de red de tests:** `guard-propuestas-red.ts` (en `setup.ts`) bloquea `places.googleapis.com`, `api.resend.com` y hosts LLM; los tests deben mockear `fetch`. El guard solo envuelve `fetch`, no SDKs ni clientes HTTP alternativos.
- **`estadoEnvio` no es el gate de aprobacion:** exige `PROPUESTAS_ENVIO_HABILITADO`, Resend, from/reply-to, secreto, URL HTTPS y textos legales, pero **solo se usa para enviar**. Aprobar exige remitente, secreto, URL y texto/base legal, y nunca envia.
- **Listas con tope:** bandeja y supresiones leen 200 filas y envios 100, sin paginacion completa; un volumen alto puede ocultar pendientes/historicos v1.
- **`PROPUESTAS_MAX_ENVIOS_PROSPECTO=2`:** inicial + un follow-up **manual**. No hay scheduler, envio por lote ni retry automatico; el follow-up requiere nuevo borrador/aprobacion.

## Backlog abierto (2026-11-14)

- **T-24 (spec 004, cerrada):** runbook y checklist legal redactados; `AGENTS.md`/`MEMORY.md` actualizados; commit `2b8132c`; PASS tester+reviewer.
- **T-25 (spec 004, PASS tester, pendiente cierre reviewer):** verificacion final local con evidencia: suite **3031/3031 en 114 archivos**, `tsc --noEmit` 0 errores, lint 18/18 preexistente y `next build` PASS; corregir solo lo introducido por la feature. Baseline vigente: T-25. El codigo quedo desplegado en produccion (deploy `02a5ca66`, commit `700eaf1` + docs posteriores).
- **T-26 [GATE] (spec 004, no ejecutado):** staging con Postgres separado y `PROPUESTAS_ENVIO_HABILITADO=false` hasta el envio controlado; smoke de Places/fetch/auditoria/score/borrador/aprobacion, baja one-click, cupo 21 y retencion. **No se ejecuto:** el dueno autorizo aplicar el portal directamente en produccion.
- **T-27 [GATE] (spec 004, no ejecutado):** produccion con autorizacion del dueno y checklist legal firmado + SPF/DKIM/DMARC + `pg_dump`/`db push`; recien entonces habilitar el envio. **El gate formal no se ejecuto:** el despliegue (`02a5ca66`) y el esquema aplicado se hicieron con autorizacion del dueno, sin checklist firmado ni SPF/DKIM/DMARC.
- **Validacion real del portal en produccion:** esquema aplicado (6 tablas + 8 enums) y 52 variables (`PROPUESTAS_SECRETO` generado; `PROPUESTAS_ENVIO_HABILITADO=false`); `PROPUESTAS_TEXTO_LEGAL`/`PROPUESTAS_BASE_LEGAL` sin cargar, por lo que aprobar/enviar sigue bloqueado. Falta smoke real de Places/fetch/auditoria/borrador/aprobacion/envio/baja/cupos, checklist legal y SPF/DKIM/DMARC. No marcar T-26/T-27 como PASS.
- **Deuda portal v1:** LLM no implementado (`modo="LLM"` falla cerrado), sin webhooks de Resend (resultados manuales), cupo `REDACTOR` no reservado, listas sin paginacion completa y reconciliacion de `ENVIANDO` sin boton en UI.
- **Primer cobro real PayPal (post-T-38):** monitorear con prioridad la firma del webhook (`200`), un solo `Pago`, hito `PAGADO`, recibo y ausencia de duplicados. T-38 no ejecuto pago real de smoke por decision del dueno.
- **T-09 (spec 003, deuda documental):** smoke manual de staging — link en `REVISION`, webhook PayPal con firma invalida (`401`/`429`), topic ajeno a MP (`200` ignorado) y `git check-ignore` de `.railway/`. No bloquea produccion.
- **Evidencia documental T-38:** backup/restore (G3), freeze (G2) y revalidacion de suite/typecheck/lint/build sobre `de64b50` no reportados; el commit difiere de `139b8cb`.
- No bloqueante: completar el identificador de cuenta/aplicacion MP en el expediente H-6; unificar el helper de IP (PayPal/MP) y evaluar `debug` para el `429` de PayPal; R-9: otros consumidores de `NEXT_PUBLIC_URL` con `env || default`.

## Entorno

- Sanity: projectId `g0wvbc4g`, dataset `production`; Studio en `/studio`.
- Envs en Railway + `.env.local` (nunca commitear; `.env.example` es la referencia).
- `CRON_SECRET` vive en Railway (servicio principal + functions); no esta en `.env.local`.
- Emails de alertas/digest: `ADMIN_EMAIL` o `CONTACT_EMAIL` (hoy el Gmail del dueno).
- WhatsApp: `5491132464045`; mensajes en `src/lib/contact.ts`.
- El **Sentry MCP no esta en opencode**; el plugin `@sentry/agent-plugin` quedo instalado para **Claude Code** (skills sentry-*).

## Sesion 13 nov 2026 — Portal de propuestas T-01..T-24

- **T-01..T-24 PASS tester+reviewer**, un commit `feat:` por tarea (T-24 `docs:`) y push de la rama de trabajo (sin listar hashes). Cierre funcional del portal admin-only de prospeccion B2B, separado del CRM.
- **Fundaciones:** middleware corregido (`/propuesta` singular publico; `/propuestas` admin; APIs `401/403`; baja/opt-out publicos; headers `noindex`/`no-store`), guard Clerk-only sin Prisma, shell sin nav de CRM, esquema aditivo de 6 modelos/8 enums sin FKs al CRM y config server-only fail-closed.
- **Prospeccion y borradores:** Places (solo `place_id`), dedupe por `placeId`/email/dominio, fetch seguro + robots, extraccion de email publicado, auditoria interna, score determinista, alta manual con fuente, plantillas versionadas, borrador con grounding y edicion versionada.
- **Aprobacion y envio:** snapshot con footer legal/token/hash, aprobacion sin envio, wrapper Resend con `Idempotency-Key` y `List-Unsubscribe` one-click, reintento manual, resultado/rebote/queja con supresion global y reconciliacion manual de `ENVIANDO`.
- **Cumplimiento:** baja publica `/propuestas/baja/[token]` + `POST /api/opt-out`, supresiones por hash/dominio con revocacion excepcional, retencion 12 meses con cron `Bearer`, ARCO exportar/rectificar/eliminar y redaccion de PII/tokens en logs/Sentry.
- **Verificacion T-23:** suite **3031/3031 en 114 archivos**, `tsc --noEmit` 0 errores, `npm run lint` 18 errores/18 warnings preexistentes y `next build` PASS.
- **Estado real (13 nov):** codigo desplegado, pero **esquema pendiente de `db push`** y `PROPUESTAS_ENVIO_HABILITADO=false`; el portal fallaba cerrado (`ESQUEMA_NO_APLICADO`). No se ejecutaron T-26 (staging) ni T-27 (produccion), no hubo envio real ni llamadas reales a Places/Resend/LLM. **Superado el 14 nov 2026:** esquema aplicado y portal desplegado en produccion (deploy `02a5ca66`).
- **T-24 cerrada:** `runbook.md` y `legal-checklist.md` redactados; `AGENTS.md`/`MEMORY.md` actualizados; commit `2b8132c`; PASS tester+reviewer.
- **T-25 (PASS tester, pendiente cierre reviewer):** suite **3031/3031 en 114 archivos**, `tsc --noEmit` 0 errores, lint 18/18 preexistente y `next build` PASS (13 nov 2026); T-26/T-27 siguen pendientes de ejecucion.

## Sesion 14 nov 2026 — Portal de propuestas desplegado a produccion

- **Deploy `02a5ca66`** en el commit `700eaf1` + docs posteriores; `/api/health` OK y `/api/propuestas/**` responde `401` sin sesion. T-01..T-25 en produccion.
- **Esquema aplicado en produccion:** 6 tablas + 8 enums verificados con una Function temporal (ya eliminada). Ya no hay `db push` pendiente para propuestas y el portal no cae en `ESQUEMA_NO_APLICADO`.
- **Variables:** 52 en el servicio PixelArch, incluidas las `PROPUESTAS_*`; `PROPUESTAS_SECRETO` generado. `PROPUESTAS_ENVIO_HABILITADO=false`; `PROPUESTAS_TEXTO_LEGAL`/`PROPUESTAS_BASE_LEGAL` no cargados, asi que aprobar/enviar sigue bloqueado.
- **Decision del dueno:** autorizo aplicar el portal directamente en produccion. **T-26 (staging) y T-27 (gate formal) no se ejecutaron** y no se marcan como PASS. Queda pendiente la validacion real de Places/fetch/auditoria/borrador/aprobacion/envio/baja/cupos y el checklist legal/SPF/DKIM/DMARC antes de habilitar el envio.
- **Historial:** la sesion del 13 nov queda como estaba (T-24 cerrada, T-25 PASS tester pendiente de reviewer, esquema pendiente en ese momento); este deploy no cambia el baseline de tests (**3031/3031 en 114 archivos**).

## Sesion 3 nov 2026 — Cierre T-38 (rollout a produccion)

- **T-38 PASS con observacion:** deploy `f1185f76` en el commit `de64b50`, `/api/health` OK; `db push` + backfill aplicados (`UPDATE 0`, sin filas a migrar); PayPal Live cargado (33 variables); webhook `https://pixelarch.dev/api/webhooks/paypal` responde `401` sin firma; admin y Mercado Pago operativos.
- **Sin pago real de smoke** por decision del dueno: no hubo cobro live de punta a punta. La validacion live de firma, captura, hito y recibo queda para el primer cobro real; monitorearlo con prioridad.
- **Rollback definido (no ejecutado):** quitar envs PayPal + deshabilitar webhook Live + redeploy, sin borrar datos ni revertir el esquema aditivo.
- **T-09 (spec 003)** sigue pendiente como deuda documental y no bloquea produccion. Tests **historicos del cierre T-38: 1644/1644 en 85 archivos** (ultima corrida reportada al 30 oct 2026, no revalidada en este cierre); **baseline vigente: 3031/3031 en 114 archivos** (T-25, 13 nov 2026; PASS tester, pendiente cierre reviewer). Sin cambios de codigo en este cierre; `de64b50` difiere de `139b8cb` y no se reporta revalidacion sobre ese SHA.
- Docs actualizados: `AGENTS.md`, `MEMORY.md` y `specs/001-paypal-pagos/review.md`, `specs/001-paypal-pagos/tasks.md`, `specs/002-recibo-mp/tasks.md`, `specs/003-hardening-paypal/tasks.md`; commit docs-only (no dispara deploy).

## Sesion 30 oct 2026 — Cierre spec 003 (hardening PayPal/MP)

- H-5..H-9 implementados en `paypal-staging` y **PASS tester+reviewer**: "Pago en revision" (H-5), expediente + hardening del webhook MP (H-6), limites y rechazos tempranos del webhook PayPal (H-7), `Location` relativo y fallo cerrado (H-8), `.railway/` ignorado (H-9). **Sin cambios de schema, envs, `Dockerfile`, `package.json` ni `railway.toml`.**
- T-07 (docs) y T-08 (verificacion) cerradas: suite **1644/1644 en 85 archivos**, `tsc --noEmit` 0 errores, `npm run lint` 18 errores/18 warnings preexistentes y `next build` PASS. T-09 (smoke de staging) queda pendiente; en esa fecha **T-38 seguia no autorizado** (se ejecuto el 3 nov 2026, ver sesion de cierre).
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
