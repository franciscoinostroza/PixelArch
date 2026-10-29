# T-38 — Rollout de PayPal a produccion (runbook de ejecucion)

**Tarea:** T-38 (AC-29; AC-16, AC-21 y regresion AC-13/AC-20)
**Spec:** `./spec.md`
**Plan:** `./plan.md` §4.2 (migracion/backfill), §7.1 (variables), §7.2 (Railway), §7.3 (webhook), §7.5 (migracion y rollback), §7.6 (observabilidad)
**Runbooks base:** `./sandbox.md` §6/§7, `./t-37-staging.md` §7/§8
**Backfill:** `./backfill.sql`
**Evidencia previa:** `./review.md` (T-37: PASS con observaciones)
**Estado:** **NO AUTORIZADO**. Pendiente de aprobacion explicita del dueno, ventana y ejecucion.
**Alcance de este documento:** planificacion operativa. No ejecuta comandos, no modifica produccion, no
marca tareas y no contiene secretos ni valores de conexion.

> **Regla de oro:** T-38 no empieza hasta que G1 (aprobacion del dueno) y G3 (backup verificado) esten
> cumplidos. Si cualquier gate o stop condition falla, se detiene el rollout; no se "sigue y se arregla
> despues".

---

## 0. Reglas duras (si una falla, detener)

1. **Migrar antes de mergear.** `prisma db push` + `backfill.sql` en produccion se ejecutan **antes**
   del merge a `main`. Si se mergea primero, el auto-deploy puede levantar codigo que consulta tablas
   que aun no existen y `/admin/pagos`/`/admin/cobros` devuelven 500 (H-2).
2. **Nunca** `prisma db push --force-reset` ni `--accept-data-loss`. Si Prisma pide resetear o borrar
   datos, se aborta y se investiga.
3. **Nunca** usar credenciales, webhook, `PAYPAL_ENV=sandbox` ni `PAYPAL_BASE_URL` de staging en
   produccion. Tampoco al reves.
4. **Nunca** pegar secretos, cadenas de conexion, tokens completos, `PAYPAL_WEBHOOK_ID` completo,
   emails/nombres de pagadores ni payloads crudos de webhooks en la evidencia, en el chat o en el repo.
5. **No borrar datos ni tablas.** `Pago`, `EnlacePago`, `EventoPasarela`, `AjustePago` y los pagos
   historicos se conservan. El esquema es aditivo.
6. **No volver al codigo anterior (`cdafe04`) si ya existen pagos PayPal.** El cliente Prisma viejo no
   conoce los valores de enum `PAYPAL`, `REVISION` ni `CONTRACARGO` y `/admin/pagos` puede fallar. El
   rollback seguro es deshabilitar PayPal manteniendo el codigo nuevo (ver §10).
7. **Un solo ejecutor autorizado** en la ventana. Nadie mas deploya, mergea ni cambia variables de
   produccion mientras T-38 esta en curso.
8. **Si hay duda, se para.** Una ventana reprogramada es mas barata que un cobro duplicado o una DB
   inconsistente.

---

## 1. Objetivo, alcance y gates

### 1.1 Objetivo

Habilitar PayPal en produccion (`https://pixelarch.dev`) con el codigo validado en staging, sin romper
Mercado Pago, sin perdida de datos y con un rollback operativo rapido. El resultado esperado es:

- Esquema PayPal aplicado en la Postgres de produccion y backfill historico completado.
- `main` con el codigo PayPal, desplegado primero con PayPal **deshabilitado** y smoke verde.
- PayPal live habilitado con su propia app, credenciales, webhook y tarifa `540`/`30`.
- Webhook de produccion respondiendo `401` sin firma (no `503`/`404`).
- Mercado Pago y el CRM sin regresiones; sin PII ni secretos en logs/Sentry.
- Evidencia redactada y revision final registrada.

### 1.2 Alcance

1. Backup de produccion + prueba de restore.
2. Migracion/backfill de produccion **antes del merge**.
3. FF-merge de `paypal-staging` → `main` conservando `139b8cb`.
4. Auto-deploy y smoke con PayPal deshabilitado.
5. Configuracion PayPal live (app, envs, webhook, fee).
6. Smoke PayPal opcional de bajo monto (solo con aprobacion separada).
7. Monitoreo, rollback y cierre documental.

### 1.3 Fuera de alcance

- Cambios de codigo, `src/**`, `prisma/schema.prisma` o tests.
- Backlog no bloqueante: recibo imprimible de Mercado Pago, H-5..H-9.
- Recalcular pagos historicos, cambiar la tarifa aprobada o borrar datos.
- Operar staging (solo lectura para comparar).
- Crear un portal de clientes, cambiar roles de Clerk o tocar el diseno.
- Limpiar los warnings de MP (H-6) durante la ventana.

### 1.4 Gates (todos obligatorios)

| Gate | Condicion | Evidencia de cumplimiento | Si falla |
|---|---|---|---|
| **G1** | Aprobacion **explicita** del dueno de T-38: fecha/hora, ventana, ejecutor y autorizacion para DDL/DML y cambios de envs en produccion. PA-11 (tarifa) **no** autoriza T-38. | Mensaje/correo del dueno citado en el registro, sin secretos. | No se ejecuta nada. |
| **G2** | Ventana de baja actividad y freeze: sin otros merges/deploys/variables de produccion; dueno disponible para aprobar el smoke opcional y un rollback. | Fecha/hora de inicio y fin; confirmacion de freeze. | Reprogramar. |
| **G3** | Backup de produccion completado y **restore probado** en una DB descartable; conteos iguales a la linea base. | Archivo, tamano, SHA-256, DB de restore y conteos. | No se migra. |
| **G4** | FF-merge posible: `origin/main` es ancestro de `origin/paypal-staging`, tip `139b8cb`, sin commits ajenos. | `git merge-base --is-ancestor` + `git rev-parse` + `git log`. | Ver §5.3: revalidar o replanificar. |
| **G5** | App PayPal **Live** y webhook **Live** listos, separados de staging; credenciales Live disponibles para cargar en §7.2; `PAYPAL_ENV=production`. | Captura del panel Live con IDs enmascarados; nombres de envs (sin valores). | No se habilita PayPal. |
| **G6** | Rollback listo: lista de envs a quitar, acceso al panel PayPal para deshabilitar el webhook, deployment anterior identificado. | Checklist §10 firmado; deployment `554f70d7-4ebd-47db-9812-b831052c9a32` localizado. | No se empieza. |
| **G7** | Si se hara smoke PayPal real: aprobacion separada con monto, pagador, fecha y plan de limpieza. | Mensaje del dueno con el monto aprobado. | Se omite el smoke; se registra el riesgo residual. |
| **G8** | Calidad y evidencia: si el merge es FF, se usa la evidencia H-4 de `139b8cb`; si no es FF, suite/typecheck/lint/build y revalidacion en staging. Plantilla de evidencia lista. | Salida de tests/typecheck/build o referencia a H-4; SHA. | No se mergea. |

**Orden de gates:** G1, G2, G3, G4, G6 y G8 se cumplen antes de la migracion/merge (§3-§5). G5 se cumple
antes de habilitar PayPal (§7). G7 se cumple antes del smoke opcional (§8); si no se aprueba, §8 se omite
y se registra el riesgo residual.

### 1.5 Trazabilidad AC

