# Runbook 004 — Portal de propuestas

**Estado (2026-11-14):** esquema aditivo aplicado en producción (6 tablas + 8 enums verificados) mediante un job temporal de Railway/Prisma ya eliminado; código T-01..T-25 desplegado (deploy `02a5ca66`, commit `700eaf1` + docs posteriores); `/api/health` OK; portal admin-only. `PROPUESTAS_ENVIO_HABILITADO=false` y `PROPUESTAS_TEXTO_LEGAL`/`PROPUESTAS_BASE_LEGAL` no cargados: aprobar/enviar bloqueado. **T-26 (staging) y T-27 (gate formal) no se ejecutaron como gates** (ver §0). No habilitar el envío sin checklist legal firmado, SPF/DKIM/DMARC y pruebas controladas.
**Última actualización:** 2026-11-14
**Alcance:** operación del portal interno `/propuestas` (admin-only), prospección B2B, envío con Resend, baja pública, retención y ARCO.
**Documentos relacionados:** `spec.md` §11.2/§14/§20.1, `plan.md` §7, `tasks.md` T-24, `legal-checklist.md`.

> **Regla de oro:** `PROPUESTAS_ENVIO_HABILITADO=false` por defecto. Sin checklist legal firmado, sin SPF/DKIM/DMARC verificados y sin la validación controlada pendiente (T-26 no se ejecutó como gate) no se habilita el envío. El portal puede buscar, analizar, puntuar y redactar en seco; el envío falla cerrado. La aprobación exige secreto, URL pública, from/reply-to, texto legal y base legal; **no** exige `RESEND_API_KEY` ni el gate, y no envía. Hoy `PROPUESTAS_TEXTO_LEGAL` y `PROPUESTAS_BASE_LEGAL` no están cargados, por lo que aprobar también falla cerrado.

---

## 0. Estado real del despliegue (2026-11-14)

> **T-26 (staging) y T-27 (gate formal) no se ejecutaron como gates.** El dueño autorizó aplicar el portal directamente en producción. El esquema y el código ya están aplicados; la validación funcional y el envío real siguen pendientes. **No afirmar T-26 PASS ni T-27 PASS.**

| Ítem | Estado real |
|------|-------------|
| Esquema aditivo en producción | **Aplicado** mediante un job temporal de Railway/Prisma: 6 tablas + 8 enums verificados. El job y los servicios temporales ya se eliminaron. |
| Código T-01..T-25 | **Desplegado**: deploy `02a5ca66`, commit `700eaf1` + docs posteriores. |
| Health | **OK** (`/api/health`). |
| Variables en PixelArch | **52 variables**, incluidas las `PROPUESTAS_*`. `PROPUESTAS_SECRETO` generado. |
| `PROPUESTAS_ENVIO_HABILITADO` | **`false`**. |
| `PROPUESTAS_TEXTO_LEGAL` / `PROPUESTAS_BASE_LEGAL` | **No cargados**: aprobar y enviar fallan cerrado. |
| Acceso | **Solo admin**; las APIs `/api/propuestas/**` responden `401` sin sesión. |
| T-26 (staging) | **No ejecutado como gate.** |
| T-27 (gate formal) | **No ejecutado como gate.** La aplicación directa en producción fue autorizada por el dueño. |

### 0.1 Validación pendiente

La validación real queda pendiente y **no debe registrarse como PASS** hasta completarla:

- Places: corrida acotada, field mask mínimo y solo `place_id` persistido.
- Fetch seguro + robots + email publicado con fuente/fecha.
- Auditoría interna y score determinista.
- Borrador con grounding.
- Aprobación con snapshot/hash; hoy bloqueada por texto/base legal ausentes.
- Envío real, headers `List-Unsubscribe`, baja one-click y supresión.
- Cupos (`ConsumoProveedor`), presupuesto y retención/locks.

**No habilitar `PROPUESTAS_ENVIO_HABILITADO=true`** hasta completar: (1) checklist legal firmado; (2) SPF/DKIM/DMARC y dominio de Resend verificados; (3) `PROPUESTAS_TEXTO_LEGAL` y `PROPUESTAS_BASE_LEGAL` aprobados y cargados; (4) pruebas controladas a una dirección propia con evidencia. La autorización para aplicar el portal **no** es autorización para enviar.

---

## 1. Mapa operativo

| Ruta | Función | Acceso |
|------|---------|--------|
| `/propuestas` | Dashboard: campañas, cola, cupos, supresiones. | Admin |
| `/propuestas/buscar` | Alta de campaña/búsqueda. | Admin |
| `/propuestas/campanas/[id]` | Resultados, ejecución, duplicados y consumo. | Admin |
| `/propuestas/prospectos/[id]` | Ficha, fuentes, auditoría, score, borrador, aprobación, ARCO. | Admin |
| `/propuestas/bandeja` | Borradores pendientes. | Admin |
| `/propuestas/plantillas` | Plantillas y versiones. | Admin |
| `/propuestas/plantillas/[id]` | Detalle/edición de una plantilla versionada. | Admin |
| `/propuestas/envios` | Historial de envíos. | Admin |
| `/propuestas/supresiones` | Supresiones y revocación excepcional. | Admin |
| `/propuestas/baja/[token]` | Baja pública por token. | Público, `noindex`/`no-store`/`no-referrer` |
| `/api/propuestas/**` | APIs internas. | Admin; `401/403` sin sesión/asistente |
| `/api/opt-out` | POST público one-click (RFC 8058). | Público, rate limit |
| `/api/cron/propuestas-retencion` | Purga programada. | `Authorization: Bearer $CRON_SECRET` |

Decisiones v1 que afectan la operación:

- **Sin LLM:** plantillas deterministas; `PROPUESTAS_LLM_HABILITADO=false` y cualquier intento `modo: "LLM"` falla cerrado.
- **Sin envío automático, programado, por lote ni reintento automático.**
- **Sin webhooks de Resend:** rebotes, quejas y respuestas se registran manualmente desde el portal.
- **Sin conversión al CRM:** no hay lectura/escritura de `Cliente`, `Pago` ni pasarelas.
- **Sin listas compradas, scraping ni datos sensibles:** solo Places oficial y webs públicas del negocio (o carga manual con fuente).
- **B2B:** solo contacto profesional publicado; sin consumidores, menores ni datos sensibles.
- **Sin portal para la asistente:** solo `admin`; la baja pública es la única excepción.

---

## 2. Variables de entorno

