# PixelArch — Estado del Proyecto

> Memoria operativa del agente (workflow, comandos, gotchas): ver **MEMORY.md**.

**Ultima actualizacion:** 13 de noviembre de 2026
**Build:** TypeScript 0 errores | **Lint:** 18 errores/18 warnings preexistentes | **Tests:** 3031 en 114 archivos (ultima corrida T-25) | **Build local:** PASS en T-25
**Portal de propuestas (spec 004):** cerrado hasta **T-24** (T-01..T-24 PASS tester+reviewer); **T-25 en verificación** (PASS tester: suite 3031/114, tsc 0, lint 18/18, build PASS; pendiente cierre reviewer); codigo desplegado; **esquema pendiente de `db push`** y `PROPUESTAS_ENVIO_HABILITADO=false` (falla cerrado con `ESQUEMA_NO_APLICADO`); gates T-26/T-27 pendientes
**PayPal:** **produccion Live** (T-38 PASS con observacion, deploy `f1185f76`, commit `de64b50`, health OK); sin pago real de smoke por decision del dueno
**Hardening PayPal/MP (spec 003):** H-5/H-6/H-7/H-8/H-9 implementados y **PASS tester+reviewer**; **sin cambios de schema/envs**; T-09 (smoke manual de staging) pendiente como deuda documental
**Recibo MP:** desplegado a produccion con T-38 (T-01..T-07); **sin cambios de schema**; falta validacion con un cobro MP real
**Deploy Railway:** Online (Mercado Pago + PayPal Live) | **BD:** PostgreSQL sincronizada para CRM/PayPal en staging y produccion (`db push` + backfill, `UPDATE 0`); **esquema de propuestas pendiente de `db push`** | **Clerk:** Auth admin/asistente (gate con modal) | **Sanity:** Studio + Schemas + 15 articulos | **Pagos:** CRM por proyectos/hitos + soporte mensual + Mercado Pago (links) + PayPal (USD) + recibo interno PayPal/MP
**URL:** https://pixelarch.dev

---

## Metodologia: Spec-Driven Development (SDD)

Nada se implementa sin spec aprobada. Flujo:

```
Constitucion → Spec (QUE/POR QUE) → Plan (COMO) → Tareas → Implementacion → Tests → Revision
```

| Fase | Artefacto | Quien lo produce |
|------|-----------|------------------|
| 1. Specify | `specs/NNN-slug/spec.md` | planner |
| 2. Plan | `specs/NNN-slug/plan.md` | planner |
| 3. Tasks | `specs/NNN-slug/tasks.md` | planner |
| 4. Implement | codigo en `src/` | implementer |
| 5. Test | tests en `src/__tests__/` + reporte | tester |
| 6. Review | `specs/NNN-slug/review.md` | reviewer (lo guarda planner) |

### Agentes (OpenCode)

- **coordinator** (primario, por defecto): orquesta, no escribe codigo ni specs. Delega y verifica.
- **planner** (sub): spec, plan, tareas e informes de revision. Solo escribe en `specs/`.
- **implementer** (sub): implementa UNA tarea a la vez segun `tasks.md`.
- **tester** (sub): escribe y ejecuta tests contra los criterios de aceptacion.
- **reviewer** (sub): revision de solo lectura (calidad, seguridad, conformidad con la spec).

### Comandos

- `/specify <idea>`: crea la spec.
- `/plan <NNN>`: plan tecnico + tareas.
- `/implement <NNN>`: ejecuta la siguiente tarea pendiente.
- `/verify <NNN>`: tests + revision global.

### Reglas SDD

1. La spec es la fuente de verdad. Si el codigo y la spec difieren, se corrige uno de los dos de forma explicita.
2. Cada tarea referencia al menos un criterio de aceptacion (`AC-x`).
3. Una tarea = un cambio revisable (~1 commit).
4. Ante ambiguedad, marcar `[NECESITA ACLARACION]` en la spec en lugar de inventar.
5. Principios no negociables en `specs/constitution.md`; workflow operativo en `MEMORY.md`.

---

## Stack

| Componente | Version | Detalle |
|------------|---------|---------|
| Next.js | 16.2.6 | App Router, Turbopack |
| Tailwind | v4 | CSS-first con `@theme` |
| Clerk | v7 | `Show`, `ClerkProvider`, login solo para admin/asistente (`publicMetadata.role`) |
| Prisma | 7 | adapter `@prisma/adapter-pg` |
| Sanity | v5 | Studio embebido en `/studio` |
| Resend | v6 | Emails transaccionales |
| Sentry | 11 | Errors + tracing + replay (condicional a SENTRY_DSN, tunnel `/monitoring`) |
| PayPal | REST Orders v2 | `fetch` nativo, checkout alojado, webhook verificado con firma (sin SDK) |
| Vitest | 3.2.6 | Testing (3031 tests, 114 archivos; baseline T-25; flake ocasional de `registrar-pago-paypal`) |
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

### Pagos PayPal (publico)

