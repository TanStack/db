// Support for calibrations whose mutant driver replays an existing calibration
// body. The body's shared check must reject each wrong answer with an error
// that the old matcher accepted; the driver then marks one held rejection with
// rejectAt, so the property reports the check's law. Neither helper decides a
// product result: the shared check still does.

/**
 * Runs one wrong answer through the shared check and returns the rejection
 * when the old matcher accepts it. Any other outcome throws an unmarked error,
 * so the calibration fails as the old test did.
 */
export function rejection(
  accepts: (error: Error) => boolean,
  wrong: () => unknown,
): Error {
  try {
    wrong()
  } catch (error) {
    if (error instanceof Error && accepts(error)) return error
    throw new Error(
      `the check rejected the wrong answer with an error that the calibration does not accept: ${String(error)}`,
    )
  }
  throw new Error(`the check accepted the wrong answer`)
}

/** The asynchronous form of `rejection`. */
export async function asyncRejection(
  accepts: (error: Error) => boolean,
  wrong: () => Promise<unknown>,
): Promise<Error> {
  try {
    await wrong()
  } catch (error) {
    if (error instanceof Error && accepts(error)) return error
    throw new Error(
      `the check rejected the wrong answer with an error that the calibration does not accept: ${String(error)}`,
    )
  }
  throw new Error(`the check accepted the wrong answer`)
}

/**
 * Runs a clean check inside a calibration. Its failure is a broken
 * calibration, not the check rejecting a wrong answer, so it throws an
 * unmarked error that carries the message but not the marked cause.
 */
export function clean(check: () => void): void {
  try {
    check()
  } catch (error) {
    throw new Error(
      `a clean check in the calibration failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
