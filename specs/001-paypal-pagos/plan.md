# Plan 001: Cobros con PayPal

**Spec:** ./spec.md (aprobada 2026-10-19)
**Alcance:** agregar PayPal como segunda pasarela para cobros en USD, sin reemplazar ni alterar el flujo de Mercado Pago en ARS.
**Estado:** aprobado (implementacion en curso; T-01).

---

## 1. Resumen tecnico

PayPal se integra con **Orders API v2** (`intent=CAPTURE`) y checkout alojado por PayPal. El CRM genera un **link estable de 30 dias** alojado en PixelArch; al abrirlo, el servidor crea (o reutiliza) una orden PayPal y redirige al checkout. Esto es necesario porque una orden de PayPal vive **3 horas** por defecto (extendible a 72 h), no 30 dias; el link de 30 dias es el punto de entrada, y la orden PayPal se renueva cuando hace falta.

La confirmacion se registra por dos caminos idempotentes:

1. **Retorno del comprador** (`return_url`): se captura la orden y se procesa el pago.
2. **Webhook** (`/api/webhooks/paypal`): se verifica la firma con PayPal y se procesa el mismo pago; si el retorno ya lo registro, el webhook no duplica.

No se agrega ninguna dependencia npm. Se usa `fetch` nativo de Node 22 contra la API REST de PayPal. El SDK oficial se evaluo y se descarto por tamano y superficie innecesaria (ver §3).

Cambios principales:

- **Prisma:** `EnlacePago` (historial de links y envios), `EventoPasarela` (trazabilidad tecnica e idempotencia de webhooks), `AjustePago` (reembolsos/contracargos manuales) y campos nuevos en `Pago`.
- **Libs nuevas:** `src/lib/paypal/{config,client,fees,links,process,webhook,receipts,messages,redact,validation}.ts`.
- **APIs admin:** generar link, enviar/recordar, registrar pago manual (solo admin), resolver diferencias (solo admin), registrar ajustes (solo admin).
- **Rutas publicas:** `/pago/paypal/[token]`, `/pago/paypal/retorno`, `/pago/paypal/cancelado`, `/pago/paypal/estado`.
- **Webhook:** `/api/webhooks/paypal`.
- **UI admin:** boton PayPal en hitos y soporte, modal accesible, historial con desglose, recibo imprimible, estados de revision y ajustes. La asistente solo accede a clientes, cobros y pagos; el resto del admin queda para el admin.
- **Formato USD:** `formatearMonto` pasa a formato argentino en UI/CRM/recibos (`US$100,50`, `US$1.000,50`); las plantillas en ingles pueden usar en-US (`US$100.50`) como excepcion documentada.
- **Sandbox:** la validacion final se hace en un entorno Railway staging con base de datos separada; local/ngrok queda solo para desarrollo.

Reglas de dinero: todo en **centavos enteros**, moneda explicita, sin floats. Para PayPal solo USD. `montoAcordado + comision = total` en pagos normales; si el cobro real difiere, el pago queda en `REVISION`.

---

## 2. Arquitectura (componentes y flujo de datos)

### 2.1 Flujo de generacion (admin/asistente)

```
Admin UI (Clerk: admin | asistente; asistente solo en clientes/cobros/pagos)
  -> POST /api/admin/paypal/link
      1. requireStaff() + rate limit
      2. paypalConfig(): si falta config -> 503, no crea nada
      3. valida concepto (hito PENDIENTE o soporte ACTIVE/PAST_DUE)
      4. si hay EnlacePago ACTIVO de PayPal para el concepto -> lo devuelve (reutilizado)
      5. calcula gross-up (monto acordado + comision) y snapshottea la tarifa
      6. crea EnlacePago (CREANDO, token opaco, grupoCobroId, expiraEn=+30d)
      7. OAuth PayPal + POST /v2/checkout/orders (primer checkout)
      8. guarda orderId, checkoutUrl, orderExpiraEn=+3h -> ACTIVO
  <- { url: /pago/paypal/<token>, total, comision, expiraEn, reutilizado }
```

El link que se copia o envia es siempre el **link estable de PixelArch**. La URL de PayPal (`checkoutUrl`) es interna y se renueva; no se envia al cliente. El estado del hito/soporte no cambia al generar.

### 2.2 Flujo de pago (cliente)

```
Cliente abre /pago/paypal/<token> (publico, sin login)
  -> valida token, expiraEn, estado y que el concepto siga pendiente
  -> si la orden actual sigue vigente (<3h) y no fue pagada: reutiliza checkoutUrl
  -> si no: crea nueva orden PayPal y actualiza EnlacePago
  -> 302 al checkout alojado por PayPal (guest checkout si PayPal lo permite)
  -> comprador aprueba
  -> PayPal redirige a /pago/paypal/retorno?token=<order>&enlace=<token>
       -> valida orden, captura (PayPal-Request-Id idempotente)
       -> procesarCapturaPaypal()
       -> muestra agradecimiento / estado
  -> PayPal envia webhook PAYMENT.CAPTURE.COMPLETED (respaldo)
       -> verifica firma, deduplica evento, procesarCapturaPaypal()
```

Si el comprador cancela, `/pago/paypal/cancelado` registra el intento sin tocar el cobro y fuerza una orden nueva en el proximo intento. Si el link vencio o fue invalidado, `/pago/paypal/estado` muestra el motivo y no se crea una orden.

### 2.3 Flujo de conciliacion

```
Pago confirmado (retorno o webhook)
  -> transaccion Prisma:
       - valida y actualiza EnlacePago de forma condicional
       - busca Pago por externalId (capture id) o paypalOrderId
       - si ya existe: evento DUPLICADO, no crea ni acredita
       - si el link fue invalidado por el otro gateway: evento REQUIERE_ACCION, no crea Pago
       - si monto/moneda != esperado: Pago REVISION, no marca hito ni acredita meses
       - si coincide: Pago SUCCEEDED + reciboId + hito PAGADO o soporte +meses
       - invalida los demas EnlacePago ACTIVOS del grupoCobroId
  -> email de recibo (post-transaccion, best effort)
```

### 2.4 Componentes

| Componente | Responsabilidad |
|---|---|
| `src/lib/paypal/config.ts` | Lee envs, valida `PAYPAL_ENV`, devuelve `{ disponible, motivo, baseUrl, webhookId, fee }`. Nunca lanza por PayPal faltante. |
| `src/lib/paypal/client.ts` | OAuth client_credentials con cache, create/get/capture order, verify webhook, timeouts y errores sanitizados. |
| `src/lib/paypal/fees.ts` | Gross-up entero, snapshot de tarifa, validacion de montos USD. |
| `src/lib/paypal/links.ts` | Crear/reutilizar/regenerar/vencer links, token opaco, grupo de cobro, adopcion de links MP legacy. |
| `src/lib/paypal/process.ts` | Maquina de estados de pago: idempotencia, hito, soporte, diferencias, primer pago gana. |
| `src/lib/paypal/webhook.ts` | Parseo y dispatch de eventos PayPal sin payload crudo ni PII. |
| `src/lib/paypal/receipts.ts` | `reciboId`, snapshot y datos del recibo interno tomados del cliente del CRM; sin PII del pagador. |
| `src/lib/paypal/messages.ts` | Plantillas ES/EN de email y WhatsApp; formateo localizado. |
| `src/lib/paypal/redact.ts` | Redaccion de PII/secretos para logs y Sentry. |
| `src/lib/paypal/validation.ts` | Esquemas Zod de bodies y webhooks. |
| `src/app/(admin)/admin/pagos/[id]/recibo/page.tsx` | Recibo imprimible, solo staff. |
| `src/components/ui/paypal-link-modal.tsx` | Modal accesible de generacion/envio. |
| `src/components/ui/registrar-pago-paypal-button.tsx` | Registro manual, solo admin. |
| `src/components/ui/ajuste-paypal-button.tsx` | Reembolso/contracargo, solo admin. |
| `src/components/ui/revision-paypal-button.tsx` | Resolver diferencia de monto, solo admin. |

