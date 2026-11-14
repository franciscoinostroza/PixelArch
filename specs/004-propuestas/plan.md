# Plan 004: Portal de propuestas y prospección asistida

**Spec:** ./spec.md (aprobada 2026-11-10)
**Estado:** propuesto para implementación
**Fecha:** 2026-11-10
**Rama sugerida:** `propuestas-portal`
**Gate de envío:** `PROPUESTAS_ENVIO_HABILITADO=true` + checklist legal (§20.1 de la spec) + gate de staging (§7.6). Sin esos tres, el portal funciona en seco y no llama a Resend.
**Dependencias duras:** ninguna feature pendiente. El portal es aditivo y no toca CRM, pagos, PayPal, Mercado Pago ni la landing.

---

## 1. Resumen técnico

Se crea un portal interno separado, `/propuestas`, con route group y layout propios (`src/app/(propuestas)/`), autenticado con Clerk y restringido a `publicMetadata.role === "admin"`. No reutiliza el layout de `/admin` ni `requireAdmin()`/`requireStaff()` porque esos helpers consultan `Cliente`; el portal usa un guard Clerk-only que nunca lee ni escribe el CRM.

El flujo v1 es determinista y sin LLM:

```
Campaña → Google Places (API oficial) → dedupe → prospecto
  → fetch web pública (SSRF/robots/límites) → email profesional publicado
  → auditoría interna (lógica existente) → score explicable
  → borrador por plantilla → aprobación humana (snapshot)
  → confirmación separada → Resend (idempotencia) → resultado
  → respuesta/rebote/queja → supresión global por email/hash
```

Piezas nuevas:

1. **Middleware corregido:** `/propuesta` (singular) sigue público; `/propuestas` (plural) y `/api/propuestas/**` quedan admin-only; `/propuestas/baja/[token]` y `/api/opt-out` son las únicas excepciones públicas. Se corrigen los headers `noindex`/`no-store` del portal.
2. **Guard Clerk-only** (`src/lib/propuestas/auth.ts`) que no importa Prisma ni consulta `Cliente`.
3. **Esquema Prisma aditivo:** `CampanaProspeccion`, `Prospecto`, `PlantillaPropuesta`, `EnvioPropuesta`, `SupresionProspecto` y `ConsumoProveedor`, con enums propios. Sin FKs ni relaciones al CRM.
4. **Dominio puro testeable:** normalización/dedupe, hash de supresión, tokens de baja, score, transiciones, plantillas, email, consumo y retención.
5. **Adaptadores server-only:** Places, fetch web con guard SSRF/DNS/robots, auditoría reutilizada, Resend y un puerto de redacción reservado para LLM (v1 solo `PLANTILLA`).
6. **APIs internas** bajo `/api/propuestas/**` con guard admin Clerk-only, Zod, rate limit, control de origen y cupos diarios en base.
7. **Baja pública** en `/propuestas/baja/[token]` y `POST /api/opt-out`, con token firmado sin PII y supresión por hash.

No se agregan dependencias npm. Se usan `node:crypto`, `node:dns`, `node:tls`, `fetch` nativo, Prisma, Clerk y Resend ya instalados. No hay `NEXT_PUBLIC_*` nuevas ni cambios de `Dockerfile`.

---

## 2. Arquitectura

### 2.1 Rutas, route group y archivos

Se usa un route group nuevo `(propuestas)`, hermano del `(propuesta)` existente. Los nombres de route group no afectan la URL: la página pública sigue en `src/app/(propuesta)/propuesta/page.tsx` y el portal vive en `src/app/(propuestas)/propuestas/page.tsx`. La baja pública vive en un route group separado `(propuestas-baja)` con un layout mínimo que **no** llama al guard admin; si estuviera bajo `(propuestas)`, heredaría el layout autenticado y dejaría de ser pública. El grupo admin no define `baja`, así que no hay colisión de URLs. El build de Next valida el árbol.

| Ruta | Archivo | Acceso | Función |
|------|---------|--------|---------|
| `/propuestas` | `src/app/(propuestas)/propuestas/page.tsx` | Admin | Dashboard: campañas, cola, cupos, supresiones. |
| `/propuestas/buscar` | `.../propuestas/buscar/page.tsx` | Admin | Alta de campaña y ejecución de búsqueda. |
| `/propuestas/campanas/[id]` | `.../propuestas/campanas/[id]/page.tsx` | Admin | Estado, resultados, duplicados, análisis, consumo. |
| `/propuestas/prospectos/[id]` | `.../propuestas/prospectos/[id]/page.tsx` | Admin | Ficha, fuentes, auditoría, score, borrador, aprobación y envío. |
| `/propuestas/bandeja` | `.../propuestas/bandeja/page.tsx` | Admin | Borradores pendientes, ordenados por score. |
| `/propuestas/plantillas` | `.../propuestas/plantillas/page.tsx` | Admin | Lista y alta de plantillas. |
| `/propuestas/plantillas/[id]` | `.../propuestas/plantillas/[id]/page.tsx` | Admin | Edición, versionado y vista previa con un prospecto real. |
| `/propuestas/envios` | `.../propuestas/envios/page.tsx` | Admin | Historial, estados, message IDs y errores sanitizados. |
| `/propuestas/supresiones` | `.../propuestas/supresiones/page.tsx` | Admin | Supresiones, alta manual, revocación excepcional y purga. |
| `/propuestas/baja/[token]` | `src/app/(propuestas-baja)/propuestas/baja/[token]/page.tsx` | Público | Confirmación de baja, sin login y sin datos (layout mínimo, sin guard admin). |
| `/propuestas` internas | `src/app/(propuestas)/layout.tsx` | Admin | Shell propio, sin navegación de CRM. |

APIs del portal (todas `runtime = "nodejs"`, `dynamic = "force-dynamic"`; `/api/opt-out` es la única pública):

| Método | Ruta | Función |
|--------|------|--------|
| POST | `/api/propuestas/campanas` | Crear campaña (idempotente por `idempotencyKey`). |
| POST | `/api/propuestas/campanas/[id]/ejecutar` | Ejecutar búsqueda Places. |
| POST | `/api/propuestas/campanas/[id]/cancelar` | Cancelar una campaña `BORRADOR`/`EN_CURSO`. |
| POST | `/api/propuestas/prospectos` | Alta manual con fuente. |
| PATCH | `/api/propuestas/prospectos/[id]` | Corregir datos con motivo/fuente. |
| POST | `/api/propuestas/prospectos/[id]/descartar` | Descartar prospecto y cancelar pendientes. |
| POST | `/api/propuestas/prospectos/[id]/analizar` | Fetch web + email + auditoría + score. |
| POST | `/api/propuestas/prospectos/[id]/borrador` | Generar borrador por plantilla. |
| PATCH | `/api/propuestas/envios/[id]` | Editar borrador o crear versión si estaba aprobado. |
| POST | `/api/propuestas/envios/[id]/aprobar` | Aprobar con snapshot (no envía). |
| POST | `/api/propuestas/envios/[id]/enviar` | Confirmación separada + Resend. |
| POST | `/api/propuestas/envios/[id]/reintentar` | Crear versión BORRADOR de un envío `FALLIDO` (sin Resend). |
| POST | `/api/propuestas/envios/[id]/resultado` | Registrar respuesta/rebote/queja. |
| POST | `/api/propuestas/supresiones` | Alta manual idempotente. |
| POST | `/api/propuestas/supresiones/[id]/revocar` | Excepción explícita con motivo. |
| POST | `/api/propuestas/plantillas` | Crear plantilla. |
| PATCH | `/api/propuestas/plantillas/[id]` | Nueva versión de plantilla. |
| POST | `/api/propuestas/arco/[prospectoId]` | Exportar/rectificar/eliminar por ARCO. |
| POST | `/api/propuestas/retencion` | Purga manual (admin). |
| GET | `/api/cron/propuestas-retencion` | Purga programada con `CRON_SECRET`. |
| POST | `/api/opt-out` | Baja pública one-click. |

No hay APIs públicas de lectura. Los listados y fichas se leen en server components; las mutaciones van por API.

### 2.2 Autenticación y aislamiento

- **Middleware (primera barrera):** ver §2.7.
- **Segunda barrera (páginas):** `src/app/(propuestas)/layout.tsx` llama a `resolverAdminPropuestas()` (la baja pública vive en `(propuestas-baja)`, con layout mínimo y sin este guard):
  - sin sesión → `redirect("/gate/admin?next=/propuestas")`;
  - sesión sin rol admin → `redirect("/admin/cobros")` si es asistente, `/` en cualquier otro caso;
  - admin → renderiza el shell.
- **Tercera barrera (APIs):** cada route handler llama a `resolverAdminPropuestas()`; sin sesión `401`, sin rol admin `403`, sin cuerpo en el error.
- **Nunca** se usa `requireStaff()` ni `requireAdmin()` en el portal: ambos consultan `prisma.cliente`. Un test estático verifica que `src/lib/propuestas/**`, `src/app/(propuestas)/**` y `src/app/api/propuestas/**` no contengan `prisma.cliente`, `prisma.pago`, `prisma.suscripcion`, `prisma.enlacePago`, `prisma.proyecto` ni `prisma.hito`.

Contrato:

```ts
export type ResultadoAdminPropuestas =
  | { ok: true; admin: { userId: string; nombre: string } }
  | { ok: false; motivo: "SIN_SESION" | "NO_ADMIN"; esAsistente: boolean }

export async function resolverAdminPropuestas(): Promise<ResultadoAdminPropuestas>
```

No importa `@/lib/prisma`. Usa `auth()` y `clerkClient()`; el nombre sale de Clerk (`fullName`/`firstName`) o `"Admin"`. No hay cache del rol en cliente.

### 2.3 Flujo end-to-end y orquestación

La corrida se parte en dos fases para no exceder timeouts de Railway y para que el admin controle el costo:

**Fase A — búsqueda (`POST /campanas/[id]/ejecutar`)**

```
requireAdmin + origen + rate limit
  -> updateMany({ id, estado: "BORRADOR" }, { estado: "EN_CURSO", iniciadaEn })
     (si count = 0 -> 409, evita doble clic)
  -> reservarCupo(GOOGLE_PLACES, 1)   // tope diario global
  -> Places Text Search (1 request, pageSize <= limiteCorrida <= 20)
  -> por cada place con websiteUri:
       normalizar URL + dominio
       descartar sitio social/marketplace/agregador (FUENTE_NO_PERMITIDA)
       comprobar supresión por dominio (el email aún no existe)
       dedupe por placeId / email / dominio
       crear Prospecto(NUEVO, placeId, sitioWeb, nombreNegocio=hostname)
       o reutilizar / marcar posibleDuplicadoDeId / omitir si está suprimido
  -> estado COMPLETADA | PARCIAL | FALLIDA, ultimoError sanitizado
  -> respuesta con candidatos transitorios (nombre de Places + website)
     para mostrar en la corrida con atribución; no se persiste el nombre de Places
```

