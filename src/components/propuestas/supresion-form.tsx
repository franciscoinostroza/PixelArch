"use client"

/**
 * T-20 (AC-15..AC-18, AC-27, AC-36; RF-23..RF-28, RF-56): alta manual y
 * revocacion excepcional de supresiones.
 *
 * - Alta: `POST /api/propuestas/supresiones`. El ámbito decide el dato
 *   obligatorio (email o dominio de negocio). El servidor normaliza, rechaza
 *   proveedores públicos/multiinquilino y hace el alta idempotente.
 * - Revocacion: `POST /api/propuestas/supresiones/[id]/revocar`. Exige motivo
 *   y una confirmación explícita; no reabre prospectos.
 * - Purga manual: `POST /api/propuestas/supresiones/[id]/purga`. Solo aparece
 *   en supresiones revocadas; exige motivo y confirmación explícita. Es una
 *   excepción administrativa que no reabre prospectos ni envíos. El texto del
 *   motivo no se persiste ni se loguea: solo queda un hash operativo sin PII.
 * - La UI no muestra emails completos: el alta devuelve solo `clave`, y el
 *   listado usa el email enmascarado que guarda el servidor.
 * - Errores accesibles (`role="alert"`, `aria-describedby`) y estados de
 *   éxito (`role="status"`). No hay acciones masivas ni envíos.
 */

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  SUPRESION_AMBITOS,
  SUPRESION_DOMINIO_MAX,
  SUPRESION_EMAIL_MAX,
  SUPRESION_MOTIVOS,
  SUPRESION_NOTAS_MAX,
  supresionFormSchema,
  type SupresionFormValues,
} from "@/lib/propuestas/validation"

type MotivoSupresion = (typeof SUPRESION_MOTIVOS)[number]

const ETIQUETAS_MOTIVO: Record<MotivoSupresion, string> = {
  OPT_OUT: "Baja (opt-out)",
  REBOTE_DURO: "Rebote duro",
  QUEJA: "Queja",
  MANUAL: "Manual",
  SOLICITUD_ARCO: "Solicitud ARCO",
}

const CLASE_AYUDA = "mt-1 text-xs leading-5 text-text-faint"
const CLASE_ERROR = "mt-1 font-mono text-xs text-red-400"
const CLASE_TEXTAREA =
  "flex min-h-[90px] w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text placeholder:text-text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50"
const CLASE_SELECT =
  "flex h-10 w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50"

interface RespuestaApi {
  id?: unknown
  clave?: unknown
  creada?: unknown
  reactivada?: unknown
  purgada?: unknown
  codigo?: unknown
}

interface ResultadoAlta {
  id: string
  clave: string
  creada: boolean
  reactivada: boolean
}

function mensajeDeError(codigo: string | undefined): string {
  switch (codigo) {
    case "VALIDACION":
      return "Revisá el email o el dominio y el motivo. Los proveedores de email públicos y las plataformas multiinquilino no se pueden suprimir por dominio."
    case "NO_CONFIGURADO":
      return "La supresión por email está deshabilitada: falta PROPUESTAS_SECRETO. Avisá al responsable técnico."
    case "NO_AUTORIZADO":
      return "Tu sesión venció. Volvé a ingresar al portal."
    case "PROHIBIDO":
      return "No tenés permisos para administrar supresiones."
    case "ORIGEN_INVALIDO":
      return "La solicitud no proviene del portal. Recargá la página e intentá de nuevo."
    case "RATE_LIMIT":
      return "Demasiadas solicitudes. Esperá un minuto y volvé a intentar."
    case "ESQUEMA_NO_APLICADO":
      return "El esquema del portal no está aplicado. Avisá al responsable técnico."
    default:
      return "No se pudo registrar la supresión. Intentá de nuevo."
  }
}

async function leerRespuesta(res: Response): Promise<RespuestaApi | null> {
  try {
    return (await res.json()) as RespuestaApi
  } catch {
    return null
  }
}

