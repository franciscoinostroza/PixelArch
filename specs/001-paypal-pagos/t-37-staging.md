# T-37 — Staging Railway con Postgres separado (runbook de ejecucion)

**Tarea:** T-37 (AC-16, AC-29; RNF-11)
**Spec:** `./spec.md`
**Plan:** `./plan.md` §4.2 (backfill), §7.1 (variables), §7.2 (Railway), §7.3 (webhook), §7.5 (migracion y rollback), §7.7 (checklist)
**Runbook base:** `./sandbox.md` §2.2, §3, §4 (pasos 1-14), §5, §6, §7, §10
**Backfill:** `./backfill.sql`
**Estado:** **EJECUTADO EN STAGING — P-1..P-8 completos**. Checklist 1-14 validado (pasos 5, 11 y 14 con limitacion/observacion); **T-38 pendiente de aprobacion explicita del dueno**. Este documento no toca produccion; la evidencia esta en `review.md`.

> **Alcance:** T-37 se ejecuto en Railway staging con Postgres separado; los 14 pasos de `sandbox.md` §4 quedaron `PASS` con las salvedades de los pasos 5, 11 y 14. La evidencia, los hallazgos y el veredicto estan en `review.md`. El cierre formal en `tasks.md` lo hace el implementer.

---

## 0. Resumen y reglas duras

1. Se crea un entorno **`staging` vacio**, con **Postgres nuevo** y **servicio web nuevo**, en la misma region `us-west2`. No se duplica ni se sincroniza produccion.
2. La migracion (`prisma db push`) se ejecuta **antes del primer deploy** en staging. El codigo ya consulta `Pago.pasarela`, `EnlacePago`, `EventoPasarela` y `AjustePago`; sin esquema, `/admin/pagos` y `/admin/cobros` fallan aunque PayPal este deshabilitado.
3. Primero se despliega con PayPal **deshabilitado** (sin ninguna `PAYPAL_*`) y se hace smoke test. Recien despues se cargan credenciales sandbox y `PAYPAL_WEBHOOK_ID`.
4. La validacion final es el checklist de `sandbox.md` §4 (1-14); la evidencia va al registro §10 y no contiene secretos ni PII.
5. Produccion es **solo lectura** durante T-37: mismo `/api/health`, mismos conteos/ids de pagos, mismas variables, sin deploys ni escrituras.

### Reglas duras (si una falla, detener)

- **Nunca** usar la DB de produccion `62441c9a-785f-4871-b75f-ca8c1430959b` en staging, ni con otro schema, ni como copia.
- **Nunca** copiar un `DATABASE_URL` literal de produccion. En staging debe ser una referencia `${{<postgres-staging>.DATABASE_URL}}`.
- **Nunca** ejecutar `prisma db push`, `prisma db push --force-reset`, `--accept-data-loss` ni `backfill.sql` contra produccion durante T-37.
- **Nunca** deployar a produccion, cambiar variables de produccion ni redeployar el servicio `PixelArch` `871fb7fb-789f-447e-9a9d-49b7b47cea27`.
- **Nunca** cargar `PAYPAL_ENV=production` ni credenciales PayPal de produccion en staging.
- **Nunca** pegar secretos, `DATABASE_URL`, tokens completos, `PAYPAL_WEBHOOK_ID` completo, emails/nombres de pagadores ni payloads crudos en la evidencia o en el chat.
- **Nunca** usar `railway environment new staging --copy production` como camino por defecto (ver §3).
- Toda operacion sobre produccion en este runbook es **solo lectura** (`GET /api/health`, `/admin/pagos`, listar nombres de variables, listar deployments).

> **Sin cambios de codigo:** T-37 es infraestructura + validacion. No modifica `src/**`, `prisma/schema.prisma`, `plan.md` ni `tasks.md`. Si un paso requiere un cambio de CSP, Clerk o Sanity, se abre una tarea aparte; no se improvisa en T-37.

---

## 1. Estado al preparar el runbook y por que migrar antes del primer deploy

> Este es el estado previo a T-37. El resultado real de la ejecucion esta en §5 y en `review.md`.

| Elemento | Estado real |
|---|---|
| Proyecto | `PixelArch-Plataforma` `1f0ad07e-c893-42f9-a152-13559641b7b9` |
| Entornos | Solo `production` `89e0c0f9-da00-4e45-b986-d54014618c35`; **staging no existe** |
| Servicio web prod | `PixelArch` `871fb7fb-789f-447e-9a9d-49b7b47cea27`, repo `franciscoinostroza/PixelArch`, branch `main`, builder RAILPACK, region `us-west2`, health `/api/health`, dominio `https://pixelarch.dev` |
| Postgres prod | `62441c9a-785f-4871-b75f-ca8c1430959b`, volumen 5 GB, TCP proxy. **No usar en staging** |
| Codigo PayPal | Implementado en `main`; la BD de produccion **no** tiene las tablas/columnas nuevas y PayPal no esta deployado |
| Migracion pendiente | `EnlacePago`, `EventoPasarela`, `AjustePago` y campos nuevos de `Pago`; requieren `db push` + `backfill.sql` |

**Consecuencia:** el primer build de staging ya incluye el codigo que lee el esquema nuevo. Si se deploya antes de migrar, `/api/health` puede responder `ok` (solo hace `SELECT 1`), pero `/admin/pagos` y `/admin/cobros` devuelven 500. Por eso el orden es:

```
crear servicios -> cargar variables base -> db push/generate -> primer deploy (PayPal off)
-> smoke -> sandbox vars + webhook -> checklist 1-14 -> produccion intacta
```

Esto invierte el orden de algunos borradores que ponian el deploy antes de la migracion; es intencional y obligatorio.

---

## 2. Topologia objetivo

```
Railway project: PixelArch-Plataforma (1f0ad07e-c893-42f9-a152-13559641b7b9)
├─ production (89e0c0f9-da00-4e45-b986-d54014618c35)   <- SOLO LECTURA en T-37
│  ├─ PixelArch (871fb7fb-789f-447e-9a9d-49b7b47cea27)  https://pixelarch.dev
│  └─ Postgres (62441c9a-785f-4871-b75f-ca8c1430959b)   5 GB + TCP proxy
└─ staging (<staging-environment-id>)                  <- T-37
   ├─ PixelArch-staging (<staging-web-service-id>)      https://<staging-domain>
   └─ Postgres-staging (<staging-postgres-id>)          volumen nuevo, sin datos de prod
```

| Recurso staging | Valor esperado | Nota |
|---|---|---|
| Entorno | `staging` | Vacío al crear; no duplicar production |
| Servicio web | `PixelArch-staging` (recomendado) o `<staging-web-service>` | Servicio **nuevo**, no el `PixelArch` de produccion |
| Fuente | `franciscoinostroza/PixelArch`, branch `main` | Mismo commit que se validara |
| Builder | El mismo del servicio de produccion (RAILPACK con el `Dockerfile` del repo); no cambiarlo en T-37 | El `Dockerfile` ya declara los `ARG` de `NEXT_PUBLIC_*` |
| Region | `us-west2` | Misma region que el Postgres staging (private networking) |
| Health | `/api/health` | Lo toma `railway.toml` |
| Dominio | `https://<staging-domain>` | Railway `*.up.railway.app`; no `pixelarch.dev` |
| Postgres | `Postgres-staging` (nombre real, puede ser `Postgres-2`) | Servicio y volumen nuevos |
| Funciones/cron | Ninguna | No copiar `uptime-cron` ni `digest-cobros` a staging |

> **Nombres de servicio:** los servicios son recursos del proyecto. Si `PixelArch` o `Postgres` ya existen en produccion, Railway puede generar un sufijo (`PixelArch-staging`, `Postgres-2`). **No forzar el renombre** para reutilizar un nombre tomado: ajustar la referencia al nombre real. Las referencias `${{servicio.VARIABLE}}` se resuelven por entorno.

---

## 3. Decision: entorno vacio vs `--copy production`

### 3.1 Recomendado: entorno vacio

Dashboard: selector de entorno → **+ New Environment** → **Empty Environment** → nombre `staging`.
CLI:

```powershell
railway environment new staging
```

Un entorno vacio no arrastra servicios, variables ni volumenes de produccion. Es la unica forma simple de garantizar que staging no nace apuntando a la DB de produccion.

### 3.2 `--copy production`: no recomendado

```powershell
# NO USAR POR DEFECTO
railway environment new staging --copy production
```

Copia servicios y configuracion (y puede dejar cambios en staged). Riesgos concretos:

