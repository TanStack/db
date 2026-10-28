/**
 * Core receiving driver for the stream-view owner's record lifetime judgment.
 * The real Router host established the original RED before production edits.
 * This later driver adds undefined causes, cleanup, peer records, and first
 * attempts after transport terminates; it is not that original pre-edit gate.
 *
 * The grammar separates missing, received pending, and explicitly preloaded
 * local records. A local preload uses the public API and a newer browser clock;
 * its rows cannot answer hydration before an older server record arrives.
 * Pending+cleanup is excluded: disposal of an existing result promise is not
 * the missing-record lifetime law. No timestamp policy after consumption is
 * asserted. Internal wait observations isolate settlement and identity; public
 * observer reads check terminal retries without starting adapter work.
 */
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { DbClient, Query, collectionOptions } from '../src/index.js'
import { createDeferred } from '../src/deferred.js'
import { getLiveQueryHash } from '../src/live-query-options.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { expectedSsrStreamRecordOutcome } from './ssr-stream-view-oracle.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'
import { createOracleReach } from './oracle-reach.js'
import { withOracleCleanup } from './utils.js'
import type { DehydratedLiveQueryResult } from '../src/client.js'
import type { SsrStreamRecordHistory } from './ssr-stream-view-oracle.js'

const grammar = fc
  .record({
    record: fc.constantFrom(
      `missing` as const,
      `pending` as const,
      `local` as const,
    ),
    terminal: fc.constantFrom(
      `arrival` as const,
      `close` as const,
      `error` as const,
      `cleanup` as const,
    ),
    attemptAfterTerminal: fc.boolean(),
    peerFirst: fc.boolean(),
    definedCause: fc.boolean(),
    restartAfterCleanup: fc.boolean(),
  })
  .filter(
    (history) => history.record !== `pending` || history.terminal !== `cleanup`,
  )

