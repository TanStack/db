import { fc } from '@fast-check/vitest'

/**
 * # What does a sync source read back, and what do consumers see?
 *
 * A sync function writes rows and metadata through `begin`, `write`,
 * `metadata.row`, `metadata.collection`, `truncate`, and `commit`. This oracle
 * judges what the same sync run reads back through `metadata.row.get`,
 * `metadata.collection.get`, and `metadata.collection.list`, and which rows
 * consumers see through `collection.base`.
 *
 * ## The borrowed laws
 *
 * The contract borrows standard consistency theory. One sync run is one
 * session. Every sync transaction is an independent transaction, including
 * one begun while another is open. The API has no transaction handle, so
 * `write`, `truncate`, `commit`, and abort act on the innermost open
 * transaction.
 *
 * - Commit order. A transaction's writes take effect together at its commit,
 *   so accepted transactions apply in commit order, each transaction's
 *   writes in issue order. Each key holds one current value, the last write
 *   in that order (Terry et al. 1994, §3.4, monotonic writes, with commit as
 *   a transaction's write time).
 * - Read your writes (Terry §3.1) and own reads (Adya 1999, §3.1.2): a read
 *   includes every accepted write of the session and every write of its
 *   open transactions, in serialization order: accepted transactions in
 *   commit order, then the open transactions in begin order. The innermost
 *   transaction's own writes therefore win. An inner transaction commits
 *   before the transactions it began inside, so once it commits, their open
 *   writes are ordered after its writes. A read can then change from the
 *   inner write to an outer one without a new write. The set of writes it
 *   includes still only grows (monotonic reads, Terry §3.2), except at an abort.
 * - A held accepted transaction is still the session's write. A persisting
 *   optimistic transaction delays when consumers see it, never what the
 *   source reads.
 * - Aborts: an abort discards only the aborted transaction's writes. A
 *   transaction committed inside it stays accepted. An inner transaction
 *   reads the open writes of the transactions it began inside, so an outer
 *   abort can leave a committed transaction that read an aborted write
 *   (Adya's G1a). The maintainer accepted these reads with independent
 *   transactions; the oracle does not judge what an inner transaction wrote
 *   because of them.
 * - Atomic visibility (Bailis et al. 2014, monotonic atomic view): consumers
 *   see each transaction all at once.
 * - Applied receipts (`SyncConfig.commit`): a receipt settles when its
 *   transaction applies.
 * - Seeds come from another writer. A hydration seed is a snapshot older than
 *   every source write (Thomas's write rule). Row data and row metadata are
 *   separate objects. Once a committed source write has written an object
 *   (an insert, update, delete, or truncate for row data; an explicit write,
 *   an insert's implicit clear, a delete, or a truncate for metadata), a
 *   seed that arrives later is ignored for that object. A seed that arrives
 *   while the source's transaction is open sits beneath that transaction,
 *   as the maintainer's answer on an open insert ("seeds are older") put it. A source insert
 *   names the whole row and its metadata: it replaces a seeded row, without
 *   a duplicate-key error, and an insert without metadata clears the seed's
 *   metadata. A source update merges over the row as it stands when the
 *   update is written, a seed included, so only a partial update's merge
 *   base depends on arrival order. An insert equal to a row the source itself
 *   wrote is an equal re-insert and keeps its metadata; over a row that only
 *   a seed supplied it is an insert. Among seeds of a row that no source
 *   write has written, the latest seed wins whole, metadata included
 *   (`db-client-hydration-authority-oracle.test.ts`).
 *
 * Authority: maintainer decisions of 2026-10-22 to borrow standard theory and
 * to place seeds beneath source writes (D4, D5, and its clarification "b");
 * the decision of 2026-10-23 to keep sync transactions independent, which
 * withdrew closed nesting (D2) because handler and listener write-backs
 * share the sync API with the source; the glossary
 * entries for accepted sync transactions and the exposed authoritative base;
 * and the row-metadata write rules of 2026-10-05 for implicit metadata.
 *
 * ## Limits
 *
 * The oracle does not judge `list()` order, invalidated transactions, live
 * queries, or change events. It does not generate an inner transaction's
 * row write or truncate that conflicts with an outer open transaction's row
 * writes (see the history grammar). Stale runs and writes without an open
 * transaction are fixed boundary witnesses, not generated histories. Only the
 * `seeds-full` lane uses full row updates. A source update of an absent row
 * is not a legal history (the change-message protocol), so it is not
 * generated.
 */

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

/**
 * Two source rows and five collection metadata keys separate per-key,
 * cross-key, and prefix behaviour. Two keys sit under the `gc:` prefix; `gc:`
 * equals the prefix, and `gc` is a proper prefix of it, so `list('gc:')` must
 * include the first and exclude the second. The hold is a persisting
 * optimistic insert of a fixture key that source actions never name.
 */
export const sessionRowKeys = [1, 2] as const
export const sessionCollectionKeys = [
  `cursor`,
  `gc:a`,
  `gc:b`,
  `gc:`,
  `gc`,
] as const
export const sessionPrefix = `gc:`
export type SessionRowKey = (typeof sessionRowKeys)[number]
export type SessionCollectionKey = (typeof sessionCollectionKeys)[number]

export type SessionAction =
  | { type: `begin` }
  | { type: `commit` }
  | { type: `cancel` }
  | { type: `rowSet`; key: SessionRowKey }
  | { type: `rowDelete`; key: SessionRowKey }
  | { type: `upsert`; key: SessionRowKey; metadata: boolean }
  | { type: `reinsert`; key: SessionRowKey; metadata: boolean }
  | { type: `remove`; key: SessionRowKey }
  | { type: `truncate` }
  | {
      type: `collectionSet`
      key: SessionCollectionKey
      undefinedValue?: boolean
    }
  | { type: `collectionDelete`; key: SessionCollectionKey }
  | { type: `hold`; store?: boolean }
  | { type: `release` }
  | { type: `seed`; key: SessionRowKey; narrow?: boolean; bare?: boolean }
  | { type: `insertOverSeed`; key: SessionRowKey; metadata: boolean }

