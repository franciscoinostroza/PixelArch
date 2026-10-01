# PixelArch — Estado del Proyecto

**Ultima actualizacion:** Septiembre 2026
**Build:** Excelente | **TypeScript:** 0 errores | **Paginas:** 43 compiladas | **Tests:** 148 pasando
**Deploy Railway:** Online | **BD:** PostgreSQL sincronizada | **Clerk:** Auth solo admin (gate con modal) | **Sanity:** Studio + Schemas + 15 articulos | **Pagos:** CRM por proyectos/hitos + soporte mensual + Mercado Pago (links)
**URL:** https://pixelarch.dev

---

## Stack

| Componente | Version | Detalle |
|------------|---------|---------|
| Next.js | 16.2.6 | App Router, Turbopack |
| Tailwind | v4 | CSS-first con `@theme` |
| Clerk | v7 | `Show`, `ClerkProvider`, login solo para admin/asistente |
| Prisma | 7 | adapter `@prisma/adapter-pg` |
| Sanity | v5 | Studio embebido en `/studio` |
| Resend | v6 | Emails transaccionales |
| Sentry | 11 | Errors + tracing + replay (condicional a SENTRY_DSN, tunnel `/monitoring`) |
| Vitest | 3.2.6 | Testing (148 tests) |
| Deploy | Railway | Auto-deploy desde GitHub |

---

## Estructura del proyecto

### Landing (publico)

| Ruta | Funcion |
|------|---------|
| `/` | Hero centrado + Nosotros + Productos (cards + precios ARS/USD) + Proceso + ContactForm con banner de auditoria |
| `/productos` | Grid de 6 productos: implementacion desde + soporte opcional |
| `/productos/[slug]` | **Implementacion** (desde US$, CTA WhatsApp, pago por hitos) + **Soporte basico/premium** (tarjetas explicativas sin boton) + trust strip + garantia + mini-FAQ |
| `/precios` | Tabla: Implementacion (desde) / Soporte basico / Soporte premium + FAQ de pagos |
| `/faq` | Preguntas frecuentes categorizadas (acordeon) |
| `/nosotros` | Pagina completa: historia, como trabajamos, principios, stack |
| `/proyectos` | Caso pixelarch.dev + proyectos internos |
| `/estado` | Status page con monitoreo propio (uptime, latencia, 90 dias, incidentes) |
| `/auditoria` | Herramienta gratis: audita cualquier URL (velocidad, SSL, SEO, seguridad) |
| `/calculadora` | Calculadora de ahorro por automatizacion (interactiva) |
| `/blog` + `/blog/[slug]` | Blog con filtros por tags, tiempo de lectura, relacionados, RSS y CTA de auditoria |
| `/rss.xml` | Feed RSS 2.0 (se renderiza con XSLT en el navegador) |
| `/gracias`, `/terminos`, `/privacidad`, `/reembolsos`, `/studio`, `/logo` | Legales y utilidades |

### Auth (Clerk) — solo admin/asistente

| Ruta | Componente |
|------|-----------|
| `/sign-in` | `<SignIn />` con tema PixelArch (fallback de Clerk) |
| `/gate/admin` | Gate: abre el modal de Clerk sobre el sitio (`openSignIn`) y redirige a `next` |

El nav publico **no muestra "Ingresar"**: el acceso es entrando a `/admin` (el middleware hace rewrite al gate y aparece el modal). Registro publico desactivado.

### Admin (requiere rol "admin")

| Ruta | Funcionalidad |
|------|--------------|
| `/admin/dashboard` | Metricas (ingresos USD/ARS, por cobrar 7d, clientes, suscripciones, vencidos) + ultimos clientes + chart estados |
| `/admin/clientes` | Lista paginada (20/pag) con busqueda + **alta manual de clientes** |
| `/admin/clientes/[id]` | Datos + editar + notas + **proyectos por hitos** (crear, editar, agregar/eliminar hitos, link MP, registrar pago) + **soporte** (activar, precio, vencimiento, deploy) + historial |
| `/admin/cobros` | **Hitos pendientes (vencidos/por vencer/sin fecha) + Soportes** con acciones: registrar pago, link MP (recordado 30 dias), recordar (WhatsApp/email), pausar |
| `/admin/servicios` | Catalogo de productos desde Prisma con precios y estado activo/inactivo |
| `/admin/pagos` | Historial con filtros (estado, rango fechas) + paginacion + moneda/metodo |
| `/admin/blog` | Gestion del blog (enlaza a Sanity Studio) |