| Ruta | Funcion |
|------|---------|
| `/pago/paypal/[token]` | Link estable de 30 dias: valida token/estado/concepto, crea o renueva la orden PayPal (3 h) y redirige al checkout alojado |
| `/pago/paypal/retorno` | PayPal vuelve del checkout: consulta/captura la orden y registra el pago (idempotente) |
| `/pago/paypal/cancelado` | Registra el intento cancelado sin cambiar el estado del cobro y fuerza una orden nueva en el proximo intento |
| `/pago/paypal/estado` | Pagina publica con el estado del link (pendiente/pagado/vencido/invalidado/error), sin datos del cliente |

Las rutas de pago son `no-store`, `no-referrer` y `noindex`; el pago es como invitado cuando PayPal lo permite. Estan en `ROUTES.public` del middleware (`/pago` y `/pago/(.*)`).

### Auth (Clerk) — solo admin/asistente

| Ruta | Componente |
|------|-----------|
| `/sign-in` | `<SignIn />` con tema PixelArch (fallback de Clerk) |
| `/gate/admin` | Gate: abre el modal de Clerk sobre el sitio (`openSignIn`) y redirige a `next` |

El nav publico **no muestra "Ingresar"**: el acceso es entrando a `/admin` (el middleware hace rewrite al gate y aparece el modal). Registro publico desactivado.

Roles (`publicMetadata.role`, sin alias `assistant`):

- **`admin`**: acceso completo al CRM y a todas las acciones sensibles.
- **`asistente`**: solo `/admin/clientes`, `/admin/cobros` y `/admin/pagos` (incluye detalle del cliente y recibo). Dashboard, servicios, blog y el resto quedan admin-only; `/admin` la redirige a `/admin/cobros`.
- **Solo admin**: registro manual de pagos PayPal, reembolsos/contracargos y resolucion de diferencias. `requireStaff()` habilita link/envio; `requireAdmin()` queda estricto para lo sensible.

### Admin (staff: rol "admin" o "asistente")

| Ruta | Funcionalidad |
|------|--------------|
| `/admin/dashboard` | Metricas (ingresos USD/ARS, por cobrar 7d, clientes, suscripciones, vencidos) + ultimos clientes + chart estados · admin-only |
| `/admin/clientes` | Lista paginada (20/pag) con busqueda + **alta manual de clientes** |
| `/admin/clientes/[id]` | Datos + editar + notas + **proyectos por hitos** (crear, editar, agregar/eliminar hitos, link MP/PayPal, registrar pago) + **soporte** (activar, precio, vencimiento, deploy, link PayPal) + historial con **"Ver recibo"** para pagos PayPal/MP elegibles · registro manual PayPal solo admin |
| `/admin/cobros` | **Hitos pendientes (vencidos/por vencer/sin fecha) + Soportes** con acciones: registrar pago, link MP (recordado 30 dias) / PayPal (link 30 dias), recordar (WhatsApp/email), pausar · sin link de recibo |
| `/admin/servicios` | Catalogo de productos desde Prisma con precios y estado activo/inactivo · admin-only |
| `/admin/pagos` | Historial con filtros (estado, rango fechas, pasarela) + paginacion + moneda/metodo + desglose PayPal (acordado/comision/total) + revision/ajustes (admin) + **"Ver recibo"** para pagos PayPal/MP elegibles |
| `/admin/pagos/[id]/recibo` | Recibo interno imprimible de un pago **PayPal o Mercado Pago** (staff; datos del cliente del CRM, sin PII del pagador; A4). MP: id derivado, estados elegibles y referencia externa obligatoria |
| `/admin/blog` | Gestion del blog (enlaza a Sanity Studio) · admin-only |

La asistente solo ve clientes, cobros y pagos (incluye detalle y recibo). Las acciones de registro manual PayPal, reembolso/contracargo y resolucion de diferencias se ocultan en la UI para la asistente y las APIs las rechazan con `requireAdmin()`.

### Portal de propuestas (spec 004; admin-only)

Portal interno de prospeccion B2B **separado del CRM**: no lee ni escribe `Cliente`, `Pago`, `Suscripcion`, `EnlacePago`, `Proyecto` ni `Hito`, y no crea clientes ni cobros.

| Ruta | Funcion |
|------|---------|
| `/propuestas` | Dashboard: campanas, cola, cupos, supresiones y estado operativo |
| `/propuestas/buscar` | Alta de campana/busqueda (Places) con `limiteCorrida` 1-20 |
| `/propuestas/campanas/[id]` | Detalle, ejecucion de Places, resultados transitorios, duplicados y consumo |
| `/propuestas/prospectos/[id]` | Ficha, fuentes, auditoria, score, borrador, aprobacion, ARCO |
| `/propuestas/bandeja` | Borradores `BORRADOR`/`APROBADO` pendientes, sin acciones masivas |
| `/propuestas/plantillas` + `/propuestas/plantillas/[id]` | Plantillas versionadas y vista previa con prospecto real |
| `/propuestas/envios` | Historial de envios y estados |
| `/propuestas/supresiones` | Supresiones por email/dominio y revocacion excepcional con motivo |
| `/propuestas/baja/[token]` | Baja publica por token, layout propio `(propuestas-baja)`, `noindex`/`no-store`/`no-referrer` |

