import { describe, expect } from 'vitest'
import { createChangeProxy } from '../src/proxy'
import { oracleProperty, pass } from './oracle-property'
import {
  FIELDS,
  FIXED_SEED,
  HOLE,
  S,
  Secret,
  applicable,
  canon,
  classWriteArb,
  encode,
  expectedChanges,
  historyArb,
  nativeHistoryArb,
  nestedRoundTripArb,
  partialRevertArb,
  prim,
  realize,
  realizeRoot,
  resolve,
  signedZeroArb,
  signedZeroHistory,
  signedZeroPaths,
  step,
  typedKind,
} from './proxy-revert-model-oracle'
import type { Observation, Verdict } from './oracle-property'
import type {
  Field,
  History,
  MapValue,
  NativeHistory,
  NativeRow,
  Op,
  Primitive,
  Root,
  SignedZeroInput,
  Spec,
} from './proxy-revert-model-oracle'

/**
 * # Which draft writes count as changes, and which count as reverts?
 *
 * A draft records the changes a callback makes to a row. A write that makes a
 * value structurally equal to its original again is a revert. `getChanges()`
 * reports each own enumerable string key whose final value differs from its
 * original, with that final value, and each deleted key as `undefined`. It
 * may also report a key the callback wrote whose final value equals its
 * original, with that value. A missed change (a false negative) breaks the
 * row; an extra report of an equal value (a false positive) only repeats the
 * stored value, so the law permits it. A direct write back to the original
 * value still reports nothing.
 *
 * "Equal" here is draft equality, which is stricter than `deepEquals`:
 *
 * 1. Primitives compare by SameValue: `-0` differs from `0`, and `NaN` equals `NaN`.
 * 2. Dates compare by timestamp. Invalid dates are equal.
 * 3. Regular expressions compare by source, flags, and `lastIndex`.
 * 4. Maps and Sets compare by entries or values in insertion order.
 * 5. Arrays compare by length and present indexes, so a hole differs from
 *    `undefined`.
 * 6. Plain objects compare by enumerable own string and symbol keys, in any
 *    order.
 * 7. Typed arrays compare by class and by elements under rule 1.
 * 8. URLs compare by `href`.
 * 9. Instances of two different classes differ. A class instance and a
 *    plain object compare by keys, because a draft snapshot holds class
 *    instances as plain objects. A class instance without enumerable keys
 *    (here, one with only a private field) equals only itself.
 *
 * Laws checked at one checkpoint: after the last write of a history.
 * The driver writes through `createChangeProxy`'s draft
 * (its `set`, `deleteProperty`, and `get` traps, and the array iterator), and
 * the check reads `getChanges()` and the draft.
 *
 * - `getChanges()` reports every change in the model, with its final value.
 *   Any other key it reports is one the history wrote, with its final value.
 * - Reading the draft gives the model's final value.
 * - The original row is unchanged.
 *
 * Authority: rules 1 to 6 and the laws come from the `createChangeProxy` and
 * `getChanges` implementation comments in `src/proxy.ts` and the revert
 * examples in `tests/proxy-oracle.test.ts`, as of `18abceee`. Rules 7 to 9 are design
 * decisions recorded in
 * `docs/contributing/oracle-reviews/code-weight-draft-proxy.md`. The
 * false-positive permission is a maintainer decision (2026-10-09), recorded in
 * `docs/contributing/oracle-reviews/proxy-revert-replaced-object.md`.
 * The maintainer's FID-1 decision (2026-10-29), recorded in the coverage map,
 * also requires user writes to preserve signed zero, including nested and
 * floating typed-array values. This supersedes rule 1's earlier zero equivalence.
 *
 * Limits:
 * - The main histories write by assignment, delete, nested property write,
 *   and nested write through `for...of` on an array. A native mutator
 *   (`push`, `set`, `add`, ...) marks a value changed without a revert check,
 *   so a mutator that leaves the value equal may still report it. The last
 *   block mixes array mutators with assignments, a nested object, and a
 *   retained handle, and checks when that permission ends. Map and Set
 *   mutators are not mixed with assignments. Each mutator's own result
 *   belongs to `proxy-native-methods-oracle.property.test.ts`.
 * - An assignment of a value draft-equal to the current one is a no-op, so a
 *   handle retained before it stays attached. Native JavaScript would detach
 *   it; no law here decides that case.
 * - Top-level symbol keys are not written. `getChanges()` does not report
 *   them; the coverage map lists symbol writes as unsupported. Symbol keys
 *   inside nested objects are written.
 * - Keys are non-index strings, so property order follows insertion order.
 * - A keyed class instance (`Point`) appears in original rows and written
 *   values. A keyless one (`Secret`) appears only as a written value. A
 *   draft reads a class instance of the original row as a plain object; the
 *   detachment contract owns that boundary.
 */

