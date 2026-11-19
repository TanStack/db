/**
 * The shared eager-source checker remains the independent judge at every
 * original checkpoint. This bridge records its named mismatch as framework
 * comparison evidence; fixture/setup errors still escape as driver errors.
 * Five randomized constructions preserve TrailBase's minimum-five reach across
 * the same twelve-step grammar. They vary rows, titles, notes, value examples
 * and key rotation from the generated history, and return fresh objects.
 */
import {
  ConformanceViolation,
  checkEagerLiveSourceHistory,
  describeValue,
  jsonValueKinds,
} from '../../db-adapter-conformance/src'
import type {
  ConformanceRow,
  EagerLiveSourceDriver,
  EagerLiveSourceHistory,
  EagerLiveSourceReachState,
} from '../../db-adapter-conformance/src'
import type { Observation, Verdict } from '../../db/tests/oracle-property'

export type EagerHistoryResult = {
  browserErrors?: ReadonlyArray<string>
  reached: Array<EagerLiveSourceReachState>
  result?: { accepted: number; skipped: number }
  failure?: {
    law: string
    step: number
    expected: unknown
    actual: unknown
    cleanup: Array<string>
  }
}

// These are members of the unchanged shared grammar's value-example domain.
// They construct inputs only; the shared model owns all expected row truth.
const examples = [
  [``, `plain`, `two\nlines`, `ünïcødé ✓`],
  [0, -7, 2 ** 31, Number.MAX_SAFE_INTEGER],
  [0.5, -1.25, 1e-7],
  [true, false],
  [null],
  [[], [0, `a`, null], [[1], [true]]],
  [{}, { a: 0, b: `x` }, { nested: { deep: [1, { k: null }] } }, { '': false }],
] as const

export function constructTrailBaseEagerHistory(
  generated: EagerLiveSourceHistory,
  salt: number,
): EagerLiveSourceHistory {
  let hash = salt + 1
  for (const char of describeValue(generated))
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  const offset = hash % 5
  const kinds = jsonValueKinds.map(
    (_, index) => (index + salt) % jsonValueKinds.length,
  )
  const row = (kind: number, index: number, note: boolean): ConformanceRow => ({
    id: ((index + offset) % 5) + 1,
    title: ([`a`, `b`, `c`] as const)[(hash + index) % 3]!,
    ...(note ? { note: hash % 2 ? `x` : `y` } : {}),
    value: structuredClone(
      examples[kind]![(hash + index) % examples[kind]!.length],
    ),
  })
  const initial = kinds.slice(0, 4).map((kind, index) => row(kind, index, true))
  const changes = kinds.map((kind, index) => ({
    type: `upsert` as const,
    row: row(kind, index, false),
  }))
  // Fail before and after readiness, then restart each failed run. The
  // malformed first delivery checks duplicate replacement. Two later loads
  // partition the seven kinds because a load holds at most four rows. Three
  // batches carry all seven change kinds (at most three changes per batch),
  // and the first update removes a note from a held row. This uses the
  // existing twelve-step bound; no extra grammar length is introduced.
  return [
    { kind: `fail` },
    { kind: `restart` },
    {
      kind: `malformed`,
      rows: [row(kinds[hash % 7]!, 0, true)],
      duplicate: hash % 3,
    },
    { kind: `fail` },
    { kind: `restart` },
    { kind: `snapshot`, rows: initial },
    { kind: `changes`, changes: changes.slice(0, 3) },
    { kind: `changes`, changes: changes.slice(3, 6) },
    { kind: `changes`, changes: changes.slice(6) },
    { kind: `fail` },
    { kind: `restart` },
    {
      kind: `snapshot`,
      rows: kinds.slice(4).map((kind, index) => row(kind, index, false)),
    },
  ]
}

export async function observeTrailBaseEagerHistory(
  driver: EagerLiveSourceDriver,
  history: EagerLiveSourceHistory,
  corruptValues = false,
): Promise<EagerHistoryResult> {
  const reached: Array<EagerLiveSourceReachState> = []
  const actualDriver = corruptValues
    ? {
        ...driver,
        create: () => {
          const fixture = driver.create()
          const collection = fixture.collection
          return {
            ...fixture,
            collection: {
              ...collection,
              get status() {
                return collection.status
              },
              get health() {
                return collection.health
              },
              *values() {
                for (const row of collection.values())
                  yield { ...row, value: { incorrect: true } }
              },
            },
          }
        },
      }
    : driver
  try {
    const result = await checkEagerLiveSourceHistory(actualDriver, history, {
      reach: (state) => reached.push(state),
    })
    return { reached, result }
  } catch (error) {
    const primary = error instanceof AggregateError ? error.cause : error
    if (!(primary instanceof ConformanceViolation)) throw error
    return {
      reached,
      failure: {
        law: primary.law,
        step: primary.step,
        expected: primary.expected,
        actual: primary.actual,
        cleanup:
          error instanceof AggregateError ? error.errors.map(String) : [],
      },
    }
  }
}

export function trailBaseEagerVerdict(
  trace: ReadonlyArray<Observation>,
  required: ReadonlyArray<string>,
): Verdict {
  const completed = trace.find((entry) => entry.checkpoint === `completed`)
  const actual = completed?.value as EagerHistoryResult | undefined
  const browserErrors = actual?.browserErrors ?? []
  const secondary = browserErrors.length
    ? `; secondary browser errors: ${browserErrors.join(`; `)}`
    : ``
  if (actual?.failure) {
    const { law, step, expected, actual: observed, cleanup } = actual.failure
    return {
      kind: `violation`,
      checkpoint: `step:${step}`,
      law,
      difference: `${law} at original shared checkpoint ${step}${cleanup.length ? `; secondary cleanup: ${cleanup.join(`; `)}` : ``}${secondary}`,
      values: { expected, actual: observed },
    }
  }
  const reached = new Set(
    trace
      .filter((entry) => entry.checkpoint === `reach`)
      .map((entry) => entry.value),
  )
  const missing = required.filter((state) => !reached.has(state))
  if (missing.length)
    return {
      kind: `violation`,
      checkpoint: `reach`,
      law: `constructed builder reach`,
      difference: `generated construction omitted ${missing.join(`, `)}${secondary}`,
    }
  if (!actual?.result)
    return {
      kind: `violation`,
      checkpoint: `completed`,
      law: `eager source comparison`,
      difference: `shared comparison did not complete${secondary}`,
    }
  if (browserErrors.length)
    return {
      kind: `violation`,
      checkpoint: `browser`,
      law: `detached-browser-error`,
      difference: browserErrors.join(`; `),
    }
  return { kind: `pass` }
}
