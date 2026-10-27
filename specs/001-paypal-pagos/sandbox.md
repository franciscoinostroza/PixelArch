# Runbook sandbox 001: validacion previa a produccion (AC-29)

**Tarea:** T-36 (AC-29; RNF-11)
**Spec:** ./spec.md
**Plan:** ./plan.md §7.3 (webhook), §7.5 (migracion y rollback), §7.7 (checklist)
**Estado:** preparado. Este documento **no ejecuta** deploy, no carga variables ni toca base de datos.

> **Alcance de T-36:** solo define el procedimiento y la evidencia. El deploy y la ejecucion del
> checklist los hacen **T-37** (Railway staging) y **T-38** (produccion). **AC-29 queda pendiente**
> hasta que los 14 pasos de §4 se completen y la evidencia quede registrada; cerrar T-36 no cierra AC-29.

---

## 1. Proposito

Validar PayPal de punta a punta en un entorno **Railway staging con Postgres separado**, con
credenciales sandbox y un webhook publico estable, sin afectar produccion. Local/ngrok sirve solo
para desarrollo y **no reemplaza** esta validacion (RNF-11, PA-11).

La validacion cubre: generacion de link, pago invitado, webhook y recibo, hito PAGADO, soporte de
3 meses, idempotencia, firma invalida, diferencias en `REVISION`, coexistencia con Mercado Pago,
registro manual, reembolso/contracargo y evidencia final.

---

## 2. Requisitos previos

Nada de esta seccion se resuelve con este documento: lo verifica y carga T-37 antes del checklist.

### 2.1 Cuenta PayPal sandbox (dueno)

- App sandbox creada en PayPal Developer con `client_id` y `client_secret`.
- Cuenta **business sandbox** que recibe el pago y cuenta **personal sandbox** para pagar.
- Webhook sandbox creado contra la URL de staging (§2.3) y su `webhook_id`.
- Aprobacion explicita de la tarifa de gross-up antes de usarla en produccion (PA-11).

### 2.2 Entorno Railway staging

- Entorno de staging con **servicio web propio** y **Postgres propio**; no se reutiliza la base de
  produccion ni un schema de produccion.
- **URL publica estable HTTPS** para el servicio staging (dominio Railway o subdominio propio).
  No se acepta localhost, ngrok ni una URL efimera para la validacion final.
- `DATABASE_URL` apunta **solo** a la BD de staging. Prohibido usar la BD de produccion, aunque sea
  con otro schema o una copia.
- Variables de staging separadas de produccion. Ninguna credencial de produccion se carga en staging
  ni viceversa.
- Deploy del codigo con PayPal **deshabilitado** primero y smoke test, segun plan §7.5; luego se
  cargan las variables sandbox y se habilita PayPal.

Variables requeridas en staging (los valores secretos los carga el dueno; nunca se pegan en este
documento, en el repo ni en la evidencia):

| Variable | Valor requerido en staging | Nota |
|---|---|---|
| `PAYPAL_ENV` | `sandbox` | Sin valor, PayPal queda deshabilitado. |
| `PAYPAL_CLIENT_ID` | Client id de la app sandbox | Server-only; la carga el dueno. |
| `PAYPAL_CLIENT_SECRET` | Client secret de la app sandbox | Server-only; nunca en logs. |
| `PAYPAL_WEBHOOK_ID` | Id del webhook sandbox | Debe coincidir con el panel de PayPal. |
| `PAYPAL_BASE_URL` | Vacio, o `https://api-m.sandbox.paypal.com` | **Nunca** `https://api-m.paypal.com` en staging. |
| `PAYPAL_FEE_BPS` | `540` (5,40%) | Default del plan; se valida en el paso 5. |
| `PAYPAL_FEE_FIXED_CENTS` | `30` (US$0,30) | Default del plan; se valida en el paso 5. |
| `NEXT_PUBLIC_URL` | `https://<staging-domain>` | Define `return_url`, `cancel_url` y el link estable. |
| `DATABASE_URL` | Postgres de staging | **Nunca** la de produccion. |
| `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` | Credenciales MP de prueba | Solo para el paso 11; nunca las de produccion. |
| `CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk de staging o el admin existente | Acceso solo al admin/asistente de prueba. |
| `RESEND_API_KEY` | Clave de staging o la existente | Los emails de prueba solo van al dueno; no a clientes reales. |
| `ADMIN_EMAIL` / `CONTACT_EMAIL` | Email del dueno | Alertas y recibos de prueba. |

No se agrega ninguna variable `NEXT_PUBLIC_*` de PayPal: no hace falta tocar el `Dockerfile` ni los
build args (plan §7.1).

### 2.3 Webhook sandbox

- URL: `https://<staging-domain>/api/webhooks/paypal`.
- Eventos suscritos (plan §7.3): `CHECKOUT.ORDER.APPROVED`, `CHECKOUT.ORDER.COMPLETED`,
  `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`,
  `PAYMENT.CAPTURE.REVERSED`, `CUSTOMER.DISPUTE.CREATED`.
