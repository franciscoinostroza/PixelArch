"use client"

import { useEffect } from "react"

const REVIEWS = [
  { name: "Martina R.", role: "Fundadora, Estudio Creativo", quote: "Entendieron exactamente lo que necesitábamos y entregaron antes del plazo. La comunicación fue clarísima en todo momento.", rating: 5 },
  { name: "Carlos G.", role: "CTO, Retail Digital", quote: "La auditoría de infraestructura nos salvó de un problema serio antes de escalar. Un nivel de detalle que no vimos en otros equipos.", rating: 5 },
  { name: "Laura M.", role: "Directora, Clínica Salud+", quote: "El chatbot redujo nuestros tiempos de respuesta a minutos. Simple de usar y el soporte post-lanzamiento fue excelente.", rating: 5 },
  { name: "Diego F.", role: "Founder, Marketplace Sur", quote: "Migraron nuestro sistema legacy sin downtime. Todavía no puedo creer lo prolijo que quedó todo documentado.", rating: 5 },
  { name: "Sofía T.", role: "Head of Ops, LogiTrack", quote: "Automatizaron un proceso que nos consumía horas por semana. Se pagó solo en el primer mes.", rating: 5 },
  { name: "Nicolás P.", role: "CEO, Estudio Fintech", quote: "Se nota que piensan en la red tanto como en el código. Nuestra infraestructura nunca estuvo tan estable.", rating: 5 },
]

function starIcon() {
  return '<svg viewBox="0 0 20 20" width="13" height="13"><path d="M10 1l2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L10 14.9 4.4 18l1.4-6.2L1 7.5l6.4-.6L10 1z"/></svg>'
}

function reviewInitials(name: string) {
  return name.split(" ").map((p) => p.charAt(0)).join("").slice(0, 2).toUpperCase()
}

export function Reviews() {
  useEffect(() => {
    const track = document.getElementById("reviewsTrack")
    if (!track || track.hasChildNodes()) return

    function reviewCardHTML(r: typeof REVIEWS[number]) {
      let stars = ""
      for (let i = 0; i < r.rating; i++) stars += starIcon()
      return (
        '<article class="review-card">' +
        '<div class="review-stars">' + stars + "</div>" +
        '<p class="review-quote">\u201c' + r.quote + '\u201d</p>' +
        '<div class="review-author">' +
        '<span class="review-avatar" aria-hidden="true">' + reviewInitials(r.name) + "</span>" +
        '<span><span class="review-author-name">' + r.name + '</span><span class="review-author-role">' + r.role + "</span></span>" +
        "</div>" +
        "</article>"
      )
    }

    track.innerHTML = REVIEWS.map(reviewCardHTML).join("") + REVIEWS.map(reviewCardHTML).join("")
  }, [])

  return (
    <section className="resenas" id="resenas">
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "380px", height: "380px", left: "-120px", top: "20%" }} aria-hidden="true" />
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Reseñas</p>
          <h2>Lo que dicen quienes ya trabajaron con nosotros</h2>
          <p>Opiniones de clientes reales. Conectá tu fuente (Google, Trustpilot, etc.) para que esto se actualice solo.</p>
        </div>
      </div>
      <div className="marquee-viewport" id="reviewsViewport">
        <div className="marquee-track" id="reviewsTrack" aria-label="Reseñas de clientes" />
      </div>

      <style>{`
        .resenas {
          position: relative;
          z-index: 1;
          overflow: hidden;
          background: rgba(7,6,12,0.88);
          backdrop-filter: blur(3px);
          padding-bottom: clamp(60px, 7vw, 88px);
        }
        .resenas .section-head { margin-bottom: 44px }

        .marquee-viewport {
          overflow: hidden;
          width: 100%;
          -webkit-mask-image: linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent);
          mask-image: linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent);
        }
        .marquee-track {
          display: flex;
          gap: 20px;
          width: max-content;
          padding-inline: 8px;
          animation: marquee-scroll 34s linear infinite;
        }
        .marquee-viewport:hover .marquee-track { animation-play-state: paused }
        @keyframes marquee-scroll {
          from { transform: translateX(0) }
          to { transform: translateX(-50%) }
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track { animation: none; overflow-x: auto; max-width: 100% }
        }

        .review-card {
          flex: 0 0 auto;
          width: min(340px, 78vw);
          background: var(--color-panel);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 26px 24px;
        }
        .review-stars { display: flex; gap: 3px; margin-bottom: 14px; color: var(--color-cyan) }
        .review-stars svg { fill: currentColor }
        .review-quote { color: var(--color-text); font-size: 0.92rem; line-height: 1.65; margin-bottom: 22px }
        .review-author { display: flex; align-items: center; gap: 12px }
        .review-avatar {
          width: 38px; height: 38px; border-radius: 50%;
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          color: #07060c;
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-weight: 700; font-size: 0.82rem; flex-shrink: 0;
        }
        .review-author-name { display: block; font-family: var(--font-display); font-size: 0.86rem; font-weight: 600 }
        .review-author-role { display: block; font-family: var(--font-mono); font-size: 0.68rem; color: var(--color-text-faint); margin-top: 2px }
      `}</style>
    </section>
  )
}
