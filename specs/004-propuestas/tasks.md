# Tareas 004: Portal de propuestas y prospección asistida

**Spec:** ./spec.md (aprobada 2026-11-10)
**Plan:** ./plan.md
**Regla:** una tarea = un cambio revisable (~1 commit). Cada tarea indica AC, archivos probables, dependencias, tests y cierre tester+reviewer.
**Gate:** ninguna tarea de envío real se habilita sin `PROPUESTAS_ENVIO_HABILITADO=true`, checklist legal y gate de staging (T-26). T-27 (producción) requiere aprobación explícita del dueño.
**Baseline:** suite 1644/1644 en 85 archivos; TypeScript 0 errores; lint 18/18 preexistente. No introducir errores nuevos.

Formato de cierre por tarea:

```
Cierre: tester <tests que corre> · reviewer <foco de revisión> · 1 commit
```

---

## Fase 0: Fundaciones

- [x] **T-01 (AC-1, AC-4, AC-5; RF-3) — Corregir el middleware y los headers del portal.**
  - Cambiar `ROUTES.public`: reemplazar `"/propuesta(.*)"` por `"/propuesta"` y `"/propuesta/(.*)"`; agregar `"/propuestas/baja"`, `"/propuestas/baja/(.*)"`, `"/api/opt-out"`.
  - Agregar `admin: ["/admin(.*)", "/propuestas", "/propuestas/(.*)"]` y `apiAdmin: ["/api/propuestas(.*)"]`.
  - Orden: public → apiAdmin → admin → next. `apiAdmin` responde 401/403 JSON, sin gate.
  - Headers `X-Robots-Tag: noindex, nofollow` y `Cache-Control: no-store` para `/propuestas`, `/api/propuestas` y `/api/opt-out`.
  - Archivos: `src/middleware.ts`; `src/__tests__/middleware-propuestas.test.ts`; ajustar `src/__tests__/middleware-auth.test.ts` solo si el refactor lo exige.
  - Depende: —.
  - Tests: `/propuesta` y `/propuesta/x` públicos; `/propuestas` anónimo no público; asistente redirect; admin pasa; baja pública; `/api/opt-out` público; `/api/propuestas/campanas` 401 anónimo, 403 asistente, pasa admin; headers.
  - Cierre: tester (`node node_modules\vitest\vitest.mjs run src/__tests__/middleware-propuestas.test.ts src/__tests__/middleware-auth.test.ts`) · reviewer (seguridad de rutas, regresión de `/propuesta`) · 1 commit.
  - PASS tester+reviewer: 120 tests, tsc 0; /propuesta exacta pública, /propuestas admin, baja/opt-out públicos, APIs 401/403, headers; sin regresión /admin//pago.

- [x] **T-02 (AC-1, AC-2, AC-3, AC-5, AC-6; RF-1, RF-2, RF-4, RF-8) — Guard Clerk-only y shell del portal.**
  - Crear `resolverAdminPropuestas()` sin importar Prisma ni consultar `Cliente`; devuelve `SIN_SESION`/`NO_ADMIN` (con `esAsistente` para el redirect) o admin.
  - Crear `src/app/(propuestas)/layout.tsx` con redirect a `/gate/admin?next=/propuestas` (sin sesión) o `/admin/cobros` (asistente), y shell propio sin navegación de CRM.
  - Crear `portal-shell.tsx`, `portal-sidebar.tsx` (con `aria-current`), `estado-vacio.tsx` y dashboard vacío en `src/app/(propuestas)/propuestas/page.tsx`; metadata `robots: { index: false, follow: false }` en las páginas internas; fechas de UI con `Intl.DateTimeFormat("es-AR")` sobre datos UTC.
  - Si `esErrorTablaFaltante` al consultar, mostrar un estado operativo `ESQUEMA_NO_APLICADO` sin formularios ni datos (fallar cerrado).
  - Archivos: `src/lib/propuestas/auth.ts`; `src/app/(propuestas)/layout.tsx`; `src/app/(propuestas)/propuestas/page.tsx`; `src/components/propuestas/portal-shell.tsx`, `portal-sidebar.tsx`, `estado-vacio.tsx`; tests `src/__tests__/lib/propuestas-auth.test.ts`, `src/__tests__/app/propuestas-auth.test.tsx`, `src/__tests__/app/propuestas-pages.test.tsx` (dashboard/shell).
  - Depende: T-01.
  - Tests: anónimo → gate; asistente → `/admin/cobros`; admin → shell; Clerk lanza/falla → gate o redirect sin datos; el helper no importa Prisma; no se renderiza nav de CRM; headers de página; esquema faltante → estado operativo.
  - Cierre: tester (`propuestas-auth.test.ts`, `propuestas-auth.test.tsx`) · reviewer (aislamiento CRM, auth, accesibilidad del shell) · 1 commit.
  - PASS tester+reviewer: guard Clerk-only, shell/sidebar sin CRM, dashboard fail-closed, no emails; spec-coverage 001 excluye tests 004.

- [x] **T-03 (AC-6, AC-43; RF-62) — Esquema Prisma aditivo y tests de aislamiento.**
  - Agregar enums y modelos `CampanaProspeccion`, `Prospecto`, `PlantillaPropuesta`, `EnvioPropuesta`, `SupresionProspecto`, `ConsumoProveedor` del plan §4.1.
  - Índices/unique: `placeId`, `email`, `idempotencyKey`, `proveedorMessageId`, `(prospectoId, secuencia, version)`, `clave` de supresión, `(campanaId, proveedor, fecha)`.
  - Sin FKs ni relaciones a `Cliente`, `Pago`, `Suscripcion`, `EnlacePago`, `Proyecto`, `Hito`.
  - Archivos: `prisma/schema.prisma`; tests `src/__tests__/lib/propuestas-schema.test.ts`, `src/__tests__/lib/propuestas-aislamiento.test.ts`.
  - Depende: — (puede ir en paralelo con T-01/T-02).
  - Tests: modelos/enums presentes; sin relaciones al CRM; unique/índices; sin `scheduledAt`; el test estático no encuentra `prisma.cliente/pago/...` en el portal.
  - Cierre: tester (`propuestas-schema.test.ts`, `propuestas-aislamiento.test.ts`) · reviewer (esquema aditivo, datos, sin backfill) · 1 commit.
  - PASS tester+reviewer: schema aditivo 6 modelos/8 enums, sin FK al CRM; generate/validate OK; db push pendiente en T-26/T-27.