- El `webhook_id` del panel debe ser exactamente el valor de `PAYPAL_WEBHOOK_ID`. Si falta, el
  endpoint responde `503` y no se procesa nada.
- Credenciales y webhook los configura el dueno (PA-11); el implementer solo verifica que la URL
  responda y que el id coincida.

### 2.4 Datos y salvaguardas

- Usar solo un cliente de prueba (`Cliente Prueba Sandbox`) con el email del dueno. No cargar datos
  de clientes reales ni PII de produccion.
- La BD de staging es descartable; la de produccion no se escribe durante T-37. Solo se permiten
  lecturas puntuales en P-8 y en el paso 14 para demostrar que no cambio.
- No se modifica codigo ni se fuerza el resultado tocando la BD. Si un paso no se puede reproducir,
  queda `BLOCKED` y no se aprueba.
- No se pegan secretos, tokens completos, URLs completas de pago ni email/nombre del pagador en la
  evidencia. Se usan ids internos, sufijos y capturas redactadas.
- Mercado Pago se prueba solo con credenciales de prueba. Si el dueno no las tiene, el paso 11 queda
  `BLOCKED` y no se aprueba el checklist.

---

## 3. Preparacion del entorno (T-37, plan §7.5)

| # | Paso | Resultado esperado |
|---|---|---|
| P-1 | Crear o verificar el servicio web de staging y su Postgres propio. Registrar nombre de BD y fingerprint del host, sin credenciales. | Servicio y BD separados de produccion. |
| P-2 | Cargar `DATABASE_URL` de staging y ejecutar `npx prisma db push` + `npx prisma generate` contra esa BD (fallback local del plan §4.2 si `npx` falla). Si hay datos previos, correr el backfill de §4.2. | Esquema aditivo aplicado solo en staging. |
| P-3 | Desplegar el codigo con PayPal deshabilitado y esperar el health check. Smoke test: `/api/health`, login admin, `/admin/pagos` y un link MP de prueba. | La app arranca y MP sigue operativo. |
| P-4 | Cargar las variables sandbox de §2.2, redeploy/restart y verificar que PayPal aparece disponible y que MP sigue disponible. | `PAYPAL_ENV=sandbox` activo; sin `NEXT_PUBLIC_*` de PayPal. |
| P-5 | Registrar el webhook sandbox de §2.3, cargar `PAYPAL_WEBHOOK_ID` y confirmar que la URL responde (sin 404). | Webhook y variable coinciden. |
| P-6 | Crear los datos de prueba: cliente, proyecto con hito `PENDIENTE` y soporte `ACTIVE` o `PAST_DUE`, con montos conocidos. | Datos solo en staging. |
| P-7 | Abrir el registro de evidencia (§10) y anotar fecha, ejecutor, URL staging, commit (`RAILWAY_GIT_COMMIT_SHA`) y nombre de la BD. | Registro iniciado, sin secretos. |
| P-8 | Tomar una linea base de produccion: `/api/health`, ultimo `Pago.id` y cantidad total de pagos; confirmar que el cliente de prueba no existe. Solo lectura. | Base para demostrar que produccion no cambio. |

