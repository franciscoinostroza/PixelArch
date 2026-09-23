"use client"

import { useState } from "react"

export interface FaqItem {
  q: string
  a: string
}

export interface FaqCategory {
  titulo: string
  items: FaqItem[]
}

export function FaqAccordion({ categories }: { categories: FaqCategory[] }) {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className="faq-wrap">
      {categories.map((cat) => (
        <div key={cat.titulo}>
          <h3 className="faq-cat">{cat.titulo}</h3>
          {cat.items.map((item) => {
            const id = `${cat.titulo}-${item.q}`
            const isOpen = open === id
            return (
              <div key={id} className={isOpen ? "faq-item open" : "faq-item"}>
                <button
                  type="button"
                  className="faq-q"
                  onClick={() => setOpen(isOpen ? null : id)}
                  aria-expanded={isOpen}
                >
                  {item.q}
                  <span className="plus" aria-hidden="true">+</span>
                </button>
                <div className="faq-a" style={{ maxHeight: isOpen ? "340px" : "0px" }}>
                  <p>{item.a}</p>
                </div>
              </div>
            )
          })}
        </div>
      ))}

      <style>{`
        .faq-cat {
          font-family: var(--font-mono);
          font-size: 0.72rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--color-cyan);
          margin: 38px 0 16px;
          font-weight: 500;
        }
        .faq-cat:first-child { margin-top: 0 }
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
          max-width: 66ch;
        }
      `}</style>
    </div>
  )
}