/**
 * A lane fixes which actions the grammar may choose and the nesting depth.
 * `flat` histories are the issue's domain: no transaction begins while one
 * is open. `nested` histories begin transactions inside open ones. `seeds`
 * add a second writer; `seeds-full` repeats it under full row updates, and
 * `nested-seeds` crosses seeds with nested transactions. Each lane is its own
 * replay property.
 */
export type SessionLane = {
  name: string
  maxDepth: number
  seeds: boolean
  /**
   * Whether `hold` may instead hold a wrapping sync's durable step. The model
   * treats both kinds alike: neither changes what the source reads.
   */
  storeHold?: boolean
  /**
   * Whether `collectionSet` may store `undefined`. `get` cannot tell such a
   * key from an absent one, but `list()` includes it. The persisted lane
   * excludes it: stored collection metadata must be bindable.
   */
  undefinedValues?: boolean
  /**
   * Whether the Collection uses `rowUpdateMode: 'full'`. An update then
   * replaces the row instead of merging over it, so a source insert of a
   * seeded row drops the seed's other fields. Other lanes use `'partial'`.
   */
  fullRows?: boolean
}

export const flatLane: SessionLane = {
  name: `flat`,
  maxDepth: 1,
  seeds: false,
  undefinedValues: true,
}
export const nestedLane: SessionLane = {
  name: `nested`,
  maxDepth: 3,
  seeds: false,
  undefinedValues: true,
}
export const seedLane: SessionLane = {
  name: `seeds`,
  maxDepth: 1,
  seeds: true,
  undefinedValues: true,
}
export const nestedSeedLane: SessionLane = {
  name: `nested-seeds`,
  maxDepth: 3,
  seeds: true,
  undefinedValues: true,
}
export const seedFullLane: SessionLane = {
  name: `seeds-full`,
  maxDepth: 1,
  seeds: true,
  undefinedValues: true,
  fullRows: true,
}
export const persistedFlatLane: SessionLane = {
  name: `persisted-flat`,
  maxDepth: 1,
  seeds: false,
  storeHold: true,
}
export const persistedNestedLane: SessionLane = {
  name: `persisted-nested`,
  maxDepth: 3,
  seeds: false,
  storeHold: true,
}
export const persistedSeedLane: SessionLane = {
  name: `persisted-seeds`,
  maxDepth: 1,
  seeds: true,
  storeHold: true,
}

const rowKeyArbitrary = fc.constantFrom(...sessionRowKeys)
const collectionKeyArbitrary = fc.constantFrom(...sessionCollectionKeys)

/**
 * Weights favour transaction boundaries and holds, because the laws concern
 * what happens across commits: most generated writes then land inside an open
 * transaction, and most histories commit more than once during a hold.
 */
export function sessionActionArbitrary(
  lane: SessionLane,
): fc.Arbitrary<SessionAction> {
  const weighted = (
    weight: number,
    arbitrary: fc.Arbitrary<SessionAction>,
  ): fc.WeightedArbitrary<SessionAction> => ({ weight, arbitrary })
  const actions: Array<fc.WeightedArbitrary<SessionAction>> = [
    weighted(4, fc.constant({ type: `begin` as const })),
    weighted(4, fc.constant({ type: `commit` as const })),
    weighted(1, fc.constant({ type: `cancel` as const })),
    weighted(
      2,
      rowKeyArbitrary.map((key) => ({ type: `rowSet` as const, key })),
    ),
    weighted(
      1,
      rowKeyArbitrary.map((key) => ({ type: `rowDelete` as const, key })),
    ),
    weighted(
      2,
      fc
        .tuple(rowKeyArbitrary, fc.boolean())
        .map(([key, metadata]) => ({ type: `upsert` as const, key, metadata })),
    ),
    weighted(
      1,
      fc.tuple(rowKeyArbitrary, fc.boolean()).map(([key, metadata]) => ({
        type: `reinsert` as const,
        key,
        metadata,
      })),
    ),
    weighted(
      1,
      rowKeyArbitrary.map((key) => ({ type: `remove` as const, key })),
    ),
    weighted(1, fc.constant({ type: `truncate` as const })),
    weighted(
      2,
      fc
        .tuple(collectionKeyArbitrary, fc.integer({ min: 0, max: 5 }))
        .map(([key, roll]) => ({
          type: `collectionSet` as const,
          key,
          ...(lane.undefinedValues && roll === 0
            ? { undefinedValue: true }
            : {}),
        })),
    ),
    weighted(
      1,
      collectionKeyArbitrary.map((key) => ({
        type: `collectionDelete` as const,
        key,
      })),
    ),
    weighted(
      3,
      lane.storeHold
        ? fc.boolean().map((store) => ({ type: `hold` as const, store }))
        : fc.constant({ type: `hold` as const }),
    ),
    weighted(1, fc.constant({ type: `release` as const })),
  ]
  if (lane.seeds)
    actions.push(
      weighted(
        4,
        fc
          .tuple(rowKeyArbitrary, fc.boolean(), fc.integer({ min: 0, max: 3 }))
          .map(([key, narrow, roll]) => ({
            type: `seed` as const,
            key,
            narrow,
            ...(roll === 0 ? { bare: true } : {}),
          })),
      ),
      weighted(
        2,
        fc.tuple(rowKeyArbitrary, fc.boolean()).map(([key, metadata]) => ({
          type: `insertOverSeed` as const,
          key,
          metadata,
        })),
      ),
    )
  return fc.oneof(...actions)
}