---

## 4. Checklist de validacion (AC-29)

Los pasos 1-3 son configuracion; 4-14 son validacion funcional. El paso 5 se completa con el detalle
del primer pago del paso 6, pero debe quedar resuelto antes del paso 7.

### 1. App y cuentas sandbox (configuracion)

**Accion:** crear la app sandbox, obtener client id/secret y las cuentas business/personal; cargar
las credenciales en staging.

**Resultado esperado:** `PAYPAL_ENV=sandbox`; PayPal disponible en el admin; credenciales validas y
distintas de produccion. La cuenta business puede recibir USD.

**Evidencia:** captura de la app con ids enmascarados, nombres de variables de staging (sin valores)
y confirmacion de que PayPal aparece disponible.

### 2. Railway staging con Postgres separado (configuracion)

**Accion:** verificar servicio, BD, `DATABASE_URL`, migracion `db push`/`generate` y backfill.

**Resultado esperado:** staging usa su propia BD; no hay datos de produccion; el admin carga; el
esquema nuevo existe solo en staging. Nunca se usa la BD de produccion.

**Evidencia:** `SELECT current_database(), current_user, inet_server_addr();` en staging, comparado
con el identificador de produccion; captura de variables (sin valores). No pegar la connection string.

### 3. Webhook sandbox (configuracion)

**Accion:** registrar `https://<staging-domain>/api/webhooks/paypal` con los 7 eventos de §2.3 y
copiar el `webhook_id` a `PAYPAL_WEBHOOK_ID`.

**Resultado esperado:** el id coincide; la URL responde; no hay `404`; el endpoint no devuelve `503`
por configuracion faltante.

**Evidencia:** captura del webhook (URL, eventos, id enmascarado) y de la variable cargada.

### 4. Link para un hito de prueba

**Accion:** con un hito `PENDIENTE` de US$100,50, generar el link PayPal desde el admin. Usar la
tarifa default 540 bps + 30 centavos. Intentar generar un segundo link para el mismo hito.

**Resultado esperado:** un link unico y activo por 30 dias; el hito sigue `PENDIENTE`; no se crea
`Pago`; se muestra `US$100,50` acordado, `US$6,06` de comision y `US$106,56` total (con la tarifa
default); el snapshot `feeBps`/`feeFixedCents` queda guardado; el segundo intento reutiliza el link
vigente y no duplica.

**Evidencia:** captura del modal con montos y vencimiento, `EnlacePago.id`, sufijo del token (nunca
completo), estado del hito antes/despues y segundo intento con `reutilizado=true`.

### 5. Tarifa real de PayPal

**Accion:** contrastar la comision calculada (`comision`) con la comision que PayPal informe en el
detalle de la transaccion sandbox del primer pago (paso 6). Si el sandbox no expone el detalle,
registrar la limitacion y contrastar la tarifa con la tabla vigente de la cuenta; no inventar un
valor.

**Resultado esperado:** la comision calculada coincide con la real, o se ajustan
`PAYPAL_FEE_BPS`/`PAYPAL_FEE_FIXED_CENTS`, se regenera el link y se confirma un nuevo snapshot. Un
link ya creado conserva su snapshot; no se recalcula.

**Evidencia:** detalle de la transaccion, calculo esperado, valores de env usados y captura del link
regenerado si hubo ajuste.

### 6. Pago invitado, webhook, recibo y hito PAGADO

**Accion:** abrir el link en una ventana privada y pagar con la cuenta personal sandbox, usando guest
checkout si PayPal lo ofrece. Verificar la redireccion, la captura, la entrega del webhook y el
recibo.

