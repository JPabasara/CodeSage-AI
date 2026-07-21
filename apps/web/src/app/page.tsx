const TOKENS = [
  "--severity-critical",
  "--severity-high",
  "--severity-medium",
  "--severity-low",
  "--health-bad",
  "--health-mid",
  "--health-good",
]

export default function Home() {
  return (
    <div className="p-8 space-y-2">
      {TOKENS.map((t) => (
        <div
          key={t}
          className="p-4 font-mono text-sm text-white"
          style={{ background: `hsl(var(${t}))` }}
        >
          {t}
        </div>
      ))}
    </div>
  )
}
