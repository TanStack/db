/**
 * # Does every joined pair keep its own result row?
 *
 * Law and source: the live-query guide defines joins like SQL joins that
 * combine matching rows into single result rows, and gives a join result a
 * composite key of the parent keys (`docs/guides/live-queries.md`, "Joins" and
 * the `getKey` option). A joined live-query Collection therefore publishes one
 * row for each matching pair of source rows, plus one row for each unmatched
 * row a left or full join keeps, and two distinct pairs never share a key. The
 * guide does not fix the key's format. The compiler used to join the two source
 * keys with a comma, so keys that contain delimiters, or a number and a string
 * that print alike, could collide and drop or reject a valid row.
 *
 * Model: `expectedPairs` recomputes the pair set with nested loops over plain
 * arrays. It does not import the compiler or its key encoding.
 *
 * History grammar: left and right rows draw keys from a domain of plain,
 * comma-bearing, bracket-bearing, and quoted strings, numbers alongside the
 * strings that print the same, both infinities, and `NaN`. Rows join on a small
 * group value. Each history uses an inner, left, or full join, then applies up
 * to three synced group changes to either side.
 *
 * Production driver: two `mockSyncCollectionOptions` Collections and a public
 * `createLiveQueryCollection` join that selects both keys.
 *
 * Refinement check: after preload and after each synced change, the published
 * rows equal the model's pair multiset, and the result key count equals the
 * row count.
 *
 * Calibration: the fixed pair (`a,b`, `c`) versus (`a`, `b,c`) and the pair
 * (1, `c`) versus (`1`, `c`) collided under the comma encoding; restoring it
 * fails both fixed histories and both campaigns. Plain `JSON.stringify`
 * printed `Infinity` and `-Infinity` as `null`; restoring it fails the fixed
 * infinity history and both campaigns. Comparing the join index's source-key
 * prefixes with `===` let a retracted `NaN`-keyed row survive; restoring it
 * fails the fixed `NaN` history.
 *
 * The pair-only campaign above does not cover joins over subqueries or more
 * than two sources. The receiving grammar below adds bounded custom-key and
 * optimistic-update histories without claiming arbitrary write overlap.
 * The mock sync source is a controlled provider; this oracle claims only the
 * compiler's keying of the rows it supplies, not any real adapter's behavior.
 */
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  Query,
  createLiveQueryCollection,
  eq,
  include,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import {
  oracleProperty,
  oracleReplayRequested,
  oracleRoute,
} from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import { declareOracle } from '../oracle-declaration.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'
import { expectedSourceMetadata } from './virtual-row-fields-source-oracle.js'
import type { QueryBuilder } from '../../src/query/builder/index.js'

const property = `join-result-key.pairs`

type Key = string | number
type Row = { id: Key; g: number }
type JoinType = `inner` | `left` | `full`
type Change = { side: `left` | `right`; index: number; g: number }
type History = {
  join: JoinType
  left: Array<Row>
  right: Array<Row>
  changes: Array<Change>
}

// Keys that a delimiter-joined encoding cannot tell apart, plus non-finite
// numbers, which JSON prints as `null`, the missing-side marker. A `NaN` key
// also checks that the join's source-key index treats `NaN` as one key.
const keyDomain: ReadonlyArray<Key> = [
  `a`,
  `b`,
  `c`,
  `a,b`,
  `b,c`,
  `[a`,
  `b]`,
  `"a"`,
  1,
  `1`,
  2,
  `2`,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.NaN,
]

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type Pair = { l: Key | undefined; r: Key | undefined }

// Nested-loop join over the current rows.
function expectedPairs(
  join: JoinType,
  left: ReadonlyArray<Row>,
  right: ReadonlyArray<Row>,
): Array<string> {
  const pairs: Array<Pair> = []
  const matchedRight = new Set<Row>()
  for (const l of left) {
    const matches = right.filter((r) => r.g === l.g)
    for (const r of matches) {
      pairs.push({ l: l.id, r: r.id })
      matchedRight.add(r)
    }
    if (matches.length === 0 && join !== `inner`) {
      pairs.push({ l: l.id, r: undefined })
    }
  }
  if (join === `full`) {
    for (const r of right) {
      if (!matchedRight.has(r)) pairs.push({ l: undefined, r: r.id })
    }
  }
  return pairs.map(describePair).sort()
}

