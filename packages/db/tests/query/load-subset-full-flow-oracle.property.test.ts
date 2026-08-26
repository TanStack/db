import { expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import {
  projectAdapterLifecycle,
  projectRetainedRowKeys,
  projectTransportLoads,
} from '../load-subset-full-flow-model.js'
import type { LoadSubsetOptions } from '../../src/types.js'
import type { LoadSubsetFullFlowEvent } from '../load-subset-full-flow-model.js'

type AdapterLifecycleEvent =
  | { type: `start`; options: LoadSubsetOptions }
  | { type: `release`; options: LoadSubsetOptions }

function eventTypes(
  events: ReadonlyArray<AdapterLifecycleEvent>,
): Array<AdapterLifecycleEvent[`type`]> {
  return events.map((event) => event.type)
}

function visibleRows<Row extends { id: string; value: number }>(
  values: Iterable<Row>,
): Array<{ id: string; value: number }> {
  return Array.from(values, ({ id, value }) => ({ id, value }))
}

it(`does not release physical work when an already-aborted demand skips adapter start`, async () => {
  const ownerId = `aborted-owner`
  const requestEvent: LoadSubsetFullFlowEvent = {
    type: `requestDemand`,
    ownerId,
    sessionId: `session-1`,
    demandId: `all-rows`,
    alreadyAborted: true,
  }
  const history: ReadonlyArray<LoadSubsetFullFlowEvent> = [
    requestEvent,
    {
      type: `releaseDemand`,
      ownerId,
      demandId: `all-rows`,
      rowKeys: [],
      finalRowOwner: false,
      invalidatesAdapterEvidence: false,
    },
  ]
  const adapterEvents: Array<AdapterLifecycleEvent> = []
  const collection = createCollection<{ id: string }>({
    id: `full-flow-aborted-before-start`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return {
          loadSubset: (options) => {
            adapterEvents.push({ type: `start`, options })
            return true
          },
          unloadSubset: (options) => {
            adapterEvents.push({ type: `release`, options })
          },
        }
      },
    },
  })
  const subscription = collection.subscribeChanges(() => {}, {
    includeInitialState: false,
  })
  const request = new AbortController()
  request.abort()

  try {
    subscription.requestSnapshot({
      signal: request.signal,
      optimizedOnly: false,
    })
    expect(eventTypes(adapterEvents)).toEqual(
      projectAdapterLifecycle([requestEvent]).map(({ type }) =>
        type === `invoke` ? `start` : `release`,
      ),
    )

    subscription.unsubscribe()

    // A skipped adapter call creates no physical resource to release.
    expect(eventTypes(adapterEvents)).toEqual(
      projectAdapterLifecycle(history).map(({ type }) =>
        type === `invoke` ? `start` : `release`,
      ),
    )
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`reloads authoritative rows after final-owner cleanup invalidates retained adapter coverage`, async () => {
  type Row = { id: string; value: number }
  const row: Row = { id: `row`, value: 1 }
  const history: ReadonlyArray<LoadSubsetFullFlowEvent> = [
    {
      type: `requestDemand`,
      ownerId: `owner-1`,
      sessionId: `session-1`,
      demandId: `all-rows`,
      alreadyAborted: false,
    },
    {
      type: `applyAuthoritativeRows`,
      ownerId: `owner-1`,
      demandId: `all-rows`,
      rowKeys: [row.id],
    },
    {
      type: `releaseDemand`,
      ownerId: `owner-1`,
      demandId: `all-rows`,
      rowKeys: [row.id],
      finalRowOwner: true,
      invalidatesAdapterEvidence: true,
    },
    {
      type: `restartSession`,
      previousSessionId: `session-1`,
      nextSessionId: `session-2`,
    },
    {
      type: `requestDemand`,
      ownerId: `owner-2`,
      sessionId: `session-2`,
      demandId: `all-rows`,
      alreadyAborted: false,
    },
    {
      type: `applyAuthoritativeRows`,
      ownerId: `owner-2`,
      demandId: `all-rows`,
      rowKeys: [row.id],
    },
  ]
  let transportLoads = 0
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>

  const deduplicated = new DeduplicatedLoadSubset({
    loadSubset: async () => {
      transportLoads++
      begin()
      write({ type: `insert`, value: row })
      const applied = commit()
      if (applied !== true) await applied
      return { hasMore: false, appliedRowKeys: [row.id] }
    },
  })
  const source = createCollection<Row>({
    id: `full-flow-dedupe-remount-source`,
    getKey: (value) => value.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: deduplicated.loadSubset,
          unloadSubset: deduplicated.unloadSubset,
        }
      },
    },
  })
  const createLive = (id: string) =>
    createLiveQueryCollection({
      id,
      query: (q) => q.from({ row: source }),
      startSync: true,
    })
  const first = createLive(`full-flow-dedupe-remount-first`)
  let second: ReturnType<typeof createLive> | undefined

  try {
    await first.preload()
    expect(visibleRows(first.values())).toEqual([row])
    expect(transportLoads).toBe(1)

    await first.cleanup()
    expect(Array.from(source.values())).toEqual([])

    second = createLive(`full-flow-dedupe-remount-second`)
    await second.preload()

    // The adapter must either replay retained evidence or fetch it again.
    expect(transportLoads).toBe(projectTransportLoads(history))
    expect(visibleRows(second.values()).map(({ id }) => id)).toEqual(
      projectRetainedRowKeys(history),
    )
  } finally {
    await Promise.all([
      first.cleanup(),
      second?.cleanup() ?? Promise.resolve(),
      source.cleanup(),
    ])
  }
})
