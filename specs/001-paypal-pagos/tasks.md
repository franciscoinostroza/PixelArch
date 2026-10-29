# Tareas 001: Cobros con PayPal

Formato: `- [ ] T-XX (AC-x, AC-y) descripcion · archivos probables · dependencias`

Reglas:

- Ninguna tarea esta marcada; se completa `[x]` solo al aprobar implementacion + tests + revision.
- Cada tarea debe caber en un cambio revisable (~1 commit) y dejar `typecheck`, lint sin errores nuevos y tests en verde.
- No se incluye la deuda de lint preexistente (20 errores): no introducir errores nuevos.
- Los tests no hacen llamadas reales a PayPal; se mockea `fetch` y Prisma.
- La migracion Prisma la ejecuta el implementer con `npx prisma db push` (fallback local documentado en `plan.md` §4.2).
- `T-04b` se agrega con sufijo para no renumerar `T-05..T-38`; es una tarea independiente de migracion de formatos USD y sus tests.

## Fase 1: Base

- [x] T-01 (AC-16; RNF-2) Configuracion PayPal opcional: `paypalConfig()` con validacion de `PAYPAL_ENV`, base URL, webhook id y tarifa (default `feeBps=540`, `feeFixedCents=30`, override por env); sin lanzar si falta config y sin agregar PayPal a las envs requeridas de `src/lib/env.ts`; `.env.example` con las variables · `src/lib/paypal/config.ts`, `src/lib/env.ts`, `src/__tests__/lib/paypal-config.test.ts`, `.env.example` · sin dependencias.
- [x] T-02 (AC-17, AC-25) Roles staff/admin: `requireStaff()` acepta solo `admin` y `asistente` (`publicMetadata.role = "asistente"`, sin alias `assistant`); acceso de la asistente limitado a `/admin/clientes`, `/admin/cobros` y `/admin/pagos` (detalle y recibo incluidos); `/admin` redirige a la asistente a `/admin/cobros`; dashboard, servicios, blog y demas paginas quedan admin-only o redirigen; `requireAdmin()` queda estricto para registro manual, ajustes/reembolsos/contracargos y resolucion de diferencias; actualizar layout, middleware, nav, redirect y guards; exponer el rol para ocultar acciones admin-only en la UI; tests de autorizacion · `src/lib/auth.ts`, `src/middleware.ts`, `src/app/(admin)/layout.tsx`, `src/app/(admin)/admin/**/page.tsx`, `src/components/layout/nav.tsx`, `src/app/(auth)/redirect/page.tsx`, `src/__tests__/lib/auth.test.ts` · sin dependencias.
- [x] T-03 (AC-1, AC-10, AC-11, AC-18, AC-24) Modelo Prisma aditivo: enums `Pasarela`, `OrigenPago`, `EstadoEnlace`, `EstadoRevision`, `TipoAjuste`, `DecisionAjuste`; `MetodoPago.PAYPAL` y `METODO_LABEL` (el selector generico `METODOS_PAGO` no ofrece PayPal; solo el flujo dedicado); `EstadoPago.REVISION/CONTRACARGO`; campos de `Pago` (incluido `meses`; sin `pagadorEmail`/`pagadorNombre`); modelos `EnlacePago`, `EventoPasarela`, `AjustePago` y relaciones; documentar `db push` y backfill · `prisma/schema.prisma`, `src/lib/pagos.ts`, `specs/001-paypal-pagos/plan.md` §4.2 · sin dependencias.
- [x] T-04 (AC-1, AC-18, AC-24, AC-26) Dominio de dinero y link: gross-up entero con default 540 bps + 30 centavos, snapshot de tarifa, validacion USD/centavos, expiracion a 30 dias, token opaco, mapeo de estados y `formatearMonto` locale-aware (`es-AR`/`en-US`); tests de redondeo, limites y formato. T-04 implementa la capacidad; el default es-AR y la migracion de call sites quedan en T-04b · `src/lib/paypal/fees.ts`, `src/lib/paypal/utils.ts`, `src/lib/pagos.ts`, `src/__tests__/lib/paypal-fees.test.ts`, `src/__tests__/lib/pagos.test.ts` · T-03.
- [x] T-04b (AC-10, AC-11, AC-12, AC-18, AC-24; RNF-4, RNF-14) Migracion de formatos USD existentes: usar `formatearMonto` es-AR por defecto en UI/CRM/recibos/digest/notificaciones, reemplazar formateos ad-hoc (`toFixed`, `toLocaleString("en-US")`) y actualizar tests/expectativas que hoy esperan `US$25.00`/`US$100.00`; unica excepcion documentada: plantilla EN puede usar en-US (`US$100.50`) · `src/lib/pagos.ts`, `src/lib/digest.ts`, `src/lib/notifications.ts`, `src/app/(admin)/admin/dashboard/page.tsx`, `src/app/(admin)/admin/pagos/page.tsx`, `src/app/(admin)/admin/clientes/[id]/page.tsx`, `src/app/(admin)/admin/cobros/page.tsx`, `src/components/ui/proyecto-block.tsx`, `src/__tests__/lib/pagos.test.ts`, `src/__tests__/lib/digest.test.ts` · T-04.
- [x] T-05 (AC-3; RNF-14) Plantillas ES/EN de email y WhatsApp: concepto, monto total USD, comision, link, vencimiento; montos localizados (ES en es-AR; EN puede usar en-US como excepcion documentada); tests de ambos idiomas · `src/lib/paypal/messages.ts`, `src/__tests__/lib/paypal-messages.test.ts` · T-04.
- [x] T-06 (AC-1, AC-5, AC-7, AC-14, AC-16, AC-19; RNF-5, RNF-6) Cliente REST PayPal: OAuth cache, create/get/capture order, verify webhook signature, timeouts configurables (8 s admin/retorno, 4 s por llamada en webhook), errores sanitizados y redaccion de PII/tokens para logs/Sentry (`includeLocalVariables: false` + `beforeSend`); tests con `fetch` mockeado · `src/lib/paypal/client.ts`, `src/lib/paypal/redact.ts`, `src/sentry.server.config.ts`, `src/__tests__/lib/paypal-client.test.ts`, `src/__tests__/lib/redact.test.ts` · T-01, T-04.

