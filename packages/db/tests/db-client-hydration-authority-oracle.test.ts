import { describe, expect } from 'vitest'
import { DbClient, collectionOptions } from '../src'
import { oracleProperty } from './oracle-config'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter.js'
import {
  adapterAction,
  cases,
  hydrationRows,
  initialRows,
  referenceRows,
  target,
} from './db-client-hydration-authority-model-oracle.js'
import type { Collection, SyncConfig } from '../src'
import type { ChangeMessage } from '../src/types'
import type {
  AdapterAction,
  AdapterDecision,
  HistoryAction,
  HydrationOrder,
  HydrationStage,
  Metadata,
  ObservedRow,
  Row,
  RowUpdateMode,
  SeedRow,
} from './db-client-hydration-authority-model-oracle.js'

/**
 * # Can a hydration seed supersede applied adapter work?
 *
 * A hydration seed sits beneath every source (adapter) write. It supplies only
 * the objects that no surviving adapter write has written, whatever the order
 * of arrival. Decision D5 in
 * docs/contributing/oracle-reviews/2026-10-22-sync-metadata-session.md and the
 * "Initial Data" contract in docs/guides/ssr.md state this law. Row data and
 * row metadata are separate objects, and each has its own written flag:
 *
 * - An adapter insert names the whole row and its metadata. Over a row that
 *   only a seed supplied, it replaces the row without a duplicate-key error,
 *   and an insert without metadata clears the seed's metadata. An insert equal
 *   to a row the source itself wrote is an equal re-insert and keeps metadata.
 * - An adapter update merges over the row before it, a seed included, under
 *   `partial` mode, and replaces the row under `full` mode. It fixes the row
 *   data, and it fixes the metadata only when it names metadata.
 * - An adapter metadata write sets a row's metadata and writes no row data. It
 *   fixes the metadata, so a later seed cannot supply it. A later seed still
 *   supplies the row data, because the source never wrote the row.
 * - An adapter delete removes its key, and an adapter truncate removes the
 *   whole snapshot. Each fixes the affected objects as absent, and a later seed
 *   does not resurrect a removed key.
 * - Clarification (b): once a surviving source write has written a row's data,
 *   a later seed is ignored for that row's data. A partial update merges over
 *   the row as it stood when the update applied, a seed included, so only a
 *   partial update's merge base depends on arrival order. Metadata follows the
 *   same rule per object: a later seed's metadata is ignored once the source has
 *   written that row's metadata, explicitly, by an insert's implicit clear, or
 *   by a delete or truncate. A seed still supplies metadata when the source
 *   wrote only the row's data, for example through an update without metadata.
 * - Among seeds of an object that no surviving source write has written, the
 *   latest seed wins whole. A later seed without metadata leaves the metadata
 *   absent. `initialData` is the first seed and carries no metadata.
 *
 * The reference folds the declared history forward, key by key. Each object
 * (row data, row metadata) has a written flag. A source write sets the flag and
 * fixes the object; a seed fills only objects whose flag is clear. The
 * reference does not use the queued projection or the hydration classifier.
 *
 * The grammar crosses seven adapter decisions in both `full` and `partial` row
 * update modes: insert and update, each with and without metadata, a
 * metadata-only write, delete, and truncate. Hydration arrives before, after,
 * or on both sides of the adapter's applied receipt. That gives a grid of 56
 * cells (2 modes times 28): 7 single decisions times 3 hydration orders, and 7
 * two-decision histories (delete/reinsert, delete/update, insert/delete,
 * truncate/reinsert) after hydration. Each chunk row carries metadata and a field that no adapter
 * write names, `seeded`. The early chunk has `seeded`; the late chunk does not,
 * so a partial merge of the late seed over the early one would keep the stale
 * field. `initialData` gives its target `seeded: 'initial'`, so an adapter
 * insert over an `initialData` row is observable in both modes.
 *
 * The driver uses DbClient initialData, a real sync transaction, and
 * applyCollectionChunk. At each completed action it compares the synced store,
 * the public rows, the change-message mirror, and the row metadata that
 * `client.dehydrate()` reports with the reference. Each callback also checks
 * mirror/public agreement. The change-message mirror carries no metadata, so
 * metadata is observed only through dehydration.
 *
 * Fixed reference cases (not run against production) cover the equal
 * re-insert, clarification (b) in both arrival orders, a metadata-less latest
 * seed, and a metadata-only write held against a later seed. The reference
 * throws on an insert that differs from a row the source wrote; the grammar
 * never produces that history.
 *
 * Limits: this owner covers one or two immediately applied adapter
 * transactions, all of them on the target key, three keys, and at most two
 * hydration chunks. A source insert over a source-written row appears only in
 * the fixed reference cases. `initialData` carries no metadata. The
 * state-retention oracle and focused DbClient tests own queued transactions and
 * cancellation. This test does not establish provider transport order or a
 * later authoritative hydration epoch.
 *
 * The reference fold `referenceRows`, its seeds and adapter actions, and the
 * bounded `cases` grammar are in db-client-hydration-authority-model-oracle.ts,
 * which the ordinary reference tests also import.
 */

