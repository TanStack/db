/**
 * The scientific law is in lazy-paging-model-oracle.ts: exact scoped coverage,
 * evidence-authorized successor work and applied source provenance. The same
 * source can support several logical owners. Retirement revokes future work
 * permission, not permission for an already initiated response to arrive.
 * Captured callbacks from a retired transport cannot affect its replacement.
 * Authority: LoadSubsetFn/UnloadSubsetFn and cleanup in db/src/types.ts, and
 * the approved fixed-query profile in docs/collections/convex-collection.md.
 *
 * The grammar authors acquire/retire/abort and environment delivery choices;
 * it has no page-chain or sealing state. lazy-paging-driver.ts alone translates
 * opaque provider intervals. A constructive ownership prefix is followed by
 * arbitrary legal action orders, including callbacks from retired transports.
 * Comparisons run after every action; success is also checked after an honest
 * responsive drain. No future source suffix grants work permission. Scope
 * profiles include unique, leading-three and interior ties. Removing retirement
 * loses initiation-time versus current permission; removing stale errors loses
 * authority effects invisible to a stale-row sentinel.
 */
import fc from 'fast-check'
import { createTransaction } from '@tanstack/db'
import { expect } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'
import { withTestCleanup } from './helpers'
import { lazyFixture } from './lazy-paging-driver'
import {
  assertLazyCoverage,
  assertLazySourceFacts,
  expectedLazyRows,
  ordered,
} from './lazy-paging-model-oracle'
import type { LazyRow } from './lazy-paging-model-oracle'

type AssertionHistory<T> = T extends fc.Arbitrary<infer H> ? H : never
type AssertionReach = {
  beginHistory: () => void
  reach: (state: string) => void
}

const commands = fc.array(
  fc.record({
    action: fc.constantFrom(
      `acquire`,
      `retire`,
      `abort`,
      `deliver`,
      `drain`,
      `stale-success`,
      `stale-error`,
      `hold-application`,
      `release-application`,
      `source-change`,
      `cleanup`,
      `restart`,
    ),
    choice: fc.nat({ max: 15 }),
  }),
  { minLength: 1, maxLength: 32 },
)
const history = fc.record({
  size: fc.integer({ min: 16, max: 24 }),
  pageSize: fc.integer({ min: 2, max: 5 }),
  descending: fc.boolean(),
  react: fc.boolean(),
  text: fc.string({ maxLength: 8 }),
  commands,
})