## Fase 2: Backend

- [x] T-07 (AC-1, AC-2, AC-12, AC-13, AC-18, AC-24, AC-26) Servicio de links: crear `EnlacePago` con token/grupo/snapshot, primer checkout PayPal, reutilizar link activo, regenerar invalidando el anterior, vencer a los 30 dias y adoptar links MP legacy al generar PayPal; tests de grupo y reutilizacion · `src/lib/paypal/links.ts`, `src/__tests__/lib/paypal-links.test.ts` · T-03, T-04, T-06.
- [x] T-08 (AC-1, AC-2, AC-3, AC-14, AC-16, AC-17, AC-24) API `POST /api/admin/paypal/link`: staff, Zod, concepto pendiente, gross-up, reutilizacion sin duplicado, `503` claro si PayPal no esta configurado, `409` si ya esta pagado o tiene un pago en `REVISION` sin resolver; no modifica hito/soporte; tests de ruta con Prisma/PayPal mockeados · `src/app/api/admin/paypal/link/route.ts`, `src/lib/paypal/validation.ts`, `src/__tests__/api/admin/paypal-link.test.ts` · T-07.
- [x] T-09 (AC-3, AC-4, AC-12, AC-17) API `POST /api/admin/paypal/enviar`: email con Resend o registro de WhatsApp/copia, idioma ES/EN, actualiza `enviadoPor`, `enviadoEn`, `canalEnvio`, `idioma`; devuelve mensaje canonico; tests de canales y tracking · `src/app/api/admin/paypal/enviar/route.ts`, `src/lib/notifications.ts`, `src/__tests__/api/admin/paypal-enviar.test.ts` · T-05, T-07.
- [x] T-10 (AC-5, AC-8, AC-10, AC-18, AC-24, AC-27) Procesador de captura para hitos: transaccion, busqueda por `externalId`/`paypalOrderId`, comparacion de monto/moneda, `Pago` con desglose y recibo (datos del cliente del CRM, sin PII del pagador), hito PAGADO; diferencia -> `REVISION`; tests de exito y error · `src/lib/paypal/process.ts`, `src/lib/paypal/receipts.ts`, `src/__tests__/lib/paypal-process.test.ts` · T-07.
- [x] T-11 (AC-5, AC-9, AC-10, AC-24, AC-27) Procesador de soporte: meses 1–12, `vencimientoConMeses`, actualizacion unica de `proximoPago`, estado ACTIVE y `Pago.meses` para auditoria; diferencia -> `REVISION`; tests de 1/12 meses y fin de mes · `src/lib/paypal/process.ts`, `src/__tests__/lib/paypal-process-soporte.test.ts` · T-10.
- [x] T-12 (AC-5, AC-6, AC-8, AC-9, AC-13, AC-19, AC-27) Idempotencia y primer pago gana: `EventoPasarela`, constraints unicas, deteccion de duplicados simultaneos/fuera de orden, invalidacion de links hermanos del `grupoCobroId`, trazabilidad del intento descartado y del legacy MP; tests con store falso concurrente · `src/lib/paypal/process.ts`, `src/lib/paypal/events.ts`, `src/__tests__/lib/paypal-idempotencia.test.ts` · T-10, T-11.
- [x] T-13 (AC-10, AC-11, AC-12, AC-24) Recibo interno: `reciboId` unico, snapshot de montos, pasarela/referencia, datos del cliente del CRM, sin PII del pagador, sin datos de tarjeta ni factura fiscal; pagina imprimible solo staff; tests de contenido y permisos · `src/lib/paypal/receipts.ts`, `src/app/(admin)/admin/pagos/[id]/recibo/page.tsx`, `src/components/ui/recibo-paypal.tsx`, `src/__tests__/components/recibo-paypal.test.tsx` · T-10.
- [x] T-14 (AC-1, AC-8, AC-14, AC-15, AC-26, AC-28, AC-29) Rutas publicas: `/pago/paypal/[token]` valida/crea orden y redirige, `/retorno` captura, `/cancelado` registra intento, `/estado` muestra vencido/invalidado/pagado; guest checkout, no-store, noindex, rate limit; agregar `/pago(.*)` a `ROUTES.public`; tests de token/expira (AC-29 se completa en sandbox) · `src/app/pago/paypal/[token]/route.ts`, `src/app/pago/paypal/retorno/route.ts`, `src/app/pago/paypal/cancelado/route.ts`, `src/app/pago/paypal/estado/page.tsx`, `src/middleware.ts`, `src/__tests__/api/paypal-public.test.ts` · T-06, T-07, T-10. AC-29 (sandbox) se valida en T-37/T-38; no se ejecutó en T-14.
- [x] T-15 (AC-17, AC-19, AC-24, AC-25) API `POST /api/admin/paypal/manual`: solo admin, evidencia textual/URL (capture id, order id, comprobante o nota; sin archivos ni storage), `externalId`/`paypalOrderId`, lookup de orden si esta configurado, validacion de desglose, `meses` 1-12 para soporte y `Pago.meses`, flags `marcarHitoPagado`/`acreditarMeses`, unico y recibo con datos del cliente; no persiste email/nombre del pagador; si el webhook llega despues no duplica; rechazar `metodo=PAYPAL` en el endpoint generico `/api/admin/pagos`; tests de permisos y duplicado · `src/app/api/admin/paypal/manual/route.ts`, `src/lib/paypal/manual.ts`, `src/app/api/admin/pagos/route.ts`, `src/__tests__/api/admin/paypal-manual.test.ts` · T-10, T-13.
- [x] T-16 (AC-17, AC-19, AC-22) API `POST /api/admin/paypal/ajustes`: solo admin, reembolso/contracargo, conserva pago original, `AjustePago`, decision `NINGUNA|REVERTIR_HITO|DESCONTAR_MESES`, sin automatismo; tests de cada decision · `src/app/api/admin/paypal/ajustes/route.ts`, `src/lib/paypal/adjustments.ts`, `src/__tests__/api/admin/paypal-ajustes.test.ts` · T-12, T-13.
- [x] T-17 (AC-11, AC-17, AC-27) API `POST /api/admin/paypal/revision`: solo admin, aceptar/rechazar diferencia, aplicar hito/meses o dejar sin aplicar, registrar nota y quien resolvio; tests de ambos caminos · `src/app/api/admin/paypal/revision/route.ts`, `src/lib/paypal/review.ts`, `src/__tests__/api/admin/paypal-revision.test.ts` · T-10, T-13.
- [x] T-18 (AC-13, AC-20) Coexistencia MP/PayPal en backend: nuevos links MP escriben `EnlacePago`; metadata `enlaceId`; adopcion de links legacy; el webhook MP setea `pasarela=MERCADOPAGO`, `origen=AUTOMATICO`, `montoAcordado=monto`, `comision=0`, `montoEsperado=monto` y `meses` cuando aplica, detecta duplicados, registra el intento descartado e invalida links PayPal; el registro manual con metodo MP setea `pasarela=MERCADOPAGO`; un pago MP sigue actualizando hito/soporte como antes; tests de regresion MP · `src/app/api/admin/mp/link/route.ts`, `src/app/api/webhooks/mercadopago/route.ts`, `src/app/api/admin/pagos/route.ts`, `src/lib/mercadopago.ts`, `src/lib/mp-utils.ts`, `src/__tests__/api/mercadopago-coexistencia.test.ts` · T-07, T-12.
- [x] T-19 (AC-11, AC-12, AC-19) Helpers de historial/vista: filtro `pasarela`, mapeo de concepto, referencia, desglose, canal/fecha de envio y estado de revision; sin PII; tests puros · `src/lib/paypal/view.ts`, `src/lib/pagos.ts`, `src/__tests__/lib/paypal-view.test.ts` · T-03, T-13.