- [x] **T-04 (AC-42; RF-8, RF-46, RF-63) — Configuración, errores y `.env.example`.**
  - `configPropuestas()`: lectura en cada llamada, defaults del plan §4.7, cupos positivos, `estadoEnvio()` con motivos, `null` por pieza faltante; nunca lanza.
  - `errores.ts`: códigos, `esErrorTablaFaltante`, `sanitizarError`; `origen.ts`: `origenPermitido(req, urlPublica)`.
  - Actualizar `.env.example` con todas las variables server-only y los valores `propuestas@pixelarch.dev` / `hola@pixelarch.dev`.
  - Archivos: `src/lib/propuestas/config.ts`, `errores.ts`, `origen.ts`, `.env.example`; test `src/__tests__/lib/propuestas-config.test.ts`.
  - Depende: T-03.
  - Tests: sin envs → piezas deshabilitadas y motivos; defaults 20/20/100/20/20/2/3/12; from/reply/URL/secreto/texto/base legal requeridos para aprobar y enviar; origen same-origin acepta, cross-site rechaza; `esErrorTablaFaltante` con `P2021`.
  - Cierre: tester (`propuestas-config.test.ts`) · reviewer (fail-closed, secretos, sin `NEXT_PUBLIC_*`) · 1 commit.
  - PASS tester+reviewer: config fail-closed, defaults, sanitización, origen same-origin, envs server-only y gate false.

---

## Fase 1: Dominio puro

- [x] **T-05 (AC-14, AC-19; RF-14, RF-19, RF-22) — Normalización, dedupe y extracción de datos públicos.**
  - `normalizarEmail` (lowercase/trim, sin adivinar), `normalizarDominio`, `dominioRegistrable` con sufijos comunes (`com.ar`, `com.br`, `co.uk`, etc.), `esProveedorPublico`, `esHostNoProspectable` (redes sociales, marketplaces, agregadores, link-in-bio).
  - `evaluarDedupe`: `placeId` exacto → reutilizar; email exacto → reutilizar; dominio de negocio distinto `placeId` → nuevo + `posibleDuplicadoDeId`; nunca dedupe por proveedor público.
  - `extraerEmailPublicado` (mailto primero, luego texto; rechaza ruido), `extraerTelefonoPublicado` (solo `tel:`), `limpiarNombreNegocio` (title/og:site_name, fallback host).
  - Archivos: `src/lib/propuestas/normalizar.ts`, `dedupe.ts`; tests `src/__tests__/lib/propuestas-normalizar.test.ts`, `src/__tests__/lib/propuestas-dedupe.test.ts`.
  - Depende: T-04.
  - Tests: emails válidos/inválidos; dominios multi-parte; `com.ar`/`co.uk` solos → null (nunca un sufijo público como dominio); Gmail/Hotmail/Outlook/Yahoo/iCloud rechazados como dominio de negocio; Facebook/Instagram/LinkedIn/TikTok/Linktree rechazados como sitio; dedupe por cada señal; sucursal; público; no fusión automática; extracción sin patrón inventado.
  - Cierre: tester (`propuestas-normalizar.test.ts`, `propuestas-dedupe.test.ts`) · reviewer (privacidad, precisión de dedupe) · 1 commit.
  - PASS tester+reviewer: normalización, PSL curada, proveedores públicos, hosts no prospectables, extracción email/tel y dedupe; 46 tests, tsc 0.

- [x] **T-06 (AC-15, AC-16, AC-17, AC-18, AC-33, AC-34, AC-35, AC-36; RF-23..28, RF-51, RF-52) — Supresión por hash, token de baja y contactabilidad.**
  - `hashEmail` HMAC-SHA256 con `PROPUESTAS_SECRETO`; `claveSupresionEmail`/`claveSupresionDominio`; `emailEnmascarado`.
  - `evaluarContactabilidad` para email y dominio; dominio público nunca suprime.
  - `crearTokenBaja`/`verificarTokenBaja` con formato `v1.<prospectoId>.<emailHash>.<hmac>`, `timingSafeEqual`; sin PII y sin persistencia obligatoria.
  - Archivos: `src/lib/propuestas/supresion.ts`; test `src/__tests__/lib/propuestas-supresion.test.ts`.
  - Depende: T-05.
  - Tests: hash estable/distinto con otro secreto; no queda email en claro; token válido, tamper, formato inválido; idempotencia de clave; dominio público o sufijo público (`com.ar`) rechazado; email suprimido bloquea; supresión sobrevive a borrar prospecto (fixture).
  - Cierre: tester (`propuestas-supresion.test.ts`) · reviewer (criptografía, PII, cumplimiento) · 1 commit.
  - PASS tester+reviewer: HMAC/claves, supresión email/dominio, token de baja, públicos/multiinquilino, sin PII/red/Prisma; 86 tests, tsc 0.

- [x] **T-07 (AC-21, AC-24, AC-27, AC-31; RF-33, RF-38, RF-42..45) — Score, transiciones y permisos.**
  - `calcularScore` v1 con los 5 componentes del plan §4.4, clamp 0-100, desglose y motivos; sin fechas/azar.
  - `puedeAprobar` y `puedeEnviar` con los guardas del plan §4.2; `siguienteSecuencia` y máximo de mensajes.
  - Archivos: `src/lib/propuestas/score.ts`, `transiciones.ts`; tests `src/__tests__/lib/propuestas-score.test.ts`, `src/__tests__/lib/propuestas-transiciones.test.ts`.
  - Depende: T-05, T-06.
  - Tests: mismos inputs → mismo score; rango; datos faltantes no inventan; sin auditoría → 0 con motivo; aprobar sin email/suprimido → motivos; enviar sin hash/estado/cupo → motivos; editar aprobado invalida; follow-up respeta máximo 2.
  - Cierre: tester (`propuestas-score.test.ts`, `propuestas-transiciones.test.ts`) · reviewer (reglas de negocio, explicabilidad) · 1 commit.
  - PASS tester+reviewer: score v1 determinista, puedeAprobar/puedeEnviar, edición versionada, secuencias; 74 tests, tsc 0.

