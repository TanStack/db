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
 * new element, and then edits a peer again. Reorder histories compare every
 * current value and rendered child while retaining element identities. Native
 * descendants also cross ordinary/native parent replacements in both directions,
 * with same-parent controls. Resize histories grow, shrink and empty arrays.
 * The shared snapshot owner's immutable-update law also preserves source values.
 * All three inputs run on the real Solid host at one or two array levels.
 * Signal-driven query inputs also change their selected value and must rebind.
 * This distinguishes input tracking from incidental native row reads.
 * Comparison follows the host's settled cut. This law does not promise
 * identity for an element whose source object changed, live mutable-source
 * values, arbitrary getters, cyclic updates, or a wall-clock work bound.
 */
import { createCollection } from '@tanstack/db'
import { render, waitFor } from '@solidjs/testing-library'
import { For, createRenderEffect, createRoot, createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import { expect, vi } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery'
import { createRowStore } from '../src/store-materialization'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { oracleProperty } from '../../db/tests/oracle-config'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { ScenarioLifetime } from '../../db/tests/conformance/scenario-lifetime'
import type { InitialQueryBuilder } from '@tanstack/db'

// Keep the existing independent assertions at their authored host cuts. The
// adapter transports their judgment without serializing live getters, callable
// identities or native stores, and leaves runtime and cleanup errors intact.
type Observer = (checkpoint: string, value: unknown) => void

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
  reactiveInput?: boolean
  nativeElements?: boolean
  initialParent?: boolean
  nextParent?: boolean
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
        ] as const) {
          yield { input, nested, native, law }
          if (input !== `collection` && law === `lifetime`)
            yield { input, nested, native, law, reactiveInput: true }
        }
}

// Replacing a parent can expose the same native child through raw descriptors
// or public store reads. Those representations cannot change child admission.
// Same-parent controls distinguish that transition from native support itself.
function* nativeParentHistories(): Generator<History> {
  for (const input of [`callback`, `config`, `collection`] as const)
    for (const nested of [false, true])
      for (const initialParent of [false, true])
        for (const nextParent of [false, true])
          yield {
            input,
            nested,
            native: true,
            law: `reorder`,
            nativeElements: true,
            initialParent,
            nextParent,
          }
}

function arrayParent(
  items: Array<Element>,
  nested: boolean,
  native: boolean,
): Row[`tags`] {
  const parent = nested ? { items } : items
  return native ? createStore(parent)[0] : parent
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
  oracleAssertion(`current element value`, () =>
    expect(elements(current)[0]!.value, `current element value`).toBe(
      expectedValue,
    ),
  )
  oracleAssertion(`unchanged elements do not remount`, () =>
    expect(mounts, `unchanged elements do not remount`).toBe(admitted.mounts),
  )
  oracleAssertion(
    `unchanged element references do not invalidate effects`,
    () =>
      expect(
        reads,
        `unchanged element references do not invalidate effects`,
      ).toBe(admitted.reads),
  )
  oracleAssertion(`unchanged nested element identity`, () =>
    expect(elements(current)[0], `unchanged nested element identity`).toBe(
      admitted.element,
    ),
  )
}

// The resize model is the admitted scalar sequence. Both the reactive map
// consumer and rendered children must follow it at each host checkpoint.
function compareArray(
  observed: Array<number>,
  rendered: string | null,
  admitted: Array<number>,
) {
  oracleAssertion(`array consumers follow current membership`, () =>
    expect(observed, `array consumers follow current membership`).toEqual(
      admitted,
    ),
  )
  oracleAssertion(`rendered array membership`, () =>
    expect(rendered, `rendered array membership`).toBe(admitted.join(``)),
  )
}

