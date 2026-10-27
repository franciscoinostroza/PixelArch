# Spec 001: Cobros con PayPal

**Estado:** aprobada
**Aprobacion:** pendiente
**Fecha:** 2026-10-19
**Relacionada con:** `specs/constitution.md` §2, enmendada el 2026-10-19 (PayPal permitido ademas de Mercado Pago).

## 1. Contexto y objetivo

### 1.1 Situacion actual

- El CRM cobra proyectos por hitos (`Proyecto`/`Hito`) y soporte mensual (`Suscripcion` plan SOPORTE).
- Hoy los cobros se generan con links de Mercado Pago (Checkout Pro) desde `/admin/clientes/[id]` y `/admin/cobros`. El link se puede copiar o enviar por WhatsApp/email.
- Los links de MP se recuerdan 30 dias (`mpLink`, `mpLinkExpira`) y se invalidan al editar el monto, marcar pagado o vencer.
- Los pagos se registran con monto en centavos, moneda, metodo, cotizacion, recibo y trazabilidad. `Pago.externalId` garantiza idempotencia.
- El webhook `/api/webhooks/mercadopago` verifica la firma y actualiza el hito (PAGADO) o acredita meses de soporte.
- `/admin/pagos` concentra el historial con filtros por estado, fecha, moneda y metodo.

Estos datos describen el flujo actual. La incorporacion de PayPal se suma a ese flujo; no lo reemplaza.

### 1.2 Problema

Los clientes internacionales suelen cobrar y pagar en USD, mientras que el circuito actual esta centrado en Mercado Pago y en ARS. Eso obliga a coordinar transferencias o conversiones fuera del CRM, agrega friccion para el cliente y dificulta la conciliacion automatica. PayPal es una pasarela ampliamente usada por clientes internacionales y permite cobrar en USD sin que PixelArch manipule datos de tarjetas.

### 1.3 Objetivo

Permitir que el admin genere y envie cobros por PayPal en USD para hitos de proyectos y soporte mensual, que el cliente pague desde un checkout alojado por PayPal y que el CRM registre y concilie el pago con la misma trazabilidad que los cobros de Mercado Pago, sin afectar los cobros existentes.

### 1.4 Resultado esperado

- Un hito o un soporte mensual pendiente puede pagarse por PayPal desde un link de pago unico generado por el admin.
- El cliente paga el monto acordado mas la comision de PayPal; el CRM registra monto acordado, comision y total cobrado, y el recibo muestra el desglose.
- El pago queda registrado una sola vez, con recibo y vinculo al hito o al soporte correspondiente.
- El admin ve el estado del cobro en el CRM y puede conciliar sin depender de revisar manualmente el panel de PayPal.
- Mercado Pago sigue funcionando sin cambios para los cobros en ARS y para los links ya generados.
- Si un mismo cobro tiene links de Mercado Pago y PayPal, ambos pueden coexistir; el primer pago confirmado gana e invalida el otro link, conservando la trazabilidad de ambos.

### 1.5 Decisiones fijas (constitucion)

- PayPal es una pasarela permitida. Mercado Pago sigue siendo la pasarela principal para ARS; PayPal se usa para clientes internacionales y cobros en USD.
- Cada pasarela se integra con su propio checkout y con webhooks verificados con firma e idempotencia.
- Nunca se almacenan datos de tarjetas.
- Los montos se guardan en centavos y se formatean con `formatearMonto`; ARS y USD se muestran por separado.
- Toda accion que mueva dinero deja trazabilidad (pago, recibo, pasarela y quien lo registro).
- El acceso al CRM esta restringido a admin/asistente mediante Clerk.
- Los secretos viven en variables de entorno, nunca en el repositorio.

### 1.6 Supuestos de trabajo

- El admin y la asistente inician todos los cobros; no hay autoservicio del cliente ni portal publico de pagos.
- PayPal se usa exclusivamente para cobros en USD. No se acepta ARS por PayPal ni se convierte un cobro de ARS a USD.
- Si el pagador usa otra moneda, PayPal maneja la conversion; el CRM registra el monto en USD.
- El modelo de proyectos por hitos y soporte mensual no cambia.
- El checkout es alojado por PayPal; PixelArch no recibe ni almacena datos de tarjeta.
- Se usa un link de pago unico (PayPal Orders), no una suscripcion recurrente (PayPal Subscriptions).
- El cliente paga el monto acordado mas la comision de PayPal (gross-up).
- Un pago se considera confirmado con la aprobacion de PayPal o con un registro manual autorizado para el admin.
- Los links de Mercado Pago y PayPal pueden coexistir para el mismo cobro pendiente; el primer pago confirmado gana.
- La validacion en sandbox es obligatoria antes de habilitar PayPal en produccion.

