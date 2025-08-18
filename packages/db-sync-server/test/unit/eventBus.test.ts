import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventBus } from '../../src/core/eventBus'
import type { ChangeEvent } from '../../src/types'

describe('EventBus', () => {
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('subscribe and emit', () => {
    it('should call listeners when events are emitted', () => {
      const listener = vi.fn()
      const unsubscribe = eventBus.subscribe(listener)

      const event: ChangeEvent = { v: 1, pk: 'test', op: 'insert' }
      eventBus.emit(event)

      expect(listener).toHaveBeenCalledWith(event)
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()
    })

    it('should support multiple listeners', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()
      
      eventBus.subscribe(listener1)
      eventBus.subscribe(listener2)

      const event: ChangeEvent = { v: 1, pk: 'test', op: 'insert' }
      eventBus.emit(event)

      expect(listener1).toHaveBeenCalledWith(event)
      expect(listener2).toHaveBeenCalledWith(event)
    })

    it('should allow unsubscribing', () => {
      const listener = vi.fn()
      const unsubscribe = eventBus.subscribe(listener)

      const event: ChangeEvent = { v: 1, pk: 'test', op: 'insert' }
      eventBus.emit(event)
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()
      eventBus.emit(event)
      expect(listener).toHaveBeenCalledTimes(1) // Should not be called again
    })

    it('should handle listener errors gracefully', () => {
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error('Test error')
      })
      const normalListener = vi.fn()

      eventBus.subscribe(errorListener)
      eventBus.subscribe(normalListener)

      const event: ChangeEvent = { v: 1, pk: 'test', op: 'insert' }
      
      // Should not throw, and normal listener should still be called
      expect(() => eventBus.emit(event)).not.toThrow()
      expect(normalListener).toHaveBeenCalledWith(event)
    })
  })

  describe('waitForChange', () => {
    it('should resolve when a change is emitted', async () => {
      const waitPromise = eventBus.waitForChange(1000)
      
      // Emit an event
      const event: ChangeEvent = { v: 1, pk: 'test', op: 'insert' }
      eventBus.emit(event)

      const result = await waitPromise
      expect(result).toEqual(event)
    })

    it('should reject on timeout', async () => {
      const waitPromise = eventBus.waitForChange(1000)
      
      // Advance time past timeout
      vi.advanceTimersByTime(1001)

      await expect(waitPromise).rejects.toThrow('Timeout waiting for change')
    })

    it('should clean up listener after resolving', async () => {
      const waitPromise = eventBus.waitForChange(1000)
      
      const event: ChangeEvent = { v: 1, pk: 'test', op: 'insert' }
      eventBus.emit(event)

      await waitPromise

      // Listener should be cleaned up
      expect(eventBus.listenerCount).toBe(0)
    })
  })

  describe('listenerCount', () => {
    it('should track active listeners', () => {
      expect(eventBus.listenerCount).toBe(0)

      const unsubscribe1 = eventBus.subscribe(vi.fn())
      expect(eventBus.listenerCount).toBe(1)

      const unsubscribe2 = eventBus.subscribe(vi.fn())
      expect(eventBus.listenerCount).toBe(2)

      unsubscribe1()
      expect(eventBus.listenerCount).toBe(1)

      unsubscribe2()
      expect(eventBus.listenerCount).toBe(0)
    })
  })
})