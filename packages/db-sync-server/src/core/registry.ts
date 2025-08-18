import { randomUUID } from 'crypto'
import type { ShapeHandle } from '../types'

/**
 * Registry for managing shape handles
 * Auto-generates handles on creation and maintains them for process lifetime
 */
export class ShapeHandleRegistry {
  private handles = new Map<string, ShapeHandle>()

  /**
   * Generate a new shape handle
   * @returns A new shape handle
   */
  generateHandle(): ShapeHandle {
    const handle: ShapeHandle = {
      id: randomUUID(),
      createdAt: Date.now()
    }
    
    this.handles.set(handle.id, handle)
    return handle
  }

  /**
   * Get a shape handle by ID
   * @param id The handle ID
   * @returns The shape handle or undefined if not found
   */
  getHandle(id: string): ShapeHandle | undefined {
    return this.handles.get(id)
  }

  /**
   * Check if a handle exists
   * @param id The handle ID
   * @returns True if the handle exists
   */
  hasHandle(id: string): boolean {
    return this.handles.has(id)
  }

  /**
   * Remove a shape handle
   * @param id The handle ID
   * @returns True if the handle was removed
   */
  removeHandle(id: string): boolean {
    return this.handles.delete(id)
  }

  /**
   * Get all registered handles
   * @returns Array of all shape handles
   */
  getAllHandles(): ShapeHandle[] {
    return Array.from(this.handles.values())
  }

  /**
   * Get the number of registered handles
   */
  get size(): number {
    return this.handles.size
  }

  /**
   * Clear all handles (useful for testing)
   */
  clear(): void {
    this.handles.clear()
  }
}

// Global registry instance
export const globalRegistry = new ShapeHandleRegistry()