async function checkRecordHistory(history: SsrStreamRecordHistory) {
  const client = new DbClient()
  client._setSsrStreamingEnabled(true)
  client.hydrate({ collections: [] })
  let starts = 0
  const descriptor = collectionOptions(`stream-record-wait`, () => ({
    id: `stream-record-wait`,
    getKey: (row: { id: string; version: number }) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        starts++
        begin()
        write({ type: `insert`, value: { id: `a`, version: 1 } })
        commit()
        markReady()
      },
    },
  }))
  const query = new Query().from({ row: descriptor })
  const hash = getLiveQueryHash({ query })
  const source = client.collection(descriptor)
  const observer = createLiveQueryObserver(source, {
    client,
    queryHash: hash,
    mode: `wholesale`,
  })
  const result = createDeferred<DehydratedLiveQueryResult>()
  const snapshot: DehydratedLiveQueryResult = {
    rows: [{ key: `a`, value: { id: `a`, version: 0 } }],
  }
  const cause = history.definedCause ? new Error(`transport failed`) : undefined
  let pending: Promise<void> | undefined
  let settled:
    { status: `ready` } | { status: `error`; cause: unknown } | undefined
  await withOracleCleanup(async () => {
    if (history.record === `pending`) {
      client.hydrate({
        collections: [],
        liveQueries: [
          { queryHash: hash, dehydratedAt: 1, promise: result.promise },
        ],
      })
      pending = client._getLiveQuery(hash)!.promise
    } else if (history.record === `local`)
      await client.preloadLiveQuery({ query })
    const prefix = starts
    const wait = () => client._waitForSsrLiveQuery(hash, true)
    if (!history.attemptAfterTerminal) {
      const waiting = wait()
      if (history.record === `pending`) expect(waiting).toBeUndefined()
      else {
        expect(waiting).toBeInstanceOf(Promise)
        expect(wait()).toBe(waiting)
        client._setSsrStreamingEnabled(true)
        expect(
          wait(),
          `enabling the current stream preserves its existing demand`,
        ).toBe(waiting)
        pending = waiting
      }
    }
    void pending?.then(
      () => {
        settled = { status: `ready` }
      },
      (error) => {
        settled = { status: `error`, cause: error }
      },
    )
    if (history.peerFirst) {
      client.hydrate({
        collections: [],
        liveQueries: [{ queryHash: `unrelated`, dehydratedAt: 1, snapshot }],
      })
      await Promise.resolve()
      expect(
        settled,
        `a peer record cannot settle this query's demand`,
      ).toBeUndefined()
    }
    if (history.terminal === `arrival`) {
      client.hydrate({
        collections: [],
        liveQueries: [{ queryHash: hash, dehydratedAt: 2, snapshot }],
      })
      result.resolve(snapshot)
    } else if (history.terminal === `close`)
      client._setSsrStreamingEnabled(false)
    else if (history.terminal === `error`) {
      client._failPendingLiveQueries(cause)
      client._setSsrStreamingEnabled(false)
    } else await client.cleanup()
    const expected = expectedSsrStreamRecordOutcome(history)
    if (expected === `snapshot` || expected === `pending`) {
      expect(wait()).toBeUndefined()
      if (expected === `pending`) {
        await Promise.resolve()
        expect(
          settled,
          `normal record-stream close retains the known result promise`,
        ).toBeUndefined()
        result.resolve(snapshot)
      }
      await pending
      expect(client._getLiveQuery(hash, true)?.snapshot).toEqual(snapshot)
    } else if (history.record === `pending`) {
      await pending?.catch(() => {})
      expect(settled).toEqual({ status: `error`, cause })
    } else {
      const capture = (read: () => unknown) => {
        try {
          read()
          return { threw: false, cause: undefined as unknown }
        } catch (error) {
          return { threw: true, cause: error }
        }
      }
      const first = capture(wait)
      expect(
        first.threw,
        `missing terminal transport cannot become successful browser data`,
      ).toBe(true)
      if (expected === `transport-error`) expect(first.cause).toBe(cause)
      else
        expect(first.cause).toMatchObject({
          message: `The DB stream ended before the server-rendered query snapshot arrived.`,
        })
      expect(capture(() => observer.getSnapshot())).toEqual(first)
      expect(capture(() => client._waitForSsrLiveQuery(hash))).toEqual(first)
      await pending?.catch(() => {})
    }
    expect(starts, `waiting and terminal retry never acquire a source`).toBe(
      prefix,
    )
    if (history.restartAfterCleanup) {
      // DbClient cleanup releases its current scope, rather than destroying
      // the client: the existing rematerialization contract permits this next
      // lifetime. The prior rejected promise keeps its own terminal cause.
      const priorSettlement = settled
      await client.cleanup()
      expect(client.collection(descriptor)).not.toBe(source)
      client._setSsrStreamingEnabled(true)
      client.hydrate({ collections: [] })
      let replacement: Promise<void> | undefined
      expect(() => {
        replacement = wait()
      }, `a new stream cannot inherit the old terminal cause`).not.toThrow()
      expect(
        replacement,
        `a fresh stream owns a fresh missing-record wait`,
      ).toBeInstanceOf(Promise)
      client.hydrate({
        collections: [],
        liveQueries: [{ queryHash: hash, dehydratedAt: 3, snapshot }],
      })
      await replacement
      expect(wait()).toBeUndefined()
      expect(client._getLiveQuery(hash, true)?.snapshot).toEqual(snapshot)
      expect(settled, `a new lifetime cannot revive the old result`).toEqual(
        priorSettlement,
      )
    }
  }, [
    () => result.resolve(snapshot),
    () => observer.dispose(),
    () => client.cleanup(),
  ])
}

describe(`SSR stream record lifetime`, () => {
  for (const campaign of [`fixed`, `random`] as const) {
    it(`settles each record demand at its transport checkpoint (${campaign})`, async () => {
      const reach = createOracleReach(`ssr-stream-record`, [
        `missing`,
        `pending`,
        `local`,
        `arrival`,
        `close`,
        `error`,
        `cleanup`,
        `late-attempt`,
        `peer-first`,
        `undefined-cause`,
        `restart-after-cleanup`,
      ])
      await fc.assert(
        fc.asyncProperty(grammar, async (history) => {
          reach.beginHistory()
          await checkRecordHistory(history)
          reach.reach(history.record)
          reach.reach(history.terminal)
          if (history.attemptAfterTerminal) reach.reach(`late-attempt`)
          if (history.peerFirst) reach.reach(`peer-first`)
          if (!history.definedCause) reach.reach(`undefined-cause`)
          if (history.restartAfterCleanup) reach.reach(`restart-after-cleanup`)
        }),
        campaign === `fixed`
          ? { numRuns: oracleRuns(100), seed: 2229 }
          : oraclePropertyOptions(100, `ssr.stream-record-lifetime`),
      )
      reach.assertReached()
      console.info(
        `ssr-stream-record ${campaign}`,
        Object.fromEntries(reach.counts()),
      )
    })
  }
})