| AC | Como lo cubre T-38 | Tipo de verificacion |
|---|---|---|
| **AC-29** | Rollout completo con evidencia en produccion. | Smoke manual + registro §12/Anexo A. |
| **AC-16** | Primer deploy sin `PAYPAL_*`: PayPal deshabilitado, MP operativo, webhook `503` (no `404`). | Smoke §6. |
| **AC-21** | Si el merge no es FF: tests/typecheck/lint/build. Si es FF: H-4 sobre `139b8cb`. | Suite/CI local + deploy. |
| **AC-13, AC-20** | Regresion MP: UI, link y webhook sin cambios; pagos MP intactos. | Smoke §6 + monitoreo §9. |
| **AC-7** | Webhook live responde `401` sin firma y no crea `Pago`. | Preflight §7.4. |
| **AC-28** | No se re-prueba guest checkout en produccion; sigue validado en staging. | Referencia a T-37. |
| **AC-1..AC-27 restantes** | No se re-ejecutan; cobertura automatizada y T-37. | `review.md` §5. |

> T-38 no agrega AC ni tests automatizados nuevos. Es una tarea operativa: su evidencia es el smoke, los
> IDs, los conteos y el registro. La cobertura automatizada de AC-29 sigue siendo T-34/T-37.

---

## 2. Estado inicial y precondiciones

### 2.1 Linea base de produccion (segun T-37; re-verificar en §2.4)

| Elemento | Valor |
|---|---|
| Proyecto Railway | `PixelArch-Plataforma` `1f0ad07e-c893-42f9-a152-13559641b7b9` |
| Entorno produccion | `production` `89e0c0f9-da00-4e45-b986-d54014618c35` |
| Servicio web | `PixelArch` `871fb7fb-789f-447e-9a9d-49b7b47cea27` |
| Postgres produccion | `62441c9a-785f-4871-b75f-ca8c1430959b` |
| Dominio | `https://pixelarch.dev` |
| Deploy actual | `554f70d7-4ebd-47db-9812-b831052c9a32` |
| Commit actual | `cdafe04`, branch `main` |
| Health actual | `/api/health` `ok` |
| PayPal en produccion | **No**: `main` no tiene PayPal, la DB no tiene el esquema nuevo y no hay webhook live |
| Backup | **No verificado** en este documento; se exige en §3 |

### 2.2 Staging validado (referencia, no se toca)

| Elemento | Valor |
|---|---|
| Entorno staging | `57936b79-5d77-4408-92b3-8d1b69f40647` |
| Servicio web staging | `3aab4a6e-3f35-42df-a604-256f5b635a0a` |
| Deploy staging | `4c765526-acc7-421f-a62f-2c03745e0891` |
| Commit staging | `139b8cb` (SHA a conservar) |
| Resultado | T-37 PASS con observaciones; `review.md` |
| PA-11 | Aprobado: fee `540`/`30`, tolerancia ±US$0,01 (2026-10-29) |
| T-38 | **No autorizado** |

### 2.3 Precondiciones de ejecucion

- [ ] G1, G2, G3, G4, G6 y G8 cumplidos; G5 con disponibilidad Live y G7 con decision registrada (se
      completan antes de §7/§8).
- [ ] Ventana acordada; nadie mas mergea/deploya/cambia variables de produccion.
- [ ] Acceso del ejecutor a Railway (dashboard y CLI autenticada), al panel PayPal Live y al repo.
- [ ] `git` limpio; checkout de trabajo en el commit correcto; `node_modules` instalado para el CLI local de Prisma.
- [ ] Cliente `psql`, `pg_dump` y `pg_restore` instalados, con version **>=** la del servidor de produccion.
- [ ] Una DB local descartable (Docker/instancia temporal) para la prueba de restore. Nunca restaurar sobre produccion.
- [ ] App PayPal **Live** creada por el dueno; webhook Live creado; `PAYPAL_WEBHOOK_ID` disponible para el dueno.
- [ ] Sin `PAYPAL_*` residuales en produccion. Si existen, se eliminan **antes** del merge con aprobacion (G1).
- [ ] `NEXT_PUBLIC_URL` de produccion apunta a `https://pixelarch.dev`; `MP_*` live intactas.
- [ ] El dueno confirmo si autoriza o no el smoke PayPal real de bajo monto (G7).
- [ ] Reviewer/coordinador disponibles para validar la evidencia al cierre.

### 2.4 Verificaciones de arranque (solo lectura)

```powershell
git fetch origin --prune
git rev-parse origin/main origin/paypal-staging
git status --short
git log --oneline origin/main..origin/paypal-staging
Invoke-RestMethod https://pixelarch.dev/api/health | ConvertTo-Json -Compress
railway deployment list -s PixelArch -e production --limit 3 --json
railway variable list -s PixelArch -e production --json |
  ConvertFrom-Json | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name
```

Esperado:

- `origin/main` = `cdafe04` y `origin/paypal-staging` = `139b8cb` (o el baseline actualizado y aprobado).
- Arbol de trabajo limpio en el checkout que se usara para mergear.
- `/api/health` = `status: "ok"`, `db: "ok"`.
- Deploy actual = `554f70d7-4ebd-47db-9812-b831052c9a32`.
- Nombres de variables: **sin** `PAYPAL_*`. No imprimir valores.

Si `origin/main` avanzo, si `paypal-staging` no esta en `139b8cb` o si hay `PAYPAL_*` residuales:
**detener** y re-baseline con el dueno. No continuar "con lo que hay".

---

## 3. Backup de produccion y prueba de restore

### 3.1 Regla

No se ejecuta `prisma db push` ni `backfill.sql` sin un backup verificado. El backup contiene PII:
guardarlo fuera del repo, cifrado o en un disco con acceso restringido, y no subirlo al chat. La prueba
de restore se hace en una DB descartable y se borra al terminar.

### 3.2 Conexion a produccion (sin exponer credenciales)

**Opcion recomendada: tunel SSH de solo lectura/escritura temporal.**

```powershell
railway connect <prod-postgres> -e production --tunnel-only
```

Abre un tunel local e imprime la cadena de conexion. **No pegar esa salida** en la evidencia, el chat o
un archivo del repo. Usarla solo en la sesion:

```powershell
$env:T38_PGURL = '<cadena-impresa-por-railway-connect>'
([uri]$env:T38_PGURL).Host   # solo el host, para verificar que es produccion
```

**Alternativa: TCP proxy (solo si el dueno lo aprueba).** Preferir el tunel. **No crear un proxy nuevo
si el Postgres de produccion ya tiene uno** (la linea base de T-37 indica que existe): usar el existente
y **no borrarlo**. Si no existe y se autoriza uno temporal:

```powershell
railway tcp-proxy create -s <prod-postgres> -e production --port 5432
railway tcp-proxy list -s <prod-postgres> -e production
$pg = railway variable list -s <prod-postgres> -e production --json | ConvertFrom-Json
$env:T38_PGURL = $pg.DATABASE_PUBLIC_URL
([uri]$env:T38_PGURL).Host
```

Al terminar la migracion/backfill, borrar **solo el proxy creado en esta ventana**; si ya existia, dejarlo
como estaba:

```powershell
# Solo si el proxy se creo en esta ventana.
railway tcp-proxy delete 5432 -s <prod-postgres> -e production -y
```

Guardas:

- El host debe corresponder al proxy/tunel de **produccion**, no de staging.
- Usar la cadena tal como la provee Railway (con su `sslmode`); no deshabilitar TLS.
- `psql` debe mostrar la base de produccion y un conteo de `Pago` compatible con la linea base.
- No imprimir `$env:T38_PGURL`, `$pg` ni la salida completa de `railway connect`.

### 3.3 Tomar el backup

Antes del dump, ejecutar los `SELECT` de §4.1 (solo lectura) y registrar los conteos. Son la linea base
del backup, del restore y del post-backfill. Mantener el freeze activo mientras se toman los conteos y
el dump; si algo cambia entre ambos, repetir.

