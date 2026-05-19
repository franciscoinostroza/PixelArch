# PixelArch — Estado del Proyecto

**Ultima actualizacion:** Mayo 2026
**Build:** Excelente | **TypeScript:** 0 errores | **Rutas:** 26 compiladas
**Deploy Railway:** Online | **BD:** PostgreSQL sincronizada | **Clerk:** Auth + Webhook svix | **Sanity:** Studio + Schemas + 9 docs | **Paddle:** Productos + Checkout + Webhooks
**URL:** https://pixelarch-production.up.railway.app

---

## Stack

| Componente | Version | Detalle |
|------------|---------|---------|
| Next.js | 16.2.6 | App Router, Turbopack |
| Tailwind | v4 | CSS-first con `@theme` |
| Clerk | v7 | `Show`, `ClerkProvider`, svix webhooks |
| Prisma | 7 | adapter `@prisma/adapter-pg` |
| Sanity | v5 | Studio embebido en `/studio` |
| Paddle | SDK v3 | Pagos internacionales, suscripciones |
| Resend | v6 | Emails transaccionales |
| Deploy | Railway | Auto-deploy desde GitHub |

---

## Estructura del proyecto

### Landig (público)

| Ruta | Funcion |
|------|---------|
| `/` | Hero + Stats + Services (con precios) + Process + ContactForm |
| `/servicios` | Grid de 6 servicios con badge de precio ($30-60/mes) |
| `/servicios/[slug]` | Detalle con precio + boton "Contratar" (Paddle Checkout overlay) |
| `/gracias` | Pagina de agradecimiento |
| `/studio` | Sanity Studio embebido |

### Auth (Clerk)

| Ruta | Componente |
|------|-----------|
| `/sign-in` | `<SignIn />` con tema PixelArch completo (dark theme) |
| `/sign-up` | `<SignUp />` con tema PixelArch completo |

### Portal Cliente (requiere login)

| Ruta | Funcionalidad |
|------|--------------|
| `/portal` | Suscripciones activas, banner exito/fallido, cancelar suscripcion, link Paddle portal |
| `/portal/facturacion` | Historial de pagos con paginacion (20/pag) |

### Admin (requiere rol "admin")

| Ruta | Funcionalidad |
|------|--------------|
| `/admin/dashboard` | 4 metricas (ingresos mes, clientes, suscripciones, vencidos) + ultimos clientes + chart estados |
| `/admin/clientes` | Lista paginada (20/pag) con busqueda (nombre/email/empresa) |
| `/admin/clientes/[id]` | Datos cliente + suscripciones con botones Pausar/Reanudar/Cancelar + historial pagos |
| `/admin/servicios` | Catalogo desde Prisma con precios y estado activo/inactivo |
| `/admin/pagos` | Historial con filtros (estado, rango fechas) + paginacion (20/pag) |

### API Routes

| Ruta | Metodo | Proposito |
|------|--------|-----------|
| `/api/contact` | POST | Form de contacto (Resend) |
| `/api/payments/checkout` | POST | Datos para checkout Paddle (priceId + customer) |
| `/api/webhooks/paddle` | POST | 6 eventos: transaction.completed/paid/payment_failed, subscription.created/updated/canceled/paused |
| `/api/webhooks/clerk` | POST | Sync user.created/updated/deleted + welcome email |
| `/api/admin/suscripciones` | PATCH | Admin: pause/resume/cancel suscripcion |
| `/api/portal/cancel-subscription` | POST | Cliente: cancelar su propia suscripcion |
| `/api/portal/payment-portal` | POST | Cliente: sesion del customer portal de Paddle |
| `/api/cron/corte-servicios` | GET | Corte automatico de suscripciones morosas (+30 dias) |
| `/api/revalidate` | POST | ISR on-demand |

### Librerias (`src/lib/`)

| Archivo | Responsabilidad |
|---------|-----------------|
| `prisma.ts` | Singleton PrismaClient con adapter Pg |
| `sanity.ts` | Cliente Sanity + `sanityFetch()` generico |
| `payments.ts` | Singleton Paddle SDK (sandbox/prod) |
| `resend.ts` | Singleton Resend (email) |
| `validations.ts` | `contactSchema` (Zod) |
| `notifications.ts` | 4 emails transaccionales (welcome, receipt, failed, cancel, ready) |

### UI Components (`src/components/ui/`)

| Componente | Uso |
|-----------|-----|
| `button.tsx` | Button con variants (default, outline, ghost, accent2) |
| `badge.tsx` | Badge (default, accent, accent2, muted) |
| `card.tsx` | Card, CardHeader, CardTitle, CardDescription, CardContent |
| `input.tsx` | Input estilizado |
| `textarea.tsx` | Textarea estilizado |
| `section-label.tsx` | Label de seccion |
| `checkout-button.tsx` | Client: abre Paddle.Checkout.open() |
| `cancel-subscription-button.tsx` | Client: cancelar suscripcion con confirmacion |
| `subscription-actions.tsx` | Client: Pausar/Reanudar/Cancelar (admin) |
| `payment-portal-link.tsx` | Client: abre customer portal de Paddle |
| `paddle-script.tsx` | Inicializa Paddle.js con client token |
| `portal-nav.tsx` | Nav del portal con link activo |
| `portal-user-button.tsx` | UserButton de Clerk en portal |

---

## Lo completado

### Pagos (Paddle)
- 6 productos + 12 precios (mensual/anual) creados en Paddle
- `PADDLE_API_KEY`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET` en Railway
- Webhook: 7 eventos configurados
- Checkout: boton "Contratar" en catalogo → Paddle overlay → pago → redirect portal
- Customer portal: clientes pueden actualizar metodo de pago
- Admin: pause/resume/cancel suscripciones desde UI

### Base de datos (Prisma)
- 4 modelos: Cliente, Servicio, Suscripcion, Pago
- 7 paginas con queries reales (dashboard, clientes, servicios, pagos, portal)
- Busqueda, paginacion (20/pag), filtros por estado y rango de fechas

### Auth (Clerk)
- Login/registro con tema oscuro completo (10 variables + 20 elementos)
- Webhook svix: sync user.created/updated/deleted → BD
- Roles: admin (publicMetadata.role) vs cliente
- Middleware: proxy.ts protege /admin, /portal; excluye webhooks, cron, revalidate

### Emails transaccionales (Resend)
- Bienvenida (user.created)
- Recibo de pago (transaction.completed)
- Pago fallido (transaction.payment_failed)
- Cancelacion (subscription.canceled)

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

- [ ] Nada pendiente

---

## Build

```
Next.js 16.2.6 (Turbopack)
Compiled successfully
TypeScript — 0 errores
Generating static pages (20/20)

26 routes:
  /, /servicios, /servicios/[slug], /gracias, /studio
  /sign-in, /sign-up
  /portal, /portal/facturacion
  /admin/dashboard, /admin/clientes, /admin/clientes/[id], /admin/servicios, /admin/pagos
  /api/contact, /api/payments/checkout, /api/webhooks/paddle, /api/webhooks/clerk
  /api/admin/suscripciones, /api/portal/cancel-subscription, /api/portal/payment-portal
  /api/cron/corte-servicios, /api/revalidate
  /sitemap.xml, /robots.txt
  Proxy (Middleware)
```

---

## Comandos utiles

```bash
npm run dev        # Desarrollo local
npm run build      # Build de produccion
npx tsc --noEmit   # Type check
npx prisma studio  # Explorar BD
npx prisma db push # Sincronizar schema → BD
npx prisma generate # Regenerar cliente
```