**APIs:** `/api/propuestas/**` (admin; `401/403` JSON en middleware) y `/api/opt-out` (POST publico one-click RFC 8058). La purga programada vive en `/api/cron/propuestas-retencion` (`Authorization: Bearer $CRON_SECRET`).

**Auth:** solo `publicMetadata.role === "admin"`. `resolverAdminPropuestas()` es Clerk-only (sin Prisma ni consultas al CRM); el layout redirige sin sesion a `/gate/admin?next=/propuestas` y a la asistente a `/admin/cobros`, mientras que las APIs `/api/propuestas/**` responden `401`/`403` JSON. El portal tiene shell/sidebar propios sin navegacion de CRM.

**Modelos aditivos (sin FKs al CRM):** `CampanaProspeccion`, `Prospecto`, `PlantillaPropuesta`, `EnvioPropuesta`, `SupresionProspecto`, `ConsumoProveedor` (y 8 enums). `SupresionProspecto` no tiene relacion con `Prospecto`: sobrevive al borrado del prospecto.

**Flujo:** Places (solo `place_id` persistido) → dedupe por `placeId`/email/dominio de negocio → fetch seguro + robots + auditoria + score determinista → plantilla/borrador con grounding → **aprobacion con snapshot** (footer legal, token de baja y hash) → envio con Resend (`Idempotency-Key`, `List-Unsubscribe` one-click) → registro manual de resultado y supresion. **Nada es automatico:** sin scheduler, envio por lote ni retry automatico; rebotes/quejas/respuestas se registran a mano.

**Envs:** todas server-only, sin `NEXT_PUBLIC_*` nuevas (`NEXT_PUBLIC_URL` ya existente se usa para baja y check de origen). `PROPUESTAS_ENVIO_HABILITADO=false` por defecto; `estadoEnvio()` exige ademas `RESEND_API_KEY`, from/reply-to, `PROPUESTAS_SECRETO` (min. 32), URL HTTPS, `PROPUESTAS_TEXTO_LEGAL` y `PROPUESTAS_BASE_LEGAL`. Aprobar no exige el gate y nunca envia; solo el envio lo exige.

**Estado de despliegue:** codigo del portal desplegado, pero el **esquema de propuestas sigue pendiente de `db push`** y el envio esta deshabilitado. El portal **falla cerrado** (`ESQUEMA_NO_APLICADO`): sin tablas no muestra datos ni formularios. Habilitar solo tras T-26 (staging), T-27 (produccion, con dueno) y el checklist legal firmado.