- [x] **T-08 (AC-22, AC-32, AC-34; RF-34, RF-37, RF-47, RF-52, RF-53) — Plantillas, render determinista y email legal.**
  - `plantillas.ts`: lista blanca de variables, validación, render con escape HTML, asunto sin CR/LF, máximo 120, error ante variable desconocida.
  - `email.ts`: HTML/texto, footer legal, identificación, fuente, ARCO, enlace visible, `List-Unsubscribe`/`-Post`, prefijo `[publicidad]` si aplica; sin tracking ni adjuntos.
  - `legal.ts`: estructura del aviso; el texto literal sale de `PROPUESTAS_TEXTO_LEGAL`.
  - Archivos: `src/lib/propuestas/plantillas.ts`, `email.ts`, `legal.ts`; tests `src/__tests__/lib/propuestas-plantillas.test.ts`, `src/__tests__/lib/propuestas-email.test.ts`.
  - Depende: T-07.
  - Tests: variables conocidas/desconocidas; escape de `<script>` e instrucciones hostiles; asunto con `\r\n` rechazado/limpiado y sin prefijos falsos `Re:`/`Fwd:`; footer con aviso/ARCO/fuente; «publicidad» sin duplicar; headers RFC 8058; texto plano equivalente; sin píxeles/adjuntos.
  - Cierre: tester (`propuestas-plantillas.test.ts`, `propuestas-email.test.ts`) · reviewer (contenido legal, XSS, headers) · 1 commit.
  - PASS tester+reviewer: plantillas, email HTML/texto, legal, List-Unsubscribe, token; 54 tests, tsc 0.

---

## Fase 2: Integraciones

- [x] **T-09 (AC-20; RF-31, RF-32) — Extraer la auditoría y crear la auditoría interna.**
  - Extraer de `/api/audit` el parseo puro a `src/lib/audit-server.ts` (`analizarHtmlAudit`) y el helper TLS; la ruta pública conserva rate limit 8/h, UA, timeout y respuesta.
  - `src/lib/propuestas/auditoria.ts`: usa `fetchHtmlSeguro` + `analizarHtmlAudit`; reutiliza el HTML/headers del home ya obtenido en el análisis; guarda `{ scores, findings, finalUrl, fecha, estado }`; no HTML; no llama a `/api/audit`.
  - Archivos: `src/lib/audit-server.ts`; `src/app/api/audit/route.ts`; `src/lib/propuestas/auditoria.ts`; tests `src/__tests__/lib/audit-server.test.ts`, `src/__tests__/lib/propuestas-auditoria.test.ts`.
  - Depende: T-05, T-10.
  - Tests: regresión de scores/findings; la auditoría interna no hace fetch a `/api/audit`; resumen sin HTML; fallo → `FALLIDA`; una auditoría por prospecto/24 h; timeout.
  - Cierre: tester (`audit-server.test.ts`, `propuestas-auditoria.test.ts`, `audit.test.ts`) · reviewer (regresión `/api/audit`, SSRF, PII) · 1 commit.
  - PASS tester+reviewer: 60 tests verdes (27 `audit-server` + 20 `propuestas-auditoria` + 13 `audit` existentes), tsc 0 errores; reviewer PASS. Deuda menor: falta un caso HTTPS/TLS en la regresión de la ruta; algunas comparaciones de tests son tautológicas; en HTTP se duplica el hallazgo de HTTPS (15 vs tope 14); cerrar el socket si `getPeerCertificate` lanza; T-15 debe distinguir «no se pudo verificar TLS» de «certificado inválido»/fallo `TLS` del fetch.

- [x] **T-10 (AC-9, AC-10, AC-19; RF-13, RF-14, RF-16) — Fetch web seguro, robots y extracción.**
  - `fetchHtmlSeguro` con `normalizeUrl`/`isBlockedHost`, DNS `all`, rechazo de rangos privados/loopback/link-local/multicast, puertos 80/443, sin credenciales, redirects manuales máx. 3, timeout 8 s, 1 MB, solo HTML, sin cookies/JS/referrer. Usa `node:https`/`node:http` con `lookup` validador en el connect para cerrar DNS rebinding (no el `fetch` global).
  - `robots.txt` con parser puro y cache 24 h; UA `PixelArchProspectBot/1.0 (+https://pixelarch.dev/propuestas; contacto: hola@pixelarch.dev)`.
  - `descubrirPaginasContacto` (máx. 2, mismo dominio registrable) y extracción de email/teléfono/nombre; motivos `SIN_WEB`, `DNS`, `ROBOTS`, `LOGIN`, `TIMEOUT`, `TAMANIO`, `NO_HTML`, `HTTP`, `SIN_EMAIL`.
  - Archivos: `src/lib/propuestas/web.ts`; test `src/__tests__/lib/propuestas-web.test.ts`.
  - Depende: T-05.
  - Tests: host privado/loopback/`.local`/puerto/credenciales → rechazo; redirect a host privado o a otro dominio → rechazo; DNS que cambia a IP privada en el connect → rechazo; host social/agregador → rechazo; login/password → rechazo; timeout/tamaño/content-type/encoding; robots allow/disallow/404/403; UA; email `mailto` vs texto visible (sin `<script>`/`<style>`); sin JS/assets/social; fixture de prompt injection se trata como texto.
  - Cierre: tester (`propuestas-web.test.ts`) · reviewer (SSRF, red, parsing) · 1 commit.
  - PASS tester+reviewer: 90 tests verdes en `src/__tests__/lib/propuestas-web.test.ts`, tsc 0 errores; reviewer PASS con observaciones (sin test directo del transporte real; presupuesto DNS+request puede sumar ~2×8 s; rangos IPv6 especiales poco frecuentes y duplicación menor de `quitarRuidoHtml` quedan como deuda menor).