const convex_lazy_historyHistory = history
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_lazy_historyJudgment(
  h: AssertionHistory<typeof convex_lazy_historyHistory>,
  reach: AssertionReach,
) {
  reach.beginHistory()
  const rows: Array<LazyRow> = Array.from({ length: h.size }, (_, rank) => ({
    id: `r${rank}`,
    rank,
    text: h.text,
  }))
  const f = lazyFixture(
    rows,
    h.pageSize,
    h.descending,
    `none`,
    false,
    undefined,
    h.react ? `react` : `javascript`,
  )
  let running = true
  let revision = 0
  let holdNumber = 0
  let applicationHold:
    { release: () => void; persisted: Promise<unknown> } | undefined
  const releaseApplication = async () => {
    if (!applicationHold) return
    const held = applicationHold
    applicationHold = undefined
    held.release()
    await held.persisted
  }
  const holdApplication = () => {
    if (!running || applicationHold) return
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const transaction = createTransaction({ mutationFn: () => gate })
    transaction.mutate(() =>
      f.source.insert({
        id: `overlay-${holdNumber++}`,
        rank: 10000,
        text: `optimistic only`,
      }),
    )
    applicationHold = {
      release,
      persisted: transaction.when('settled'),
    }
  }
  const attempts: Array<{
    load: ReturnType<typeof f.load>
    controller: AbortController
    retired: boolean
  }> = []
  const acquire = (limit: number) => {
    const controller = new AbortController()
    const load = f.load({ limit }, controller.signal)
    void Promise.resolve(load.result).catch(() => {})
    const attempt = { load, controller, retired: false }
    attempts.push(attempt)
    return attempt
  }
  const retire = (attempt: (typeof attempts)[number]) => {
    if (attempt.retired) return
    attempt.retired = true
    attempt.load.release()
  }
  const cleanup = async () => {
    if (!running) return
    for (const attempt of attempts) retire(attempt)
    const cleaning = f.source.cleanup()
    running = false
    await releaseApplication()
    await cleaning
  }
  const restart = () => {
    if (running) return
    f.source.startSyncImmediate()
    running = true
  }
  const change = (choice: number) => {
    revision++
    f.remote.change(
      f.remote.source.map((row, i) =>
        i === choice % h.size
          ? {
              ...row,
              rank: h.descending ? h.size + revision : -revision,
              text: `${h.text}:${revision}`,
            }
          : row,
      ),
    )
  }
  const checkpoint = () => {
    for (const publication of f.publications)
      assertLazySourceFacts(publication.rows, publication.evidence)
    assertLazySourceFacts([...f.source.base.values()], f.remote.deliveredFacts)
    oracleAssertion(
      `lazy-paging-history-oracle.property.test.ts:182:toBe`,
      () =>
        expect(
          f.source.has(`obsolete`),
          `stale callback wrote into current run`,
        ).toBe(false),
    )
    oracleAssertion(
      `lazy-paging-history-oracle.property.test.ts:186:toBe`,
      () =>
        expect(f.remote.obsoleteReads, `retired watch read its cache`).toBe(0),
    )
    oracleAssertion(
      `lazy-paging-history-oracle.property.test.ts:189:toEqual`,
      () => expect(f.errors, `retired callback reported an error`).toEqual([]),
    )
    oracleAssertion(
      `lazy-paging-history-oracle.property.test.ts:190:toBeUndefined`,
      () =>
        expect(
          f.source.utils.getSyncError(),
          `retired callback poisoned current sync`,
        ).toBeUndefined(),
    )
  }
  await withTestCleanup(
    async () => {
      const shallow = acquire(1)
      await f.remote.pump()
      await shallow.load.complete()
      const deep = acquire(9)
      await f.remote.pump(
        (slot) => slot.opts.cursor !== null && slot.opts.endCursor == null,
      )
      oracleAssertion(
        `lazy-paging-history-oracle.property.test.ts:205:toBe`,
        () =>
          expect(
            f.remote.slots.some(
              (slot) =>
                slot.active &&
                slot.opts.cursor !== null &&
                slot.opts.endCursor == null &&
                !slot.current,
            ),
          ).toBe(true),
      )
      const before = f.remote.successorStarts
      retire(deep)
      reach.reach(`retired-authorizer-pending`)
      await f.remote.pump()
      oracleAssertion(
        `lazy-paging-history-oracle.property.test.ts:218:toBe`,
        () =>
          expect(
            f.remote.successorStarts,
            `new successor after its authorizer retired`,
          ).toBe(before),
      )
      assertLazyCoverage(
        [...f.source.values()],
        rows,
        { limit: 1 },
        h.descending,
      )
      reach.reach(`prior-delivery-after-retirement`)
      f.remote.late(`success`)
      await f.remote.pump()
      checkpoint()
      reach.reach(`retired-success-fenced`)
      f.remote.late(`error`)
      await f.remote.pump()
      checkpoint()
      reach.reach(`retired-error-fenced`)
      reach.reach(h.react ? `react-transport` : `javascript-transport`)
      const canceling = acquire(h.size - 1)
      await f.remote.pump(
        (slot) => slot.opts.cursor !== null && slot.opts.endCursor == null,
      )
      oracleAssertion(
        `lazy-paging-history-oracle.property.test.ts:243:toBe`,
        () =>
          expect(
            f.remote.slots.some(
              (slot) =>
                slot.active &&
                slot.opts.cursor !== null &&
                slot.opts.endCursor == null &&
                !slot.current,
            ),
          ).toBe(true),
      )
      const beforeAbort = f.remote.successorStarts
      canceling.controller.abort()
      await f.remote.pump()
      oracleAssertion(
        `lazy-paging-history-oracle.property.test.ts:255:toBe`,
        () =>
          expect(
            f.remote.successorStarts,
            `new successor after authorizing abort`,
          ).toBe(beforeAbort),
      )
      reach.reach(`aborted-authorizer-pending`)
      holdApplication()
      const acceptedBefore = f.receipts.length
      acquire(h.size)
      await f.remote.pump()
      oracleAssertion(
        `lazy-paging-history-oracle.property.test.ts:264:toBe`,
        () =>
          expect(
            f.receipts
              .slice(acceptedBefore)
              .some((receipt) => receipt !== true),
          ).toBe(true),
      )
      await cleanup()
      f.remote.late(`success`)
      f.remote.late(`error`)
      checkpoint()
      restart()
      const fresh = acquire(1)
      await f.remote.pump()
      await fresh.load.complete()
      reach.reach(`held-receipt-cleanup-restart`)
      change(0)
      await f.remote.pump()
      assertLazyCoverage(
        [...f.source.base.values()],
        f.remote.source,
        { limit: 1 },
        h.descending,
      )
      reach.reach(`source-change-after-restart`)
      for (const command of h.commands) {
        const attempt = attempts[command.choice % attempts.length]!
        switch (command.action) {
          case `acquire`:
            if (running) acquire(command.choice)
            break
          case `retire`:
            retire(attempt)
            break
          case `abort`:
            attempt.controller.abort()
            break
          case `deliver`:
            await f.remote.deliver(command.choice)
            break
          case `drain`:
            await f.remote.pump()
            break
          case `stale-success`:
            f.remote.late(`success`)
            break
          case `stale-error`:
            f.remote.late(`error`)
            break
          case `hold-application`:
            holdApplication()
            break
          case `release-application`:
            await releaseApplication()
            break
          case `source-change`:
            change(command.choice)
            break
          case `cleanup`:
            await cleanup()
            break
          case `restart`:
            restart()
            break
        }
        for (let turn = 0; turn < 10; turn++) await Promise.resolve()
        checkpoint()
      }
      reach.reach(`generated-action-suffix`)
      await releaseApplication()
      await f.remote.pump()
      for (const attempt of attempts)
        if (!attempt.retired && !attempt.controller.signal.aborted) {
          await attempt.load.complete()
          assertLazyCoverage(
            [...f.source.values()],
            f.remote.source,
            attempt.load.request,
            h.descending,
          )
        }
      checkpoint()
      reach.reach(`applied-source-provenance`)
    },
    () => {
      for (const attempt of attempts) retire(attempt)
    },
    () => releaseApplication(),
    () => f.source.cleanup(),
  )
}