**Deuda v1:** LLM no implementado (`PROPUESTAS_LLM_HABILITADO` reservado; `modo="LLM"` falla cerrado), sin webhooks de Resend, cupo `REDACTOR` definido pero no reservado, listas sin paginacion completa (bandeja/supresiones 200, envios 100) y reconciliacion de `ENVIANDO` solo por API.

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
| `/api/admin/paypal/link` | POST | Staff: crear/reutilizar link PayPal de un hito o soporte (gross-up, sin cambiar el cobro) |
| `/api/admin/paypal/enviar` | POST | Staff: enviar por email (Resend) o registrar WhatsApp/copia en ES/EN |
| `/api/admin/paypal/manual` | POST | **Admin**: registrar pago PayPal manual con evidencia textual/URL e idempotencia |
| `/api/admin/paypal/ajustes` | POST | **Admin**: registrar reembolso/contracargo y decidir hito/meses (sin automatismo) |
| `/api/admin/paypal/revision` | POST | **Admin**: aceptar/rechazar una diferencia de monto o moneda |
| `/api/webhooks/paypal` | POST | PayPal: firma server-to-server + dispatch idempotente (capture, fallos, refunds/disputas) |
| `/api/admin/recordar` | POST | Admin: recordatorio de pago por email (hito o soporte) |
| `/api/admin/suscripciones` | PATCH | Admin: activar/pausar/reactivar/cancelar/vencido + precio/vencimiento + deploy |
| `/api/admin/entregar` | POST | Admin: marcar entregado + email |
| `/api/admin/asignar-producto` | POST | Admin: asignar producto a cliente |
| `/api/propuestas/campanas` | POST | **Admin**: alta de campana idempotente (no busca ni envia) |
| `/api/propuestas/campanas/[id]/ejecutar` · `/cancelar` | POST | **Admin**: corrida Places acotada / cancelacion sin nuevas llamadas |
| `/api/propuestas/prospectos` · `/[id]` · `/[id]/analizar` · `/[id]/borrador` · `/[id]/descartar` | POST/PATCH | **Admin**: alta manual con fuente, correccion, fetch/auditoria/score, borrador y descarte |
| `/api/propuestas/plantillas` · `/[id]` | POST/PATCH | **Admin**: plantillas versionadas |
| `/api/propuestas/envios/[id]` · `/aprobar` · `/enviar` · `/reintentar` · `/resultado` · `/reconciliar` | PATCH/POST | **Admin**: edicion/version, snapshot, envio Resend, reintento manual, resultado y reconciliacion |
| `/api/propuestas/supresiones` · `/[id]/revocar` · `/[id]/purga` | POST | **Admin**: supresion por hash/dominio, revocacion con motivo y purga manual |
| `/api/propuestas/arco/[prospectoId]` | POST | **Admin**: exportar/rectificar/eliminar (ARCO) |
| `/api/propuestas/retencion` | POST | **Admin**: purga manual de prospectos vencidos |
| `/api/opt-out` | POST | Publico one-click (RFC 8058): baja por token, idempotente y con rate limit |
| `/api/cron/propuestas-retencion` | GET | Purga programada con `Authorization: Bearer $CRON_SECRET` |
| `/api/cron/uptime` | GET | Monitoreo: chequea 4 servicios (Railway Function `uptime-cron` cada 10 min) + alertas por email |
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
| `mp-utils.ts` | Logica pura MP browser-safe: meses, mapeo de estados, vencimiento por meses, titulos + dominio del recibo (estados, montos, moneda, fecha) |
| `mp-recibo.ts` | Dominio **server-only** del recibo MP: id derivado SHA-256 (`MP-AAAAMMDD-<32 hex>`), construccion y evaluacion (sin Prisma, red ni email) |
| `paypal/config.ts` | `paypalConfig()`: envs server-only, sandbox/produccion, base URL, webhook id y tarifa; nunca lanza |
| `paypal/client.ts` | OAuth con cache, create/get/capture order, verify webhook, timeouts y errores sanitizados |
| `paypal/fees.ts` | Gross-up entero, snapshot de tarifa y validacion USD/centavos |
| `paypal/links.ts` | Crear/reutilizar/regenerar/vencer links, token opaco, grupo de cobro y adopcion de links MP |
| `paypal/process.ts` | Captura idempotente: hito/soporte, primer pago gana y diferencias a `REVISION` |
| `paypal/events.ts` | Trazabilidad tecnica (`EventoPasarela`) y deduplicacion |
| `paypal/webhook.ts` | Parseo/dispatch de eventos sin payload crudo ni PII |
| `paypal/receipts.ts` | `reciboId`, snapshot y datos del recibo tomados del cliente del CRM |
| `paypal/messages.ts` | Plantillas ES/EN de email y WhatsApp con montos localizados |
| `paypal/manual.ts` | Registro manual PayPal (solo admin) con evidencia e idempotencia |
| `paypal/adjustments.ts` | Reembolsos/contracargos manuales y decision del admin |
| `paypal/review.ts` | Aceptar/rechazar diferencias de monto o moneda |
| `paypal/redact.ts` | Redaccion de PII/secretos para logs y Sentry |
| `paypal/validation.ts` | Esquemas Zod de bodies y webhooks |
| `paypal/view.ts` | Pasarela efectiva (`pasarela` + fallback `metodo`), referencias, desglose y elegibilidad de recibo PayPal/MP |
| `reading-time.ts` | Tiempo de lectura desde Portable Text |
| `chat.ts` | Intents del chat demo (PixelBot) |
| `deploy.ts` | Pausar/reanudar deploys (Railway/Vercel) |
| `uptime-alerts.ts` | Logica pura de alertas de uptime por transicion (caida/recuperacion) |
| `digest.ts` | Armado del digest diario de cobros (hitos, soportes, cobrado 24h) |
| `propuestas/config.ts` / `errores.ts` / `origen.ts` | Config server-only fail-closed, gate `estadoEnvio()`, codigos/`ESQUEMA_NO_APLICADO` y check same-origin |
| `propuestas/auth.ts` | Guard Clerk-only `resolverAdminPropuestas()` (sin Prisma ni CRM) |
| `propuestas/places.ts` / `web.ts` / `auditoria.ts` / `score.ts` | Places, fetch seguro + robots, auditoria interna y score determinista |
| `propuestas/normalizar.ts` / `dedupe.ts` / `prospectos.ts` | Normalizacion, dedupe y alta/correccion de prospectos |
| `propuestas/supresion.ts` / `supresiones.ts` / `email.ts` / `legal.ts` / `plantillas.ts` | HMAC/baja, supresiones, email legal y render de plantillas |
| `propuestas/envios.ts` / `resend.ts` / `consumo.ts` / `retencion.ts` / `arco.ts` | Snapshot/hash, wrapper Resend idempotente, cupos, retencion y ARCO |
| `propuestas/redact.ts` / `validation.ts` / `transiciones.ts` / `fechas.ts` | Redaccion de PII/Sentry, esquemas Zod, transiciones/permisos y fechas UTC/es-AR |

### UI Components clave (`src/components/`)