// ---------------------------------------------------------------------------
// Driver.

function drive(draft: Record<string, any>, op: Op): void {
  switch (op.op) {
    case `set`:
      draft[op.field] = realize(op.value)
      return
    case `revert`:
      return
    case `delete`:
      delete draft[op.field]
      return
    case `nested`:
      if (op.key === `sym`) draft[op.field][S] = op.value
      else draft[op.field][op.key] = op.value
      return
    case `nestedDelete`:
      if (op.key === `sym`) delete draft[op.field][S]
      else delete draft[op.field][op.key]
      return
    case `index`:
      draft[op.field][op.index] = op.value
      return
    case `forOf`: {
      let index = 0
      for (const row of draft[op.field] as Array<{ a: unknown }>) {
        if (index++ === op.index) row.a = op.value
      }
      return
    }
  }
}

function readSpec(value: unknown, like: Spec | undefined): string {
  // Encode the draft's value with the same rules as the model.
  if (like === undefined)
    return value === undefined ? encode(undefined) : `present`
  switch (like.k) {
    case `prim`:
      return JSON.stringify(prim(value as Primitive))
    case `date`:
      return value instanceof Date
        ? encode({ k: `date`, t: value.getTime() })
        : `not a Date`
    case `regex`:
      return value instanceof RegExp
        ? encode({ k: `regex`, flags: value.flags, lastIndex: value.lastIndex })
        : `not a RegExp`
    case `map`:
      return value instanceof Map
        ? encode({
            k: `map`,
            entries: [...value].map(([key, v]): [string, MapValue] => [
              key,
              v instanceof Set ? { set: [...v] } : v,
            ]),
          })
        : `not a Map`
    case `set`:
      return value instanceof Set
        ? encode({ k: `set`, values: [...value] })
        : `not a Set`
    case `array`: {
      if (!Array.isArray(value)) return `not an array`
      const items: Array<Primitive | typeof HOLE> = []
      for (let i = 0; i < value.length; i++)
        items.push(i in value ? (value[i] as Primitive) : HOLE)
      return encode({ k: `array`, items })
    }
    case `obj`: {
      if (value === null || typeof value !== `object`) return `not an object`
      const o = value as Record<PropertyKey, Primitive>
      const keys = Reflect.ownKeys(o).filter((key) =>
        Object.prototype.propertyIsEnumerable.call(o, key),
      )
      if (keys.some((key) => key !== `a` && key !== `b` && key !== S))
        return `extra keys`
      const spec: Spec = { k: `obj` }
      if (`a` in o) spec.a = o.a
      if (`b` in o) spec.b = o.b
      if (S in o) spec.sym = o[S]
      return encode(spec)
    }
    case `rows`:
      return Array.isArray(value)
        ? encode({
            k: `rows`,
            rows: value.map((row: { a: Primitive }) => ({ a: row.a })),
          })
        : `not rows`
    case `typed`: {
      const ctor = typedKind(value)
      return ctor === undefined
        ? `not a typed array`
        : encode({
            k: `typed`,
            ctor,
            values: Array.from(value as Float64Array),
          })
    }
    case `url`:
      return value instanceof URL
        ? encode({ k: `url`, path: value.pathname.slice(1) as `a` | `b` })
        : `not a URL`
    case `secret`:
      return value instanceof Secret
        ? encode({ k: `secret`, v: value.read() })
        : `not a Secret`
    case `point`:
      // A Point, or the plain object a draft reads for one.
      return readSpec(value, { k: `obj`, a: like.a })
  }
}

type HistoryObservation = {
  keys: Array<string>
  reported: Record<Field, boolean>
  changes: Record<Field, string>
  deleted: Record<Field, boolean>
  draft: Record<Field, string>
  original: Record<Field, string>
  before: Record<Field, string>
}

