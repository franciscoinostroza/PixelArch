# PixelArch

Plataforma SaaS de servicios digitales: desarrollo web, chatbots, agentes de IA y automatizaciones.

## Stack

- **Framework:** Next.js 16 (App Router)
- **Estilos:** Tailwind CSS v4
- **CMS:** Sanity.io
- **BD:** PostgreSQL (Prisma 7)
- **Auth:** Clerk
- **Pagos:** Stripe
- **Email:** Resend + Telegram

## Inicio rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar variables de entorno y completar con keys reales
cp .env.example .env.local

# 3. Generar cliente Prisma
npx prisma generate

# 4. Sincronizar base de datos
npx prisma db push

# 5. Desarrollo
npm run dev
```

## Documentación

Ver [`AGENTS.md`](./AGENTS.md) para el estado completo del proyecto, arquitectura de archivos, y checklist de pendientes.