function describePair({ l, r }: Pair): string {
  const side = (key: Key | undefined) =>
    key === undefined ? `-` : `${typeof key}:${String(key)}`
  return `${side(l)} | ${side(r)}`
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const rowsArbitrary = fc.uniqueArray(
  fc.record({
    id: fc.constantFrom(...keyDomain),
    g: fc.integer({ min: 0, max: 2 }),
  }),
  { selector: (row) => `${typeof row.id}:${String(row.id)}`, maxLength: 5 },
)

const historyArbitrary: fc.Arbitrary<History> = fc.record({
  join: fc.constantFrom<JoinType>(`inner`, `left`, `full`),
  left: rowsArbitrary,
  right: rowsArbitrary,
  changes: fc.array(
    fc.record({
      side: fc.constantFrom<Change[`side`]>(`left`, `right`),
      index: fc.nat({ max: 4 }),
      g: fc.integer({ min: 0, max: 2 }),
    }),
    { maxLength: 3 },
  ),
})

// Under the comma encoding, (`a,b`, `c`) and (`a`, `b,c`) share `[a,b,c]`,
// and (1, `c`) and (`1`, `c`) share `[1,c]`. Under plain JSON, (`a`, Infinity)
// and (`a`, -Infinity) share `["a",null]`, and so do the unmatched right rows
// once `a` moves away.
const fixedHistories: ReadonlyArray<History> = [
  {
    join: `inner`,
    left: [
      { id: `a,b`, g: 1 },
      { id: `a`, g: 1 },
    ],
    right: [
      { id: `c`, g: 1 },
      { id: `b,c`, g: 1 },
    ],
    changes: [{ side: `right`, index: 0, g: 2 }],
  },
  {
    join: `left`,
    left: [
      { id: 1, g: 1 },
      { id: `1`, g: 1 },
    ],
    right: [{ id: `c`, g: 1 }],
    changes: [{ side: `right`, index: 0, g: 0 }],
  },
  {
    join: `full`,
    left: [{ id: `a`, g: 1 }],
    right: [
      { id: Number.POSITIVE_INFINITY, g: 1 },
      { id: Number.NEGATIVE_INFINITY, g: 1 },
    ],
    changes: [{ side: `left`, index: 0, g: 0 }],
  },
  {
    // The pair leaves and re-forms; the NaN-keyed left row must cancel.
    join: `inner`,
    left: [{ id: Number.NaN, g: 0 }],
    right: [{ id: `a`, g: 0 }],
    changes: [
      { side: `left`, index: 0, g: 1 },
      { side: `right`, index: 0, g: 1 },
    ],
  },
]

// ---------------------------------------------------------------------------
// Production driver and refinement check
// ---------------------------------------------------------------------------

let collectionSerial = 0

async function runHistory(history: History): Promise<void> {
  const serial = collectionSerial++
  const leftRows = history.left.map((row) => ({ ...row }))
  const rightRows = history.right.map((row) => ({ ...row }))
  const left = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `join-key-left-${serial}`,
      getKey: (row) => row.id,
      initialData: leftRows.map((row) => ({ ...row })),
    }),
  )
  const right = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `join-key-right-${serial}`,
      getKey: (row) => row.id,
      initialData: rightRows.map((row) => ({ ...row })),
    }),
  )
  const live = createLiveQueryCollection((q) =>
    q
      .from({ l: left })
      .join({ r: right }, ({ l, r }) => eq(l.g, r.g), history.join)
      .select(({ l, r }) => ({ l: l.id, r: r.id })),
  )
  const check = (checkpoint: string) => {
    const published = live.toArray
      .map((row) => describePair({ l: row.l, r: row.r }))
      .sort()
    oracleAssertion(checkpoint, () =>
      expect(published, checkpoint).toEqual(
        expectedPairs(history.join, leftRows, rightRows),
      ),
    )
    oracleAssertion(`${checkpoint} key count`, () =>
      expect(live.size, `${checkpoint} key count`).toBe(published.length),
    )
  }
  await withOracleCleanup(async () => {
    await live.preload()
    check(`after preload`)
    for (const [step, change] of history.changes.entries()) {
      const rows = change.side === `left` ? leftRows : rightRows
      const collection = change.side === `left` ? left : right
      const target = rows[change.index % Math.max(rows.length, 1)]
      if (!target || target.g === change.g) continue
      collection.utils.begin()
      collection.utils.write({
        type: `update`,
        value: { id: target.id, g: change.g },
      })
      collection.utils.commit()
      target.g = change.g
      check(`after change ${step}`)
    }
  }, [
    () => live.cleanup(),
    () => Promise.all([left.cleanup(), right.cleanup()]),
  ])
}