```powershell
New-Item -ItemType Directory -Force "C:\PixelArchWeb-backups\t38" | Out-Null
pg_dump --format=custom --no-owner --no-privileges `
  --file="C:\PixelArchWeb-backups\t38\prod-pre-t38.dump" `
  "$env:T38_PGURL"
```

Verificar que el archivo exista, no este vacio y sea legible:

```powershell
Get-Item "C:\PixelArchWeb-backups\t38\prod-pre-t38.dump" | Select-Object Length, LastWriteTime
Get-FileHash "C:\PixelArchWeb-backups\t38\prod-pre-t38.dump" -Algorithm SHA256
pg_restore --list "C:\PixelArchWeb-backups\t38\prod-pre-t38.dump" | Select-String 'TABLE DATA'
```

Registrar: fecha/hora, tamano, SHA-256 y lista de tablas principales. **No** registrar la cadena de
conexion ni datos de filas.

### 3.4 Prueba de restore (obligatoria)

En una Postgres local descartable (Docker o instancia temporal, **nunca** produccion ni staging):

```powershell
createdb -h 127.0.0.1 -p 55432 t38_restore
pg_restore --no-owner --no-privileges `
  --host 127.0.0.1 --port 55432 --username postgres --dbname t38_restore `
  "C:\PixelArchWeb-backups\t38\prod-pre-t38.dump"
psql -h 127.0.0.1 -p 55432 -d t38_restore
```

En `psql`, comparar contra la linea base registrada antes del dump (§3.3/§4.1):

```sql
SELECT 'Pago' AS tabla, count(*) FROM "Pago"
UNION ALL SELECT 'Cliente', count(*) FROM "Cliente"
UNION ALL SELECT 'Proyecto', count(*) FROM "Proyecto"
UNION ALL SELECT 'Hito', count(*) FROM "Hito"
UNION ALL SELECT 'Suscripcion', count(*) FROM "Suscripcion"
UNION ALL SELECT 'Servicio', count(*) FROM "Servicio";
```

Esperado: los conteos coinciden con produccion (tolerancia cero para `Pago`; si algo no coincide, el
dump no es valido). Verificar tambien que las tablas nuevas **no** existan en el dump pre-T-38:

```sql
SELECT to_regclass('public."EnlacePago"') AS enlace_pago,
       to_regclass('public."EventoPasarela"') AS evento_pasarela,
       to_regclass('public."AjustePago"') AS ajuste_pago;
```

Esperado: `NULL`, `NULL`, `NULL`. Si alguna existe, el backup no es del estado pre-T-38: detener.

Borrar la DB de prueba:

```powershell
dropdb -h 127.0.0.1 -p 55432 t38_restore
```

### 3.5 Criterio de aceptacion del backup

- [ ] `pg_dump` termino con codigo 0; archivo > 0; SHA-256 registrado.
- [ ] `pg_restore --list` lista las tablas principales.
- [ ] Restore completo sin errores; conteos iguales a produccion.
- [ ] Las tablas nuevas no existen en el dump.
- [ ] La copia de prueba se borro; el dump queda fuera del repo y con acceso restringido.

Si algo falla: **no se migra**. Se repite el backup o se escala al dueno.

---

## 4. Migracion/backfill de produccion antes del merge

> Esta seccion se ejecuta desde un checkout limpio de `paypal-staging` en `139b8cb`, porque el
> `prisma/schema.prisma` con PayPal vive ahi. **No** ejecutar `db push` desde `main` (`cdafe04`).

### 4.1 Snapshot pre-migracion (solo lectura)

Con la conexion de §3.2 activa:

```sql
SELECT current_database(), current_user, inet_server_addr();

SELECT count(*) AS pagos,
       coalesce(sum("monto"), 0) AS suma_monto,
       max("creadoEn") AS ultimo_pago
FROM "Pago";

SELECT count(*) AS clientes FROM "Cliente";
SELECT count(*) AS proyectos FROM "Proyecto";
SELECT count(*) AS hitos FROM "Hito";
SELECT count(*) AS soportes FROM "Suscripcion";

SELECT to_regclass('public."EnlacePago"')    AS enlace_pago,
       to_regclass('public."EventoPasarela"') AS evento_pasarela,
       to_regclass('public."AjustePago"')     AS ajuste_pago;
```

Esperado antes de migrar:

- Las tres tablas nuevas = `NULL`.
- `pagos`, `suma_monto`, `clientes`, `proyectos`, `hitos`, `soportes` = linea base.
- La base/host corresponden a produccion (no staging).

Registrar solo los conteos y `current_database()`/host. No registrar credenciales.

### 4.2 Preview del DDL (guard destructivo)

Generar el SQL que Prisma aplicaria y revisarlo **antes** de tocar la DB:

```powershell
node node_modules\prisma\build\index.js migrate diff `
  --from-url "$env:T38_PGURL" `
  --to-schema-datamodel prisma/schema.prisma `
  --script | Out-File -Encoding utf8 "C:\PixelArchWeb-backups\t38\t38-ddl-preview.sql"
```

Revisar el archivo manualmente. Debe contener solo:

- `CREATE TYPE` para los enums nuevos.
- `CREATE TABLE` para `EnlacePago`, `EventoPasarela`, `AjustePago`.
- `ALTER TABLE ... ADD COLUMN` nullable o con default para `Pago`.
- `CREATE INDEX` / constraints nuevos.
- `ALTER TYPE ... ADD VALUE` para `PAYPAL`, `REVISION`, `CONTRACARGO`.

**No debe contener** `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE`, `DROP INDEX` no justificado,
`ALTER COLUMN ... TYPE` destructivo ni `SET NOT NULL` sobre datos existentes. Si aparece cualquiera de
esos: **STOP**; el esquema no es aditivo en este entorno y hay que revisar el drift.

Si el preview incluye cambios **no relacionados con PayPal** (otras tablas, columnas o indices), tambien
**STOP**: hay drift entre produccion y el schema; no aplicar `db push` hasta entenderlo y acordar el
alcance con el dueno.

### 4.3 Aplicar el esquema (`db push`)

Desde el checkout de `paypal-staging` en `139b8cb`, con la conexion de produccion solo en la sesion:

```powershell
# Prisma lee la variable definida en prisma.config.ts. Asignarle el valor de $env:T38_PGURL
# en esta sesion, sin escribirlo en archivos ni imprimirlo. El nombre exacto esta en ese archivo.
node node_modules\prisma\build\index.js db push
```

Fallback si `npx` funciona en la maquina:

```powershell
npx prisma db push
```

Reglas:

- Ejecutar en terminal interactiva. Si pregunta si continuar ante perdida de datos, responder **NO** y
  abortar.
- **Nunca** agregar `--force-reset` ni `--accept-data-loss`.
- Si dice que la DB ya esta en sync **antes** de crear las tablas nuevas, es la DB equivocada o alguien
  ya migro: detener y verificar host/conteos.
- No pegar la salida completa (puede incluir el host). Registrar solo el estado final.
- Despues: `node node_modules\prisma\build\index.js generate` (local; no cambia produccion).

### 4.4 Backfill historico

Aplicar solo despues de que las columnas existan y solo si `Pago` tiene filas (produccion las tiene).
El script `backfill.sql` es idempotente, no tiene DDL y no borra filas.

Pre-check (solo SELECT):

```sql
SELECT count(*) AS paypal_previos FROM "Pago" WHERE "metodo" = 'PAYPAL';

