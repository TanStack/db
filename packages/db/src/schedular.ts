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
 * - A context (e.g. a transaction id) scopes work execution:
 *   queued jobs for the same context run together when that context is flushed.
 * - A job id (e.g. a specific CollectionConfigBuilder) dedupes work within a context.
 *
 * Callers provide an entry factory so state objects can be mutated across schedules,
 * and optionally an updater to merge new data into an existing entry.
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