| Componente | Uso |
|-----------|-----|
| `layout/admin-gate.tsx` | Modal de ingreso al admin (openSignIn sobre el sitio) |
| `layout/admin-user-button.tsx` | Cuenta + cerrar sesion en el sidebar del admin (AccountModal custom) |
| `propuestas/portal-shell.tsx` / `portal-sidebar.tsx` / `estado-vacio.tsx` | Shell, sidebar y estados vacios del portal (sin nav de CRM) |
| `propuestas/campana-form.tsx` / `campana-tabla.tsx` / `prospecto-ficha.tsx` / `score-desglose.tsx` | Alta/ejecucion de campanas, ficha y desglose de score |
| `propuestas/borrador-editor.tsx` / `aprobacion-panel.tsx` / `envio-confirmacion.tsx` | Borrador, snapshot de aprobacion y confirmacion de envio |
| `propuestas/cupo-dia.tsx` / `supresion-form.tsx` / `arco-panel.tsx` / `baja-confirmar.tsx` | Cupos, supresiones, ARCO y baja publica |
| `ui/account-modal.tsx` | Modal "Mi cuenta" custom (mover a admin) |
| `ui/paypal-dialog.tsx` / `ui/paypal-link-modal.tsx` | Dialogo accesible base y modal de link PayPal (monto, meses, preview de comision, idioma, copiar/enviar/regenerar) |
| `ui/generar-link-paypal-button.tsx` | Boton "Link PayPal" en hitos y soportes elegibles |
| `ui/registrar-pago-paypal-button.tsx` | Registro manual PayPal con evidencia textual/URL (solo admin) |
| `ui/ajuste-paypal-button.tsx` | Reembolso/contracargo y decision sobre hito/meses (solo admin) |
| `ui/revision-paypal-button.tsx` | Aceptar/rechazar diferencia de monto (solo admin) |
| `ui/recibo-pago.tsx` | Recibo imprimible generico (marca, cliente, tabla, estado, pie, boton `print`) |
| `ui/recibo-paypal.tsx` / `ui/recibo-mercadopago.tsx` | Adaptadores del recibo para PayPal (DOM historico) y Mercado Pago (ARS/USD, comision 0 o real) |
| `ui/pago-paypal-row.tsx` | Fila de historial PayPal/MP con desglose y "Ver recibo" |
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

### Pagos — PayPal (Oct 2026; validado en staging y desplegado a produccion con T-38)
- **Link estable de 30 dias** (`/pago/paypal/<token>`): al abrirlo se crea o reutiliza una **orden PayPal de 3 h**; la URL de checkout no se envia al cliente y se renueva sin cambiar el link. Regenerar invalida el anterior y conserva historial; el vencimiento a los 30 dias se resuelve de forma perezosa.
- **Gross-up entero**: `total = ceil((acordado + fijo) * 10000 / (10000 - bps))`, default **5,40% + US$0,30** (`PAYPAL_FEE_BPS`/`PAYPAL_FEE_FIXED_CENTS`), con snapshot por link y por pago. Solo USD y centavos: `monto = acordado + comision = esperado`. Formato es-AR en CRM/recibos (`US$100,50`); la plantilla EN puede usar `US$100.50`.
- **Confirmacion por dos caminos idempotentes**: retorno del comprador (captura) + webhook `/api/webhooks/paypal` (firma server-to-server con `PAYPAL_WEBHOOK_ID`, timeout 4 s). Eventos: `CHECKOUT.ORDER.APPROVED/COMPLETED`, `PAYMENT.CAPTURE.COMPLETED/DENIED/REFUNDED/REVERSED` y `CUSTOMER.DISPUTE.CREATED`. Dedupe por `EventoPasarela.eventoId` + `Pago.externalId`/`paypalOrderId`; repetidos/desconocidos responden 200, firma invalida 401 y error 500 para reintento.
- **Primer pago gana**: links MP y PayPal conviven por `grupoCobroId`; el pago ganador invalida los hermanos y deja trazado el intento descartado. Los links MP legacy se adoptan al generar PayPal; el flujo MP no cambia.
- **Estados**: `EnlacePago` CREANDO/ACTIVO/PAGADO/VENCIDO/INVALIDADO/FALLIDO; `Pago` SUCCEEDED/REVISION/FAILED/PENDING/REFUNDED/CONTRACARGO; `EventoPasarela` PROCESADO/IGNORADO/DUPLICADO/REQUIERE_ACCION/FIRMA_INVALIDA/ERROR; `AjustePago` REEMBOLSO/CONTRACARGO con decision NINGUNA/REVERTIR_HITO/DESCENTAR_MESES.
- **Modelos**: `EnlacePago` (link, envio, snapshot), `EventoPasarela` (dedupe/trazabilidad), `AjustePago` (reembolso/contracargo manual) y campos nuevos de `Pago` (pasarela, origen, desglose, meses, fee, recibo, revision). No se persisten email/nombre del pagador; el recibo usa los datos del cliente del CRM.
- **API/UI**: link y envio para staff; manual, ajustes y revision solo admin; recibo imprimible; modal accesible; filtros/desglose en `/admin/pagos`; cobros con link/recordar PayPal.
- **Roles**: `admin` y `asistente` (sin alias `assistant`); la asistente solo accede a clientes, cobros y pagos, y no puede registro manual, ajustes/reembolsos ni resolucion de diferencias.
- **Sin cambios de Dockerfile**: no hay `NEXT_PUBLIC_PAYPAL_*`; las envs PayPal son server-only y se inyectan en runtime. Si falta la config, `paypalConfig()` deshabilita PayPal (503 en las APIs) y Mercado Pago sigue operativo.
- **Produccion (T-38, 2026-11-03; PASS con observacion)**: deploy `f1185f76` en el commit `de64b50`, `/api/health` OK, `prisma db push` + backfill aplicados (`UPDATE 0`, sin filas a migrar), PayPal Live con 33 variables y webhook `https://pixelarch.dev/api/webhooks/paypal` (`401` sin firma); admin y Mercado Pago operativos. **No se ejecuto un pago real de smoke por decision del dueno**: la validacion live de firma, captura, hito y recibo queda para el primer cobro real (monitorear con prioridad). Rollback: quitar envs PayPal, deshabilitar el webhook Live y redeployar, sin borrar datos.