- `DATABASE_URL` puede quedar como URL literal de produccion o referencia al Postgres de produccion.
- `NEXT_PUBLIC_URL` queda `https://pixelarch.dev`; los links de pago y el webhook apuntarian a produccion.
- Se copian secretos de Clerk, Resend, Mercado Pago, Sentry y (si existieran) PayPal de produccion.
- Se pueden copiar Functions/cron (`uptime-cron`, `digest-cobros`) y disparar alertas/digests desde staging.
- Un deploy de staging podria escribir en la DB de produccion o mandar emails reales.

**Si el dueno decide usarlo igualmente**, antes de deployar hay que auditar y corregir **todas** estas variables, y firmar la auditoria en el registro:

| Variable | Accion obligatoria |
|---|---|
| `DATABASE_URL` | Reemplazar por referencia `${{<postgres-staging>.DATABASE_URL}}`. Si es literal `postgres://...`, borrarla y volver a crearla como referencia. |
| `NEXT_PUBLIC_URL` | Cambiar a `https://<staging-domain>` **antes del primer build**. |
| `PAYPAL_*` | Eliminar todas. Staging arranca con PayPal deshabilitado. |
| `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` | Reemplazar por credenciales de prueba. Nunca las de produccion. |
| `CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Decision explicita del dueno (ver §6/P-3). |
| `RESEND_API_KEY` | Key de staging o restringida; destinatarios solo el dueno. |
| `SANITY_API_TOKEN` / `SANITY_REVALIDATE_SECRET` | Token read-only o de staging; no reutilizar escritura de produccion. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Proyecto staging o vacio; no mezclar errores de prod. |
| `CRON_SECRET`, `RAILWAY_API_TOKEN`, `VERCEL_API_TOKEN` | Eliminar; staging no corre crons ni controla deploys. |
| Servicios/Functions | Verificar que no se copiaron `uptime-cron` ni `digest-cobros`; si estan, eliminarlos de staging. |

**Criterio:** si `railway status` en staging muestra el Postgres de produccion, o si `DATABASE_URL` no es una referencia al Postgres staging, **ABORTAR** y recrear el entorno vacio.

---

## 4. Placeholders

| Placeholder | Significado |
|---|---|
| `<staging-environment-id>` | ID del entorno `staging` creado en P-1 |
| `<staging-web-service>` | Nombre del servicio web staging; recomendado `PixelArch-staging` |
| `<staging-web-service-id>` | ID del servicio web staging |
| `<staging-postgres>` | Nombre real del Postgres staging (`Postgres-staging`, `Postgres-2`, etc.) |
| `<staging-postgres-id>` | ID del Postgres staging (debe ser distinto de `62441c9a-...`) |
| `<staging-domain>` | Dominio publico staging, sin `https://` al usarlo en URLs |
| `<test-email>` | Email del dueno con alias de prueba (nunca un cliente real) |
| `<sanity-project-id>` / `<sanity-dataset>` | Proyecto/dataset de Sanity a usar en staging (`g0wvbc4g`/`production` si se reutiliza) |
| `<commit>` | `RAILWAY_GIT_COMMIT_SHA` del deployment staging (visible en el detalle del deployment) |
| `<prod-web-service>` | `PixelArch` `871fb7fb-789f-447e-9a9d-49b7b47cea27` |
| `<prod-postgres>` | `62441c9a-785f-4871-b75f-ca8c1430959b` (solo lectura, evitar) |

---

## 5. Tabla de estado T-37 (P-1..P-8)

| Paso | Accion | Comando / herramienta | Resultado esperado | Evidencia | Estado |
|---|---|---|---|---|---|
| **P-1** | Crear entorno `staging` vacio | `railway environment new staging` o dashboard Empty Environment | Entorno sin servicios, separado de production | Entorno `57936b79-5d77-4408-92b3-8d1b69f40647`, separado de `production` | `PASS` |
| **P-2** | Crear Postgres staging + servicio web nuevo + dominio | Dashboard o `railway add --database postgres`, `railway add --service PixelArch-staging`, `railway domain ...` | DB y web propios, region `us-west2`, dominio HTTPS | `Postgres-gdmt`; servicio `3aab4a6e-3f35-42df-a604-256f5b635a0a`; `https://staging.pixelarch.dev` | `PASS` |
| **P-3** | Cargar variables base sin PayPal | `railway variable set ... --skip-deploys` o dashboard/MCP | 6 requeridas + opcionales; cero `PAYPAL_*`; `DATABASE_URL` como referencia | 28 variables al cierre; sin credenciales de produccion de PayPal/MP ni control de deploys; H-1 resuelto (Clerk/Resend/Sentry por decision del dueno) | `PASS` (H-1 resuelto) |
| **P-4** | Migrar staging (`db push` + `generate`) | `node node_modules\prisma\build\index.js db push` con URL efimera de staging | Esquema nuevo solo en staging; tablas nuevas presentes | Esquema aplicado solo en `Postgres-gdmt`; checklist 2 `PASS` | `PASS` |
| **P-5** | Primer deploy con PayPal deshabilitado + smoke | Conectar source / `railway up`; health; `/admin/pagos`; link MP | App arranca, admin carga, PayPal deshabilitado, MP operativo | Health `ok`; checklist 1-4 `PASS`; PayPal deshabilitado y MP operativo | `PASS` |
| **P-6** | Cargar sandbox PayPal + webhook | PayPal Developer + `railway variable set` + redeploy | `PAYPAL_ENV=sandbox`; PayPal disponible; webhook 401 (no 503/404) | Webhook sandbox con los 7 eventos; `PAYPAL_WEBHOOK_ID` coincidente; `401` sin firma; checklist 3 y 9 `PASS` | `PASS` |
| **P-7** | Ejecutar checklist `sandbox.md` §4 (1-14) | UI admin + PayPal sandbox + requests de prueba | 14 pasos `PASS` o `NO APLICA`; ningun `FAIL`/`BLOCKED` | Deploy final `4c765526-acc7-421f-a62f-2c03745e0891` / commit `139b8cb`; 1-14 `PASS`: 5 con ±US$0,01 (H-3), 11 con observacion MP (H-6), 14 con observaciones; detalle en `review.md` §2 | `PASS` con limitacion/observacion |
| **P-8** | Confirmar produccion intacta + cierre/rollback | Lecturas de produccion; comparacion con baseline | Mismos conteos/ids/variables/deployment; sin datos sandbox | Produccion: deploy `554f70d7-4ebd-47db-9812-b831052c9a32`, commit `cdafe04`, branch `main`, `/api/health` `ok`; sin migracion ni deploy PayPal; DB separada | `PASS` |

**Resultado real (cierre de evidencia 2026-10-29):** P-1..P-8 `PASS`; checklist 1-14 `PASS` con las
salvedades de los pasos 5 (tolerancia de redondeo ±US$0,01), 11 (warnings de firma MP, H-6) y 14
(observaciones; produccion intacta).
Sin `FAIL` ni `BLOCKED`. Evidencia, IDs y hallazgos H-1..H-9 en `review.md`.

**H-1 (P-3):** se quitaron de staging `RAILWAY_API_TOKEN`, `CRON_SECRET`, `SANITY_REVALIDATE_SECRET` y
`SANITY_API_TOKEN` (Editor/write); el sitio publico sigue funcionando. Quedan `CLERK_*`,
`RESEND_API_KEY` y `SENTRY_AUTH_TOKEN`/`SENTRY_*` por decision explicita del dueno (staging no recibe
clientes reales; emails de prueba al dueno).

**T-38:** no ejecutado. Requiere aprobacion explicita del dueno y la migracion/backfill de produccion
**antes** del merge a `main`/auto-deploy (H-2); FF-merge de `paypal-staging` para conservar `139b8cb`.

**Dependencias (verificadas en la ejecucion):** P-3 antes de P-5 (variables build-time), P-4 antes de
P-5 (esquema), P-6 antes de P-7, P-8 despues de P-7.

**Mapeo con `sandbox.md` §3 (P-1..P-8):**

| `sandbox.md` §3 | Este runbook |
|---|---|
| P-1 Crear/verificar servicio web y Postgres | P-2 |
| P-2 Cargar `DATABASE_URL` + `db push`/`generate` + backfill | P-4 |
| P-3 Deploy con PayPal deshabilitado + smoke | P-5 |
| P-4 Cargar variables sandbox + redeploy | P-6 (6.3) |
| P-5 Webhook sandbox + `PAYPAL_WEBHOOK_ID` | P-6 (6.2/6.4) |
| P-6 Datos de prueba (cliente, hito, soporte) | P-7 |
| P-7 Abrir registro de evidencia | P-7/P-8 |
| P-8 Baseline de produccion (solo lectura) | P-8 (8.1) |

