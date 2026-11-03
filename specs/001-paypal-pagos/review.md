# Revision 001: Cobros con PayPal — validacion en staging (T-37) y rollout a produccion (T-38)

**Spec:** ./spec.md
**Plan:** ./plan.md
**Runbooks:** ./sandbox.md (checklist §4), ./t-37-staging.md (P-1..P-8), ./t-38-production.md
**Fecha:** 2026-10-29 (T-37) · 2026-11-03 (cierre T-38)
**Alcance:** revision de solo lectura de la ejecucion de T-37 en Railway staging y del cierre operativo de
T-38 en produccion. Describe la evidencia reportada por el coordinador; no re-ejecuta pagos ni modifica
produccion.

- **Veredicto:** **PASS CON OBSERVACIONES** en T-37 y **PASS CON OBSERVACION** en T-38.
- **Bloqueantes:** ninguno de codigo.
- **Observacion T-38:** no se ejecuto un pago real de smoke por decision del dueno (ver §10). La
  validacion end-to-end live del webhook (firma real, captura, recibo y hito pagado) queda como riesgo
  residual para el primer cobro real.
- **Recomendaciones:** monitorear con prioridad el primer pago live; completar la evidencia documental
  de los gates no reportados (backup/restore, freeze y revalidacion de `de64b50`) si el dueno la
  requiere; mantener la tolerancia de redondeo ±US$0,01 y resolver el backlog UX/hardening segun riesgo.
- **Conformidad con la spec:** AC-29 validado en staging (T-37); no hay AC sin cobertura. T-38 no agrega
  AC: cierra el gate operativo de produccion y confirma que MP/CRM no se rompieron.

---

## 1. Entorno, commit y baseline

| Elemento | Valor verificado |
|---|---|
| Proyecto Railway | `PixelArch-Plataforma` `1f0ad07e-c893-42f9-a152-13559641b7b9` |
| Entorno staging | `57936b79-5d77-4408-92b3-8d1b69f40647` |
| Servicio web staging | `3aab4a6e-3f35-42df-a604-256f5b635a0a` |
| Postgres staging | `Postgres-gdmt` (servicio y BD separados de produccion) |
| URL publica staging | `https://staging.pixelarch.dev` |
| Deploy staging final | `4c765526-acc7-421f-a62f-2c03745e0891` |
| Commit staging | `139b8cb` (`test: ajustar validación de envs PayPal`) |
| Health staging | `ok` |
| Variables staging | 28 |
| Deploy produccion (baseline T-37) | `554f70d7-4ebd-47db-9812-b831052c9a32`, commit `cdafe04`, branch `main` |
| Health produccion | `/api/health` `ok` |
| Migracion/deploy PayPal en produccion (T-37) | Ninguno; produccion seguia en `cdafe04` (`main` sin PayPal) y con DB separada |
| Produccion post-T-38 (2026-11-03) | Deploy `f1185f76`, commit `de64b50`, health `ok`; `db push` + backfill (`UPDATE 0`); PayPal Live; evidencia §10 |

La validacion de T-37 fue en **Railway staging con Postgres separado**, no en local ni ngrok
(RNF-11, PA-11). T-38 se ejecuto en **Railway produccion**; la evidencia reportada esta en §10.

---

## 2. Checklist de validacion T-37 (sandbox.md §4)

