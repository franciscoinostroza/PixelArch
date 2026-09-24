# PixelArch — Estado del Proyecto

**Ultima actualizacion:** Septiembre 2026
**Build:** Excelente | **TypeScript:** 0 errores | **Paginas:** 41 compiladas | **Tests:** 130 pasando
**Deploy Railway:** Online | **BD:** PostgreSQL sincronizada | **Clerk:** Auth solo admin (gate con modal) | **Sanity:** Studio + Schemas + 9 articulos | **Pagos:** Mercado Pago (links de pago) + CRM manual (ARS/USD)
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
| Sentry | 10.57 | Error tracking (condicional a SENTRY_DSN) |
| Vitest | 3.2.6 | Testing (96 tests) |
| Deploy | Railway | Auto-deploy desde GitHub |

---

## Estructura del proyecto

### Landing (publico)

| Ruta | Funcion |
|------|---------|
| `/` | Hero centrado + Nosotros + Productos (cards + precios ARS/USD) + Proceso + ContactForm con banner de auditoria |
| `/productos` | Grid de 6 productos con precio y microcopy mensual |
| `/productos/[slug]` | Planes rediseñados (Variante A) + trust strip + garantia + mini-FAQ + CTAs a WhatsApp por plan |
| `/precios` | Tabla global 6 productos x 3 modalidades (ARS + USD) + FAQ de pagos |
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
| `/admin/clientes/[id]` | Datos + editar + notas + asignar producto + entregar + **registrar pago** + **ajustes de suscripcion** (precio acordado, vencimiento) + deploy (pausar/reanudar) + historial |
| `/admin/cobros` | **Vencidos + por vencer (7 dias)** con acciones: registrar pago, recordar (WhatsApp/email), pausar |
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
| `/api/admin/pagos` | POST | Admin: registrar pago (ARS o USD, metodo, nota, recibo) |
| `/api/admin/mp/link` | POST | Admin: genera link de pago de Mercado Pago (meses 1-12 / solo registrar, monto editable) |
| `/api/webhooks/mercadopago` | POST | MP: firma x-signature + registro idempotente del pago + acreditacion de meses |
| `/api/admin/recordar` | POST | Admin: recordatorio de pago por email (Resend) |
| `/api/admin/suscripciones` | PATCH | Admin: activar/pausar/reactivar/cancelar/vencido + precio/vencimiento + deploy |
| `/api/admin/entregar` | POST | Admin: marcar entregado + email |
| `/api/admin/asignar-producto` | POST | Admin: asignar producto a cliente |
| `/api/cron/uptime` | GET | Monitoreo: chequea 4 servicios cada 10 min (GitHub Actions) |
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
| `reading-time.ts` | Tiempo de lectura desde Portable Text |
| `chat.ts` | Intents del chat demo (PixelBot) |
| `deploy.ts` | Pausar/reanudar deploys (Railway/Vercel) |

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

### Pagos — desmonte de Polar (Sept 2026)
- Eliminada la integracion Polar: SDK, webhooks, checkout, customer portal, descuentos, cron de corte por mora
- CTAs de contratacion → **WhatsApp por plan** (mensaje prellenado con producto/precio)
- Precios de referencia en USD (Prisma + Sanity) + conversion ARS automatica
- **Mercado Pago** sera la pasarela (integracion proxima) y el registro manual de pagos (transferencia/efectivo) vivera en el admin

### Pagos — Mercado Pago (Checkout Pro)
- **Links de pago desde el admin**: boton "Link MP" en Cobros y detalle del cliente → selector `Meses (1-12)` / `Solo registrar` + monto ARS editable → Copiar / Enviar por WhatsApp
- Preferencia de MP con `external_reference` = suscripcion + `metadata.meses`; la cotizacion del dia se guarda en el pago
- **Webhook** `/api/webhooks/mercadopago`: valida firma `x-signature` (SDK), idempotente por `Pago.externalId`, registra el pago y acredita los meses (o solo registra si meses = 0) + recibo por email
- Envs: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` (Railway). Webhook configurado en el panel MP con el evento **Pagos**
- Convive con el registro manual (transferencias/efectivo)
- Pendiente: cargar credenciales de produccion y correr la prueba integral; fase 2 opcional: Suscripciones automaticas (preapproval)

### Admin — CRM manual (Sept 2026)
- **Alta manual de clientes** (form + API) con notas internas
- **Registrar pagos a mano**: ARS o USD (con cotizacion guardada), metodo (transferencia/MP/efectivo/otro), nota, recibo por email opcional; actualiza estado a ACTIVE y vencimiento +1 mes
- **Vista "Cobros"** (`/admin/cobros`): vencidos + por vencer 7 dias, con registrar pago, recordar por WhatsApp (link prellenado) y email (Resend, registra `ultimoRecordatorioEn`), y pausar
- **Acciones locales de suscripcion**: activar / pausar (con opcion de pausar deploy) / reactivar / cancelar / marcar vencido + precio acordado (`precioCustom`) + fijar vencimiento
- Dashboard con ingresos USD y ARS separados + "Por cobrar 7 dias"; sidebar con badge de cobros pendientes
- Migracion Prisma: `clerkUserId` opcional, columnas `polar*` eliminadas, `Pago.metodo/nota/registradoPor/cotizacion`, `Suscripcion.precioCustom/ultimoRecordatorioEn`

### Monitoreo propio (`/estado`)
- Tabla `UptimeCheck` + cron cada 10 min (GitHub Actions, repo publico)
- 4 servicios: Sitio web, Blog, API, Base de datos (uptime, latencia, historial 90 dias, incidentes)

### Blog
- 9 articulos (contenido completo + portadas reales: Unsplash/Wikimedia)
- Reading time, relacionados, filtros por tags, RSS con XSLT

### Auditoria web gratis (`/auditoria`)
- Chequeos reales: velocidad, SSL (certificado via TLS), SEO, headers de seguridad
- Proteccion SSRF + rate limit 8/hora + scoring y hallazgos

### Auth (Clerk) — solo admin
- Login solo para admin/asistente (modal sobre el sitio via `/gate/admin`)
- Sin registro publico, sin webhook de sync, sin portal de clientes
- Rol admin via `publicMetadata.role`

---

## Pendiente

- [ ] **Mercado Pago**: cargar `MP_ACCESS_TOKEN` (produccion) y `MP_WEBHOOK_SECRET` en Railway + prueba integral con credenciales de prueba
- [ ] **Newsletter**: Resend Audiences + form en el blog + envio automatico al publicar (webhook de Sanity)
- [ ] **Analytics**: Umami Cloud (falta crear cuenta + Website ID)
- [ ] Unificar "Nosotros": la seccion de la landing vs la pagina `/nosotros` (quedo pendiente definir)
- [ ] Pasos manuales: desactivar registro en Clerk + invitar asistente a su correo
- [ ] (Opcional) Mercado Pago fase 2: Suscripciones automaticas (preapproval)

---

## Tests

```
✓ 16 test files | 130 tests | all passed
```

`npm test` — correr tests
`npm run test:watch` — modo watch

## Build

```
Next.js 16.2.6 (Turbopack)
Compiled successfully
TypeScript — 0 errores
Generating static pages (39/39)
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
```
