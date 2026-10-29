# Spec 002: Recibo interno imprimible de pagos de Mercado Pago

**Estado:** aprobada
**Aprobacion:** 2026-10-29 — decisiones D-1 a D-10 cerradas con los defaults recomendados (D-1a).
**Fecha:** 2026-10-29
**Rama de implementacion:** `paypal-staging` (D-8).
**Relacionada con:** `specs/001-paypal-pagos/spec.md` (recibo PayPal), `specs/constitution.md` §1, §2, §3, §4 y §5; backlog abierto del 2026-10-29.

## 1. Contexto y objetivo

### 1.1 Situacion actual

> En esta spec, "MP" es Mercado Pago.

- El CRM registra los pagos de Mercado Pago con `pasarela=MERCADOPAGO` y `metodo=MERCADOPAGO`. El webhook los crea con `origen=AUTOMATICO`, `moneda=ars`, `comision=0`, `montoAcordado=monto` y `externalId` igual al payment id de Mercado Pago. El alta manual desde el admin los crea con `origen=MANUAL`, moneda ARS o USD, y no guarda `externalId`.
- El webhook de Mercado Pago registra `SUCCEEDED` para pagos aprobados y `FAILED` para rechazados o cancelados. Hoy el flujo de Mercado Pago no produce `REVISION`, `REFUNDED` ni `CONTRACARGO`.
- El recibo imprimible existente vive en `/admin/pagos/[id]/recibo`. Es de uso interno, exige staff autenticado y hoy solo acepta pagos con `pasarela=PAYPAL`, `reciboId` emitido y referencia externa. Muestra datos del cliente del CRM y no muestra datos del pagador, de la tarjeta ni fiscales.
- Los pagos de Mercado Pago no tienen `reciboId` ni `reciboEmitidoEn`: esos campos se generan solo en el flujo PayPal.
- El email `sendPaymentReceipt` se envia al cliente cuando un pago de Mercado Pago se confirma por webhook o cuando el admin activa "Enviar recibo por email" en el alta manual. Es un texto plano con nombre, monto, moneda y concepto; no incluye numero de recibo, enlace ni PDF.
- El historial `/admin/pagos` y el detalle del cliente muestran "Ver recibo" solo para pagos PayPal elegibles. Para los pagos de Mercado Pago muestran "—".
- El esquema que agrega `pasarela`, `EnlacePago` y `reciboId` esta validado en staging, pero produccion todavia no esta migrada (T-38 pendiente).

### 1.2 Problema

El cliente que paga por Mercado Pago recibe un email de recibo, pero el staff no tiene un recibo visual uniforme para imprimir, archivar o responder consultas. El recibo PayPal ya resolvio esa necesidad; la ausencia del equivalente para Mercado Pago obliga a reconstruir la informacion desde el historial o a reenviar el email, con riesgo de errores, de mezclar datos y de perder trazabilidad.

### 1.3 Objetivo

Extender el recibo interno imprimible a los pagos de Mercado Pago, con los mismos permisos, formato y garantias de privacidad que el recibo PayPal, sin cambiar el flujo de cobro, los montos, los estados ni el email existente.

### 1.4 Resultado esperado

- El staff puede abrir e imprimir un recibo interno para un pago de Mercado Pago elegible (confirmado, en revision, reembolsado o con contracargo), con la misma identidad visual y los mismos permisos que el recibo PayPal.
- El recibo muestra cliente del CRM, concepto, monto y moneda, fecha, estado, referencia de Mercado Pago y vinculo al hito o al soporte, sin datos del pagador ni de tarjeta.
- Los pagos de Mercado Pago historicos con referencia externa tambien pueden mostrar recibo.
- El enlace "Ver recibo" aparece en `/admin/pagos` y en el detalle del cliente para los pagos de Mercado Pago elegibles.
- Un pago fallido o pendiente no genera recibo y sigue visible en el historial con su estado.
- Un pago reembolsado, con contracargo o en revision muestra su estado real en el recibo, nunca "Pagado".
- El recibo PayPal, el webhook de Mercado Pago, los links, los montos y el email existente no cambian.

### 1.5 Decisiones fijas (constitucion)

