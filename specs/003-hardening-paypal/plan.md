# Plan 003: Hardening posterior a T-37/002 (H-5, H-6, H-7, H-8, H-9)

**Spec:** ./spec.md
**Estado:** propuesto para implementacion (H-6 bloqueado por datos del panel)
**Fecha:** 2026-10-29
**Rama:** `paypal-staging`
**Gate:** no merge a `main` ni deploy a produccion antes de T-38. T-38 no esta autorizado.
**Dependencia:** el esquema PayPal (incluida la relacion `EnlacePago.pagos` y `Pago.estadoPago`) ya existe en staging; produccion no lo tiene. H-5 viaja con T-38. H-7, H-8 y H-9 no agregan esquema.

## 1. Resumen tecnico

Cinco frentes independientes, sin cambios de esquema, envs, `Dockerfile`, `package.json` ni `railway.toml`:

1. **H-5 (estado publico):** extraer el mapeo de estado publico a `src/lib/paypal/utils.ts`, incluir en la consulta de `/pago/paypal/estado` la existencia de un `Pago` en `REVISION` y agregar el estado publico `revision` con copia propia. El retorno ya informa `pendiente`; se cubre con tests.
2. **H-7 (webhook PayPal):** nuevo modulo `src/lib/paypal/webhook-limit.ts` con limite de solicitudes y presupuesto de fallos por origen, mas un tope de cuerpo. La ruta `/api/webhooks/paypal` aplica rechazos baratos antes de verificar y conserva intacta la semantica de los eventos verificados.
3. **H-8 (base publica):** mantener `resolverBaseUrlPublica` como esta (ya falla cerrado) y agregar `construirLocationEstado` para devolver un `Location` absoluto o relativo. Las tres rutas publicas dejan de hacer `?? req.url`; la creacion de ordenes sigue fallando cerrado si no hay base absoluta.
4. **H-9 (higiene):** agregar `.railway/` a `.gitignore`; sin codigo.
5. **H-6 (investigacion):** producir `specs/003-hardening-paypal/h6-mp-firmas.md` con evidencia redactada, matriz de entornos, hipotesis y decision. Sin codigo, sin panel, sin secretos.

No hay cambios de comportamiento en montos, comisiones, checkout, links, emails, idempotencia ni procesamiento de capturas.

## 2. Arquitectura (componentes y flujo de datos)

### 2.1 H-5 — Estado publico en revision

#### Flujo actual

```
GET /pago/paypal/estado?token=...&estado=...
  -> noStore()
  -> prisma.enlacePago.findUnique({ where: { token }, select: { ...publicos } })
  -> estadoDeEnlace(): PAGADO => "pagado"
  -> ESTADOS["pagado"] = "Pago acreditado"
```

El problema: en una captura con diferencia de monto/moneda, `registrarPagoEnRevision` crea `Pago.estadoPago = "REVISION"` y marca el link `PAGADO`. La pagina solo mira el link y muestra "Pago acreditado". El retorno (`/pago/paypal/retorno`) ya devuelve `estado=pendiente` para `REVISION`, pero la pagina no lo usa cuando el link figura `PAGADO`.

#### Flujo propuesto

```
GET /pago/paypal/estado?token=...&estado=...
  -> noStore()
  -> prisma.enlacePago.findUnique({
       where: { token },
       select: {
         ...campos publicos actuales,
         pagos: {
           where: { estadoPago: "REVISION" },
           select: { estadoPago: true },
           take: 1,
         },
       },
     })
  -> resolverEstadoPublicoEnlace(enlace, { pagoEnRevision: enlace.pagos.length > 0 })
  -> if (estadoQuery === "error") estado = "error"
  -> ESTADOS[estado] (incluye "revision")
```

Reglas de mapeo:

| Link | Pago asociado | Concepto | Estado publico |
|------|---------------|----------|----------------|
| Cualquiera | `REVISION` | cualquiera | `revision` (primera regla) |
| `PAGADO` | sin pago / `SUCCEEDED` / otro | cualquiera | `pagado` (comportamiento actual) |
| `ACTIVO` | cualquiera | hito `PAGADO` | `pagado` |
| `ACTIVO` | cualquiera | hito `PENDIENTE` | `pendiente` |
| `ACTIVO` | cualquiera | soporte `SOPORTE` `ACTIVE`/`PAST_DUE` | `pendiente` |
| `ACTIVO` | cualquiera | otro concepto | `invalidado` |
| `VENCIDO` | cualquiera | cualquiera | `vencido` |
| `INVALIDADO` | cualquiera | cualquiera | `invalidado` |
| `FALLIDO` | cualquiera | cualquiera | `error` |
| `CREANDO` | cualquiera | concepto pendiente / no pendiente | `pendiente` / `invalidado` |
| — | — | `?estado=error` | `error` (prioridad final) |

`revision` gana sobre `PAGADO` y sobre cualquier concepto. Si la revision se resuelve y el pago deja de estar en `REVISION`, la proxima apertura vuelve a la regla normal. Si la consulta falla, la pagina muestra `error` (fail closed), nunca `pagado`.

#### Contrato del helper

En `src/lib/paypal/utils.ts` (dominio puro, sin Prisma):

```ts
export type EstadoPublicoPaypal =
  | "pendiente"
  | "pagado"
  | "revision"
  | "vencido"
  | "invalidado"
  | "error"

export interface EnlaceEstadoPublico extends ConceptoEnlacePaypal {
  estado: EstadoEnlace
  expiraEn: Date | string
}

export function resolverEstadoPublicoEnlace(
  enlace: EnlaceEstadoPublico,
  opciones?: { pagoEnRevision?: boolean }
): EstadoPublicoPaypal
```

- Reutiliza `resolverEstadoEnlace` y `evaluarConceptoEnlace`; no duplica reglas.
- `pagoEnRevision === true` devuelve `"revision"` antes de evaluar el link.
- No conoce query strings, React ni Prisma.