SELECT
  count(*) FILTER (WHERE "metodo" = 'MERCADOPAGO' AND "pasarela" = 'MANUAL') AS a_migrar_pasarela,
  count(*) FILTER (WHERE "metodo" = 'MERCADOPAGO' AND "registradoPor" = 'Mercado Pago'
                     AND "origen" = 'MANUAL') AS a_migrar_origen,
  count(*) FILTER (WHERE "montoAcordado" IS NULL) AS a_completar_montos
FROM "Pago";
```

Esperado: `paypal_previos = 0`. Si hay pagos PayPal previos, **STOP**: hay un rollout parcial o datos
ajenos y el backfill de montos podria no aplicar; revisar antes de continuar.

Ejecutar las tres `UPDATE` de `backfill.sql` dentro de una transaccion revisada:

```sql
BEGIN;

UPDATE "Pago"
SET "pasarela" = 'MERCADOPAGO'
WHERE "metodo" = 'MERCADOPAGO' AND "pasarela" = 'MANUAL';

UPDATE "Pago"
SET "origen" = 'AUTOMATICO'
WHERE "metodo" = 'MERCADOPAGO' AND "registradoPor" = 'Mercado Pago';

UPDATE "Pago"
SET "montoAcordado" = "monto", "montoEsperado" = "monto"
WHERE "montoAcordado" IS NULL;

-- Verificacion dentro de la transaccion (esperado 0, 0, 0).
SELECT
  count(*) FILTER (WHERE "metodo" = 'MERCADOPAGO' AND "pasarela" = 'MANUAL') AS pendientes_pasarela,
  count(*) FILTER (WHERE "metodo" = 'MERCADOPAGO' AND "registradoPor" = 'Mercado Pago'
                     AND "origen" = 'MANUAL') AS pendientes_origen,
  count(*) FILTER (WHERE "montoAcordado" IS NULL) AS pendientes_montos
FROM "Pago";

COMMIT;
```

Alternativa: `\i 'C:/PixelArchWeb/specs/001-paypal-pagos/backfill.sql'` (commitea al final; para revisar
antes, usar el bloque manual). Si se usa el archivo, no editarlo.

Verificacion posterior (solo SELECT):

```sql
SELECT count(*) AS pendientes_pasarela
FROM "Pago" WHERE "metodo" = 'MERCADOPAGO' AND "pasarela" = 'MANUAL';

SELECT count(*) AS pendientes_origen
FROM "Pago" WHERE "metodo" = 'MERCADOPAGO' AND "registradoPor" = 'Mercado Pago'
  AND "origen" = 'MANUAL';

SELECT count(*) AS pendientes_montos
FROM "Pago" WHERE "montoAcordado" IS NULL;

SELECT count(*) AS pagos, coalesce(sum("monto"), 0) AS suma_monto FROM "Pago";
```

Esperado: `0`, `0`, `0`; `pagos` y `suma_monto` iguales a §4.1. Los pagos historicos no se recalculan
ni se borran.

### 4.5 Verificar esquema y conteos

```sql
\dt

SELECT to_regclass('public."EnlacePago"')    AS enlace_pago,
       to_regclass('public."EventoPasarela"') AS evento_pasarela,
       to_regclass('public."AjustePago"')     AS ajuste_pago;

\d "Pago"

SELECT t.typname, e.enumlabel
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('MetodoPago', 'EstadoPago', 'Pasarela', 'OrigenPago')
ORDER BY t.typname, e.enumsortorder;

SELECT count(*) AS enlaces FROM "EnlacePago";
SELECT count(*) AS eventos FROM "EventoPasarela";
SELECT count(*) AS ajustes FROM "AjustePago";
```

Esperado:

- Las tres tablas existen (no `NULL`) y aparecen en `\dt`.
- `Pago` muestra `pasarela`, `origen`, `enlacePagoId`, `montoAcordado`, `comision`, `montoEsperado`,
  `meses`, `feeBps`, `feeFixedCents`, `paypalOrderId`, `evidencia`, `reciboId` y campos `revision*`.
- `MetodoPago` incluye `PAYPAL`; `EstadoPago` incluye `REVISION` y `CONTRACARGO`.
- Las tablas nuevas estan vacias (`0`, `0`, `0`) antes del deploy.

### 4.6 Checkpoint post-migracion, pre-merge (el codigo viejo sigue live)

La produccion sigue corriendo `cdafe04`. Verificar que la migracion aditiva no rompio nada:

- `/api/health` = `ok`/`db: ok`.
- `/admin/pagos` y `/admin/cobros` cargan sin 500 con el codigo actual.
- Mercado Pago sigue operativo (UI y pagos recientes intactos).
- Logs/Sentry sin errores nuevos de DB.

Si aparece un 500 o un error de esquema: **STOP**. No mergear. El codigo viejo deberia ignorar tablas y
columnas nuevas; si no lo hace, hay drift o un cambio no aditivo que hay que entender.

### 4.7 Rollback de la migracion

- El esquema es **aditivo**: no se hace `DROP` de tablas/columnas ni se revierte con `db push`.
- Si la migracion quedo a medias, no usar reset. Evaluar el estado, corregir hacia adelante y volver a
  ejecutar `db push` solo tras revisar el preview. El codigo viejo sigue funcionando con columnas
  nullable/default y tablas nuevas vacias.
- Si el backfill falla, `ROLLBACK` y no mergear. La DB queda como antes del backfill (el esquema nuevo
  puede quedar aplicado; es inofensivo para el codigo viejo).
- Stop conditions de esta fase: drift/destructive DDL, pedido de reset, conteos distintos, timeout/lock
  prolongado, 500 en admin, o perdida de sumas. Cualquiera detiene el rollout.

---

## 5. FF-merge `paypal-staging` → `main` y deploy con PayPal deshabilitado

### 5.1 Verificar que el FF es posible

```powershell
git fetch origin --prune
git rev-parse origin/main origin/paypal-staging
git merge-base --is-ancestor origin/main origin/paypal-staging
$LASTEXITCODE   # 0 = FF posible; 1 = no es FF
git log --oneline origin/main..origin/paypal-staging
git diff --stat origin/main..origin/paypal-staging
```

Esperado: `origin/main` = `cdafe04`, `origin/paypal-staging` = `139b8cb`, exit code `0`, y un diff
acotado a PayPal (sin cambios ajenos). Si el diff incluye archivos fuera del alcance o commits de otra
persona: **STOP** y revisar con el coordinador.

### 5.2 FF-merge y push

Con el freeze activo y `origin/main` recien verificado:

```powershell
git switch main
git pull --ff-only origin main
git merge --ff-only origin/paypal-staging
git rev-parse HEAD        # debe ser 139b8cb
git push origin main
```

- El push dispara el auto-deploy de Railway desde `main`.
- No usar `git push --force`.
- Si entre la verificacion y el push aparece un commit nuevo en `origin/main`: abortar el push,
  actualizar y repetir §5.1. No mergear "a mano" para ganar tiempo.

### 5.3 Si el merge no es FF

**No mergear directo a `main`.** El SHA validado se pierde y el deploy incluiria codigo no revalidado.
Opciones, solo con aprobacion del dueno/coordinador:

1. **Rebase controlado** de `paypal-staging` sobre `main`, resolviendo conflictos sin cambios de
   comportamiento; nuevo SHA; ejecutar suite/typecheck/lint/build; desplegar a staging y repetir el
   smoke critico (P-5/P-6, `401`, link y pago sandbox) antes de produccion.
2. **Merge commit** en una rama temporal, preservando `139b8cb` como ancestro; mismos gates de calidad
   y revalidacion en staging; luego merge a `main`.

Si hay conflictos no triviales, cambios de codigo para "hacer pasar" el merge o un AC afectado:
**replanificar**. T-38 no se ejecuta sobre un SHA distinto sin revalidacion completa.

Comandos de revalidacion (en esta maquina `npx` puede fallar; usar los binarios locales):

```powershell
node node_modules\vitest\vitest.mjs run
node node_modules\typescript\bin\tsc --noEmit
npm run lint
node node_modules\prisma\build\index.js generate
node node_modules\next\dist\bin\next build
```

### 5.4 Seguir el deploy

```powershell
railway deployment list -s PixelArch -e production --limit 3 --json
```

Verificar:

- Deploy nuevo con commit `139b8cb` (`RAILWAY_GIT_COMMIT_SHA`).
- Estado `SUCCESS`; health `/api/health` `ok`.
- Build con PayPal **deshabilitado**: en este punto no debe haber ninguna `PAYPAL_*` en produccion.
- `NEXT_PUBLIC_URL=https://pixelarch.dev`; `MP_*` live sin cambios.

