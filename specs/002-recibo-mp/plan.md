# Plan 002: Recibo interno imprimible de pagos de Mercado Pago

**Spec:** ./spec.md
**Estado:** propuesto para implementacion
**Fecha:** 2026-10-29
**Rama:** `paypal-staging` (D-8)
**Dependencia dura:** T-38 (esquema PayPal aplicado en produccion). Esta feature no agrega esquema propio, pero lee `Pago.pasarela`, `Pago.reciboId`, `Pago.reciboEmitidoEn` y `EnlacePago`, que hoy no existen en produccion.

## 1. Resumen tecnico

Se generaliza la ruta existente `/admin/pagos/[id]/recibo` y el componente presentacional del recibo para que sirvan a pagos de Mercado Pago sin duplicar la vista. El trabajo se apoya en cuatro piezas:

1. **`src/lib/mp-utils.ts` + `src/lib/mp-recibo.ts`** (nuevo/modificado):
   - `mp-utils.ts` suma el dominio puro y **browser-safe**: estados con recibo, validacion de montos, moneda y fecha, y el tipo `ReciboMercadoPago`.
   - `mp-recibo.ts` es **server-only**: usa `node:crypto` para el identificador D-1a y construye/evalua el recibo. No se importa en runtime desde componentes cliente.
2. **`src/lib/paypal/view.ts`** (modificado): helper compartido de pasarela efectiva (`pasarela` + fallback `metodo`) y elegibilidad de recibo ampliada para MP. Usa solo helpers browser-safe de `mp-utils.ts` (nunca `node:crypto`), porque `view.ts` lo importa un componente cliente (`revision-paypal-button.tsx`). Es el mismo mapper que ya usan `/admin/pagos` y el detalle del cliente, por lo que el enlace "Ver recibo" aparece en ambas vistas sin tocar su estructura.
3. **`src/components/ui/recibo-pago.tsx`** (nuevo, generico): layout imprimible unico (marca, encabezado, cliente, tabla, pie, boton de imprimir).
   - `recibo-paypal.tsx` pasa a ser un adaptador que conserva su API publica, sus textos y su DOM.
   - `recibo-mercadopago.tsx` es el adaptador nuevo para ARS/USD; importa el tipo `ReciboMercadoPago` desde `mp-utils.ts` (browser-safe), nunca el modulo server-only.
4. **`src/app/(admin)/admin/pagos/[id]/recibo/page.tsx`** (modificado): una sola consulta, autorizacion staff primero y bifurcacion PayPal / Mercado Pago. PayPal conserva su camino actual; MP usa el modulo server-only y el componente nuevo.

No hay cambios de esquema, migraciones, backfill, envs, Dockerfile, red, emails ni mutaciones. La unica interaccion de navegador sigue siendo `window.print()`.

## 2. Arquitectura (componentes y flujo de datos)

### 2.1 Archivos y responsabilidades

| Archivo | Accion | Responsabilidad |
|---------|--------|-----------------|
| `src/lib/mp-utils.ts` | modificar | Dominio puro browser-safe: `ESTADOS_RECIBO_MERCADOPAGO`, `esEstadoReciboMercadoPago`, `ReciboMpValidationError`, `validarMontosReciboMp`, `monedaReciboMp`, `resolverFechaReciboMp`, tipo `ReciboMercadoPago`. Sin `node:crypto`, sin Prisma, sin React. |
| `src/lib/mp-recibo.ts` | crear | Dominio server-only: `generarReciboIdMp` (SHA-256), `construirReciboMercadoPago`, `evaluarDatosReciboMercadoPago`. Importa los helpers de `mp-utils.ts`. No se importa en runtime desde cliente. |
| `src/lib/paypal/view.ts` | modificar | `pasarelaEfectivaPago`; `PagoHistorialInput.metodo`; `ElegibilidadReciboInput` ampliado; `evaluarElegibilidadRecibo` con rama MP usando solo helpers de `mp-utils.ts`; `mapearPagoHistorial` usa la pasarela efectiva para referencias y recibo. |
| `src/app/(admin)/admin/pagos/page.tsx` | modificar | Reemplaza el helper local `pasarelaDePago`/`pasarelaDesdeMetodo` por `pasarelaEfectivaPago`. Sin cambios visuales. |
| `src/app/(admin)/admin/clientes/[id]/page.tsx` | sin cambio de codigo esperado | `mapearPagoHistorial(p)` ya recibe `metodo` (escalar de Prisma) y ahora calcula la pasarela efectiva; el enlace de recibo MP aparece solo. |
| `src/components/ui/recibo-pago.tsx` | crear | Componente cliente generico: recibe datos ya normalizados y solo presenta. |
| `src/components/ui/recibo-paypal.tsx` | modificar | Se conserva como API publica (`ReciboPaypal`, mismos props) y delega en `ReciboPago` con los mismos textos/clases. |
| `src/components/ui/recibo-mercadopago.tsx` | crear | Adaptador MP: filas de desglose, etiquetas de moneda, nota y `caption`; delega en `ReciboPago`. |
| `src/app/(admin)/admin/pagos/[id]/recibo/page.tsx` | modificar | Bifurcacion por pasarela efectiva; concepto/fecha MP; `notFound()` si no es elegible o los datos no reconcilian. |
| `src/app/(admin)/admin.css` | modificar | `@page { size: A4; margin: 12mm }` dentro del bloque de impresion (aplica a ambos recibos). |
| `src/__tests__/...` | crear/modificar | Ver §6. |

