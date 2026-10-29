# Tareas 002: Recibo interno imprimible de Mercado Pago

**Spec:** ./spec.md · **Plan:** ./plan.md
**Rama:** `paypal-staging` · **Gate:** no merge/deploy a produccion antes de T-38.

Formato: `- [ ] T-XX (AC-x) descripcion · archivos · dependencias`.
Una tarea = un cambio revisable (~1 commit). El implementer hace una por ciclo; tester y reviewer validan antes de marcar `[x]`.
No se toca `prisma/schema.prisma`, `Dockerfile`, `package.json`, envs ni `railway.toml`.

## Fase 1: Dominio y elegibilidad

- [x] **T-01 (AC-6, AC-7, AC-9, AC-10, AC-11, AC-12, AC-25) Dominio del recibo MP**
  - Modificar `src/lib/mp-utils.ts` (browser-safe, sin `node:crypto`): `ESTADOS_RECIBO_MERCADOPAGO`, `esEstadoReciboMercadoPago`, `ReciboMpValidationError`, `validarMontosReciboMp`, `monedaReciboMp`, `resolverFechaReciboMp`, `RECIBO_MP_REFERENCIA_MAX`, `RECIBO_MP_CONCEPTO_MAX` y el tipo `ReciboMercadoPago`.
  - Crear `src/lib/mp-recibo.ts` (server-only): `RECIBO_MP_PREFIJO`, `RECIBO_MP_HASH_HEX`, `RECIBO_MP_ID_MAX`, `generarReciboIdMp` (SHA-256), `construirReciboMercadoPago`, `evaluarDatosReciboMercadoPago`. Importa los helpers de `mp-utils.ts`; no importa Prisma, React ni red.
  - Identificador `MP-AAAAMMDD-<32 hex>`: SHA-256 de la referencia recortada a 128 bits, fecha UTC (`reciboEmitidoEn ?? creadoEn`), sin PII, sin ids internos, sin `PAY-`. No se persiste.
  - Montos enteros no negativos; `montoAcordado ?? monto`; `comision ?? 0`; exigir `montoAcordado + comision === total`. Moneda solo `ars`/`usd`. Fecha valida. Referencia y concepto obligatorios con maximos.
  - Estados con recibo: `SUCCEEDED`, `REVISION`, `REFUNDED`, `CONTRACARGO`. `FAILED`, `PENDING`, `null` y desconocidos no.
  - Crear `src/__tests__/lib/mp-recibo.test.ts` (id, construccion, evaluacion, claves exactas) y extender `src/__tests__/lib/mp-utils.test.ts` (montos, moneda, fecha, estados): formato/estabilidad/unicidad/sin PII; ARS/USD; comision 0 y >0; `montoAcordado` nulo; totales inconsistentes; fecha/moneda/referencia invalidas; estados.
  - **Hecho cuando:** `node node_modules\vitest\vitest.mjs run src/__tests__/lib/mp-recibo.test.ts src/__tests__/lib/mp-utils.test.ts` pasa; `tsc --noEmit` limpio.
  - **Deps:** ninguna.
  - **PASS tester+reviewer; recs no bloqueantes:** trim de referencia y UTC fecha/ID/estadoUI a cubrir en T-04/T-05; flake registrar-pago-paypal documentado para T-08; import "server-only" opcional.

