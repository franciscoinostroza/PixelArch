# H-6: firmas de Mercado Pago — evidencia y decision de hardening

**Spec:** ./spec.md §5.5 y §7.5 · **Plan:** ./plan.md §2.5
**Fecha:** 2026-10-30
**Rama:** `paypal-staging` · **Gate:** T-38 no autorizado; nada de esto toca produccion.
**Estado:** cerrado con evidencia parcial — URL y secreto correctos; los warnings son POSTs invalidos/ruido sin pago. Queda pendiente el emisor exacto y la fecha/zona de los POSTs (ver §8).

> Este documento no contiene PII, secretos, firmas completas, certificados, credenciales ni payload crudo.
> El valor de `MP_WEBHOOK_SECRET` no se transcribe en ninguna parte; solo se registra su presencia y la
> confirmacion del dueno.

## 1. Alcance y metodo

Se investigaron dos sintomas del paso 11 de T-37 (Coexistencia Mercado Pago / PayPal) en staging:

1. Warnings `Webhook MP con firma invalida` en los logs de staging.
2. Una notificacion IPN vacia, sin pago utilizable.

Metodo:

- Revision de la evidencia de T-37 (`specs/001-paypal-pagos/review.md` §2 paso 11, §3 y §4 H-6).
- Confirmacion del dueno (2026-10-30) sobre la URL de webhook y el secreto de staging.
- Inspeccion de solo lectura del codigo del webhook MP (`src/app/api/webhooks/mercadopago/route.ts`) y
  del SDK `mercadopago` 3.6.1 (`WebhookSignatureValidator`).
- Contraste con los eventos validos de Coexistencia A/B, que si pasaron la firma y se procesaron.
- Revision de los tests del webhook MP y del limitador compartido.

No se roto el secreto, no se desactivo la validacion de firma, no se cambio la URL del webhook y no se
toco el panel de Mercado Pago. No se consultaron credenciales ni se leyeron valores de variables.

## 2. Entorno staging

| Elemento | Valor |
|---|---|
| URL publica de staging | `https://staging.pixelarch.dev` |
| Endpoint de webhook MP | `https://staging.pixelarch.dev/api/webhooks/mercadopago` |
| Evento habilitado | `Pagos` (`payment`) |
| Secreto `MP_WEBHOOK_SECRET` | **Presente y coincidente con el panel**, confirmado por el dueno (2026-10-30). Valor no registrado. |
| Deploy validado | `4c765526-acc7-421f-a62f-2c03745e0891`, commit `139b8cb` (T-37) |
| Cuenta/aplicacion MP | La aplicacion de staging configurada por el dueno; su identificador no se registra en este expediente. |

Conclusion de entorno: la URL que recibe los eventos es la de staging y el secreto en runtime coincide
con el que usa el panel. No hay evidencia de URL de produccion apuntando a staging para el webhook MP en
esta sesion; el aislamiento de produccion se re-verifica en T-38 y no forma parte de este cambio.

## 3. Eventos observados

| # | Hora (log staging) | Evento | Pago asociado | Efecto observado | Clasificacion |
|---|---|---|---|---|---|
| 1 | 08:35 | `Webhook MP con firma invalida` | Ninguno | Sin `Pago`, sin cambio de hito/soporte | POST invalido / ruido |
| 2 | 08:51 | `Webhook MP con firma invalida` | Ninguno | Sin `Pago`, sin cambio de hito/soporte | POST invalido / ruido |
| 3 | Paso 11 | Notificacion "IPN vacia" | Ninguno | Sin cobro; notificacion sin `data.id` utilizable | Ruido / legacy, sin pago |
| 4 | Paso 11 (A) | Evento MP valido de Coexistencia A | Si: MP gana | Link PayPal `INVALIDADO`, un `Pago` | Procesado correctamente |
| 5 | Paso 11 (B) | Evento MP valido de Coexistencia B | Si: PayPal gana | Intento MP descartado, un solo `Pago` | Procesado correctamente |

Notas de lectura:

