import {
  Html, Head, Preview, Body, Container, Section, Text, Hr, Link,
} from "@react-email/components"

interface SubscriptionCanceledProps {
  nombre: string
  servicio: string
}

const baseUrl = process.env.NEXT_PUBLIC_URL || "https://pixelarch.dev"

export default function SubscriptionCanceled({
  nombre, servicio,
}: SubscriptionCanceledProps) {
  return (
    <Html>
      <Head />
      <Preview>Suscripcion cancelada — {servicio}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={heading}>Suscripcion cancelada</Text>
          <Text style={paragraph}>Hola {nombre},</Text>
          <Text style={paragraph}>
            Tu suscripcion a <strong>{servicio}</strong> fue cancelada. Si fue
            un error, podes volver a contratarla cuando quieras desde nuestro
            catalogo.
          </Text>
          <Section style={btnContainer}>
            <Link style={button} href={`${baseUrl}/productos`}>
              Ver productos
            </Link>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>Equipo PixelArch</Text>
        </Container>
      </Body>
    </Html>
  )
}

const main = {
  backgroundColor: "#0a0a0a",
  fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif",
  padding: "40px 0",
}

const container = {
  backgroundColor: "#111111",
  border: "1px solid #222",
  borderRadius: "8px",
  margin: "0 auto",
  maxWidth: "560px",
  padding: "40px 32px",
}

const heading = {
  color: "#fafafa",
  fontSize: "24px",
  fontWeight: "700",
  margin: "0 0 24px",
}

const paragraph = {
  color: "#a3a3a3",
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 16px",
}

const btnContainer = {
  margin: "32px 0",
  textAlign: "center" as const,
}

const button = {
  backgroundColor: "#a78bfa",
  borderRadius: "6px",
  color: "#0a0a0a",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: "600",
  padding: "12px 28px",
  textDecoration: "none",
}

const hr = {
  borderColor: "#222",
  margin: "32px 0 16px",
}

const footer = {
  color: "#525252",
  fontSize: "14px",
}
