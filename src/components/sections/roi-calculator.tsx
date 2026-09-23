"use client"

import { useMemo, useState } from "react"
import { whatsappUrl } from "@/lib/contact"

const AUTOMATIZABLE = 0.7
const WEEKS_PER_MONTH = 4.33

export function RoiCalculator() {
  const [hours, setHours] = useState(8)
  const [rate, setRate] = useState(15)
  const [tasks, setTasks] = useState(3)

  const result = useMemo(() => {
    const monthlyHours = Math.round(hours * WEEKS_PER_MONTH * AUTOMATIZABLE)
    const monthly = monthlyHours * (rate || 0)
    return {
      monthlyHours,
      monthly,
      yearly: monthly * 12,
    }
  }, [hours, rate, tasks])

  const fmt = (n: number) => "US$" + n.toLocaleString("en-US")

  return (
    <div className="roi">
      <div className="roi-panel">
        <span className="roi-line" aria-hidden="true" />
        <div className="roi-field">
          <label htmlFor="roiHours">¿Cuántas horas por semana gastás en tareas repetitivas?</label>
          <input
            id="roiHours"
            type="range"
            min={1}
            max={40}
            value={hours}
            onChange={(e) => setHours(+e.target.value)}
          />
          <div className="roi-range-meta">
            <span className="roi-hint">1h</span>
            <span className="roi-value">{hours} {hours === 1 ? "hora" : "horas"}</span>
            <span className="roi-hint">40h</span>
          </div>
        </div>

        <div className="roi-field">
          <label htmlFor="roiRate">Valor de tu hora (USD)</label>
          <input
            id="roiRate"
            type="number"
            min={1}
            max={500}
            value={rate}
            onChange={(e) => setRate(+e.target.value)}
          />
          <span className="roi-hint">Lo que vale tu tiempo de trabajo por hora</span>
        </div>

        <div className="roi-field">
          <label htmlFor="roiTasks">Tareas distintas que querés automatizar</label>
          <input
            id="roiTasks"
            type="range"
            min={1}
            max={10}
            value={tasks}
            onChange={(e) => setTasks(+e.target.value)}
          />
          <div className="roi-range-meta">
            <span className="roi-hint">1</span>
            <span className="roi-value">{tasks} {tasks === 1 ? "tarea" : "tareas"}</span>
            <span className="roi-hint">10</span>
          </div>
        </div>
      </div>

      <div className="roi-panel">
        <span className="roi-line" aria-hidden="true" />
        <div className="roi-result">
          <span className="roi-result-key">Horas recuperadas por mes</span>
          <span className="roi-result-val">{result.monthlyHours}h</span>
        </div>
        <div className="roi-result">
          <span className="roi-result-key">Ahorro mensual estimado</span>
          <span className="roi-result-val">{fmt(result.monthly)}</span>
        </div>
        <div className="roi-result">
          <span className="roi-result-key">Ahorro anual estimado</span>
          <span className="roi-result-val roi-result-big">{fmt(result.yearly)}</span>
        </div>
        <p className="roi-note">
          Estimación: 70% de las tareas repetitivas son automatizables. La inversión típica se recupera en 1-3 meses.
        </p>
        <a
          href={whatsappUrl(`Hola! Usé la calculadora: pierdo ~${hours}h por semana en tareas repetitivas y quiero automatizarlas.`)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary roi-cta"
        >
          Quiero recuperar esas horas <span className="btn-arrow" aria-hidden="true">→</span>
        </a>
      </div>

      <style>{`
        .roi { display: grid; grid-template-columns: 1fr 1fr; gap: 24px }
        .roi-panel {
          position: relative;
          background: linear-gradient(160deg, #171321, #110e1a);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px;
          padding: 30px;
          overflow: hidden;
        }
        .roi-line {
          position: absolute;
          top: 0;
          left: 22px;
          right: 22px;
          height: 2px;
          border-radius: 0 0 4px 4px;
          background: linear-gradient(90deg, #8b5cf6, #22d3ee);
        }
        .roi-field { margin-bottom: 26px }
        .roi-field:last-child { margin-bottom: 0 }
        .roi-field label {
          display: block;
          font-size: 0.86rem;
          color: var(--color-text-dim);
          margin-bottom: 10px;
          line-height: 1.5;
        }
        .roi-field input[type="number"] {
          width: 100%;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 12px 14px;
          color: var(--color-text);
          font-family: var(--font-mono);
          font-size: 0.95rem;
          outline: none;
          transition: border-color 0.2s;
        }
        .roi-field input[type="number"]:focus { border-color: #8b5cf6 }
        .roi-field input[type="range"] {
          width: 100%;
          accent-color: #8b5cf6;
          cursor: pointer;
        }
        .roi-range-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 8px;
        }
        .roi-hint {
          font-family: var(--font-mono);
          font-size: 0.64rem;
          color: var(--color-text-faint);
          display: block;
          margin-top: 6px;
        }
        .roi-range-meta .roi-hint { margin-top: 0 }
        .roi-value {
          font-family: var(--font-mono);
          font-size: 0.82rem;
          color: var(--color-cyan);
          font-weight: 600;
        }
        .roi-result {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 14px;
          padding: 15px 0;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .roi-result:first-of-type { padding-top: 6px }
        .roi-result-key { font-size: 0.88rem; color: var(--color-text-dim) }
        .roi-result-val { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; white-space: nowrap }
        .roi-result-big {
          font-size: 2.1rem;
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .roi-note {
          font-family: var(--font-mono);
          font-size: 0.64rem;
          color: var(--color-text-faint);
          line-height: 1.7;
          margin: 16px 0 22px;
        }
        .roi-cta { width: 100% }
        @media (max-width: 980px) {
          .roi { grid-template-columns: 1fr }
        }
      `}</style>
    </div>
  )
}