- La hora es la del registro de staging. La fecha exacta y la zona horaria no estan confirmadas en esta
  evidencia (§8).
- "Sin pago asociado" significa: no se creo un `Pago` para esos POSTs, el hito y el soporte quedaron
  igual y el unico pago del paso 11 es el de los casos A/B.
- El codigo responde `401` a una firma invalida y no escribe eventos de negocio; el warning corresponde a
  ese camino. El detalle de la respuesta HTTP de esos dos POSTs no quedo archivado (§8).
- La IPN vacia es coherente con una notificacion sin `type: "payment"`/`data.id`; con el hardening
  vigente se ignora con `200` antes de la firma.

## 4. Prueba de que URL y secreto funcionan: Coexistencia A/B

| Caso | Resultado en T-37 | Que prueba |
|---|---|---|
| A: MP gana | Link PayPal `INVALIDADO`; un `Pago` MP | La notificacion MP paso la firma y registro el cobro con el secreto de staging. |
| B: PayPal gana | Intento MP descartado; un solo `Pago` | La notificacion MP paso la firma y se proceso como intento descartado, sin duplicar. |

Si la URL o el secreto estuvieran mal, ambos eventos habrian fallado la verificacion y no habrian
producido los efectos de A/B. Por lo tanto, los warnings de las 08:35 y 08:51 **no** son un fallo
sistematico de configuracion del webhook.

## 5. Matriz de entornos

| Entorno | Endpoint MP | Evento | Secreto | Estado en esta spec |
|---|---|---|---|---|
| staging | `https://staging.pixelarch.dev/api/webhooks/mercadopago` | `Pagos` | Presente y coincidente (confirmado por el dueno; sin valor) | Validado con A/B |
| produccion | `https://pixelarch.dev/api/webhooks/mercadopago` (referencia de la app; no re-verificado en esta evidencia) | `Pagos` | Presente; no se lee ni se registra | No se toca; T-38 verifica aislamiento |

No se reconfigura ningun entorno. Produccion sigue operando con su propia URL y su propio secreto; este
expediente no prueba ni cambia su configuracion.

## 6. Verificacion de firma

- SDK: `mercadopago` 3.6.1, `WebhookSignatureValidator.validate({ xSignature, xRequestId, dataId, secret })`.
  Recalcula el HMAC-SHA256 y compara en tiempo constante; no hace llamadas de red.
- Manifest firmado: `id:<dataId>;request-id:<xRequestId>;ts:<ts>;` (omite las partes ausentes).
- `dataId`: se toma de `?data.id=` y, si falta, de `body.data.id`.
- `x-signature`: `ts` + `v1` calculados por MP; `x-request-id` viaja en el header.
- La validacion corre solo cuando el body es JSON, `body.type === "payment"` y hay `dataId`.
- Un fallo de firma devuelve `401` y no consulta `obtenerPagoMp`.
- Reloj: la ruta **no** pasa `toleranceSeconds`, asi que el SDK no aplica una ventana de reloj:
  `ts` solo forma parte del manifest. Un reloj desfasado no explica los warnings (el SDK soporta
  `TimestampOutOfTolerance`, pero no esta habilitado).
- La documentacion del SDK advierte que las notificaciones de QR **no estan firmadas** y siempre fallan la
  validacion. Es una fuente plausible de ruido no-payment; con el hardening se descartan antes de la
  firma si no son `payment` o no traen `data.id`.

## 7. Hipotesis

