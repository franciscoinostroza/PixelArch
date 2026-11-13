"use client"

/**
 * T-22 (AC-37; RF-30, RF-65): panel ARCO de la ficha de prospecto.
 *
 * - Exportar: descarga un JSON generado por el servidor. El navegador no arma
 *   el contenido ni recibe tokens/hashes.
 * - Eliminar: exige una confirmación explícita. Avisa que la ficha, borradores
 *   y envíos se eliminan, y que la supresión por hash se conserva. Si hay
 *   email, el servidor crea la supresión SOLICITUD_ARCO antes de borrar.
 * - Rectificar: solo los campos permitidos de T-14, con motivo obligatorio.
 *
 * Reglas de UI:
 * - ninguna PII viaja en la URL: solo el id interno en el path de la API;
 * - no hay acciones masivas;
 * - estados pending/éxito/error accesibles (`aria-busy`, `role=status`/
 *   `role=alert`, foco en el mensaje y `aria-describedby`);
 * - tras un éxito se refresca la ficha (o se vuelve a la campaña si se borró).
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { useRouter } from "next/navigation"
import { Download, Loader2, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  PROSPECTO_CIUDAD_MAX,
  PROSPECTO_CONTACTO_MAX,
  PROSPECTO_EMAIL_MAX,
  PROSPECTO_MOTIVO_MAX,
  PROSPECTO_NOMBRE_MAX,
  PROSPECTO_RUBRO_MAX,
  PROSPECTO_TELEFONO_MAX,
  PROSPECTO_URL_MAX,
  prospectoPatchSchema,
} from "@/lib/propuestas/validation"
import { normalizarSitioManual } from "@/lib/propuestas/prospectos"

export interface ProspectoArco {
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

interface CamposRectificacion {
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
}

type CampoRectificacion = keyof CamposRectificacion
type Errores = Partial<Record<CampoRectificacion | "motivo" | "general", string>>

type Accion = "EXPORTAR" | "RECTIFICAR" | "ELIMINAR"

interface Mensaje {
  tono: "ok" | "error"
  texto: string
}

const CAMPOS_RECTIFICABLES = new Set<string>([
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
])

const CLASE_AYUDA = "mt-1 text-xs leading-5 text-text-faint"
const CLASE_ERROR = "mt-1 font-mono text-xs text-red-400"
const CLASE_TEXTAREA =
  "flex min-h-[90px] w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text font-mono placeholder:text-text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50"
const CLASE_MENSAJE =
  "rounded-lg border p-3 text-sm leading-6 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
const CLASE_AVISO =
  "rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-text-dim"
const CLASE_SECCION = "rounded-xl border border-border bg-panel p-5"

function valoresIniciales(prospecto: ProspectoArco): CamposRectificacion {
  return {
    nombreNegocio: prospecto.nombreNegocio,
    sitioWeb: prospecto.sitioWeb ?? "",
    email: prospecto.email ?? "",
    telefono: prospecto.telefono ?? "",
    ciudad: prospecto.ciudad ?? "",
    rubro: prospecto.rubro ?? "",
    contactoNombre: prospecto.contactoNombre ?? "",
    contactoCargo: prospecto.contactoCargo ?? "",
    fuenteUrl: prospecto.fuenteUrl ?? "",
    emailFuenteUrl: prospecto.emailFuenteUrl ?? "",
  }
}

function textoDe(valor: unknown): string | undefined {
  return typeof valor === "string" ? valor : undefined
}

function mensajeDeError(codigo: string | undefined, accion: Accion): string {
  switch (codigo) {
    case "VALIDACION":
      return accion === "RECTIFICAR"
        ? "Revisá los datos: hace falta al menos un campo válido y el motivo es obligatorio."
        : "La solicitud no es válida."
    case "SUPRIMIDO":
      return "El contacto está suprimido. No se rectifica sin revocar la supresión con una acción administrativa."
    case "NO_CONFIGURADO":
      return "La operación requiere PROPUESTAS_SECRETO para crear la supresión por hash. Avisá al responsable técnico."
    case "NO_ENCONTRADO":
      return "El prospecto no existe o ya fue eliminado."
    case "ESTADO":
      return "El email ya pertenece a otro prospecto. No se fusionó automáticamente."
    case "RATE_LIMIT":
      return "Demasiadas solicitudes. Esperá un minuto y volvé a intentar."
    case "ORIGEN_INVALIDO":
      return "La solicitud no proviene del portal. Recargá la página e intentá de nuevo."
    case "NO_AUTORIZADO":
      return "Tu sesión venció. Volvé a ingresar al portal."
    case "PROHIBIDO":
      return "No tenés permisos para atender solicitudes ARCO."
    case "ESQUEMA_NO_APLICADO":
      return "El esquema del portal no está aplicado. Avisá al responsable técnico."
    default:
      return accion === "EXPORTAR"
        ? "No se pudo generar la exportación. Intentá de nuevo."
        : "No se pudo completar la solicitud ARCO. Intentá de nuevo."
  }
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
  type?: string
  maxLength?: number
  textarea?: boolean
  filas?: number
}

function Campo({
  id,
  etiqueta,
  valor,
  onChange,
  error,
  ayuda,
  type = "text",
  maxLength,
  textarea = false,
  filas = 3,
}: CampoProps) {
  const descripcionId = `${id}-descripcion`
  const errorId = `${id}-error`

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
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : ayuda ? descripcionId : undefined}
          className={`mt-1 ${CLASE_TEXTAREA}`}
        />
      ) : (
        <Input
          id={id}
          type={type}
          value={valor}
          maxLength={maxLength}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : ayuda ? descripcionId : undefined}
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

interface ArcoPanelProps {
  prospecto: ProspectoArco
  /** Campaña a la que volver tras eliminar la ficha. */
  campanaId?: string
}