### 2.5 Maquinas de estado

**EnlacePago**

```
CREANDO -> ACTIVO -> PAGADO
              |  \-> VENCIDO (expiraEn < ahora)
              |  \-> INVALIDADO (otro pago gano, regeneracion o baja)
              \-> FALLIDO (PayPal rechazo la creacion)
```

`VENCIDO` se persiste de forma perezosa al leer el link; no hay cron obligatorio.

**Pago**

```
SUCCEEDED   pago aplicado (hito PAGADO / soporte +meses)
REVISION    capturado pero monto/moneda no coincide; no aplica automaticamente
FAILED      intento fallido (solo MP conserva este uso historico)
REFUNDED    reembolso manual registrado
CONTRACARGO contracargo manual registrado
PENDING     reservado para estados intermedios
```

**EventoPasarela**

```
RECIBIDO -> PROCESADO | IGNORADO | DUPLICADO | REQUIERE_ACCION | FIRMA_INVALIDA | ERROR
```

---

## 3. Decisiones y alternativas

| Decision | Alternativas | Motivo | Licencia/Coste |
|---|---|---|---|
| **Orders API v2** con `intent=CAPTURE` y checkout alojado. | Subscriptions; Payments v1; checkout embebido. | La spec exige link unico y prohibe cobros recurrentes. Orders v2 es la API vigente y permite guest checkout. | API sin costo; solo comision de PayPal. |
| **REST directo con `fetch`**, sin SDK. | `@paypal/paypal-server-sdk` 2.5.0 (oficial, MIT, mantenido por PayPal; ~4.3 MB y ~3.5k archivos, dependencias APIMatic); SDK comunitario. | Solo se usan 5 endpoints (token, create, get, capture, verify). `fetch` nativo reduce dependencias, tamano y facilita mocks en tests. Node 22 ya tiene `fetch`. | Sin licencia nueva; cero dependencias. SDK: MIT, sin costo, pero innecesario. |
| **Link de 30 dias = link estable de PixelArch** que crea una orden PayPal al abrirse. | Guardar el `payer-action` de PayPal (3 h); crear una orden de 30 dias (PayPal no lo soporta). | PayPal Orders vive 3 h por defecto (72 h maximo). El link local permite cumplir RF-5/AC-26 y renovar la orden sin cambiar el link enviado. El checkout final sigue siendo alojado por PayPal. | Sin costo extra. |
| **Tabla `EnlacePago`** para links, historial, envios y coexistencia. | Agregar `paypalLink`, `paypalOrderId`, `paypalLinkExpira` a Hito/Suscripcion; una tabla por gateway. | La spec exige historial de links vencidos, regeneracion, canal/fecha de envio y coexistencia MP/PayPal. Las columnas no alcanzan y duplican logica. | Sin costo. |
| **Gross-up entero** con `total = ceil((acordado + fijo) * 10000 / (10000 - bps))`; `comision = total - acordado`. | Absorber la comision; sumar un porcentaje simple; comision fija. | Garantiza que el neto sea el monto acordado y evita floats. La tarifa se snapshottea en el link y en el pago para auditar cambios. | Default **5,40% + US$0,30** (tramo AR 0,01–3.000 USD/mes), configurable por env y validado contra la cuenta real en sandbox antes de produccion. |
| **Verificacion de webhook contra PayPal** (`/v1/notifications/verify-webhook-signature`). | Validar el certificado X.509 localmente; confiar en headers. | Es el mecanismo oficial, tolera rotacion de certificados y evita implementar criptografia propia. Se usan timeouts y se rechaza si no hay `PAYPAL_WEBHOOK_ID`. | Sin costo. |
| **Idempotencia multiple:** `EventoPasarela.eventoId` unico + `Pago.externalId` (capture id) unico + `Pago.paypalOrderId` unico. | Solo `externalId`; solo event id. | Cubre reintentos, eventos simultaneos, desorden y registro manual con order id. Las constraints de Postgres son la ultima barrera. | Sin costo. |
| **Coexistencia por `grupoCobroId`**; el primer pago confirmado invalida los links hermanos. Se adopta el link MP legacy al generar PayPal. | Links independientes por gateway; bloquear PayPal si hay MP. | RF-9/RF-22/PA-8 exigen coexistencia y trazabilidad. La adopcion permite invalidar el MP legacy sin migracion masiva. | Sin costo. |
| **Registro manual solo admin**, con capture id o lookup de order id y **evidencia textual/URL** (capture id, order id, comprobante o nota). No se adjuntan archivos ni se agrega storage. | Permitir a la asistente; pedir solo una nota; adjuntar archivos. | RF-16/AC-25/PA-6. El lookup con order id reduce el riesgo de duplicado cuando llegue el webhook. La evidencia textual alcanza para auditar sin sumar un storage nuevo. | Sin costo. |
| **Reembolsos/contracargos manuales** con `AjustePago`; el webhook solo marca `requiereAccion`. | Automaticos desde webhooks. | RF-20/PA-7: el admin decide si revierte el hito o descuenta meses. Nunca se modifica solo. | Sin costo. |
| **Roles:** `requireStaff` acepta solo `admin` y `asistente` (`publicMetadata.role = "asistente"`, sin alias `assistant`). La asistente accede solo a clientes/cobros/pagos; `requireAdmin` queda estricto para registro manual, ajustes/reembolsos/contracargos y resolucion de diferencias. | Reutilizar `requireAdmin` (hoy solo admin), un rol unico o aceptar `assistant` como alias. | RF-24/AC-17. El codigo actual solo conoce `role === "admin"`; se agrega el slug exacto `asistente` y se mantiene el gate estricto en acciones sensibles. | Sin costo. |
| **Guest checkout:** `payment_source.paypal.experience_context` con `landing_page=NO_PREFERENCE`, `user_action=PAY_NOW`, `shipping_preference=NO_SHIPPING`. | `landing_page=LOGIN` o `GUEST_CHECKOUT`. | Permite que PayPal ofrezca guest checkout cuando este disponible, sin obligar a crear cuenta en PixelArch. | Sin costo. |
| **Formato USD en UI/CRM/recibos:** `formatearMonto` usa formato argentino (`US$100,50`, `US$1.000,50`) en todo el CRM y los recibos. | Mantener `US$100.50` global; formateador PayPal-only. | Decision operativa: unificar en es-AR y actualizar tests/expectativas existentes (`US$25.00`, `US$100.00`). Se evita un formateador paralelo. | Sin costo. |
| **Plantillas ES/EN** con montos localizados. | Solo espanol; un unico formato. | RF-6/RNF-14. La plantilla ES usa es-AR. La plantilla EN puede usar en-US (`US$100.50`) para el destinatario internacional; es la unica excepcion documentada. | Sin costo. |
| **Recibo interno con `reciboId` + pagina imprimible**, sin modelo separado. | Modelo `Recibo`; PDF; factura fiscal. | AC-10 pide identificador y disponibilidad para el admin; la factura fiscal esta fuera de alcance. Los datos se leen del pago, su snapshot y el cliente del CRM; no se persisten datos del pagador. | Sin costo. |
| **Solo USD para PayPal**; se rechaza ARS. | Convertir ARS a USD. | RF-2/PA-3. La conversion la hace PayPal si el pagador usa otra moneda; el CRM registra USD. | Sin costo. |
| **Datos del pagador:** no se persisten email/nombre por defecto. El recibo se emite con los datos del cliente del CRM y solo se guardan referencias PayPal (`paypalOrderId`, capture id). | Guardar email/nombre siempre; columnas opcionales. | RNF-3/AC-19/AC-28. El webhook no necesita PII y el recibo interno no requiere los datos del pagador. Se mantiene la redaccion de PII en logs/Sentry. | Sin costo. |
| **Rate limit y timeouts:** 20/min por IP en admin; 30/min por IP y 5/min por token en link publico; timeout PayPal 8 s. | Sin limites; procesos asincronicos. | RNF-10 y proteccion contra abuso de creacion de ordenes. El rate limit en memoria es best-effort (ya existe en el proyecto). | Sin costo. |
| **Migracion aditiva** con `prisma db push` + backfill SQL. | Migraciones destructivas o renombrar columnas. | No se tocan `mpLink`, `mpPreferenceId` ni pagos historicos. El rollback es desactivar envs PayPal. | Sin costo. |
| **Sandbox final en Railway staging** con base de datos separada. | Solo local/ngrok; mezclar con produccion. | RNF-11/AC-29: la validacion de punta a punta debe ser reproducible y no tocar produccion. Local/ngrok queda solo para desarrollo. | Costo del entorno staging (dentro de Railway). |

