export function About() {
  return (
    <section className="nosotros" id="nosotros">
      <div className="section-divider section-divider--cyan" aria-hidden="true" />
      <div className="section-band section-band--cyan" aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "400px", height: "400px", right: "-130px", top: "10%" }} aria-hidden="true" />
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Quiénes somos</p>
          <h2>Un equipo, dos disciplinas</h2>
        </div>

        <div className="nosotros-grid">
          <div className="nosotros-copy">
            <p>PixelArch nació de una combinación poco común: desarrollo full-stack e ingeniería de redes en el mismo lugar. La mayoría de los estudios te entregan una aplicación y te desean suerte con el resto. Nosotros diseñamos también el terreno donde esa aplicación va a vivir.</p>
            <p>Trabajamos remoto, con clientes en Chile, Argentina, México, Perú, Colombia, Brasil, España y otros países de Europa.</p>
            <ul className="capability-list">
              <li>Desarrollo Full-Stack</li>
              <li>Arquitectura de Redes</li>
              <li>DevOps &amp; CI/CD</li>
              <li>Seguridad e Infraestructura</li>
            </ul>
          </div>

          <div className="panel-card" aria-hidden="true">
            <div className="panel-card-head">
              <span className="panel-dot" /><span className="panel-dot" /><span className="panel-dot" />
            </div>
            <div className="panel-row"><span className="panel-row-label">Infraestructura</span><span className="panel-row-value">Monitoreada</span></div>
            <div className="panel-row"><span className="panel-row-label">Arquitectura</span><span className="panel-row-value">Escalable</span></div>
            <div className="panel-row"><span className="panel-row-label">Deploys</span><span className="panel-row-value">Automatizados</span></div>
            <div className="panel-row"><span className="panel-row-label">Código</span><span className="panel-row-value">Versionado</span></div>
          </div>
        </div>
      </div>

      <style>{`
        .nosotros {
          position: relative;
          z-index: 1;
          overflow: hidden;
          background: rgba(7,6,12,0.88);
          backdrop-filter: blur(3px);
        }
        .nosotros-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 64px; align-items: start }
        .nosotros-copy p { color: var(--color-text-dim); margin-bottom: 18px; font-size: 1.02rem; max-width: 54ch }
        .capability-list { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 28px }
        .capability-list li {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: var(--font-display);
          font-size: 0.88rem;
          font-weight: 500;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          padding: 13px 14px;
        }
        .capability-list li::before {
          content: "";
          width: 6px;
          height: 6px;
          border-radius: 2px;
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          flex-shrink: 0;
        }

        .panel-card {
          background: var(--color-panel);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 30px;
          box-shadow: 0 30px 70px -35px rgba(0,0,0,0.6);
        }
        .panel-card-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 22px;
          padding-bottom: 18px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .panel-dot { width: 9px; height: 9px; border-radius: 50% }
        .panel-dot:nth-child(1) { background: #ff6259 }
        .panel-dot:nth-child(2) { background: #ffbd2e }
        .panel-dot:nth-child(3) { background: #28c93f }
        .panel-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .panel-row:last-child { border-bottom: none }
        .panel-row-label { font-family: var(--font-mono); font-size: 0.78rem; color: var(--color-text-dim) }
        .panel-row-value {
          font-family: var(--font-mono);
          font-size: 0.78rem;
          color: #22d3ee;
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .panel-row-value::before {
          content: "";
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #22d3ee;
          box-shadow: 0 0 8px #22d3ee;
        }

        @media (max-width: 980px) { .nosotros-grid { grid-template-columns: 1fr; gap: 44px } }
        @media (max-width: 720px) { .capability-list { grid-template-columns: 1fr } }
      `}</style>
    </section>
  )
}
