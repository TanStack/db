import { codedMessage, devBuild } from '../error-message.js'

/** Reject an invalid width before query construction or window movement. */
export function validateLimit(limit = 0): void {
  if (limit < 0) {
    throw new RangeError(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `limit must be nonnegative`
        : codedMessage(261),
    )
  }
}