Si el auto-deploy no se dispara: verificar source/branch y el commit; disparar un **deploy nuevo desde
el source** en `139b8cb` (preferir GitHub/dashboard para conservar `RAILWAY_GIT_COMMIT_SHA`; si se usa
`railway up` desde un checkout limpio, registrar que el release de Sentry puede no tener SHA). **No**
reusar el build anterior (`cdafe04`) con un restart/redeploy, porque no incluye PayPal. **No** usar
`railway up` con un arbol de trabajo sucio ni deployar un commit distinto.

Si el build falla: la produccion sigue en el deployment anterior; la DB ya migrada es compatible con
`cdafe04` (si no hay filas PayPal). **STOP**, recolectar logs y decidir rollback/reintento con el dueno.
No habilitar PayPal. Si el fallo es transitorio y conocido (por ejemplo, Google Fonts o
`module-not-found`), el fallback documentado es `railway redeploy --from-source -y`; si el error es de
codigo, esquema o tests, no reintentar a ciegas.

---

## 6. Smoke con PayPal deshabilitado

Objetivo: probar que el codigo nuevo arranca con el esquema nuevo, que el CRM funciona y que Mercado
Pago sigue operativo, **sin** credenciales PayPal.

| # | Chequeo | Comando/accion | Esperado |
|---|---|---|---|
| 6.1 | Health | `Invoke-RestMethod https://pixelarch.dev/api/health \| ConvertTo-Json -Compress` | `status: "ok"`, `db: "ok"` |
| 6.2 | Home y login | Abrir `/` y `/admin`; iniciar sesion como admin | 200; login OK |
| 6.3 | Pagos | Abrir `/admin/pagos` | 200, sin 500; filas historicas visibles |
| 6.4 | Cobros | Abrir `/admin/cobros` | 200; PayPal **deshabilitado** con motivo claro (AC-16) |
| 6.5 | Clientes | Abrir `/admin/clientes` y un cliente con proyecto/hito | 200; datos intactos |
| 6.6 | Webhook PayPal off | `curl.exe -i -X POST https://pixelarch.dev/api/webhooks/paypal -H "Content-Type: application/json" -d '{"id":"T-38-PREFLIGHT-OFF","event_type":"PAYMENT.CAPTURE.COMPLETED"}'` | **503** "Webhook no configurado"; **no** 404/500 |
| 6.7 | MP UI | Abrir el modal de link MP en un cobro interno | Disponible; sin errores |
| 6.8 | MP link (opcional) | Generar un link MP para un concepto interno de bajo monto; **no enviarlo ni pagarlo** | Link creado; MP responde; se deja vencer o se documenta |
| 6.9 | MP intacto | Revisar `/admin/pagos` y conteos de pagos MP | Mismos pagos/estados que la linea base |
| 6.10 | Logs/Sentry | Railway logs + Sentry del periodo | Sin 500 ni errores nuevos de esquema |

Notas:

- El health solo hace `SELECT 1`: **no** prueba el esquema. El smoke real de esquema es `/admin/pagos`
  y `/admin/cobros`.
- Si no hay un concepto interno seguro para 6.8, no crear links MP reales; registrar la limitacion y
  validar solo UI + pagos historicos. No usar datos de un cliente real.
- No cargar `PAYPAL_*` hasta completar 6.1..6.10.

Si hay 500, 404, pagos MP rotos o errores de esquema: **STOP**; no habilitar PayPal; evaluar rollback
(§10) o corregir antes de seguir.

---

## 7. PayPal live: app, envs y webhook de produccion

### 7.1 Requisitos del dueno

- App PayPal **Live** (no sandbox) con `client_id` y `client_secret` live.
- Webhook **Live** creado contra `https://pixelarch.dev/api/webhooks/paypal`.
- `PAYPAL_WEBHOOK_ID` del webhook Live.
- Cuenta business live habilitada para recibir USD; confirmar que no hay restricciones.
- Carga de secretos por el dueno o por el ejecutor autorizado, sin exponerlos en el chat/repo.

### 7.2 Variables de produccion

Cargar **todas las envs PayPal juntas**; `paypalConfig()` exige las cuatro principales y, si falta una,
PayPal queda deshabilitado. Aplicar con `--skip-deploys` y hacer **un solo redeploy** al final.
`NEXT_PUBLIC_URL` se verifica aparte (es build-time).

| Variable | Valor esperado | Secreta | Evidencia |
|---|---|---|---|
| `PAYPAL_ENV` | `production` | No | Nombre + valor no secreto |
| `PAYPAL_CLIENT_ID` | Client ID de la app **Live** | Tratar como sensible | Enmascarado (`AX...` / ultimos 4) |
| `PAYPAL_CLIENT_SECRET` | Secret de la app **Live** | **Si** | Solo "cargado"; nunca valor |
| `PAYPAL_WEBHOOK_ID` | ID del webhook **Live** | **Si** | Enmascarado (`8N...` / ultimos 4) |
| `PAYPAL_BASE_URL` | `https://api-m.paypal.com` | No | Valor visible |
| `PAYPAL_FEE_BPS` | `540` | No | Valor visible |
| `PAYPAL_FEE_FIXED_CENTS` | `30` | No | Valor visible |
| `NEXT_PUBLIC_URL` | `https://pixelarch.dev` | No | Valor visible |

Reglas:

- **No** cargar `PAYPAL_ENV=sandbox`, `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com` ni credenciales
  de staging.
- **No** agregar `NEXT_PUBLIC_PAYPAL_*`: no hay SDK client-side; no hace falta tocar el Dockerfile.
- **No** tocar `MP_*`, Clerk, Resend, Sanity ni Sentry en esta ventana.
- `NEXT_PUBLIC_URL` es build-time: si ya es `https://pixelarch.dev`, solo se verifica. Si fuera otra,
  no se corrige con restart: requiere rebuild y se trata como un cambio aparte, no dentro de T-38.
- La conexion de Prisma debe seguir apuntando a la referencia del Postgres de produccion, no a staging.
- Si `PAYPAL_WEBHOOK_ID` no coincide exactamente con el webhook Live, la firma fallara con `401` en
  eventos reales.

Comandos (secretos por stdin/dashboard; nunca en el historial):

```powershell
railway variable set -s PixelArch -e production --skip-deploys `
  'PAYPAL_ENV=production' `
  'PAYPAL_BASE_URL=https://api-m.paypal.com' `
  'PAYPAL_FEE_BPS=540' `
  'PAYPAL_FEE_FIXED_CENTS=30'

Get-Clipboard | railway variable set PAYPAL_CLIENT_ID -s PixelArch -e production --stdin --skip-deploys
Get-Clipboard | railway variable set PAYPAL_CLIENT_SECRET -s PixelArch -e production --stdin --skip-deploys
Get-Clipboard | railway variable set PAYPAL_WEBHOOK_ID -s PixelArch -e production --stdin --skip-deploys
```