### Recibo interno de Mercado Pago (Oct 2026; desplegado a produccion con T-38)
- **Ruta unica** `/admin/pagos/[id]/recibo` para pagos PayPal y Mercado Pago; "Ver recibo" en `/admin/pagos` y en el detalle del cliente para pagos MP elegibles. `/admin/cobros` no muestra el link (D-10).
- **Elegibilidad:** pasarela efectiva (`pasarela` manda; respaldo `metodo` para historicos), estados `SUCCEEDED`, `REVISION`, `REFUNDED` o `CONTRACARGO`, `externalId` (payment id) obligatorio y montos que reconcilien. `FAILED`, `PENDING`, estados desconocidos y pagos manuales sin referencia no tienen recibo.
- **Identificador derivado** `MP-AAAAMMDD-<32 hex>`: SHA-256 de `externalId` recortado a 128 bits y fecha UTC (`reciboEmitidoEn ?? creadoEn`). No se persiste, no usa PII ni ids internos y no colisiona con `PAY-`.
- **Sin cambios de schema:** no hay columnas, migracion ni backfill. La feature viajo con el deploy de PayPal de T-38 (`f1185f76`) y quedo operativa en produccion; falta validarla con un cobro MP real.
- **Impresion A4** (`@page { size: A4; margin: 12mm }` en `admin.css`), estado como texto, tabla con `caption`/`scope` y boton/volver ocultos al imprimir. Aplica tambien al recibo PayPal solo en papel/margen.
- **Solo lectura:** una consulta Prisma con `select` minimo, sin llamadas a la API de MP, sin email (`sendPaymentReceipt` no cambia) y sin mutaciones. Solo datos del cliente del CRM; sin PII del pagador ni datos de tarjeta.

### Hardening PayPal/MP (Oct 2026; spec 003; PASS tester+reviewer)
- **H-5:** `/pago/paypal/estado` muestra "Pago en revision" cuando el link tiene un `Pago` en `REVISION`; `?estado=pagado` no asciende el estado y `?estado=error` conserva prioridad. Sin PII ni estados internos.
- **H-6:** expediente `specs/003-hardening-paypal/h6-mp-firmas.md` (URL/secreto de staging confirmados sin valor; warnings 08:35/08:51 = ruido sin pago; eventos A/B procesados). Webhook MP: 300 solicitudes/min por origen, 20 firmas invalidas/10 min, topics que no son `payment` o sin `data.id` se ignoran con `200` **antes** de la firma y el log de firma invalida es `debug` sin PII. No se rota el secreto ni se toca el panel.
- **H-7:** webhook PayPal con 300 solicitudes/min y 20 fallos de autenticidad/10 min por origen, cuerpo maximo 256 KiB (`413`), rechazos baratos antes de verificar y `429` reintentable; los eventos verificados conservan `200/500` e idempotencia.
- **H-8:** con `NEXT_PUBLIC_URL` invalida, las redirecciones usan `Location` relativo a `/pago/paypal/estado` (sin `0.0.0.0` ni host interno) y la creacion de ordenes falla cerrado (no llama a PayPal).
- **H-9:** `.railway/` en `.gitignore`; sin archivos versionados.
- **Operacion:** limitadores en memoria best-effort (no distribuidos, se reinician con el deploy); sin envs, esquema ni migracion nuevos. T-38 se ejecuto el 2026-11-03; T-09 (smoke manual de staging) sigue pendiente y no bloquea produccion.

### Cierre T-38 — PayPal + recibo MP en produccion (Nov 2026)
- **PASS con observacion:** deploy `f1185f76` en el commit `de64b50`, `/api/health` OK; `prisma db push` + backfill aplicados (`UPDATE 0`, sin filas a migrar); PayPal Live cargado (33 variables) y webhook `https://pixelarch.dev/api/webhooks/paypal` (`401` sin firma); admin y Mercado Pago operativos.
- **Sin pago real de smoke** por decision del dueno: no hubo cobro live de punta a punta. La validacion live de firma, captura, hito y recibo queda para el primer cobro real; monitorearlo con prioridad.
- **Rollback definido (no ejecutado):** quitar las envs PayPal, deshabilitar el webhook Live y redeployar; sin borrar datos ni revertir el esquema (aditivo).
- **Deuda documental:** T-09 (smoke manual de staging) sigue pendiente; `de64b50` difiere de `139b8cb` y no se reporta revalidacion de suite/typecheck/lint/build sobre ese SHA. Tests al cerrar T-38: **1644/1644 en 85 archivos** (ultima corrida reportada, 30 oct 2026), sin cambios de codigo en ese cierre.