## 2. Historias de usuario

- **H-1 (admin genera el cobro):** Como admin, quiero generar un cobro por PayPal en USD para un hito o un soporte pendiente, para ofrecerle al cliente internacional una forma de pago adecuada.
- **H-2 (admin envia el cobro):** Como admin, quiero copiar o enviar el link de PayPal por email o WhatsApp, en espanol o en ingles, para que el cliente reciba el cobro por el canal y el idioma que usa.
- **H-3 (cliente paga):** Como cliente internacional, quiero pagar el cobro en USD con PayPal desde un link, sin crear una cuenta en PixelArch y pudiendo usar el pago como invitado cuando PayPal lo permita, para completar el pago de forma simple y segura.
- **H-4 (admin concilia):** Como admin, quiero que el pago quede registrado y vinculado automaticamente al hito o soporte, para no conciliar a mano ni arriesgar cobros duplicados.
- **H-5 (admin consulta):** Como admin, quiero ver los pagos PayPal en el historial y en el detalle del cliente, con monto acordado, comision, total, referencia y estado, para auditar y responder consultas.
- **H-6 (admin gestiona excepciones):** Como admin, quiero ver links vencidos, pagos fallidos, diferencias de monto, reembolsos o contracargos y poder actuar, para mantener el CRM como fuente de verdad.
- **H-7 (asistente opera):** Como asistente, quiero generar, enviar, ver y conciliar cobros PayPal, para cubrir la operacion diaria del CRM.
- **H-8 (admin registra un pago manual):** Como admin, quiero registrar a mano un pago PayPal con evidencia cuando el webhook no llegue, sin duplicarlo si el evento aparece despues.

## 3. Requisitos funcionales

### 3.1 Alcance y elegibilidad

- **RF-1:** El sistema debe permitir generar cobros por PayPal para hitos de proyectos y para soporte mensual. La funcionalidad de Mercado Pago debe seguir disponible para ambos conceptos.
- **RF-2:** Todo cobro PayPal debe expresarse en USD y registrarse en centavos con moneda explicita. No se permite un cobro PayPal en ARS ni la conversion de un cobro de ARS a USD. Si el pagador usa otra moneda, PayPal realiza la conversion y el CRM registra el monto en USD.
- **RF-3:** El admin o la asistente deben poder iniciar un cobro PayPal para un concepto que exista, pertenezca al cliente y este pendiente. Deben poder indicar concepto, monto acordado en USD, descripcion y una nota interna. El inicio no debe marcar el cobro como pagado ni modificar el vencimiento del soporte.
- **RF-4:** Al iniciar el cobro, el sistema debe generar un checkout alojado por PayPal a partir de un link de pago unico (Orders) y devolver un enlace vinculado de forma unica al concepto interno. No se usan suscripciones recurrentes (Subscriptions). La generacion no debe alterar el estado del hito ni del soporte.
- **RF-5:** El enlace debe tener vigencia de 30 dias y estado visibles para el admin. Si ya existe un enlace vigente para el mismo cobro, el sistema debe mostrarlo y evitar crear un duplicado silencioso. Al vencer, el admin debe poder regenerar un enlace nuevo; el anterior deja de ser utilizable y se conserva como historial.

### 3.2 Envio y seguimiento

- **RF-6:** El admin o la asistente deben poder copiar el enlace y enviarlo por email o WhatsApp. El mensaje debe incluir concepto, monto total a pagar en USD (monto acordado mas comision), enlace y vigencia. Debe existir una plantilla en espanol y otra en ingles, y el admin o la asistente deben poder elegir el idioma antes de enviar. El sistema debe registrar el canal y la fecha de envio para trazabilidad, sin incluir PII en los logs.
- **RF-7:** Desde `/admin/cobros`, el admin o la asistente deben poder enviar un recordatorio con el enlace PayPal de un cobro pendiente elegible, sin alterar el estado del cobro.
- **RF-8:** El cliente debe poder pagar desde el enlace sin cuenta en PixelArch y sin acceder al CRM. Se debe permitir el pago como invitado cuando PayPal lo permita. El sistema debe asociar la confirmacion del pago al cobro correcto.
- **RF-9:** Se debe poder generar un link PayPal para un cobro pendiente aunque ya tenga un link de Mercado Pago. Ambos links pueden coexistir hasta que uno se pague.

