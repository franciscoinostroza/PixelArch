/**
 * Crea 6 articulos nuevos en Sanity para el blog de PixelArch
 * Uso: node node_modules/tsx/dist/cli.mjs src/scripts/seed-articulos.ts
 * Requiere SANITY_API_TOKEN en .env.local
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { createClient } from "@sanity/client"
import sharp from "sharp"
import { coverSvg } from "./covers"

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "production",
  apiVersion: "2024-01-01",
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
})

interface ArticuloSeed {
  slug: string
  titulo: string
  descripcion: string
  fecha: string
  tags: string[]
  meta_title: string
  meta_description: string
  contenido: string[]
}

const ARTICULOS: ArticuloSeed[] = [
  {
    slug: "landing-pages-que-convierten",
    titulo: "Landing pages que convierten: la estructura que usamos en cada proyecto",
    descripcion: "Una landing bonita no vende. Te mostramos la estructura exacta que usamos en cada proyecto para convertir visitas en clientes.",
    fecha: "2026-09-09",
    tags: ["Landing pages", "Conversión", "SEO", "Diseño web"],
    meta_title: "Landing pages que convierten: estructura y metodología | PixelArch",
    meta_description: "La estructura que usamos en cada landing page: hero, prueba social, beneficios, FAQ y CTA. Método probado para convertir visitas en clientes.",
    contenido: [
      "La página de inicio de la mayoría de las pymes cuenta la historia del emprendedor: cómo empezó, qué le apasiona, cuánto le costó. Esa página no vende. La persona que la visita llega con una pregunta en la cabeza ('¿este producto resuelve mi problema?') y se va sin respuesta, porque el texto le contó otra cosa.",
      "Una landing page efectiva no es más linda que una web tradicional: está estructurada para responder la pregunta del visitante en el orden exacto en que la hace. Esa estructura se puede repetir en cualquier proyecto, y es la que usamos en PixelArch.",
      "H2: La estructura que repetimos en cada landing",
      "El orden importa más que el diseño. En cada landing que construimos, la información aparece en esta secuencia:",
      "BULLET:Hero con una sola promesa: qué es, para quién, y una sola acción posible. Un visitante que lee tres ofertas distintas no hace ninguna.",
      "BULLET:Prueba social cerca del hero: números, logos, clientes. La prueba social no es un adorno del final; es lo que sostiene la promesa inicial.",
      "BULLET:Tres beneficios concretos, no tres características. 'Respondemos en menos de 24hs' vende más que 'Atención personalizada'.",
      "BULLET:Cómo funciona en pasos: desarmar el proceso en tres o cuatro pasos elimina el miedo a lo desconocido.",
      "BULLET:Preguntas frecuentes antes del formulario: las dudas que frenan a alguien justo antes de escribir ('¿cómo cancelo?', '¿en qué moneda cobran?') tienen que estar respondidas ahí.",
      "BULLET:Un solo CTA principal, repetido: el botón de acción aparece al menos tres veces, siempre con el mismo texto.",
      "H2: La velocidad también es conversión",
      "Una landing que tarda cuatro segundos en cargar pierde más de la mitad de los visitantes en móviles. Los Core Web Vitals que Google mide (velocidad de carga, estabilidad visual, respuesta a interacciones) son los mismos que el visitante percibe como 'esta página anda bien' o 'esta página anda mal'.",
      "Por eso en PixelArch cada landing se construye con métricas de rendimiento en la mesa desde el día uno: imágenes optimizadas, fuentes que no bloquean la renderización y código sin librerías innecesarias. No es una mejora posterior: es parte del proceso.",
      "H2: Qué medimos después de publicar",
      "Publicar es el punto de partida, no la meta. Las dos semanas siguientes a cada lanzamiento medimos:",
      "BULLET:Qué sección ve la gente y en cuál se queda (mapa de scroll y de calor).",
      "BULLET:Qué botones reciben clics y cuáles nadie toca.",
      "BULLET:Qué formularios se envían y cuáles se abandonan a mitad de camino.",
      "BULLET:De dónde viene el tráfico que sí convierte, para invertir más ahí.",
      "Con esos datos ajustamos el texto y el orden de las secciones. Las mejores conversiones aparecen después de la segunda o tercera iteración, no en el primer diseño.",
      "H2: Cómo arrancar",
      "Si tu página actual no convierte, el primer paso no es rediseñarla entera: es medir dónde se pierde la gente y corregir el mensaje. En PixelArch regalamos una auditoría exprés de landing pages — velocidad, SEO, conversión y seguridad — para que sepas exactamente qué cambiar primero y qué puede esperar.",
    ],
  },
  {
    slug: "que-es-un-agente-de-ia",
    titulo: "Qué es un agente de IA (y qué puede hacer por tu negocio)",
    descripcion: "Chatbots que responden, agentes que actúan: la diferencia que cambia cómo tu negocio usa la inteligencia artificial. Explicado sin tecnicismos.",
    fecha: "2026-09-09",
    tags: ["IA", "Agentes", "Automatización", "Negocios"],
    meta_title: "Qué es un agente de IA y qué puede hacer por tu negocio | PixelArch",
    meta_description: "La diferencia entre un chatbot y un agente de IA, con ejemplos concretos por rubro: qué hacen, qué necesitan y cuánto cuesta ponerlos a trabajar.",
    contenido: [
      "Los chatbots resolvieron una parte del problema: pueden responder preguntas frecuentes las 24 horas. Pero se quedan cortos en el siguiente paso. Un cliente no solo pregunta: también quiere que algo pase. Que se le genere una factura, que se le confirme un turno, que se le reembolse un envío.",
      "Ahí aparece la diferencia entre un chatbot y un agente de IA. El chatbot responde. El agente, además, actúa.",
      "H2: La diferencia en una frase",
      "Un chatbot te dice qué hacer. Un agente de IA lo hace por vos: analiza la situación, decide qué paso corresponde y ejecuta la acción conectándose con tus herramientas — el sistema de facturación, el calendario, el correo, la base de clientes.",
      "Para decirlo simple: si un cliente escribe 'perdí el acceso a mi cuenta', el chatbot responde 'te paso con un humano'. El agente verifica la identidad, genera un link de recuperación y lo envía, mientras te avisa a vos por Slack que el incidente quedó resuelto.",
      "H2: Qué tareas son candidatas reales",
      "No todo sirve para un agente. Los mejores candidatos comparten tres características: son repetitivos, siguen reglas claras y hoy ocupan horas de una persona. Ejemplos concretos:",
      "BULLET:Atención al cliente que termina en acciones: reembolsos, cambios de plan, recuperación de cuentas.",
      "BULLET:Clasificación y respuesta de correos: separa lo urgente de lo informativo, redacta borradores y los deja listos para aprobar.",
      "BULLET:Reportes periódicos: junta datos de ventas, los resume en lenguaje simple y los envía cada lunes a las 9.",
      "BULLET:Seguimiento de leads: cuando un prospecto pide presupuesto, el agente envía la propuesta, recuerda el seguimiento y avisa si no hubo respuesta.",
      "H2: Qué necesita para funcionar bien",
      "Un agente es tan bueno como la información a la que accede. Antes de construir uno, hay que definir:",
      "BULLET:Qué herramientas puede tocar y cuáles no (reglas de permisos claras).",
      "BULLET:Qué decisiones puede tomar solo y cuáles requieren aprobación humana.",
      "BULLET:Cómo se registra cada acción, para que nada pase desapercibido.",
      "BULLET:Un protocolo de escalada: cuándo el agente se detiene y pasa el problema a una persona.",
      "H2: El costo real",
      "Contrario a lo que se piensa, un agente de IA bien acotado puede costar menos que una hora diaria de trabajo manual. La inversión no está en el modelo de IA, sino en conectarlo bien con tus sistemas y definir las reglas. Por eso los proyectos se cotizan según el alcance, no por 'el precio de la IA'.",
      "H2: Por dónde empezar",
      "El punto de partida es elegir una sola tarea repetitiva que hoy te robe horas, no tres. Con una tarea bien resuelta, el resto se encadena solo. Si no sabés por dónde cortar, una auditoría gratuita de tus procesos sirve para detectar la primera automatización que valga la pena.",
    ],
  },
  {
    slug: "5-tareas-para-automatizar",
    titulo: "5 tareas para automatizar hoy (y cuántas horas te devuelven)",
    descripcion: "La automatización no es para empresas grandes. Estas cinco tareas — con horas devueltas reales — son las que más repetimos en PyMEs.",
    fecha: "2026-09-09",
    tags: ["Automatización", "Productividad", "n8n", "Workflows"],
    meta_title: "5 tareas para automatizar hoy y cuántas horas te devuelven | PixelArch",
    meta_description: "Cinco automatizaciones concretas para PyMEs con estimaciones de horas devueltas: WhatsApp, facturación, reportes, calendario y respaldo de datos.",
    contenido: [
      "La idea de 'automatizar la empresa' suena a proyecto de tres meses y cinco cifras. La realidad es distinta: la mayoría de los beneficios vienen de automatizar tareas pequeñas y repetitivas que hoy se hacen a mano. Estas cinco son las que más repetimos en clientes chicos, con la cantidad de horas que devuelven por semana.",
      "H2: 1. Respuesta a consultas frecuentes por WhatsApp y email",
      "La misma pregunta ('¿hacen envíos?', '¿cuál es el horario?', '¿cómo pago?') llega todos los días. Un asistente automático responde al instante y deriva a una persona solo las consultas que no sabe resolver.",
      "BULLET:Horas devueltas: 3 a 5 por semana por cada canal.",
      "BULLET:Bonus: las respuestas llegan a cualquier hora, incluida la madrugada.",
      "H2: 2. Reconocimiento de pagos y avisos",
      "Cuando un cliente paga, el aviso suele llegar al correo del dueño y morir ahí. Una automatización detecta el pago, lo registra, envía el comprobante al cliente y avisa al equipo que ya puede despachar.",
      "BULLET:Horas devueltas: 2 a 3 por semana, y menos errores de facturación.",
      "BULLET:Bonus: nadie vuelve a decir 'el pago no me llegó'.",
      "H2: 3. El reporte semanal de ventas",
      "En vez de juntar números de tres plataformas cada lunes, un flujo automático arma el resumen: vendido, cobrado, pendiente, clientes nuevos. Llega por email o Slack a la hora que elijas.",
      "BULLET:Horas devueltas: 1 a 2 por semana, todos los lunes a las 9.",
      "H2: 4. Coordinación de turnos y reuniones",
      "Para quienes venden por turnos (consultas, servicios, soporte), un bot de agendamiento propone horarios, confirma la cita y envía recordatorios automáticos. Las ausencias se reducen a la mitad cuando el recordatorio existe.",
      "BULLET:Horas devueltas: 2 a 4 por semana en coordinación.",
      "H2: 5. Respaldo y alertas de datos",
      "Una copia de seguridad automática y una alerta cuando algo falla no te devuelven horas: te evitan perder un mes de trabajo en un día. Es la automatización más barata y la que más clientes arrancan después de una tragedia.",
      "BULLET:Horas devueltas: indefinidas — es un seguro, no una tarea.",
      "H2: La regla de oro",
      "Automatizar no es eliminar personas: es eliminar tareas que nadie disfruta. El equipo gana tiempo para lo que sí genera ventas: atender mejor, proponer más y cerrar negocios.",
      "Si querés saber cuál de estas cinco se adapta a tu caso, el primer paso es un mapeo corto de tus tareas repetitivas — lo hacemos sin cargo en una auditoría exprés.",
    ],
  },
  {
    slug: "hosting-compartido-vs-gestionado",
    titulo: "Hosting compartido vs gestionado: por qué tu web se cae",
    descripcion: "Tu web no se cae por casualidad: casi siempre es el hosting. Comparamos compartido, VPS y gestionado para que elijas con datos.",
    fecha: "2026-09-09",
    tags: ["Hosting", "Infraestructura", "Rendimiento", "Seguridad"],
    meta_title: "Hosting compartido vs gestionado: por qué tu web se cae | PixelArch",
    meta_description: "Compartido, VPS o gestionado: qué diferencia hay, por qué se caen las webs y qué buscar al elegir hosting para tu negocio.",
    contenido: [
      "La web se cayó a las 3 de la tarde, justo cuando llegaban los pedidos. El dueño del negocio mira la pantalla y la primera sospecha es 'se cayó el sitio'. Casi nunca es así: lo que se cayó fue el servidor donde ese sitio vive. Y la razón, en la mayoría de los casos, está en el tipo de hosting contratado.",
      "H2: Los tres niveles de hosting",
      "BULLET:Compartido: tu web comparte un servidor con cientos de otras webs. Es barato y suficiente para sitios de prueba, pero el rendimiento depende de lo que hagan tus 'vecinos'. Si uno recibe un pico de tráfico o es atacado, tu web se ralentiza o cae con él.",
      "BULLET:VPS (servidor privado virtual): tu parte del servidor está aislada. El rendimiento es predecible y podés instalar lo que quieras. El costo: la administración es tuya — actualizaciones, seguridad, backups.",
      "BULLET:Gestionado (managed): un VPS o servidor dedicado donde un equipo se encarga de todo lo aburrido: actualizaciones, monitoreo, backups, renovación de SSL, respuesta ante caídas.",
      "H2: Por qué se cae una web (en orden de frecuencia)",
      "BULLET:El 'vecino ruidoso' en hosting compartido: un pico de tráfico o un ataque a otra web del mismo servidor.",
      "BULLET:SSL vencido: la web sigue funcionando, pero el navegador la muestra como insegura y el tráfico se derrumba.",
      "BULLET:Sin monitoreo: nadie se entera de la caída hasta que llega el primer reclamo, a veces horas después.",
      "BULLET:Sin backups: la caída no es el problema; el problema es no poder volver a un punto anterior.",
      "BULLET:Actualizaciones desatendidas: el software viejo es la puerta de entrada de los ataques automatizados.",
      "H2: Lo que nadie te cuenta del hosting barato",
      "El hosting compartido 'ilimitado' publicita espacio y ancho de banda, pero la variable que importa — la capacidad de procesamiento — es la que se reparte entre todos. Cuando tu web crece, el plan que parecía gratis te cobra en lentitud lo que no te cobró en dinero.",
      "El momento de migrar no es cuando la web se cae: es cuando el tráfico legítimo empieza a crecer. Migrar con calma toma una tarde; migrar en emergencia toma una tarde y un cliente perdido.",
      "H2: Qué busca un dueño de negocio que no quiere saber de servidores",
      "Un plan gestionado tiene sentido cuando el tiempo vale más que la diferencia de precio. Lo que recibís a cambio:",
      "BULLET:Monitoreo activo 24/7 con alertas antes de que el cliente se queje.",
      "BULLET:SSL renovado automáticamente, sin vencimientos sorpresa.",
      "BULLET:Backups automáticos con restauración comprobada.",
      "BULLET:Actualizaciones de seguridad aplicadas sin que tengas que pedirlas.",
      "BULLET:Una persona responsable cuando algo falla.",
      "H2: Nuestra recomendación práctica",
      "Para un sitio institucional sin tráfico, el compartido alcanza. Para un negocio que cobra por su web — e-commerce, reservas, consultas — el costo de una caída no justifica el ahorro. La pregunta correcta no es '¿cuánto cuesta el hosting gestionado?', sino '¿cuánto pierdo el día que la web no esté online?'.",
    ],
  },
  {
    slug: "como-cobrar-online-argentina-chile",
    titulo: "Cómo cobrar online en Argentina y Chile sin perder ventas",
    descripcion: "Cobrar en el día con un cliente argentino y otro chileno parece un laberinto. Guía práctica de pasarelas, tipos de cambio y checkouts que no frenan compradores.",
    fecha: "2026-09-09",
    tags: ["Pagos online", "E-commerce", "Argentina", "Chile"],
    meta_title: "Cómo cobrar online en Argentina y Chile sin perder ventas | PixelArch",
    meta_description: "Guía práctica para cobrar online en Argentina y Chile: tarjetas internacionales, Mercado Pago, Polar y Stripe, tipos de cambio y checkouts que convierten.",
    contenido: [
      "Cobrar online en Argentina y Chile tiene una dificultad que no existe en otros mercados: la moneda. Un cliente argentino piensa en pesos, un chileno en pesos chilenos, y el negocio necesita pagar proveedores en dólares. Si el checkout no resuelve esa traducción, el carrito se abandona justo en el último paso.",
      "H2: El problema real no es la pasarela, es el tipo de cambio",
      "Muchos negocios fijan un precio en dólares y lo convierten a mano con el valor del mes pasado. Resultado: o pierden margen cuando el dólar sube, o el precio se ve desactualizado y el cliente desconfía.",
      "La solución práctica es fijar precios en dólares y convertir automáticamente al día, con una fuente confiable por país (en Argentina, el dólar venta Banco Nación; en Chile, el dólar del Banco Central). Así el precio siempre está fresco y la conversión es transparente para el comprador.",
      "H2: Qué opciones existen para cobrar",
      "BULLET:En Argentina: Mercado Pago para pagos locales en pesos (transferencia, tarjeta, cuotas) y pasarelas internacionales para cobrar en dólares a clientes de afuera.",
      "BULLET:En Chile: Stripe funciona de forma directa y es la opción más estándar para tarjetas internacionales y suscripciones.",
      "BULLET:Para suscripciones y productos digitales en ambos países: plataformas globales como Polar permiten cobrar en dólares con facturación automática y portal de cliente, sin necesidad de constituir una empresa en cada país.",
      "BULLET:Siempre: PayPal o transferencia directa como alternativa de respaldo para casos puntuales.",
      "H2: El checkout que no frena compradores",
      "El 70% de los carritos se abandona, y la mayoría de las veces la causa es el propio checkout: pedir demasiados datos, cobrar en una moneda inesperada o no mostrar el total final antes de pagar. Las reglas que aplicamos en cada integración de pagos:",
      "BULLET:Mostrar el precio final y la moneda antes de pedir la tarjeta.",
      "BULLET:Mostrar el equivalente local cuando el cobro es en dólares ('≈ $38.500 ARS'), para que nadie se sorprenda.",
      "BULLET:Permitir pagar sin crear cuenta: la cuenta se puede ofrecer después, nunca antes.",
      "BULLET:Enviar el comprobante automáticamente y con el detalle de lo comprado.",
      "H2: Y si vendés servicios mensuales",
      "Las suscripciones agregan dos capas de complejidad: el cobro recurrente y la cancelación. Un buen sistema de pagos recurrente te da:",
      "BULLET:Cobros automáticos sin que tengas que acordarte.",
      "BULLET:Un portal donde el cliente ve sus pagos y gestiona su plan.",
      "BULLET:Reintentos inteligentes cuando una tarjeta falla (ahí se recuperan muchas ventas).",
      "BULLET:Comprobantes y recibos enviados solos, cada mes.",
      "H2: Cómo empezar sin morir en el intento",
      "Arrancá simple: una pasarela, precios en dólares con conversión automática y el checkout más corto posible. Cuando el volumen lo justifique, agregás suscripciones y facturación automática. Si ya tenés algo funcionando pero perdés ventas en el último paso, una auditoría de tu checkout actual suele revelar la causa en la primera revisión.",
    ],
  },
  {
    slug: "monitoreo-24-7",
    titulo: "¿Tu web está caída y no te enterás? Monitoreo 24/7",
    descripcion: "Una caída sin monitoreo no se detecta: se descubre. Cuánto cuesta, por qué no te enterás y qué vigila un servicio de monitoreo serio.",
    fecha: "2026-09-09",
    tags: ["Monitoreo", "Uptime", "Mantenimiento", "Soporte"],
    meta_title: "Monitoreo 24/7: tu web caída y no te enterás | PixelArch",
    meta_description: "Cuánto cuesta una caída sin detectar, por qué el monitoreo pasivo no alcanza y qué vigila un servicio de mantenimiento serio en tu web.",
    contenido: [
      "Hay dos tipos de caídas de web: las que nadie nota y las que nadie descubre. Las primeras duran minutos y se resuelven solas. Las segundas duran horas — a veces días — y se descubren cuando un cliente escribe para preguntar '¿qué pasó con mi pedido?'. La diferencia entre una y otra se llama monitoreo.",
      "H2: El costo real de una caída",
      "Una hora sin web no se mide solo en ventas perdidas. Se mide en:",
      "BULLET:Ventas directas que no se procesaron (el costo obvio).",
      "BULLET:SEO: si la caída se repite, Google pierde confianza y el posicionamiento baja durante semanas.",
      "BULLET:Confianza: cada visitante que encontró la web caída y no volvió es un cliente que no vas a recuperar.",
      "BULLET:Horas de reclamos: el soporte responde 'estamos revisando' mientras el problema lleva horas resuelto en silencio.",
      "H2: Por qué no te enterás",
      "El problema de no tener monitoreo no es la caída en sí: es que nadie la detecta hasta que alguien la padece. El servidor no te llama para avisarte. El 'revisemos de vez en cuando' de un amigo técnico no funciona porque la mayoría de las caídas ocurren de noche o los fines de semana — justo cuando nadie revisa.",
      "H2: Qué vigila un monitoreo serio",
      "Un servicio de monitoreo completo no se limita a 'ping, está vivo'. Vigila:",
      "BULLET:Disponibilidad: que la web responda desde distintos puntos del mundo, no solo desde tu oficina.",
      "BULLET:SSL: que el certificado esté vigente, con alerta antes de que expire (la caída más silenciosa de todas).",
      "BULLET:Tiempo de respuesta: que cargue rápido, no solo que cargue. Una web que tarda 8 segundos está 'online' y es igual de inútil.",
      "BULLET:Backups: que las copias se generen y que se puedan restaurar — un backup que nunca se probó no es un backup.",
      "BULLET:Logs y errores: los errores de servidor que se acumulan sin que nadie los vea.",
      "H2: Qué pasa cuando algo falla (la parte que importa)",
      "El monitoreo detecta; el servicio se completa cuando alguien arregla. Un plan de mantenimiento real tiene dos fases: la alerta automática (correo, WhatsApp, Slack) y la respuesta humana — la persona que ya conoce tu infraestructura y actúa sobre el problema, no un ticket que espera turno.",
      "H2: La regla práctica",
      "Si tu web es tu principal canal de venta o de consultas, el monitoreo no es un extra: es parte del costo de tener el negocio online. La pregunta no es '¿cuánto cuesta monitorearla?' sino '¿cuánto me costó la última caída que nadie detectó?'.",
    ],
  },
]

function blocks(items: string[]) {
  return items.map((raw) => {
    if (raw.startsWith("H2:")) {
      return {
        _type: "block",
        style: "h2",
        children: [{ _type: "span", text: raw.slice(3) }],
      }
    }
    if (raw.startsWith("BULLET:")) {
      return {
        _type: "block",
        style: "normal",
        listItem: "bullet",
        level: 1,
        children: [{ _type: "span", text: raw.slice(7) }],
      }
    }
    return {
      _type: "block",
      style: "normal",
      children: [{ _type: "span", text: raw }],
    }
  })
}

async function run() {
  console.log("Conectando a Sanity...\n")

  for (const a of ARTICULOS) {
    const existing = await client.fetch(`*[_type == "articulo" && slug.current == $slug][0]{_id}`, { slug: a.slug })
    if (existing) {
      console.log(`SKIP  ${a.slug} (ya existe)`)
      continue
    }

    const svg = coverSvg(a.slug, a.titulo)
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    const asset = await client.assets.upload("image", png, {
      contentType: "image/png",
      filename: `${a.slug}-cover.png`,
    })

    const doc = {
      _type: "articulo",
      titulo: a.titulo,
      slug: { _type: "slug", current: a.slug },
      descripcion: a.descripcion,
      portada: { _type: "image", asset: { _type: "reference", _ref: asset._id } },
      fecha: a.fecha,
      autor: "PixelArch",
      tags: a.tags,
      contenido: blocks(a.contenido),
      meta_title: a.meta_title,
      meta_description: a.meta_description,
      og_image: { _type: "image", asset: { _type: "reference", _ref: asset._id } },
      activo: true,
    }

    await client.create(doc)
    console.log(`OK    ${a.slug} — ${a.titulo}`)
  }

  console.log("\nListo. Revisa https://pixelarch.dev/blog")
}

run().catch((e) => {
  console.error("Error:", e)
  process.exit(1)
})