# PixelArch — Estado del Proyecto

**Ultima actualizacion:** Junio 2026
**Build:** Excelente | **TypeScript:** 0 errores | **Rutas:** 30 compiladas | **Tests:** 60 pasando
**Deploy Railway:** Online | **BD:** PostgreSQL sincronizada | **Clerk:** Auth + Webhook svix | **Sanity:** Studio + Schemas + 9 docs | **Polar.sh:** 18 productos + Checkout + Webhooks
**URL:** https://pixelarch.dev

---

## Stack

| Componente | Version | Detalle |
|------------|---------|---------|
| Next.js | 16.2.6 | App Router, Turbopack |
| Tailwind | v4 | CSS-first con `@theme` |
| Clerk | v7 | `Show`, `ClerkProvider`, svix webhooks |
| Prisma | 7 | adapter `@prisma/adapter-pg` |
| Sanity | v5 | Studio embebido en `/studio` |
| Polar.sh | SDK v0.48 | Pagos internacionales, suscripciones (MoR) |
| Resend | v6 | Emails transaccionales |
| Sentry | 10.57 | Error tracking (condicional a SENTRY_DSN) |
| Vitest | 3.2.6 | Testing (60 tests) |
| Deploy | Railway | Auto-deploy desde GitHub |

---

## Estructura del proyecto

### Landig (público)

| Ruta | Funcion |
|------|---------|
| `/` | Hero + Stats + Services (con precios) + Process + ContactForm |
| `/productos` | Grid de 6 productos con badge de precio ($30-60/mes) |
| `/productos/[slug]` | Detalle con precio + boton "Contratar" (Polar.sh checkout) |
| `/gracias` | Pagina de agradecimiento |
| `/terminos` | Terminos del servicio |
| `/privacidad` | Politica de privacidad |
| `/reembolsos` | Politica de reembolsos |
| `/studio` | Sanity Studio embebido |

### Auth (Clerk)

| Ruta | Componente |
|------|-----------|
| `/sign-in` | `<SignIn />` con tema PixelArch completo (dark theme) |
| `/sign-up` | `<SignUp />` con tema PixelArch completo |

### Portal Cliente (requiere login)

| Ruta | Funcionalidad |
|------|--------------|
| `/portal` | Suscripciones activas, banner exito/fallido, cancelar suscripcion, link Polar portal |
| `/portal/facturacion` | Historial de pagos con paginacion (20/pag) |

### Admin (requiere rol "admin")

| Ruta | Funcionalidad |
|------|--------------|
| `/admin/dashboard` | 4 metricas (ingresos mes, clientes, suscripciones, vencidos) + ultimos clientes + chart estados |
| `/admin/clientes` | Lista paginada (20/pag) con busqueda (nombre/email/empresa) |
| `/admin/clientes/[id]` | Datos cliente + suscripciones con botones Pausar/Reanudar/Cancelar + historial pagos |
| `/admin/servicios` | Catalogo de productos desde Prisma con precios y estado activo/inactivo |
| `/admin/pagos` | Historial con filtros (estado, rango fechas) + paginacion (20/pag) |

### API Routes

| Ruta | Metodo | Proposito |
|------|--------|-----------|
| `/api/contact` | POST | Form de contacto (Resend) |
| `/api/payments/checkout` | POST | Crea checkout session en Polar.sh |
| `/api/webhooks/polar` | POST | 7 eventos: order.paid, subscription.* |
| `/api/webhooks/clerk` | POST | Sync user.created/updated/deleted + welcome email |
| `/api/admin/suscripciones` | PATCH | Admin: pause/resume/cancel suscripcion |
| `/api/portal/cancel-subscription` | POST | Cliente: cancelar su propia suscripcion |
| `/api/portal/payment-portal` | POST | Cliente: sesion del customer portal de Polar |
| `/api/cron/corte-servicios` | GET | Corte automatico de suscripciones morosas (+30 dias) |
| `/api/revalidate` | POST | ISR on-demand |
| `/api/health` | GET | Health check con status de DB |

### Librerias (`src/lib/`)

| Archivo | Responsabilidad |
|---------|-----------------|
| `prisma.ts` | Singleton PrismaClient con adapter Pg |
| `sanity.ts` | Cliente Sanity + `sanityFetch()` generico |
| `polar.ts` | Singleton Polar SDK |
| `resend.ts` | Singleton Resend (email) |
| `validations.ts` | `contactSchema` (Zod) |
| `notifications.ts` | 3 emails transaccionales (bienvenida, fallido, cancelacion) |
| `rate-limit.ts` | Rate limiter en memoria (Map + timestamps) |
| `logger.ts` | Logger estructurado JSON (niveles debug/info/warn/error) |
| `env.ts` | Validacion de env vars al startup |
| `shutdown.ts` | Graceful shutdown (SIGTERM/SIGINT) |