// This is the existing transition model, separated from its production driver.
// The observer encodes each rich value through the same readSpec projection
// used by the original comparison; no Date, draft, class, or symbol is a trace.
function historyExpectation({ original, ops }: History) {
  let state: Root = { ...original }
  const written = new Set<Field>()
  for (const generated of ops) {
    const op = resolve(state, original, generated)
    if (op === undefined || !applicable(state, original, op)) continue
    written.add(op.field)
    state = step(state, original, op)
  }
  return { state, written, expected: expectedChanges(original, state) }
}

function driveHistory({ original, ops }: History): HistoryObservation {
  const row = realizeRoot(original)
  const before = realizeRoot(original)
  const { proxy, getChanges } = createChangeProxy(row)
  let state: Root = { ...original }
  for (const generated of ops) {
    const op = resolve(state, original, generated)
    if (op === undefined || !applicable(state, original, op)) continue
    if (op.op === `revert`) {
      if (original[op.field] === undefined) delete proxy[op.field]
      else
        proxy[op.field] = op.same ? row[op.field] : realize(original[op.field]!)
    } else drive(proxy as Record<string, any>, op)
    state = step(state, original, op)
  }

  const changes = getChanges() as Record<string, unknown>
  const fields = (read: (field: Field) => string): Record<Field, string> =>
    Object.fromEntries(FIELDS.map((field) => [field, read(field)])) as Record<
      Field,
      string
    >
  return {
    keys: Object.keys(changes),
    reported: Object.fromEntries(
      FIELDS.map((field) => [field, field in changes]),
    ) as Record<Field, boolean>,
    changes: fields((field) =>
      field in changes
        ? readSpec(changes[field], state[field])
        : `not reported`,
    ),
    deleted: Object.fromEntries(
      FIELDS.map((field) => [field, changes[field] === undefined]),
    ) as Record<Field, boolean>,
    draft: fields((field) => readSpec(proxy[field], state[field])),
    original: fields((field) => readSpec(row[field], original[field])),
    before: fields((field) => readSpec(before[field], original[field])),
  }
}

function expectHistoryObservation(
  { original, ops }: History,
  observed: HistoryObservation,
  { state, written, expected } = historyExpectation({ original, ops }),
): void {
  const context = JSON.stringify({
    original: Object.fromEntries(FIELDS.map((f) => [f, canon(original[f])])),
    ops,
  })
  for (const field of expected.keys())
    expect(
      observed.reported[field],
      `change of ${field} reported, ${context}`,
    ).toBe(true)
  // An extra report is permitted only for a written key, with its final value.
  expect(
    observed.keys.filter(
      (key) => !(FIELDS as ReadonlyArray<string>).includes(key),
    ),
    `keys outside the row reported, ${context}`,
  ).toEqual([])
  for (const field of FIELDS) {
    if (!observed.reported[field] || expected.has(field)) continue
    expect(written.has(field), `unwritten ${field} reported, ${context}`).toBe(
      true,
    )
    expect(
      observed.changes[field],
      `extra report of ${field}, ${context}`,
    ).toBe(encode(state[field]))
  }
  for (const [field, spec] of expected) {
    if (spec === undefined)
      expect(observed.deleted[field], `deleted ${field}, ${context}`).toBe(true)
    else
      expect(observed.changes[field], `change of ${field}, ${context}`).toBe(
        encode(spec),
      )
  }
  for (const field of FIELDS)
    expect(observed.draft[field], `draft ${field}, ${context}`).toBe(
      encode(state[field]),
    )
  for (const field of FIELDS)
    expect(
      observed.original[field],
      `original ${field} unchanged, ${context}`,
    ).toBe(observed.before[field])
}

function checkHistory(
  history: History,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof historyExpectation>,
): Verdict {
  try {
    const final = trace.find((entry) => entry.checkpoint === `final`)
    expect(final, `final draft observation`).toBeDefined()
    expectHistoryObservation(
      history,
      final!.value as HistoryObservation,
      expected,
    )
    return pass
  } catch (error) {
    if (!(error instanceof Error) || error.name !== `AssertionError`)
      throw error
    return {
      kind: `violation`,
      law: `draft revert`,
      checkpoint: `final`,
      difference: error.message,
      cause: error,
    }
  }
}

function historyDriver(
  history: History,
  observe: (checkpoint: string, value: unknown) => void,
): void {
  observe(`final`, driveHistory(history))
}

const revertLaw = {
  statement: `Draft reads, changes, and original-row isolation agree with the existing independent draft-equality transition model after the final write.`,
  authority: `The nine draft-equality rules and maintainer decisions documented above.`,
  limits: `The existing assignment, deletion, nested, iterator, typed-array, URL, class, and revert grammars; no new values or paths are introduced.`,
}