export function sessionHistoryArbitrary(
  lane: SessionLane,
): fc.Arbitrary<Array<SessionAction>> {
  return fc.array(sessionActionArbitrary(lane), {
    minLength: 12,
    maxLength: 48,
    size: `medium`,
  })
}

/**
 * The regimes that a legal history reaches, read from the model as it
 * replays. The campaign reach test requires each law's premise.
 */
export function historyRegimes(
  lane: SessionLane,
  history: ReadonlyArray<SessionAction>,
): Set<string> {
  const model = new SessionModel(lane.fullRows)
  const regimes = new Set<string>()
  for (const [step, action] of history.entries()) {
    if (!isLegal(lane, model, action)) continue
    const before = { held: model.heldTransactions, depth: model.depth }
    void planAction(model, action, { s: step })(modelOnly)
    if (before.held >= 2) regimes.add(`read with two held transactions`)
    if (model.depth > 0 && model.heldTransactions >= 1)
      regimes.add(`open transaction over a held transaction`)
    if (action.type === `commit` && before.depth >= 2) {
      regimes.add(`nested commit`)
      if (model.isHolding) regimes.add(`nested commit during a hold`)
    }
    if (action.type === `cancel` && model.lastCancelKeptInnerCommit)
      regimes.add(`abort keeps an inner commit`)
    if (action.type === `truncate` && model.isHolding)
      regimes.add(`truncate during a hold`)
    if (action.type === `seed`) {
      regimes.add(`seed`)
      if (model.hasSourceInsert(action.key))
        regimes.add(`seed under a source insert`)
      if (model.hasOpenRowUpdate(action.key))
        regimes.add(`seed under an open update`)
      if (action.bare === true) regimes.add(`seed without metadata`)
    }
    if (action.type === `reinsert`) regimes.add(`equal re-insert`)
    if (action.type === `collectionSet` && action.undefinedValue === true)
      regimes.add(`undefined collection value`)
    if (action.type === `cancel`) regimes.add(`cancel`)
    if (action.type === `hold`)
      regimes.add(action.store === true ? `store hold` : `core hold`)
  }
  return regimes
}

// ---------------------------------------------------------------------------
// Independent model
// ---------------------------------------------------------------------------

/**
 * The model keeps an event log rather than transaction write sets. Every
 * source write appends one event naming its transaction frame; a frame
 * records only its status. A read places the session's writes in
 * serialization order and folds them, so the expected value follows
 * directly from the laws: accepted transactions and seeds in the order they
 * were accepted, then the open transactions in begin order, each
 * transaction's events in issue order. The last write to an object wins;
 * a seed counts only beneath every source write to its object. Production
 * instead scans queued transaction write sets. The two structures differ on
 * purpose.
 *
 * The source and consumers read different layers of the same order. The
 * source reads every accepted transaction and seed, applied or held, and its
 * open transactions, because accepted work always applies and the source's
 * session includes it. Consumers read only applied transactions and applied
 * seeds, because a hold or an open transaction delays what they see.
 */
type ObjectStore = `row` | `rowMetadata` | `collection`
type ModelValue = { present: false } | { present: true; value: unknown }
const absent: ModelValue = { present: false }

type ModelEvent =
  | { frame: number; truncate: true }
  | {
      frame: number
      truncate: false
      store: ObjectStore
      key: string | number
      value: ModelValue
      /**
       * How a row write meets the row before it. Under partial row updates an
       * `update` merges its fields over that row, a seed included. An
       * `insert`, and every write under full row updates, replaces it.
       */
      rowWrite?: `insert` | `update`
    }

type FrameStatus = `open` | `accepted` | `applied` | `aborted`
type ModelFrame = {
  status: FrameStatus
  /** Whether a transaction begun inside this one committed while it was open. */
  innerCommitted: boolean
}
type ModelSeed = {
  key: SessionRowKey
  row: unknown
  metadata: ModelValue
  applied: boolean
}
/** One step of the serialization order: a source write or a seed. */
type ModelEntry = { event: ModelEvent } | { seed: ModelSeed }

export type SessionObservation = {
  rowMetadata: Record<string, unknown>
  collection: Record<string, unknown>
  list: Array<[string, unknown]>
  prefixList: Array<[string, unknown]>
  base: Record<string, unknown>
  /**
   * Each `commit()` receipt by commit order: `applied` once its writes are
   * visible, `rejected` once they are abandoned, otherwise `pending`. A
   * receipt that `commit()` returned as `true` counts as `applied`.
   */
  receipts: Array<ReceiptState>
}

export type ReceiptState = `pending` | `applied` | `rejected`

/** Observations encode absence as this marker so `undefined` stays visible. */
export const absentMarker = `<absent>`

export class SessionModel {
  /** Under full row updates an update replaces the row. */
  constructor(private readonly fullRows = false) {}

  private events: Array<ModelEvent> = []
  private frames: Array<ModelFrame> = []
  private openStack: Array<number> = []
  /** Accepted transactions and seeds, in the order they were accepted. */
  private accepted: Array<{ frame: number } | { seed: ModelSeed }> = []
  private holding = false

  get depth(): number {
    return this.openStack.length
  }
  get isHolding(): boolean {
    return this.holding
  }
  /** Accepted transactions that have not applied. */
  get heldTransactions(): number {
    return this.accepted.filter(
      (item) =>
        `frame` in item && this.frames[item.frame]!.status !== `applied`,
    ).length
  }
  lastCancelKeptInnerCommit = false
  /** The frame each `commit()` closed, in commit order. */
  private committed: Array<number> = []

  begin(): void {
    this.frames.push({ status: `open`, innerCommitted: false })
    this.openStack.push(this.frames.length - 1)
  }

  write(store: ObjectStore, key: string | number, value: ModelValue): void {
    this.events.push({
      frame: this.innermost(),
      truncate: false,
      store,
      key,
      value,
    })
  }

