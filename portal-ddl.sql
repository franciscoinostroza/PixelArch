-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlanTipo" AS ENUM ('UNICO', 'BASICO', 'MANTENIMIENTO', 'SOPORTE');

-- CreateEnum
CREATE TYPE "Estado" AS ENUM ('PENDING', 'READY', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "EstadoProyecto" AS ENUM ('ACTIVO', 'ENTREGADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "EstadoHito" AS ENUM ('PENDIENTE', 'PAGADO');

-- CreateEnum
CREATE TYPE "MetodoPago" AS ENUM ('TRANSFERENCIA', 'MERCADOPAGO', 'PAYPAL', 'EFECTIVO', 'OTRO');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('SUCCEEDED', 'FAILED', 'REFUNDED', 'PENDING', 'REVISION', 'CONTRACARGO');

-- CreateEnum
CREATE TYPE "Pasarela" AS ENUM ('MANUAL', 'MERCADOPAGO', 'PAYPAL');

-- CreateEnum
CREATE TYPE "OrigenPago" AS ENUM ('AUTOMATICO', 'MANUAL');

-- CreateEnum
CREATE TYPE "EstadoEnlace" AS ENUM ('CREANDO', 'ACTIVO', 'PAGADO', 'VENCIDO', 'INVALIDADO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "EstadoRevision" AS ENUM ('PENDIENTE', 'ACEPTADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "TipoAjuste" AS ENUM ('REEMBOLSO', 'CONTRACARGO');

-- CreateEnum
CREATE TYPE "DecisionAjuste" AS ENUM ('NINGUNA', 'REVERTIR_HITO', 'DESCONTAR_MESES');

-- CreateEnum
CREATE TYPE "EstadoCampanaProspeccion" AS ENUM ('BORRADOR', 'EN_CURSO', 'COMPLETADA', 'PARCIAL', 'CANCELADA', 'FALLIDA');

-- CreateEnum
CREATE TYPE "EstadoProspecto" AS ENUM ('NUEVO', 'SIN_ENRIQUECER', 'ENRIQUECIDO', 'PUNTUADO', 'BORRADOR', 'APROBADO', 'ENVIADO', 'RESPONDIO', 'DESCARTADO', 'SUPRIMIDO');

-- CreateEnum
CREATE TYPE "EstadoEnvioPropuesta" AS ENUM ('BORRADOR', 'APROBADO', 'ENVIANDO', 'ENVIADO', 'FALLIDO', 'REBOTADO', 'QUEJA', 'RESPONDIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "AmbitoSupresion" AS ENUM ('EMAIL', 'DOMINIO');

-- CreateEnum
CREATE TYPE "MotivoSupresion" AS ENUM ('OPT_OUT', 'REBOTE_DURO', 'QUEJA', 'MANUAL', 'SOLICITUD_ARCO');

-- CreateEnum
CREATE TYPE "OrigenSupresion" AS ENUM ('ENLACE', 'MANUAL', 'ARCO');

-- CreateEnum
CREATE TYPE "FuenteDatoProspecto" AS ENUM ('PLACES', 'WEB_NEGOCIO', 'CARGA_MANUAL');

-- CreateEnum
CREATE TYPE "ProveedorConsumo" AS ENUM ('GOOGLE_PLACES', 'WEB_FETCH', 'AUDITORIA', 'REDACTOR', 'RESEND');

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "empresa" TEXT,
    "telefono" TEXT,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Servicio" (
    "id" TEXT NOT NULL,
    "slug" TEXT,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "icono" TEXT,
    "tags" TEXT[],
    "precioUnico" INTEGER NOT NULL,
    "precioBasico" INTEGER NOT NULL,
    "precioMantenimiento" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suscripcion" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "plan" "PlanTipo" NOT NULL,
    "estado" "Estado" NOT NULL,
    "deploymentId" TEXT,
    "deploymentPlatform" TEXT,
    "platformServiceId" TEXT,
    "proximoPago" TIMESTAMP(3),
    "entregadoEn" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceladoEn" TIMESTAMP(3),
    "pastDueEn" TIMESTAMP(3),
    "precioCustom" INTEGER,
    "ultimoRecordatorioEn" TIMESTAMP(3),
    "mpLink" TEXT,
    "mpPreferenceId" TEXT,
    "mpLinkExpira" TIMESTAMP(3),
    "mpLinkMeses" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suscripcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pago" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "suscripcionId" TEXT,
    "hitoId" TEXT,
    "enlacePagoId" TEXT,
    "externalId" TEXT,
    "paypalOrderId" TEXT,
    "monto" INTEGER NOT NULL,
    "montoAcordado" INTEGER,
    "comision" INTEGER NOT NULL DEFAULT 0,
    "montoEsperado" INTEGER,
    "meses" INTEGER,
    "feeBps" INTEGER,
    "feeFixedCents" INTEGER,
    "moneda" TEXT NOT NULL DEFAULT 'usd',
    "cotizacion" DOUBLE PRECISION,
    "metodo" "MetodoPago",
    "pasarela" "Pasarela" NOT NULL DEFAULT 'MANUAL',
    "origen" "OrigenPago" NOT NULL DEFAULT 'MANUAL',
    "nota" TEXT,
    "evidencia" TEXT,
    "registradoPor" TEXT,
    "estadoPago" "EstadoPago" NOT NULL,
    "reciboId" TEXT,
    "reciboEmitidoEn" TIMESTAMP(3),
    "revisionEstado" "EstadoRevision",
    "revisionNota" TEXT,
    "revisionResueltaPor" TEXT,
    "revisionResueltaEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnlacePago" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "hitoId" TEXT,
    "suscripcionId" TEXT,
    "pasarela" "Pasarela" NOT NULL,
    "concepto" TEXT NOT NULL,
    "descripcion" TEXT,
    "notaInterna" TEXT,
    "montoAcordado" INTEGER NOT NULL,
    "comision" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'usd',
    "meses" INTEGER,
    "feeBps" INTEGER NOT NULL DEFAULT 0,
    "feeFixedCents" INTEGER NOT NULL DEFAULT 0,
    "url" TEXT,
    "checkoutUrl" TEXT,
    "externalId" TEXT,
    "estado" "EstadoEnlace" NOT NULL DEFAULT 'CREANDO',
    "grupoCobroId" TEXT NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "orderExpiraEn" TIMESTAMP(3),
    "generadoPor" TEXT,
    "generadoPorNombre" TEXT,
    "enviadoPor" TEXT,
    "enviadoEn" TIMESTAMP(3),
    "canalEnvio" TEXT,
    "idioma" TEXT,
    "invalidadoEn" TIMESTAMP(3),
    "motivoInvalido" TEXT,
    "ultimoError" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnlacePago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoPasarela" (
    "id" TEXT NOT NULL,
    "pasarela" "Pasarela" NOT NULL,
    "eventoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "externalId" TEXT,
    "enlacePagoId" TEXT,
    "pagoId" TEXT,
    "resultado" TEXT NOT NULL,
    "motivo" TEXT,
    "monto" INTEGER,
    "moneda" TEXT,
    "requiereAccion" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesadoEn" TIMESTAMP(3),

    CONSTRAINT "EventoPasarela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AjustePago" (
    "id" TEXT NOT NULL,
    "pagoId" TEXT NOT NULL,
    "tipo" "TipoAjuste" NOT NULL,
    "monto" INTEGER NOT NULL,
    "motivo" TEXT,
    "evidencia" TEXT,
    "decision" "DecisionAjuste" NOT NULL DEFAULT 'NINGUNA',
    "mesesDescontados" INTEGER,
    "registradoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AjustePago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proyecto" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "servicioId" TEXT,
    "titulo" TEXT NOT NULL,
    "montoTotal" INTEGER NOT NULL,
    "estado" "EstadoProyecto" NOT NULL DEFAULT 'ACTIVO',
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proyecto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hito" (
    "id" TEXT NOT NULL,
    "proyectoId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "monto" INTEGER NOT NULL,
    "estado" "EstadoHito" NOT NULL DEFAULT 'PENDIENTE',
    "vencimiento" TIMESTAMP(3),
    "pagadoEn" TIMESTAMP(3),
    "mpLink" TEXT,
    "mpPreferenceId" TEXT,
    "mpLinkExpira" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UptimeCheck" (
    "id" TEXT NOT NULL,
    "servicio" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "latenciaMs" INTEGER NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UptimeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampanaProspeccion" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "consulta" TEXT NOT NULL,
    "zona" TEXT,
    "rubro" TEXT,
    "filtros" JSONB,
    "estado" "EstadoCampanaProspeccion" NOT NULL DEFAULT 'BORRADOR',
    "limiteCorrida" INTEGER NOT NULL DEFAULT 20,
    "plantillaId" TEXT,
    "creadaPor" TEXT NOT NULL,
    "creadaPorNombre" TEXT,
    "idempotencyKey" TEXT,
    "ultimoError" TEXT,
    "iniciadaEn" TIMESTAMP(3),
    "finalizadaEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampanaProspeccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prospecto" (
    "id" TEXT NOT NULL,
    "nombreNegocio" TEXT NOT NULL,
    "sitioWeb" TEXT,
    "dominioNormalizado" TEXT,
    "ciudad" TEXT,
    "rubro" TEXT,
    "placeId" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "contactoNombre" TEXT,
    "contactoCargo" TEXT,
    "emailFuenteUrl" TEXT,
    "emailFechaFuente" TIMESTAMP(3),
    "fuenteTipo" "FuenteDatoProspecto",
    "fuenteUrl" TEXT,
    "fechaFuente" TIMESTAMP(3),
    "estado" "EstadoProspecto" NOT NULL DEFAULT 'NUEVO',
    "score" INTEGER,
    "scoreDetalle" JSONB,
    "auditoriaResumen" JSONB,
    "auditoriaEstado" TEXT,
    "auditoriaFecha" TIMESTAMP(3),
    "posibleDuplicadoDeId" TEXT,
    "motivoSinEnriquecer" TEXT,
    "baseLegal" TEXT,
    "notaLegal" TEXT,
    "notas" TEXT,
    "arcoHistorial" JSONB,
    "historial" JSONB,
    "actualizadoPor" TEXT,
    "ultimaInteraccionEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoEnvioEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "campanaOrigenId" TEXT NOT NULL,

    CONSTRAINT "Prospecto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantillaPropuesta" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "idioma" TEXT NOT NULL DEFAULT 'es',
    "asunto" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "variablesPermitidas" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaPor" TEXT NOT NULL,
    "creadaPorNombre" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlantillaPropuesta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvioPropuesta" (
    "id" TEXT NOT NULL,
    "prospectoId" TEXT NOT NULL,
    "campanaId" TEXT NOT NULL,
    "plantillaId" TEXT,
    "plantillaVersion" INTEGER,
    "secuencia" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "destinatario" TEXT NOT NULL,
    "fromEmail" TEXT,
    "fromNombre" TEXT,
    "replyTo" TEXT,
    "asunto" TEXT NOT NULL,
    "cuerpoHtml" TEXT NOT NULL,
    "cuerpoTexto" TEXT NOT NULL,
    "hashContenido" TEXT NOT NULL,
    "tokenBaja" TEXT,
    "estado" "EstadoEnvioPropuesta" NOT NULL DEFAULT 'BORRADOR',
    "aprobadoAsunto" TEXT,
    "aprobadoCuerpoHtml" TEXT,
    "aprobadoCuerpoTexto" TEXT,
    "aprobadoHash" TEXT,
    "aprobadoPor" TEXT,
    "aprobadoPorNombre" TEXT,
    "aprobadoEn" TIMESTAMP(3),
    "enviadoPor" TEXT,
    "enviadoPorNombre" TEXT,
    "enviadoEn" TIMESTAMP(3),
    "proveedorMessageId" TEXT,
    "idempotencyKey" TEXT,
    "error" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "motivoCancelacion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvioPropuesta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupresionProspecto" (
    "id" TEXT NOT NULL,
    "ambito" "AmbitoSupresion" NOT NULL,
    "clave" TEXT NOT NULL,
    "emailHash" TEXT,
    "emailEnmascarado" TEXT,
    "dominioNegocio" TEXT,
    "motivo" "MotivoSupresion" NOT NULL,
    "origen" "OrigenSupresion" NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "notas" TEXT,
    "historial" JSONB,
    "creadaPor" TEXT,
    "creadaPorNombre" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocadaPor" TEXT,
    "revocadaEn" TIMESTAMP(3),
    "motivoRevocacion" TEXT,

    CONSTRAINT "SupresionProspecto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumoProveedor" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "campanaId" TEXT NOT NULL,
    "prospectoId" TEXT,
    "proveedor" "ProveedorConsumo" NOT NULL,
    "fecha" DATE NOT NULL,
    "llamadas" INTEGER NOT NULL DEFAULT 0,
    "unidades" INTEGER NOT NULL DEFAULT 0,
    "costoCentavos" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsumoProveedor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_clerkUserId_key" ON "Cliente"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_email_key" ON "Cliente"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Servicio_slug_key" ON "Servicio"("slug");

-- CreateIndex
CREATE INDEX "Suscripcion_clienteId_idx" ON "Suscripcion"("clienteId");

-- CreateIndex
CREATE INDEX "Suscripcion_servicioId_idx" ON "Suscripcion"("servicioId");

-- CreateIndex
CREATE INDEX "Suscripcion_estado_idx" ON "Suscripcion"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "Pago_externalId_key" ON "Pago"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Pago_paypalOrderId_key" ON "Pago"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Pago_reciboId_key" ON "Pago"("reciboId");

-- CreateIndex
CREATE INDEX "Pago_clienteId_idx" ON "Pago"("clienteId");

-- CreateIndex
CREATE INDEX "Pago_suscripcionId_idx" ON "Pago"("suscripcionId");

-- CreateIndex
CREATE INDEX "Pago_hitoId_idx" ON "Pago"("hitoId");

-- CreateIndex
CREATE INDEX "Pago_creadoEn_idx" ON "Pago"("creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "EnlacePago_token_key" ON "EnlacePago"("token");

-- CreateIndex
CREATE UNIQUE INDEX "EnlacePago_externalId_key" ON "EnlacePago"("externalId");

-- CreateIndex
CREATE INDEX "EnlacePago_clienteId_idx" ON "EnlacePago"("clienteId");

-- CreateIndex
CREATE INDEX "EnlacePago_hitoId_idx" ON "EnlacePago"("hitoId");

-- CreateIndex
CREATE INDEX "EnlacePago_suscripcionId_idx" ON "EnlacePago"("suscripcionId");

-- CreateIndex
CREATE INDEX "EnlacePago_estado_idx" ON "EnlacePago"("estado");

-- CreateIndex
CREATE INDEX "EnlacePago_grupoCobroId_idx" ON "EnlacePago"("grupoCobroId");

-- CreateIndex
CREATE INDEX "EnlacePago_expiraEn_idx" ON "EnlacePago"("expiraEn");

-- CreateIndex
CREATE UNIQUE INDEX "EventoPasarela_eventoId_key" ON "EventoPasarela"("eventoId");

-- CreateIndex
CREATE INDEX "EventoPasarela_pasarela_creadoEn_idx" ON "EventoPasarela"("pasarela", "creadoEn");

-- CreateIndex
CREATE INDEX "EventoPasarela_enlacePagoId_idx" ON "EventoPasarela"("enlacePagoId");

-- CreateIndex
CREATE INDEX "EventoPasarela_pagoId_idx" ON "EventoPasarela"("pagoId");

-- CreateIndex
CREATE INDEX "EventoPasarela_requiereAccion_idx" ON "EventoPasarela"("requiereAccion");

-- CreateIndex
CREATE INDEX "AjustePago_pagoId_idx" ON "AjustePago"("pagoId");

-- CreateIndex
CREATE INDEX "Proyecto_clienteId_idx" ON "Proyecto"("clienteId");

-- CreateIndex
CREATE INDEX "Proyecto_estado_idx" ON "Proyecto"("estado");

-- CreateIndex
CREATE INDEX "Hito_proyectoId_idx" ON "Hito"("proyectoId");

-- CreateIndex
CREATE INDEX "Hito_estado_idx" ON "Hito"("estado");

-- CreateIndex
CREATE INDEX "UptimeCheck_servicio_creadoEn_idx" ON "UptimeCheck"("servicio", "creadoEn");

-- CreateIndex
CREATE INDEX "UptimeCheck_creadoEn_idx" ON "UptimeCheck"("creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "CampanaProspeccion_idempotencyKey_key" ON "CampanaProspeccion"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CampanaProspeccion_estado_creadoEn_idx" ON "CampanaProspeccion"("estado", "creadoEn");

-- CreateIndex
CREATE INDEX "CampanaProspeccion_creadaPor_idx" ON "CampanaProspeccion"("creadaPor");

-- CreateIndex
CREATE UNIQUE INDEX "Prospecto_placeId_key" ON "Prospecto"("placeId");

-- CreateIndex
CREATE UNIQUE INDEX "Prospecto_email_key" ON "Prospecto"("email");

-- CreateIndex
CREATE INDEX "Prospecto_estado_actualizadoEn_idx" ON "Prospecto"("estado", "actualizadoEn");

-- CreateIndex
CREATE INDEX "Prospecto_campanaOrigenId_estado_idx" ON "Prospecto"("campanaOrigenId", "estado");

-- CreateIndex
CREATE INDEX "Prospecto_dominioNormalizado_idx" ON "Prospecto"("dominioNormalizado");

-- CreateIndex
CREATE INDEX "Prospecto_posibleDuplicadoDeId_idx" ON "Prospecto"("posibleDuplicadoDeId");

-- CreateIndex
CREATE INDEX "Prospecto_ultimaInteraccionEn_idx" ON "Prospecto"("ultimaInteraccionEn");

-- CreateIndex
CREATE INDEX "PlantillaPropuesta_activa_idx" ON "PlantillaPropuesta"("activa");

-- CreateIndex
CREATE UNIQUE INDEX "PlantillaPropuesta_nombre_version_key" ON "PlantillaPropuesta"("nombre", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EnvioPropuesta_proveedorMessageId_key" ON "EnvioPropuesta"("proveedorMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "EnvioPropuesta_idempotencyKey_key" ON "EnvioPropuesta"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EnvioPropuesta_estado_creadoEn_idx" ON "EnvioPropuesta"("estado", "creadoEn");

-- CreateIndex
CREATE INDEX "EnvioPropuesta_prospectoId_secuencia_idx" ON "EnvioPropuesta"("prospectoId", "secuencia");

-- CreateIndex
CREATE INDEX "EnvioPropuesta_campanaId_estado_idx" ON "EnvioPropuesta"("campanaId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "EnvioPropuesta_prospectoId_secuencia_version_key" ON "EnvioPropuesta"("prospectoId", "secuencia", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SupresionProspecto_clave_key" ON "SupresionProspecto"("clave");

-- CreateIndex
CREATE INDEX "SupresionProspecto_ambito_activa_idx" ON "SupresionProspecto"("ambito", "activa");

-- CreateIndex
CREATE INDEX "SupresionProspecto_emailHash_idx" ON "SupresionProspecto"("emailHash");

-- CreateIndex
CREATE INDEX "SupresionProspecto_dominioNegocio_idx" ON "SupresionProspecto"("dominioNegocio");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumoProveedor_clave_key" ON "ConsumoProveedor"("clave");

-- CreateIndex
CREATE INDEX "ConsumoProveedor_campanaId_proveedor_fecha_idx" ON "ConsumoProveedor"("campanaId", "proveedor", "fecha");

-- CreateIndex
CREATE INDEX "ConsumoProveedor_prospectoId_idx" ON "ConsumoProveedor"("prospectoId");

-- CreateIndex
CREATE INDEX "ConsumoProveedor_proveedor_fecha_idx" ON "ConsumoProveedor"("proveedor", "fecha");

-- AddForeignKey
ALTER TABLE "Suscripcion" ADD CONSTRAINT "Suscripcion_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suscripcion" ADD CONSTRAINT "Suscripcion_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_suscripcionId_fkey" FOREIGN KEY ("suscripcionId") REFERENCES "Suscripcion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_hitoId_fkey" FOREIGN KEY ("hitoId") REFERENCES "Hito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_enlacePagoId_fkey" FOREIGN KEY ("enlacePagoId") REFERENCES "EnlacePago"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnlacePago" ADD CONSTRAINT "EnlacePago_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnlacePago" ADD CONSTRAINT "EnlacePago_hitoId_fkey" FOREIGN KEY ("hitoId") REFERENCES "Hito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnlacePago" ADD CONSTRAINT "EnlacePago_suscripcionId_fkey" FOREIGN KEY ("suscripcionId") REFERENCES "Suscripcion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoPasarela" ADD CONSTRAINT "EventoPasarela_enlacePagoId_fkey" FOREIGN KEY ("enlacePagoId") REFERENCES "EnlacePago"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoPasarela" ADD CONSTRAINT "EventoPasarela_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "Pago"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjustePago" ADD CONSTRAINT "AjustePago_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "Pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proyecto" ADD CONSTRAINT "Proyecto_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proyecto" ADD CONSTRAINT "Proyecto_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hito" ADD CONSTRAINT "Hito_proyectoId_fkey" FOREIGN KEY ("proyectoId") REFERENCES "Proyecto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanaProspeccion" ADD CONSTRAINT "CampanaProspeccion_plantillaId_fkey" FOREIGN KEY ("plantillaId") REFERENCES "PlantillaPropuesta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospecto" ADD CONSTRAINT "Prospecto_campanaOrigenId_fkey" FOREIGN KEY ("campanaOrigenId") REFERENCES "CampanaProspeccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioPropuesta" ADD CONSTRAINT "EnvioPropuesta_prospectoId_fkey" FOREIGN KEY ("prospectoId") REFERENCES "Prospecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioPropuesta" ADD CONSTRAINT "EnvioPropuesta_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "CampanaProspeccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioPropuesta" ADD CONSTRAINT "EnvioPropuesta_plantillaId_fkey" FOREIGN KEY ("plantillaId") REFERENCES "PlantillaPropuesta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoProveedor" ADD CONSTRAINT "ConsumoProveedor_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "CampanaProspeccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoProveedor" ADD CONSTRAINT "ConsumoProveedor_prospectoId_fkey" FOREIGN KEY ("prospectoId") REFERENCES "Prospecto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