#### Cambios en la pagina

- `src/app/pago/paypal/estado/page.tsx`
  - `EnlacePublico` suma `pagos: { estadoPago: string }[]`.
  - `ESTADOS_QUERY` sigue aceptando solo `pendiente`, `pagado`, `vencido`, `invalidado`, `error` (no se acepta `revision` por query).
  - `ESTADOS` suma `revision` (la copia visible usa "Pago en revision" sin acento, como el resto de la UI):
    - `titulo: "Pago en revision"`
    - `detalle: "Estamos revisando el pago. No es necesario volver a pagar."`
    - `Icono: Clock3` (no `CheckCircle2`)
    - `color: "text-amber-300"`
  - `estadoDeEnlace` delega en `resolverEstadoPublicoEnlace` con `pagoEnRevision`.
  - Se elimina el `switch` local de estados.
  - El resto del markup (concepto, monto USD, `role="status"`, `no-store`, metadata) no cambia. No se agrega detalle de la revision, diferencia, nota ni enlace al admin.

No se toca `/pago/paypal/retorno`: ya devuelve `pendiente` para `REVISION` (`estadoDeResultado`). Se agrega test de integracion retorno -> pagina.

### 2.2 H-7 — Rate limit y hardening del webhook PayPal

#### Archivos y responsabilidades

| Archivo | Accion | Responsabilidad |
|---------|--------|-----------------|
| `src/lib/paypal/webhook-limit.ts` | crear | Dominio puro con reloj inyectable: limite de solicitudes por clave, presupuesto de fallos, limpieza por exito, mapa acotado y chequeo de tamano de cuerpo. Sin Prisma, red, React ni envs. |
| `src/app/api/webhooks/paypal/route.ts` | modificar | Aplicar limite, tope de cuerpo y orden de rechazos; contar fallos; limpiar al verificar; conservar 200/401/500/503. |
| `src/__tests__/lib/paypal-webhook-limit.test.ts` | crear | Unitarios del limitador y del tope de cuerpo. |
| `src/__tests__/api/webhooks/paypal.test.ts` | extender | Casos de ruta: 429, 413, 401 acotado, 503 no cuenta, verificado intacto. |
| `src/__tests__/api/webhooks/paypal-resiliencia.test.ts` | revisar/extender | Regresion de timeouts, errores y reintentos. |

#### Contrato del limitador

```ts
export const WEBHOOK_SOLICITUDES_MAX = 300
export const WEBHOOK_SOLICITUDES_VENTANA_MS = 60_000
export const WEBHOOK_FALLOS_MAX = 20
export const WEBHOOK_FALLOS_VENTANA_MS = 10 * 60_000
export const WEBHOOK_CUERPO_MAX_BYTES = 256 * 1024
export const WEBHOOK_MAX_CLAVES = 10_000

export type ResultadoLimiteWebhook =
  | { permitido: true }
  | {
      permitido: false
      motivo: "SOLICITUDES" | "FALLOS"
      retryAfterSegundos: number
    }

export interface LimitadorWebhook {
  permitir(clave: string): ResultadoLimiteWebhook
  registrarFallo(clave: string): void
  registrarExito(clave: string): void
}

export function crearLimitadorWebhook(opciones?: {
  ahora?: () => number
  solicitudesMax?: number
  solicitudesVentanaMs?: number
  fallosMax?: number
  fallosVentanaMs?: number
  maxClaves?: number
}): LimitadorWebhook

export const limitadorWebhookPaypal: LimitadorWebhook

/** Solo para tests: reinicia el singleton. No se usa en producto. */
export function reiniciarLimitadorWebhookPaypal(): void

export function cuerpoExcedeLimite(
  contentLength: string | null,
  cuerpo: string | null
): boolean
```

Reglas:

- **Clave:** IP del origen (`x-forwarded-for` primera, `x-real-ip`, o `"desconocida"`). No se loguea la IP.
- **Solicitudes:** ventana fija por clave; se permiten `WEBHOOK_SOLICITUDES_MAX` y se bloquea la siguiente. `retryAfterSegundos` se calcula con el `resetAt`.
- **Fallos:** solo se registran en rechazos de autenticidad (`HEADERS_INCOMPLETOS`, `CUERPO_INVALIDO`, `EVENTO_INVALIDO`, `FIRMA_INVALIDA` y `VALIDACION` de la verificacion). No se registran en `503` por verificacion no disponible, `500` de procesamiento, `413` ni `429`.
- **Exito:** `registrarExito` borra el contador de fallos de la clave; no borra el contador de solicitudes.
- **Bloqueo:** `permitir` devuelve `FALLOS` si el contador de fallos alcanzo el maximo; si no, incrementa solicitudes y devuelve `SOLICITUDES` al superar el maximo.
- **Memoria:** cada mapa se limita a `WEBHOOK_MAX_CLAVES`; al llenarse se elimina la entrada mas antigua (orden de insercion). No hay timers por request.
- **Cuerpo:** `true` si `Content-Length` es un entero valido y supera el maximo, o si el cuerpo ya se leyo y `Buffer.byteLength(cuerpo, "utf8")` supera el maximo. Un `Content-Length` invalido o ausente no excede por si solo; el chequeo real se hace sobre el cuerpo cuando esta disponible. Un cuerpo `null` sin header no excede.

#### Orden de la ruta