| ID | Hipotesis | Estado | Evidencia que la discrimina |
|---|---|---|---|
| H6-H1 | Secreto distinto entre el panel y el entorno. | **Rechazada** | El dueno confirmo que coinciden; A/B pasaron la firma y procesaron el cobro. |
| H6-H2 | Notificacion de otra cuenta/aplicacion de MP. | **No determinada** | Una firma invalida y sin pago es compatible, pero no se conservo el origen ni un identificador de la aplicacion; no se puede afirmar sin logs. |
| H6-H3 | Notificacion de la funcion "Probar" del panel con firma invalida. | **No determinada** | No hay registro del evento de prueba en la evidencia; el panel de MP no se reviso en esta sesion. |
| H6-H4 | IPN legacy/vacia de una integracion anterior. | **Parcial** | La IPN vacia existe y no tiene pago; es coherente con el ruido, pero no se puede atribuir a los dos warnings sin sus logs. |
| H6-H5 | Diferencia de algoritmo/SDK en la construccion de la firma. | **Rechazada** | La app usa el validador oficial del SDK 3.6.1 y A/B verificaron con el mismo codigo. |
| H6-H6 | Reloj fuera de ventana. | **Rechazada** | La ruta no pasa `toleranceSeconds`; el SDK no aplica ventana de reloj y A/B verificaron en la misma ejecucion. |
| H6-H7 | El `data.id` usado en la validacion no coincide con el que MP firmo (query vs body). | **No determinada** | El manifest incluye `id:<dataId>`; un id distinto produciria `SignatureMismatch`. No se conservaron los dos POSTs para comparar query y body. |
| H6-H8 | Notificacion no firmada por diseno (QR/legacy) que el SDK rechaza siempre. | **Parcial** | El SDK documenta que las notificaciones QR no estan firmadas; el hardening las descarta antes de la firma si no son `payment`. No se conservo el tipo exacto de los dos POSTs. |

## 8. Decision y datos faltantes

Decision (aprobada por el dueno, 2026-10-30):

1. **No rotar el secreto, no cambiar la URL y no tocar el panel.** La evidencia muestra que la
   configuracion de staging es correcta.
2. **Hardening del webhook MP** (implementado en `src/app/api/webhooks/mercadopago/route.ts`):
   - limite de 300 solicitudes/min por origen (`429` + `Retry-After` + `no-store`, antes de parsear);
   - presupuesto de 20 firmas invalidas/10 min por origen (`429` antes de validar; una firma valida lo
     limpia; no afecta a otros origenes);
   - descarte de `body.type !== "payment"` o sin `data.id` antes de la firma (`200` ignorado), lo que
     cubre topics de plan/merchant order y la IPN vacia;
   - log de firma invalida en `debug`, sin `data.id`, firma, IP, payload crudo ni PII.
3. **Tratar los warnings de 08:35 y 08:51 como POSTs invalidos/ruido**, no como fallos de pago. Si en el
   futuro un evento `payment` firmado falla o un cobro real queda sin registrar, se reabre H-6 con el
   `paymentId` y la evidencia del panel.

Datos faltantes (no bloqueantes, para trazabilidad completa):

- Fecha exacta y zona horaria de los POSTs de 08:35 y 08:51 (la evidencia conserva solo la hora del log).
- Emisor probable: funcion "Probar" del panel, escaneo externo u otra integracion; si la IPN vacia tenia
  su propia URL configurada.
- Respuesta HTTP archivada de esos dos POSTs (si existe en los logs retenidos de staging).

## 9. Anexo: fuentes y comandos

Fuentes revisadas (solo lectura):

- `specs/001-paypal-pagos/review.md` §2 (paso 11), §3 y §4 (H-6).
- `specs/001-paypal-pagos/t-37-staging.md` §2.3 (webhook MP de staging y coincidencia del secreto).
- `src/app/api/webhooks/mercadopago/route.ts`.
- `src/lib/rate-limit.ts`.
- `src/__tests__/api/webhooks/mercadopago.test.ts`.
- `src/__tests__/lib/rate-limit.test.ts`.

Verificacion local sugerida (sin red, sin base; la ejecucion y el veredicto quedan para tester/reviewer):

```
node node_modules\vitest\vitest.mjs run src/__tests__/api/webhooks/mercadopago.test.ts src/__tests__/lib/rate-limit.test.ts
```

No se ejecutaron comandos contra el panel de Mercado Pago, ni `railway variables`, ni consultas que
pudieran exponer el secreto. No se transcriben ids internos de pago, tokens ni URLs con credenciales.