**Fase B — análisis (`POST /prospectos/[id]/analizar`), una request por prospecto**

```
requireAdmin + origen + rate limit
  -> reservarCupo(WEB_FETCH) por página, máximo 3
  -> fetchHtmlSeguro(home) con DNS/SSRF/robots/timeout/tamaño/HTML
  -> extraer email profesional publicado (mailto o texto visible) + teléfono
  -> si hace falta, hasta 2 páginas de contacto del mismo dominio
  -> no sobrescribir nombre/email/teléfono cargados manualmente; solo completar vacíos
     (el nombre derivado de Places sí puede mejorarse con el de la web)
  -> guardar fuente/fecha por dato; nombre desde <title>/og:site_name
  -> si hay email: comprobar supresión por hash
  -> reservarCupo(AUDITORIA, 1) y auditar el home (si ya hay auditoría < 24 h, reutilizar)
  -> calcular score determinista
  -> estado PUNTUADO | SIN_ENRIQUECER | SUPRIMIDO
```

El cliente encadena los análisis de a uno ("Analizar pendientes"), con progreso y cancelación. No hay worker, cola ni cron de prospección. El admin puede analizar un prospecto suelto.

**Fase C — borrador, aprobación y envío**

```
POST /prospectos/[id]/borrador
  -> requiere email, no suprimido, plantilla activa, sin borrador abierto
  -> render plantilla + datos + hallazgos (sin LLM)
  -> crea EnvioPropuesta(BORRADOR, secuencia, version=1, hashContenido)

PATCH /envios/[id]
  -> BORRADOR: edita en sitio
  -> APROBADO: nueva version (misma secuencia), la anterior CANCELADO/EDITADO

POST /envios/[id]/aprobar
  -> re-renderiza el email final (footer legal + token de baja + headers)
  -> guarda snapshot aprobado* + aprobadoHash + aprobadoPor/En
  -> estado APROBADO; NO llama a Resend

POST /envios/[id]/enviar { confirmacion: "ENVIAR" }
  -> revalida estado, hash, email, supresión, from/reply-to, cupo y max mensajes
  -> reserva cupo RESEND + updateMany(APROBADO -> ENVIANDO)
  -> Resend con Idempotency-Key y headers List-Unsubscribe
  -> ENVIADO + messageId, o FALLIDO + código sanitizado (sin auto-retry)
```

**Fase D — seguimiento y supresión**

```
POST /envios/[id]/resultado { tipo: RESPONDIDO | REBOTE_DURO | QUEJA }
  -> RESPONDIDO: envio RESPONDIDO, prospecto RESPONDIO
  -> REBOTE_DURO/QUEJA: envio REBOTADO/QUEJA, supresión EMAIL,
     cancela BORRADOR/APROBADO del prospecto, prospecto SUPRIMIDO

POST /api/opt-out (público, token) o POST /api/propuestas/supresiones (admin)
  -> SupresionProspecto EMAIL (hash) o DOMINIO (solo dominio de negocio)
  -> idempotente por clave; cancela pendientes
  -> prospecto SUPRIMIDO solo si su email actual coincide con el hash;
     si no, se conserva el prospecto y se bloquea ese email
```

### 2.4 Componentes de dominio

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/lib/propuestas/auth.ts` | Guard Clerk-only admin; sin Prisma. |
| `src/lib/propuestas/config.ts` | Envs server-only, defaults, cupos, costos y `estadoEnvio()`. Nunca lanza. |
| `src/lib/propuestas/errores.ts` | Códigos de error, `esErrorTablaFaltante`, `sanitizarError`. |
| `src/lib/propuestas/normalizar.ts` | Email, dominio registrable, proveedores públicos, extracción de email/teléfono. |
| `src/lib/propuestas/dedupe.ts` | Dedupe por `placeId`, email exacto y dominio; posible duplicado. |
| `src/lib/propuestas/supresion.ts` | Hash HMAC, clave de supresión, contactabilidad, token de baja. |
| `src/lib/propuestas/score.ts` | Score 0-100 determinista con desglose y motivos. |
| `src/lib/propuestas/transiciones.ts` | Estados, transiciones y `puedeAprobar`/`puedeEnviar`. |
| `src/lib/propuestas/plantillas.ts` | Variables con lista blanca, validación y render determinista. |
| `src/lib/propuestas/email.ts` | Asunto, HTML/texto, footer legal y headers `List-Unsubscribe`. |
| `src/lib/propuestas/legal.ts` | Estructura del aviso; el texto literal aprobado llega por env. |
| `src/lib/propuestas/redact.ts` | Redacción de errores/logs sin PII, tokens ni secretos. |
| `src/lib/propuestas/places.ts` | Cliente Places oficial con field mask mínimo. |
| `src/lib/propuestas/web.ts` | Fetch seguro, DNS, robots, límites y extracción. |
| `src/lib/propuestas/auditoria.ts` | Auditoría interna con la lógica existente. |
| `src/lib/propuestas/consumo.ts` | Reserva y registro de cupos/costos en base. |
| `src/lib/propuestas/retencion.ts` | Selección y purga de prospectos vencidos. |
| `src/lib/propuestas/arco.ts` | Exportar/eliminar, conservando supresión. |
| `src/lib/propuestas/validation.ts` | Esquemas Zod de bodies. |
| `src/lib/propuestas/origen.ts` | Verificación de origen en mutaciones. |
| `src/lib/audit-server.ts` | Extracción de la lógica de parseo y TLS de `/api/audit` para reutilizarla sin duplicar. |

### 2.5 Adaptadores de proveedores

**Places**

- Endpoint oficial `https://places.googleapis.com/v1/places:searchText`.
- `X-Goog-Api-Key: PROPUESTAS_PLACES_API_KEY`; `X-Goog-FieldMask: places.id,places.displayName.text,places.websiteUri`.
- Body `{ textQuery, languageCode: "es", regionCode: "AR", pageSize }`; sin `pageToken`, sin fotos, reseñas, horarios ni ratings. Una request por corrida; `pageSize <= 20`.
- Se persiste `placeId` y la URL del sitio (dato necesario para enriquecer). El nombre/address/rating de Places se muestra solo en la respuesta de la corrida con atribución y no se guarda.
- Errores: `400` configuración, `401/403` credenciales, `429` cuota (corta la corrida, sin bucle), `5xx`/timeout proveedor. Se mapean a códigos; no se reintenta.
- Si falta la clave, la búsqueda se deshabilita en UI y API (`503 PROVEEDOR_NO_CONFIGURADO`).

**Fetch web pública**

- `normalizeUrl` + `isBlockedHost` existentes, más resolución DNS (`dns.promises.lookup(host, { all: true })`) y rechazo de IPv4/IPv6 privadas, loopback, link-local, multicast, reservadas, `.local`, `.internal`, `.localhost`, credenciales embebidas y puertos distintos de 80/443.
- Para cerrar el DNS rebinding, el fetch interno usa `node:https`/`node:http` con un `lookup` validador que comprueba la IP en el momento de conectar (no el `fetch` global, que re-resuelve sin control). En el portal, el `fetch` global queda solo para Places/Resend, que tienen hosts fijos; `/api/audit` conserva su fetch público sin cambios.
- Redirecciones manuales (`redirect: "manual"`), máximo 3, cada hop revalidado y limitado al mismo dominio registrable del sitio inicial (subdominios permitidos); un redirect a otro dominio se rechaza (`DOMINIO_EXTERNO`). Solo `text/html`/`application/xhtml+xml`, `Accept-Encoding: identity` (si llega comprimido, se rechaza `ENCODING`). Timeout 8 s por request, 1 MB máximo, sin cookies, sin JS, sin assets/PDF/redes.
- `robots.txt` por origen, cacheado 24 h en memoria; parser puro para `User-agent: *` y `PixelArchProspectBot`; 404/5xx permite, 401/403 bloquea.
- User-Agent: `PixelArchProspectBot/1.0 (+https://pixelarch.dev/propuestas; contacto: hola@pixelarch.dev)`.
- Se rechaza un sitio de red social, marketplace, agregador o link-in-bio (`FACEBOOK`, `INSTAGRAM`, `LINKEDIN`, `TIKTOK`, `LINKTR.EE`, etc.) como web del negocio; no se fetch-ea. Se rechaza una página de login/autenticación (path `/login`, `/signin`, `/auth`, `/acceso` o `<input type="password">`) con motivo `LOGIN`; no se intenta autenticar ni evadir.
- Extracción: `mailto:` primero, luego texto visible tras remover `<script>`, `<style>` y comentarios; solo un email principal; se rechazan `no-reply`, `noreply`, `sentry`, `wixpress`, `example.com`, imágenes y valores sin dominio. No se adivinan patrones. Teléfono solo desde `tel:`. Nombre de contacto/cargo no se extraen automáticamente (carga manual).
- Guarda `emailFuenteUrl` y `emailFechaFuente`; si no hay email, el prospecto queda sin contacto y no se puede aprobar/enviar.

**Auditoría**

- Se extrae de `/api/audit` la parte pura de parseo (`analizarHtmlAudit`) y el helper TLS a `src/lib/audit-server.ts`; la ruta pública conserva su comportamiento, su rate limit de 8/h y su User-Agent.
- La auditoría interna usa `fetchHtmlSeguro` + `analizarHtmlAudit`; reutiliza el HTML/headers del home ya obtenido en el análisis (no hace un segundo fetch del mismo home), no llama a `/api/audit` ni consume su rate limit.
- Se guarda `{ scores, findings, finalUrl, fecha, estado }`; no HTML, no certificado completo.
- Una auditoría por prospecto cada 24 h; si falla, `auditoriaEstado = "FALLIDA"` y el borrador puede generarse sin hallazgos, marcado como tal. Si el sitio es HTTP o el certificado TLS falla, se registra un hallazgo sintético (`SIN_HTTPS`/`TLS_INVALIDO`) con `ssl: 0`; no se salta la validación TLS ni se reintenta con `rejectUnauthorized: false`.

**Redacción**

- v1 `modo = "PLANTILLA"`. Puerto reservado:

