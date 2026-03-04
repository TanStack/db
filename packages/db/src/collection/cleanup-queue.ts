type CleanupTask = {
  executeAt: number
  callback: () => void
}

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

  // Only used for testing to clean up state
  public static resetInstance(): void {
    if (CleanupQueue.instance) {
      if (CleanupQueue.instance.timeoutId !== null) {
        clearTimeout(CleanupQueue.instance.timeoutId)
      }
      CleanupQueue.instance = null
    }
  }
}
