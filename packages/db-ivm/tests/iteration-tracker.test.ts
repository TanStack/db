import { describe, expect, it } from 'vitest'
import { createIterationTracker } from '../src/iteration-tracker.js'

describe(`createIterationTracker`, () => {
  it(`should not exceed limit on normal iteration counts`, () => {
    const tracker = createIterationTracker<string>(100)

    for (let i = 0; i < 50; i++) {
      expect(tracker.trackAndCheckLimit(`state-a`)).toBe(false)
    }

    expect(tracker.getIterations()).toBe(50)
  })

  it(`should return true when limit is exceeded`, () => {
    const tracker = createIterationTracker<string>(10)

    for (let i = 0; i < 10; i++) {
      expect(tracker.trackAndCheckLimit(`state`)).toBe(false)
    }

    // 11th iteration exceeds the limit
    expect(tracker.trackAndCheckLimit(`state`)).toBe(true)
    expect(tracker.getIterations()).toBe(11)
  })

  it(`should track state transitions correctly`, () => {
    const tracker = createIterationTracker<string>(100)

    // 3 iterations in state-a
    tracker.trackAndCheckLimit(`state-a`)
    tracker.trackAndCheckLimit(`state-a`)
    tracker.trackAndCheckLimit(`state-a`)

    // 2 iterations in state-b
    tracker.trackAndCheckLimit(`state-b`)
    tracker.trackAndCheckLimit(`state-b`)

    // 1 iteration in state-c (forces recording of state-b)
    tracker.trackAndCheckLimit(`state-c`)

    const history = tracker.getHistory()

    expect(history).toHaveLength(2)
    expect(history[0]).toEqual({
      state: `state-a`,
      startIter: 1,
      endIter: 3,
    })
    expect(history[1]).toEqual({
      state: `state-b`,
      startIter: 4,
      endIter: 5,
    })
  })

  it(`should record final state when limit is exceeded`, () => {
    const tracker = createIterationTracker<string>(5)

    // 2 iterations in state-a
    tracker.trackAndCheckLimit(`state-a`)
    tracker.trackAndCheckLimit(`state-a`)

    // 4 iterations in state-b (exceeds limit at iteration 6)
    tracker.trackAndCheckLimit(`state-b`)
    tracker.trackAndCheckLimit(`state-b`)
    tracker.trackAndCheckLimit(`state-b`)
    const exceeded = tracker.trackAndCheckLimit(`state-b`)

    expect(exceeded).toBe(true)

    const history = tracker.getHistory()
    expect(history).toHaveLength(2)
    expect(history[0]).toEqual({
      state: `state-a`,
      startIter: 1,
      endIter: 2,
    })
    expect(history[1]).toEqual({
      state: `state-b`,
      startIter: 3,
      endIter: 6,
    })
  })

  it(`should format warning with iteration breakdown`, () => {
    const tracker = createIterationTracker<string>(5, (state) => `ops=[${state}]`)

    // Create a pattern: 2 in state-a, then exceed in state-b
    tracker.trackAndCheckLimit(`TopK,Filter`)
    tracker.trackAndCheckLimit(`TopK,Filter`)
    tracker.trackAndCheckLimit(`TopK`)
    tracker.trackAndCheckLimit(`TopK`)
    tracker.trackAndCheckLimit(`TopK`)
    tracker.trackAndCheckLimit(`TopK`) // exceeds

    const warning = tracker.formatWarning(`D2 graph execution`, {
      totalOperators: 8,
    })

    expect(warning).toContain(`[TanStack DB] D2 graph execution exceeded 5 iterations`)
    expect(warning).toContain(`Continuing with available data`)
    expect(warning).toContain(`Iteration breakdown (where the loop spent time):`)
    expect(warning).toContain(`1-2: ops=[TopK,Filter]`)
    expect(warning).toContain(`3-6: ops=[TopK]`)
    expect(warning).toContain(`"totalOperators": 8`)
    expect(warning).toContain(`https://github.com/TanStack/db/issues`)
  })

  it(`should work with object states using default JSON serialization`, () => {
    type State = { valuesNeeded: number; keysInBatch: number }
    const tracker = createIterationTracker<State>(10)

    tracker.trackAndCheckLimit({ valuesNeeded: 10, keysInBatch: 5 })
    tracker.trackAndCheckLimit({ valuesNeeded: 10, keysInBatch: 5 })
    tracker.trackAndCheckLimit({ valuesNeeded: 8, keysInBatch: 3 })

    const history = tracker.getHistory()
    expect(history).toHaveLength(1)
    expect(history[0]!.state).toEqual({ valuesNeeded: 10, keysInBatch: 5 })
  })

  it(`should use custom stateToKey function for display`, () => {
    type State = { valuesNeeded: number; keysInBatch: number }
    const tracker = createIterationTracker<State>(
      5,
      (state) => `valuesNeeded=${state.valuesNeeded}, keysInBatch=${state.keysInBatch}`
    )

    tracker.trackAndCheckLimit({ valuesNeeded: 10, keysInBatch: 5 })
    tracker.trackAndCheckLimit({ valuesNeeded: 10, keysInBatch: 5 })
    tracker.trackAndCheckLimit({ valuesNeeded: 10, keysInBatch: 5 })
    tracker.trackAndCheckLimit({ valuesNeeded: 10, keysInBatch: 5 })
    tracker.trackAndCheckLimit({ valuesNeeded: 10, keysInBatch: 5 })
    tracker.trackAndCheckLimit({ valuesNeeded: 10, keysInBatch: 5 }) // exceeds

    const warning = tracker.formatWarning(`requestLimitedSnapshot`)

    expect(warning).toContain(`1-6: valuesNeeded=10, keysInBatch=5`)
  })

  it(`should handle single state that exceeds limit`, () => {
    const tracker = createIterationTracker<string>(3)

    tracker.trackAndCheckLimit(`stuck`)
    tracker.trackAndCheckLimit(`stuck`)
    tracker.trackAndCheckLimit(`stuck`)
    const exceeded = tracker.trackAndCheckLimit(`stuck`)

    expect(exceeded).toBe(true)

    const history = tracker.getHistory()
    expect(history).toHaveLength(1)
    expect(history[0]).toEqual({
      state: `stuck`,
      startIter: 1,
      endIter: 4,
    })
  })

  it(`should format warning without diagnostic info`, () => {
    const tracker = createIterationTracker<string>(2)

    tracker.trackAndCheckLimit(`state`)
    tracker.trackAndCheckLimit(`state`)
    tracker.trackAndCheckLimit(`state`) // exceeds

    const warning = tracker.formatWarning(`Graph execution`)

    expect(warning).toContain(`[TanStack DB] Graph execution exceeded 2 iterations`)
    expect(warning).not.toContain(`Diagnostic info:`)
  })
})