- El acceso al CRM esta restringido a admin y asistente mediante Clerk; no hay portal publico de clientes.
- Solo se muestran los datos del cliente del CRM imprescindibles para el recibo. No se muestran datos del pagador de Mercado Pago, de tarjetas, de cuentas de la pasarela ni datos fiscales.
- Los montos se guardan en centavos y se formatean con `formatearMonto`; ARS y USD se muestran por separado.
- El recibo es interno y no reemplaza a una factura fiscal.
- No se registran secretos ni PII en logs, analitica ni emails internos.
- Cada criterio de aceptacion tiene al menos un test automatizado.
- TypeScript estricto, lint, typecheck y build limpios antes de dar la tarea por terminada.
- Esta spec no requiere cambios de esquema Prisma ni backfill: el identificador del recibo de Mercado Pago se deriva en tiempo de lectura (D-1a). Cualquier cambio de esquema futuro se sincronizaria con `db push` y se documentaria en el plan.

### 1.6 Supuestos y dependencias

- El recibo es una vista de solo lectura: no registra pagos, no cambia estados, no reenvia emails y no consulta la API de Mercado Pago.
- Mercado Pago sigue siendo la pasarela principal para ARS. El alta manual de un pago de Mercado Pago puede ser en ARS o en USD, pero el alta manual actual no guarda `externalId`; por D-2 esos pagos no generan recibo. Un pago de Mercado Pago en USD con referencia externa (dato historico o futuro) sigue la regla de moneda de RF-12.
- Los pagos de Mercado Pago historicos con referencia externa deben poder mostrar recibo.
- La funcionalidad se apoya en el esquema que ya incluye `pasarela`, `EnlacePago` y `reciboId`. No agrega columnas, migraciones ni backfill. Si produccion no esta migrada (T-38), la feature se implementa en la rama de PayPal y se despliega con esa migracion o despues; no se propone un deploy independiente antes de T-38 (D-8).
- El cliente no accede al recibo: no hay link publico, token ni envio del recibo visual por email.
- No se recogen datos nuevos del pagador.
- El recibo no es un documento fiscal.

## 2. Alcance

### 2.1 Incluido

- Generalizar el recibo interno imprimible de `/admin/pagos/[id]/recibo` para que sirva tambien a pagos de Mercado Pago elegibles.
- Definir la elegibilidad por pasarela, estado y referencia externa, incluyendo datos historicos.
- Definir los datos que se muestran y los que nunca se muestran.
- Definir el identificador del recibo y su relacion con `reciboId`, que hoy es exclusivo de PayPal.
- Definir el comportamiento para los estados `SUCCEEDED`, `REVISION`, `REFUNDED`, `CONTRACARGO`, `FAILED` y `PENDING`.
- Definir la impresion y la accesibilidad con el mismo estandar que el recibo PayPal.
- Exponer el enlace "Ver recibo" en `/admin/pagos` y en el detalle del cliente para los pagos elegibles.
- Cubrir los pagos historicos con referencia externa, sin migracion ni backfill (D-1a).
- Mantener sin cambios el recibo PayPal, el webhook de Mercado Pago y el email existente.
- Tests automatizados para cada criterio de aceptacion y regresion de la suite existente.

### 2.2 Fuera de alcance

- Factura fiscal, comprobante fiscal, integracion contable o datos de facturacion.
- Generacion de PDF, adjuntos de email, envio del recibo visual al cliente o link publico de descarga.
- Portal de clientes o autoservicio para ver o descargar recibos.
- Reembolsos, contracargos o resolucion de diferencias de Mercado Pago. Hoy esas acciones son manuales y exclusivas del flujo PayPal del admin; esta spec solo define como se muestra el estado si existiera.
- Automatizar la conciliacion, la revision o el cambio de estado de un pago de Mercado Pago.
- Cambiar el webhook de Mercado Pago, la idempotencia, los links de pago, los montos, las comisiones o el gross-up.
- Migrar o reescribir pagos historicos. Esta feature no modifica datos existentes ni requiere backfill (D-1a).
- Mostrar datos del pagador de Mercado Pago, de tarjetas, de cuentas de la pasarela o datos fiscales.
- Impresion por lote, exportacion masiva o envio de recibos en bloque.
- Rediseñar `/admin/pagos`, el detalle del cliente o el recibo PayPal.
- Cambiar el email `sendPaymentReceipt` o agregarle el recibo visual.

## 3. Actores y permisos