  /** A source insert or update of a row's data. */
  writeRow(key: SessionRowKey, row: unknown, rowWrite: `insert` | `update`) {
    this.events.push({
      frame: this.innermost(),
      truncate: false,
      store: `row`,
      key,
      value: { present: true, value: row },
      rowWrite,
    })
  }

  /** An insert names the row's whole metadata; one without metadata clears it. */
  insertClear(key: SessionRowKey): void {
    this.write(`rowMetadata`, key, absent)
  }

  /** Whether the row is present from source writes alone, ignoring seeds. */
  sourceWroteRow(key: SessionRowKey): boolean {
    const entries = this.sessionEntries().filter((entry) => `event` in entry)
    return this.fold(`row`, key, entries).present
  }

  /**
   * Whether a transaction that the innermost one began inside has written
   * row data: any row, or `key` only, and a truncate counts for every row.
   * The grammar keeps an inner transaction's row writes and truncates apart
   * from those, so that committing first never reorders writes to one row.
   */
  enclosingWroteRows(key?: SessionRowKey): boolean {
    const enclosing = new Set(this.openStack.slice(0, -1))
    return this.events.some(
      (event) =>
        enclosing.has(event.frame) &&
        (event.truncate ||
          (event.store === `row` && (key === undefined || event.key === key))),
    )
  }

  truncate(): void {
    this.events.push({ frame: this.innermost(), truncate: true })
  }

  /** The row as the source sees it; the driver classifies inserts by it. */
  sourceRow(key: SessionRowKey): ModelValue {
    return this.fold(`row`, key, this.sessionEntries())
  }

  /**
   * Each transaction is independent. A commit accepts it, after every
   * transaction accepted before it and beneath every open one. It applies
   * at once unless a hold is active, and a transaction that truncates
   * applies at once regardless, with everything accepted before it.
   */
  commit(): void {
    const frame = this.openStack.pop()!
    for (const enclosing of this.openStack)
      this.frames[enclosing]!.innerCommitted = true
    this.committed.push(frame)
    this.frames[frame]!.status = `accepted`
    this.accepted.push({ frame })
    if (!this.holding || this.truncates(frame)) this.applyAccepted()
  }

  /** An abort discards only the innermost open transaction's own writes. */
  cancel(): void {
    const frame = this.openStack.pop()!
    this.frames[frame]!.status = `aborted`
    this.lastCancelKeptInnerCommit = this.frames[frame]!.innerCommitted
  }

  hold(): void {
    this.holding = true
  }

  release(): void {
    this.holding = false
    this.applyAccepted()
  }

  /**
   * A seed arrives after every accepted transaction but beneath the open
   * transactions, whose writes have not yet committed.
   */
  seed(key: SessionRowKey, row: unknown, metadata: ModelValue): void {
    this.accepted.push({ seed: { key, row, metadata, applied: false } })
    if (!this.holding) this.applyAccepted()
  }

  /** Whether an open transaction has updated this row. */
  hasOpenRowUpdate(key: SessionRowKey): boolean {
    const open = new Set(this.openStack)
    return this.events.some(
      (event) =>
        open.has(event.frame) &&
        !event.truncate &&
        event.rowWrite === `update` &&
        event.key === key,
    )
  }

  /** Whether a surviving source insert wrote this row. */
  hasSourceInsert(key: SessionRowKey): boolean {
    return this.sessionEntries().some(
      (entry) =>
        `event` in entry &&
        !entry.event.truncate &&
        entry.event.rowWrite === `insert` &&
        entry.event.key === key,
    )
  }

  observe(): SessionObservation {
    const session = this.sessionEntries()
    const consumers = this.consumerEntries()
    const rowMetadata: Record<string, unknown> = {}
    const base: Record<string, unknown> = {}
    for (const key of sessionRowKeys) {
      rowMetadata[key] = encode(this.fold(`rowMetadata`, key, session))
      base[key] = encode(this.fold(`row`, key, consumers))
    }
    const collection: Record<string, unknown> = {}
    const list: Array<[string, unknown]> = []
    for (const key of sessionCollectionKeys) {
      const value = this.fold(`collection`, key, session)
      // `get` returns undefined for a stored undefined; `list()` still has it.
      collection[key] =
        value.present && value.value !== undefined ? value.value : absentMarker
      if (value.present) list.push([key, value.value])
    }
    // `list()` order is not judged; drivers and the model both sort by key.
    list.sort(([a], [b]) => a.localeCompare(b))
    return {
      rowMetadata,
      collection,
      list,
      prefixList: list.filter(([key]) => key.startsWith(sessionPrefix)),
      base,
      // A receipt settles when its transaction applies (`SyncConfig.commit`).
      receipts: this.committed.map((frame) =>
        this.frames[frame]!.status === `applied` ? `applied` : `pending`,
      ),
    }
  }

  private innermost(): number {
    return this.openStack.at(-1)!
  }

  private truncates(frame: number): boolean {
    return this.events.some((event) => event.truncate && event.frame === frame)
  }

  private applyAccepted(): void {
    for (const item of this.accepted) {
      if (`frame` in item) this.frames[item.frame]!.status = `applied`
      else item.seed.applied = true
    }
  }

  private frameEntries(frame: number): Array<ModelEntry> {
    return this.events
      .filter((event) => event.frame === frame)
      .map((event) => ({ event }))
  }

  /** The source's serialization order: accepted work, then open transactions. */
  private sessionEntries(): Array<ModelEntry> {
    return [
      ...this.accepted.flatMap((item) =>
        `frame` in item ? this.frameEntries(item.frame) : [item],
      ),
      ...this.openStack.flatMap((frame) => this.frameEntries(frame)),
    ]
  }

