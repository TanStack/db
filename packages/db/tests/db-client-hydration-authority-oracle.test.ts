import { describe, expect, it } from 'vitest'
import { DbClient, collectionOptions } from '../src'
import type { Collection, SyncConfig } from '../src'
import type { ChangeMessage } from '../src/types'

/**
 * # Can a hydration seed supersede applied adapter work?
 *
 * A hydration chunk seeds rows that the sync adapter has not established. An
 * adapter insert, update, or delete is authoritative for its key, even when an
 * older hydration chunk arrives later. An adapter truncate is authoritative
 * for the whole source snapshot. A separate, untouched key may still receive
 * hydration rows.
 *
 * The reference scans a declarative history for each key: the last adapter
 * decision affecting that key wins; without one, the latest seed wins. It does
 * not use Collection's queued projection or hydration classifier. The bounded
 * grammar crosses four adapter decisions with hydration before, after, or on
 * both sides of their applied receipt. It also crosses delete/reinsert,
 * insert/delete, and truncate/reinsert histories. The driver uses DbClient initialData,
 * a real sync transaction, and applyCollectionChunk. At each completed action
 * it compares the complete retained source, public rows, and change-message
 * mirror with the reference. Each callback also checks mirror/public agreement.
 *
 * This owner covers one or two immediately applied adapter transactions, three
 * keys, and at most two hydration chunks. The state-retention oracle and focused
 * DbClient tests own queued transactions and cancellation. This test does not
 * establish provider transport order or a later authoritative hydration epoch.
 */

type Row = { id: string; name: string }
type AdapterDecision = `insert` | `update` | `delete` | `truncate`
type HydrationOrder = `before` | `after` | `both`
type SyncActions = Parameters<SyncConfig<Row, string>[`sync`]>[0]
type HistoryAction =
  | { kind: `hydrate`; rows: ReadonlyArray<Row> }
  | { kind: `adapter`; decision: `insert` | `update`; row: Row }
  | { kind: `adapter`; decision: `delete` | `truncate` }

const target = `1`
const peer = `2`
const newKey = `3`

function initialRows(decision: AdapterDecision): Array<Row> {
  const rows: Array<Row> = [{ id: peer, name: `initial-peer` }]
  if (decision !== `insert`) rows.push({ id: target, name: `initial-target` })
  return rows
}

function hydrationRows(stage: `before` | `after`): Array<Row> {
  return [
    { id: target, name: `${stage}-target` },
    { id: peer, name: `${stage}-peer` },
    { id: newKey, name: `${stage}-new` },
  ]
}

function adapterAction(decision: AdapterDecision): HistoryAction {
  if (decision === `insert` || decision === `update`)
    return {
      kind: `adapter`,
      decision,
      row: { id: target, name: `adapter-${decision}` },
    }
  return {
    kind: `adapter`,
    decision,
  }
}

/** Recompute each key's strongest decision from the declared history. */
function referenceRows(
  initial: ReadonlyArray<Row>,
  history: ReadonlyArray<HistoryAction>,
): Array<Row> {
  const keys = new Set([
    ...initial.map((row) => row.id),
    ...history.flatMap((action) =>
      action.kind === `hydrate`
        ? action.rows.map((row) => row.id)
        : action.decision === `insert` || action.decision === `update`
          ? [action.row.id]
          : action.decision === `delete`
            ? [target]
            : [],
    ),
  ])
  const rows: Array<Row> = []

  for (const key of keys) {
    let decidedByAdapter = false
    for (let index = history.length - 1; index >= 0; index--) {
      const action = history[index]!
      if (action.kind !== `adapter`) continue
      if (action.decision === `truncate`) {
        decidedByAdapter = true
        break
      }
      if (action.decision === `delete`) {
        if (key !== target) continue
        decidedByAdapter = true
        break
      }
      if (`row` in action && key === action.row.id) {
        decidedByAdapter = true
        rows.push(action.row)
        break
      }
    }
    if (decidedByAdapter) continue

    for (let index = history.length - 1; index >= -1; index--) {
      const action = history[index]
      const seedRows =
        index === -1 ? initial : action?.kind === `hydrate` ? action.rows : []
      const seed = seedRows.find((row) => row.id === key)
      if (seed) {
        rows.push(seed)
        break
      }
    }
  }
  return rows.sort((left, right) => left.id.localeCompare(right.id))
}