**Resultado esperado:** el pago se completa; `return_url` captura la orden; el webhook
`PAYMENT.CAPTURE.COMPLETED` se procesa; queda **un** `Pago` con `estadoPago=SUCCEEDED`,
`montoAcordado=10050`, `comision` y `monto` iguales al snapshot vigente (con la tarifa default:
606 y 10656), moneda USD, `externalId` = capture id, `paypalOrderId` y `reciboId`; el recibo muestra
el desglose y los datos del cliente del CRM, sin
datos de tarjeta ni PII del pagador; el hito queda `PAGADO` y no admite un segundo cobro. Si el
retorno ya proceso el pago, el webhook **no debe crear otro `Pago`** (resultado `DUPLICADO` o
`IGNORADO` segun corresponda).

**Evidencia:** `paypalOrderId`, capture id, `EventoPasarela.eventoId` y resultado, `Pago.id`, captura
de la pagina de retorno, recibo y hito `PAGADO`.

### 7. Soporte de 3 meses

**Accion:** generar un link de soporte por 3 meses (`montoAcordado = precio mensual x 3`) y pagarlo.
Verificar la acreditacion y el vencimiento.

**Resultado esperado:** `Pago.meses=3`; el soporte acredita exactamente 3 meses; `proximoPago` se
actualiza una sola vez con la misma regla que Mercado Pago; el estado queda `ACTIVE`; no se duplica
la acreditacion si llega otro evento.

**Evidencia:** `Suscripcion.proximoPago` antes/despues, `Pago.id`, `meses`, evento y captura del
soporte actualizado.

### 8. Repeticion idempotente del webhook

**Accion:** desde el panel o la API sandbox de PayPal, reenviar el mismo
`PAYMENT.CAPTURE.COMPLETED` **con firma valida** (no fabricarla). Si el panel genera un `eventoId`
nuevo, repetir tambien para probar la deduplicacion por capture id.

**Resultado esperado:** respuesta `200`; `EventoPasarela.resultado=DUPLICADO`; no se crea otro
`Pago`; no se vuelve a marcar el hito ni se acreditan meses dos veces.

**Evidencia:** `eventoId`, capture id, respuesta HTTP, resultado del evento y conteo de `Pago` antes/
despues.

### 9. Firma invalida o ausente: 401

**Accion:** enviar un POST al webhook staging sin `PAYPAL-TRANSMISSION-SIG` o con una firma alterada/
invalida. No fabricar una firma valida ni usar secretos reales en la evidencia.

**Resultado esperado:** `401`; no se crea `Pago` ni cambia el hito/soporte; queda un
`EventoPasarela` tecnico (`FIRMA_INVALIDA`) sin PII ni payload crudo.

**Evidencia:** status `401`, cuerpo de respuesta, `EventoPasarela.eventoId` y confirmacion de que no
hay `Pago` nuevo.

Ejemplo de request seguro (sin datos reales):

```bash
curl -i -X POST "https://<staging-domain>/api/webhooks/paypal" \
  -H "Content-Type: application/json" \
  -d '{"id":"TEST-INVALID-SIG","event_type":"PAYMENT.CAPTURE.COMPLETED"}'
```

### 10. Diferencia de monto: REVISION

**Accion:** crear por API sandbox una orden con el mismo `custom_id`/`invoice_id` del enlace y un
monto distinto, aprobarla y capturarla. No editar la BD ni el codigo.

**Resultado esperado:** el pago queda `estadoPago=REVISION`, `monto` es lo capturado y
`montoEsperado` el total del link; el hito sigue `PENDIENTE` y no se acreditan meses; el admin ve la
diferencia. Si se prueba aceptar/rechazar, la decision queda trazada y no hay aplicacion automatica.

**Evidencia:** order id, capture id, `Pago.id`, montos esperado/cobrado/diferencia, captura de la
vista de revision y estado del hito/soporte. Si el evento no se vincula al link, el resultado es
`IGNORADO`/`REQUIERE_ACCION` y el paso no se considera aprobado: corregir la orden de prueba.

### 11. Coexistencia Mercado Pago / PayPal