  /** Consumers' order: applied transactions and seeds only. */
  private consumerEntries(): Array<ModelEntry> {
    return this.accepted.flatMap((item) =>
      `frame` in item
        ? this.frames[item.frame]!.status === `applied`
          ? this.frameEntries(item.frame)
          : []
        : item.seed.applied
          ? [item]
          : [],
    )
  }

  /**
   * Folds one object newest first. A seed counts only if no source write to
   * the object, or truncate, comes before it in the order.
   */
  private fold(
    store: ObjectStore,
    key: string | number,
    entries: ReadonlyArray<ModelEntry>,
    end = entries.length,
  ): ModelValue {
    for (let index = end - 1; index >= 0; index--) {
      const entry = entries[index]!
      if (`seed` in entry) {
        const seed = entry.seed
        if (
          store === `collection` ||
          seed.key !== key ||
          this.sourceWroteBefore(store, key, entries, index)
        )
          continue
        return store === `row`
          ? { present: true, value: seed.row }
          : seed.metadata
      }
      const event = entry.event
      if (event.truncate) {
        if (store !== `collection`) return absent
        continue
      }
      if (event.store !== store || event.key !== key) continue
      if (
        !this.fullRows &&
        event.rowWrite === `update` &&
        event.value.present
      ) {
        const before = this.fold(`row`, key, entries, index)
        if (before.present)
          return {
            present: true,
            value: {
              ...(before.value as object),
              ...(event.value.value as object),
            },
          }
      }
      return event.value
    }
    return absent
  }

  /** Whether a source write to the object comes before `end` in the order. */
  private sourceWroteBefore(
    store: ObjectStore,
    key: string | number,
    entries: ReadonlyArray<ModelEntry>,
    end: number,
  ): boolean {
    return entries
      .slice(0, end)
      .some(
        (entry) =>
          `event` in entry &&
          (entry.event.truncate ||
            (entry.event.store === store && entry.event.key === key)),
      )
  }
}

function encode(value: ModelValue): unknown {
  return value.present ? value.value : absentMarker
}

// ---------------------------------------------------------------------------
// Production driver contract
// ---------------------------------------------------------------------------

/**
 * A driver exercises one production path. It performs each action through
 * the public sync API and records the observation at each checkpoint. A
 * thrown error or an unexpected receipt rejection is an observation too, so
 * the comparison can report it as a law violation rather than a crash.
 */
export type SessionDriver = {
  begin: () => void
  commit: () => void
  cancel: () => void
  rowSet: (key: SessionRowKey, value: unknown) => void
  rowDelete: (key: SessionRowKey) => void
  insert: (key: SessionRowKey, value: unknown, metadata: unknown) => void
  update: (key: SessionRowKey, value: unknown, metadata: unknown) => void
  delete: (key: SessionRowKey) => void
  truncate: () => void
  collectionSet: (key: SessionCollectionKey, value: unknown) => void
  collectionDelete: (key: SessionCollectionKey) => void
  /** `store` holds a wrapping sync's next durable step instead of core. */
  hold: (store: boolean) => void
  release: () => Promise<void>
  seed?: (key: SessionRowKey, row: unknown, metadata: unknown) => void
  observe: () => SessionObservation
  /** Lets receipt continuations run before an observation. */
  flush: () => Promise<void>
  /** Ends any hold and resolves every receipt; returns unexpected rejections. */
  settle: () => Promise<Array<string>>
  /**
   * When consumers and receipts are compared. `each-step` (the default)
   * requires them at every checkpoint. `final` compares them only after
   * `settle`, for a path that applies asynchronously after its own durable
   * step; source reads are still compared at every checkpoint.
   */
  consumerCheckpoint?: `each-step` | `final`
  cleanup: () => Promise<void>
}

export type SessionMismatch = {
  step: number
  action: SessionAction | `settle`
  law: string
  expected: unknown
  actual: unknown
}

// ---------------------------------------------------------------------------
// Refinement check
// ---------------------------------------------------------------------------

/**
 * The runner applies each legal action to the model and the driver, then
 * compares the full observation at the checkpoint after the action returns.
 * Illegal actions for the current model state are skipped, so every
 * generated history is legal: `commit`, `cancel`, and writes need an open
 * transaction; `begin` respects the lane's depth; `hold` and `release`
 * alternate; `remove` and `reinsert` need the row. A seed is legal at any
 * point, including over a row the source has inserted.
 *
 * An inner transaction does not write a row, or truncate, after a
 * transaction it began inside has written that row or truncated (truncate:
 * after it has written any row). Committing first would put the inner write
 * ahead of the outer one, so the outer insert's kind could change or its
 * transaction become invalid. The row-metadata composition oracle owns those
 * histories; this one owns the reads around them.
 *
 * Implicit row metadata follows the 2026-10-05 rules. An insert names the
 * row's whole metadata, so one without `metadata` clears it; an update
 * without `metadata` keeps it; a delete clears it. An `upsert` writes a
 * fresh value, so only `reinsert` is an equal re-insert. A source insert
 * replaces a seeded row, and `reinsert` over a row that only a seed supplied
 * is an insert.
 */