| Actor | Puede | No puede |
|-------|-------|----------|
| **Admin** | Ver e imprimir el recibo de cualquier pago de Mercado Pago elegible. | Registrar pagos, cambiar estados o emitir facturas desde el recibo. |
| **Asistente** | Ver e imprimir el recibo de cualquier pago de Mercado Pago elegible, igual que el recibo PayPal. | Acciones de dinero, ajustes, reembolsos, contracargos o resolucion de diferencias. |
| **Usuario sin rol staff** | Nada. Se le redirige al gate de ingreso. | Ver datos del pago, del cliente o del recibo. |
| **Cliente o publico** | Nada. No existe ruta publica ni token de acceso. | Acceder al recibo, descargarlo o recibirlo por email como documento visual. |

Reglas de acceso:

- El recibo se sirve bajo la ruta interna del admin y exige la misma verificacion de staff que el recibo PayPal.
- La asistente conserva el acceso a clientes, cobros y pagos, incluido el recibo, sin ganar permisos nuevos.
- El recibo no se indexa, no se comparte por link publico y no se incluye en emails.
- Abrir o imprimir el recibo no revela ni registra datos del pagador.

## 4. Historias de usuario

- **H-1 (staff consulta):** Como admin o asistente, quiero abrir el recibo de un pago de Mercado Pago, para verificar los datos del cobro sin revisar el panel de la pasarela.
- **H-2 (staff imprime):** Como admin o asistente, quiero imprimir el recibo, para archivarlo o adjuntarlo a una conversacion interna.
- **H-3 (staff responde):** Como admin o asistente, quiero responder una consulta del cliente con los datos exactos del pago, para evitar errores de monto, fecha o concepto.
- **H-4 (asistente opera):** Como asistente, quiero ver e imprimir el recibo de Mercado Pago, para cubrir la operacion diaria sin pedirle permiso al admin.
- **H-5 (admin audita):** Como admin, quiero consultar el recibo de un pago historico, para reconstruir la trazabilidad de un cobro ya registrado.
- **H-6 (admin verifica el estado):** Como admin, quiero ver en el recibo si el pago esta confirmado, en revision, reembolsado o con contracargo, para no afirmar que un cobro esta vigente cuando no lo esta.
- **H-7 (admin identifica el cobro):** Como admin, quiero que el recibo identifique el proyecto e hito o el servicio y los meses, para vincular el pago con el trabajo correspondiente.

## 5. Requisitos funcionales

### 5.1 Elegibilidad, acceso y alcance

- **RF-1:** El recibo de Mercado Pago debe servirse en la misma ruta interna del recibo imprimible existente, `/admin/pagos/[id]/recibo`. No se crea una ruta publica, un token de acceso ni un endpoint nuevo para el cliente.
- **RF-2:** Solo el admin y la asistente autenticados pueden ver el recibo. Sin staff, se redirige al gate de ingreso y no se consultan datos del pago.
- **RF-3:** El recibo debe estar disponible para pagos de Mercado Pago en estado `SUCCEEDED`, `REVISION`, `REFUNDED` o `CONTRACARGO` que tengan una referencia externa de Mercado Pago (`Pago.externalId`). La elegibilidad debe usar la misma pasarela efectiva que el historial: `pasarela` manda y, para datos historicos sin backfill, se usa `metodo` como respaldo. Los estados `FAILED`, `PENDING` y cualquier estado no reconocido no tienen recibo. Un pago sin referencia externa no tiene recibo (D-2).
- **RF-4:** El recibo debe armarse exclusivamente con los datos registrados en el CRM. No debe consultar la API de Mercado Pago al abrirlo, imprimirlo o refrescarlo.
- **RF-5:** Abrir o imprimir el recibo no debe modificar el pago, el hito, el soporte, el enlace de pago ni el estado de la suscripcion. Tampoco debe enviar emails ni registrar eventos de pasarela.
- **RF-6:** Los pagos de Mercado Pago registrados antes de esta feature deben poder mostrar recibo si cumplen la elegibilidad, sin migracion ni backfill: el identificador se deriva de la referencia externa y de la fecha del recibo (`creadoEn` en el flujo actual) (D-1a).

### 5.2 Datos mostrados