async function runHistory(history: History, observe: Observer) {
  const parentState =
    history.initialParent === history.nextParent
      ? `same-parent-control`
      : `parent-transition`
  const requiredStates =
    history.law === `reorder` || history.law === `resize`
      ? [
          history.law === `reorder` ? `source-reorder` : `array-resize`,
          ...(history.nativeElements
            ? [`native-element-admission`, `source-identity-reuse`, parentState]
            : []),
        ]
      : [
          `peer-edit`,
          `same-row-scalar-edit`,
          `element-replacement`,
          `source-only-write`,
          ...(history.reactiveInput ? [`query-input-change`] : []),
        ]
  const entered = new Set<string>()
  const resources = new ScenarioLifetime()
  await resources.run(async () => {
    const [nativePayload, setNativePayload] = createStore({ value: 0 })
    const [inputVersion, setInputVersion] = createSignal(0)
    const initialValues = history.law === `reorder` ? [0, 10] : [0]
    const tags = initialValues.map((value) =>
      history.nativeElements ? createStore({ value })[0] : { value },
    )
    // Keep the native public references before a parent store unwraps its input.
    const sourceElements = [...tags]
    const initialTags = history.nativeElements
      ? arrayParent([...tags], history.nested, history.initialParent ?? false)
      : tags
    const rows: Array<Row> = [`a`, `b`].map((id) => ({
      id,
      value: 0,
      tags: history.nativeElements
        ? initialTags
        : history.nested
          ? { items: tags }
          : tags,
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
        const build = (q: InitialQueryBuilder) => {
          if (!history.reactiveInput)
            return q.from({ row: source }).select(({ row }) => ({ ...row }))
          const version = inputVersion()
          return q
            .from({ row: source })
            .select(({ row }) => ({ ...row, inputVersion: version }))
        }
        return history.input === `collection`
          ? useLiveQuery(() => source)
          : history.input === `config`
            ? useLiveQuery(() => ({ query: build }))
            : useLiveQuery(build)
      })
      resources.defer(() => query.collection.cleanup())
      await waitFor(() =>
        oracleAssertion(`expect(query()).toHaveLength(2)`, () =>
          expect(query()).toHaveLength(2),
        ),
      )
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
          await waitFor(() =>
            oracleAssertion(`expect(current().value).toBe(next.value)`, () =>
              expect(current().value).toBe(next.value),
            ),
          )
          compareArray(observed, view.container.textContent, values)
          entered.add(`array-resize`)
        }
        return
      }
      if (history.law === `reorder`) {
        const initialElements = [...elements(current())]
        const initialSources = elements(source.get(`a`)!)
        oracleAssertion(`complete admitted source values`, () =>
          expect(
            initialSources.map((element) => element.value),
            `complete admitted source values`,
          ).toEqual(initialValues),
        )
        if (history.nativeElements) {
          oracleAssertion(`complete source child admission`, () =>
            expect(
              initialSources,
              `complete source child admission`,
            ).toHaveLength(sourceElements.length),
          )
          for (const [index, element] of initialSources.entries())
            oracleAssertion(`source admitted the native child`, () =>
              expect(element, `source admitted the native child`).toBe(
                sourceElements[index],
              ),
            )
          entered.add(`native-element-admission`)
        }
        let admissions = 0
        view = render(() => (
          <For each={elements(current())}>
            {(element) => {
              admissions++
              return <span>{element.value}</span>
            }}
          </For>
        ))
        compareArray(
          elements(current()).map((element) => element.value),
          view.container.textContent,
          initialValues,
        )
        // Permuting identical source elements admits no new element. Repeating
        // the permutation distinguishes stable source identity from index merges.
        for (let turn = 0; turn < 2; turn++) {
          const reordered =
            turn === 0
              ? [...sourceElements].reverse()
              : history.nativeElements
                ? [...sourceElements]
                : tags
          const expectedValues =
            turn === 0 ? [...initialValues].reverse() : initialValues
          const expectedElements =
            turn === 0 ? [...initialElements].reverse() : initialElements
          const next = {
            ...rows[0]!,
            value: turn + 1,
            tags: arrayParent(
              reordered,
              history.nested,
              (turn === 0 ? history.nextParent : history.initialParent) ??
                false,
            ),
          }
          source.utils.begin()
          source.utils.write({ type: `update`, value: next })
          source.utils.commit()
          await waitFor(() =>
            oracleAssertion(`expect(current().value).toBe(next.value)`, () =>
              expect(current().value).toBe(next.value),
            ),
          )
          const admittedSources = elements(source.get(`a`)!)
          oracleAssertion(`complete unchanged source values`, () =>
            expect(
              admittedSources.map((element) => element.value),
              `complete unchanged source values`,
            ).toEqual(expectedValues),
          )
          if (history.nativeElements) {
            const expectedSources =
              turn === 0 ? [...sourceElements].reverse() : sourceElements
            oracleAssertion(`complete unchanged source child admission`, () =>
              expect(
                admittedSources,
                `complete unchanged source child admission`,
              ).toHaveLength(expectedSources.length),
            )
            for (const [index, element] of admittedSources.entries())
              oracleAssertion(
                `source retained the unchanged native child`,
                () =>
                  expect(
                    element,
                    `source retained the unchanged native child`,
                  ).toBe(expectedSources[index]),
              )
            entered.add(`source-identity-reuse`)
            entered.add(parentState)
          }
          compareArray(
            elements(current()).map((element) => element.value),
            view.container.textContent,
            expectedValues,
          )
          for (const [index, element] of elements(current()).entries())
            oracleAssertion(`source element identity follows reorder`, () =>
              expect(element, `source element identity follows reorder`).toBe(
                expectedElements[index],
              ),
            )
          oracleAssertion(`reordering does not admit new elements`, () =>
            expect(admissions, `reordering does not admit new elements`).toBe(
              tags.length,
            ),
          )
          entered.add(`source-reorder`)
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
          oracleAssertion(
            `expect(query().find((row) => row.id === rows[index]!.id)!.value).toBe( rows[index]!.value, )`,
            () =>
              expect(
                query().find((row) => row.id === rows[index]!.id)!.value,
              ).toBe(rows[index]!.value),
          ),
        )
        const replaced = rows[0]!.value >= 2
        if (history.law === `identity`) {
          if (replacement) {
            // Only current values are promised at a changed-source cut. The
            // next peer edit must preserve whichever identity was admitted.
            oracleAssertion(
              `expect(elements(current())[0]!.value).toBe(1)`,
              () => expect(elements(current())[0]!.value).toBe(1),
            )
            oracleAssertion(
              `expect(view!.container.textContent).toBe('1')`,
              () => expect(view!.container.textContent).toBe(`1`),
            )
            admitted = { element: elements(current())[0]!, mounts, reads }
          } else compare(current(), replaced ? 1 : 0, admitted, mounts, reads)
        }
        entered.add(
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
      oracleAssertion(`row reads cannot rebind the hook`, () =>
        expect(
          subscriptions.mock.calls.length,
          `row reads cannot rebind the hook`,
        ).toBe(starts),
      )
      entered.add(`source-only-write`)
      if (history.reactiveInput) {
        setInputVersion(1)
        await waitFor(() =>
          oracleAssertion(
            `expect(Reflect.get(current(), 'inputVersion')).toBe(inputVersion())`,
            () =>
              expect(Reflect.get(current(), `inputVersion`)).toBe(
                inputVersion(),
              ),
          ),
        )
        oracleAssertion(`query-input reads still rebind the hook`, () =>
          expect(
            subscriptions.mock.calls.length,
            `query-input reads still rebind the hook`,
          ).toBeGreaterThan(starts),
        )
        entered.add(`query-input-change`)
      }
    } finally {
      resources.defer(() => source.cleanup())
    }
  })
  oracleAssertion(`declared finite reach`, () =>
    oracleAssertion(
      `expect(requiredStates.filter((state) => !entered.has(state))).toEqual([])`,
      () =>
        expect(requiredStates.filter((state) => !entered.has(state))).toEqual(
          [],
        ),
    ),
  )
  for (const state of entered) observe(`reach`, state)
}

oracleProperty({
  id: `solid.row-materialization`,
  law: {
    statement: `Unchanged nested elements retain identity and quiet consumers, while current array values and authored reactive query inputs follow their source.`,
    authority: `Existing fine-grained result contract and maintainer decisions recorded in docs/contributing/oracle-coverage.md under the Solid row-materialization receiving owner.`,
    limits: `The existing callback/config/Collection finite grammar at settled Solid host cuts; no changed-element identity, native-source-only value liveness, cycles or elapsed-time claim.`,
  },
  histories: [...histories()],
  driver: (history: Parameters<typeof runHistory>[0], observe) =>
    recordAssertionJudgment(`solid.row-materialization`, history, observe, () =>
      runHistory(history, observe),
    ),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
})

oracleProperty({
  id: `solid.native-parent-materialization`,
  law: {
    statement: `Unchanged native children retain admission and identity across ordinary and native parent replacement in both directions.`,
    authority: `Existing fine-grained result contract and maintainer decisions recorded in docs/contributing/oracle-coverage.md under the Solid row-materialization receiving owner.`,
    limits: `The existing same-parent and parent-transition cases at one or two array levels through three public inputs.`,
  },
  histories: [...nativeParentHistories()],
  driver: (history: Parameters<typeof runHistory>[0], observe) =>
    recordAssertionJudgment(
      `solid.native-parent-materialization`,
      history,
      observe,
      () => runHistory(history, observe),
    ),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
})

