// Classifier cases for tests/error-sites-oracle.ts. The production error
// message oracle pins how the census classifies each function below.

function devBuild(): boolean {
  return true
}

function codedMessage(code: number, values?: Record<string, unknown>): string {
  return `${code} ${JSON.stringify(values)}`
}

// Development-only: production removes the alias and its text.
export function guardedAlias(): void {
  if (devBuild() && process.env.NODE_ENV !== `production`) {
    const warn = console.warn
    warn(`Guarded hint text`)
  }
}

// A plain site: an alias that production keeps.
export function unguardedAlias(): typeof console.warn {
  return console.warn
}

// A plain site: `guard || x` is true in production whenever x is.
export function orGuard(x: boolean): void {
  if ((devBuild() && process.env.NODE_ENV !== `production`) || x)
    console.warn(`Or-guarded hint text`)
}

// A plain site: an empty production branch hides a failure.
export function emptyBranch(error: unknown): void {
  console.error(
    devBuild() && process.env.NODE_ENV !== `production`
      ? `Failed to save the row:`
      : ``,
    error,
  )
}

// Not a site: a development-only decoration of a value.
export function decoration(message: string): void {
  console.error(
    devBuild() && process.env.NODE_ENV !== `production`
      ? `[Prefix] ${message}`
      : message,
  )
}

// A coded site.
export function coded(id: string): void {
  console.error(
    devBuild() && process.env.NODE_ENV !== `production`
      ? `Failed for ${id}`
      : codedMessage(1, { id }),
  )
}

// A plain site: destructuring hands on console methods that could log anything.
export function destructured(): void {
  const { warn } = console
  warn(`Destructured hint text`)
}

declare function warnOnce(key: string, message: string): void

// A plain site: warnOnce logs its second argument.
export function viaWarnOnce(): void {
  warnOnce(`key`, `Helper hint text`)
}

// Development-only: a braced early return counts like a bare one.
export function bracedReturn(): void {
  if (!(devBuild() && process.env.NODE_ENV !== `production`)) {
    return
  }
  console.warn(`Braced return hint text`)
}

// A stored coded message: the oracle requires it to be used where written.
export function stored(): void {
  const message =
    devBuild() && process.env.NODE_ENV !== `production`
      ? `Stored failure text`
      : codedMessage(2)
  console.error(message)
}
