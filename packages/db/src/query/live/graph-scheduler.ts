import {
  getActivePublicationContext,
  transactionScopedScheduler,
} from '../../scheduler.js'
import { getActiveTransaction } from '../../transactions.js'
import type { SchedulerContextId } from '../../scheduler.js'

export type GraphDependency = {
  scheduleGraphRun: (options?: { contextId?: SchedulerContextId }) => void
}

/** Schedule source graphs before a consumer in the same transaction turn. */
export function scheduleQueryGraphRun(
  jobId: unknown,
  dependencies: Iterable<GraphDependency>,
  run: () => void,
  contextId = getActiveTransaction()?.id ?? getActivePublicationContext(),
): void {
  const deps = [...dependencies]
  if (contextId !== undefined) {
    for (const dep of deps) dep.scheduleGraphRun({ contextId })
  }
  transactionScopedScheduler.schedule({
    contextId,
    jobId,
    dependencies: deps,
    run,
  })
}