**Accion 11a:** para un hito pendiente, generar un link MP de prueba y un link PayPal. Pagar primero
Mercado Pago. Verificar que el link PayPal queda `INVALIDADO`, que hay un solo `Pago` y que el
intento PayPal descartado queda trazado. Intentar usar el link PayPal invalidado.

**Accion 11b:** repetir con otro hito, pagando primero PayPal; verificar que el link MP queda
invalidado y que un intento MP posterior no crea otro `Pago`.

**Resultado esperado:** el primer pago gana; el link hermano se invalida; no hay segundo `Pago`; se
conservan ambos links y la trazabilidad; el flujo MP sigue funcionando (AC-13, AC-20).

**Evidencia:** ids/estados de ambos `EnlacePago`, `Pago.id`, evento del intento descartado y capturas
de los dos estados. Usar solo credenciales MP de prueba; nunca produccion.

### 12. Registro manual y no duplicacion

**Accion:** crear y capturar por API sandbox una orden con el `custom_id`/`invoice_id` de un enlace,
**sin abrir el `return_url`**, y deshabilitar temporalmente el webhook sandbox para que ese capture no
se registre automaticamente. Registrarlo manualmente desde el admin con capture id/order id y
evidencia textual/URL. Reactivar el webhook y reenviar el evento real de ese pago. No borrar ni editar
un `Pago` existente para fabricar el escenario.

**Resultado esperado:** se crea **un** `Pago` con `origen=MANUAL`, evidencia, `externalId` y
`paypalOrderId`; el hito/soporte se aplica solo si el admin lo eligio; al llegar el webhook el evento
queda `DUPLICADO` y no se crea otro pago; no se guardan email/nombre del pagador. Si hay un usuario
asistente de prueba, verificar que no ve la accion y que el endpoint responde `403`.

**Evidencia:** captura del formulario, `Pago.id`, `origen`, evidencia, evento posterior y consulta de
`Pago` sin campos de pagador/PII.

### 13. Reembolso y contracargo manual

**Accion 13a:** sobre un pago de prueba exitoso, registrar un `REEMBOLSO` con decision
`REVERTIR_HITO` (o `NINGUNA`) y evidencia.

**Accion 13b:** sobre un pago de soporte, registrar un `CONTRACARGO` con decision
`DESCONTAR_MESES` y la cantidad de meses indicada.

**Resultado esperado:** el pago original y su recibo se conservan; se crea `AjustePago`; el estado
pasa a `REFUNDED`/`CONTRACARGO`; la decision del admin se aplica solo si fue elegida; no hay reversion
ni descuento automatico.

**Evidencia:** `AjustePago.id`, `tipo`, `decision`, `mesesDescontados`, `Pago.id/estado` y estado del
hito/soporte antes/despues. Solo pagos sandbox.

### 14. Produccion intacta y evidencia final

**Accion:** verificar que produccion no cambio: `/api/health`, `/admin/pagos` sin el cliente de
prueba, conteo/ultimo `Pago` igual a la linea base, variables de produccion sin cambios y staging sin
credenciales de produccion. Guardar la evidencia.

**Resultado esperado:** cero escrituras en produccion; ningun dato sandbox en produccion; los 13
pasos anteriores aprobados; evidencia completa y redactada. Dejar constancia explicita de que la
validacion final fue en **Railway staging con BD separada**, no en local/ngrok.

**Evidencia:** captura de produccion sin datos de prueba, comparacion de conteos/ids, captura de
variables de staging/produccion (sin valores), registro §10 completo y aprobacion del dueno.

---

## 5. Evidencia esperada

Registrar en `specs/001-paypal-pagos/review.md` (cuando el planner reciba el informe) o en el
registro de T-37. No crear ni modificar `review.md` desde T-36.