| # | Paso | Resultado | Evidencia / nota |
|---|---|---|---|
| 1 | App y cuentas sandbox | `PASS` | Credenciales sandbox cargadas; cuentas business/personal; PayPal disponible en staging. |
| 2 | Railway staging con Postgres separado | `PASS` | `Postgres-gdmt`; DB distinta de produccion; esquema nuevo aplicado solo en staging. |
| 3 | Webhook sandbox | `PASS` | Webhook contra `https://staging.pixelarch.dev/api/webhooks/paypal` con los 7 eventos de §2.3; `PAYPAL_WEBHOOK_ID` coincidente. |
| 4 | Link para un hito de prueba | `PASS` | Hito de US$100,50: comision US$6,06 y total US$106,56; link unico/reutilizado; hito `PENDIENTE`; sin `Pago`. |
| 5 | Tarifa real | **`PASS` con limitacion (H-3)** | PayPal informo comision US$6,05 y neto US$100,51; la app calculo US$6,06 por `ceil`. Diferencia US$0,01; total US$106,56 correcto. No se cambia `540`/`30`; tolerancia documentada en `sandbox.md` §6. |
| 6 | Pago invitado, webhook, recibo y hito `PAGADO` | `PASS` | Pago confirmado con un solo `Pago`, hito `PAGADO` y recibo con desglose; datos del cliente del CRM, sin PII del pagador. |
| 7 | Soporte de 3 meses | `PASS` | `Pago.meses=3`; acreditacion unica y `proximoPago` actualizado con la regla de Mercado Pago. |
| 8 | Repeticion idempotente | `PASS` | Evento repetido con firma valida: `DUPLICADO`; sin segundo `Pago` ni doble acreditacion. |
| 9 | Firma invalida o ausente: `401` | `PASS` | Status `401`; `EventoPasarela` tecnico (`FIRMA_INVALIDA`) sin PII; sin `Pago` ni cambio de estado. |
| 10 | Diferencia de monto: `REVISION` | `PASS` | Revision C: link de US$10, orden creada por API por US$5; `Pago` en `REVISION`, monto US$5,00, esperado US$10,89; hito `PENDIENTE`. |
| 11 | Coexistencia Mercado Pago / PayPal | **`PASS` con observacion (H-6)** | A: MP gana y el link PayPal queda `INVALIDADO`; B: PayPal gana, intento MP descartado y un solo `Pago`. Quedan warnings `Webhook MP con firma invalida` sin origen identificado e IPN vacia; no bloqueante, a investigar. |
| 12 | Registro manual y no duplicacion | `PASS` | Manual D de US$10; orden PayPal `8FM72438B8399124S`, capture `3EK70639MX6995506`; `Pago` con `origen=MANUAL` y hito `PAGADO`. Webhook temporal desactivado, luego restaurado y evento reenviado sin duplicar. El Event log de PayPal quedo `Pending` por demora de UI; la app proceso. |
| 13 | Reembolso y contracargo manual | `PASS` | Reembolso de US$1 con decision `NINGUNA` → `Pago` `REFUNDED`; contracargo de soporte con `DESCONTAR_MESES` 3 → vencimiento 28/11/2026 y `Pago` `CONTRACARGO`; recibos conservados. |
| 14 | Produccion intacta y evidencia final | **`PASS` con observaciones** | Produccion sin cambios: deploy `554f70d7-4ebd-47db-9812-b831052c9a32`, commit `cdafe04`, health `ok`, sin migracion ni deploy PayPal, DB separada y sin datos sandbox. H-1 resuelto (ver §4). |

Resumen: 14/14 `PASS`; los pasos 5 y 14 quedan marcados como **PASS con limitacion/observacion** y el
paso 11 como **PASS con observacion**. Ningun `FAIL` ni `BLOCKED`.

---

## 3. Evidencia y referencias verificadas

| Evidencia | Valor |
|---|---|
| Infraestructura | Proyecto `1f0ad07e-c893-42f9-a152-13559641b7b9`; entorno staging `57936b79-5d77-4408-92b3-8d1b69f40647`; servicio `3aab4a6e-3f35-42df-a604-256f5b635a0a`; Postgres `Postgres-gdmt` |
| Deploy staging | `4c765526-acc7-421f-a62f-2c03745e0891`, commit `139b8cb`, health `ok`, 28 variables |
| Baseline de produccion | `554f70d7-4ebd-47db-9812-b831052c9a32`, commit `cdafe04`, branch `main`, `/api/health` `ok` |
| Link y desglose (paso 4) | Acordado US$100,50 (`10050`), comision US$6,06 (`606`), total US$106,56 (`10656`); snapshot de tarifa `540`/`30` |
| Tarifa real (paso 5) | PayPal: comision US$6,05 y neto US$100,51; app: comision US$6,06; diferencia US$0,01; total sin cambios |
| Diferencia (paso 10) | Revision C, link US$10; orden API US$5; `Pago` `REVISION`; monto US$5,00; esperado US$10,89; hito `PENDIENTE` |
| Registro manual (paso 12) | Orden `8FM72438B8399124S`; capture `3EK70639MX6995506`; `origen=MANUAL`; hito `PAGADO`; evento posterior sin duplicado |
| Ajustes (paso 13) | Reembolso US$1 (`NINGUNA`, `REFUNDED`); contracargo de soporte (`DESCONTAR_MESES` 3, vencimiento 28/11/2026, `CONTRACARGO`); recibos conservados |
| Coexistencia (paso 11) | Caso A: MP gana, PayPal `INVALIDADO`; caso B: PayPal gana, intento MP descartado, un solo `Pago` |
| Produccion post-T-38 | Deploy `f1185f76`, commit `de64b50`, health `ok`; `db push` + backfill (`UPDATE 0`) |
| PayPal Live (T-38) | 33 variables cargadas; webhook `https://pixelarch.dev/api/webhooks/paypal`; sin valores de secretos |
| Preflight webhook T-38 | `401` sin firma |
| Smoke real T-38 | **No ejecutado** por decision del dueno (G7); riesgo residual en §10 |