La numeracion de este documento separa “crear servicios”, “variables base” y “migrar” para que el primer build no herede una configuracion incompleta; el contenido es el mismo de `sandbox.md` §3.

**Cobertura de AC en T-37:**

| AC | Donde se valida |
|---|---|
| AC-16 | P-5 (PayPal deshabilitado sin credenciales; MP sigue) y P-6 (credencial invalida opcional, mensaje claro) |
| AC-29 | P-7 (checklist 1-14 en staging) y P-8 (produccion intacta; evidencia) |

---

## 6. Detalle de pasos

### P-1 — Crear el entorno `staging` vacio

**Objetivo:** un entorno aislado, sin servicios ni variables, que no herede nada de produccion.

#### Camino recomendado (dashboard primero, CLI despues)

1. En Railway, abrir el proyecto `PixelArch-Plataforma`.
2. Selector de entorno → **+ New Environment** → **Empty Environment** → nombre `staging`.
3. Verificar que el selector quede en `staging` y que el canvas este vacio.
4. Linkear la CLI a ese entorno:

```powershell
railway login
railway link --project 1f0ad07e-c893-42f9-a152-13559641b7b9 --environment staging
railway status
```

`railway status` debe mostrar `Environment: staging` y ningun servicio de produccion.

#### Camino solo CLI

```powershell
railway link --project 1f0ad07e-c893-42f9-a152-13559641b7b9
railway environment new staging
railway environment staging
railway status
```

> **Precaucion:** `railway link --project ...` sin `--environment` puede pedir un entorno y dejar `production` linkeado. No ejecutar ninguna mutacion (`add`, `variable set`, `db push`, `redeploy`) hasta confirmar con `railway status` que el entorno linkeado es `staging`.

**Resultado esperado:** entorno `staging` creado y vacio; CLI linkeada a staging.

**Evidencia:** nombre/ID del entorno, captura del canvas vacio y salida de `railway status` (sin valores de variables).

**No hacer:** `railway environment new staging --copy production`; crear servicios antes de confirmar el entorno.

---

### P-2 — Crear Postgres staging, servicio web nuevo y dominio

**Objetivo:** DB y web propios de staging, en `us-west2`, con URL publica estable.

#### 2.1 Postgres staging

**Dashboard (recomendado, permite elegir region y evita conflictos de nombre):**

1. Con el entorno `staging` seleccionado: **New** → **Database** → **PostgreSQL**.
2. Region `us-west2`.
3. Nombre: `Postgres-staging` si esta disponible; si Railway asigna otro (`Postgres`, `Postgres-2`), registrar el nombre real. No importar datos ni backup de produccion.
4. Esperar a que el servicio este activo y tenga su volumen propio.

**CLI (alternativa):**

```powershell
railway add --database postgres
railway status
```

> `railway add --database postgres` crea la DB en el entorno linkeado. Si el nombre `Postgres` ya existe en el proyecto, Railway puede generar un sufijo o fallar; en ese caso usar el dashboard. **No** renombrar el Postgres de produccion ni reutilizar su volumen.

**Verificacion obligatoria:**

- El ID del Postgres staging **no** es `62441c9a-785f-4871-b75f-ca8c1430959b`.
- El volumen es nuevo (no el volumen de 5 GB de produccion).
- El servicio aparece solo en `staging`, no en `production`.
- `railway status` en staging no muestra el Postgres de produccion.

#### 2.2 Servicio web staging

Crear un servicio **nuevo y vacio** (sin source todavia), para cargar variables antes del primer build:

```powershell
railway add --service PixelArch-staging
```

Alternativa MCP (con el ID del entorno staging):

```text
create-service(
  projectId: "1f0ad07e-c893-42f9-a152-13559641b7b9",
  name: "PixelArch-staging",
  environmentId: "<staging-environment-id>"
)
```

> Tambien existe `create-deployment(repo, branch, name, environmentId)`, que crea el servicio **y dispara el primer deploy**. Si se usa, ese primer deploy es descartable: se hizo antes de cargar `NEXT_PUBLIC_URL` y las demas variables build-time, asi que despues de P-3 hay que forzar un build nuevo. El camino recomendado sigue siendo servicio vacio → variables → conectar source.

**No** reutilizar el servicio `PixelArch` de produccion. Si se reutilizara, cualquier cambio de source/variables debe ser por entorno y revisado en staged changes; un `connect-service-source` sin `environmentId` aplica a todos los entornos y puede tocar produccion.

#### 2.3 Dominio publico staging

```powershell
railway domain -s PixelArch-staging -e staging
railway domain list -s PixelArch-staging -e staging
```

Dashboard equivalente: servicio → **Settings** → **Networking** → **Generate Domain**.

- Usar el dominio Railway `https://<algo>.up.railway.app` por defecto. Es estable y evita DNS.
- **No** usar `https://pixelarch.dev` ni un dominio de produccion.
- El dominio staging es publico: no cargar PII real ni compartirlo. La app no tiene un `noindex` global; si se necesita, es un cambio de codigo fuera de T-37.
- Si el dueno quiere `staging.pixelarch.dev`, crear el custom domain, completar DNS/TXT, esperar el certificado y recien entonces usarlo en `NEXT_PUBLIC_URL` y en el webhook. Es opcional y agrega pasos.

> El dominio debe existir **antes** del primer build, porque `NEXT_PUBLIC_URL` es build-time (`ARG` en `Dockerfile`).

#### 2.4 TCP proxy para migrar (temporal, opcional)

Solo si se va a ejecutar `prisma db push` desde la maquina local con `DATABASE_PUBLIC_URL`:

```powershell
railway tcp-proxy create -s <staging-postgres> -e staging --port 5432
railway tcp-proxy list -s <staging-postgres> -e staging
```

Debe ser el proxy del **Postgres staging**. Se elimina al terminar P-4:

```powershell
railway tcp-proxy delete 5432 -s <staging-postgres> -e staging -y
```

Si el dueno no autoriza un proxy publico, usar el fallback de P-4 (`railway connect --tunnel-only`).

**Resultado esperado:** Postgres staging activo con volumen propio, servicio web staging vacio, dominio HTTPS asignado.

**Evidencia:** IDs/nombres de ambos servicios, region, dominio, ID del volumen (sin credenciales), captura de `railway status`.

**No hacer:** crear la DB en produccion, copiar el volumen de produccion, asignar el dominio de produccion, crear Functions/cron en staging.

---

### P-3 — Cargar variables base (PayPal deshabilitado)

**Objetivo:** que el primer build tenga todo lo necesario, sin ninguna variable PayPal, y con `DATABASE_URL` apuntando solo al Postgres staging.

#### 3.1 Matriz de variables

| Variable | Fase | Build/Runtime | Valor en staging | Origen / decision | Secreto |
|---|---|---|---|---|---|
| `DATABASE_URL` | Base | Runtime | `${{<staging-postgres>.DATABASE_URL}}` | Referencia al Postgres staging; **nunca** una URL literal de prod | Si (contiene credenciales) |
| `NEXT_PUBLIC_URL` | Base | Build | `https://<staging-domain>` | Dominio staging; nunca `pixelarch.dev` | No |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Base | Build | Clave publishable | Reutilizar Clerk existente o instancia staging (decision del dueno) | No (publica) |
| `CLERK_SECRET_KEY` | Base | Runtime | Secret correspondiente | Misma decision que la publishable | Si |
| `RESEND_API_KEY` | Base | Runtime | Key de staging o restringida | No reutilizar la de produccion sin aprobacion; enviar solo al dueno | Si |
| `CONTACT_EMAIL` | Base | Runtime | `<test-email>` | Bandeja del dueno; nunca clientes reales | PII interna |
| `ADMIN_EMAIL` | Base | Runtime | `<test-email>` | Alertas/recibos de prueba | PII interna |
| `NEXT_PUBLIC_SANITY_PROJECT_ID` | Base | Build | `g0wvbc4g` si se reutiliza | Decision del dueno | No |
| `NEXT_PUBLIC_SANITY_DATASET` | Base | Build | `production` si se reutiliza; preferir dataset staging | Si se usa `production`, no escribir desde staging | No |
| `SANITY_API_TOKEN` | Base | Runtime | Token **read-only** o de staging | No usar un token de escritura de produccion | Si |
| `SANITY_REVALIDATE_SECRET` | Base | Runtime | Opcional | Solo si se prueba `/api/revalidate` | Si |
| `MP_ACCESS_TOKEN` | Base | Runtime | Token de prueba | **Nunca** el de produccion | Si |
| `MP_WEBHOOK_SECRET` | Base | Runtime | Secret de prueba | **Nunca** el de produccion | Si |
| `GOOGLE_PLACES_API_KEY` | Base | Runtime | Opcional/vacio | No critico para T-37 | Si |
| `SENTRY_DSN` | Base | Runtime | Vacio o proyecto staging | No mezclar errores con produccion | Si |
| `NEXT_PUBLIC_SENTRY_DSN` | Base | Build | Vacio o proyecto staging | No mezclar con produccion | No (publica) |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Base | Build | `pixelarch` / `pixelarch-staging` (opcional) | Solo si se suben source maps de staging | No |
| `SENTRY_AUTH_TOKEN` | Base | Build | Opcional; no reutilizar el de prod sin aprobacion | Source maps | Si |
| `LOG_LEVEL` | Base | Runtime | `info` | Diagnostico | No |
| `PAYPAL_ENV` | Sandbox | Runtime | `sandbox` | **P-6**, no P-3 | No |
| `PAYPAL_CLIENT_ID` | Sandbox | Runtime | Client id sandbox | **P-6**, lo carga el dueno | Si |
| `PAYPAL_CLIENT_SECRET` | Sandbox | Runtime | Client secret sandbox | **P-6**, lo carga el dueno | Si |
| `PAYPAL_WEBHOOK_ID` | Sandbox | Runtime | Id del webhook sandbox | **P-6**, debe coincidir con el panel | Si |
| `PAYPAL_BASE_URL` | Sandbox | Runtime | Vacio (default sandbox) | **Nunca** `https://api-m.paypal.com` | No |
| `PAYPAL_FEE_BPS` | Sandbox | Runtime | `540` | Default; se valida en el checklist | No |
| `PAYPAL_FEE_FIXED_CENTS` | Sandbox | Runtime | `30` | Default; se valida en el checklist | No |