declareOracle({
  owns: [
    `src/query/compiler/joins.ts#processJoins`,
    `src/query/live-query-collection.ts#createLiveQueryCollection`,
  ],
  check: [runHistory],
  model: [expectedPairs],
})

describe(`joined result key oracle`, () => {
  // The fixed histories and the fixed-seed campaign stand aside during any path
  // replay. The random campaign below is the one that a replay of this
  // property selects.
  if (!oracleReplayRequested()) {
    for (const history of fixedHistories) {
      it(`keeps every ${history.join} join pair for ${history.left
        .map((row) =>
          typeof row.id === `number` ? String(row.id) : JSON.stringify(row.id),
        )
        .join(` `)}`, () => {
        oracleRoute(`case`)
        return runHistory(history)
      })
    }
  }

  oracleProperty({
    id: property,
    law: {
      statement: `Each joined source pair retains a distinct public row and key after preload and synced group changes.`,
      authority: `docs/guides/live-queries.md, Joins and getKey, and the established key contract above.`,
      limits: `The unchanged bounded two-source inner, left and full join grammar with up to three synced group changes.`,
      owner: `Joined result keys`,
    },
    histories: {
      arbitrary: historyArbitrary,
      runs: 80,
      fixedSeeds: [44501962],
      states: [],
      constructed: [],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan: { history: History }, observe) =>
      recordAssertionJudgment(property, plan, observe, () =>
        runHistory(plan.history),
      ),
    check: forwardAssertionJudgment,
  })
})

/**
 * Whole-source selection does not turn a join into a set of source rows.
 * Each pair still contributes one occurrence (live-query guide, Joins/getKey;
 * maintainer decision, November 5). Published $key is its actual Collection
 * entry key, including an explicit getKey. The selected source owns the other
 * three metadata fields. Inline values keep their authored source fields.
 *
 * This receiving grammar adds direct/QueryRef placement, both selected sides,
 * all four join kinds, structured/direct functional selections and spreads.
 * Functional direct selection falls back to the present side on an unmatched
 * pair; structured selection of an absent side is the documented empty object.
 * Both spread forms can override all reserved names. Only the structured one
 * retains source attribution at publication. These distinctions are required:
 * removing fanout hides source-key collapse, removing unmatched pairs hides
 * missing-side identity, and removing either receiving boundary hides changes
 * to authored inline values or computed Collection metadata.
 *
 * Three unique keys per side are legal; duplicate source keys are excluded.
 * Two rows per side match and one on each side is unmatched. While a selected
 * source write persists, both matching peers move away and back. Settlement
 * restores that source's base, followed by a remote write. Comparisons run at
 * each synchronous public cut and after the mutation's settlement. This claims
 * eager core behavior, not framework timing, real providers, arbitrary include
 * depth or arbitrary custom-key functions. Explicit custom keys intentionally
 * reduce congruent contributors; default keys retain all pairs. Correlated
 * direct children filter by the left route field; QueryRef children filter by
 * their exported selected route field. Absent inputs fail that WHERE equality.
 */
type SelectionRow = Row & { route: number; label: string }
type SelectionShape =
  | `structured-direct`
  | `functional-direct`
  | `structured-spread`
  | `functional-spread`
