// Bundlers inline `process.env.NODE_ENV` even where `process` does not exist,
// so it is read directly; without either, warnings stay off.
export function shouldWarnInDevelopment(disableEnvVar: string): boolean {
  try {
    if (process.env.NODE_ENV === `production`) return false
  } catch {
    return false
  }
  return typeof process === `undefined` || process.env[disableEnvVar] !== `1`
}