// ---------------------------------------------------------------------------
// Campaigns. Each generated property has a fixed campaign and a random
// campaign over the same grammar and check. A path replay of one property
// runs its recorded history once and every other test stands aside. A seed
// alone reseeds the random campaigns.

const WRITE_HISTORY = `proxy.revert-history`
const NESTED_ROUND_TRIPS = `proxy.revert-nested-round-trips`
const CLASS_WRITES = `proxy.revert-class-writes`
const PARTIAL_REVERTS = `proxy.revert-partial-reverts`
const NATIVE_HISTORIES = `proxy.revert-native-histories`
const SIGNED_ZERO = `proxy.revert-signed-zero`

describe(`draft revert oracle`, () => {
  // These six fixed histories reconstruct the scalar false-green witness and
  // its nested/Float64 neighbors in both directions. They use the generated
  // campaign's model, draft driver and final getChanges/draft/isolation check.
  const zeroExamples: Array<SignedZeroInput> = signedZeroPaths.flatMap((path) =>
    [false, true].map((negative) => ({
      path,
      negative,
      field: `f`,
      key: `a`,
      width: 1,
      index: 0,
    })),
  )
  oracleProperty({
    id: SIGNED_ZERO,
    law: revertLaw,
    // What this oracle owns: the gap report judges the draft's revert and change
    // report, and its native mutator writes, in proxy.ts by this file's tests.
    owns: [`src/proxy.ts`],
    histories: {
      arbitrary: signedZeroArb,
      runs: 100,
      fixedSeeds: [FIXED_SEED],
      states: signedZeroPaths,
      constructed: signedZeroPaths.map((path) => ({
        name: path,
        enters: [path],
        build: (history: SignedZeroInput) => ({ ...history, path }),
      })),
      fixed: zeroExamples.map((history) => ({
        name: `${history.path}/${history.negative}`,
        history,
        enters: [history.path],
      })),
    },
    resolve: (input) => ({ input, history: signedZeroHistory(input) }),
    model: ({ history }) => historyExpectation(history),
    driver: ({ input, history }, observe) => {
      historyDriver(history, observe)
      observe(`reach`, input.path)
    },
    check: ({ history }, trace, expected) =>
      checkHistory(history, trace, expected),
  })

  oracleProperty({
    id: WRITE_HISTORY,
    law: revertLaw,
    owns: [`src/proxy.ts`],
    histories: { arbitrary: historyArb, runs: 400, fixedSeeds: [FIXED_SEED] },
    model: historyExpectation,
    driver: historyDriver,
    check: checkHistory,
  })

  oracleProperty({
    id: NESTED_ROUND_TRIPS,
    law: revertLaw,
    owns: [`src/proxy.ts`],
    histories: {
      arbitrary: nestedRoundTripArb,
      runs: 200,
      fixedSeeds: [FIXED_SEED],
    },
    model: historyExpectation,
    driver: historyDriver,
    check: checkHistory,
  })

  oracleProperty({
    id: CLASS_WRITES,
    law: revertLaw,
    owns: [`src/proxy.ts`],
    histories: {
      arbitrary: classWriteArb,
      runs: 200,
      fixedSeeds: [FIXED_SEED],
    },
    model: historyExpectation,
    driver: historyDriver,
    check: checkHistory,
  })

  oracleProperty({
    id: PARTIAL_REVERTS,
    law: revertLaw,
    owns: [`src/proxy.ts`],
    histories: {
      arbitrary: partialRevertArb,
      runs: 200,
      fixedSeeds: [FIXED_SEED],
    },
    model: historyExpectation,
    driver: historyDriver,
    check: checkHistory,
  })

  // Fixed histories. The generated grammars cannot take these back, so one
  // enumerated property replays them through the campaign's model, draft
  // driver and final getChanges/draft/isolation check.
  const fixedHistories: Array<{ name: string; history: History }> = (
    [
      [
        `reverting one of two changed fields keeps the other change`,
        {
          original: { f: { k: `prim`, v: `a` }, g: { k: `prim`, v: `a` } },
          ops: [
            { op: `set`, field: `f`, value: { k: `prim`, v: `b` } },
            { op: `set`, field: `g`, value: { k: `prim`, v: `b` } },
            { op: `revert`, field: `f` },
          ],
        },
      ],
      [
        `adding a nested key and deleting it again is not a change`,
        {
          original: { f: { k: `obj`, a: 1 } },
          ops: [
            { op: `nested`, field: `f`, key: `b`, value: 2 },
            { op: `nestedDelete`, field: `f`, key: `b` },
          ],
        },
      ],
      [
        `restoring a nested value is not a change while a sibling stays changed`,
        {
          original: { f: { k: `obj`, a: 1 }, g: { k: `prim`, v: `a` } },
          ops: [
            { op: `nested`, field: `f`, key: `a`, value: 2 },
            { op: `set`, field: `g`, value: { k: `prim`, v: `b` } },
            { op: `nested`, field: `f`, key: `a`, value: 1 },
          ],
        },
      ],
      [
        `deleting an added nested key is not a change while a sibling stays changed`,
        {
          original: { f: { k: `obj`, a: 1 }, g: { k: `prim`, v: `a` } },
          ops: [
            { op: `nested`, field: `f`, key: `b`, value: 2 },
            { op: `set`, field: `g`, value: { k: `prim`, v: `b` } },
            { op: `nestedDelete`, field: `f`, key: `b` },
          ],
        },
      ],
      [
        `a replaced object that returns to its new value is still a change`,
        {
          original: { f: { k: `obj`, a: 1 } },
          ops: [
            { op: `set`, field: `f`, value: { k: `obj`, a: 2 } },
            { op: `nested`, field: `f`, key: `a`, value: 3 },
            { op: `nested`, field: `f`, key: `a`, value: 2 },
          ],
        },
      ],
      [
        `a replaced object restored to its original by a nested write reports at most its original value`,
        {
          original: { f: { k: `obj`, a: 0 } },
          ops: [
            { op: `set`, field: `f`, value: { k: `obj` } },
            { op: `nested`, field: `f`, key: `a`, value: 0 },
          ],
        },
      ],
      [
        `a replaced object restored with its symbol key kept reports at most its original value`,
        {
          original: {
            f: { k: `obj`, a: 0, sym: 1 },
            g: { k: `map`, entries: [] },
          },
          ops: [
            { op: `nested`, field: `f`, key: `a`, value: 0 },
            { op: `set`, field: `f`, value: { k: `obj`, sym: 1 } },
            { op: `nested`, field: `f`, key: `a`, value: 0 },
          ],
        },
      ],
      [
        `an array replaced by an empty Set is a change`,
        {
          original: { g: { k: `array`, items: [] } },
          ops: [{ op: `set`, field: `g`, value: { k: `set`, values: [] } }],
        },
      ],
      [
        `a key added with the value undefined stays a change after a sibling revert`,
        {
          original: { f: { k: `obj`, a: 0 } },
          ops: [
            { op: `nested`, field: `f`, key: `b`, value: 0 },
            { op: `set`, field: `h`, value: { k: `prim`, v: undefined } },
            { op: `nestedDelete`, field: `f`, key: `b` },
          ],
        },
      ],
      [
        `a typed-array subclass keeps its elements in the draft`,
        {
          original: { f: { k: `typed`, ctor: `vec3`, values: [1, 2, 3] } },
          ops: [{ op: `index`, field: `f`, index: 0, value: 9 }],
        },
      ],
      [
        `rewriting NaN into a Float64Array is not a change`,
        {
          original: { f: { k: `typed`, ctor: `f64`, values: [NaN, 1] } },
          ops: [
            {
              op: `set`,
              field: `f`,
              value: { k: `typed`, ctor: `f64`, values: [NaN, 1] },
            },
            { op: `index`, field: `f`, index: 0, value: NaN },
          ],
        },
      ],
      [
        `a typed array of another class is a change`,
        {
          original: { f: { k: `typed`, ctor: `f64`, values: [1, 0] } },
          ops: [
            {
              op: `set`,
              field: `f`,
              value: { k: `typed`, ctor: `u8`, values: [1, 0] },
            },
          ],
        },
      ],
      [
        `deleting a field and writing its original back is a revert`,
        {
          original: { f: { k: `prim`, v: `a` }, g: { k: `prim`, v: `a` } },
          ops: [
            { op: `delete`, field: `f` },
            { op: `revert`, field: `f` },
          ],
        },
      ],
      [
        `a nested write through for...of records the row change`,
        {
          original: { f: { k: `rows`, rows: [{ a: 0 }, { a: 1 }] } },
          ops: [{ op: `forOf`, field: `f`, index: 1, value: `a` }],
        },
      ],
      [
        `a nested write through for...of that restores the value is a revert`,
        {
          original: { f: { k: `rows`, rows: [{ a: 0 }, { a: 1 }] } },
          ops: [
            { op: `forOf`, field: `f`, index: 1, value: `a` },
            { op: `forOf`, field: `f`, index: 1, value: 1 },
          ],
        },
      ],
      [
        `a change made only under a nested symbol key is recorded`,
        {
          original: { f: { k: `obj`, a: 1, sym: `a` } },
          ops: [{ op: `nested`, field: `f`, key: `sym`, value: `b` }],
        },
      ],
      [
        `replacing a nested object with one that differs only under a symbol key is recorded`,
        {
          original: { f: { k: `obj`, a: 1, sym: `a` } },
          ops: [{ op: `set`, field: `f`, value: { k: `obj`, a: 1, sym: `b` } }],
        },
      ],
      [
        `Map entry order is a change`,
        {
          original: {
            f: {
              k: `map`,
              entries: [
                [`x`, 1],
                [`y`, 0],
              ],
            },
          },
          ops: [
            {
              op: `set`,
              field: `f`,
              value: {
                k: `map`,
                entries: [
                  [`y`, 0],
                  [`x`, 1],
                ],
              },
            },
          ],
        },
      ],
      [
        `a reordered Set inside a Map value is a change`,
        {
          original: { f: { k: `map`, entries: [[`x`, { set: [`x`, `y`] }]] } },
          ops: [
            {
              op: `set`,
              field: `f`,
              value: { k: `map`, entries: [[`x`, { set: [`y`, `x`] }]] },
            },
          ],
        },
      ],
      [
        `Set value order is a change`,
        {
          original: { f: { k: `set`, values: [`x`, `y`] } },
          ops: [
            { op: `set`, field: `f`, value: { k: `set`, values: [`y`, `x`] } },
          ],
        },
      ],
      [
        `RegExp lastIndex is a change`,
        {
          original: { f: { k: `regex`, flags: `g`, lastIndex: 0 } },
          ops: [
            {
              op: `set`,
              field: `f`,
              value: { k: `regex`, flags: `g`, lastIndex: 1 },
            },
          ],
        },
      ],
      [
        `a hole replaced by undefined is a change`,
        {
          original: { f: { k: `array`, items: [HOLE, 1] } },
          ops: [
            {
              op: `set`,
              field: `f`,
              value: { k: `array`, items: [undefined, 1] },
            },
          ],
        },
      ],
      [
        `a zero-sign rewrite changes while NaN remains equal`,
        {
          original: { f: { k: `prim`, v: 0 }, g: { k: `prim`, v: NaN } },
          ops: [
            { op: `set`, field: `f`, value: { k: `prim`, v: -0 } },
            { op: `set`, field: `g`, value: { k: `prim`, v: NaN } },
          ],
        },
      ],
    ] satisfies Array<[string, History]>
  ).map(([name, history]) => ({ name, history }))
  oracleProperty({
    id: `proxy.revert-fixed-histories`,
    law: revertLaw,
    owns: [`src/proxy.ts`],
    // Some fixed histories hold symbol keys or values, which are not history
    // data, so each history is its name and resolve looks up its value.
    histories: fixedHistories.map(({ name }) => name),
    label: (name) => name,
    resolve: (name) =>
      fixedHistories.find((entry) => entry.name === name)!.history,
    model: historyExpectation,
    driver: historyDriver,
    check: checkHistory,
  })
})