type SelectionHistory = {
  join: JoinType | `right`
  shape: SelectionShape
  selected: `left` | `right`
  composition: `direct` | `query-ref`
  collision: boolean
  customKey: boolean
  leftKeys: Array<Key>
  rightKeys: Array<Key>
  label: string
}
type SelectionContext = {
  schema: { selected: Partial<SelectionRow> }
  baseSchema: { selected: Partial<SelectionRow> }
  fromSourceName: `selected`
  result: Partial<SelectionRow>
  hasResult: true
}
const selectionProperty = `join-result-key.whole-source`
const selectionCuts = [
  `initial`,
  `held`,
  `unmatched`,
  `rejoined`,
  `settled`,
  `remote`,
] as const
const selectionReceivers = [`root`, `facade`, `array`, `materialized`] as const
const selectionForms = ([`inner`, `left`, `right`, `full`] as const).flatMap(
  (join) =>
    ([`left`, `right`] as const).flatMap((selected) =>
      ([`direct`, `query-ref`] as const).flatMap((composition) =>
        (
          [
            `structured-direct`,
            `functional-direct`,
            `structured-spread`,
            `functional-spread`,
          ] as const
        ).flatMap((shape) =>
          (shape.endsWith(`spread`) ? [false, true] : [false]).flatMap(
            (collision) =>
              [false, true].map((customKey) => ({
                join,
                selected,
                composition,
                shape,
                collision,
                customKey,
              })),
          ),
        ),
      ),
    ),
)
const selectionExamples: Array<SelectionHistory> = selectionForms.map(
  (form) => ({
    ...form,
    leftKeys: [1, `1`, `unmatched,left`],
    rightKeys: [`a,b`, `b,c`, `unmatched,right`],
    label: `before`,
  }),
)
const selectionKeysArbitrary = fc.uniqueArray(fc.constantFrom(...keyDomain), {
  selector: (key) => `${typeof key}:${String(key)}`,
  minLength: 3,
  maxLength: 3,
})
const selectionHistoryArbitrary: fc.Arbitrary<SelectionHistory> = fc
  .tuple(
    fc.constantFrom(...selectionForms),
    selectionKeysArbitrary,
    selectionKeysArbitrary,
    fc.string({ maxLength: 8 }),
  )
  .map(([form, leftKeys, rightKeys, label]) => ({
    ...form,
    leftKeys,
    rightKeys,
    label,
  }))
const selectionState = (
  history: SelectionHistory,
  receiver: string,
  cut: string,
) =>
  `${history.join}/${history.selected}/${history.composition}/${history.shape}/${history.collision}/${history.customKey}/${receiver}/${cut}`
// A plain nested-loop join supplies occurrences; selecting a source changes
// its value, never the number of those occurrences. No compiler key encoder
// participates. The public key's format remains implementation freedom.
function expectedSelections(
  history: SelectionHistory,
  left: ReadonlyArray<SelectionRow>,
  right: ReadonlyArray<SelectionRow>,
  pending: ReadonlySet<Key>,
  leftId: string,
  rightId: string,
  outputId: string,
  inline: boolean,
  nested: boolean,
): Array<object> {
  const pairs: Array<{
    left?: SelectionRow
    right?: SelectionRow
  }> = []
  for (const a of left) {
    const matches = right.filter((b) => a.g === b.g)
    for (const b of matches) pairs.push({ left: a, right: b })
    if (!matches.length && (history.join === `left` || history.join === `full`))
      pairs.push({ left: a })
  }
  if (history.join === `right` || history.join === `full`)
    for (const b of right)
      if (!left.some((a) => a.g === b.g)) pairs.push({ right: b })
  const values = pairs.flatMap((pair) => {
    const source =
      pair[history.selected] ??
      (history.shape === `functional-direct`
        ? (pair.left ?? pair.right)
        : undefined)
    // Correlation reads the direct left row, or the QueryRef's exported row.
    // An absent row cannot satisfy that equality.
    if (nested && (history.composition === `direct` ? !pair.left : !source))
      return []
    const ownerId = source === pair.left ? leftId : rightId
    const sourceMetadata = source
      ? expectedSourceMetadata(
          source.id,
          ownerId,
          pending.has(source.id) &&
            (source === pair.left
              ? history.selected === `left`
              : history.selected === `right`),
        )
      : undefined
    const overrides = history.collision
      ? {
          $key: `authored-key`,
          $collectionId: `authored-id`,
          $origin: `local`,
          $hasPendingWrites: false,
        }
      : {}
    if (inline) return [{ ...source, ...sourceMetadata, ...overrides }]
    const metadata =
      source && history.shape !== `functional-spread`
        ? sourceMetadata!
        : expectedSourceMetadata(`unused`, outputId, false)
    const { $key: _key, ...attribution } = metadata
    return [{ ...source, ...attribution }]
  })
  // Explicit getKey requests one congruent row per authored key, so fanout
  // may intentionally reduce. The default-key lane must retain every pair.
  return history.customKey && !nested
    ? [...new Map(values.map((row) => [selectionCustomKey(row), row])).values()]
    : values
}