type SyncActions = Parameters<SyncConfig<Row, string>[`sync`]>[0]

/** Row data fields only; collection virtual props such as `$hasPendingWrites` are not data. */
function rowData(row: Row): Row {
  return { id: row.id, name: row.name, seeded: row.seeded }
}

function observedRows(rows: Iterable<Row>): Array<Row> {
  return [...rows]
    .map(rowData)
    .sort((left, right) => left.id.localeCompare(right.id))
}

/** Row data and metadata as `client.dehydrate()` reports them. */
function dehydratedRows(
  client: DbClient,
  collectionId: string,
): Array<ObservedRow> {
  const chunk = client
    .dehydrate()
    .collections.find((item) => item.collectionId === collectionId)
  return (chunk?.rows ?? [])
    .map((row) => ({
      id: String(row.key),
      row: rowData(row.value as Row),
      metadata: row.metadata as Metadata | undefined,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function applyAdapterAction(
  sync: SyncActions,
  action: AdapterAction,
): ReturnType<SyncActions[`commit`]> {
  sync.begin()
  switch (action.op) {
    case `insert`:
    case `update`:
      sync.write({
        type: action.op,
        value: action.row,
        ...(action.metadata === undefined ? {} : { metadata: action.metadata }),
      })
      break
    case `metadata`:
      if (!sync.metadata) throw new Error(`sync metadata API is unavailable`)
      sync.metadata.row.set(target, action.metadata)
      break
    case `delete`:
      sync.write({ type: `delete`, key: target })
      break
    case `truncate`:
      sync.truncate()
      break
  }
  return sync.commit()
}

async function runHistory(
  decisions: ReadonlyArray<AdapterDecision>,
  order: HydrationOrder,
  rowUpdateMode: RowUpdateMode,
  seedRows: (stage: HydrationStage) => ReadonlyArray<SeedRow> = hydrationRows,
): Promise<void> {
  let sync!: SyncActions
  const client = new DbClient()
  const descriptor = collectionOptions<Row, string>({
    id: `hydration-authority-${rowUpdateMode}-${decisions.join(`-`)}-${order}`,
    getKey: (row) => row.id,
    sync: {
      rowUpdateMode,
      sync: (actions) => {
        sync = actions
        actions.markReady()
      },
    },
  })
  const collection = client.collection(descriptor, {
    initialData: initialRows.map((seed) => seed.value),
  })
  const history: Array<HistoryAction> = []
  const mirror = new Map(initialRows.map((seed) => [seed.value.id, seed.value]))
  const callbackSnapshots: Array<{
    mirror: Array<Row>
    publicRows: Array<Row>
  }> = []
  let subscription:
    ReturnType<Collection<Row, string>[`subscribeChanges`]> | undefined
  let primaryFailure: unknown
  let hasPrimaryFailure = false

  try {
    await collection.preload()
    subscription = collection.subscribeChanges(
      (changes: Array<ChangeMessage<Row, string>>) => {
        for (const change of changes) {
          if (change.type === `delete`) mirror.delete(change.key)
          else mirror.set(change.key, rowData(change.value))
        }
        callbackSnapshots.push({
          mirror: observedRows(mirror.values()),
          publicRows: observedRows(collection.values()),
        })
      },
      { includeInitialState: false },
    )

    const check = () => {
      const expected = referenceRows(initialRows, history, rowUpdateMode)
      const expectedRows = expected.map((entry) => entry.row)
      expect(observedRows(collection._state.syncedData.values())).toEqual(
        expectedRows,
      )
      expect(observedRows(collection.values())).toEqual(expectedRows)
      expect(observedRows(mirror.values())).toEqual(expectedRows)
      expect(dehydratedRows(client, descriptor.id)).toEqual(expected)
    }
    check()

    const hydrate = (stage: HydrationStage) => {
      const rows = seedRows(stage)
      client.applyCollectionChunk({
        collectionId: descriptor.id,
        rows: rows.map(({ value, metadata }) => ({
          key: value.id,
          value,
          metadata,
        })),
      })
      history.push({ kind: `hydrate`, rows })
      check()
    }

    if (order !== `after`) hydrate(`before`)
    for (const decision of decisions) {
      const action = adapterAction(decision)
      await applyAdapterAction(sync, action)
      history.push(action)
      check()
    }
    if (order !== `before`) hydrate(`after`)

    for (const snapshot of callbackSnapshots)
      expect(snapshot.mirror).toEqual(snapshot.publicRows)
  } catch (error) {
    primaryFailure = error
    hasPrimaryFailure = true
  }

  const cleanupFailures: Array<unknown> = []
  try {
    subscription?.unsubscribe()
  } catch (error) {
    cleanupFailures.push(error)
  }
  try {
    await client.cleanup()
  } catch (error) {
    cleanupFailures.push(error)
  }
  if (hasPrimaryFailure && cleanupFailures.length > 0)
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures],
      `Hydration authority and cleanup both failed`,
      { cause: primaryFailure },
    )
  if (hasPrimaryFailure) throw primaryFailure
  if (cleanupFailures.length > 0)
    throw new AggregateError(cleanupFailures, `Hydration cleanup failed`, {
      cause: cleanupFailures[0],
    })
}

// Both seeds carry the same row fields, so the row check cannot tell a whole
// replacement from a merge; only the metadata distinguishes them.
function runAbsentLatestSeedMetadataHistory(): Promise<void> {
  const row = { id: target, name: `seed`, seeded: `initial` }
  return runHistory([], `both`, `partial`, (stage) =>
    stage === `before`
      ? [{ value: row, metadata: { source: `early-seed` } }]
      : [{ value: row }],
  )
}

describe(`DbClient hydration authority oracle`, () => {
  // What this oracle owns: the gap report judges DbClient.collection and
  // DbClient.applyCollectionChunk by this file's hydration histories.
  oracleProperty({
    id: `db-client-hydration.authority`,
    law: {
      statement: `An adapter write is authoritative over hydration in either arrival order: at each completed action the synced store, the public rows, the change-message mirror, and the dehydrated row metadata equal the reference fold.`,
      authority: `The D5 hydration authority rules stated above`,
      limits: `One or two immediately applied adapter transactions on the target key, three keys, and at most two hydration chunks, in full and partial row-update modes.`,
    },
    owns: [
      `src/client.ts#DbClient.collection`,
      `src/client.ts#DbClient.applyCollectionChunk`,
    ],
    histories: cases,
    label: ({ label, order, rowUpdateMode }) =>
      `keeps ${label} authoritative with hydration ${order} its receipt in ${rowUpdateMode} mode`,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`hydration authority`, plan, observe, () =>
        runHistory(
          plan.history.decisions,
          plan.history.order,
          plan.history.rowUpdateMode,
        ),
      ),
    check: forwardAssertionJudgment,
  })

  const absentLatestSeedMetadataHistories = [
    {
      name: `keeps metadata absent when the latest seed names none, in production`,
    },
  ]
  oracleProperty({
    id: `db-client-hydration.absent-seed-metadata`,
    law: {
      statement: `When the latest seed names no metadata, the row keeps no metadata, so a whole replacement is distinguished from a merge.`,
      authority: `The D5 hydration authority rules stated above`,
      limits: `One fixed history with two seeds of the same row fields and no adapter write; the generated grammar's hydration chunks always carry metadata.`,
    },
    owns: [
      `src/client.ts#DbClient.collection`,
      `src/client.ts#DbClient.applyCollectionChunk`,
    ],
    histories: absentLatestSeedMetadataHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`absent seed metadata`, plan, observe, () =>
        runAbsentLatestSeedMetadataHistory(),
      ),
    check: forwardAssertionJudgment,
  })
})

