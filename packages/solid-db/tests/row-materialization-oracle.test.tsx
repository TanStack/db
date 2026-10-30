/**
 * Solid's fine-grained result contract keeps consumers of unchanged values
 * quiet. The existing Fine-grained reactivity tests establish this for scalar
 * row fields; this receiving oracle crosses nested array elements and binding
 * lifetime. An identical source container has not changed merely because a
 * peer row or another field changed. Materializing a row must not add that
 * row's native store dependencies to the query-input dependency set.
 *
 * The independent model counts admissions of new element objects. The grammar
 * alternates two keys, retains nested inputs through scalar edits, introduces a
 * new element, and then edits a peer again. Resize histories grow, shrink and
 * empty an existing array while observing its consumers. All three inputs run on the
 * real Solid host, with plain and native-store payloads and one or two array
 * levels. Comparison follows the host's settled cut. This law does not promise
 * identity for an element whose source object changed, live mutable-source
 * values, arbitrary getters, cyclic updates, or a wall-clock work bound.
 */
import { createCollection } from '@tanstack/db'
import { render, waitFor } from '@solidjs/testing-library'
import { For, createRenderEffect, createRoot, createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import { expect, it, vi } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery'
import { createRowStore } from '../src/store-materialization'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { ScenarioLifetime } from '../../db/tests/conformance/scenario-lifetime'
import type { InitialQueryBuilder } from '@tanstack/db'

type Element = { value: number }
type Row = {
  id: string
  value: number
  tags: Array<Element> | { items: Array<Element> }
  payload: { value: number }
}
type History = {
  input: `callback` | `config` | `collection`
  nested: boolean
  native: boolean
  law: `identity` | `lifetime` | `reorder` | `resize`
}

// Unchanged source elements retain the identity and admission counts observed
// at their admission cut. Changed sources may reuse or replace an owned element.
type Admission = { element: Element; mounts: number; reads: number }

function* histories(): Generator<History> {
  for (const input of [`callback`, `config`, `collection`] as const)
    for (const nested of [false, true])
      for (const native of [false, true])
        for (const law of [
          `identity`,
          `lifetime`,
          `reorder`,
          `resize`,
        ] as const)
          yield { input, nested, native, law }
}

function elements(row: Row): Array<Element> {
  return Array.isArray(row.tags) ? row.tags : row.tags.items
}

function compare(
  current: Row,
  expectedValue: number,
  admitted: Admission,
  mounts: number,
  reads: number,
) {
  expect(elements(current)[0]!.value, `current element value`).toBe(
    expectedValue,
  )
  expect(mounts, `unchanged elements do not remount`).toBe(admitted.mounts)
  expect(reads, `unchanged element references do not invalidate effects`).toBe(
    admitted.reads,
  )
  expect(elements(current)[0], `unchanged nested element identity`).toBe(
    admitted.element,
  )
}

// The resize model is the admitted scalar sequence. Both the reactive map
// consumer and rendered children must follow it at each host checkpoint.
function compareArray(
  observed: Array<number>,
  rendered: string | null,
  admitted: Array<number>,
) {
  expect(observed, `array consumers follow current membership`).toEqual(
    admitted,
  )
  expect(rendered, `rendered array membership`).toBe(admitted.join(``))
}

async function runHistory(history: History) {
  const reach = createOracleReach(
    `solid.materialization.${history.input}.${history.nested}.${history.native}.${history.law}`,
    history.law === `reorder` || history.law === `resize`
      ? [history.law === `reorder` ? `source-reorder` : `array-resize`]
      : [
          `peer-edit`,
          `same-row-scalar-edit`,
          `element-replacement`,
          `source-only-write`,
        ],
  )
  reach.beginHistory()
  const resources = new ScenarioLifetime()
  await resources.run(async () => {
    const [nativePayload, setNativePayload] = createStore({ value: 0 })
    const tags =
      history.law === `reorder` ? [{ value: 0 }, { value: 10 }] : [{ value: 0 }]
    const rows: Array<Row> = [`a`, `b`].map((id) => ({
      id,
      value: 0,
      tags: history.nested ? { items: tags } : tags,
      payload: history.native ? nativePayload : { value: 0 },
    }))
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `materialization-${history.input}-${history.nested}-${history.native}`,
        getKey: (row) => row.id,
        initialData: rows,
        rowUpdateMode: `full`,
      }),
    )
    try {
      const subscriptions = vi.spyOn(source, `subscribeChanges`)
      resources.defer(() => subscriptions.mockRestore())
      let view: ReturnType<typeof render> | undefined
      let disposeEffects: (() => void) | undefined
      resources.defer(() => view?.unmount())
      resources.defer(() => disposeEffects?.())
      const query = createRoot((dispose) => {
        resources.defer(dispose)
        const build = (q: InitialQueryBuilder) =>
          q.from({ row: source }).select(({ row }) => ({ ...row }))
        return history.input === `collection`
          ? useLiveQuery(() => source)
          : history.input === `config`
            ? useLiveQuery(() => ({ query: build }))
            : useLiveQuery(build)
      })
      resources.defer(() => query.collection.cleanup())
      await waitFor(() => expect(query()).toHaveLength(2))
      const current = () => query().find((row) => row.id === `a`)!
      if (history.law === `resize`) {
        let observed: Array<number> = []
        createRoot((dispose) => {
          resources.defer(dispose)
          createRenderEffect(() => {
            observed = elements(current()).map((element) => element.value)
          })
        })
        view = render(() => (
          <For each={elements(current())}>
            {(element) => <span>{element.value}</span>}
          </For>
        ))
        // Growth must notify length readers before a later shrink can conceal
        // it. Repeated growth also checks objects admitted by earlier updates.
        for (const values of [[0, 1], [0], [0, 2, 3], []]) {
          const admitted = values.map((value) => ({ value }))
          const next = {
            ...rows[0]!,
            value: rows[0]!.value + 1,
            tags: history.nested ? { items: admitted } : admitted,
          }
          rows[0] = next
          source.utils.begin()
          source.utils.write({ type: `update`, value: next })
          source.utils.commit()
          await waitFor(() => expect(current().value).toBe(next.value))
          compareArray(observed, view.container.textContent, values)
          reach.reach(`array-resize`)
        }
        return
      }
      if (history.law === `reorder`) {
        const initialElements = [...elements(current())]
        let admissions = 0
        view = render(() => (
          <For each={elements(current())}>
            {(element) => {
              admissions++
              return <span>{element.value}</span>
            }}
          </For>
        ))
        // Permuting identical source elements admits no new element. Repeating
        // the permutation distinguishes stable source identity from index merges.
        for (let turn = 0; turn < 2; turn++) {
          const reordered = turn === 0 ? [...tags].reverse() : tags
          const next = {
            ...rows[0]!,
            value: turn + 1,
            tags: history.nested ? { items: reordered } : reordered,
          }
          source.utils.begin()
          source.utils.write({ type: `update`, value: next })
          source.utils.commit()
          await waitFor(() => expect(current().value).toBe(next.value))
          expect(
            elements(current())[0],
            `source element identity follows reorder`,
          ).toBe(initialElements[turn === 0 ? 1 : 0])
          expect(admissions, `reordering does not admit new elements`).toBe(
            tags.length,
          )
          reach.reach(`source-reorder`)
        }
        return
      }
      const initial = elements(current())[0]!
      let mounts = 0
      let reads = 0
      let admitted: Admission = { element: initial, mounts: 1, reads: 1 }
      if (history.law === `identity`) {
        view = render(() => (
          <For each={elements(current())}>
            {(element) => {
              mounts++
              return <span>{element.value}</span>
            }}
          </For>
        ))
        createRoot((dispose) => {
          disposeEffects = dispose
          createRenderEffect(() => {
            void elements(current())[0]
            reads++
          })
        })
        compare(current(), 0, admitted, mounts, reads)
      }
      const write = (index: number, replacement: boolean) => {
        const previous = rows[index]!
        const next = { ...previous, value: previous.value + 1 }
        if (replacement) {
          const replacementItems = [{ value: 1 }]
          next.tags = history.nested
            ? { items: replacementItems }
            : replacementItems
        }
        rows[index] = next
        source.utils.begin()
        source.utils.write({ type: `update`, value: next })
        source.utils.commit()
      }
      for (const [index, replacement] of [
        [1, false],
        [0, false],
        [0, true],
        [1, false],
      ] as const) {
        write(index, replacement)
        await waitFor(() =>
          expect(query().find((row) => row.id === rows[index]!.id)!.value).toBe(
            rows[index]!.value,
          ),
        )
        const replaced = rows[0]!.value >= 2
        if (history.law === `identity`) {
          if (replacement) {
            // Only current values are promised at a changed-source cut. The
            // next peer edit must preserve whichever identity was admitted.
            expect(elements(current())[0]!.value).toBe(1)
            expect(view!.container.textContent).toBe(`1`)
            admitted = { element: elements(current())[0]!, mounts, reads }
          } else compare(current(), replaced ? 1 : 0, admitted, mounts, reads)
        }
        reach.reach(
          replacement
            ? `element-replacement`
            : index === 0
              ? `same-row-scalar-edit`
              : `peer-edit`,
        )
      }
      // A native source write supplies a tracked read premise, not a Collection
      // change. Its liveness policy is outside this law; binding lifetime is not.
      const starts = subscriptions.mock.calls.length
      setNativePayload(`value`, 1)
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(
        subscriptions.mock.calls.length,
        `row reads cannot rebind the hook`,
      ).toBe(starts)
      reach.reach(`source-only-write`)
    } finally {
      resources.defer(() => source.cleanup())
    }
  })
  reach.assertReached()
}

