// The model and history grammar of the row metadata composition oracle,
// moved unchanged from collection-row-metadata-composition-oracle.test.ts so
// that the ordinary grammar and model tests in
// collection-row-metadata-composition.test.ts can import them. The oracle's
// opening comment states the contract that this model enacts.

export type Write =
  | { kind: `set` }
  | { kind: `unset` }
  | { kind: `truncate` }
  | {
      kind: `insert` | `reinsert` | `update` | `delete`
      metadata: boolean
    }
export type Start =
  `absent` | `present-with-metadata` | `present-without-metadata`
export type ProductionPath = `immediate` | `held` | `rebuilt`

export const writes: ReadonlyArray<Write> = [
  { kind: `set` },
  { kind: `unset` },
  { kind: `truncate` },
  ...([`insert`, `reinsert`, `update`, `delete`] as const).flatMap((kind) =>
    [false, true].map((metadata) => ({ kind, metadata })),
  ),
]

export const startMetadata = { m: `start` }
export const writeMetadata = (step: number) => ({ m: `w${step}` })

/**
 * The model folds the writes in order over the starting value. It keeps no
 * staging state: each write replaces, keeps, or clears the one current value,
 * as the contract above states.
 */
export function expectedMetadata(start: Start, sequence: ReadonlyArray<Write>) {
  return foldMetadata(
    start === `present-with-metadata` ? startMetadata : undefined,
    sequence,
  )
}

export function foldMetadata(initial: unknown, sequence: ReadonlyArray<Write>) {
  let current = initial
  sequence.forEach((write, step) => {
    if (write.kind === `set`) current = writeMetadata(step)
    else if (
      write.kind === `unset` ||
      write.kind === `truncate` ||
      write.kind === `delete`
    )
      current = undefined
    else if (write.metadata) current = writeMetadata(step)
    else if (write.kind === `insert`) current = undefined
    // A re-insert or an update without metadata keeps the current value.
  })
  return current
}

/**
 * Legal histories follow the change-message protocol for the row: an insert
 * names an absent key, and an update or delete names a present one. A
 * truncate leaves the row absent. Metadata API calls are legal in any row
 * state.
 */
export function isLegal(start: Start, sequence: ReadonlyArray<Write>): boolean {
  let present = start !== `absent`
  for (const write of sequence) {
    if (write.kind === `truncate`) present = false
    else if (write.kind === `insert`) {
      if (present) return false
      present = true
    } else if (
      write.kind === `reinsert` ||
      write.kind === `update` ||
      write.kind === `delete`
    ) {
      if (!present) return false
      present = write.kind !== `delete`
    }
  }
  return true
}

export const starts: ReadonlyArray<Start> = [
  `absent`,
  `present-with-metadata`,
  `present-without-metadata`,
]
export const histories = starts.flatMap((start) => {
  const legal: Array<{ start: Start; sequence: Array<Write> }> = []
  const extend = (sequence: Array<Write>) => {
    if (sequence.length > 0 && isLegal(start, sequence))
      legal.push({ start, sequence })
    if (sequence.length < 3)
      for (const write of writes) extend([...sequence, write])
  }
  extend([])
  return legal
})

/**
 * The rebuilt variant also varies the earlier held transaction. It either
 * updates key 2, or writes key 1 without metadata: an update or a delete when
 * key 1 is present, an insert when it is absent. A key-1 write changes the
 * projection that the open transaction rebuilds against, so its sequences are
 * legal after that write. Sequences stay at two writes to bound the variant.
 */
export type EarlierWrite = { key: 1 | 2; kind: `insert` | `update` | `delete` }
export const shortSequences = writes.flatMap((first) => [
  [first],
  ...writes.map((second) => [first, second]),
])
export const asWrite = (earlier: EarlierWrite): Write => ({
  kind: earlier.kind,
  metadata: false,
})
export const rebuiltHistories = starts.flatMap((start) => {
  const present = start !== `absent`
  const earlierWrites: Array<EarlierWrite> = [
    { key: 2, kind: `update` },
    ...(present
      ? ([
          { key: 1, kind: `update` },
          { key: 1, kind: `delete` },
        ] as const)
      : ([{ key: 1, kind: `insert` }] as const)),
  ]
  return earlierWrites.flatMap((earlier) =>
    earlier.key === 2
      ? histories
          .filter((history) => history.start === start)
          .map((history) => ({ ...history, earlier }))
      : shortSequences
          .filter((sequence) => isLegal(start, [asWrite(earlier), ...sequence]))
          .map((sequence) => ({ start, sequence, earlier })),
  )
})