## Fase 3: UI

- [x] T-20 (AC-1, AC-2, AC-3, AC-14, AC-16, AC-23, AC-24, AC-26) Modal accesible de link PayPal: monto USD, meses (soporte), preview de comision/total, idioma, link vigente, copiar, WhatsApp, email, regenerar, loading/timeout y errores `role=alert`; deshabilitado si PayPal no esta configurado; tests de teclado/foco · `src/components/ui/paypal-link-modal.tsx`, `src/components/ui/generar-link-paypal-button.tsx`, `src/__tests__/components/paypal-link-modal.test.tsx` · T-08, T-09.
- [x] T-21 (AC-1, AC-2, AC-12, AC-26) Integrar PayPal en cliente/proyecto: boton en hitos PENDIENTES y soportes ACTIVE/PAST_DUE, incluir `enlacesPago` activos, mostrar link/vencimiento y no ofrecer si ya esta pagado · `src/app/(admin)/admin/clientes/[id]/page.tsx`, `src/components/ui/proyecto-block.tsx` · T-20.
- [x] T-22 (AC-4, AC-15, AC-23) Integrar en `/admin/cobros`: enviar/recordar PayPal, ver ultimo intento fallido, estado vencido/invalidado y regenerar sin cambiar el estado del cobro · `src/app/(admin)/admin/cobros/page.tsx`, `src/components/ui/paypal-link-modal.tsx` · T-20, T-09.
- [x] T-23 (AC-11, AC-12, AC-19, AC-24) `/admin/pagos`: filtro por pasarela PayPal, columnas de concepto/referencia/monto acordado/comision/total/moneda/estado, distincion MP/PayPal y acceso a eventos que requieren accion (reembolsos/contracargos/duplicados); tests de vista · `src/app/(admin)/admin/pagos/page.tsx`, `src/components/ui/pagos-tabla.tsx`, `src/__tests__/components/pagos-paypal.test.tsx` · T-19.
- [x] T-24 (AC-10, AC-12, AC-19, AC-22) Historial del cliente: desglose PayPal, quien genero, fecha/canal de envio, link al recibo, estado de revision y ajustes; sin PII innecesaria · `src/app/(admin)/admin/clientes/[id]/page.tsx`, `src/components/ui/pago-paypal-row.tsx`, `src/__tests__/components/cliente-paypal.test.tsx` · T-13, T-16, T-19.
- [x] T-25 (AC-17, AC-23, AC-25) UI de registro manual PayPal: solo admin (`puedeRegistrarManual`), campos de capture/order id, monto acordado/comision/total, evidencia textual/URL (sin upload), fecha, meses, checkboxes de aplicacion y recibo; oculto para asistente, junto con los botones de registro manual generico (MP/transferencia) cuyas APIs siguen siendo admin-only; el recibo usa datos del cliente del CRM; tests de teclado y permisos · `src/components/ui/registrar-pago-paypal-button.tsx`, `src/components/ui/registrar-pago-button.tsx`, `src/components/ui/registrar-pago-hito-button.tsx`, `src/app/(admin)/admin/clientes/[id]/page.tsx`, `src/app/(admin)/admin/cobros/page.tsx`, `src/__tests__/components/registrar-pago-paypal.test.tsx` · T-15.
- [x] T-26 (AC-17, AC-22, AC-23) UI de reembolso/contracargo: solo admin, monto/motivo/evidencia, decision sobre hito o meses, conserva el pago original; tests de teclado y confirmacion · `src/components/ui/ajuste-paypal-button.tsx`, `src/app/(admin)/admin/pagos/page.tsx`, `src/app/(admin)/admin/clientes/[id]/page.tsx`, `src/__tests__/components/ajuste-paypal.test.tsx` · T-16, T-24.
- [x] T-27 (AC-23, AC-27) UI de revision de diferencia: mostrar esperado vs cobrado y diferencia, aceptar/rechazar (solo admin), nota; tests de teclado y mensajes accesibles · `src/components/ui/revision-paypal-button.tsx`, `src/app/(admin)/admin/pagos/page.tsx`, `src/__tests__/components/revision-paypal.test.tsx` · T-17, T-23.
- [x] T-28 (AC-23) Pase de accesibilidad de los flujos PayPal: foco inicial/retorno, Escape, trampa de foco, `aria-labelledby`, `aria-live`, etiquetas, contraste y estados no solo por color; tests de teclado en modales · `src/components/ui/paypal-link-modal.tsx`, `src/components/ui/registrar-pago-paypal-button.tsx`, `src/components/ui/ajuste-paypal-button.tsx`, `src/components/ui/revision-paypal-button.tsx`, `src/__tests__/components/paypal-accesibilidad.test.tsx` · T-20, T-25, T-26, T-27.