function observedRows(rows: Iterable<Row>): Array<Row> {
  return [...rows]
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function applyAdapterDecision(
  sync: SyncActions,
  decision: AdapterDecision,
): ReturnType<SyncActions[`commit`]> {
  sync.begin()
  switch (decision) {
    case `insert`:
    case `update`:
      sync.write({
        type: decision,
        value: { id: target, name: `adapter-${decision}` },
      })
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
): Promise<void> {
  let sync!: SyncActions
  const initial = initialRows(decisions[0]!)
  const client = new DbClient()
  const descriptor = collectionOptions<Row, string>({
    id: `hydration-authority-${decisions.join(`-`)}-${order}`,
    getKey: (row) => row.id,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.markReady()
      },
    },
  })
  const collection = client.collection(descriptor, { initialData: initial })
  const history: Array<HistoryAction> = []
  const mirror = new Map(initial.map((row) => [row.id, row]))
  const callbackSnapshots: Array<{
    mirror: Array<Row>
    publicRows: Array<Row>
  }> = []
  let subscription:
    | ReturnType<Collection<Row, string>[`subscribeChanges`]>
    | undefined
  let primaryFailure: unknown
  let hasPrimaryFailure = false

  try {
    await collection.preload()
    subscription = collection.subscribeChanges(
      (changes: Array<ChangeMessage<Row, string>>) => {
        for (const change of changes) {
          if (change.type === `delete`) mirror.delete(change.key)
          else
            mirror.set(change.key, {
              id: change.value.id,
              name: change.value.name,
            })
        }
        callbackSnapshots.push({
          mirror: observedRows(mirror.values()),
          publicRows: observedRows(collection.values()),
        })
      },
      { includeInitialState: false },
    )

    const check = () => {
      const expected = referenceRows(initial, history)
      expect(observedRows(collection._state.syncedData.values())).toEqual(
        expected,
      )
      expect(observedRows(collection.values())).toEqual(expected)
      expect(observedRows(mirror.values())).toEqual(expected)
    }
    check()

    const hydrate = (stage: `before` | `after`) => {
      const rows = hydrationRows(stage)
      client.applyCollectionChunk({
        collectionId: descriptor.id,
        rows: rows.map((row) => ({ key: row.id, value: row })),
      })
      history.push({ kind: `hydrate`, rows })
      check()
    }

    if (order !== `after`) hydrate(`before`)
    for (const decision of decisions) {
      const receipt = applyAdapterDecision(sync, decision)
      await receipt
      history.push(adapterAction(decision))
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

describe(`DbClient hydration authority oracle`, () => {
  const cases: Array<{
    decisions: ReadonlyArray<AdapterDecision>
    label: string
    order: HydrationOrder
  }> = ([`insert`, `update`, `delete`, `truncate`] as const).flatMap(
    (decision) =>
      ([`before`, `after`, `both`] as const).map((order) => ({
        decisions: [decision],
        label: decision,
        order,
      })),
  )
  cases.push(
    ...([`delete,insert`, `insert,delete`, `truncate,insert`] as const).map(
      (label) => ({
        decisions: label.split(`,`) as Array<AdapterDecision>,
        label,
        order: `after` as const,
      }),
    ),
  )

  it(`reaches applied delete and truncate with late hydration`, () => {
    expect(cases).toContainEqual({
      decisions: [`delete`],
      label: `delete`,
      order: `after`,
    })
    expect(cases).toContainEqual({
      decisions: [`truncate`],
      label: `truncate`,
      order: `after`,
    })
    expect(
      referenceRows(initialRows(`delete`), [
        adapterAction(`delete`),
        { kind: `hydrate`, rows: hydrationRows(`after`) },
      ]),
    ).toEqual([
      { id: peer, name: `after-peer` },
      { id: newKey, name: `after-new` },
    ])
  })

  it.each(cases)(
    `keeps $label authoritative with hydration $order its receipt`,
    async ({ decisions, order }) => runHistory(decisions, order),
  )
})
