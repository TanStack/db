import type { ChangeEvent, ChangeListener } from '../types'

/**
 * Simple event bus for change notifications
 * Used to wake up live requests when changes occur
 */
export class EventBus {
  private listeners: Set<ChangeListener> = new Set()

  /**
   * Subscribe to change events
   * @param listener The listener function to call when changes occur
   * @returns Unsubscribe function
   */
  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Emit a change event to all listeners
   * @param event The change event to emit
   */
  emit(event: ChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('Error in event listener:', error)
      }
    }
  }

  /**
   * Wait for the next change event with a timeout
   * @param timeoutMs Timeout in milliseconds
   * @returns Promise that resolves with the change event or rejects on timeout
   */
  waitForChange(timeoutMs: number): Promise<ChangeEvent> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for change'))
      }, timeoutMs)

      const listener = (event: ChangeEvent) => {
        clearTimeout(timeout)
        resolve(event)
      }

      this.listeners.add(listener)
      
      // Clean up listener after it's called
      const originalEmit = this.emit.bind(this)
      this.emit = (event: ChangeEvent) => {
        originalEmit(event)
        this.listeners.delete(listener)
      }
    })
  }

  /**
   * Get the number of active listeners
   */
  get listenerCount(): number {
    return this.listeners.size
  }
}