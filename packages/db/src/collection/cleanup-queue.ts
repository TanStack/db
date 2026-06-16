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
    if (!CleanupQueue.instance) {
      CleanupQueue.instance = new CleanupQueue()
    }
    return CleanupQueue.instance
  }

  /**
   * Queues a cleanup task and defers timeout selection to a microtask so
   * multiple synchronous registrations can share one root timer.
   */
  public schedule(key: unknown, gcTime: number, callback: () => void): void {
    const executeAt = Date.now() + gcTime
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

    const delay = Math.max(0, earliestTime - Date.now())
    this.timeoutId = setTimeout(() => this.process(), delay)
  }

  /**
   * Runs every task whose deadline has passed, then schedules the next wakeup
   * if there is still pending work.
   */
  private process(): void {
    this.timeoutId = null
    const now = Date.now()
    for (const [key, task] of this.tasks.entries()) {
      if (now >= task.executeAt) {
        this.tasks.delete(key)
        try {
          task.callback()
        } catch (error) {
          console.error('Error in CleanupQueue task:', error)
        }
      }
    }

    if (this.tasks.size > 0) {
      this.updateTimeout()
    }
  }

  /**
   * Resets the singleton instance for tests.
   */
  public static resetInstance(): void {
    if (CleanupQueue.instance) {
      if (CleanupQueue.instance.timeoutId !== null) {
        clearTimeout(CleanupQueue.instance.timeoutId)
      }
      CleanupQueue.instance = null
    }
  }
}
