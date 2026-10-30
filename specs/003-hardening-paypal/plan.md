# Plan 003: Hardening posterior a T-37/002 (H-5, H-6, H-7, H-8, H-9)

**Spec:** ./spec.md
**Estado:** implementacion cerrada en staging (2026-10-30) — H-5, H-6, H-7, H-8 y H-9 implementadas y **PASS tester+reviewer**; **T-38 pendiente y NO autorizado**; produccion sin cambios.
**Fecha:** 2026-10-30 (original 2026-10-29)
**Rama:** `paypal-staging`
**Gate:** no merge a `main` ni deploy a produccion antes de T-38. T-38 no esta autorizado.
**Dependencia:** el esquema PayPal (incluida la relacion `EnlacePago.pagos` y `Pago.estadoPago`) ya existe en staging; produccion no lo tiene. H-5 viaja con T-38. H-6, H-7, H-8 y H-9 no agregan esquema.

## 1. Resumen tecnico

Cinco frentes independientes, sin cambios de esquema, envs, `Dockerfile`, `package.json` ni `railway.toml`:

1. **H-5 (estado publico):** extraer el mapeo de estado publico a `src/lib/paypal/utils.ts`, incluir en la consulta de `/pago/paypal/estado` la existencia de un `Pago` en `REVISION` y agregar el estado publico `revision` con copia propia. El retorno ya informa `pendiente`; se cubre con tests.
2. **H-7 (webhook PayPal):** nuevo modulo `src/lib/paypal/webhook-limit.ts` con limite de solicitudes y presupuesto de fallos por origen, mas un tope de cuerpo. La ruta `/api/webhooks/paypal` aplica rechazos baratos antes de verificar y conserva intacta la semantica de los eventos verificados.
3. **H-8 (base publica):** mantener `resolverBaseUrlPublica` como esta (ya falla cerrado) y agregar `construirLocationEstado` para devolver un `Location` absoluto o relativo. Las tres rutas publicas dejan de hacer `?? req.url`; la creacion de ordenes sigue fallando cerrado si no hay base absoluta.
4. **H-9 (higiene):** agregar `.railway/` a `.gitignore`; sin codigo.
5. **H-6 (firmas MP + hardening):** dos entregables. (a) `specs/003-hardening-paypal/h6-mp-firmas.md` con la evidencia redactada (URL/endpoint de staging, secreto confirmado sin valor, warnings 08:35/08:51 sin pago, eventos validos de Coexistencia A/B) y la decision. (b) Hardening del webhook MP en `src/app/api/webhooks/mercadopago/route.ts` reutilizando el limitador de `src/lib/rate-limit.ts`: 300 solicitudes/min y 20 firmas invalidas/10 min por origen, descarte de `body.type !== "payment"`/sin `data.id` antes de la firma y log de firma invalida en `debug`. Sin rotar el secreto, sin tocar el panel y sin desactivar la firma.

No hay cambios de comportamiento en montos, comisiones, checkout, links, emails, idempotencia ni procesamiento de capturas.

**Estado de implementacion (2026-10-30):** los cinco frentes estan implementados y con PASS tester+reviewer. H-6 incluye el expediente `h6-mp-firmas.md` y el hardening del webhook MP. Verificacion T-07/T-08: suite 1644/1644 tests en 85 archivos, `tsc --noEmit` 0 errores, lint 18/18 (baseline preexistente) y `next build` PASS. El smoke manual de staging (T-09) sigue pendiente; T-38 no esta autorizado.

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

### 2.5 H-6 — Evidencia de firmas MP y hardening del webhook MP

#### 2.5.1 Entregable documental

`specs/003-hardening-paypal/h6-mp-firmas.md` con esta estructura:

