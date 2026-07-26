import type { Metadata } from "next"
import { Space_Grotesk, Inter, JetBrains_Mono, Pixelify_Sans } from "next/font/google"
import { ClerkProvider } from "@clerk/nextjs"
import { ToastProvider } from "@/components/ui/toast"
import { registerShutdown } from "@/lib/shutdown"
import { sanityFetch } from "@/lib/sanity"
import type { SeoFields } from "@/types/sanity"
import "./globals.css"

registerShutdown()

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["500"],
})

const pixelifySans = Pixelify_Sans({
  variable: "--font-pixel-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

const baseUrl = process.env.NEXT_PUBLIC_URL || "https://pixelarch.dev"

const SEO_QUERY = `*[_type == "seo"][0]{ titulo_sitio, descripcion, "og_image_url": og_image.asset->url, keywords }`

const DEFAULTS = {
  title: "PixelArch — Desarrollo Full-Stack & Infraestructura",
  description:
    "Desarrollo full-stack e ingeniería de redes en un mismo equipo. No solo programamos tu producto: pensamos dónde corre, cómo escala y qué pasa el día que algo falla.",
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
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
    manifest: "/manifest.json",
    other: { "theme-color": "#07060c" },
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
    "Desarrollo full-stack e ingeniería de redes en un mismo equipo."
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
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} ${pixelifySans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <link rel="preconnect" href="https://cdn.sanity.io" />
        <link rel="preconnect" href="https://clerk.pixelarch.dev" />
        <link rel="preconnect" href="https://api.polar.sh" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="dns-prefetch" href="https://cdn.sanity.io" />
        <link rel="dns-prefetch" href="https://clerk.pixelarch.dev" />
        <link rel="dns-prefetch" href="https://api.polar.sh" />
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
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
        variables: { colorPrimary: "#8b5cf6", colorBackground: "#110e1a" },
        elements: {
          // === SignIn / SignUp ===
          card: {
            background: "linear-gradient(145deg, #161320 0%, #110e1a 50%, #161320 100%)",
            boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 40px rgba(139,92,246,0.06)",
            borderRadius: "16px",
            border: "1px solid rgba(139,92,246,0.12)",
            padding: "2rem",
          },
          headerTitle: { color: "#f6f5f8", fontWeight: 700, fontSize: "1.375rem", letterSpacing: "-0.02em" },
          headerSubtitle: { color: "#a29cb3", fontSize: "0.875rem", marginTop: "0.25rem" },
          headerLogo: { display: "none" },
          formFieldLabel: { color: "#a29cb3", fontSize: "0.8125rem", fontWeight: 500, marginBottom: "0.375rem" },
          formFieldInput: {
            background: "rgba(255,255,255,0.04)",
            color: "#f6f5f8",
            border: "1.5px solid rgba(255,255,255,0.08)",
            borderRadius: "10px",
            padding: "0.875rem 1rem",
            fontSize: "0.875rem",
            outline: "none",
            transition: "all 0.25s ease",
            "&:focus": { borderColor: "#8b5cf6", boxShadow: "0 0 0 4px rgba(139,92,246,0.12), 0 4px 12px rgba(0,0,0,0.2)" },
            "&::placeholder": { color: "#645f74" },
          },
          formButtonPrimary: {
            background: "linear-gradient(135deg, #8b5cf6 0%, #22d3ee 100%)",
            color: "#07060c",
            fontWeight: 600,
            borderRadius: "10px",
            padding: "0.875rem 1rem",
            fontSize: "0.875rem",
            border: "none",
            cursor: "pointer",
            transition: "all 0.3s ease",
            "&:hover": { transform: "translateY(-2px)", boxShadow: "0 14px 34px -10px rgba(139,92,246,0.55)" },
          },
          formButtonSecondary: {
            background: "rgba(255,255,255,0.04)",
            color: "#a29cb3",
            border: "1.5px solid rgba(255,255,255,0.08)",
            borderRadius: "10px",
            padding: "0.875rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.2s ease",
            "&:hover": { color: "#f6f5f8", borderColor: "rgba(255,255,255,0.2)" },
          },
          backLink: { color: "#a29cb3", fontSize: "0.8125rem", "&:hover": { color: "#f6f5f8" } },
          footerActionText: { color: "#a29cb3", fontSize: "0.8125rem" },
          footerActionLink: { color: "#8b5cf6", fontWeight: 600, fontSize: "0.8125rem" },
          footerMessage: { display: "none" },
          dividerText: { color: "#a29cb3", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" },
          dividerLine: { background: "rgba(255,255,255,0.06)", height: "1px" },
          socialButtonsBlockButton: {
            background: "rgba(255,255,255,0.04)",
            border: "1.5px solid rgba(255,255,255,0.08)",
            color: "#f6f5f8",
            borderRadius: "10px",
            padding: "0.625rem",
            transition: "all 0.25s ease",
            "&:hover": { borderColor: "rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.08)", transform: "translateY(-1px)" },
          },
          socialButtonsBlockButtonText: { color: "#f6f5f8", fontWeight: 500, fontSize: "0.875rem" },
          identityPreviewText: { color: "#f6f5f8" },
          identityPreviewEditButton: { color: "#8b5cf6", fontWeight: 500 },
          formFieldInputShowPasswordButton: { color: "#a29cb3" },
          formFieldErrorText: { color: "#ef4444", fontSize: "0.75rem" },
          formFieldSuccessText: { color: "#34d399", fontSize: "0.75rem" },
          alert: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px" },
          alertText: { color: "#f6f5f8" },
          developmentModeText: { display: "none" },

          footerItem: { display: "none" },

          // === UserProfile ===
          userProfileRoot: { width: "100%" },
          userProfileCard: {
            background: "linear-gradient(145deg, #161320 0%, #110e1a 50%, #161320 100%)",
            boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 40px rgba(139,92,246,0.06)",
            borderRadius: "16px",
            border: "1px solid rgba(139,92,246,0.12)",
          },

          // === UserButton ===
          userButtonBox: {
            border: "1.5px solid rgba(255,255,255,0.12)",
            borderRadius: "9999px",
            transition: "border-color 0.2s, box-shadow 0.2s",
            "&:hover": { borderColor: "rgba(139,92,246,0.4)", boxShadow: "0 0 0 3px rgba(139,92,246,0.1)" },
          },
          userButtonAvatarBox: { border: "2px solid transparent", borderRadius: "9999px" },
          userButtonPopoverCard: {
            background: "#161320",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "12px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 30px rgba(139,92,246,0.04)",
          },
          userPreview: { padding: "0.5rem 0" },
          userPreview__userButton: { padding: "1rem 1rem 0.5rem" },
          userPreviewMainIdentifier: { color: "#f6f5f8", fontWeight: 600, fontSize: "0.875rem" },
          userPreviewMainIdentifierText: { color: "#f6f5f8" },
          userPreviewSecondaryIdentifier: { color: "#a29cb3", fontSize: "0.8125rem" },
          userButtonPopoverActions: { padding: "0.25rem 0.5rem" },
          userButtonPopoverActionButton: {
            color: "#f6f5f8",
            borderRadius: "8px",
            padding: "0.5rem 0.75rem",
            fontSize: "0.8125rem",
            transition: "all 0.15s",
            "&:hover": { background: "rgba(139,92,246,0.15)" },
          },
          userButtonPopoverActionButtonText: { color: "#f6f5f8" },
          userButtonPopoverFooter: {
            background: "rgba(0,0,0,0.15)",
            padding: "0.5rem",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          },
        },
      }}
      unsafe_disableDevelopmentModeConsoleWarning={true}
    >
      <ToastProvider>{html}</ToastProvider>
    </ClerkProvider>
  )
}