/**
 * The nested variant opens a transaction, T1, and writes up to three writes to
 * key 1. Then a nested write applies before T1 commits:
 *
 * - `delete`: a transaction begun inside T1 deletes the present row.
 * - `insert`: a transaction begun inside T1 inserts the absent row with its
 *   own metadata.
 * - `seed`: a hydration seed inserts the absent row with its own metadata.
 *   The Collection places a seed ahead of the first open transaction.
 *
 * A nested transaction can also call `metadata.row.set` after its row write.
 *
 * A transaction begun inside T1 is independent and commits first, so it
 * applies first: sync transactions apply in commit order (maintainer
 * decision of 2026-10-23, recorded in
 * `docs/contributing/oracle-reviews/2026-10-22-sync-metadata-session.md`).
 * T1 applies after the nested write, so the Collection reclassifies each of
 * T1's inserts against the rows that the nested write leaves. An insert of a
 * present key is an equal re-insert, and an insert of an absent key is an
 * insert. Every row write in this variant writes one value, so a reclassified
 * insert is never a duplicate. The `held` variant holds both transactions
 * behind a persisting optimistic update until T1 commits; a hold delays
 * application but cannot change commit order, so it expects the same value.
 *
 * A seed is older than every source write (decisions D4 and D5 of
 * 2026-10-22). It sits beneath T1, and T1's first insert names the whole
 * row, so it is an insert that replaces the seeded row, not an equal
 * re-insert of it.
 *
 * A history is legal when T1's writes are legal both where T1 writes them and
 * where they apply. An insert is legal in either place. An update or a delete
 * needs the row present in both. A truncate leaves the row absent in both.
 */
export type NestedWrite = `delete` | `insert` | `seed`
export type NestedHistory = {
  start: Start
  nested: NestedWrite
  nestedSet: boolean
  sequence: Array<Write>
}
export const nestedMetadata = { m: `nested` }
export const nestedSetMetadata = { m: `nested-set` }
// The model decides which inserts are re-inserts, so T1 writes only inserts.
export const nestedCandidates = writes.filter(
  (write) => write.kind !== `reinsert`,
)
export function isNestedLegal(
  writePresent: boolean,
  applyPresent: boolean,
  sequence: ReadonlyArray<Write>,
): boolean {
  for (const write of sequence) {
    if (write.kind === `truncate`) writePresent = applyPresent = false
    else if (write.kind === `insert`) writePresent = applyPresent = true
    else if (write.kind === `update` || write.kind === `delete`) {
      if (!writePresent || !applyPresent) return false
      if (write.kind === `delete`) writePresent = applyPresent = false
    }
  }
  return true
}
export const nestedVariants: ReadonlyArray<Omit<NestedHistory, `sequence`>> = [
  ...([`present-with-metadata`, `present-without-metadata`] as const).flatMap(
    (start) =>
      [false, true].map((nestedSet) => ({
        start,
        nested: `delete` as const,
        nestedSet,
      })),
  ),
  { start: `absent`, nested: `insert`, nestedSet: false },
  { start: `absent`, nested: `insert`, nestedSet: true },
  { start: `absent`, nested: `seed`, nestedSet: false },
]
export const nestedHistories: Array<NestedHistory> = nestedVariants.flatMap(
  (variant) => {
    const writePresent = variant.start !== `absent`
    const applyPresent = variant.nested !== `delete`
    const sequences: Array<Array<Write>> = []
    const extend = (sequence: Array<Write>) => {
      if (
        sequence.length > 0 &&
        isNestedLegal(writePresent, applyPresent, sequence)
      )
        sequences.push(sequence)
      if (sequence.length < 3)
        for (const write of nestedCandidates) extend([...sequence, write])
    }
    extend([])
    return sequences.map((sequence) => ({ ...variant, sequence }))
  },
)
/**
 * An insert of the row is a re-insert exactly when the row is present. A
 * delete or a truncate leaves the row absent.
 */