**No cargar en staging:** `CRON_SECRET`, `RAILWAY_API_TOKEN`, `VERCEL_API_TOKEN`, `MP_*` de produccion, `PAYPAL_*` de produccion, `SENTRY_AUTH_TOKEN` de produccion sin aprobacion. No existe ninguna `NEXT_PUBLIC_PAYPAL_*` y no hace falta tocar el `Dockerfile`.

> **Clerk y CSP:** `next.config.ts` tiene CSP con `clerk.pixelarch.dev` y `*.clerk.accounts.dev`. Reutilizar la instancia Clerk existente evita un cambio de codigo. Usar una instancia Clerk nueva requeriria agregar su dominio a `script-src`, `connect-src` y `frame-src` (fuera de T-37). Si el dueno elige una instancia nueva, el paso queda `[NECESITA ACLARACION]` y bloqueado hasta abrir una tarea de codigo.
>
> **Sanity:** reutilizar el dataset `production` permite que staging lea contenido real, pero tambien que `/studio` escriba en produccion. Para T-37 usar un token read-only y no usar `/studio`; si se necesita escritura, crear un dataset staging (requiere seed, fuera de alcance). Agregar el dominio staging a CORS de Sanity si se usa el Studio.

#### 3.2 Comandos (sin secretos en la linea de comandos)

```powershell
# Verificar entorno linkeado antes de cargar nada.
railway status

# Variables no secretas. Las comillas simples evitan que PowerShell expanda ${{...}}.
railway variable set -s PixelArch-staging -e staging --skip-deploys `
  'DATABASE_URL=${{<staging-postgres>.DATABASE_URL}}' `
  'NEXT_PUBLIC_URL=https://<staging-domain>' `
  'NEXT_PUBLIC_SANITY_PROJECT_ID=<sanity-project-id>' `
  'NEXT_PUBLIC_SANITY_DATASET=<sanity-dataset>' `
  'LOG_LEVEL=info'
```

> Si se reutiliza el contenido actual, `<sanity-project-id>` = `g0wvbc4g` y `<sanity-dataset>` = `production`; en ese caso usar token read-only y no escribir desde staging. Si se crea un dataset staging, usar ese nombre.

Para secretos, preferir el dashboard (campos enmascarados). Si se usa CLI, `--stdin` evita el valor en `argv`:

```powershell
# Ejemplo de patron; no pegar valores reales en este documento ni en el chat.
Get-Clipboard | railway variable set CLERK_SECRET_KEY -s PixelArch-staging -e staging --stdin --skip-deploys
Get-Clipboard | railway variable set RESEND_API_KEY -s PixelArch-staging -e staging --stdin --skip-deploys
Get-Clipboard | railway variable set MP_ACCESS_TOKEN -s PixelArch-staging -e staging --stdin --skip-deploys
```

> No usar `railway variable list --kv` ni `--json` completo en la evidencia: imprimen valores. Para verificar, listar solo **nombres**.

#### 3.3 Verificacion antes del primer build

```powershell
# 1) Nombres de variables (sin valores).
railway variable list -s PixelArch-staging -e staging --json |
  ConvertFrom-Json |
  Get-Member -MemberType NoteProperty |
  Select-Object -ExpandProperty Name

# 2) No debe haber ninguna PAYPAL_*.
railway variable list -s PixelArch-staging -e staging --json |
  ConvertFrom-Json |
  Get-Member -MemberType NoteProperty |
  Select-Object -ExpandProperty Name |
  Select-String '^PAYPAL_'

# 3) NEXT_PUBLIC_URL debe ser la de staging (no es secreta).
railway variable list -s PixelArch-staging -e staging --json |
  ConvertFrom-Json |
  Select-Object -ExpandProperty NEXT_PUBLIC_URL
```

- `NEXT_PUBLIC_URL` debe ser `https://<staging-domain>`. Si es `https://pixelarch.dev`, **detener** y corregir; un build con esa URL manda links/retornos a produccion.
- Si aparece cualquier `PAYPAL_*`, borrarla antes de deployar:
  ```powershell
  railway variable delete PAYPAL_ENV -s PixelArch-staging -e staging
  # repetir por cada PAYPAL_* listada
  ```
- `DATABASE_URL` debe verse como referencia `${{...}}` en el dashboard. Si se ve como `postgres://...`, borrarla y recrearla como referencia. No imprimir el valor.
- Las variables build-time (`NEXT_PUBLIC_URL`, Clerk publishable, Sanity project/dataset, Sentry DSN/org/project/auth token) deben estar **antes del primer build**. Si cambian despues, hace falta un build nuevo, no solo restart.

**Resultado esperado:** variables base cargadas, cero PayPal, `DATABASE_URL` referenciando staging, `NEXT_PUBLIC_URL` staging.

**Evidencia:** lista de nombres (sin valores), captura del dashboard con valores enmascarados, confirmacion de que no hay `PAYPAL_*`.

**No hacer:** cargar secretos de produccion sin decision explicita; usar `--kv`; setear `PAYPAL_*` en esta fase; usar `NEXT_PUBLIC_URL=https://pixelarch.dev`.

---

### P-4 — Migrar el Postgres staging antes del primer deploy

**Objetivo:** aplicar el esquema aditivo (tablas `EnlacePago`, `EventoPasarela`, `AjustePago` y campos nuevos de `Pago`) **solo** en staging.

#### 4.1 Precondiciones y guardas

Antes de ejecutar:

1. `railway status` muestra `staging`.
2. El Postgres staging tiene ID distinto de `62441c9a-785f-4871-b75f-ca8c1430959b`.
3. El Postgres staging tiene volumen propio; no es el volumen de 5 GB de produccion.
4. En el dashboard, `DATABASE_URL` del servicio web staging es `${{<staging-postgres>.DATABASE_URL}}` (referencia), no una URL literal.
5. Si se creo un TCP proxy, pertenece al Postgres staging y no al de produccion.

Si cualquiera falla: **ABORTAR**. No ejecutar `db push`.

#### 4.2 Opcion A (recomendada): TCP proxy temporal + variable efimera

Prisma 7 no carga `.env` automaticamente (`prisma.config.ts` lee `process.env.DATABASE_URL`). Por eso la URL se pasa por entorno, no se escribe en un archivo.

```powershell
# 1) Crear proxy solo en el Postgres staging.
railway tcp-proxy create -s <staging-postgres> -e staging --port 5432
railway tcp-proxy list -s <staging-postgres> -e staging

# 2) Leer DATABASE_PUBLIC_URL sin imprimir el JSON completo.
$pg = railway variable list -s <staging-postgres> -e staging --json | ConvertFrom-Json
$env:DATABASE_URL = $pg.DATABASE_PUBLIC_URL

# 3) Guard: imprimir solo el host. Debe ser el proxy de staging, no produccion.
([uri]$env:DATABASE_URL).Host

# 4) Aplicar esquema y regenerar cliente.
node node_modules\prisma\build\index.js db push
node node_modules\prisma\build\index.js generate

# 5) Limpiar la variable y el proxy.
Remove-Item Env:\DATABASE_URL
railway tcp-proxy delete 5432 -s <staging-postgres> -e staging -y
```