### API Routes

| Ruta | Metodo | Proposito |
|------|--------|-----------|
| `/api/contact` | POST | Form de contacto (Resend) |
| `/api/audit` | POST | Auditoria web: fetch + SSL (TLS) + headers + SEO. Rate limit 8/h |
| `/api/admin/clientes` | POST | Admin: alta manual de cliente |
| `/api/admin/clientes/[id]` | PATCH | Admin: editar cliente / activar-desactivar |
| `/api/admin/proyectos` | POST | Admin: crear proyecto con hitos |
| `/api/admin/proyectos/[id]` | PATCH | Admin: editar proyecto (titulo, notas, estado) |
| `/api/admin/proyectos/[id]/hitos` | POST | Admin: agregar hito |
| `/api/admin/hitos/[id]` | PATCH/DELETE | Admin: editar/marcar hito, eliminar (pendientes sin pagos) |
| `/api/admin/soporte` | POST | Admin: activar soporte mensual (plan SOPORTE, precio, vencimiento) |
| `/api/admin/pagos` | POST | Admin: registrar pago (hito o soporte; ARS/USD, metodo, nota, recibo) |
| `/api/admin/mp/link` | POST | Admin: link de pago MP para hito o soporte (recordado 30 dias, monto editable) |
| `/api/webhooks/mercadopago` | POST | MP: firma x-signature + registro idempotente (hito → Pagado / soporte → +meses) |
| `/api/admin/recordar` | POST | Admin: recordatorio de pago por email (hito o soporte) |
| `/api/admin/suscripciones` | PATCH | Admin: activar/pausar/reactivar/cancelar/vencido + precio/vencimiento + deploy |
| `/api/admin/entregar` | POST | Admin: marcar entregado + email |
| `/api/admin/asignar-producto` | POST | Admin: asignar producto a cliente |
| `/api/cron/uptime` | GET | Monitoreo: chequea 4 servicios (Railway Function `uptime-cron` cada 10 min; GitHub Actions de respaldo) + alertas por email |
| `/api/cron/digest` | GET | Digest diario de cobros por email (Railway Function `digest-cobros`, 9:00 ARG) |
| `/api/revalidate` | POST | ISR on-demand |
| `/api/health` | GET | Health check con status de DB |
| `/api/reviews/google` | GET | Reseñas de Google (widget) |

### Librerias (`src/lib/`)

| Archivo | Responsabilidad |
|---------|-----------------|
| `prisma.ts` | Singleton PrismaClient con adapter Pg |
| `sanity.ts` | Cliente Sanity + `sanityFetch()` generico (revalidate 60s) |
| `resend.ts` | Singleton Resend (email) |
| `validations.ts` | `contactSchema` (Zod) |
| `notifications.ts` | Email de recibo de pago (para el CRM) |
| `rate-limit.ts` | Rate limiter en memoria (Map + timestamps) |
| `logger.ts` | Logger estructurado JSON (niveles debug/info/warn/error) |
| `env.ts` | Validacion de env vars al startup |
| `shutdown.ts` | Graceful shutdown (SIGTERM/SIGINT) |
| `dolar.ts` | Dolar venta Banco Nacion (ComparaDolar) + formatters ARS/USD |
| `contact.ts` | Numero/mensajes de WhatsApp + `whatsappUrl()` |
| `audit.ts` | Logica pura de la auditoria (normalizeUrl, SSRF guard, scores, findings) |
| `pagos.ts` | Conversiones ARS/USD, vencimientos (+1 mes), precio de plan, metodos de pago |
| `mercadopago.ts` | SDK MP: crear link de pago (Checkout Pro, vigencia) + consultar pago |
| `mp-utils.ts` | Logica pura MP: meses, mapeo de estados, vencimiento por meses, titulos |
| `reading-time.ts` | Tiempo de lectura desde Portable Text |
| `chat.ts` | Intents del chat demo (PixelBot) |
| `deploy.ts` | Pausar/reanudar deploys (Railway/Vercel) |
| `uptime-alerts.ts` | Logica pura de alertas de uptime por transicion (caida/recuperacion) |
| `digest.ts` | Armado del digest diario de cobros (hitos, soportes, cobrado 24h) |

### UI Components clave (`src/components/`)

