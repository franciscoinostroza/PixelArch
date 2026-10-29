# Revision 001: Cobros con PayPal — validacion en staging (T-37) y evidencia de AC-29

**Spec:** ./spec.md
**Plan:** ./plan.md
**Runbooks:** ./sandbox.md (checklist §4), ./t-37-staging.md (P-1..P-8)
**Fecha:** 2026-10-29
**Alcance:** revision de solo lectura de la ejecucion de T-37 en Railway staging y de la evidencia de
AC-29. **No** incluye T-38 (rollout a produccion), que no se ejecuto y requiere aprobacion explicita
del dueno.

- **Veredicto:** **PASS CON OBSERVACIONES**
- **Bloqueantes:** ninguno de codigo. Quedan gates operativos: aprobacion del dueno (PA-11 y T-38) y el
  orden de migracion/backfill de produccion antes del merge a `main`/auto-deploy (H-2).
- **Recomendaciones:** conservar el SHA validado (`139b8cb`) con un FF-merge de `paypal-staging`;
  mantener la tolerancia de redondeo ±US$0,01 documentada; resolver el backlog UX/hardening segun
  riesgo, sin bloquear T-38.
- **Conformidad con la spec:** AC-29 validado en staging; no hay AC sin cobertura (los AC no
  re-ejecutados en T-37 tienen test automatizado). T-38 no agrega AC, solo el rollout.

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
| Deploy produccion (baseline) | `554f70d7-4ebd-47db-9812-b831052c9a32`, commit `cdafe04`, branch `main` |
| Health produccion | `/api/health` `ok` |
| Migracion/deploy PayPal en produccion | Ninguno; produccion sigue en `cdafe04` (`main` sin PayPal) y con DB separada |

La validacion final fue en **Railway staging con Postgres separado**, no en local ni ngrok
(RNF-11, PA-11).

---

## 2. Checklist de validacion (sandbox.md §4)

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

Los ids internos (`Pago.id`, `EnlacePago.id`, `EventoPasarela.eventoId`, `AjustePago.id`) y las
capturas de UI (modal del link, checkout/guest, retorno, recibo, hito `PAGADO`, soporte, duplicado,
`401`, `REVISION`, coexistencia, registro manual, ajustes y produccion) quedan archivados con el
registro de ejecucion de T-37. Este informe no transcribe valores internos no verificados.

---

## 4. Hallazgos H-1..H-9

| ID | Severidad | Hallazgo | Estado | Accion / nota |
|---|---|---|---|---|
| **H-1** | Alto | Credenciales y secretos de produccion reutilizados en staging, incluido un token de escritura de Sanity. | **Resuelto** con decisiones del dueno registradas | Se quitaron de staging `RAILWAY_API_TOKEN`, `CRON_SECRET`, `SANITY_REVALIDATE_SECRET` y `SANITY_API_TOKEN` (este era Editor/write); el sitio publico sigue funcionando. Quedan `CLERK_*`, `RESEND_API_KEY` y `SENTRY_AUTH_TOKEN`/`SENTRY_*` como decision explicita del dueno de reutilizar la configuracion existente; staging no recibe clientes reales y los emails de prueba van al dueno. |
| **H-2** | Alto (operativo) | T-38 debe migrar produccion/backfill **antes** del merge a `main`/auto-deploy: `main` no tiene PayPal y el deploy actual es `cdafe04`. | **Abierto** — bloquea T-38, no el codigo | Secuencia obligatoria: `db push` + backfill en produccion → deploy con PayPal deshabilitado → envs/webhook live → smoke. Hacer FF-merge de `paypal-staging` para conservar el SHA validado `139b8cb`; si el merge no es FF o cambia codigo, repetir suite/typecheck/build y revalidar. |
| **H-3** | Medio | Diferencia de US$0,01 por redondeo `ceil` entre la comision de PayPal y la de la app. | **Resuelto** — aprobado por el dueno (PA-11, 2026-10-29) | Tolerancia ±US$0,01 aprobada junto con la tarifa `540`/`30` (PA-11, 2026-10-29) y documentada en `sandbox.md` §6. No se recalculan pagos historicos ni se cambia la tarifa. |
| **H-4** | Medio | Suite, typecheck y build como evidencia de calidad. | **Resuelto** | 79/79 archivos, 1431/1431 tests; `tsc --noEmit` 0 errores; build `PASS` en `139b8cb`. |
| **H-5** | Bajo | La pagina publica muestra "Pago acreditado" cuando el pago esta en `REVISION`. | **Abierto** — backlog UX | Mostrar "en revision" sin exponer datos internos. |
| **H-6** | Bajo | Warnings `Webhook MP con firma invalida` sin origen identificado e IPN vacia durante el paso 11. | **Abierto** — backlog | Investigar secreto/panel de Mercado Pago. No bloquea T-37; produccion no debe apuntar a staging. |
| **H-7** | Bajo | El webhook de PayPal necesita rate limit/hardening. | **Abierto** — backlog hardening | Agregar limite sin romper reintentos legitimos de PayPal. |
| **H-8** | Bajo | Si `NEXT_PUBLIC_URL` es invalida, el retorno cae a `req.url`. | **Abierto** — backlog | Validar la URL y usar un fallback controlado. |
| **H-9** | Bajo | Los scripts `t37-step*.ps1` fueron borrados y `.railway/` no esta en `.gitignore`. | **Abierto** — backlog | Higiene del repo y reproducibilidad de la evidencia; agregar `.railway/` a `.gitignore`. |

