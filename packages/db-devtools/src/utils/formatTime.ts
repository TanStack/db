export function formatTime(ms: number): string {
  if (ms === 0) return `0s`

  const units = [`s`, `min`, `h`, `d`]
  const values = [ms / 1000, ms / 60000, ms / 3600000, ms / 86400000]

  let chosenUnitIndex = 0
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < 1) break
    chosenUnitIndex = i
  }

  const formatter = new Intl.NumberFormat(navigator.language, {
    compactDisplay: `short`,
    notation: `compact`,
    maximumFractionDigits: 0,
  })

  return formatter.format(values[chosenUnitIndex]!) + units[chosenUnitIndex]
}