declareOracle({
  grammar: [histories, nativeParentHistories],
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
    for (const initial of [false, true])
      for (const key of [`payload`, `__proto__`] as const)
        yield { kind, initial, key }
}

function compareVisibility(
  observed: Array<string>,
  current: object,
  visible: boolean,
  key: string,
) {
  const expected = visible ? [key] : []
  oracleAssertion(`enumeration observer follows descriptor visibility`, () =>
    expect(
      observed,
      `enumeration observer follows descriptor visibility`,
    ).toEqual(expected),
  )
  oracleAssertion(`current descriptor visibility`, () =>
    expect(Object.keys(current), `current descriptor visibility`).toEqual(
      expected,
    ),
  )
}

type VisibilityHistory =
  ReturnType<typeof visibilityHistories> extends Generator<infer H> ? H : never
async function runVisibilityHistory(
  history: VisibilityHistory,
  observe: Observer,
) {
  const { kind, initial, key } = history
  const requiredStates = [
    `unchanged`,
    `hidden`,
    `visible`,
    `visibility-restored`,
  ]
  const entered = new Set<string>()
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
    Object.defineProperty({} as Record<string, unknown>, key, {
      value: payload,
      enumerable: visible,
      writable: true,
      configurable: true,
    })
  const resources = new ScenarioLifetime()
  await resources.run(async () => {
    const original = sourceRow(initial)
    const entry = createRowStore(original)
    const row = entry.value
    const admitted = row[key]
    let observed: Array<string> = []
    createRoot((dispose) => {
      resources.defer(dispose)
      createRenderEffect(() => {
        observed = Object.keys(row)
      })
    })
    compareVisibility(observed, row, initial, key)
    for (const visible of [initial, !initial, initial, !initial]) {
      entry.update(sourceRow(visible))
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      compareVisibility(observed, row, visible, key)
      oracleAssertion(`ordinary root identity`, () =>
        expect(entry.value, `ordinary root identity`).toBe(row),
      )
      oracleAssertion(`visibility keeps the admitted payload`, () =>
        expect(row[key], `visibility keeps the admitted payload`).toBe(
          admitted,
        ),
      )
      oracleAssertion(`source payload remains borrowed`, () =>
        expect(original[key], `source payload remains borrowed`).toBe(payload),
      )
      oracleAssertion(
        `expect(Object.keys(original)).toEqual(initial ? [key] : [])`,
        () => expect(Object.keys(original)).toEqual(initial ? [key] : []),
      )
      entered.add(visible ? `visible` : `hidden`)
    }
    entered.add(`unchanged`)
    entered.add(`visibility-restored`)
  })
  oracleAssertion(`declared finite reach`, () =>
    oracleAssertion(
      `expect(requiredStates.filter((state) => !entered.has(state))).toEqual([])`,
      () =>
        expect(requiredStates.filter((state) => !entered.has(state))).toEqual(
          [],
        ),
    ),
  )
  for (const state of entered) observe(`reach`, state)
}

oracleProperty({
  id: `solid.descriptor-visibility`,
  law: {
    statement: `A stable helper root notifies enumeration consumers when an own data descriptor changes visibility while preserving payload and source identity.`,
    authority: `Existing fine-grained result contract and maintainer decisions recorded in docs/contributing/oracle-coverage.md under the Solid row-materialization receiving owner.`,
    limits: `The existing finite helper-only visibility grammar; no public descriptor admission, accessors, symbols or in-place source edits.`,
  },
  histories: [...visibilityHistories()],
  driver: (history: Parameters<typeof runVisibilityHistory>[0], observe) =>
    recordAssertionJudgment(
      `solid.descriptor-visibility`,
      history,
      observe,
      () => runVisibilityHistory(history, observe),
    ),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
})

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
  oracleAssertion(`live getter at the host cut`, () =>
    expect(actual, `live getter at the host cut`).toEqual(
      expectedLabel(history.object, locale, value),
    ),
  )
}

// Every history crosses a source replacement with subsequent signal writes.
// Initial and later container admission use the same model and observation.
// The getter is nested: spreading a root getter in a query projection would
// evaluate it in Core before it could reach the framework adapter boundary.
async function runGetterHistory(history: GetterHistory, observe: Observer) {
  const requiredStates = [
    `getter-admission`,
    `source-replacement`,
    `signal-only-write`,
    `retained-getter`,
    `getter-omission`,
    `getter-readmission`,
  ]
  const entered = new Set<string>()
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
      await waitFor(() =>
        oracleAssertion(`expect(query()).toHaveLength(1)`, () =>
          expect(query()).toHaveLength(1),
        ),
      )
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
        await waitFor(() =>
          oracleAssertion(`expect(query()[0]!.value).toBe(value)`, () =>
            expect(query()[0]!.value).toBe(value),
          ),
        )
        entered.add(value === 0 ? `getter-admission` : `source-replacement`)
        if (!history.later) entered.add(`getter-admission`)
        const labelVersion = history.stable ? 0 : value
        compareLabel(observed, history, locale(), labelVersion)
        const language = value % 2 === 0 ? `fr` : `de`
        const starts = subscriptions.mock.calls.length
        setLocale(language)
        await new Promise<void>((resolve) => queueMicrotask(resolve))
        entered.add(`signal-only-write`)
        compareLabel(observed, history, language, labelVersion)
        oracleAssertion(`getter reads cannot rebind the hook`, () =>
          expect(
            subscriptions.mock.calls.length,
            `getter reads cannot rebind the hook`,
          ).toBe(starts),
        )
        for (const saved of admitted)
          compareLabel(saved.config.label, history, language, saved.value)
        entered.add(`retained-getter`)
      }
      source.utils.begin()
      source.utils.write({
        type: `update`,
        value: { id: `a`, value: 3, config: {} },
      })
      source.utils.commit()
      await waitFor(() =>
        oracleAssertion(`expect(query()[0]!.value).toBe(3)`, () =>
          expect(query()[0]!.value).toBe(3),
        ),
      )
      oracleAssertion(`omitted getter value`, () =>
        expect(observed, `omitted getter value`).toBeUndefined(),
      )
      oracleAssertion(`omitted getter membership`, () =>
        expect(member, `omitted getter membership`).toBe(false),
      )
      oracleAssertion(`omitted getter enumeration`, () =>
        expect(keys, `omitted getter enumeration`).toEqual([]),
      )
      entered.add(`getter-omission`)
      source.utils.begin()
      source.utils.write({ type: `update`, value: sourceRow(4) })
      source.utils.commit()
      await waitFor(() =>
        oracleAssertion(`expect(query()[0]!.value).toBe(4)`, () =>
          expect(query()[0]!.value).toBe(4),
        ),
      )
      compareLabel(observed, history, locale(), history.stable ? 0 : 4)
      setLocale(`de`)
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      compareLabel(observed, history, `de`, history.stable ? 0 : 4)
      oracleAssertion(`readmitted getter membership`, () =>
        expect(member, `readmitted getter membership`).toBe(true),
      )
      oracleAssertion(`readmitted getter enumeration`, () =>
        expect(keys, `readmitted getter enumeration`).toContain(`label`),
      )
      entered.add(`getter-readmission`)
    } finally {
      resources.defer(() => source.cleanup())
    }
  })
  oracleAssertion(`declared finite reach`, () =>
    oracleAssertion(
      `expect(requiredStates.filter((state) => !entered.has(state))).toEqual([])`,
      () =>
        expect(requiredStates.filter((state) => !entered.has(state))).toEqual(
          [],
        ),
    ),
  )
  for (const state of entered) observe(`reach`, state)
}