`NEXT_PUBLIC_URL` **no** se setea en runtime: es build-time. Verificar que el build actual ya usa
`https://pixelarch.dev`; si no, **STOP** y tratar el rebuild como un cambio aparte.

Alternativa preferida para secretos: dashboard de Railway, campo por campo. No pegar valores en el
chat ni en la evidencia.

### 7.3 Webhook Live

En PayPal Developer, app **Live** → Webhooks:

- URL: `https://pixelarch.dev/api/webhooks/paypal` (exacta; no `staging.pixelarch.dev`, no `www`).
- Eventos (los 7):
  1. `CHECKOUT.ORDER.APPROVED`
  2. `CHECKOUT.ORDER.COMPLETED`
  3. `PAYMENT.CAPTURE.COMPLETED`
  4. `PAYMENT.CAPTURE.DENIED`
  5. `PAYMENT.CAPTURE.REFUNDED`
  6. `PAYMENT.CAPTURE.REVERSED`
  7. `CUSTOMER.DISPUTE.CREATED`
- Modo: **Live**.
- `PAYPAL_WEBHOOK_ID` = id de ese webhook (no el de sandbox).
- Si el panel permite un evento de prueba, usarlo solo si no crea un pago real; si no, el smoke opcional
  (§8) es la validacion real.

### 7.4 Aplicar y verificar

1. Confirmar que todas las variables estan cargadas (nombres; valores de las no secretas).
2. Hacer **un solo redeploy** del servicio `PixelArch` en produccion (mismo build; las envs se inyectan
   en runtime; no hace falta rebuild).
3. Verificar health y admin:

```powershell
Invoke-RestMethod https://pixelarch.dev/api/health | ConvertTo-Json -Compress
```

4. Preflight del webhook **sin firma**:

```powershell
curl.exe -i -X POST https://pixelarch.dev/api/webhooks/paypal `
  -H "Content-Type: application/json" `
  -d '{"id":"T-38-PREFLIGHT-ON","event_type":"PAYMENT.CAPTURE.COMPLETED"}'
```

Esperado: **401** "Firma invalida". Un **503** significa que falta una variable, la tarifa es invalida o
la base URL es invalida. Un **404** es URL/deploy/middleware incorrecto.

5. Abrir `/admin/cobros`: PayPal debe figurar **disponible** (sin el motivo "no configurado").
6. Abrir `/admin/pagos` y verificar que sigue cargando; MP intacto.
7. Revisar Sentry/logs: sin errores nuevos.

Notas:

- El preflight `401` crea un `EventoPasarela` tecnico (`FIRMA_INVALIDA`) en produccion. Es esperado, no
  tiene PII y no crea `Pago`. No usar una firma fabricada.
- El `401` **no** prueba que el `PAYPAL_WEBHOOK_ID` coincida con el webhook Live; solo prueba que la
  config esta completa. La coincidencia se verifica comparando el id enmascarado del panel con el valor
  cargado y, si se hace §8, con una entrega real.
- Si el `401` no aparece y en su lugar hay `503`, corregir la variable faltante y repetir. No continuar
  con PayPal "a medias".
- No imprimir `PAYPAL_CLIENT_SECRET` ni el `PAYPAL_WEBHOOK_ID` completo.

---

## 8. Smoke PayPal opcional de bajo monto (solo con G7)

> **No es obligatorio para cerrar T-38**, pero es la unica forma de validar de punta a punta la app
> Live, el webhook Live y el id real. Si se omite, se registra el riesgo residual y se monitorea el
> primer pago real con prioridad.

### 8.1 Condiciones

- Aprobacion explicita del dueno con: monto acordado, pagador, fecha, autorizacion del cargo y plan de
  reembolso/limpieza.
- Monto bajo recomendado: **US$5,00 acordados** (total con fee `540`/`30`: ~US$5,61). Usar el monto que
  el dueno apruebe.
- Sin PII real de clientes: crear un cliente interno de prueba, no usar un cliente existente.

### 8.2 Que se crea en produccion

- Un `Cliente` interno, por ejemplo `T-38 Smoke (interno)`, con email no real del tipo
  `t38-smoke@example.invalid` (no usar el email de un cliente).
- Un `Proyecto` "T-38 smoke interno" con un unico `Hito` de US$5,00.
- Al generar el link: un `EnlacePago` ACTIVO y una orden PayPal.
- Al pagar: un `Pago` SUCCEEDED con recibo, el hito PAGADO y eventos `EventoPasarela`. No se persiste
  email/nombre del pagador (diseño del flujo).
- El pagador es el dueno o una cuenta autorizada; no un cliente real.

### 8.3 Pasos

1. Crear cliente/proyecto/hito internos desde el admin.
2. Generar el link PayPal desde el hito; verificar monto acordado/comision/total y que el hito sigue
   PENDIENTE antes de pagar.
3. Pagar el link con la cuenta autorizada (checkout PayPal Live).
4. Verificar: retorno, webhook, **un solo** `Pago`, hito PAGADO, recibo con desglose, sin PII del pagador.
5. Verificar en PayPal Live que la entrega del webhook fue 200 (no 401/500) y que el id coincide.
6. Revisar `/admin/pagos`, `/admin/cobros` y Sentry.

No reenviar un webhook real en produccion para probar idempotencia: ya se valido en staging (T-37). Si
se quiere probar, hacerlo solo con aprobacion y sin riesgo de duplicar un cobro real.

### 8.4 Limpieza y marcado

- Reembolsar el pago en PayPal Live (total capturado) o dejar constancia de que el dueno decidio no
  reembolsar.
- Registrar un `AjustePago` de tipo REEMBOLSO con decision `REVERTIR_HITO` (si se reembolso y se quiere
  devolver el hito a PENDIENTE) o `NINGUNA` (si se deja el pago como interno). Agregar nota
  "T-38 smoke - no cobrar".
- Marcar el cliente/proyecto como internos: desactivar el cliente (`activo=false`) y agregar nota
  "T-38 smoke". **No borrar** cliente, proyecto, hito, pago, recibo, enlace ni eventos.
- Si el reembolso deja el `Pago` en `REFUNDED`, conservar el recibo y el ajuste; no eliminar filas.
- Si aparece un pago duplicado: reembolsar uno y registrar el ajuste; no borrar.
- Si el dueno no autoriza el smoke: registrar "NO EJECUTADO POR DECISION DEL DUENO" y el riesgo residual
  (el primer pago real sera la primera validacion live del webhook).

---

## 9. Monitoreo, criterios de exito y stop conditions

### 9.1 Ventana de monitoreo

| Momento | Que revisar |
|---|---|
| **T+0 a T+60 min** | Health, logs de Railway, Sentry, admin (`/admin/pagos`, `/admin/cobros`), webhook PayPal Live, MP |
| **T+24 h** | Sentry (errores nuevos), `EventoPasarela` con `requiereAccion`, pagos en `REVISION`, webhook failures, MP |
| **T+7 d** | Cierre: sin regresiones, sin duplicados, MP estable, evidencia completa |

### 9.2 Criterios de exito

- Deploy `SUCCESS` con commit `139b8cb` (o el SHA revalidado y aprobado).
- `/api/health` = `ok`/`db: ok`.
- `/admin/pagos`, `/admin/cobros`, `/admin/clientes` cargan sin 500.
- PayPal disponible en el admin; webhook `401` sin firma (no `503`/`404`).
- Webhook Live con los 7 eventos y `PAYPAL_WEBHOOK_ID` coincidente (validado por panel + smoke si se hizo).
- MP operativo: pagos historicos y link sin regresiones; sin errores nuevos.
- Sin PII ni secretos en logs/Sentry/evidencia.
- Si hubo smoke: un solo `Pago`, hito PAGADO, recibo, webhook 200; limpieza registrada.
- `EnlacePago`/`EventoPasarela`/`AjustePago` solo con las filas esperadas; sin duplicados.