### 3.1 SDK vs REST: detalle

- `@paypal/paypal-server-sdk` 2.5.0 (verificado 2026-10-19): licencia **MIT**, publicado por PayPal, con mantenimiento activo (ultimo release: agosto 2026). Incluye `OrdersController`, `PaymentsController` y `WebhooksController`; sus dependencias principales son APIMatic, `axios` y `tslib` (MIT/0BSD).
- Se descarta porque:
  - agrega ~4.3 MB y ~3.500 archivos al `node_modules` server-side;
  - arrastra `@apimatic/*` y `axios`;
  - solo se necesitan 5 llamadas, y el mocking de `fetch` es mas simple para la suite;
  - el SDK no aporta valor en un unico runtime Node y no hay requisito de tipos generados.
- Si en el futuro se agregan disputes/refunds automaticos o multiparty, se puede reevaluar.

### 3.2 Formula de gross-up

```
totalCents = ceil( (montoAcordadoCents + feeFixedCents) * 10000 / (10000 - feeBps) )
comisionCents = totalCents - montoAcordadoCents
```

- `feeBps` en puntos basicos (540 = 5,40%).
- `feeFixedCents` en centavos USD (30 = US$0,30).
- Se redondea hacia arriba para que el neto no quede por debajo del acordado.
- Ejemplo: US$100,50 + tarifa 5,40% + US$0,30 -> total **US$106,56**, comision **US$6,06**.
- La tarifa aplicada (`feeBps`, `feeFixedCents`) se guarda en `EnlacePago` y en `Pago`.
- Si la tarifa real difiere, PixelArch absorbe o gana la diferencia; el admin puede corregir la configuracion sin tocar codigo. No se recalcula un pago ya confirmado.

---

## 4. Modelo de datos y contratos de API

### 4.1 Cambios Prisma (aditivos)

```prisma
enum Pasarela {
  MANUAL
  MERCADOPAGO
  PAYPAL
}

enum OrigenPago {
  AUTOMATICO
  MANUAL
}

enum EstadoEnlace {
  CREANDO
  ACTIVO
  PAGADO
  VENCIDO
  INVALIDADO
  FALLIDO
}

enum EstadoRevision {
  PENDIENTE
  ACEPTADO
  RECHAZADO
}

enum TipoAjuste {
  REEMBOLSO
  CONTRACARGO
}

enum DecisionAjuste {
  NINGUNA
  REVERTIR_HITO
  DESCONTAR_MESES
}

// MetodoPago agrega PAYPAL
// EstadoPago agrega REVISION y CONTRACARGO
```

**Pago (campos nuevos)**

```prisma
pasarela          Pasarela      @default(MANUAL)
origen            OrigenPago    @default(MANUAL)
enlacePagoId      String?
montoAcordado     Int?
comision          Int           @default(0)
montoEsperado     Int?
meses             Int?
feeBps            Int?
feeFixedCents     Int?
paypalOrderId     String?       @unique
evidencia         String?
reciboId          String?       @unique
reciboEmitidoEn   DateTime?
revisionEstado    EstadoRevision?
revisionNota      String?
revisionResueltaPor String?
revisionResueltaEn  DateTime?

enlacePago EnlacePago? @relation(fields: [enlacePagoId], references: [id])
ajustes    AjustePago[]
```

`monto` sigue siendo el **total cobrado** (compatibilidad con el resto del CRM). En un pago normal `monto = montoAcordado + comision = montoEsperado`. En `REVISION`, `monto` es lo capturado y `montoEsperado` el total del link; la UI muestra la diferencia.

No se agregan columnas de email/nombre del pagador. El recibo toma `Cliente.nombre`/`Cliente.email` del CRM y solo se persisten referencias PayPal (`externalId` = capture id, `paypalOrderId`) y la evidencia textual/URL del registro manual.

**EnlacePago**

```prisma
model EnlacePago {
  id                String        @id @default(cuid())
  token             String        @unique
  clienteId         String
  hitoId            String?
  suscripcionId     String?
  pasarela          Pasarela
  concepto          String
  descripcion       String?
  notaInterna       String?
  montoAcordado     Int
  comision          Int           @default(0)
  total             Int
  moneda            String        @default("usd")
  meses             Int?
  feeBps            Int           @default(0)
  feeFixedCents     Int           @default(0)
  url               String?
  checkoutUrl       String?
  externalId        String?       @unique // preferenceId MP u orderId PayPal
  estado            EstadoEnlace  @default(CREANDO)
  grupoCobroId      String
  expiraEn          DateTime
  orderExpiraEn     DateTime?
  generadoPor       String?
  generadoPorNombre String?
  enviadoPor        String?
  enviadoEn         DateTime?
  canalEnvio        String?       // EMAIL | WHATSAPP | COPIA
  idioma            String?       // es | en
  invalidadoEn      DateTime?
  motivoInvalido    String?
  ultimoError       String?
  creadoEn          DateTime      @default(now())
  actualizadoEn     DateTime      @updatedAt

  cliente     Cliente        @relation(fields: [clienteId], references: [id])
  hito        Hito?          @relation(fields: [hitoId], references: [id])
  suscripcion Suscripcion?   @relation(fields: [suscripcionId], references: [id])
  pagos       Pago[]
  eventos     EventoPasarela[]

  @@index([clienteId])
  @@index([hitoId])
  @@index([suscripcionId])
  @@index([estado])
  @@index([grupoCobroId])
  @@index([expiraEn])
}
```

**EventoPasarela** (sin payload crudo ni PII)

```prisma
model EventoPasarela {
  id             String    @id @default(cuid())
  pasarela       Pasarela
  eventoId       String    @unique
  tipo           String
  externalId     String?
  enlacePagoId   String?
  pagoId         String?
  resultado      String    // PROCESADO | IGNORADO | DUPLICADO | REQUIERE_ACCION | FIRMA_INVALIDA | ERROR
  motivo         String?
  monto          Int?
  moneda         String?
  requiereAccion Boolean   @default(false)
  creadoEn       DateTime  @default(now())
  procesadoEn    DateTime?

  enlacePago EnlacePago? @relation(fields: [enlacePagoId], references: [id])
  pago       Pago?       @relation(fields: [pagoId], references: [id])

  @@index([pasarela, creadoEn])
  @@index([enlacePagoId])
  @@index([pagoId])
  @@index([requiereAccion])
}
```

**AjustePago**