## Fase 4: Webhook

- [x] T-29 (AC-5, AC-7, AC-11, AC-13, AC-15, AC-19, AC-21; RNF-1, RNF-5, RNF-6) Ruta `POST /api/webhooks/paypal`: headers, verificacion contra PayPal, rechazo 401, parseo/dispatch de `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED/DENIED/REFUNDED/REVERSED` y disputes; `200` para ignorados/duplicados, `500` para reintento; sin payload crudo ni PII; tests con fetch/Prisma mockeados · `src/app/api/webhooks/paypal/route.ts`, `src/lib/paypal/webhook.ts`, `src/__tests__/api/webhooks/paypal.test.ts` · T-12, T-14.
- [x] T-30 (AC-6, AC-7, AC-13, AC-15, AC-21) Resiliencia de webhook: firma invalida/ausente/alterada, timeout de verificacion, evento repetido, dos simultaneos, fuera de orden, evento desconocido y segundo pago descartado; tests sin red · `src/__tests__/api/webhooks/paypal-resiliencia.test.ts`, `src/__tests__/lib/paypal-webhook.test.ts` · T-29.

## Fase 5: Tests

- [x] T-31 (AC-18, AC-19, AC-24, AC-28) Tests de dinero y PII: 10050 centavos, redondeo, tarifa 0/invalida, `US$100,50`/`US$1.000,50` (es-AR) y `US$100.50` solo en plantilla EN, logs/Sentry sin email/nombre, guest checkout flags · `src/__tests__/lib/paypal-dinero.test.ts`, `src/__tests__/lib/redact.test.ts` · T-04, T-04b, T-06, T-10.
- [x] T-32 (AC-20, AC-21) Regresion MP y suite completa: la suite existente (148 tests baseline) sigue pasando, links MP intactos, pago MP actualiza hito/soporte, link PayPal coexiste; ejecutar `npm test`, typecheck y build · `src/__tests__/api/mercadopago-coexistencia.test.ts`, `src/__tests__/lib/mp-utils.test.ts`, suite existente · T-18.
- [x] T-33 (AC-21, AC-29) Guard de tests sin red: fallar si un test intenta llamar a `api-m*.paypal.com`; documentar que la validacion sandbox final se corre en Railway staging (local/ngrok solo desarrollo); verificar que `PAYPAL_*` ausente deshabilita sin romper MP · `src/__tests__/setup.ts`, `src/__tests__/lib/paypal-config.test.ts`, `specs/001-paypal-pagos/plan.md` §7.7 · T-30.
- [x] T-34 (AC-21) Meta-test de cobertura: leer `spec.md`, extraer `AC-1..AC-29` y fallar si un AC no aparece en ningun test; documentar AC-29 como manual/sandbox · `src/__tests__/spec-coverage.test.ts` · T-30, T-31, T-32, T-33.

