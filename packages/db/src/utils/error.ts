export const normalizeError = (error: unknown): Error => {
  try {
    if (error instanceof Error) return error
    return new Error(String(error))
  } catch {
    return new Error(`Unknown error`)
  }
}
