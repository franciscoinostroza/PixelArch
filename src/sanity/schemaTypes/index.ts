import { type SchemaTypeDefinition } from 'sanity'
import servicio from '../../../sanity/schemas/servicio'
import landing from '../../../sanity/schemas/landing'
import seo from '../../../sanity/schemas/seo'
import contacto from '../../../sanity/schemas/contacto'

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [servicio, landing, seo, contacto],
}