- [x] **T-11 (AC-8, AC-11, AC-12, AC-38, AC-39; RF-10, RF-11, RF-17, RF-57, RF-58) — Cliente Places y cupos/costos.**
  - `places.ts`: endpoint oficial, `X-Goog-Api-Key`, field mask `places.id,places.displayName.text,places.websiteUri`, body `textQuery/languageCode/regionCode/pageSize`, sin paginación ni detalles.
  - Mapear `400/401/403/429/5xx/timeout` a códigos; sin reintentos en bucle.
  - `consumo.ts`: `evaluarCupo` puro; `reservarCupo` con `pg_advisory_xact_lock` por `(proveedor, fecha)`, upsert de `ConsumoProveedor` con `clave` por campaña/prospecto/proveedor/día, tope global, costo opcional y presupuesto mensual; `estadoCupos`.
  - Archivos: `src/lib/propuestas/places.ts`, `consumo.ts`; tests `src/__tests__/lib/propuestas-places.test.ts`, `src/__tests__/lib/propuestas-consumo.test.ts`.
  - Depende: T-04, T-05.
  - Tests: URL/método/headers/body exactos; field mask; `place_id`; 429 corta sin retry; 5xx/timeout; cupo 20/día bloquea la 21; 80% alerta; 100% bloquea; costo en centavos; concurrencia simulada.
  - Cierre: tester (`propuestas-places.test.ts`, `propuestas-consumo.test.ts`) · reviewer (términos Places, costos, concurrencia) · 1 commit.
  - PASS tester+reviewer: 136 tests verdes (70 consumo + 66 places), tsc 0 errores; reviewer PASS. Handoff/deuda menor: T-13/T-15 deben envolver `reservarCupo` en `prisma.$transaction` (si pasan el singleton los locks no protegen); los overrides de `capDiario`/`capCampana` son solo para tests/dev y las rutas deben usar la config como hard cap; `llamadas` vs `unidades` a definir en T-13/T-15; evaluar índice `[fecha]` para la consulta mensual; T-13 debe mapear errores de validación a 400/503; validar en staging (T-26) el advisory lock de un argumento; deadlock residual solo si se mezclan reservas con presupuesto 0 y >0 o sin presupuesto con claves diarias invertidas.

---

## Fase 3: Portal y APIs

- [x] **T-12 (AC-7, AC-14; RF-9, RF-12) — Alta de campaña y página `/propuestas/buscar`.**
  - `POST /api/propuestas/campanas`: Zod, guard admin, origen, rate limit, `idempotencyKey` único; crea `BORRADOR` con creador, límites y plantilla opcional; si la clave se repite, reutiliza la campaña existente (200 `reutilizada: true`), no crea otra.
  - Página `/propuestas/buscar` con formulario (`nombre`, `consulta`, `zona`, `rubro`, `limiteCorrida` 1-20, plantilla) y aviso de que crear no busca ni envía; el servidor guarda `filtros.soloConWeb=true` (v1 no crea prospectos de Places sin web).
  - Componentes `campana-form.tsx`; estados vacíos/errores accesibles.
  - Archivos: `src/app/api/propuestas/campanas/route.ts`; `src/app/(propuestas)/propuestas/buscar/page.tsx`; `src/components/propuestas/campana-form.tsx`; `src/lib/propuestas/validation.ts`; test `src/__tests__/api/propuestas/campanas.test.ts`.
  - Depende: T-03, T-04, T-05, T-11.
  - Tests: 201 BORRADOR; doble submit con misma clave → una sola campaña (200 reutilizada); sin sesión 401; asistente 403; origen inválido 403; validación de límites; rate limit por admin/IP; no llama a Places ni Resend.
  - Cierre: tester (`campanas.test.ts`) · reviewer (auth, idempotencia, UX) · 1 commit.
  - PASS tester+reviewer: 50 tests verdes (28 API + 22 páginas), suite completa 2261/2261, tsc 0 errores; reviewer PASS. Deuda menor: unificar el helper de IP (`x-forwarded-for`/`x-real-ip`) y documentar que el rate limit es en memoria; `esErrorTablaFaltante` no cubre P2022 (deuda compartida con T-02); mover el foco al primer error del formulario; tope de body explícito opcional.

- [x] **T-13 (AC-8, AC-11, AC-12, AC-14; RF-10..RF-12, RF-16, RF-17) — Ejecutar búsqueda Places y detalle de campaña.**
  - `POST /api/propuestas/campanas/[id]/ejecutar`: transición atómica `BORRADOR -> EN_CURSO`; reserva cupo Places; llama al cliente; descarta sitios sociales/agregadores; crea prospectos con `placeId`, `sitioWeb`, nombre desde host y `ciudad`/`rubro` heredados de la campaña; comprueba supresión por dominio; dedupe/posible duplicado; `COMPLETADA|PARCIAL|FALLIDA`; `ultimoError` sanitizado; sin segunda corrida.
  - Respuesta con candidatos transitorios (nombre Places + website) y atribución; no se persiste el nombre de Places.
  - Página `/propuestas/campanas/[id]` con estado, resultados, duplicados, consumo y acciones (analizar, descartar, cancelar); botón de ejecutar solo en BORRADOR.
  - `POST /api/propuestas/campanas/[id]/cancelar`: solo BORRADOR/EN_CURSO; estado CANCELADA; detiene nuevas llamadas; 409 si es terminal.
  - Archivos: `src/app/api/propuestas/campanas/[id]/ejecutar/route.ts`, `src/app/api/propuestas/campanas/[id]/cancelar/route.ts`; `src/app/(propuestas)/propuestas/campanas/[id]/page.tsx`; `src/components/propuestas/campana-tabla.tsx`; tests `campanas.test.ts` (ampliar).
  - Depende: T-11, T-12.
  - Tests: doble clic → 409 y una sola request; cap corta y no hay llamadas extra; 429/5xx/timeout → PARCIAL/FALLIDA y conserva lo creado; sin key → 503; no scraping; dedupe por `placeId`; sitio social/agregador se omite; dominio suprimido se omite; cancelar BORRADOR/EN_CURSO → CANCELADA y 409 en terminal.
  - Cierre: tester (`campanas.test.ts`, `propuestas-places.test.ts`) · reviewer (idempotencia, términos Places, errores) · 1 commit.
  - PASS tester+reviewer: 127 tests verdes (85 API + 42 páginas), tsc 0 errores; reviewer PASS. Deuda menor: candidatos transitorios sin atribución visible (no mostrar en UI hasta agregar «Datos de Google»); `esErrorTablaFaltante` no cubre P2022; tests de `$transaction`/locks mockeados (validar en staging T-26); `confirmado` no es `.strict()`; dedupe de plataformas multiinquilino (`wixsite.com`) a revisar en T-05/T-14; una cancelación después de reservar consume 1 unidad de Places; copy/títulos internos «Disponible en T-14/T-15» a limpiar.