export async function runSessionHistory(
  lane: SessionLane,
  history: ReadonlyArray<SessionAction>,
  createDriver: () => Promise<SessionDriver>,
): Promise<{ mismatch: SessionMismatch | undefined; steps: number }> {
  const model = new SessionModel(lane.fullRows)
  const driver = await createDriver()
  let mismatch: SessionMismatch | undefined
  let steps = 0
  let primary: unknown
  try {
    for (const [step, action] of history.entries()) {
      if (!isLegal(lane, model, action)) continue
      steps++
      const value = { s: step }
      let thrown: string | undefined
      try {
        await planAction(model, action, value)(driver)
      } catch (error) {
        thrown = describeError(error)
      }
      if (thrown !== undefined) {
        mismatch = {
          step,
          action,
          law: `legal action threw`,
          expected: `no error`,
          actual: thrown,
        }
        break
      }
      await driver.flush()
      mismatch = compare(
        step,
        action,
        model.observe(),
        driver.observe(),
        driver.consumerCheckpoint === `final`,
      )
      if (mismatch) break
    }
    if (!mismatch) {
      const rejections = await driver.settle()
      if (model.isHolding) model.release()
      while (model.depth > 0) model.cancel()
      if (rejections.length > 0)
        mismatch = {
          step: history.length,
          action: `settle`,
          law: `accepted transaction applies`,
          expected: [],
          actual: rejections,
        }
      else
        mismatch = compare(
          history.length,
          `settle`,
          model.observe(),
          driver.observe(),
        )
    }
  } catch (error) {
    primary = error
  }
  let cleanupFailure: unknown
  try {
    await driver.cleanup()
  } catch (error) {
    cleanupFailure = error ?? new Error(`cleanup failed`)
  }
  if (cleanupFailure !== undefined) {
    // A cleanup failure must not hide the oracle result it follows.
    const first =
      primary ??
      (mismatch ? new Error(describeMismatch(history, mismatch)) : undefined)
    if (first === undefined) throw cleanupFailure
    throw new AggregateError(
      [first, cleanupFailure],
      `oracle run and cleanup failed`,
      {
        cause: first,
      },
    )
  }
  if (primary !== undefined) throw primary
  return { mismatch, steps }
}

/**
 * A second formulation of hold invisibility, independent of the model. Two
 * production runs execute the same history, one with every `hold` and
 * `release` removed. The source's reads must match at each checkpoint of an
 * action both runs perform: a hold may change when consumers see writes,
 * never what the source reads. The model decides only legality, and removing
 * holds does not change which other actions are legal.
 */
export async function runHoldInvariance(
  lane: SessionLane,
  history: ReadonlyArray<SessionAction>,
  createDriver: () => Promise<SessionDriver>,
): Promise<SessionMismatch | undefined> {
  const held = await createDriver()
  const unheld = await createDriver()
  const model = new SessionModel(lane.fullRows)
  let mismatch: SessionMismatch | undefined
  try {
    for (const [step, action] of history.entries()) {
      if (!isLegal(lane, model, action)) continue
      const value = { s: step }
      let thrown: string | undefined
      try {
        const call = planAction(model, action, value)
        await call(held)
        if (action.type !== `hold` && action.type !== `release`)
          await call(unheld)
      } catch (error) {
        thrown = describeError(error)
      }
      if (thrown !== undefined) {
        mismatch = {
          step,
          action,
          law: `legal action threw`,
          expected: `no error`,
          actual: thrown,
        }
        break
      }
      if (action.type === `hold` || action.type === `release`) continue
      await held.flush()
      await unheld.flush()
      mismatch = compareSource(step, action, unheld.observe(), held.observe())
      if (mismatch) {
        mismatch.law = `a hold does not change source reads (${mismatch.law})`
        break
      }
    }
  } finally {
    await Promise.allSettled([held.settle(), unheld.settle()])
    await Promise.allSettled([held.cleanup(), unheld.cleanup()])
  }
  return mismatch
}

type PlannedCall = { step: number; action: SessionAction; call: DriverCall }

/** The legal actions of a history and their driver calls, planned once. */
function planHistory(
  lane: SessionLane,
  history: ReadonlyArray<SessionAction>,
): Array<PlannedCall> {
  const model = new SessionModel(lane.fullRows)
  const planned: Array<PlannedCall> = []
  for (const [step, action] of history.entries()) {
    if (!isLegal(lane, model, action)) continue
    planned.push({ step, action, call: planAction(model, action, { s: step }) })
  }
  return planned
}

async function performCall(
  driver: SessionDriver,
  { step, action, call }: PlannedCall,
): Promise<SessionMismatch | undefined> {
  try {
    await call(driver)
  } catch (error) {
    return {
      step,
      action,
      law: `legal action threw`,
      expected: `no error`,
      actual: describeError(error),
    }
  }
  await driver.flush()
  return undefined
}

const otherRowKey: SessionRowKey = 2

/** Whether an action names row 2's data or metadata. */
function namesOtherRow(action: SessionAction): boolean {
  return `key` in action && action.key === otherRowKey
}

/** Row 1, the collection metadata, and receipts: what row 2 must not change. */
function withoutOtherRow(observation: SessionObservation): SessionObservation {
  return {
    ...observation,
    rowMetadata: { 1: observation.rowMetadata[1] },
    base: { 1: observation.base[1] },
  }
}

/**
 * A second formulation of per-object independence (read your writes holds
 * per object). Two production runs execute the same legal history, one with
 * every action that names row 2 removed. Row 1's reads, the collection
 * metadata, consumers' view of row 1, and receipts must match at each
 * checkpoint of an action both runs perform. Row 2's actions never change
 * which other actions are legal; `truncate` names every row and stays.
 */
export async function runKeyIndependence(
  lane: SessionLane,
  history: ReadonlyArray<SessionAction>,
  createDriver: () => Promise<SessionDriver>,
): Promise<SessionMismatch | undefined> {
  const both = await createDriver()
  const rowOneOnly = await createDriver()
  let mismatch: SessionMismatch | undefined
  try {
    for (const planned of planHistory(lane, history)) {
      mismatch = await performCall(both, planned)
      if (mismatch) break
      if (namesOtherRow(planned.action)) continue
      mismatch = await performCall(rowOneOnly, planned)
      if (mismatch) break
      mismatch = compare(
        planned.step,
        planned.action,
        withoutOtherRow(rowOneOnly.observe()),
        withoutOtherRow(both.observe()),
      )
      if (mismatch) {
        mismatch.law = `row 2's writes do not change row 1 (${mismatch.law})`
        break
      }
    }
  } finally {
    await Promise.allSettled([both.settle(), rowOneOnly.settle()])
    await Promise.allSettled([both.cleanup(), rowOneOnly.cleanup()])
  }
  return mismatch
}