export function SupresionForm() {
  const router = useRouter()
  const [resultado, setResultado] = useState<ResultadoAlta | null>(null)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SupresionFormValues>({
    resolver: zodResolver(supresionFormSchema),
    defaultValues: {
      ambito: "EMAIL",
      email: "",
      dominioNegocio: "",
      motivo: "MANUAL",
      notas: "",
    },
  })

  const ambito = useWatch({ control, name: "ambito" })

  async function onSubmit(datos: SupresionFormValues) {
    if (enviando) return

    setEnviando(true)
    setErrorGeneral(null)

    const payload =
      datos.ambito === "EMAIL"
        ? {
            ambito: "EMAIL",
            email: datos.email,
            motivo: datos.motivo,
            notas: datos.notas || undefined,
          }
        : {
            ambito: "DOMINIO",
            dominioNegocio: datos.dominioNegocio,
            motivo: datos.motivo,
            notas: datos.notas || undefined,
          }

    try {
      const res = await fetch("/api/propuestas/supresiones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const respuesta = await leerRespuesta(res)

      if (!res.ok) {
        const codigo =
          typeof respuesta?.codigo === "string" ? respuesta.codigo : undefined
        setErrorGeneral(mensajeDeError(codigo))
        return
      }

      if (
        !respuesta ||
        typeof respuesta.id !== "string" ||
        typeof respuesta.clave !== "string" ||
        typeof respuesta.creada !== "boolean"
      ) {
        setErrorGeneral("La respuesta del servidor no es válida.")
        return
      }

      // `reactivada` es opcional en la respuesta: si falta, se trata como
      // alta idempotente de una fila ya activa.
      const reactivada = respuesta.reactivada === true

      setResultado({
        id: respuesta.id,
        clave: respuesta.clave,
        creada: respuesta.creada,
        reactivada,
      })
      router?.refresh()
    } catch {
      setErrorGeneral("Error de red. Revisá la conexión e intentá de nuevo.")
    } finally {
      setEnviando(false)
    }
  }

  if (resultado) {
    return (
      <section
        role="status"
        aria-live="polite"
        aria-label="Resultado del alta de supresión"
        className="max-w-[70ch] rounded-xl border border-border bg-panel p-6"
      >
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          {resultado.creada
            ? "Supresión creada"
            : resultado.reactivada
              ? "Supresión reactivada"
              : "Supresión existente"}
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold text-text">
          {resultado.creada
            ? "El contacto quedó suprimido"
            : resultado.reactivada
              ? "La supresión revocada volvió a quedar activa"
              : "La clave ya estaba suprimida"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-text-dim">
          {resultado.reactivada
            ? "Se conservaron el motivo, el origen y la fecha de creación originales; el historial registra la reactivación. No se reabrieron prospectos ni envíos: la supresión vuelve a bloquear el contacto y se cancelaron los pendientes afectados. No se envió ningún email."
            : "La supresión es global y se aplica de inmediato. Se cancelaron los envíos pendientes afectados y los intentos de aprobar o enviar a ese contacto quedan bloqueados. No se envió ningún email."}
        </p>
        <p className="mt-4 break-all rounded-lg border border-border bg-bg/40 p-3 font-mono text-xs text-text">
          {resultado.clave}
        </p>

        <div className="mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setResultado(null)
              reset()
            }}
          >
            Registrar otra supresión
          </Button>
        </div>
      </section>
    )
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-busy={enviando}
      className="max-w-[70ch] rounded-xl border border-border bg-panel p-6"
    >
      {errorGeneral && (
        <div
          role="alert"
          className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {errorGeneral}
        </div>
      )}

      <div
        role="note"
        aria-label="Alcance de la supresión"
        className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-text"
      >
        La supresión es <strong>global y permanente hasta una excepción</strong>.
        Bloquea futuros envíos aunque se borre el prospecto o la campaña. No
        reemplaza una baja pública: solo el admin la registra o revoca con
        motivo.
      </div>

      <div className="space-y-5">
        <div>
          <label
            htmlFor="supresion-ambito"
            className="block text-sm font-medium text-text"
          >
            Ámbito
          </label>
          <select
            id="supresion-ambito"
            className={`mt-1 ${CLASE_SELECT}`}
            {...register("ambito")}
          >
            {SUPRESION_AMBITOS.map((valor) => (
              <option key={valor} value={valor}>
                {valor === "EMAIL" ? "Email (global)" : "Dominio de negocio"}
              </option>
            ))}
          </select>
          <p className={CLASE_AYUDA}>
            El dominio solo aplica a dominios de negocio: nunca a Gmail,
            Hotmail, Outlook, Yahoo, iCloud ni plataformas compartidas.
          </p>
        </div>

        {ambito === "EMAIL" ? (
          <div>
            <label
              htmlFor="supresion-email"
              className="block text-sm font-medium text-text"
            >
              Email a suprimir
            </label>
            <Input
              id="supresion-email"
              type="email"
              className="mt-1"
              autoComplete="off"
              maxLength={SUPRESION_EMAIL_MAX}
              placeholder="contacto@empresa.com"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={
                errors.email ? "supresion-email-error" : "supresion-email-ayuda"
              }
              {...register("email")}
            />
            {errors.email ? (
              <p id="supresion-email-error" className={CLASE_ERROR}>
                {errors.email.message}
              </p>
            ) : (
              <p id="supresion-email-ayuda" className={CLASE_AYUDA}>
                Se guarda solo un hash HMAC y una versión enmascarada; el email
                en claro no se persiste en la supresión ni se muestra en la
                lista.
              </p>
            )}
          </div>
        ) : (
          <div>
            <label
              htmlFor="supresion-dominio"
              className="block text-sm font-medium text-text"
            >
              Dominio de negocio a suprimir
            </label>
            <Input
              id="supresion-dominio"
              className="mt-1"
              autoComplete="off"
              maxLength={SUPRESION_DOMINIO_MAX}
              placeholder="empresa.com"
              aria-invalid={errors.dominioNegocio ? true : undefined}
              aria-describedby={
                errors.dominioNegocio
                  ? "supresion-dominio-error"
                  : "supresion-dominio-ayuda"
              }
              {...register("dominioNegocio")}
            />
            {errors.dominioNegocio ? (
              <p id="supresion-dominio-error" className={CLASE_ERROR}>
                {errors.dominioNegocio.message}
              </p>
            ) : (
              <p id="supresion-dominio-ayuda" className={CLASE_AYUDA}>
                Afecta a todos los prospectos cuyo dominio de negocio coincida.
                Un proveedor público o multiinquilino se rechaza.
              </p>
            )}
          </div>
        )}

        <div>
          <label
            htmlFor="supresion-motivo"
            className="block text-sm font-medium text-text"
          >
            Motivo
          </label>
          <select
            id="supresion-motivo"
            className={`mt-1 ${CLASE_SELECT}`}
            aria-invalid={errors.motivo ? true : undefined}
            {...register("motivo")}
          >
            {SUPRESION_MOTIVOS.map((motivo) => (
              <option key={motivo} value={motivo}>
                {ETIQUETAS_MOTIVO[motivo]}
              </option>
            ))}
          </select>
          {errors.motivo && (
            <p className={CLASE_ERROR}>{errors.motivo.message}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="supresion-notas"
            className="block text-sm font-medium text-text"
          >
            Notas internas (opcional)
          </label>
          <textarea
            id="supresion-notas"
            rows={3}
            className={`mt-1 ${CLASE_TEXTAREA}`}
            maxLength={SUPRESION_NOTAS_MAX}
            placeholder="Por ejemplo: baja solicitada por respuesta al correo."
            aria-invalid={errors.notas ? true : undefined}
            aria-describedby="supresion-notas-ayuda"
            {...register("notas")}
          />
          <p id="supresion-notas-ayuda" className={CLASE_AYUDA}>
            No pegues datos sensibles ni el email completo. Las notas son
            internas y no se muestran en la lista.
          </p>
          {errors.notas && (
            <p className={CLASE_ERROR}>{errors.notas.message}</p>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-border pt-5">
        <Button type="submit" disabled={enviando || isSubmitting}>
          {enviando && <Loader2 aria-hidden="true" className="animate-spin" />}
          {enviando ? "Registrando…" : "Registrar supresión"}
        </Button>
        <p
          role="status"
          aria-live="polite"
          className="min-h-5 text-xs text-text-dim"
        >
          {enviando
            ? "Registrando la supresión. No se envía ningún email."
            : ""}
        </p>
      </div>
    </form>
  )
}

interface SupresionRevocarFormProps {
  id: string
  etiqueta: string
}

function mensajeErrorRevocar(codigo: string | undefined): string {
  switch (codigo) {
    case "VALIDACION":
      return "Indicá un motivo válido para la excepción."
    case "NO_ENCONTRADO":
      return "La supresión no existe o fue eliminada."
    case "ESTADO":
      return "La supresión ya estaba revocada."
    case "NO_AUTORIZADO":
      return "Tu sesión venció. Volvé a ingresar al portal."
    case "PROHIBIDO":
      return "No tenés permisos para revocar supresiones."
    case "ORIGEN_INVALIDO":
      return "La solicitud no proviene del portal. Recargá la página e intentá de nuevo."
    case "RATE_LIMIT":
      return "Demasiadas solicitudes. Esperá un minuto y volvé a intentar."
    case "ESQUEMA_NO_APLICADO":
      return "El esquema del portal no está aplicado. Avisá al responsable técnico."
    default:
      return "No se pudo revocar la supresión. Intentá de nuevo."
  }
}

export function SupresionRevocarForm({
  id,
  etiqueta,
}: SupresionRevocarFormProps) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [confirmado, setConfirmado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revocada, setRevocada] = useState(false)

  if (revocada) {
    return (
      <p role="status" className="mt-3 text-sm leading-6 text-mint">
        Supresión revocada. No se reabrieron prospectos ni envíos: el admin
        decide el siguiente paso.
      </p>
    )
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-expanded={false}
        aria-label={`Revocar la supresión de ${etiqueta}`}
        className="mt-3 inline-flex rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-300"
      >
        Revocar por excepción…
      </button>
    )
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enviando) return

    const limpio = motivo.trim()
    if (limpio.length === 0) {
      setError("Indicá el motivo de la excepción.")
      return
    }
    if (!confirmado) {
      setError("Confirmá que la revocación es una excepción explícita.")
      return
    }

    setEnviando(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/propuestas/supresiones/${encodeURIComponent(id)}/revocar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo: limpio }),
        },
      )

      const respuesta = await leerRespuesta(res)

      if (!res.ok) {
        const codigo =
          typeof respuesta?.codigo === "string" ? respuesta.codigo : undefined
        setError(mensajeErrorRevocar(codigo))
        return
      }

      setRevocada(true)
      router?.refresh()
    } catch {
      setError("Error de red. Revisá la conexión e intentá de nuevo.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-busy={enviando}
      className="mt-3 max-w-[60ch] rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
    >
      <p className="text-sm leading-6 text-text">
        La revocación deja de bloquear a este contacto, pero{" "}
        <strong>no reabre prospectos ni reactiva envíos</strong>. Usala solo como
        excepción documentada.
      </p>

      <div className="mt-3">
        <label
          htmlFor={`revocar-motivo-${id}`}
          className="block text-sm font-medium text-text"
        >
          Motivo de la excepción
        </label>
        <textarea
          id={`revocar-motivo-${id}`}
          rows={2}
          required
          maxLength={500}
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={`revocar-ayuda-${id}`}
          className={`mt-1 ${CLASE_TEXTAREA}`}
          placeholder="Por ejemplo: autorización expresa del titular."
        />
        <p id={`revocar-ayuda-${id}`} className={CLASE_AYUDA}>
          Se registra quién y cuándo. No incluyas datos sensibles.
        </p>
      </div>

      <label className="mt-3 flex items-start gap-2 text-sm text-text-dim">
        <input
          type="checkbox"
          required
          checked={confirmado}
          onChange={(event) => setConfirmado(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border bg-panel"
        />
        <span>
          Confirmo que la revocación es una excepción explícita y que el
          siguiente paso lo decide el admin.
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-2 font-mono text-xs text-red-400">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={enviando}
        >
          {enviando && <Loader2 aria-hidden="true" className="animate-spin" />}
          {enviando ? "Revocando…" : "Confirmar revocación"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setAbierto(false)
            setMotivo("")
            setConfirmado(false)
            setError(null)
          }}
          className="text-xs text-text-dim underline-offset-4 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

interface SupresionPurgarFormProps {
  id: string
  etiqueta: string
}

function mensajeErrorPurgar(codigo: string | undefined): string {
  switch (codigo) {
    case "VALIDACION":
      return "Indicá un motivo válido para la purga."
    case "NO_ENCONTRADO":
      return "La supresión no existe o ya fue purgada."
    case "ESTADO":
      return "Primero revocá la supresión: solo se pueden purgar las revocadas."
    case "NO_AUTORIZADO":
      return "Tu sesión venció. Volvé a ingresar al portal."
    case "PROHIBIDO":
      return "No tenés permisos para purgar supresiones."
    case "ORIGEN_INVALIDO":
      return "La solicitud no proviene del portal. Recargá la página e intentá de nuevo."
    case "RATE_LIMIT":
      return "Demasiadas solicitudes. Esperá un minuto y volvé a intentar."
    case "ESQUEMA_NO_APLICADO":
      return "El esquema del portal no está aplicado. Avisá al responsable técnico."
    default:
      return "No se pudo purgar la supresión. Intentá de nuevo."
  }
}

export function SupresionPurgarForm({
  id,
  etiqueta,
}: SupresionPurgarFormProps) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [confirmado, setConfirmado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [purgada, setPurgada] = useState(false)

  if (purgada) {
    return (
      <p role="status" className="mt-3 text-sm leading-6 text-mint">
        Supresión purgada. La fila se eliminó definitivamente; no se
        reabrieron prospectos ni envíos.
      </p>
    )
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-expanded={false}
        aria-label={`Purgar la supresión de ${etiqueta}`}
        className="mt-3 inline-flex rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-300"
      >
        Purgar por excepción…
      </button>
    )
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enviando) return

    const limpio = motivo.trim()
    if (limpio.length === 0) {
      setError("Indicá el motivo de la purga.")
      return
    }
    if (!confirmado) {
      setError("Confirmá que la purga es una excepción administrativa definitiva.")
      return
    }

    setEnviando(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/propuestas/supresiones/${encodeURIComponent(id)}/purga`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo: limpio }),
        },
      )

      const respuesta = await leerRespuesta(res)

      if (!res.ok) {
        const codigo =
          typeof respuesta?.codigo === "string" ? respuesta.codigo : undefined
        setError(mensajeErrorPurgar(codigo))
        return
      }

      if (respuesta?.purgada !== true) {
        setError("La respuesta del servidor no es válida.")
        return
      }

      setPurgada(true)
      router?.refresh()
    } catch {
      setError("Error de red. Revisá la conexión e intentá de nuevo.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-busy={enviando}
      className="mt-3 max-w-[60ch] rounded-lg border border-red-500/30 bg-red-500/5 p-4"
    >
      <p className="text-sm leading-6 text-text">
        La purga <strong>borra la fila de supresión de forma definitiva</strong>.
        Es una excepción administrativa: no reabre prospectos ni envíos y no
        modifica sus historiales. Solo se permite sobre supresiones ya
        revocadas. <strong>El texto del motivo no se guarda.</strong>
      </p>

      <div className="mt-3">
        <label
          htmlFor={`purgar-motivo-${id}`}
          className="block text-sm font-medium text-text"
        >
          Motivo de la purga
        </label>
        <textarea
          id={`purgar-motivo-${id}`}
          rows={2}
          required
          maxLength={500}
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={`purgar-ayuda-${id}`}
          className={`mt-1 ${CLASE_TEXTAREA}`}
          placeholder="Por ejemplo: limpieza de un registro revocado por error."
        />
        <p id={`purgar-ayuda-${id}`} className={CLASE_AYUDA}>
          Excepción administrativa: no se guarda el texto del motivo. Solo se
          deja constancia operativa sin datos personales (identificador, admin,
          longitud y hash del motivo). No incluyas datos sensibles.
        </p>
      </div>

      <label className="mt-3 flex items-start gap-2 text-sm text-text-dim">
        <input
          type="checkbox"
          required
          checked={confirmado}
          onChange={(event) => setConfirmado(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border bg-panel"
        />
        <span>
          Confirmo que la purga es una excepción administrativa definitiva y que
          la supresión ya estaba revocada.
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-2 font-mono text-xs text-red-400">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={enviando}
        >
          {enviando && <Loader2 aria-hidden="true" className="animate-spin" />}
          {enviando ? "Purgando…" : "Confirmar purga"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setAbierto(false)
            setMotivo("")
            setConfirmado(false)
            setError(null)
          }}
          className="text-xs text-text-dim underline-offset-4 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