Todas las variables nuevas del portal son **server-only**. No se agrega ninguna `NEXT_PUBLIC_*`. `NEXT_PUBLIC_URL` ya existe, es pública por diseño y no debe contener secretos; se usa para construir enlaces de baja y validar el origen de las mutaciones.

### 2.1 Variables del portal

| Variable | Obligatoria para | Default | Uso / nota |
|----------|------------------|---------|------------|
| `PROPUESTAS_ENVIO_HABILITADO` | Enviar | `false` | Gate explícito de envío; aprobar no lo exige ni envía. Mantener `false` hasta checklist legal firmado, SPF/DKIM/DMARC y validación controlada. **T-26/T-27 no se ejecutaron como gates** (ver §0). |
| `PROPUESTAS_PLACES_API_KEY` | Buscar | — | Clave **separada** de reseñas. No reutilizar `GOOGLE_PLACES_API_KEY`. Server-only. |
| `PROPUESTAS_FROM_EMAIL` | Aprobar/enviar | — | `propuestas@pixelarch.dev` (valor acordado). |
| `PROPUESTAS_FROM_NOMBRE` | No | `PixelArch` | Nombre visible del remitente. |
| `PROPUESTAS_REPLY_TO` | Aprobar/enviar | — | `hola@pixelarch.dev` (valor acordado). |
| `PROPUESTAS_SECRETO` | Supresión/baja/aprobación | — | HMAC de hash y token; mínimo 32 caracteres. **No rotar sin planificar** (ver §10.5). |
| `PROPUESTAS_TEXTO_LEGAL` | Aprobar/enviar | — | Texto literal aprobado por el abogado; máximo 20.000 caracteres. No se inventa en código. |
| `PROPUESTAS_BASE_LEGAL` | Aprobar/enviar | — | Base legal documentada por campaña/prospecto. No se inventa en código. |
| `PROPUESTAS_ETIQUETA_PUBLICIDAD` | No | `true` | Prefijo `[publicidad]` en el asunto cuando corresponde. |
| `PROPUESTAS_CUPO_ENVIOS_DIA` | No | `20` | Tope duro de envíos/día. |
| `PROPUESTAS_CUPO_PLACES_DIA` | No | `20` | Requests Places/día. |
| `PROPUESTAS_CUPO_FETCHES_DIA` | No | `100` | Páginas web/día. |
| `PROPUESTAS_CUPO_AUDITORIAS_DIA` | No | `20` | Auditorías/día. |
| `PROPUESTAS_CUPO_BORRADORES_DIA` | No | `20` | Borradores/día (ver deuda en §11). |
| `PROPUESTAS_MAX_ENVIOS_PROSPECTO` | No | `2` | Inicial + un follow-up manual. |
| `PROPUESTAS_PAGINAS_POR_PROSPECTO` | No | `3` | Home + hasta 2 páginas de contacto. |
| `PROPUESTAS_COSTO_PLACES_CENTAVOS` | No | `0` | Costo estimado por request; `0` = no estimar. |
| `PROPUESTAS_COSTO_RESEND_CENTAVOS` | No | `0` | Costo estimado por envío; `0` = no estimar. |
| `PROPUESTAS_PRESUPUESTO_MENSUAL_CENTAVOS` | No | `0` | `0` = sin tope monetario; `>0` = tope mensual global. |
| `PROPUESTAS_RETENCION_MESES` | No | `12` | Retención de prospectos. Un valor inválido bloquea la purga (nunca borra todo). |
| `PROPUESTAS_LLM_HABILITADO` | No | `false` | Reservado; v1 no usa LLM. |

> **Estado 2026-11-14:** 52 variables cargadas en el servicio PixelArch, incluidas las `PROPUESTAS_*`. `PROPUESTAS_SECRETO` generado; `PROPUESTAS_ENVIO_HABILITADO=false`; `PROPUESTAS_TEXTO_LEGAL` y `PROPUESTAS_BASE_LEGAL` **no cargados**, por lo que aprobar y enviar siguen bloqueados.

### 2.2 Variables existentes requeridas

| Variable | Uso |
|----------|-----|
| `RESEND_API_KEY` | Envío con Resend. Server-only. Sin ella, el envío falla cerrado; la aprobación no la exige y no envía. |
| `CRON_SECRET` | Autentica la purga programada. Debe existir en el servicio principal y en la Railway Function `propuestas-retencion`. |
| `NEXT_PUBLIC_URL` | Origen HTTPS absoluto del sitio (`https://pixelarch.dev`). Sin path, query, hash ni credenciales. Si es inválida, los enlaces de baja y el check de origen fallan cerrado. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Opcionales; Sentry no-op sin DSN. Verificar redacción antes de confiar en él. |
| `ADMIN_EMAIL` / `CONTACT_EMAIL` | Alertas operativas existentes; no son el canal ARCO. |

### 2.3 Valores de remitente y reply-to

| Elemento | Valor |
|----------|-------|
| From | `PixelArch <propuestas@pixelarch.dev>` (`PROPUESTAS_FROM_NOMBRE` + `PROPUESTAS_FROM_EMAIL`) |
| Reply-To | `hola@pixelarch.dev` (`PROPUESTAS_REPLY_TO`) |
| Canal ARCO visible | `hola@pixelarch.dev` (canal por defecto del código; el email debe incluirlo) |
| Baja visible | `https://pixelarch.dev/propuestas/baja/<token>` |
| Baja one-click | `https://pixelarch.dev/api/opt-out?token=<token>` |
| Dominio | `pixelarch.dev` debe estar verificado en Resend, con SPF/DKIM/DMARC verificados, antes de habilitar el envío; verificar y registrar la evidencia en `legal-checklist.md` §5 |

No usar `onboarding@resend.dev`, un remitente inventado ni un reply-to sin buzón atendido.

### 2.4 Railway y build

- Cargar las variables en el servicio principal de Railway; `CRON_SECRET` también en la Function de retención.
- Los cambios de envs **no invalidan la cache Docker**; si hace falta un rebuild real, tocar un path vigilado (`src/**`, `Dockerfile`, `package.json`) o redeployar según el procedimiento del proyecto.
- No hay `NEXT_PUBLIC_*` nuevas; no hace falta tocar el `Dockerfile` por este portal.
- Si falta una pieza, el portal falla cerrado por partes: sin Places no busca; sin `PROPUESTAS_SECRETO`, `NEXT_PUBLIC_URL`, from/reply-to, texto legal o base legal no se aprueba; sin `RESEND_API_KEY` o con `PROPUESTAS_ENVIO_HABILITADO=false` no se envía; sin secreto no suprime ni genera baja; sin URL pública no se generan enlaces de baja y las rutas que validan origen rechazan la mutación.

