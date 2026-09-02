"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { AsignarProductoModal } from "@/components/ui/asignar-producto-modal"
import { Plus } from "lucide-react"

interface Servicio {
  id: string
  nombre: string
}

export function AsignarProductoButton({ clienteId, servicios }: { clienteId: string; servicios: Servicio[] }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size="sm" variant="accent2" onClick={() => setOpen(true)}>
        <Plus size={14} />
        Asignar producto
      </Button>
      <AsignarProductoModal isOpen={open} onClose={() => setOpen(false)} clienteId={clienteId} servicios={servicios} />
    </>
  )
}
