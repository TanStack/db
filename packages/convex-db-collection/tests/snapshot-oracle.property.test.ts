/**
 * A Collection mirrors the complete keyed rows of its latest valid Convex
 * query result, as promised by docs/collections/convex-collection.md. Missing
 * keys delete rows, missing fields disappear, and duplicate keys reject the
 * whole result while preserving the last valid snapshot. Keys retain their
 * string or finite-number identity: numeric 1 and string '1' are distinct.
 *
 * The independent reference is the last valid selected input array. Pairwise
 * key equality judges duplicates without the adapter's map or sync operations.
 * Every generated history covers valid and duplicate starts, then constructs
 * omission, field removal, empty results,
 * reintroduction, duplicates and recovery, then appends arbitrary snapshots.
 * String, numeric and mixed key grammars share that history. The mixed grammar
 * includes 1/'1'; finite numeric parameters include fractions and negatives.
 * Raw and selected runs compare the same law. Selection changes key shape and
 * uppercases text; the reference states that transformation independently.
 *
 * The real Collection receives controlled Convex callbacks. After each
 * delivery, typed public entries, status, health and the error flag are compared.
 * The health migration in #2168 makes first-load failure terminal for its sync
 * run. A valid result recovers that case through reload; after readiness, valid
 * results clear recoverable sync failure reasons in the same run.
 * Reach counts only histories that pass those checks. This owner does not
 * establish provider ordering, intermediate publication, SDK transport,
 * mutation timing or cleanup scheduling; receiving tests own those boundaries.
 */
import { isDeepStrictEqual } from 'node:util'
import { createCollection } from '@tanstack/db'
import { fc } from '@fast-check/vitest'
import { makeFunctionReference } from 'convex/server'
import { expect } from 'vitest'
import { ConvexClient } from 'convex/browser'
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { convexCollectionOptions } from '../src/index'
import { ConvexProvider, rowsQuery } from './conformance-driver'
import { controlledClient, withTestCleanup } from './helpers'
import type { Observation } from '../../db/tests/oracle-property'
import type { Row } from './helpers'

type AssertionHistory<T> = T extends fc.Arbitrary<infer H> ? H : never
type AssertionReach = {
  beginHistory: () => void
  reach: (state: string) => void
}

type KeyedRow = Row & { key: string | number }
const query = makeFunctionReference<
  `query`,
  { owner: string },
  Array<KeyedRow>
>(`tasks:keyed`)

const rowInput = fc.record({
  slot: fc.integer({ min: 0, max: 2 }),
  text: fc.string({ maxLength: 12 }),
  optional: fc.option(fc.string({ maxLength: 6 }), { nil: undefined }),
})
const states = [
  `string-keys`,
  `numeric-keys`,
  `mixed-key-types`,
  `equal-looking-typed-keys`,
  `selected-key-representation`,
  `omitted-key`,
  `omitted-field`,
  `empty-result`,
  `reintroduced-key`,
  `duplicate-rejected`,
  `valid-after-error`,
  `initial-valid`,
  `initial-duplicate-rejected`,
] as const

