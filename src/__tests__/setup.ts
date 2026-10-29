import "@testing-library/jest-dom/vitest"
import { instalarGuardRedPasarelas } from "./helpers/guard-paypal-red"

// T-33 (AC-21) + T-06 (AC-22): la suite no hace llamadas reales a PayPal ni a
// Mercado Pago. Cualquier test que intente salir a *.paypal.com o
// *.mercadopago.com sin mockear `fetch` falla con un mensaje accionable. El
// guard solo envuelve `fetch` (no otros clientes HTTP). La validacion sandbox
// final se corre en Railway staging (plan.md §7.7), fuera de CI; local/ngrok es
// solo desarrollo.
instalarGuardRedPasarelas()