- **RF-7:** El encabezado debe mostrar la marca PixelArch, el titulo "Recibo interno de pago", el identificador del recibo y el estado del pago.
- **RF-8:** El recibo debe mostrar el nombre del cliente del CRM y, si existe, su email. No debe mostrar nombre, email, telefono, direccion ni ningun otro dato del pagador de Mercado Pago.
- **RF-9:** El concepto debe tomarse del concepto del enlace de pago si existe. Si no existe, debe armarse como "Proyecto — Hito" para un hito o como "Servicio — N meses" para un soporte. Si no hay concepto vinculado, debe mostrarse "Pago Mercado Pago".
- **RF-10:** La fecha del recibo debe ser la fecha de emision registrada (`reciboEmitidoEn`) si existe; si no, la fecha del pago registrada en el CRM (`creadoEn`). Debe formatearse en espanol (es-AR) y ser estable entre la renderizacion en servidor y la hidratacion en el navegador.
- **RF-11:** El recibo debe mostrar la pasarela "Mercado Pago" y la referencia externa de Mercado Pago (payment id) completa, sin truncar y sin datos de tarjeta ni de la cuenta del pagador.
- **RF-12:** El importe debe mostrarse en la moneda registrada del pago, ARS o USD, con el formato vigente del CRM. ARS y USD no deben mezclarse en el mismo recibo.
- **RF-13:** El recibo debe mostrar el monto cobrado. La comision de Mercado Pago no se registra en el CRM (es 0), por lo que no debe mostrarse una linea de comision inventada. Si un pago de Mercado Pago tuviera una comision registrada mayor que 0, el recibo debe mostrar el desglose y cumplir `monto acordado + comision = total`. Si `montoAcordado` no estuviera registrado, el recibo debe usar el monto cobrado como monto acordado, sin inventar una comision; si ademas la comision registrada es mayor que 0, los datos no reconcilian y no se muestra recibo (AC-25).
- **RF-14:** El concepto debe permitir identificar el proyecto e hito o el servicio y los meses. No se imprimen identificadores internos como `clienteId`, `hitoId`, `suscripcionId` ni `enlacePagoId`.
- **RF-15:** No se imprimen notas internas, evidencia de pago, datos de revision, el origen del pago (`AUTOMATICO`/`MANUAL`), `registradoPor`, links de Mercado Pago (`mpLink`, `mpPreferenceId`), tokens, secretos ni datos fiscales.
- **RF-16:** El pie debe incluir "Recibo interno emitido por PixelArch. No reemplaza a una factura fiscal." y "Documento generado desde pixelarch.dev", con el mismo espiritu que el recibo PayPal.

### 5.3 Identificador del recibo y email existente

- **RF-17:** Todo recibo de Mercado Pago debe mostrar un identificador unico, estable y sin PII, distinguible del identificador de PayPal (que usa el prefijo `PAY-`) y que no colisione con `Pago.reciboId`. Con D-1a, el identificador se deriva de la referencia externa y de la fecha del recibo, no se persiste y no modifica el esquema.
- **RF-18:** El identificador debe ser el mismo cada vez que se abre o imprime el mismo pago, y debe ser distinto entre pagos distintos. No puede derivarse del nombre, email ni documento del cliente.
- **RF-19:** Con D-1a no se persiste el identificador ni se requiere backfill. La fecha del recibo es `reciboEmitidoEn` si existiera; en el flujo de Mercado Pago, que no genera ese campo, es `creadoEn` (RF-10). Esa misma fecha alimenta el identificador para que no haya dos fechas distintas en el documento.
- **RF-20:** El email `sendPaymentReceipt` existente no cambia con esta feature (D-6): no se le agrega el numero de recibo, no se le adjunta un PDF, no se le agrega un link al recibo interno y no se envia un email nuevo al abrir o imprimir el recibo.

### 5.4 Estados de Mercado Pago

- **RF-21:** `SUCCEEDED`: el recibo esta disponible y el estado se muestra como "Pagado".
- **RF-22:** `FAILED`, `PENDING` y cualquier estado no confirmado: no se emite recibo, porque no hubo cobro. El pago sigue visible en el historial con su estado y conserva su trazabilidad (D-3).
- **RF-23:** `REFUNDED` y `CONTRACARGO`: el recibo esta disponible y el estado impreso debe ser "Reembolsado" o "Contracargo", nunca "Pagado", y no se deben recalcular los montos (D-3).
- **RF-24:** `REVISION`: el recibo esta disponible y el estado impreso debe ser "En revision", nunca "Pagado". Hoy el flujo de Mercado Pago no produce este estado; la regla cubre datos historicos o futuros (D-3).
- **RF-25:** El estado debe mostrarse como texto y no depender solo del color. El recibo no debe cambiar el estado del pago ni sugerir una accion de cobro.

