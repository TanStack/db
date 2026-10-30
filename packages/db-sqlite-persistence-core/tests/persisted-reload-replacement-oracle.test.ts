import { createCollection } from '@tanstack/db'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { persistedCollectionOptions } from '../src/index.js'
import type { PersistenceAdapter } from '../src/index.js'
import type { SyncConfig } from '@tanstack/db'

/**
 * # What replaces a persisted Collection's rows, through the wrapper?
 *
 * Core's law (maintainer decisions F19 and F18/F6, recorded in the core API
 * note for this review): a sync transaction replaces every synced row only
 * when the sync adapter declares it, by `begin({ snapshot: true })` or by
 * calling `truncate()` in it. Every other transaction applies on the rows the
 * Collection holds, during a reload too. A snapshot does not mark the
 * Collection ready; `truncate()` does unless it is `truncate({ markReady:
 * false })`. A reload of a `ready` Collection keeps the retired run's rows,
 * status, and problems until the new run's first replacing transaction
 * applies or its `markReady()`, whichever comes first.
 *
 * The persisted wrapper sits between the sync adapter and core. Two laws hold
 * through it:
 *
 * - **It forwards the adapter's calls faithfully.** The `snapshot` option of
 *   `begin` and the `markReady` option of `truncate` reach core as the adapter
 *   gave them.
 * - **Its own work is never a replacement.** On a reload the wrapper restarts
 *   persistence: it restores the durable rows and writes its own metadata.
 *   Those commits are its bookkeeping, not the sync adapter's declaration of
 *   full state, so they replace nothing and do not complete the reload.
 *
 * And durable storage follows the Collection: once the history settles, the
 * durable rows equal the rows the Collection shows, so a replacement deletes
 * the rows it did not write from storage too.
 *
 * ## The model
 *
 * `expected` replays the history's steps over the visible rows, the status,
 * and the reload's state. It reads no production state.
 *
 * ## The history grammar
 *
 * A Collection whose durable store already holds rows `a` and `b` either
 * starts its first load from them (`first-load`), or became ready from a
 * snapshot of them and then reloads (`reload`). Its run then does, in order:
 * zero to two unmarked steps (`write`: an `update` of the kept row `a`;
 * `metadata`: a commit that only sets collection metadata), then one
 * full-state step (`snapshot`, `truncate`, `truncate-not-ready`, or `none`)
 * that writes rows `b` and `c`, then `markReady()`. Every combination is
 * generated.
 *
 * ## The comparison
 *
 * After every step the driver compares the visible rows (key and value), the
 * status, and whether the reload completed. At the end it compares the rows
 * in the durable store with the visible rows.
 *
 * ## Limits
 *
 * The adapter is a controlled in-memory persistence adapter, not SQLite. The
 * Collection is eager; on-demand replay after a replacement belongs to core's
 * subscription owner. Cross-tab delivery of a snapshot is outside this owner.
 */

type Row = { id: string; value: string }
type Phase = `first-load` | `reload`
type Prefix = `write` | `metadata`
type Final = `snapshot` | `truncate` | `truncate-not-ready` | `none`
type Step = Prefix | Final | `ready`
type History = { phase: Phase; prefix: Array<Prefix>; final: Final }

const DURABLE: Array<Row> = [
  { id: `a`, value: `a1` },
  { id: `b`, value: `b1` },
]
const DIRECT: Row = { id: `a`, value: `a-direct` }
const FULL_STATE: Array<Row> = [
  { id: `b`, value: `b2` },
  { id: `c`, value: `c2` },
]

type Observation = {
  rows: Array<string>
  status: string
  reload: `none` | `pending` | `completed`
}

const rowsOf = (rows: Iterable<Row>) =>
  [...rows].map((row) => `${row.id}=${row.value}`).sort()

// ---------------------------------------------------------------------------
// Independent model
// ---------------------------------------------------------------------------

