import { describe, expect, it } from 'vitest'
import {
  captureCandidateHostGap,
  createCandidateReceiptObservations,
  createControlledGraphTasks,
  failOneCandidatePublication,
  installCandidateContinuationControl,
  observeCandidatePromise,
  observeExactCandidateGraph,
} from './candidate-controls.js'

// Instrument calibration only: local callbacks, plain fake graph objects and
// native promises. No production import, QueryClient, DB history or host witness.
describe('future candidate control mechanics', () => {
  it('captures native promise settlement while the exact continuation stays queued', async () => {
    const queue = createControlledGraphTasks()
    queue.scheduleGraphContinuation(() => {
      throw new Error('must stay queued')
    })
    const complete = observeCandidatePromise(Promise.resolve())
    const pending = observeCandidatePromise(new Promise(() => {}))
    const cut = await captureCandidateHostGap(
      queue,
      1,
      () => [1],
      () => [1],
      () => ({ offset: 0, limit: 1 }),
      [complete, pending],
    )
    expect(cut.operations).toEqual([
      { state: 'fulfilled' },
      { state: 'pending' },
    ])
    expect(cut.tasks).toEqual([{ id: 1, cancelled: false, dispatches: 0 }])
  })
  it('refuses a host gap after the retained callback already dispatched', async () => {
    const queue = createControlledGraphTasks()
    queue.scheduleGraphContinuation(() => {})
    queue.dispatch(1)
    await expect(
      captureCandidateHostGap(
        queue,
        1,
        () => [],
        () => [],
        () => ({}),
        [],
      ),
    ).rejects.toThrow('did not remain queued')
  })

  it('records an exact deferred callback and preserves cancelled stale dispatch', () => {
    const queue = createControlledGraphTasks()
    let calls = 0
    const cancel = queue.scheduleGraphContinuation(() => {
      calls++
    })
    expect(calls).toBe(0)
    cancel()
    expect(() => queue.dispatch(1)).toThrow('deliberate stale dispatch')
    queue.dispatchStale(1)
    expect(calls).toBe(1)
    expect(queue.records()).toEqual([{ id: 1, cancelled: true, dispatches: 1 }])
  })
  it('refuses the absent baseline seam', () => {
    expect(() =>
      installCandidateContinuationControl(
        '/missing-h02-candidate',
        createControlledGraphTasks(),
      ),
    ).toThrow('seam is absent')
  })
  it('distinguishes dispatch from entry on the exact graph', () => {
    const queue = createControlledGraphTasks()
    const graph = { run: () => 7 }
    const other = { run: () => 8 }
    const observation = observeExactCandidateGraph(graph, queue)
    queue.scheduleGraphContinuation(() => {
      other.run()
    })
    queue.scheduleGraphContinuation(() => {
      graph.run()
    })
    queue.dispatch(1)
    expect(observation.entries()).toEqual([])
    queue.dispatch(2)
    expect(observation.entries()).toEqual([{ dispatchId: 2, faulted: false }])
    observation.restore()
  })
  it('injects a one-shot exact dispatched graph error and preserves later entry', () => {
    const queue = createControlledGraphTasks()
    const graph = { run: () => 7 }
    const original = graph.run
    const observation = observeExactCandidateGraph(graph, queue)
    const error = new Error('exact dispatched graph failure')
    observation.failNextDispatchedRun(error)
    expect(graph.run()).toBe(7)
    queue.scheduleGraphContinuation(() => {
      graph.run()
    })
    expect(() => queue.dispatch(1)).toThrow(error)
    queue.dispatch(1)
    expect(observation.entries()).toEqual([
      { dispatchId: undefined, faulted: false },
      { dispatchId: 1, faulted: true },
      { dispatchId: 1, faulted: false },
    ])
    observation.restore()
    expect(graph.run).toBe(original)
  })
  it('records promise rejection with exact identity and no replacement outcome', async () => {
    let reject: (error: unknown) => void = () => {
      throw new Error('not installed')
    }
    const promise = new Promise((_, fail) => {
      reject = fail
    })
    const read = observeCandidatePromise(promise)
    expect(read()).toEqual({ state: 'pending' })
    const error = new Error('original rejection')
    reject(error)
    await Promise.resolve()
    expect(read()).toEqual({ state: 'rejected', error })
  })
  it('throws at only one measured public delivery', () => {
    const error = new Error('publication tail')
    const fault = failOneCandidatePublication<number>(
      error,
      (value) => value === 2,
    )
    fault.callback(1)
    expect(() => fault.callback(2)).toThrow(error)
    fault.callback(2)
    expect(fault.observations()).toEqual({
      injected: true,
      deliveries: [1, 2, 2],
    })
  })
  it('keeps forward/restoration receipts and explicit disposal observations distinct', async () => {
    const target = {},
      retained = {},
      attempt = {}
    let reject: (error: unknown) => void = () => {
      throw new Error('not installed')
    }
    const parked = new Promise((_, fail) => {
      reject = fail
    })
    const controls = createCandidateReceiptObservations()
    controls.returned(target, attempt, parked)
    controls.returned(retained, attempt, true)
    controls.disposing(target, attempt)
    const error = new Error('disposed old target')
    reject(error)
    await Promise.resolve()
    expect(controls.observations()).toEqual({
      receipts: [
        {
          id: 1,
          target,
          attempt,
          literalTrue: false,
          observation: { state: 'rejected', error },
        },
        {
          id: 2,
          target: retained,
          attempt,
          literalTrue: true,
          observation: { state: 'fulfilled' },
        },
      ],
      disposals: [{ target, attempt }],
    })
  })
})
