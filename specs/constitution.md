# Constitucion del proyecto

Principios no negociables. Cualquier plan que los contradiga debe justificarse por escrito.

## 1. Privacidad y datos de clientes
- Solo se recogen los datos necesarios para cotizar, facturar y dar soporte.
- Los datos de clientes (PII) no se registran en logs, analitica ni emails internos mas alla de lo imprescindible.
- El acceso al CRM esta restringido a admin/asistente mediante Clerk; no hay portal publico de clientes.
- Secretos y credenciales viven en variables de entorno (Railway / `.env.local`), nunca en el repositorio.

## 2. Pagos y cobros
- Mercado Pago y PayPal son las pasarelas permitidas; nunca se almacenan datos de tarjetas.
- Mercado Pago sigue siendo la pasarela principal para cobros en ARS; PayPal se usa para clientes internacionales y cobros en USD.
- Cada pasarela se integra con su propio Checkout y webhooks verificados con firma e idempotencia (`Pago.externalId` o equivalente).
- Los montos se guardan en centavos y se formatean con `formatearMonto`; ARS y USD se muestran por separado.
- Toda accion que mueva dinero debe dejar trazabilidad (pago, recibo, pasarela, quien lo registro).

## 3. Calidad tecnica
- TypeScript estricto. Lint, typecheck y build limpios antes de dar una tarea por terminada.
- Tests para toda logica de negocio; cada criterio de aceptacion tiene al menos un test.
- Sin comandos interactivos ni en watch en la automatizacion: `npm test`, `node node_modules\vitest\vitest.mjs run`, `npm run lint`, `npm run build`.
- Los cambios de esquema Prisma se sincronizan con `npx prisma db push` (o el CLI local si `npx` falla) y se documentan en el plan.

## 4. Producto, SEO y UX
- El sitio publico se renderiza en servidor (SSR/ISR) y mantiene metadata, sitemap, RSS y datos estructurados.
- Precios en ARS primero y USD cuando aplique; mensajes claros y en espanol.
- Buen rendimiento y experiencia movil (Core Web Vitals en verde).
- Accesibilidad: navegacion por teclado, contraste y textos alternativos.

## 5. Operaciones y despliegue
- Deploy en Railway desde GitHub; toda variable `NEXT_PUBLIC_*` debe llegar al build (Dockerfile `ARG` + `ENV`).
- Las paginas publicas nuevas se agregan a `ROUTES.public` del middleware; excluir `/monitoring` y `api/*` del matcher.
- Los cambios solo de docs no disparan build (watchPatterns); tocar `src/**`, `Dockerfile` o `package.json` para forzar deploy.
- Sin secretos en el repositorio; `.env.example` es la referencia.

## 6. Dependencias y licencias
- Antes de adoptar una libreria, verificar licencia, mantenimiento y alternativas. Documentar la decision en `plan.md`.

## 7. SDD
- Nada se implementa sin una spec aprobada. La spec es la fuente de verdad.
- Si el codigo y la spec difieren, se corrige uno de los dos de forma explicita.
- Ante ambiguedad, marcar `[NECESITA ACLARACION]` en la spec en lugar de inventar.

## Historial de enmiendas
- 2026-10-19: §2 se amplia para permitir PayPal ademas de Mercado Pago, para cobros internacionales en USD.
