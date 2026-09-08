import { runAllCallbacks } from './utils/callbacks.js'

/**
 * Identifier used to scope scheduled work. Maps to a transaction id for live queries.
 */
export type SchedulerContextId = string | symbol

/**
 * Options for {@link Scheduler.schedule}. Jobs are identified by `jobId` within a context
 * and may declare dependencies.
 */
interface ScheduleOptions {
  contextId?: SchedulerContextId
  jobId: unknown
  dependencies?: Iterable<unknown>
  run: () => void
}

/**
 * State per context. Queue preserves order, jobs hold run functions, dependencies track
 * prerequisites. A job leaves the pending map before its callback runs, so work
 * queued by that callback is a new pending dependency.
 */
interface SchedulerContextState {
  queue: Array<unknown>
  jobs: Map<unknown, () => void>
  dependencies: Map<unknown, Set<unknown>>
}

interface PendingAwareJob {
  hasPendingGraphRun: (contextId: SchedulerContextId) => boolean
}

function isPendingAwareJob(dep: any): dep is PendingAwareJob {
  return (
    typeof dep === `object` &&
    dep !== null &&
    typeof dep.hasPendingGraphRun === `function`
  )
}

/**
 * Scoped scheduler that coalesces work by context and job.
 *
 * - **context** (e.g. transaction id) defines the batching boundary; work is queued until flushed.
 * - **job id** deduplicates work within a context; scheduling the same job replaces the previous run function.
 * - Without a context id, work executes immediately.
 *
 * Callers manage their own state; the scheduler only orchestrates execution order.
 */
export class Scheduler {
  private contexts = new Map<SchedulerContextId, SchedulerContextState>()
  private clearListeners = new Set<(contextId: SchedulerContextId) => void>()

  /**
   * Get or create the state bucket for a context.
   */
  private getOrCreateContext(
    contextId: SchedulerContextId,
  ): SchedulerContextState {
    let context = this.contexts.get(contextId)
    if (!context) {
      context = {
        queue: [],
        jobs: new Map(),
        dependencies: new Map(),
      }
      this.contexts.set(contextId, context)
    }
    return context
  }

  /**
   * Schedule work. Without a context id, executes immediately.
   * Otherwise queues the job to be flushed once dependencies are satisfied.
   * Scheduling the same jobId again replaces the previous run function.
   */
  schedule({ contextId, jobId, dependencies, run }: ScheduleOptions): void {
    if (typeof contextId === `undefined`) {
      run()
      return
    }

    const context = this.getOrCreateContext(contextId)

    // If this is a new job, add it to the queue
    if (!context.jobs.has(jobId)) {
      context.queue.push(jobId)
    }

    // Store or replace the run function
    context.jobs.set(jobId, run)

    // Update dependencies
    if (dependencies) {
      const depSet = new Set<unknown>(dependencies)
      depSet.delete(jobId)
      context.dependencies.set(jobId, depSet)
    } else if (!context.dependencies.has(jobId)) {
      context.dependencies.set(jobId, new Set())
    }
  }

  /**
   * Flush all queued work for a context. Jobs with unmet dependencies are retried.
   * Throws if a pass completes without running any job (dependency cycle).
   */
  flush(contextId: SchedulerContextId): void {
    const context = this.contexts.get(contextId)
    if (!context) return

    const { queue, jobs, dependencies } = context

    while (queue.length > 0) {
      let ranThisPass = false
      const jobsThisPass = queue.length

      for (let i = 0; i < jobsThisPass; i++) {
        const jobId = queue.shift()!
        const run = jobs.get(jobId)
        if (!run) {
          dependencies.delete(jobId)
          continue
        }

        const deps = dependencies.get(jobId)
        let ready = !deps
        if (deps) {
          ready = true
          for (const dep of deps) {
            if (dep === jobId) continue

            const depHasPending =
              isPendingAwareJob(dep) && dep.hasPendingGraphRun(contextId)

            // Treat dependencies as blocking if the dep has a pending run in this
            // context or if it's enqueued. If the dep is
            // neither pending nor enqueued, consider it satisfied to avoid deadlocks
            // on lazy sources that never schedule work.
            if (jobs.has(dep) || depHasPending) {
              ready = false
              break
            }
          }
        }

        if (ready) {
          jobs.delete(jobId)
          dependencies.delete(jobId)
          // A reentrant schedule now owns a fresh pending job; finishing this
          // callback must not mark that replacement as complete.
          run()
          ranThisPass = true
        } else {
          queue.push(jobId)
        }
      }

      if (!ranThisPass) {
        throw new Error(
          `Scheduler detected unresolved dependencies for context ${String(
            contextId,
          )}.`,
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
    runAllCallbacks(
      [...this.clearListeners].map((listener) => () => listener(contextId)),
    )
  }

  /** Register a listener to be notified when a context is cleared. */
  onClear(listener: (contextId: SchedulerContextId) => void): () => void {
    this.clearListeners.add(listener)
    return () => this.clearListeners.delete(listener)
  }

  /** Check if a context has pending jobs. */
  hasPendingJobs(contextId: SchedulerContextId): boolean {
    const context = this.contexts.get(contextId)
    return !!context && context.jobs.size > 0
  }
}

export const transactionScopedScheduler = new Scheduler()

let activePublicationContext: SchedulerContextId | undefined
let activePublicationFailure: { error: unknown } | undefined

function getActivePublicationFailure(): { error: unknown } | undefined {
  return activePublicationFailure
}

/**
 * Returns the Collection publication that currently owns synchronous change
 * delivery. Live-query jobs use it to coalesce all source subscriptions that
 * observe one committed batch.
 */
export function getActivePublicationContext(): SchedulerContextId | undefined {
  return activePublicationContext
}

/** Report a listener failure after the whole publication graph has drained. */
export function recordPublicationError(error: unknown): void {
  if (activePublicationContext === undefined) throw error
  activePublicationFailure ??= { error }
}

/**
 * Runs one synchronous Collection publication inside a scheduler context.
 * Nested publications share the outer context, so downstream live queries run
 * only after every subscriber to the original committed batch has observed it.
 */
export function withPublicationContext<T>(publish: () => T): T {
  if (activePublicationContext !== undefined) return publish()

  const contextId = Symbol(`collection-publication`)
  activePublicationContext = contextId
  activePublicationFailure = undefined
  let result!: T
  let listenerFailure: { error: unknown } | undefined
  try {
    result = publish()
    transactionScopedScheduler.flush(contextId)
    listenerFailure = getActivePublicationFailure()
  } catch (error) {
    try {
      transactionScopedScheduler.clear(contextId)
    } catch {
      // Keep the earlier publication or graph failure.
    }
    // Keep the first reported failure, including one from an earlier listener.
    const publicationFailure = getActivePublicationFailure()
    if (publicationFailure) {
      throw publicationFailure.error
    }
    throw error
  } finally {
    activePublicationContext = undefined
    activePublicationFailure = undefined
  }
  if (listenerFailure) throw listenerFailure.error
  return result
}
