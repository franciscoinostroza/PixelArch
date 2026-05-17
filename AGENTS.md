# PixelArch — Estado del Proyecto

**Última actualización:** Mayo 2026  
**Build:** ✅ Exitoso | **TypeScript:** ✅ 0 errores | **Rutas:** 22 compiladas  
**Deploy Railway:** ✅ Online | **BD:** ✅ PostgreSQL sincronizada | **Clerk:** ✅ Auth + Webhook svix | **Sanity:** ✅ Studio + Schemas + 9 docs  
**URL:** https://pixelarch-production.up.railway.app

---

## Stack real (con adaptaciones)

| Componente | Planeado | Real | Motivo |
|------------|----------|------|--------|
| Next.js | 14 | **16.2.6** | Último estable, App Router compatible |
| Tailwind | v3 + config | **v4** (CSS-first con `@theme`) | Viene con Next 16 |
| Clerk | `SignedIn`/`SignedOut` | **`Show`** (v7) | API cambió en Clerk 7 |
| Prisma | schema con `url` | **prisma.config.ts + adapter Pg** | Prisma 7 requiere adapter explícito |
| Middleware | `middleware.ts` | **`proxy.ts`** | Next.js 16 deprecó middleware |
| Webhook Clerk | sin verificar | **svix** (firma criptográfica) | Clerk requiere svix para webhooks |
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
| `prisma.ts` | Singleton PrismaClient con adapter `PrismaPg` | Prisma 7, adapter @prisma/adapter-pg |
| `sanity.ts` | Cliente Sanity + `sanityFetch()` genérico | Retorna null si no hay project ID |
| `payments.ts` | Cliente Paddle lazy | No crashea sin PADDLE_API_KEY |
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
| `/api/payments/checkout` | POST | Crea checkout Paddle |
| `/api/webhooks/paddle` | POST | 6 eventos: transaction, subscription |
| `/api/webhooks/clerk` | POST | Sync user.created/updated/deleted → BD (svix verificado) |
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
| `src/proxy.ts` | Clerk middleware con roles (admin/cliente/público), no-op sin keys, excluye webhooks |
| `sanity.config.ts` | Config del Sanity Studio (embebido en `/studio`) |
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

### ✅ Completado hoy (Mayo 15)
- Clerk: auth (7 vars Railway), webhook svix + Prisma sync, publicMetadata admin
- Sanity: Studio embebido (`/studio`), schemas conectados, 9 docs (6 servicios + landing + SEO + contacto), API token, webhook revalidación
- Proxy: excluye webhooks y `/studio` del middleware Clerk
- Prisma 7: adapter `@prisma/adapter-pg`
- Paddle: API key, productos/precios (6), webhooks (7 eventos), checkout + admin queries → ✅

### ✅ Paddle — completado
- [x] Crear productos/precios en [Paddle](https://paddle.com) — 6 productos + 12 precios
- [x] `PADDLE_API_KEY` y `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` configurados
- [x] Webhook → `https://pixelarch-production.up.railway.app/api/webhooks/paddle` con 7 eventos
- [x] `PADDLE_WEBHOOK_SECRET` del notification destination

### ✅ Admin + Portal — queries reales
- [x] Páginas admin — reemplazar placeholders con queries reales
- [x] Portal cliente — fetch suscripciones y pagos desde BD

### 🟡 Email + Telegram
- [x] Crear API key en [Resend](https://resend.com) → `RESEND_API_KEY`
- [x] `CONTACT_EMAIL` configurado
- [ ] Crear bot en [@BotFather](https://t.me/BotFather) → `TELEGRAM_BOT_TOKEN`
- [ ] Obtener `TELEGRAM_CHAT_ID` (tu chat o grupo)

### ✅ Deploy
- [x] Webhook de Paddle configurado → `https://pixelarch-production.up.railway.app/api/webhooks/paddle`
- [x] Railway deploy online, conectado a GitHub (auto-deploy en push)

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