```
POST /api/webhooks/paypal
  1. paypalConfig(); si no esta disponible -> 503 (sin limite, comportamiento actual)
  2. ip = ipDe(req)
  3. limite = limitadorWebhookPaypal.permitir(ip)
       -> 429 { error: "Demasiadas solicitudes" } + Retry-After + no-store
          (sin verificar, sin evento, sin tocar pagos)
  4. Content-Length > WEBHOOK_CUERPO_MAX_BYTES -> 413 (sin leer, sin verificar, sin evento)
  5. headers = leerHeadersTransmision(req.headers)
       -> sin headers: 401 + registrarFirmaInvalida(HEADERS_INCOMPLETOS) + registrarFallo(ip)
  6. crudo = await req.text()
       -> error de lectura: 401 + registrarFirmaInvalida(CUERPO_INVALIDO) + registrarFallo(ip)
       -> cuerpo ya leido > maximo: 413 sin evento ni fallo (lo acota el limite de solicitudes)
  7. JSON.parse(crudo)
       -> invalido: 401 + registrarFirmaInvalida(CUERPO_INVALIDO) + registrarFallo(ip)
  8. evento no es registro: 401 + registrarFirmaInvalida(EVENTO_INVALIDO) + registrarFallo(ip)
  9. verifyWebhookSignature()
       -> error VALIDACION: 401 + registrarFirmaInvalida(EVENTO_INVALIDO) + registrarFallo(ip)
       -> error de red/timeout/HTTP: 503 (sin evento, sin fallo)
       -> !verificado: 401 + registrarFirmaInvalida(FIRMA_INVALIDA) + registrarFallo(ip)
       -> verificado: registrarExito(ip)
 10. procesarEventoPaypal()
       -> 200 procesado/duplicado/ignorado; 500 error (sin contar fallo)
```

Notas:

- Los rechazos de los pasos 5 a 8 no llaman a PayPal. El paso 9 es el unico costoso.
- El `429` no escribe `EventoPasarela`: evita amplificar la base. El `413` tampoco.
- `registrarFirmaInvalida` ya usa un `eventoId` sintetico (hash del transmission id/event id) y no bloquea el evento real. El presupuesto de fallos acota cuantas filas puede generar un origen.
- Un evento verificado de otro origen no se ve afectado porque la clave es la IP. Un reintento legitimo del mismo origen durante la ventana recibe `429` temporal; al reiniciarse la ventana vuelve a intentarse. Es el trade-off aceptado de D-H7-1.
- `Retry-After` usa los segundos restantes de la ventana (minimo 1, maximo el tamano de la ventana).
- El `json()` local se extiende para aceptar headers extra (o se agrega un helper `respuestaLimitada`) sin cambiar las respuestas existentes.

#### Tabla de respuestas

| Caso | Status | Verifica | Evento | Cuenta fallo |
|------|--------|----------|--------|--------------|
| PayPal no configurado | 503 | no | no | no |
| Limite de solicitudes o fallos | 429 | no | no | no |
| Cuerpo excesivo | 413 | no | no | no (lo acota el limite de solicitudes) |
| Headers faltantes | 401 | no | si (`HEADERS_INCOMPLETOS`) | si |
| JSON invalido | 401 | no | si (`CUERPO_INVALIDO`) | si |
| Evento invalido | 401 | no | si (`EVENTO_INVALIDO`) | si |
| Firma invalida | 401 | si | si (`FIRMA_INVALIDA`) | si |
| Verificacion no disponible | 503 | si (falla) | no | no |
| Evento verificado | 200 / 500 | si | segun dominio | no |

### 2.3 H-8 — Base publica y redireccion segura

#### Estado actual

`resolverBaseUrlPublica(configurada, requestUrl)` ya hace lo correcto:

- env definida y valida -> base normalizada;
- env definida e invalida -> `null` (no cae a la request);
- sin env -> valida el origin de la request (HTTPS, o HTTP local/loopback);
- sin base valida -> `null`.

El problema esta en los llamadores:

- `src/app/pago/paypal/[token]/route.ts` (`urlEstado`): `resolverBaseUrlPublica(...) ?? req.url`.
- `src/app/pago/paypal/retorno/route.ts` (`urlEstado`): igual.
- `src/app/pago/paypal/cancelado/route.ts` (`urlEstado`): igual.
- `src/app/api/admin/paypal/link/route.ts`: no usa fallback; devuelve 400 si `null` (correcto, solo se testea).

#### Contrato del helper

En `src/lib/paypal/utils.ts`:

```ts
export interface LocationEstadoPublico {
  location: string
  absoluta: boolean
}

export function construirLocationEstado(
  configurada: string | null | undefined,
  requestUrl: string,
  token: string,
  estado: string
): LocationEstadoPublico
```

Reglas:

- Llama a `resolverBaseUrlPublica(configurada, requestUrl)`.
- Si hay base: `new URL("/pago/paypal/estado", base)`, setea `token` y `estado` con `URLSearchParams`, devuelve `{ location: url.toString(), absoluta: true }`.
- Si no hay base: devuelve `{ location: "/pago/paypal/estado?token=...&estado=...", absoluta: false }`. La ruta es fija; no se acepta host, esquema ni path del usuario. `URLSearchParams` codifica el token.
- No loguea el valor de la env ni la URL interna.
- `estado` se pasa como string corto y controlado por las rutas (`pagado`, `pendiente`, `error`, etc.); el helper no lo valida semanticamente.

#### Cambios en rutas

- Reemplazar el `urlEstado` local de `[token]`, `retorno` y `cancelado` por `construirLocationEstado`.
- `redirigirEstado` deja de usar `NextResponse.redirect(url)` y arma una respuesta 302 con `Location` manual:

```ts
const { location } = construirLocationEstado(
  process.env.NEXT_PUBLIC_URL,
  req.url,
  token,
  estado
)

return new NextResponse(null, {
  status: 302,
  headers: { ...HEADERS_SEGURIDAD, Location: location },
})
```

Esto permite `Location` relativo sin que `NextResponse.redirect` lo rechace.

- En `[token]`, la creacion de la orden sigue usando `resolverBaseUrlPublica` sin fallback:

```ts
const baseUrl = resolverBaseUrlPublica(process.env.NEXT_PUBLIC_URL, req.url)
if (!baseUrl) {
  logger.error("URL base publica invalida para PayPal", { enlaceId: enlace.id })
  return redirigirEstado(req, token, "error") // ahora relativo si no hay base
}
```

