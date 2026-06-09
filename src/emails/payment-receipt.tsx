import {
  Html, Head, Preview, Body, Container, Section, Text, Hr,
} from "@react-email/components"

interface PaymentReceiptProps {
  nombre: string
  monto: string
  moneda: string
  servicio: string
}

export default function PaymentReceipt({
  nombre, monto, moneda, servicio,
}: PaymentReceiptProps) {
  return (
    <Html>
      <Head />
      <Preview>Recibo de pago — {servicio}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={heading}>Recibo de pago</Text>
          <Text style={paragraph}>Hola {nombre},</Text>
          <Text style={paragraph}>
            Tu pago de <strong>${monto} {moneda}</strong> por{" "}
            <strong>{servicio}</strong> fue procesado exitosamente.
          </Text>
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

const hr = {
  borderColor: "#222",
  margin: "32px 0 16px",
}

const footer = {
  color: "#525252",
  fontSize: "14px",
}
