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
import { describe, expect } from 'vitest'
import { DbClient, Query, collectionOptions } from '../src/index.js'
import { createDeferred } from '../src/deferred.js'
import { getLiveQueryHash } from '../src/live-query-options.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { expectedSsrStreamRecordOutcome } from './ssr-stream-view-oracle.js'
import { oracleProperty } from './oracle-property.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter.js'
import { declareOracle } from './oracle-declaration.js'
import { withOracleCleanup } from './utils.js'
import type { Verdict } from './oracle-property.js'
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
      if (history.record === `pending`)
        oracleAssertion(`checkRecordHistory:106`, () =>
          expect(waiting).toBeUndefined(),
        )
      else {
        oracleAssertion(`checkRecordHistory:108`, () =>
          expect(waiting).toBeInstanceOf(Promise),
        )
        oracleAssertion(`checkRecordHistory:109`, () =>
          expect(wait()).toBe(waiting),
        )
        client._setSsrStreamingEnabled(true)
        oracleAssertion(`checkRecordHistory:111`, () =>
          expect(
            wait(),
            `enabling the current stream preserves its existing demand`,
          ).toBe(waiting),
        )
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
      oracleAssertion(`checkRecordHistory:132`, () =>
        expect(
          settled,
          `a peer record cannot settle this query's demand`,
        ).toBeUndefined(),
      )
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
      oracleAssertion(`checkRecordHistory:151`, () =>
        expect(wait()).toBeUndefined(),
      )
      if (expected === `pending`) {
        await Promise.resolve()
        oracleAssertion(`checkRecordHistory:154`, () =>
          expect(
            settled,
            `normal record-stream close retains the known result promise`,
          ).toBeUndefined(),
        )
        result.resolve(snapshot)
      }
      await pending
      oracleAssertion(`checkRecordHistory:161`, () =>
        expect(client._getLiveQuery(hash, true)?.snapshot).toEqual(snapshot),
      )
    } else if (history.record === `pending`) {
      await pending?.catch(() => {})
      oracleAssertion(`checkRecordHistory:164`, () =>
        expect(settled).toEqual({ status: `error`, cause }),
      )
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
      oracleAssertion(`checkRecordHistory:175`, () =>
        expect(
          first.threw,
          `missing terminal transport cannot become successful browser data`,
        ).toBe(true),
      )
      if (expected === `transport-error`)
        oracleAssertion(`checkRecordHistory:179`, () =>
          expect(first.cause).toBe(cause),
        )
      else
        oracleAssertion(`checkRecordHistory:181`, () =>
          expect(first.cause).toMatchObject({
            message: `The DB stream ended before the server-rendered query snapshot arrived.`,
          }),
        )
      oracleAssertion(`checkRecordHistory:184`, () =>
        expect(capture(() => observer.getSnapshot())).toEqual(first),
      )
      oracleAssertion(`checkRecordHistory:185`, () =>
        expect(capture(() => client._waitForSsrLiveQuery(hash))).toEqual(first),
      )
      await pending?.catch(() => {})
    }
    oracleAssertion(`checkRecordHistory:188`, () =>
      expect(starts, `waiting and terminal retry never acquire a source`).toBe(
        prefix,
      ),
    )
    if (history.restartAfterCleanup) {
      // DbClient cleanup releases its current scope, rather than destroying
      // the client: the existing rematerialization contract permits this next
      // lifetime. The prior rejected promise keeps its own terminal cause.
      const priorSettlement = settled
      await client.cleanup()
      oracleAssertion(`checkRecordHistory:197`, () =>
        expect(client.collection(descriptor)).not.toBe(source),
      )
      client._setSsrStreamingEnabled(true)
      client.hydrate({ collections: [] })
      let replacement: Promise<void> | undefined
      oracleAssertion(`checkRecordHistory:201`, () =>
        expect(() => {
          replacement = wait()
        }, `a new stream cannot inherit the old terminal cause`).not.toThrow(),
      )
      oracleAssertion(`checkRecordHistory:204`, () =>
        expect(
          replacement,
          `a fresh stream owns a fresh missing-record wait`,
        ).toBeInstanceOf(Promise),
      )
      client.hydrate({
        collections: [],
        liveQueries: [{ queryHash: hash, dehydratedAt: 3, snapshot }],
      })
      await replacement
      oracleAssertion(`checkRecordHistory:213`, () =>
        expect(wait()).toBeUndefined(),
      )
      oracleAssertion(`checkRecordHistory:214`, () =>
        expect(client._getLiveQuery(hash, true)?.snapshot).toEqual(snapshot),
      )
      oracleAssertion(`checkRecordHistory:215`, () =>
        expect(settled, `a new lifetime cannot revive the old result`).toEqual(
          priorSettlement,
        ),
      )
    }
  }, [
    () => result.resolve(snapshot),
    () => observer.dispose(),
    () => client.cleanup(),
  ])
}