oracleProperty({
  id: `solid.live-getters`,
  law: {
    statement: `Admitted nested live getters follow signal changes without rebinding the query and preserve retained source getters through replacement, omission and readmission.`,
    authority: `Existing fine-grained result contract and maintainer decisions recorded in docs/contributing/oracle-coverage.md under the Solid row-materialization receiving owner.`,
    limits: `The existing finite object/scalar, early/later and stable/fresh getter grammar through three public inputs at settled host cuts.`,
  },
  histories: [...getterHistories()],
  driver: (history: Parameters<typeof runGetterHistory>[0], observe) =>
    recordAssertionJudgment(`solid.live-getters`, history, observe, () =>
      runGetterHistory(history, observe),
    ),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
})

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
  oracleAssertion(`expect(actual).not.toBeNull()`, () =>
    expect(actual).not.toBeNull(),
  )
  oracleAssertion(`expect(typeof actual).toBe('object')`, () =>
    expect(typeof actual).toBe(`object`),
  )
  oracleAssertion(`expect(Array.isArray(actual)).toBe(false)`, () =>
    expect(Array.isArray(actual)).toBe(false),
  )
  const record = actual as Record<string, unknown>
  const pairs = seen.get(record) ?? new Set<object>()
  if (pairs.has(expected)) return
  pairs.add(expected)
  seen.set(record, pairs)
  if (`value` in expected) {
    oracleAssertion(`expect(Object.keys(record)).toEqual(['value'])`, () =>
      expect(Object.keys(record)).toEqual([`value`]),
    )
    oracleAssertion(`complete graph leaf`, () =>
      expect(record.value, `complete graph leaf`).toBe(expected.value),
    )
  } else {
    oracleAssertion(
      `expect(new Set(Object.keys(record))).toEqual(new Set(['left', 'right']))`,
      () =>
        expect(new Set(Object.keys(record))).toEqual(
          new Set([`left`, `right`]),
        ),
    )
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
  oracleAssertion(`source enumeration scales with distinct containers`, () =>
    expect(
      visits,
      `source enumeration scales with distinct containers`,
    ).toBeLessThanOrEqual(enumerationBudget(containers)),
  )
  compareGraphValues(actual, expected)
}

// A wrong observation changes one interior path while keeping the two extreme
// paths intact. The same complete comparison must reject it at every crossed
// depth; a checker of only all-left/all-right leaves would accept it.
function runGraphCalibration(
  history: ReturnType<typeof graphHistories> extends Generator<infer H>
    ? H
    : never,
  _observe: Observer,
) {
  const { depth, shared, crossed } = history
  const expected = semanticGraph(depth, 0, shared, crossed)
  function corrupted(graph: Graph, remaining: number): Graph {
    if (`value` in graph) return { value: 99 }
    const side = remaining === depth * 2 - 1 ? `right` : `left`
    return { ...graph, [side]: corrupted(graph[side], remaining - 1) }
  }
  oracleAssertion(
    `expect(() => compareGraphValues(corrupted(expected, depth * 2), expected), ).toThrow()`,
    () =>
      expect(() =>
        compareGraphValues(corrupted(expected, depth * 2), expected),
      ).toThrow(),
  )
}

oracleProperty({
  id: `solid.shared-graph-calibration`,
  law: {
    statement: `The existing complete graph comparison rejects interior mixed-path corruption even when the extreme paths are intact.`,
    authority: `Existing fine-grained result contract and maintainer decisions recorded in docs/contributing/oracle-coverage.md under the Solid row-materialization receiving owner.`,
    limits: `The existing three crossed-depth calibration inputs and unchanged graph comparison; no new mutation campaign.`,
  },
  histories: [...graphHistories()].filter((history) => history.crossed),
  driver: (history: Parameters<typeof runGraphCalibration>[0], observe) =>
    recordAssertionJudgment(
      `solid.shared-graph-calibration`,
      history,
      observe,
      () => runGraphCalibration(history, observe),
    ),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
})

async function runGraphHistory(
  {
    depth,
    shared,
    crossed,
  }: {
    depth: number
    shared: boolean
    crossed: boolean
  },
  observe: Observer,
) {
  const requiredStates = [
    `graph-admission`,
    `graph-replacement`,
    `branch-divergence`,
    ...(crossed ? [`crossed-sharing`] : []),
  ]
  const entered = new Set<string>()
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
      await waitFor(() =>
        oracleAssertion(`expect(query()).toHaveLength(1)`, () =>
          expect(query()).toHaveLength(1),
        ),
      )
      compareGraph(
        query()[0]!.config,
        semanticGraph(depth, 0, shared, crossed),
        visits,
        containers,
      )
      entered.add(`graph-admission`)
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
        await waitFor(() =>
          oracleAssertion(`expect(query()[0]!.value).toBe(value)`, () =>
            expect(query()[0]!.value).toBe(value),
          ),
        )
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
        entered.add(value === 1 ? `graph-replacement` : `branch-divergence`)
        if (crossed && value === 1) entered.add(`crossed-sharing`)
      }
    } finally {
      resources.defer(() => source.cleanup())
    }
  })
  oracleAssertion(`declared finite reach`, () =>
    oracleAssertion(
      `expect(requiredStates.filter((state) => !entered.has(state))).toEqual([])`,
      () =>
        expect(requiredStates.filter((state) => !entered.has(state))).toEqual(
          [],
        ),
    ),
  )
  for (const state of entered) observe(`reach`, state)
}
oracleProperty({
  id: `solid.shared-graphs`,
  law: {
    statement: `Shared acyclic graph materialization preserves every public value path within the existing source-enumeration regression budget.`,
    authority: `Existing fine-grained result contract and maintainer decisions recorded in docs/contributing/oracle-coverage.md under the Solid row-materialization receiving owner.`,
    limits: `The existing finite graph grammar and unchanged 32 enumerations per distinct admitted container; no public SLO, alias topology or cyclic support claim.`,
  },
  histories: [...graphHistories()],
  driver: (history: Parameters<typeof runGraphHistory>[0], observe) =>
    recordAssertionJudgment(`solid.shared-graphs`, history, observe, () =>
      runGraphHistory(history, observe),
    ),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
})
declareOracle({
  model: [enumerationBudget, semanticGraph],
  grammar: [graphHistories],
  check: [compareGraph, compareGraphValues],
})

/**
 * Callable user fields remain usable in Solid tracking scopes. The public
 * current-result law and the shared snapshot owner's function leaves apply to
 * ordinary own fields, inherited-name shadows and admitted null-prototype
 * records. Native-store adoption does not reserve hasOwnProperty as user data.
 * The live-getter decision also applies when a simple getter returns a callable.
 *
 * The model keeps an authored function identity and its scalar version. Every
 * callable reads the receiver's unchanged value, so changing only its identity
 * must update a consumer. A scalar peer cannot supply the missing invalidation.
 * Root accessors are excluded because Core evaluates them before admission;
 * nested accessors and null-prototype containers receive a source-premise check.
 * These finite histories do not judge arbitrary function/getter bodies, mutable
 * source writes, cyclic graphs or browser rendering.
 */
