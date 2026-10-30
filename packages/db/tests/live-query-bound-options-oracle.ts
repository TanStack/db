/**
 * Identity-comparing bindings retain inline options until identity changes.
 * Authority: the maintainer's inline-option decision. Function/reference
 * allocation on normal renders cannot change the Collection; a query or
 * explicit queryKey change binds the new options. Reactive hosts that do not
 * compare identity are outside this law. React and Preact are receiving drivers.
 */
import { expect } from 'vitest'
import { declareOracle } from './oracle-declaration.js'

export const boundOptionHistories = (
  [`getKey`, `schema`, `both`] as const
).flatMap((option) =>
  ([`query`, `queryKey`] as const).map((identity) => ({ option, identity })),
)
// Capture references before any later render can mutate the Collection config.
export function captureBoundOptions(collection: {
  config: { getKey: unknown; schema?: unknown }
}) {
  return {
    collection,
    getKey: collection.config.getKey,
    schema: collection.config.schema,
  }
}
// A binding's identity, rather than its current option references, determines
// whether the next Collection and configured option references must be new.
export function checkBoundOptions(
  initial: ReturnType<typeof captureBoundOptions>,
  current: { config: { getKey: unknown; schema?: unknown } },
  changed: boolean,
  option: string,
): void {
  expect(current === initial.collection, `Collection identity`).toBe(!changed)
  if (option !== `schema`)
    expect(current.config.getKey === initial.getKey, `getKey binding`).toBe(
      !changed,
    )
  if (option !== `getKey`)
    expect(current.config.schema === initial.schema, `schema binding`).toBe(
      !changed,
    )
}

/**
 * Which schema governs the next client mutation?
 *
 * Reference retention alone cannot show that a Collection still uses those
 * references. The schema guide's "TInput vs TOutput" contract supplies the
 * receiving law: schemas validate client inserts/updates, never sync writes.
 * A held update must expose the bound schema's output and give that output to
 * its handler. The optimistic-history contract restores the authored base when
 * the unconfirmed handler settles. The two native drivers below receive this
 * law through React live/Suspense and Preact live hooks.
 *
 * This finite grammar varies the proposed schema independently from query
 * identity and getKey. Absence is a real declaration, including on both sides
 * of a render. Same-mode pairs preserve allocating-but-equivalent callbacks.
 * All transformations accept their own outputs, as the schema guide requires.
 * The grammar excludes async/invalid schemas, key edits inside mutations, and
 * a mutation that spans query replacement. Only explicit plain/prefixed key
 * functions are covered; default-getKey absence remains outside this receiver.
 * The public schema type currently resolves to never. These are documented
 * JavaScript configuration witnesses, not evidence for typed schema options.
 */
export type BoundSchemaMode = `absent` | `trim` | `uppercase`
export type BoundSchemaPhase = `initial` | `retained` | `rebound`
export type BoundSchemaRow = { id: string; label: string; rank: number }
export const boundSchemaModes: ReadonlyArray<BoundSchemaMode> = [
  `absent`,
  `trim`,
  `uppercase`,
]
export const boundSchemaHistories = boundSchemaModes.flatMap((firstSchema) =>
  boundSchemaModes.flatMap((nextSchema) =>
    ([`query`, `queryKey`] as const).flatMap((identity) =>
      [false, true].flatMap((changeKey) =>
        [
          { word: `alpha`, padding: ` ` },
          { word: `beta gamma`, padding: `  ` },
        ].map((input) => ({
          firstSchema,
          nextSchema,
          identity,
          changeKey,
          input,
        })),
      ),
    ),
  ),
)
export type BoundSchemaHistory = (typeof boundSchemaHistories)[number]

// Binding names are model-only declarations. They combine no Collection,
// compiler, or schema-parser state: phase names the history's identity cut.
export function modelBoundSchemaBinding(
  history: BoundSchemaHistory,
  phase: BoundSchemaPhase,
) {
  return {
    schema: phase === `rebound` ? history.nextSchema : history.firstSchema,
    key: phase === `rebound` && history.changeKey ? `prefixed` : `plain`,
  } as const
}
export function modelBoundSchemaKey(id: string, key: `plain` | `prefixed`) {
  return key === `plain` ? id : `bound-${id}`
}