```prisma
model AjustePago {
  id               String         @id @default(cuid())
  pagoId           String
  tipo             TipoAjuste
  monto            Int
  motivo           String?
  evidencia        String?
  decision         DecisionAjuste @default(NINGUNA)
  mesesDescontados Int?
  registradoPor    String?
  creadoEn         DateTime       @default(now())

  pago Pago @relation(fields: [pagoId], references: [id])

  @@index([pagoId])
}
```

Relaciones inversas a agregar: `Cliente.enlacesPago`, `Hito.enlacesPago`, `Suscripcion.enlacesPago`, `Pago.enlacePago`, `Pago.ajustes`, `Pago.eventos`, `EnlacePago.pagos`, `EnlacePago.eventos`.

### 4.2 Migracion

Comandos para el implementer (no los ejecuta el planner):

```bash
npx prisma db push
npx prisma generate
```

Fallback local si `npx` falla:

```bash
node node_modules/prisma/build/index.js db push
node node_modules/prisma/build/index.js generate
```

Backfill recomendado, una sola vez y en transaccion:

```sql
UPDATE "Pago"
SET "pasarela" = 'MERCADOPAGO'
WHERE "metodo" = 'MERCADOPAGO' AND "pasarela" = 'MANUAL';

UPDATE "Pago"
SET "origen" = 'AUTOMATICO'
WHERE "metodo" = 'MERCADOPAGO' AND "registradoPor" = 'Mercado Pago';

UPDATE "Pago"
SET "montoAcordado" = "monto", "montoEsperado" = "monto"
WHERE "montoAcordado" IS NULL;
```

No se migran ni se borran los links MP existentes. Se “adoptan” de forma perezosa cuando se genera un link PayPal para el mismo concepto o cuando el webhook MP los encuentra.

### 4.3 Contratos de API

| Metodo | Ruta | Auth | Proposito |
|---|---|---|---|
| POST | `/api/admin/paypal/link` | staff | Crear o reutilizar link PayPal para hito/soporte. |
| POST | `/api/admin/paypal/enviar` | staff | Enviar por email o registrar envio por WhatsApp/copia; idioma ES/EN. |
| POST | `/api/admin/paypal/manual` | **admin** | Registrar pago PayPal manual con evidencia. |
| POST | `/api/admin/paypal/ajustes` | **admin** | Registrar reembolso/contracargo y decision. |
| POST | `/api/admin/paypal/revision` | **admin** | Aceptar/rechazar un pago en revision por diferencia. |
| GET | `/pago/paypal/[token]` | publico | Validar link y redirigir al checkout PayPal. |
| GET | `/pago/paypal/retorno` | publico | Capturar orden y procesar pago. |
| GET | `/pago/paypal/cancelado` | publico | Registrar cancelacion y mostrar estado. |
| GET | `/pago/paypal/estado` | publico | Pagina informativa (vencido/invalidado/pagado). |
| GET | `/admin/pagos/[id]/recibo` | staff | Recibo interno imprimible. |
| POST | `/api/webhooks/paypal` | publico + firma | Verificar y procesar eventos PayPal. |

**POST `/api/admin/paypal/link`**

```json
{
  "hitoId": "cuid",
  "montoAcordadoCents": 10050,
  "descripcion": "Anticipo",
  "notaInterna": "Acordado por email",
  "idioma": "es",
  "regenerar": false
}
```

Respuesta `200`:

```json
{
  "ok": true,
  "enlaceId": "cuid",
  "url": "https://pixelarch.dev/pago/paypal/<token>",
  "montoAcordado": 10050,
  "comision": 606,
  "total": 10656,
  "moneda": "usd",
  "expiraEn": "2026-11-18T12:00:00.000Z",
  "reutilizado": false
}
```

Para soporte, `montoAcordado` es el **total del cobro por los N meses** (por defecto `precioDePlan * meses`), no el precio mensual; `meses` debe estar entre 1 y 12. Para hitos, el default es `hito.monto`, editable con confirmacion explicita si cambia.

Errores: `400` body invalido, `403` sin rol, `404` concepto inexistente, `409` concepto ya pagado o con un pago en `REVISION` pendiente de resolver, `429` rate limit, `503` PayPal no configurado/disponible.

**POST `/api/admin/paypal/enviar`**

```json
{ "enlaceId": "cuid", "canal": "EMAIL", "idioma": "en" }
```

`canal`: `EMAIL` | `WHATSAPP` | `COPIA`. Para `EMAIL` envia con Resend; para los otros solo registra. Actualiza `enviadoPor`, `enviadoEn`, `canalEnvio`, `idioma`. Respuesta incluye `mensaje` renderizado para que WhatsApp use la plantilla canonica.

**POST `/api/admin/paypal/manual`**

```json
{
  "hitoId": "cuid",
  "montoAcordadoCents": 10050,
  "comisionCents": 606,
  "totalCents": 10656,
  "externalId": "3C679366HH908993F",
  "paypalOrderId": "5O190127TN364715T",
  "evidencia": "Capture 3C679366HH908993F / order 5O190127TN364715T / comprobante recibido por email",
  "meses": null,
  "marcarHitoPagado": true,
  "acreditarMeses": false,
  "enviarRecibo": true
}
```

Valida `montoAcordado + comision = total`, que el concepto este pendiente y que no exista `Pago` con el mismo `externalId` ni `paypalOrderId`. Si se envia `paypalOrderId` y PayPal esta configurado, consulta la orden para resolver el capture id. La evidencia es **texto/URL** (capture id, order id, comprobante o nota); no se aceptan archivos ni se agrega storage. No se persiste email/nombre del pagador: el recibo usa los datos del cliente del CRM. El admin decide si aplica el pago al concepto (`marcarHitoPagado`/`acreditarMeses`); por defecto se aplica, con la misma trazabilidad que un pago automatico. Solo admin. El endpoint generico `POST /api/admin/pagos` rechaza `metodo=PAYPAL`: el unico camino de registro manual PayPal es este endpoint dedicado, para no perder evidencia ni idempotencia.

**POST `/api/admin/paypal/ajustes`**

```json
{
  "pagoId": "cuid",
  "tipo": "REEMBOLSO",
  "montoCents": 10656,
  "motivo": "Cliente solicito reembolso",
  "evidencia": "ID de reembolso PayPal",
  "decision": "REVERTIR_HITO",
  "mesesDescontados": null
}
```

Crea `AjustePago`, conserva el pago original, cambia `Pago.estadoPago` a `REFUNDED`/`CONTRACARGO` y aplica la decision solo si el admin la elige. No hay reversion automatica.

**POST `/api/admin/paypal/revision`**

```json
{ "pagoId": "cuid", "accion": "ACEPTAR", "nota": "Diferencia acordada por descuento" }
```

`ACEPTAR` aplica el pago (hito PAGADO o meses), pasa `estadoPago` a `SUCCEEDED`, `revisionEstado` a `ACEPTADO` y emite recibo. `RECHAZAR` deja el pago sin aplicar con `estadoPago=REVISION` y `revisionEstado=RECHAZADO`; el admin puede registrar un ajuste/reembolso despues, que lo pasa a `REFUNDED`/`CONTRACARGO`.

### 4.4 Webhook PayPal