Los ids internos (`Pago.id`, `EnlacePago.id`, `EventoPasarela.eventoId`, `AjustePago.id`) y las
capturas de UI (modal del link, checkout/guest, retorno, recibo, hito `PAGADO`, soporte, duplicado,
`401`, `REVISION`, coexistencia, registro manual, ajustes y produccion) quedan archivados con el
registro de ejecucion de T-37. La evidencia de T-38 (§10) no incluye capturas ni valores de secretos.
Este informe no transcribe valores internos no verificados.

---

## 4. Hallazgos H-1..H-9

| ID | Severidad | Hallazgo | Estado | Accion / nota |
|---|---|---|---|---|
| **H-1** | Alto | Credenciales y secretos de produccion reutilizados en staging, incluido un token de escritura de Sanity. | **Resuelto** con decisiones del dueno registradas | Se quitaron de staging `RAILWAY_API_TOKEN`, `CRON_SECRET`, `SANITY_REVALIDATE_SECRET` y `SANITY_API_TOKEN` (este era Editor/write); el sitio publico sigue funcionando. Quedan `CLERK_*`, `RESEND_API_KEY` y `SENTRY_AUTH_TOKEN`/`SENTRY_*` como decision explicita del dueno de reutilizar la configuracion existente; staging no recibe clientes reales y los emails de prueba van al dueno. |
| **H-2** | Alto (operativo) | T-38 debe migrar produccion/backfill **antes** del merge a `main`/auto-deploy: `main` no tiene PayPal y el deploy actual es `cdafe04`. | **Cerrado por T-38 (2026-11-03)** — con evidencia documental parcial | Produccion quedo con el esquema PayPal aplicado, el backfill ejecutado (`UPDATE 0`) y el deploy `f1185f76` en `de64b50` operativo. La evidencia recibida no detalla el orden exacto ni el backup/restore previo; el resultado no muestra perdida de datos ni 500 en admin/MP. |
| **H-3** | Medio | Diferencia de US$0,01 por redondeo `ceil` entre la comision de PayPal y la de la app. | **Resuelto** — aprobado por el dueno (PA-11, 2026-10-29) | Tolerancia ±US$0,01 aprobada junto con la tarifa `540`/`30` (PA-11, 2026-10-29) y documentada en `sandbox.md` §6. No se recalculan pagos historicos ni se cambia la tarifa. |
| **H-4** | Medio | Suite, typecheck y build como evidencia de calidad. | **Resuelto en staging; no reportado para `de64b50`** | 79/79 archivos, 1431/1431 tests; `tsc --noEmit` 0 errores; build `PASS` en `139b8cb`. No se reporta suite/typecheck/lint/build sobre el commit de produccion `de64b50`; `[NECESITA ACLARACION]` si el merge introdujo cambios de codigo (ver §11). |
| **H-5** | Bajo | La pagina publica muestra "Pago acreditado" cuando el pago esta en `REVISION`. | **Implementado en spec 003** — smoke manual T-09 pendiente | Mostrar "en revision" sin exponer datos internos; ver `specs/003-hardening-paypal/tasks.md` (T-03). |
| **H-6** | Bajo | Warnings `Webhook MP con firma invalida` sin origen identificado e IPN vacia durante el paso 11. | **Evidencia + hardening en spec 003** — smoke manual T-09 pendiente | Warnings clasificados como ruido sin pago; no se rota el secreto ni se toca el panel. Ver `h6-mp-firmas.md` y T-05/T-06 de 003. |
| **H-7** | Bajo | El webhook de PayPal necesita rate limit/hardening. | **Implementado en spec 003** | Limite 300/min y 20 fallos/10 min, cuerpo maximo 256 KiB; ver T-04 de 003. |
| **H-8** | Bajo | Si `NEXT_PUBLIC_URL` es invalida, el retorno cae a `req.url`. | **Implementado en spec 003** | Redireccion relativa y fallo cerrado sin base valida; ver T-02 de 003. |
| **H-9** | Bajo | Los scripts `t37-step*.ps1` fueron borrados y `.railway/` no esta en `.gitignore`. | **Implementado en spec 003** | `.railway/` ignorado y sin archivos versionados; ver T-01 de 003. |