// ---------------------------------------------------------------------------
// Native mutators mixed with assignments.
//
// The histories above write only through assignment and delete, so they
// cannot reach a key whose value a native mutator changed. A native mutator
// (`push`, `pop`, `reverse`) counts as a change without a revert check, so
// when the value ends equal to the original, `getChanges()` may still report
// it, as for any written key. A mutator called through a handle the callback
// has since replaced changes nothing in the row.
//
// Model: plain JavaScript values. A row is `{ x, f: { arr, g: { a } } }`. Each
// step runs on a native copy. A retained handle is the array object it was
// taken from; once `f.arr` holds another array, the handle is detached. An assignment of a value equal to the current one changes
// nothing, as the set trap documents: the draft keeps its array, so the handle
// and any native write stay attached. Native JavaScript would detach the
// handle there; that difference is an open question, not a law of this block.
//
// Law, checked after the last step:
// - `x` is reported exactly when it differs from the original.
// - `f` is reported, with its final value, when it differs from the original.
//   When it equals the original, `f` may be reported only if the history wrote
//   the live `f` value, and then only with its final value.
// - Reading the draft gives the model's final row.

const cloneRow = (row: NativeRow): NativeRow => ({
  x: row.x,
  f: { arr: [...row.f.arr], g: { ...row.f.g } },
})
const sameRowPart = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right)

