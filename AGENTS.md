# PixelArch — Estado del Proyecto

**Última actualización:** Mayo 2026  
**Build:** ✅ Exitoso | **TypeScript:** ✅ 0 errores | **Rutas:** 22 compiladas  
**Deploy Railway:** ✅ Online | **BD:** ✅ PostgreSQL sincronizada  
**URL:** https://pixelarch-production.up.railway.app

---

## Stack real (con adaptaciones)

| Componente | Planeado | Real | Motivo |
|------------|----------|------|--------|
| Next.js | 14 | **16.2.6** | Último estable, App Router compatible |
| Tailwind | v3 + config | **v4** (CSS-first con `@theme`) | Viene con Next 16 |
| Clerk | `SignedIn`/`SignedOut` | **`Show`** (v7) | API cambió en Clerk 7 |
| Prisma | schema con `url` | **`prisma.config.ts`** separado | Prisma 7 rompió compatibilidad |
| Middleware | `middleware.ts` | **`proxy.ts`** | Next.js 16 deprecó middleware |
| Deploy | Vercel | **Railway** | Proyecto ya conectado en Railway |
| Env vars | Crash sin keys | **Condicional (safe-by-default)** | La app carga sin API keys |

---

## Lo construido (47 archivos)

### Design System
- `src/app/globals.css` — CSS vars (`--bg`, `--accent`, `--accent2`, etc.) + `@theme`
- `src/app/layout.tsx` — Fuentes Syne + DM Mono, ClerkProvider condicional (solo si hay keys)
- `src/lib/utils.ts` — `cn()` helper (clsx + tailwind-merge)

### UI Components (`src/components/ui/`)
| Archivo | Componente |
|---------|-----------|
| `button.tsx` | Button con variants (default, outline, ghost, accent2) y sizes |
| `badge.tsx` | Badge (default, accent, accent2, muted, destructive) |
| `card.tsx` | Card, CardHeader, CardTitle, CardDescription, CardContent |
| `input.tsx` | Input estilizado |
| `textarea.tsx` | Textarea estilizado |
| `section-label.tsx` | Label de sección (pill con borde accent) |

### Layout (`src/components/layout/`)
- `nav.tsx` — Navbar sticky con links, auth condicional (Show), mobile menu
- `footer.tsx` — Footer con links y copyright
- `admin-sidebar.tsx` — Sidebar admin con navegación y estado activo

### Secciones Landing (`src/components/sections/`)
- `hero.tsx` — Hero con gradiente, CTAs, fallback a defaults si Sanity no responde
- `stats.tsx` — Barra de stats numéricas
- `services.tsx` — Grid de servicios con iconos, tags y links
- `process.tsx` — Pasos del proceso numerados
- `contact-form.tsx` — Form con RHF + Zod, estados loading/success/error

### Librerías (`src/lib/`)
| Archivo | Función | Nota |
|---------|---------|------|
| `prisma.ts` | Singleton PrismaClient | Prisma 7, sin URL en schema |
| `sanity.ts` | Cliente Sanity + `sanityFetch()` genérico | Retorna null si no hay project ID |
| `stripe.ts` | Cliente Stripe lazy | No crashea sin STRIPE_SECRET_KEY |
| `resend.ts` | Cliente Resend lazy | No crashea sin RESEND_API_KEY |
| `telegram.ts` | `sendTelegramMessage()` via fetch | Sin dependencia extra |
| `auth.ts` | `getCurrentCliente()` + `requireAdmin()` | Usa Clerk + Prisma |
| `validations.ts` | `contactSchema` (Zod) | nombre, email, mensaje |

### Páginas — Marketing `(marketing)`
| Ruta | Archivo | Tipo |
|------|---------|------|
| `/` | `(marketing)/page.tsx` | SSR — Fetch Sanity (Hero + Stats + Services + Process) |
| `/servicios` | `(marketing)/servicios/page.tsx` | SSR — Grid desde Sanity |
| `/servicios/[slug]` | `(marketing)/servicios/[slug]/page.tsx` | SSR — Detalle con metadata dinámica |
| `/gracias` | `(marketing)/gracias/page.tsx` | Estática |

### Páginas — Auth `(auth)`
| Ruta | Archivo | Nota |
|------|---------|------|
| `/sign-in` | `(auth)/sign-in/[[...sign-in]]/page.tsx` | `<SignIn />` con tema PixelArch, fallback si no hay keys |
| `/sign-up` | `(auth)/sign-up/[[...sign-up]]/page.tsx` | `<SignUp />` con tema PixelArch, fallback si no hay keys |

### Páginas — Admin `(admin)`
| Ruta | Archivo | Protegido |
|------|---------|-----------|
| `/admin/dashboard` | `admin/dashboard/page.tsx` | Role admin — Métricas, últimos clientes, gráfico |
| `/admin/clientes` | `admin/clientes/page.tsx` | Role admin — Lista con búsqueda |
| `/admin/clientes/[id]` | `admin/clientes/[id]/page.tsx` | Role admin — Detalle, suscripciones, pagos |
| `/admin/servicios` | `admin/servicios/page.tsx` | Role admin — CRUD catálogo |
| `/admin/pagos` | `admin/pagos/page.tsx` | Role admin — Historial transacciones |

### Páginas — Portal Cliente `(cliente)`
| Ruta | Archivo | Protegido |
|------|---------|-----------|
| `/portal` | `portal/page.tsx` | Autenticado — Mis servicios, banner pagos fallidos |
| `/portal/facturacion` | `portal/facturacion/page.tsx` | Autenticado — Historial de pagos |