El detalle y la validacion manual de H-5..H-9 viven en `specs/003-hardening-paypal/tasks.md`; T-09 (smoke
manual de staging) sigue pendiente y no bloqueo T-38.

---

## 5. Conformidad con la spec (AC)

| AC | Evidencia (T-37 / T-38) | Resultado |
|---|---|---|
| AC-1, AC-2 | Paso 4: link unico, reutilizacion, hito `PENDIENTE` y montos `10050`/`606`/`10656` | `PASS` |
| AC-5, AC-8, AC-9 | Pasos 6-8: pago confirmado, hito `PAGADO`, 3 meses y evento repetido `DUPLICADO` | `PASS` |
| AC-6 | Paso 8: un solo `Pago` y una sola acreditacion | `PASS` |
| AC-7 | Paso 9: `401`, evento tecnico sin PII y sin `Pago` | `PASS` |
| AC-10, AC-18, AC-24 | Pasos 4-6: centavos USD, desglose y recibo con monto acordado/comision/total | `PASS` (H-3) |
| AC-11 | Pasos 10 y 14: vista `/admin/pagos` con pago en `REVISION` y produccion sin datos de prueba | `PASS` |
| AC-13, AC-20 | Paso 11: MP gana/PayPal gana, link hermano invalidado, un solo `Pago` y MP operativo | `PASS` (H-6) |
| AC-16 | P-5/P-6: PayPal deshabilitado sin envs y disponible con sandbox; MP sigue operativo | `PASS` |
| AC-22 | Paso 13: `REFUNDED`/`CONTRACARGO`, decision manual y recibos conservados | `PASS` |
| AC-25 | Paso 12: registro manual, un solo `Pago` y webhook posterior sin duplicar | `PASS` |
| AC-27 | Paso 10: `REVISION`, hito `PENDIENTE`, diferencia visible | `PASS` |
| AC-28 | Paso 6: pago invitado | `PASS` |
| AC-29 | T-37: checklist 1-14 + produccion intacta y evidencia registrada. T-38: deploy `f1185f76`, health, `db push` + backfill, webhook `401`, admin/MP; **sin pago real** por decision del dueno | `PASS` en staging; `PASS` con observacion en produccion |
| AC-21 | H-4: 1431/1431 tests, `tsc` 0 errores, build `PASS` en `139b8cb` | `PASS` en staging; no reportado para `de64b50` |

T-38 no re-ejecuta los AC funcionales: aporta evidencia operativa de AC-29/AC-16/AC-7 y de regresion
MP/CRM (AC-13, AC-20). AC-28 no se re-prueba en produccion; sigue validado en staging (T-37).

AC-3, AC-4, AC-12, AC-14, AC-15, AC-17, AC-19, AC-23 y AC-26 no se re-ejecutaron en T-37; siguen
cubiertos por la suite automatizada y por las tareas de implementacion previas (ver el mapa
AC → tareas en `tasks.md`). No hay AC sin cobertura.

---

## 6. Acciones previas a T-38 y estado al cierre

> **Runbook T-38:** [`./t-38-production.md`](./t-38-production.md) — gates, backup/restore, migracion y
> backfill antes del merge, FF-merge, deploy con PayPal deshabilitado, smoke, PayPal live, monitoreo y
> rollback.
>
> **Estado 2026-11-03:** T-38 fue autorizado y ejecutado; cerro en **PASS con observacion** (§10). Las
> acciones 1-4 se cumplieron en la medida reportada; el smoke real de G7 no se ejecuto por decision del
> dueno.

1. **PA-11 aprobado por el dueno (2026-10-29):** tarifa `540`/`30` con tolerancia ±US$0,01.
   **T-38 no fue autorizado en la sesion de T-37**; se ejecuto despues, el 2026-11-03 (§10).
2. **H-2 (orden obligatorio):** aplicar `db push` + backfill en produccion **antes** del merge a
   `main`/auto-deploy. Luego deployar con PayPal deshabilitado, cargar envs/webhook live y hacer el
   smoke test. El resultado reportado de T-38 es consistente: esquema/backfill aplicados, deploy
   `f1185f76` y admin/MP operativos; la evidencia no detalla el orden exacto.
3. **FF-merge de `paypal-staging`** para que `main` reciba el SHA validado `139b8cb`. Si el merge no
   es FF o se agrega codigo, repetir suite/typecheck/build y revalidar la evidencia. El commit de
   produccion reportado es `de64b50`, no `139b8cb`; ver §10.3 y §11.
