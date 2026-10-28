import { describe, expect, it } from 'vitest'
import { DbClient, collectionOptions } from '../src'
import { declareOracle } from './oracle-declaration.js'
import type { Collection, SyncConfig } from '../src'
import type { ChangeMessage } from '../src/types'

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
 * Pinned reference cases (not run against production) cover the equal
 * re-insert, clarification (b) in both arrival orders, a metadata-less latest
 * seed, and a metadata-only write held against a later seed. The reference
 * throws on an insert that differs from a row the source wrote; the grammar
 * never produces that history.
 *
 * Limits: this owner covers one or two immediately applied adapter
 * transactions, all of them on the target key, three keys, and at most two
 * hydration chunks. A source insert over a source-written row appears only in
 * the pinned reference cases. `initialData` carries no metadata. The
 * state-retention oracle and focused DbClient tests own queued transactions and
 * cancellation. This test does not establish provider transport order or a
 * later authoritative hydration epoch.
 */

type Row = { id: string; name: string; seeded?: string }
type Metadata = { source: string }
type RowUpdateMode = `partial` | `full`
type SeedRow = { value: Row; metadata?: Metadata }
type SyncActions = Parameters<SyncConfig<Row, string>[`sync`]>[0]
type HydrationOrder = `before` | `after` | `both`
type HydrationStage = `before` | `after`

/** Each adapter decision names its operation and whether it names metadata. */
const adapterDecisions = {
  insert: { op: `insert`, metadata: false },
  'insert+metadata': { op: `insert`, metadata: true },
  update: { op: `update`, metadata: false },
  'update+metadata': { op: `update`, metadata: true },
  metadata: { op: `metadata`, metadata: true },
  delete: { op: `delete`, metadata: false },
  truncate: { op: `truncate`, metadata: false },
} as const
type AdapterDecision = keyof typeof adapterDecisions
type AdapterAction =
  | { kind: `adapter`; op: `insert` | `update`; row: Row; metadata?: Metadata }
  | { kind: `adapter`; op: `metadata`; metadata: Metadata }
  | { kind: `adapter`; op: `delete` }
  | { kind: `adapter`; op: `truncate` }
type HistoryAction =
  { kind: `hydrate`; rows: ReadonlyArray<SeedRow> } | AdapterAction

const target = `1`
const peer = `2`
const newKey = `3`

/**
 * `initialData` is the first seed. It carries no metadata, and the target's
 * `seeded` field is one that no adapter write names.
 */
const initialRows: ReadonlyArray<SeedRow> = [
  { value: { id: peer, name: `initial-peer` } },
  { value: { id: target, name: `initial-target`, seeded: `initial` } },
]

/**
 * The early chunk carries `seeded`, a field no adapter write names. The late
 * chunk omits it, so a merge of the late chunk over the early one is visible.
 */
function hydrationRows(stage: HydrationStage): Array<SeedRow> {
  const seeded: { seeded?: string } =
    stage === `before` ? { seeded: stage } : {}
  return [
    { id: target, name: `${stage}-target` },
    { id: peer, name: `${stage}-peer` },
    { id: newKey, name: `${stage}-new` },
  ].map((value) => ({
    value: { ...value, ...seeded },
    metadata: { source: `${stage}-hydration` },
  }))
}

function adapterAction(decision: AdapterDecision): AdapterAction {
  const { op, metadata } = adapterDecisions[decision]
  if (op === `delete` || op === `truncate`) return { kind: `adapter`, op }
  if (op === `metadata`)
    return { kind: `adapter`, op, metadata: { source: `adapter-metadata` } }
  return {
    kind: `adapter`,
    op,
    row: { id: target, name: `adapter-${op}` },
    ...(metadata ? { metadata: { source: `adapter-${op}` } } : {}),
  }
}

type ObservedRow = { id: string; row: Row; metadata: Metadata | undefined }
type Slot = {
  row: Row | undefined
  rowWritten: boolean
  metadata: Metadata | undefined
  metadataWritten: boolean
}

