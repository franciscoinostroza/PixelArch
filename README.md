# PixelArch

Plataforma SaaS de servicios digitales: desarrollo web, chatbots, agentes de IA y automatizaciones.

## Stack

- **Framework:** Next.js 16 (App Router)
- **Estilos:** Tailwind CSS v4
- **CMS:** Sanity.io
- **BD:** PostgreSQL en Railway (Prisma 7)
- **Auth:** Clerk
- **Pagos:** Stripe
- **Email:** Resend + Telegram
- **Deploy:** Railway

## Estado actual

| Recurso | Estado | Detalle |
|---------|--------|---------|
| Build | ✅ | 0 errores TypeScript |
| Deploy | ✅ | [pixelarch-production.up.railway.app](https://pixelarch-production.up.railway.app) |
| Frontend | ✅ | Landing, servicios, gracias — visibles sin API keys |
| BD Railway | ✅ | PostgreSQL — tablas creadas con `prisma db push` |
| GitHub | ✅ | [franciscoinostroza/PixelArch](https://github.com/franciscoinostroza/PixelArch) |
| Clerk | ❌ | Falta crear app y keys |
| Stripe | ❌ | Falta crear cuenta y keys |
| Sanity | ❌ | Falta crear proyecto y project ID |
| Resend | ❌ | Falta API key |
| Telegram | ❌ | Falta bot token |

## Inicio rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar variables de entorno y completar con keys reales
cp .env.example .env.local

# 3. Generar y sincronizar Prisma
npx prisma generate
npx prisma db push

# 4. Desarrollo
npm run dev
```

## Deploy

El proyecto se deploya automáticamente en Railway al pushear a `main`. Las variables de entorno se configuran con:

```bash
railway link -p "PixelArch-Plataforma"
railway variables set "CLAVE=valor"
```

## Documentación

Ver [`AGENTS.md`](./AGENTS.md) para el estado completo, arquitectura de archivos, y checklist de pendientes.