### 3.3 Comision, confirmacion y registro

- **RF-10:** El cobro debe aplicar gross-up: el cliente paga el monto acordado mas la comision de PayPal. El CRM debe registrar, en centavos y en USD, el monto acordado, la comision y el total cobrado, y el recibo debe mostrar el desglose. La formula exacta de la comision se define en el plan.
- **RF-11:** El sistema debe recibir las notificaciones de PayPal, verificar su autenticidad y procesar solo las validas. Debe responder a tiempo, tolerar reintentos e ignorar de forma segura los eventos desconocidos o no relacionados con un cobro de PixelArch.
- **RF-12:** Cada pago confirmado debe generar exactamente un registro de pago con: monto acordado, comision y total cobrado en centavos, moneda USD, metodo PayPal, referencia externa de PayPal, fecha, concepto vinculado (hito o soporte), estado, recibo y origen (automatico o manual).
- **RF-13:** El procesamiento debe ser idempotente por `externalId`. Notificaciones repetidas, simultaneas o fuera de orden no deben duplicar pagos, acreditar dos veces el soporte ni volver a marcar un hito.
- **RF-14:** Cuando se confirme el pago de un hito y el total cobrado coincida con el total esperado, el hito debe quedar PAGADO, vinculado al pago y sin posibilidad de un segundo cobro. Si el monto difiere del esperado, el pago queda para revision y no marca el hito como pagado automaticamente.
- **RF-15:** Cuando se confirme el pago de soporte, el sistema debe acreditar los meses indicados, de 1 a 12, con la misma regla de Mercado Pago, y actualizar el vencimiento una sola vez. Si el monto difiere del esperado, el pago queda para revision y no acredita meses automaticamente.
- **RF-16:** El registro manual de un pago PayPal debe estar disponible solo para el admin, con evidencia de la operacion y la misma idempotencia por `externalId`. Si el webhook llega despues, no debe duplicar el pago. El registro debe dejar trazabilidad de quien lo hizo, cuando y con que evidencia.
- **RF-17:** Solo se debe guardar el email o nombre del pagador si es necesario para el recibo. Esos datos no deben registrarse en logs ni en analitica y solo deben ser visibles para admin y asistente.

### 3.4 Recibo, historial y trazabilidad

- **RF-18:** Todo pago PayPal confirmado debe generar un recibo interno con identificador, concepto, monto acordado, comision, total cobrado, moneda USD, fecha, pasarela, referencia externa y estado, sin datos de tarjeta. El recibo debe quedar asociado al pago y disponible para el admin. La factura fiscal queda fuera de alcance.
- **RF-19:** El historial (`/admin/pagos` y detalle del cliente) debe mostrar los pagos PayPal con pasarela, referencia, monto acordado, comision, total, moneda, concepto, fecha, estado y vinculo al hito o soporte. Debe permitir filtrar por PayPal y distinguirlo de Mercado Pago. Debe conservar quien genero el cobro, cuando y por que canal se envio.
- **RF-20:** Los reembolsos y contracargos deben registrarse manualmente en el CRM. Se debe conservar el pago original y dejar trazabilidad del evento y de la decision del admin, que define si revierte el hito o descuenta meses de soporte. No se revierte ni se descuenta automaticamente.
- **RF-21:** Los estados fallido, cancelado, vencido o rechazado no deben marcar el cobro como pagado. El admin debe ver el estado y el motivo disponible, y poder regenerar el enlace o reintentar. Una falla de PayPal no debe corromper datos locales ni bloquear Mercado Pago.
- **RF-22:** Si un cobro tiene links de Mercado Pago y PayPal, ambos pueden estar vigentes. El primer pago confirmado gana, invalida el enlace de la otra pasarela y conserva la trazabilidad de ambos. Un segundo pago para el mismo cobro no debe registrarse como un pago nuevo; el intento debe quedar trazado.
- **RF-23:** Los links de Mercado Pago existentes deben quedar intactos. Se debe poder generar un link PayPal para el mismo cobro pendiente. Los pagos y soportes ya registrados por Mercado Pago no se ven afectados.