### 2.2 Flujo de la pagina del recibo

```
requireStaff() -------------------------- sin staff -> redirect("/admin"); no se consulta nada
  |
  v
prisma.pago.findUnique(id, {
  cliente: { nombre, email },
  hito: { titulo, proyecto.titulo },
  suscripcion: { servicio.nombre },
  enlacePago: { concepto },
})  // una sola consulta; escalares de Pago incluidos por defecto
  |
  v
pasarelaEfectivaPago(pago)  // PAYPAL | MERCADOPAGO | MANUAL
  |
  +-- PAYPAL ------> construirReciboPaypal(...) (camino actual, sin cambios)
  |                   + referencia: externalId ?? paypalOrderId
  |                   + reciboId persistido obligatorio; USD; reconciliacion
  |
  +-- MERCADOPAGO --> evaluarDatosReciboMercadoPago({
  |                     estadoPago, referenciaExterna: externalId,
  |                     fechaPago: creadoEn, fechaEmision: reciboEmitidoEn,
  |                     monto, montoAcordado, comision, moneda
  |                   })
  |                   + si !ok -> notFound()
  |                   + concepto: enlacePago.concepto ?? "Proyecto — Hito"
  |                                ?? tituloLink(servicio, meses) ?? "Pago Mercado Pago"
  |                   + fecha: reciboEmitidoEn ?? creadoEn
  |                   + <ReciboMercadoPago ... />
  |
  +-- MANUAL -------> notFound()
```

### 2.3 Flujo de los enlaces "Ver recibo"

```
Pago (fila Prisma)
  -> mapearPagoHistorial(p)
       -> pasarelaEfectivaPago(p)
       -> mapearReferenciasPago({ ...p, pasarela })
       -> evaluarElegibilidadRecibo({ ...p, pasarela })
            -> PAYPAL: reglas actuales (reciboId + referencia)
            -> MERCADOPAGO: estado + externalId + montos/fecha validos
            -> MANUAL: no elegible
  -> PagoHistorial.recibo { disponible, motivo, reciboId, referencia, emitidoEn, href }
  -> PagosTabla (servidor) y PagoPaypalRow (servidor) renderizan "Ver recibo"
```

`/admin/cobros` no usa `PagosTabla` ni `PagoPaypalRow`: no se toca y no recibe el enlace (D-10).

### 2.4 Componente generico

`ReciboPago` reproduce el layout actual del recibo PayPal:

- Boton "Imprimir recibo" con `window.print()`, `print:hidden` y `focus-visible`.
- `<article aria-labelledby={idTitulo}>` con las mismas clases de impresion (`print:rounded-none print:border-0 print:p-0 print:shadow-none`).
- Encabezado: marca PixelArch, `<h1>` "Recibo interno de pago", numero de recibo y estado (`estadoUI`).
- `<dl>`: Cliente (nombre + email del CRM), Concepto, Fecha, Pasarela, Referencia externa, Moneda.
- Tabla semantica con `aria-label="Desglose del pago"`, `caption` sr-only, `thead` Concepto del cobro / Importe, filas con `th scope="row"` y `td`, `tfoot` con el total.
- Nota de importes.
- Pie: "Recibo interno emitido por PixelArch. No reemplaza a una factura fiscal." y "Documento generado desde pixelarch.dev".
- Fecha con `Intl.DateTimeFormat("es-AR", { timeZone: "UTC" })`, igual que hoy.

Contrato:

```ts
export interface ReciboPagoFila {
  etiqueta: string
  monto: number
}

export interface ReciboPagoDatos {
  reciboId: string
  concepto: string
  fecha: Date
  pasarelaLabel: string          // "PayPal" | "Mercado Pago"
  referenciaExterna: string
  moneda: "usd" | "ars"
  monedaLabel: "USD" | "ARS"
  filas: readonly ReciboPagoFila[]
  total: number
  etiquetaTotal: string          // "Total cobrado (USD)" | "Total cobrado (ARS)"
  caption: string
  notaImportes: string
}

export interface ReciboPagoProps {
  recibo: ReciboPagoDatos
  cliente: { nombre: string; email?: string | null }
  estado: string
  idTitulo?: string              // default "recibo-pago-titulo"
}
```

`ReciboPaypal` conserva exactamente:

