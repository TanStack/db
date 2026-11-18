// The reference model and history grammar of the DbClient hydration
// authority oracle, moved unchanged from
// db-client-hydration-authority-oracle.test.ts so that the ordinary reference
// tests in db-client-hydration-authority.test.ts can import them. The oracle's
// opening comment states the law that `referenceRows` folds.

export type Row = { id: string; name: string; seeded?: string }
export type Metadata = { source: string }
export type RowUpdateMode = `partial` | `full`
export type SeedRow = { value: Row; metadata?: Metadata }
export type HydrationOrder = `before` | `after` | `both`
export type HydrationStage = `before` | `after`

/** Each adapter decision names its operation and whether it names metadata. */
export const adapterDecisions = {
  insert: { op: `insert`, metadata: false },
  'insert+metadata': { op: `insert`, metadata: true },
  update: { op: `update`, metadata: false },
  'update+metadata': { op: `update`, metadata: true },
  metadata: { op: `metadata`, metadata: true },
  delete: { op: `delete`, metadata: false },
  truncate: { op: `truncate`, metadata: false },
} as const
export type AdapterDecision = keyof typeof adapterDecisions
export type AdapterAction =
  | { kind: `adapter`; op: `insert` | `update`; row: Row; metadata?: Metadata }
  | { kind: `adapter`; op: `metadata`; metadata: Metadata }
  | { kind: `adapter`; op: `delete` }
  | { kind: `adapter`; op: `truncate` }
export type HistoryAction =
  { kind: `hydrate`; rows: ReadonlyArray<SeedRow> } | AdapterAction

export const target = `1`
export const peer = `2`
export const newKey = `3`

/**
 * `initialData` is the first seed. It carries no metadata, and the target's
 * `seeded` field is one that no adapter write names.
 */
export const initialRows: ReadonlyArray<SeedRow> = [
  { value: { id: peer, name: `initial-peer` } },
  { value: { id: target, name: `initial-target`, seeded: `initial` } },
]

/**
 * The early chunk carries `seeded`, a field no adapter write names. The late
 * chunk omits it, so a merge of the late chunk over the early one is visible.
 */
export function hydrationRows(stage: HydrationStage): Array<SeedRow> {
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

export function adapterAction(decision: AdapterDecision): AdapterAction {
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

export type ObservedRow = {
  id: string
  row: Row
  metadata: Metadata | undefined
}
export type Slot = {
  row: Row | undefined
  rowWritten: boolean
  metadata: Metadata | undefined
  metadataWritten: boolean
}

export const sameRow = (left: Row, right: Row): boolean =>
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
export function referenceRows(
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

export type Case = {
  decisions: ReadonlyArray<AdapterDecision>
  label: string
  order: HydrationOrder
  rowUpdateMode: RowUpdateMode
}
export const orders: ReadonlyArray<HydrationOrder> = [`before`, `after`, `both`]
export const singles: ReadonlyArray<AdapterDecision> = [
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
export const pairs = [
  `delete,insert`,
  `delete,insert+metadata`,
  `delete,update`,
  `delete,update+metadata`,
  `insert,delete`,
  `truncate,insert`,
  `truncate,insert+metadata`,
]
export const cases: Array<Case> = ([`full`, `partial`] as const).flatMap(
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
