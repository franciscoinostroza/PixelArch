-- ============================================================================
-- 001-paypal-pagos — Backfill de datos historicos de "Pago"
-- Plan: specs/001-paypal-pagos/plan.md §4.2
-- Tareas: T-37 (staging) y T-38 (produccion, solo tras aprobacion)
-- ============================================================================
--
-- CUANDO EJECUTAR
--   1. Despues de `prisma db push` (las columnas nuevas ya existen).
--   2. Antes de desplegar el codigo que lee `pasarela`, `origen`,
--      `montoAcordado` o `montoEsperado`.
--   3. Solo si la base tiene pagos previos. En un staging nuevo y vacio
--      (`SELECT count(*) FROM "Pago"` = 0) NO hace falta ejecutarlo.
--
-- DONDE EJECUTAR
--   - T-37: solo contra el Postgres de staging.
--   - T-38: contra produccion, una sola vez, con backup/ventana acordada y
--     aprobacion explicita del dueno. Nunca durante T-37.
--
-- SALVAGUARDAS
--   - No contiene DDL, no borra filas y es idempotente.
--   - El archivo ejecuta BEGIN ... COMMIT. Si se quiere revisar los conteos
--     antes de confirmar, copiar las tres UPDATE en una sesion psql dentro de
--     BEGIN, verificar y recien ejecutar COMMIT (o ROLLBACK si algo no cuadra).
--   - No pegar connection strings ni la salida completa en la evidencia.
--   - Prohibido `prisma db push --force-reset` / `--accept-data-loss`.
--
-- VERIFICACION PREVIA (ejecutar aparte, solo SELECT):
--   SELECT
--     count(*) FILTER (WHERE "metodo" = 'MERCADOPAGO' AND "pasarela" = 'MANUAL') AS a_migrar_pasarela,
--     count(*) FILTER (WHERE "metodo" = 'MERCADOPAGO' AND "registradoPor" = 'Mercado Pago' AND "origen" = 'MANUAL') AS a_migrar_origen,
--     count(*) FILTER (WHERE "montoAcordado" IS NULL) AS a_completar_montos
--   FROM "Pago";
--
-- ============================================================================

BEGIN;

-- 1) Pagos de Mercado Pago registrados por la pasarela quedan con pasarela MP.
UPDATE "Pago"
SET "pasarela" = 'MERCADOPAGO'
WHERE "metodo" = 'MERCADOPAGO' AND "pasarela" = 'MANUAL';

-- 2) Los pagos creados automaticamente por el webhook de MP quedan como AUTOMATICO.
UPDATE "Pago"
SET "origen" = 'AUTOMATICO'
WHERE "metodo" = 'MERCADOPAGO' AND "registradoPor" = 'Mercado Pago';

-- 3) Compatibilidad de montos: el total cobrado pasa a ser acordado y esperado.
UPDATE "Pago"
SET "montoAcordado" = "monto", "montoEsperado" = "monto"
WHERE "montoAcordado" IS NULL;

-- Si se ejecuto el archivo completo, la transaccion ya commiteo.
-- Para revisar antes de confirmar, ejecutar las tres UPDATE por separado
-- dentro de BEGIN y decidir COMMIT o ROLLBACK en esa sesion.
COMMIT;

-- ============================================================================
-- VERIFICACION POSTERIOR (ejecutar aparte, solo SELECT):
--   SELECT count(*) AS pendientes_pasarela
--   FROM "Pago" WHERE "metodo" = 'MERCADOPAGO' AND "pasarela" = 'MANUAL';
--
--   SELECT count(*) AS pendientes_origen
--   FROM "Pago" WHERE "metodo" = 'MERCADOPAGO' AND "registradoPor" = 'Mercado Pago'
--     AND "origen" = 'MANUAL';
--
--   SELECT count(*) AS pendientes_montos
--   FROM "Pago" WHERE "montoAcordado" IS NULL;
--
-- Esperado: 0, 0 y 0. Los pagos historicos no se recalculan ni se borran.
-- ============================================================================