type CallableValue = (this: { value: number }) => number
type CallableContainer = {
  value: number
  format?: CallableValue
  hasOwnProperty?: unknown
}
type CallableRow = {
  id: string
  version: number
  unchanged: number
  value: number
  format?: CallableValue
  hasOwnProperty?: unknown
  config: CallableContainer | null
}

function requiredFirstRow<T>(rows: ReadonlyArray<T>): T {
  const row = rows[0]
  if (row === undefined)
    throw new Error(`the settled materialization checkpoint has no row`)
  return row
}
type CallableHistory = {
  input: History[`input`]
  location: `root` | `nested`
  property: `data` | `getter`
  shape: `ordinary` | `shadow-value` | `shadow-callable` | `null-prototype`
}
type CallableObservation = {
  callable: CallableValue | undefined
  value: number | undefined
}
type CallableChoices = ReadonlyArray<ReadonlyArray<CallableValue>>

function* callableHistories(): Generator<CallableHistory> {
  for (const input of [`callback`, `config`, `collection`] as const)
    for (const location of [`root`, `nested`] as const)
      for (const property of location === `root`
        ? ([`data`] as const)
        : ([`data`, `getter`] as const))
        for (const shape of location === `root`
          ? ([`ordinary`, `shadow-value`, `shadow-callable`] as const)
          : ([
              `ordinary`,
              `shadow-value`,
              `shadow-callable`,
              `null-prototype`,
            ] as const))
          yield { input, location, property, shape }
}

// Function identities come from the authored input, and the return law is
// receiver.value + source-version * 10 + the getter's selected signal version.
function expectedCallable(
  history: CallableHistory,
  version: number,
  signal: number,
  choices: CallableChoices,
  omitted = false,
): CallableObservation {
  if (omitted) return { callable: undefined, value: undefined }
  const selected = history.property === `getter` ? signal : 0
  return {
    callable: choices[version]![selected]!,
    value: 7 + version * 10 + selected,
  }
}
function compareCallable(
  actual: CallableObservation,
  expected: CallableObservation,
) {
  oracleAssertion(`tracked callable identity`, () =>
    expect(actual.callable, `tracked callable identity`).toBe(
      expected.callable,
    ),
  )
  oracleAssertion(`tracked callable result with the current receiver`, () =>
    expect(
      actual.value,
      `tracked callable result with the current receiver`,
    ).toBe(expected.value),
  )
}

async function runCallableHistory(history: CallableHistory, observe: Observer) {
  const requiredStates = [
    `callable-admission`,
    `tracked-initial`,
    `source-replacement`,
    `signal-only-read`,
    `callable-omission`,
    `callable-readmission`,
    `retained-source`,
    `quiet-neighbor`,
  ]
  const entered = new Set<string>()
  const resources = new ScenarioLifetime()
  await resources.run(async () => {
    const [signal, setSignal] = createSignal(0)
    const choices: CallableChoices = Array.from({ length: 4 }, (_, version) =>
      [0, 1].map(
        (selected) =>
          function (this: { value: number }) {
            return this.value + version * 10 + selected
          },
      ),
    )
    const shadow = () => false
    const sourceRow = (version: number, omitted = false): CallableRow => {
      const fields: CallableContainer =
        history.shape === `null-prototype`
          ? Object.assign(Object.create(null) as object, { value: 7 })
          : { value: 7 }
      if (history.shape === `shadow-value`) fields.hasOwnProperty = 0
      if (history.shape === `shadow-callable`) fields.hasOwnProperty = shadow
      if (!omitted)
        Object.defineProperty(
          fields,
          `format`,
          history.property === `getter`
            ? {
                get: () => choices[version]![signal()]!,
                enumerable: true,
                configurable: true,
              }
            : {
                value: choices[version]![0]!,
                enumerable: true,
                writable: true,
                configurable: true,
              },
        )
      const base = { id: `a`, version, unchanged: 0, value: 7, config: null }
      return history.location === `root`
        ? { ...base, ...fields }
        : { ...base, config: fields }
    }
    const source = createCollection(
      mockSyncCollectionOptions<CallableRow>({
        id: `callable-${history.input}-${history.location}-${history.property}-${history.shape}`,
        getKey: (row) => row.id,
        initialData: [sourceRow(0)],
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
      await waitFor(() =>
        oracleAssertion(`expect(query()).toHaveLength(1)`, () =>
          expect(query()).toHaveLength(1),
        ),
      )
      const container = (row: CallableRow): CallableContainer =>
        history.location === `root` ? row : row.config!
      const retained: Array<{
        row: CallableRow
        version: number
        omitted: boolean
      }> = []
      const admit = (version: number, omitted: boolean) => {
        const row = source.get(`a`)!
        const fields = container(row)
        oracleAssertion(`source admitted callable ownness`, () =>
          expect(
            Object.hasOwn(fields, `format`),
            `source admitted callable ownness`,
          ).toBe(!omitted),
        )
        if (history.shape === `null-prototype`)
          oracleAssertion(`source admitted nested null prototype`, () =>
            expect(
              Object.getPrototypeOf(fields),
              `source admitted nested null prototype`,
            ).toBe(null),
          )
        if (history.shape.startsWith(`shadow`)) {
          oracleAssertion(`source admitted ordinary shadow`, () =>
            expect(
              Object.hasOwn(fields, `hasOwnProperty`),
              `source admitted ordinary shadow`,
            ).toBe(true),
          )
          oracleAssertion(`source admitted user shadow value`, () =>
            expect(
              fields.hasOwnProperty,
              `source admitted user shadow value`,
            ).toBe(history.shape === `shadow-value` ? 0 : shadow),
          )
        }
        retained.push({ row, version, omitted })
      }
      admit(0, false)
      entered.add(`callable-admission`)
      const root = query()[0]!
      let observed: CallableObservation = {
        callable: undefined,
        value: undefined,
      }
      let reads = 0
      let unchangedReads = 0
      // This recorder runs in the actual host listener. An untracked value
      // comparison cannot establish callable usability or dependency tracking.
      createRoot((dispose) => {
        resources.defer(dispose)
        createRenderEffect(() => {
          const current = container(requiredFirstRow(query()))
          observed = { callable: current.format, value: current.format?.() }
          reads++
        })
        createRenderEffect(() => {
          void query()[0]!.unchanged
          unchangedReads++
        })
      })
      compareCallable(observed, expectedCallable(history, 0, signal(), choices))
      entered.add(`tracked-initial`)
      const compareCurrentCallable = (version: number, omitted = false) => {
        compareCallable(
          observed,
          expectedCallable(history, version, signal(), choices, omitted),
        )
        oracleAssertion(`ordinary root stays stable`, () =>
          expect(query()[0], `ordinary root stays stable`).toBe(root),
        )
        oracleAssertion(`unchanged scalar neighbor stays quiet`, () =>
          expect(unchangedReads, `unchanged scalar neighbor stays quiet`).toBe(
            1,
          ),
        )
        for (const saved of retained) {
          const fields = container(saved.row)
          compareCallable(
            { callable: fields.format, value: fields.format?.() },
            expectedCallable(
              history,
              saved.version,
              signal(),
              choices,
              saved.omitted,
            ),
          )
          oracleAssertion(`retained source version`, () =>
            expect(saved.row.version, `retained source version`).toBe(
              saved.version,
            ),
          )
          oracleAssertion(`retained source ownness`, () =>
            expect(
              Object.hasOwn(fields, `format`),
              `retained source ownness`,
            ).toBe(!saved.omitted),
          )
        }
        if (history.shape.startsWith(`shadow`))
          for (const fields of [
            container(requiredFirstRow(query())),
            ...retained.map((saved) => container(saved.row)),
          ]) {
            oracleAssertion(`current and retained user shadow ownness`, () =>
              expect(
                Object.hasOwn(fields, `hasOwnProperty`),
                `current and retained user shadow ownness`,
              ).toBe(true),
            )
            oracleAssertion(`current and retained user shadow value`, () =>
              expect(
                fields.hasOwnProperty,
                `current and retained user shadow value`,
              ).toBe(history.shape === `shadow-value` ? 0 : shadow),
            )
          }
        entered.add(`retained-source`)
        entered.add(`quiet-neighbor`)
      }
      compareCurrentCallable(0)
      const signalOnly = async (selected: number, version: number) => {
        const starts = subscriptions.mock.calls.length
        const before = reads
        setSignal(selected)
        await new Promise<void>((resolve) => queueMicrotask(resolve))
        compareCurrentCallable(version)
        oracleAssertion(`callable reads cannot rebind the hook`, () =>
          expect(
            subscriptions.mock.calls.length,
            `callable reads cannot rebind the hook`,
          ).toBe(starts),
        )
        if (history.property === `data`)
          oracleAssertion(
            `a data callable does not depend on the getter signal`,
            () =>
              expect(
                reads,
                `a data callable does not depend on the getter signal`,
              ).toBe(before),
          )
        entered.add(`signal-only-read`)
      }
      const write = async (version: number, omitted = false) => {
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: sourceRow(version, omitted),
        })
        source.utils.commit()
        await waitFor(() =>
          oracleAssertion(`expect(query()[0]!.version).toBe(version)`, () =>
            expect(query()[0]!.version).toBe(version),
          ),
        )
        admit(version, omitted)
        compareCurrentCallable(version, omitted)
      }
      await signalOnly(1, 0)
      await write(1)
      entered.add(`source-replacement`)
      await signalOnly(0, 1)
      await write(2, true)
      entered.add(`callable-omission`)
      await write(3)
      entered.add(`callable-readmission`)
      await signalOnly(1, 3)
    } finally {
      resources.defer(() => source.cleanup())
    }
  })
  oracleAssertion(`declared finite reach`, () =>
    oracleAssertion(
      `expect(requiredStates.filter((state) => !entered.has(state))).toEqual([])`,
      () =>
        expect(requiredStates.filter((state) => !entered.has(state))).toEqual(
          [],
        ),
    ),
  )
  for (const state of entered) observe(`reach`, state)
}
oracleProperty({
  id: `solid.callable-fields`,
  law: {
    statement: `Tracked callable data and getter fields retain current identity and receiver results while unchanged neighbors stay quiet and retained sources remain intact.`,
    authority: `Existing fine-grained result contract and maintainer decisions recorded in docs/contributing/oracle-coverage.md under the Solid row-materialization receiving owner.`,
    limits: `The existing finite callable grammar through three public inputs; no arbitrary function/getter bodies, mutable-source writes, cycles or browser rendering.`,
  },
  histories: [...callableHistories()],
  driver: (history: Parameters<typeof runCallableHistory>[0], observe) =>
    recordAssertionJudgment(`solid.callable-fields`, history, observe, () =>
      runCallableHistory(history, observe),
    ),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
})
declareOracle({
  model: [expectedCallable],
  grammar: [callableHistories],
  check: [compareCallable],
})

