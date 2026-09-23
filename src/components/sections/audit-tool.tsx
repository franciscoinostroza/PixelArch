"use client"

import { useEffect, useRef, useState } from "react"
import { whatsappUrl } from "@/lib/contact"
import type { AuditFinding, AuditScores } from "@/lib/audit"

const STEPS = [
  "Conectando con el sitio…",
  "Midiendo velocidad de carga…",
  "Verificando SSL y seguridad…",
  "Analizando SEO y accesibilidad…",
]

interface AuditResult {
  scores: AuditScores
  findings: AuditFinding[]
  data: { finalUrl: string; totalMs: number; htmlKb: number }
}

function scoreColor(score: number): string {
  if (score >= 80) return "#34d399"
  if (score >= 60) return "#fbbf24"
  return "#f87171"
}

export function AuditTool() {
  const [url, setUrl] = useState("")
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle")
  const [step, setStep] = useState(0)
  const [result, setResult] = useState<AuditResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stepTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (stepTimer.current) window.clearInterval(stepTimer.current)
    }
  }, [])

  async function run() {
    if (!url.trim() || phase === "running") return
    setPhase("running")
    setStep(0)
    setResult(null)
    setError(null)

    stepTimer.current = window.setInterval(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s))
    }, 900)

    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error || "No pudimos auditar el sitio. Intentá de nuevo.")
        setPhase("error")
      } else {
        setResult({ scores: data.scores, findings: data.findings, data: data.data })
        setPhase("done")
      }
    } catch {
      setError("Hubo un error de conexión. Intentá de nuevo.")
      setPhase("error")
    } finally {
      if (stepTimer.current) window.clearInterval(stepTimer.current)
    }
  }

  function reset() {
    setPhase("idle")
    setResult(null)
    setError(null)
    setUrl("")
  }

  return (
    <div className="at-box">
      <span className="at-line" aria-hidden="true" />

      <div className="at-input">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run()
          }}
          placeholder="https://tu-sitio.com"
          aria-label="URL del sitio a auditar"
          disabled={phase === "running"}
        />
        <button type="button" className="btn btn-primary" onClick={run} disabled={phase === "running"}>
          {phase === "running" ? "Auditando…" : "Auditar gratis →"}
        </button>
      </div>

      {phase === "running" && (
        <div className="at-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={i <= step ? "at-step done" : "at-step"}>
              <span className="at-spin" aria-hidden="true" />
              {s}
            </div>
          ))}
        </div>
      )}

      {phase === "error" && error && (
        <div className="at-error" role="alert">
          <span aria-hidden="true">⚠️</span> {error}
        </div>
      )}

      {phase === "done" && result && (
        <div className="at-results">
          <p className="at-summary">
            Resultado para <b>{result.data.finalUrl}</b> — respondió en {result.data.totalMs} ms · HTML {result.data.htmlKb} KB
          </p>

          <div className="at-scores">
            {(
              [
                ["Velocidad", result.scores.velocidad],
                ["SSL", result.scores.ssl],
                ["SEO", result.scores.seo],
                ["Seguridad", result.scores.seguridad],
              ] as const
            ).map(([label, score]) => (
              <div key={label} className="at-score">
                <div
                  className="at-ring"
                  style={{ background: `conic-gradient(${scoreColor(score)} ${score}%, rgba(255,255,255,0.08) 0)` }}
                >
                  <span>{score}</span>
                </div>
                <span className="at-score-label">{label}</span>
              </div>
            ))}
          </div>

          <ul className="at-findings">
            {result.findings.map((f, i) => (
              <li key={i} className={f.type}>
                <span className="at-finding-icon" aria-hidden="true">
                  {f.type === "ok" ? "✓" : f.type === "warn" ? "⚠" : "✕"}
                </span>
                {f.text}
              </li>
            ))}
          </ul>

          <div className="at-actions">
            <a
              href={whatsappUrl(`Hola! Audité ${result.data.finalUrl} y quiero la auditoría completa.`)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-wa"
            >
              Quiero la auditoría completa por WhatsApp →
            </a>
            <button type="button" className="btn btn-ghost" onClick={reset}>
              Auditar otro sitio
            </button>
          </div>
        </div>
      )}

      <style>{`
        .at-box {
          position: relative;
          background: linear-gradient(160deg, #171321, #110e1a);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px;
          padding: 34px;
          overflow: hidden;
        }
        .at-line {
          position: absolute;
          top: 0;
          left: 24px;
          right: 24px;
          height: 2px;
          border-radius: 0 0 4px 4px;
          background: linear-gradient(90deg, #8b5cf6, #22d3ee);
        }
        .at-input { display: flex; gap: 12px; flex-wrap: wrap }
        .at-input input {
          flex: 1;
          min-width: 240px;
          background: rgba(7,6,12,0.55);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 12px;
          padding: 15px 18px;
          color: var(--color-text);
          font-family: var(--font-mono);
          font-size: 0.9rem;
          outline: none;
          transition: border-color 0.2s;
        }
        .at-input input:focus { border-color: #8b5cf6 }
        .at-input input:disabled { opacity: 0.6 }
        .at-input .btn:disabled { opacity: 0.7; cursor: wait }
        .btn-wa { background: #25d366; color: #07060c }
        .btn-wa:hover { transform: translateY(-2px); box-shadow: 0 14px 34px -12px rgba(37,211,102,0.5) }

        .at-steps { margin-top: 24px; display: flex; flex-direction: column; gap: 10px }
        .at-step {
          display: flex;
          align-items: center;
          gap: 12px;
          font-family: var(--font-mono);
          font-size: 0.78rem;
          color: var(--color-text-dim);
          opacity: 0.4;
          transition: opacity 0.3s;
        }
        .at-step.done { opacity: 1; color: #34d399 }
        .at-spin {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.15);
          border-top-color: #22d3ee;
          animation: at-spin 0.8s linear infinite;
          flex-shrink: 0;
        }
        .at-step.done .at-spin { border: 2px solid #34d399; animation: none }
        @keyframes at-spin { to { transform: rotate(360deg) } }

        .at-error {
          margin-top: 22px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          background: rgba(248,113,113,0.08);
          border: 1px solid rgba(248,113,113,0.3);
          border-radius: 12px;
          padding: 16px 18px;
          color: #f87171;
          font-size: 0.88rem;
          line-height: 1.6;
        }

        .at-results { margin-top: 26px }
        .at-summary {
          font-family: var(--font-mono);
          font-size: 0.72rem;
          color: var(--color-text-dim);
          margin-bottom: 20px;
          line-height: 1.7;
          word-break: break-word;
        }
        .at-scores { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px }
        .at-score {
          background: rgba(17,14,26,0.7);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          padding: 18px;
          text-align: center;
        }
        .at-ring {
          width: 74px;
          height: 74px;
          margin: 0 auto 10px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .at-ring::after {
          content: "";
          position: absolute;
          inset: 6px;
          border-radius: 50%;
          background: #110e1a;
        }
        .at-ring span {
          position: relative;
          z-index: 1;
          font-size: 1.3rem;
          font-weight: 700;
        }
        .at-score-label { font-size: 0.82rem; color: var(--color-text-dim) }

        .at-findings { list-style: none }
        .at-findings li {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          font-size: 0.86rem;
          color: var(--color-text-dim);
          line-height: 1.6;
          padding: 10px 0;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .at-findings li:last-child { border-bottom: none }
        .at-finding-icon { flex-shrink: 0; font-weight: 700 }
        .at-findings li.ok .at-finding-icon { color: #34d399 }
        .at-findings li.warn .at-finding-icon { color: #fbbf24 }
        .at-findings li.fail .at-finding-icon { color: #f87171 }

        .at-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px }

        @media (max-width: 680px) {
          .at-box { padding: 24px 20px }
          .at-scores { grid-template-columns: repeat(2, 1fr) }
        }
      `}</style>
    </div>
  )
}