/**
 * # Is a hydration chunk accepted while other work is pending?
 *
 * A hydration chunk is a sync transaction the client accepts at once. While a
 * mutation persists, its rows are accepted but held: readers of accepted
 * rows, such as Query Collection direct writes, see them at once, and they
 * publish when the mutation settles. A chunk never becomes the target of a
 * source's still-open transaction: that source's `commit()` commits its own
 * writes. The reference is the union of seed and source rows, in the order
 * their transactions were accepted. The bounded grammar crosses an optional
 * persisting mutation with a source transaction that is absent, opened before
 * the chunk, or begun after it, and a source write that names the seeded key
 * or another key. The three review probes are cases of this grammar:
 * persisting with no source, persisting with a source insert of the seeded
 * key after the chunk, and persisting with a source transaction open before
 * the chunk.
 */
type Interleaving = {
  persisting: boolean
  source: `none` | `open-before-chunk` | `after-chunk`
  sourceKey: `seed` | `other`
}

// Reference: the seed row, then the source row; a later write to the same
// key wins.
function expectedInterleavedRows({
  source,
  sourceKey,
}: Interleaving): Array<Row> {
  const rows = new Map<string, Row>([[`seed`, { id: `seed`, name: `seed` }]])
  if (source !== `none`) rows.set(sourceKey, { id: sourceKey, name: `source` })
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id))
}