const convex_snapshotHistory = fc.tuple(
  fc.double({ min: -100, max: 100, noNaN: true }),
  fc.string({ maxLength: 12 }),
  fc.array(fc.array(rowInput, { maxLength: 5 }), {
    minLength: 1,
    maxLength: 30,
  }),
)
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_snapshotJudgment(
  [numberKey, text, suffix]: AssertionHistory<typeof convex_snapshotHistory>,
  reach: AssertionReach,
) {
  reach.beginHistory()
  const keyKinds = [
    { name: `string-keys`, keys: [`a`, `b`, `c`] },
    { name: `numeric-keys`, keys: [numberKey, numberKey + 0.5, 1] },
    { name: `mixed-key-types`, keys: [1, `1`, numberKey] },
  ] as const
  for (const keyKind of keyKinds) {
    const first: KeyedRow = {
      _id: `first`,
      key: keyKind.keys[0],
      text: `lower:${text}`,
      optional: `remove`,
    }
    const second: KeyedRow = {
      _id: `second`,
      key: keyKind.keys[1],
      text,
    }
    // The first two keys are always distinct. This constructive
    // prefix forces adjacent laws even when the random suffix is empty.
    const history: Array<Array<KeyedRow>> = [
      [first, second],
      [{ _id: first._id, key: first.key, text: `updated:${text}` }],
      [],
      [first, second],
      [second, first],
      [first, { ...first, text: `duplicate:${text}` }],
      [{ ...second, text: `recovered:${text}` }],
      ...suffix.map((snapshot) =>
        snapshot.map((value): KeyedRow => ({
          _id: `source:${value.slot}`,
          key: keyKind.keys[value.slot]!,
          text: value.text,
          ...(value.optional === undefined ? {} : { optional: value.optional }),
        })),
      ),
    ]
    for (const [projected, initiallyInvalid] of [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ] as const) {
      const transport = controlledClient()
      const collection = createCollection(
        convexCollectionOptions({
          client: transport.client,
          query,
          queryArgs: { owner: `alice` },
          getKey: (value) => value.key,
          ...(projected
            ? {
                select: (rows: Array<KeyedRow>): Array<KeyedRow> =>
                  rows.map((value) => ({
                    ...value,
                    key:
                      typeof value.key === `number`
                        ? String(value.key)
                        : `selected:${value.key}`,
                    text: value.text.toUpperCase(),
                  })),
              }
            : {}),
          gcTime: 0,
        }),
      )
      collection.startSyncImmediate()
      let expected: Array<KeyedRow> = []
      const seen: Array<string | number> = []
      let previousInvalid = false
      await withTestCleanup(
        async () => {
          // Both startup forms remain reachable: prepending a
          // duplicate must reject without publishing even one row.
          const deliveries = initiallyInvalid
            ? [[first, { ...first }], ...history]
            : history
          for (const [deliveryIndex, snapshot] of deliveries.entries()) {
            // The public projection contract supplies these expected
            // values; no adapter helper or key map computes them.
            const selected = snapshot.map((value): KeyedRow => ({
              ...value,
              key: projected
                ? typeof value.key === `number`
                  ? `${value.key}`
                  : `selected:${value.key}`
                : value.key,
              text: projected ? value.text.toUpperCase() : value.text,
            }))
            const valid = selected.every((value, index) =>
              selected
                .slice(index + 1)
                .every((other) => other.key !== value.key),
            )
            const prior = expected
            if (valid) expected = selected
            if (valid && collection.status === `error`) {
              transport.cache(snapshot)
              await collection.reload()
            } else transport.emit(snapshot)
            oracleAssertion(`snapshot-oracle.property.test.ts:186:toBe`, () =>
              expect(collection.status).toBe(
                deliveryIndex === 0 && !valid ? `error` : `ready`,
              ),
            )
            oracleAssertion(`snapshot-oracle.property.test.ts:189:toBe`, () =>
              expect(collection.health.hasErrors).toBe(!valid),
            )
            oracleAssertion(`snapshot-oracle.property.test.ts:190:toBe`, () =>
              expect(collection.utils.getSyncError() !== undefined).toBe(
                !valid,
              ),
            )
            // Keep public key types and cardinality. String sorting or
            // a string-keyed object would erase the 1/'1' distinction.
            const actual = [...collection.entries()].map(([key, value]) => {
              const observed: KeyedRow = {
                _id: value._id,
                key: value.key,
                text: value.text,
              }
              if (Object.hasOwn(value, `optional`))
                observed.optional = value.optional
              return { key, row: observed }
            })
            oracleAssertion(
              `snapshot-oracle.property.test.ts:207:toHaveLength`,
              () => expect(actual).toHaveLength(expected.length),
            )
            for (const wanted of expected) {
              const entry = actual.find(({ key }) => key === wanted.key)
              oracleAssertion(`snapshot-oracle.property.test.ts:210:toBe`, () =>
                expect(isDeepStrictEqual(entry?.row, wanted)).toBe(true),
              )
            }
            if (deliveryIndex === 0)
              reach.reach(
                valid ? `initial-valid` : `initial-duplicate-rejected`,
              )
            if (!valid) reach.reach(`duplicate-rejected`)
            else {
              if (projected && selected.length > 0)
                reach.reach(`selected-key-representation`)
              if (!projected && selected.length > 0) reach.reach(keyKind.name)
              if (
                selected.some((value) => value.key === 1) &&
                selected.some((value) => value.key === `1`)
              )
                reach.reach(`equal-looking-typed-keys`)
              if (expected.length === 0) reach.reach(`empty-result`)
              if (previousInvalid) reach.reach(`valid-after-error`)
              if (
                prior.some(
                  (old) => !selected.some((value) => value.key === old.key),
                )
              )
                reach.reach(`omitted-key`)
              if (
                selected.some((value) =>
                  prior.some(
                    (old) =>
                      old.key === value.key &&
                      Object.hasOwn(old, `optional`) &&
                      !Object.hasOwn(value, `optional`),
                  ),
                )
              )
                reach.reach(`omitted-field`)
              if (
                selected.some(
                  (value) =>
                    seen.includes(value.key) &&
                    !prior.some((old) => old.key === value.key),
                )
              )
                reach.reach(`reintroduced-key`)
              for (const value of selected) {
                if (!seen.includes(value.key)) seen.push(value.key)
              }
            }
            previousInvalid = !valid
          }
        },
        () => collection.cleanup(),
      )
    }
  }
}