Notas:

- `$pg` contiene credenciales en memoria: no imprimir `$pg` ni `$env:DATABASE_URL`.
- `prisma db push` imprime el datasource/host y el resultado. **No pegar la salida completa**; solo el estado final. No imprime la password.
- Si `db push` pide resetear/borrar datos, **abortar**: no usar `--force-reset` ni `--accept-data-loss`. En una DB nueva no deberia pedirlo.
- Si dice `already in sync` en una DB supuestamente nueva, verificar `\dt` y el host; puede ser la DB equivocada.
- Si `DATABASE_PUBLIC_URL` no aparece, esperar a que el proxy este activo o redeployar **el Postgres staging** (nunca produccion). Si no se autoriza proxy publico, usar la opcion B.

**Fallback de `railway run`:** `railway run -s <staging-web-service> -e staging --no-local -- <comando>` inyecta las variables del servicio, pero `DATABASE_URL` apunta a `*.railway.internal`, que no es resoluble desde la maquina local. Sirve para comandos que no tocan la DB; **no** para `db push` local. Para DB, usar la opcion A o B. Si el servicio staging se llamara `PixelArch`, la forma literal seria `railway run --service PixelArch --environment staging --no-local -- <comando>`; con el servicio nuevo, usar `PixelArch-staging`.

#### 4.3 Opcion B (sin proxy publico): tunel SSH de `railway connect`

```powershell
railway connect <staging-postgres> -e staging --tunnel-only
```

Abre un tunel SSH local e imprime host, puerto, usuario, password y URL completa. **No pegar esa salida en la evidencia ni en el chat.** En otra terminal local, usar esa URL solo como `DATABASE_URL` efimera, ejecutar `db push` + `generate`, y cerrar el tunel con `Ctrl+C`. Al terminar, `Remove-Item Env:\DATABASE_URL`.

Esta opcion evita exponer un TCP proxy, pero maneja credenciales en la terminal. Si el dueno no autoriza ni proxy ni tunel, T-37 queda bloqueado en P-4.

#### 4.4 Verificar el esquema en staging

> `railway connect` requiere el cliente `psql` instalado localmente. Si no esta, usar el editor SQL del dashboard de Railway o un cliente externo con `railway connect --tunnel-only` (sin pegar la salida con credenciales).

```powershell
railway connect <staging-postgres> -e staging
```

En `psql`:

```sql
SELECT current_database(), current_user, inet_server_addr();

\dt

SELECT to_regclass('public."EnlacePago"')    AS enlace_pago,
       to_regclass('public."EventoPasarela"') AS evento_pasarela,
       to_regclass('public."AjustePago"')     AS ajuste_pago;

\d "Pago"
```

Esperado: las tres tablas nuevas existen (no `NULL`), `\dt` las lista y `Pago` muestra `pasarela`, `origen`, `enlacePagoId`, `montoAcordado`, `comision`, `montoEsperado`, `meses`, `feeBps`, `feeFixedCents`, `paypalOrderId`, `evidencia`, `reciboId`, `revision*`.

**Evidencia:** `current_database()`/`current_user`/`inet_server_addr()`, lista de tablas y columnas. Sin connection string ni password.

#### 4.5 Backfill: solo si hay datos previos

En un staging nuevo, `SELECT count(*) FROM "Pago"` debe ser `0`; **no ejecutar** `backfill.sql`.

Si staging tiene datos (por ejemplo, porque se uso `--copy` o se importo algo):

```powershell
railway connect <staging-postgres> -e staging
```

En `psql`:

```sql
\i 'C:/PixelArchWeb/specs/001-paypal-pagos/backfill.sql'
```

Si `\i` no resuelve la ruta absoluta, abrir `psql` contra el mismo tunel/servicio y ejecutar las tres `UPDATE` del archivo manualmente dentro de `BEGIN` / `COMMIT` (revisando los conteos antes de confirmar). No usar un pipe que imprima la salida completa en la evidencia.

El script es transaccional e idempotente. Si se ejecuta el archivo completo, commitea al final; para revisar antes, ejecutar las sentencias por separado. **No ejecutarlo en produccion durante T-37.**

**Resultado esperado:** esquema nuevo aplicado solo en staging; `Pago` con columnas nuevas; tablas nuevas presentes.

**Evidencia:** host/DB fingerprint de staging, `\dt`, `to_regclass`, `\d "Pago"`; conteo de `Pago` antes/despues del backfill (si aplica).

**No hacer:** `db push` con `DATABASE_URL` de produccion; `--force-reset`; `--accept-data-loss`; `backfill.sql` en produccion; usar el TCP proxy de produccion.

#### 4.6 Datos minimos de staging (solo staging)

Una DB nueva no tiene filas en `Servicio`. Sin un servicio, el modal de “activar soporte” no tiene opciones y el paso 7 del checklist no se puede completar. Insertar **solo en staging** un servicio de prueba:

```sql
-- Solo staging. No ejecutar en produccion (T-38 no usa este seed).
INSERT INTO "Servicio"
  ("id", "nombre", "descripcion", "tags", "precioUnico", "precioBasico", "precioMantenimiento", "activo", "orden")
VALUES
  ('t37-soporte-staging', 'Soporte mensual (prueba)', 'Servicio de prueba para T-37', ARRAY['soporte'], 0, 0, 10000, true, 0)
ON CONFLICT ("id") DO NOTHING;
```

El cliente de prueba, el proyecto, el hito `PENDIENTE` y el soporte se crean desde el admin en P-7. No importar servicios ni clientes de produccion.

---

### P-5 — Primer deploy con PayPal deshabilitado y smoke test

**Objetivo:** confirmar que la app arranca, que el esquema esta aplicado y que Mercado Pago sigue operativo, sin PayPal.

#### 5.1 Conectar la fuente y construir

**Dashboard:** servicio `PixelArch-staging` → **Settings** → **Source** → conectar `franciscoinostroza/PixelArch`, branch `main`. Verificar region `us-west2` y health `/api/health`.

> T-37 no toca `src/**`; los cambios en `specs/**` no disparan build por `watchPatterns`. El primer build de staging se dispara al conectar el source o con `railway up`.

**MCP (si se creo el servicio vacio):**

```text
connect-service-source(
  projectId: "1f0ad07e-c893-42f9-a152-13559641b7b9",
  serviceId: "<staging-web-service-id>",
  repo: "franciscoinostroza/PixelArch",
  branch: "main"
)
```

**CLI (fallback):** desde un checkout limpio de `main`:

```powershell
git status --short   # debe estar vacio
railway up -s PixelArch-staging -e staging --ci
```

> Preferir el source de GitHub: deja `RAILWAY_GIT_COMMIT_SHA` y reproduce el commit que luego se usara en produccion. `railway up` sube el working tree; no usarlo con cambios locales.
>
> Sobre `connect-service-source` y MCP: como `PixelArch-staging` es un servicio **nuevo** que solo existe en staging, el connect live no afecta produccion. Si se reutilizara un servicio existente, usar `staged: true` + `environmentId` de staging, revisar staged changes y recien aceptar; un connect live sobre un servicio compartido puede cambiar todos los entornos.

Esperar el build (3-4 min) y verificar:

```powershell
railway deployment list -s PixelArch-staging -e staging --limit 3 --json
```

#### 5.2 Health check

```powershell
Invoke-RestMethod https://<staging-domain>/api/health | ConvertTo-Json -Compress
```

Esperado: `status: "ok"` y `db: "ok"`.

- `db: "untested"` → falta `DATABASE_URL`.
- `status: "degraded"` / `db: "error"` → URL incorrecta o DB inaccesible. Revisar P-3/P-4; no avanzar.

> Health solo hace `SELECT 1`: **no** prueba que el esquema nuevo exista. El smoke de `/admin/pagos` es el que lo prueba.

#### 5.3 Smoke test

1. Abrir `https://<staging-domain>/`, `https://<staging-domain>/admin` y loguearse con el admin/asistente de prueba.
   - Si el login falla por origen/CSP de Clerk, el dueno debe agregar el dominio staging en Clerk. No cambiar codigo en T-37.
2. Abrir `/admin/pagos`: debe cargar sin 500. Si da 500, el esquema no esta aplicado o `DATABASE_URL` apunta a otra DB: volver a P-4.
3. Abrir `/admin/cobros`: debe cargar y mostrar PayPal **deshabilitado** con un motivo claro (AC-16).
4. Abrir el modal de link MP y, si hay credenciales MP de prueba, generar un link para un cobro de prueba. Si no hay credenciales de prueba, registrar la limitacion; **no** usar Mercado Pago de produccion.
5. Preflight del webhook (sin PayPal configurado):