1. **Alcance y metodo:** que se investigo, que no, y que fuentes se usaron.
2. **Entorno staging:** URL publica `https://staging.pixelarch.dev`, endpoint `https://staging.pixelarch.dev/api/webhooks/mercadopago`, evento habilitado `Pagos`; secreto presente y coincidente con el panel (confirmado por el dueno, sin valor).
3. **Warnings 08:35 / 08:51:** `Webhook MP con firma invalida` sin pago asociado. Evidencia: no se creo `Pago`, no cambio el hito/soporte y los eventos validos de Coexistencia A/B se procesaron. Son POSTs invalidos/ruido, no fallos de cobro.
4. **Eventos validos Coexistencia A/B (paso 11 de T-37):** A (MP gana, link PayPal `INVALIDADO`) y B (PayPal gana, intento MP descartado, un solo `Pago`). Prueban que la URL y el secreto funcionan de punta a punta.
5. **Matriz de entornos:** staging y produccion; cuenta/aplicacion, URL de webhook, eventos, secreto (presencia, sin valor); produccion no se reconfigura en esta spec.
6. **Verificacion de firma:** version del SDK `mercadopago` (3.6.1), manifest `id:<dataId>;request-id:<xRequestId>;ts:<ts>;`, `toleranceSeconds` no habilitado (sin ventana de reloj), origen del `data.id` (query o body) y headers de MP.
7. **Hipotesis:** secreto distinto (rechazada), notificacion de otra cuenta/aplicacion (no determinada), notificacion de prueba (no determinada), IPN legacy/vacia (parcial), diferencia SDK/algoritmo (rechazada por A/B), reloj fuera de ventana (rechazada: la ruta no pasa `toleranceSeconds`), `data.id` distinto entre query y body (no determinada) y notificacion no firmada por diseno tipo QR/legacy (parcial).
8. **Conclusion y decision:** hardening sin rotar secreto ni tocar el panel; datos faltantes (fecha/zona exacta y origen de los POSTs).
9. **Anexo:** consultas y comandos usados, sin secretos ni PII.

Reglas:

- El agente no cambia `MP_WEBHOOK_SECRET`, no desactiva la validacion y no toca el panel de Mercado Pago.
- El valor del secreto no se transcribe en el expediente, la spec, el plan ni las tareas.
- Toda muestra se redacta: sin nombre, email, telefono, direccion, tarjeta, CBU/CVU, firma completa ni credencial.

#### 2.5.2 Hardening del webhook MP (codigo)

Archivo: `src/app/api/webhooks/mercadopago/route.ts`. Reutiliza `rateLimitDetalle`, `rateLimitEstado` y `resetRateLimit` de `src/lib/rate-limit.ts`; no agrega modulo, env ni dependencia.

```
POST /api/webhooks/mercadopago
  1. ipDe(req)
  2. rateLimitDetalle(`webhook-mp:ip:${ip}`, 300, 60_000)
       -> 429 { error: "Demasiadas solicitudes" } + Retry-After + no-store
          (sin parsear, sin firma, sin consultar MP, sin escribir)
  3. JSON.parse del body; invalido -> 400 (comportamiento actual)
  4. dataId = query data.id || body.data.id
  5. if (body.type !== "payment" || !dataId) -> 200 { ok: true, ignored: true }
       (topics plan/merchant order e IPN vacia; antes de la firma)
  6. sin MP_WEBHOOK_SECRET -> 503 en produccion / aviso en desarrollo (actual)
  7. rateLimitEstado(`webhook-mp:firma:${ip}`, 20, 10 min)
       -> excedido: 429 sin validar la siguiente firma
  8. WebhookSignatureValidator.validate(...)
       -> InvalidWebhookSignatureError: rateLimit(...) + logger.debug
          + 401 { error: "Firma invalida" } (sin data.id, firma, IP ni PII)
  9. firma valida: resetRateLimit(`webhook-mp:firma:${ip}`)
 10. procesamiento actual sin cambios (obtenerPagoMp, idempotencia, hito/soporte)
```

Reglas:

