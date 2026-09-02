"use client"

import { motion } from "framer-motion"
import { useEffect, useState } from "react"
import { whatsappUrl, WHATSAPP_MESSAGE } from "@/lib/contact"

export function WhatsappButton() {
  const [showTip, setShowTip] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  }, [])

  return (
    <>
      <motion.a
        href={whatsappUrl(WHATSAPP_MESSAGE)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Contactar por WhatsApp"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.6, duration: 0.3 }}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        onFocus={() => setShowTip(true)}
        onBlur={() => setShowTip(false)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_8px_24px_rgba(37,211,102,0.45)] transition-transform hover:scale-110 hover:shadow-[0_10px_30px_rgba(37,211,102,0.6)]"
        style={{ willChange: "transform" }}
      >
        {!reduceMotion && (
          <span
            className="absolute inset-0 rounded-full bg-[#25D366] opacity-40"
            style={{ animation: "wa-pulse 2.4s ease-out infinite" }}
            aria-hidden="true"
          />
        )}
        <svg viewBox="0 0 32 32" width="28" height="28" fill="currentColor" aria-hidden="true" className="relative">
          <path d="M16.04 3C9.05 3 3.38 8.58 3.38 15.45c0 2.2.6 4.35 1.74 6.23L3.1 29l7.56-1.96a12.7 12.7 0 0 0 5.37 1.18h.01c6.98 0 12.65-5.58 12.65-12.45C28.7 8.58 23.03 3 16.04 3Zm0 22.83h-.01c-1.86 0-3.69-.5-5.28-1.45l-.38-.22-4.48 1.16 1.2-4.34-.25-.4a10.2 10.2 0 0 1-1.59-5.46c0-5.67 4.65-10.28 10.79-10.28 5.79 0 10.8 4.62 10.8 10.29 0 5.67-4.65 10.7-10.8 10.7Zm5.92-8.02c-.32-.16-1.92-.94-2.22-1.05-.3-.11-.51-.16-.73.16-.22.32-.84 1.05-1.03 1.27-.19.22-.38.24-.7.08-.32-.16-1.36-.5-2.6-1.6-.96-.85-1.6-1.9-1.79-2.22-.19-.32-.02-.5.14-.65.14-.14.32-.37.48-.55.16-.19.21-.32.32-.54.11-.21.05-.4-.03-.56-.08-.16-.73-1.75-1-2.4-.26-.63-.53-.54-.73-.55h-.62c-.21 0-.56.08-.86.4-.3.32-1.13 1.1-1.13 2.69 0 1.59 1.16 3.12 1.32 3.34.16.22 2.29 3.48 5.54 4.88.77.33 1.38.53 1.85.68.78.24 1.49.21 2.05.13.62-.09 1.92-.78 2.19-1.54.27-.76.27-1.4.19-1.54-.08-.13-.29-.22-.61-.38Z" />
        </svg>
      </motion.a>

      <span
        aria-hidden="true"
        className={`pointer-events-none fixed bottom-7 right-[74px] z-50 hidden whitespace-nowrap font-display text-[13px] text-text transition-opacity duration-200 sm:block ${
          showTip ? "opacity-100" : "opacity-0"
        }`}
      >
        ¿Hablamos?
      </span>

      <style>{`
        @keyframes wa-pulse {
          0% { transform: scale(1); opacity: 0.45; }
          70% { transform: scale(1.55); opacity: 0; }
          100% { transform: scale(1.55); opacity: 0; }
        }
      `}</style>
    </>
  )
}
