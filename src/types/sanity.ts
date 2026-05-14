export interface ServicioFields {
  titulo: string
  slug: string
  descripcion: string
  icono: string
  tags: string[]
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
  titulo_sitio: string
  descripcion: string
  og_image: string
  keywords: string[]
}

export interface ContactoFields {
  email: string
  whatsapp: string
  telegram: string
  linkedin: string
  github: string
  instagram: string
}