## Fase 6: Docs

- [x] T-35 (AC-16, AC-29; RNF-2) Documentacion operativa: `.env.example` con `PAYPAL_*`, `AGENTS.md` con el flujo/modelo/estados, `MEMORY.md` con gotchas (orden PayPal 3 h vs link 30 d, gross-up 5,40% + US$0,30, webhook, rol `asistente` sin alias, formato USD es-AR con excepcion EN, evidencia sin storage, datos del pagador no persistidos, sandbox en Railway staging) y nota de que no hace falta Dockerfile porque no hay `NEXT_PUBLIC_*` de PayPal · `.env.example`, `AGENTS.md`, `MEMORY.md` · T-01, T-04b, T-09, T-34.
- [x] T-36 (AC-29; RNF-11) Runbook sandbox: checklist de §7.7, credenciales/webhook del dueno, **Railway staging con Postgres separado** (local/ngrok solo desarrollo), validacion de la tarifa real, evidencia esperada y criterio de “listo para produccion” · `specs/001-paypal-pagos/sandbox.md`, `specs/001-paypal-pagos/plan.md` §7.7 · T-35.

## Fase 7: Deploy

- [x] T-37 (AC-16, AC-29) Deploy sandbox: crear/verificar el entorno **Railway staging con Postgres separado**, aplicar `prisma db push`/backfill en esa BD, cargar envs sandbox, configurar el webhook sandbox contra la URL publica estable de staging, validar la tarifa real y ejecutar el checklist completo; verificar que produccion no se toca · `prisma/schema.prisma`, `specs/001-paypal-pagos/sandbox.md` · T-03, T-36. PASS con observaciones; evidencia en review.md; T-38 no autorizado en esta sesión.
- [ ] T-38 (AC-29) Rollout produccion: solo despues de aprobar el checklist en staging; migracion/backfill en produccion antes del deploy, deploy con PayPal deshabilitado, cargar envs y webhook de produccion, smoke test (health, admin, link MP, link PayPal de bajo monto si el dueno lo aprueba), monitorear logs/Sentry y confirmar MP intacto; rollback = quitar envs PayPal · `railway.toml`, `.env.example`, `specs/001-paypal-pagos/sandbox.md` · T-37.