- `retorno` y `cancelado` no usan la base para nada mas que el redirect; el procesamiento y los eventos no cambian.
- `admin/paypal/link` no cambia: ya devuelve 400 si no hay base. Se agrega test con env invalida.
- No se toca `sitemap.ts`, `robots.ts`, `rss.xml`, `cron/uptime`, `mercadopago.ts` ni `admin/entregar`; usan `NEXT_PUBLIC_URL || default` y quedan documentados como riesgo separado (R-9).

### 2.4 H-9 — `.gitignore`

- Agregar al final de `.gitignore`, en una seccion propia:

```gitignore
# railway (estado local de la CLI)
.railway/
```

- Verificar que no haya archivos versionados:

```bash
git ls-files .railway
git check-ignore -v .railway/config.json
git status --short
```

- Si `git ls-files` devuelve algo, ejecutar `git rm -r --cached .railway` en la misma tarea (sin borrar el directorio local). Hoy no hay archivos en `.railway/`, pero la tarea incluye la verificacion.

### 2.5 H-6 — Investigacion de firmas MP

No hay cambio de codigo ni de panel en esta spec. El entregable es un expediente en `specs/003-hardening-paypal/h6-mp-firmas.md` con esta estructura:

1. **Alcance y metodo:** que se investigo, que no, y que fuentes se usaron.
2. **Matriz de entornos:** staging/produccion; cuenta/aplicacion MP; URL de webhook; eventos; secreto (presencia y rotacion); confirmacion de que produccion no apunta a staging.
3. **Muestras redactadas:** 3-5 por tipo (firma invalida, IPN vacia); fecha/hora, entorno, URL sin secretos, `x-signature`/`x-request-id` (parciales), query, body redactado, `data.id`, respuesta HTTP, real vs prueba.
4. **Verificacion de firma:** version del SDK `mercadopago`, construccion de `x-signature` (`ts`, `v1`, `data.id`), origen del `data.id` (query vs body), reloj, headers que envia MP.
5. **Hipotesis:** cada una con estado (confirmada / rechazada / evidencia insuficiente) y la evidencia que la discrimina. Hipotesis iniciales: secreto distinto, notificacion de otra cuenta/aplicacion, notificacion de prueba, IPN legacy, diferencia SDK/algoritmo, reloj.
6. **Conclusion y decision:** accion de configuracion, cambio de codigo (spec nueva/enmienda) o no accionar.
7. **Datos faltantes:** lista exacta de lo que debe aportar el dueno.
8. **Anexo:** consultas y comandos usados, sin secretos ni PII.

Reglas:

- El agente no cambia `MP_WEBHOOK_SECRET`, no desactiva la validacion y no toca el panel.
- Si la conclusion es un cambio de codigo, se abre una spec nueva (004 o enmienda de 001); no se implementa en 003.
- Toda muestra se redacta: sin nombre, email, telefono, direccion, tarjeta, CBU/CVU, firma completa ni credencial.

## 3. Decisiones y alternativas

| Decision | Alternativas | Motivo | Licencia/Coste |
|----------|--------------|--------|----------------|
| **D-H5-1: `Pago` en `REVISION` en la misma consulta** | Confiar en `?estado=pendiente`; guardar un estado publico en `EnlacePago` | El query es falsificable y no persiste; un campo nuevo requiere esquema y backfill. La relacion ya existe en staging. | Sin costo de licencia. Una llamada Prisma; Prisma puede resolver la relacion con una segunda sentencia SQL, sin N+1. |
| **D-H5-2: copia "Pago en revision"** | "Pago pendiente"; mostrar la diferencia | "Pendiente" se confunde con checkout no iniciado; la diferencia es un dato interno y no debe exponerse. | Sin costo. |
| **D-H5-3: el query solo conserva `error`** | Confiar en el query para el estado | La base es la fuente de verdad; el retorno solo aporta el error. | Sin costo. |
| **D-H7-1: dos capas (solicitudes + fallos), sin allowlist** | Allowlist de IPs de PayPal; limite global unico | Los rangos de PayPal cambian y una allowlist mal mantenida bloquea cobros; un limite global bloquea reintentos legitimos. | Sin dependencias nuevas. |
| **D-H7-2: 300/min, 20 fallos/10 min, 256 KiB** | Limites mas bajos o sin tope de cuerpo | Valores altos para el volumen del negocio; el tope de cuerpo evita parseos gigantes. Ajustables en codigo sin envs. | Sin costo. |
| **D-H7-3: 429/413 genericos, sin persistir bloqueos** | 401 para todo; 200 para descartar | 401 oculta la causa; 200 hace que PayPal no reintente y se pierda el evento. | Sin costo. |
| **D-H7-4: limitador en memoria con mapa acotado** | Redis/DB; WAF | Evita infra y esquema; es best-effort y consistente con el resto del proyecto. | Sin costo; se documenta la limitacion multi-instancia. |
| **D-H8-1: `Location` relativo si no hay base** | 503; hardcodear `pixelarch.dev`; `X-Forwarded-Host` | Mantiene la UX, funciona en staging y produccion, y no confia en un host del usuario. | Sin costo. |
| **D-H8-2: fallo cerrado para `return_url`/`cancel_url`** | Relativo; origin interno | PayPal exige URL absoluta; el origin interno es inaccesible. | Sin costo. |
| **D-H8-3: mantener `resolverBaseUrlPublica`** | Validar la env al startup | Cambiar la validacion global afecta a otros consumidores y al build; el contrato actual ya es correcto. | Sin costo. |
| **D-H9-1: `.railway/`** | `.railway/*`; archivo por archivo | Cubre subdirectorios y es una sola linea. | Sin costo. |
| **D-H6-1: no tocar codigo/panel hasta tener evidencia** | Rotar el secreto a ciegas; desactivar la firma; ignorar | Rotar o desactivar puede romper produccion o abrir el webhook; ignorar deja el problema sin trazabilidad. | Sin costo. |

