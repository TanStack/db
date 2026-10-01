// Bundlers inline `process.env.NODE_ENV` even where `process` does not exist,
// so it is read directly; without either, warnings stay off.
export function shouldWarnInDevelopment(disableEnvVar: string): boolean {
  let development: boolean
  try {
    development = process.env.NODE_ENV !== `production`
  } catch {
    return false
  }
  return (
    development &&
    (typeof process === `undefined` || process.env[disableEnvVar] !== `1`)
  )
}
