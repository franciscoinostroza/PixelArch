import type { Metadata } from "next"
import { Syne, DM_Mono } from "next/font/google"
import { ClerkProvider } from "@clerk/nextjs"
import { PaddleScript } from "@/components/ui/paddle-script"
import Script from "next/script"
import "./globals.css"

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

export const metadata: Metadata = {
  title: "PixelArch — Desarrollo Web · Chatbots · Agentes IA",
  description:
    "Creamos sitios web, chatbots inteligentes, agentes de IA y automatizaciones para impulsar tu negocio.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const hasClerk =
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== ""

  const html = (
    <html
      lang="es"
      className={`${syne.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Script id="remove-clerk-dev-badge" strategy="afterInteractive">
          {`setTimeout(function() {
            var badges = document.querySelectorAll('[class*="development"], [class*="cl-development"], [data-clerk-component*="dev"]');
            badges.forEach(function(b) { b.remove(); });
          }, 500);`}
        </Script>
        <PaddleScript />
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
          colorBackground: "#0a0a0f",
          colorText: "#fffffe",
          colorTextSecondary: "#94a1b2",
          colorInputText: "#fffffe",
          colorInputBackground: "#111118",
          colorSuccess: "#2cb67d",
          colorDanger: "#ef4444",
          colorNeutral: "#535a66",
          borderRadius: "8px",
        },
        elements: {
          card: "bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)]",
          headerTitle: "text-[#fffffe]",
          headerSubtitle: "text-[#94a1b2]",
          formFieldLabel: "text-[#94a1b2]",
          formFieldInput: "bg-[#111118] text-[#fffffe] border-[rgba(255,255,255,0.07)]",
          formButtonPrimary: "bg-[#7f5af0] hover:bg-[#9370ff]",
          footerActionText: "text-[#94a1b2]",
          footerActionLink: "text-[#7f5af0]",
          dividerText: "text-[#94a1b2]",
          dividerLine: "bg-[rgba(255,255,255,0.07)]",
          socialButtonsBlockButton: "bg-[#111118] border-[rgba(255,255,255,0.07)] text-[#fffffe]",
          socialButtonsBlockButtonText: "text-[#fffffe]",
          identityPreviewText: "text-[#fffffe]",
          identityPreviewEditButton: "text-[#7f5af0]",
          formFieldInputShowPasswordButton: "text-[#94a1b2]",
          formFieldErrorText: "text-[#ef4444]",
          formFieldSuccessText: "text-[#2cb67d]",
          alert: "bg-[#111118] border-[rgba(255,255,255,0.07)]",
          alertText: "text-[#fffffe]",
          userButtonPopoverCard: "bg-[#111118] border border-[rgba(255,255,255,0.07)]",
          userButtonPopoverActionButton: "text-[#fffffe] hover:bg-[#7f5af0]/10",
          userButtonPopoverActionButtonText: "text-[#fffffe]",
          userButtonPopoverFooter: "border-t border-[rgba(255,255,255,0.07)]",
        },
      }}
      unsafe_disableDevelopmentModeConsoleWarning={true}
    >
      {html}
    </ClerkProvider>
  )
}