oracleProperty({
  id: `convex.lazy-history`,
  law: {
    statement: `generates ownership and callback schedules against one independent scope law`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
  },
  owns: [`src/paginated-options.ts#convexPaginatedCollectionOptions`],
  histories: {
    arbitrary: convex_lazy_historyHistory,
    runs: 60,
    fixedSeeds: [20261027],
    states: [
      `javascript-transport`,
      `react-transport`,
      `held-receipt-cleanup-restart`,
      `source-change-after-restart`,
      `aborted-authorizer-pending`,
      `retired-authorizer-pending`,
      `prior-delivery-after-retirement`,
      `retired-success-fenced`,
      `retired-error-fenced`,
      `generated-action-suffix`,
      `applied-source-provenance`,
    ] as const,
    constructed: [
      ...([false, true] as const).map((react) => ({
        name: react
          ? `existing React receiver`
          : `existing JavaScript receiver`,
        enters: (
          [
            `javascript-transport`,
            `react-transport`,
            `held-receipt-cleanup-restart`,
            `source-change-after-restart`,
            `aborted-authorizer-pending`,
            `retired-authorizer-pending`,
            `prior-delivery-after-retirement`,
            `retired-success-fenced`,
            `retired-error-fenced`,
            `generated-action-suffix`,
            `applied-source-provenance`,
          ] as const
        ).filter(
          (state) =>
            state !== (react ? `javascript-transport` : `react-transport`),
        ),
        build: (
          generated: AssertionHistory<typeof convex_lazy_historyHistory>,
        ) => ({ ...generated, react }),
      })),
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.lazy-history`, plan, observe, () =>
      convex_lazy_historyJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 60000,
})

const convex_lazy_suffixHistory = fc.tuple(
  fc.boolean(),
  fc.string({ maxLength: 8 }),
)
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_lazy_suffixJudgment(
  [descending, text]: AssertionHistory<typeof convex_lazy_suffixHistory>,
  reach: AssertionReach,
) {
  reach.beginHistory()
  const traces: Array<Array<string>> = []
  let firstEvidence: Array<LazyRow> | undefined
  for (const ranks of [
    [1, 2, 3, 4, 5, 6],
    [1, 2, 2, 3, 4, 5],
    [1, 1, 1, 2, 3, 4],
  ]) {
    const rows = ranks.map((rank, i) => ({
      id: `r${String(descending ? 10 - i : i).padStart(2, `0`)}`,
      rank: descending ? -rank : rank,
      text,
    }))
    if (traces.length < 2) {
      const evidence = ordered(rows, descending).slice(0, 2)
      if (firstEvidence)
        oracleAssertion(
          `lazy-paging-history-oracle.property.test.ts:409:toEqual`,
          () => expect(evidence).toEqual(firstEvidence),
        )
      else firstEvidence = evidence
    }
    const f = lazyFixture(rows, 2, descending)
    await withTestCleanup(
      async () => {
        const load = f.load({ limit: 2 })
        let settled = false
        void Promise.resolve(load.result).then(() => {
          settled = true
        })
        await f.remote.pump((slot) => slot.opts.cursor !== null)
        oracleAssertion(
          `lazy-paging-history-oracle.property.test.ts:421:toBe`,
          () =>
            expect(
              settled,
              `a full nonterminal page cannot close its leading tie`,
            ).toBe(false),
        )
        if (traces.length < 2)
          traces.push(f.remote.slots.map((slot) => JSON.stringify(slot.opts)))
        await f.remote.pump()
        await load.complete()
        assertLazyCoverage(
          [...f.source.values()],
          rows,
          { limit: 2 },
          descending,
        )
        oracleAssertion(
          `lazy-paging-history-oracle.property.test.ts:437:toEqual`,
          () =>
            expect(
              expectedLazyRows(
                [...f.source.values()],
                { limit: 2 },
                descending,
              ),
            ).toEqual(expectedLazyRows(rows, { limit: 2 }, descending)),
        )
        load.release()
      },
      () => f.source.cleanup(),
    )
  }
  oracleAssertion(
    `lazy-paging-history-oracle.property.test.ts:449:toEqual`,
    () => expect(traces[0]).toEqual(traces[1]),
  )
  reach.reach(`same-prefix-discovery`)
  reach.reach(`different-suffix-coverage`)
  reach.reach(`leading-three-tie`)
}

oracleProperty({
  id: `convex.lazy-suffix`,
  law: {
    statement: `compares paired hidden suffixes at the production discovery boundary`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
  },
  owns: [`src/paginated-options.ts#convexPaginatedCollectionOptions`],
  histories: {
    arbitrary: convex_lazy_suffixHistory,
    runs: 60,
    fixedSeeds: [20261027],
    states: [
      `same-prefix-discovery`,
      `different-suffix-coverage`,
      `leading-three-tie`,
    ] as const,
    constructed: [
      {
        name: `existing constructive history`,
        enters: [
          `same-prefix-discovery`,
          `different-suffix-coverage`,
          `leading-three-tie`,
        ] as const,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.lazy-suffix`, plan, observe, () =>
      convex_lazy_suffixJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 60000,
})

/** These are positive and negative calibrations of the scientific coverage
 * comparison, not claims that the native adapter selects both retention
 * strategies. An overshot row may be kept, or dropped and reacquired before a
 * later deeper success. Assuming it was retained after dropping it is illegal. */
const retentionCalibrationHistory = fc.tuple(
  fc.integer({ min: 2, max: 8 }),
  fc.boolean(),
)
function checkRetentionCalibration([size, descending]: AssertionHistory<
  typeof retentionCalibrationHistory
>) {
  const source = Array.from({ length: size + 2 }, (_, rank) => ({
    id: `r${rank}`,
    rank,
    text: `authored`,
  }))
  const orderedSource = ordered(source, descending)
  const shallow = orderedSource.slice(0, 1)
  const retained = orderedSource.slice(0, size)
  assertLazyCoverage(retained, source, { limit: 1 }, descending)
  assertLazyCoverage(shallow, source, { limit: 1 }, descending)
  assertLazyCoverage(retained, source, { limit: size }, descending)
  oracleAssertion(
    `lazy-paging-history-oracle.property.test.ts:497:toThrow`,
    () =>
      expect(() =>
        assertLazyCoverage(shallow, source, { limit: size }, descending),
      ).toThrow(`lazy coverage`),
  )
  const reacquired = [...shallow, ...orderedSource.slice(1, size)]
  assertLazyCoverage(reacquired, source, { limit: size }, descending)
}
oracleProperty({
  id: `convex.lazy-retention-calibration`,
  law: {
    statement: `The shared coverage comparison accepts retained and reacquired overshoot and rejects a missing required row.`,
    authority: `Existing checker calibration in this file.`,
    limits: `The unchanged bounded 2..8-row coverage calibration; no new production claim.`,
  },
  owns: [`src/paginated-options.ts#convexPaginatedCollectionOptions`],
  histories: {
    arbitrary: retentionCalibrationHistory,
    runs: 120,
    fixedSeeds: [20261027],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`coverage calibration`, plan, observe, () =>
      checkRetentionCalibration(plan.history),
    ),
})