4. **Configuracion de produccion aislada:** credenciales, webhook y URL de produccion (nunca los de
   staging); `PAYPAL_ENV=production`; sin `NEXT_PUBLIC_URL` ni `DATABASE_URL` de staging. Reportado en
   T-38: PayPal Live con 33 variables y webhook `https://pixelarch.dev/api/webhooks/paypal`; sin
   valores de secretos en este informe.
5. **Cierre formal:** T-37 y T-38 quedan marcadas `[x]` en `tasks.md` con la evidencia y observaciones
   de este informe. El planner no modifica codigo ni configuracion fuera de `specs/`.

---

## 7. Backlog acordado con el dueno (al cierre de T-37) y estado posterior

| Item | Origen | Estado posterior |
|---|---|---|
| Recibo imprimible de Mercado Pago | Acuerdo con el dueno | Implementado en `specs/002-recibo-mp`; rollout con T-38. |
| Investigar firmas MP (`Webhook MP con firma invalida`, IPN vacia) | H-6 | Atendido en `specs/003-hardening-paypal` (expediente + hardening); validacion manual T-09 pendiente. |
| Estado publico "en revision" | H-5 | Implementado en 003 (T-03); T-09 pendiente. |
| Rate limit del webhook PayPal | H-7 | Implementado en 003 (T-04). |
| Fallback de `NEXT_PUBLIC_URL` | H-8 | Implementado en 003 (T-02). |
| `.railway/` en `.gitignore` | H-9 | Implementado en 003 (T-01). |

Queda como deuda no bloqueante el smoke manual de staging de 003 (T-09) y la evidencia documental de
T-38 listada en §10.3/§11.

---

## 8. Produccion, PII y secretos

- **En T-37:** produccion no fue modificada: mismo deploy `554f70d7-4ebd-47db-9812-b831052c9a32`,
  commit `cdafe04`, branch `main`, `/api/health` `ok`; sin migracion, sin deploy PayPal y con DB
  separada de staging.
- **En T-38 (2026-11-03):** produccion fue actualizada: deploy `f1185f76`, commit `de64b50`,
  `db push` + backfill (`UPDATE 0`), PayPal Live (33 variables) y webhook `401` sin firma; admin/MP
  operativos. Sin borrado de datos. Evidencia en §10.
- No hay datos sandbox en produccion ni datos de produccion en staging. Staging uso un unico cliente
  de prueba con el email del dueno.
- Este informe no contiene `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` completo, `client_id`,
  `DATABASE_URL`, tokens, cookies, email/nombre del pagador ni payload crudo de webhooks. Solo incluye
  ids de infraestructura, referencias sandbox de PayPal y montos.
- Las capturas se archivan redactadas, sin PII del pagador ni secretos.
- El reviewer confirma que la evidencia revisada no expone PII ni secretos.
- H-1 dejo registrada la decision del dueno de reutilizar Clerk, Resend y Sentry; no se reutilizan
  credenciales de Mercado Pago ni de PayPal de produccion, y se quitaron los tokens de escritura,
  cron/revalidacion y control de deploys.

---

## 9. Conclusion

T-37 cumple AC-29 en staging: checklist 1-14 `PASS`, con la limitacion de redondeo del paso 5
(US$0,01, tolerancia ±US$0,01 aprobada con la tarifa `540`/`30` en PA-11 el 2026-10-29), la observacion
de firmas MP del paso 11 (H-6) y las observaciones del paso 14. El codigo validado (`139b8cb`) no
tiene bloqueantes de revision.

T-38 cerro el rollout a produccion en **PASS con observacion**: deploy `f1185f76` en `de64b50`, health
`ok`, `db push` + backfill (`UPDATE 0`), PayPal Live cargado (33 variables), webhook
`https://pixelarch.dev/api/webhooks/paypal` con `401` sin firma y admin/Mercado Pago operativos. **No se
ejecuto un pago real de smoke por decision del dueno**, por lo que el camino live de captura, webhook y
recibo queda como riesgo residual: el primer cobro real debe monitorearse con prioridad. El rollback
definido (quitar envs PayPal + deshabilitar webhook + redeploy) no borra datos ni revierte el esquema
aditivo. H-5..H-9 y el recibo imprimible de MP se rigen por sus propias specs (002/003) y no bloquean el
cierre de 001.

---

## 10. T-38 — Rollout a produccion (cierre 2026-11-03)

