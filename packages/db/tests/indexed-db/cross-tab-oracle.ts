/**
 * Independent cross-tab publication model.
 *
 * The durable ledger contains authored values. Each Collection has its own
 * public snapshot: persistence in A does not make a queued notification visible
 * in B. A notification causes a new read, so its expected values are selected
 * from the ledger at the read's permitted transaction order, not from its old
 * authoring payload or any observed production row.
 *
 * The concurrent-read grammar admits reads after all preceding writes finish,
 * holds them behind one native transaction, dispatches several receivers, then
 * releases them. All reads in this window see the same durable snapshot. Their
 * completion/publication order is unspecified. The reference enumerates subsets
 * of whole read effects and requires ONE increasing subset history explaining
 * every public snapshot. A multi-row effect cannot be split into partial rows.
 * Coalescing and no-op effects are allowed. Raw delta semantics are checked
 * before reduction so duplicate inserts or wrong previous values remain visible.
 *
 * This deliberately bounded model does not specify reads straddling concurrent
 * same-key writes, optimistic acknowledgement, or crash durability. Settlement
 * and the core optimistic-history owner retain those distinct responsibilities.
 */
export type OracleRow = { id: string | number; name: string; optional?: number }
export type Change = {
  rows: Array<OracleRow>
  deletes: Array<string | number>
  replace: boolean
}
export type RawChange = {
  key: string | number
  type: 'insert' | 'update' | 'delete'
  value: OracleRow
  previousValue?: OracleRow
}
export type Publication = { changes: Array<RawChange>; rows: Array<OracleRow> }

export class OracleMismatch extends Error {
  constructor(
    readonly law: string,
    readonly checkpoint: string,
    readonly expected: unknown,
    readonly actual: unknown,
  ) {
    super(
      `${law} at ${checkpoint}: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`,
    )
  }
}

// Preserve extra user fields and typed keys. Only the five virtual Collection
// fields are outside this row-value domain. Optional absent/undefined are equal.
export function plain(row: OracleRow): OracleRow {
  const {
    $key: _key,
    $origin: _origin,
    $hasPendingWrites: _pending,
    $synced: _synced,
    $collectionId: _id,
    ...value
  } = row as OracleRow & Record<string, unknown>
  return value
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    )
  return value
}
export function equal(left: unknown, right: unknown) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}
export function snapshot(rows: Iterable<OracleRow>): Array<OracleRow> {
  return [...rows]
    .map((row) => structuredClone(plain(row)))
    .sort((a, b) => JSON.stringify(a.id).localeCompare(JSON.stringify(b.id)))
}
export function assertSnapshot(
  actual: Iterable<OracleRow>,
  expected: Iterable<OracleRow>,
  checkpoint: string,
) {
  const observed = snapshot(actual),
    wanted = snapshot(expected)
  if (!equal(observed, wanted))
    throw new OracleMismatch('public rows', checkpoint, wanted, observed)
}
export function apply(
  rows: Array<OracleRow>,
  change: Change,
): Array<OracleRow> {
  const written = new Set(change.rows.map((row) => row.id))
  const removed = new Set(change.deletes)
  return snapshot([
    ...(change.replace
      ? []
      : rows.filter((row) => !written.has(row.id) && !removed.has(row.id))),
    ...change.rows,
  ])
}
export function readEffect(
  durable: Array<OracleRow>,
  authored: Change,
): Change {
  if (authored.replace)
    return { rows: snapshot(durable), deletes: [], replace: true }
  const keys = new Set([
    ...authored.rows.map((row) => row.id),
    ...authored.deletes,
  ])
  return {
    rows: snapshot(durable.filter((row) => keys.has(row.id))),
    deletes: [...keys].filter((key) => durable.every((row) => row.id !== key)),
    replace: false,
  }
}

