interface StatsProps {
  stats: { numero: number; label: string }[]
}

export function Stats({ stats }: StatsProps) {
  if (!stats?.length) return null

  return (
    <section className="border-y border-border bg-bg2 px-6 py-12">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-8 md:gap-16">
        {stats.map((s, i) => (
          <div key={i} className="text-center">
            <p className="text-3xl font-bold text-accent font-display md:text-4xl">
              +{s.numero}
            </p>
            <p className="mt-1 text-sm text-muted font-mono">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