### UI Components (`src/components/ui/`)

| Componente | Uso |
|-----------|-----|
| `button.tsx` | Button con variants (default, outline, ghost, accent2) |
| `badge.tsx` | Badge (default, accent, accent2, muted) |
| `card.tsx` | Card, CardHeader, CardTitle, CardDescription, CardContent |
| `input.tsx` | Input estilizado |
| `textarea.tsx` | Textarea estilizado |
| `section-label.tsx` | Label de seccion |
| `checkout-button.tsx` | Client: redirect a Polar checkout |
| `cancel-subscription-button.tsx` | Client: cancelar suscripcion con confirmacion |
| `subscription-actions.tsx` | Client: Pausar/Cancelar (admin) |
| `payment-portal-link.tsx` | Client: abre customer portal de Polar |
| `portal-nav.tsx` | Nav del portal con link activo |
| `portal-user-button.tsx` | UserButton de Clerk en portal |

---

## Lo completado

### Pagos (Polar.sh)
- 18 productos en Polar.sh (6 servicios × 3 planes)
- `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET` en Railway
- Webhook: 8 eventos (order.paid, subscription.*)
- Checkout: boton "Contratar" → redirect a Polar checkout → vuelve a /portal
- Customer portal: Polar customer sessions
- Admin: cancel suscripciones desde UI

### Base de datos (Prisma)
- 4 modelos: Cliente, Servicio, Suscripcion, Pago
- 7 paginas con queries reales (dashboard, clientes, servicios, pagos, portal)
- Busqueda, paginacion (20/pag), filtros por estado y rango de fechas

### Auth (Clerk)
- Login/registro con tema oscuro completo (10 variables + 20 elementos)
- Webhook svix: sync user.created/updated/deleted → BD
- Roles: admin (publicMetadata.role) vs cliente
- Middleware: middleware.ts protege /admin, /portal; excluye webhooks, cron, revalidate

### Emails transaccionales (Resend)
- Bienvenida (user.created) — Resend
- Pago fallido — Resend
- Cancelacion — Resend

### Automatizacion
- `GET /api/cron/corte-servicios`: cancela suscripciones PAST_DUE > 30 dias
- Email de advertencia a los 23 dias (7 dias antes del corte)
- GitHub Actions cron: corre todos los dias a las 6am UTC (3am Argentina)

### UX
- Sidebar admin responsive (hamburger en mobile, overlay)
- Nav portal con link activo resaltado
- UserButton con cerrar sesion en portal
- Banner de exito post-pago en portal
- Banner de pago fallido con link al customer portal

---

## Pendiente

- [ ] Correr `npx tsx src/scripts/seed-polar.ts` con POLAR_ACCESS_TOKEN para crear 18 productos
- [ ] Generar iconos PNG reales para PWA (reemplazar SVGs placeholder)

---

## Produccion Readiness — Implementado

| Fase | Items | Estado |
|------|-------|--------|
| F1: Seguridad | CSP header + Rate limiting (5 endpoints) + CSRF (cubierto por Clerk) | ✅ |
| F2: Observabilidad | Logger JSON estructurado + Sentry (condicional) + Graceful shutdown | ✅ |
| F3: Resiliencia | Error boundaries (4 route groups) + Loading states (9 nuevos) + Env validation | ✅ |
| F4: UX/PWA | Manifest + icons SVG + Accesibilidad (aria-*) + Code splitting (dynamic) | ✅ |
| F5: Pulido | JSON-LD enriquecido + URLs dinámicas en emails + Plain text fallback + DRY auth + UserButton footer visible | ✅ |

## Tests

```
✓ 10 test files | 60 tests | all passed
```

`npm test` — correr tests
`npm run test:watch` — modo watch

## Build

```
Next.js 16.2.6 (Turbopack)
Compiled successfully
TypeScript — 0 errores
Generating static pages (20/20)

27 routes:
  /, /productos, /productos/[slug], /gracias, /studio, /terminos, /privacidad, /reembolsos

  /admin/dashboard, /admin/clientes, /admin/clientes/[id], /admin/servicios, /admin/pagos
  /api/contact, /api/payments/checkout, /api/webhooks/polar, /api/webhooks/clerk
  /api/admin/suscripciones, /api/portal/cancel-subscription, /api/portal/payment-portal
  /api/cron/corte-servicios, /api/revalidate, /api/health
  /sitemap.xml, /robots.txt
  Proxy (Middleware)
```

---

### Comandos utiles

```bash
npm run dev        # Desarrollo local
npm run build      # Build de produccion
npm test           # Tests unitarios + componentes + API
npx tsc --noEmit   # Type check
npx prisma studio  # Explorar BD
npx prisma db push # Sincronizar schema → BD
npx prisma generate # Regenerar cliente
```
