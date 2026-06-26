const paises = [
  { flag: "🇨🇱", nombre: "Chile" },
  { flag: "🇦🇷", nombre: "Argentina" },
  { flag: "🇲🇽", nombre: "México" },
  { flag: "🇵🇪", nombre: "Perú" },
  { flag: "🇨🇴", nombre: "Colombia" },
  { flag: "🇪🇸", nombre: "España" },
]

export function Presencia() {
  return (
    <section className="border-y border-border bg-bg2 px-6 py-12">
      <div className="mx-auto max-w-4xl text-center">
        <p className="text-xs uppercase tracking-[0.12em] text-muted font-mono mb-6">
          Presencia en Latinoamérica y Europa
        </p>
        <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10">
          {paises.map((p) => (
            <div key={p.nombre} className="flex flex-col items-center gap-1.5">
              <span className="text-3xl md:text-4xl">{p.flag}</span>
              <span className="text-sm text-text font-mono">{p.nombre}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