function selectionCustomKey(row: Partial<SelectionRow>): string {
  return `custom:${typeof row.id}:${String(row.id)}:${String(row.g)}`
}

// Public keys must be unique and agree with each row's readable $key. Removing
// only that already-checked key permits any composite-key encoding. Full row
// comparisons preserve duplicates and all other metadata and ordinary fields.
function checkSelections(
  actual: ReadonlyArray<readonly [Key, object]> | ReadonlyArray<object>,
  expected: ReadonlyArray<object>,
  inline: boolean,
): void {
  const failures: Array<unknown> = []
  const check = (assertion: () => void) => {
    try {
      assertion()
    } catch (error) {
      failures.push(error)
    }
  }
  const rows = inline
    ? (actual as ReadonlyArray<object>)
    : (actual as ReadonlyArray<readonly [Key, Record<string, unknown>]>).map(
        ([key, row]) => {
          check(() => {
            oracleAssertion(`checkSelections comparison 3`, () =>
              expect(typeof key === `string` || typeof key === `number`).toBe(
                true,
              ),
            )
            oracleAssertion(`published key equals Collection entry key`, () =>
              expect(
                row.$key,
                `published key equals Collection entry key`,
              ).toBe(key),
            )
          })
          const { $key: _key, ...value } = row
          return value
        },
      )
  if (!inline) {
    const keys = (actual as ReadonlyArray<readonly [Key, object]>).map(
      ([key]) => key,
    )
    check(() =>
      oracleAssertion(`distinct joined occurrence keys`, () =>
        expect(new Set(keys).size, `distinct joined occurrence keys`).toBe(
          expected.length,
        ),
      ),
    )
  }
  const order = (a: object, b: object) => {
    const describeRow = (row: object) => {
      const { id, label, g } = row as Partial<SelectionRow>
      return `${typeof id}:${String(id)}:${label}:${g}`
    }
    return describeRow(a).localeCompare(describeRow(b))
  }
  check(() =>
    oracleAssertion(`checkSelections comparison 6`, () =>
      expect([...rows].sort(order)).toEqual([...expected].sort(order)),
    ),
  )
  if (failures.length)
    throw new AggregateError(failures, `Joined selection refinement`, {
      cause: failures[0],
    })
}