```ts
export interface RedactorPropuesta {
  modo: "PLANTILLA" | "LLM"
  redactar(input: EntradaRedaccion): Promise<SalidaRedaccion>
}
```

- `POST /borrador` con `modo: "LLM"` responde `503 LLM_NO_CONFIGURADO` y no escribe nada (AC-23). Si en el futuro se habilita, el adaptador recibe solo datos del negocio y hallazgos, sin CRM ni secretos, y su salida se sanitiza igual.

**Resend**

- `src/lib/propuestas/resend.ts` encapsula `getResend()`. Si el SDK no expone la opción de idempotencia en la versión instalada, se usa `fetch` directo a `https://api.resend.com/emails` con `Idempotency-Key`; la suite lo mockea.
- Payload: `from: "PixelArch <propuestas@pixelarch.dev>"`, `replyTo: "hola@pixelarch.dev"`, `to`, `subject`, `html`, `text`, `headers` con `List-Unsubscribe` y `List-Unsubscribe-Post`.
- Sin `scheduledAt`, sin adjuntos, sin píxeles, sin tracking.
- Éxito solo si hay `data.id`; `error` o excepción → `FALLIDO` con código (`VALIDACION`, `LIMITE`, `PROVEEDOR`, `RED`, `DESCONOCIDO`). No se loguea destinatario, asunto ni cuerpo.

### 2.6 UI y accesibilidad

- Shell propio: sidebar/header con marca, secciones, `aria-current`, identidad del admin, medidor de cupo del día y enlace a `/admin/dashboard`. En mobile, drawer accesible.
- No muestra navegación ni datos de clientes, cobros, pagos, servicios o blog.
- Componentes nuevos en `src/components/propuestas/`:
  - `portal-shell.tsx`, `portal-sidebar.tsx`, `cupo-dia.tsx`, `estado-vacio.tsx`;
  - `campana-form.tsx`, `campana-tabla.tsx`, `prospecto-ficha.tsx`, `score-desglose.tsx`;
  - `borrador-editor.tsx`, `aprobacion-panel.tsx`, `envio-confirmacion.tsx`;
  - `plantilla-form.tsx`, `supresion-form.tsx`, `arco-panel.tsx`, `baja-confirmar.tsx`.
- Se reutiliza `src/components/ui/paypal-dialog.tsx` como shell accesible de modales (ya es genérico: foco, `aria-modal`, Escape, retorno de foco). No se renombra para no tocar tests existentes; se documenta como "diálogo accesible existente".
- Aprobación y envío son dos modales distintos. El de envío exige marcar "Entiendo que se enviará un email real" y escribe `confirmacion: "ENVIAR"` en el body.
- El botón de enviar queda deshabilitado con motivos visibles: sin aprobación, suprimido, sin email, cupo agotado, contenido cambiado, configuración incompleta.
- Formularios con `react-hook-form` + Zod (ya instalados). Errores asociados con `aria-describedby`; foco visible; contraste con tokens existentes.
- Los listados muestran email enmascarado; la ficha muestra el email completo porque el admin debe verificar el destinatario. Nunca se pone PII en la URL.

### 2.7 Middleware: corrección de la colisión

Situación actual: `ROUTES.public` incluye `"/propuesta(.*)"`, que también matchea `/propuestas`; como `isPublic` se evalúa primero, agregar `/propuestas` a `admin` no alcanza.

Cambio propuesto:

```ts
const ROUTES = {
  public: [
    ...,
    "/propuesta",                 // exacta
    "/propuesta/(.*)",            // subrutas públicas existentes
    "/propuestas/baja",           // baja pública
    "/propuestas/baja/(.*)",
    "/api/opt-out",
  ],
  admin: ["/admin(.*)", "/propuestas", "/propuestas/(.*)"],
  apiAdmin: ["/api/propuestas(.*)"],
}
```

Orden de evaluación: `isPublic` → `isApiAdmin` → `isAdmin` → `next`.

- `isPublic` se evalúa primero: `/propuestas/baja/<token>` y `/api/opt-out` quedan públicos aunque `/propuestas/(.*)` esté en admin.
- `isApiAdmin`: sin sesión → `401 { error: "No autorizado" }`; rol no admin → `403 { error: "Prohibido" }`; admin → `next`. No usa el rewrite del gate.
- `isAdmin` conserva el comportamiento actual. La asistente en `/propuestas` cae en `esRutaAdminPermitida` falso y se redirige a `/admin/cobros`; sin sesión, rewrite a `/gate/admin?next=...`.
- Headers: para `/propuestas(.*)`, `/api/propuestas(.*)` y `/api/opt-out`, la respuesta lleva `X-Robots-Tag: noindex, nofollow` y `Cache-Control: no-store`. Se aplican también a rewrite/redirect cuando sea posible.
- `matcher` no cambia: `/api/propuestas` y `/api/opt-out` ya entran por el segundo matcher; `/api/cron/propuestas-retencion` queda excluido por `api/cron`.
- Tests obligatorios: `/propuesta` público; `/propuesta/lo-que-sea` público; `/propuestas` anónimo no público; asistente denegada; admin pasa; `/propuestas/baja/token` público; `/api/opt-out` público; `/api/propuestas/campanas` 401 anónimo, 403 asistente, pasa admin; headers en página y API.

---

## 3. Decisiones y alternativas

| Decisión | Alternativas | Motivo | Licencia/Coste |
|----------|--------------|--------|----------------|
| **D-1: route group `(propuestas)` y layout propio.** | Colgar de `/admin/propuestas`; reutilizar layout admin. | Aísla el portal del CRM, evita navegación y consultas de `Cliente`. | Sin costo. |
| **D-2: guard Clerk-only `resolverAdminPropuestas()`.** | Usar `requireAdmin()`/`requireStaff()`. | Esos helpers consultan `Cliente` y devuelven sus datos; violarían RF-6/AC-6. | Sin costo. |
| **D-3: dos fases (búsqueda y análisis por prospecto).** | Una sola request que hace todo; worker/cola. | Evita timeouts, permite cancelar y controlar costo; sin infraestructura nueva. | Sin costo; una request HTTP por prospecto. |
| **D-4: v1 determinista sin LLM.** | Integrar un proveedor LLM ahora. | Decisión del dueño; reduce costo, dependencia y superficie de prompt injection. | Sin licencia nueva. |
| **D-5: clave Places separada.** | Reutilizar `GOOGLE_PLACES_API_KEY` de reseñas. | Aísla cuotas, facturación y restricciones de API; no se asume que la clave de reseñas tenga Places habilitado. | Costo variable por request; cupo diario. |
| **D-6: persistir solo `place_id` + URL del sitio; nombre canónico desde la web/carga manual.** | Guardar nombre, dirección, teléfono y rating de Places. | Respeta los términos y AC-8/AC-43. La URL es necesaria para enriquecer y se registra como fuente. | Sin costo. |
| **D-7: supresión por HMAC-SHA256 y token de baja firmado.** | Guardar email en claro; token aleatorio en base. | El bloqueo funciona sin email en claro y sobrevive al borrado; el token no contiene PII y sirve aunque el envío se haya purgado. | `node:crypto` built-in. |
| **D-8: `EnvioPropuesta` con `secuencia` (mensaje) y `version` (edición/reintento).** | Una fila mutable; versionar en JSON. | Conserva historial, impide doble envío y permite invalidar una aprobación sin contar un mensaje nuevo. | Sin costo. |
| **D-9: cupos diarios en `ConsumoProveedor`.** | Solo rate limit en memoria; JSON en campaña. | El tope duro debe sobrevivir reinicios y ser auditable; el limitador en memoria queda como defensa de primer nivel. | Una fila por campaña/proveedor/día. |
| **D-10: baja pública en `/propuestas/baja/[token]` + `POST /api/opt-out`.** | Baja dentro de `/admin`; solo mailto. | Cumple one-click y no requiere login; el POST satisface RFC 8058. | Sin costo. |
| **D-11: sin dependencias npm nuevas.** | Añadir parser HTML, TLD parser, cliente Places, SDK LLM. | `fetch`, regex acotadas, `node:*` y Prisma cubren el MVP; menos superficie y licencias. | Sin licencias nuevas. |
| **D-12: retención por borrado en cascada + supresión permanente.** | Anonimizar prospectos. | Privacidad primero; la supresión es la única evidencia que debe sobrevivir. | Sin costo. |
| **D-13: sin webhooks de Resend en v1.** | Integrar webhooks firmados ahora. | Decisión Q-9; el admin registra rebote/queja manual. Se puede agregar después sin cambiar el modelo. | Sin costo. |
| **D-14: `PROPUESTAS_ENVIO_HABILITADO` como gate explícito.** | Enviar si hay API key. | Evita envíos accidentales en staging o antes del checklist legal. | Sin costo. |

---

## 4. Modelo de datos y contratos

### 4.1 Esquema Prisma (aditivo)

> `db push` crea tablas, enums e índices nuevos. No se altera ninguna columna existente. No hay FKs a `Cliente`, `Pago`, `Suscripcion`, `EnlacePago`, `Proyecto` ni `Hito`.