oracleProperty({
  id: `convex.snapshot`,
  law: {
    statement: `refines complete snapshots throughout generated histories`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
  },
  owns: [`src/index.ts#convexCollectionOptions`],
  histories: {
    arbitrary: convex_snapshotHistory,
    runs: 150,
    fixedSeeds: [20261022],
    states: states,
    constructed: [
      {
        name: `existing constructive history`,
        enters: states,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.snapshot`, plan, observe, () =>
      convex_snapshotJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 120000,
})

/**
 * Select refusal uses the same complete-result reference rule as the snapshot
 * judgment above: the latest valid selected array is the whole public result.
 * A selected key is application data and may change representation. A thrown
 * select admits no prefix. After readiness it reports a recoverable failure;
 * the next valid result clears it without replacing the query listener. Before
 * readiness it ends the run, so recovery uses reload. The installed SDKs receive
 * these histories over the controlled socket; no deployment claim follows.
 */
type ProjectionHistory = {
  phase: `initial` | `live`
  outcome: `valid` | `throw`
  count: number
  refusalIndex: number
  coordinate: number
  stringKey: boolean
}
type ProjectionRow = { id: string | number; value: number }
type ProjectionCut = {
  rows: Array<ProjectionRow>
  status: string
  failureMatches: boolean
  hasErrors: boolean
  releases: Array<number>
}
type ProjectionObservation = {
  cleanupErrors?: Array<string>
  first: ProjectionCut
  recovered: ProjectionCut
  publications: Array<Array<ProjectionRow>>
  readyRows: Array<Array<ProjectionRow>>
  finalReleases: Array<number>
  onErrorMatches: boolean
  reached: Array<string>
}
const projectionArb = fc
  .record({
    phase: fc.constantFrom(`initial` as const, `live` as const),
    outcome: fc.constantFrom(`valid` as const, `throw` as const),
    count: fc.integer({ min: 1, max: 4 }),
    refusalIndex: fc.nat({ max: 1000 }),
    coordinate: fc.integer({ min: 0, max: 100_000 }),
    stringKey: fc.boolean(),
  })
  .map(
    (h) => ({ ...h, refusalIndex: h.refusalIndex % h.count }),
    (h) => h as ProjectionHistory,
  )
const projectionStates = [
  `initial-valid`,
  `initial-refused`,
  `live-valid`,
  `live-refused`,
  `refusal-first`,
  `refusal-middle`,
  `refusal-last`,
  `string-selected-key`,
  `numeric-selected-key`,
  `same-run-valid-after-refusal`,
  `new-run-valid-after-refusal`,
] as const

// Authored coordinates define the selected array without calling select or
// reading a provider cache. A fresh version omits the old result's distinct key.
function projectionModel(h: ProjectionHistory) {
  const rows = (version: number): Array<ProjectionRow> =>
    Array.from({ length: h.count }, (_, index) => ({
      id: h.stringKey
        ? `selected:${version * 10 + index}`
        : version * 10 + index,
      value: h.coordinate + version * 100 + index,
    }))
  const before = h.phase === `live` ? rows(1) : []
  return {
    before,
    target: rows(2),
    first: h.outcome === `valid` ? rows(2) : before,
  }
}
function projectionViolations(
  h: ProjectionHistory,
  raw: ProjectionObservation,
  expected = projectionModel(h),
) {
  const errors: Array<string> = []
  const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b)
  if (!same(raw.first.rows, expected.first))
    errors.push(`first complete result`)
  if (
    raw.first.status !==
    (h.phase === `initial` && h.outcome === `throw` ? `error` : `ready`)
  )
    errors.push(`first status`)
  if (raw.first.hasErrors !== (h.outcome === `throw`))
    errors.push(`first health`)
  if (raw.first.failureMatches !== (h.outcome === `throw`))
    errors.push(`refusal cause`)
  if (raw.onErrorMatches !== (h.outcome === `throw`))
    errors.push(`onError cause`)
  if (
    !same(raw.recovered.rows, expected.target) ||
    raw.recovered.status !== `ready` ||
    raw.recovered.hasErrors
  )
    errors.push(`valid result recovery`)
  const expectedFirstReleases =
    h.phase === `initial` && h.outcome === `throw` ? [1] : [0]
  if (!same(raw.first.releases, expectedFirstReleases))
    errors.push(`refusal listener ownership`)
  const recoveryReleases =
    h.phase === `initial` && h.outcome === `throw` ? [1, 0] : [0]
  if (!same(raw.recovered.releases, recoveryReleases))
    errors.push(`recovery listener ownership`)
  if (
    !same(
      raw.finalReleases,
      recoveryReleases.map(() => 1),
    )
  )
    errors.push(`cleanup listener ownership`)
  // Before recovery no valid prefix of a refused array may become public. A
  // valid complete result can publish once; repeated complete rows are harmless.
  const allowed =
    h.outcome === `throw`
      ? [expected.before]
      : [expected.before, expected.target]
  if (
    raw.publications.some(
      (rows) => !allowed.some((candidate) => same(rows, candidate)),
    )
  )
    errors.push(`partial selected publication`)
  const firstReady = h.phase === `live` ? expected.before : expected.target
  // Every history reaches readiness: an initially refused selection does so
  // in its new sync run. The callback must already see that complete result.
  if (!same(raw.readyRows[0], firstReady)) errors.push(`rows inside readiness`)
  return errors
}

async function projectionReceive(
  h: ProjectionHistory,
  kind: `javascript` | `react` | `wrapped`,
  fault?: `cleanup-only` | `mismatch-and-cleanup` | `leaked-source-field`,
): Promise<ProjectionObservation> {
  const provider = new ConvexProvider(kind)
  const refusal = new Error(
    `projection refused ${h.coordinate}:${h.refusalIndex}`,
  )
  const errors: Array<unknown> = []
  const options = convexCollectionOptions({
    client:
      kind === `wrapped` && provider.client instanceof ConvexClient
        ? { onUpdate: provider.client.onUpdate.bind(provider.client) }
        : provider.client,
    query: rowsQuery,
    queryArgs: {},
    select: (result): Array<ProjectionRow> =>
      result.map((row) => {
        if (row.note === `refuse`) throw refusal
        return {
          id: h.stringKey ? `selected:${row.id}` : row.id,
          value: row.value as number,
        }
      }),
    getKey: (row) => row.id,
    onError: (error) => errors.push(error),
  })
  if (fault === `leaked-source-field`) {
    const sync = options.sync.sync
    options.sync.sync = (params) =>
      sync({
        ...params,
        write: (message) => {
          if (`value` in message) {
            const leaked = { ...message.value, title: `leaked` }
            params.write({ ...message, value: leaked })
          } else params.write(message)
        },
      })
  }
  const collection = createCollection(options)
  const read = () =>
    [...collection.values()]
      .map((item) => {
        // Only Collection's four reserved virtual fields are outside the
        // selected-array contract. Preserve every application field so an
        // adapter that leaks source fields cannot be hidden by this recorder.
        const row: ProjectionRow & Record<string, unknown> = { ...item }
        for (const name of [
          `$hasPendingWrites`,
          `$origin`,
          `$key`,
          `$collectionId`,
        ])
          delete row[name]
        return row
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const publications: Array<Array<ProjectionRow>> = []
  const readyRows: Array<Array<ProjectionRow>> = []
  collection.on(`status:ready`, () => readyRows.push(read()))
  const subscription = collection.subscribeChanges(() =>
    publications.push(read()),
  )
  const preload = collection.preload().catch(() => {})
  const deliver = async (version: number, refuse: boolean) => {
    await provider.settle()
    provider.deliverSnapshot(
      Array.from({ length: h.count }, (_, index) => ({
        id: version * 10 + index,
        title: `a` as const,
        value: h.coordinate + version * 100 + index,
        ...(refuse && index === h.refusalIndex ? { note: `refuse` } : {}),
      })),
    )
    await provider.settle()
  }
  const cut = (): ProjectionCut => ({
    rows: read(),
    status: collection.status,
    failureMatches:
      (collection.health.failureReason?.cause ??
        collection.health.error?.cause) === refusal,
    hasErrors: collection.health.hasErrors,
    releases: [...provider.releases()],
  })
  let raw: ProjectionObservation | undefined
  try {
    await withTestCleanup(
      async () => {
        if (h.phase === `live`) {
          await deliver(1, false)
          await preload
        }
        publications.length = 0
        await deliver(2, h.outcome === `throw`)
        await preload
        const first = cut()
        const captured = publications.map((rows) =>
          rows.map((row) => ({ ...row })),
        )
        if (h.phase === `initial` && h.outcome === `throw`) {
          const reload = collection.reload()
          await deliver(2, false)
          await reload
        } else if (h.outcome === `throw`) await deliver(2, false)
        await collection.utils.awaitSync()
        const recovered = cut()
        const reached: Array<string> = [
          `${h.phase}-${h.outcome === `throw` ? `refused` : `valid`}`,
          h.stringKey ? `string-selected-key` : `numeric-selected-key`,
        ]
        if (h.outcome === `throw`) {
          if (h.refusalIndex === 0) reached.push(`refusal-first`)
          if (h.refusalIndex > 0 && h.refusalIndex < h.count - 1)
            reached.push(`refusal-middle`)
          if (h.refusalIndex === h.count - 1) reached.push(`refusal-last`)
          reached.push(
            h.phase === `live`
              ? `same-run-valid-after-refusal`
              : `new-run-valid-after-refusal`,
          )
        }
        // Capture product cuts before teardown. Even cleanup in this body can
        // reject; its failure must not erase a mismatch already observed.
        raw = {
          first,
          recovered,
          publications: captured,
          readyRows,
          finalReleases: [...provider.releases()],
          onErrorMatches: errors.includes(refusal),
          reached,
        }
        if (fault === `mismatch-and-cleanup`)
          raw.publications.push([{ id: `leaked-prefix`, value: 1 }])
        subscription.unsubscribe()
        try {
          await collection.cleanup()
          if (fault === `cleanup-only` || fault === `mismatch-and-cleanup`)
            throw new Error(`injected projection cleanup failure`)
        } finally {
          raw.finalReleases = [...provider.releases()]
        }
      },
      () => subscription.unsubscribe(),
      () => collection.cleanup(),
      provider.dispose,
    )
  } catch (error) {
    if (!raw) throw error
    raw.cleanupErrors = [
      ...(raw.cleanupErrors ?? []),
      describeOracleCleanupError(error),
    ]
  }
  if (!raw) throw new Error(`Projection receiver did not record its final cut`)
  return raw
}

for (const client of [`javascript`, `react`, `wrapped`] as const) {
  const required = new WeakMap<ProjectionHistory, string>()
  const constructions = projectionStates.map((state) => ({
    name: `generated ${state}`,
    enters: [state],
    build: (generated: ProjectionHistory): ProjectionHistory => {
      const h = { ...generated }
      if (state.startsWith(`initial-`)) h.phase = `initial`
      if (state.startsWith(`live-`)) h.phase = `live`
      if (state.endsWith(`valid`)) h.outcome = `valid`
      if (state.includes(`refus`)) h.outcome = `throw`
      if (state === `refusal-first`) h.refusalIndex = 0
      if (state === `refusal-middle`) {
        h.count = 3
        h.refusalIndex = 1
      }
      if (state === `refusal-last`) h.refusalIndex = h.count - 1
      if (state === `string-selected-key`) h.stringKey = true
      if (state === `numeric-selected-key`) h.stringKey = false
      if (state === `same-run-valid-after-refusal`) h.phase = `live`
      if (state === `new-run-valid-after-refusal`) h.phase = `initial`
      required.set(h, state)
      return h
    },
  }))
  oracleProperty({
    id: `convex.snapshot-projection.${client}`,
    owns: [
      `src/options.ts#createConvexOptions`,
      `src/subscription.ts#subscribeQuery`,
    ],
    law: {
      statement: `Each selected complete result replaces its query rows; select refusal publishes no prefix, ends an initial run, or reports a recoverable live failure until the next valid result.`,
      authority: `docs/collections/convex-collection.md Subscribe to a query and Errors and cleanup; this oracle owner's latest-valid-selected-array law.`,
      limits: `One refusal and one recovery, first/middle/last row, projected string/numeric keys and installed SDK over a controlled socket. No PowerSync parser identity rule or deployed backend.`,
    },
    histories: {
      arbitrary: projectionArb,
      states: projectionStates,
      constructed: constructions,
      runs: 40,
      fixedSeeds: [2377],
    },
    model: projectionModel,
    driver: async (h, observe) => {
      const raw = await projectionReceive(h, client)
      for (const state of raw.reached) observe(`reach`, state)
      observe(`projection results`, raw)
    },
    check: (h, trace, expected) => {
      const raw = trace.find(
        (entry) => entry.checkpoint === `projection results`,
      )?.value as ProjectionObservation
      const errors = projectionViolations(h, raw, expected)
      if (errors.length)
        return violation(
          `projection results`,
          errors.join(`; `),
          `selected complete result`,
          { actual: raw, expected },
        )
      if (raw.cleanupErrors?.length)
        return violation(
          `receiving cleanup`,
          raw.cleanupErrors.join(`; `),
          `receiving cleanup`,
          { actual: raw, expected },
        )
      const state = required.get(h)
      if (
        state &&
        !trace.some(
          (entry) => entry.checkpoint === `reach` && entry.value === state,
        )
      )
        return violation(
          `reach`,
          `missing ${state}`,
          `constructed builder reach`,
        )
      return pass
    },
    calibrations: [
      {
        name: `adapter leaks a field omitted by select`,
        history: { constructed: `generated live-valid` },
        law: `selected complete result`,
        difference: `first complete result`,
        driver: async (h, observe) => {
          const raw = await projectionReceive(h, client, `leaked-source-field`)
          for (const state of raw.reached) observe(`reach`, state)
          observe(`projection results`, raw)
        },
      },
      {
        name: `initial refusal recovery requires rows inside readiness`,
        history: { constructed: `generated new-run-valid-after-refusal` },
        law: `selected complete result`,
        difference: `rows inside readiness`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint === `projection results`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as ProjectionObservation),
                    readyRows: [],
                  },
                }
              : entry,
          ),
      },
      ...([`cleanup-only`, `mismatch-and-cleanup`] as const).map((fault) => ({
        name: `actual projection teardown ${fault} preserves completed cuts`,
        history: { constructed: `generated live-valid` },
        law:
          fault === `cleanup-only`
            ? `receiving cleanup`
            : `selected complete result`,
        difference:
          fault === `cleanup-only`
            ? `injected projection cleanup failure`
            : `partial selected publication`,
        driver: async (
          h: ProjectionHistory,
          observe: (checkpoint: string, value: unknown) => void,
        ) => {
          const raw = await projectionReceive(h, client, fault)
          for (const state of raw.reached) observe(`reach`, state)
          observe(`projection results`, raw)
        },
      })),
      {
        name: `completed projection observation retains cleanup diagnostics`,
        history: { constructed: `generated live-valid` },
        law: `receiving cleanup`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint === `projection results`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as ProjectionObservation),
                    cleanupErrors: [`injected socket disposal failure`],
                  },
                }
              : entry,
          ),
      },
      {
        name: `projection mismatch survives secondary cleanup failure`,
        history: { constructed: `generated live-valid` },
        law: `selected complete result`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint === `projection results`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as ProjectionObservation),
                    publications: [[{ id: `leaked-prefix`, value: 1 }]],
                    cleanupErrors: [`secondary socket disposal failure`],
                  },
                }
              : entry,
          ),
      },
      {
        name: `refusal leaks a selected prefix`,
        history: { constructed: `generated live-refused` },
        law: `selected complete result`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint === `projection results`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as ProjectionObservation),
                    publications: [[{ id: `leaked-prefix`, value: 1 }]],
                  },
                }
              : entry,
          ),
      },
      ...projectionStates.map((state) => ({
        name: `missing generated ${state}`,
        history: { constructed: `generated ${state}` },
        law: `constructed builder reach`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.filter(
            (entry) => !(entry.checkpoint === `reach` && entry.value === state),
          ),
      })),
    ],
    timeout: 120_000,
  })
}
