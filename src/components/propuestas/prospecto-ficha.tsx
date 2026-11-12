"use client"

/**
 * T-14 (AC-13, AC-14, AC-19; RF-18, RF-22): ficha de alta y corrección de
 * prospectos.
 *
 * - `ProspectoFicha` es el formulario reutilizable (alta en una campaña o
 *   corrección de un prospecto existente). En la corrección exige motivo y
 *   envía solo los campos que cambiaron; el alta exige nota y al menos una
 *   fuente.
 * - `AltaProspecto` es el panel plegable del detalle de campaña.
 * - `ProspectoAcciones` agrega "Editar" y "Descartar" a cada fila de la tabla;
 *   el descarte pide motivo y confirmación explícita.
 *
 * Reglas de UI:
 * - aviso visible de no pegar datos sensibles ni listas compradas;
 * - límites de longitud visibles en nota y motivo;
 * - estados pending/éxito/error accesibles (`aria-busy`, `role=status`,
 *   `role=alert` y foco en el mensaje);
 * - tras cada éxito se llama a `router.refresh()`;
 * - no se muestran datos del CRM, no se envían emails ni se analiza el sitio;
 * - ninguna PII viaja en la URL (solo el id interno en el path de la API).
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { useRouter } from "next/navigation"
import { Ban, Loader2, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
// Shell de dialogo accesible ya existente (foco, Escape, trampa de foco). No
// aporta datos ni logica de pagos: el portal de propuestas no los toca.
import { PaypalDialog as Dialogo } from "@/components/ui/paypal-dialog"
import {
  PROSPECTO_CIUDAD_MAX,
  PROSPECTO_CONTACTO_MAX,
  PROSPECTO_EMAIL_MAX,
  PROSPECTO_MOTIVO_MAX,
  PROSPECTO_NOMBRE_MAX,
  PROSPECTO_NOTA_MAX,
  PROSPECTO_RUBRO_MAX,
  PROSPECTO_TELEFONO_MAX,
  PROSPECTO_URL_MAX,
  prospectoCreateSchema,
  prospectoDescartarSchema,
  prospectoPatchSchema,
} from "@/lib/propuestas/validation"
import { normalizarSitioManual } from "@/lib/propuestas/prospectos"

export interface ProspectoEditable {
  id: string
  nombreNegocio: string
  sitioWeb: string | null
  email: string | null
  telefono: string | null
  ciudad: string | null
  rubro: string | null
  contactoNombre: string | null
  contactoCargo: string | null
  fuenteUrl: string | null
  emailFuenteUrl: string | null
  estado: string
}

interface ValoresFormulario {
  nombreNegocio: string
  sitioWeb: string
  email: string
  telefono: string
  ciudad: string
  rubro: string
  contactoNombre: string
  contactoCargo: string
  fuenteUrl: string
  emailFuenteUrl: string
  nota: string
  motivo: string
}

type CampoFormulario = keyof ValoresFormulario
type Errores = Partial<Record<CampoFormulario | "general", string>>

interface Mensaje {
  tono: "ok" | "error"
  texto: string
}

const CLASE_AYUDA = "mt-1 text-xs leading-5 text-text-faint"
const CLASE_ERROR = "mt-1 font-mono text-xs text-red-400"
const CLASE_TEXTAREA =
  "flex min-h-[110px] w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text font-mono placeholder:text-text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50"
const CLASE_MENSAJE =
  "rounded-lg border p-3 text-sm leading-6 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
const CLASE_AVISO =
  "rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-text-dim"

const CAMPOS_FORMULARIO = new Set<string>([
  "nombreNegocio",
  "sitioWeb",
  "email",
  "telefono",
  "ciudad",
  "rubro",
  "contactoNombre",
  "contactoCargo",
  "fuenteUrl",
  "emailFuenteUrl",
  "nota",
  "motivo",
])

const AVISO_DATOS =
  "No pegues datos sensibles ni listas compradas. Cargá solo datos profesionales públicos o verificados, con su fuente. Esta pantalla no envía emails ni analiza el sitio."

function valoresIniciales(prospecto?: ProspectoEditable): ValoresFormulario {
  return {
    nombreNegocio: prospecto?.nombreNegocio ?? "",
    sitioWeb: prospecto?.sitioWeb ?? "",
    email: prospecto?.email ?? "",
    telefono: prospecto?.telefono ?? "",
    ciudad: prospecto?.ciudad ?? "",
    rubro: prospecto?.rubro ?? "",
    contactoNombre: prospecto?.contactoNombre ?? "",
    contactoCargo: prospecto?.contactoCargo ?? "",
    fuenteUrl: prospecto?.fuenteUrl ?? "",
    emailFuenteUrl: prospecto?.emailFuenteUrl ?? "",
    nota: "",
    motivo: "",
  }
}

function erroresDeZod(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): Errores {
  const errores: Errores = {}

  for (const issue of issues) {
    const campo = issue.path[0]
    if (typeof campo === "string" && CAMPOS_FORMULARIO.has(campo)) {
      const clave = campo as CampoFormulario
      if (!errores[clave]) errores[clave] = issue.message
    } else if (!errores.general) {
      errores.general = issue.message
    }
  }

  return errores
}

function mensajeDeError(
  codigo: string | undefined,
  modo: "ALTA" | "EDICION" | "DESCARTE",
): string {
  switch (codigo) {
    case "VALIDACION":
      return modo === "ALTA"
        ? "Revisá los datos: hacen falta el nombre, la nota y al menos una fuente válida."
        : "Revisá los datos: el motivo es obligatorio y los campos deben ser válidos."
    case "SUPRIMIDO":
      return "El contacto está suprimido. No se modifica hasta revocar la supresión con una acción administrativa."
    case "ESTADO":
      return "La operación ya no es válida en el estado actual o el email ya pertenece a otro prospecto. Se actualizó la página."
    case "NO_ENCONTRADO":
      return "El prospecto no existe o fue eliminado."
    case "RATE_LIMIT":
      return "Demasiadas solicitudes. Esperá un minuto y volvé a intentar."
    case "NO_CONFIGURADO":
      return "La verificación de supresión no está configurada. Avisá al responsable técnico; no se guardó nada."
    case "ORIGEN_INVALIDO":
      return "La solicitud no proviene del portal. Recargá la página e intentá de nuevo."
    case "NO_AUTORIZADO":
      return "Tu sesión venció. Volvé a ingresar al portal."
    case "PROHIBIDO":
      return "No tenés permisos para operar sobre prospectos."
    case "ESQUEMA_NO_APLICADO":
      return "El esquema del portal no está aplicado. Avisá al responsable técnico."
    default:
      return modo === "DESCARTE"
        ? "No se pudo descartar el prospecto. Intentá de nuevo."
        : "No se pudo guardar el prospecto. Intentá de nuevo."
  }
}

function textoDe(valor: unknown): string | undefined {
  return typeof valor === "string" ? valor : undefined
}

async function leerJson(
  res: Response,
): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

interface CampoProps {
  id: string
  etiqueta: string
  valor: string
  onChange: (valor: string) => void
  error?: string
  ayuda?: string
  placeholder?: string
  type?: string
  maxLength?: number
  textarea?: boolean
  filas?: number
  autoComplete?: string
}

function Campo({
  id,
  etiqueta,
  valor,
  onChange,
  error,
  ayuda,
  placeholder,
  type = "text",
  maxLength,
  textarea = false,
  filas = 3,
  autoComplete = "off",
}: CampoProps) {
  const descripcionId = `${id}-descripcion`
  const errorId = `${id}-error`
  const describedBy = error ? errorId : ayuda ? descripcionId : undefined

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-text">
        {etiqueta}
      </label>
      {textarea ? (
        <textarea
          id={id}
          rows={filas}
          value={valor}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`mt-1 ${CLASE_TEXTAREA}`}
        />
      ) : (
        <Input
          id={id}
          type={type}
          value={valor}
          maxLength={maxLength}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="mt-1"
        />
      )}
      {error ? (
        <p id={errorId} className={CLASE_ERROR}>
          {error}
        </p>
      ) : ayuda ? (
        <p id={descripcionId} className={CLASE_AYUDA}>
          {ayuda}
        </p>
      ) : null}
    </div>
  )
}

interface ProspectoFichaProps {
  campanaId?: string
  prospecto?: ProspectoEditable
  onCancel?: () => void
}

/**
 * Formulario compartido por el alta y la corrección. No implementa la ficha
 * completa del prospecto (T-15): solo los datos editables de T-14.
 */