const sameRow = (left: Row, right: Row): boolean =>
  left.id === right.id &&
  left.name === right.name &&
  left.seeded === right.seeded

/**
 * Forward fold, key by key. A source write sets the written flag of each object
 * it touches. An insert names the row and its metadata: over a row that only a
 * seed supplied it replaces both, and an insert without metadata clears the
 * metadata. Over a row the source wrote, an equal insert keeps metadata unless
 * it names some. An update merges over the current row under `partial` mode,
 * and fixes metadata only when it names it. A metadata write fixes metadata
 * alone. A delete fixes both objects as absent. A truncate fixes every key,
 * including keys that a later seed names. A seed fills each object whose flag
 * is clear, so a later seed replaces an earlier seed's object whole.
 */
function referenceRows(
  initial: ReadonlyArray<SeedRow>,
  history: ReadonlyArray<HistoryAction>,
  rowUpdateMode: RowUpdateMode,
): Array<ObservedRow> {
  const slots = new Map<string, Slot>()
  let truncated = false
  const slotOf = (key: string): Slot => {
    let slot = slots.get(key)
    if (!slot) {
      slot = {
        row: undefined,
        rowWritten: truncated,
        metadata: undefined,
        metadataWritten: truncated,
      }
      slots.set(key, slot)
    }
    return slot
  }
  const fixMetadata = (slot: Slot, metadata: Metadata | undefined): void => {
    slot.metadata = metadata
    slot.metadataWritten = true
  }
  const clear = (slot: Slot): void => {
    slot.row = undefined
    slot.rowWritten = true
    fixMetadata(slot, undefined)
  }
  const insertRow = (slot: Slot, row: Row, metadata?: Metadata): void => {
    if (slot.rowWritten && slot.row !== undefined) {
      if (!sameRow(slot.row, row))
        throw new Error(`insert over a source-written row must re-insert it`)
      if (metadata !== undefined) fixMetadata(slot, metadata)
      return
    }
    slot.row = row
    slot.rowWritten = true
    fixMetadata(slot, metadata)
  }
  const seed = (rows: ReadonlyArray<SeedRow>): void => {
    for (const { value, metadata } of rows) {
      const slot = slotOf(value.id)
      if (!slot.rowWritten) slot.row = value
      if (!slot.metadataWritten) slot.metadata = metadata
    }
  }
  const write = (action: AdapterAction): void => {
    if (action.op === `truncate`) {
      truncated = true
      for (const slot of slots.values()) clear(slot)
      return
    }
    if (action.op === `delete`) {
      clear(slotOf(target))
      return
    }
    if (action.op === `metadata`) {
      fixMetadata(slotOf(target), action.metadata)
      return
    }
    const slot = slotOf(action.row.id)
    if (action.op === `insert`) {
      insertRow(slot, action.row, action.metadata)
      return
    }
    slot.row =
      rowUpdateMode === `partial` ? { ...slot.row, ...action.row } : action.row
    slot.rowWritten = true
    if (action.metadata !== undefined) fixMetadata(slot, action.metadata)
  }

  seed(initial)
  for (const action of history) {
    if (action.kind === `hydrate`) seed(action.rows)
    else write(action)
  }
  return [...slots]
    .flatMap(([id, slot]) =>
      slot.row === undefined
        ? []
        : [{ id, row: slot.row, metadata: slot.metadata }],
    )
    .sort((left, right) => left.id.localeCompare(right.id))
}

/** Row data fields only; collection virtual props such as `$synced` are not data. */
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

declareOracle({ check: [runHistory], model: [referenceRows] })