- [x] **T-02 (AC-8, AC-9, AC-10, AC-11, AC-18, AC-19, AC-20, AC-21) Pasarela efectiva y elegibilidad MP en el historial**
  - Modificar `src/lib/paypal/view.ts`:
    - exportar `pasarelaEfectivaPago({ pasarela, metodo })` con la regla actual de `/admin/pagos`: `pasarela` manda salvo `MANUAL`/nula/invalida; luego `metodo`; si no, `MANUAL`;
    - agregar `metodo` a `PagoHistorialInput`;
    - ampliar `ElegibilidadReciboInput` (`metodo`, `estadoPago`, `monto`, `montoAcordado`, `comision`, `moneda`, `creadoEn`);
    - ampliar `MotivoReciboHistorial` (`PASARELA_NO_ELEGIBLE`, `ESTADO_NO_ELEGIBLE`, `DATOS_INCONSISTENTES`) y reemplazar `NO_PAYPAL`;
    - `evaluarElegibilidadRecibo`: PayPal conserva su regla (reciboId + referencia); MP usa `esEstadoReciboMercadoPago`, `resolverFechaReciboMp`, `validarMontosReciboMp`, `monedaReciboMp` y el maximo de `RECIBO_MP_REFERENCIA_MAX` de `mp-utils.ts` (nunca `mp-recibo.ts`), con `reciboId: null` porque el id se calcula en la pagina; manual no elegible;
    - `mapearPagoHistorial` calcula la pasarela efectiva y la pasa a referencias y recibo; `recibo.href` solo si disponible.
  - Modificar `src/app/(admin)/admin/pagos/page.tsx`: eliminar `pasarelaDesdeMetodo`/`pasarelaDePago` local y usar `pasarelaEfectivaPago`.
  - `src/app/(admin)/admin/clientes/[id]/page.tsx` no requiere cambio de codigo: `mapearPagoHistorial(p)` ya recibe `metodo`; verificar que el link MP aparece.
  - Actualizar tests:
    - `src/__tests__/lib/paypal-view.test.ts`: reemplazar el caso "nunca habilita MP o manual" por MP elegible / manual no elegible / sin referencia / estados / historico `pasarela=MANUAL` + `metodo=MERCADOPAGO` / montos inconsistentes; conservar todos los casos PayPal.
    - `src/__tests__/components/pagos-paypal.test.tsx`: la fila MP del fixture ahora tiene "Ver recibo"; ajustar el conteo/aserciones sin quitar las de PayPal. Ojo: los `getByRole("link", { name: /ver recibo/i })` que hoy esperan un solo link pasan a `getAllByRole` o a `within(fila)`.
    - `src/__tests__/components/cliente-paypal.test.tsx`: invertir "no muestra recibo para un pago de Mercado Pago" por "muestra el recibo MP elegible" (verificar el href `/admin/pagos/pago_mp/recibo`); conservar manual y PayPal sin recibo. Revisar los `getByRole` singulares del historial: con MP elegible hay dos links; usar `within(fila)` o `getAllByRole` y mantener las aserciones PayPal.
  - **Hecho cuando:** los tres archivos de test pasan; `/admin/pagos` y el detalle muestran el link MP sin cambios de layout.
  - **Deps:** T-01.

## Fase 2: Presentacion imprimible

- [x] **T-03 (AC-15, AC-16, AC-21, AC-26) Componente generico y adaptador PayPal**
  - Crear `src/components/ui/recibo-pago.tsx` (`"use client"`): boton "Imprimir recibo" (`window.print`, `print:hidden`, foco visible), `<article aria-labelledby>`, encabezado (numero de recibo con `break-words`), `<dl>`, tabla con `aria-label="Desglose del pago"`, `caption` sr-only, `th scope`, `tfoot`, nota y pie.
  - Fecha con `Intl.DateTimeFormat("es-AR", { timeZone: "UTC" })`; sin `new Date()` en render.
  - Refactorizar `src/components/ui/recibo-paypal.tsx` como adaptador: mismos exports/props (`ReciboPaypal`, `ReciboPaypalProps`, `ReciboPaypalCliente`), mismos textos, clases e `idTitulo="recibo-paypal-titulo"`. No cambiar su salida.
  - Agregar `@page { size: A4; margin: 12mm }` al bloque de impresion de `src/app/(admin)/admin.css`.
  - Tests: los existentes `src/__tests__/components/recibo-paypal.test.tsx` y `src/__tests__/app/recibo-paypal-page.test.tsx` deben pasar en T-03 (la pagina sigue usando el adaptador PayPal); T-05 cambia un solo fixture de la pagina PayPal por la nueva elegibilidad MP. Extender la asercion de CSS para `@page`/A4; agregar un caso de dos renders con la misma fecha si no queda cubierto.
  - **Hecho cuando:** la suite PayPal de recibo sigue verde y el CSS declara A4; no hay cambios de textos/clases en el DOM PayPal.
  - **Deps:** ninguna (puede ir en paralelo con T-02). Hacer antes de T-04.