it.each([...histories()])(
  `preserves $law through $input, nested=$nested native=$native`,
  runHistory,
)

declareOracle({
  grammar: [histories],
  check: [compare, compareArray],
})

/**
 * The materializer's own data-field boundary preserves descriptor visibility
 * and supplies native shape notifications. This is a helper-only law: Core
 * public row snapshots copy enumerable root fields before hook admission.
 * These histories therefore establish no public descriptor-admission promise.
 * The existing supplied-Collection shape test covers public field admission.
 *
 * The model retains only a descriptor's enumerable flag. An Object.keys
 * consumer of the stable root must see that flag at every settled host cut.
 * Payload identity, scalar value, and source descriptors remain unchanged.
 * Accessors, symbols, frozen descriptors, and in-place source edits are outside
 * this family. Each update admits a fresh root with an immutable payload.
 */
function* visibilityHistories() {
  for (const kind of [
    `undefined`,
    `null`,
    `scalar`,
    `object`,
    `array`,
    `native`,
  ] as const)
    for (const initial of [false, true]) yield { kind, initial }
}

function compareVisibility(
  observed: Array<string>,
  current: object,
  visible: boolean,
) {
  const expected = visible ? [`payload`] : []
  expect(
    observed,
    `enumeration observer follows descriptor visibility`,
  ).toEqual(expected)
  expect(Object.keys(current), `current descriptor visibility`).toEqual(
    expected,
  )
}