No se agregan librerias. `node:crypto`, `Buffer`, `URL`, `URLSearchParams` y las APIs de Next/React ya estan en el proyecto. No hay licencias nuevas que revisar.

## 4. Modelo de datos y contratos

### 4.1 Esquema

**No hay cambios en `prisma/schema.prisma`.** No hay `db push`, migracion ni backfill por esta spec.

Se leen campos existentes:

- `EnlacePago`: `token`, `pasarela`, `concepto`, `total`, `moneda`, `estado`, `expiraEn`, `hitoId`, `suscripcionId`, relaciones `hito(estado)`, `suscripcion(estado, plan)` y `pagos(estadoPago)`.
- `Pago`: `estadoPago` (solo la existencia de `REVISION`).
- H-7 no lee ni escribe tablas nuevas; sigue usando `EventoPasarela` a traves de `registrarFirmaInvalida` y `procesarEventoPaypal`.
- H-8 y H-9 no tocan datos.

No se seleccionan `cliente`, `notaInterna`, `revisionNota`, `revisionEstado`, `registradoPor`, `evidencia`, `mpLink`, `checkoutUrl`, `externalId` ni ids internos adicionales en la pagina publica. Se conservan `hitoId` y `suscripcionId` porque el dominio los necesita para evaluar el concepto; no se renderizan. El unico campo nuevo es `pagos.estadoPago`, filtrado a `REVISION`.

### 4.2 Contrato de la pagina H-5

```ts
interface EnlacePublico {
  pasarela: string
  concepto: string
  total: number
  moneda: string
  estado: EstadoEnlace
  expiraEn: Date
  hitoId: string | null
  suscripcionId: string | null
  hito: { estado: string } | null
  suscripcion: { estado: string; plan: string } | null
  pagos: { estadoPago: string }[]   // solo REVISION, take 1
}
```

`select` exacto:

```ts
{
  pasarela: true,
  concepto: true,
  total: true,
  moneda: true,
  estado: true,
  expiraEn: true,
  hitoId: true,
  suscripcionId: true,
  hito: { select: { estado: true } },
  suscripcion: { select: { estado: true, plan: true } },
  pagos: {
    where: { estadoPago: "REVISION" },
    select: { estadoPago: true },
    take: 1,
  },
}
```

No se usa `pagos[0].estadoPago` en el render; solo `pagos.length > 0`. El test exacto del `select` debe actualizarse.

### 4.3 Contrato del webhook H-7

```ts
// src/lib/paypal/webhook-limit.ts
export const WEBHOOK_SOLICITUDES_MAX = 300
export const WEBHOOK_SOLICITUDES_VENTANA_MS = 60_000
export const WEBHOOK_FALLOS_MAX = 20
export const WEBHOOK_FALLOS_VENTANA_MS = 10 * 60_000
export const WEBHOOK_CUERPO_MAX_BYTES = 256 * 1024
export const WEBHOOK_MAX_CLAVES = 10_000

export type ResultadoLimiteWebhook =
  | { permitido: true }
  | {
      permitido: false
      motivo: "SOLICITUDES" | "FALLOS"
      retryAfterSegundos: number
    }

export interface LimitadorWebhook {
  permitir(clave: string): ResultadoLimiteWebhook
  registrarFallo(clave: string): void
  registrarExito(clave: string): void
}

export function crearLimitadorWebhook(opciones?: {
  ahora?: () => number
  solicitudesMax?: number
  solicitudesVentanaMs?: number
  fallosMax?: number
  fallosVentanaMs?: number
  maxClaves?: number
}): LimitadorWebhook

export const limitadorWebhookPaypal: LimitadorWebhook
export function reiniciarLimitadorWebhookPaypal(): void
export function cuerpoExcedeLimite(
  contentLength: string | null,
  cuerpo: string | null
): boolean
```

Contrato HTTP del webhook (sin cambios en los casos existentes, salvo los nuevos rechazos):

| Caso | Status | Body | Headers |
|------|--------|------|---------|
| No configurado | 503 | `{ error: "Webhook no configurado" }` | `no-store` |
| Limite | 429 | `{ error: "Demasiadas solicitudes" }` | `no-store`, `Retry-After` |
| Cuerpo excesivo | 413 | `{ error: "Solicitud demasiado grande" }` | `no-store` |
| Firma/headers/body invalido | 401 | `{ error: "Firma invalida" }` | `no-store` |
| Verificacion no disponible | 503 | `{ error: "Verificacion no disponible" }` | `no-store` |
| Procesado/duplicado/ignorado | 200 | `{ ok: true, ... }` | `no-store` |
| Error de procesamiento | 500 | `{ error: "Error procesando el webhook" }` | `no-store` |

`ipDe(req)` se mantiene local a la ruta (misma logica que las rutas publicas): `x-forwarded-for` primera, `x-real-ip`, o `"desconocida"`. No se agrega un modulo compartido para no ampliar el alcance; la duplicacion es de seis lineas y ya existe en tres rutas.

### 4.4 Contrato de H-8

```ts
export interface LocationEstadoPublico {
  location: string
  absoluta: boolean
}

export function construirLocationEstado(
  configurada: string | null | undefined,
  requestUrl: string,
  token: string,
  estado: string
): LocationEstadoPublico
```

- Base valida: `https://host/pago/paypal/estado?token=...&estado=...` (absoluta; se construye con `new URL("/pago/paypal/estado", base)`, la misma semantica que hoy).
- Sin base: `/pago/paypal/estado?token=...&estado=...` (relativa).
- El `token` se codifica; no se acepta host del usuario.
- No se loguea el valor de `configurada`.

### 4.5 Contrato de H-9

```gitignore
# railway (estado local de la CLI)
.railway/
```

Sin contrato de API.

### 4.6 Contrato de H-6