/**
 * A second formulation of decisions D4 and D5: a seed is older than every
 * source write, so its arrival time cannot change the outcome. Two
 * production runs perform the same driver calls; the second performs every
 * seed first, in their original order. The source's calls stay what they
 * were, so a source that inserted a row before its seed arrived still calls
 * `insert`. After both runs settle, every observation must match. The model
 * plans the calls with seeds beneath every source write, and a source insert
 * replaces a seeded row, so an equal re-insert planned in arrival order
 * stays equal when the seed moves first. Under partial row updates a seed
 * that arrives after a source update is ignored, while a seed moved first is
 * the update's merge base, so consumers' rows are compared only under full
 * row updates; metadata is compared in every lane. For the same reason a
 * re-insert planned from the arrival-order row need not equal the row when
 * the seed moves first (decision "b"), so partial lanes drop `reinsert` from
 * both runs.
 */
export async function runSeedOrderInvariance(
  lane: SessionLane,
  history: ReadonlyArray<SessionAction>,
  createDriver: () => Promise<SessionDriver>,
): Promise<SessionMismatch | undefined> {
  const asArrived = await createDriver()
  const seedsFirst = await createDriver()
  const planned = planHistory(
    lane,
    lane.fullRows
      ? history
      : history.filter((action) => action.type !== `reinsert`),
  )
  const isSeed = ({ action }: PlannedCall) => action.type === `seed`
  let mismatch: SessionMismatch | undefined
  try {
    for (const next of planned) {
      mismatch = await performCall(asArrived, next)
      if (mismatch) break
    }
    if (!mismatch)
      for (const next of [
        ...planned.filter(isSeed),
        ...planned.filter((other) => !isSeed(other)),
      ]) {
        mismatch = await performCall(seedsFirst, next)
        if (mismatch) break
      }
    if (!mismatch) {
      await Promise.all([asArrived.settle(), seedsFirst.settle()])
      const comparable = (observation: SessionObservation) =>
        lane.fullRows ? observation : { ...observation, base: {} }
      mismatch = compare(
        history.length,
        `settle`,
        comparable(seedsFirst.observe()),
        comparable(asArrived.observe()),
      )
      if (mismatch)
        mismatch.law = `a seed's arrival time does not change the outcome (${mismatch.law})`
    }
  } finally {
    await Promise.allSettled([asArrived.settle(), seedsFirst.settle()])
    await Promise.allSettled([asArrived.cleanup(), seedsFirst.cleanup()])
  }
  return mismatch
}

const modelOnly: SessionDriver = {
  begin: () => {},
  commit: () => {},
  cancel: () => {},
  rowSet: () => {},
  rowDelete: () => {},
  insert: () => {},
  update: () => {},
  delete: () => {},
  truncate: () => {},
  collectionSet: () => {},
  collectionDelete: () => {},
  hold: () => {},
  release: () => Promise.resolve(),
  seed: () => {},
  observe: () => new SessionModel().observe(),
  flush: () => Promise.resolve(),
  settle: () => Promise.resolve([]),
  cleanup: () => Promise.resolve(),
}

/**
 * The model's observation at each checkpoint of a history, keyed by the step
 * index of each legal action. Witness tests use it to check the model against
 * expectations derived by hand from the laws.
 */
export async function modelCheckpoints(
  lane: SessionLane,
  history: ReadonlyArray<SessionAction>,
): Promise<Map<number, SessionObservation>> {
  const model = new SessionModel(lane.fullRows)
  const checkpoints = new Map<number, SessionObservation>()
  for (const [step, action] of history.entries()) {
    if (!isLegal(lane, model, action)) continue
    await planAction(model, action, { s: step })(modelOnly)
    checkpoints.set(step, model.observe())
  }
  return checkpoints
}

function isLegal(
  lane: SessionLane,
  model: SessionModel,
  action: SessionAction,
): boolean {
  switch (action.type) {
    case `begin`:
      return model.depth < lane.maxDepth
    case `hold`:
      return !model.isHolding
    case `release`:
      return model.isHolding
    case `seed`:
      return lane.seeds
    case `insertOverSeed`:
      return (
        lane.seeds &&
        model.depth > 0 &&
        !model.enclosingWroteRows(action.key) &&
        model.sourceRow(action.key).present &&
        !model.sourceWroteRow(action.key)
      )
    case `remove`:
    case `reinsert`:
      return (
        model.depth > 0 &&
        !model.enclosingWroteRows(action.key) &&
        model.sourceRow(action.key).present
      )
    case `upsert`:
      return model.depth > 0 && !model.enclosingWroteRows(action.key)
    case `truncate`:
      return model.depth > 0 && !model.enclosingWroteRows()
    default:
      return model.depth > 0
  }
}

type DriverCall = (driver: SessionDriver) => void | Promise<void>

/**
 * Advances the model by one legal action and returns the matching driver
 * call. The model decides once; the call can be replayed on several drivers.
 */