- [ ] **T-14 (AC-13, AC-14, AC-19; RF-18, RF-22) — Alta manual y corrección de prospectos.**
  - `POST /api/propuestas/prospectos`: exige `nombreNegocio`, `nota` y `fuenteUrl` o `emailFuenteUrl`; no hay endpoint de importación masiva; rechaza sitios sociales/agregadores; si el email no pertenece al dominio del negocio, exige `emailFuenteUrl` y nota justificada; comprueba dedupe y supresión; `fuenteTipo=CARGA_MANUAL`.
  - `PATCH /api/propuestas/prospectos/[id]`: correcciones con `motivo`; si cambia email, exige `emailFuenteUrl`/`fuenteUrl`; registra en `historial`; no permite tocar un `SUPRIMIDO` sin revocar.
  - `POST /api/propuestas/prospectos/[id]/descartar`: exige motivo; estado DESCARTADO; cancela BORRADOR/APROBADO pendientes; no permite descartar un `SUPRIMIDO` sin revocar.
  - UI de alta/corrección/descarte en el detalle de campaña/prospecto, con aviso de no pegar datos sensibles y límite de longitud en notas.
  - Archivos: `src/app/api/propuestas/prospectos/route.ts`, `src/app/api/propuestas/prospectos/[id]/route.ts`, `src/app/api/propuestas/prospectos/[id]/descartar/route.ts`; `src/components/propuestas/prospecto-ficha.tsx`; `src/lib/propuestas/validation.ts`; tests `src/__tests__/api/propuestas/prospectos.test.ts`.
  - Depende: T-05, T-12.
  - Tests: alta sin fuente/nota → 400; sitio social/agregador → 400; email de otro dominio sin fuente/nota → 400; email suprimido → 409; duplicado por email → reutiliza/409; corrección con motivo; cambio de email exige fuente; descarte con motivo y cancelación de pendientes; no listas compradas; historial.
  - Cierre: tester (`prospectos.test.ts`) · reviewer (procedencia, PII, permisos) · 1 commit.

- [ ] **T-15 (AC-9, AC-10, AC-19, AC-20, AC-21; RF-13..RF-16, RF-31..RF-33) — Analizar prospecto: fetch, email, auditoría y score.**
  - `POST /api/propuestas/prospectos/[id]/analizar`: guard/origen/rate limit; reserva fetches por página (máx. 3) y auditoría (1); comprueba supresión por email y por dominio antes de analizar; fetch seguro; extrae email/teléfono/nombre con fuente/fecha sin sobrescribir datos cargados manualmente (solo completa vacíos); si el email ya pertenece a otro prospecto, marca `posibleDuplicadoDeId` y no lo asigna en silencio; audita si hay sitio reutilizando el HTML del home (y <24 h); calcula score; actualiza `ultimaInteraccionEn` y estado.
  - Sin web → `SIN_ENRIQUECER` con motivo; sin email → sigue sin contacto y no se puede aprobar; auditoría fallida → `auditoriaEstado=FALLIDA` y score con motivo.
  - Página de prospecto con ficha, fuentes, auditoría, score y botón "Analizar".
  - Archivos: `src/app/api/propuestas/prospectos/[id]/analizar/route.ts`; `src/app/(propuestas)/propuestas/prospectos/[id]/page.tsx`; `src/components/propuestas/score-desglose.tsx`; tests `src/__tests__/api/propuestas/prospectos.test.ts` (ampliar), `propuestas-auditoria.test.ts`.
  - Depende: T-09, T-10, T-14.
  - Tests: host privado → rechazo; robots; timeout; HTTP/TLS inválido → hallazgo sintético sin saltar TLS; email publicado con `emailFuenteUrl`; nombre/email manual no se sobrescriben; email de otro prospecto → `posibleDuplicadoDeId`; sin email → no aprobable; supresión por email/dominio detectada; auditoría resumida sin HTML; score determinista; una auditoría/24 h; límites diarios.
  - Cierre: tester (`prospectos.test.ts`, `propuestas-auditoria.test.ts`, `propuestas-score.test.ts`) · reviewer (SSRF, PII, exactitud del score) · 1 commit.

- [ ] **T-16 (AC-22, AC-23, AC-24; RF-34..RF-39) — Plantillas y borrador determinista.**
  - `POST /api/propuestas/plantillas` y `PATCH /api/propuestas/plantillas/[id]`: nueva versión al editar, desactiva la anterior; variables con lista blanca; validación de asunto/cuerpo.
  - Páginas `/propuestas/plantillas` y `/propuestas/plantillas/[id]` con editor, variables permitidas y vista previa con un prospecto real (sin datos inventados).
  - Página `/propuestas/bandeja` con borradores `BORRADOR`/`APROBADO` pendientes, ordenados por score, sin aprobación ni envío por lote.
  - `POST /api/propuestas/prospectos/[id]/borrador`: requiere email/no suprimido/plantilla/sin borrador abierto/máx. mensajes; si `prospecto.baseLegal` es null y `config.baseLegal` existe, lo guarda; render determinista del asunto/cuerpo; crea `EnvioPropuesta` BORRADOR con `hashContenido`; el footer legal y el token de baja se materializan al aprobar; `modo="LLM"` → 503 sin escribir; actualiza `ultimaInteraccionEn`.
  - `PATCH /api/propuestas/envios/[id]`: BORRADOR edita en sitio y recomputa `hashContenido`; APROBADO crea versión nueva y cancela la anterior.
  - Archivos: `src/app/api/propuestas/plantillas/route.ts`, `plantillas/[id]/route.ts`, `prospectos/[id]/borrador/route.ts`, `envios/[id]/route.ts`; páginas `plantillas/*`, `bandeja/page.tsx`; `borrador-editor.tsx`; tests `propuestas-plantillas.test.ts`, `envios.test.ts`.
  - Depende: T-08, T-15.
  - Tests: plantilla inválida no guarda; edición crea versión; borrador con datos/fuente/hallazgo; sin claims; `LLM` → 503 sin fila; editar aprobado invalida y no envía; máximo de mensajes; bandeja lista pendientes sin acciones masivas.
  - Cierre: tester (`propuestas-plantillas.test.ts`, `envios.test.ts`) · reviewer (XSS, versionado, grounding) · 1 commit.