```prisma
enum EstadoCampanaProspeccion {
  BORRADOR
  EN_CURSO
  COMPLETADA
  PARCIAL
  CANCELADA
  FALLIDA
}

enum EstadoProspecto {
  NUEVO
  SIN_ENRIQUECER
  ENRIQUECIDO
  PUNTUADO
  BORRADOR
  APROBADO
  ENVIADO
  RESPONDIO
  DESCARTADO
  SUPRIMIDO
}

enum EstadoEnvioPropuesta {
  BORRADOR
  APROBADO
  ENVIANDO
  ENVIADO
  FALLIDO
  REBOTADO
  QUEJA
  RESPONDIDO
  CANCELADO
}

enum AmbitoSupresion {
  EMAIL
  DOMINIO
}

enum MotivoSupresion {
  OPT_OUT
  REBOTE_DURO
  QUEJA
  MANUAL
  SOLICITUD_ARCO
}

enum OrigenSupresion {
  ENLACE
  MANUAL
  ARCO
}

enum FuenteDatoProspecto {
  PLACES
  WEB_NEGOCIO
  CARGA_MANUAL
}

enum ProveedorConsumo {
  GOOGLE_PLACES
  WEB_FETCH
  AUDITORIA
  REDACTOR
  RESEND
}

model CampanaProspeccion {
  id                String                   @id @default(cuid())
  nombre            String
  consulta          String
  zona              String?
  rubro             String?
  filtros           Json?
  estado            EstadoCampanaProspeccion @default(BORRADOR)
  limiteCorrida     Int                      @default(20)
  plantillaId       String?
  creadaPor         String
  creadaPorNombre   String?
  idempotencyKey    String?                  @unique
  ultimoError       String?
  iniciadaEn        DateTime?
  finalizadaEn      DateTime?
  creadoEn          DateTime                 @default(now())
  actualizadoEn     DateTime                 @updatedAt

  plantilla  PlantillaPropuesta? @relation(fields: [plantillaId], references: [id], onDelete: SetNull)
  prospectos Prospecto[]
  envios     EnvioPropuesta[]
  consumos   ConsumoProveedor[]

  @@index([estado, creadoEn])
  @@index([creadaPor])
}

model Prospecto {
  id                   String              @id @default(cuid())
  nombreNegocio        String
  sitioWeb             String?
  dominioNormalizado   String?
  ciudad               String?
  rubro                String?
  placeId              String?             @unique
  email                String?             @unique
  telefono             String?
  contactoNombre       String?
  contactoCargo        String?
  emailFuenteUrl       String?
  emailFechaFuente     DateTime?
  fuenteTipo           FuenteDatoProspecto?
  fuenteUrl            String?
  fechaFuente          DateTime?
  estado               EstadoProspecto    @default(NUEVO)
  score                Int?
  scoreDetalle         Json?
  auditoriaResumen     Json?
  auditoriaEstado      String?
  auditoriaFecha       DateTime?
  posibleDuplicadoDeId String?
  motivoSinEnriquecer  String?
  baseLegal            String?
  notaLegal            String?
  notas                String?
  arcoHistorial        Json?
  historial            Json?
  actualizadoPor       String?
  ultimaInteraccionEn  DateTime            @default(now())
  ultimoEnvioEn        DateTime?
  creadoEn             DateTime            @default(now())
  actualizadoEn        DateTime            @updatedAt
  campanaOrigenId      String

  campanaOrigen CampanaProspeccion @relation(fields: [campanaOrigenId], references: [id], onDelete: Cascade)
  envios        EnvioPropuesta[]
  consumos      ConsumoProveedor[]

  @@index([estado, actualizadoEn])
  @@index([campanaOrigenId, estado])
  @@index([dominioNormalizado])
  @@index([posibleDuplicadoDeId])
  @@index([ultimaInteraccionEn])
}
```

```prisma
model PlantillaPropuesta {
  id                  String   @id @default(cuid())
  nombre              String
  idioma              String   @default("es")
  asunto              String
  cuerpo              String
  variablesPermitidas Json
  version             Int      @default(1)
  activa              Boolean  @default(true)
  creadaPor           String
  creadaPorNombre     String?
  creadoEn            DateTime @default(now())
  actualizadoEn       DateTime @updatedAt

  campanas CampanaProspeccion[]
  envios   EnvioPropuesta[]

  @@unique([nombre, version])
  @@index([activa])
}

model EnvioPropuesta {
  id                  String               @id @default(cuid())
  prospectoId         String
  campanaId           String
  plantillaId         String?
  plantillaVersion    Int?
  secuencia           Int
  version             Int                  @default(1)
  destinatario        String
  fromEmail           String?
  fromNombre          String?
  replyTo             String?
  asunto              String
  cuerpoHtml          String
  cuerpoTexto         String
  hashContenido       String
  tokenBaja           String?
  estado              EstadoEnvioPropuesta @default(BORRADOR)
  aprobadoAsunto      String?
  aprobadoCuerpoHtml  String?
  aprobadoCuerpoTexto String?
  aprobadoHash        String?
  aprobadoPor         String?
  aprobadoPorNombre   String?
  aprobadoEn          DateTime?
  enviadoPor          String?
  enviadoPorNombre    String?
  enviadoEn           DateTime?
  proveedorMessageId  String?              @unique
  idempotencyKey      String?              @unique
  error               String?
  intentos            Int                  @default(0)
  motivoCancelacion   String?
  creadoEn            DateTime             @default(now())
  actualizadoEn       DateTime             @updatedAt

  prospecto Prospecto           @relation(fields: [prospectoId], references: [id], onDelete: Cascade)
  campana   CampanaProspeccion  @relation(fields: [campanaId], references: [id], onDelete: Cascade)
  plantilla PlantillaPropuesta? @relation(fields: [plantillaId], references: [id], onDelete: SetNull)

  @@unique([prospectoId, secuencia, version])
  @@index([estado, creadoEn])
  @@index([prospectoId, secuencia])
  @@index([campanaId, estado])
}

model SupresionProspecto {
  id                 String          @id @default(cuid())
  ambito             AmbitoSupresion
  clave              String          @unique
  emailHash          String?
  emailEnmascarado   String?
  dominioNegocio     String?
  motivo             MotivoSupresion
  origen             OrigenSupresion
  activa             Boolean         @default(true)
  notas              String?
  historial          Json?
  creadaPor          String?
  creadaPorNombre    String?
  creadaEn           DateTime        @default(now())
  revocadaPor        String?
  revocadaEn         DateTime?
  motivoRevocacion   String?

  @@index([ambito, activa])
  @@index([emailHash])
  @@index([dominioNegocio])
}

model ConsumoProveedor {
  id             String           @id @default(cuid())
  clave          String           @unique
  campanaId      String
  prospectoId    String?
  proveedor      ProveedorConsumo
  fecha          DateTime         @db.Date
  llamadas       Int              @default(0)
  unidades       Int              @default(0)
  costoCentavos  Int              @default(0)
  creadoEn       DateTime         @default(now())
  actualizadoEn  DateTime         @updatedAt

  campana   CampanaProspeccion @relation(fields: [campanaId], references: [id], onDelete: Cascade)
  prospecto Prospecto?         @relation(fields: [prospectoId], references: [id], onDelete: SetNull)

  @@index([campanaId, proveedor, fecha])
  @@index([prospectoId])
  @@index([proveedor, fecha])
}
```

Reglas de esquema:

- `clave` de supresión es `EMAIL:<hmac>` o `DOMINIO:<dominio>`; garantiza idempotencia sin unique condicional.
- `Prospecto.email` y `Prospecto.placeId` son unique nullable (Postgres permite múltiples NULL).
- `EnvioPropuesta` guarda el borrador en `cuerpo*` y el email final en `aprobado*`. La aprobación **re-renderiza** el footer legal, el token de baja y los headers; `hashContenido` cubre el borrador y `aprobadoHash` cubre el snapshot final. El envío usa el snapshot y exige que `aprobadoHash` coincida con el snapshot y que `hashContenido` coincida con el borrador. `fromEmail`/`replyTo` pueden ser null en BORRADOR si falta configuración; la aprobación y el envío los exigen no nulos.
- `tokenBaja` se guarda para comparar el token del HTML aprobado con el recalculado al enviar; no es PII y no se loguea.
- `secuencia` numera mensajes manuales (1 = inicial, 2 = follow-up manual); no es una secuencia automática ni implica scheduler, cola o follow-up automático. No hay `scheduledAt` ni tabla de follow-ups.
- `ConsumoProveedor.fecha` se normaliza a UTC (`@db.Date`) con `Date.UTC(y, m, d)`. Cada fila se identifica por `clave = <campanaId>:<proveedor>:<fecha>:<prospectoId|GLOBAL>`; así hay consumo por campaña y por prospecto, y la retención deja el costo histórico (`prospectoId` pasa a null, la fila no se borra).
- Todos los modelos nuevos usan `cuid()` como el resto del proyecto.

### 4.2 Invariantes y transiciones

**Campaña**

- `BORRADOR -> EN_CURSO -> COMPLETADA | PARCIAL | FALLIDA`; `BORRADOR|EN_CURSO -> CANCELADA`.
- Solo `BORRADOR` se puede ejecutar. `EN_CURSO` bloquea doble clic. `COMPLETADA/PARCIAL/FALLIDA/CANCELADA` son terminales; para reintentar se crea otra campaña.
- `limiteCorrida` entre 1 y 20; el cupo global diario manda.

**Prospecto**

- `NUEVO -> SIN_ENRIQUECER | ENRIQUECIDO -> PUNTUADO -> BORRADOR -> APROBADO -> ENVIADO -> RESPONDIO`.
- `cualquiera -> DESCARTADO` (admin) y `cualquiera -> SUPRIMIDO` (supresión).
- `SIN_ENRIQUECER` puede puntuarse con datos faltantes; no puede generar borrador sin email.
- Un prospecto `SUPRIMIDO` no vuelve a `BORRADOR` salvo que el admin revoque la supresión con motivo; el flujo normal no lo permite.

**Envío**

- `BORRADOR -> APROBADO -> ENVIANDO -> ENVIADO | FALLIDO`.
- `ENVIADO -> REBOTADO | QUEJA | RESPONDIDO`.
- `BORRADOR|APROBADO -> CANCELADO` por supresión, edición tras aprobación o descarte.
- `FALLIDO` no se reintenta automáticamente; un reintento manual crea una versión nueva (`version+1`) con la misma `secuencia`, o una secuencia nueva si se considera otro mensaje.
- `puedeAprobar` exige: email, no supresión, plantilla válida, prospecto no suprimido, máximo de mensajes no alcanzado, hash del borrador calculado, secreto y URL pública válidos, configuración de remitente/reply-to válida, texto legal/base legal presentes y ningún otro envío `APROBADO`/`ENVIANDO` para el mismo prospecto/secuencia (el snapshot aprobado debe ser enviable tal cual).
- `puedeEnviar` exige: `APROBADO`, `aprobadoHash` coincide con el snapshot final, `hashContenido` coincide con el borrador, destinatario igual al email del prospecto, no supresión, cupo disponible, configuración de envío completa, `baseLegal` y `textoLegal` presentes.

### 4.3 Contratos de dominio