| Evidencia | Origen | Nota |
|---|---|---|
| `EnlacePago.id`, sufijo del token, estado, `expiraEn` | Admin / BD staging | Nunca el token completo. |
| `paypalOrderId` y capture id (`Pago.externalId`) | PayPal sandbox y `Pago` | Referencias externas. |
| `Pago.id`, `estadoPago`, `montoAcordado`, `comision`, `monto`, `montoEsperado`, `feeBps`, `feeFixedCents`, `origen`, `reciboId` | BD staging / admin | Desglose exacto en centavos. |
| `EventoPasarela.eventoId`, `tipo`, `resultado`, `creadoEn`, `requiereAccion` | BD staging / logs | Sin payload crudo ni PII. |
| `Hito.id/estado`; `Suscripcion.id/proximoPago/estado` | Admin / BD staging | Antes y despues. |
| `AjustePago.id`, `tipo`, `decision`, `mesesDescontados` | Admin / BD staging | Reembolso y contracargo. |
| Status `401` y cuerpo de respuesta | Request de prueba | Sin firma valida ni secretos. |
| Capturas de UI | Admin, checkout PayPal, retorno, recibo, pagos, revision, ajustes | Redactar PII y tokens. |
| Logs/Sentry de staging | Railway / Sentry | Solo ids, monto, moneda y estado. |
| Verificacion de produccion | `/api/health`, `/admin/pagos`, conteos | Solo lectura. |

Capturas minimas: modal del link con montos, checkout/guest, retorno, recibo, hito `PAGADO`,
soporte antes/despues, webhook duplicado, `401`, diferencia en `REVISION`, coexistencia MP/PayPal,
registro manual, reembolso/contracargo y produccion sin datos de prueba.

Regla de redaccion: no incluir `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` completo, tokens completos,
`DATABASE_URL`, email/nombre del pagador ni cuerpo crudo de webhooks. Usar ids internos, sufijos o
valores enmascarados.

---

## 6. Criterio "listo para produccion"

Se considera listo solo si:

1. Los 14 pasos de §4 estan `PASS` o, en guest checkout, `NO APLICA` con justificacion de que PayPal
   no lo ofrecio (AC-28 es condicional). No hay `FAIL` ni `BLOCKED`.
2. La tarifa real fue validada y el snapshot del link/pago coincide; si se ajusto, se regenero el
   link y se confirmo el nuevo total.
3. La idempotencia quedo demostrada: un solo `Pago` y una sola acreditacion de meses ante eventos
   repetidos o simultaneos.
4. La firma invalida/ausente devuelve `401` sin crear `Pago` y el evento tecnico no tiene PII.
5. La diferencia de monto queda en `REVISION` sin marcar hito ni acreditar meses, y el admin ve la
   diferencia.
6. La coexistencia MP/PayPal y la regresion MP estan verdes (AC-13, AC-20).
7. Produccion no fue modificada: mismos conteos/ids de la linea base, sin datos sandbox, sin cambios
   de variables de produccion.
8. La suite automatizada, el typecheck y el build estan limpios; AC-21 cubierto sin llamadas reales
   a PayPal (T-31..T-34).
9. La evidencia de §5 esta completa, redactada y registrada; no hay secretos ni PII.
10. El dueno aprueba explicitamente habilitar PayPal en produccion (PA-11) y el reviewer valida la
    evidencia. Solo entonces se ejecuta T-38.

---

## 7. Rollback (plan §7.5)

### 7.1 Staging (antes de aprobar)