- [ ] **T-17 (AC-25, AC-27; RF-40..RF-42, RF-44) — Aprobación con snapshot (sin envío).**
  - `POST /api/propuestas/envios/[id]/aprobar`: solo BORRADOR; revalida email, supresión, plantilla y hash del borrador; exige from/reply-to configurados y texto/base legal presentes; re-renderiza el email final con footer legal, token de baja y headers; guarda `aprobado*`, `aprobadoHash`, `aprobadoPor/En`, `tokenBaja`; estado APROBADO; prospecto APROBADO; actualiza `ultimaInteraccionEn`.
  - UI de aprobación: destinatario, from/reply-to, asunto, HTML/texto, fuentes, score, auditoría y versión; aviso "Aprobar no envía"; confirmación explícita.
  - Archivos: `src/app/api/propuestas/envios/[id]/aprobar/route.ts`; `src/components/propuestas/aprobacion-panel.tsx`; test `envios.test.ts` (ampliar).
  - Depende: T-16.
  - Tests: snapshot final con footer legal/token y aprobador; `aprobadoHash` cubre el snapshot; Resend no llamado; sin email/suprimido → 409; borrador mutado/hash distinto → 409; otro envío APROBADO/ENVIANDO en la misma secuencia → 409; sin secreto/URL, from/reply o texto/base legal → 409; asistente 403.
  - Cierre: tester (`envios.test.ts`) · reviewer (inmutabilidad, auth, Resend no llamado) · 1 commit.

- [ ] **T-18 (AC-26, AC-28, AC-29, AC-30, AC-31; RF-43..RF-50) — Envío con Resend, idempotencia y resultado.**
  - `src/lib/propuestas/resend.ts`: wrapper server-only, `Idempotency-Key`, headers `List-Unsubscribe`/`-Post`, from/reply-to, sin scheduling/adjuntos/tracking; errores sanitizados.
  - `POST /api/propuestas/envios/[id]/enviar`: body `confirmacion: "ENVIAR"`; revalida `puedeEnviar`; reserva cupo; `updateMany(APROBADO -> ENVIANDO)`; llama a Resend; éxito `ENVIADO` + messageId; fallo `FALLIDO` sin retry; actualiza prospecto/`ultimoEnvioEn`.
  - `POST /api/propuestas/envios/[id]/reintentar`: solo FALLIDO; crea `version+1` BORRADOR con el mismo contenido, hash nuevo; requiere edición/aprobación; no llama a Resend.
  - `POST /api/propuestas/envios/[id]/resultado`: RESPONDIDO/REBOTE_DURO/QUEJA; supresión en rebote/queja; sin retry.
  - Reconciliación manual: permitir marcar un `ENVIANDO` estancado (>10 min) como `FALLIDO` con nota, solo tras verificar en Resend; sin auto-retry.
  - UI de confirmación de envío (modal separado, checkbox + `confirmacion: "ENVIAR"`), historial y estado.
  - Archivos: `src/lib/propuestas/resend.ts`; `src/app/api/propuestas/envios/[id]/enviar/route.ts`, `reintentar/route.ts`, `resultado/route.ts`; `src/components/propuestas/envio-confirmacion.tsx`; `src/app/(propuestas)/propuestas/envios/page.tsx`; test `envios.test.ts` (ampliar).
  - Depende: T-17.
  - Tests: una sola llamada con key; doble clic no duplica; error → FALLIDO/código; éxito → messageId; sin aprobación/suprimido/sin email/cupo → 409; `aprobadoHash` o `hashContenido` distintos → 409; reintentar FALLIDO crea versión BORRADOR sin Resend; 21.º envío → 429 sin cola; no scheduler/`scheduledAt` (`secuencia` es numeración manual); rebote/queja suprimen; follow-up exige nueva aprobación.
  - Cierre: tester (`envios.test.ts`, `propuestas-sin-red.test.ts`) · reviewer (idempotencia, PII, cumplimiento) · 1 commit.

---

## Fase 4: Cumplimiento y operación

- [ ] **T-19 (AC-33, AC-34, AC-35; RF-51, RF-52, RF-56) — Baja pública y POST one-click.**
  - Página `/propuestas/baja/[token]`: valida token sin revelar datos; formulario de confirmación; genérica para token inválido/usado; `noindex`/`no-store`; sin login. Vive en un route group `(propuestas-baja)` con layout mínimo, **fuera** del layout admin de `(propuestas)`.
  - `POST /api/opt-out`: rate limit 10/min por IP y 5/min por token (clave = hash del token, nunca el token en claro); verifica HMAC; crea/actualiza supresión por `emailHash`; cancela BORRADOR/APROBADO; si el email actual del prospecto coincide con el hash, lo marca SUPRIMIDO; si no, solo cancela los envíos pendientes de ese email; responde 200/202 genérico; idempotente.
  - `List-Unsubscribe` del email apunta a este POST; enlace visible apunta a la página.
  - Archivos: `src/app/(propuestas-baja)/layout.tsx`; `src/app/(propuestas-baja)/propuestas/baja/[token]/page.tsx`; `src/app/api/opt-out/route.ts`; `src/components/propuestas/baja-confirmar.tsx`; tests `src/__tests__/api/opt-out.test.ts`, `propuestas-email.test.ts`.
  - Depende: T-06, T-18.
  - Tests: render público sin guard admin; token válido → supresión; inválido/usado → misma respuesta; sin enumeración; idempotente; rate limit 429 con `Retry-After`; headers; no PII; POST one-click 200/202; GET no muta.
  - Cierre: tester (`opt-out.test.ts`, `propuestas-email.test.ts`) · reviewer (privacidad, enumeración, cumplimiento) · 1 commit.

- [ ] **T-20 (AC-15..AC-18, AC-27, AC-36; RF-23..RF-28, RF-56) — Supresiones admin, rebotes y respuestas.**
  - `POST /api/propuestas/supresiones`: EMAIL por hash o DOMINIO de negocio; motivo/origen; idempotente por clave; rechaza proveedores públicos; cancela pendientes y marca prospectos.
  - `POST /api/propuestas/supresiones/[id]/revocar`: excepción con motivo, registro de quién/cuándo; no es flujo normal; desactiva la supresión pero no reabre prospectos automáticamente (el admin crea/decide el siguiente paso).
  - Página `/propuestas/supresiones`: lista (hash/enmascarado/dominio/motivo/fecha/origen), alta manual, revocación con confirmación y purga manual.
  - Completar `resultado` de rebote/queja para que use la misma creación de supresión.
  - Archivos: `src/app/api/propuestas/supresiones/route.ts`, `supresiones/[id]/revocar/route.ts`; `src/app/(propuestas)/propuestas/supresiones/page.tsx`; `src/components/propuestas/supresion-form.tsx`; test `src/__tests__/api/propuestas/supresiones.test.ts`.
  - Depende: T-06, T-18.
  - Tests: alta email/dominio; hash no plaintext; público rechazado; idempotencia; cancelación de pendientes; revocación con motivo sin reabrir prospectos; rebote/queja; asistente 403.
  - Cierre: tester (`supresiones.test.ts`, `envios.test.ts`) · reviewer (cumplimiento, PII, idempotencia) · 1 commit.