```ts
// normalizar.ts
export function normalizarEmail(input: string): string | null
export function normalizarDominio(input: string): string | null
export function dominioRegistrable(host: string): string | null
export function esProveedorPublico(dominio: string): boolean
export function esHostNoProspectable(host: string): boolean // redes sociales, marketplaces, agregadores, link-in-bio
export function extraerEmailPublicado(html: string, pageUrl: string): { email: string; fuenteUrl: string } | null
export function extraerTelefonoPublicado(html: string): string | null
export function limpiarNombreNegocio(titulo: string, host: string): string

// dedupe.ts
export type ResultadoDedupe =
  | { tipo: "NUEVO" }
  | { tipo: "REUTILIZAR"; prospectoId: string; motivo: "PLACE_ID" | "EMAIL" }
  | { tipo: "POSIBLE_DUPLICADO"; prospectoId: string; motivo: "DOMINIO" }
export function evaluarDedupe(input: EntradaDedupe, existentes: ExistenteDedupe[]): ResultadoDedupe

// supresion.ts
export function hashEmail(email: string, secreto: string): string
export function claveSupresionEmail(hash: string): string
export function claveSupresionDominio(dominio: string): string
export function emailEnmascarado(email: string): string
export function evaluarContactabilidad(input: {
  email?: string | null
  dominioNegocio?: string | null
  supresiones: Array<
    | { ambito: "EMAIL"; emailHash: string }
    | { ambito: "DOMINIO"; dominioNegocio: string }
  >
}, secreto: string): { contactable: boolean; motivo?: "SIN_EMAIL" | "SUPRIMIDO_EMAIL" | "SUPRIMIDO_DOMINIO" }
export function crearTokenBaja(prospectoId: string, emailHash: string, secreto: string): string
export function verificarTokenBaja(token: string, secreto: string):
  | { ok: true; prospectoId: string; emailHash: string }
  | { ok: false }

// score.ts
export interface ScoreComponente { clave: string; etiqueta: string; puntos: number; maximo: number; motivos: string[] }
export interface ScoreResultado { total: number; componentes: ScoreComponente[]; version: "v1" }
export function calcularScore(input: EntradaScore): ScoreResultado

// transiciones.ts
export function puedeAprobar(input: EntradaAprobacion): { ok: true } | { ok: false; motivos: string[] }
export function puedeEnviar(input: EntradaEnvio): { ok: true } | { ok: false; motivos: string[] }

// consumo.ts
export function evaluarCupo(input: { usado: number; cantidad: number; cap: number }): { permitido: boolean; restantes: number }
export async function reservarCupo(tx: Prisma.TransactionClient, reserva: ReservaCupo & { prospectoId?: string }): Promise<{ restantes: number }>
export async function estadoCupos(fecha: Date): Promise<EstadoCupos>
```

`dominioRegistrable` nunca devuelve un sufijo público solo (`com.ar`, `co.uk`): en ese caso retorna `null`, y la supresión por dominio exige un dominio registrable real.

### 4.4 Score v1 (determinista, explicable)

Total 100, sin fecha, sin azar, sin LLM. Los datos faltantes suman 0 y agregan un motivo; no se inventan.

| Componente | Puntos | Regla |
|------------|--------|-------|
| Contacto profesional | 30 | 30 si hay email publicado con fuente; 0 y motivo si falta. |
| Sitio propio | 20 | 10 si hay sitio; +5 si es HTTPS; +5 si la auditoría terminó OK. |
| Oportunidad técnica | 20 | Si hay auditoría: `round(20 * (1 - promedio(scores)/100))`. Sin auditoría: 0 y motivo. |
| Encaje campaña | 15 | 8 si `rubro` coincide (normalizado); 7 si `ciudad`/`zona` coincide. Si la campaña no define el campo, no suma ni resta; se informa "sin criterio". |
| Completitud | 15 | 5 sitio, 5 ciudad, 5 teléfono. Cada faltante suma 0 con motivo. |

`scoreDetalle` guarda `{ version: "v1", total, componentes }`; no guarda email, nombre de contacto ni HTML.

### 4.5 Plantillas y email

Variables con lista blanca global; `variablesPermitidas` solo declara el subconjunto usado por cada plantilla y nunca puede ampliar la lista global.

`nombreNegocio`, `ciudad`, `rubro`, `sitioWeb`, `contactoNombre`, `saludo`, `hallazgoPrincipal`, `score`, `remitenteNombre`, `anio`.

- `saludo` = `Hola ${contactoNombre}` si existe; si no, `Hola`.
- `hallazgoPrincipal` = primer finding `fail`; si no hay, primer `warn`; si no, primer `ok`; si no hay auditoría, texto honesto "No pudimos revisar tu sitio todavía".
- Variable desconocida o plantilla sin asunto/cuerpo → `PlantillaInvalidaError`; no se guarda ni se renderiza a medias.
- La plantilla base aprobada debe tener un solo CTA claro; el renderer no agrega CTAs, tracking ni enlaces adicionales.
- Asunto: se quitan `\r`/`\n`, se colapsan espacios, máximo 120 caracteres y se rechazan/limpian prefijos falsos `Re:`/`Fwd:`/`Fw:`. Si `PROPUESTAS_ETIQUETA_PUBLICIDAD=true`, prefijo `[publicidad] `.
- Cuerpo: se escapa HTML; doble salto → párrafo, simple → `<br>`. No se permite HTML arbitrario de la plantilla ni del admin.
- Footer no editable: identificación de PixelArch, finalidad, fuente (`sitioWeb`), canal ARCO (`hola@pixelarch.dev`), enlace visible de baja, texto legal (`PROPUESTAS_TEXTO_LEGAL`) y etiqueta de publicidad cuando corresponda. Se materializa al aprobar (no se guarda en el borrador): el borrador tiene asunto/cuerpo; el snapshot final incluye el footer completo y el token de baja.
- Versión texto equivalente, sin imágenes ni enlaces de tracking.
- Headers:
  - `List-Unsubscribe: <https://pixelarch.dev/api/opt-out?token=...>, <mailto:hola@pixelarch.dev?subject=Baja>`
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
- La URL pública se toma de `NEXT_PUBLIC_URL` validada; si no es absoluta/HTTPS, el envío se deshabilita (no se construyen links relativos en un email).

### 4.6 APIs: cuerpos, respuestas y errores

Todas las mutaciones internas (salvo `/api/opt-out`, que es público y tiene su propio rate limit por IP/token):

- Guard admin Clerk-only + `origenPermitido(req, urlPublica)`; si falla, `403 ORIGEN_INVALIDO`.
- `Content-Type: application/json`, `Cache-Control: no-store`.
- Zod (`validation.ts`) con límites de longitud; strings trim; email válido; `idempotencyKey` UUID.
- Rate limit: 30/min por admin (`rateLimit("propuestas:<userId>", 30, 60_000)`) y 60/min por IP (`propuestas:ip:<ip>`) como defensa adicional en memoria. Búsqueda y análisis: 10/min además de la exclusión mutua en base.
- Errores: `{ error: string, codigo: string }`; sin PII, sin detalles de proveedor. `400 VALIDACION`, `401 NO_AUTORIZADO`, `403 PROHIBIDO|ORIGEN_INVALIDO`, `404 NO_ENCONTRADO`, `409 ESTADO|SUPRIMIDO|SIN_EMAIL|MAX_MENSAJES|BORRADOR_ABIERTO`, `429 CUPO|RATE_LIMIT`, `502 PROVEEDOR`, `503 NO_CONFIGURADO|ESQUEMA_NO_APLICADO`.

Contratos clave:

```ts
// POST /api/propuestas/campanas
{ nombre: string; consulta: string; zona?: string; rubro?: string;
  filtros?: { soloConWeb?: boolean }; plantillaId?: string;
  limiteCorrida?: number; idempotencyKey: string }
// v1 exige sitio web para crear prospectos desde Places; el servidor guarda
// filtros.soloConWeb = true y no persiste nombres de Places sin web.
// 201 { id, estado: "BORRADOR" }
// 200 { id, estado, reutilizada: true } si el idempotencyKey ya existe

// POST /api/propuestas/campanas/[id]/ejecutar
{ confirmado: true }
// 200 { estado, creados, reutilizados, duplicados, omitidos,
//        candidatos: { placeId, nombreTransitorio, sitioWeb, resultado }[] }

// POST /api/propuestas/campanas/[id]/cancelar
{ confirmado: true }
// 200 { estado: "CANCELADA" } si estaba BORRADOR/EN_CURSO; 409 si es terminal

// POST /api/propuestas/prospectos
{ nombreNegocio: string; sitioWeb?: string; email?: string; telefono?: string;
  ciudad?: string; rubro?: string; fuenteUrl?: string; emailFuenteUrl?: string;
  nota: string }

// PATCH /api/propuestas/prospectos/[id]
{ nombreNegocio?, sitioWeb?, email?, telefono?, ciudad?, rubro?,
  contactoNombre?, contactoCargo?, motivo: string, fuenteUrl?: string }

// POST /api/propuestas/prospectos/[id]/descartar
{ motivo: string } // estado DESCARTADO; cancela BORRADOR/APROBADO pendientes

// POST /api/propuestas/prospectos/[id]/analizar
{} // v1 no permite forzar una auditoría existente
// 200 { estado, emailEncontrado, auditoriaEstado, score }

// POST /api/propuestas/prospectos/[id]/borrador
{ modo?: "PLANTILLA" | "LLM"; plantillaId?: string }
// 201 { envioId, secuencia, version }

// PATCH /api/propuestas/envios/[id]
{ asunto: string; cuerpoTexto: string }
// 200 { envioId, version } | 201 { envioId, version } si crea versión nueva

// POST /api/propuestas/envios/[id]/aprobar
{ confirmado: true }
// 200 { estado: "APROBADO", aprobadoEn }

// POST /api/propuestas/envios/[id]/enviar
{ confirmacion: "ENVIAR" }
// 200 { estado: "ENVIADO", messageId }
// 409 { codigo: "REVALIDACION", motivos: string[] }
// 502 { codigo: "PROVEEDOR" }

// POST /api/propuestas/envios/[id]/reintentar
{} // solo FALLIDO; crea version+1 BORRADOR con el mismo contenido; no llama a Resend
// 201 { envioId, version }

// POST /api/propuestas/envios/[id]/resultado
{ tipo: "RESPONDIDO" | "REBOTE_DURO" | "QUEJA"; detalle?: string }

// POST /api/propuestas/supresiones
{ ambito: "EMAIL" | "DOMINIO"; email?: string; dominioNegocio?: string;
  motivo: "OPT_OUT" | "REBOTE_DURO" | "QUEJA" | "MANUAL" | "SOLICITUD_ARCO";
  notas?: string }
// 201/200 idempotente

// POST /api/propuestas/supresiones/[id]/revocar
{ motivo: string } // excepción explícita, admin, registrada

// POST /api/propuestas/plantillas
{ nombre, idioma, asunto, cuerpo, variablesPermitidas: string[] }
// PATCH crea nueva versión y desactiva la anterior

// POST /api/propuestas/arco/[prospectoId]
{ tipo: "EXPORTAR" | "ELIMINAR" | "RECTIFICAR"; cambios?: Record<string, string> }

// POST /api/propuestas/retencion
{} // admin manual; 200 { eliminados }

// POST /api/opt-out?token=...  (o body { token })
// 200/202 genérico siempre para solicitudes bien formadas; 429 por rate limit
```