it.each([...visibilityHistories()])(
  `notifies helper visibility for $kind, initially=$initial`,
  async ({ kind, initial }) => {
    const reach = createOracleReach(
      `solid.materialization.visibility.${kind}.${initial}`,
      [`unchanged`, `hidden`, `visible`, `visibility-restored`],
    )
    reach.beginHistory()
    const payload =
      kind === `undefined`
        ? undefined
        : kind === `null`
          ? null
          : kind === `scalar`
            ? 1
            : kind === `array`
              ? [1]
              : kind === `native`
                ? createStore({ value: 1 })[0]
                : { value: 1 }
    const sourceRow = (visible: boolean) =>
      Object.defineProperty({ payload }, `payload`, { enumerable: visible })
    const resources = new ScenarioLifetime()
    await resources.run(async () => {
      const original = sourceRow(initial)
      const entry = createRowStore(original)
      const row = entry.value
      const admitted = row.payload
      let observed: Array<string> = []
      createRoot((dispose) => {
        resources.defer(dispose)
        createRenderEffect(() => {
          observed = Object.keys(row)
        })
      })
      compareVisibility(observed, row, initial)
      for (const visible of [initial, !initial, initial, !initial]) {
        entry.update(sourceRow(visible))
        await new Promise<void>((resolve) => queueMicrotask(resolve))
        compareVisibility(observed, row, visible)
        expect(entry.value, `ordinary root identity`).toBe(row)
        expect(row.payload, `visibility keeps the admitted payload`).toBe(
          admitted,
        )
        expect(original.payload, `source payload remains borrowed`).toBe(
          payload,
        )
        expect(Object.keys(original)).toEqual(initial ? [`payload`] : [])
        reach.reach(visible ? `visible` : `hidden`)
      }
      reach.reach(`unchanged`)
      reach.reach(`visibility-restored`)
    })
    reach.assertReached()
  },
)