### 3.5 Roles y operacion

- **RF-24:** El admin y la asistente pueden generar, enviar, ver y conciliar cobros PayPal. Las decisiones sobre reembolsos y contracargos quedan reservadas al admin. Ningun usuario sin rol autorizado puede acceder a estas acciones ni a los datos del pagador.
- **RF-25:** La configuracion de PayPal debe provenir de variables de entorno. Si falta o es invalida, PayPal debe quedar no disponible con un mensaje claro y Mercado Pago debe seguir operativo.

## 4. Requisitos no funcionales

- **RNF-1 (seguridad del webhook):** Toda notificacion debe verificarse con la firma o mecanismo de autenticidad de PayPal. Las notificaciones invalidas, ausentes o alteradas se rechazan sin crear pagos ni cambiar estados. El procesamiento debe tolerar reintentos y no confiar en el orden de llegada.
- **RNF-2 (secretos):** Las credenciales de PayPal viven en variables de entorno, nunca en el repositorio, logs o respuestas al cliente. Sandbox y produccion deben usar credenciales distintas; las credenciales y la configuracion del webhook las provee y configura el dueno de la cuenta. La rotacion no debe requerir cambios de codigo.
- **RNF-3 (datos de pago):** No se almacenan datos de tarjetas ni credenciales del pagador. Solo se guardan los identificadores y datos minimos necesarios para conciliar, emitir el recibo y auditar, incluido el email o nombre del pagador solo si es imprescindible para el recibo.
- **RNF-4 (dinero):** Los montos se guardan en centavos como enteros, con moneda explicita; nunca en punto flotante. USD y ARS se muestran por separado y con el formato existente. El desglose debe reconciliar exactamente: monto acordado mas comision es igual al total cobrado.
- **RNF-5 (disponibilidad y recuperacion):** El sistema debe responder las notificaciones en un tiempo acotado (objetivo: 10 segundos) y dejar el pago recuperable si el procesamiento posterior falla. Una caida o lentitud de PayPal no debe afectar Mercado Pago ni el resto del CRM.
- **RNF-6 (logs y observabilidad):** Los logs estructurados y los eventos de error deben incluir identificadores de pago, cobro, monto, moneda y estado, pero no PII del pagador (nombre, email, direccion) ni secretos. Los errores criticos deben reportarse a Sentry sin PII.
- **RNF-7 (tests):** Cada criterio de aceptacion funcional debe tener al menos un test automatizado. La logica de montos, comision, estados, idempotencia y verificacion de firma se prueba con tests unitarios; la integracion con PayPal se prueba con dobles o sandbox, sin llamadas reales en la suite de CI. La validacion operativa en sandbox se documenta como checklist antes de produccion.
- **RNF-8 (compatibilidad):** La incorporacion de PayPal no debe romper el flujo de Mercado Pago. La suite existente debe seguir pasando; typecheck y build deben quedar limpios y no se deben introducir errores nuevos de lint sobre el baseline conocido.
- **RNF-9 (accesibilidad):** Las acciones de PayPal en el admin deben poder completarse por teclado, con etiquetas y mensajes de error legibles, contraste suficiente y sin depender solo del color.
- **RNF-10 (rendimiento percibido):** Las acciones del admin deben mostrar un estado de carga y no bloquear la interfaz mientras PayPal responde. Los tiempos de espera deben tener un limite y un mensaje claro al vencer.
- **RNF-11 (entornos):** Debe existir una configuracion de pruebas (sandbox) separada de produccion, sin mezclar datos ni credenciales. La validacion en sandbox es obligatoria antes de habilitar PayPal en produccion; las credenciales y el webhook los configura el dueno.
- **RNF-12 (auditoria y retencion):** Los pagos, recibos y eventos de PayPal no se borran al reversarse o fallar; se conservan con su estado y trazabilidad segun la politica existente. Los links vencidos y los intentos de pago de la pasarela que no gano se conservan como historial.
- **RNF-13 (privacidad):** Los datos del pagador que PayPal entregue se usan solo si son imprescindibles para el recibo o la conciliacion. No se envian a analitica ni a emails internos mas alla de lo necesario, y el acceso queda restringido a admin y asistente.
- **RNF-14 (idioma y formato):** Las plantillas de email y WhatsApp deben existir en espanol e ingles, y los montos en USD deben formatearse de forma consistente en ambos idiomas.