- `reciboId`, `concepto`, `montoAcordado`, `comision`, `total`, `moneda: "usd"`, `fecha`, `pasarela: "PAYPAL"`, `referenciaExterna`.
- Filas "Monto acordado" y "Comisión de PayPal"; total "Total cobrado (USD)".
- Nota: "El total cobrado incluye la comisión de PayPal. Todos los importes están expresados en dólares estadounidenses (USD)."
- `caption`: "Desglose del pago en dólares estadounidenses".
- `idTitulo`: "recibo-paypal-titulo".

`ReciboMercadoPago` construye:

- `import type { ReciboMercadoPago as ReciboMercadoPagoDatos } from "@/lib/mp-utils"` para no chocar con el nombre del componente, igual que `ReciboPaypal`/`ReciboPaypalDatos`.
- Props: `{ recibo: ReciboMercadoPagoDatos; cliente: { nombre: string; email?: string | null }; estado: string }`.
- Filas: "Monto acordado" siempre; "Comisión de Mercado Pago" solo si `comision > 0`.
- Total: "Total cobrado (ARS)" o "Total cobrado (USD)".
- Nota:
  - `comision > 0`: "El total cobrado incluye la comisión de Mercado Pago. Todos los importes están expresados en ...".
  - `comision === 0`: "El total cobrado coincide con el monto acordado. Todos los importes están expresados en ...".
- `caption`: "Desglose del pago en pesos argentinos" / "en dólares estadounidenses".
- `idTitulo`: "recibo-mercadopago-titulo".
- `estadoUI(estado)` en el generico para "Pagado", "En revision", "Reembolsado", "Contracargo" (texto, no solo color); el adaptador MP solo pasa el estado crudo.

## 3. Decisiones y alternativas

| Decision | Alternativas | Motivo | Licencia/Coste |
|----------|--------------|--------|----------------|
| **D-1a: identificador derivado** `MP-AAAAMMDD-<32 hex>` a partir de `Pago.externalId` y la fecha del recibo. | (b) persistir `reciboId`/`reciboEmitidoEn` con backfill; (c) mostrar `externalId` como numero. | Evita esquema, migracion y backfill; no coordina una segunda migracion con T-38. (c) mezcla referencia con numero y no cubre altas manuales. | Sin costo de licencia. `node:crypto` es built-in. Riesgo teorico de colision mitigado con 128 bits (ver R-2). |
| **Componente generico + adaptadores** (`ReciboPago`, `ReciboPaypal`, `ReciboMercadoPago`). | Duplicar el recibo MP copiando el PayPal. | Un solo layout evita divergencia visual y de accesibilidad; el adaptador PayPal conserva API, textos y tests. | Refactor contenido; se valida con la suite PayPal existente (R-4). |
| **Pasarela efectiva compartida en `view.ts`**. | Nuevo modulo `pasarelas.ts`; duplicar el helper en cada pagina. | `view.ts` ya es el mapper de historial de PayPal, MP y manuales; evita un modulo nuevo y mantiene una sola regla. | Sin costo. El nombre `lib/paypal` queda algo amplio; se documenta. |
| **Validacion de montos y moneda en un modulo puro**. | Validar en la pagina; confiar en los datos. | La misma regla alimenta la elegibilidad del historial y la pagina; evita links a recibos que luego dan 404. | Sin costo. |
| **Impresion A4 global en `admin.css`**. | Estilo por pagina o por componente. | `@page` no se puede aplicar por componente; el estandar es comun a ambos recibos. | Afecta tambien al recibo PayPal solo en tamano/margen de papel, no en contenido. |
| **Sin feature flag**. | Env gate para habilitar MP. | La feature es de solo lectura y se despliega con T-38; un flag agrega configuracion sin reducir riesgo real. El rollback es revertir el commit. | Sin costo. |
| **Sin nuevas dependencias**. | Libreria de hash/fechas. | `node:crypto` e `Intl` cubren el caso. | Sin licencia nueva. |

## 4. Modelo de datos y contratos

### 4.1 Esquema

**No hay cambios en `prisma/schema.prisma`.** No hay `db push`, migracion ni backfill por esta feature. Se leen los campos existentes:

`Pago`: `id`, `clienteId`, `monto`, `montoAcordado`, `comision`, `moneda`, `estadoPago`, `externalId`, `reciboId`, `reciboEmitidoEn`, `creadoEn`, `pasarela`, `metodo`, `hitoId`, `suscripcionId`, `enlacePagoId`.

Relaciones incluidas: `cliente(nombre,email)`, `hito(titulo, proyecto.titulo)`, `suscripcion(servicio.nombre)`, `enlacePago(concepto)`. No se incluye `EnlacePago.url`, `checkoutUrl`, `notaInterna` ni `Hito.mpLink`/`Suscripcion.mpLink`.

### 4.2 Contrato de `src/lib/mp-utils.ts` (browser-safe)