### 10.1 Veredicto y alcance

**PASS CON OBSERVACION.** T-38 se ejecuto con autorizacion del dueno y produccion quedo con PayPal Live
habilitado, el esquema aditivo aplicado y Mercado Pago operativo. **No se ejecuto un pago real de smoke**
por decision del dueno: la evidencia no incluye un cobro live de punta a punta.

T-38 no agrega AC ni tests automatizados. AC-29 sigue validado en staging (T-37); T-38 cierra el gate
operativo y verifica que el rollout no rompio el CRM ni MP.

### 10.2 Evidencia reportada

| Elemento | Valor |
|---|---|
| Deploy de produccion | `f1185f76` |
| Commit desplegado | `de64b50` |
| Health | `/api/health` `ok` |
| Esquema | `prisma db push` aplicado en produccion |
| Backfill | Ejecutado; `UPDATE 0` (sin filas a migrar) |
| PayPal Live | Cargado (33 variables); credenciales de produccion |
| Webhook Live | `https://pixelarch.dev/api/webhooks/paypal` |
| Preflight sin firma | `401` |
| Admin | Operativo |
| Mercado Pago | Operativo; sin regresiones reportadas |
| Pago real de smoke | **No ejecutado** por decision del dueno (G7) |
| Borrado de datos | Ninguno; esquema aditivo y rollback sin borrado |

### 10.3 Observaciones y riesgo residual

1. **Sin pago real:** no se valido en produccion una captura live, la firma de un webhook real, el
   recibo emitido ni el hito/soporte actualizado por un pago PayPal. El primer cobro real sera la
   primera validacion end-to-end; monitorearlo con prioridad (webhook `200`, un solo `Pago`, hito
   `PAGADO`, recibo, sin duplicado).
2. **`401` no prueba el id del webhook:** el preflight demuestra que la config esta completa, no que
   `PAYPAL_WEBHOOK_ID` coincida con el webhook Live. Esa coincidencia se verifica con la entrega real
   del primer pago (o con una prueba del panel que no cree un pago).
3. **Commit `de64b50` != `139b8cb`:** no se reporta si el merge fue FF ni la revalidacion de
   suite/typecheck/lint/build sobre `de64b50`. `[NECESITA ACLARACION]` si el merge introdujo cambios de
   codigo; si fue asi, corresponde repetir la evidencia de calidad.
4. **Gates documentales no reportados:** backup/restore de produccion (G3), freeze (G2) y conteos
   pre/post no vienen en la evidencia recibida. El resultado operativo es consistente, pero el
   expediente de T-38 queda incompleto para auditoria.
5. **T-09 (003) pendiente:** el smoke manual de staging de H-5/H-6/H-7/H-9 no se ejecuto; no bloqueo el
   rollout, pero queda como deuda de validacion manual.

### 10.4 Rollback

Definido y **no ejecutado**:

1. Quitar las envs PayPal de produccion.
2. Deshabilitar el webhook PayPal Live en el panel.
3. Redeploy del servicio.
4. Verificar health, admin y MP; el webhook queda `503` (PayPal deshabilitado), no `404`/`500`.

No se borran datos ni se revierte el esquema (aditivo). No se vuelve a `cdafe04` si ya existen pagos con
enums nuevos; el codigo nuevo se mantiene con PayPal deshabilitado.

### 10.5 Conclusion T-38

Produccion quedo con PayPal Live operativo y sin regresiones reportadas de admin/MP. El rollout cumple
el objetivo operativo, pero la ausencia de un pago real de smoke deja sin validar el camino live de
captura/webhook/recibo. Se cierra como **PASS con observacion** y con el riesgo residual del primer
cobro real explicitamente aceptado por el dueno.

---

## 11. Preguntas abiertas

1. `[NECESITA ACLARACION]` **Commit de produccion:** `de64b50` difiere del SHA validado en staging
   (`139b8cb`). Confirmar si el merge fue FF y si hubo cambios de codigo; si los hubo, adjuntar
   suite/typecheck/lint/build sobre `de64b50`.
2. `[NECESITA ACLARACION]` **Gates documentales:** confirmar si existen backup/restore de produccion
   (G3), ventana/freeze (G2) y conteos pre/post de T-38, y donde se archivan.
3. `[NECESITA ACLARACION]` **Smoke live:** se mantiene la decision de no ejecutar un pago PayPal real de
   bajo monto, o se autoriza una prueba posterior con monto, pagador y plan de limpieza (G7)?