---

## Mapa AC → tareas

| AC | Tareas |
|---|---|
| AC-1 | T-03, T-04, T-06, T-07, T-08, T-14, T-20, T-21 |
| AC-2 | T-07, T-08, T-20, T-21 |
| AC-3 | T-05, T-08, T-09, T-20 |
| AC-4 | T-09, T-22 |
| AC-5 | T-06, T-10, T-11, T-12, T-29 |
| AC-6 | T-12, T-30 |
| AC-7 | T-06, T-29, T-30 |
| AC-8 | T-10, T-12, T-14 |
| AC-9 | T-11, T-12 |
| AC-10 | T-03, T-04b, T-10, T-11, T-13, T-24 |
| AC-11 | T-03, T-04b, T-13, T-17, T-19, T-23, T-29 |
| AC-12 | T-04b, T-07, T-09, T-13, T-19, T-21, T-23, T-24 |
| AC-13 | T-07, T-12, T-18, T-29, T-30 |
| AC-14 | T-06, T-08, T-10, T-14, T-20 |
| AC-15 | T-14, T-22, T-29, T-30 |
| AC-16 | T-01, T-06, T-08, T-20, T-35, T-37 |
| AC-17 | T-02, T-08, T-09, T-15, T-16, T-17, T-25, T-26 |
| AC-18 | T-03, T-04, T-04b, T-07, T-10, T-31 |
| AC-19 | T-06, T-12, T-15, T-16, T-19, T-23, T-24, T-29, T-31 |
| AC-20 | T-18, T-32 |
| AC-21 | T-29, T-30, T-32, T-33, T-34 |
| AC-22 | T-16, T-24, T-26 |
| AC-23 | T-20, T-22, T-25, T-26, T-27, T-28 |
| AC-24 | T-03, T-04, T-04b, T-07, T-08, T-10, T-11, T-13, T-15, T-20, T-23, T-31 |
| AC-25 | T-02, T-15, T-25 |
| AC-26 | T-04, T-07, T-14, T-20, T-21 |
| AC-27 | T-10, T-11, T-12, T-17, T-27 |
| AC-28 | T-14, T-31 |
| AC-29 | T-14, T-33, T-35, T-36, T-37, T-38 |