### API Routes
| Ruta | Método | Función |
|------|--------|---------|
| `/api/contact` | POST | Valida con Zod → Resend + Telegram en parallel |
| `/api/revalidate` | POST | ISR on-demand (protegido por secreto) |
| `/api/stripe/checkout` | POST | Crea sesión de checkout Stripe |
| `/api/webhooks/stripe` | POST | 5 eventos: checkout, invoice, subscription |
| `/api/webhooks/clerk` | POST | Sync user.created/updated/deleted → BD |
| `/api/admin/suscripciones` | PATCH | Acciones admin sobre suscripciones |

### Schemas
| Archivo | Contenido |
|---------|-----------|
| `prisma/schema.prisma` | Cliente, Servicio, Suscripcion, Pago + enums |
| `prisma.config.ts` | URL de base de datos para Prisma 7 |
| `sanity/schemas/servicio.ts` | titulo, slug, descripcion, icono, tags, orden, activo |
| `sanity/schemas/landing.ts` | hero_*, stats[], proceso_pasos[] |
| `sanity/schemas/seo.ts` | titulo_sitio, descripcion, og_image, keywords |
| `sanity/schemas/contacto.ts` | email, whatsapp, telegram, redes |

### SEO
| Archivo | Función |
|---------|---------|
| `src/app/sitemap.ts` | Sitemap dinámico |
| `src/app/robots.ts` | Reglas de indexación |
| Metadata | title + description en todas las páginas |

### Config
| Archivo | Función |
|---------|---------|
| `src/proxy.ts` | Clerk middleware con roles (admin/cliente/público), no-op sin keys |
| `next.config.ts` | Dominios de imágenes (Sanity CDN) |
| `components.json` | Config de shadcn/ui |
| `.env.example` | Las 18 variables de entorno documentadas |
| `.env.local` | Copia del example (completar con keys reales) |

---

## Verificación de build

```
▲ Next.js 16.2.6 (Turbopack)
✓ Compiled successfully
✓ TypeScript — 0 errores
✓ Generating static pages (20/20)

Route (app)
┌ ○ /                    (static)
├ ○ /servicios           (static)
├ ƒ /servicios/[slug]    (dynamic)
├ ○ /gracias             (static)
├ ƒ /sign-in             (dynamic)
├ ƒ /sign-up             (dynamic)
├ ƒ /admin/*             (dynamic, role-protected)
├ ƒ /portal/*            (dynamic, auth-protected)
├ ƒ /api/*               (dynamic)
├ ○ /sitemap.xml         (static)
├ ○ /robots.txt          (static)
└ ƒ Proxy                (middleware activo)
```

---

## Lo que falta (pendiente)

### Para desarrollo local
- [ ] Llenar `.env.local` con las API keys reales (ver `.env.example`)
- [x] El frontend carga sin API keys (safe-by-default) — landing, servicios, gracias visibles
- [ ] Crear app en [Clerk](https://clerk.com) → pegar `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` y `CLERK_SECRET_KEY`
- [ ] Configurar webhook de Clerk apuntando a `https://pixelarch-production.up.railway.app/api/webhooks/clerk`
- [ ] Asignar `publicMetadata: { role: "admin" }` a tu usuario en Clerk

### Base de datos
- [x] Crear proyecto en [Railway](https://railway.app) con PostgreSQL
- [x] Pegar `DATABASE_URL` en Railway env vars
- [x] `npx prisma db push` (tablas creadas)
- [ ] Descomentar queries de Prisma en webhooks y páginas admin

### Sanity CMS
- [ ] Crear proyecto en [Sanity](https://sanity.io)
- [ ] Pegar `NEXT_PUBLIC_SANITY_PROJECT_ID` en Railway env vars
- [ ] `SANITY_API_TOKEN` (para revalidación)
- [ ] Subir los schemas de `sanity/schemas/` al Studio
- [ ] Crear documentos: landing, servicios, SEO, contacto

### Stripe
- [ ] Crear cuenta en [Stripe](https://stripe.com)
- [ ] Pegar `STRIPE_SECRET_KEY` y `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- [ ] Configurar webhook de Stripe → `https://pixelarch-production.up.railway.app/api/webhooks/stripe`
- [ ] Crear productos/precios en Stripe y vincularlos a `Servicio.stripePriceId`

### Email + Telegram
- [ ] Crear API key en [Resend](https://resend.com) → `RESEND_API_KEY`
- [ ] `CONTACT_EMAIL` (tu email para recibir mensajes)
- [ ] Crear bot en [@BotFather](https://t.me/BotFather) → `TELEGRAM_BOT_TOKEN`
- [ ] Obtener `TELEGRAM_CHAT_ID` (tu chat o grupo)

### Deploy
- [x] `NEXT_PUBLIC_URL=https://pixelarch-production.up.railway.app`
- [x] Deploy en Railway → auto-deploy desde GitHub
- [ ] Configurar webhook de Sanity → `/api/revalidate` con `SANITY_REVALIDATE_SECRET`

### Conexiones pendientes en código (marcadas con TODO)
- [ ] `api/webhooks/clerk/route.ts` — queries Prisma comentadas
- [ ] `api/webhooks/stripe/route.ts` — queries Prisma comentadas
- [ ] `api/stripe/checkout/route.ts` — obtener cliente de Clerk + precio de BD
- [ ] `api/admin/suscripciones/route.ts` — integrar con Stripe API + Prisma
- [ ] Páginas admin — reemplazar placeholders con queries reales
- [ ] Portal cliente — fetch suscripciones y pagos desde BD

---

## Comandos útiles

```bash
npm run dev        # Desarrollo local
npm run build      # Build de producción
npx tsc --noEmit   # Type check
npx prisma studio  # Explorar BD
npx prisma db push # Sincronizar schema → BD
npx prisma generate # Regenerar cliente
```