- El limite de solicitudes corre **antes** de parsear: un topic ajeno tambien cuenta para el limite, pero no consume el presupuesto de firmas.
- El presupuesto de firmas solo cuenta fallos de autenticidad; una firma valida lo limpia y `resetRateLimit` no toca el contador de solicitudes.
- `body.type` y `data.id` se leen del body ya parseado; no se agrega tope de cuerpo (fuera de alcance). El limite de solicitudes acota el abuso trivial.
- El `429` no escribe `EventoPasarela`; el `401` por firma invalida mantiene el comportamiento actual (sin evento de negocio).
- No se persiste ni loguea la IP; el log de firma invalida es un mensaje fijo en `debug`.
- `MP_WEBHOOK_SECRET` no se toca; si falta en produccion se mantiene el `503`.

##### Tabla de respuestas MP

| Caso | Status | Verifica firma | Consulta MP | Escribe |
|------|--------|----------------|-------------|---------|
| Topic ajeno o sin `data.id` | 200 `{ ok: true, ignored: true }` | no | no | no |
| Limite de solicitudes | 429 `{ error: "Demasiadas solicitudes" }` + `Retry-After` | no | no | no |
| Presupuesto de firmas agotado | 429 `{ error: "Demasiadas solicitudes" }` + `Retry-After` | no | no | no |
| JSON invalido | 400 `{ error: "JSON invalido" }` | no | no | no |
| Sin secreto en produccion | 503 `{ error: "Webhook no configurado" }` | no | no | no |
| Firma invalida dentro del presupuesto | 401 `{ error: "Firma invalida" }` | si (falla) | no | no |
| Pago valido | 200 `{ ok: true }` | si | si | si (hito/soporte/pago) |


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
| **D-H6-1: la firma de MP se mantiene activa; no se rota el secreto ni se toca el panel** | Rotar el secreto a ciegas; desactivar la firma; ignorar los warnings | Los eventos validos A/B prueban que URL y secreto funcionan; rotar o desactivar puede romper produccion o abrir el webhook. El problema se trata como ruido/abuso. | Sin costo. |
| **D-H6-2: reutilizar `src/lib/rate-limit.ts` (300/min y 20 firmas/10 min por origen)** | Limitador nuevo; Redis/WAF; sin limite | El limitador existente ya tiene ventana, `Retry-After`, estado sin incremento y reset; evita duplicar logica y agrega cero dependencias. | Sin costo; best-effort en memoria (la IP se usa solo como clave, no se persiste). |
| **D-H6-3: descartar topics ajenos y cuerpos sin `data.id` antes de la firma** | Validar la firma primero; `401` para topics ajenos | Un topic que no es pago no tiene nada que cobrar; validarlo gasta trabajo y warnings. Responder `401` haria que MP reintente ruido. | Sin costo. |
| **D-H6-4: log de firma invalida en `debug`, sin `data.id`/firma/IP/PII** | `warn`/`info`; loguear `data.id` | `debug` no inunda produccion y mantiene la trazabilidad; `data.id` es un identificador de pago y no debe ir a logs. | Sin costo. |

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

**Evidencia:** `specs/003-hardening-paypal/h6-mp-firmas.md` con las secciones de §2.5.1. No es codigo; se verifica con checklist.

**Hardening:** no cambia contratos publicos de MP. Solo agrega rechazos tempranos y un log:

```ts
// src/app/api/webhooks/mercadopago/route.ts (constantes locales, sin envs)
const WEBHOOK_SOLICITUDES_MAX = 300
const WEBHOOK_SOLICITUDES_VENTANA_MS = 60_000
const WEBHOOK_FIRMAS_MAX = 20
const WEBHOOK_FIRMAS_VENTANA_MS = 10 * 60_000

// tipos esperados del body (sin cambios en el procesamiento)
type BodyMp = { type?: string; action?: string; data?: { id?: string } }
```

Contrato HTTP: tabla de §2.5.2. El camino de un `payment` valido no cambia: `obtenerPagoMp`, idempotencia por `Pago.externalId`, hito/soporte, montos, meses, links y emails quedan iguales.

## 5. Seguridad y privacidad (cumplimiento de la constitucion)