### 4.7 Variables de entorno

Todas server-only. No se agrega ninguna `NEXT_PUBLIC_*`. `.env.example` se actualiza.

| Variable | Obligatoria | Default | Uso |
|----------|-------------|---------|-----|
| `PROPUESTAS_PLACES_API_KEY` | Para buscar | — | Places Text Search. |
| `PROPUESTAS_ENVIO_HABILITADO` | Para enviar | `false` | Gate explícito de envío. |
| `PROPUESTAS_FROM_EMAIL` | Para aprobar/enviar | — | `propuestas@pixelarch.dev`. |
| `PROPUESTAS_FROM_NOMBRE` | No | `PixelArch` | Nombre visible. |
| `PROPUESTAS_REPLY_TO` | Para aprobar/enviar | — | `hola@pixelarch.dev`. |
| `PROPUESTAS_SECRETO` | Para supresión/baja/aprobación | — | HMAC de hash y token (mín. 32 chars). |
| `PROPUESTAS_TEXTO_LEGAL` | Para aprobar/enviar | — | Transcripción legal aprobada. |
| `PROPUESTAS_BASE_LEGAL` | Para aprobar/enviar | — | Base legal documentada por campaña/prospecto. |
| `PROPUESTAS_ETIQUETA_PUBLICIDAD` | No | `true` | Prefijo `[publicidad]`. |
| `PROPUESTAS_CUPO_ENVIOS_DIA` | No | `20` | Cupo duro de envíos. |
| `PROPUESTAS_CUPO_PLACES_DIA` | No | `20` | Requests Places/día. |
| `PROPUESTAS_CUPO_FETCHES_DIA` | No | `100` | Páginas web/día. |
| `PROPUESTAS_CUPO_AUDITORIAS_DIA` | No | `20` | Auditorías/día. |
| `PROPUESTAS_CUPO_BORRADORES_DIA` | No | `20` | Borradores/día. |
| `PROPUESTAS_MAX_ENVIOS_PROSPECTO` | No | `2` | Mensajes por prospecto (inicial + follow-up manual). |
| `PROPUESTAS_PAGINAS_POR_PROSPECTO` | No | `3` | Home + hasta 2 contacto. |
| `PROPUESTAS_COSTO_PLACES_CENTAVOS` | No | `0` | Costo estimado por request; 0 = no estimar. |
| `PROPUESTAS_COSTO_RESEND_CENTAVOS` | No | `0` | Costo estimado por envío. |
| `PROPUESTAS_PRESUPUESTO_MENSUAL_CENTAVOS` | No | `0` | 0 = sin tope monetario; si >0, tope mensual. |
| `PROPUESTAS_RETENCION_MESES` | No | `12` | Retención de prospectos. |
| `PROPUESTAS_LLM_HABILITADO` | No | `false` | Reservado; en v1 cualquier intento LLM falla cerrado. |
| `CRON_SECRET` | Para cron | — | Ya existe; autentica la purga programada. |

Reglas de configuración:

- `configPropuestas()` lee en cada llamada, nunca lanza y devuelve `null`/motivo por pieza faltante.
- `estadoEnvio(cfg)` devuelve `{ ok: false, motivos }` si falta `PROPUESTAS_ENVIO_HABILITADO`, from/reply-to válidos, secreto, URL pública HTTPS, texto legal o base legal.
- Si falta Places, la búsqueda se deshabilita; si falta Resend/from, el envío se deshabilita; si falta el secreto, la supresión por hash y la baja se deshabilitan. El resto del portal sigue funcionando.
- `PROPUESTAS_TEXTO_LEGAL` y `PROPUESTAS_BASE_LEGAL` no se inventan en código: se cargan en Railway tras la revisión legal. Hasta entonces el envío falla cerrado.

---

## 5. Seguridad y privacidad (constitución)

- **§1 Privacidad:** solo datos profesionales publicados o cargados con fuente. No se leen datos del CRM. No se guarda HTML crudo, certificado completo, tarjetas ni secretos. El email se guarda solo en `Prospecto.email` y en el snapshot de `EnvioPropuesta` (necesario para enviar y para el token de baja); en logs y Sentry solo ids, estados y códigos.
- **§1 Supresión:** `SupresionProspecto` guarda HMAC del email normalizado y un email enmascarado opcional; nunca el email en claro para bloquear. La clave única `EMAIL:<hash>`/`DOMINIO:<dominio>` hace la baja idempotente. La supresión no se borra por retención ni por borrar el prospecto; la revocación es una excepción admin con motivo y registro. El estado `SUPRIMIDO` del prospecto se aplica solo si su email actual coincide con el hash suprimido; un opt-out de un email anterior no bloquea por sí solo una dirección nueva de la misma empresa.
- **§1 Tokens:** el token de baja es `v1.<prospectoId>.<emailHash>.<hmac>`; no contiene email ni nombre. `emailHash = HMAC-SHA256(secreto, "email:<normalizado>")` en hex y `hmac = HMAC-SHA256(secreto, "baja:v1:<prospectoId>:<emailHash>")` en base64url. Se verifica con `timingSafeEqual`. No se loguea. La página y el API de baja son genéricos: no revelan si el email existía.
- **§2 Pagos:** el portal no mueve dinero, no toca `Pago`, `EnlacePago`, `AjustePago`, `EventoPasarela` ni pasarelas. No hay FKs ni escrituras al CRM.
- **§3 Calidad:** TypeScript estricto; lógica pura separada de Prisma/red; tests por AC; sin comandos interactivos ni watch. Suite, typecheck, lint y build limpios antes de cerrar, sin errores nuevos sobre el baseline.
- **§3 Esquema:** cambios aditivos con `db push`; sin backfill. Si falta el esquema, el portal falla cerrado (`ESQUEMA_NO_APLICADO`) y no crea datos a medias.
- **§4 UX:** mobile-first, teclado, foco visible, contraste, labels, `aria-current`, errores asociados, modales accesibles y confirmaciones explícitas.
- **§4 SEO:** el portal interno es `noindex`/`no-store`; la página pública de baja también es `noindex`/`no-store` y no se agrega al sitemap.
- **§5 Operaciones:** `/propuestas` y `/api/propuestas/**` se protegen en middleware y en servidor. La asistente recibe redirect/403. No hay `NEXT_PUBLIC_*` nuevas; las envs son server-only. El deploy sigue el orden esquema → código → salud → checklist legal → envío.
- **§6 Dependencias:** no se agregan librerías; `node:crypto`, `node:dns`, `node:tls` y `fetch` son built-in.
- **§7 SDD:** la spec aprobada es la fuente de verdad; cada tarea referencia AC y cada AC tiene test.

### 5.1 Controles concretos

| Riesgo | Control |
|--------|---------|
| Colisión `/propuesta` vs `/propuestas` | Matcher exacto + test de middleware. |
| Asistente accede al portal | Middleware admin-only + guard en página/API + tests con rol asistente. |
| Fuga de datos del CRM | Guard Clerk-only sin Prisma + test estático de imports/consultas + esquema sin FKs. |
| SSRF / DNS rebinding | `normalizeUrl`, `isBlockedHost`, DNS `all`, rechazo de rangos privados, redirecciones manuales, timeout, tamaño y content-type. |
| Prompt injection / HTML hostil | v1 no LLM; render determinista escapa todo; el contenido web se trata como dato; tests con fixtures maliciosos. |
| Doble envío | `Idempotency-Key` + `idempotencyKey` único + `updateMany(APROBADO -> ENVIANDO)` + test de doble clic. |
| Envío sin aprobación | Aprobar y enviar son endpoints distintos; `puedeEnviar` revalida todo; test con spy de Resend. |
| Recontacto a suprimidos | Verificación en creación, antes de aprobar y antes de enviar; hash global; test de reimportación. |
| Sobreconsumo | Cupos diarios en `ConsumoProveedor` + rate limit + alerta 80% + bloqueo 100%; sin cola. |
| PII en logs/Sentry | `redact.ts`, metas solo con ids/códigos, regla de redacción de URLs de baja en Sentry. |
| Retención | Purga diaria con advisory lock, borrado en cascada, supresión intacta; test. |
| Deploy sin esquema | `esErrorTablaFaltante` + 503/estado operativo; orden de deploy documentado. |
| Origen/CSRF | `origenPermitido` en todas las mutaciones + cookies Clerk; sin mutaciones GET. |

---

## 6. Estrategia de pruebas (mapa AC → tipo de test)

### 6.1 Archivos de test