async function runSelectionHistory(
  history: SelectionHistory,
  observeCheckpoint: (state: string) => void = () => {},
): Promise<void> {
  const makeRows = (keys: ReadonlyArray<Key>, unmatched: number) =>
    keys.map((id, index) => ({
      id,
      g: index === 2 ? unmatched : 0,
      route: 1,
      label: history.label,
    }))
  let leftTruth = makeRows(history.leftKeys, 1)
  let rightTruth = makeRows(history.rightKeys, 2)
  const left = createCollection(
    mockSyncCollectionOptions<SelectionRow>({
      id: `selection-left`,
      getKey: (row) => row.id,
      initialData: leftTruth.map((row) => ({ ...row })),
    }),
  )
  const right = createCollection(
    mockSyncCollectionOptions<SelectionRow>({
      id: `selection-right`,
      getKey: (row) => row.id,
      initialData: rightTruth.map((row) => ({ ...row })),
    }),
  )
  const parents = createCollection(
    mockSyncCollectionOptions({
      id: `selection-parents`,
      getKey: (row: { id: number }) => row.id,
      initialData: [{ id: 1 }],
    }),
  )
  const select = (base: ReturnType<typeof joined>) => {
    const overrides = history.collision
      ? {
          $key: `authored-key`,
          $collectionId: `authored-id`,
          $origin: `local`,
          $hasPendingWrites: false,
        }
      : {}
    const projected =
      history.shape === `functional-direct`
        ? base.fn.select(({ l, r }) =>
            history.selected === `left` ? (l ?? r) : (r ?? l),
          )
        : history.shape === `functional-spread`
          ? base.fn.select(({ l, r }) => ({
              ...(history.selected === `left` ? l : r),
              ...overrides,
            }))
          : history.shape === `structured-spread`
            ? base.select(({ l, r }) => ({
                ...(history.selected === `left` ? l : r),
                ...overrides,
              }))
            : base.select(({ l, r }) => (history.selected === `left` ? l : r))
    return (history.composition === `query-ref`
      ? new Query().from({ selected: projected })
      : projected) as unknown as QueryBuilder<SelectionContext>
  }
  function joined() {
    return new Query()
      .from({ l: left })
      .join({ r: right }, ({ l, r }) => eq(l.g, r.g), history.join)
  }
  const root = createLiveQueryCollection({
    query: () => select(joined()),
    ...(history.customKey ? { getKey: selectionCustomKey } : {}),
  })
  const nested = createLiveQueryCollection((q) =>
    q.from({ parent: parents }).select(({ parent }) => {
      const child =
        history.composition === `query-ref`
          ? select(joined()).where(({ selected }) =>
              eq(selected.route, parent.id),
            )
          : select(joined().where(({ l }) => eq(l.route, parent.id)))
      return {
        id: parent.id,
        facade: include(child),
        array: toArray(child),
        materialized: materialize(child),
      }
    }),
  )
  const pending = new Set<Key>()
  const failures: Array<unknown> = []
  const initialKeys = new Map<string, Array<string>>()
  const check = (cut: (typeof selectionCuts)[number]) => {
    const parent = nested.toArray[0]!
    for (const receiver of selectionReceivers) {
      observeCheckpoint(selectionState(history, receiver, cut))
      try {
        const inline = receiver === `array` || receiver === `materialized`
        if (!inline) {
          const keys = [...(receiver === `root` ? root : parent.facade).keys()]
            .map((key) => `${typeof key}:${String(key)}`)
            .sort()
          if (cut === `initial`) initialKeys.set(receiver, keys)
          else if (cut !== `unmatched`)
            oracleAssertion(
              `${receiver}/${cut} same pairs keep their keys`,
              () =>
                expect(
                  keys,
                  `${receiver}/${cut} same pairs keep their keys`,
                ).toEqual(initialKeys.get(receiver)),
            )
        }
        checkSelections(
          receiver === `root`
            ? [...root.entries()]
            : receiver === `facade`
              ? [...parent.facade.entries()]
              : parent[receiver],
          expectedSelections(
            history,
            leftTruth,
            rightTruth,
            pending,
            left.id,
            right.id,
            receiver === `root` ? root.id : parent.facade.id,
            inline,
            receiver !== `root`,
          ),
          inline,
        )
      } catch (error) {
        failures.push(new Error(`${receiver}/${cut}`, { cause: error }))
      }
    }
  }
  let finishMutation = async () => {}
  await withOracleCleanup(async () => {
    await Promise.all([root.preload(), nested.preload()])
    check(`initial`)
    const source = history.selected === `left` ? left : right
    const sourceRows = () =>
      history.selected === `left` ? leftTruth : rightTruth
    // NaN keys stay on sync paths: optimistic admission compares keys with ===.
    const selectedIndex = Number.isNaN(sourceRows()[0]!.id) ? 1 : 0
    const selectedKey = sourceRows()[selectedIndex]!.id
    const updateSelected = (label: string) => {
      const rows = sourceRows().map((row, index) =>
        index === selectedIndex ? { ...row, label } : row,
      )
      if (history.selected === `left`) leftTruth = rows
      else rightTruth = rows
    }
    const heldLabel = `${history.label} held`
    updateSelected(heldLabel)
    pending.add(selectedKey)
    const mutation = source.update(selectedKey, (row) => {
      row.label = heldLabel
    })
    finishMutation = async () => {
      source.utils.resolveSync()
      finishMutation = async () => {}
      await mutation.when(`settled`)
    }
    oracleAssertion(`runSelectionHistory comparison 8`, () =>
      expect(source.get(selectedKey)!.$hasPendingWrites).toBe(true),
    )
    check(`held`)
    const peer = history.selected === `left` ? right : left
    const movePeers = (group: number) => {
      const rows = (history.selected === `left` ? rightTruth : leftTruth).map(
        (row, index) => (index < 2 ? { ...row, g: group } : row),
      )
      peer.utils.begin()
      for (const row of rows.slice(0, 2))
        peer.utils.write({ type: `update`, value: { ...row } })
      peer.utils.commit()
      if (history.selected === `left`) rightTruth = rows
      else leftTruth = rows
    }
    movePeers(3)
    check(`unmatched`)
    movePeers(0)
    check(`rejoined`)
    await finishMutation()
    updateSelected(history.label)
    pending.clear()
    check(`settled`)
    updateSelected(`${history.label} remote`)
    source.utils.begin()
    source.utils.write({
      type: `update`,
      value: { ...sourceRows()[selectedIndex]! },
    })
    source.utils.commit()
    check(`remote`)
    if (failures.length)
      throw new AggregateError(
        failures,
        `Joined source receiving comparisons`,
        {
          cause: failures[0],
        },
      )
  }, [
    () => finishMutation(),
    () => root.cleanup(),
    () => nested.cleanup(),
    () => Promise.all([left.cleanup(), right.cleanup(), parents.cleanup()]),
  ])
}