---

## 5. Conformidad con la spec (AC)

| AC | Evidencia en T-37 | Resultado |
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
| AC-29 | Checklist 1-14 + produccion intacta y evidencia registrada | `PASS` |
| AC-21 | H-4: 1431/1431 tests, `tsc` 0 errores, build `PASS` | `PASS` |

AC-3, AC-4, AC-12, AC-14, AC-15, AC-17, AC-19, AC-23 y AC-26 no se re-ejecutaron en T-37; siguen
cubiertos por la suite automatizada y por las tareas de implementacion previas (ver el mapa
AC → tareas en `tasks.md`). No hay AC sin cobertura.

---

## 6. Acciones obligatorias antes de T-38

> **Runbook T-38:** [`./t-38-production.md`](./t-38-production.md) — gates, backup/restore, migracion y
> backfill antes del merge, FF-merge, deploy con PayPal deshabilitado, smoke, PayPal live, monitoreo y
> rollback. Es documentacion de planificacion: no autoriza la ejecucion.

1. **PA-11 aprobado por el dueno (2026-10-29):** tarifa `540`/`30` con tolerancia ±US$0,01.
   **T-38 no fue autorizado** en esta sesion: el rollout a produccion queda pendiente y no se ejecuta
   hasta que el dueno lo autorice de forma explicita.
2. **H-2 (orden obligatorio):** aplicar `db push` + backfill en produccion **antes** del merge a
   `main`/auto-deploy. Luego deployar con PayPal deshabilitado, cargar envs/webhook live y hacer el
   smoke test. Nunca mergear primero: `main` no tiene PayPal y el deploy actual es `cdafe04`.
3. **FF-merge de `paypal-staging`** para que `main` reciba el SHA validado `139b8cb`. Si el merge no
   es FF o se agrega codigo, repetir suite/typecheck/build y revalidar la evidencia.
4. **Configuracion de produccion aislada:** credenciales, webhook y URL de produccion (nunca los de
   staging); `PAYPAL_ENV=production`; sin `NEXT_PUBLIC_URL` ni `DATABASE_URL` de staging. Verificar
   que el webhook de produccion no apunte a `staging.pixelarch.dev`.
5. **Cierre formal:** el implementer marca T-37 en `tasks.md` despues del veredicto y de la aprobacion
   del dueno. El planner no modifica `tasks.md`.

---

## 7. Backlog acordado con el dueno

| Item | Origen | Nota |
|---|---|---|
| Recibo imprimible de Mercado Pago | Acuerdo con el dueno | No es AC de T-37; queda pendiente. |
| Investigar firmas MP (`Webhook MP con firma invalida`, IPN vacia) | H-6 | Revisar secreto/panel; no bloqueante. |
| Estado publico "en revision" | H-5 | Evitar "Pago acreditado" en `REVISION`. |
| Rate limit del webhook PayPal | H-7 | Hardening. |
| Fallback de `NEXT_PUBLIC_URL` | H-8 | Validacion/fallback controlado. |
| `.railway/` en `.gitignore` | H-9 | Higiene del repo. |

---

## 8. Produccion intacta, PII y secretos

- Produccion no fue modificada: mismo deploy `554f70d7-4ebd-47db-9812-b831052c9a32`, commit `cdafe04`,
  branch `main`, `/api/health` `ok`; sin migracion, sin deploy PayPal y con DB separada de staging.
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
tiene bloqueantes de revision. PayPal **no** esta habilitado en produccion: **PA-11 quedo aprobado**
(tarifa `540`/`30` con tolerancia ±US$0,01, 2026-10-29), pero **T-38 no fue autorizado** en esta
sesion y sigue pendiente. La habilitacion queda condicionada a la autorizacion explicita de T-38, a la
migracion/backfill de produccion antes del merge, al FF-merge que conserve el SHA validado y al smoke
test de T-38. Los hallazgos H-5..H-9 y el recibo imprimible de MP quedan en backlog.