### 9.3 Stop conditions (rollback inmediato o pausa)

- 500 sostenido en admin o health `degraded`/`db: error` no explicado.
- PayPal sigue en `503` tras corregir una variable, o webhook `404`.
- Webhook Live devuelve `401` en eventos reales (id/credencial incorrecta).
- Pago duplicado, doble acreditacion de meses o `Pago` inesperado.
- MP deja de funcionar o aparecen errores nuevos en su webhook.
- Perdida/inconsistencia de conteos, sumas o datos; drift no aditivo.
- PII o secreto expuesto en logs/Sentry/chat/evidencia.
- Build con commit incorrecto o deploy fallido sin rollback claro.
- El dueno pide detener.

Al activar una stop condition: ejecutar §10, preservar evidencia y no borrar datos. Comunicar al dueno
y al reviewer.

---

## 10. Rollback

### 10.1 Principio

El rollback **preferido** es deshabilitar PayPal y mantener el codigo nuevo. La DB es aditiva y los
datos se conservan. **No** se hace `DROP`, `TRUNCATE`, `DELETE` ni reset.

### 10.2 Secuencia

1. Quitar de produccion (`PixelArch`) las envs PayPal:
   `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_BASE_URL`,
   `PAYPAL_FEE_BPS`, `PAYPAL_FEE_FIXED_CENTS`.
   - Dashboard (preferido) o CLI con `railway variable delete ... -s PixelArch -e production` (usar
     `--skip-deploys` si el CLI lo soporta; si no, dashboard).
   - Agrupar todos los cambios; no redeployar todavia.
2. Registrar el id enmascarado y deshabilitar/borrar el webhook PayPal **Live** en el panel para cortar
   reintentos.
3. Redeploy del servicio (un solo redeploy para todos los cambios). Verificar:
   - `/api/health` = `ok`.
   - `/admin/pagos` y `/admin/cobros` cargan.
   - PayPal no disponible (UI deshabilitada; link API `503`).
   - `/api/webhooks/paypal` responde `503` (config deshabilitada), no `404`/`500`.
   - MP operativo y pagos historicos intactos.
4. Revisar Sentry/logs: sin errores nuevos.

### 10.3 Code rollback (solo si es seguro)

- **No** volver a `cdafe04` si ya existe algun `Pago` con `metodo=PAYPAL`, `estadoPago=REVISION` o
  `CONTRACARGO`: el cliente Prisma viejo no conoce esos valores de enum y puede fallar al leer
  `/admin/pagos`.
- Si no hay filas con esos valores y se decide revertir codigo: redeploy del deployment anterior
  `554f70d7-4ebd-47db-9812-b831052c9a32` desde el dashboard (o el equivalente MCP/CLI). La DB nueva es
  aditiva y el codigo viejo ignora tablas/columnas nuevas.
- Si hay filas PayPal: mantener el codigo nuevo con PayPal deshabilitado; no revertir codigo. Si hace
  falta, archivar/exportar y definir con el dueno antes de tocar el esquema.
- Nunca borrar filas para "limpiar" el rollback.

### 10.4 Pagos duplicados o diferencias

- Reembolsar/ajustar manualmente desde PayPal y registrar `AjustePago` (REEMBOLSO/CONTRACARGO) con la
  decision correspondiente. Conservar `Pago`, recibo y eventos.
- Si un pago se capturo pero el webhook fallo: conciliar por order/capture id y registrar el pago
  manual (solo admin) o reembolsar. No crear un segundo `Pago` si ya existe uno.
- Si hay meses acreditados de mas: decidir `DESCONTAR_MESES` manualmente; no automatizar.
- No borrar `EventoPasarela` tecnicos (`FIRMA_INVALIDA`) generados por el preflight; son evidencia sin
  PII.

### 10.5 Migracion

- No se revierte el esquema. Las tablas/columnas nuevas quedan; el codigo anterior las ignora (salvo
  filas con enums nuevos, ver §10.3).
- Si hubiera que restaurar el backup: es el **ultimo recurso**, requiere aprobacion del dueno y pierde
  los pagos/eventos posteriores al backup. Preferir arreglo hacia adelante. Nunca restaurar sobre
  produccion sin exportar el estado actual.

### 10.6 Evidencia del rollback

Registrar: hora, motivo, envs eliminadas (nombres), webhook deshabilitado (id enmascarado), deployment
anterior usado (si aplica), health, estado de admin/MP, pagos afectados y ajustes. Sin secretos/PII.

---

## 11. Evidencia esperada y cierre

### 11.1 Evidencia minima

| Evidencia | Origen | Redaccion |
|---|---|---|
| Aprobacion G1 (fecha, ventana, ejecutor) | Mensaje del dueno | Sin secretos |
| Backup: fecha, tamano, SHA-256, DB de restore, conteos | §3 | Sin cadena de conexion ni PII |
| Snapshot pre/post: conteos, sumas, `current_database()`/host | §4.1/§4.4 | Solo conteos/fingerprint |
| Preview DDL: solo aditivo | §4.2 | Sin datos |
| `db push`: estado final | §4.3 | Sin salida completa ni host |
| Backfill: antes/despues (`0/0/0`) | §4.4 | Sin filas |
| Merge: tipo FF, `main`/`paypal-staging` SHA, `git log` | §5 | Sin credenciales |
| Deploy: ID, commit, estado, health JSON | §5.4/§6 | Sin cookies |
| Envs: nombres y valores no secretos (`PAYPAL_ENV`, fee, URL) | §7.2 | Secretos enmascarados |
| Webhook: URL, 7 eventos, modo Live, id enmascarado | §7.3 | Sin id completo |
| Webhook off: `503`; on: `401`; sin `404` | §6.6/§7.4 | Status + cuerpo corto |
| Admin: PayPal off/on, `/admin/pagos`, `/admin/cobros` | §6/§7 | Capturas redactadas |
| MP: pagos historicos y link | §6 | Sin datos de clientes |
| Smoke opcional: IDs internos, montos, recibo, webhook 200 | §8 | Sin PII del pagador |
| Monitoreo: Sentry/logs/webhook/MP | §9 | Sin payloads crudos |
| Rollback (si aplica): motivo, envs, deploy, health | §10 | Sin secretos |

### 11.2 Reglas de redaccion

- No incluir `PAYPAL_CLIENT_SECRET`, `PAYPAL_CLIENT_ID` completo, `PAYPAL_WEBHOOK_ID` completo, tokens,
  cookies, cadenas de conexion, emails/nombres de pagadores ni payloads crudos.
- Usar IDs internos (`Pago.id`, `EnlacePago.id`, `EventoPasarela.eventoId`, `AjustePago.id`), sufijos o
  valores enmascarados.
- Capturas: redactar PII, tokens y cualquier valor de conexion.
- El backup no se guarda en el repo ni se adjunta al informe.

### 11.3 Actualizacion de `review.md` y registro

- El link al runbook ya esta en `review.md` §6.
- Al cerrar la ejecucion, el planner agrega en `review.md` una seccion T-38 (o un `review-t38.md`
  enlazado) con: veredicto, gates, evidencia, incidentes, rollback (si hubo) y riesgo residual.
- El registro de ejecucion se completa en el Anexo A de este documento.
- El implementer marca T-38 en `tasks.md` **solo** despues de la revision y la aprobacion del dueno; el
  planner no marca tareas.
