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
          card: "bg-[#1a1a2e] shadow-md shadow-black/20",
          headerTitle: "text-[#f1f5f9] font-semibold",
          headerSubtitle: "text-[#cbd5e1]",
          formFieldLabel: "text-[#cbd5e1]",
          formFieldInput: "bg-[#232340] text-[#f1f5f9] border border-[rgba(255,255,255,0.15)] focus:border-[#7f5af0]",
          formButtonPrimary: "bg-[#7f5af0] hover:bg-[#9370ff] text-white font-medium",
          footerActionText: "text-[#cbd5e1]",
          footerActionLink: "text-[#7f5af0] font-medium",
          dividerText: "text-[#cbd5e1]",
          dividerLine: "bg-[rgba(255,255,255,0.12)]",
          socialButtonsBlockButton: "bg-[#232340] border-[rgba(255,255,255,0.15)] text-[#f1f5f9]",
          socialButtonsBlockButtonText: "text-[#f1f5f9]",
          identityPreviewText: "text-[#f1f5f9]",
          identityPreviewEditButton: "text-[#7f5af0]",
          formFieldInputShowPasswordButton: "text-[#cbd5e1]",
          formFieldErrorText: "text-[#ef4444]",
          formFieldSuccessText: "text-[#2cb67d]",
          alert: "bg-[#232340] border-[rgba(255,255,255,0.12)]",
          alertText: "text-[#f1f5f9]",
          developmentModeText: "hidden",
          userButtonBox: "border border-border rounded-full",
          userButtonPopoverCard: "bg-[#232340] border border-[rgba(255,255,255,0.15)]",
          userButtonPopoverActionButton: "text-[#f1f5f9] hover:bg-[#7f5af0]/10",
          userButtonPopoverActionButtonText: "text-[#f1f5f9]",
        },
      }}
      unsafe_disableDevelopmentModeConsoleWarning={true}
    >
      {html}
    </ClerkProvider>
  )
}