```ts
export const ESTADOS_RECIBO_MERCADOPAGO = [
  "SUCCEEDED",
  "REVISION",
  "REFUNDED",
  "CONTRACARGO",
] as const

export const RECIBO_MP_REFERENCIA_MAX = 128
export const RECIBO_MP_CONCEPTO_MAX = 200

export type EstadoReciboMercadoPago =
  (typeof ESTADOS_RECIBO_MERCADOPAGO)[number]

export function esEstadoReciboMercadoPago(
  estado: string | null | undefined
): boolean

export class ReciboMpValidationError extends Error {
  readonly campo: string
}

export function validarMontosReciboMp(input: {
  monto: number
  montoAcordado?: number | null
  comision?: number | null
}): { montoAcordado: number; comision: number; total: number }

export function monedaReciboMp(
  valor: string | null | undefined
): "ars" | "usd" | null

export function resolverFechaReciboMp(
  fechaEmision: Date | string | null | undefined,
  fechaPago: Date | string | null | undefined
): Date | null

export interface ReciboMercadoPago {
  reciboId: string
  concepto: string
  montoAcordado: number
  comision: number
  total: number
  moneda: "ars" | "usd"
  fecha: Date
  pasarela: "MERCADOPAGO"
  referenciaExterna: string
}
```

Reglas de los helpers:

- **Estados**: `SUCCEEDED`, `REVISION`, `REFUNDED`, `CONTRACARGO`; cualquier otro (incluye `FAILED`, `PENDING`, `null`) no es elegible.
- **Montos**: enteros no negativos (centavos). `montoAcordado ?? monto`; `comision ?? 0`; debe cumplir `montoAcordado + comision === total`. Si `montoAcordado` falta y `comision > 0`, no reconcilia -> `ReciboMpValidationError`. No se recalcula nada.
- **Moneda**: solo `"ars"`/`"usd"` (case-insensitive); cualquier otra -> `null`. No se hace equivalente USD ni se usa `cotizacion`.
- **Fecha**: `fechaEmision ?? fechaPago`; si no es una fecha valida -> `null`. La misma fecha alimenta el id y el campo "Fecha".
- `mp-utils.ts` no importa `node:crypto`, Prisma, React ni red: puede ser importado por `view.ts` (que llega a un componente cliente).

### 4.3 Contrato de `src/lib/mp-recibo.ts` (server-only)

```ts
export const RECIBO_MP_PREFIJO = "MP"
export const RECIBO_MP_HASH_HEX = 32          // 128 bits
export const RECIBO_MP_ID_MAX = 80
// RECIBO_MP_REFERENCIA_MAX y RECIBO_MP_CONCEPTO_MAX viven en mp-utils.ts.

export function generarReciboIdMp(
  referenciaExterna: string,
  fecha: Date
): string

export function construirReciboMercadoPago(input: {
  referenciaExterna: string
  concepto: string
  monto: number
  montoAcordado?: number | null
  comision?: number | null
  moneda: string
  fecha: Date                                 // ya resuelta por el caller
}): ReciboMercadoPago

export type MotivoDatosReciboMp =
  | "ESTADO"
  | "SIN_REFERENCIA"
  | "DATOS_INCONSISTENTES"

export function evaluarDatosReciboMercadoPago(input: {
  estadoPago: string | null | undefined
  referenciaExterna: string | null | undefined
  monto: number | null | undefined
  montoAcordado?: number | null
  comision?: number | null
  moneda: string | null | undefined
  concepto?: string | null
  fechaEmision?: Date | string | null
  fechaPago: Date | string | null | undefined
}): { ok: true; recibo: ReciboMercadoPago } | { ok: false; motivo: MotivoDatosReciboMp }
```

Reglas:

- **Identificador**: `MP-${AAAAMMDD}-${hash32}`; fecha en UTC; hash SHA-256 de `referenciaExterna.trim()` truncado a 32 hex (128 bits) en mayusculas. `MP-` no colisiona con `PAY-` y no se escribe en `Pago.reciboId`.
- **Estabilidad**: misma referencia + misma fecha -> mismo id. La fecha es `reciboEmitidoEn ?? creadoEn`; ambas son inmutables en el flujo MP actual (`reciboEmitidoEn` siempre es `null`).
- **Unicidad**: `Pago.externalId` es `@unique`; el hash de 128 bits hace la colision despreciable. Se documenta la alternativa de usar el digest completo (64 hex, 76 chars, dentro de `RECIBO_MP_ID_MAX`) si se exigiera unicidad matematica (R-2).
- **Sin PII**: no se usan `cliente.nombre`, `cliente.email`, `hitoId`, `suscripcionId`, `enlacePagoId` ni `Pago.id`.
- **Concepto**: obligatorio, maximo 200; el evaluador usa "Pago Mercado Pago" si no se informa.
- **Referencia**: obligatoria, maximo 128; se muestra completa, sin truncar.
- **Errores**: `ReciboMpValidationError` con `campo` y mensaje. La pagina y la elegibilidad capturan y no muestran un recibo a medias.
- **Server-only**: `mp-recibo.ts` importa `node:crypto`; solo lo importan la pagina del recibo y sus tests. `view.ts` y los componentes cliente no lo importan en runtime (el componente MP usa `import type` desde `mp-utils.ts`).