Headers obligatorios: `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-TIME`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-CERT-URL`, `PAYPAL-AUTH-ALGO`. Sin alguno: `401`, evento tecnico sin PII.

| Evento | Accion |
|---|---|
| `CHECKOUT.ORDER.APPROVED` | Busca el link por order id; captura la orden si aun no fue capturada. |
| `CHECKOUT.ORDER.COMPLETED` | Solo traza; la confirmacion real es el capture. |
| `PAYMENT.CAPTURE.COMPLETED` | Procesa el pago (idempotente por capture id). Resuelve el link por `supplementary_data.related_ids.order_id`; si falta, consulta la orden y usa `custom_id`/`invoice_id`. |
| `PAYMENT.CAPTURE.DENIED` | Marca intento fallido y fuerza una orden nueva (`orderExpiraEn=now`); el cobro sigue pendiente. |
| `PAYMENT.CAPTURE.REFUNDED` | `requiereAccion`; no modifica el pago automaticamente. |
| `PAYMENT.CAPTURE.REVERSED` | `requiereAccion` (contracargo/reversion); no modifica automaticamente. |
| `CUSTOMER.DISPUTE.CREATED` | `requiereAccion`; visible para el admin. |
| Desconocido | `200 { ignored: true }`; se registra solo el tipo/id. |

Respuestas: `200` procesado/duplicado/ignorado; `401` firma invalida; `503` PayPal no configurado o verificacion no disponible; `500` error de procesamiento (PayPal reintenta).

### 4.5 Invariantes

- `montoAcordado > 0`, `comision >= 0`, `total > 0`; todos enteros en centavos.
- PayPal siempre `moneda = "usd"`; se rechaza ARS.
- El “total esperado” de AC-8/AC-27 es el snapshot `EnlacePago.total`; si el admin edito el monto acordado, ese total es el nuevo esperado. La captura se compara contra ese snapshot y la moneda USD.
- Un `Pago` PayPal confirmado tiene `externalId` (capture id) y/o `paypalOrderId` unico.
- Un hito `PAGADO` no admite un segundo pago exitoso.
- Un soporte acredita meses una sola vez por capture id.
- Un `EnlacePago` PayPal vencido/invalidado no crea una nueva orden.
- `EnlacePago` y `Pago` conservan el snapshot de tarifa; no se recalculan pagos historicos.
- No se persisten email/nombre del pagador; solo referencias PayPal y evidencia textual/URL.
- Los links y eventos no se borran al vencer, fallar o reversarse.

---

## 5. Seguridad y privacidad (cumplimiento de la constitucion)

### 5.1 Autenticacion y autorizacion

- `requireStaff()` acepta solo `role === "admin"` o `role === "asistente"` (`publicMetadata.role = "asistente"`). No existe alias `assistant`. Devuelve `userId` de Clerk, nombre y rol.
- La asistente accede solo a `/admin/clientes`, `/admin/cobros` y `/admin/pagos` (incluye detalle y recibo). Dashboard, servicios, blog y cualquier otra seccion del admin quedan admin-only o redirigen. El nav solo muestra las secciones permitidas. El ingreso a `/admin` redirige a la asistente a `/admin/cobros`, nunca al dashboard.
- `requireAdmin()` queda estricto para: registro manual PayPal, ajustes/reembolsos/contracargos, resolucion de diferencias y las paginas fuera del alcance de la asistente.
- Actualizar `src/lib/auth.ts`, `src/middleware.ts`, `src/app/(admin)/layout.tsx`, `src/app/(admin)/admin/**/page.tsx`, `src/components/layout/nav.tsx` y `src/app/(auth)/redirect/page.tsx` para permitir staff con el alcance indicado. Las APIs de link/envio usan `requireStaff`; las sensibles usan `requireAdmin`.
- Todas las APIs admin validan rol en servidor, no solo en UI. La UI oculta acciones no permitidas, pero el endpoint es la fuente de verdad.
- Rate limit por IP en admin (20/min) y en link publico (30/min IP, 5/min token). Es defensa en profundidad, no un sandbox.

### 5.2 Webhook

- Verificacion **server-to-server** con PayPal; nunca se confia en headers ni en el body por si solos.
- `PAYPAL_WEBHOOK_ID` obligatorio. Si falta, el endpoint responde `503` y no procesa.
- `EventoPasarela.eventoId` unico: un evento repetido no se procesa dos veces.
- Si la verificacion falla o faltan headers: `401`, se registra `firma_invalida` sin PII y sin crear pago.
- Si PayPal esta lento o no responde: timeout de 8 s en admin/retorno y de 4 s por llamada en el webhook (presupuesto total ~10 s), con `503`/`500` para que reintente; el retorno del comprador y el registro manual son recuperacion.
- Eventos desconocidos: `200` e `IGNORADO`; no rompen el CRM.
- No se guarda el payload crudo. Solo ids, tipo, monto, moneda, estado y motivo sanitizado.
- No se descarga el certificado X.509 por nuestra cuenta; se envia a PayPal en la verificacion (sin SSRF).

### 5.3 Secretos y configuracion

- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` son server-only; nunca `NEXT_PUBLIC_*`, nunca en logs, respuestas o Sentry.
- `PAYPAL_ENV` (`sandbox` | `production`) define la base URL; `PAYPAL_BASE_URL` permite override controlado. Credenciales de sandbox y produccion separadas.
- Si falta o es invalida la config, `paypalConfig()` devuelve `disponible: false`; la UI muestra “PayPal no disponible: configuracion incompleta” y el endpoint responde `503`. Mercado Pago no se toca.
- La rotacion de secretos es solo cambio de envs, sin deploy de codigo.
- `.env.example` documenta las variables sin valores reales.

### 5.4 PII y datos de pago

- No se almacenan datos de tarjetas ni credenciales del pagador. El checkout es alojado por PayPal.
- No se persisten email/nombre del pagador en ningun flujo PayPal (retorno, webhook o registro manual). No se agregan columnas `pagadorEmail`/`pagadorNombre`. El recibo usa `Cliente.nombre`/`Cliente.email` del CRM; solo se guardan referencias PayPal (`externalId` = capture id, `paypalOrderId`) y la evidencia textual/URL.
- Los logs incluyen `pagoId`, `enlaceId`, `externalId`, `monto`, `moneda`, `estado`, `pasarela`. Nunca email, nombre, direccion, payload, token ni URL completa del link.
- Sentry: se pasa `includeLocalVariables` a `false` para no capturar PII en stack frames y se agrega un `beforeSend` que redacta claves sensibles (`email`, `email_address`, `payerEmail`, `pagadorEmail`, `nombre`, `name`, `given_name`, `surname`, `address`, `token`, `enlace`, `PayerID`) en extras, contextos, breadcrumbs y request data.
- La evidencia manual es texto/URL (capture id, order id, comprobante o nota); no se suben archivos ni se agrega storage en esta fase.
- Acceso a pagos y recibos: staff con acceso a `/admin/pagos`; ajustes y resolucion de diferencias, solo admin.

### 5.5 Link publico

- Token opaco de alta entropia (`randomBytes(24).toString("base64url")`), unico, sin PII ni ids internos.
- `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`.
- Valida estado, expiracion, concepto pendiente y que no exista un pago ganador antes de crear una orden.
- No revela si un email existe ni datos del cliente; solo concepto y monto.
- El `return_url` incluye el token del link y PayPal agrega el order id; se valida que la orden pertenezca al link (`custom_id`/`invoice_id`).

### 5.6 Dinero

- Enteros en centavos; Zod valida `int().positive()` y rangos.
- Formula de gross-up con aritmetica entera y `Math.ceil`.
- No se aceptan montos en ARS para PayPal.
- `formatearMonto` usa formato argentino por defecto en UI/CRM/recibos: `10050 -> "US$100,50"`, `100050 -> "US$1.000,50"`. La variante en-US (`"US$100.50"`) solo se usa en plantillas EN y queda documentada como excepcion.
- Los tests y expectativas existentes que hoy esperan `US$25.00`/`US$100.00` se migran a es-AR; la suite no debe quedar con dos formatos para el mismo contexto.
- La UI muestra estado de carga, timeout y error legible; no bloquea el resto del admin.

---

## 6. Estrategia de pruebas (mapa AC → tipo de test)