### Portal de propuestas (spec 004; T-01..T-24, Nov 2026)
- **T-01..T-24 PASS tester+reviewer**, un commit `feat:` por tarea (T-24 `docs:`). Portal admin-only separado del CRM, con shell/sidebar propios.
- **Fundaciones:** middleware `/propuesta` (singular) sigue publico y `/propuestas` pasa a admin; APIs `401/403`; headers `noindex`/`no-store`; baja publica con `no-referrer`. Guard Clerk-only sin Prisma; esquema aditivo de 6 modelos/8 enums sin FKs al CRM; config server-only fail-closed.
- **Prospeccion:** Places (solo `place_id`), dedupe, fetch seguro + robots, extraccion de email publicado, auditoria interna y score determinista; alta manual/correccion con fuente y nota, sin importacion masiva ni scraping.
- **Borradores y envio:** plantillas versionadas, borrador determinista con grounding, aprobacion con snapshot (footer legal/token/hash), envio Resend con `Idempotency-Key` y `List-Unsubscribe` one-click; reintento manual; resultado/rebote/queja con supresion.
- **Cumplimiento:** baja publica `/propuestas/baja/[token]` + `POST /api/opt-out`, supresiones por hash/dominio con revocacion excepcional, retencion 12 meses con cron `Bearer` y ARCO exportar/rectificar/eliminar.
- **Cupos y privacidad:** `ConsumoProveedor` con locks transaccionales, alertas 80%/bloqueo 100%, redaccion de PII/tokens en logs/Sentry y guard de red que bloquea Places/Resend/LLM en tests.
- **Docs operativas (T-24, commit `2b8132c`):** `runbook.md` y `legal-checklist.md`; `AGENTS.md`/`MEMORY.md` actualizados; checklist legal pendiente de firma del dueno.
- **Verificacion T-25 (PASS tester, pendiente cierre reviewer):** suite **3031/3031 en 114 archivos**, `tsc --noEmit` 0 errores, lint 18/18 preexistente y build PASS.
- **Estado:** T-24 cerrada; **T-25 en verificacion** (PASS tester, pendiente cierre reviewer); codigo desplegado; **esquema pendiente de `db push`** y `PROPUESTAS_ENVIO_HABILITADO=false`. T-26/T-27 gates pendientes.

### Monitoreo propio (`/estado`)
- Tabla `UptimeCheck` + **Railway Function `uptime-cron`** cada 10 min (dispara `/api/cron/uptime` con el secret; unica fuente, sin GitHub Actions)
- 4 servicios: Sitio web, Blog, API, Base de datos (uptime, latencia, historial 90 dias, incidentes)
- **Alertas por email** (por transicion, anti-spam): caida tras 2 fallos seguidos + aviso de recuperacion; si el sitio entero no responde, la funcion escribe el fallo directo en la BD y avisa por Resend
- **Digest diario de cobros** (9:00 ARG via Railway Function `digest-cobros`): hitos vencidos/por vencer/sin fecha + soportes + cobrado ultimas 24h

### Blog
- 15 articulos (contenido completo + portadas reales: Unsplash/Wikimedia)
- Reading time, relacionados, filtros por tags, RSS con XSLT

### Auditoria web gratis (`/auditoria`)
- Chequeos reales: velocidad, SSL (certificado via TLS), SEO, headers de seguridad
- Proteccion SSRF + rate limit 8/hora + scoring y hallazgos

### Auth (Clerk) — admin/asistente
- Login solo para admin/asistente (modal sobre el sitio via `/gate/admin`)
- Sin registro publico, sin webhook de sync, sin portal de clientes
- Roles via `publicMetadata.role`: `admin` (todo) y `asistente` (solo clientes/cobros/pagos; sin alias `assistant`)

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