```powershell
curl.exe -i -X POST https://<staging-domain>/api/webhooks/paypal `
  -H "Content-Type: application/json" `
  -d '{"id":"T-37-PREFLIGHT","event_type":"PAYMENT.CAPTURE.COMPLETED"}'
```

Esperado: **503** `Webhook no configurado` (PayPal deshabilitado), **no 404**. Un 404 significa URL/middleware incorrecto; un 500 es un error de ruta.

**Resultado esperado:** deploy exitoso; health `ok`; `/admin/pagos` y `/admin/cobros` cargan; PayPal deshabilitado; MP operativo (o limitacion registrada).

**Evidencia:** deployment ID/commit, health JSON, status HTTP del preflight, screenshots de `/admin/pagos` y del estado PayPal deshabilitado. Sin cookies ni tokens.

**No hacer:** cargar `PAYPAL_*` antes de este smoke; usar la DB de produccion; usar MP de produccion; cambiar codigo para “hacer pasar” el smoke.

---

### P-6 — Cargar PayPal sandbox y configurar el webhook

**Objetivo:** habilitar PayPal solo en staging con credenciales sandbox y un webhook que coincida con `PAYPAL_WEBHOOK_ID`.

#### 6.1 Bloqueo del dueno

`BLOQUEADO HASTA QUE EL DUEÑO LO HAGA`:

- Crear la app sandbox en PayPal Developer (`client_id` + `client_secret`).
- Tener cuenta **business sandbox** que recibe el pago y cuenta **personal sandbox** para pagar.
- Crear el webhook sandbox contra `https://<staging-domain>/api/webhooks/paypal` con los 7 eventos.
- Copiar el `webhook_id` y cargarlo como `PAYPAL_WEBHOOK_ID`.
- Aprobar la tarifa de gross-up (`PAYPAL_FEE_BPS`/`PAYPAL_FEE_FIXED_CENTS`) antes de produccion (PA-11).

Sin estos datos, P-6 no se ejecuta y P-7 queda bloqueado.

#### 6.2 Crear el webhook sandbox

En PayPal Developer, app sandbox → **Webhooks** → agregar:

```
https://<staging-domain>/api/webhooks/paypal
```

Eventos (los 7 de `plan.md` §7.3):

1. `CHECKOUT.ORDER.APPROVED`
2. `CHECKOUT.ORDER.COMPLETED`
3. `PAYMENT.CAPTURE.COMPLETED`
4. `PAYMENT.CAPTURE.DENIED`
5. `PAYMENT.CAPTURE.REFUNDED`
6. `PAYMENT.CAPTURE.REVERSED`
7. `CUSTOMER.DISPUTE.CREATED`

Guardar y copiar el `webhook_id`. El id del panel debe ser **exactamente** el valor de `PAYPAL_WEBHOOK_ID`. Si el dominio staging cambia, actualizar la URL del webhook en PayPal y, si PayPal genera un id nuevo, actualizar `PAYPAL_WEBHOOK_ID` y redeployar.

#### 6.3 Cargar variables sandbox

`paypalConfig()` exige **las cuatro** (`PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`). Si falta una, PayPal queda deshabilitado, incluso para generar links. Cargarlas juntas.

```powershell
# Variables no secretas.
railway variable set -s PixelArch-staging -e staging --skip-deploys `
  'PAYPAL_ENV=sandbox' `
  'PAYPAL_FEE_BPS=540' `
  'PAYPAL_FEE_FIXED_CENTS=30'

# Secretos: dashboard o --stdin, uno por uno. No pegar valores en el chat.
Get-Clipboard | railway variable set PAYPAL_CLIENT_ID -s PixelArch-staging -e staging --stdin --skip-deploys
Get-Clipboard | railway variable set PAYPAL_CLIENT_SECRET -s PixelArch-staging -e staging --stdin --skip-deploys
Get-Clipboard | railway variable set PAYPAL_WEBHOOK_ID -s PixelArch-staging -e staging --stdin --skip-deploys
```

- No setear `PAYPAL_BASE_URL` salvo que haga falta; si se setea, debe ser `https://api-m.sandbox.paypal.com`. **Nunca** `https://api-m.paypal.com`.
- `PAYPAL_ENV` no puede ser `production` en staging.
- Aplicar el cambio: `railway redeploy -s PixelArch-staging -y` (con staging linkeado) o **Restart** en el dashboard. Son variables runtime; no hace falta rebuild.

#### 6.4 Verificar que PayPal quedo disponible

```powershell
curl.exe -i -X POST https://<staging-domain>/api/webhooks/paypal `
  -H "Content-Type: application/json" `
  -d '{"id":"T-37-CONFIG-CHECK","event_type":"PAYMENT.CAPTURE.COMPLETED"}'
```

Esperado: **401** `Firma invalida` (el endpoint esta configurado y rechaza la falta de firma). Un **503** significa que falta una variable, la tarifa es invalida o la base URL es invalida. Un **404** es URL incorrecta.

> Este request sin firma no llama a PayPal y crea un `EventoPasarela` tecnico (`FIRMA_INVALIDA`) en staging. Es esperado. No usar una firma fabricada.

Ademas:

- `/admin/cobros` debe mostrar PayPal **disponible** (sin el motivo de “no configurado”).
- `PAYPAL_ENV=sandbox`; `PAYPAL_BASE_URL` vacio o sandbox; fee `540`/`30`.
- No imprimir `PAYPAL_CLIENT_SECRET` ni `PAYPAL_WEBHOOK_ID` completo.

**Resultado esperado:** PayPal disponible en staging con credenciales sandbox; webhook registrado con los 7 eventos y el id correcto; endpoint responde 401 (no 503/404).

**Evidencia:** captura del webhook (URL, 7 eventos, id enmascarado), status 401, captura de PayPal disponible en el admin, lista de nombres de variables (sin valores).

**No hacer:** cargar credenciales de produccion; usar `PAYPAL_ENV=production`; setear `PAYPAL_BASE_URL` de produccion; crear el webhook contra `pixelarch.dev`.

> **AC-16 con credenciales invalidas (opcional, solo staging):** para cubrir tambien el caso “credenciales invalidas” de AC-16, cambiar temporalmente `PAYPAL_CLIENT_ID` por un valor invalido, redeployar y verificar que PayPal queda **no disponible** con un mensaje claro y que Mercado Pago sigue operativo. Restaurar las credenciales sandbox, redeployar y repetir el 401. No hacer esta prueba en produccion.

---

### P-7 — Ejecutar el checklist de sandbox (pasos 1-14)

**Objetivo:** validar PayPal de punta a punta en staging, segun `sandbox.md` §4.

Antes de empezar, crear desde el admin el cliente `Cliente Prueba Sandbox` (`<test-email>`), un proyecto con un hito `PENDIENTE` de US$100,50 y un soporte `ACTIVE`/`PAST_DUE` usando el servicio de prueba de P-4.6. No importar datos de produccion.

Checklist (detalle completo en `sandbox.md` §4; no duplicar aqui):

| # | Paso | Evidencia clave | Resultado |
|---|---|---|---|
| 1 | App y cuentas sandbox | Captura con ids enmascarados; PayPal disponible | |
| 2 | Railway staging con Postgres separado | `current_database()`, `current_user`, `inet_server_addr()`; variables staging vs prod | |
| 3 | Webhook sandbox | URL, 7 eventos, id enmascarado, variable cargada | |
| 4 | Link para hito de prueba | `EnlacePago.id`, sufijo del token, montos `US$100,50`/`US$6,06`/`US$106,56`, `reutilizado=true` | |
| 5 | Tarifa real | Comision calculada vs PayPal; snapshot `feeBps`/`feeFixedCents` | |
| 6 | Pago invitado, webhook, recibo y hito PAGADO | `paypalOrderId`, capture id, `EventoPasarela`, un solo `Pago`, hito `PAGADO` | |
| 7 | Soporte de 3 meses | `Pago.meses=3`, `Suscripcion.proximoPago` antes/despues | |
| 8 | Repeticion idempotente | `EventoPasarela.resultado=DUPLICADO`, un solo `Pago` | |
| 9 | Firma invalida/ausente: 401 | Status 401, evento tecnico sin PII, sin `Pago` nuevo | |
| 10 | Diferencia de monto: REVISION | `Pago.estadoPago=REVISION`, montos esperado/cobrado, hito pendiente | |
| 11 | Coexistencia MP/PayPal | Ambos links, ganador, hermano invalidado, un solo `Pago` | |
| 12 | Registro manual y no duplicacion | `Pago.origen=MANUAL`, evidencia, evento posterior `DUPLICADO` | |
| 13 | Reembolso y contracargo manual | `AjustePago`, decision, pago original conservado | |
| 14 | Produccion intacta y evidencia final | Conteos/ids/variables iguales al baseline; sin datos sandbox | |