### 4.4 Contrato de elegibilidad (`view.ts`)

```ts
export type MotivoReciboHistorial =
  | "DISPONIBLE"
  | "PASARELA_NO_ELEGIBLE"   // MANUAL o desconocida
  | "SIN_RECIBO"             // PayPal sin reciboId
  | "SIN_REFERENCIA"
  | "ESTADO_NO_ELEGIBLE"
  | "DATOS_INCONSISTENTES"

export interface ElegibilidadReciboInput {
  id: string
  pasarela?: string | null
  metodo?: string | null
  estadoPago?: string | null
  monto?: number | null
  montoAcordado?: number | null
  comision?: number | null
  moneda?: string | null
  reciboId?: string | null
  reciboEmitidoEn?: Date | string | null
  creadoEn?: Date | string | null
  externalId?: string | null
  paypalOrderId?: string | null
  enlacePago?: { externalId?: string | null } | null
}
```

Reglas de `evaluarElegibilidadRecibo`:

- `pasarelaEfectivaPago({ pasarela, metodo })`:
  - si `pasarela` es `PAYPAL` o `MERCADOPAGO`, manda;
  - si `pasarela` es `MANUAL`, `null` o invalida, se usa `metodo` (`PAYPAL`/`MERCADOPAGO`);
  - si nada coincide, `MANUAL`.
- **PayPal**: se conserva la regla actual (`reciboId` + `externalId ?? paypalOrderId`). Motivos: `SIN_RECIBO`, `SIN_REFERENCIA`. No se agregan chequeos de estado/monto para no alterar el recibo existente (AC-21).
- **Mercado Pago**:
  - sin `externalId` -> `SIN_REFERENCIA`;
  - `externalId.trim().length > RECIBO_MP_REFERENCIA_MAX` -> `DATOS_INCONSISTENTES`;
  - `esEstadoReciboMercadoPago(estado)` falso -> `ESTADO_NO_ELEGIBLE` (incluye `FAILED`, `PENDING`, `null`);
  - `resolverFechaReciboMp(reciboEmitidoEn, creadoEn)`, `validarMontosReciboMp(...)` y `monedaReciboMp(moneda)` fallan -> `DATOS_INCONSISTENTES`;
  - ok -> `DISPONIBLE`, con `reciboId: null` (el id derivado se calcula solo en la pagina), `referencia = externalId`, `emitidoEn = fecha`, `href = /admin/pagos/<id>/recibo`.
- **Manual**: `PASARELA_NO_ELEGIBLE`.
- El `href` solo se devuelve si `disponible`.
- `view.ts` usa solo helpers de `mp-utils.ts`; **no importa `mp-recibo.ts`**, para no arrastrar `node:crypto` al bundle cliente de `revision-paypal-button.tsx`.

`mapearPagoHistorial`:

```ts
const pasarela = pasarelaEfectivaPago(input)
const base = { ...input, pasarela }
return {
  ...,
  pasarela,
  pasarelaEtiqueta: PASARELA_LABEL[pasarela],
  referencias: mapearReferenciasPago(base),
  recibo: evaluarElegibilidadRecibo(base),
}
```

Esto hace que una fila historica con `pasarela = MANUAL` y `metodo = MERCADOPAGO` se muestre como Mercado Pago, con referencia "Pago MP <id>" y con recibo. Es el comportamiento que exige RF-3/AC-19.

### 4.5 Contrato de la pagina

- Ruta: `/admin/pagos/[id]/recibo` (sin cambios).
- Autorizacion: `requireStaff()` antes de cualquier consulta; `redirect("/admin")` si no hay staff.
- Consulta unica al pago: `prisma.pago.findUnique` con los includes de §4.1. `requireStaff()` puede consultar Clerk/Cliente para autenticar; eso no cuenta como consulta al pago.
- `notFound()` si:
  - el pago no existe o `pago.cliente` falta;
  - la pasarela efectiva es `MANUAL`;
  - PayPal: falta `reciboId`, falta referencia, no es USD o no reconcilia (comportamiento actual);
  - MP: `evaluarDatosReciboMercadoPago` no ok;
  - cualquier dato obligatorio falta o es invalido.
- Concepto MP: `enlacePago.concepto`; si no, `${proyecto.titulo} — ${hito.titulo}`; si no, `tituloLink(servicio.nombre, meses ?? 0)` (con `meses` nulo produce `Servicio — pago`, no se inventa un numero); si no, `"Pago Mercado Pago"`. No se imprimen ids internos.
- Respuesta: `ReciboPaypal` o `ReciboMercadoPago` + link "← Volver a pagos" con `print:hidden`.
- Sin `fetch`, sin SDK de MP, sin `sendPaymentReceipt`, sin `prisma.*.update/create/delete`, sin `EventoPasarela`.