## 5. Criterios de aceptacion

Nota: salvo en AC-22 y AC-25, donde la accion es exclusiva del admin, las menciones al admin incluyen a la asistente.

- **AC-1:** Dado un cobro pendiente de un hito o de soporte mensual, cuando el admin o la asistente solicita generar el cobro, entonces el sistema devuelve un enlace de checkout unico de PayPal y muestra en el CRM el concepto, el monto acordado, la comision y el total en USD, y el cobro sigue pendiente.
- **AC-2:** Dado un cobro que ya tiene un enlace PayPal vigente, cuando el admin intenta generar otro, entonces el sistema muestra el enlace vigente y evita crear un duplicado silencioso.
- **AC-3:** Dado un enlace PayPal generado, cuando el admin lo envia por email o WhatsApp en espanol o en ingles, entonces el mensaje incluye concepto, monto total a pagar en USD, enlace y vigencia, y queda registrado el canal y la fecha de envio.
- **AC-4:** Dado un cobro pendiente con enlace PayPal, cuando el admin envia un recordatorio desde `/admin/cobros`, entonces el recordatorio incluye el enlace y el cobro permanece pendiente.
- **AC-5:** Dado un pago aprobado en PayPal, cuando llega una notificacion valida, entonces se registra exactamente un pago con monto acordado, comision y total en centavos USD, metodo PayPal, referencia externa y recibo, y se vincula al hito o soporte correcto.
- **AC-6:** Dado un pago PayPal ya registrado, cuando llega otra vez la misma notificacion o dos notificaciones simultaneas, entonces no se crea un segundo pago y no se acredita dos veces el soporte ni se vuelve a marcar el hito.
- **AC-7:** Dado una notificacion con firma invalida, ausente o alterada, cuando se recibe, entonces se rechaza, no se registra pago ni cambio de estado, y se deja un registro tecnico sin PII.
- **AC-8:** Dado un hito pendiente pagado por PayPal cuyo total coincide con el esperado, cuando se confirma el pago, entonces el hito queda PAGADO, vinculado al pago, y no admite un segundo cobro.
- **AC-9:** Dado un soporte mensual con un cobro PayPal de 1 a 12 meses, cuando se confirma el pago con el monto esperado, entonces se acreditan los meses indicados y el vencimiento se actualiza una sola vez, con la misma regla que Mercado Pago.
- **AC-10:** Dado un pago PayPal confirmado, cuando se genera el recibo interno, entonces incluye identificador, concepto, monto acordado, comision, total, USD, fecha, pasarela y referencia externa, no incluye datos de tarjeta, queda asociado al pago y no se emite factura fiscal.
- **AC-11:** Dado un pago PayPal registrado, cuando el admin abre `/admin/pagos`, entonces lo ve con pasarela PayPal, referencia, monto acordado, comision, total, moneda, concepto, fecha y estado, y puede filtrarlo por PayPal.
- **AC-12:** Dado un pago PayPal registrado, cuando el admin abre el detalle del cliente o del cobro, entonces ve el pago, quien genero el cobro, cuando, por que canal se envio y a que hito o soporte corresponde.
- **AC-13:** Dado un cobro con links de Mercado Pago y PayPal, cuando se confirma el primero de los pagos, entonces se registra ese pago, se invalida el enlace de la otra pasarela, no se registra un segundo pago para el mismo cobro y se conserva la trazabilidad de ambos enlaces y del intento descartado.
- **AC-14:** Dado que PayPal no responde o rechaza la generacion, cuando el admin intenta generar el cobro, entonces ve un error claro, no se crea un pago y el cobro no cambia de estado.
- **AC-15:** Dado un pago fallido, cancelado o vencido en PayPal, cuando se recibe la notificacion, entonces el cobro sigue pendiente, se registra el evento del intento sin crear un pago confirmado y el admin puede regenerar el enlace.
- **AC-16:** Dado que faltan las credenciales de PayPal o son invalidas, cuando el admin intenta usar PayPal, entonces la opcion queda no disponible con un mensaje claro, no se crea checkout y Mercado Pago sigue funcionando.
- **AC-17:** Dado un usuario sin rol de admin ni de asistente, cuando intenta generar, enviar, ver o conciliar un cobro PayPal, entonces la operacion se rechaza y no se exponen datos. Dado un asistente, cuando realiza esas acciones, entonces se permiten, pero cuando intenta decidir un reembolso o contracargo, entonces se rechaza.
- **AC-18:** Dado un monto de US$100,50, cuando se registra el pago, entonces se almacena 10050 centavos y se muestra US$100,50, sin errores de punto flotante y sin mezclar ARS. Si el pagador uso otra moneda, el CRM registra el monto en USD informado por PayPal.
- **AC-19:** Dado un pago con email o nombre del pagador, cuando se procesa, entonces los logs y eventos de error no contienen esos datos; solo identificadores, monto, moneda y estado.
- **AC-20:** Dado el flujo de Mercado Pago existente, cuando se ejecuta la suite de regresion, entonces los tests de Mercado Pago pasan, los links existentes siguen intactos, un pago por Mercado Pago sigue actualizando el hito o el soporte como antes y se puede generar un link PayPal para el mismo cobro pendiente.
- **AC-21:** Dado cada criterio de aceptacion funcional de esta spec, cuando se ejecuta la suite automatizada, entonces existe al menos un test que lo cubre y la suite pasa sin llamadas reales a PayPal.
- **AC-22:** Dado un pago PayPal reembolsado o contracargado, cuando el admin lo registra en el CRM, entonces el pago original se conserva, el evento y la decision quedan trazados y el efecto sobre el hito o el soporte es el que define el admin, sin reversion ni descuento automatico.
- **AC-23:** Dado el flujo de generacion y envio de un cobro PayPal en el admin, cuando se navega solo con teclado, entonces se pueden completar las acciones y los mensajes de error son legibles por lector de pantalla.
- **AC-24:** Dado un cobro con un monto acordado y una comision de PayPal, cuando se genera y se confirma el pago, entonces el cliente paga el total (acordado mas comision), el CRM registra los tres montos en centavos USD y el recibo muestra el desglose, sin comisiones ocultas.
- **AC-25:** Dado un pago PayPal que no se reflejo por webhook, cuando el admin lo registra manualmente con evidencia y `externalId`, entonces se crea un unico pago vinculado al cobro, y si luego llega el webhook no se duplica. La asistente no puede realizar este registro manual.
- **AC-26:** Dado un enlace PayPal generado, cuando transcurren 30 dias, entonces el enlace vence, no puede usarse para pagar, el admin puede regenerar uno nuevo y el enlace anterior queda en el historial como vencido.
- **AC-27:** Dado un pago cuyo total no coincide con el esperado (parcial, mayor o distinto), cuando se confirma, entonces queda para revision, no se marca el hito como pagado ni se acreditan meses automaticamente, y el admin ve la diferencia para resolverla.
- **AC-28:** Dado un pagador sin cuenta PayPal, cuando PayPal permite el pago como invitado, entonces puede completar el pago; el sistema solo guarda email o nombre si es necesario para el recibo, no los expone en logs ni analitica y restringe su acceso a admin y asistente.
- **AC-29:** Dado el entorno de sandbox con las credenciales y el webhook configurados por el dueno, cuando se ejecuta la validacion previa a produccion, entonces se completa un cobro de prueba de principio a fin (generacion, pago, webhook y recibo) sin afectar datos de produccion.

