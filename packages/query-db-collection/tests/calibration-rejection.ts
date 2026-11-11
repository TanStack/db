// Transport for a calibration whose mutant must be rejected by the existing
// comparison. The old calibration test accepted only the rejections that its
// Vitest matcher accepted; `rejectsAs` keeps exactly that matcher. It marks an
// accepted rejection as the comparison's verdict at `checkpoint`, so
// recordAssertionJudgment reports it under the property's law. Any other
// rejection becomes a new, unmarked driver error, so no checkpoint inside it
// counts. A mutant that resolves records no verdict here.
import { rejectAt } from '../../db/tests/oracle-assertion-adapter'

export async function rejectsAs(
  checkpoint: string,
  run: () => Promise<unknown>,
  accepts: (failure: unknown) => void,
): Promise<void> {
  let rejected = false
  let failure: unknown
  try {
    await run()
  } catch (error) {
    rejected = true
    failure = error
  }
  if (!rejected) return
  try {
    accepts(failure)
  } catch {
    throw new Error(
      `${checkpoint}: the mutant failed in a way that its calibration does not accept: ${String(failure)}`,
    )
  }
  rejectAt(
    checkpoint,
    failure instanceof Error ? failure : new Error(String(failure)),
  )
}