### 5.5 Historial y compatibilidad

- **RF-26:** El enlace "Ver recibo" debe aparecer en `/admin/pagos` y en el detalle del cliente para los pagos de Mercado Pago elegibles, con el mismo comportamiento que el recibo PayPal. Para los pagos no elegibles no debe mostrarse enlace.
- **RF-27:** El recibo PayPal debe quedar intacto: misma ruta, mismos datos, mismos permisos, mismo formato y mismos tests.
- **RF-28:** El flujo de Mercado Pago debe quedar intacto: webhook, links, montos, estados, idempotencia y email. Esta feature no debe introducir cambios de comportamiento en el cobro.

## 6. Requisitos no funcionales

- **RNF-1 (privacidad y permisos):** El recibo es staff-only. Solo muestra datos del cliente del CRM y los datos del pago. No muestra PII del pagador, datos de tarjeta, datos de la cuenta de Mercado Pago ni secretos. No se registra PII en logs, analitica ni Sentry.
- **RNF-2 (impresion):** El recibo debe imprimirse en una pagina A4, sin cortar importes, referencias ni conceptos. El boton "Imprimir recibo" y el enlace "Volver a pagos" deben ocultarse al imprimir. El fondo debe ser blanco y el texto oscuro, sin depender de imagenes ni de colores de fondo para la legibilidad.
- **RNF-3 (accesibilidad):** El recibo debe poder recorrerse y accionarse solo con teclado, con foco visible. Debe tener jerarquia de encabezados, tabla semantica con `caption` y encabezados de columna y fila, etiqueta accesible para el boton de imprimir y contraste suficiente (WCAG AA). El estado y los importes deben leerse como texto.
- **RNF-4 (estabilidad de fecha):** La fecha mostrada no debe variar entre servidor y cliente ni entre dos impresiones del mismo pago. Debe fijarse una zona horaria coherente con el recibo existente.
- **RNF-5 (sin red):** Abrir el recibo no debe hacer llamadas a Mercado Pago. Si faltan datos o no reconcilian, no se debe mostrar un recibo a medias.
- **RNF-6 (rendimiento):** El recibo debe resolverse con una unica consulta al pago y sus relaciones, sin consultas N+1 ni trabajo pesado en el cliente. El boton de imprimir es la unica interaccion de navegador.
- **RNF-7 (tests):** Cada criterio de aceptacion debe tener al menos un test automatizado. La suite no debe hacer llamadas reales a Mercado Pago. Los tests de la pagina y de la logica de elegibilidad deben mockear Prisma y la navegacion.
- **RNF-8 (compatibilidad):** La suite existente debe seguir pasando. TypeScript, lint y build deben quedar limpios, sin errores nuevos sobre el baseline conocido. El recibo PayPal y el flujo de Mercado Pago no deben sufrir regresiones.
- **RNF-9 (idioma y formato):** El recibo debe estar en espanol y usar el formato vigente del CRM para ARS y USD. No se deben mezclar monedas ni mostrar centavos de una moneda en el formato de la otra.
- **RNF-10 (trazabilidad):** El recibo no altera el pago. La trazabilidad existente (pago, pasarela, referencia, estado, quien lo registro y cuando) se conserva. El identificador derivado (D-1a) no se persiste ni requiere backfill.

## 7. Criterios de aceptacion

Nota: las decisiones D-1 a D-10 estan cerradas (aprobacion del 2026-10-29). Los AC-9, AC-10, AC-19 y AC-20 ya reflejan la decision aprobada y no dependen de preguntas abiertas.