- **§1 Privacidad:** H-5 solo muestra el estado, el concepto y el monto que ya muestra hoy; no agrega PII ni datos del CRM. H-7 no loguea payload, PII, firma, certificado, secreto ni IP completa. H-6 se redacta, no incluye PII del pagador y su log de firma invalida no lleva `data.id`, firma ni IP. H-8 no loguea el valor invalido de la env. H-9 no agrega datos.
- **§2 Pagos:** no se mueve dinero, no se cambian montos, comisiones, estados ni idempotencia. H-7 solo agrega rechazos previos; los eventos verificados siguen el mismo camino. H-6 solo agrega rechazos tempranos al webhook MP; la firma sigue siendo obligatoria para todo `payment` y un pago valido sigue el mismo camino. No se rota el secreto ni se toca el panel. No se almacenan datos de tarjeta.
- **§3 Calidad:** TypeScript estricto; tests por AC funcional; suite/typecheck/lint/build limpios. H-6 tiene tests de ruta para el hardening y checklist documental para la evidencia.
- **§4 UX:** H-5 usa texto, no solo color; mantiene `role="status"`, `no-store`, `no-referrer` y `noindex`; la copia es clara y en espanol. H-8 evita un host interno inaccesible.
- **§5 Operaciones:** no se agregan rutas publicas ni se toca el middleware. No hay envs nuevas ni cambios de Dockerfile. No hay merge/deploy a produccion antes de T-38. H-9 es docs-only.
- **§6 Dependencias:** no se agregan librerias; se usan APIs built-in y las ya instaladas. No hay licencias nuevas.
- **§7 SDD:** la spec es la fuente de verdad; este plan y `tasks.md` referencian cada AC. H-6 separa evidencia (checklist) de hardening (tests) y no rota el secreto ni toca el panel.

### 5.1 Limites de seguridad asumidos

- El limitador de H-7 es **best-effort y en memoria**: no es un WAF, no es distribuido, se reinicia con el proceso y no impide un ataque coordinado desde muchas IPs. Su objetivo es acotar el abuso trivial y el ruido de un solo origen, no garantizar disponibilidad absoluta.
- La IP se toma de headers de proxy (`x-forwarded-for`/`x-real-ip`). En Railway el proxy los maneja; no se confia en ellos para autenticar, solo para limitar. Un atacante que pueda falsificar el header puede rotar la clave; el limite es por clave y no reemplaza un WAF. El tope de cuerpo y la verificacion de firma siguen acotando el trabajo por request.
- La redireccion relativa de H-8 no es un open redirect: la ruta es fija y el token se codifica. No se usa ningun host provisto por el usuario.
- H-6 no cambia la validacion de firma de MP ni rota el secreto: si en el futuro la evidencia mostrara un secreto mal configurado, la accion seria del dueno en el panel, no un cambio de codigo.
- El limite de H-6 es el mismo limitador best-effort en memoria del proyecto: acota el ruido y el abuso trivial de un origen, no es un WAF ni reemplaza la verificacion de firma. Un atacante que rote la IP puede esquivar el limite por clave; el trabajo costoso sigue protegido por la firma y el presupuesto.
- La clave de ambos limitadores sale de headers de proxy (`x-forwarded-for`/`x-real-ip`) y no se usa para autenticar. Un origen que pueda fijar esos headers podria intentar consumir el presupuesto de otra clave; el `429` es temporal (1 o 10 minutos) y no hay allowlist ni WAF en esta spec.

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
| `src/__tests__/lib/rate-limit.test.ts` | unitaria pura | H-6: semantica compartida de `rateLimitDetalle`/`rateLimitEstado`/`resetRateLimit`. |
| `src/__tests__/api/webhooks/mercadopago.test.ts` | ruta MP con mocks (nuevo/extender) | H-6: topic ajeno y sin `data.id` antes de la firma; 429 por solicitudes; 20/21 firmas; 401 en `debug` sin PII; firma valida limpia y procesa. |
| `src/__tests__/api/mercadopago-coexistencia.test.ts` / `mercadopago.test.ts` | regresion | H-6/H-7: un `payment` valido de MP sigue igual (Coexistencia A/B, hito/soporte, links). |
| `git check-ignore` / `git status` | verificacion de repo | H-9: `.railway/` ignorado y sin archivos versionados. No se agrega un test de repo; el comando es la evidencia. |
| `specs/003-hardening-paypal/h6-mp-firmas.md` | checklist documental | H-6: URL/endpoint, secreto confirmado sin valor, warnings 08:35/08:51, eventos A/B, decision y redaccion. |

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
| AC-H7-10 | regresion | tests MP verdes; un pago valido sigue igual y solo se agregan rechazos tempranos de H-6. |
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
| AC-H6-1 | checklist | URL/endpoint staging, secreto confirmado sin valor, warnings 08:35/08:51 sin pago, eventos A/B. |
| AC-H6-2 | checklist | warnings clasificados como ruido/no determinados con evidencia discriminante. |
| AC-H6-3 | checklist | decision de hardening, sin rotar secreto/panel/firma, sin PII ni secretos. |
| AC-H6-4 | ruta MP | topic ajeno o sin `data.id` -> 200 ignorado, sin firma ni consulta ni escritura. |
| AC-H6-5 | ruta MP | limite de solicitudes -> 429 + `Retry-After`, sin firma ni consulta ni escritura. |
| AC-H6-6 | ruta MP + pura | 20 firmas -> 21 recibe 429; otro origen valido -> 200. |
| AC-H6-7 | ruta MP + logs | firma invalida dentro del presupuesto -> 401, log `debug` sin `data.id`/firma/IP/PII. |
| AC-H6-8 | ruta MP | `payment` valido -> 200, un solo `Pago`, idempotencia y reset del presupuesto. |
| AC-H6-9 | regresion | Coexistencia A/B, links, montos, meses y recibo MP verdes; sin red real. |

