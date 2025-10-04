/**
 * Identifier used to scope scheduled work. Maps to a transaction id for live queries.
 */
export type SchedulerContextId = string | symbol

/**
 * Internal representation of a job queued by the scheduler.
 * Mutable `state` accumulates information before `run` executes the work.
 */
interface SchedulerEntry<TState> {
  state: TState
  run: () => void
}

/**
 * Options for {@link Scheduler.schedule}. Jobs are identified by `jobId` within a context
 * and may declare dependencies. `createEntry` is called once; `updateEntry` merges state.
 */
interface ScheduleOptions<TState> {
  contextId?: SchedulerContextId
  jobId: unknown
  dependencies?: Iterable<unknown>
  createEntry: () => SchedulerEntry<TState>
  updateEntry?: (entry: SchedulerEntry<TState>) => void
}

/**
 * State per context. Queue preserves order, entries hold jobs, dependencies track
 * prerequisites, and completed records which jobs have run during the current flush.
 */
interface SchedulerContextState {
  queue: Array<unknown>
  entries: Map<unknown, SchedulerEntry<any>>
  dependencies: Map<unknown, Set<unknown>>
  completed: Set<unknown>
}

/**
 * Scoped scheduler that coalesces work by context and job.
 *
 * - **context** (e.g. transaction id) defines the batching boundary; work is queued until flushed.
 * - **job id** deduplicates work within a context; subsequent schedules update the entry.
 * - Without a context id, work executes immediately.
 *
 * Each entry has mutable state so callers can merge data before `run()` executes.
 */
export class Scheduler {
  private contexts = new Map<SchedulerContextId, SchedulerContextState>()

  /**
   * Get or create the state bucket for a context.
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
   * Schedule work. Without a context id, executes immediately.
   * Otherwise queues the job to be flushed once dependencies are satisfied.
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
   * Flush all queued work for a context. Jobs with unmet dependencies are retried.
   * Throws if a pass completes without running any job (dependency cycle).
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
   * Flush all contexts with pending work. Useful during tear-down.
   */
  flushAll(): void {
    for (const contextId of Array.from(this.contexts.keys())) {
      this.flush(contextId)
    }
  }

  /** Clear all scheduled jobs for a context. */
  clear(contextId: SchedulerContextId): void {
    this.contexts.delete(contextId)
  }

  /** Check if a context has pending jobs. */
  hasPendingJobs(contextId: SchedulerContextId): boolean {
    const context = this.contexts.get(contextId)
    if (!context) return false
    return context.entries.size > 0
  }

  /** Remove a single job from a context and clean up its dependencies. */
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