export function ProspectoFicha({
  campanaId,
  prospecto,
  onCancel,
}: ProspectoFichaProps) {
  const router = useRouter()
  const idBase = useId()
  const [valores, setValores] = useState<ValoresFormulario>(() =>
    valoresIniciales(prospecto),
  )
  const [errores, setErrores] = useState<Errores>({})
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)
  const [enviando, setEnviando] = useState(false)

  const enCurso = useRef(false)
  const mensajeRef = useRef<HTMLDivElement>(null)

  const modo = prospecto ? "EDICION" : "ALTA"

  useEffect(() => {
    if (mensaje !== null) mensajeRef.current?.focus()
  }, [mensaje])

  function actualizar(campo: CampoFormulario, valor: string) {
    setValores((previos) => ({ ...previos, [campo]: valor }))
  }

  function prepararAlta():
    | { ok: true; payload: Record<string, unknown>; ruta: string; metodo: "POST" }
    | { ok: false; errores: Errores; texto: string } {
    if (!campanaId) {
      return {
        ok: false,
        errores: {},
        texto: "Falta la campaña de origen. Recargá la página.",
      }
    }

    const parsed = prospectoCreateSchema.safeParse({
      campanaId,
      nombreNegocio: valores.nombreNegocio,
      sitioWeb: valores.sitioWeb,
      email: valores.email,
      telefono: valores.telefono,
      ciudad: valores.ciudad,
      rubro: valores.rubro,
      fuenteUrl: valores.fuenteUrl,
      emailFuenteUrl: valores.emailFuenteUrl,
      nota: valores.nota,
    })

    if (!parsed.success) {
      return {
        ok: false,
        errores: erroresDeZod(parsed.error.issues),
        texto: mensajeDeError("VALIDACION", "ALTA"),
      }
    }

    if (!parsed.data.fuenteUrl && !parsed.data.emailFuenteUrl) {
      return {
        ok: false,
        errores: {
          fuenteUrl:
            "Indicá al menos una fuente: el sitio del negocio o la fuente del email.",
        },
        texto: "Falta la fuente de los datos.",
      }
    }

    if (
      parsed.data.sitioWeb &&
      normalizarSitioManual(parsed.data.sitioWeb) === null
    ) {
      return {
        ok: false,
        errores: {
          sitioWeb:
            "Ingresá el sitio propio del negocio. No se aceptan redes sociales, marketplaces, agregadores ni proveedores de email.",
        },
        texto: "El sitio web no es una web de negocio válida.",
      }
    }

    return {
      ok: true,
      payload: parsed.data,
      ruta: "/api/propuestas/prospectos",
      metodo: "POST",
    }
  }

  function prepararEdicion():
    | { ok: true; payload: Record<string, unknown>; ruta: string; metodo: "PATCH" }
    | { ok: false; errores: Errores; texto: string } {
    if (!prospecto) {
      return {
        ok: false,
        errores: {},
        texto: "Falta el prospecto a corregir. Recargá la página.",
      }
    }

    const cambios: Record<string, string> = {}

    function agregar(
      campo:
        | "nombreNegocio"
        | "sitioWeb"
        | "email"
        | "telefono"
        | "ciudad"
        | "rubro"
        | "contactoNombre"
        | "contactoCargo"
        | "fuenteUrl"
        | "emailFuenteUrl",
      actual: string | null,
    ) {
      const nuevo = valores[campo].trim()

      if (campo === "email") {
        // El servidor normaliza a lowercase; comparar asi evita enviar un
        // cambio de email que en realidad es el mismo contacto.
        const nuevoEmail = nuevo.toLowerCase()
        const actualEmail = (actual ?? "").trim().toLowerCase()
        if (nuevoEmail.length > 0 && nuevoEmail !== actualEmail) {
          cambios[campo] = nuevoEmail
        }
        return
      }

      // Los campos vacíos no borran datos existentes en esta tarea: solo se
      // envían valores nuevos no vacíos.
      if (nuevo.length > 0 && nuevo !== (actual ?? "")) {
        cambios[campo] = nuevo
      }
    }

    agregar("nombreNegocio", prospecto.nombreNegocio)
    agregar("sitioWeb", prospecto.sitioWeb)
    agregar("email", prospecto.email)
    agregar("telefono", prospecto.telefono)
    agregar("ciudad", prospecto.ciudad)
    agregar("rubro", prospecto.rubro)
    agregar("contactoNombre", prospecto.contactoNombre)
    agregar("contactoCargo", prospecto.contactoCargo)
    agregar("fuenteUrl", prospecto.fuenteUrl)
    agregar("emailFuenteUrl", prospecto.emailFuenteUrl)

    if (Object.keys(cambios).length === 0) {
      return {
        ok: false,
        errores: {},
        texto:
          "No cambiaste ningún dato. Los campos vacíos no borran el valor existente.",
      }
    }

    if (cambios.sitioWeb && normalizarSitioManual(cambios.sitioWeb) === null) {
      return {
        ok: false,
        errores: {
          sitioWeb:
            "Ingresá el sitio propio del negocio. No se aceptan redes sociales, marketplaces, agregadores ni proveedores de email.",
        },
        texto: "El sitio web no es una web de negocio válida.",
      }
    }

    // Un email nuevo exige una fuente: la del body o la ya registrada.
    if (
      cambios.email !== undefined &&
      !cambios.emailFuenteUrl &&
      !valores.emailFuenteUrl.trim() &&
      !cambios.fuenteUrl &&
      !valores.fuenteUrl.trim()
    ) {
      return {
        ok: false,
        errores: {
          emailFuenteUrl:
            "Para cambiar el email indicá la fuente del email o una fuente general.",
        },
        texto: "Falta la fuente del email nuevo.",
      }
    }

    const parsed = prospectoPatchSchema.safeParse({
      ...cambios,
      motivo: valores.motivo,
    })

    if (!parsed.success) {
      return {
        ok: false,
        errores: erroresDeZod(parsed.error.issues),
        texto: mensajeDeError("VALIDACION", "EDICION"),
      }
    }

    return {
      ok: true,
      payload: parsed.data,
      ruta: `/api/propuestas/prospectos/${encodeURIComponent(prospecto.id)}`,
      metodo: "PATCH",
    }
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enCurso.current) return

    setMensaje(null)
    setErrores({})

    const preparado = modo === "ALTA" ? prepararAlta() : prepararEdicion()
    if (!preparado.ok) {
      setErrores(preparado.errores)
      setMensaje({ tono: "error", texto: preparado.texto })
      return
    }

    enCurso.current = true
    setEnviando(true)

    try {
      const res = await fetch(preparado.ruta, {
        method: preparado.metodo,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preparado.payload),
      })
      const data = await leerJson(res)

      if (!res.ok) {
        setMensaje({
          tono: "error",
          texto: mensajeDeError(textoDe(data?.codigo), modo),
        })
        return
      }

      if (!data || typeof data.id !== "string") {
        setMensaje({
          tono: "error",
          texto: "La respuesta del servidor no es válida.",
        })
        return
      }

      setMensaje({
        tono: "ok",
        texto:
          modo === "ALTA"
            ? "Prospecto agregado con su fuente y nota. Quedó en estado NUEVO y no se envió ningún email."
            : "Corrección guardada. El motivo quedó registrado en el historial y no se envió ningún email.",
      })

      if (modo === "ALTA") setValores(valoresIniciales())
    } catch {
      setMensaje({
        tono: "error",
        texto:
          "Error de red. Revisá la conexión; el prospecto puede haberse guardado y se actualizará al refrescar.",
      })
    } finally {
      enCurso.current = false
      setEnviando(false)
      router?.refresh()
    }
  }

  const titulo = modo === "ALTA" ? "Alta manual" : "Corregir prospecto"

  return (
    <section aria-label={titulo} className="rounded-xl border border-border bg-panel p-5">
      <h3 className="font-display text-lg font-semibold text-text">{titulo}</h3>
      <p className="mt-1 text-sm leading-6 text-text-dim">
        {modo === "ALTA"
          ? "Sumá un negocio con datos profesionales y su fuente. El alta no busca en Google Places, no analiza el sitio y no envía nada."
          : "Corregí solo los datos verificados. Cada corrección requiere un motivo y queda registrada sin guardar los valores anteriores."}
      </p>

      <p role="note" className={`mt-3 ${CLASE_AVISO}`}>
        {AVISO_DATOS}
      </p>

      {mensaje && (
        <div
          ref={mensajeRef}
          tabIndex={-1}
          role={mensaje.tono === "ok" ? "status" : "alert"}
          className={`mt-4 ${CLASE_MENSAJE} ${
            mensaje.tono === "ok"
              ? "border-mint/30 bg-mint/5 text-text"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {mensaje.texto}
        </div>
      )}

      <form
        onSubmit={(event) => void enviar(event)}
        noValidate
        aria-busy={enviando}
        className="mt-4 space-y-5"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo
            id={`${idBase}-nombre`}
            etiqueta="Nombre del negocio"
            valor={valores.nombreNegocio}
            onChange={(valor) => actualizar("nombreNegocio", valor)}
            error={errores.nombreNegocio}
            maxLength={PROSPECTO_NOMBRE_MAX}
            placeholder="Ej.: Estudio Contable Alfa"
          />

          <Campo
            id={`${idBase}-sitio`}
            etiqueta="Sitio web"
            valor={valores.sitioWeb}
            onChange={(valor) => actualizar("sitioWeb", valor)}
            error={errores.sitioWeb}
            ayuda="Solo el sitio propio del negocio. No redes sociales, marketplaces ni agregadores."
            type="url"
            maxLength={PROSPECTO_URL_MAX}
            placeholder="https://www.negocio.com.ar"
          />

          <Campo
            id={`${idBase}-email`}
            etiqueta="Email de contacto"
            valor={valores.email}
            onChange={(valor) => actualizar("email", valor)}
            error={errores.email}
            ayuda="Solo un email profesional publicado o cargado con fuente. No se adivinan patrones."
            type="email"
            maxLength={PROSPECTO_EMAIL_MAX}
            placeholder="contacto@negocio.com.ar"
          />

          <Campo
            id={`${idBase}-telefono`}
            etiqueta="Teléfono comercial"
            valor={valores.telefono}
            onChange={(valor) => actualizar("telefono", valor)}
            error={errores.telefono}
            type="tel"
            maxLength={PROSPECTO_TELEFONO_MAX}
            placeholder="+54 11 5555 5555"
          />

          <Campo
            id={`${idBase}-ciudad`}
            etiqueta="Ciudad"
            valor={valores.ciudad}
            onChange={(valor) => actualizar("ciudad", valor)}
            error={errores.ciudad}
            maxLength={PROSPECTO_CIUDAD_MAX}
          />

          <Campo
            id={`${idBase}-rubro`}
            etiqueta="Rubro"
            valor={valores.rubro}
            onChange={(valor) => actualizar("rubro", valor)}
            error={errores.rubro}
            maxLength={PROSPECTO_RUBRO_MAX}
          />

          {modo === "EDICION" && (
            <>
              <Campo
                id={`${idBase}-contacto-nombre`}
                etiqueta="Nombre del contacto"
                valor={valores.contactoNombre}
                onChange={(valor) => actualizar("contactoNombre", valor)}
                error={errores.contactoNombre}
                ayuda="Solo si es un dato profesional público."
                maxLength={PROSPECTO_CONTACTO_MAX}
              />
              <Campo
                id={`${idBase}-contacto-cargo`}
                etiqueta="Cargo del contacto"
                valor={valores.contactoCargo}
                onChange={(valor) => actualizar("contactoCargo", valor)}
                error={errores.contactoCargo}
                maxLength={PROSPECTO_CONTACTO_MAX}
              />
            </>
          )}

          <Campo
            id={`${idBase}-fuente`}
            etiqueta="Fuente de los datos (URL)"
            valor={valores.fuenteUrl}
            onChange={(valor) => actualizar("fuenteUrl", valor)}
            error={errores.fuenteUrl}
            ayuda="Página pública donde constan los datos. No pegues listas compradas."
            type="url"
            maxLength={PROSPECTO_URL_MAX}
            placeholder="https://www.negocio.com.ar/contacto"
          />

          <Campo
            id={`${idBase}-email-fuente`}
            etiqueta="Fuente del email (URL)"
            valor={valores.emailFuenteUrl}
            onChange={(valor) => actualizar("emailFuenteUrl", valor)}
            error={errores.emailFuenteUrl}
            ayuda="Obligatoria si el email no pertenece al dominio del sitio o es un proveedor público."
            type="url"
            maxLength={PROSPECTO_URL_MAX}
            placeholder="https://www.negocio.com.ar/contacto"
          />
        </div>

        {modo === "ALTA" ? (
          <Campo
            id={`${idBase}-nota`}
            etiqueta="Nota de procedencia (obligatoria)"
            valor={valores.nota}
            onChange={(valor) => actualizar("nota", valor)}
            error={errores.nota}
            ayuda={`${valores.nota.length}/${PROSPECTO_NOTA_MAX} caracteres. Explicá de dónde salieron los datos; no incluyas datos sensibles.`}
            maxLength={PROSPECTO_NOTA_MAX}
            textarea
            filas={4}
            placeholder="Ej.: datos tomados de la página de contacto publicada por el negocio el 12/11/2026."
          />
        ) : (
          <Campo
            id={`${idBase}-motivo`}
            etiqueta="Motivo de la corrección (obligatorio)"
            valor={valores.motivo}
            onChange={(valor) => actualizar("motivo", valor)}
            error={errores.motivo}
            ayuda={`${valores.motivo.length}/${PROSPECTO_MOTIVO_MAX} caracteres. No repitas datos personales en el motivo.`}
            maxLength={PROSPECTO_MOTIVO_MAX}
            textarea
            filas={3}
            placeholder="Ej.: el email correcto figura en la página de contacto del negocio."
          />
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button type="submit" disabled={enviando}>
            {enviando && <Loader2 aria-hidden="true" className="animate-spin" />}
            {enviando
              ? "Guardando…"
              : modo === "ALTA"
                ? "Agregar prospecto"
                : "Guardar corrección"}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={enviando}
            >
              Volver
            </Button>
          )}
        </div>
      </form>
    </section>
  )
}

/**
 * Panel plegable para el detalle de campaña. Se integra arriba de la tabla de
 * prospectos y deja el formulario visible tras el éxito para cargar otro.
 */
export function AltaProspecto({ campanaId }: { campanaId: string }) {
  const [abierto, setAbierto] = useState(false)

  return (
    <section
      aria-label="Alta manual de prospecto"
      className="rounded-xl border border-border bg-panel p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[65ch]">
          <h2 className="font-display text-xl font-semibold text-text">
            Agregar prospecto manualmente
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-dim">
            Para negocios que no salieron de la búsqueda. Solo datos
            profesionales con fuente y nota de procedencia. No pegues datos
            sensibles ni listas compradas; no se importa nada ni se envía nada.
          </p>
        </div>
        <Button
          type="button"
          variant={abierto ? "outline" : "default"}
          aria-expanded={abierto}
          onClick={() => setAbierto((previo) => !previo)}
        >
          {abierto ? null : <Plus aria-hidden="true" />}
          {abierto ? "Cerrar formulario" : "Agregar prospecto"}
        </Button>
      </div>

      {abierto && (
        <div className="mt-4">
          <ProspectoFicha
            campanaId={campanaId}
            onCancel={() => setAbierto(false)}
          />
        </div>
      )}
    </section>
  )
}

interface DescarteProps {
  prospecto: ProspectoEditable
  onDescartado: () => void
  onCancel?: () => void
}

function DescarteProspecto({
  prospecto,
  onDescartado,
  onCancel,
}: DescarteProps) {
  const router = useRouter()
  const idBase = useId()
  const [motivo, setMotivo] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)
  const [enviando, setEnviando] = useState(false)

  const enCurso = useRef(false)
  const mensajeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mensaje !== null) mensajeRef.current?.focus()
  }, [mensaje])

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enCurso.current) return

    setError(null)
    setMensaje(null)

    const parsed = prospectoDescartarSchema.safeParse({ motivo })
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "El motivo es obligatorio.",
      )
      return
    }

    enCurso.current = true
    setEnviando(true)

    try {
      const res = await fetch(
        `/api/propuestas/prospectos/${encodeURIComponent(prospecto.id)}/descartar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      )
      const data = await leerJson(res)

      if (!res.ok) {
        setMensaje({
          tono: "error",
          texto: mensajeDeError(textoDe(data?.codigo), "DESCARTE"),
        })
        return
      }

      if (data?.estado !== "DESCARTADO") {
        setMensaje({
          tono: "error",
          texto: "La respuesta del servidor no es válida.",
        })
        return
      }

      setMensaje({
        tono: "ok",
        texto:
          "Prospecto descartado. Se cancelaron los envíos pendientes; no se borró la supresión ni se envió ningún email.",
      })
      onDescartado()
    } catch {
      setMensaje({
        tono: "error",
        texto:
          "Error de red. Revisá la conexión; el estado se actualizará al refrescar.",
      })
    } finally {
      enCurso.current = false
      setEnviando(false)
      router?.refresh()
    }
  }

  return (
    <form
      onSubmit={(event) => void enviar(event)}
      noValidate
      aria-busy={enviando}
      className="space-y-4"
    >
      <p role="note" className={CLASE_AVISO}>
        Vas a descartar <strong className="text-text">{prospecto.nombreNegocio}</strong>.
        Se cancelan los envíos en borrador o aprobados de este prospecto. No se
        borra el prospecto, no se borra la supresión y no se envía nada.
      </p>

      {mensaje && (
        <div
          ref={mensajeRef}
          tabIndex={-1}
          role={mensaje.tono === "ok" ? "status" : "alert"}
          className={`${CLASE_MENSAJE} ${
            mensaje.tono === "ok"
              ? "border-mint/30 bg-mint/5 text-text"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {mensaje.texto}
        </div>
      )}

      <div>
        <label
          htmlFor={`${idBase}-motivo`}
          className="block text-sm font-medium text-text"
        >
          Motivo del descarte (obligatorio)
        </label>
        <textarea
          id={`${idBase}-motivo`}
          rows={3}
          value={motivo}
          maxLength={PROSPECTO_MOTIVO_MAX}
          onChange={(event) => setMotivo(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? `${idBase}-motivo-error` : `${idBase}-motivo-ayuda`
          }
          className={`mt-1 ${CLASE_TEXTAREA}`}
          placeholder="Ej.: el negocio cerró o no encaja con el servicio."
        />
        {error ? (
          <p id={`${idBase}-motivo-error`} className={CLASE_ERROR}>
            {error}
          </p>
        ) : (
          <p id={`${idBase}-motivo-ayuda`} className={CLASE_AYUDA}>
            {motivo.length}/{PROSPECTO_MOTIVO_MAX} caracteres. El motivo queda
            registrado en el historial.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={enviando}
          className="bg-red-600 hover:bg-red-500"
        >
          {enviando && <Loader2 aria-hidden="true" className="animate-spin" />}
          {enviando ? "Descartando…" : "Confirmar descarte"}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={enviando}
          >
            Volver
          </Button>
        )}
      </div>
    </form>
  )
}

interface AccionesProps {
  prospecto: ProspectoEditable
}

/**
 * Acciones por fila de la tabla de campaña. "Editar" y "Descartar" abren el
 * mismo formulario/panel; el descarte exige motivo y confirmación. Un
 * prospecto SUPRIMIDO no se toca desde aquí.
 */
export function ProspectoAcciones({ prospecto }: AccionesProps) {
  const [panel, setPanel] = useState<"EDITAR" | "DESCARTAR" | null>(null)
  const [descartado, setDescartado] = useState(false)

  const suprimido = prospecto.estado === "SUPRIMIDO"
  const yaDescartado = prospecto.estado === "DESCARTADO" || descartado

  function cerrar() {
    setPanel(null)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={suprimido}
        title={
          suprimido
            ? "El prospecto está suprimido: no se edita sin revocar la supresión."
            : undefined
        }
        onClick={() => setPanel("EDITAR")}
      >
        <Pencil aria-hidden="true" />
        Editar
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={suprimido || yaDescartado}
        title={
          suprimido
            ? "El prospecto está suprimido: no se descarta sin revocar la supresión."
            : yaDescartado
              ? "El prospecto ya está descartado."
              : undefined
        }
        onClick={() => setPanel("DESCARTAR")}
      >
        <Ban aria-hidden="true" />
        Descartar
      </Button>

      <Dialogo
        open={panel === "EDITAR"}
        onClose={cerrar}
        title="Corregir prospecto"
        description="Los cambios exigen motivo y quedan registrados sin guardar los valores anteriores."
        maxWidthClassName="max-w-3xl"
      >
        <ProspectoFicha prospecto={prospecto} onCancel={cerrar} />
      </Dialogo>

      <Dialogo
        open={panel === "DESCARTAR"}
        onClose={cerrar}
        title="Descartar prospecto"
        description="El descarte exige motivo y cancela los envíos pendientes."
        maxWidthClassName="max-w-xl"
      >
        <DescarteProspecto
          prospecto={prospecto}
          onDescartado={() => setDescartado(true)}
          onCancel={cerrar}
        />
      </Dialogo>
    </div>
  )
}