---

## 3. Orden de despliegue (producción)

> **Este orden no se ejecutó como gate T-27.** El dueño autorizó aplicar el portal directamente en producción el 2026-11-14; el esquema y el deploy ya están aplicados (ver §0). Lo que sigue es el procedimiento de referencia para completar el rollout y habilitar el envío. Siguen siendo obligatorios el checklist legal firmado, SPF/DKIM/DMARC y las pruebas controladas.

### 3.1 Prerrequisitos

> **Estado 2026-11-14:** esta lista no está completa. T-26 y T-27 no se ejecutaron como gates; los ítems de validación, textos legales y DNS siguen pendientes. No marcar ítems por el hecho de que el deploy ya esté en producción.

- [ ] T-25 (verificación local) PASS.
- [ ] T-26 (staging) ejecutado con evidencia y PASS. **No ejecutado como gate (2026-11-14); no existe PASS de T-26.**
- [ ] T-19 (baja pública/one-click) verificado; no habilitar el envío antes de esta verificación.
- [ ] `legal-checklist.md` preparado y completo (sin secciones pendientes de redacción); firma de dueño y abogado **antes de habilitar el envío**. Sin esa firma no se habilita el envío. **Pendiente.**
- [ ] Autorización explícita del dueño para ejecutar T-27, registrada con fecha. **No aplica como gate:** T-27 no se ejecutó; el dueño autorizó aplicar el portal directamente en producción el 2026-11-14, lo que no autoriza el envío.
- [ ] `PROPUESTAS_TEXTO_LEGAL` y `PROPUESTAS_BASE_LEGAL` aprobados y **cargados en Railway**; el contenido debe coincidir con el anexo firmado (hash/fecha). **Hoy no cargados.**
- [ ] Verificar SPF/DKIM/DMARC y dominio en Resend; registrar la evidencia en `legal-checklist.md` §5. Sin esto no se habilita el envío. **Pendiente.**
- [ ] `PROPUESTAS_ENVIO_HABILITADO=false` antes de empezar. **Cumplido (2026-11-14).**
- [ ] Ventana de mantenimiento y responsable de rollback definidos.

### 3.2 Secuencia

1. **Backup (`pg_dump`).**
   - Ejecutar con la `DATABASE_URL` de producción en un entorno seguro, sin imprimir la URL.
   - `pg_dump "$DATABASE_URL" -Fc -f propuestas-<fecha>-<hora>.dump`
   - Verificar el archivo con `pg_restore --list <archivo>.dump`.
   - Guardar fuera del repositorio; nunca commitear el dump.
   - Si el backup falla, **detenerse**.

2. **Aplicar esquema (`db push`).**
   - **Estado 2026-11-14:** aplicado en producción mediante un job temporal de Railway/Prisma, ya eliminado; verificación: 6 tablas + 8 enums, sin FKs al CRM. El comando local queda como referencia para un entorno nuevo.
   - `node node_modules\prisma\build\index.js db push`
   - Luego `node node_modules\prisma\build\index.js generate` si el entorno lo requiere.
   - El cambio es aditivo: 6 tablas y 8 enums nuevos, sin backfill y sin FKs al CRM.
   - Si Prisma propone pérdida de datos, **detenerse**: no es el cambio esperado.
   - Verificar que las tablas existen y que no hay FKs a `Cliente`/`Pago`.

3. **Deploy del código.**
   - **Estado 2026-11-14:** T-01..T-25 desplegado; deploy `02a5ca66`, commit `700eaf1` + docs posteriores. Mantener `PROPUESTAS_ENVIO_HABILITADO=false`.
   - Deploy normal de Railway desde GitHub.
   - `NEXT_PUBLIC_URL` debe apuntar al dominio de producción; si es inválida, las mutaciones se rechazan por origen y los enlaces de baja no se generan.

4. **Health.**
   - **Estado 2026-11-14:** OK.
   - `curl -sS https://pixelarch.dev/api/health`
   - Confirmar estado del sitio y de la base. Si falla, no continuar.

5. **Portal admin-only.**
   - **Estado 2026-11-14:** accesible solo admin; las APIs `/api/propuestas/**` responden `401` sin sesión.
   - Entrar a `/propuestas` con un admin: shell propio, sin navegación de CRM.
   - Sin sesión: gate/redirect, sin datos. Asistente: redirect/denegación.
   - `/propuesta` (singular) sigue público y sin cambios.
   - `POST /api/propuestas/campanas` responde `401` sin sesión y `403` para asistente.
   - Headers: `X-Robots-Tag: noindex, nofollow` y `Cache-Control: no-store` en páginas/APIs internas.
   - Si aparece `ESQUEMA_NO_APLICADO`, el `db push` no se aplicó: detenerse y corregir.

6. **Smoke en seco (sin envío).**
   - **Estado 2026-11-14:** pendiente; no ejecutado.
   - Crear una campaña acotada (`limiteCorrida` 1-2) y ejecutar Places.
   - Verificar field mask mínimo; no se persiste nombre/address/rating de Places, solo `place_id` y datos de la web/carga manual.
   - Analizar un sitio controlado: fetch seguro, robots, timeout, email publicado con fuente/fecha, auditoría, score y borrador.
   - Si el texto legal de producción **no** está cargado, **detenerse**: el checklist firmado exige que esté cargado. La aprobación fallará cerrada (`409` por configuración); el fail-closed debe validarse en la validación controlada, no en producción.
   - Aprobar un borrador con `PROPUESTAS_ENVIO_HABILITADO=false`; el botón de enviar debe estar deshabilitado y Resend no debe recibir llamadas.
   - Confirmar que no hay filas `RESEND` en `ConsumoProveedor` y que no se envió ningún email.

7. **Checklist legal firmado y textos aprobados.**
   - **Estado 2026-11-14:** pendiente; `PROPUESTAS_TEXTO_LEGAL` y `PROPUESTAS_BASE_LEGAL` no cargados.
   - Verificar que el `legal-checklist.md` firmado por dueño y abogado es la versión vigente (la firma debe estar vigente antes de habilitar el envío; el smoke en seco no la reemplaza; no se firma en este paso).
   - Verificar que `PROPUESTAS_TEXTO_LEGAL` y `PROPUESTAS_BASE_LEGAL` cargados coinciden exactamente con el anexo firmado (hash/fecha), sin placeholders.
   - Verificar que `estadoEnvio()` solo reporta el gate pendiente (si el resto ya está configurado) y que el texto renderizado no tiene placeholders.
   - No habilitar el envío con un texto de prueba en producción.