- [x] **T-04 (AC-3, AC-6, AC-7, AC-13, AC-15, AC-16, AC-26) Componente del recibo Mercado Pago**
  - Crear `src/components/ui/recibo-mercadopago.tsx` (`"use client"`): recibe `ReciboMercadoPagoDatos` (`import type { ReciboMercadoPago as ReciboMercadoPagoDatos } from "@/lib/mp-utils"`, browser-safe), cliente y estado; delega en `ReciboPago`.
  - Filas: "Monto acordado" siempre; "Comisión de Mercado Pago" solo si `comision > 0`; total "Total cobrado (ARS|USD)". Nota y `caption` segun moneda/comision. `idTitulo="recibo-mercadopago-titulo"`.
  - El generico `ReciboPago` muestra el estado con `estadoUI`; el test verifica "Pagado", "En revision", "Reembolsado" y "Contracargo", y que `REVISION`/`REFUNDED`/`CONTRACARGO` nunca digan "Pagado".
  - Crear `src/__tests__/components/recibo-mercadopago.test.tsx`: contenido, ARS `$... ARS` sin `US$`, USD `US$...` sin `$... ARS`, comision 0 sin fila de comision, comision >0 con desglose, sin PII del pagador, `print:hidden`, caption/scope, estado como texto, misma fecha en dos renders.
  - **Hecho cuando:** el test del componente pasa y el componente no importa `mp-recibo` en runtime.
  - **Deps:** T-01, T-03.
  - **Review T-03:** usar el default de reciboIdClassName (break-words); agregar test directo de ReciboPago (idTitulo/break-words) o cubrir el default; asertar break-words en la referencia externa.

## Fase 3: Pagina y bordes

- [x] **T-05 (AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-12, AC-13, AC-14, AC-17) Pagina del recibo MP (camino feliz)**
  - Modificar `src/app/(admin)/admin/pagos/[id]/recibo/page.tsx`:
    - `requireStaff()` primero; sin staff `redirect("/admin")` sin consultar;
    - una sola `prisma.pago.findUnique` con `cliente`, `hito.proyecto`, `suscripcion.servicio`, `enlacePago.concepto`;
    - `if (!pago || !pago.cliente) notFound()`;
    - `pasarelaEfectivaPago(pago)` y bifurcacion: PayPal conserva el codigo actual; MP usa `evaluarDatosReciboMercadoPago` y `ReciboMercadoPago`; `MANUAL` -> `notFound()`;
    - concepto MP: si hay `enlacePago.concepto`, usarlo; si no, si hay hito, `${proyecto.titulo} — ${hito.titulo}`; si no, si hay soporte, `tituloLink(servicio.nombre, meses ?? 0)`; si no, `"Pago Mercado Pago"`;
    - fecha `reciboEmitidoEn ?? creadoEn`; sin fetch, sin email, sin mutaciones.
  - Crear `src/__tests__/app/recibo-mp-page.test.tsx` con Prisma/navegacion mockeados: redirect sin staff y sin consulta; asistente; pago `SUCCEEDED` (marca, titulo, id, estado, cliente, concepto, fecha, pasarela, referencia, moneda); hito; soporte N meses; ARS; USD con referencia externa (historico/futuro; el alta manual actual no la guarda); referencia exacta; PII extra no visible; nota/evidencia/revision/mpLink, `registradoPor` y origen no visibles; `prisma.pago.update/updateMany/create/delete` y `sendPaymentReceipt` no llamados.
  - En `src/__tests__/app/recibo-paypal-page.test.tsx` cambiar solo el fixture del caso "no es de PayPal" de `MERCADOPAGO` a `MANUAL`, para conservar la intencion (MP ahora tiene recibo).
  - **Hecho cuando:** el test nuevo pasa, el test PayPal sigue pasando y la pagina hace exactamente una consulta al pago (`findUnique`).
  - **Deps:** T-01, T-02, T-04.
  - **Review T-02:** bifurcar con `pasarelaEfectivaPago(pago)`, no `pago.pasarela` cruda; manejar concepto > `RECIBO_MP_CONCEPTO_MAX` (truncar/rechazar) para evitar link muerto; cubrir PayPal legacy `MANUAL`+`metodo=PAYPAL`.
  - **Review T-04:** normalizar estado trim/upper antes de estadoUI; truncar/rechazar concepto > RECIBO_MP_CONCEPTO_MAX; construir ReciboMercadoPagoDatos solo desde evaluarDatos/construir (moneda fail-open); select de Prisma solo cliente.nombre/email; usar el mismo Date para id y documento; pasarelaEfectivaPago y PayPal legacy.