function nativeModel(history: NativeHistory): {
  row: NativeRow
  wroteF: boolean
} {
  const row = cloneRow(history.original)
  let handle: Array<number> | undefined
  let wroteF = false
  for (const action of history.ops) {
    switch (action.op) {
      case `push`:
        wroteF = true
        row.f.arr.push(action.v)
        break
      case `pop`:
        wroteF = true
        row.f.arr.pop()
        break
      case `reverse`:
        wroteF = true
        row.f.arr.reverse()
        break
      case `assignArr`:
      case `restoreArr`: {
        const next =
          action.op === `assignArr` ? action.items : history.original.f.arr
        // An assignment of an equal value is a no-op: the draft keeps its
        // array, so a retained handle stays attached.
        if (sameRowPart(next, row.f.arr)) break
        wroteF = true
        row.f.arr = [...next]
        break
      }
      case `replaceG`:
        wroteF = true
        row.f.g = {}
        break
      case `setGa`:
        if (row.f.g.a !== action.v) wroteF = true
        row.f.g.a = action.v
        break
      case `retain`:
        handle = row.f.arr
        break
      case `pushHandle`:
        if (handle === undefined) break
        if (handle === row.f.arr) wroteF = true
        handle.push(action.v)
        break
      case `setX`:
        row.x = action.v
        break
    }
  }
  return { row, wroteF }
}

