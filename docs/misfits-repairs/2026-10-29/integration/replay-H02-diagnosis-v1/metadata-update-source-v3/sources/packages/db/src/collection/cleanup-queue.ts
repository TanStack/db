import { codedMessage, devBuild } from '../error-message'

// Share one elapsed clock for appointments and startup handoff deadlines.
// Some runtimes lack `performance` although the DOM types declare it.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
export const cleanupNow = () => globalThis.performance?.now() ?? Date.now()

type CleanupTask = {
  executeAt: number
  callback: () => void
}

/**
 * Batches many GC registrations behind a single shared timeout.
 */
export class CleanupQueue {
  private static instance: CleanupQueue | null = null

  private tasks: Map<unknown, CleanupTask> = new Map()

  private timeoutId: ReturnType<typeof setTimeout> | null = null
  private microtaskScheduled = false

  private constructor() {}

  public static getInstance(): CleanupQueue {
    return (CleanupQueue.instance ??= new CleanupQueue())
  }

  /**
   * Queues a cleanup task and defers timeout selection to a microtask so
   * multiple synchronous registrations can share one root timer.
   */
  public schedule(key: unknown, gcTime: number, callback: () => void): void {
    const executeAt = cleanupNow() + gcTime
    this.tasks.set(key, { executeAt, callback })

    if (!this.microtaskScheduled) {
      this.microtaskScheduled = true
      Promise.resolve().then(() => {
        this.microtaskScheduled = false
        this.updateTimeout()
      })
    }
  }

  public cancel(key: unknown): void {
    this.tasks.delete(key)

    // Retire the root timer with the last task. A non-empty queue keeps its
    // timer even when the cancelled task was the earliest: it wakes early,
    // finds nothing due and reschedules, which costs less than rescanning
    // every task on each cancellation.
    if (this.tasks.size === 0 && this.timeoutId !== null) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
  }

  /**
   * Keeps only one active timeout: whichever task is due next.
   */
  private updateTimeout(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }

    if (this.tasks.size === 0) {
      return
    }

    let earliestTime = Infinity
    for (const task of this.tasks.values()) {
      if (task.executeAt < earliestTime) {
        earliestTime = task.executeAt
      }
    }

    const delay = Math.max(0, earliestTime - cleanupNow())
    // Run every due task, then select the next shared wakeup.
    this.timeoutId = setTimeout(() => {
      this.timeoutId = null
      const now = cleanupNow()
      for (const [key, task] of this.tasks.entries()) {
        if (now >= task.executeAt) {
          this.tasks.delete(key)
          try {
            task.callback()
          } catch (error) {
            console.error(
              devBuild() && process.env.NODE_ENV !== `production`
                ? 'Error in CleanupQueue task:'
                : codedMessage(214),
              error,
            )
          }
        }
      }

      this.updateTimeout()
    }, delay)
    // Background collection GC must not keep an otherwise finished Node
    // process alive. Browsers return a numeric timer handle.
    if (typeof this.timeoutId === `object`) this.timeoutId.unref()
  }
}