| Componente | Uso |
|-----------|-----|
| `layout/admin-gate.tsx` | Modal de ingreso al admin (openSignIn sobre el sitio) |
| `layout/admin-user-button.tsx` | Cuenta + cerrar sesion en el sidebar del admin (AccountModal custom) |
| `ui/account-modal.tsx` | Modal "Mi cuenta" custom (mover a admin) |
| `ui/faq-accordion.tsx` / `ui/product-faq.tsx` | Acordeones de FAQ |
| `sections/blog-grid.tsx` | Grid del blog con filtros por tags + tiempo de lectura |
| `sections/audit-tool.tsx` | Herramienta de auditoria interactiva |
| `sections/roi-calculator.tsx` | Calculadora de ahorro |
| `leads/chat-widget.tsx` | PixelBot demo (intents → WhatsApp) |
| `leads/audit-modal.tsx` | Popup de auditoria por inactividad (10s, min 8s en pagina) |
| `leads/whatsapp-button.tsx` | Boton flotante de WhatsApp |

---

## Lo completado

### Pagos — modelo de proyectos por hitos + soporte (Sept 2026)
- Se retiro el modelo de suscripciones por producto: ahora los trabajos son **Proyectos** (`Proyecto` + `Hito`) cotizados a medida y **pagados por hitos** (anticipo, avances, entrega)
- **Alta manual de clientes** (form + API) con notas internas
- **Registrar pago por hito**: ARS o USD (con cotizacion), metodo, nota, recibo; marca el hito como Pagado · tambien **marcar pagado/pendiente** a mano
- **Editar proyecto** (titulo/notas) y **editar/agregar/eliminar hitos** (eliminar solo pendientes sin pagos, reordena y recalcula el total)
- **Soporte mensual** (`Suscripcion` plan SOPORTE): activar con monto USD + primer vencimiento; acciones locales (activar/pausar/reactivar/cancelar/marcar vencido, precio acordado, fijar vencimiento)
- **Vista "Cobros"** (`/admin/cobros`): hitos pendientes (vencidos / por vencer / sin fecha) + soportes, con registrar pago, link MP, recordar (WhatsApp/email) y pausar
- Dashboard con ingresos USD y ARS separados + "Por cobrar 7 dias" (soportes + hitos); sidebar con badge
- Migracion Prisma: `clerkUserId` opcional, columnas `polar*` eliminadas, `Pago.metodo/nota/registradoPor/cotizacion/hitoId/externalId`, `Proyecto`/`Hito`, `Suscripcion.precioCustom/ultimoRecordatorioEn`

### Pagos — Mercado Pago (Checkout Pro)
- **Links de pago desde el admin**: boton "Link MP" en cada hito (monto ARS editable) y en soportes (meses 1-12 / solo registrar) → Copiar / Enviar por WhatsApp
- **Link recordado**: se guarda en la BD (`mpLink`, `mpLinkExpira`) con vigencia de **30 dias**; al reabrir el modal aparece el mismo link + "Regenerar". Se limpia al editar el monto, marcar pagado o vencer
- Preferencia con `external_reference` (hito/suscripcion) + `metadata.tipo`; la cotizacion del dia se guarda en el pago
- **Webhook** `/api/webhooks/mercadopago`: firma `x-signature` (SDK), idempotente por `Pago.externalId`; pago de hito → **PAGADO** + recibo; soporte → acredita meses (+1 por mes)
- Envs `MP_ACCESS_TOKEN` + `MP_WEBHOOK_SECRET` cargadas en Railway; webhook configurado en el panel MP (evento **Pagos**)
- Convive con el registro manual (transferencias/efectivo)

### Monitoreo propio (`/estado`)
- Tabla `UptimeCheck` + **Railway Function `uptime-cron`** cada 10 min (dispara `/api/cron/uptime` con el secret; el workflow de GitHub Actions queda como respaldo)
- 4 servicios: Sitio web, Blog, API, Base de datos (uptime, latencia, historial 90 dias, incidentes)
- **Alertas por email** (por transicion, anti-spam): caida tras 2 fallos seguidos + aviso de recuperacion; si el sitio entero no responde, la funcion escribe el fallo directo en la BD y avisa por Resend
- **Digest diario de cobros** (9:00 ARG via Railway Function `digest-cobros`): hitos vencidos/por vencer/sin fecha + soportes + cobrado ultimas 24h

### Blog
- 15 articulos (contenido completo + portadas reales: Unsplash/Wikimedia)
- Reading time, relacionados, filtros por tags, RSS con XSLT