export function ArcoPanel({ prospecto, campanaId }: ArcoPanelProps) {
  const router = useRouter()
  const idBase = useId()
  const [panel, setPanel] = useState<"RECTIFICAR" | "ELIMINAR" | null>(null)
  const [valores, setValores] = useState<CamposRectificacion>(() =>
    valoresIniciales(prospecto),
  )
  const [motivoRectificar, setMotivoRectificar] = useState("")
  const [errores, setErrores] = useState<Errores>({})
  const [motivoEliminar, setMotivoEliminar] = useState("")
  const [confirmoEliminar, setConfirmoEliminar] = useState(false)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)
  const [enviando, setEnviando] = useState<Accion | null>(null)

  const enCurso = useRef(false)
  const mensajeRef = useRef<HTMLDivElement>(null)

  const suprimido = prospecto.estado === "SUPRIMIDO"
  const tieneEmail = Boolean(prospecto.email)
  const ocupado = enviando !== null

  useEffect(() => {
    if (mensaje !== null) mensajeRef.current?.focus()
  }, [mensaje])

  function actualizar(campo: CampoRectificacion, valor: string) {
    setValores((previos) => ({ ...previos, [campo]: valor }))
  }

  function abrir(nuevo: "RECTIFICAR" | "ELIMINAR") {
    setMensaje(null)
    setErrores({})
    // El panel de eliminar no queda "armado" al cerrar/reabrir: la
    // confirmación y el motivo se descartan en cada apertura o cambio.
    setConfirmoEliminar(false)
    setMotivoEliminar("")
    setPanel((actual) => (actual === nuevo ? null : nuevo))
  }

  function cerrar() {
    setPanel(null)
    setConfirmoEliminar(false)
    setMotivoEliminar("")
  }

  function erroresDeZod(
    issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
  ): Errores {
    const salida: Errores = {}

    for (const issue of issues) {
      const campo = issue.path[0]
      if (typeof campo === "string" && CAMPOS_RECTIFICABLES.has(campo)) {
        const clave = campo as CampoRectificacion
        if (!salida[clave]) salida[clave] = issue.message
      } else if (campo === "motivo" && !salida.motivo) {
        salida.motivo = issue.message
      } else if (!salida.general) {
        salida.general = issue.message
      }
    }

    return salida
  }

  async function exportar() {
    if (enCurso.current) return

    setMensaje(null)
    enCurso.current = true
    setEnviando("EXPORTAR")

    try {
      const res = await fetch(
        `/api/propuestas/arco/${encodeURIComponent(prospecto.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo: "EXPORTAR" }),
        },
      )

      if (!res.ok) {
        const data = await leerJson(res)
        setMensaje({
          tono: "error",
          texto: mensajeDeError(textoDe(data?.codigo), "EXPORTAR"),
        })
        return
      }

      const blob = await res.blob()
      const disposicion = res.headers.get("content-disposition")
      const coincidencia = disposicion
        ? /filename="([^"]+)"/i.exec(disposicion)
        : null
      const nombre = coincidencia?.[1] ?? `arco-${prospecto.id}.json`

      if (typeof URL.createObjectURL !== "function") {
        setMensaje({
          tono: "error",
          texto: "El navegador no permite descargar el archivo. Probá desde otro navegador.",
        })
        return
      }

      const url = URL.createObjectURL(blob)
      const enlace = document.createElement("a")
      enlace.href = url
      enlace.download = nombre
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      URL.revokeObjectURL(url)

      setMensaje({
        tono: "ok",
        texto:
          "Exportación descargada. Incluye datos, fuentes, auditoría, envíos e historial; no incluye tokens, hashes ni notas internas.",
      })
    } catch {
      setMensaje({
        tono: "error",
        texto:
          "Error de red al exportar. Revisá la conexión e intentá de nuevo.",
      })
    } finally {
      enCurso.current = false
      setEnviando(null)
    }
  }

  function prepararCambios():
    | { ok: true; cambios: Record<string, string> }
    | { ok: false; errores: Errores; texto: string } {
    const cambios: Record<string, string> = {}

    for (const campo of Object.keys(valores) as CampoRectificacion[]) {
      const nuevo = valores[campo].trim()
      const actual = (prospecto[campo] ?? "").trim()

      if (campo === "email") {
        if (nuevo.length > 0 && nuevo.toLowerCase() !== actual.toLowerCase()) {
          cambios.email = nuevo
        }
        continue
      }

      // Los campos vacíos no borran datos existentes: misma regla que T-14.
      if (nuevo.length > 0 && nuevo !== actual) {
        cambios[campo] = nuevo
      }
    }

    if (Object.keys(cambios).length === 0) {
      return {
        ok: false,
        errores: {},
        texto:
          "No cambiaste ningún dato. Los campos vacíos no borran el valor existente.",
      }
    }

    if (
      cambios.sitioWeb &&
      normalizarSitioManual(cambios.sitioWeb) === null
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
      motivo: motivoRectificar,
    })

    if (!parsed.success) {
      return {
        ok: false,
        errores: erroresDeZod(parsed.error.issues),
        texto: mensajeDeError("VALIDACION", "RECTIFICAR"),
      }
    }

    return { ok: true, cambios }
  }

  async function rectificar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enCurso.current) return

    setMensaje(null)
    setErrores({})

    const preparado = prepararCambios()
    if (!preparado.ok) {
      setErrores(preparado.errores)
      setMensaje({ tono: "error", texto: preparado.texto })
      return
    }

    enCurso.current = true
    setEnviando("RECTIFICAR")

    try {
      const res = await fetch(
        `/api/propuestas/arco/${encodeURIComponent(prospecto.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo: "RECTIFICAR",
            cambios: preparado.cambios,
            motivo: motivoRectificar,
          }),
        },
      )
      const data = await leerJson(res)

      if (!res.ok) {
        setMensaje({
          tono: "error",
          texto: mensajeDeError(textoDe(data?.codigo), "RECTIFICAR"),
        })
        return
      }

      setMensaje({
        tono: "ok",
        texto:
          "Rectificación guardada. El motivo quedó en el historial y la acción en el registro ARCO; no se envió ningún email.",
      })
      setPanel(null)
      setMotivoRectificar("")
      router.refresh()
    } catch {
      setMensaje({
        tono: "error",
        texto: "Error de red al rectificar. Revisá la conexión e intentá de nuevo.",
      })
    } finally {
      enCurso.current = false
      setEnviando(null)
    }
  }

  async function eliminar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enCurso.current || !confirmoEliminar) return

    setMensaje(null)
    enCurso.current = true
    setEnviando("ELIMINAR")

    try {
      const res = await fetch(
        `/api/propuestas/arco/${encodeURIComponent(prospecto.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo: "ELIMINAR",
            confirmado: true,
            motivo: motivoEliminar.trim() || undefined,
          }),
        },
      )
      const data = await leerJson(res)

      if (!res.ok) {
        setMensaje({
          tono: "error",
          texto: mensajeDeError(textoDe(data?.codigo), "ELIMINAR"),
        })
        return
      }

      const supresion =
        data && typeof data.supresion === "object" && data.supresion !== null
          ? (data.supresion as Record<string, unknown>)
          : null

      setMensaje({
        tono: "ok",
        texto: supresion
          ? "Prospecto eliminado. La supresión SOLICITUD_ARCO quedó registrada y no se volverá a contactar ese email."
          : "Prospecto eliminado. No tenía email, así que no se creó una supresión.",
      })

      router.push(
        campanaId
          ? `/propuestas/campanas/${encodeURIComponent(campanaId)}`
          : "/propuestas",
      )
    } catch {
      setMensaje({
        tono: "error",
        texto:
          "Error de red al eliminar. Revisá la conexión; la ficha puede seguir existiendo.",
      })
    } finally {
      enCurso.current = false
      setEnviando(null)
    }
  }

  return (
    <section
      aria-label="Derechos ARCO"
      aria-busy={ocupado}
      className={CLASE_SECCION}
    >
      <div className="max-w-[75ch]">
        <h2 className="font-display text-xl font-semibold text-text">
          Derechos ARCO
        </h2>
        <p className="mt-1 text-sm leading-6 text-text-dim">
          Atención de solicitudes de acceso, rectificación y supresión. Exportar
          no modifica la ficha. Eliminar borra la ficha y sus borradores/envíos,
          pero conserva la supresión por hash para no volver a contactar.
        </p>
      </div>

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

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={() => void exportar()} disabled={ocupado}>
          {enviando === "EXPORTAR" ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Download aria-hidden="true" />
          )}
          {enviando === "EXPORTAR" ? "Exportando…" : "Exportar datos"}
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-expanded={panel === "RECTIFICAR"}
          disabled={ocupado || suprimido}
          title={
            suprimido
              ? "El prospecto está suprimido: no se rectifica sin revocar la supresión."
              : undefined
          }
          onClick={() => abrir("RECTIFICAR")}
        >
          <Pencil aria-hidden="true" />
          Rectificar
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-expanded={panel === "ELIMINAR"}
          disabled={ocupado}
          onClick={() => abrir("ELIMINAR")}
        >
          <Trash2 aria-hidden="true" />
          Eliminar
        </Button>
      </div>

      {panel === "RECTIFICAR" && !suprimido && (
        <form
          onSubmit={(event) => void rectificar(event)}
          noValidate
          aria-busy={enviando === "RECTIFICAR"}
          className="mt-5 space-y-4 border-t border-border pt-5"
        >
          <p className="text-sm leading-6 text-text-dim">
            Solo se envían los campos que cambian. Los campos vacíos no borran el
            valor actual. La rectificación no cambia el estado, la campaña ni el
            score.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              id={`${idBase}-nombre`}
              etiqueta="Nombre del negocio"
              valor={valores.nombreNegocio}
              onChange={(valor) => actualizar("nombreNegocio", valor)}
              error={errores.nombreNegocio}
              maxLength={PROSPECTO_NOMBRE_MAX}
            />
            <Campo
              id={`${idBase}-sitio`}
              etiqueta="Sitio web"
              valor={valores.sitioWeb}
              onChange={(valor) => actualizar("sitioWeb", valor)}
              error={errores.sitioWeb}
              ayuda="Solo el sitio propio del negocio."
              type="url"
              maxLength={PROSPECTO_URL_MAX}
            />
            <Campo
              id={`${idBase}-email`}
              etiqueta="Email de contacto"
              valor={valores.email}
              onChange={(valor) => actualizar("email", valor)}
              error={errores.email}
              ayuda="Un email nuevo exige fuente."
              type="email"
              maxLength={PROSPECTO_EMAIL_MAX}
            />
            <Campo
              id={`${idBase}-telefono`}
              etiqueta="Teléfono comercial"
              valor={valores.telefono}
              onChange={(valor) => actualizar("telefono", valor)}
              error={errores.telefono}
              type="tel"
              maxLength={PROSPECTO_TELEFONO_MAX}
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
            <Campo
              id={`${idBase}-fuente`}
              etiqueta="Fuente de los datos (URL)"
              valor={valores.fuenteUrl}
              onChange={(valor) => actualizar("fuenteUrl", valor)}
              error={errores.fuenteUrl}
              type="url"
              maxLength={PROSPECTO_URL_MAX}
            />
            <Campo
              id={`${idBase}-email-fuente`}
              etiqueta="Fuente del email (URL)"
              valor={valores.emailFuenteUrl}
              onChange={(valor) => actualizar("emailFuenteUrl", valor)}
              error={errores.emailFuenteUrl}
              type="url"
              maxLength={PROSPECTO_URL_MAX}
            />
          </div>

          <Campo
            id={`${idBase}-motivo-rectificar`}
            etiqueta="Motivo de la rectificación (obligatorio)"
            valor={motivoRectificar}
            onChange={setMotivoRectificar}
            error={errores.motivo}
            ayuda={`${motivoRectificar.length}/${PROSPECTO_MOTIVO_MAX} caracteres. No repitas datos personales en el motivo.`}
            maxLength={PROSPECTO_MOTIVO_MAX}
            textarea
            filas={3}
          />

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={ocupado}>
              {enviando === "RECTIFICAR" && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              {enviando === "RECTIFICAR" ? "Guardando…" : "Guardar rectificación"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={cerrar}
              disabled={ocupado}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {panel === "ELIMINAR" && (
        <form
          onSubmit={(event) => void eliminar(event)}
          noValidate
          aria-busy={enviando === "ELIMINAR"}
          className="mt-5 space-y-4 border-t border-border pt-5"
        >
          <p
            id={`${idBase}-eliminar-aviso`}
            role="note"
            className={CLASE_AVISO}
          >
            Vas a eliminar <strong className="text-text">{prospecto.nombreNegocio}</strong>.
            La acción es definitiva y no se puede deshacer. Se eliminan la ficha,
            sus borradores, snapshots y envíos asociados.{" "}
            {tieneEmail
              ? "Se creará una supresión SOLICITUD_ARCO con hash: el email no se guarda en claro y no se volverá a contactar."
              : "La ficha no tiene email: se elimina sin crear una supresión."}{" "}
            No se toca el CRM.
          </p>

          <div>
            <label
              htmlFor={`${idBase}-motivo-eliminar`}
              className="block text-sm font-medium text-text"
            >
              Motivo o referencia de la solicitud (opcional)
            </label>
            <textarea
              id={`${idBase}-motivo-eliminar`}
              rows={2}
              value={motivoEliminar}
              maxLength={PROSPECTO_MOTIVO_MAX}
              onChange={(event) => setMotivoEliminar(event.target.value)}
              aria-describedby={`${idBase}-motivo-eliminar-ayuda`}
              className={`mt-1 ${CLASE_TEXTAREA}`}
              placeholder="Ej.: solicitud recibida por hola@pixelarch.dev"
            />
            <p id={`${idBase}-motivo-eliminar-ayuda`} className={CLASE_AYUDA}>
              {motivoEliminar.length}/{PROSPECTO_MOTIVO_MAX} caracteres. No
              incluyas datos personales.
            </p>
          </div>

          <label className="flex items-start gap-2 text-sm leading-6 text-text">
            <input
              type="checkbox"
              checked={confirmoEliminar}
              onChange={(event) => setConfirmoEliminar(event.target.checked)}
              aria-describedby={`${idBase}-eliminar-aviso`}
              className="mt-1 h-4 w-4 rounded border-border"
            />
            <span>
              Confirmo la eliminación de esta ficha y entiendo que la supresión
              por hash se conserva.
            </span>
          </label>

          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={ocupado || !confirmoEliminar}
              className="bg-red-600 hover:bg-red-500"
            >
              {enviando === "ELIMINAR" && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              {enviando === "ELIMINAR" ? "Eliminando…" : "Eliminar prospecto"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={cerrar}
              disabled={ocupado}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