### 6.3 Regresion

- `paypal-public.test.ts`, `paypal.test.ts`, `paypal-resiliencia.test.ts`, `paypal-idempotencia.test.ts`, `paypal-process*.test.ts`, `paypal-links*.test.ts`, `paypal-receipts.test.ts`, `recibo-paypal*.test.*`, `recibo-mp-page.test.tsx`, `mercadopago*.test.ts` deben seguir pasando.
- Los tests de H-7 no deben hacer llamadas reales a PayPal; `verifyWebhookSignature` ya esta mockeado en `paypal.test.ts`.
- Los tests de H-5 deben actualizar el fixture `enlace()` para incluir `pagos: []` y el test exacto del `select`; los casos existentes de `PAGADO` sin `pagos` deben seguir mostrando "Pago acreditado".
- Los tests de H-8 deben usar `Location` relativo. El helper `redirect()` actual hace `new URL(location)` y fallaria con un valor relativo; hay que actualizarlo a `new URL(location, "https://pixelarch.dev")` (o equivalente). Con un `Location` absoluto el resultado no cambia.
- Los tests de H-7 y H-6 deben usar IPs unicas o un reset del limitador para no contaminar casos; el de MP usa claves `webhook-mp:*` y el de PayPal `reiniciarLimitadorWebhookPaypal()`. No debe quedar estado compartido entre tests.
- Los tests de H-6 mockean `mercadopago`, `@/lib/mercadopago`, Prisma, `@/lib/rate-limit`, `logger` y Sentry; no tocan la red ni la base. La Coexistencia A/B existente queda como regresion del camino valido.

## 7. Impacto en despliegue, datos y migraciones

### 7.1 Datos y esquema

- **Sin migracion, sin `db push`, sin backfill.** No se escribe en la base por H-5, H-8, H-9 ni por los rechazos de H-6.
- H-7 sigue escribiendo `EventoPasarela` como hoy para intentos no verificados dentro del presupuesto; no agrega columnas.
- H-6 no cambia escrituras: el 429 y el 200 ignorado no escriben; un `payment` valido escribe lo mismo que hoy (un `Pago`, hito/soporte, evento de negocio e idempotencia).
- H-5 solo lee `EnlacePago.pagos` y `Pago.estadoPago`; esos campos ya existen en staging.
- No se reescriben pagos, links, hitos ni soportes.