declareOracle({
  grammar: [visibilityHistories],
  check: [compareVisibility],
})

/**
 * Maintainer decision, 2026-10-30: preserve live row getters. A signal change
 * must reach a getter consumer without a Collection publication. Getter-returned
 * objects still belong to the source; reconciling a later row cannot edit them.
 * These are different observations: liveness follows the current signal, while
 * each retained source getter keeps its admitted scalar version.
 */
type GetterHistory = {
  input: History[`input`]
  object: boolean
  later: boolean
  stable: boolean
}
type Label = string | { locale: string; value: number }
type GetterRow = { id: string; value: number; config: { label?: Label } | null }

function expectedLabel(object: boolean, locale: string, value: number): Label {
  return object ? { locale, value } : `${locale}:${value}`
}

function* getterHistories(): Generator<GetterHistory> {
  for (const input of [`callback`, `config`, `collection`] as const)
    for (const object of [false, true])
      for (const later of [false, true])
        for (const stable of [false, true])
          yield { input, object, later, stable }
}

function compareLabel(
  actual: Label | undefined,
  history: GetterHistory,
  locale: string,
  value: number,
) {
  expect(actual, `live getter at the host cut`).toEqual(
    expectedLabel(history.object, locale, value),
  )
}

// Every history crosses a source replacement with subsequent signal writes.
// Initial and later container admission use the same model and observation.
// The getter is nested: spreading a root getter in a query projection would
// evaluate it in Core before it could reach the framework adapter boundary.
async function runGetterHistory(history: GetterHistory) {
  const reach = createOracleReach(
    `solid.getter.${history.input}.${history.object}.${history.later}.${history.stable}`,
    [
      `getter-admission`,
      `source-replacement`,
      `signal-only-write`,
      `retained-getter`,
      `getter-omission`,
      `getter-readmission`,
    ],
  )
  reach.beginHistory()
  const resources = new ScenarioLifetime()
  await resources.run(async () => {
    const [locale, setLocale] = createSignal(`en`)
    const stableValues = new Map(
      [`en`, `fr`, `de`].map((language) => [
        language,
        expectedLabel(history.object, language, 0),
      ]),
    )
    const admitted: Array<{ value: number; config: { label: Label } }> = []
    const sourceRow = (value: number): GetterRow => {
      const values = history.stable
        ? stableValues
        : new Map(
            [`en`, `fr`, `de`].map((language) => [
              language,
              expectedLabel(history.object, language, value),
            ]),
          )
      const config = {
        data:
          value === 0
            ? values.get(`en`)!
            : expectedLabel(history.object, `en`, value),
        get label() {
          return values.get(locale())!
        },
      }
      admitted.push({ value: history.stable ? 0 : value, config })
      return { id: `a`, value, config }
    }
    const source = createCollection(
      mockSyncCollectionOptions<GetterRow>({
        id: `getter-${history.input}-${history.object}-${history.later}`,
        getKey: (row) => row.id,
        initialData: [
          history.later ? { id: `a`, value: -1, config: null } : sourceRow(0),
        ],
        rowUpdateMode: `full`,
      }),
    )
    try {
      const subscriptions = vi.spyOn(source, `subscribeChanges`)
      resources.defer(() => subscriptions.mockRestore())
      const query = createRoot((dispose) => {
        resources.defer(dispose)
        const build = (q: InitialQueryBuilder) =>
          q.from({ row: source }).select(({ row }) => ({ ...row }))
        return history.input === `collection`
          ? useLiveQuery(() => source)
          : history.input === `config`
            ? useLiveQuery(() => ({ query: build }))
            : useLiveQuery(build)
      })
      resources.defer(() => query.collection.cleanup())
      await waitFor(() => expect(query()).toHaveLength(1))
      let observed: Label | undefined
      let member = false
      let keys: Array<string> = []
      createRoot((dispose) => {
        resources.defer(dispose)
        createRenderEffect(() => {
          observed = query()[0]?.config?.label
        })
        createRenderEffect(() => {
          const config = query()[0]?.config
          member = config !== null && config !== undefined && `label` in config
          keys = config ? Object.keys(config) : []
        })
      })
      for (let value = history.later ? 0 : 1; value <= 2; value++) {
        source.utils.begin()
        source.utils.write({ type: `update`, value: sourceRow(value) })
        source.utils.commit()
        await waitFor(() => expect(query()[0]!.value).toBe(value))
        reach.reach(value === 0 ? `getter-admission` : `source-replacement`)
        if (!history.later) reach.reach(`getter-admission`)
        const labelVersion = history.stable ? 0 : value
        compareLabel(observed, history, locale(), labelVersion)
        const language = value % 2 === 0 ? `fr` : `de`
        const starts = subscriptions.mock.calls.length
        setLocale(language)
        await new Promise<void>((resolve) => queueMicrotask(resolve))
        reach.reach(`signal-only-write`)
        compareLabel(observed, history, language, labelVersion)
        expect(
          subscriptions.mock.calls.length,
          `getter reads cannot rebind the hook`,
        ).toBe(starts)
        for (const saved of admitted)
          compareLabel(saved.config.label, history, language, saved.value)
        reach.reach(`retained-getter`)
      }
      source.utils.begin()
      source.utils.write({
        type: `update`,
        value: { id: `a`, value: 3, config: {} },
      })
      source.utils.commit()
      await waitFor(() => expect(query()[0]!.value).toBe(3))
      expect(observed, `omitted getter value`).toBeUndefined()
      expect(member, `omitted getter membership`).toBe(false)
      expect(keys, `omitted getter enumeration`).toEqual([])
      reach.reach(`getter-omission`)
      source.utils.begin()
      source.utils.write({ type: `update`, value: sourceRow(4) })
      source.utils.commit()
      await waitFor(() => expect(query()[0]!.value).toBe(4))
      compareLabel(observed, history, locale(), history.stable ? 0 : 4)
      setLocale(`de`)
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      compareLabel(observed, history, `de`, history.stable ? 0 : 4)
      expect(member, `readmitted getter membership`).toBe(true)
      expect(keys, `readmitted getter enumeration`).toContain(`label`)
      reach.reach(`getter-readmission`)
    } finally {
      resources.defer(() => source.cleanup())
    }
  })
  reach.assertReached()
}