declareOracle({
  model: [expectedSelections],
  check: [checkSelections, runSelectionHistory],
  grammar: [selectionForms, selectionHistoryArbitrary],
})
// The old aggregate ledger counted each form/receiver/cut reached by the finite
// matrix. The native finite property preserves every form. Each history checks
// its own receiver/cut product at the same production boundaries, so all 4,608
// original matrix cells remain required without repeating the full matrix in
// every generated history.
async function judgeSelectionHistory(history: SelectionHistory): Promise<void> {
  const reached = new Set<string>()
  await runSelectionHistory(history, (state) => reached.add(state))
  for (const receiver of selectionReceivers) {
    for (const cut of selectionCuts) {
      const state = selectionState(history, receiver, cut)
      oracleAssertion(`joined selection checkpoint ${state}`, () =>
        expect(reached.has(state), state).toBe(true),
      )
    }
  }
}

const selectionLaw = {
  statement: `Whole-source selections preserve joined occurrences, public key identity and source attribution at each receiving cut.`,
  authority: `docs/guides/live-queries.md, Joins/getKey, and the November 5 metadata decision stated above.`,
  limits: `The unchanged direct/QueryRef, selection and custom-key forms across root, facade and inline receivers with one held optimistic mutation.`,
  owner: `Whole-source joined occurrences`,
}
const driveSelectionHistory = (
  plan: { history: SelectionHistory },
  observe: Parameters<typeof recordAssertionJudgment>[2],
) =>
  recordAssertionJudgment(selectionProperty, plan, observe, () =>
    judgeSelectionHistory(plan.history),
  )

oracleProperty({
  id: `join-result-key.whole-source-matrix`,
  law: selectionLaw,
  histories: selectionExamples,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: driveSelectionHistory,
  check: forwardAssertionJudgment,
})

oracleProperty({
  id: selectionProperty,
  law: selectionLaw,
  histories: {
    arbitrary: selectionHistoryArbitrary,
    runs: 80,
    fixedSeeds: [15811743],
    states: [],
    constructed: [],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: driveSelectionHistory,
  check: forwardAssertionJudgment,
})