1. Quitar del servicio staging `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
   `PAYPAL_WEBHOOK_ID` (y opcionalmente `PAYPAL_BASE_URL`, `PAYPAL_FEE_BPS`,
   `PAYPAL_FEE_FIXED_CENTS`). Redeploy/restart.
2. Deshabilitar o borrar el webhook sandbox en el panel de PayPal para cortar reintentos.
3. Verificar que PayPal queda no disponible (`503`/deshabilitado en la UI) y que Mercado Pago sigue
   operativo.
4. **No borrar tablas ni datos.** `EnlacePago`, `Pago`, `EventoPasarela` y `AjustePago` se conservan
   (RNF-12). No ejecutar `db push --force-reset` ni drops.

### 7.2 Produccion (despues de T-38)

1. Quitar `PAYPAL_ENV`, credenciales y `PAYPAL_WEBHOOK_ID` del servicio principal. Redeploy/restart.
2. Deshabilitar el webhook de produccion en el panel de PayPal.
3. Confirmar que PayPal queda no disponible, que Mercado Pago y el resto del CRM siguen operativos y
   que no hay errores nuevos en logs/Sentry.
4. La migracion es aditiva: el codigo anterior ignora tablas/columnas nuevas. No hay rollback
   destructivo ni perdida de pagos/links. Si hiciera falta, redeploy del commit anterior, sin borrar
   datos.
5. Si se detecto un cobro duplicado, registrar el reembolso/ajuste manual; no eliminar registros.

### 7.3 Rotacion de secretos

Si un secreto se expone, rotarlo en PayPal, actualizar la variable en Railway y redeployar. No pegar
el valor nuevo en el repo, en la evidencia ni en el chat.

---

## 8. Tareas relacionadas y estado de AC-29

| Tarea | Que hace | Estado |
|---|---|---|
| **T-35** | Documentacion operativa (`.env.example`, `AGENTS.md`, `MEMORY.md`) | Dependencia declarada de T-36; no la ejecuta este documento. |
| **T-36** | Este runbook | Preparado; no ejecuta deploy ni marca tareas. |
| **T-37** | Crea/verifica staging, aplica `db push`/backfill, carga envs sandbox, configura webhook y ejecuta §4 | Pendiente. |
| **T-38** | Rollout a produccion solo tras aprobar §6 | Pendiente. |

**AC-29 queda pendiente** hasta que T-37 ejecute los 14 pasos y la evidencia se registre. T-36 no
cierra AC-29 ni modifica `tasks.md`.

---

## 9. Responsables

| Rol | Responsabilidad |
|---|---|
| **Dueno (Franco)** | Crear la app/cuentas sandbox, proveer y cargar credenciales y webhook, aprobar la tarifa y autorizar produccion (PA-11). |
| **Implementer** | Ejecutar T-37: staging, `db push`/backfill, variables, webhook, checklist y evidencia. No tocar produccion durante T-37. |
| **Tester** | Confirmar AC-21: suite, typecheck y build limpios, sin llamadas reales a PayPal; aportar evidencia de tests. |
| **Reviewer** | Revisar en solo lectura la evidencia, la separacion staging/produccion y la ausencia de PII/secretos. |
| **Planner** | Mantener este runbook y guardar el informe en `review.md` cuando el reviewer lo entregue. |

---

## 10. Registro de ejecucion (plantilla)

| Campo | Valor |
|---|---|
| Fecha | |
| Ejecutor | |
| Entorno | Railway staging: `<servicio>` |
| URL publica | `https://<staging-domain>` |
| Commit | `RAILWAY_GIT_COMMIT_SHA` |
| BD staging | Nombre/fingerprint (sin credenciales) |
| Resultado global | `APROBADO` / `RECHAZADO` / `BLOCKED` |
| Aprobacion del dueno | |
| Evidencia | `specs/001-paypal-pagos/review.md` o registro de T-37 |

| # | Paso | Resultado | Evidencia | Nota |
|---|---|---|---|---|
| 1 | App y cuentas sandbox | | | |
| 2 | Staging con Postgres separado | | | |
| 3 | Webhook sandbox | | | |
| 4 | Link de hito | | | |
| 5 | Tarifa real | | | |
| 6 | Pago invitado, webhook y recibo | | | |
| 7 | Soporte 3 meses | | | |
| 8 | Repeticion idempotente | | | |
| 9 | Firma invalida 401 | | | |
| 10 | Diferencia REVISION | | | |
| 11 | Coexistencia MP/PayPal | | | |
| 12 | Registro manual | | | |
| 13 | Reembolso/contracargo | | | |
| 14 | Produccion intacta y evidencia | | | |