/** Per-Collection views are separate from the global authored durable ledger. */
export class CrossTabModel {
  durable: Array<Array<OracleRow>>
  publicSnapshots: Array<Array<OracleRow>>
  constructor(
    readonly stores: Array<number>,
    initial: Array<Array<OracleRow>>,
  ) {
    this.durable = initial.map(snapshot)
    this.publicSnapshots = stores.map((store) => snapshot(initial[store]!))
  }
  accept(tab: number, change: Change) {
    const store = this.stores[tab]!
    this.durable[store] = apply(this.durable[store]!, change)
    this.publicSnapshots[tab] = apply(this.publicSnapshots[tab]!, change)
  }
  receive(tab: number, effects: Array<Change>) {
    this.publicSnapshots[tab] = effects.reduce(
      apply,
      this.publicSnapshots[tab]!,
    )
  }
  restore(tab: number) {
    this.publicSnapshots[tab] = snapshot(this.durable[this.stores[tab]!]!)
  }
}

export function assertStatuses(
  statuses: Array<string>,
  allowed: Array<string>,
  checkpoint: string,
) {
  for (const status of statuses)
    if (!allowed.includes(status))
      throw new OracleMismatch(
        'Collection status',
        checkpoint,
        allowed,
        statuses,
      )
}

export function assertPublicationHistory(
  before: Array<OracleRow>,
  trace: Array<Publication>,
  effects: Array<Change>,
  checkpoint: string,
) {
  // Repeated identical reads have the same atomic effect. Deduplication here is
  // a reference-state reduction; raw observed events below are never deduplicated.
  const unique = effects.filter(
    (effect, index) =>
      effects.findIndex((other) => equal(effect, other)) === index,
  )
  if (unique.length > 8)
    throw new Error('Read window exceeds the declared eight-effect bound')
  const all = (1 << unique.length) - 1
  const states = Array.from({ length: all + 1 }, (_, mask) =>
    unique.reduce(
      (rows, effect, index) =>
        mask & (1 << index) ? apply(rows, effect) : rows,
      snapshot(before),
    ),
  )
  let possible = [0]
  let replica = snapshot(before)
  for (const [index, publication] of trace.entries()) {
    for (const change of publication.changes) {
      const previous = replica.find((row) => row.id === change.key)
      const valid =
        change.key === change.value.id &&
        (change.type === 'insert'
          ? previous === undefined
          : previous !== undefined &&
            (change.type === 'delete' || change.previousValue !== undefined) &&
            equal(
              plain(
                change.type === 'delete' ? change.value : change.previousValue!,
              ),
              previous,
            ))
      if (!valid)
        throw new OracleMismatch(
          'event semantics',
          `${checkpoint} event ${index}`,
          previous,
          change,
        )
      replica = apply(replica, {
        rows: change.type === 'delete' ? [] : [change.value],
        deletes: change.type === 'delete' ? [change.key] : [],
        replace: false,
      })
    }
    assertSnapshot(
      publication.rows,
      replica,
      `${checkpoint} callback snapshot ${index}`,
    )
    const next = states.flatMap((rows, mask) =>
      equal(rows, snapshot(publication.rows)) &&
      possible.some((prior) => (mask & prior) === prior)
        ? [mask]
        : [],
    )
    if (!next.length)
      throw new OracleMismatch(
        'atomic publication',
        `${checkpoint} publication ${index}`,
        states,
        publication.rows,
      )
    possible = next
  }
  assertSnapshot(replica, states[all]!, `${checkpoint} terminal publication`)
}

export type ReplayRecord = {
  inputReconstructed: boolean
  premiseReached: boolean
  sameFailure: boolean
}
export function assertReplay(record: ReplayRecord) {
  if (
    !record.inputReconstructed ||
    !record.premiseReached ||
    !record.sameFailure
  )
    throw new OracleMismatch(
      'failure replay',
      'original law and checkpoint',
      { inputReconstructed: true, premiseReached: true, sameFailure: true },
      record,
    )
}