it.each([...getterHistories()])(
  `preserves live getters through $input, object=$object later=$later stable=$stable`,
  runGetterHistory,
)

declareOracle({
  model: [expectedLabel],
  grammar: [getterHistories],
  check: [compareLabel],
})

/**
 * Maintainer decision, 2026-10-30: shared acyclic graphs must materialize
 * efficiently. This cost judgment counts source enumerations, not elapsed time.
 * This bounded witness allows 32 enumerations per distinct admitted container.
 * It includes source and owned nodes, observer startup and Core's comparison.
 * The generous regression budget distinguishes linear passes from path
 * expansion; it is not a public performance SLO or a bound on getter bodies.
 * Cyclic support remains undecided. The supplied-Collection input isolates this
 * materialization boundary from live-query graph hashing and query evaluation.
 */
type Graph = { value: number } | { left: Graph; right: Graph }
function* graphHistories() {
  for (const depth of [0, 1, 4, 8, 12])
    for (const shared of [false, true]) yield { depth, shared, crossed: false }
  for (const depth of [4, 6, 8]) yield { depth, shared: true, crossed: true }
}
function enumerationBudget(containers: number): number {
  return containers * 32
}
// The model forgets sharing identity but retains every public value path.
function semanticGraph(
  level: number,
  value: number,
  shared: boolean,
  crossed: boolean,
): Graph {
  if (crossed) return semanticGraph(level * 2, value, true, false)
  if (!level) return { value }
  const child = semanticGraph(level - 1, value, shared, false)
  return { left: child, right: shared ? child : { value } }
}

