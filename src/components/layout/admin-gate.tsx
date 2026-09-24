"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useClerk, useUser } from "@clerk/nextjs"

export function AdminGate({ next }: { next: string }) {
  const { openSignIn } = useClerk()
  const { isLoaded, isSignedIn } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn) {
      router.replace(next)
      router.refresh()
      return
    }
    openSignIn({})
  }, [isLoaded, isSignedIn, openSignIn, router, next])

  return (
    <div className="gate-card">
      <span className="gate-line" aria-hidden="true" />
      <div className="gate-logo" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 32 32">
          <rect x="4" y="4" width="11" height="11" rx="2" fill="#8b5cf6"/>
          <rect x="17" y="17" width="11" height="11" rx="2" fill="#22d3ee" opacity=".5"/>
        </svg>
      </div>
      <h1>Panel de PixelArch</h1>
      <p>Ingresá con tu cuenta para administrar clientes, pagos y contenido.</p>
      <button type="button" className="btn btn-primary" onClick={() => openSignIn({})}>
        Ingresar <span className="btn-arrow" aria-hidden="true">→</span>
      </button>
      <a href="/" className="gate-back">← Volver al sitio</a>

      <style>{`
        .gate-card {
          position: relative;
          z-index: 2;
          width: min(420px, calc(100vw - 40px));
          background: linear-gradient(160deg, #171321, #110e1a);
          border: 1px solid rgba(139,92,246,0.3);
          border-radius: 20px;
          padding: 40px 34px 30px;
          text-align: center;
          overflow: hidden;
          box-shadow: 0 30px 70px -30px rgba(0,0,0,0.8);
        }
        .gate-line {
          position: absolute;
          top: 0;
          left: 24px;
          right: 24px;
          height: 2px;
          border-radius: 0 0 4px 4px;
          background: linear-gradient(90deg, #8b5cf6, #22d3ee);
        }
        .gate-logo {
          width: 58px;
          height: 58px;
          margin: 0 auto 18px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(139,92,246,0.13);
          border: 1px solid rgba(139,92,246,0.25);
        }
        .gate-card h1 {
          font-family: var(--font-pixel-display);
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 10px;
        }
        .gate-card p {
          color: var(--color-text-dim);
          font-size: 0.9rem;
          line-height: 1.65;
          margin-bottom: 24px;
        }
        .gate-card .btn { width: 100%; margin-bottom: 16px }
        .gate-back {
          font-family: var(--font-mono);
          font-size: 0.72rem;
          color: var(--color-text-faint);
          transition: color 0.2s;
        }
        .gate-back:hover { color: var(--color-cyan) }
      `}</style>
    </div>
  )
}