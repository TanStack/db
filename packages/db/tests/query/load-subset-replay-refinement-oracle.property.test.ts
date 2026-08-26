import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { projectReplayPublication } from '../load-subset-full-flow-model.js'
import { flushPromises } from '../utils.js'
import type { LoadSubsetFullFlowEvent } from '../load-subset-full-flow-model.js'
import type {
  ChangeMessage,
  ChangeMessageOrDeleteKeyMessage,
  LoadSubsetOptions,
} from '../../src/types.js'

type Row = { id: string; version: number }

describe(`loadSubset replay refinement`, () => {
  function createHarness(sourceId: string) {
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const pending: Array<{
      options: LoadSubsetOptions
      deferred: ReturnType<typeof createDeferred<void>>
    }> = []
    const batches: Array<
      Array<{
        type: `insert` | `update` | `delete`
        row: { sourceId: string; rowKey: string; version: number }
        previousVersion?: number
      }>
    > = []
    const visible = new Map<string, Row>()
    const source = createCollection<Row>({
      id: sourceId,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `row`, version: 1 } })
                commit()
                return true
              }
              const deferred = createDeferred<void>()
              pending.push({ options, deferred })
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = source.subscribeChanges(
      (changes: Array<ChangeMessage<Row, string>>) => {
        const batch = changes.map((change) => {
          if (change.type === `delete`) visible.delete(String(change.key))
          else visible.set(String(change.key), { ...change.value })
          return {
            type: change.type,
            row: {
              sourceId,
              rowKey: String(change.key),
              version: change.value.version,
            },
            ...(change.previousValue === undefined
              ? {}
              : { previousVersion: change.previousValue.version }),
          }
        })
        if (batch.length > 0) batches.push(batch)
      },
    )

    const replaceCore = (version: number) => {
      begin()
      write({ type: `insert`, value: { id: `row`, version } })
      commit()
    }
    const startReplay = async () => {
      begin()
      truncate()
      commit()
      await flushPromises()
    }
    const coreRows = () =>
      source.toArray.map(({ id, version }) => ({
        sourceId,
        rowKey: id,
        version,
      }))
    const visibleRows = () =>
      [...visible.values()].map(({ id, version }) => ({
        sourceId,
        rowKey: id,
        version,
      }))

    return {
      source,
      subscription,
      pending,
      batches,
      replaceCore,
      startReplay,
      coreRows,
      visibleRows,
    }
  }

  it(`retains the last complete publication when replay fails after writing`, async () => {
    const sourceId = `replay-refinement-failure`
    const row = (version: number) => ({
      sourceId,
      rowKey: `row`,
      version,
    })
    const history: Array<LoadSubsetFullFlowEvent> = [
      { type: `establishPublication`, sourceId, rows: [row(1)] },
    ]
    const harness = createHarness(sourceId)

    try {
      harness.subscription.requestSnapshot({ optimizedOnly: false })
      await harness.startReplay()
      history.push({ type: `startReplay`, attemptId: `replay-1`, sourceId })

      harness.replaceCore(2)
      history.push({
        type: `writeReplayRows`,
        attemptId: `replay-1`,
        rows: [row(2)],
        acceptedByCore: true,
      })
      harness.pending[0]?.deferred.reject(new Error(`replay failed`))
      history.push({
        type: `settleReplay`,
        attemptId: `replay-1`,
        outcome: `reject`,
      })
      await flushPromises()

      const expected = projectReplayPublication(history)
      expect(harness.coreRows()).toEqual(expected.coreRows)
      expect(harness.visibleRows()).toEqual(expected.visibleRows)
      expect(harness.batches).toEqual(expected.publishedBatches)
    } finally {
      harness.subscription.unsubscribe()
      await harness.source.cleanup()
    }
  })

  it(`waits for every overlapping replay before publishing the newest success`, async () => {
    const sourceId = `replay-refinement-overlap`
    const row = (version: number) => ({
      sourceId,
      rowKey: `row`,
      version,
    })
    const history: Array<LoadSubsetFullFlowEvent> = [
      { type: `establishPublication`, sourceId, rows: [row(1)] },
    ]
    const harness = createHarness(sourceId)

    try {
      harness.subscription.requestSnapshot({ optimizedOnly: false })
      await harness.startReplay()
      history.push({ type: `startReplay`, attemptId: `replay-1`, sourceId })
      await harness.startReplay()
      history.push({ type: `startReplay`, attemptId: `replay-2`, sourceId })

      expect(harness.pending[0]?.options.signal?.aborted).toBe(true)
      harness.replaceCore(3)
      history.push({
        type: `writeReplayRows`,
        attemptId: `replay-2`,
        rows: [row(3)],
        acceptedByCore: true,
      })
      harness.pending[1]?.deferred.resolve()
      history.push({
        type: `settleReplay`,
        attemptId: `replay-2`,
        outcome: `resolve`,
      })
      await flushPromises()

      const beforeObsoleteSettlement = projectReplayPublication(history)
      expect(harness.visibleRows()).toEqual(
        beforeObsoleteSettlement.visibleRows,
      )
      expect(harness.batches).toEqual(beforeObsoleteSettlement.publishedBatches)

      harness.pending[0]?.deferred.reject(
        new DOMException(`obsolete`, `AbortError`),
      )
      history.push({
        type: `settleReplay`,
        attemptId: `replay-1`,
        outcome: `reject`,
      })
      await flushPromises()

      const expected = projectReplayPublication(history)
      expect(harness.coreRows()).toEqual(expected.coreRows)
      expect(harness.visibleRows()).toEqual(expected.visibleRows)
      expect(harness.batches).toEqual(expected.publishedBatches)
    } finally {
      for (const replay of harness.pending) replay.deferred.resolve()
      harness.subscription.unsubscribe()
      await harness.source.cleanup()
    }
  })
})