8. **Habilitar envío.**
   - **Estado 2026-11-14:** no ejecutado; `PROPUESTAS_ENVIO_HABILITADO=false`.
   - Cambiar `PROPUESTAS_ENVIO_HABILITADO=true`.
   - Redeploy/restart según corresponda para que el runtime lea la env.
   - Verificar en el portal que un envío aprobado y elegible habilita la confirmación de envío.
   - Si algo falla, volver a `false` de inmediato.

9. **Primer envío a dirección propia.**
   - **Estado 2026-11-14:** no ejecutado; sin envíos reales.
   - Usar una dirección propia/controlada, no un prospecto real.
   - Alta manual con fuente y nota (por ejemplo, `smoke de validación controlada`); no usar datos de clientes del CRM.
   - Aprobar y enviar con la segunda confirmación.
   - Verificar: un solo email, `ENVIADO`, message ID de Resend, headers `List-Unsubscribe`/`List-Unsubscribe-Post`, enlace visible, baja one-click, supresión global, pendientes cancelados, prospecto `SUPRIMIDO` y ausencia de duplicados.
   - Si el email cae en spam o falla autenticación, detener el rollout y revisar DNS/Resend antes de seguir.

10. **Monitoreo.**
    - `/api/health`, errores 5xx, Sentry, logs sin PII, cupos, supresiones y estado de los envíos.
    - Revisar Resend manualmente las primeras 24-48 h: entregado, rebote, queja.
    - Registrar el message ID y la evidencia del primer envío en el registro de cutover (§13).

### 3.3 Criterio de aborto

Abortar y volver a `PROPUESTAS_ENVIO_HABILITADO=false` si:

- el health falla o la base no responde;
- el portal muestra datos o permite acciones a un no-admin;
- el esquema no está aplicado;
- el texto legal renderizado no coincide con el aprobado;
- el primer envío no genera message ID o genera duplicados;
- los headers de baja faltan o el one-click no suprime;
- aparece PII en logs/Sentry.

---

## 4. Staging y gate T-26 (no ejecutado como gate)

> **Estado 2026-11-14:** T-26 no se ejecutó como gate. Esta sección queda como checklist de la validación controlada pendiente (ver §0.1). No hay evidencia de T-26 PASS y no debe registrarse como PASS sin ejecutarla.

### 4.1 Preparación

- Postgres separado de producción; nunca ejecutar el smoke contra la base real.
- `NEXT_PUBLIC_URL` con el dominio de staging para que el check de origen acepte las mutaciones.
- `PROPUESTAS_ENVIO_HABILITADO=false` hasta el paso de envío controlado.
- Para probar aprobación en staging se puede cargar un `PROPUESTAS_TEXTO_LEGAL` de prueba **marcado como tal**; no usar ese texto en producción.
- Reloj/UTC: cupos y retención usan día UTC. La UI muestra es-AR.

### 4.2 Checklist de smoke

- [ ] `db push` en staging sin errores; tablas/enums creados; sin FKs al CRM.
- [ ] `/propuesta` público; `/propuestas` no público; asistente denegada; APIs `401/403`.
- [ ] Portal admin con shell propio, sin navegación de CRM; `noindex`/`no-store`.
- [ ] Búsqueda Places acotada (máximo 2 resultados); field mask mínimo; solo `place_id` persistido; sin scraping.
- [ ] Fetch de un sitio controlado: email publicado/fuente/fecha, auditoría, score y borrador; sin HTML persistido.
- [ ] Auditoría: una por prospecto/24 h; timeout acotado; fallo TLS/HTTP se registra como hallazgo, no se salta TLS.
- [ ] Aprobación: snapshot, aprobador, hash; Resend no llamado; con gate `false`, enviar rechaza.
- [ ] Aprobación sin texto/base legal: `409` por configuración; no se aprueba ni se envía. Validar el fail-closed en staging, no en producción.
- [ ] Borrador: sin claims inventados; editar un aprobado invalida la aprobación; máximo de mensajes.
- [ ] Envío controlado con `PROPUESTAS_ENVIO_HABILITADO=true` solo a dirección propia: message ID, headers, baja visible y one-click.
- [ ] Baja one-click: página pública sin login, POST 200/202, supresión por hash, prospecto `SUPRIMIDO`, pendientes cancelados.
- [ ] Reimportación del mismo email: bloqueada por hash; supresión visible y no borrada.
- [ ] Cupo de envíos: el intento 21 responde `429` y no encola.
- [ ] Retención en seco: `eliminados=0` sobre datos recientes; un prospecto de prueba viejo se borra y la supresión queda.
- [ ] Rollback probado: `PROPUESTAS_ENVIO_HABILITADO=false` deshabilita el envío; la aprobación no envía.
- [ ] Logs/Sentry sin PII ni tokens; `noindex`/`no-store`; token de baja no aparece en URLs logueadas.

### 4.3 Headers de la baja pública

Verificar con `curl -I` (o `curl -sS -D - -o /dev/null` si `-I` no es aceptado):

```bash
curl -I "https://<staging-host>/propuestas/baja/<token>"
curl -I "https://<staging-host>/api/opt-out"
```

Esperado en ambas rutas:

- `Referrer-Policy: no-referrer`
- `X-Robots-Tag: noindex, nofollow`
- `Cache-Control: no-store`

Notas:

- El header global es `strict-origin-when-cross-origin`; las entradas específicas de `next.config.ts` deben pisarlo con `no-referrer`.
- `/api/opt-out` es POST para mutar; un `HEAD/GET` puede devolver método no permitido, pero los headers de seguridad deben estar presentes. No usar `GET` para dar de baja.
- No pegar tokens reales en tickets, capturas o logs. En evidencia, enmascarar el token.

### 4.4 Locks y concurrencia

- **Retención:** `pg_try_advisory_xact_lock(hashtext('PROPUESTAS_RETENCION'))` es de **un argumento**. Validar en staging con dos corridas simultáneas: una procesa y la otra responde `200 { omitido: true }`; no debe haber doble borrado.
- **Cupos:** validar dos reservas simultáneas del mismo proveedor/día; el total no debe superar el cap. El lock diario es por `(proveedor, fecha)` y el presupuesto global usa `PROPUESTAS_PRESUPUESTO`.
- No ejecutar estas pruebas contra producción.