## 5. Seguridad y privacidad (constitucion)

- **§1 Privacidad**: solo se muestran `cliente.nombre` y `cliente.email` del CRM. No se seleccionan ni renderizan datos del pagador, tarjeta, CBU/CVU, cuenta de Mercado Pago ni datos fiscales. No se imprimen `nota`, `evidencia`, `revisionNota`, `registradoPor`, `origen`, `mpLink`, `mpPreferenceId`, `checkoutUrl` ni `notaInterna`.
- **§1 Logs**: la pagina no loguea ni manda eventos a Sentry; no hay PII en logs. El identificador es un hash sin PII.
- **§2 Pagos**: no se mueve dinero, no se cambia ningun estado, no se registran eventos de pasarela. La vista es de solo lectura.
- **§3 Calidad**: TypeScript estricto; suite, typecheck, lint y build limpios antes de cerrar (sin errores nuevos sobre el baseline).
- **§4 UX**: impresion A4, texto oscuro sobre blanco, estado como texto, tabla con `caption`/`scope`, foco visible, navegacion por teclado.
- **§5 Operaciones**: `/admin/pagos/*` sigue detras del gate de Clerk; no se agrega a `ROUTES.public`, no hay token ni link publico. No hay envs nuevas ni cambios de Dockerfile.
- **§6 Dependencias**: no se agregan librerias; `node:crypto` es built-in.
- **§7 SDD**: la spec aprobada es la fuente de verdad; este plan y `tasks.md` referencian cada AC.

## 6. Estrategia de pruebas (mapa AC -> tipo de test)

### 6.1 Archivos

| Archivo | Tipo | Proposito |
|---------|------|-----------|
| `src/__tests__/lib/mp-recibo.test.ts` + `src/__tests__/lib/mp-utils.test.ts` | unitaria pura | Identificador, construccion y evaluacion (mp-recibo); montos, moneda, fecha y estados (mp-utils). Cubre AC-6, 7, 9, 10, 11, 12, 25. |
| `src/__tests__/lib/paypal-view.test.ts` | unitaria pura (actualizar) | Pasarela efectiva, elegibilidad MP, motivos, fila compuesta, regresion PayPal (AC-8 a 11, 18 a 21). |
| `src/__tests__/components/recibo-paypal.test.tsx` | unitaria DOM (sin cambios de comportamiento) | Paridad PayPal y regresion de textos/clases; se puede extender con la asercion de `@page` A4 (AC-21). |
| `src/__tests__/components/recibo-mercadopago.test.tsx` | unitaria DOM (nuevo) | Contenido, ARS/USD, comision, PII, impresion, accesibilidad, fecha (AC-3, 6, 7, 13, 15, 16, 26). |
| `src/__tests__/app/recibo-mp-page.test.tsx` | pagina con Prisma/navegacion mockeados (nuevo) | Permisos, elegibilidad, conceptos, estados, referencia, datos inconsistentes, sin red/email/mutaciones (AC-1 a 14, 17, 19, 20, 22, 23, 25, 26). |
| `src/__tests__/app/recibo-paypal-page.test.tsx` | pagina (1 fixture a cambiar) | Conserva la cobertura PayPal; el caso "no es PayPal" pasa de `MERCADOPAGO` a `MANUAL` porque MP ahora tiene recibo (AC-21). |
| `src/__tests__/components/pagos-paypal.test.tsx` | pagina `/admin/pagos` (actualizar) | El enlace aparece para MP elegible; no aparece para no elegible; PayPal sigue igual (AC-18, 19, 20, 21). |
| `src/__tests__/components/cliente-paypal.test.tsx` | pagina detalle (actualizar) | Se invierte "no muestra recibo para MP": ahora lo muestra; se mantiene la ausencia para manual y PayPal sin recibo (AC-18, 19, 21). |
| `src/__tests__/app/admin-pagos-estados.test.tsx` | regresion | Sin cambios esperados; verifica que los estados y el metodo sigan iguales. |

### 6.2 Mapa AC -> test

