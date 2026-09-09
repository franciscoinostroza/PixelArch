"use client"

import { useState } from "react"

const ITEMS = [
  {
    q: "¿Cómo se cobra y en qué moneda?",
    a: "El cobro se realiza en USD a través de Polar, con tarjeta internacional. En la web ves el equivalente estimado en ARS según el dólar del día, que se actualiza automáticamente.",
  },
  {
    q: "¿Ya tengo hosting. ¿Puedo usarlo?",
    a: "Sí. En el plan Básico el hosting corre incluido y gestionado por nosotros. Si preferís usar tu hosting actual, lo evaluamos en el plan Mantenimiento para garantizar seguridad y monitoreo.",
  },
  {
    q: "¿Cómo cancelo la suscripción?",
    a: "Desde tu portal de cliente, con 7 días de aviso. Sin permanencia ni penalidades.",
  },
]

export function ProductFaq() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className="product-faq">
      <p className="eyebrow">Antes de contratar</p>
      {ITEMS.map((item, i) => (
        <div key={item.q} className={open === i ? "faq-item open" : "faq-item"}>
          <button
            type="button"
            className="faq-q"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
          >
            {item.q}
            <span className="plus" aria-hidden="true">+</span>
          </button>
          <div className="faq-a" style={{ maxHeight: open === i ? "300px" : "0px" }}>
            <p>{item.a}</p>
          </div>
        </div>
      ))}

      <style>{`
        .product-faq { margin-top: 52px }
        .product-faq .eyebrow { margin-bottom: 20px }
        .faq-item {
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          background: linear-gradient(160deg, #171321, #110e1a);
          overflow: hidden;
          margin-bottom: 12px;
          transition: border-color 0.3s;
        }
        .faq-item.open { border-color: rgba(139,92,246,0.4) }
        .faq-q {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 18px 22px;
          background: transparent;
          border: none;
          color: var(--color-text);
          font-family: var(--font-display);
          font-size: 0.94rem;
          font-weight: 600;
          text-align: left;
          cursor: pointer;
        }
        .faq-q .plus {
          flex-shrink: 0;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.14);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.85rem;
          color: var(--color-cyan);
          transition: transform 0.3s;
        }
        .faq-item.open .faq-q .plus {
          transform: rotate(45deg);
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          color: #07060c;
          border-color: transparent;
        }
        .faq-a {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.35s cubic-bezier(.19,1,.22,1);
        }
        .faq-a p {
          padding: 0 22px 18px;
          color: var(--color-text-dim);
          font-size: 0.88rem;
          line-height: 1.7;
          max-width: 62ch;
        }
      `}</style>
    </div>
  )
}