"use client"

interface PasoItem {
  titulo: string
  descripcion: string
}

interface ProcessProps {
  pasos: PasoItem[]
}

const STEPS = [
  {
    num: "01",
    label: "Auditoría",
    title: "Auditoría",
    desc: "Relevamos tu infraestructura, dependencias y superficie de riesgo antes de escribir una sola línea de código.",
    icon: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/></svg>',
  },
  {
    num: "02",
    label: "Arquitectura",
    title: "Arquitectura",
    desc: "Diseñamos el mapa técnico completo: stack, servidores, red y flujo de datos, pensado para escalar.",
    icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/></svg>',
  },
  {
    num: "03",
    label: "Desarrollo",
    title: "Desarrollo",
    desc: "Construimos con código limpio, tests automatizados y revisiones constantes.",
    icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M8 6 2 12l6 6M16 6l6 6-6 6M14 4l-4 16"/></svg>',
  },
  {
    num: "04",
    label: "Integración continua",
    title: "Integración continua",
    desc: "Cada cambio se integra, se testea y se despliega automáticamente. CI/CD real.",
    icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>',
  },
  {
    num: "05",
    label: "Soporte técnico",
    title: "Soporte técnico",
    desc: "Monitoreo activo de la app y la infraestructura, con acompañamiento continuo.",
    icon: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5 5l4 4M19 5l-4 4M5 19l4-4M19 19l-4-4"/></svg>',
  },
]

export function Process({ pasos }: ProcessProps) {
  const displaySteps = pasos.length > 0
    ? pasos.map((p, i) => ({
        num: String(i + 1).padStart(2, "0"),
        label: p.titulo,
        title: p.titulo,
        desc: p.descripcion,
        icon: STEPS[i]?.icon || "",
      }))
    : STEPS

  return (
    <section className="proceso" id="proceso">
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "400px", height: "400px", left: "-130px", bottom: "5%" }} aria-hidden="true" />
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Metodología</p>
          <h2>De la idea a producción, sin puntos ciegos</h2>
          <p>Un proceso pensado por alguien que también piensa en la infraestructura: cada etapa cubre tanto el código como la red que lo sostiene.</p>
        </div>

        <div className="timeline" id="timeline" style={{ position: "relative", maxWidth: "760px" }}>
          <div className="timeline-track" style={{ position: "absolute", left: "23px", top: "24px", bottom: "24px", width: "2px", background: "rgba(255,255,255,0.08)" }}>
            <div className="timeline-track-fill" id="trackFill" style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "0%", background: "linear-gradient(135deg, #8b5cf6, #22d3ee)", transition: "height 0.1s linear" }} />
            <div className="timeline-dot" id="trackDot" style={{ position: "absolute", left: "50%", top: "0%", width: "9px", height: "9px", borderRadius: "50%", background: "#22d3ee", transform: "translate(-50%,-50%)", boxShadow: "0 0 14px 3px rgba(34,211,238,0.65)", transition: "top 0.1s linear" }} />
          </div>

          {displaySteps.map((step, i) => (
            <div className="step" data-step key={i} style={{ position: "relative", paddingLeft: "76px", paddingBottom: i < displaySteps.length - 1 ? "58px" : 0 }}>
              <span className="step-ghost" aria-hidden="true" style={{
                position: "absolute", right: 0, top: "-18px",
                fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "5rem",
                color: "transparent", WebkitTextStroke: "1px rgba(255,255,255,0.08)",
                lineHeight: 1, pointerEvents: "none", userSelect: "none",
                transition: "color 0.6s cubic-bezier(.19,1,.22,1), -webkit-text-stroke-color 0.6s cubic-bezier(.19,1,.22,1)",
              }}>{step.num}</span>
              <div className="step-marker" style={{
                position: "absolute", left: 0, top: 0, width: "48px", height: "48px", borderRadius: "50%",
                border: "1.5px solid rgba(255,255,255,0.08)", background: "var(--color-bg-soft)",
                display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-faint)",
                transition: "border-color 0.5s cubic-bezier(.19,1,.22,1), color 0.5s cubic-bezier(.19,1,.22,1), box-shadow 0.5s cubic-bezier(.19,1,.22,1), transform 0.5s cubic-bezier(.19,1,.22,1)",
                zIndex: 1,
              }} dangerouslySetInnerHTML={{ __html: step.icon }} />
              <div className="step-content" style={{
                opacity: 0.35, transform: "translateX(14px)",
                transition: "opacity 0.6s cubic-bezier(.19,1,.22,1), transform 0.6s cubic-bezier(.19,1,.22,1)",
              }}>
                <span className="step-num" style={{
                  fontFamily: "var(--font-mono)", fontSize: ".7rem", color: "var(--color-text-faint)", display: "block", marginBottom: "6px", letterSpacing: ".08em",
                  transition: "color 0.5s cubic-bezier(.19,1,.22,1)",
                }}>{step.num} · {step.label}</span>
                <h3 style={{ fontSize: "1.2rem", marginBottom: "8px" }}>{step.title}</h3>
                <p style={{ color: "var(--color-text-dim)", fontSize: ".94rem", maxWidth: "50ch" }}>{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .proceso {
          position: relative;
          z-index: 1;
          overflow: hidden;
          background: rgba(12,10,21,0.88);
          backdrop-filter: blur(3px);
        }
        @media (max-width: 640px) { .step-ghost { display: none } }
        .step.is-active .step-ghost { -webkit-text-stroke-color: rgba(34,211,238,0.14) }
        .step.is-active .step-marker { border-color: #22d3ee; color: #22d3ee; box-shadow: 0 0 0 6px rgba(34,211,238,0.14); transform: scale(1.05); animation: marker-pulse 0.8s cubic-bezier(.19,1,.22,1) }
        @keyframes marker-pulse { 0% { box-shadow: 0 0 0 0 rgba(34,211,238,0.5) } 70% { box-shadow: 0 0 0 16px rgba(34,211,238,0) } 100% { box-shadow: 0 0 0 6px rgba(34,211,238,0.14) } }
        .step.is-active .step-num { color: #22d3ee }
        .step.is-active .step-content { opacity: 1; transform: translateX(0) }
      `}</style>
    </section>
  )
}