### Auditoria web gratis (`/auditoria`)
- Chequeos reales: velocidad, SSL (certificado via TLS), SEO, headers de seguridad
- Proteccion SSRF + rate limit 8/hora + scoring y hallazgos

### Auth (Clerk) — solo admin
- Login solo para admin/asistente (modal sobre el sitio via `/gate/admin`)
- Sin registro publico, sin webhook de sync, sin portal de clientes
- Rol admin via `publicMetadata.role`

### Alertas de uptime + digest diario (Sept 2026)
- **Alertas por transicion** (anti-spam): 2 fallos seguidos → email de caida; al volver → email de recuperacion; no repite mientras siga caido (`uptime-alerts.ts` + tests)
- **Fallback del sitio entero caido**: la Railway Function `uptime-cron` escribe el fallo directo en la BD (con `pg`) y avisa por Resend si la API no responde
- **Digest diario de cobros** (9:00 ARG): hitos vencidos/por vencer/sin fecha + soportes + cobrado 24h (`digest.ts` + tests, Railway Function `digest-cobros`)
- Destinatario: `ADMIN_EMAIL` o `CONTACT_EMAIL` (hoy el Gmail del admin)

### Observabilidad — Sentry (Sept 2026)
- **SDK v11 en los 3 runtimes**: `instrumentation-client.ts` (browser), `sentry.server.config.ts` (Node), `sentry.edge.config.ts` (edge) + `instrumentation.ts` con `onRequestError`
- **Errors + tracing** (100% dev / 10% prod) + **Session Replay** (10% sesiones, 100% con error; texto enmascarado por defecto)
- **Tunnel `/monitoring`** (evita bloqueadores) + CSP con `*.sentry.io`; middleware excluye la ruta
- `captureException` en catch criticos: webhook MP, contacto, cron uptime, cron digest; `global-error.tsx` para errores del root layout
- Envs: `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` en Railway (y `.env.local`); sin DSN queda inactivo (no-op)
- **Source maps**: `SENTRY_AUTH_TOKEN` + `SENTRY_ORG`/`SENTRY_PROJECT` como build args del Dockerfile (tambien `NEXT_PUBLIC_SENTRY_DSN`); el **release es el commit SHA** (`RAILWAY_GIT_COMMIT_SHA`, build + runtime); subida verificada en build ("Successfully uploaded source maps")
- Plugin oficial de Sentry instalado en Claude Code (`@sentry/agent-plugin`, skills sentry-*)

---

## Pendiente

- [ ] Pasos manuales: desactivar registro publico en Clerk + invitar a la asistente · borrar el webhook de Polar en su panel

## Descartado / no planificado (por decision, Sept 2026)

- Prueba E2E del cobro por hito: **integracion de Mercado Pago verificada y funcionando** (link → pago → hito Pagado)
- Newsletter (Resend Audiences) · Analytics (Umami Cloud) · unificar "Nosotros" · Mercado Pago fase 2 (preapproval): no se haran por ahora

---

## Tests

```
✓ 18 test files | 148 tests | all passed
```

`npm test` — correr tests
`npm run test:watch` — modo watch

## Build

```
Next.js 16.2.6 (Turbopack)
Compiled successfully
TypeScript — 0 errores
Generating static pages (43/43)
```

---

### Comandos utiles

```bash
npm run dev        # Desarrollo local
npm run build      # Build de produccion
npm test           # Tests unitarios + libs
node node_modules/typescript/bin/tsc --noEmit   # Type check
npx prisma studio  # Explorar BD
npx prisma db push # Sincronizar schema → BD
npx prisma generate # Regenerar cliente
```

### Scripts propios (`src/scripts/`)

```bash
node node_modules/tsx/dist/cli.mjs src/scripts/seed-sanity.ts         # Seed Sanity (servicios/landing/seo)
node node_modules/tsx/dist/cli.mjs src/scripts/seed-articulos.ts      # Crear articulos del blog (idempotente)
node node_modules/tsx/dist/cli.mjs src/scripts/regenerate-covers-real.ts  # Portadas reales del blog
node node_modules/tsx/dist/cli.mjs src/scripts/generate-brand-assets.ts   # favicon-32 + og-image 1200x630
node node_modules/tsx/dist/cli.mjs src/scripts/covers.ts             # Generador de portadas SVG (fallback)
node node_modules/tsx/dist/cli.mjs src/scripts/test-mp.ts 100 <suscripcionId> 1  # Probar link de pago MP
```
