/**
 * Reload keeps accepted source rows until the new run supplies evidence.
 * A finite lazy answer establishes its leading prefix, not the unread suffix.
 * Authority: glossary reload/source snapshot, LoadSubsetFn/SyncAppliedReceipt,
 * and docs/collections/convex-collection.md#lazy-pagination-for-a-fixed-query.
 *
 * This controlled core receiver supplies an applied or accepted-but-held
 * baseline, reloads before the first provider answer, then acquires a finite
 * prefix. The independent lazy window, publication and work models judge the
 * same public source observations used by the older lazy families. Equal,
 * changed, omitted and exhausted-empty answers share the same comparison.
 *
 * Restored keys inside the established prefix must not corrupt its answer.
 * Keys outside it have no deletion expectation here. This receiver does not
 * establish persisted demand coverage or promise source retention; the shared
 * persisted-demand receiver owns storage reopen and offline demand settlement.
 * Provider callbacks and baseline writes are controlled. No real SDK or storage
 * claim follows from this family; those receiving owners remain separate.
 */
import { DbClient, createTransaction, whenSyncAccepted } from '@tanstack/db'
import fc from 'fast-check'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { withTestCleanup } from './helpers'
import { lazyFixture } from './lazy-paging-driver'
import { deferredLazyAcceptance } from './lazy-paging-deferred-acceptance'
import { LazyVersionModel } from './lazy-paging-version-model-oracle'
import {
  assertDeferredBaselineRows,
  deferredBaselineGrammar,
  deferredBaselineRows,
} from './lazy-deferred-baseline-oracle'
import { lazyOracleBaseRuns, receiveBothSdks } from './lazy-paging-campaign'
import {
  assertLazyCoverage,
  assertLazyPublications,
  expectedLazyRows,
} from './lazy-paging-model-oracle'
import type { Observation, Verdict } from '../../db/tests/oracle-property'
import type { LazyRow } from './lazy-paging-model-oracle'
import type { DeferredBaselineHistory } from './lazy-deferred-baseline-oracle'