export function compareGraphValues(
  actual: unknown,
  expected: Graph,
  seen = new WeakMap<object, Set<object>>(),
): void {
  expect(actual).not.toBeNull()
  expect(typeof actual).toBe(`object`)
  expect(Array.isArray(actual)).toBe(false)
  const record = actual as Record<string, unknown>
  const pairs = seen.get(record) ?? new Set<object>()
  if (pairs.has(expected)) return
  pairs.add(expected)
  seen.set(record, pairs)
  if (`value` in expected) {
    expect(Object.keys(record)).toEqual([`value`])
    expect(record.value, `complete graph leaf`).toBe(expected.value)
  } else {
    expect(new Set(Object.keys(record))).toEqual(new Set([`left`, `right`]))
    compareGraphValues(record.left, expected.left, seen)
    compareGraphValues(record.right, expected.right, seen)
  }
}

function compareGraph(
  actual: Graph,
  expected: Graph,
  visits: number,
  containers: number,
) {
  // Counts enter by value before the checker traverses any observation.
  expect(
    visits,
    `source enumeration scales with distinct containers`,
  ).toBeLessThanOrEqual(enumerationBudget(containers))
  compareGraphValues(actual, expected)
}

// A wrong observation changes one interior path while keeping the two extreme
// paths intact. The same complete comparison must reject it at every crossed
// depth; a checker of only all-left/all-right leaves would accept it.
it.each([...graphHistories()].filter((history) => history.crossed))(
  `rejects mixed-path corruption at crossed depth=$depth`,
  ({ depth, shared, crossed }) => {
    const expected = semanticGraph(depth, 0, shared, crossed)
    function corrupted(graph: Graph, remaining: number): Graph {
      if (`value` in graph) return { value: 99 }
      const side = remaining === depth * 2 - 1 ? `right` : `left`
      return { ...graph, [side]: corrupted(graph[side], remaining - 1) }
    }
    expect(() =>
      compareGraphValues(corrupted(expected, depth * 2), expected),
    ).toThrow()
  },
)