- Actualizar `AGENTS.md`/`MEMORY.md` (produccion ya no pendiente, gotchas live) es un cambio separado,
  fuera de T-38; no hacerlo en la ventana de rollout.

---

## 12. Tabla de pasos

| # | Paso | Responsable | Comando/herramienta | Resultado esperado | Evidencia |
|---|---|---|---|---|---|
| 0 | Aprobar T-38, ventana y ejecutor (G1/G2) | Dueno | Mensaje/correo | Autorizacion explicita; freeze | Texto de aprobacion (sin secretos) |
| 1 | Verificar baseline y SHAs | Implementer | `git fetch`/`rev-parse`; `railway deployment list`; health | `main`=`cdafe04`, `paypal-staging`=`139b8cb`, deploy `554f70d7...`, health ok | SHAs, deploy ID, health JSON |
| 2 | Verificar disponibilidad de G5/G6/G7 (sin cargar PayPal) | Dueno + Implementer | Panel PayPal; checklist §10 | Live disponible; rollback listo; decision sobre smoke | Capturas con IDs enmascarados |
| 3 | Conectar a Postgres prod | Implementer | `railway connect ... --tunnel-only` o TCP proxy aprobado | Host de produccion; sin exponer credenciales | Host/fingerprint |
| 4 | Snapshot pre-migracion | Implementer | `psql` (§4.1) | Tablas nuevas NULL; conteos baseline | Conteos + `current_database()` |
| 5 | Backup | Implementer | `pg_dump`; `Get-FileHash`; `pg_restore --list` | Dump valido, SHA-256, tablas listadas | Path, tamano, hash |
| 6 | Prueba de restore (G3) | Implementer | `createdb`/`pg_restore`; conteos; `dropdb` | Conteos iguales; sin tablas nuevas | Conteos de restore |
| 7 | Preview DDL | Implementer | `prisma migrate diff ... --script` | Solo aditivo; sin DROP/TRUNCATE | Archivo preview + revision |
| 8 | `db push` | Implementer | `node node_modules\prisma\build\index.js db push` | Esquema aplicado; sin reset | Estado final |
| 9 | `generate` | Implementer | `node node_modules\prisma\build\index.js generate` | Cliente local regenerado | OK |
| 10 | Backfill | Implementer | `psql` con las 3 UPDATE de `backfill.sql` | `0/0/0`; conteos/suma intactos | Antes/despues |
| 11 | Verificar esquema | Implementer | `\dt`, `to_regclass`, `\d "Pago"`, enums | Tablas/columnas/enums presentes; nuevas vacias | Salida redactada |
| 12 | Checkpoint pre-merge | Implementer | Health + `/admin/pagos` + `/admin/cobros` | Codigo viejo sano; MP intacto | Status/capturas |
| 13 | Verificar FF (G4) | Implementer | `git merge-base --is-ancestor`; `git log`; `git diff` | Exit 0; diff acotado | Salida |
| 14 | FF-merge y push | Implementer | `git merge --ff-only`; `git push origin main` | `main`=`139b8cb`; push OK | `git rev-parse HEAD`; log |
| 15 | Seguir auto-deploy | Implementer | `railway deployment list`; logs | Deploy SUCCESS, commit `139b8cb` | Deploy ID + commit |
| 16 | Smoke PayPal off | Implementer | §6 | Health ok; admin OK; MP OK; webhook `503` | Capturas/status |
| 17 | Cargar envs live | Dueno/Implementer | Dashboard o `railway variable set --skip-deploys` | 7 PayPal + `NEXT_PUBLIC_URL` verificado; sin `NEXT_PUBLIC_PAYPAL_*` | Nombres + no secretos |
| 18 | Crear/verificar webhook Live | Dueno | Panel PayPal Live | URL prod + 7 eventos + id coincidente | Captura enmascarada |
| 19 | Redeploy | Implementer | Dashboard/Railway | App con PayPal disponible | Deploy/redeploy OK |
| 20 | Preflight webhook on | Implementer | `curl -i POST /api/webhooks/paypal` sin firma | **401**, no 503/404 | Status + cuerpo |
| 21 | Verificar admin/MP | Implementer | `/admin/cobros`, `/admin/pagos`, MP | PayPal disponible; MP intacto; sin 500 | Capturas |
| 22 | Smoke PayPal opcional (G7) | Dueno + Implementer | §8 | 1 `Pago`, hito PAGADO, recibo, webhook 200 | IDs enmascarados |
| 23 | Limpiar smoke | Implementer | Reembolso + `AjustePago`; notas | Pago REFUNDED; hito revertido/decidido; sin borrar | IDs/ajuste |
| 24 | Monitoreo T+60m/T+24h/T+7d | Implementer | Railway logs/Sentry/PayPal/MP | Sin regresiones ni duplicados | Reporte de monitoreo |
| 25 | Rollback si stop condition | Implementer | §10 | PayPal off; MP/admin OK; datos conservados | Registro de rollback |
| 26 | Revision y cierre | Reviewer/Planner/Implementer | `review.md` + Anexo A | Veredicto; T-38 marcada solo si aprueba | Informe final |

---

## Anexo A — Registro de ejecucion T-38 (plantilla)

| Campo | Valor |
|---|---|
| Fecha/hora de inicio y fin | |
| Ejecutor autorizado | |
| Aprobacion del dueno (G1) | Referencia/fecha; sin secretos |
| Ventana/freeze (G2) | |
| Backup: path, tamano, SHA-256 | Fuera del repo |
| Restore: DB, conteos | |
| Snapshot pre: `Pago`/suma/clientes/proyectos/hitos/soportes | |
| Preview DDL: resultado | Solo aditivo / STOP |
| `db push`: resultado | |
| Backfill: antes/despues (`0/0/0`) | |
| Esquema: tablas/columnas/enums | |
| Merge: FF si/no; SHA `main`/`paypal-staging` | |
| Deploy ID/commit/estado | |
| Health post-deploy | |
| Envs cargadas (nombres; no secretos) | |
| Webhook: URL, 7 eventos, modo, id enmascarado | |
| Preflight off/on | `503` / `401` |
| Smoke PayPal: si/no; monto; IDs; webhook | |
| Limpieza del smoke | |
| Monitoreo T+60m/T+24h/T+7d | |
| Rollback: si/no; motivo; envs; deploy | |
| Resultado global | `PASS` / `PASS CON OBSERVACIONES` / `FAIL` / `BLOCKED` |
| Riesgo residual | |
| Evidencia | `review.md` + este anexo |

---

## Anexo B — Preguntas abiertas / decisiones del dueno

1. **G1:** fecha, hora, ventana y ejecutor autorizado de T-38. `[NECESITA ACLARACION]`
2. **G7:** se autoriza el smoke PayPal real de bajo monto? Monto y pagador. Si no, se omite y se asume
   el riesgo de validar el webhook Live con el primer pago real. `[NECESITA ACLARACION]`
3. **G3:** donde se guarda el backup y cuanto se retiene; que DB descartable se usa para el restore.
   `[NECESITA ACLARACION]`
4. **G4:** si el merge no es FF, se prefiere rebase controlado o merge commit con revalidacion en
   staging? Cualquiera de las dos exige un SHA nuevo y revalidacion. `[NECESITA ACLARACION]`
5. **G5:** la app PayPal Live y el webhook Live ya existen y estan verificados para recibir USD?
   `[NECESITA ACLARACION]`
6. **Operacion:** quien ejecuta el rollback si el ejecutor no esta disponible al T+60m? `[NECESITA ACLARACION]`
