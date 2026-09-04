export const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) return error
  try {
    return new Error(String(error))
  } catch {
    return new Error(`Unknown error`)
  }
}