El expediente `specs/003-hardening-paypal/h6-mp-firmas.md` debe tener las secciones de §2.5. No es codigo; no se valida en la suite.

## 5. Seguridad y privacidad (cumplimiento de la constitucion)

- **§1 Privacidad:** H-5 solo muestra el estado, el concepto y el monto que ya muestra hoy; no agrega PII ni datos del CRM. H-7 no loguea payload, PII, firma, certificado, secreto ni IP completa. H-6 se redacta y no incluye PII del pagador. H-8 no loguea el valor invalido de la env. H-9 no agrega datos.
- **§2 Pagos:** no se mueve dinero, no se cambian montos, comisiones, estados ni idempotencia. H-7 solo agrega rechazos previos; los eventos verificados siguen el mismo camino. H-6 no toca el webhook MP. No se almacenan datos de tarjeta.
- **§3 Calidad:** TypeScript estricto; tests por AC funcional; suite/typecheck/lint/build limpios. H-6 se verifica con checklist documental por ser investigacion sin codigo (excepcion justificada de RNF-5).
- **§4 UX:** H-5 usa texto, no solo color; mantiene `role="status"`, `no-store`, `no-referrer` y `noindex`; la copia es clara y en espanol. H-8 evita un host interno inaccesible.
- **§5 Operaciones:** no se agregan rutas publicas ni se toca el middleware. No hay envs nuevas ni cambios de Dockerfile. No hay merge/deploy a produccion antes de T-38. H-9 es docs-only.
- **§6 Dependencias:** no se agregan librerias; se usan APIs built-in y las ya instaladas. No hay licencias nuevas.
- **§7 SDD:** la spec es la fuente de verdad; este plan y `tasks.md` referencian cada AC. H-6 no implementa nada hasta tener evidencia.

### 5.1 Limites de seguridad asumidos

- El limitador de H-7 es **best-effort y en memoria**: no es un WAF, no es distribuido, se reinicia con el proceso y no impide un ataque coordinado desde muchas IPs. Su objetivo es acotar el abuso trivial y el ruido de un solo origen, no garantizar disponibilidad absoluta.
- La IP se toma de headers de proxy (`x-forwarded-for`/`x-real-ip`). En Railway el proxy los maneja; no se confia en ellos para autenticar, solo para limitar. Un atacante que pueda falsificar el header puede rotar la clave; el limite es por clave y no reemplaza un WAF. El tope de cuerpo y la verificacion de firma siguen acotando el trabajo por request.
- La redireccion relativa de H-8 no es un open redirect: la ruta es fija y el token se codifica. No se usa ningun host provisto por el usuario.
- H-6 no cambia la validacion de firma de MP; si la causa es un secreto mal configurado, la accion es del dueno en el panel, no un cambio de codigo.

## 6. Estrategia de pruebas (mapa AC -> tipo de test)

### 6.1 Archivos

| Archivo | Tipo | Proposito |
|---------|------|-----------|
| `src/__tests__/lib/paypal-utils.test.ts` | unitaria pura (extender) | `resolverEstadoPublicoEnlace` (H-5) y `construirLocationEstado` (H-8); regresion de `resolverBaseUrlPublica`. |
| `src/__tests__/api/paypal-public.test.ts` | rutas + pagina con Prisma/PayPal mockeados (extender) | H-5: link `PAGADO` + `REVISION`, retorno, `?estado=pagado`, `?estado=error`, sin PII, select exacto. H-8: `[token]`, retorno y cancelado con env invalida, `Location` relativo. |
| `src/__tests__/api/admin/paypal-link.test.ts` | ruta admin (extender) | H-8: env invalida -> 400, sin crear enlace/orden. |
| `src/__tests__/lib/paypal-webhook-limit.test.ts` | unitaria pura (nuevo) | H-7: ventanas, limites, fallos, exito, reset, cuerpo, memoria. |
| `src/__tests__/api/webhooks/paypal.test.ts` | ruta con mocks (extender) | H-7: 429, 413, 401 acotado, 503 no cuenta, 200/500 verificados. |
| `src/__tests__/api/webhooks/paypal-resiliencia.test.ts` | ruta (revisar/extender) | H-7: timeouts, errores y reintentos. |
| `src/__tests__/api/mercadopago-coexistencia.test.ts` / `mercadopago.test.ts` | regresion | H-6/H-7: el webhook MP no cambia. |
| `git check-ignore` / `git status` | verificacion de repo | H-9: `.railway/` ignorado y sin archivos versionados. No se agrega un test de repo; el comando es la evidencia. |
| `specs/003-hardening-paypal/h6-mp-firmas.md` | checklist documental | H-6: muestras, matriz, hipotesis, decision. |

### 6.2 Mapa AC -> test