function driveNative(history: NativeHistory): {
  changes: Record<string, unknown>
  read: unknown
} {
  const { proxy, getChanges } = createChangeProxy(
    cloneRow(history.original) as unknown as Record<string, unknown>,
  )
  const draft = proxy as unknown as NativeRow
  let handle: Array<number> | undefined
  for (const action of history.ops) {
    switch (action.op) {
      case `push`:
        draft.f.arr.push(action.v)
        break
      case `pop`:
        draft.f.arr.pop()
        break
      case `reverse`:
        draft.f.arr.reverse()
        break
      case `assignArr`:
        draft.f.arr = [...action.items]
        break
      case `restoreArr`:
        draft.f.arr = [...history.original.f.arr]
        break
      case `replaceG`:
        draft.f.g = {}
        break
      case `setGa`:
        draft.f.g.a = action.v
        break
      case `retain`:
        handle = draft.f.arr
        break
      case `pushHandle`:
        handle?.push(action.v)
        break
      case `setX`:
        draft.x = action.v
        break
    }
  }
  return {
    changes: getChanges(),
    read: { x: draft.x, f: { arr: [...draft.f.arr], g: { ...draft.f.g } } },
  }
}

function expectNativeResult(
  history: NativeHistory,
  { changes, read }: ReturnType<typeof driveNative>,
  expected = nativeModel(history),
): void {
  const { row: final, wroteF } = expected
  const context = JSON.stringify(history)
  expect(read, `draft reads the final row, ${context}`).toEqual(final)
  const xChanged = final.x !== history.original.x
  expect(`x` in changes, `x reported, ${context}`).toBe(xChanged)
  if (xChanged) expect(changes.x, `x value, ${context}`).toBe(final.x)
  const fChanged = !sameRowPart(final.f, history.original.f)
  if (fChanged) expect(`f` in changes, `f reported, ${context}`).toBe(true)
  else if (!wroteF)
    expect(`f` in changes, `unwritten f absent, ${context}`).toBe(false)
  // An equal f may be reported only after a write to the live value.
  if (`f` in changes) expect(changes.f, `f value, ${context}`).toEqual(final.f)
  expect(Object.keys(changes).sort(), `only x and f, ${context}`).toEqual(
    Object.keys(changes)
      .filter((key) => key === `x` || key === `f`)
      .sort(),
  )
}

