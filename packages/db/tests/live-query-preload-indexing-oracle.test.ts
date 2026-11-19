/**
 * Every explicit DbClient preload declaration obeys Collection's eager-index
 * constructor requirement, including warm reuse. Authority: maintainer's
 * preload-admission decision in the PR #2314 review, 2026-10-30. A rejected
 * declaration cannot discard a compatible caller's pending or settled preload.
 *
 * The shared indexing model judges admission synchronously, before any held
 * source delivery. The finite grammar crosses all nine declarations with a
 * cold client or each valid prior declaration, pending/settled prior delivery,
 * and derived/same/different query keys. It judges no hydrated cache or SSR.
 */
import { expect } from 'vitest'
import {
  BTreeIndex,
  BasicIndex,
  DbClient,
  Query,
  createCollection,
} from '../src'
import {
  expectIndexingAdmission,
  expectedIndexing,
  indexConfigurationLabel,
  indexConfigurations,
} from './conformance/indexing-config-oracle'
import { oracleProperty } from './oracle-property'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter'
import { withOracleCleanup } from './utils'

function preloadIndexHistories() {
  const settings = indexConfigurations({
    indexTypes: { basic: BasicIndex, btree: BTreeIndex },
  })
  const priors = [
    { first: undefined, phase: `cold` },
    ...settings
      .filter((setting) => !expectedIndexing(setting).rejects)
      .flatMap((first) =>
        [`pending`, `settled`].map((phase) => ({ first, phase })),
      ),
  ]
  return priors.flatMap((prior) =>
    settings.flatMap((second) =>
      ([`derived`, `same-key`, `different-key`] as const).map((identity) => ({
        ...prior,
        second,
        identity,
      })),
    ),
  )
}

// Constructor functions remain in the original fixture table. Data histories
// name each fixture by its position and stable constructor role; resolve retrieves
// those same references without serializing them into a history or observation.
const preloadIndexCases = preloadIndexHistories()
type PreloadIndexCase = (typeof preloadIndexCases)[number]
async function runPreloadIndexHistory(
  scenario: PreloadIndexCase,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  const { first, second, phase, identity } = scenario

  const entered = new Set<string>()
  const required = [`admission`, ...(first ? [`original-reuse`] : [])]
  const reach = {
    reach: (state: string) => {
      entered.add(state)
      observe(`reach`, state)
    },
  }
  const client = new DbClient()
  let starts = 0
  let delivered = false
  let deliver = () => {}
  const source = createCollection({
    id: `preload-indexing-source`,
    getKey: (row: { id: number }) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        starts++
        deliver = () => {
          if (delivered) return
          delivered = true
          begin()
          write({ type: `insert`, value: { id: 1 } })
          commit()
          markReady()
        }
      },
    },
  })
  const query = new Query().from({ row: source })
  const queryKey = identity === `derived` ? undefined : [`preload-indexing`]
  const firstConfig = { query, queryKey, ...first }
  const pending: Array<Promise<void>> = []
  let original: Promise<void> | undefined
  await withOracleCleanup(async () => {
    if (first) {
      original = client.preloadLiveQuery(firstConfig)
      pending.push(original)
      oracleAssertion(`runPreloadIndexHistory:111`, () =>
        expect(starts, `first preload starts held source`).toBe(1),
      )
      if (phase === `settled`) {
        deliver()
        await original
      }
    }
    const admission: { rejected: boolean; error?: unknown } = {
      rejected: false,
    }
    try {
      pending.push(
        client.preloadLiveQuery({
          query,
          queryKey:
            identity === `different-key`
              ? [`other-preload-indexing`]
              : queryKey,
          ...second,
        }),
      )
    } catch (error) {
      admission.rejected = true
      admission.error = error
    }
    oracleAssertion(`expectIndexingAdmission:135`, () =>
      expectIndexingAdmission(admission, second),
    )
    reach.reach(`admission`)
    if (first) {
      oracleAssertion(`runPreloadIndexHistory:138`, () =>
        expect(
          client.preloadLiveQuery(firstConfig),
          `prior preload survives second admission`,
        ).toBe(original),
      )
      reach.reach(`original-reuse`)
    }
    if (phase !== `settled` && starts) deliver()
    await Promise.all(pending)
    oracleAssertion(`preload indexing receiving reach`, () =>
      expect([...entered].sort()).toEqual([...required].sort()),
    )
  }, [
    async () => {
      if (phase !== `settled` && starts) deliver()
      await Promise.allSettled(pending)
      await client.cleanup()
    },
    () => source.cleanup({ dependents: true }),
  ])
}
oracleProperty({
  id: `live-query.preload-indexing`,
  law: {
    statement: `Every preload declaration obeys eager-index constructor admission, and rejection preserves a compatible caller's pending or settled preload.`,
    authority: `The maintainer preload-admission decision from 2026-10-30 and the shared indexing model above.`,
    limits: `The unchanged nine declarations, cold/valid-prior pending/settled states and derived/same/different keys; no hydrated cache or SSR.`,
  },
  // What this oracle owns: the gap report judges DbClient.preloadLiveQuery,
  // the explicit preload admission path, by this file's finite declaration grammar.
  owns: [`src/client.ts#DbClient.preloadLiveQuery`],
  histories: preloadIndexCases.map((scenario, index) => ({
    index,
    first: scenario.first
      ? indexConfigurationLabel(scenario.first, {
          indexTypes: { basic: BasicIndex, btree: BTreeIndex },
        })
      : `cold`,
    second: indexConfigurationLabel(scenario.second, {
      indexTypes: { basic: BasicIndex, btree: BTreeIndex },
    }),
    phase: scenario.phase,
    identity: scenario.identity,
  })),
  resolve: (history) => preloadIndexCases[history.index]!,
  model: recordedAssertionJudgment,
  driver: (scenario, observe) =>
    recordAssertionJudgment(
      `preload indexing admission`,
      scenario,
      observe,
      () => runPreloadIndexHistory(scenario, observe),
    ),
  check: forwardAssertionJudgment,
})
