export interface ServicioFields {
  titulo: string
  slug: string
  descripcion: string
  meta_title?: string
  meta_description?: string
  og_image?: { asset: { url: string } }
  icono: string
  tags: string[]
  precioUnico: number
  precioBasico: number
  precioMantenimiento: number
  orden: number
  activo: boolean
}

export interface LandingFields {
  hero_titulo: string
  hero_subtitulo: string
  hero_cta_primario: string
  hero_cta_secundario: string
  stats: { numero: number; label: string }[]
  proceso_pasos: { titulo: string; descripcion: string }[]
}

export interface SeoFields {
  titulo_sitio?: string
  descripcion?: string
  og_image_url?: string
  keywords?: string[]
}

export interface ContactoFields {
  email: string
  whatsapp: string
  telegram: string
  linkedin: string
  github: string
  instagram: string
}

export interface ArticuloFields {
  _id: string
  titulo: string
  slug: string
  descripcion?: string
  portada?: { asset: { url: string } }
  fecha: string
  autor?: string
  tags?: string[]
  contenido?: unknown[]
  meta_title?: string
  meta_description?: string
  og_image?: { asset: { url: string } }
  activo?: boolean
}
