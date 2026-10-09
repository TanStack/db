import { codedMessage, devBuild } from '../error-message'

export const normalizeError = (error: unknown): Error => {
  try {
    if (error instanceof Error) return error
    return new Error(String(error))
  } catch {
    return new Error(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Unknown error`
        : codedMessage(170),
    )
  }
}
