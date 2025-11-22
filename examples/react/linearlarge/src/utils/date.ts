const dateFormatter = new Intl.DateTimeFormat(`en`, {
  month: `short`,
  day: `numeric`,
})

const cache = new Map<number, string>()

export function formatDate(date?: Date): string {
  if (!date) return ``
  const ts = date.getTime()
  const cached = cache.get(ts)
  if (cached) return cached
  const formatted = dateFormatter.format(date)
  cache.set(ts, formatted)
  return formatted
}