| AC | Tipo | Caso / archivo |
|----|------|----------------|
| AC-1 | pagina | `requireStaff` null -> redirect y `findUnique` no llamado. |
| AC-2 | pagina | asistente renderiza el recibo MP. |
| AC-3 | pagina + DOM | marca, titulo, id, estado "Pagado", cliente, concepto, fecha, pasarela, referencia, moneda. |
| AC-4 | pagina | concepto "Proyecto — Hito" y monto del CRM. |
| AC-5 | pagina | concepto "Servicio — N meses". |
| AC-6 | pura + DOM + pagina | ARS con `formatearMonto`, sin `US$`. |
| AC-7 | pura + DOM + pagina | USD con referencia externa (historico/futuro; el alta manual actual no la guarda), `formatearMonto`, sin `$... ARS`. |
| AC-8 | pura + pagina | `FAILED` y `PENDING` -> `ESTADO_NO_ELEGIBLE` / `notFound`. |
| AC-9 | pura + pagina | `REFUNDED`/`CONTRACARGO` -> disponible y estado real, nunca "Pagado"; montos intactos. |
| AC-10 | pura + pagina | `REVISION` -> disponible, "En revision", nunca "Pagado". |
| AC-11 | pura + pagina | id estable, distinto entre pagos, sin PII/ids internos, sin `PAY-`; la pagina muestra el id derivado. |
| AC-12 | pura + pagina | referencia exacta al `externalId`, completa. |
| AC-13 | pagina + DOM | PII extra del pagador no aparece. |
| AC-14 | pagina | `nota`, `evidencia`, `revisionNota`, `mpLink`, `mpPreferenceId`, `origen` y `registradoPor` no se imprimen (D-5). |
| AC-15 | DOM + CSS | `print:hidden` en boton/volver; `@page { size: A4 }`; clases `print:*`; referencia larga no se corta. |
| AC-16 | DOM | boton/link accesibles, foco visible, `caption`, `th scope`, estado como texto. |
| AC-17 | pagina | solo `findUnique`; `update/updateMany/create/delete` no llamados; `sendPaymentReceipt` no llamado. |
| AC-18 | paginas | link en `/admin/pagos` y detalle para MP elegible; sin link para no elegible; `/admin/cobros` no se toca. |
| AC-19 | pura + pagina | `pasarela=MANUAL` + `metodo=MERCADOPAGO`, `externalId` historico -> recibo sin backfill. |
| AC-20 | pura + pagina | sin `externalId` -> sin link / `notFound`; no se inventa referencia. |
| AC-21 | suite | tests PayPal existentes pasan; solo cambia el fixture "no PayPal" de la pagina (a `MANUAL`) y las aserciones mixtas de las tablas. |
| AC-22 | pagina | `@/lib/mercadopago` mockeado y no llamado; guard de red de la suite. |
| AC-23 | pagina | `sendPaymentReceipt` mockeado y no llamado; plantilla existente sin cambios. |
| AC-24 | suite completa | cada AC tiene al menos un caso; `vitest run` sin llamadas reales a MP. |
| AC-25 | pura + pagina | monto que no reconcilia, fecha invalida, referencia vacia/larga, cliente faltante -> error/`notFound`. |
| AC-26 | DOM + pagina | dos renders/impresiones con la misma fecha producen el mismo texto; `timeZone: "UTC"`. |

### 6.3 Regresion

- `recibo-paypal-page.test.tsx`, `recibo-paypal.test.tsx`, `paypal-receipts.test.ts`, `paypal-process*.test.ts`, `paypal-idempotencia.test.ts`: deben pasar sin cambios de comportamiento.
- `mercadopago-coexistencia.test.ts` y `mercadopago.test.ts`: el webhook y los links MP no se tocan. `mp-utils.test.ts` suma los casos de recibo sin cambiar los existentes.
- `pagos-paypal.test.tsx` y `cliente-paypal.test.tsx`: se actualizan solo las expectativas que cambian por la nueva elegibilidad MP; las aserciones PayPal se conservan. `admin-pagos-estados.test.tsx` no deberia necesitar cambios.
- La suite no debe hacer llamadas reales a MP. Ademas del mock explicito de `@/lib/mercadopago` en la pagina, se recomienda extender el guard de red de `src/__tests__/setup.ts` a `*.mercadopago.com` (test-only, sin impacto en producto).

## 7. Impacto en despliegue, datos y migraciones

### 7.1 Datos y esquema

- **Sin migracion, sin `db push`, sin backfill.** No se escribe en la base.
- El identificador derivado no se persiste; `Pago.reciboId`/`reciboEmitidoEn` quedan como estan (null en MP).
- Los pagos historicos ya tienen todo lo necesario (`externalId`, `monto`, `moneda`, `estadoPago`, `creadoEn`); no se reescriben.

### 7.2 Orden con T-38

1. Implementar y probar en `paypal-staging` (T-01..T-08).
2. Validar en staging (T-09) con la base que ya tiene el esquema PayPal.
3. **No mergear a `main` ni deployar a produccion antes de T-38.** T-38 sigue el orden ya definido: `db push` + backfill en produccion **antes** del merge/auto-deploy, FF-merge de `paypal-staging` y envs/webhook live.
4. Esta feature viaja en el mismo deploy que T-38; no necesita pasos de migracion propios ni envs.
5. Smoke post-deploy: health, `/admin/pagos` (link MP), detalle de un cliente con pago MP historico, recibo MP, recibo PayPal, asistente, impresion A4.

### 7.3 Rollback

- La feature es de solo lectura: no hay datos que revertir.
- Rollback = revertir el commit (o el merge) y redeployar. El recibo PayPal sigue funcionando; los links MP desaparecen y la ruta MP vuelve a `notFound`.
- No hay flag/env que apagar. Si se necesitara un apagado parcial sin revertir, se podria ocultar el link desde `evaluarElegibilidadRecibo`, pero no se propone.

