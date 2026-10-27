import "@testing-library/jest-dom/vitest"
import { instalarGuardRedPaypal } from "./helpers/guard-paypal-red"

// T-33 (AC-21): la suite no hace llamadas reales a PayPal. Cualquier test que
// intente salir a *.paypal.com sin mockear `fetch` falla con un mensaje
// accionable. El guard solo envuelve `fetch` (no otros clientes HTTP). La
// validacion sandbox final se corre en Railway staging (plan.md §7.7), fuera
// de CI; local/ngrok es solo desarrollo.
instalarGuardRedPaypal()