- [ ] **T-21 (AC-38, AC-39; RF-57, RF-58) — Consumo, cupos y alertas en UI.**
  - Dashboard, detalle de campaña y ficha de prospecto: `estadoCupos(fecha)` por proveedor, enviados hoy/cap, restante, costo estimado si está configurado, aviso 80% y bloqueo 100%; consumo por campaña y por prospecto; sin cola.
  - Componente `cupo-dia.tsx`; enlace a supresiones; estado operativo si falta Places/Resend/secreto.
  - Archivos: `src/lib/propuestas/consumo.ts` (ampliar); `src/components/propuestas/cupo-dia.tsx`; `src/app/(propuestas)/propuestas/page.tsx`; `src/app/(propuestas)/propuestas/campanas/[id]/page.tsx`; test `propuestas-consumo.test.ts`.
  - Depende: T-11, T-18.
  - Tests: agregados por proveedor/día; fila por campaña/prospecto; 80% aviso; 100% bloqueo; costo 0 → "sin costo estimado"; configuración faltante → estado operativo.
  - Cierre: tester (`propuestas-consumo.test.ts`) · reviewer (exactitud de contadores, UX) · 1 commit.

- [ ] **T-22 (AC-37, AC-40; RF-30, RF-65) — Retención 12 meses y ARCO.**
  - `retencion.ts`: selección por `ultimaInteraccionEn < now-12m`, borrado en lotes de 100 con `onDelete: Cascade`, `pg_try_advisory_lock`, supresión intacta; cron `GET /api/cron/propuestas-retencion` con `CRON_SECRET`; `POST /api/propuestas/retencion` para admin.
  - `arco.ts` + `POST /api/propuestas/arco/[prospectoId]`: EXPORTAR (JSON con datos/fuentes/auditoría/envíos, sin tokens/hashes), ELIMINAR (crea supresión SOLICITUD_ARCO si hay email, luego borra; conserva supresión), RECTIFICAR (PATCH + historial).
  - UI `arco-panel.tsx` en la ficha.
  - Archivos: `src/lib/propuestas/retencion.ts`, `arco.ts`; `src/app/api/cron/propuestas-retencion/route.ts`, `src/app/api/propuestas/retencion/route.ts`, `src/app/api/propuestas/arco/[prospectoId]/route.ts`; `src/components/propuestas/arco-panel.tsx`; tests `propuestas-retencion.test.ts`, `src/__tests__/api/propuestas/arco.test.ts`.
  - Depende: T-06, T-18.
  - Tests: corte 12 meses; cascada borra borradores/envíos; supresión permanece; lock evita solapamiento; exportar sin tokens; eliminar conserva supresión; acción registrada; cron 401 sin secreto.
  - Cierre: tester (`propuestas-retencion.test.ts`, `arco.test.ts`) · reviewer (privacidad, borrado, evidencia) · 1 commit.

- [ ] **T-23 (AC-41, AC-44; RF-59, RF-60, RF-61) — Privacidad, redacción, guard de red y cobertura.**
  - `redact.ts`: códigos/mensajes sanitizados; logs solo con ids/estado/código/duración; Sentry sin PII y con redacción de URLs `/propuestas/baja/` y `/api/opt-out`.
  - `guard-propuestas-red.ts` en `setup.ts`: bloquea Places, Resend y LLM; mensaje accionable.
  - `propuestas-cobertura.test.ts`: matriz AC-1..AC-45 → archivo de test; `propuestas-sin-red.test.ts`: sin config no hay red.
  - Archivos: `src/lib/propuestas/redact.ts`; `src/__tests__/helpers/guard-propuestas-red.ts`; `src/__tests__/setup.ts`; tests `propuestas-privacidad.test.ts`, `propuestas-sin-red.test.ts`, `propuestas-cobertura.test.ts`; ajustar `instrumentation-client.ts`/`sentry.server.config.ts` si hace falta para redacción.
  - Depende: T-19, T-20, T-21, T-22.
  - Tests: spies de logger/Sentry sin email/nombre/teléfono/cuerpo/HTML/token/secreto; guard bloquea hosts; cobertura de todos los AC; sin llamadas reales.
  - Cierre: tester (`propuestas-privacidad.test.ts`, `propuestas-sin-red.test.ts`, `propuestas-cobertura.test.ts`) · reviewer (PII, Sentry, cobertura) · 1 commit.

---

## Fase 5: Cierre, gates y documentación

- [ ] **T-24 (RF-65; AC-45) — Runbook, checklist legal y documentación operativa.**
  - Crear `specs/004-propuestas/runbook.md`: envs, orden `db push` → deploy, cron de retención, cupos, rollback, reconciliación de envíos, ARCO y retención de logs.
  - Crear `specs/004-propuestas/legal-checklist.md`: texto legal aprobado, base legal, SPF/DKIM/DMARC, AAIP/transferencia internacional, «publicidad», canal ARCO y firma del dueño. Sin el checklist completo, `PROPUESTAS_ENVIO_HABILITADO=false`.
  - Actualizar `AGENTS.md` y `MEMORY.md` con ruta, auth, modelos, envs, comandos y deuda (LLM, webhooks Resend).
  - Archivos: `specs/004-propuestas/runbook.md`, `legal-checklist.md`, `AGENTS.md`, `MEMORY.md`.
  - Depende: T-23.
  - Tests: revisión documental; `estadoEnvio` sigue fallando cerrado sin texto/base legal.
  - Cierre: tester (revisión de checklist + `propuestas-config.test.ts`) · reviewer (operación, legal, completitud) · 1 commit.