- [ ] **T-06 (AC-8, AC-9, AC-10, AC-17, AC-19, AC-20, AC-22, AC-23, AC-25, AC-26) Bordes, seguridad y regresion de la pagina MP**
  - Extender `src/__tests__/app/recibo-mp-page.test.tsx`:
    - `FAILED` y `PENDING` -> `notFound`, sin recibo;
    - `REFUNDED`/`CONTRACARGO` -> recibo con estado real, nunca "Pagado", montos intactos;
    - `REVISION` -> "En revision", nunca "Pagado";
    - historico `pasarela=MANUAL` + `metodo=MERCADOPAGO` -> recibo;
    - sin `externalId` -> `notFound`, sin inventar referencia;
    - `@/lib/mercadopago` mockeado y `obtenerPagoMp` no llamado (AC-22);
    - no se envia email (AC-23);
    - monto que no reconcilia, fecha invalida, referencia vacia/larga o cliente faltante -> `notFound` (AC-25);
    - dos renders/impresiones con la misma fecha -> mismo texto (AC-26).
  - Corregir la pagina solo si los tests revelan un hueco (guardas de datos, `notFound`).
  - Opcional recomendado: extender el guard de red de `src/__tests__/setup.ts` a `*.mercadopago.com` con un helper test-only, sin tocar producto.
  - **Review T-04:** cubrir estado lowercase, concepto >200, moneda inesperada y PII real del select; considerar TZ America/Argentina/Buenos_Aires para el test de fecha.
  - **Review T-05:** evaluar select explícito least-privilege; spy real de email; truncado por code points; helper de concepto compartido MP/PayPal; extender guard de red a *.mercadopago.com; cubrir externalId con espacios/trim.
  - **Hecho cuando:** todos los bordes pasan y no hay llamadas reales a MP ni emails.
  - **Deps:** T-05.

## Fase 4: Cierre

- [ ] **T-07 (AC-24) Documentacion y trazabilidad**
  - Actualizar `AGENTS.md`: recibo MP disponible en `/admin/pagos` y detalle; sin cambios de esquema; estado T-38; retirar "recibo imprimible de Mercado Pago" del backlog.
  - Actualizar `MEMORY.md`: identificador derivado, elegibilidad (estados/referencia), A4, sin red/email, gate T-38.
  - Revisar que cada AC de `spec.md` tenga al menos una tarea/test en este archivo; anotar cualquier desvio.
  - **Hecho cuando:** docs coherentes y matriz AC -> tarea completa.
  - **Deps:** T-01..T-06.
  - **Review T-03:** documentar reciboIdClassName como desvío del plan §2.4 y su motivo (paridad DOM PayPal).
  - **Review T-04:** evaluar import "server-only" en mp-recibo como defensa en profundidad (opcional).