### 7.2 Orden con T-38

1. **Hecho:** H-5, H-7, H-8 y H-9 implementadas y probadas en `paypal-staging`; PASS tester+reviewer.
2. **Hecho:** H-6 cerrado con el expediente `h6-mp-firmas.md` y el hardening del webhook MP; PASS tester+reviewer. No se roto el secreto ni se toco el panel.
3. **Pendiente y NO autorizado:** no mergear a `main` ni deployar a produccion antes de T-38. T-38 sigue el orden ya definido: `db push` + backfill en produccion **antes** del merge/auto-deploy, FF-merge de `paypal-staging` para conservar `139b8cb`, deploy con PayPal deshabilitado, envs/webhook live y smoke.
4. H-5 viaja con el mismo deploy que T-38 porque depende del esquema. H-6, H-7, H-8 y H-9 no agregan pasos de migracion, pero comparten la rama y el gate. H-6 se deploya con el mismo build que toca `src/**`; no cambia envs ni panel.
5. Smoke post-T-38: health, `/pago/paypal/estado` con un pago en `REVISION`, webhook PayPal con firma invalida (401 y luego 429 si se prueba el limite), redirect con env valida, `/admin/pagos`, recibo MP/PayPal.

### 7.3 Rollback

- **H-5:** revertir el commit de la pagina/helper; la pagina vuelve a mostrar "Pago acreditado" en `REVISION` (comportamiento anterior). No hay datos que revertir.
- **H-7:** revertir el commit del limitador y la ruta; el webhook vuelve a aceptar todo como antes. No hay datos que revertir.
- **H-8:** revertir el commit de `construirLocationEstado` y las rutas; vuelve el fallback a `req.url`. No hay datos que revertir.
- **H-9:** revertir `.gitignore`; no hay runtime.
- **H-6 (hardening):** revertir el commit de `src/app/api/webhooks/mercadopago/route.ts` y su test; el webhook vuelve a validar la firma de cualquier cuerpo parseable y a no tener limite. No hay datos que revertir y la firma no se toca. El expediente queda como evidencia.
- **H-6 (evidencia):** no hay nada que revertir; el expediente queda como evidencia.
- No hay flag/env que apagar. Si se necesitara un apagado parcial de H-7 sin revertir, se pueden subir los umbrales en codigo, pero no se propone. En H-6 lo mismo aplica a `WEBHOOK_SOLICITUDES_MAX`/`WEBHOOK_FIRMAS_MAX`.

### 7.4 Build y operacion