describe(`DbClient hydration authority oracle`, () => {
  type Case = {
    decisions: ReadonlyArray<AdapterDecision>
    label: string
    order: HydrationOrder
    rowUpdateMode: RowUpdateMode
  }
  const orders: ReadonlyArray<HydrationOrder> = [`before`, `after`, `both`]
  const singles: ReadonlyArray<AdapterDecision> = [
    `insert`,
    `insert+metadata`,
    `update`,
    `update+metadata`,
    `metadata`,
    `delete`,
    `truncate`,
  ]
  // A row an update brings back after a delete keeps the metadata the delete
  // cleared: neither write leaves the metadata for a later seed.
  const pairs = [
    `delete,insert`,
    `delete,insert+metadata`,
    `delete,update`,
    `delete,update+metadata`,
    `insert,delete`,
    `truncate,insert`,
    `truncate,insert+metadata`,
  ]
  const cases: Array<Case> = ([`full`, `partial`] as const).flatMap(
    (rowUpdateMode) => [
      ...singles.flatMap((decision) =>
        orders.map((order) => ({
          decisions: [decision],
          label: decision,
          order,
          rowUpdateMode,
        })),
      ),
      ...pairs.map((label) => ({
        decisions: label.split(`,`) as Array<AdapterDecision>,
        label,
        order: `after` as const,
        rowUpdateMode,
      })),
    ],
  )

  // Seeds for the metadata law. Seed A carries `seeded` and metadata; seed B
  // carries neither `seeded` nor metadata unless a test says otherwise.
  const seedA: SeedRow = {
    value: { id: target, name: `seed-a`, seeded: `x` },
    metadata: { source: `seed-a` },
  }
  const seedB: SeedRow = {
    value: { id: target, name: `seed-b` },
    metadata: { source: `seed-b` },
  }
  const targetOf = (
    rows: ReadonlyArray<ObservedRow>,
  ): ObservedRow | undefined => rows.find((entry) => entry.id === target)
  const hydrate = (rows: ReadonlyArray<SeedRow>) => ({
    kind: `hydrate` as const,
    rows,
  })

  it(`reaches applied delete and truncate with late hydration`, () => {
    expect(cases).toContainEqual({
      decisions: [`delete`],
      label: `delete`,
      order: `after`,
      rowUpdateMode: `partial`,
    })
    expect(cases).toContainEqual({
      decisions: [`truncate`],
      label: `truncate`,
      order: `after`,
      rowUpdateMode: `partial`,
    })
    expect(
      referenceRows(
        initialRows,
        [adapterAction(`delete`), hydrate(hydrationRows(`after`))],
        `partial`,
      ),
    ).toEqual([
      {
        id: peer,
        row: { id: peer, name: `after-peer` },
        metadata: { source: `after-hydration` },
      },
      {
        id: newKey,
        row: { id: newKey, name: `after-new` },
        metadata: { source: `after-hydration` },
      },
    ])
  })

  it(`reference folds the D5 rules over pinned histories`, () => {
    const before = hydrate(hydrationRows(`before`))
    const after = hydrate(hydrationRows(`after`))

    // An insert replaces the seed's row and clears its metadata.
    expect(
      targetOf(
        referenceRows(
          initialRows,
          [before, adapterAction(`insert`)],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-insert` },
      metadata: undefined,
    })
    // A partial update merges over the seed and keeps its unnamed field and metadata.
    expect(
      targetOf(
        referenceRows(
          initialRows,
          [before, adapterAction(`update`)],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-update`, seeded: `before` },
      metadata: { source: `before-hydration` },
    })
    // An update that does not name metadata leaves the metadata open to a later seed.
    expect(
      targetOf(
        referenceRows(initialRows, [adapterAction(`update`), after], `partial`),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-update`, seeded: `initial` },
      metadata: { source: `after-hydration` },
    })
    // An update that names metadata fixes it against a later seed.
    expect(
      targetOf(
        referenceRows(
          initialRows,
          [adapterAction(`update+metadata`), after],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-update`, seeded: `initial` },
      metadata: { source: `adapter-update` },
    })
    // A metadata-only write fixes the metadata and leaves the row to a later seed.
    expect(
      targetOf(
        referenceRows(
          initialRows,
          [adapterAction(`metadata`), after],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `after-target` },
      metadata: { source: `adapter-metadata` },
    })
    // The latest seed wins for a key no adapter write has written.
    expect(
      referenceRows(initialRows, [before, after], `partial`).find(
        (entry) => entry.id === peer,
      ),
    ).toEqual({
      id: peer,
      row: { id: peer, name: `after-peer` },
      metadata: { source: `after-hydration` },
    })
  })

  it(`reference keeps the metadata of an equal re-insert of a source-written row`, () => {
    expect(
      targetOf(
        referenceRows(
          [seedA],
          [adapterAction(`insert+metadata`), adapterAction(`insert`)],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-insert` },
      metadata: { source: `adapter-insert` },
    })
    // The clear applies only over seed-only rows, so an unequal re-insert is
    // outside the grammar and the reference refuses it.
    expect(() =>
      referenceRows(
        [seedA],
        [
          adapterAction(`insert`),
          { kind: `adapter`, op: `insert`, row: { id: target, name: `other` } },
        ],
        `partial`,
      ),
    ).toThrow(`insert over a source-written row must re-insert it`)
  })

  it(`reference lets seed B supply metadata when a partial update wrote only row data`, () => {
    // Seed A's `seeded` survives the partial merge; B supplies only the metadata.
    expect(
      targetOf(
        referenceRows(
          [seedA],
          [adapterAction(`update`), hydrate([seedB])],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-update`, seeded: `x` },
      metadata: { source: `seed-b` },
    })
    // The update's metadata is the source's, so B's metadata is ignored.
    expect(
      targetOf(
        referenceRows(
          [seedA],
          [adapterAction(`update+metadata`), hydrate([seedB])],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-update`, seeded: `x` },
      metadata: { source: `adapter-update` },
    })
  })

  it(`reference merges a partial update over the later seed when both seeds arrive first`, () => {
    // Seed B replaces A's row whole, so the update's merge base has no `seeded`.
    expect(
      targetOf(
        referenceRows(
          [seedA],
          [hydrate([seedB]), adapterAction(`update`)],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `adapter-update` },
      metadata: { source: `seed-b` },
    })
  })

  it(`reference leaves metadata absent when the latest seed names none`, () => {
    expect(
      targetOf(
        referenceRows([seedA], [hydrate([{ value: seedB.value }])], `partial`),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `seed-b` },
      metadata: undefined,
    })
  })

  it(`reference holds a metadata-only write against a later seed`, () => {
    expect(
      targetOf(
        referenceRows(
          [seedA],
          [adapterAction(`metadata`), hydrate([seedB])],
          `partial`,
        ),
      ),
    ).toEqual({
      id: target,
      row: { id: target, name: `seed-b` },
      metadata: { source: `adapter-metadata` },
    })
  })

  it.each(cases)(
    `keeps $label authoritative with hydration $order its receipt in $rowUpdateMode mode`,
    async ({ decisions, order, rowUpdateMode }) =>
      runHistory(decisions, order, rowUpdateMode),
  )

  // Both seeds carry the same row fields, so the row check cannot tell a whole
  // replacement from a merge; only the metadata distinguishes them.
  it(`keeps metadata absent when the latest seed names none, in production`, () => {
    const row = { id: target, name: `seed`, seeded: `initial` }
    return runHistory([], `both`, `partial`, (stage) =>
      stage === `before`
        ? [{ value: row, metadata: { source: `early-seed` } }]
        : [{ value: row }],
    )
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

declareOracle({
  check: [expectAcceptedSeedRow, expectInterleavedRows],
  model: [expectedInterleavedRows, expectedAcceptedSeedRow],
})

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

  it.each(interleavings)(
    `accepts a chunk with persisting=$persisting and source $source writing $sourceKey`,
    async (history) => {
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
      const collection = client.collection(descriptor) as Collection<
        Row,
        string
      >
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
    },
  )
})