### Trazabilidad requisito → criterio

| Requisito | Criterios |
|-----------|-----------|
| RF-1 | AC-1, AC-8, AC-9 |
| RF-2 | AC-1, AC-18 |
| RF-3 | AC-1, AC-14 |
| RF-4 | AC-1, AC-2 |
| RF-5 | AC-2, AC-26 |
| RF-6 | AC-3 |
| RF-7 | AC-4 |
| RF-8 | AC-28 |
| RF-9 | AC-13, AC-20 |
| RF-10 | AC-5, AC-10, AC-24 |
| RF-11 | AC-5, AC-7, AC-15 |
| RF-12 | AC-5, AC-10 |
| RF-13 | AC-6 |
| RF-14 | AC-8, AC-27 |
| RF-15 | AC-9, AC-27 |
| RF-16 | AC-25 |
| RF-17 | AC-19, AC-28 |
| RF-18 | AC-10 |
| RF-19 | AC-11, AC-12 |
| RF-20 | AC-22 |
| RF-21 | AC-14, AC-15 |
| RF-22 | AC-13 |
| RF-23 | AC-20 |
| RF-24 | AC-17, AC-25 |
| RF-25 | AC-16 |
| RNF-1 | AC-7 |
| RNF-2 | AC-16, AC-17 |
| RNF-3 | AC-10, AC-19, AC-28 |
| RNF-4 | AC-18, AC-24 |
| RNF-5 | AC-14, AC-15, AC-21 |
| RNF-6 | AC-19 |
| RNF-7 | AC-21, AC-29 |
| RNF-8 | AC-20 |
| RNF-9 | AC-23 |
| RNF-10 | AC-14 |
| RNF-11 | AC-16, AC-29 |
| RNF-12 | AC-10, AC-22 |
| RNF-13 | AC-19, AC-28 |
| RNF-14 | AC-3 |

