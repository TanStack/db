// Shared helpers and finite cell grammars for the functional projection tests.
// The law these support: functional projection contract in
// packages/db/src/query/live/ARCHITECTURE.md. The oracle that owns the law is
// includes-functional-projection-oracle.test.ts; the ordinary tests are in
// includes-functional-projection.test.ts.

export const boundaries = [`query-ref`, `recursive-query-ref`, `union`] as const
export const forms = [`collection`, `array`, `materialized`] as const
export const outputs = [`expression`, `record`, `opaque-root`] as const
export const initialStates = [`empty`, `populated`] as const
export const cells = boundaries.flatMap((boundary) =>
  forms.flatMap((form) =>
    outputs.flatMap((output) =>
      initialStates.map((initial) => ({ boundary, form, output, initial })),
    ),
  ),
)
export const orderedPairCells = cells
  .filter(({ initial }) => initial === `populated`)
  .map((cell) => ({ ...cell, initial: `ordered-pair` as const }))
export const consumers = [`expression`, `functional`] as const
export const valueShapes = [`number`, `null`, `date`, `dropped-record`] as const
export const valueCells = forms.flatMap((form) =>
  consumers.flatMap((consumer) =>
    valueShapes.flatMap((shape) =>
      [false, true].map((withInclude) => ({
        form,
        consumer,
        shape,
        withInclude,
      })),
    ),
  ),
)
export const renamedCells = forms.flatMap((form) =>
  consumers.flatMap((consumer) =>
    consumers.flatMap((projection) =>
      [false, true].map((withSibling) => ({
        form,
        consumer,
        projection,
        withSibling,
      })),
    ),
  ),
)
export const operatorCells = forms.flatMap((form) =>
  ([`custom-key`, `selected-order`, `distinct`] as const).flatMap((operator) =>
    [false, true].map((readsInclude) => ({ form, operator, readsInclude })),
  ),
)

export type Child = { id: number; parentGroup: number; value: number }
export type Input = { id: number; kind: string; children?: unknown }
// Phase labels name this oracle's observation cuts. They do not model D2 phases.
export type Phase = `initial` | `child-update` | `sibling-update` | `route-move`
export type ChildView = {
  valid: boolean
  ready: boolean | undefined
  rows: Array<Child>
}

export function readChildren(
  value: unknown,
  form: (typeof forms)[number],
): ChildView {
  if (form !== `collection`) {
    return {
      valid: Array.isArray(value),
      ready: undefined,
      rows: Array.isArray(value) ? value : [],
    }
  }
  if (
    typeof value !== `object` ||
    value === null ||
    !(`toArray` in value) ||
    !(`isReady` in value) ||
    typeof value.isReady !== `function`
  ) {
    return { valid: false, ready: undefined, rows: [] }
  }
  return {
    valid: Array.isArray(value.toArray),
    ready: value.isReady(),
    rows: Array.isArray(value.toArray) ? value.toArray : [],
  }
}

// Keep only the selected public fields in row comparisons. Other assertions
// check callback-time shape and facade readiness.
export function selectedRows(rows: ReadonlyArray<Child>) {
  return rows.map(({ id, parentGroup, value }) => ({ id, parentGroup, value }))
}

export function publicRows(rows: ReadonlyArray<Child>) {
  return selectedRows(rows).sort((left, right) => left.id - right.id)
}

export const collectionInputError = `fn.select() cannot consume Collection-valued includes`
export function rejectsCollectionInput(
  form: string,
  ...functional: Array<boolean>
): boolean {
  return form === `collection` && functional.some(Boolean)
}

export const noPrimaryFailure = Symbol(`no primary oracle failure`)

// Run every release even when an earlier one fails. If the oracle already
// failed, keep that mismatch as the cause and report cleanup separately.
export async function cleanupAfterOracle(
  primaryFailure: unknown,
  releases: ReadonlyArray<() => void | Promise<void>>,
): Promise<void> {
  const cleanupFailures: Array<unknown> = []
  for (const release of releases) {
    try {
      await release()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (cleanupFailures.length === 0) return
  if (primaryFailure === noPrimaryFailure && cleanupFailures.length === 1)
    throw cleanupFailures[0]
  throw new AggregateError(cleanupFailures, `oracle cleanup failed`, {
    ...(primaryFailure === noPrimaryFailure ? {} : { cause: primaryFailure }),
  })
}

export class Projection {
  constructor(
    readonly id: number,
    readonly kind: string,
    readonly children: unknown,
    readonly total: number,
  ) {}
}