- **AC-1:** Dado un usuario sin sesion o sin rol de admin ni asistente, cuando abre la ruta del recibo de un pago de Mercado Pago, entonces se le redirige al gate de ingreso y no se consultan datos del pago.
- **AC-2:** Dado un usuario con rol de asistente, cuando abre el recibo de un pago de Mercado Pago elegible, entonces puede verlo e imprimirlo, sin acciones de dinero ni permisos de admin.
- **AC-3:** Dado un pago de Mercado Pago en estado `SUCCEEDED` con referencia externa, cuando el staff abre el recibo, entonces ve la marca PixelArch, el titulo "Recibo interno de pago", el identificador, el estado "Pagado", el cliente del CRM, el concepto, la fecha, la pasarela "Mercado Pago", la referencia externa y la moneda.
- **AC-4:** Dado un pago de Mercado Pago de un hito, cuando se abre el recibo, entonces el concepto identifica el proyecto y el hito, y el importe coincide con el monto registrado en el CRM.
- **AC-5:** Dado un pago de Mercado Pago de un soporte con N meses, cuando se abre el recibo, entonces el concepto identifica el servicio y los N meses.
- **AC-6:** Dado un pago de Mercado Pago en ARS, cuando se muestra el recibo, entonces el importe se muestra en ARS con el formato vigente del CRM y no se mezcla con USD.
- **AC-7:** Dado un pago de Mercado Pago en USD con referencia externa (dato historico o futuro; el alta manual actual no la guarda), cuando se muestra el recibo, entonces el importe se muestra en USD con el formato vigente del CRM y no se mezcla con ARS.
- **AC-8:** Dado un pago de Mercado Pago en estado `FAILED` o `PENDING`, cuando el staff intenta abrir el recibo, entonces no se muestra recibo y el pago sigue visible en el historial con su estado.
- **AC-9:** Dado un pago de Mercado Pago en estado `REFUNDED` o `CONTRACARGO` (dato historico o futuro, no producido por el flujo actual), cuando el staff abre el recibo, entonces el recibo esta disponible y el estado impreso es "Reembolsado" o "Contracargo", nunca "Pagado", y los montos no se recalculan.
- **AC-10:** Dado un pago de Mercado Pago en estado `REVISION` (dato no producido por el flujo actual), cuando el staff abre el recibo, entonces el recibo esta disponible con el estado "En revision", nunca "Pagado", y no se sugieren acciones de cobro.
- **AC-11:** Dado un pago de Mercado Pago, cuando se abre el recibo dos veces o se imprime, entonces el identificador es el mismo; dos pagos distintos nunca comparten identificador; el identificador sigue el formato derivado aprobado en D-1a, no contiene PII ni identificadores internos y no usa el prefijo `PAY-`.
- **AC-12:** Dado un pago de Mercado Pago con payment id, cuando se muestra el recibo, entonces la referencia externa coincide exactamente con el `externalId` registrado y se muestra completa.
- **AC-13:** Dado un pago de Mercado Pago con datos del pagador en la pasarela, cuando se muestra el recibo, entonces no aparecen nombre, email, telefono, direccion, tarjeta, CBU/CVU ni datos de la cuenta de Mercado Pago del pagador; solo los datos del cliente del CRM.
- **AC-14:** Dado un pago con nota interna, evidencia, datos de revision, origen o `registradoPor`, cuando se muestra el recibo, entonces esos datos no se imprimen.
- **AC-15:** Dado un recibo de Mercado Pago, cuando se imprime, entonces el boton "Imprimir recibo" y el enlace "Volver a pagos" no aparecen, el contenido cabe en una pagina A4 y no se cortan importes, referencias ni conceptos.
- **AC-16:** Dado el recibo de Mercado Pago, cuando se navega solo con teclado y con lector de pantalla, entonces el boton y el enlace son accesibles, el foco es visible, la tabla tiene caption y encabezados, y el estado y los importes se leen como texto.
- **AC-17:** Dado un recibo de Mercado Pago abierto, cuando el staff lo visualiza o imprime, entonces el pago, el hito, el soporte y el enlace no cambian de estado y no se envia ningun email.
- **AC-18:** Dado un pago de Mercado Pago elegible, cuando el staff abre `/admin/pagos` o el detalle del cliente, entonces ve "Ver recibo" y el enlace abre el recibo; para un pago no elegible no ve el enlace. El enlace no se agrega a `/admin/cobros` (D-10).
- **AC-19:** Dado un pago de Mercado Pago registrado antes de esta feature con referencia externa, cuando el staff abre su recibo, entonces se muestra con los mismos datos y reglas, sin migracion ni backfill: el identificador se deriva de la referencia historica y de la fecha del recibo (`creadoEn` en el flujo actual).
- **AC-20:** Dado un pago de Mercado Pago sin referencia externa, cuando el staff intenta abrir el recibo, entonces el sistema no muestra recibo, no inventa una referencia y el pago sigue visible en el historial.
- **AC-21:** Dado el recibo PayPal existente, cuando se ejecuta la suite, entonces sus tests siguen pasando y su contenido, ruta, permisos y formato no cambian.
- **AC-22:** Dado el recibo de Mercado Pago, cuando se abre, entonces no se llama a la API de Mercado Pago y la vista se arma solo con datos del CRM.
- **AC-23:** Dado un pago de Mercado Pago con email de recibo ya enviado, cuando el staff abre el recibo visual, entonces no se envia un email nuevo y el email existente no cambia.
- **AC-24:** Dado cada criterio de aceptacion de esta spec, cuando se ejecuta la suite automatizada, entonces existe al menos un test que lo cubre y la suite pasa sin llamadas reales a Mercado Pago.
- **AC-25:** Dado un pago de Mercado Pago con datos inconsistentes (importe que no reconcilia, referencia invalida o datos del pago incompletos), cuando se abre el recibo, entonces no se muestra un recibo a medias y se responde como no encontrado.
- **AC-26:** Dado un recibo de Mercado Pago con fecha, cuando se renderiza en servidor y se hidrata en el navegador, entonces la fecha mostrada es la misma y no cambia entre dos impresiones.