| AC | Tipo | Caso / archivo |
|----|------|----------------|
| AC-H5-1 | unitaria pura + pagina | `paypal-utils.test.ts` (`PAGADO` + `pagoEnRevision` -> `revision`); `paypal-public.test.ts` ("Pago en revision", sin "Pago acreditado", sin PII/REVISION). |
| AC-H5-2 | pagina | `PAGADO` + `SUCCEEDED` -> "Pago acreditado". |
| AC-H5-3 | pagina | `PAGADO` sin `pagos` -> "Pago acreditado". |
| AC-H5-4 | ruta + pagina | retorno `REVISION` -> `Location` con `estado=pendiente`; render de la pagina -> "Pago en revision". |
| AC-H5-5 | pagina | `?estado=pagado` + `REVISION` -> revision; `?estado=error` -> error. |
| AC-H5-6 | pagina | `findUnique` una vez; `select` exacto con `pagos` filtrado; sin cliente/notas/revision ni ids adicionales. |
| AC-H5-7 | pagina | sin `pagos` en `REVISION` -> estado resultante; `noStore`/dynamic. |
| AC-H5-8 | pagina | pendiente/vencido/invalidado/error; metadata `no-referrer`; regresion. |
| AC-H7-1 | pura + ruta | 300 permitidas, 301 -> 429, `Retry-After`, sin verify/evento. |
| AC-H7-2 | pura + ruta | 20 fallos, 21 -> 429 sin verify; reinicio de ventana -> 401/verify. |
| AC-H7-3 | ruta | IP A bloqueada, IP B valida -> 200. |
| AC-H7-4 | ruta | firma invalida dentro del presupuesto -> 401 + evento. |
| AC-H7-5 | ruta | timeout de verificacion -> 503; no consume fallo; luego valido -> 200. |
| AC-H7-6 | pura + ruta | `Content-Length`/body > 256 KiB -> 413, sin verify/evento. |
| AC-H7-7 | ruta | sin headers -> 401 `HEADERS_INCOMPLETOS`, sin verify. |
| AC-H7-8 | ruta | procesado/duplicado/ignorado 200; error 500; idempotencia. |
| AC-H7-9 | ruta + logs | sin PII/firma/secreto/IP en logs; 429 generico. |
| AC-H7-10 | regresion | tests MP verdes; ruta MP intacta. |
| AC-H8-1 | pura | env invalida -> `null`; no origin de la request. |
| AC-H8-2 | ruta | `[token]` env invalida -> `Location` relativo, sin `0.0.0.0`. |
| AC-H8-3 | ruta | `[token]` env invalida + link cobrable -> `createOrder` no llamado; error. |
| AC-H8-4 | ruta | retorno env invalida -> captura procesada; `Location` relativo. |
| AC-H8-5 | ruta | cancelado env invalida -> evento; `Location` relativo. |
| AC-H8-6 | ruta admin | env invalida -> 400; sin `createLink`. |
| AC-H8-7 | pura + rutas | env valida -> absoluta normalizada; regresion. |
| AC-H8-8 | pura + rutas | sin env + origin publico -> absoluta; sin env + interno -> relativa. |
| AC-H8-9 | pura + rutas | ruta fija, token codificado, sin host del usuario; sin log del valor invalido. |
| AC-H9-1 | repo | `.gitignore` contiene `.railway/`. |
| AC-H9-2 | repo | `git check-ignore` y `git status`. |
| AC-H9-3 | repo | `git ls-files .railway` vacio (o `git rm --cached` en la tarea). |
| AC-H9-4 | diff | solo `.gitignore` y docs; sin `src/**`, `Dockerfile`, `package.json`, `railway.toml`. |
| AC-H6-1 | checklist | 3-5 muestras redactadas por warning. |
| AC-H6-2 | checklist | matriz de entornos y aislamiento produccion/staging. |
| AC-H6-3 | checklist | hipotesis confirmadas/rechazadas/insuficientes. |
| AC-H6-4 | checklist | decision y spec nueva si corresponde. |
| AC-H6-5 | checklist | revision de redaccion (sin PII/secretos). |
| AC-H6-6 | checklist | datos faltantes y H-6 abierto. |

### 6.3 Regresion

- `paypal-public.test.ts`, `paypal.test.ts`, `paypal-resiliencia.test.ts`, `paypal-idempotencia.test.ts`, `paypal-process*.test.ts`, `paypal-links*.test.ts`, `paypal-receipts.test.ts`, `recibo-paypal*.test.*`, `recibo-mp-page.test.tsx`, `mercadopago*.test.ts` deben seguir pasando.
- Los tests de H-7 no deben hacer llamadas reales a PayPal; `verifyWebhookSignature` ya esta mockeado en `paypal.test.ts`.
- Los tests de H-5 deben actualizar el fixture `enlace()` para incluir `pagos: []` y el test exacto del `select`; los casos existentes de `PAGADO` sin `pagos` deben seguir mostrando "Pago acreditado".
- Los tests de H-8 deben usar `Location` relativo. El helper `redirect()` actual hace `new URL(location)` y fallaria con un valor relativo; hay que actualizarlo a `new URL(location, "https://pixelarch.dev")` (o equivalente). Con un `Location` absoluto el resultado no cambia.
- La suite existente no debe quedar contaminada por el limitador: usar `reiniciarLimitadorWebhookPaypal()` en `beforeEach` o IPs unicas.

## 7. Impacto en despliegue, datos y migraciones

### 7.1 Datos y esquema

- **Sin migracion, sin `db push`, sin backfill.** No se escribe en la base por H-5, H-8 ni H-9.
- H-7 sigue escribiendo `EventoPasarela` como hoy para intentos no verificados dentro del presupuesto; no agrega columnas.
- H-5 solo lee `EnlacePago.pagos` y `Pago.estadoPago`; esos campos ya existen en staging.
- No se reescriben pagos, links, hitos ni soportes.

### 7.2 Orden con T-38

1. Implementar y probar H-5, H-7, H-8 y H-9 en `paypal-staging`.
2. Investigar H-6 con datos del dueno; no implementar nada.
3. **No mergear a `main` ni deployar a produccion antes de T-38.** T-38 sigue el orden ya definido: `db push` + backfill en produccion **antes** del merge/auto-deploy, FF-merge de `paypal-staging` para conservar `139b8cb`, deploy con PayPal deshabilitado, envs/webhook live y smoke.
4. H-5 viaja con el mismo deploy que T-38 porque depende del esquema. H-7, H-8 y H-9 no agregan pasos de migracion, pero comparten la rama y el gate.
5. Smoke post-T-38: health, `/pago/paypal/estado` con un pago en `REVISION`, webhook PayPal con firma invalida (401 y luego 429 si se prueba el limite), redirect con env valida, `/admin/pagos`, recibo MP/PayPal.

### 7.3 Rollback