- [ ] **T-25 (AC-44, AC-45; RNF-6) — Verificación final local.**
  - Ejecutar suite completa, typecheck, lint y build; corregir solo lo introducido por la feature.
  - Archivos: los que correspondan a correcciones; sin cambios funcionales nuevos.
  - Depende: T-24.
  - Tests: `node node_modules\vitest\vitest.mjs run`; `node node_modules\typescript\bin\tsc --noEmit`; `npm run lint` (sin errores nuevos sobre 18/18); `node node_modules\next\dist\bin\next build`.
  - Cierre: tester (evidencia de comandos) · reviewer (diff final, baseline) · 1 commit (solo si hay correcciones).

- [ ] **T-26 [GATE] (AC-1..AC-45; RF-66) — Gate de staging antes de producción.**
  - No es un commit de código. Se ejecuta en staging con Postgres separado y `PROPUESTAS_ENVIO_HABILITADO=false` hasta el paso de envío controlado.
  - Checklist de plan §7.6: esquema, middleware, búsqueda real acotada, fetch/auditoría/score, borrador/aprobación, envío a dirección propia, message ID, headers, baja one-click, reimportación bloqueada, cupo 21 → 429, retención en seco, logs sin PII, rollback.
  - Archivos: evidencia en `specs/004-propuestas/runbook.md` (sección staging) o `t-26-staging.md`.
  - Depende: T-25.
  - Cierre: tester (smoke manual y capturas redactadas) · reviewer (PASS/FAIL con observaciones) · sin commit de código.

- [ ] **T-27 [GATE] (AC-45; RF-64, RF-65) — Gate de producción (requiere aprobación explícita del dueño).**
  - No es un commit de código. `pg_dump` → `db push` → deploy → health → `PROPUESTAS_ENVIO_HABILITADO=false` → smoke en seco → habilitar envío → primer envío a dirección propia → monitoreo.
  - Requisitos: T-26 PASS, `legal-checklist.md` firmado, SPF/DKIM/DMARC verificados, `PROPUESTAS_TEXTO_LEGAL`/`PROPUESTAS_BASE_LEGAL` cargados, rollback probado.
  - Archivos: evidencia en `specs/004-propuestas/runbook.md` (sección producción).
  - Depende: T-26 + checklist legal firmado + autorización del dueño.
  - Cierre: tester (health, smoke, primer envío controlado) · reviewer (PASS/FAIL, observaciones, deuda) · sin commit de código.

---

## Trazabilidad AC → tareas

| AC | Tareas |
|----|--------|
| AC-1 | T-01, T-02 |
| AC-2 | T-01, T-02, T-12 |
| AC-3 | T-02 |
| AC-4 | T-01 |
| AC-5 | T-01, T-02, T-23 |
| AC-6 | T-02, T-03 |
| AC-7 | T-12 |
| AC-8 | T-04, T-11, T-13 |
| AC-9 | T-10, T-15 |
| AC-10 | T-10, T-15 |
| AC-11 | T-11, T-13 |
| AC-12 | T-11, T-13 |
| AC-13 | T-14 |
| AC-14 | T-05, T-12, T-13, T-14 |
| AC-15 | T-06, T-20 |
| AC-16 | T-06, T-19, T-20 |
| AC-17 | T-06, T-20, T-22 |
| AC-18 | T-06, T-20 |
| AC-19 | T-05, T-10, T-14, T-15 |
| AC-20 | T-09, T-15 |
| AC-21 | T-07, T-15 |
| AC-22 | T-08, T-16 |
| AC-23 | T-16 |
| AC-24 | T-07, T-16 |
| AC-25 | T-17 |
| AC-26 | T-18 |
| AC-27 | T-07, T-17, T-20 |
| AC-28 | T-18 |
| AC-29 | T-18 |
| AC-30 | T-18 |
| AC-31 | T-07, T-18 |
| AC-32 | T-08, T-19 |
| AC-33 | T-06, T-19 |
| AC-34 | T-06, T-08, T-19 |
| AC-35 | T-06, T-19 |
| AC-36 | T-06, T-20 |
| AC-37 | T-22 |
| AC-38 | T-11, T-21 |
| AC-39 | T-11, T-21 |
| AC-40 | T-22 |
| AC-41 | T-23 |
| AC-42 | T-04, T-25 |
| AC-43 | T-03 |
| AC-44 | T-23, T-25 |
| AC-45 | T-25, T-26, T-27 |

## Dependencias y orden

```
Fundaciones:      T-01 / T-03 (paralelo) → T-02 / T-04
Dominio puro:     T-04 → T-05 → T-06 → T-07 → T-08
Integraciones:    T-05 → T-10 → T-09;  T-04/T-05 → T-11
Portal y APIs:    T-12 → T-13;  T-05/T-12 → T-14;  T-09/T-10/T-14 → T-15;
                  T-08/T-15 → T-16 → T-17 → T-18
Cumplimiento:     T-06/T-18 → T-19, T-20, T-22;  T-11/T-18 → T-21
Cierre:           T-19..T-22 → T-23 → T-24 → T-25 → T-26 (staging) → T-27 (producción)
```

Reglas de orden:

- T-01 y T-03 pueden ir en paralelo. T-02 requiere T-01. T-04 requiere T-03.
- T-05 es base de T-06, T-07, T-09 y T-10. T-09 requiere T-10. T-08 requiere T-07. T-11 requiere T-04/T-05.
- T-12 requiere T-03/T-04/T-05/T-11. T-13 requiere T-11/T-12. T-14 requiere T-05/T-12. T-15 requiere T-09/T-10/T-14.
- T-16 requiere T-08/T-15. T-17 requiere T-16. T-18 requiere T-17.
- T-19/T-20 requieren T-06/T-18. T-21 requiere T-11/T-18. T-22 requiere T-06/T-18.
- T-23 requiere T-19..T-22. T-24/T-25 cierran. T-26 (staging) y T-27 (producción) no se ejecutan sin autorización.

## Definición de terminado por tarea

- [ ] Cumple todos los AC listados y no rompe AC existentes.
- [ ] Tests nuevos/actualizados verdes; sin llamadas reales a Google, Resend ni LLM.
- [ ] `tsc --noEmit` sin errores; lint sin errores nuevos sobre el baseline.
- [ ] Sin `prisma.cliente/pago/...` en el portal; sin FKs al CRM.
- [ ] Sin PII en logs/Sentry; sin tokens en URLs logueadas.
- [ ] Reviewer registra PASS/FAIL y observaciones; si hay observaciones, se abre tarea de seguimiento.
- [ ] Un commit revisable por tarea (T-26/T-27 son gates operativos, sin commit de código).