### 6.1 Principios

- **Cero llamadas reales a PayPal en CI.** Todo `fetch` a PayPal se mockea con `vi.stubGlobal("fetch", ...)`; se agrega un guard que falla si un test intenta salir a `api-m*.paypal.com`.
- **Prisma mockeado** en tests de rutas/servicios; los tests unitarios puros no tocan DB.
- **Casos de dinero** con enteros y limites (0, 1 centavo, redondeo, tarifa 0, porcentaje invalido).
- **Concurrencia/idempotencia** con un store falso que impone unicidad, o con dobles que simulan `P2002`.
- **UI** con Testing Library y `user-event`: teclado, foco, Escape, `aria-live`, estados no dependientes solo del color.
- **Sandbox** es validacion manual obligatoria en **Railway staging con BD separada**; local/ngrok solo sirve para desarrollo y no reemplaza los tests ni la validacion final.
- **Cobertura de AC:** un meta-test lee `spec.md` y verifica que cada `AC-x` aparezca al menos en un archivo de test. AC-29 se marca como manual/sandbox en el checklist.

### 6.2 Mapa AC → test

| AC | Tipo | Archivo / caso principal |
|---|---|---|
| AC-1 | Unit + integration + component | `paypal-fees.test.ts`, `paypal-links.test.ts`, `api/admin/paypal-link.test.ts`, `paypal-link-modal.test.tsx`: link unico, montos y concepto pendiente. |
| AC-2 | Unit + integration | `paypal-links.test.ts`, `paypal-link.test.ts`: link activo reutilizado, sin duplicado. |
| AC-3 | Unit + integration | `paypal-messages.test.ts` (ES/EN, total, link, vencimiento), `api/admin/paypal-enviar.test.ts` (canal/fecha). |
| AC-4 | Integration + component | `api/admin/paypal-enviar.test.ts`, `cobros-paypal.test.tsx`: recordatorio no cambia estado. |
| AC-5 | Unit + integration | `paypal-process.test.ts`, `webhooks/paypal.test.ts`: Pago unico, desglose, recibo, vinculo. |
| AC-6 | Unit + integration | `paypal-process.test.ts` con doble submit/concurrencia; `webhooks/paypal.test.ts` duplicado. |
| AC-7 | Integration | `webhooks/paypal.test.ts`: firma ausente/invalida/alterada -> 401, sin Pago. |
| AC-8 | Unit + integration | `paypal-process.test.ts`: hito PAGADO, sin segundo cobro. |
| AC-9 | Unit + integration | `paypal-process.test.ts`: 1..12 meses, vencimiento una vez, mismo calculo que MP. |
| AC-10 | Unit + component | `paypal-receipts.test.ts`, `recibo-paypal.test.tsx`: identificador, desglose, sin tarjeta, sin factura. |
| AC-11 | Unit + component | `pagos-view.test.ts`, `pagos-paypal.test.tsx`: columnas y filtro PayPal. |
| AC-12 | Unit + component | `pagos-view.test.ts`, `cliente-paypal.test.tsx`: quien genero, fecha, canal, vinculo. |
| AC-13 | Unit + integration | `paypal-process.test.ts`, `mp-coexistencia.test.ts`, `webhooks/paypal.test.ts`: primer pago gana, otro invalidado, intento trazado. |
| AC-14 | Unit + integration | `paypal-links.test.ts`, `api/admin/paypal-link.test.ts`: error PayPal -> 502/503, sin Pago ni cambio de concepto. |
| AC-15 | Unit + integration + component | `paypal-webhook.test.ts`, `webhooks/paypal.test.ts`, `cobros-paypal.test.tsx`: fallido/cancelado/vencido, regenerar. |
| AC-16 | Unit + integration + component | `paypal-config.test.ts`, `api/admin/paypal-link.test.ts`, `paypal-link-modal.test.tsx`: sin config -> disabled/503, MP sigue. |
| AC-17 | Unit + integration | `auth.test.ts`, `api/admin/paypal-*.test.ts`: sin rol 403; asistente permitida solo en clientes/cobros/pagos y `/admin` redirige a cobros; asistente no manual/ajustes/revision; no existe alias `assistant`. |
| AC-18 | Unit + component | `paypal-fees.test.ts`, `pagos.test.ts`, `digest.test.ts`, `paypal-messages.test.ts`: 10050 centavos, `US$100,50` (es-AR), `US$1.000,50`, sin floats ni ARS; `US$100.50` solo en plantilla EN. |
| AC-19 | Unit + integration | `redact.test.ts`, `webhooks/paypal.test.ts`: logs/Sentry sin email/nombre. |
| AC-20 | Regression + integration | `mp-utils.test.ts`, `mercadopago-webhook.test.ts`, suite existente: MP intacto, link PayPal junto a MP. |
| AC-21 | Meta + suite | `spec-coverage.test.ts`: cada AC con test; `npm test` sin red. |
| AC-22 | Unit + integration + component | `paypal-adjustments.test.ts`, `api/admin/paypal-ajustes.test.ts`, `ajuste-paypal.test.tsx`: pago original, decision admin, sin automatismo. |
| AC-23 | Component | `paypal-link-modal.test.tsx`, `registrar-pago-paypal.test.tsx`, `ajuste-paypal.test.tsx`: teclado, foco, errores `role=alert`. |
| AC-24 | Unit + integration | `paypal-fees.test.ts`, `paypal-process.test.ts`, `paypal-receipts.test.ts`: total, comision, desglose. |
| AC-25 | Unit + integration | `api/admin/paypal-manual.test.ts`: solo admin, evidencia, unico, webhook posterior no duplica. |
| AC-26 | Unit + integration | `paypal-links.test.ts`, `pago-paypal-route.test.ts`: 30 dias, vencido, regenerado, historial. |
| AC-27 | Unit + integration + component | `paypal-process.test.ts`, `api/admin/paypal-revision.test.ts`, `revision-paypal.test.tsx`: diferencia -> REVISION, admin resuelve. |
| AC-28 | Unit + integration | `paypal-client.test.ts` (guest checkout flags), `webhooks/paypal.test.ts` (no PII), `redact.test.ts`. |
| AC-29 | Manual sandbox | Checklist en §7.7 en Railway staging con BD separada + tareas T-33, T-35..T-38; evidencia en `review.md`. |

### 6.3 Pruebas criticas adicionales

- **Formato USD:** `formatearMonto` produce es-AR en UI/CRM/recibos/digest; los tests existentes que esperaban `US$25.00`/`US$100.00` se actualizan. Solo la plantilla EN puede usar en-US (`US$100.50`).
- **Sandbox:** la validacion final se ejecuta en Railway staging con BD separada; local/ngrok solo desarrollo.
- **Idempotencia:** dos `PAYMENT.CAPTURE.COMPLETED` simultaneos, uno con el mismo `eventoId`, otro con distinto evento pero mismo capture id; debe quedar un solo `Pago` y un solo movimiento de vencimiento.
- **Desorden:** `CAPTURE.COMPLETED` antes de `ORDER.APPROVED`; `ORDER.APPROVED` sobre un link ya PAGADO; refund antes de completed (se ignora/requiere accion).
- **Diferencias:** pago parcial, pago mayor, moneda distinta, captura sin `purchase_unit` esperado.
- **Meses:** 1, 12, 0/13 rechazados, vencimiento futuro vs pasado, fin de mes.
- **Coexistencia:** MP paga primero y llega PayPal despues; PayPal paga primero y llega MP despues; links legacy sin `EnlacePago`; adopcion al generar PayPal.
- **Firma:** headers faltantes, `verification_status=FAILURE`, timeout de verificacion, webhook id incorrecto.
- **Regresion:** los 148 tests actuales deben seguir pasando; typecheck y build limpios; lint sin errores nuevos (la deuda existente queda fuera de alcance).