| Archivo | Tipo | Propósito |
|---------|------|-----------|
| `src/__tests__/middleware-propuestas.test.ts` | middleware con Clerk mockeado | Colisión `/propuesta`/`/propuestas`, asistente, APIs, baja pública, headers. |
| `src/__tests__/app/propuestas-auth.test.tsx` | página/layout | Guard Clerk-only, redirects, shell sin CRM. |
| `src/__tests__/lib/propuestas-auth.test.ts` | unitaria con Clerk mockeado | `resolverAdminPropuestas`; no toca Prisma. |
| `src/__tests__/lib/propuestas-schema.test.ts` | inspección de `schema.prisma` | Modelos/enums nuevos, sin FKs al CRM, índices/unique. |
| `src/__tests__/lib/propuestas-aislamiento.test.ts` | estático | Sin `prisma.cliente/pago/...` en el portal; sin `scheduledAt`. |
| `src/__tests__/lib/propuestas-config.test.ts` | unitaria pura | Envs faltantes, defaults, cupos, `estadoEnvio`, sin throws. |
| `src/__tests__/lib/propuestas-normalizar.test.ts` | unitaria pura | Email, dominio registrable, proveedores públicos, extracción. |
| `src/__tests__/lib/propuestas-dedupe.test.ts` | unitaria pura | `placeId`, email exacto, dominio, sucursales, público, no fusión. |
| `src/__tests__/lib/propuestas-supresion.test.ts` | unitaria pura | Hash, clave, contacto, token, idempotencia, dominio público rechazado. |
| `src/__tests__/lib/propuestas-score.test.ts` | unitaria pura | Determinismo, rango 0-100, desglose, datos faltantes. |
| `src/__tests__/lib/propuestas-transiciones.test.ts` | unitaria pura | Estados y `puedeAprobar`/`puedeEnviar`. |
| `src/__tests__/lib/propuestas-plantillas.test.ts` | unitaria pura | Lista blanca, escape, asunto, variables desconocidas, versión. |
| `src/__tests__/lib/propuestas-email.test.ts` | unitaria pura | Footer legal, «publicidad», texto/HTML, `List-Unsubscribe`, sin tracking. |
| `src/__tests__/lib/propuestas-web.test.ts` | unitaria + transporte HTTP mockeado | SSRF, DNS/rebinding, redirects, timeout, tamaño, content-type, robots, UA, email. |
| `src/__tests__/lib/propuestas-auditoria.test.ts` | unitaria + transporte/TLS mockeados | Reutiliza lógica, no llama a `/api/audit`, resumen sin HTML, fallo. |
| `src/__tests__/lib/propuestas-places.test.ts` | unitaria + fetch mockeado | Endpoint, field mask, `place_id`, errores/cuota, sin paginación. |
| `src/__tests__/lib/propuestas-consumo.test.ts` | unitaria + Prisma mockeado | Reserva, cupo, costo, alerta/tope, concurrencia. |
| `src/__tests__/lib/propuestas-retencion.test.ts` | unitaria + Prisma mockeado | Corte 12 meses, cascada, supresión intacta, advisory lock. |
| `src/__tests__/lib/propuestas-privacidad.test.ts` | unitaria con spies | Logs/Sentry sin email, nombre, teléfono, cuerpo, HTML, token ni secreto. |
| `src/__tests__/lib/propuestas-cobertura.test.ts` | meta | AC-1..AC-45 con al menos un archivo de test; sin llamadas reales. |
| `src/__tests__/lib/propuestas-sin-red.test.ts` | guard | Places/Resend/LLM no se llaman sin config o sin mock. |
| `src/__tests__/api/propuestas/campanas.test.ts` | ruta + Prisma/Places mockeados | Crear, ejecutar, doble clic, cupo, error, manual. |
| `src/__tests__/api/propuestas/prospectos.test.ts` | ruta + Prisma/fetch mockeados | Alta manual, corrección con fuente, análisis, supresión. |
| `src/__tests__/api/propuestas/envios.test.ts` | ruta + Prisma/Resend mockeados | Borrador, edición, aprobación, envío, idempotencia, errores, follow-up. |
| `src/__tests__/api/propuestas/supresiones.test.ts` | ruta | Alta, dominio público, revocación con motivo, cancelación. |
| `src/__tests__/api/opt-out.test.ts` | ruta pública | Token válido/inválido, genérico, idempotente, rate limit, headers. |
| `src/__tests__/api/propuestas/arco.test.ts` | ruta | Exportar, eliminar, conservar supresión, registrar. |
| `src/__tests__/app/propuestas-pages.test.tsx` | páginas server/client | Dashboard, ficha, bandeja, plantillas, envíos, supresiones, accesibilidad. |
| `src/__tests__/lib/audit-server.test.ts` | unitaria | Parseo extraído; regresión de `/api/audit` (scores/findings iguales). |

Además:

- `src/__tests__/setup.ts` instala un guard nuevo `guard-propuestas-red.ts` que bloquea `places.googleapis.com`, `api.resend.com` y hosts de LLM; cualquier test que intente salir sin mock falla con un mensaje accionable.
- Los tests de Places/Resend/LLM usan `vi.stubGlobal("fetch", ...)` o mocks de módulo; el fetch web inyecta un transporte `node:https`/`http` mockeado. No hay gasto ni red.
- Los tests de supresión usan emails ficticios y verifican que no queda email en claro.
- Los tests de middleware cubren la función de matcher y la integración.
- Los tests de envío verifican `Idempotency-Key`, `updateMany` y la secuencia única.
- Los tests de prompt injection usan un fixture con instrucciones maliciosas y comprueban que se escapan y no se ejecutan acciones.

### 6.2 Mapa AC → test

| AC | Tipo | Caso / archivo |
|----|------|----------------|
| AC-1 | middleware + página | Anónimo en `/propuestas` → gate/redirect, sin datos (`middleware-propuestas`, `propuestas-auth`). |
| AC-2 | middleware + API | Asistente → redirect `/admin/cobros` en página y `403` en API. |
| AC-3 | página | Admin ve shell propio, sin nav de CRM ni datos de `Cliente`/`Pago`. |
| AC-4 | middleware | `/propuesta` público; `/propuestas` no público; subrutas. |
| AC-5 | middleware + página | `X-Robots-Tag`, `Cache-Control`, metadata `noindex`; logs sin PII. |
| AC-6 | esquema + estático | Sin FKs al CRM; sin consultas `prisma.cliente/pago/...`; sin conversión. |
| AC-7 | API | Crear campaña `BORRADOR` con creador/límites; no envía. |
| AC-8 | Places | URL oficial, field mask, `place_id`, sin scraping/paginación. |
| AC-9 | web | Host privado, loopback, `.local`, puerto, redirect, timeout, tamaño, no HTML, robots, UA. |
| AC-10 | web + plantillas | Texto hostil se escapa; no ejecuta acciones; no filtra secretos. |
| AC-11 | campaña | Cupo alcanzado corta; no hay requests extra. |
| AC-12 | Places | `429/5xx/timeout` → PARCIAL/FALLIDA, conserva lo obtenido, sin bucle. |
| AC-13 | API | Alta manual exige fuente/nota; no hay endpoint de importación masiva. |
| AC-14 | dedupe | `placeId`, email exacto, dominio, sucursal, proveedor público, no fusión. |
| AC-15 | supresión | Email/dominio suprimido bloquea crear/aprobar/enviar. |
| AC-16 | supresión + API | Opt-out cancela BORRADOR/APROBADO y bloquea intentos. |
| AC-17 | retención | Borrar prospecto conserva supresión; reimportación bloqueada por hash. |
| AC-18 | API | Supresión manual exige motivo; dominio público rechazado. |
| AC-19 | web + API | Solo email publicado/cargado; sin patrón; sin email no se envía. |
| AC-20 | auditoría | Reutiliza lógica, no `/api/audit`; resumen con fecha, sin HTML. |
| AC-21 | score | Determinista, 0-100, desglose, faltantes sin inventar. |
| AC-22 | plantillas + API | Borrador con plantilla/datos/auditoría; sin claims; estado BORRADOR. |
| AC-23 | API | `modo: "LLM"` sin proveedor → 503, sin fila parcial; score intacto. |
| AC-24 | API | Editar aprobado → versión nueva; anterior cancelada; no se envía. |
| AC-25 | API | Aprobar guarda snapshot/aprobador; Resend no llamado. |
| AC-26 | API | Enviar una sola llamada con `Idempotency-Key`; doble clic no duplica. |
| AC-27 | transiciones + API | Sin aprobación/suprimido/sin email/cupo/hash distinto → rechazo. |
| AC-28 | API | Error Resend → FALLIDO, código sanitizado, sin auto-retry. |
| AC-29 | API | Éxito → ENVIADO + messageId + snapshot; logs sin PII. |
| AC-30 | estático + API | Sin scheduler/cola/`scheduledAt`; aprobado sin confirmar no envía. |
| AC-31 | API | Follow-up exige nuevo borrador/aprobación; máx. 2; cupo sin cola. |
| AC-32 | email | Identificación, asunto veraz, baja, aviso, texto legal, «publicidad», texto plano. |
| AC-33 | página + API | Baja sin login, token opaco, página genérica, idempotente. |
| AC-34 | email + API | `List-Unsubscribe`/`-Post`; POST one-click 200/202. |
| AC-35 | API | Opt-out global inmediato; próximo envío bloqueado. |
| AC-36 | API | Rebote/queja manual → supresión, sin retry, trazabilidad. |
| AC-37 | API | ARCO exporta/elimina; supresión conservada; acción registrada. |
| AC-38 | consumo + UI | Consumo por campaña/proveedor/día visible. |
| AC-39 | consumo | Umbral 80% avisa; 100% bloquea; sin cola. |
| AC-40 | retención | 12 meses → borra prospecto/borradores/envíos; supresión intacta. |
| AC-41 | privacidad | Logs/Sentry sin email, nombre, teléfono, cuerpo, HTML, token ni secreto. |
| AC-42 | config + API | Falta Places/Resend/LLM/secreto → deshabilitado, fallo cerrado. |
| AC-43 | esquema | `db push` aditivo, sin backfill, sin FKs al CRM. |
| AC-44 | cobertura | Cada AC-1..AC-43 tiene al menos un test; suite sin red real. |
| AC-45 | regresión | Suite completa, typecheck, lint y build sin errores nuevos. |

### 6.3 Regresión

- No se modifica ningún test existente de CRM, clientes, cobros, pagos, PayPal, Mercado Pago, auth ni landing. El único archivo existente que se toca es `src/middleware.ts` (más su test) y `src/app/api/audit/route.ts` (extracción de parseo, con regresión).
- `middleware-auth.test.ts` debe seguir verde; se agrega `middleware-propuestas.test.ts` sin cambiar las expectativas actuales.
- `audit.test.ts` sigue cubriendo las funciones puras; `audit-server.test.ts` cubre el parseo extraído y la ruta pública conserva scores/findings.
- La suite no hace llamadas reales a Google, Resend ni LLM. El guard nuevo se suma al de pasarelas.
- Baseline de lint: 18 errores/18 warnings preexistentes; no se introducen nuevos. Typecheck y build deben quedar limpios.

---

## 7. Impacto en despliegue, datos y migraciones

### 7.1 Esquema y datos

- **Aditivo:** se crean 6 tablas y 8 enums nuevos; no se alteran columnas existentes ni se hace backfill.
- Comando local (si `npx` falla): `node node_modules\prisma\build\index.js db push`; luego `node node_modules\prisma\build\index.js generate`.
- Antes de `db push` en producción: `pg_dump` de respaldo (operativo, no lo ejecuta el código).
- Verificación posterior: las tablas existen, no hay FKs a `Cliente`/`Pago`, y los tests de esquema pasan.
- Si el esquema no está aplicado, el portal muestra un estado operativo (`ESQUEMA_NO_APLICADO`) y las APIs responden 503; no se crean datos a medias.

### 7.2 Envs y build

- Todas las envs nuevas son server-only; no hay `NEXT_PUBLIC_*`.
- No se toca `Dockerfile` ni `package.json`; no hay dependencias nuevas.
- `.env.example` se actualiza con las variables y los valores de remitente/reply-to acordados.
- Railway: cargar `PROPUESTAS_PLACES_API_KEY`, `PROPUESTAS_SECRETO`, `PROPUESTAS_TEXTO_LEGAL`, `PROPUESTAS_BASE_LEGAL`, from/reply-to y cupos. Mantener `PROPUESTAS_ENVIO_HABILITADO=false` hasta el checklist legal.
- `CRON_SECRET` ya existe; se reutiliza para la purga.