- **H-5:** revertir el commit de la pagina/helper; la pagina vuelve a mostrar "Pago acreditado" en `REVISION` (comportamiento anterior). No hay datos que revertir.
- **H-7:** revertir el commit del limitador y la ruta; el webhook vuelve a aceptar todo como antes. No hay datos que revertir.
- **H-8:** revertir el commit de `construirLocationEstado` y las rutas; vuelve el fallback a `req.url`. No hay datos que revertir.
- **H-9:** revertir `.gitignore`; no hay runtime.
- **H-6:** no hay nada que revertir; el expediente queda como evidencia.
- No hay flag/env que apagar. Si se necesitara un apagado parcial de H-7 sin revertir, se pueden subir los umbrales en codigo, pero no se propone.

### 7.4 Build y operacion

- H-5, H-7 y H-8 tocan `src/**` y disparan build por `railway.toml` watchPatterns.
- H-9 toca solo `.gitignore` y docs: no dispara build.
- Sin cambios de `Dockerfile`, `package.json`, `NEXT_PUBLIC_*`, envs ni `railway.toml`.
- Verificacion: `node node_modules\vitest\vitest.mjs run`, `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint` (sin errores nuevos sobre la deuda preexistente), `node node_modules\next\dist\bin\next build`.
- Sentry: H-7 no captura 429/413 como excepciones; H-5 no agrega logs; H-8 no loguea el valor invalido. Los errores de render los captura el framework como cualquier pagina publica.

## 8. Riesgos

| ID | Riesgo | Impacto | Mitigacion |
|----|--------|---------|------------|
| R-1 | H-5 lee `EnlacePago.pagos`, que no existe en produccion hasta T-38. | Alto si se deploya antes | No merge/deploy a produccion antes de T-38; staging ya tiene el esquema. |
| R-2 | Un pago `REVISION` historico o multiple bloquea "Pago acreditado" incluso si otro pago del link esta confirmado; si un `Pago` en `REVISION` no tuviera `enlacePagoId`, la pagina no lo detecta. | Bajo/Medio | La regla es conservadora: mientras exista una revision, no se afirma acreditado; al resolverla, la proxima apertura refleja el estado. El flujo actual (`registrarPagoEnRevision`) siempre setea `enlacePagoId`; no hay datos PayPal en produccion. Tests con uno y varios pagos. |
| R-3 | La consulta de la pagina falla por DB. | Medio | `huboError` -> `error`, nunca `pagado`; test de fallo. |
| R-4 | El limite de H-7 bloquea un reintento legitimo de PayPal desde la misma IP. | Medio | Ventana corta (10 min), `429` reintentable, exito limpia fallos, umbrales altos; monitorear `Webhook PayPal limitado`. |
| R-5 | El limitador en memoria se reinicia con el deploy o no es compartido entre instancias. | Bajo | Best-effort documentado; no es una barrera de seguridad. Si el volumen crece, evaluar persistencia en otra spec. |
| R-6 | `413` es un status nuevo para PayPal. | Bajo | PayPal reintenta; el cuerpo real es mucho menor a 256 KiB; test con payload realista. |
| R-7 | `Location` relativo no es aceptado por algun cliente. | Bajo | Navegadores lo aceptan; tests de las tres rutas; se documenta. Si un cliente no lo acepta, se puede volver a absoluto solo con base valida. |
| R-8 | H-6 queda inconcluso por falta de datos del dueno. | Medio | El expediente lista exactamente que falta; no se inventa causa ni se toca el panel. |
| R-9 | Otros consumidores de `NEXT_PUBLIC_URL` (`sitemap`, `robots`, `rss`, `cron`, `mercadopago.ts`, `entregar`) usan `env || default` y no se corrigen. | Bajo | Fuera de alcance de H-8; se documenta. Si el dueno quiere, se abre otra spec. |
| R-10 | El test exacto del `select` de la pagina falla al agregar `pagos`. | Bajo | Actualizar el test en la misma tarea; es un cambio intencional. |
| R-11 | Un `?estado=pagado` manual podria ascender el estado si se implementa mal. | Medio | La regla es DB-first; el query solo conserva `error`; tests negativos. |
| R-12 | El presupuesto de fallos cuenta headers/body invalidos y podria penalizar a un emisor mal configurado. | Bajo | `429` temporal; el exito limpia; umbral 20/10 min; logging para diagnostico. |
| R-13 | Tests de H-7 contaminados por el singleton del limitador. | Bajo | `reiniciarLimitadorWebhookPaypal()` o IPs unicas por test. |
| R-14 | `.gitignore` oculta configuracion local necesaria para la CLI de Railway. | Bajo | Es el objetivo; el archivo local no se borra y se puede recrear con la CLI. |

## 9. Orden de implementacion

1. **T-01 (H-9):** `.gitignore` + verificacion. Independiente, sin riesgo.
2. **T-02 (H-8):** helper `construirLocationEstado`, rutas publicas y tests. Va antes de H-5 porque comparte `paypal/utils.ts` y `paypal-public.test.ts`.
3. **T-03 (H-5):** helper `resolverEstadoPublicoEnlace`, pagina, consulta y tests. Depende de T-02 por los archivos compartidos.
4. **T-04 (H-7):** limitador, ruta del webhook y tests. Independiente de T-02/T-03; puede ir en paralelo si se coordinan los archivos.
5. **T-05 (H-6):** expediente de investigacion. Puede empezar en paralelo, pero se cierra solo con datos del dueno.
6. **T-06 (docs):** `AGENTS.md`, `MEMORY.md` y trazabilidad. Depende de T-01..T-05.
7. **T-07 (verificacion final):** suite, typecheck, lint y build. Depende de T-01..T-06.
8. **T-08 (staging):** smoke en `paypal-staging` sin produccion. Depende de T-07.
9. **T-09 (gate T-38):** sin codigo, no autorizado. Depende de T-08 y de la autorizacion del dueno.

T-02 y T-03 comparten `src/lib/paypal/utils.ts` y `src/__tests__/api/paypal-public.test.ts`; hacerlos secuenciales evita conflictos. T-04 toca solo el webhook y su modulo, por lo que puede ir en paralelo con T-02/T-03.