function checkNativeHistory(
  history: NativeHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof nativeModel>,
): Verdict {
  try {
    const final = trace.find((entry) => entry.checkpoint === `final`)
    expect(final, `final native draft observation`).toBeDefined()
    expectNativeResult(
      history,
      final!.value as ReturnType<typeof driveNative>,
      expected,
    )
    return pass
  } catch (error) {
    if (!(error instanceof Error) || error.name !== `AssertionError`)
      throw error
    return {
      kind: `violation`,
      law: `native draft revert`,
      checkpoint: `final`,
      difference: error.message,
      cause: error,
    }
  }
}

const nativeRevertLaw = {
  ...revertLaw,
  statement: `Array mutators, assignments, and detached handles preserve the existing final row and permitted change-report law.`,
  limits: `The existing bounded numeric native-history grammar; Map and Set mutators are not mixed with assignments.`,
}

// The two histories of the unwritten-field calibration: an f that the history
// never wrote must stay out of the change report.
const unwrittenFieldHistories: Array<{ name: string; history: NativeHistory }> =
  [
    {
      name: `setX 1`,
      history: {
        original: { x: 0, f: { arr: [1], g: { a: 0 } } },
        ops: [{ op: `setX`, v: 1 }],
      },
    },
    {
      name: `setGa 0`,
      history: {
        original: { x: 0, f: { arr: [1], g: { a: 0 } } },
        ops: [{ op: `setGa`, v: 0 }],
      },
    },
  ]

describe(`draft revert oracle: native mutators mixed with assignments`, () => {
  oracleProperty({
    id: NATIVE_HISTORIES,
    law: nativeRevertLaw,
    owns: [`src/proxy.ts`],
    histories: {
      arbitrary: nativeHistoryArb,
      runs: 400,
      fixedSeeds: [FIXED_SEED],
    },
    model: nativeModel,
    driver: (history, observe) => observe(`final`, driveNative(history)),
    check: checkNativeHistory,
  })

  // Fixed native histories. The generated grammar cannot take them back, so
  // one enumerated property replays them, and the unwritten-field calibration
  // histories, through the campaign's model, draft driver and check.
  const nativeFixedHistories: Array<{ name: string; history: NativeHistory }> =
    [
      ...(
        [
          [
            `a native write that an assignment then restores reports at most its original value`,
            {
              original: { x: 0, f: { arr: [1], g: { a: 0 } } },
              ops: [
                { op: `setX`, v: 1 },
                { op: `push`, v: 2 },
                { op: `restoreArr` },
                { op: `replaceG` },
                { op: `setGa`, v: 0 },
              ],
            },
          ],
          [
            `a mutator through a detached handle changes nothing in the row`,
            {
              original: { x: 0, f: { arr: [1], g: { a: 0 } } },
              ops: [
                { op: `retain` },
                { op: `assignArr`, items: [1, 2] },
                { op: `restoreArr` },
                { op: `pushHandle`, v: 0 },
              ],
            },
          ],
          [
            `restoring the last native write reports at most the original value`,
            {
              original: { x: 0, f: { arr: [0], g: { a: 0 } } },
              ops: [
                { op: `pop` },
                { op: `replaceG` },
                { op: `restoreArr` },
                { op: `setGa`, v: 0 },
              ],
            },
          ],
        ] satisfies Array<[string, NativeHistory]>
      ).map(([name, history]) => ({ name, history })),
      ...unwrittenFieldHistories.map(({ name, history }) => ({
        name: `unwritten-field calibration history: ${name}`,
        history,
      })),
    ]
  oracleProperty({
    id: `proxy.revert-native-fixed-histories`,
    law: nativeRevertLaw,
    owns: [`src/proxy.ts`],
    histories: nativeFixedHistories,
    label: ({ name }) => name,
    resolve: ({ history }) => history,
    model: nativeModel,
    driver: (history, observe) => observe(`final`, driveNative(history)),
    check: checkNativeHistory,
    // The check must reject a report of the unwritten f, at its original
    // value, in each calibration history's recorded final observation.
    calibrations: unwrittenFieldHistories.map(({ name, history: target }) => ({
      name: `rejects an unwritten field in the change report: ${name}`,
      law: `native draft revert`,
      corrupt: (trace: ReadonlyArray<Observation>, history: NativeHistory) =>
        history !== target
          ? undefined
          : trace.map((entry) => {
              if (entry.checkpoint !== `final`) return entry
              const observed = entry.value as ReturnType<typeof driveNative>
              return {
                ...entry,
                value: {
                  ...observed,
                  changes: { ...observed.changes, f: history.original.f },
                },
              }
            }),
    })),
  })
})