### 7.1 Trazabilidad requisito → criterio

| Requisito | Criterios |
|-----------|-----------|
| RF-1 | AC-1, AC-2 |
| RF-2 | AC-1, AC-2 |
| RF-3 | AC-3, AC-8, AC-9, AC-10, AC-18, AC-19, AC-20 |
| RF-4 | AC-17, AC-22 |
| RF-5 | AC-17, AC-23 |
| RF-6 | AC-19 |
| RF-7 | AC-3 |
| RF-8 | AC-3, AC-13 |
| RF-9 | AC-4, AC-5 |
| RF-10 | AC-3, AC-26 |
| RF-11 | AC-3, AC-12 |
| RF-12 | AC-6, AC-7 |
| RF-13 | AC-6, AC-7, AC-25 |
| RF-14 | AC-4, AC-5, AC-11 |
| RF-15 | AC-13, AC-14 |
| RF-16 | AC-3 |
| RF-17 | AC-11 |
| RF-18 | AC-11 |
| RF-19 | AC-19 |
| RF-20 | AC-23 |
| RF-21 | AC-3 |
| RF-22 | AC-8 |
| RF-23 | AC-9 |
| RF-24 | AC-10 |
| RF-25 | AC-16 |
| RF-26 | AC-18 |
| RF-27 | AC-21 |
| RF-28 | AC-17, AC-21, AC-22 |
| RNF-1 | AC-1, AC-2, AC-13, AC-14 |
| RNF-2 | AC-15 |
| RNF-3 | AC-16 |
| RNF-4 | AC-26 |
| RNF-5 | AC-22, AC-25 |
| RNF-6 | AC-22 |
| RNF-7 | AC-24 |
| RNF-8 | AC-21, AC-24 |
| RNF-9 | AC-6, AC-7 |
| RNF-10 | AC-17, AC-19 |

## 8. Tests esperados

La estrategia se detalla en el plan; esta seccion fija el minimo esperado.

| Area | Tipo | Casos clave | AC |
|------|------|-------------|----|
| Pagina del recibo | unitaria de pagina con Prisma y navegacion mockeados | redireccion sin staff; asistente permitida; pago `SUCCEEDED`; concepto por enlace, hito y soporte; ARS y USD; referencia; ausencia de PII y notas; `notFound` por pago inexistente, pasarela no elegible (manual), estado no elegible, sin referencia y datos inconsistentes | AC-1 a AC-15, AC-17, AC-20, AC-25 |
| Identificador | unitaria pura | estabilidad entre llamadas; unicidad entre pagos; sin PII; sin prefijo `PAY-`; sin ids internos | AC-11 |
| Elegibilidad en historial | unitaria pura | MP elegible; MP sin referencia; MP `FAILED`/`PENDING`; MP historico con `metodo`; PayPal sin cambios | AC-8, AC-18, AC-19, AC-21 |
| Estados | unitaria de pagina y de mapeo visible | `SUCCEEDED` "Pagado"; `FAILED`/`PENDING` sin recibo; `REFUNDED`/`CONTRACARGO` con estado real; `REVISION` con "En revision", nunca "Pagado" | AC-8, AC-9, AC-10 |
| Impresion y accesibilidad | unitaria de DOM | `print:hidden` en boton y volver; `caption` y encabezados de tabla; foco visible; estado como texto | AC-15, AC-16 |
| Fecha | unitaria de render | misma fecha en servidor, hidratacion y segunda impresion | AC-26 |
| Email y solo lectura | unitaria con mocks | no se envia email al abrir o imprimir; no se actualiza el pago, hito, soporte ni enlace | AC-17, AC-23 |
| Sin red | suite completa | ninguna llamada real a Mercado Pago; guard de red existente | AC-22, AC-24 |
| Regresion PayPal | suite existente | tests del recibo PayPal, de la vista y de los webhooks siguen pasando | AC-21, AC-24 |