- [x] **T-24 (spec 004, cerrada):** runbook y checklist legal redactados; `AGENTS.md`/`MEMORY.md` actualizados; commit `2b8132c`; PASS tester+reviewer.
- [ ] **T-25 (spec 004, PASS tester, pendiente cierre reviewer):** verificacion final local con evidencia: suite **3031/3031 en 114 archivos**, `tsc --noEmit` 0 errores, lint 18/18 preexistente y `next build` PASS; corregir solo lo introducido por la feature.
- [ ] **T-26 [GATE] (spec 004):** staging con Postgres separado; smoke de Places/fetch/auditoria/score/borrador/aprobacion, envio a direccion propia, baja one-click, cupo 21 y retencion.
- [ ] **T-27 [GATE] (spec 004):** produccion con autorizacion del dueno, checklist legal firmado, SPF/DKIM/DMARC, `pg_dump` + `db push`, smoke en seco y primer envio controlado; recien entonces habilitar `PROPUESTAS_ENVIO_HABILITADO=true`.
- [ ] Deuda portal v1: LLM no implementado (`modo="LLM"` falla cerrado), sin webhooks de Resend (resultados manuales), cupo `REDACTOR` no reservado, listas sin paginacion completa y reconciliacion de `ENVIANDO` sin boton en UI.
- [ ] Pasos manuales: desactivar registro publico en Clerk + invitar a la asistente · borrar el webhook de Polar en su panel
- [ ] **Primer cobro real PayPal (post-T-38):** T-38 no ejecuto pago real de smoke por decision del dueno; monitorear con prioridad el primer pago Live (firma del webhook `200`, un solo `Pago`, hito `PAGADO`, recibo, sin duplicado). Rollback definido: quitar envs PayPal + deshabilitar webhook Live + redeploy, sin borrar datos.
- [ ] **T-09 (spec 003, deuda documental):** smoke manual en staging — link con pago en `REVISION`, webhook PayPal con firma invalida (`401`/`429`), topic ajeno a MP (`200` ignorado) y `git check-ignore` de `.railway/`. H-8 se valida con la suite. No bloquea produccion.
- [ ] Backlog PayPal/MP (no bloqueante): completar el identificador de cuenta/aplicacion MP de staging en el expediente H-6 · unificar el helper de IP y evaluar `debug` para el `429` de PayPal · R-9: otros consumidores de `NEXT_PUBLIC_URL` (`sitemap`, `robots`, RSS, cron, `mercadopago.ts`, `entregar`) siguen con `env || default`.

## Descartado / no planificado (por decision, Sept 2026)

- Prueba E2E del cobro por hito: **integracion de Mercado Pago verificada y funcionando** (link → pago → hito Pagado)
- Newsletter (Resend Audiences) · Analytics (Umami Cloud) · unificar "Nosotros" · Mercado Pago fase 2 (preapproval): no se haran por ahora

---

## Tests

```
114 test files | 3031 tests (3031 verdes en la ultima corrida de T-25, 13 nov 2026)
```

`npm test` — correr tests
`node node_modules\vitest\vitest.mjs run` — suite unica, sin watch
`npm run lint` — ESLint (deuda preexistente; no introducir errores nuevos)

## Build

```
TypeScript — 0 errores (verificado en T-25)
Lint — 18 errores/18 warnings preexistentes (sin errores nuevos)
Build — PASS (next build local, T-25; 13 nov 2026)
Tests — 3031/3031 en 114 archivos (T-25; 13 nov 2026)
Portal de propuestas — T-01..T-24 PASS tester+reviewer; T-25 PASS tester (pendiente cierre reviewer); codigo desplegado; esquema pendiente de `db push`; `PROPUESTAS_ENVIO_HABILITADO=false`; T-26/T-27 gates pendientes
PayPal — produccion Live desde T-38 (deploy `f1185f76` en `de64b50`, health OK); staging validado en T-37 (`139b8cb` / deploy `4c765526`)
Hardening PayPal/MP — H-5..H-9 PASS tester+reviewer; T-09 (smoke de staging) pendiente como deuda documental
Recibo MP — desplegado a produccion con T-38; pendiente de validacion con un cobro real
```

> T-38 cerro el rollout como PASS con observacion: no hubo pago real de smoke, por lo que la primera validacion end-to-end live sera el primer cobro real. Rollback: quitar envs PayPal + deshabilitar webhook + redeploy, sin borrar datos. `de64b50` difiere de `139b8cb` y no se reporta revalidacion sobre ese SHA; T-09 (smoke manual de staging) sigue pendiente. El portal de propuestas no cambia ese estado: su codigo esta desplegado pero el esquema sigue pendiente y el envio deshabilitado hasta T-26/T-27 y el checklist legal.

---

### Comandos utiles

```bash
npm run dev        # Desarrollo local
npm run build      # Build de produccion
npm test           # Tests unitarios + libs
node node_modules\vitest\vitest.mjs run          # Suite sin watch
npm run lint                                     # ESLint
node node_modules\typescript\bin\tsc --noEmit    # Type check
npx prisma studio  # Explorar BD
npx prisma db push # Sincronizar schema → BD
npx prisma generate # Regenerar cliente
```

> En esta maquina `npx` puede fallar: usar `node node_modules\prisma\build\index.js db push` y `node node_modules\prisma\build\index.js generate`.

### Scripts propios (`src/scripts/`)

```bash
node node_modules/tsx/dist/cli.mjs src/scripts/seed-sanity.ts         # Seed Sanity (servicios/landing/seo)
node node_modules/tsx/dist/cli.mjs src/scripts/seed-articulos.ts      # Crear articulos del blog (idempotente)
node node_modules/tsx/dist/cli.mjs src/scripts/regenerate-covers-real.ts  # Portadas reales del blog
node node_modules/tsx/dist/cli.mjs src/scripts/generate-brand-assets.ts   # favicon-32 + og-image 1200x630
node node_modules/tsx/dist/cli.mjs src/scripts/covers.ts             # Generador de portadas SVG (fallback)
node node_modules/tsx/dist/cli.mjs src/scripts/test-mp.ts 100 <suscripcionId> 1  # Probar link de pago MP
```