Reglas:

- Para el paso 11, el panel de **Mercado Pago de prueba** debe tener el webhook apuntando a `https://<staging-domain>/api/webhooks/mercadopago` y `MP_WEBHOOK_SECRET` debe coincidir. Si no se configura, el pago MP puede quedar sin confirmar y el paso 11 no es valido.
- Usar solo un cliente de prueba (`Cliente Prueba Sandbox`) con `<test-email>`; nunca datos de clientes reales ni PII de produccion.
- No editar la DB ni el codigo para fabricar un resultado. No fabricar firmas. No borrar pagos/eventos.
- Mercado Pago solo con credenciales de prueba. Si no existen, el paso 11 queda `BLOCKED` y T-37 no se aprueba.
- Evidencia segun `sandbox.md` §5 y registro §10; capturas redactadas, sin secretos, tokens completos ni PII del pagador.
- Criterio “listo para produccion”: `sandbox.md` §6. Todos los pasos `PASS` o `NO APLICA` (solo guest checkout puede ser `NO APLICA` con justificacion); ningun `FAIL`/`BLOCKED`.

**Resultado esperado:** los 14 pasos completados con evidencia; ningun `FAIL`/`BLOCKED`.

**Evidencia:** registro de `sandbox.md` §10 completo + capturas/ids de §5.

**Si falla:** T-37 queda abierto; no se ejecuta T-38.

---

### P-8 — Confirmar produccion intacta, cierre y rollback

**Objetivo:** demostrar que T-37 no escribio en produccion y dejar el entorno staging en un estado seguro.

#### 8.1 Baseline de produccion (solo lectura)

Idealmente tomado al inicio de T-37; si no, tomarlo ahora y dejarlo asentado.

```powershell
# Health publico (sin auth).
Invoke-RestMethod https://pixelarch.dev/api/health | ConvertTo-Json -Compress

# Ultimo deployment de produccion (no redeployar).
railway deployment list -s PixelArch -e production --limit 1 --json

# Nombres de variables de produccion (sin valores).
railway variable list -s PixelArch -e production --json |
  ConvertFrom-Json |
  Get-Member -MemberType NoteProperty |
  Select-Object -ExpandProperty Name
```

Comparar antes/despues:

- `/api/health` sigue `status=ok`, `db=ok`.
- Mismo deployment/commit; no hay deployments nuevos en produccion.
- Mismos nombres de variables; no se agrego/quitaron variables de PayPal ni de staging.
- `/admin/pagos` de produccion sigue sin `Cliente Prueba Sandbox`; mismos conteos/ids de pagos.

**SQL read-only opcional en produccion** (solo si el dueno lo autoriza; nunca DDL/DML):

```powershell
railway connect <prod-postgres> -e production
```

```sql
SELECT count(*) AS pagos, max("creadoEn") AS ultimo FROM "Pago";
SELECT count(*) AS cliente_prueba FROM "Cliente" WHERE "email" = '<test-email>';
```

Esperado: `cliente_prueba = 0`; conteos/ids iguales al baseline. No pegar emails/nombres en la evidencia; solo conteos.

#### 8.2 Verificar que staging no tiene credenciales de produccion

- `PAYPAL_ENV=sandbox`; `PAYPAL_BASE_URL` vacio o sandbox.
- `DATABASE_URL` es referencia al Postgres staging (no literal, no prod).
- `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` son de prueba.
- No hay `CRON_SECRET`, `RAILWAY_API_TOKEN` ni `VERCEL_API_TOKEN`.
- No hay Functions/cron de produccion en staging.
- Clerk/Resend/Sanity: si se reutilizo una credencial existente, hay decision explicita del dueno registrada.

#### 8.3 Cierre

T-37 se puede cerrar solo si:

1. P-1..P-7 completos; checklist 1-14 `PASS`/`NO APLICA`; sin `FAIL`/`BLOCKED`.
2. Evidencia de `sandbox.md` §5/§10 completa y redactada.
3. Produccion intacta (conteos/ids/variables/deployment).
4. El dueno aprueba la tarifa y el paso a T-38 (PA-11).
5. El reviewer valida la evidencia; el implementer marca T-37 en `tasks.md` (el planner no lo hace).

**AC-29** queda cubierto por T-37 cuando el checklist se completa en staging; **T-38** sigue siendo el rollout a produccion y requiere aprobacion separada.

#### 8.4 Rollback de staging

1. Quitar `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` (y opcionalmente `PAYPAL_BASE_URL`, `PAYPAL_FEE_BPS`, `PAYPAL_FEE_FIXED_CENTS`) del servicio staging. Redeploy/restart.
2. Deshabilitar o borrar el webhook sandbox en PayPal para cortar reintentos.
3. Verificar que PayPal queda no disponible (`503`/deshabilitado) y que Mercado Pago sigue operativo.
4. **No borrar tablas ni datos** (`EnlacePago`, `Pago`, `EventoPasarela`, `AjustePago`). No ejecutar `db push --force-reset` ni drops.
5. Si hay que eliminar staging, exportar la evidencia primero. `railway environment delete staging -y` elimina el entorno staging y sus servicios; asumir que la DB/volumen de staging se pierde con el entorno. **Nunca** ejecutarlo sobre `production`.
6. Si un secreto se expuso, rotarlo en PayPal/Clerk/Resend/MP y actualizar staging; no pegar el valor nuevo.
7. Staging consume recursos mientras exista. Si no se conserva para T-38, borrarlo despues de exportar la evidencia; nunca borrar produccion.

**Evidencia:** captura de produccion sin datos de prueba, comparacion de conteos/ids, variables staging (nombres) y registro §10.

---

## 7. Comandos prohibidos en T-37

```text
railway environment new staging --copy production     # solo con aprobacion explicita + auditoria §3.2
railway variable set ... -e production                # nunca
railway variable delete ... -e production             # nunca
railway redeploy ... -e production                    # nunca
railway up ... -e production                          # nunca
railway environment delete production -y              # nunca
railway delete ...                                    # nunca sobre produccion
prisma db push                                        # nunca con DATABASE_URL de produccion
prisma db push --force-reset / --accept-data-loss     # nunca
backfill.sql                                          # nunca en produccion durante T-37
railway connect <prod-postgres> + INSERT/UPDATE/DDL   # nunca; solo SELECT si esta autorizado
git add .railway                                      # nunca; el link local no se commitea
```

> `railway link` escribe `.railway/` en la raiz del repo y hoy **no** esta en `.gitignore`. Verificar `git status` antes de commitear; si aparece `.railway/`, borrarlo o agregarlo a `.gitignore` con aprobacion (cambio separado, fuera de T-37).

---

## 8. Equivalencias dashboard / CLI / MCP

| Accion | Dashboard | CLI | MCP |
|---|---|---|---|
| Crear entorno | Environment → + New → Empty | `railway environment new staging` | `create-project` no aplica; el entorno se crea en dashboard/CLI |
| Crear Postgres | New → Database → PostgreSQL | `railway add --database postgres` | `deploy-template(code: "postgres", environmentId)` (no usar una imagen `postgres` suelta) |
| Crear web vacio | New → Empty Service | `railway add --service PixelArch-staging` | `create-service(name, environmentId)` |
| Conectar repo | Settings → Source → Connect Repo | `railway up` (working tree) | `connect-service-source(repo, branch)`; si el servicio existe en varios entornos, usar `staged: true` + `environmentId` |
| Dominio | Settings → Networking → Generate Domain | `railway domain -s ... -e staging` | `generate-domain(serviceId, environmentId)` |
| Variables | Variables → Raw Editor / campos | `railway variable set ...` | `set-variables(..., environmentId)` |
| Deploy | Deploy / Redeploy | `railway redeploy` / `railway up` | `redeploy(serviceId, environmentId)` |
| Logs | Deployments → Logs | `railway logs` | `get-logs` |
| Estado | Canvas / Settings | `railway status` | `describe-environment`, `get-status` |
| TCP proxy | Settings → Networking → TCP Proxy | `railway tcp-proxy create/delete` | `create-tcp-proxy` / `delete-tcp-proxy` |