function expected(history: History): Array<Observation> {
  const rows = new Map(DURABLE.map((row) => [row.id, row]))
  let status = history.phase === `reload` ? `ready` : `loading`
  let reload: Observation[`reload`] =
    history.phase === `reload` ? `pending` : `none`
  const replace = () => {
    rows.clear()
    for (const row of FULL_STATE) rows.set(row.id, row)
    // A replacement completes a reload of a ready Collection.
    if (reload === `pending` && status === `ready`) reload = `completed`
  }
  const markReady = () => {
    status = `ready`
    if (reload === `pending`) reload = `completed`
  }
  return steps(history).map((step) => {
    if (step === `write`) rows.set(DIRECT.id, DIRECT)
    else if (step === `snapshot` || step === `truncate-not-ready`) replace()
    else if (step === `truncate`) {
      replace()
      markReady()
    } else if (step === `ready`) markReady()
    // `metadata` and `none` change no row.
    return { rows: rowsOf(rows.values()), status, reload }
  })
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const steps = (history: History): Array<Step> => [
  ...history.prefix,
  history.final,
  `ready`,
]

const PREFIXES: Array<Array<Prefix>> = [
  [],
  [`write`],
  [`metadata`],
  [`write`, `metadata`],
  [`metadata`, `write`],
]
const histories: Array<History> = []
for (const phase of [`first-load`, `reload`] as const)
  for (const prefix of PREFIXES)
    for (const final of [
      `snapshot`,
      `truncate`,
      `truncate-not-ready`,
      `none`,
    ] as const)
      histories.push({ phase, prefix, final })

const reachStates = [
  `an unmarked commit during a reload`,
  `a snapshot during a reload`,
  `a snapshot during a first load`,
  `a truncate that keeps the Collection loading`,
] as const

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

// An in-memory persistence adapter that keeps the rows its commits write.
function storingAdapter() {
  const rows = new Map(DURABLE.map((row) => [row.id, row]))
  const entries = () =>
    [...rows.values()].map((value) => ({ key: value.id, value }))
  const adapter: PersistenceAdapter = {
    loadSubset: async () => entries(),
    loadResumeSnapshot: async (_id, options) => ({
      rows: options?.includeRows === false ? [] : entries(),
      keySet: { status: `consistent` },
      collectionMetadata: [],
      latestTerm: 0,
      latestSeq: 0,
      latestRowVersion: 0,
      resetEpoch: 0,
    }),
    applyCommittedTx: async (_id, tx) => {
      if (tx.truncate) rows.clear()
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) rows.delete(mutation.key as string)
        else rows.set(mutation.key as string, mutation.value as Row)
      }
    },
    ensureIndex: async () => {},
  }
  return { adapter, rows }
}

type Params = Parameters<SyncConfig<Row, string>[`sync`]>[0]

function writeFullState(params: Params, final: Final) {
  if (final === `none`) return
  if (final === `snapshot`) params.begin({ snapshot: true })
  else {
    params.begin()
    params.truncate(
      final === `truncate-not-ready` ? { markReady: false } : undefined,
    )
  }
  for (const row of FULL_STATE) params.write({ type: `insert`, value: row })
  params.commit()
}

describe(`persisted reload replacement oracle`, () => {
  const reach = createOracleReach(
    `persisted-reload-replacement.history`,
    reachStates,
  )
  let historiesRan = 0
  afterAll(() => {
    if (historiesRan === histories.length) reach.assertReached()
  })

  it.each(
    histories.map(
      (history) =>
        [`${history.phase}: ${steps(history).join(` > `)}`, history] as const,
    ),
  )(`%s`, async (name, history) => {
    const store = storingAdapter()
    const runs: Array<Params> = []
    const collection = createCollection(
      persistedCollectionOptions<Row, string>({
        id: `reload-replacement ${name}`,
        getKey: (row) => row.id,
        persistence: { adapter: store.adapter },
        sync: {
          sync: (params) => {
            runs.push(params)
          },
        },
      }),
    )
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const reloadState = { completed: false }
    reach.beginHistory()
    try {
      void collection.preload().catch(() => undefined)
      await settle()
      if (history.phase === `reload`) {
        // The first run's snapshot of the durable rows makes it ready.
        runs[0]!.begin({ snapshot: true })
        for (const row of DURABLE)
          runs[0]!.write({ type: `insert`, value: row })
        runs[0]!.commit()
        runs[0]!.markReady()
        await settle()
        void collection.reload().then(() => (reloadState.completed = true))
        await settle()
      }
      const run = runs.at(-1)!
      const model = expected(history)
      for (const [index, step] of steps(history).entries()) {
        if (step === `write`) {
          run.begin()
          run.write({ type: `update`, value: DIRECT })
          run.commit()
        } else if (step === `metadata`) {
          run.begin()
          run.metadata!.collection.set(`cursor`, index)
          run.commit()
        } else if (step === `ready`) run.markReady()
        else writeFullState(run, step)
        await settle()
        if (
          history.phase === `reload` &&
          (step === `write` || step === `metadata`)
        )
          reach.reach(`an unmarked commit during a reload`)
        if (step === `snapshot`)
          reach.reach(
            history.phase === `reload`
              ? `a snapshot during a reload`
              : `a snapshot during a first load`,
          )
        if (step === `truncate-not-ready` && history.phase === `first-load`)
          reach.reach(`a truncate that keeps the Collection loading`)
        expect(
          {
            rows: rowsOf(collection.toArray),
            status: collection.status,
            reload:
              history.phase === `reload`
                ? reloadState.completed
                  ? `completed`
                  : `pending`
                : `none`,
          },
          `${name}: after ${step}`,
        ).toEqual(model[index])
      }
      expect(rowsOf(store.rows.values()), `${name}: durable rows`).toEqual(
        model.at(-1)!.rows,
      )
      historiesRan++
    } finally {
      consoleError.mockRestore()
      await collection.cleanup().catch(() => undefined)
    }
  })
})

declareOracle({ model: [expected], grammar: [histories] })