const grammar = fc.record({
  size: fc.integer({ min: 6, max: 10 }),
  pageSize: fc.integer({ min: 2, max: 4 }),
  descending: fc.boolean(),
  text: fc.string({ maxLength: 8 }),
  baseline: fc.constantFrom(`applied` as const, `held` as const),
  answer: fc.constantFrom(
    `equal` as const,
    `changed` as const,
    `omitting` as const,
    `empty` as const,
  ),
})
type History = typeof grammar extends fc.Arbitrary<infer H> ? H : never
const modes = [`applied`, `held`] as const
const answers = [`equal`, `changed`, `omitting`, `empty`] as const
const states = [
  ...modes.map((mode) => `${mode} baseline across reload`),
  ...answers.map((answer) => `first ${answer} answer`),
  `accepted baseline before first answer`,
  `javascript`,
  `react`,
]
const turns = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
const same = (actual: unknown, expected: unknown, checkpoint: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    rejectAt(
      checkpoint,
      new Error(
        `lazy baseline ${checkpoint}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      ),
    )
}

// Construction reach is checked again for every generated input. The framework
// checks each named builder's seed-derived case; this comparison also rejects a
// generated builder output whose driver silently misses its required state.
function withReach(
  trace: ReadonlyArray<Observation>,
  judgment: Verdict,
  required: ReadonlyArray<string>,
): Verdict {
  if (judgment.kind !== `pass`) return judgment
  const reached = new Set(
    trace
      .filter((item) => item.checkpoint === `reach`)
      .map((item) => item.value),
  )
  const missing = required.filter((state) => !reached.has(state))
  return missing.length
    ? violation(
        `generated construction reach`,
        `Required generated state missing: ${missing.join(`, `)}`,
        `declared reach`,
      )
    : pass
}
const missingReach = {
  name: `rejects a generated construction without its receiving state`,
  law: `declared reach`,
  difference: `Required generated state missing`,
  corrupt: (trace: ReadonlyArray<Observation>) =>
    trace.filter((item) => item.checkpoint !== `reach`),
}

async function receive(
  h: History,
  kind: `javascript` | `react`,
  wrongFinal = false,
) {
  const baseline: Array<LazyRow> = Array.from(
    { length: h.size },
    (_, rank) => ({
      id: `row-${rank}`,
      rank,
      text: h.text,
    }),
  )
  // Omission removes a key inside either leading direction's active prefix.
  // The unrelated suffix remains outside the comparison's deletion authority.
  const omitted = h.descending ? h.size - 2 : 1
  const rows =
    h.answer === `empty`
      ? []
      : baseline
          .filter((row) => h.answer !== `omitting` || row.rank !== omitted)
          .map((row) => ({
            ...row,
            text: h.answer === `changed` ? `${h.text}:new` : row.text,
          }))
  const f = lazyFixture(
    rows,
    h.pageSize,
    h.descending,
    `none`,
    false,
    undefined,
    kind,
  )
  const scope = { limit: 2 }
  let release = () => {}
  let stopChanges = () => {}
  const publications: Array<Array<LazyRow>> = []
  let load: ReturnType<typeof f.load> | undefined
  const hold = () => {
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const transaction = createTransaction({ mutationFn: () => gate })
    transaction.mutate(() =>
      f.source.insert({ id: `optimistic-hold`, rank: 10000, text: `hold` }),
    )
    return transaction
  }
  await withTestCleanup(
    async () => {
      if (h.baseline === `held`) hold()
      const restored = f.restoreRows(baseline)
      if (h.baseline === `applied`) {
        await restored
        same(
          expectedLazyRows([...f.source.base.values()], scope, h.descending),
          expectedLazyRows(baseline, scope, h.descending),
          `applied baseline premise`,
        )
      } else if (restored === true)
        throw new Error(`lazy baseline premise: restored rows were not held`)
      // A receipt alone does not prove that rows reached acceptance. These
      // observations establish the premise; authored rows still supply every
      // expected public answer below.
      const acceptedRows = () =>
        [...f.source._state.acceptedSyncedEntries()].map(([, row]) => row)
      same(
        expectedLazyRows(acceptedRows(), {}, h.descending),
        expectedLazyRows(baseline, {}, h.descending),
        `accepted baseline before reload`,
      )
      const prior = expectedLazyRows(
        [...f.source.base.values()],
        scope,
        h.descending,
      )
      // Retire the old observer before reload: replaying a surviving unfiltered
      // observer would legitimately authorize the entire source. A fresh one
      // observes this run and exposes any reset manufactured by its first
      // finite provider answer.
      f.stopObserving()
      await f.source.reload()
      same(
        expectedLazyRows(acceptedRows(), {}, h.descending),
        expectedLazyRows(baseline, {}, h.descending),
        `accepted baseline after reload`,
      )
      const observing = f.source.subscribeChanges(
        () => {
          publications.push(
            [...f.source.base.values()].map((row) => ({ ...row })),
          )
        },
        { includeInitialState: false },
      )
      stopChanges = () => observing.unsubscribe()
      same(
        expectedLazyRows([...f.source.base.values()], scope, h.descending),
        prior,
        `reload before source evidence`,
      )
      if (h.baseline === `applied`) hold()
      const firstBatch = f.batches.length
      load = f.load(scope)
      let settled = load.result === true
      void Promise.resolve(load.result).then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      await f.remote.pump()
      await turns()
      same(f.errors.map(String), [], `health after legal first answer`)
      const batches = f.batches.slice(firstBatch)
      if (!batches.length)
        throw new Error(`lazy baseline premise: no establishing source answer`)
      const held = batches.some((batch) => batch.receipt !== true)
      if (held && settled)
        throw new Error(
          `lazy baseline receipt: subset settled before application`,
        )
      // A truncate may apply immediately. Ordinary keyed writes may be held.
      // The actual core receipt decides which public checkpoint is owed.
      if (held)
        same(
          expectedLazyRows([...f.source.base.values()], scope, h.descending),
          prior,
          `before source application`,
        )
      release()
      await turns()
      await load.complete()
      const expected = expectedLazyRows(rows, scope, h.descending)
      const actual = expectedLazyRows(
        [...f.source.base.values()],
        scope,
        h.descending,
      )
      same(
        wrongFinal
          ? [...actual, { id: `undelivered`, rank: -1, text: `invented` }]
          : actual,
        expected,
        `applied answer`,
      )
      assertLazyCoverage([...f.source.base.values()], rows, scope, h.descending)
      assertLazyPublications(
        publications.map((observedRows) =>
          expectedLazyRows(observedRows, scope, h.descending),
        ),
        prior,
        expected,
      )
    },
    () => release(),
    () => load?.release(),
    () => stopChanges(),
    () => f.source.cleanup(),
  )
  // withTestCleanup preserves the primary mismatch and separates teardown errors.
  return [
    `${h.baseline} baseline across reload`,
    `first ${h.answer} answer`,
    `accepted baseline before first answer`,
    kind,
  ]
}

oracleProperty({
  id: `convex.lazy-baseline`,
  owns: [
    `src/options.ts#createConvexOptions`,
    `src/paginated-options.ts#convexPaginatedCollectionOptions`,
  ],
  law: {
    statement: `A new lazy sync run preserves its accepted baseline before evidence and establishes the requested prefix only after actual application, without unrelated successor work.`,
    authority: `docs/contributing/glossary.md reload/source snapshot; docs/collections/convex-collection.md lazy pagination; LoadSubsetFn and SyncAppliedReceipt.`,
    limits: `Controlled SDK shapes and real core, finite unique numeric ranks and ordinary accepted writes. No persisted coverage, source-suffix eviction policy, actual SDK or deferred persistence receiving claim.`,
  },
  histories: {
    arbitrary: grammar,
    runs: lazyOracleBaseRuns(12),
    fixedSeeds: [20261118],
    states,
    constructed: modes.flatMap((baseline) =>
      answers.map((answer) => ({
        name: `${baseline} baseline and ${answer} first answer`,
        enters: [
          `${baseline} baseline across reload`,
          `first ${answer} answer`,
          `accepted baseline before first answer`,
          `javascript`,
          `react`,
        ],
        build: (generated: History) => ({ ...generated, baseline, answer }),
      })),
    ),
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  check: (plan, trace, judgment) =>
    withReach(trace, forwardAssertionJudgment(plan, trace, judgment), [
      `${plan.history.baseline} baseline across reload`,
      `first ${plan.history.answer} answer`,
      `accepted baseline before first answer`,
      `javascript`,
      `react`,
    ]),
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.lazy-baseline`, plan, observe, async () => {
      for (const [, reached] of await receiveBothSdks((kind) =>
        receive(plan.history, kind),
      ))
        for (const state of reached) observe(`reach`, state)
    }),
  timeout: 60000,
  calibrations: [
    missingReach,
    {
      name: `rejects an invented row at applied settlement`,
      law: `convex.lazy-baseline`,
      difference: `lazy baseline applied answer`,
      driver: async (plan: { history: History }, observe) =>
        recordAssertionJudgment(
          `convex.lazy-baseline`,
          plan,
          observe,
          async () => {
            await receive(plan.history, `javascript`, true)
          },
        ),
    },
  ],
})

/** A wrapping sync can defer a whole committed proposal before core accepts it.
 * Later coherent callbacks still arrive. Their keyed writes must refine the
 * authored revisions in FIFO order, including delete/reinsert on a key still
 * present in core and add/update/delete/reinsert on a key absent from core.
 * The independent version model judges every actual source publication; it
 * contains authored row arrays and no insert/update classification.
 * Limits: full acquired source, one controlled durable hold, no commit reentry,
 * and successful acceptance. Real SQLite receiving remains separately owned.
 */
const deferredStates = [
  `unaccepted callback proposals`,
  `deferred absent-key add update delete reinsert`,
  `deferred present-key delete reinsert`,
  `all FIFO publications checked`,
  `javascript`,
  `react`,
]
const deferredAcceptanceStates = [
  `all callback proposals deferred together`,
  `accepted predecessor before next callback`,
]

async function receiveDeferred(
  h: DeferredBaselineHistory,
  kind: `javascript` | `react`,
  wrongFinal = false,
  wrongAccepted = false,
) {
  const { original, revisions } = deferredBaselineRows(h)
  const deferred = deferredLazyAcceptance()
  const f = lazyFixture(
    original,
    h.size + 2,
    h.descending,
    `none`,
    false,
    undefined,
    kind,
    undefined,
    deferred.wrap,
  )
  const versions = new LazyVersionModel()
  const failures: Array<unknown> = []
  let stopChanges = () => {}
  let load: ReturnType<typeof f.load> | undefined
  let publications = 0
  let releaseOptimistic = () => {}
  await withTestCleanup(
    async () => {
      load = f.load({})
      await f.remote.pump()
      await load.complete()
      versions.offer(original)
      versions.observe([...f.source.base.values()])
      if (h.acceptance === `before-next-callback`) {
        const hold = new Promise<void>((resolve) => {
          releaseOptimistic = resolve
        })
        const transaction = createTransaction({ mutationFn: () => hold })
        transaction.mutate(() =>
          f.source.insert({ id: `optimistic-hold`, rank: 10000, text: `hold` }),
        )
      }
      const observing = f.source.subscribeChanges(
        () => {
          publications++
          try {
            versions.observe([...f.source.base.values()])
          } catch (error) {
            failures.push(error)
          }
        },
        { includeInitialState: false },
      )
      stopChanges = () => observing.unsubscribe()
      deferred.hold()
      for (const rows of revisions) {
        versions.offer(rows)
        f.remote.change(rows)
        await f.remote.pump()
        await turns()
        if (h.acceptance === `before-next-callback`) {
          if (deferred.pending() !== 1)
            throw new Error(
              `lazy accepted premise: expected one deferred proposal`,
            )
          deferred.releaseNext()
          const receipt = f.receipts.at(-1)
          if (receipt === undefined || receipt === true)
            throw new Error(
              `lazy accepted premise: core did not hold application`,
            )
          const application = { settled: false }
          void receipt.then(
            () => {
              application.settled = true
            },
            () => {
              application.settled = true
            },
          )
          await whenSyncAccepted(receipt)
          // This handler-facing wait drains the adapter's acceptance callback.
          // That same callback deletes both its proposal and acceptance waiter.
          // It must complete while the applied receipt remains held.
          await f.source.utils.awaitSync()
          if (application.settled || deferred.pending() !== 0)
            throw new Error(
              `lazy accepted premise: acceptance did not precede visibility`,
            )
          try {
            assertDeferredBaselineRows(
              [...f.source.base.values()],
              original,
              h,
              `accepted predecessor before application`,
            )
            assertDeferredBaselineRows(
              [...f.source._state.acceptedSyncedEntries()]
                .map(([, row]) => row)
                .filter((row) => !wrongAccepted || row.id !== `added`),
              rows,
              h,
              `accepted predecessor baseline`,
            )
          } catch (error) {
            rejectAt(
              `accepted predecessor baseline`,
              error instanceof Error ? error : new Error(String(error)),
            )
          }
        }
      }
      if (
        deferred.pending() !==
        (h.acceptance === `after-callbacks` ? revisions.length : 0)
      )
        throw new Error(
          `lazy deferred premise: callbacks did not produce every proposal`,
        )
      same(
        expectedLazyRows([...f.source.base.values()], {}, h.descending),
        expectedLazyRows(original, {}, h.descending),
        `before deferred acceptance`,
      )
      deferred.release()
      releaseOptimistic()
      await turns()
      if (failures.length)
        rejectAt(`FIFO source publications`, failures[0] as Error)
      const expectedPublications =
        h.acceptance === `after-callbacks` ? revisions.length : 1
      if (publications !== expectedPublications)
        rejectAt(
          `FIFO source publications`,
          new Error(
            `lazy deferred: ${publications} publications, expected ${expectedPublications} for ${revisions.length} accepted revisions`,
          ),
        )
      same(
        expectedLazyRows([...f.source.base.values()], {}, h.descending).filter(
          (row) => !wrongFinal || row.id !== `added`,
        ),
        expectedLazyRows(revisions.at(-1)!, {}, h.descending),
        `after deferred acceptance`,
      )
      same(f.errors.map(String), [], `health after deferred legal answers`)
    },
    () => releaseOptimistic(),
    () => deferred.release(),
    () => load?.release(),
    () => stopChanges(),
    () => f.source.cleanup(),
  )
  return deferredStates
    .filter((state) => state !== `javascript` && state !== `react`)
    .concat(kind)
    .concat(
      h.acceptance === `after-callbacks`
        ? deferredAcceptanceStates[0]!
        : deferredAcceptanceStates[1]!,
    )
}

oracleProperty({
  id: `convex.lazy-deferred-baseline`,
  owns: [`src/options.ts#createConvexOptions`],
  law: {
    statement: `Coherent callback revisions remain legal keyed proposals while earlier proposals await durable handoff, and every accepted proposal applies in FIFO order.`,
    authority: `SyncAppliedReceipt and whenSyncAccepted; docs/contributing/glossary.md accepted and deferred sync transaction; Convex complete acquired range contract.`,
    limits: `Controlled SDK shapes and persistence-like wrapper, whole acquired source, six successful callback revisions, before-next-callback or after-all-callbacks handoff, no reentrant commits or storage claim.`,
  },
  histories: {
    arbitrary: deferredBaselineGrammar,
    runs: lazyOracleBaseRuns(12),
    fixedSeeds: [20261118],
    states: [...deferredStates, ...deferredAcceptanceStates],
    constructed: ([`after-callbacks`, `before-next-callback`] as const).map(
      (acceptance, index) => ({
        name: `deferred keyed callback revisions ${acceptance}`,
        enters: [...deferredStates, deferredAcceptanceStates[index]!],
        build: (generated: DeferredBaselineHistory) => ({
          ...generated,
          acceptance,
        }),
      }),
    ),
  },
  resolve: (history: DeferredBaselineHistory) => ({ history }),
  model: recordedAssertionJudgment,
  check: (plan, trace, judgment) =>
    withReach(trace, forwardAssertionJudgment(plan, trace, judgment), [
      ...deferredStates,
      plan.history.acceptance === `after-callbacks`
        ? deferredAcceptanceStates[0]!
        : deferredAcceptanceStates[1]!,
    ]),
  driver: async (plan, observe) =>
    recordAssertionJudgment(
      `convex.lazy-deferred-baseline`,
      plan,
      observe,
      async () => {
        for (const [, reached] of await receiveBothSdks((kind) =>
          receiveDeferred(plan.history, kind),
        ))
          for (const state of reached) observe(`reach`, state)
      },
    ),
  timeout: 60000,
  calibrations: [
    missingReach,
    {
      name: `rejects an omitted predecessor at accepted settlement`,
      history: {
        constructed: `deferred keyed callback revisions before-next-callback`,
      },
      law: `convex.lazy-deferred-baseline`,
      difference: `accepted predecessor baseline`,
      driver: async (plan: { history: DeferredBaselineHistory }, observe) =>
        recordAssertionJudgment(
          `convex.lazy-deferred-baseline`,
          plan,
          observe,
          async () => {
            await receiveDeferred(plan.history, `javascript`, false, true)
          },
        ),
    },
    {
      name: `rejects a lost reinserted key after deferred acceptance`,
      law: `convex.lazy-deferred-baseline`,
      difference: `lazy baseline after deferred acceptance`,
      driver: async (plan: { history: DeferredBaselineHistory }, observe) =>
        recordAssertionJudgment(
          `convex.lazy-deferred-baseline`,
          plan,
          observe,
          async () => {
            await receiveDeferred(plan.history, `javascript`, true)
          },
        ),
    },
  ],
})

/** A retained bounded range keeps its omission authority when its returned
 * maximum contracts. This differs from an unknown restored suffix: both old
 * high keys came from this run's provider range, and its next result omits
 * them. Hidden later rows keep the current prefix nonexhausted throughout.
 * LazyVersionModel compares the two independently authored range relations.
 */
const retainedGrammar = fc.record({
  scale: fc.integer({ min: 1, max: 5 }),
  descending: fc.boolean(),
  text: fc.string({ maxLength: 8 }),
})
type RetainedHistory =
  typeof retainedGrammar extends fc.Arbitrary<infer H> ? H : never
const retainedStates = [
  `provider-supported high keys with unread suffix`,
  `nonexhausted retained range contracts`,
  `omitted provider keys beyond current prefix removed`,
  `javascript`,
  `react`,
]
async function receiveRetained(
  h: RetainedHistory,
  kind: `javascript` | `react`,
  stalePublication = false,
) {
  const make = (value: number): LazyRow => ({
    id: `row-${value}`,
    rank: (h.descending ? -value : value) * h.scale,
    text: h.text,
  })
  const original = [0, 1, 100, 101, 1000, 1001].map(make)
  const revised = [0, 1, 2, 3, 4, 5, 1000, 1001].map(make)
  const priorRange = original.slice(0, 4)
  const nextRange = revised.slice(0, 6)
  const f = lazyFixture(
    original,
    4,
    h.descending,
    `none`,
    false,
    undefined,
    kind,
  )
  f.stopObserving()
  const versions = new LazyVersionModel()
  let stopChanges = () => {}
  let load: ReturnType<typeof f.load> | undefined
  const failures: Array<unknown> = []
  let publications = 0
  await withTestCleanup(
    async () => {
      load = f.load({ limit: 1 })
      await f.remote.pump()
      await load.complete()
      same(
        expectedLazyRows([...f.source.base.values()], {}, h.descending),
        expectedLazyRows(priorRange, {}, h.descending),
        `initial bounded range`,
      )
      versions.offer(priorRange)
      versions.observe([...f.source.base.values()])
      const observing = f.source.subscribeChanges(
        () => {
          publications++
          try {
            versions.observe([
              ...f.source.base.values(),
              ...(stalePublication ? [make(100)] : []),
            ])
          } catch (error) {
            failures.push(error)
          }
        },
        { includeInitialState: false },
      )
      stopChanges = () => observing.unsubscribe()
      versions.offer(nextRange)
      f.remote.change(revised)
      await f.remote.pump()
      await turns()
      same(f.errors.map(String), [], `health after legal range update`)
      if (failures.length)
        rejectAt(`contracted range publication`, failures[0] as Error)
      if (!publications)
        throw new Error(`lazy retained premise: no range publication`)
      same(
        expectedLazyRows([...f.source.base.values()], {}, h.descending),
        expectedLazyRows(nextRange, {}, h.descending),
        `contracted range omissions`,
      )
      if (f.source.base.has(`row-1000`))
        throw new Error(`lazy retained premise: unread suffix acquired`)
    },
    () => load?.release(),
    () => stopChanges(),
    () => f.source.cleanup(),
  )
  return retainedStates
    .filter((state) => state !== `javascript` && state !== `react`)
    .concat(kind)
}

oracleProperty({
  id: `convex.lazy-retained-omission`,
  owns: [
    `src/options.ts#createConvexOptions`,
    `src/pagination.ts#subscribePages`,
  ],
  law: {
    statement: `A coherent update to a retained provider range removes its formerly supplied keys even when their old leading values exceed the new nonexhausted prefix.`,
    authority: `docs/collections/convex-collection.md retained reactive cursor ranges; docs/contributing/glossary.md source snapshot.`,
    limits: `Controlled SDK shapes, one finite retained range, unique numeric ranks and two hidden suffix rows. No restored-suffix or real provider claim.`,
  },
  histories: {
    arbitrary: retainedGrammar,
    runs: lazyOracleBaseRuns(12),
    fixedSeeds: [20261118],
    states: retainedStates,
    constructed: [
      {
        name: `shrinking retained provider range`,
        enters: retainedStates,
        build: (generated) => ({ ...generated }),
      },
    ],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  check: (plan, trace, judgment) =>
    withReach(
      trace,
      forwardAssertionJudgment(plan, trace, judgment),
      retainedStates,
    ),
  driver: async (plan, observe) =>
    recordAssertionJudgment(
      `convex.lazy-retained-omission`,
      plan,
      observe,
      async () => {
        for (const [, reached] of await receiveBothSdks((kind) =>
          receiveRetained(plan.history, kind),
        ))
          for (const state of reached) observe(`reach`, state)
      },
    ),
  timeout: 60000,
  calibrations: [
    missingReach,
    {
      name: `rejects an omitted old key in a contracted range publication`,
      law: `convex.lazy-retained-omission`,
      difference: `lazy version: mixed revision or public rollback`,
      driver: async (plan: { history: RetainedHistory }, observe) =>
        recordAssertionJudgment(
          `convex.lazy-retained-omission`,
          plan,
          observe,
          async () => {
            await receiveRetained(plan.history, `javascript`, true)
          },
        ),
    },
  ],
})

/** Baseline input can arrive after an actual provider answer, not only at
 * startup. Public hydration supplies a previously unwritten key; the next
 * exhausted result has whole-source omission authority. The authored relation
 * and LazyVersionModel judge every publication, including the hydration seed.
 * This distinguishes resampling each callback from sampling only the first.
 */
const lateGrammar = fc.record({
  size: fc.integer({ min: 2, max: 7 }),
  scale: fc.integer({ min: 1, max: 5 }),
  descending: fc.boolean(),
  text: fc.string({ maxLength: 8 }),
  answer: fc.constantFrom(
    `equal` as const,
    `changed` as const,
    `omitting` as const,
    `empty` as const,
  ),
})
type LateHistory = typeof lateGrammar extends fc.Arbitrary<infer H> ? H : never
const lateStates = [
  `provider answer before late hydration`,
  `late hydration accepted before later callback`,
  ...answers.map((answer) => `later exhausted ${answer} answer`),
  `javascript`,
  `react`,
]
async function receiveLate(
  h: LateHistory,
  kind: `javascript` | `react`,
  staleFinal = false,
) {
  const make = (rank: number): LazyRow => ({
    id: `row-${rank}`,
    rank: (h.descending ? -rank : rank) * h.scale,
    text: h.text,
  })
  const original = Array.from({ length: h.size }, (_, rank) => make(rank))
  const restored = make(h.size + 1)
  const next =
    h.answer === `empty`
      ? []
      : original
          .filter((_, index) => h.answer !== `omitting` || index !== 0)
          .map((row) => ({
            ...row,
            text: h.answer === `changed` ? `${h.text}:later` : row.text,
          }))
  const f = lazyFixture(
    original,
    h.size + 3,
    h.descending,
    `none`,
    false,
    undefined,
    kind,
    undefined,
    undefined,
    new DbClient(),
  )
  const versions = new LazyVersionModel()
  const failures: Array<unknown> = []
  let stopChanges = () => {}
  let load: ReturnType<typeof f.load> | undefined
  await withTestCleanup(
    async () => {
      load = f.load({})
      await f.remote.pump()
      await load.complete()
      same(
        expectedLazyRows([...f.source.base.values()], {}, h.descending),
        expectedLazyRows(original, {}, h.descending),
        `initial exhausted answer`,
      )
      versions.offer(original)
      versions.observe([...f.source.base.values()])
      const observing = f.source.subscribeChanges(
        () => {
          try {
            versions.observe([...f.source.base.values()])
          } catch (error) {
            failures.push(error)
          }
        },
        { includeInitialState: false },
      )
      stopChanges = () => observing.unsubscribe()
      versions.offer([...original, restored])
      f.hydrateRows([restored])
      if (f.source.base.get(restored.id) !== restored)
        throw new Error(
          `lazy late baseline premise: public hydration was not applied`,
        )
      const accepted = new Map(f.source._state.acceptedSyncedEntries())
      if (accepted.get(restored.id) !== restored)
        throw new Error(
          `lazy late baseline premise: public hydration was not accepted`,
        )
      versions.offer(next)
      f.remote.change(next)
      await f.remote.pump()
      await turns()
      same(
        expectedLazyRows(
          [...f.source.base.values(), ...(staleFinal ? [restored] : [])],
          {},
          h.descending,
        ),
        expectedLazyRows(next, {}, h.descending),
        `later exhausted answer`,
      )
      if (failures.length)
        rejectAt(`later source publication`, failures[0] as Error)
      same(f.errors.map(String), [], `health after late hydration answer`)
    },
    () => load?.release(),
    () => stopChanges(),
    () => f.source.cleanup(),
  )
  return [
    lateStates[0]!,
    lateStates[1]!,
    `later exhausted ${h.answer} answer`,
    kind,
  ]
}

oracleProperty({
  id: `convex.lazy-late-baseline`,
  owns: [`src/options.ts#createConvexOptions`],
  law: {
    statement: `Each later coherent exhausted provider result reconciles the current accepted baseline, including previously unwritten keys hydrated after the first provider answer.`,
    authority: `docs/contributing/glossary.md hydration seed/source snapshot; docs/collections/convex-collection.md complete retained range results.`,
    limits: `Controlled SDK shapes, real core and public DbClient hydration; unique finite ranks, one later hydration and exhausted answer. No durable restore or actual SDK claim.`,
  },
  histories: {
    arbitrary: lateGrammar,
    runs: lazyOracleBaseRuns(12),
    fixedSeeds: [20261118],
    states: lateStates,
    constructed: answers.map((answer) => ({
      name: `late hydration then exhausted ${answer} answer`,
      enters: [
        lateStates[0]!,
        lateStates[1]!,
        `later exhausted ${answer} answer`,
        `javascript`,
        `react`,
      ],
      build: (generated: LateHistory) => ({ ...generated, answer }),
    })),
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  check: (plan, trace, judgment) =>
    withReach(trace, forwardAssertionJudgment(plan, trace, judgment), [
      lateStates[0]!,
      lateStates[1]!,
      `later exhausted ${plan.history.answer} answer`,
      `javascript`,
      `react`,
    ]),
  driver: async (plan, observe) =>
    recordAssertionJudgment(
      `convex.lazy-late-baseline`,
      plan,
      observe,
      async () => {
        for (const [, reached] of await receiveBothSdks((kind) =>
          receiveLate(plan.history, kind),
        ))
          for (const state of reached) observe(`reach`, state)
      },
    ),
  timeout: 60000,
  calibrations: [
    missingReach,
    {
      name: `rejects a late hydrated key after exhausted source omission`,
      law: `convex.lazy-late-baseline`,
      difference: `lazy baseline later exhausted answer`,
      driver: async (plan: { history: LateHistory }, observe) =>
        recordAssertionJudgment(
          `convex.lazy-late-baseline`,
          plan,
          observe,
          async () => {
            await receiveLate(plan.history, `javascript`, true)
          },
        ),
    },
  ],
})

/** Provider support is evidence even when its rows already match the baseline.
 * Install a coherent cache that adds one row, hydrate that exact cached object
 * through DbClient, then dispatch it. All accepted rows are reference-identical
 * to that callback. The provider's value must then resist a later conflicting
 * hydration seed: fresh adapter sync is authoritative over provisional rows
 * (docs/guides/ssr.md Initial Data). No row-write count is prescribed. The
 * retained range also acquires omission authority. A later contraction removes it
 * beyond the new strict prefix, while two genuinely unread rows stay unread.
 * The independent authored relations and version model do not classify writes.
 */
const supportStates = [
  `retained range before new provider support`,
  `reference-identical cached rows publicly hydrated`,
  `reference-identical new provider support`,
  `later hydration cannot overwrite provider-supported key`,
  `later range omits newly supported key beyond strict prefix`,
  `javascript`,
  `react`,
]
async function receiveSupport(
  h: RetainedHistory,
  kind: `javascript` | `react`,
  staleFinal = false,
) {
  const make = (rank: number): LazyRow => ({
    id: `row-${rank}`,
    rank: (h.descending ? -rank : rank) * h.scale,
    text: h.text,
  })
  const original = [0, 1, 101, 1000, 1001].map(make)
  const f = lazyFixture(
    original,
    3,
    h.descending,
    `none`,
    false,
    undefined,
    kind,
    undefined,
    undefined,
    new DbClient(),
  )
  f.stopObserving()
  const versions = new LazyVersionModel()
  const failures: Array<unknown> = []
  let load: ReturnType<typeof f.load> | undefined
  let stopChanges = () => {}
  await withTestCleanup(
    async () => {
      load = f.load({ limit: 1 })
      await f.remote.pump()
      await load.complete()
      const prior = original.slice(0, 3)
      same(
        expectedLazyRows([...f.source.base.values()], {}, h.descending),
        expectedLazyRows(prior, {}, h.descending),
        `initial provider support`,
      )
      versions.offer(prior)
      versions.observe([...f.source.base.values()])
      const observing = f.source.subscribeChanges(
        () => {
          try {
            versions.observe([...f.source.base.values()])
          } catch (error) {
            failures.push(error)
          }
        },
        { includeInitialState: false },
      )
      stopChanges = () => observing.unsubscribe()
      f.remote.changeCached([...f.remote.source, make(100)])
      f.remote.installCaches()
      const cached = f.remote.slots.find((slot) => slot.active)?.current?.page
      const added = cached?.find((row) => row.id === `row-100`)
      if (!cached || !added || cached.length !== 4)
        throw new Error(`lazy support premise: expanded retained cache missing`)
      versions.offer(cached)
      f.hydrateRows([added])
      const baseline = new Map(f.source._state.acceptedSyncedEntries())
      if (
        baseline.size !== cached.length ||
        cached.some((row) => baseline.get(row.id) !== row)
      )
        throw new Error(
          `lazy support premise: cache and accepted hydration are not reference-identical`,
        )
      await f.remote.pump()
      await turns()
      same(
        expectedLazyRows([...f.source.base.values()], {}, h.descending),
        expectedLazyRows(cached, {}, h.descending),
        `reference-identical provider answer`,
      )
      same(f.errors.map(String), [], `health after reference-identical answer`)
      // This changes an observable field while preserving key and rank. The
      // shared version model does not offer it: this key now has source support,
      // so public hydration can no longer replace its provider-supplied value.
      f.hydrateRows([{ ...added, text: `${added.text}:later-hydration` }])
      await turns()
      same(
        expectedLazyRows([...f.source.base.values()], {}, h.descending),
        expectedLazyRows(cached, {}, h.descending),
        `provider support before later hydration`,
      )
      const revised = [0, 1, 2, 3, 4, 5, 1000, 1001].map(make)
      const expected = revised.slice(0, 6)
      versions.offer(expected)
      f.remote.change(revised)
      await f.remote.pump()
      await turns()
      same(
        expectedLazyRows(
          [...f.source.base.values(), ...(staleFinal ? [added] : [])],
          {},
          h.descending,
        ),
        expectedLazyRows(expected, {}, h.descending),
        `newly supported key omission`,
      )
      if (failures.length)
        rejectAt(`new provider support publication`, failures[0] as Error)
      same(f.errors.map(String), [], `health after supported range contraction`)
      if (f.source.base.has(`row-1000`) || f.source.base.has(`row-1001`))
        throw new Error(`lazy support premise: unread suffix acquired`)
    },
    () => load?.release(),
    () => stopChanges(),
    () => f.source.cleanup(),
  )
  return supportStates
    .filter((state) => state !== `javascript` && state !== `react`)
    .concat(kind)
}

oracleProperty({
  id: `convex.lazy-support-baseline`,
  owns: [
    `src/options.ts#createConvexOptions`,
    `src/pagination.ts#subscribePages`,
  ],
  law: {
    statement: `A retained provider range gains source authority for every returned key even when its complete callback matches the accepted baseline by reference: later hydration cannot replace the provider value and a later range omission removes that support.`,
    authority: `docs/guides/ssr.md Initial Data; docs/contributing/glossary.md hydration seed/source snapshot; docs/collections/convex-collection.md retained reactive cursor ranges.`,
    limits: `Controlled immutable SDK caches, public DbClient hydration and real core; one finite retained range, unique numeric ranks, no real SDK or storage identity claim.`,
  },
  histories: {
    arbitrary: retainedGrammar,
    runs: lazyOracleBaseRuns(12),
    fixedSeeds: [20261118],
    states: supportStates,
    constructed: [
      {
        name: `reference-identical provider support then hydration and omission`,
        enters: supportStates,
        build: (generated) => ({ ...generated }),
      },
    ],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  check: (plan, trace, judgment) =>
    withReach(
      trace,
      forwardAssertionJudgment(plan, trace, judgment),
      supportStates,
    ),
  driver: async (plan, observe) =>
    recordAssertionJudgment(
      `convex.lazy-support-baseline`,
      plan,
      observe,
      async () => {
        for (const [, reached] of await receiveBothSdks((kind) =>
          receiveSupport(plan.history, kind),
        ))
          for (const state of reached) observe(`reach`, state)
      },
    ),
  timeout: 60000,
  calibrations: [
    missingReach,
    {
      name: `rejects a newly supported old key after range contraction`,
      law: `convex.lazy-support-baseline`,
      difference: `lazy baseline newly supported key omission`,
      driver: async (plan: { history: RetainedHistory }, observe) =>
        recordAssertionJudgment(
          `convex.lazy-support-baseline`,
          plan,
          observe,
          async () => {
            await receiveSupport(plan.history, `javascript`, true)
          },
        ),
    },
  ],
})