## 6. Fuera de alcance

- Reemplazar o retirar Mercado Pago. Mercado Pago sigue siendo la pasarela principal para ARS.
- Crear un portal de clientes o autoservicio para generar, ver o pagar cobros. Los links se generan desde el admin.
- Almacenar datos de tarjetas, credenciales de PayPal del pagador o datos sensibles de pago.
- Integrar otras pasarelas (Stripe, Wise, criptomonedas u otras) o un orquestador general de pagos.
- Cambiar el modelo de negocio de proyectos por hitos y soporte mensual.
- Migrar o reescribir pagos historicos de Mercado Pago.
- PayPal Subscriptions o cualquier cobro recurrente automatico. El soporte se cobra con links de pago unico.
- Facturacion fiscal o integracion contable. El alcance es un recibo interno.
- Automatizar reembolsos o contracargos. Se registran manualmente en el CRM.
- Checkout publico embebido en el sitio: el alcance es un checkout alojado por PayPal enlazado desde el admin.
- Cobros en ARS por PayPal o conversion de un cobro de ARS a USD.

## 7. Decisiones resueltas

| ID | Decision |
|----|----------|
| **PA-1** | PayPal aplica a soporte mensual y a hitos de proyectos. |
| **PA-2** | Se usa un link de pago unico (PayPal Orders). No se usan Subscriptions. |
| **PA-3** | Solo USD. No se acepta ARS por PayPal ni se convierte un cobro de ARS. |
| **PA-4** | Gross-up: el cliente paga el monto acordado mas la comision de PayPal. El CRM registra monto acordado, comision y total cobrado; el recibo muestra el desglose. La formula exacta de la comision se define en el plan. |
| **PA-5** | El link vale 30 dias y es regenerable al vencer. |
| **PA-6** | El registro manual es solo para el admin, con evidencia y la misma idempotencia por `externalId`. |
| **PA-7** | Los reembolsos y contracargos son manuales en el CRM. Se conserva el pago original y el admin decide si revierte el hito o descuenta meses. |
| **PA-8** | Los links de Mercado Pago y PayPal pueden coexistir. El primer pago confirmado gana, invalida el otro link y se conserva la trazabilidad de ambos. |
| **PA-9** | Los links de Mercado Pago existentes quedan intactos; PayPal se puede generar para el mismo cobro pendiente. |
| **PA-10** | Recibo interno. La factura fiscal queda fuera de alcance. |
| **PA-11** | Sandbox obligatorio antes de produccion. Las credenciales y el webhook los configura el dueno. |
| **PA-12** | PayPal maneja la conversion si el pagador usa otra moneda; el CRM registra USD. |
| **PA-13** | Admin y asistente pueden operar los cobros PayPal. Las decisiones de reembolso y contracargo quedan reservadas al admin (PA-7). |
| **PA-14** | Plantillas de email y WhatsApp en espanol e ingles. |
| **PA-15** | Soporte de 1 a 12 meses, igual que Mercado Pago. |
| **PA-16** | Las diferencias de monto quedan para revision; no se marcan pagadas automaticamente. |
| **PA-17** | Guardar solo email o nombre del pagador si es necesario para el recibo; nunca en logs. |
| **PA-18** | Permitir el pago como invitado si PayPal lo permite. |
| **PA-19** | No aplica porque PA-2 eligio Orders. Subscriptions queda fuera de alcance. |