- H-5, H-6, H-7 y H-8 tocan `src/**` y disparan build por `railway.toml` watchPatterns.
- H-9 toca solo `.gitignore` y docs: no dispara build.
- Sin cambios de `Dockerfile`, `package.json`, `NEXT_PUBLIC_*`, envs ni `railway.toml`.
- Verificacion: `node node_modules\vitest\vitest.mjs run`, `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint` (sin errores nuevos sobre la deuda preexistente), `node node_modules\next\dist\bin\next build`.
- Sentry: H-7 y H-6 no capturan 429 como excepciones; H-5 no agrega logs; H-8 no loguea el valor invalido. Los errores de render los captura el framework como cualquier pagina publica. En H-6, un fallo de MP sigue capturando la excepcion como hoy.

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
| R-8 | H-6 no determina el emisor exacto de los POSTs invalidos (fecha/zona u origen). | Bajo | El expediente prueba que no hubo pago y que A/B funcionan, y lista lo que falta; no se inventa causa ni se toca el panel. |
| R-9 | Otros consumidores de `NEXT_PUBLIC_URL` (`sitemap`, `robots`, `rss`, `cron`, `mercadopago.ts`, `entregar`) usan `env || default` y no se corrigen. | Bajo | Fuera de alcance de H-8; se documenta. Si el dueno quiere, se abre otra spec. |
| R-10 | El test exacto del `select` de la pagina falla al agregar `pagos`. | Bajo | Actualizar el test en la misma tarea; es un cambio intencional. |
| R-11 | Un `?estado=pagado` manual podria ascender el estado si se implementa mal. | Medio | La regla es DB-first; el query solo conserva `error`; tests negativos. |
| R-12 | El presupuesto de fallos cuenta headers/body invalidos y podria penalizar a un emisor mal configurado. | Bajo | `429` temporal; el exito limpia; umbral 20/10 min; logging para diagnostico. |
| R-13 | Tests de H-7 contaminados por el singleton del limitador. | Bajo | `reiniciarLimitadorWebhookPaypal()` o IPs unicas por test. |
| R-14 | `.gitignore` oculta configuracion local necesaria para la CLI de Railway. | Bajo | Es el objetivo; el archivo local no se borra y se puede recrear con la CLI. |
| R-15 | El limite de H-6 bloquea un reintento legitimo de Mercado Pago desde el mismo origen. | Medio | `429` temporal, ventana de 10 min, una firma valida limpia el presupuesto y 300 solicitudes/min es holgado para el volumen actual. Monitorear `Webhook MP limitado por firmas invalidas`. |
| R-16 | Descartar `body.type !== "payment"` pierde un pago si MP cambia el topic o lo omite. | Medio | El filtro sigue la semantica actual de MP (`type: "payment"` + `data.id`); el pago valido se confirma consultando `obtenerPagoMp`. Tests de topic ajeno y de pago valido; si MP cambia el contrato, se ajusta en codigo con evidencia. |
| R-17 | El presupuesto de firmas de MP penaliza a un emisor mal configurado. | Bajo | `429` temporal, se limpia con una firma valida y no afecta a otros origenes; el log en `debug` permite diagnostico sin PII. |
| R-18 | Tests de H-6 contaminados por el limitador compartido. | Bajo | Claves `webhook-mp:*` distintas de PayPal, IPs unicas y mocks de `@/lib/rate-limit`; la prueba de 20/21 usa su propio estado. |

## 9. Orden de implementacion

1. **T-01 (H-9):** `.gitignore` + verificacion. Independiente, sin riesgo.
2. **T-02 (H-8):** helper `construirLocationEstado`, rutas publicas y tests. Va antes de H-5 porque comparte `paypal/utils.ts` y `paypal-public.test.ts`.
3. **T-03 (H-5):** helper `resolverEstadoPublicoEnlace`, pagina, consulta y tests. Depende de T-02 por los archivos compartidos.
4. **T-04 (H-7):** limitador, ruta del webhook y tests. Independiente de T-02/T-03; puede ir en paralelo si se coordinan los archivos.
5. **T-05 (H-6 evidencia):** expediente `h6-mp-firmas.md`. Depende de la decision del dueno (ya registrada) y de la evidencia A/B.
6. **T-06 (H-6 hardening MP):** ruta MP + tests del hardening. Independiente de T-04; reutiliza `rate-limit.ts`.
7. **T-07 (docs):** `AGENTS.md`, `MEMORY.md` y trazabilidad. Depende de T-01..T-06.
8. **T-08 (verificacion final):** suite, typecheck, lint y build. Depende de T-01..T-07.
9. **T-09 (staging):** smoke en `paypal-staging` sin produccion. Depende de T-08.
10. **T-10 (gate T-38):** sin codigo, no autorizado. Depende de T-09 y de la autorizacion del dueno.

T-02 y T-03 comparten `src/lib/paypal/utils.ts` y `src/__tests__/api/paypal-public.test.ts`; hacerlos secuenciales evita conflictos. T-04 toca solo el webhook PayPal y su modulo; T-06 toca solo el webhook MP y su test, por lo que pueden ir en paralelo entre si y con T-02/T-03.

**Estado (2026-10-30):** T-01 a T-08 PASS (tester+reviewer y verificacion final); T-09 (smoke manual de staging) pendiente; T-10/T-38 pendiente y **NO autorizado**. La implementacion de H-5..H-9 esta cerrada y produccion no cambio.
