/**
 * Identifier used to scope scheduled work. For live queries this maps directly to a
 * transaction id so that all mutations performed inside a transaction are flushed together.
 */
export type SchedulerContextId = string | symbol

/**
 * Internal representation of a job queued by the scheduler. The mutable `state`
 * allows callers to accumulate information (callbacks, configuration, etc.) before
 * the job eventually runs, while `run` executes the actual work.
 */
interface SchedulerEntry<TState> {
  state: TState
  run: () => void
}

/**
 * Options accepted by {@link Scheduler.schedule}. Jobs are identified by a `jobId`
 * unique within a context and may declare dependencies on other jobs. The entry
 * factory is invoked the first time a job is scheduled, and `updateEntry` lets the
 * caller merge additional state into existing entries.
 */
interface ScheduleOptions<TState> {
  contextId?: SchedulerContextId
  jobId: unknown
  dependencies?: Iterable<unknown>
  createEntry: () => SchedulerEntry<TState>
  updateEntry?: (entry: SchedulerEntry<TState>) => void
}

/**
 * State stored per context (transaction). The queue preserves scheduling order,
 * `entries` holds the jobs themselves, `dependencies` maps each job to the set of
 * prerequisite jobs, and `completed` records which jobs have already run during the
 * current flush.
 */
interface SchedulerContextState {
  queue: Array<unknown>
  entries: Map<unknown, SchedulerEntry<any>>
  dependencies: Map<unknown, Set<unknown>>
  completed: Set<unknown>
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
  private contexts = new Map<SchedulerContextId, SchedulerContextState>()

  /**
   * Retrieve the state bucket for a context or create a fresh one if this is the
   * first job scheduled for that context.
   */
  private getOrCreateContext(
    contextId: SchedulerContextId
  ): SchedulerContextState {
    let context = this.contexts.get(contextId)
    if (!context) {
      context = {
        queue: [],
        entries: new Map(),
        dependencies: new Map(),
        completed: new Set(),
      }
      this.contexts.set(contextId, context)
    }
    return context
  }

  /**
   * Schedule work. When no context id is provided the job executes immediately.
   * Otherwise we add/merge the job into the current transaction bucket so it can be
   * flushed once all dependencies are satisfied.
   */
  schedule<TState>({
    contextId,
    jobId,
    dependencies,
    createEntry,
    updateEntry,
  }: ScheduleOptions<TState>): void {
    if (typeof contextId === `undefined`) {
      const entry = createEntry()
      updateEntry?.(entry)
      entry.run()
      return
    }

    const context = this.getOrCreateContext(contextId)

    let entry = context.entries.get(jobId) as SchedulerEntry<TState> | undefined
    if (!entry) {
      entry = createEntry()
      context.entries.set(jobId, entry)
      context.queue.push(jobId)
    }

    updateEntry?.(entry)

    if (dependencies) {
      const depSet = new Set<unknown>()
      for (const dep of dependencies) {
        if (dep !== jobId) {
          depSet.add(dep)
        }
      }
      context.dependencies.set(jobId, depSet)
    } else if (!context.dependencies.has(jobId)) {
      context.dependencies.set(jobId, new Set())
    }

    context.completed.delete(jobId)
  }

  /**
   * Flush all queued work for the provided context. Jobs that still have unmet
   * dependencies are rotated to the back of the queue and retried on the next pass.
   * If we complete a pass without running any job we throw to signal a dependency cycle.
   */
  flush(contextId: SchedulerContextId): void {
    const context = this.contexts.get(contextId)
    if (!context) return

    const { queue, entries, dependencies, completed } = context

    while (queue.length > 0) {
      let ranThisPass = false
      const jobsThisPass = queue.length

      for (let i = 0; i < jobsThisPass; i++) {
        const jobId = queue.shift()!
        const entry = entries.get(jobId)
        if (!entry) {
          dependencies.delete(jobId)
          completed.delete(jobId)
          continue
        }

        const deps = dependencies.get(jobId)
        const ready =
          !deps ||
          deps.size === 0 ||
          [...deps].every((dep) => dep === jobId || completed.has(dep))

        if (ready) {
          entries.delete(jobId)
          dependencies.delete(jobId)
          entry.run()
          completed.add(jobId)
          ranThisPass = true
        } else {
          queue.push(jobId)
        }
      }

      if (!ranThisPass) {
        throw new Error(
          `Scheduler detected unresolved dependencies for context ${String(
            contextId
          )}.`
        )
      }
    }

    this.contexts.delete(contextId)
  }

  /**
   * Flush every context that still has pending work. Useful during tear-down to
   * guarantee there are no lingering jobs.
   */
  flushAll(): void {
    for (const contextId of Array.from(this.contexts.keys())) {
      this.flush(contextId)
    }
  }

  /** Clear any scheduled jobs for the given context. */
  clear(contextId: SchedulerContextId): void {
    this.contexts.delete(contextId)
  }

  /** Determine whether a context still has jobs waiting to be executed. */
  hasPendingJobs(contextId: SchedulerContextId): boolean {
    const context = this.contexts.get(contextId)
    if (!context) return false
    return context.entries.size > 0
  }

  /** Remove a single job from a context, cleaning up associated dependency data. */
  clearJob(contextId: SchedulerContextId, jobId: unknown): void {
    const context = this.contexts.get(contextId)
    if (!context) return

    context.entries.delete(jobId)
    context.dependencies.delete(jobId)
    context.completed.delete(jobId)
    context.queue = context.queue.filter((id) => id !== jobId)

    if (context.entries.size === 0) {
      this.contexts.delete(contextId)
    }
  }
}

export const transactionScopedScheduler = new Scheduler()