/**
 * An own user data field keeps its ordinary current-result meaning even when
 * its name is __proto__. Core's public-field owner establishes admission; this
 * receiving family checks the distinct Solid listener boundary. Native get's
 * reserved-name shortcut must not leave the first subscribed value stale.
 *
 * The independent model is a stage sequence with scalar, signed-zero, object
 * and array data, including own undefined. Signed zero distinguishes a changed
 * admitted value from a comparison that treats both zeros as equal.
 * The grammar starts with own data, own undefined or an inherited fallback,
 * then replaces, omits and readmits the field. Host bookkeeping symbols and
 * nested mutable-source writes are outside this family.
 */
type ReservedFieldHistory = {
  input: History[`input`]
  key: `ordinary` | `__proto__`
  initial: `value` | `undefined` | `absent`
  payload: `scalar` | `signed-zero` | `object` | `array`
}
type ReservedFieldRow = {
  id: string
  version: number
  unchanged: number
  ordinary?: unknown
  __proto__?: unknown
}
function* reservedFieldHistories(): Generator<ReservedFieldHistory> {
  for (const input of [`callback`, `config`, `collection`] as const)
    for (const key of [`ordinary`, `__proto__`] as const)
      for (const initial of [`value`, `undefined`, `absent`] as const)
        for (const payload of [
          `scalar`,
          `signed-zero`,
          `object`,
          `array`,
        ] as const)
          yield { input, key, initial, payload }
}
function expectedReservedField(
  stage: number,
  initial: ReservedFieldHistory[`initial`],
  key: ReservedFieldHistory[`key`],
  payload: ReservedFieldHistory[`payload`],
): unknown {
  const inherited = key === `__proto__` ? Object.prototype : undefined
  if (stage === 3 || (stage === 0 && initial === `absent`)) return inherited
  if (stage === 2 || (stage === 0 && initial === `undefined`)) return undefined
  if (payload === `signed-zero`) return stage === 1 ? -0 : 0
  const value = stage === 0 ? 0 : stage === 1 ? 1 : 2
  return payload === `scalar`
    ? value
    : payload === `array`
      ? [value]
      : { value }
}
function compareReservedField(observed: unknown, expected: unknown) {
  if (expected === Object.prototype)
    oracleAssertion(`expect(observed).toBe(expected)`, () =>
      expect(observed).toBe(expected),
    )
  else
    oracleAssertion(`tracked own data follows its admitted stage`, () =>
      expect(observed, `tracked own data follows its admitted stage`).toEqual(
        expected,
      ),
    )
}
async function runReservedFieldHistory(
  history: ReservedFieldHistory,
  observe: Observer,
) {
  const requiredStates = [
    `initial-source-shape`,
    `tracked-initial`,
    `first-replacement`,
    `own-undefined`,
    `omission`,
    `readmission`,
    `retained-source`,
    `quiet-neighbor`,
    `tracked-own-keys`,
    `prototype-preserved`,
  ]
  const entered = new Set<string>()
  const resources = new ScenarioLifetime()
  await resources.run(async () => {
    const sourceRow = (stage: number): ReservedFieldRow => ({
      id: `a`,
      version: stage,
      unchanged: 0,
      ...(stage === 3 || (stage === 0 && history.initial === `absent`)
        ? {}
        : Object.fromEntries([
            [
              history.key,
              expectedReservedField(
                stage,
                history.initial,
                history.key,
                history.payload,
              ),
            ],
          ])),
    })
    const source = createCollection(
      mockSyncCollectionOptions<ReservedFieldRow>({
        id: `reserved-${history.input}-${history.key}-${history.initial}`,
        getKey: (row) => row.id,
        initialData: [sourceRow(0)],
        rowUpdateMode: `full`,
      }),
    )
    try {
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
      await waitFor(() =>
        oracleAssertion(`expect(query()).toHaveLength(1)`, () =>
          expect(query()).toHaveLength(1),
        ),
      )
      const root = query()[0]!
      const retained: Array<{ row: ReservedFieldRow; stage: number }> = []
      const admit = (stage: number) => {
        const row = source.get(`a`)!
        oracleAssertion(`Core admitted the authored ownness`, () =>
          expect(
            Object.hasOwn(row, history.key),
            `Core admitted the authored ownness`,
          ).toBe(stage !== 3 && (stage !== 0 || history.initial !== `absent`)),
        )
        compareReservedField(
          row[history.key],
          expectedReservedField(
            stage,
            history.initial,
            history.key,
            history.payload,
          ),
        )
        retained.push({ row, stage })
      }
      admit(0)
      entered.add(`initial-source-shape`)
      let observed: unknown
      let observedKeys: Array<string> = []
      let observedOwn = false
      let unchangedReads = 0
      createRoot((dispose) => {
        resources.defer(dispose)
        createRenderEffect(() => {
          observed = query()[0]![history.key]
        })
        createRenderEffect(() => {
          observedKeys = Object.keys(requiredFirstRow(query()))
          observedOwn = Object.hasOwn(requiredFirstRow(query()), history.key)
        })
        createRenderEffect(() => {
          void query()[0]!.unchanged
          unchangedReads++
        })
      })
      compareReservedField(
        observed,
        expectedReservedField(0, history.initial, history.key, history.payload),
      )
      entered.add(`tracked-initial`)
      for (const stage of [1, 2, 3, 4]) {
        source.utils.begin()
        source.utils.write({ type: `update`, value: sourceRow(stage) })
        source.utils.commit()
        await waitFor(() =>
          oracleAssertion(`expect(query()[0]!.version).toBe(stage)`, () =>
            expect(query()[0]!.version).toBe(stage),
          ),
        )
        admit(stage)
        compareReservedField(
          query()[0]![history.key],
          expectedReservedField(
            stage,
            history.initial,
            history.key,
            history.payload,
          ),
        )
        compareReservedField(
          observed,
          expectedReservedField(
            stage,
            history.initial,
            history.key,
            history.payload,
          ),
        )
        oracleAssertion(`current own user field`, () =>
          expect(
            Object.hasOwn(requiredFirstRow(query()), history.key),
            `current own user field`,
          ).toBe(stage !== 3),
        )
        oracleAssertion(`tracked own keys`, () =>
          expect([...observedKeys].sort(), `tracked own keys`).toEqual(
            Object.keys(source.get(`a`)!).sort(),
          ),
        )
        oracleAssertion(`tracked ownness`, () =>
          expect(observedOwn, `tracked ownness`).toBe(stage !== 3),
        )
        oracleAssertion(
          `expect(Object.getPrototypeOf(query()[0]!)).toBe(Object.prototype)`,
          () =>
            expect(Object.getPrototypeOf(query()[0])).toBe(Object.prototype),
        )
        oracleAssertion(
          `expect(Object.hasOwn(Object.prototype, 'value')).toBe(false)`,
          () => expect(Object.hasOwn(Object.prototype, `value`)).toBe(false),
        )
        entered.add(`tracked-own-keys`)
        entered.add(`prototype-preserved`)
        oracleAssertion(`ordinary root identity`, () =>
          expect(query()[0], `ordinary root identity`).toBe(root),
        )
        oracleAssertion(`unchanged scalar neighbor stays quiet`, () =>
          expect(unchangedReads, `unchanged scalar neighbor stays quiet`).toBe(
            1,
          ),
        )
        for (const saved of retained) {
          oracleAssertion(`retained source ownness`, () =>
            expect(
              Object.hasOwn(saved.row, history.key),
              `retained source ownness`,
            ).toBe(
              saved.stage !== 3 &&
                (saved.stage !== 0 || history.initial !== `absent`),
            ),
          )
          compareReservedField(
            saved.row[history.key],
            expectedReservedField(
              saved.stage,
              history.initial,
              history.key,
              history.payload,
            ),
          )
        }
        entered.add(
          stage === 1
            ? `first-replacement`
            : stage === 2
              ? `own-undefined`
              : stage === 3
                ? `omission`
                : `readmission`,
        )
        entered.add(`retained-source`)
        entered.add(`quiet-neighbor`)
      }
    } finally {
      resources.defer(() => source.cleanup())
    }
  })
  oracleAssertion(`declared finite reach`, () =>
    oracleAssertion(
      `expect(requiredStates.filter((state) => !entered.has(state))).toEqual([])`,
      () =>
        expect(requiredStates.filter((state) => !entered.has(state))).toEqual(
          [],
        ),
    ),
  )
  for (const state of entered) observe(`reach`, state)
}
oracleProperty({
  id: `solid.reserved-fields`,
  law: {
    statement: `Own user fields including __proto__ follow their admitted stage in Solid listeners while preserving own keys, prototypes, retained sources and quiet neighbors.`,
    authority: `Existing fine-grained result contract and maintainer decisions recorded in docs/contributing/oracle-coverage.md under the Solid row-materialization receiving owner.`,
    limits: `The existing finite ordinary/reserved-name, initial-ownness and scalar/signed-zero/object/array grammar through three public inputs.`,
  },
  histories: [...reservedFieldHistories()],
  driver: (history: Parameters<typeof runReservedFieldHistory>[0], observe) =>
    recordAssertionJudgment(`solid.reserved-fields`, history, observe, () =>
      runReservedFieldHistory(history, observe),
    ),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
})
declareOracle({
  model: [expectedReservedField],
  grammar: [reservedFieldHistories],
  check: [compareReservedField],
})

