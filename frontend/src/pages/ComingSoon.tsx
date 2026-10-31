export default function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <section>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{note ?? 'Not built yet. Scheduled after the P0 Agent Center slice.'}</p>
    </section>
  )
}