async function runGraphHistory({
  depth,
  shared,
  crossed,
}: {
  depth: number
  shared: boolean
  crossed: boolean
}) {
  const reach = createOracleReach(`solid.graph.${depth}.${shared}.${crossed}`, [
    `graph-admission`,
    `graph-replacement`,
    `branch-divergence`,
    ...(crossed ? [`crossed-sharing`] : []),
  ])
  reach.beginHistory()
  const resources = new ScenarioLifetime()
  await resources.run(async () => {
    let visits = 0
    let containers = 0
    const ownKeys = Object.keys
    const reflectKeys = Reflect.ownKeys
    const count = (keys: Array<PropertyKey>) => {
      if (
        keys.includes(`left`) ||
        keys.includes(`right`) ||
        (keys.includes(`value`) && !keys.includes(`id`))
      )
        visits++
    }
    const enumerations = vi
      .spyOn(Object, `keys`)
      .mockImplementation((value) => {
        const keys = ownKeys(value)
        count(keys)
        return keys
      })
    resources.defer(() => enumerations.mockRestore())
    const reflected = vi
      .spyOn(Reflect, `ownKeys`)
      .mockImplementation((value) => {
        const keys = reflectKeys(value)
        count(keys)
        return keys
      })
    resources.defer(() => reflected.mockRestore())
    const makeGraph = (level: number, value: number): Graph => {
      if (crossed) {
        const counted = (node: Graph): Graph => {
          containers++
          return new Proxy(node, {
            ownKeys(target) {
              visits++
              return Reflect.ownKeys(target)
            },
          })
        }
        const tail = (remaining: number, terminal: Graph): Graph => {
          if (!remaining) return terminal
          const child = tail(remaining - 1, terminal)
          return counted({ left: child, right: child })
        }
        const tree = (remaining: number, terminal: () => Graph): Graph =>
          remaining
            ? counted({
                left: tree(remaining - 1, terminal),
                right: tree(remaining - 1, terminal),
              })
            : terminal()
        // The old and new graphs share at opposite ends. Aligned sharing
        // cannot reveal an algorithm that enumerates their pair product.
        return value === 0
          ? tree(level, () => tail(level, counted({ value })))
          : tail(
              level,
              tree(level, () => counted({ value })),
            )
      }
      const child = level ? makeGraph(level - 1, value) : undefined
      const target: Graph = child
        ? { left: child, right: shared ? child : { value } }
        : { value }
      containers++
      if (child && !shared) containers++
      return new Proxy(target, {
        ownKeys(node) {
          visits++
          return Reflect.ownKeys(node)
        },
      })
    }
    type GraphRow = { id: string; value: number; config: Graph }
    const source = createCollection(
      mockSyncCollectionOptions<GraphRow>({
        id: `graph-${depth}-${shared}`,
        getKey: (row) => row.id,
        initialData: [{ id: `a`, value: 0, config: makeGraph(depth, 0) }],
        rowUpdateMode: `full`,
      }),
    )
    try {
      visits = 0
      const query = createRoot((dispose) => {
        resources.defer(dispose)
        return useLiveQuery(() => source)
      })
      resources.defer(() => query.collection.cleanup())
      await waitFor(() => expect(query()).toHaveLength(1))
      compareGraph(
        query()[0]!.config,
        semanticGraph(depth, 0, shared, crossed),
        visits,
        containers,
      )
      reach.reach(`graph-admission`)
      for (const value of [1, 2]) {
        const config =
          value === 1
            ? makeGraph(depth, value)
            : { left: makeGraph(depth, value), right: makeGraph(depth, 1) }
        if (value === 2) containers++
        visits = 0
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: { id: `a`, value, config },
        })
        source.utils.commit()
        await waitFor(() => expect(query()[0]!.value).toBe(value))
        compareGraph(
          query()[0]!.config,
          value === 1
            ? semanticGraph(depth, value, shared, crossed)
            : {
                left: semanticGraph(depth, value, shared, crossed),
                right: semanticGraph(depth, 1, shared, crossed),
              },
          visits,
          containers,
        )
        reach.reach(value === 1 ? `graph-replacement` : `branch-divergence`)
        if (crossed && value === 1) reach.reach(`crossed-sharing`)
      }
    } finally {
      resources.defer(() => source.cleanup())
    }
  })
  reach.assertReached()
}
it.each([...graphHistories()])(
  `materializes depth=$depth shared=$shared crossed=$crossed graphs`,
  runGraphHistory,
)
declareOracle({
  model: [enumerationBudget, semanticGraph],
  grammar: [graphHistories],
  check: [compareGraph, compareGraphValues],
})