## Mapa RF → tareas

| RF | Tareas |
|---|---|
| RF-1 | T-07, T-08, T-21 |
| RF-2 | T-03, T-04, T-07, T-10 |
| RF-3 | T-08, T-20 |
| RF-4 | T-06, T-07, T-14 |
| RF-5 | T-04, T-07, T-20, T-21 |
| RF-6 | T-04b, T-05, T-09, T-20 |
| RF-7 | T-09, T-22 |
| RF-8 | T-14 |
| RF-9 | T-07, T-18 |
| RF-10 | T-04, T-04b, T-10, T-11, T-13 |
| RF-11 | T-06, T-29, T-30 |
| RF-12 | T-04b, T-10, T-11, T-13 |
| RF-13 | T-12, T-29, T-30 |
| RF-14 | T-10, T-12 |
| RF-15 | T-11, T-12 |
| RF-16 | T-15, T-25 |
| RF-17 | T-06, T-15, T-19, T-32 |
| RF-18 | T-04b, T-13, T-24 |
| RF-19 | T-04b, T-19, T-23, T-24 |
| RF-20 | T-16, T-26 |
| RF-21 | T-06, T-14, T-22, T-29 |
| RF-22 | T-07, T-12, T-18 |
| RF-23 | T-18, T-33 |
| RF-24 | T-02, T-15, T-16, T-17, T-25, T-26, T-27 |
| RF-25 | T-01, T-06, T-08, T-20 |

## RNF → tareas

| RNF | Tareas |
|---|---|
| RNF-1 | T-29, T-30 |
| RNF-2 | T-01, T-35 |
| RNF-3 | T-03, T-06, T-31 |
| RNF-4 | T-03, T-04, T-04b, T-10, T-13 |
| RNF-5 | T-06, T-29, T-30 |
| RNF-6 | T-06, T-29, T-31 |
| RNF-7 | T-33, T-34 |
| RNF-8 | T-32 |
| RNF-9 | T-20, T-28 |
| RNF-10 | T-20 |
| RNF-11 | T-36, T-37 |
| RNF-12 | T-03, T-16 |
| RNF-13 | T-06, T-19, T-31 |
| RNF-14 | T-04, T-04b, T-05 |