// Expected text comes from the authored input grammar. Trim keeps its word;
// uppercase converts ASCII code points. Neither computation calls a fixture's
// validate() or the production mutation/schema machinery.
export function modelBoundSchemaLabel(
  mode: BoundSchemaMode,
  input: BoundSchemaHistory[`input`],
) {
  const raw = `${input.padding}${input.word}${input.padding}`
  if (mode === `trim`) return input.word
  if (mode === `absent`) return raw
  return [...raw]
    .map((letter) => {
      const code = letter.charCodeAt(0)
      return code >= 97 && code <= 122 ? String.fromCharCode(code - 32) : letter
    })
    .join(``)
}
export type BoundSchemaRows = ReadonlyArray<{
  key: unknown
  value: Readonly<Record<string, unknown>>
}>
export type BoundSchemaMutation = {
  key: unknown
  original: Readonly<Record<string, unknown>>
  modified: Readonly<Record<string, unknown>>
  changes: Readonly<Record<string, unknown>>
}
export function modelBoundSchemaRows(
  rows: ReadonlyArray<BoundSchemaRow>,
  key: `plain` | `prefixed`,
): BoundSchemaRows {
  return rows.map((row) => ({
    key: modelBoundSchemaKey(row.id, key),
    value: { ...row },
  }))
}
export function modelBoundSchemaMutation(
  history: BoundSchemaHistory,
  phase: BoundSchemaPhase,
  base: ReadonlyArray<BoundSchemaRow>,
) {
  const binding = modelBoundSchemaBinding(history, phase)
  const original = base[0]!
  const label = modelBoundSchemaLabel(binding.schema, history.input)
  const modified = { ...original, label }
  return {
    rows: modelBoundSchemaRows([modified, ...base.slice(1)], binding.key),
    mutations: [
      {
        key: modelBoundSchemaKey(original.id, binding.key),
        original: { ...original },
        modified,
        changes: { label },
      },
    ],
  }
}

function orderedBoundSchemaRows(rows: BoundSchemaRows) {
  return [...rows].sort((a, b) =>
    `${typeof a.key}:${String(a.key)}`.localeCompare(
      `${typeof b.key}:${String(b.key)}`,
    ),
  )
}
export function checkBoundSchemaRows(
  actual: BoundSchemaRows,
  expected: BoundSchemaRows,
  cut: string,
): void {
  // Only unspecified row order is normalized. Extra fields, duplicate rows,
  // missing peers and wrong keys remain representable and fail here.
  expect(orderedBoundSchemaRows(actual), cut).toStrictEqual(
    orderedBoundSchemaRows(expected),
  )
}
export type BoundSchemaObservation = {
  immediate: BoundSchemaRows
  collection: BoundSchemaRows
  state: BoundSchemaRows
  data: ReadonlyArray<Readonly<Record<string, unknown>>>
  mutations: ReadonlyArray<BoundSchemaMutation>
}
export function checkBoundSchemaValues(
  actual: ReadonlyArray<Readonly<Record<string, unknown>>>,
  expected: ReadonlyArray<Readonly<Record<string, unknown>>>,
  cut: string,
): void {
  const byId = (
    a: Readonly<Record<string, unknown>>,
    b: Readonly<Record<string, unknown>>,
  ) => String(a.id).localeCompare(String(b.id))
  expect([...actual].sort(byId), cut).toStrictEqual([...expected].sort(byId))
}
export function checkBoundSchemaMutation(
  actual: BoundSchemaObservation,
  expected: ReturnType<typeof modelBoundSchemaMutation>,
  cut: string,
): void {
  for (const field of [`immediate`, `collection`, `state`] as const)
    checkBoundSchemaRows(actual[field], expected.rows, `${cut}/${field}`)
  checkBoundSchemaValues(
    actual.data,
    expected.rows.map(({ value }) => value),
    `${cut}/host data`,
  )
  expect(actual.mutations, `${cut}/handler payload`).toStrictEqual(
    expected.mutations,
  )
}

// Every lane is required separately in each native receiving driver. A held
// observation counts only after immediate/public/handler comparisons succeed.
export const boundSchemaCuts = [
  `initial-source-raw`,
  `initial-held`,
  `initial-settled`,
  `retained-held`,
  `retained-settled`,
  `retained-source-raw`,
  `rebound-source-raw`,
  `rebound-held`,
  `rebound-settled`,
  `rebound-followup-source-raw`,
  `rebound-followup-held`,
  `rebound-followup-settled`,
] as const
export function boundSchemaLane(history: BoundSchemaHistory) {
  return `${history.identity}/${history.firstSchema}->${history.nextSchema}/${history.changeKey ? `new-key` : `same-key`}/${history.input.word}`
}
export const boundSchemaReachStates = boundSchemaHistories.flatMap((history) =>
  boundSchemaCuts.map((cut) => `${boundSchemaLane(history)}/${cut}`),
)

declareOracle({
  grammar: [boundOptionHistories, boundSchemaHistories],
  model: [
    modelBoundSchemaBinding,
    modelBoundSchemaKey,
    modelBoundSchemaLabel,
    modelBoundSchemaRows,
    modelBoundSchemaMutation,
  ],
  check: [
    checkBoundOptions,
    checkBoundSchemaRows,
    checkBoundSchemaValues,
    checkBoundSchemaMutation,
  ],
})