export const reclassify = (
  present: boolean,
  sequence: ReadonlyArray<Write>,
): Array<Write> =>
  sequence.map((write) => {
    if (write.kind === `delete` || write.kind === `truncate`) present = false
    if (write.kind !== `insert`) return write
    const kind = present ? `reinsert` : `insert`
    present = true
    return { kind, metadata: write.metadata }
  })
/**
 * The model's expected value: T1's writes fold over the nested write's. A
 * nested insert leaves the row present for T1's inserts; a seed does not,
 * because T1's first insert replaces it.
 */
export function expectedNestedMetadata(history: NestedHistory): unknown {
  const metadata = history.nestedSet
    ? nestedSetMetadata
    : history.nested === `delete`
      ? undefined
      : nestedMetadata
  return foldMetadata(
    metadata,
    reclassify(history.nested === `insert`, history.sequence),
  )
}
export const describeNested = ({
  start,
  nested,
  nestedSet,
  sequence,
}: NestedHistory) =>
  `${start}, nested ${nested}${nestedSet ? `+set` : ``}: ${sequence.map(describeWrite).join(`, `)}`

export const describeWrite = (write: Write) =>
  write.kind === `set` || write.kind === `unset` || write.kind === `truncate`
    ? write.kind
    : `${write.kind}${write.metadata ? `+metadata` : ``}`

/**
 * The driver writes the history through a real Collection's sync API and reads
 * the result through `metadata.row.get` after the transaction applies. Each
 * production path takes a different route through the Collection for the same
 * rule:
 *
 * - `immediate`: the transaction applies at commit.
 * - `held`: a persisting optimistic request holds the transaction until it
 *   settles. A transaction with a truncate applies at once instead.
 * - `rebuilt`: an earlier held transaction applies while this one is still
 *   open, so the Collection rebuilds this transaction's automatic metadata
 *   writes before it commits.
 */
// The model predicts a production path's row metadata. A write before the history (the
// earlier write) applies first when it names the same key, and the history
// then folds over that result.
export function expectedProductionPathMetadata(
  start: Start,
  sequence: ReadonlyArray<Write>,
  earlier: EarlierWrite | undefined,
): unknown {
  return earlier?.key === 1
    ? foldMetadata(expectedMetadata(start, [asWrite(earlier)]), sequence)
    : expectedMetadata(start, sequence)
}

// The observed metadata must equal the model's value, compared as JSON. A
// mismatch is recorded with its history label instead of failing at once.
export function compareObservedMetadata(
  mismatches: Array<string>,
  label: string,
  actual: unknown,
  expected: unknown,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    mismatches.push(
      `${label} read ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    )
}

/**
 * The held-window model folds collection metadata separately. An explicit
 * `set` names the cursor's value and an `unset` deletes it. Row writes and
 * truncates leave it alone, because collection metadata is not row state.
 * T2 always writes the `later` key, so a correct `list()` contains it.
 */
export const cursorKey = `cursor`
export const laterKey = `later`
export const laterMetadata = { m: `later` }
export type HeldOpen = `empty` | `truncated`
export type HeldReads = {
  row: unknown
  cursor: unknown
  list: Array<{ key: string; value: unknown }>
}

export function expectedCursor(start: Start, sequence: ReadonlyArray<Write>) {
  let current: unknown =
    start === `present-with-metadata` ? startMetadata : undefined
  sequence.forEach((write, step) => {
    if (write.kind === `set`) current = writeMetadata(step)
    else if (write.kind === `unset`) current = undefined
  })
  return current
}

export function expectedHeldReads(
  start: Start,
  sequence: ReadonlyArray<Write>,
  open: HeldOpen | `applied`,
): HeldReads {
  const cursor = expectedCursor(start, sequence)
  return {
    // An open truncate hides every older row metadata value.
    row: open === `truncated` ? undefined : expectedMetadata(start, sequence),
    cursor,
    list: [
      ...(cursor === undefined ? [] : [{ key: cursorKey, value: cursor }]),
      { key: laterKey, value: laterMetadata },
    ],
  }
}