- [ ] **T-08 (AC-21, AC-24) Verificacion final**
  - Ejecutar `node node_modules\vitest\vitest.mjs run` (suite completa, sin watch).
  - Ejecutar `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint` (sin errores nuevos sobre el baseline) y `node node_modules\next\dist\bin\next build`.
  - Confirmar que los tests PayPal de recibo, proceso e idempotencia siguen verdes y que no hay llamadas reales a MP/PayPal.
  - **Hecho cuando:** suite/typecheck/build limpios; lint sin errores nuevos; resultados anotados para el reviewer.
  - **Deps:** T-01..T-07.
  - **Review T-02 (opcional):** test barato de `/admin/cobros` sin link; evaluar alinear `coincideFiltroHistorial` con `metodo` (R-11).
  - **Review T-03:** opcional snapshot/innerHTML golden del recibo PayPal previo; acotar el test CSS al bloque @media print.
  - **Review T-05:** confirmar que los timeouts de registrar-pago-paypal son preexistentes; suite/build final.

- [ ] **T-09 (AC-19, AC-21, AC-22) Gate de staging y T-38 (sin codigo, no es commit)**
  - En staging (`paypal-staging`, esquema ya aplicado): abrir un recibo MP historico/seed con `externalId`, un pago MP confirmado de staging, un recibo PayPal, verificar links en `/admin/pagos` y detalle, rol asistente y una impresion A4.
  - Confirmar que `/admin/cobros` no muestra "Ver recibo".
  - **No mergear a `main` ni deployar a produccion antes de T-38** (`db push` + backfill en produccion, FF-merge y envs/webhook live).
  - Smoke post-T-38: health, pagos, detalle, recibo MP, recibo PayPal, asistente.
  - **Hecho cuando:** checklist de staging completo y T-38 autorizado/ejecutado en el orden acordado.
  - **Deps:** T-08.
  - **Review T-02:** click real sobre un link MP, un PayPal actual y un PayPal legacy `MANUAL`+`metodo=PAYPAL`; confirmar `/admin/cobros` sin "Ver recibo".
  - **Review T-03:** verificar A4 físico y precedencia de @page (globals 2cm vs admin 12mm); imprimir referencia de 128 chars.
  - **Review T-04:** @page ya anotado; verificar A4 físico y margen.

## Cobertura AC -> tarea

| AC | Tareas |
|----|--------|
| AC-1 | T-05 |
| AC-2 | T-05 |
| AC-3 | T-04, T-05 |
| AC-4 | T-05 |
| AC-5 | T-05 |
| AC-6 | T-01, T-04, T-05 |
| AC-7 | T-01, T-04, T-05 |
| AC-8 | T-02, T-06 |
| AC-9 | T-01, T-02, T-04, T-06 |
| AC-10 | T-01, T-02, T-04, T-06 |
| AC-11 | T-01, T-02 |
| AC-12 | T-01, T-05 |
| AC-13 | T-04, T-05 |
| AC-14 | T-05 |
| AC-15 | T-03, T-04 |
| AC-16 | T-03, T-04 |
| AC-17 | T-05, T-06 |
| AC-18 | T-02 |
| AC-19 | T-02, T-06, T-09 |
| AC-20 | T-02, T-06 |
| AC-21 | T-02, T-03, T-08, T-09 |
| AC-22 | T-06, T-09 |
| AC-23 | T-06 |
| AC-24 | T-07, T-08 |
| AC-25 | T-01, T-06 |
| AC-26 | T-03, T-04, T-06 |

## Notas de ejecucion

- Comandos: `node node_modules\vitest\vitest.mjs run`, `node node_modules\typescript\bin\tsc --noEmit`, `npm run lint`, `node node_modules\next\dist\bin\next build`.
- Tests focalizados: `node node_modules\vitest\vitest.mjs run src/__tests__/lib/mp-utils.test.ts src/__tests__/lib/mp-recibo.test.ts src/__tests__/lib/paypal-view.test.ts src/__tests__/components/recibo-mercadopago.test.tsx src/__tests__/app/recibo-mp-page.test.tsx`.
- No usar `npm test` en watch; no tocar la base real; mockear Prisma y la navegacion.
- Marcar `[x]` solo despues de tester + reviewer. Si un AC cambia, actualizar spec/plan/tasks en el mismo cambio.