> **MCP:** `set-variables` sin `environmentId` va a **produccion**; `create-service`, `create-deployment`, `generate-domain` y `redeploy` tambien pueden aplicar a todos los entornos si se omite. En T-37, pasar siempre el ID de `staging` y revisar staged changes. No ejecutar MCP mutaciones desde este documento sin aprobacion.

---

## 9. Registro de ejecucion T-37 (completado)

| Campo | Valor |
|---|---|
| Fecha | 2026-10-29 (cierre de evidencia) |
| Ejecutor | implementer (T-37) |
| Entorno | `staging` / `57936b79-5d77-4408-92b3-8d1b69f40647` |
| Servicio web | `3aab4a6e-3f35-42df-a604-256f5b635a0a` |
| Postgres staging | `Postgres-gdmt` (id no reportado en este registro) |
| URL publica | `https://staging.pixelarch.dev` |
| Commit | `139b8cb` (`RAILWAY_GIT_COMMIT_SHA`) |
| BD staging | `Postgres-gdmt`, separada de produccion (sin credenciales) |
| Resultado global | `PASS CON OBSERVACIONES` en staging |
| Aprobacion del dueno | Pendiente: PA-11 (tarifa `540`/`30`) y T-38 |
| Evidencia | `review.md` + capturas del registro de T-37 |

| Paso | Resultado (`PASS`/`FAIL`/`BLOCKED`) | Evidencia | Nota |
|---|---|---|---|
| P-1 Entorno vacio | `PASS` | `57936b79-5d77-4408-92b3-8d1b69f40647` | Separado de `production`. |
| P-2 Postgres + web + dominio | `PASS` | `Postgres-gdmt`; `3aab4a6e-3f35-42df-a604-256f5b635a0a`; `https://staging.pixelarch.dev` | DB y web propios. |
| P-3 Variables base | `PASS` | 28 variables al cierre; H-1 resuelto | Sin credenciales de produccion salvo Clerk/Resend/Sentry por decision del dueno. |
| P-4 `db push`/`generate` | `PASS` | Checklist 2 | Esquema solo en staging. |
| P-5 Deploy PayPal off + smoke | `PASS` | Health `ok`; checklist 1-4 | PayPal deshabilitado y MP operativo. |
| P-6 Sandbox + webhook | `PASS` | Webhook 7 eventos; `401` sin firma | Checklist 3 y 9. |
| P-7 Checklist 1-14 | `PASS` con limitacion/observacion | Deploy `4c765526-acc7-421f-a62f-2c03745e0891`; commit `139b8cb`; `review.md` §2 | Pasos 5, 11 y 14 con salvedades; sin `FAIL`/`BLOCKED`. |
| P-8 Produccion intacta | `PASS` | Deploy `554f70d7-4ebd-47db-9812-b831052c9a32`; commit `cdafe04`; health `ok` | Sin migracion ni deploy PayPal. |

Checklist funcional completo: `review.md` §2 (14 filas, sin abreviar). Este registro no reproduce
secretos, tokens ni PII.

---

## 10. Criterio listo / no listo

### Listo para pasar a T-38

- Entorno `staging` con Postgres y web propios; dominio HTTPS estable; region `us-west2`.
- Esquema aplicado solo en staging; `/admin/pagos` y `/admin/cobros` cargan; health `ok`.
- Primer deploy con PayPal deshabilitado verificado (AC-16) y MP operativo.
- `PAYPAL_ENV=sandbox`; las cuatro variables PayPal cargadas; webhook con los 7 eventos y `PAYPAL_WEBHOOK_ID` coincidente.
- Webhook responde 401 sin firma (no 503/404) y procesa eventos reales sandbox.
- Los 14 pasos de `sandbox.md` §4 estan `PASS` o `NO APLICA`; ningun `FAIL`/`BLOCKED`.
- Evidencia completa, redactada, sin secretos ni PII.
- Produccion intacta: mismos conteos/ids/variables/deployment; sin datos sandbox.
- El dueno aprueba la tarifa y el rollout (PA-11); el reviewer valida.

### No listo

- Se uso la DB de produccion, un `DATABASE_URL` literal de prod o el TCP proxy de prod.
- Falta el esquema en staging o `/admin/pagos` da 500.
- Quedo alguna `PAYPAL_*` de produccion o `PAYPAL_ENV=production` en staging.
- El webhook da 404/503 despues de configurar, o el `webhook_id` no coincide.
- Hay `FAIL`/`BLOCKED` en el checklist; en particular, MP de prueba no disponible para el paso 11.
- Produccion cambio (deployment, variables, conteos o datos de prueba).
- La evidencia contiene secretos, `DATABASE_URL`, tokens completos o PII.

---

## 11. Decisiones pendientes / preguntas abiertas

Las siguientes decisiones no bloquean la preparacion, pero si la ejecucion. Marcar la elegida en el registro.

| # | Decision | Default recomendado | Si no se aprueba |
|---|---|---|---|
| 1 | Clerk: reutilizar la instancia existente o crear una de staging | **Reutilizar** (CSP ya incluye `clerk.pixelarch.dev`); agregar el dominio staging a los origenes permitidos | Instancia nueva requiere cambiar CSP en `next.config.ts` (fuera de T-37) → `[NECESITA ACLARACION]` |
| 2 | Sanity: reutilizar `g0wvbc4g/production` o dataset staging | Reutilizar con token **read-only**; no usar `/studio` desde staging | Dataset staging requiere seed y cambio de `NEXT_PUBLIC_SANITY_DATASET` → `[NECESITA ACLARACION]` |
| 3 | Resend: key existente o restringida | Key nueva/restringida; destinatarios solo `<test-email>` | Reutilizar la de produccion requiere aprobacion explicita; riesgo de emails reales |
| 4 | Mercado Pago: credenciales de prueba | Credenciales de test | Sin ellas, el paso 11 queda `BLOCKED` y T-37 no se aprueba |
| 5 | Nombre del servicio web staging | `PixelArch-staging` (servicio nuevo) | Reutilizar `PixelArch` exige cambios por entorno y revisar staged changes; no recomendado |
| 6 | Postgres staging: proxy temporal, tunel SSH o sin migracion local | TCP proxy temporal (se borra en P-4) | Tunel SSH (`railway connect --tunnel-only`) imprime credenciales; sin ninguno, P-4 bloqueado |
| 7 | Dominio staging | Railway `*.up.railway.app` | `staging.pixelarch.dev` requiere DNS/TXT y agregarlo a Clerk/Sanity/PayPal |
| 8 | Sentry staging | Vacio o proyecto separado | Reutilizar el proyecto de prod mezcla errores; requiere aprobacion |
| 9 | Baseline de produccion | `/admin/pagos` + health + nombres de variables | SQL read-only adicional requiere autorizacion del dueno |
| 10 | Tarifa gross-up | `540` bps + `30` centavos, validada en el paso 5 | Si PayPal informa otra tarifa, ajustar env y regenerar el link; no recalcular pagos historicos |

Las filas 1-9 eran decisiones de preparacion. Al cierre de T-37 quedaron registradas: Clerk, Resend y Sentry se reutilizan por decision explicita del dueno (H-1, `review.md` §4); el dominio staging es `https://staging.pixelarch.dev`; Mercado Pago de prueba se uso en el paso 11. La fila 10 se valido en sandbox con tolerancia ±US$0,01. Las filas no mencionadas quedan como referencia y no bloquean T-38.

**Bloqueos por credenciales del dueno:** la app sandbox, las cuentas business/personal y el `webhook_id` quedaron resueltos para T-37. Siguen pendientes la aprobacion de la tarifa y la autorizacion de T-38 (PA-11); no se suplen con credenciales de produccion.

---

## 12. Referencias

- `specs/001-paypal-pagos/spec.md` — AC-16, AC-29; RNF-11.
- `specs/001-paypal-pagos/plan.md` §4.2 (backfill), §7.1 (variables), §7.2 (Railway), §7.3 (webhook), §7.5 (migracion/rollback), §7.7 (checklist).
- `specs/001-paypal-pagos/sandbox.md` §2.2 (variables), §2.3 (webhook), §3 (P-1..P-8), §4 (checklist 1-14), §5 (evidencia), §6 (criterio), §7 (rollback), §10 (registro).
- `specs/001-paypal-pagos/backfill.sql` — SQL de `plan.md` §4.2, transaccional e idempotente.
- `specs/constitution.md` §1 (privacidad), §2 (pagos), §5 (operaciones y despliegue).
- `railway.toml` — health `/api/health`, watchPatterns.
- `Dockerfile` — `ARG`/`ENV` de `NEXT_PUBLIC_*`; no hay `NEXT_PUBLIC_PAYPAL_*`.