### 7.3 Orden de despliegue

1. **Staging:** `db push` → deploy → health → el portal abre solo para admin. `NEXT_PUBLIC_URL` debe apuntar al dominio de staging para que el origin check de las APIs acepte las mutaciones; si no, se rechazan por seguridad.
2. **Staging en seco:** búsqueda Places acotada (1 campaña, 2 resultados), análisis de un sitio controlado, auditoría, score, borrador, aprobación. `PROPUESTAS_ENVIO_HABILITADO=false`; cargar un `PROPUESTAS_TEXTO_LEGAL` de prueba solo en staging (marcado como tal) para poder aprobar; verificar que el botón de enviar está deshabilitado y que Resend no se llama. En producción, la aprobación se habilita junto con el checklist legal; antes de eso el portal permite buscar/analizar/puntuar/borrar borradores, pero no aprobar un email no enviable.
3. **Staging con envío controlado:** habilitar envío, enviar a una dirección propia, verificar message ID, headers `List-Unsubscribe`, baja one-click y supresión. Volver a `false` si no se sigue probando.
4. **Checklist legal:** texto legal, base legal, SPF/DKIM/DMARC, AAIP/transferencia internacional, retención y canal ARCO. Firmar en `specs/004-propuestas/legal-checklist.md` (lo produce el planner con el dueño).
5. **Producción:** `pg_dump` → `db push` → deploy → health → `PROPUESTAS_ENVIO_HABILITADO=false` → smoke de portal (búsqueda/análisis/borrador/aprobación) → habilitar envío → primer envío a dirección propia → monitorear.
6. **Post-deploy:** revisar logs (sin PII), cupos, supresiones y `/api/health`. No hay pago ni migración de datos.

### 7.4 Rollback

- **Apagado inmediato:** `PROPUESTAS_ENVIO_HABILITADO=false` (no envía nada) y, si hace falta, revertir el deploy.
- **Datos:** las tablas son aditivas; se conservan. No se borran supresiones ni prospectos para “volver atrás”.
- Si se revierte el código, el esquema puede quedar; una nueva versión lo reutiliza. No hay migración inversa.
- Si un envío quedó `ENVIANDO`, el admin puede marcarlo `FALLIDO` con una nota tras verificar en Resend; no hay auto-retry.

### 7.5 Operación y cron

- **Purga de retención:** Railway Function `propuestas-retencion` (cron `0 4 * * *`, UTC) llama a `GET /api/cron/propuestas-retencion` con `Authorization: Bearer $CRON_SECRET`. Alternativa: botón admin `POST /api/propuestas/retencion`.
- **Advisory lock:** `pg_try_advisory_xact_lock(hashtext('PROPUESTAS_RETENCION'))` para evitar solapamientos; si no se obtiene, responde 200 `{ omitido: true }`.
- **Logs 30 días:** verificar la retención de logs de Railway y documentarla; la evidencia durable de aprobaciones/envíos/supresiones vive en la base, no en logs.
- **Monitoreo:** Sentry con redacción de URLs de baja y sin PII; alertas de errores 5xx del portal.

### 7.6 Gate de staging antes de producción

Checklist mínimo (sin código):

- [ ] Esquema aplicado en staging; `db push` sin errores; tests de esquema verdes.
- [ ] `/propuesta` sigue público y `/propuestas` no; asistente denegada; APIs 401/403.
- [ ] Búsqueda real acotada con Places (máximo 2 resultados) y field mask verificado en logs de red (sin persistir nombre/address).
- [ ] Fetch de un sitio controlado: email publicado, fuente/fecha, auditoría, score; sin HTML persistido.
- [ ] Borrador por plantilla, aprobación y envío a dirección propia con `PROPUESTAS_ENVIO_HABILITADO=true`; message ID; headers de baja.
- [ ] Baja one-click: página pública, POST 200/202, supresión por hash, prospecto SUPRIMIDO, pendientes cancelados.
- [ ] Reimportación del mismo email: bloqueada por hash; supresión visible.
- [ ] Cupo de envíos: el intento 21 responde 429 y no encola.
- [ ] Retención en seco: `eliminados=0` sobre datos recientes; un prospecto de prueba viejo se borra y la supresión queda.
- [ ] Logs/Sentry sin PII ni tokens; `noindex`/`no-store`.
- [ ] Rollback probado: `PROPUESTAS_ENVIO_HABILITADO=false` deshabilita el envío.

---

## 8. Riesgos

| ID | Riesgo | Impacto | Mitigación |
|----|--------|---------|------------|
| R-1 | El patrón `/propuesta(.*)` sigue matcheando `/propuestas` y el portal queda público. | Crítico | Cambiar a `/propuesta` exacto + `/propuesta/(.*)`; test de middleware con anónimo, asistente y admin. |
| R-2 | `requireAdmin()`/`requireStaff()` filtran datos de `Cliente`. | Alto | Guard Clerk-only; test estático de imports y consultas; revisión de reviewer. |
| R-3 | SSRF/DNS rebinding en el fetch web. | Alto | `isBlockedHost` + DNS `all` + rangos privados + `lookup` validador en el connect (`node:https`/`http`) + redirecciones manuales + timeout/tamaño/content-type. |
| R-4 | Persistir contenido de Places fuera de sus términos. | Alto | Solo `place_id` + URL; nombre/address/rating transitorios; field mask mínimo; revisión legal. |
| R-5 | Doble envío por doble clic, timeout o reintento. | Alto | `Idempotency-Key`, unique, transición atómica, sin auto-retry; aviso de reconciliación manual en Resend. |
| R-6 | Enviar sin aprobación o con contenido cambiado. | Crítico | Endpoints separados; snapshot + hash; `puedeEnviar` revalida; tests con spy de Resend. |
| R-7 | Recontactar a un suprimido. | Crítico | Verificación en 3 puntos; hash global; supresión independiente del prospecto; tests de reimportación. |
| R-8 | Rotación de `PROPUESTAS_SECRETO` invalida tokens de borradores aprobados. | Medio | Comparar `tokenBaja` con el recalculado al enviar; si no coincide, 409 y re-aprobación. Documentar. |
| R-9 | El token de baja aparece en logs/Sentry (URL). | Medio | Redacción de `/propuestas/baja/` y `/api/opt-out` en Sentry; no loguear URLs; token solo permite baja. |
| R-10 | Timeout de Railway en un análisis con 3 fetches + auditoría. | Medio | Fase B acotada a 1 prospecto por request; 8 s fetch, 12 s auditoría; cliente secuencial. |
| R-11 | Cupos en memoria no distribuidos. | Medio | `ConsumoProveedor` en base es la fuente autoritativa; rate limit en memoria es defensa adicional; documentar. |
| R-12 | Retención borra evidencia de aprobaciones. | Bajo/Medio | Decisión Q-5: 12 meses; logs 30 días; la supresión permanece. Documentar en el runbook. |
| R-13 | Extracción de email con falsos positivos. | Medio | `mailto:` primero, misma fuente publicada, rechazo de ruido; el admin ve la fuente y aprueba; sin adivinar patrones. |
| R-14 | El texto legal no está aprobado y se envía igual. | Alto | `PROPUESTAS_ENVIO_HABILITADO=false` por defecto; `estadoEnvio` exige texto/base legal; gate de staging + checklist. |
| R-15 | Deploy antes de aplicar el esquema. | Alto | Orden `db push` → deploy; `esErrorTablaFaltante` + 503; checklist de release. |
| R-16 | Regresión en `/api/audit` por la extracción de parseo. | Medio | Extracción pura + test de regresión con fixtures; la ruta conserva rate limit, UA y timeout. |
| R-17 | El asistente accede por una ruta nueva no cubierta. | Alto | Middleware admin-only + guard en cada página/API; test con asistente en todas las rutas. |
| R-18 | Lint/build rompen por el nuevo route group o imports server-only. | Medio | `runtime = "nodejs"` en APIs; no importar `node:*` en componentes cliente; build local antes del deploy. |

---

## 9. Orden de implementación

| Fase | Tareas | Resultado |
|------|--------|-----------|
| 0. Fundaciones | T-01 a T-04 | Middleware, auth, esquema, config. |
| 1. Dominio puro | T-05 a T-08 | Normalización, dedupe, supresión, score, transiciones, plantillas, email. |
| 2. Integraciones | T-09 a T-11 | Auditoría, web, Places, consumo. |
| 3. Portal y APIs | T-12 a T-18 | Campañas, análisis, borradores, aprobación, envío. |
| 4. Cumplimiento y operación | T-19 a T-22 | Baja, supresiones, cupos, retención/ARCO. |
| 5. Cierre | T-23 a T-27 | Privacidad/cobertura, docs/runbook, verificación, gate de staging, gate de producción. |

Dependencias:

- T-01 y T-03 pueden ir en paralelo; T-02 depende de T-01; T-04 depende de T-03.
- T-05 depende de T-04; T-06 de T-05; T-07 de T-05/T-06; T-08 de T-07.
- T-10 depende de T-05; T-09 de T-05/T-10; T-11 de T-04/T-05.
- T-12 depende de T-03/T-04/T-05/T-11; T-13 de T-11/T-12; T-14 de T-05/T-12; T-15 de T-09/T-10/T-14.
- T-16 de T-08/T-15; T-17 de T-16; T-18 de T-17.
- T-19/T-20/T-22 de T-06/T-18; T-21 de T-11/T-18.
- T-23 de T-19..T-22; T-24 de T-23; T-25 de T-24; T-26 de T-25; T-27 de T-26 + checklist legal firmado + autorización del dueño.

---

## 10. Fuera de alcance de este plan

- LLM real, proveedor, prompts y costos: mejora posterior con su propia spec.
- Webhooks de Resend (rebotes/quejas): v1 manual.
- Conversión a `Cliente`, portal de clientes, CRM o pagos.
- Envío por lote, scheduler, secuencias, follow-ups automáticos, tracking de aperturas/clics.
- Scraping de Google Maps/buscadores/redes, compra de listas, verificación externa de emails.
- Rate limiting distribuido, Redis, colas persistentes o workers.
- Cambios en `Dockerfile`, `package.json`, `NEXT_PUBLIC_*` o la landing pública.

