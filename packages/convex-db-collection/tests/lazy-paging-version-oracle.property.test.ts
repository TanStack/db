/**
 * Every public base snapshot of a fully acquired fixed-query source is one
 * coherent authored revision, and publication never moves backwards. This
 * extends source-fact provenance: individually delivered old facts still cannot
 * form a mixed or rolled-back public relation. The companion
 * lazy-paging-version-model-oracle.ts states the law
 * without pager, queue, receipt, or cursor machinery.
 *
 * The native Convex fixture loads the full finite relation through several lazy
 * pages. After initial acquisition, subscribeChanges records every publication,
 * including synchronous callbacks inside receipt application. Two complete
 * revisions are accepted while a real optimistic transaction holds application;
 * old values remain legal until the hold drains. Later authored revisions vary
 * callback order and can supersede a revision before its callbacks run.
 *
 * Grammar controls: size 8..14, page size 2..4, both SDK shapes and directions,
 * 3..6 later revisions, callback choice 0..15, and optional supersession. Dropping
 * the hold loses accepted-versus-applied observations; one revision cannot expose
 * rollback; updating one row alone cannot expose mixed source versions. A source
 * with independent incoherent page caches is excluded by the SDK premise.
 * Limits: stable keys/order, nonempty fully acquired relation, no cleanup or
 * provider failure in this receiver, and no claim of eventual progress before
 * provider/receipt holds drain. Initial partial acquisitions have other owners.
 */
import { createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'
import { oracleRoute } from '../../db/tests/oracle-config'
import { withTestCleanup } from './helpers'
import { lazyFixture } from './lazy-paging-driver'
import { assertLazySourceFacts } from './lazy-paging-model-oracle'
import { LazyVersionModel } from './lazy-paging-version-model-oracle'
import type { LazyRow } from './lazy-paging-model-oracle'

type AssertionHistory<T> = T extends fc.Arbitrary<infer H> ? H : never
type AssertionReach = {
  beginHistory: () => void
  reach: (state: string) => void
}

const history = fc.record({
  size: fc.integer({ min: 8, max: 14 }),
  pageSize: fc.integer({ min: 2, max: 4 }),
  descending: fc.boolean(),
  react: fc.boolean(),
  revisions: fc.integer({ min: 3, max: 6 }),
  text: fc.string({ maxLength: 8 }),
  choices: fc.array(fc.nat({ max: 15 }), { minLength: 1, maxLength: 8 }),
  skip: fc.boolean(),
})
type History = typeof history extends fc.Arbitrary<infer T> ? T : never
type Fault = `none` | `rollback` | `mixed`

async function runVersions(h: History, fault: Fault = `none`) {
  // Every row's fact changes, making revisions independently distinguishable.
  const authored = Array.from({ length: h.revisions + 1 }, (_, revision) =>
    Array.from({ length: h.size }, (_row, rank) => ({
      id: `row-${rank}`,
      rank,
      text: `${h.text}:revision-${revision}`,
    })),
  )
  const f = lazyFixture(
    authored[0]!,
    h.pageSize,
    h.descending,
    `none`,
    false,
    undefined,
    h.react ? `react` : `javascript`,
  )
  const model = new LazyVersionModel()
  const failures: Array<unknown> = []
  const observed: Array<Array<LazyRow>> = []
  let revision = 0
  let injected = false
  let stop: (() => void) | undefined
  let release: () => void = () => undefined
  let persisted: Promise<unknown> | undefined
  const compare = (rows: Array<LazyRow>) => {
    observed.push(rows)
    try {
      assertLazySourceFacts(rows, f.remote.deliveredFacts)
      model.observe(rows)
    } catch (error) {
      failures.push(error)
    }
  }
  const publish = () => {
    const rows = [...f.source.base.values()].map((row) => ({ ...row }))
    compare(rows)
    // Mutant publication controls run at the same observation boundary, then
    // restore the correct final value. They test trace comparison, not a claim
    // that production itself emitted these deliberately injected observations.
    if (!injected && fault !== `none` && rows[0]?.text.endsWith(`revision-2`)) {
      injected = true
      compare(
        fault === `rollback`
          ? authored[0]!
          : [authored[0]![0]!, ...authored[2]!.slice(1)],
      )
      compare(rows)
    }
  }
  const change = () => {
    revision++
    model.offer(authored[revision]!)
    f.remote.change(authored[revision]!)
  }
  const drain = async () => {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
  }
  await withTestCleanup(
    async () => {
      const load = f.load({ limit: h.size })
      await f.remote.pump()
      await load.complete()
      oracleAssertion(
        `lazy-paging-version-oracle.property.test.ts:120:toBeGreaterThan`,
        () => expect(f.remote.slots.length).toBeGreaterThan(1),
      )
      model.offer(authored[0]!)
      publish()
      const observer = f.source.subscribeChanges(publish, {
        includeInitialState: false,
      })
      stop = () => observer.unsubscribe()
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const transaction = createTransaction({ mutationFn: () => gate })
      transaction.mutate(() =>
        f.source.insert({ id: `overlay`, rank: -1, text: `optimistic only` }),
      )
      persisted = transaction.when('settled')
      const accepted = f.receipts.length
      change()
      await f.remote.deliver(h.choices[0])
      await f.remote.pump()
      const first = f.receipts.length
      oracleAssertion(
        `lazy-paging-version-oracle.property.test.ts:140:toBeGreaterThan`,
        () => expect(first).toBeGreaterThan(accepted),
      )
      change()
      await f.remote.deliver(h.choices[1 % h.choices.length])
      await f.remote.pump()
      oracleAssertion(
        `lazy-paging-version-oracle.property.test.ts:144:toBeGreaterThan`,
        () => expect(f.receipts.length).toBeGreaterThan(first),
      )
      oracleAssertion(
        `lazy-paging-version-oracle.property.test.ts:145:toBe`,
        () =>
          expect(
            f.receipts.slice(accepted).every((receipt) => receipt !== true),
          ).toBe(true),
      )
      oracleAssertion(
        `lazy-paging-version-oracle.property.test.ts:148:toEqual`,
        () =>
          expect([...f.source.base.values()]).toEqual(
            expect.arrayContaining(authored[0]!),
          ),
      )
      oracleAssertion(
        `lazy-paging-version-oracle.property.test.ts:151:toBe`,
        () => expect(f.source.base.size).toBe(h.size),
      )
      release()
      await persisted
      await drain()
      publish()
      while (revision < h.revisions) {
        change()
        if (h.skip && revision < h.revisions) change()
        await f.remote.deliver(h.choices[revision % h.choices.length])
        await f.remote.pump(
          () => false,
          h.choices[revision % h.choices.length]! % 2 === 0,
        )
      }
      await drain()
      publish()
      oracleAssertion(
        `lazy-paging-version-oracle.property.test.ts:167:toEqual`,
        () =>
          expect([...f.source.base.values()]).toEqual(
            expect.arrayContaining(authored[h.revisions]!),
          ),
      )
      oracleAssertion(
        `lazy-paging-version-oracle.property.test.ts:170:toBe`,
        () => expect(f.source.base.size).toBe(h.size),
      )
      oracleAssertion(
        `lazy-paging-version-oracle.property.test.ts:171:toBeGreaterThan`,
        () => expect(observed.length).toBeGreaterThan(2),
      )
      if (fault !== `none`)
        oracleAssertion(
          `lazy-paging-version-oracle.property.test.ts:172:toBe`,
          () => expect(injected).toBe(true),
        )
      if (failures.length) throw failures[0]
      load.release()
    },
    () => stop?.(),
    async () => {
      release()
      await persisted
    },
    () => f.source.cleanup(),
  )
}

const convex_lazy_versionHistory = history
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_lazy_versionJudgment(
  h: AssertionHistory<typeof convex_lazy_versionHistory>,
  reach: AssertionReach,
) {
  reach.beginHistory()
  const fault = process.env.CONVEX_LAZY_VERSION_FAULT
  if (fault !== undefined && fault !== `rollback` && fault !== `mixed`)
    throw new Error(`invalid CONVEX_LAZY_VERSION_FAULT`)
  await runVersions(h, fault)
  reach.reach(h.react ? `react-versions` : `javascript-versions`)
  reach.reach(`two-revisions-held`)
  reach.reach(`post-hold-publication`)
  reach.reach(`three-or-more-revisions`)
  if (h.skip && h.revisions >= 4) reach.reach(`superseded-before-delivery`)
}

oracleProperty({
  id: `convex.lazy-version`,
  law: {
    statement: `checks every native publication against coherent monotone authored revisions`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
  },
  owns: [`src/paginated-options.ts#convexPaginatedCollectionOptions`],
  histories: {
    arbitrary: convex_lazy_versionHistory,
    runs: 50,
    fixedSeeds: [20261027],
    states: [
      `javascript-versions`,
      `react-versions`,
      `two-revisions-held`,
      `post-hold-publication`,
      `three-or-more-revisions`,
      `superseded-before-delivery`,
    ] as const,
    constructed: [
      ...([false, true] as const).map((react) => ({
        name: react
          ? `existing React receiver`
          : `existing JavaScript receiver`,
        enters: (
          [
            `javascript-versions`,
            `react-versions`,
            `two-revisions-held`,
            `post-hold-publication`,
            `three-or-more-revisions`,
            `superseded-before-delivery`,
          ] as const
        ).filter(
          (state) =>
            state !== (react ? `javascript-versions` : `react-versions`),
        ),
        build: (
          generated: AssertionHistory<typeof convex_lazy_versionHistory>,
        ) => ({
          ...generated,
          react,
          skip: true,
          revisions: Math.max(generated.revisions, 4),
        }),
      })),
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.lazy-version`, plan, observe, () =>
      convex_lazy_versionJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 60000,
})

it.each([`rollback`, `mixed`] as const)(
  `rejects a transient %s publication even with the correct final revision`,
  async (fault) => {
    oracleRoute(`calibration`)
    await oracleAssertion(
      `lazy-paging-version-oracle.property.test.ts:232:toThrow`,
      () =>
        expect(
          runVersions(
            {
              size: 8,
              pageSize: 2,
              descending: false,
              react: false,
              revisions: 4,
              text: `authored`,
              choices: [0, 1],
              skip: true,
            },
            fault,
          ),
        ).rejects.toThrow(`lazy version`),
    )
  },
)

it(`allows stuttering, skipped and observationally identical revisions`, () => {
  oracleRoute(`case`)
  const a = [{ id: `a`, rank: 0, text: `first` }]
  const b = [{ id: `a`, rank: 0, text: `middle` }]
  const c = [{ id: `a`, rank: 0, text: `last` }]
  const model = new LazyVersionModel()
  for (const rows of [a, a, b, c]) model.offer(rows)
  for (const rows of [a, a, c, c]) model.observe(rows)
  oracleAssertion(
    `lazy-paging-version-oracle.property.test.ts:258:toThrow`,
    () => expect(() => model.observe(a)).toThrow(`lazy version`),
  )
})