// Native registration uses the same grammar and complete independent helper.
// Four legal constructions replace seed-dependent reach without changing the
// generated language, excluded pending+cleanup case, or comparison checkpoints.
describe(`SSR stream record lifetime`, () => {
  oracleProperty<SsrStreamRecordHistory, Verdict>({
    id: `ssr.stream-record-lifetime`,
    law: {
      statement: `Each record demand settles at its transport checkpoint and terminal retries preserve its outcome without acquiring a source.`,
      authority: `The stream-view owner's expectedSsrStreamRecordOutcome and the record lifetime contract above.`,
      limits: `Missing, pending and local records under the existing transport grammar; pending+cleanup and timestamp policy after consumption remain excluded.`,
    },
    histories: {
      arbitrary: grammar,
      runs: 100,
      fixedSeeds: [2229],
      states: [
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
      ],
      constructed: [
        {
          name: `missing record arrival after a peer`,
          enters: [`missing`, `arrival`, `peer-first`, `undefined-cause`],
          build: (generated) => ({
            ...generated,
            record: `missing` as const,
            terminal: `arrival` as const,
            peerFirst: true,
            definedCause: false,
          }),
        },
        {
          name: `pending record closes`,
          enters: [`pending`, `close`],
          build: (generated) => ({
            ...generated,
            record: `pending` as const,
            terminal: `close` as const,
          }),
        },
        {
          name: `local record attempts after transport error`,
          enters: [`local`, `error`, `late-attempt`],
          build: (generated) => ({
            ...generated,
            record: `local` as const,
            terminal: `error` as const,
            attemptAfterTerminal: true,
          }),
        },
        {
          name: `missing record starts a new stream after cleanup`,
          enters: [`cleanup`, `restart-after-cleanup`],
          build: (generated) => ({
            ...generated,
            record: `missing` as const,
            terminal: `cleanup` as const,
            restartAfterCleanup: true,
          }),
        },
      ],
    },
    model: recordedAssertionJudgment,
    driver: (history, observe) =>
      recordAssertionJudgment(
        `SSR stream record lifetime`,
        history,
        observe,
        async () => {
          await checkRecordHistory(history)
          observe(`reach`, history.record)
          observe(`reach`, history.terminal)
          if (history.attemptAfterTerminal) observe(`reach`, `late-attempt`)
          if (history.peerFirst) observe(`reach`, `peer-first`)
          if (!history.definedCause) observe(`reach`, `undefined-cause`)
          if (history.restartAfterCleanup)
            observe(`reach`, `restart-after-cleanup`)
        },
      ),
    check: forwardAssertionJudgment,
  })
})

// What this oracle owns: the gap report judges the DbClient's SSR query waits
// and stream failure handling in client.ts by this file's tests. The record
// model is checkRecordHistory's expectation over the stream-view oracle.
declareOracle({
  owns: [`src/client.ts`],
  check: [checkRecordHistory],
  grammar: [grammar],
})