### 4.5 Envío controlado en staging

- [ ] T-19 (baja pública/one-click) verificado; **no habilitar envío antes de esta verificación**.
- [ ] Habilitar `PROPUESTAS_ENVIO_HABILITADO=true` solo para la prueba.
- [ ] Enviar a una dirección propia; verificar message ID, headers, baja visible y one-click.
- [ ] Confirmar supresión y cancelación de pendientes.
- [ ] Volver a `PROPUESTAS_ENVIO_HABILITADO=false` al terminar.
- [ ] Guardar evidencia redactada (sin tokens, sin emails completos).

### 4.6 Evidencia

Registrar en este runbook o en `t-26-staging.md`: fecha, commit/deploy, resultados por ítem, capturas redactadas, message ID de prueba, incidentes y decisión PASS/FAIL con observaciones.

---

## 5. Cron de retención

### 5.1 Function

- **Railway Function:** `propuestas-retencion` (crear si aún no existe).
- **Cron sugerido:** `0 4 * * *` UTC (01:00 en Argentina, UTC-3). Ajustar solo con decisión operativa.
- **Endpoint:** `GET https://pixelarch.dev/api/cron/propuestas-retencion`.
- **Auth:** `Authorization: Bearer $CRON_SECRET`.

> **No copiar el patrón de uptime/digest.** `/api/cron/uptime` y `/api/cron/digest` usan `x-cron-secret`. La retención usa **`Authorization: Bearer`**. Si se copia el header equivocado, responde `401` y no purga nada.

```bash
curl -sS -X GET "https://pixelarch.dev/api/cron/propuestas-retencion" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Nunca imprimir `$CRON_SECRET` ni pegarlo en tickets. El secreto debe existir en el servicio principal y en la Function.

### 5.2 Respuestas

| Situación | Respuesta |
|-----------|-----------|
| Purga ejecutada | `200 { ok: true, omitido: false, eliminados, lotes }` |
| Otra corrida tiene el lock | `200 { ok: true, omitido: true, eliminados: 0, lotes: 0 }` |
| Sin secreto/header inválido | `401` |
| Configuración inválida o esquema faltante | `503` |
| Error inesperado | `500` sanitizado |

Los logs solo llevan `origen`, `meses`, `omitido`, `eliminados`, `lotes` y códigos; nunca ids de prospectos, emails ni detalles de esquema.

### 5.3 Alternativa admin

`POST /api/propuestas/retencion` con sesión admin, same-origin y rate limit. Devuelve `{ eliminados, lotes, omitido }`. Es la vía manual para una purga fuera del horario o para verificar el comportamiento sin esperar al cron.

### 5.4 Mecánica de retención

- Corte: `ultimaInteraccionEn < ahora - PROPUESTAS_RETENCION_MESES` (12 por defecto), en UTC.
- Borrado en lotes de 100; tope de 100 lotes por corrida (10.000 prospectos).
- `Prospecto.deleteMany` con cascada: elimina borradores/envíos; `ConsumoProveedor.prospectoId` queda en `null`.
- `SupresionProspecto` **no** se borra: no tiene relación con `Prospecto`.
- Un valor inválido de retención falla cerrado (`503`), nunca interpreta “borrar todo”.
- La evidencia durable de aprobaciones/envíos/supresiones vive en la base; los logs no son evidencia legal.

---

## 6. Cupos, costos y `ConsumoProveedor`

### 6.1 Topes

| Proveedor (`ConsumoProveedor.proveedor`) | Qué mide | Default | Comportamiento |
|------------------------------------------|----------|---------|----------------|
| `GOOGLE_PLACES` | Requests de búsqueda | 20/día | `429` de Google corta la corrida; campaña `PARCIAL`/`FALLIDA`; sin retry en bucle. |
| `WEB_FETCH` | Páginas web | 100/día; 3 por prospecto | Timeout 8 s, 1 MB, solo HTML; sin assets ni redes sociales. |
| `AUDITORIA` | Auditorías internas | 20/día; 1 por prospecto/24 h | Reutiliza la lógica existente; no llama a `/api/audit`. |
| `REDACTOR` | Borradores | 20/día (config/UI) | **No reservado en v1**; ver deuda §11. |
| `RESEND` | Envíos | 20/día | Un envío por aprobación; el intento cuenta aunque falle la red; sin cola. |

- **Tope duro:** al 100% la acción se bloquea (`429`/UI); no se encola para el día siguiente ni se sobreconsume en silencio.
- **Aviso:** al 80% se muestra alerta; no bloquea.
- **Config inválida:** un cupo inválido se interpreta como `0` y bloquea la acción; no usa defaults silenciosos.
- **Overrides:** `capDiario`/`capCampana` son para tests/dev; las rutas de producción usan la config como hard cap.
- **Día UTC:** la clave de consumo usa `YYYY-MM-DD` UTC; la UI muestra es-AR.
- **Sin cola:** no hay worker, scheduler ni reintento automático de envíos.

### 6.2 Presupuesto mensual

- `PROPUESTAS_PRESUPUESTO_MENSUAL_CENTAVOS=0`: sin tope monetario.
- `>0`: tope global mensual; se aplica a todos los proveedores/campañas y no se puede desactivar con un override de test.
- Los costos son **estimados** (`PROPUESTAS_COSTO_PLACES_CENTAVOS`, `PROPUESTAS_COSTO_RESEND_CENTAVOS`); no son la factura del proveedor.
- Si el presupuesto se alcanza, la reserva falla con `429`/`LIMITE` y no hay cola.

### 6.3 Tabla de consumo

`ConsumoProveedor` guarda una fila por clave:

```text
<campanaId>:<proveedor>:<YYYY-MM-DD>:<prospectoId|GLOBAL>
```

Campos operativos: `unidades`, `llamadas`, `costoCentavos`, `proveedor`, `fecha`, `campanaId`, `prospectoId`. La UI muestra enviados/cap, restante, costo estimado y alerta. `unidades` es la unidad de cupo; `llamadas` permite distinguir llamadas externas (deuda menor de semántica).

---

## 7. Rollback e incidentes

### 7.1 Apagado inmediato

1. `PROPUESTAS_ENVIO_HABILITADO=false` y redeploy/restart si hace falta.
2. Verificar que el envío queda deshabilitado y que Resend no recibe llamadas. La aprobación puede seguir disponible, pero no envía.
3. Si el portal debe quedar inaccesible, revertir el deploy o bloquear la ruta; no borrar datos.
4. Si hay un incidente de acceso, revocar sesión/rol en Clerk y revisar logs/Sentry.

### 7.2 Datos

- Las tablas son aditivas: se conservan.
- **No borrar supresiones** ni prospectos para “volver atrás”.
- No hay migración inversa. Un deploy anterior puede ignorar las tablas nuevas; una versión nueva las reutiliza.
- No ejecutar SQL destructivo durante un rollback.

### 7.3 Webhooks y portal

- v1 no tiene webhooks de Resend. Si en el futuro se agregan, deshabilitar el endpoint y rotar su secreto según su propio procedimiento.
- “Deshabilitar el portal” significa cortar el acceso o revertir el deploy, no borrar la base.
- Al deshabilitar el portal, mantener `/api/opt-out` operativo mientras existan enlaces de baja emitidos. Si el rollback elimina esa ruta, coordinar una versión mínima que conserve la baja antes de cortar el servicio.

### 7.4 Envío trabado

Si un envío quedó `ENVIANDO`, no reintentar ni borrar. Ver §8.

### 7.5 Registro del incidente

Registrar: fecha/hora, commit/deploy, síntoma, alcance, acción tomada, responsable, si hubo envíos duplicados o PII, y criterio para re-habilitar. No incluir tokens, emails completos ni cuerpos.

---

## 8. Reconciliación de envíos

Un envío puede quedar `ENVIANDO` si el proceso murió entre la transición y la respuesta de Resend. **No hay auto-retry.**

1. Confirmar que el envío está `ENVIANDO` y que pasaron **más de 10 minutos** desde `enviadoEn`/`actualizadoEn`.
2. Verificar en el panel de **Resend** si el email salió, con message ID, destinatario y hora. No confiar solo en la UI.
3. Si **no salió**: marcar el envío como `FALLIDO` con nota, usando el endpoint admin:

```http
POST /api/propuestas/envios/<id>/reconciliar
Content-Type: application/json