/**
 * Arrays retain their admitted inherited methods in a Solid listener. The
 * snapshot owner's array/subclass capability law and ordinary user-field law
 * compose: an own hasOwnProperty value cannot make map, reduce or a supplied
 * subclass total method unusable. The model recomputes two scalar elements.
 * This family judges arrays, not arbitrary class instances or prototype edits.
 */
class CallableMethodValues extends Array<number> {
  total(): number {
    return this.reduce((sum, value) => sum + value, 0)
  }
}
type MethodHistory = {
  input: History[`input`]
  subclass: boolean
  shape: `ordinary` | `shadow-value` | `shadow-callable`
}
type MethodRow = {
  id: string
  version: number
  unchanged: number
  values: Array<number>
}
type MethodObservation = { mapped: Array<number>; total: number }
function* methodHistories(): Generator<MethodHistory> {
  for (const input of [`callback`, `config`, `collection`] as const)
    for (const subclass of [false, true])
      for (const shape of [
        `ordinary`,
        `shadow-value`,
        `shadow-callable`,
      ] as const)
        yield { input, subclass, shape }
}
function expectedMethods(version: number): MethodObservation {
  return { mapped: [version * 2, (version + 1) * 2], total: version * 2 + 1 }
}
function compareMethods(actual: MethodObservation, version: number) {
  oracleAssertion(
    `tracked array and subclass methods preserve their scalar result`,
    () =>
      expect(
        actual,
        `tracked array and subclass methods preserve their scalar result`,
      ).toEqual(expectedMethods(version)),
  )
}
async function runMethodHistory(history: MethodHistory, observe: Observer) {
  const requiredStates = [
    `array-admission`,
    `tracked-methods`,
    `array-replacement`,
    `retained-source`,
    `quiet-neighbor`,
  ]
  const entered = new Set<string>()
  const resources = new ScenarioLifetime()
  await resources.run(async () => {
    const shadow = () => false
    const sourceRow = (version: number): MethodRow => {
      const values = history.subclass
        ? CallableMethodValues.from([version, version + 1])
        : [version, version + 1]
      if (history.shape !== `ordinary`)
        Object.defineProperty(values, `hasOwnProperty`, {
          value: history.shape === `shadow-value` ? 0 : shadow,
          enumerable: true,
          writable: true,
          configurable: true,
        })
      return { id: `a`, version, unchanged: 0, values }
    }
    const source = createCollection(
      mockSyncCollectionOptions<MethodRow>({
        id: `methods-${history.input}-${history.subclass}-${history.shape}`,
        getKey: (row) => row.id,
        initialData: [sourceRow(0)],
        rowUpdateMode: `full`,
      }),
    )
    try {
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
      await waitFor(() =>
        oracleAssertion(`expect(query()).toHaveLength(1)`, () =>
          expect(query()).toHaveLength(1),
        ),
      )
      const retained: Array<{ row: MethodRow; version: number }> = []
      const checkFields = (values: Array<number>) => {
        if (history.shape !== `ordinary`) {
          oracleAssertion(`array keeps user shadow ownness`, () =>
            expect(
              Object.hasOwn(values, `hasOwnProperty`),
              `array keeps user shadow ownness`,
            ).toBe(true),
          )
          oracleAssertion(`array keeps user shadow value`, () =>
            expect(
              Reflect.get(values, `hasOwnProperty`),
              `array keeps user shadow value`,
            ).toBe(history.shape === `shadow-value` ? 0 : shadow),
          )
        }
      }
      const sourceAdmission = (version: number) => {
        const row = source.get(`a`)!
        oracleAssertion(`source admitted an array`, () =>
          expect(Array.isArray(row.values), `source admitted an array`).toBe(
            true,
          ),
        )
        if (history.subclass)
          oracleAssertion(`source admitted subclass method`, () =>
            expect(
              typeof Reflect.get(row.values, `total`),
              `source admitted subclass method`,
            ).toBe(`function`),
          )
        checkFields(row.values)
        retained.push({ row, version })
      }
      sourceAdmission(0)
      entered.add(`array-admission`)
      let observed: MethodObservation = { mapped: [], total: 0 }
      let unchangedReads = 0
      const readMethods = (values: Array<number>): MethodObservation => {
        const total: unknown = Reflect.get(values, `total`)
        return {
          mapped: [...values.map((value) => value * 2)],
          total: history.subclass
            ? Reflect.apply(
                total as (this: Array<number>) => number,
                values,
                [],
              )
            : values.reduce((sum, value) => sum + value, 0),
        }
      }
      createRoot((dispose) => {
        resources.defer(dispose)
        createRenderEffect(() => {
          observed = readMethods(query()[0]!.values)
        })
        createRenderEffect(() => {
          void query()[0]!.unchanged
          unchangedReads++
        })
      })
      compareMethods(observed, 0)
      entered.add(`tracked-methods`)
      for (const version of [1, 2]) {
        source.utils.begin()
        source.utils.write({ type: `update`, value: sourceRow(version) })
        source.utils.commit()
        await waitFor(() =>
          oracleAssertion(`expect(query()[0]!.version).toBe(version)`, () =>
            expect(query()[0]!.version).toBe(version),
          ),
        )
        sourceAdmission(version)
        compareMethods(observed, version)
        checkFields(query()[0]!.values)
        oracleAssertion(`unchanged scalar neighbor stays quiet`, () =>
          expect(unchangedReads, `unchanged scalar neighbor stays quiet`).toBe(
            1,
          ),
        )
        for (const saved of retained) {
          compareMethods(readMethods(saved.row.values), saved.version)
          checkFields(saved.row.values)
        }
        entered.add(`array-replacement`)
        entered.add(`retained-source`)
        entered.add(`quiet-neighbor`)
      }
    } finally {
      resources.defer(() => source.cleanup())
    }
  })
  oracleAssertion(`declared finite reach`, () =>
    oracleAssertion(
      `expect(requiredStates.filter((state) => !entered.has(state))).toEqual([])`,
      () =>
        expect(requiredStates.filter((state) => !entered.has(state))).toEqual(
          [],
        ),
    ),
  )
  for (const state of entered) observe(`reach`, state)
}
oracleProperty({
  id: `solid.array-methods`,
  law: {
    statement: `Admitted arrays retain inherited and subclass methods in Solid listeners even when user data shadows hasOwnProperty.`,
    authority: `Existing fine-grained result contract and maintainer decisions recorded in docs/contributing/oracle-coverage.md under the Solid row-materialization receiving owner.`,
    limits: `The existing finite array/subclass and user-shadow grammar through three public inputs; no arbitrary class instances or prototype edits.`,
  },
  histories: [...methodHistories()],
  driver: (history: Parameters<typeof runMethodHistory>[0], observe) =>
    recordAssertionJudgment(`solid.array-methods`, history, observe, () =>
      runMethodHistory(history, observe),
    ),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
})
declareOracle({
  owns: [
    `src/useLiveQuery.ts#useLiveQuery`,
    `src/store-materialization.ts#createRowStore`,
  ],
  model: [expectedMethods],
  grammar: [methodHistories],
  check: [compareMethods],
})