function planAction(
  model: SessionModel,
  action: SessionAction,
  value: unknown,
): DriverCall {
  switch (action.type) {
    case `begin`:
      model.begin()
      return (driver) => driver.begin()
    case `commit`:
      model.commit()
      return (driver) => driver.commit()
    case `cancel`:
      model.cancel()
      return (driver) => driver.cancel()
    case `rowSet`:
      model.write(`rowMetadata`, action.key, { present: true, value })
      return (driver) => driver.rowSet(action.key, value)
    case `rowDelete`:
      model.write(`rowMetadata`, action.key, absent)
      return (driver) => driver.rowDelete(action.key)
    case `upsert`: {
      // A row written with metadata also carries field `m`, so rows differ in
      // shape and a full update is distinguishable from a merge.
      const row = action.metadata
        ? { id: action.key, v: value, m: value }
        : { id: action.key, v: value }
      const metadata = action.metadata ? value : undefined
      const present = model.sourceRow(action.key).present
      if (metadata === undefined && !present) model.insertClear(action.key)
      model.writeRow(action.key, row, present ? `update` : `insert`)
      if (metadata !== undefined)
        model.write(`rowMetadata`, action.key, {
          present: true,
          value: metadata,
        })
      return (driver) =>
        present
          ? driver.update(action.key, row, metadata)
          : driver.insert(action.key, row, metadata)
    }
    case `reinsert`: {
      // An insert equal to a row the source itself wrote is an equal
      // re-insert: without metadata it keeps the current value, like an
      // update. Over a row that only a seed supplied it is an insert.
      const current = model.sourceRow(action.key)
      if (!current.present) throw new Error(`reinsert needs a present row`)
      const row = structuredClone(current.value)
      const metadata = action.metadata ? value : undefined
      if (metadata === undefined && !model.sourceWroteRow(action.key))
        model.insertClear(action.key)
      model.writeRow(action.key, row, `insert`)
      if (metadata !== undefined)
        model.write(`rowMetadata`, action.key, {
          present: true,
          value: metadata,
        })
      return (driver) => driver.insert(action.key, row, metadata)
    }
    case `remove`:
      model.write(`row`, action.key, absent)
      model.write(`rowMetadata`, action.key, absent)
      return (driver) => driver.delete(action.key)
    case `truncate`:
      model.truncate()
      return (driver) => driver.truncate()
    case `collectionSet`: {
      const stored = action.undefinedValue === true ? undefined : value
      model.write(`collection`, action.key, { present: true, value: stored })
      return (driver) => driver.collectionSet(action.key, stored)
    }
    case `collectionDelete`:
      model.write(`collection`, action.key, absent)
      return (driver) => driver.collectionDelete(action.key)
    case `hold`:
      model.hold()
      return (driver) => driver.hold(action.store === true)
    case `release`:
      model.release()
      return (driver) => driver.release()
    case `seed`: {
      // A seed usually carries a field the source never writes, so a source
      // update that merges over it keeps it. A narrow seed omits the field,
      // so a later seed of the same key shows whether it replaces the row.
      // A bare seed carries no metadata, so a later seed of the same key
      // shows whether the latest seed wins metadata too.
      const row =
        action.narrow === true
          ? { id: action.key, v: value }
          : { id: action.key, v: value, seeded: value }
      const metadata = action.bare === true ? undefined : value
      model.seed(
        action.key,
        row,
        metadata === undefined ? absent : { present: true, value: metadata },
      )
      return (driver) => driver.seed!(action.key, row, metadata)
    }
    case `insertOverSeed`: {
      // A fresh source insert over a row only a seed supplied replaces it.
      const row = action.metadata
        ? { id: action.key, v: value, m: value }
        : { id: action.key, v: value }
      const metadata = action.metadata ? value : undefined
      if (metadata === undefined) model.insertClear(action.key)
      model.writeRow(action.key, row, `insert`)
      if (metadata !== undefined)
        model.write(`rowMetadata`, action.key, {
          present: true,
          value: metadata,
        })
      return (driver) => driver.insert(action.key, row, metadata)
    }
  }
}

/**
 * Each observation field is one public promise. The comparison names the
 * law that the first differing field protects.
 */
function compare(
  step: number,
  action: SessionAction | `settle`,
  expected: SessionObservation,
  actual: SessionObservation,
  sourceOnly = false,
): SessionMismatch | undefined {
  const fields: Array<[keyof SessionObservation, string]> = [
    [`rowMetadata`, `source reads its row metadata (metadata.row.get)`],
    [
      `collection`,
      `source reads its collection metadata (metadata.collection.get)`,
    ],
    [`list`, `source lists its collection metadata (metadata.collection.list)`],
    [`prefixList`, `source lists a prefix (metadata.collection.list(prefix))`],
    [`base`, `consumers see whole applied transactions only (collection.base)`],
    [`receipts`, `a receipt settles when its writes become visible`],
  ]
  for (const [field, law] of fields) {
    if (sourceOnly && (field === `base` || field === `receipts`)) continue
    if (canonical(expected[field]) !== canonical(actual[field]))
      return {
        step,
        action,
        law,
        expected: expected[field],
        actual: actual[field],
      }
  }
  return undefined
}

/** JSON with sorted object keys, so field order is not an observation. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === `object` && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : item,
  )
}

function compareSource(
  step: number,
  action: SessionAction,
  expected: SessionObservation,
  actual: SessionObservation,
): SessionMismatch | undefined {
  return compare(step, action, expected, actual, true)
}

function describeError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error)
}

export function describeMismatch(
  history: ReadonlyArray<SessionAction>,
  mismatch: SessionMismatch,
): string {
  const trace = history
    .slice(
      0,
      typeof mismatch.action === `string` ? history.length : mismatch.step + 1,
    )
    .map((action) =>
      action.type === `seed`
        ? `seed(${[action.key, action.narrow === true ? `narrow` : ``, action.bare === true ? `bare` : ``].filter(Boolean).join(`,`)})`
        : `key` in action
          ? `${action.type}(${action.key})`
          : action.type === `hold` && action.store === true
            ? `hold(store)`
            : action.type,
    )
    .join(` `)
  return [
    `law: ${mismatch.law}`,
    `at step ${mismatch.step} (${typeof mismatch.action === `string` ? mismatch.action : mismatch.action.type})`,
    `history: ${trace}`,
    `expected: ${JSON.stringify(mismatch.expected)}`,
    `actual:   ${JSON.stringify(mismatch.actual)}`,
  ].join(`\n`)
}