{ "nota": "Verificado en Resend: no hay envío para este message ID; se marca FALLIDO." }
```

Respuesta esperada: `200 { estado: "FALLIDO" }`. La nota queda sanitizada. No se llama a Resend, no se envía nada y no se reintenta.

4. Si **sí salió**: **no usar `reconciliar`** (lo marcaría `FALLIDO` incorrectamente). Registrar el incidente con el message ID y corregir el estado con el implementer; no reenviar.
5. Para volver a intentar un `FALLIDO`: `POST /api/propuestas/envios/<id>/reintentar` crea `version+1` en `BORRADOR` con el mismo contenido. Requiere editar/aprobar de nuevo y consume cupo al enviar. No llama a Resend por sí solo.
6. **No hay botón de reconciliación en la UI** (deuda T-18): usar la API con sesión admin y same-origin, o pedir la herramienta antes de un incidente.

Ruta correcta: `/api/propuestas/envios/[id]/reconciliar`.

---

## 9. ARCO

Canal: `hola@pixelarch.dev`. El admin atiende y registra. No hay portal público de ARCO ni acceso del titular.

### 9.1 Exportar

- `POST /api/propuestas/arco/[prospectoId]` con `{ "tipo": "EXPORTAR" }`.
- Devuelve JSON descargable con datos, fuentes/fechas, auditoría, envíos e historial.
- No incluye tokens de baja, hashes de contenido, `idempotencyKey`, notas internas ni datos del CRM.
- Registrar fecha, solicitante y entrega.

### 9.2 Rectificar

- `POST /api/propuestas/arco/[prospectoId]` con `{ "tipo": "RECTIFICAR", "cambios": { ... }, "motivo": "..." }`.
- Mismas reglas que el PATCH de prospecto: no toca estado, campaña ni score; historial con motivo, campos, autor y fecha.
- Si cambia email, exige fuente y comprueba supresión/duplicados.

### 9.3 Eliminar

- `POST /api/propuestas/arco/[prospectoId]` con `{ "tipo": "ELIMINAR", "confirmado": true, "motivo": "..." }`.
- Si el prospecto tiene email, crea/reactiva una supresión `SOLICITUD_ARCO` **antes** de borrar; la supresión se conserva.
- El borrado es en cascada: elimina borradores/envíos; `ConsumoProveedor.prospectoId` queda en `null`.
- **No borrar la supresión** después de la eliminación.
- **Sin email:** no se inventa una supresión; solo queda un log sanitizado con `motivoHash` (SHA-256) y longitud. Si se necesita evidencia durable, abrir seguimiento; no crear una supresión ficticia.

### 9.4 Reglas

- No usar la revocación de supresión como flujo normal; solo excepción admin con motivo y registro.
- La eliminación ARCO no elimina automáticamente todos los datos por sí sola: el admin decide y deja constancia.
- No prometer plazos legales: el plazo y el texto exacto se validan con el abogado (`legal-checklist.md`).
- Las notas internas no se exportan; no pegar PII innecesaria en ellas.

---

## 10. Logs, privacidad y Sentry

### 10.1 Retención de logs

- Objetivo: **30 días** de logs técnicos.
- Verificar la retención configurada en Railway y dejar evidencia (fecha, plan, valor). Si el plan no permite 30 días, documentar el gap y escalar; no asumirlo.
- La evidencia durable de aprobaciones, envíos, supresiones y ARCO vive en la base, no en logs.

### 10.2 Qué no se registra

- Email completo, nombre, teléfono, asunto, cuerpo, HTML de la web, token de baja, `Authorization`, `CRON_SECRET`, API keys.
- Solo ids internos, estados, códigos, duración y contadores.
- No confiar en la redacción automática para texto libre: no pasar PII en `meta` de logs. `redactarMetaPropuestas` no cubre todos los callers (deuda T-23).
- El token de baja no debe aparecer en URLs de logs, Sentry, analytics ni capturas. Enmascarar en evidencia.

### 10.3 Sentry

- Sin DSN, Sentry es no-op; el portal sigue funcionando.
- La redacción debe ocultar `/propuestas/baja/<token>` y `?token=` de `/api/opt-out`.
- Verificar con un evento de prueba (sin PII) que el token queda como `[token]`/`[REDACTED]` y que no se envía email/cuerpo.
- Revisar también el runtime cliente; el test de Sentry cliente es una deuda (T-23).

### 10.4 Retención y evidencias

| Dato | Plazo | Acción |
|------|-------|--------|
| Prospecto | 12 meses desde última interacción | Purga cron/manual; borra borradores/envíos; conserva supresión. |
| Borradores/envíos | Con el prospecto | Cascada; no se conservan indefinidamente. |
| Supresión | Permanente | No borrar; revocación solo excepción con motivo. |
| Logs técnicos | 30 días | Retención Railway; sin PII. |
| Evidencia de aprobaciones/envíos | Mientras viva el prospecto | Base de datos; no logs. |

### 10.5 Rotación de `PROPUESTAS_SECRETO`

- Rotar invalida los tokens de baja ya enviados y los hashes de supresión calculados con el secreto anterior; también invalida la aprobación si el hash/token cambia.
- Las filas de `SupresionProspecto` **no se borran**, pero dejan de coincidir con el hash nuevo: una supresión vieja puede no bloquear el email. No hay rehash automático en v1 (la tabla no guarda el email en claro).
- Planificar: anunciar ventana, pausar envíos, rotar, verificar baja/supresión y re-aprobar borradores aprobados. Si se necesita conservar la eficacia de supresiones existentes, evaluar el procedimiento antes de rotar; no hay una migración automática.
- No hay soporte de doble secreto en v1. Los enlaces viejos pueden dejar de funcionar; ofrecer reply-to/ARCO como canal alternativo.
- No rotar durante una campaña activa ni como “prueba” en producción.

### 10.6 AAIP y transferencia internacional (operativo)

Antes del primer envío real, `legal-checklist.md` §6 debe estar completo. El runbook no reemplaza la decisión legal; solo la deja operativa.

- **AAIP/inscripción:** si el abogado determina que corresponde inscribir o actualizar la base, el trámite se completa antes de habilitar el envío. Registrar número/fecha en el checklist legal; no inventar números.
- **Transferencia internacional:** Google Places, Resend, Railway y un futuro LLM pueden procesar datos fuera de Argentina. Verificar país/región, DPA/términos y si hace falta aviso o base legal adicional.
- **Datos alcanzados:** consulta/`place_id` (Google), email profesional/asunto/cuerpo/message ID (Resend), datos del portal (Railway), errores técnicos (Sentry opcional), datos de negocio/auditoría (LLM futuro, no v1).
- **Si falta la decisión:** `PROPUESTAS_ENVIO_HABILITADO=false`; no se envía. La búsqueda/análisis/borrador pueden seguir en seco.
- **Evidencia:** dejar en el checklist legal la decisión, la fecha y el responsable; no copiar contratos con secretos en el repositorio.

---

## 11. Diferencias y deudas conocidas

| Origen | Deuda | Impacto operativo | Mitigación |
|--------|-------|-------------------|------------|
| T-16/T-18/T-20/T-21 | Listados limitan filas sin paginación completa: bandeja 200 antes de ordenar, envíos 100, supresiones 200. | Un volumen alto puede ocultar pendientes o históricos. | Mantener volumen v1 bajo; revisar y paginar antes de escalar. |
| T-16/T-21 | Cupo `REDACTOR` (borradores 20/día) definido en config/UI pero **no reservado**. | No hay hard cap real de borradores. | Control manual; implementar reserva en seguimiento. |
| T-18 | Reconciliación de `ENVIANDO` sin botón en la UI. | Requiere API/sesión admin en un incidente. | Documentado en §8; no esperar a tener el incidente. |
| T-16 | El grounding no descarta una auditoría `FALLIDA` o vencida. | Un borrador podría citar hallazgos viejos. | Revisar fecha/estado de la auditoría antes de aprobar; regenerar si es vieja. |
| T-17/T-18 | Headers no se persisten; se reconstruyen al enviar desde snapshot + URL/reply-to actuales y se comparan con `aprobadoHash`. | Cambiar from/reply/URL/texto entre aprobar y enviar produce `409`; hay que re-aprobar. | No cambiar envs entre aprobación y envío; verificar antes. |
| T-17 | La UI de aprobación muestra from/reply del borrador, pero la ruta usa la config actual. | Puede haber discrepancia visual. | Revisar la config vigente antes de aprobar; el servidor manda. |
| T-18 | El cupo `RESEND` se consume ante fallo de red (cuenta el intento). | Un fallo puede consumir uno de los 20 envíos. | Monitorear cupo; no reintentar a ciegas. |
| T-11/T-12/T-19 | Rate limits en memoria, best-effort; se reinician con el deploy. | No son distribuidos; no son hard cap. | `ConsumoProveedor` es la fuente autoritativa. |
| T-18/T-20 | Sin webhooks de Resend: rebotes/quejas/respuestas se registran manualmente. | Depende de revisar Resend y el buzón. | Revisión diaria; registrar resultado en el portal. |
| T-22 | ARCO sin email: solo log sanitizado, sin evidencia durable en BD. | Puede faltar evidencia para una solicitud sin email. | Registrar ticket externo; evaluar esquema dedicado. |
| T-20 | En ámbito `DOMINIO`, pegar un email suprime el dominio. | Puede bloquear un dominio entero por error. | Usar `EMAIL` para emails; confirmar antes de guardar. |
| T-20 | Notas de supresión libres sin redacción; límites 500/1000. | Riesgo de PII en notas. | No pegar PII; revisar antes de guardar. |
| T-21 | Places no se registra por prospecto y el restante puede estar acotado; no refleja siempre el global. | La ficha puede mostrar 0/20 o un restante conservador. | Mirar el dashboard/global; no confiar solo en la ficha. |
| T-22 | La exportación ARCO no incluye la entrada `EXPORTACION` recién registrada. | El JSON puede no mostrar esa acción. | Guardar acuse externo; no bloquea el acceso. |
| T-12/T-13/T-14 | `esErrorTablaFaltante` no cubre `P2022`; drift de esquema puede dar `500` en vez de `503`. | Un esquema incompleto puede parecer error genérico. | Verificar `db push` y tablas; revisar logs de esquema. |
| T-09/T-10/T-15 | Auditoría/TLS: sin test de transporte real; en HTTP se duplica el hallazgo de HTTPS; timeout DNS+request puede sumar ~2×8 s. | Hallazgos/tiempos pueden ser conservadores. | Validar en staging con sitio controlado; no saltar TLS. |
| T-13/T-14 | Dedupe multiinquilino (`wixsite.com`) y sucursales requieren revisión manual; no hay fusión automática. | Puede aparecer un posible duplicado. | Revisar `posibleDuplicadoDeId`; no fusionar a ciegas. |
| T-17/T-18 | Algunas validaciones (otro APROBADO/ENVIANDO, supresión) ocurren fuera de la transacción; carreras de historial/resultado. | En concurrencia puede haber estados transitorios. | Un solo admin operando; revisar antes de reintentar. |
| T-19 | La página de baja requiere JS para confirmar; sin JS no hay POST. | Puede afectar una baja si el cliente no ejecuta JS. | Evaluar fallback form POST; documentar en legal checklist. |
| T-19 | Sin `PROPUESTAS_SECRETO`, la baja pública no puede verificar el token (respuesta genérica sin supresión efectiva). | No se puede suprimir de forma fiable. | No operar sin secreto; la config lo exige para baja/aprobación. |
| T-22 | `motivoHash` de ARCO es SHA-256 sin secreto; el historial puede tener carreras. | Menor; no usar motivos sensibles. | No pegar PII en motivos; revisar historial. |
| T-23 | Redacción de logs no cubre todos los callers; guard LLM con lista fija; Sentry cliente sin test runtime. | Un meta mal armado podría filtrar PII. | Logs solo con campos permitidos; verificar Sentry manualmente. |
| T-12/T-21 | Helper de IP y banner de cupos duplicado; detalles de UI. | Cosmético/operativo menor. | No bloquea v1. |
| — | `PROPUESTAS_SECRETO` sin doble versión. | Rotar invalida enlaces. | Planificar §10.5. |
| — | Sin conversión a CRM ni pagos. | El portal no crea clientes/proyectos. | Fuera de alcance; no intentar desde el portal. |

---

## 12. Checklist operativo recurrente

### Antes de cada release que toque el portal

- [ ] `PROPUESTAS_ENVIO_HABILITADO=false` si no está aprobado el envío.
- [ ] `db push` verificado; sin pérdida de datos; sin FKs al CRM.
- [ ] Health OK.
- [ ] `/propuesta` público; `/propuestas` admin-only; asistente denegada.
- [ ] Headers `noindex`/`no-store`; baja con `no-referrer`.
- [ ] Sin PII en logs/Sentry.
- [ ] Rollback probado (`false` deshabilita envío).

### Diario / semanal

- [ ] Revisar `/api/health`, 5xx y Sentry.
- [ ] Revisar cupos y presupuesto; 80% aviso, 100% bloqueo.
- [ ] Revisar envíos `ENVIANDO` >10 min; reconciliar solo tras verificar Resend.
- [ ] Revisar rebotes/quejas/respuestas y registrar resultado.
- [ ] Revisar supresiones; no borrar.
- [ ] Revisar retención (cron `propuestas-retencion`) y logs de purga.
- [ ] Revisar correo ARCO (`hola@pixelarch.dev`) y registrar solicitudes.

### Mensual

- [ ] Verificar retención de logs (30 días) y evidencia durable.
- [ ] Revisar costo estimado vs factura de Places/Resend.
- [ ] Revisar supresiones y posibles duplicados.
- [ ] Probar restore de backup en staging (si el plan lo permite).
- [ ] Revisar deudas de §11 y priorizar.

---

## 13. Registro de cutover y estado de producción (2026-11-14)

Este registro refleja la **aplicación directa autorizada por el dueño**, no un gate T-27. T-26 y T-27 no se ejecutaron como gates. No adjuntar secretos.

| Campo | Valor |
|-------|-------|
| Fecha/hora (UTC) | 2026-11-14 (hora exacta no registrada) |
| Responsable | Dueño (autorización) y operador del deploy `[NECESITA ACLARACION: nombre]` |
| Commit/deploy | Commit `700eaf1` + docs posteriores · deploy `02a5ca66` |
| Backup `pg_dump` (archivo/verificación) | No consta en este registro; el esquema se aplicó con un job temporal de Railway/Prisma (ver §0) |
| `db push` (resultado) | Aplicado mediante job temporal de Railway/Prisma; 6 tablas + 8 enums verificados; job y servicios temporales eliminados |
| Health | OK (`/api/health`) |
| Portal admin-only | Sí; APIs `/api/propuestas/**` responden `401` sin sesión |
| Smoke en seco (sin envío) | **Pendiente** (no ejecutado) |
| Checklist legal firmado (fecha) | **Pendiente** |
| Autorización del dueño para T-27 (fecha) | **No aplica como gate:** T-27 no se ejecutó; el 2026-11-14 el dueño autorizó aplicar el portal directamente en producción |
| `PROPUESTAS_ENVIO_HABILITADO=true` | **No ejecutado**; sigue `false` |
| Primer envío (message ID, hora) | **Pendiente** (no ejecutado) |
| Headers/baja one-click | **Pendiente** de validación real |
| Supresión verificada | **Pendiente** de validación real |
| Monitoreo 24-48 h | No aplica aún (sin envíos) |
| Rollback probado | No registrado en este corte; verificar antes de habilitar el envío |
| Observaciones/deuda | 52 variables en PixelArch, `PROPUESTAS_SECRETO` generado, `PROPUESTAS_TEXTO_LEGAL`/`PROPUESTAS_BASE_LEGAL` no cargados; T-26/T-27 no ejecutados como gates; validación real pendiente (§0.1). No habilitar envío sin checklist legal, SPF/DKIM/DMARC y pruebas controladas. |

---

## 14. Contactos y escalamiento

| Rol | Responsable | Nota |
|-----|-------------|------|
| Dueño / aprobador | `[COMPLETAR]` | Autoriza el rollout y el checklist legal. El 2026-11-14 autorizó aplicar el portal directamente en producción; T-27 no se ejecutó como gate. |
| Abogado / revisión legal | `[COMPLETAR]` | Texto, base legal, AAIP, transferencia. |
| Admin del portal | `[COMPLETAR]` | Opera prospección, aprobaciones, ARCO. |
| Resend | `[COMPLETAR]` | Dominio, DNS, rebotes/quejas. |
| Google Cloud / Places | `[COMPLETAR]` | Clave, cuotas, facturación. |
| Railway | `[COMPLETAR]` | Deploy, envs, logs, Function. |

No incluir teléfonos, emails personales ni credenciales en este documento si se comparte fuera del equipo.
