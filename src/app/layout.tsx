import type { Metadata } from "next"
import { Syne, DM_Mono } from "next/font/google"
import { ClerkProvider } from "@clerk/nextjs"
import { registerShutdown } from "@/lib/shutdown"
import { sanityFetch } from "@/lib/sanity"
import type { SeoFields } from "@/types/sanity"
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

const baseUrl = process.env.NEXT_PUBLIC_URL || "https://pixelarch.dev"

const SEO_QUERY = `*[_type == "seo"][0]{ titulo_sitio, descripcion, "og_image_url": og_image.asset->url, keywords }`

const DEFAULTS = {
  title: "PixelArch — Desarrollo Web · Chatbots · Agentes IA",
  description:
    "Creamos sitios web, chatbots inteligentes, agentes de IA y automatizaciones para impulsar tu negocio.",
}

async function getSeo() {
  return sanityFetch<SeoFields>(SEO_QUERY)
}

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSeo()
  const title = seo?.titulo_sitio || DEFAULTS.title
  const description = seo?.descripcion || DEFAULTS.description
  const ogImage = seo?.og_image_url || "/og-image.png"

  return {
    title,
    description,
    metadataBase: new URL(baseUrl),
    alternates: { canonical: "/" },
    openGraph: {
      title,
      description,
      url: baseUrl,
      siteName: "PixelArch",
      locale: "es_AR",
      type: "website",
      images: [{ url: ogImage, width: 1536, height: 1024, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
    icons: {
      icon: "/icon-192.svg",
      apple: "/apple-touch-icon.png",
    },
    manifest: "/manifest.json",
    other: { "theme-color": "#0a0a0f" },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const hasClerk =
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== ""

  const seo = await getSeo()
  const description =
    seo?.descripcion ||
    "Creamos sitios web, chatbots inteligentes, agentes de IA y automatizaciones para impulsar tu negocio."
  const website: Record<string, unknown> = {
    "@type": "WebSite",
    url: baseUrl,
    name: "PixelArch",
    description,
    potentialAction: {
      "@type": "SearchAction",
      target: `${baseUrl}/productos?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  }
  if (seo?.keywords?.length) {
    website.keywords = seo.keywords.join(", ")
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "PixelArch",
        url: baseUrl,
        description,
      },
      website,
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
        <style id="clerk-override">{`.cl-footerItem{display:none!important}`}</style>
        {children}
      </body>
    </html>
  )

  if (!hasClerk) return html

  return (
    <ClerkProvider
        appearance={{
        layout: { showClerkBranding: false },
        variables: {
          colorPrimary: "#7f5af0",
          colorBackground: "#14142a",
          colorText: "#f1f5f9",
          colorTextSecondary: "#94a3b8",
          colorInputText: "#f1f5f9",
          colorInputBackground: "rgba(255,255,255,0.04)",
          colorSuccess: "#2cb67d",
          colorDanger: "#ef4444",
          colorNeutral: "#535a66",
          borderRadius: "10px",
        },
        elements: {
          // === SignIn / SignUp ===
          card: {
            background: "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)",
            boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 40px rgba(127,90,240,0.06)",
            borderRadius: "16px",
            border: "1px solid rgba(127,90,240,0.12)",
            padding: "2rem",
          },
          headerTitle: { color: "#f1f5f9", fontWeight: 700, fontSize: "1.375rem", letterSpacing: "-0.02em" },
          headerSubtitle: { color: "#94a3b8", fontSize: "0.875rem", marginTop: "0.25rem" },
          headerLogo: { display: "none" },
          formFieldLabel: { color: "#94a3b8", fontSize: "0.8125rem", fontWeight: 500, marginBottom: "0.375rem" },
          formFieldInput: {
            background: "rgba(255,255,255,0.04)",
            color: "#f1f5f9",
            border: "1.5px solid rgba(255,255,255,0.08)",
            borderRadius: "10px",
            padding: "0.875rem 1rem",
            fontSize: "0.875rem",
            outline: "none",
            transition: "all 0.25s ease",
            "&:focus": { borderColor: "#7f5af0", boxShadow: "0 0 0 4px rgba(127,90,240,0.12), 0 4px 12px rgba(0,0,0,0.2)" },
            "&::placeholder": { color: "#6b7280" },
          },
          formButtonPrimary: {
            background: "linear-gradient(135deg, #7f5af0 0%, #6d4ed8 50%, #7f5af0 100%)",
            backgroundSize: "200% 200%",
            color: "#fff",
            fontWeight: 600,
            borderRadius: "10px",
            padding: "0.875rem 1rem",
            fontSize: "0.875rem",
            border: "none",
            cursor: "pointer",
            transition: "all 0.3s ease",
            "&:hover": { backgroundPosition: "right center", transform: "translateY(-2px)", boxShadow: "0 8px 25px rgba(127,90,240,0.3)" },
          },
          formButtonSecondary: {
            background: "rgba(255,255,255,0.04)",
            color: "#94a3b8",
            border: "1.5px solid rgba(255,255,255,0.08)",
            borderRadius: "10px",
            padding: "0.875rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.2s ease",
            "&:hover": { color: "#f1f5f9", borderColor: "rgba(255,255,255,0.2)" },
          },
          backLink: { color: "#94a3b8", fontSize: "0.8125rem", "&:hover": { color: "#f1f5f9" } },
          footerActionText: { color: "#94a3b8", fontSize: "0.8125rem" },
          footerActionLink: { color: "#7f5af0", fontWeight: 600, fontSize: "0.8125rem" },
          footerMessage: { display: "none" },
          dividerText: { color: "#94a3b8", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" },
          dividerLine: { background: "rgba(255,255,255,0.06)", height: "1px" },
          socialButtonsBlockButton: {
            background: "rgba(255,255,255,0.04)",
            border: "1.5px solid rgba(255,255,255,0.08)",
            color: "#f1f5f9",
            borderRadius: "10px",
            padding: "0.625rem",
            transition: "all 0.25s ease",
            "&:hover": { borderColor: "rgba(127,90,240,0.3)", background: "rgba(127,90,240,0.08)", transform: "translateY(-1px)" },
          },
          socialButtonsBlockButtonText: { color: "#f1f5f9", fontWeight: 500, fontSize: "0.875rem" },
          identityPreviewText: { color: "#f1f5f9" },
          identityPreviewEditButton: { color: "#7f5af0", fontWeight: 500 },
          formFieldInputShowPasswordButton: { color: "#94a3b8" },
          formFieldErrorText: { color: "#ef4444", fontSize: "0.75rem" },
          formFieldSuccessText: { color: "#2cb67d", fontSize: "0.75rem" },
          alert: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px" },
          alertText: { color: "#f1f5f9" },
          developmentModeText: { display: "none" },

          footerItem: { display: "none" },

          // === UserProfile ===
          userProfileRoot: { width: "100%" },
          userProfileCard: {
            background: "linear-gradient(145deg, #1a1a30 0%, #14142a 50%, #1a1a30 100%)",
            boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 40px rgba(127,90,240,0.06)",
            borderRadius: "16px",
            border: "1px solid rgba(127,90,240,0.12)",
          },

          // === UserButton ===
          userButtonBox: {
            border: "1.5px solid rgba(255,255,255,0.12)",
            borderRadius: "9999px",
            transition: "border-color 0.2s, box-shadow 0.2s",
            "&:hover": { borderColor: "rgba(127,90,240,0.4)", boxShadow: "0 0 0 3px rgba(127,90,240,0.1)" },
          },
          userButtonAvatarBox: { border: "2px solid transparent", borderRadius: "9999px" },
          userButtonPopoverCard: {
            background: "#1a1a30",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "12px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 30px rgba(127,90,240,0.04)",
          },
          userPreview: { padding: "0.5rem 0" },
          userPreview__userButton: { padding: "1rem 1rem 0.5rem" },
          userPreviewMainIdentifier: { color: "#f1f5f9", fontWeight: 600, fontSize: "0.875rem" },
          userPreviewMainIdentifierText: { color: "#f1f5f9" },
          userPreviewSecondaryIdentifier: { color: "#94a3b8", fontSize: "0.8125rem" },
          userButtonPopoverActions: { padding: "0.25rem 0.5rem" },
          userButtonPopoverActionButton: {
            color: "#f1f5f9",
            borderRadius: "8px",
            padding: "0.5rem 0.75rem",
            fontSize: "0.8125rem",
            transition: "all 0.15s",
            "&:hover": { background: "rgba(127,90,240,0.15)" },
          },
          userButtonPopoverActionButtonText: { color: "#f1f5f9" },
          userButtonPopoverFooter: {
            background: "rgba(0,0,0,0.15)",
            padding: "0.5rem",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          },
        },
      }}
      unsafe_disableDevelopmentModeConsoleWarning={true}
    >
      {html}
    </ClerkProvider>
  )
}