---

## 7. Impacto en despliegue, datos y migraciones

### 7.1 Variables de entorno

| Variable | Requerida | Secreta | Ejemplo / default | Uso |
|---|---|---|---|---|
| `PAYPAL_CLIENT_ID` | Para PayPal | Si | `AX...` | OAuth. |
| `PAYPAL_CLIENT_SECRET` | Para PayPal | Si | `EL...` | OAuth. |
| `PAYPAL_WEBHOOK_ID` | Para PayPal | Si | `8N...` | Verificacion de firma. |
| `PAYPAL_ENV` | Para PayPal | No | `sandbox` \| `production` | Base URL. Sin valor -> PayPal deshabilitado. |
| `PAYPAL_BASE_URL` | No | No | `https://api-m.sandbox.paypal.com` | Override controlado; si existe, prevalece. |
| `PAYPAL_FEE_BPS` | No | No | `540` | Porcentaje de comision (puntos basicos). Default 5,40%; se valida contra la cuenta real en sandbox. |
| `PAYPAL_FEE_FIXED_CENTS` | No | No | `30` | Fijo USD en centavos. Default US$0,30; se valida en sandbox. |
| `NEXT_PUBLIC_URL` | Si (existente) | No | `https://pixelarch.dev` | `return_url`, `cancel_url` y link estable. En staging debe ser la URL publica de staging. |
| `ADMIN_EMAIL` / `CONTACT_EMAIL` | No | No | Gmail del dueno | Alertas de eventos que requieren accion. |

No se agrega ninguna `NEXT_PUBLIC_*` de PayPal, por lo que **no hace falta tocar el Dockerfile** ni los build args. Las envs server-only se inyectan en runtime en Railway. Si en el futuro se usa el JS SDK client-side, ahi si habria que agregar `ARG`/`ENV`.

### 7.2 Railway

- Servicio principal **PixelArch** (`871fb7fb-789f-447e-9a9d-49b7b47cea27`), proyecto `PixelArch-Plataforma`.
- La validacion final se hace en un **entorno Railway staging** con su propio servicio web y **Postgres separado**. Cargar alli las envs sandbox y usar una URL publica estable para el webhook. Local/ngrok solo sirve para desarrollo.
- Cargar las envs de produccion en el servicio principal solo cuando el checklist §7.7 este aprobado en staging.
- `railway.toml` ya vigila `src/**`, `prisma/**` y `package.json`; el deploy se dispara con el codigo. Cambios solo de docs (`AGENTS.md`, `MEMORY.md`, `specs/**`) no disparan build.
- No se agregan volumes, buckets ni Functions. El entorno staging puede reutilizar el mismo repositorio con su propio Postgres; el webhook es una API route normal.
- `prisma db push` se corre contra la BD de staging durante la validacion y contra la BD de produccion una vez, con backup/ventana de mantenimiento acordada. Es aditivo; no borra datos.

### 7.3 Webhook en PayPal

