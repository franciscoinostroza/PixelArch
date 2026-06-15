import type { Metadata } from "next"
import { Syne, DM_Mono } from "next/font/google"
import { ClerkProvider } from "@clerk/nextjs"
import { registerShutdown } from "@/lib/shutdown"
import "./globals.css"

registerShutdown()

const syne = Syne({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "700", "800"],
})

const dmMono = DM_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
})

const baseUrl = process.env.NEXT_PUBLIC_URL || "https://pixelarch.com"

export const metadata: Metadata = {
  title: "PixelArch — Desarrollo Web · Chatbots · Agentes IA",
  description:
    "Creamos sitios web, chatbots inteligentes, agentes de IA y automatizaciones para impulsar tu negocio.",
  metadataBase: new URL(baseUrl),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "PixelArch — Desarrollo Web · Chatbots · Agentes IA",
    description:
      "Creamos sitios web, chatbots inteligentes, agentes de IA y automatizaciones para impulsar tu negocio.",
    url: baseUrl,
    siteName: "PixelArch",
    locale: "es_AR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PixelArch — Desarrollo Web · Chatbots · Agentes IA",
    description:
      "Creamos sitios web, chatbots inteligentes, agentes de IA y automatizaciones para impulsar tu negocio.",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.json",
  other: {
    "theme-color": "#0a0a0f",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const hasClerk =
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== ""

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "PixelArch",
        url: baseUrl,
        description:
          "Creamos sitios web, chatbots inteligentes, agentes de IA y automatizaciones para impulsar tu negocio.",
      },
      {
        "@type": "WebSite",
        url: baseUrl,
        name: "PixelArch",
        description:
          "Creamos sitios web, chatbots inteligentes, agentes de IA y automatizaciones para impulsar tu negocio.",
        potentialAction: {
          "@type": "SearchAction",
          target: `${baseUrl}/productos?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
    ],
  }

  const html = (
    <html
      lang="es"
      className={`${syne.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd),
          }}
        />
        {children}
      </body>
    </html>
  )

  if (!hasClerk) return html

  return (
    <ClerkProvider
      appearance={{
        cssLayerName: "clerk",
        variables: {
          colorPrimary: "#7f5af0",
          colorBackground: "#1a1a2e",
          colorText: "#f1f5f9",
          colorTextSecondary: "#cbd5e1",
          colorInputText: "#f1f5f9",
          colorInputBackground: "#232340",
          colorSuccess: "#2cb67d",
          colorDanger: "#ef4444",
          colorNeutral: "#535a66",
          borderRadius: "8px",
        },
        elements: {
          card: { backgroundColor: "#1a1a2e", boxShadow: "0 8px 32px rgba(0,0,0,0.3)", borderRadius: "12px" },
          headerTitle: { color: "#f1f5f9", fontWeight: 600, fontSize: "1.25rem" },
          headerSubtitle: { color: "#cbd5e1" },
          headerLogo: { display: "none" },
          formFieldLabel: { color: "#cbd5e1", fontSize: "0.8125rem" },
          formFieldInput: { backgroundColor: "#232340", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.12)", outline: "none", borderRadius: "8px", padding: "0.75rem 1rem", fontSize: "0.875rem", transition: "border-color 0.2s", "&:focus": { borderColor: "#7f5af0" }, "&::placeholder": { color: "#6b7280" } },
          formButtonPrimary: { backgroundColor: "#7f5af0", color: "#fff", fontWeight: 500, borderRadius: "8px", padding: "0.75rem 1rem", fontSize: "0.875rem", transition: "background-color 0.2s", "&:hover": { backgroundColor: "#9370ff" } },
          footerActionText: { color: "#cbd5e1", fontSize: "0.8125rem" },
          footerActionLink: { color: "#7f5af0", fontWeight: 500, fontSize: "0.8125rem" },
          footerMessage: { display: "none" },
          dividerText: { color: "#cbd5e1", fontSize: "0.75rem" },
          dividerLine: { backgroundColor: "rgba(255,255,255,0.1)" },
          socialButtonsBlockButton: { backgroundColor: "#232340", border: "1px solid rgba(255,255,255,0.12)", color: "#f1f5f9", borderRadius: "8px", transition: "border-color 0.2s", "&:hover": { borderColor: "rgba(255,255,255,0.25)" } },
          socialButtonsBlockButtonText: { color: "#f1f5f9", fontWeight: 500 },
          identityPreviewText: { color: "#f1f5f9" },
          identityPreviewEditButton: { color: "#7f5af0" },
          formFieldInputShowPasswordButton: { color: "#cbd5e1" },
          formFieldErrorText: { color: "#ef4444", fontSize: "0.75rem" },
          formFieldSuccessText: { color: "#2cb67d", fontSize: "0.75rem" },
          alert: { backgroundColor: "#232340", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" },
          alertText: { color: "#f1f5f9" },
          developmentModeText: { display: "none" },
          userButtonBox: { border: "1px solid rgba(255,255,255,0.12)", borderRadius: "9999px" },
          userButtonPopoverCard: { backgroundColor: "#232340", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" },
          userButtonPopoverActionButton: { color: "#f1f5f9", borderRadius: "6px", "&:hover": { backgroundColor: "rgba(127,90,240,0.15)" } },
          userButtonPopoverActionButtonText: { color: "#f1f5f9" },
        },
      }}
      unsafe_disableDevelopmentModeConsoleWarning={true}
    >
      {html}
    </ClerkProvider>
  )
}