// The model: an accepted reader sees the source's staged write for the seed
// key only when that transaction was opened before the chunk and names it.
function expectedAcceptedSeedRow(history: Interleaving): Row {
  return history.source === `open-before-chunk` && history.sourceKey === `seed`
    ? { id: `seed`, name: `source` }
    : { id: `seed`, name: `seed` }
}

// The check: accepted readers and the settled publication match the model.
function expectAcceptedSeedRow(accepted: unknown, history: Interleaving): void {
  expect(accepted, `accepted readers see the chunk`).toEqual(
    expectedAcceptedSeedRow(history),
  )
}

function expectInterleavedRows(
  rows: ReadonlyArray<Row>,
  history: Interleaving,
): void {
  expect(rows).toEqual(expectedInterleavedRows(history))
}

async function runInterleavingCase(history: Interleaving): Promise<void> {
  let sync!: SyncActions
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const descriptor = collectionOptions<Row, string>({
    id: `db-client-interleaving-${history.persisting}-${history.source}-${history.sourceKey}`,
    getKey: (row) => row.id,
    sync: {
      sync: (params) => {
        sync = params
        params.markReady()
      },
    },
    onInsert: () => held,
  })
  const client = new DbClient()
  const collection = client.collection(descriptor) as Collection<Row, string>
  try {
    await collection.preload()
    const mutation = history.persisting
      ? collection.insert({ id: `local`, name: `local` })
      : undefined
    const sourceRow = {
      id: history.sourceKey,
      name: `source`,
    }
    if (history.source === `open-before-chunk`) {
      sync.begin()
      sync.write({ type: `insert`, value: sourceRow })
    }
    client.applyCollectionChunk({
      collectionId: collection.id,
      rows: [{ key: `seed`, value: { id: `seed`, name: `seed` } }],
    })
    // The accepted-row view also includes an open transaction's staged
    // writes, which follow the chunk in commit order.
    expectAcceptedSeedRow(
      collection._state.getAcceptedSyncedRow(`seed`),
      history,
    )
    if (history.source === `after-chunk`) {
      sync.begin()
      sync.write({ type: `insert`, value: sourceRow })
    }
    if (history.source !== `none`) {
      const receipt = sync.commit()
      void Promise.resolve(receipt).catch(() => undefined)
    }
    release()
    await mutation?.when('settled').catch(() => undefined)
    expectInterleavedRows(
      observedRows(collection.values()).filter((row) => row.id !== `local`),
      history,
    )
  } finally {
    release()
    await collection.cleanup()
  }
}

describe(`DbClient hydration interleaving oracle`, () => {
  const interleavings: Array<Interleaving> = [false, true].flatMap(
    (persisting) =>
      ([`none`, `open-before-chunk`, `after-chunk`] as const).flatMap(
        (source) =>
          ([`seed`, `other`] as const).map((sourceKey) => ({
            persisting,
            source,
            sourceKey,
          })),
      ),
  )

  oracleProperty({
    id: `db-client-hydration.interleaving`,
    law: {
      statement: `A hydration chunk is accepted at once while other work is pending: accepted readers see the seed row or an earlier open source transaction's staged write, and the settled rows are the union of seed and source rows in acceptance order.`,
      authority: `The hydration chunk acceptance contract stated above`,
      limits: `The bounded grammar of an optional persisting mutation crossed with a source transaction that is absent, opened before the chunk, or begun after it, writing the seeded key or another key.`,
    },
    owns: [
      `src/client.ts#DbClient.collection`,
      `src/client.ts#DbClient.applyCollectionChunk`,
    ],
    histories: interleavings,
    label: ({ persisting, source, sourceKey }) =>
      `accepts a chunk with persisting=${persisting} and source ${source} writing ${sourceKey}`,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`hydration interleaving`, plan, observe, () =>
        runInterleavingCase(plan.history),
      ),
    check: forwardAssertionJudgment,
  })
})