Ademas:

- Los tests deben cubrir un pago historico sin `EnlacePago` (concepto por proyecto e hito o por servicio y meses).
- Los tests deben cubrir un pago de Mercado Pago con `pasarela=MANUAL` y `metodo=MERCADOPAGO` para verificar la pasarela efectiva.
- Los tests no deben tocar la base de datos real ni la API de Mercado Pago.
- La suite existente debe seguir en verde y no se deben introducir errores nuevos de lint sobre el baseline conocido.

## 9. Decisiones aprobadas

Aprobadas por el dueno el 2026-10-29. Cierran las preguntas abiertas del borrador y no cambian el alcance.

| ID | Decision aprobada | Impacto |
|----|-------------------|---------|
| **D-1 (a)** | Identificador determinista derivado de la referencia externa de Mercado Pago y de la fecha del recibo, sin persistir. Se descartan (b) persistir `reciboId`/`reciboEmitidoEn` con backfill y (c) usar `externalId` como numero visible. Sin cambios de esquema ni backfill. | Esquema, T-38, RF-17 a RF-19, AC-11 y AC-19. |
| **D-2** | No emitir recibo para pagos manuales de Mercado Pago sin `externalId`. No se inventa una referencia. Si se necesita, pedir el payment id en el alta manual requiere otra spec. | Elegibilidad, alta manual, RF-3, AC-20. |
| **D-3** | `SUCCEEDED` muestra "Pagado"; `REVISION` muestra "En revision" (recibo disponible, nunca "Pagado"); `REFUNDED` y `CONTRACARGO` muestran recibo con el estado real; `FAILED`, `PENDING` y estados desconocidos no llevan recibo. | Estados, RF-21 a RF-24, AC-8 a AC-10. |
| **D-4** | Mantener el formato ARS vigente del CRM (redondeo a pesos enteros). No se cambia el historial ni se agregan decimales. | Importes, RF-12, AC-6. |
| **D-5** | No mostrar el origen (`AUTOMATICO`/`MANUAL`) ni `registradoPor`; paridad con el recibo PayPal. | Privacidad, RF-15, AC-14. |
| **D-6** | El email `sendPaymentReceipt` no cambia: sin numero de recibo, sin PDF, sin link y sin envio nuevo. El recibo visual sigue siendo staff-only. | Email, RF-20, AC-23. |
| **D-7** | Sin equivalente en USD de un pago en ARS. El recibo muestra solo la moneda cobrada. | Importes, RF-12, AC-6. |
| **D-8** | Implementar en la rama PayPal (`paypal-staging`) y desplegar con la migracion/backfill de T-38. No deployar a produccion antes de T-38. | Despliegue, §7 del plan. |
| **D-9** | Mostrar el estado actual del pago, no un snapshot inmutable. Un cambio de estado se refleja en la proxima apertura. | Estados, RF-23, RF-24, AC-9, AC-10. |
| **D-10** | "Ver recibo" en `/admin/pagos` y en el detalle del cliente, igual que PayPal. No se agrega a `/admin/cobros`, que es una vista de cobros pendientes. | Alcance, RF-26, AC-18. |

### 9.1 Cierre

No quedan decisiones abiertas ni `[NECESITA ACLARACION]` para esta spec. Cualquier cambio de alcance (PDF, link publico, persistir el recibo, recibo para pagos manuales sin referencia, email con recibo visual) requiere una spec nueva.