- URL produccion: `https://pixelarch.dev/api/webhooks/paypal`.
- URL sandbox: la URL publica estable del servicio **Railway staging** (no local/ngrok para la validacion final).
- Eventos a suscribir: `CHECKOUT.ORDER.APPROVED`, `CHECKOUT.ORDER.COMPLETED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `CUSTOMER.DISPUTE.CREATED`.
- El `webhook_id` del panel debe coincidir con `PAYPAL_WEBHOOK_ID`. Credenciales y webhook los configura el dueno de la cuenta (PA-11).

### 7.4 Middleware y rutas

- Agregar `/pago(.*)` a `ROUTES.public` en `src/middleware.ts`; las APIs `/api/webhooks/*` ya estan excluidas del matcher.
- Las rutas admin nuevas quedan cubiertas por el matcher de `/api/(...)` y por `requireStaff`/`requireAdmin`.
- Las paginas publicas de pago llevan `robots: { index: false }` y `no-store`.

### 7.5 Migracion y rollback

1. `prisma db push` + `prisma generate` (aditivo) contra la BD objetivo, antes de desplegar el codigo que consulta las tablas nuevas.
2. Backfill SQL de `pasarela`/`origen`/montos historicos.
3. Deploy del codigo con PayPal **deshabilitado** (sin envs) para que la app arranque y MP siga igual.
4. Smoke test: `/api/health`, login admin, `/admin/pagos`, crear un link MP de prueba en un entorno seguro.
5. Configurar el entorno Railway staging con BD separada y ejecutar el checklist §7.7 completo.
6. Aprobado el checklist en staging, configurar produccion y habilitar PayPal.

Rollback: quitar `PAYPAL_ENV`/credenciales deshabilita PayPal sin tocar la BD; el codigo viejo ignora tablas/columnas nuevas. No hay migracion destructiva. Los pagos y links creados se conservan.

### 7.6 Observabilidad

- Logs estructurados con ids, monto, moneda, estado y pasarela; sin PII ni secretos.
- Sentry: `captureException` en fallos de webhook/procesamiento con error sanitizado; `beforeSend` redacta PII.
- Alertas/visibilidad para `EventoPasarela.requiereAccion = true` (reembolsos, contracargos, duplicados) en `/admin/cobros` o `/admin/pagos`.
- Health check existente; no se agrega dependencia de PayPal al health (PayPal caido no debe afectar el sitio ni MP).

### 7.7 Checklist de sandbox (AC-29)

1. Crear app sandbox en PayPal Developer; obtener client id/secret y business/personal sandbox accounts.
2. Configurar el **entorno Railway staging** con su propio Postgres: `PAYPAL_ENV=sandbox`, credenciales, `PAYPAL_WEBHOOK_ID`, `PAYPAL_FEE_BPS=540` y `PAYPAL_FEE_FIXED_CENTS=30` (o la tarifa validada). Usar **BD separada**, nunca la de produccion. Local/ngrok solo para desarrollo, no cuenta como validacion final.
3. Registrar el webhook sandbox contra la URL publica estable del servicio staging de Railway, con los eventos de §7.3.
4. Generar un link para un hito de prueba; verificar que el hito sigue PENDIENTE, que se muestra monto acordado/comision/total en formato `US$100,50`, y que el gross-up usa la tarifa configurada.
5. Contrastar la comision calculada con la comision real informada por PayPal en la cuenta sandbox; si difiere, ajustar `PAYPAL_FEE_BPS`/`PAYPAL_FEE_FIXED_CENTS`, regenerar el link y confirmar el nuevo snapshot.
6. Pagar como invitado (si PayPal lo permite) con una cuenta personal sandbox; verificar redireccion, captura, webhook, `Pago` SUCCEEDED, recibo con datos del cliente del CRM y hito PAGADO.
7. Generar un link de soporte de 3 meses; pagar; verificar acreditacion de 3 meses y vencimiento una sola vez.
8. Reenviar el mismo webhook desde el panel/API de sandbox de PayPal (con firma valida, sin inventarla) y verificar que no se duplica el pago ni los meses.
9. Enviar un webhook con firma invalida/ausente y verificar 401, sin Pago y con evento tecnico sin PII.
10. Forzar una diferencia de monto (orden de prueba con otro monto) y verificar `REVISION`, sin marcar hito ni acreditar meses.
11. Generar link MP y PayPal para el mismo cobro pendiente; pagar uno y verificar que el otro queda invalidado y que un segundo intento no crea otro Pago.
12. Registrar un pago manual con capture id/order id y evidencia textual; luego reenviar el webhook real de ese pago; verificar que no se duplica y que no se guardaron email/nombre del pagador.
13. Registrar un reembolso/contracargo manual y verificar que el pago original se conserva y que la decision del admin se aplica.
14. Confirmar que no se toco la BD de produccion y guardar evidencia (ids de pago/evento, capturas) en `review.md` o en el registro de la tarea; dejar constancia de que la validacion final fue en staging.

---

## 8. Riesgos y supuestos

### 8.1 Riesgos

| Riesgo | Impacto | Mitigacion |
|---|---|---|
| PayPal Orders vive 3 h (72 h max), no 30 dias. | El link directo de PayPal venceria antes que el link del CRM. | Link estable local + creacion/reuso de orden al abrir; se documenta que el checkout final es PayPal. |
| No se puede “cancelar” una orden PayPal ya creada. | Un comprador podria pagar un link invalidado por el primer pago. | Invalidacion local + deteccion de capture duplicado + `requiereAccion` para reembolso manual. Se documenta la limitacion. |
| Tarifa real de PayPal distinta de 5,40% + US$0,30. | PixelArch absorbe diferencia o cobra de mas. | Default configurable por env y **validado contra la cuenta real en sandbox**; snapshot por operacion. Si la tarifa cambia, se ajusta la env y se regeneran links nuevos; no se recalculan pagos historicos. |
| Cuenta PayPal AR con restricciones para recibir USD. | PayPal no disponible o fondos retenidos. | Validacion en Railway staging con la cuenta real antes de produccion; si falla, PayPal queda deshabilitado y MP sigue. |
| Guest checkout no garantizado. | Algunos pagadores deberan crear cuenta PayPal. | `NO_PREFERENCE`; se comunica que PayPal decide. AC-28 lo condiciona a que PayPal lo permita. |
| Webhook lento o caido. | Pago no conciliado a tiempo. | Timeout, reintentos de PayPal, captura en retorno y registro manual admin. |
| Eventos fuera de orden o duplicados. | Doble pago o doble acreditacion. | Idempotencia por evento/capture/order + transacciones + constraints unicas + tests. |
| Link MP legacy pagado despues de PayPal. | Segundo pago para el mismo cobro. | Adopcion del link legacy al generar PayPal, invalidacion y deteccion de duplicado; si el legacy no fue adoptado, el riesgo residual se alerta. |
| Rol `asistente` no existe hoy en el codigo. | La asistente no puede operar o se le da mas acceso del necesario. | `publicMetadata.role = "asistente"` exacto, sin alias; `requireStaff` + gate estricto admin; acceso solo a clientes/cobros/pagos; tests de autorizacion. |
| `formatearMonto` cambia a formato es-AR en todo el CRM. | Cambio visual y tests existentes desactualizados (`US$25.00`, `US$100.00`). | Se migran formateos ad-hoc y expectativas en T-04b/T-31; unica excepcion documentada: plantilla EN en-US. |
| Datos del pagador en logs/Sentry o en la BD. | Fuga de PII o almacenamiento innecesario. | No se persisten email/nombre; recibo con datos del cliente del CRM; `includeLocalVariables: false` + `beforeSend` scrubber y tests de redaccion. |
| Validacion sandbox en local/ngrok se toma como final. | Se aprueba produccion con un entorno no reproducible o se toca la BD equivocada. | Validacion final obligatoria en **Railway staging con Postgres separado**; local/ngrok solo desarrollo; checklist §7.7 y evidencia. |
| El pagador PayPal no coincide con el cliente del CRM. | El recibo interno muestra los datos del cliente y no los del pagador. | Es un recibo interno, no fiscal; se documenta. Si se requiere el dato del pagador, se evalua en otra spec. |
| Sentry `includeLocalVariables` captura PII. | Fuga de email/nombre en errores. | Pasar `includeLocalVariables` a `false` y agregar `beforeSend` scrubber; tests de redaccion. |
| Rate limit en memoria no es distribuido. | Abuso en multiples instancias. | Limites conservadores; PayPal tambien aplica controles; no es la unica defensa. |
| Evidencia manual solo texto/URL. | No hay archivo adjunto en el CRM. | Se documenta; si se requiere archivo, se evalua storage en otra spec. |

### 8.2 Supuestos

- El rol de la asistente se representa exactamente como `publicMetadata.role = "asistente"`; no se acepta `assistant` como alias.
- La asistente accede solo a clientes/cobros/pagos; dashboard, servicios, blog y las acciones sensibles quedan para el admin.
- La cuenta PayPal es business y puede recibir USD; el dueno configura credenciales/webhook.
- La tarifa default es 5,40% + US$0,30 (AR, tramo 0,01–3.000 USD/mes); se ajusta por env y se valida contra la cuenta real en sandbox.
- La evidencia del registro manual es texto/URL (capture id, order id, comprobante o nota), no un archivo; no se agrega storage.
- El link estable de PixelArch es aceptable como “link de PayPal” porque el checkout final es alojado por PayPal y la spec exige 30 dias.
- El admin/asistente inicia todos los cobros; no hay autoservicio del cliente.
- No se aceptan pagos parciales automaticos: una diferencia queda en `REVISION` y la decide el admin.
- El recibo es interno; no hay factura fiscal. Se emite con los datos del cliente del CRM y no persiste email/nombre del pagador.
- `formatearMonto` usa es-AR en UI/CRM/recibos; la plantilla EN puede usar en-US como unica excepcion documentada.
- La validacion final de sandbox se hace en Railway staging con base de datos separada; local/ngrok es solo desarrollo.

### 8.3 Decisiones operativas resueltas

1. **Rol asistente:** `publicMetadata.role = "asistente"`, sin alias `assistant`. Acceso acotado a clientes, cobros y pagos. El registro manual, los ajustes, los reembolsos/contracargos y la resolucion de diferencias quedan solo para admin.
2. **Tarifa gross-up:** default **5,40% + US$0,30**, configurable por variable de entorno. Se valida contra la cuenta real en sandbox. Se mantiene la formula entera y el snapshot por operacion.
3. **Formato USD:** `formatearMonto` cambia a formato argentino en UI/CRM/recibos: `US$100,50`, `US$1.000,50`. Se actualizan los tests y expectativas existentes que hoy esperan `US$25.00`. Las plantillas en ingles pueden usar formato en-US (`US$100.50`) para el destinatario internacional; esa excepcion queda documentada.
4. **Evidencia manual:** texto/URL (capture id, order id, comprobante o nota); no se adjuntan archivos ni se agrega storage.
5. **Sandbox:** validacion final en **Railway staging con base de datos separada**. Local/ngrok solo para desarrollo, no como validacion final.
6. **Datos del pagador:** no se persisten email/nombre por defecto. El recibo se emite con los datos del cliente del CRM; solo se guardan referencias de PayPal. Se mantiene la redaccion de PII en logs/Sentry.

No quedan preguntas abiertas de operacion para esta spec.

### 8.4 Orden de implementacion

1. **Base:** envs/config, roles, schema Prisma, dominio de dinero, migracion de formatos USD, mensajes, cliente REST.
2. **Backend:** links, APIs admin, procesador de captura, meses, idempotencia, recibos, rutas publicas, manual, ajustes, revision, coexistencia MP.
3. **UI:** modal PayPal, integracion en cliente/cobros, historial, recibo, manual, ajustes, revision, accesibilidad.
4. **Webhook:** ruta, verificacion, dispatch y pruebas de resiliencia.
5. **Tests:** cobertura de AC, dinero/PII/Sentry, regresion MP, suite completa.
6. **Docs:** `.env.example`, `AGENTS.md`, `MEMORY.md`, checklist sandbox.
7. **Deploy:** migracion/backfill, staging sandbox, produccion, smoke y monitoreo.

Cada paso debe dejar typecheck, lint (sin errores nuevos) y tests en verde antes de pasar al siguiente.
