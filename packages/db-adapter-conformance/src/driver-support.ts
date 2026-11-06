/**
 * Support for receiving drivers: code a driver may share, outside the
 * oracle's model and check.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface QuietSettleOptions {
  /** The cut is ready: everything the adapter owes has happened. */
  done: () => boolean
  /**
   * Something is held, so some writes legitimately wait; the cut is ready
   * once `activity` has not changed for `quietMs`.
   */
  blocked: () => boolean
  /** A value that changes whenever the adapter or the provider acts. */
  activity: () => unknown
  /** The adapter has stopped; nothing more will happen. */
  stopped?: () => boolean
  timeoutMs?: number
  quietMs?: number
}

/**
 * A propagation step for a provider that can hold requests or copies: wait
 * until `done`, or, while something is held, until nothing changes for a
 * while, then give the client a few turns to apply what it received.
 */
export async function settleWhenQuiet({
  done,
  blocked,
  activity,
  stopped = () => false,
  timeoutMs = 2_000,
  quietMs = 25,
}: QuietSettleOptions): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = activity()
  let quietSince = Date.now()
  while (Date.now() < deadline && !stopped()) {
    if (done()) break
    if (blocked() && Date.now() - quietSince >= quietMs) break
    await sleep(2)
    const now = activity()
    if (now !== last) {
      last = now
      quietSince = Date.now()
    }
  }
  for (let turn = 0; turn < 3; turn++) await sleep(0)
}
