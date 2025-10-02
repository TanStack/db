export type SchedulerContextId = string | symbol

interface SchedulerEntry<TState> {
  state: TState
  run: () => void
}

interface ScheduleOptions<TState> {
  contextId?: SchedulerContextId
  jobId: unknown
  createEntry: () => SchedulerEntry<TState>
  updateEntry?: (entry: SchedulerEntry<TState>) => void
}

/**
 * Basic scoped scheduler that coalesces work by context and job.
 *
 * - A **context** (for example a transaction id) represents the batching boundary.
 *   Work scheduled with the same context id is queued until that context is flushed.
 * - A **job id** deduplicates work inside a context. The first scheduled job determines
 *   the execution slot; subsequent schedules update the same entry but preserve order.
 * - When no context id is provided the work executes immediately (no batching).
 *
 * Each job entry owns a mutable state object so callers can merge new data between
 * schedule calls before the eventual `run()` executes.
 */
export class Scheduler {
  private contexts = new Map<
    SchedulerContextId,
    Map<unknown, SchedulerEntry<any>>
  >()

  schedule<TState>({
    contextId,
    jobId,
    createEntry,
    updateEntry,
  }: ScheduleOptions<TState>): void {
    if (typeof contextId === `undefined`) {
      const entry = createEntry()
      updateEntry?.(entry)
      entry.run()
      return
    }

    let context = this.contexts.get(contextId)
    if (!context) {
      context = new Map()
      this.contexts.set(contextId, context)
    }

    let entry = context.get(jobId) as SchedulerEntry<TState> | undefined
    if (!entry) {
      entry = createEntry()
      context.set(jobId, entry)
    }

    updateEntry?.(entry)
  }

  flush(contextId: SchedulerContextId): void {
    const context = this.contexts.get(contextId)
    if (!context) return

    this.contexts.delete(contextId)

    for (const entry of context.values()) {
      entry.run()
    }
  }

  flushAll(): void {
    const contexts = Array.from(this.contexts.keys())
    contexts.forEach((contextId) => {
      const context = this.contexts.get(contextId)
      if (!context) return
      this.contexts.delete(contextId)
      for (const entry of context.values()) {
        entry.run()
      }
    })
  }

  clear(contextId: SchedulerContextId): void {
    this.contexts.delete(contextId)
  }

  hasPendingJobs(contextId: SchedulerContextId): boolean {
    return this.contexts.has(contextId)
  }

  clearJob(contextId: SchedulerContextId, jobId: unknown): void {
    const context = this.contexts.get(contextId)
    if (!context) return

    context.delete(jobId)
    if (context.size === 0) {
      this.contexts.delete(contextId)
    }
  }
}

export const transactionScopedScheduler = new Scheduler()