### 7.4 Build y operacion

- Sin cambios de `Dockerfile`, `package.json`, envs ni `NEXT_PUBLIC_*`.
- Solo `src/**` + docs; `railway.toml` watchPatterns dispara build.
- Verificacion: `node node_modules\vitest\vitest.mjs run`, `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint` (sin errores nuevos sobre la deuda preexistente), `node node_modules\next\dist\bin\next build`.
- Sentry: la pagina no agrega logs ni capturas; los errores de render los captura el framework como cualquier pagina admin.

## 8. Riesgos

| ID | Riesgo | Impacto | Mitigacion |
|----|--------|---------|------------|
| R-1 | Actualizar tests mixtos (MP deja de ser "sin recibo") puede ocultar una regresion PayPal; varios `getByRole("link", { name: /ver recibo/i })` esperan un solo link y pasan a fallar por multiples. | Medio | Conservar todas las aserciones PayPal; usar `within(fila)` o `getAllByRole` en los tests de las tablas; revisar el diff de tests; correr primero los archivos PayPal y despues la suite completa. |
| R-2 | Colision teorica del hash truncado a 128 bits. | Bajo | `externalId` es `@unique`; 128 bits es despreciable. Si se exige unicidad matematica, usar el digest completo de 64 hex (76 chars, dentro del maximo). |
| R-3 | La pasarela efectiva cambia etiquetas de filas historicas (`MANUAL` + `metodo=PAYPAL/MERCADOPAGO`). | Bajo/Medio | Es el comportamiento aprobado (RF-3); ademas alinea la pagina del recibo con el link que `/admin/pagos` ya podia mostrar para un PayPal historico y evita un link muerto. Revisar el detalle del cliente y `/admin/pagos`; los tests cubren el caso. No cambia datos. |
| R-4 | Refactor de `recibo-paypal.tsx` altera el DOM/clases y rompe el recibo PayPal. | Medio | Mantener textos, clases y `idTitulo`; los tests existentes se ejecutan sin cambios; si algo falla, se conserva el markup PayPal y se extrae solo lo comun. |
| R-5 | Datos MP con `comision > 0` y totales que no reconcilian. | Bajo | AC-25: no se muestra recibo a medias; `notFound`; se prueba con fixtures. |
| R-6 | IDs/referencias largas se cortan en A4. | Bajo | `break-words`, `font-mono`, `@page A4`; prueba manual de impresion en T-09. |
| R-7 | Un flujo futuro setea `reciboEmitidoEn` despues de la primera apertura y cambia el id derivado. | Bajo | D-1a asume que la fecha del recibo es inmutable; el flujo MP actual no setea el campo. Documentado en el modulo. |
| R-8 | `mp-recibo.ts` usa `node:crypto`; importarlo en runtime desde un componente cliente rompe el bundle. | Bajo | Split `mp-utils.ts` (browser-safe) / `mp-recibo.ts` (server-only). `view.ts` solo importa `mp-utils.ts`; los componentes usan `import type`. Revisar imports en el PR. |
| R-9 | No hay datos MP reales en `REVISION`/`REFUNDED`/`CONTRACARGO` para validar. | Bajo | Se cubren con fixtures; la spec aclara que el flujo actual no los produce. |
| R-10 | Deployar antes de T-38 (sin columnas PayPal). | Alto | Checklist de release: no merge/deploy a produccion antes de T-38; staging ya tiene el esquema. |
| R-11 | El filtro de `/admin/pagos` sigue usando la columna `pasarela`; un historico `MANUAL` + `metodo=MERCADOPAGO` se muestra como MP y tiene recibo, pero no aparece bajo el filtro "Mercado Pago". | Bajo | Limitacion preexistente, fuera de AC-18; no se cambia el filtro en esta feature. Se documenta para el reviewer. |

## 9. Orden de implementacion

1. **T-01** dominio `mp-utils.ts` + `mp-recibo.ts` + tests.
2. **T-02** pasarela efectiva y elegibilidad MP en `view.ts` + actualizacion de tests de historial.
3. **T-03** `ReciboPago` generico + adaptador PayPal + A4 (paridad PayPal).
4. **T-04** `ReciboMercadoPago` + tests.
5. **T-05** pagina del recibo (rama MP, concepto, fecha, una consulta) + tests felices.
6. **T-06** bordes de la pagina (estados, sin referencia, sin red/email, datos inconsistentes) + tests.
7. **T-07** documentacion (`AGENTS.md`, `MEMORY.md`) y trazabilidad.
8. **T-08** verificacion final (suite, typecheck, lint, build).
9. **T-09** gate de staging + T-38 (sin codigo; no es un commit).

T-03 puede hacerse en paralelo con T-02; T-04 depende de T-03; T-05 depende de T-01, T-02 y T-04. El resto es secuencial.
