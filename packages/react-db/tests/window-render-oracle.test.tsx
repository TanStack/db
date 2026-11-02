/**
 * A mounted window moves at commit. React can abandon a render after the hook
 * returns, so that render cannot mutate the committed Collection or acquire
 * provider rows. This receives the shared window law at React's pre-commit cut.
 * It uses the shared recomputation and comparison, with synchronous eager and
 * finite on-demand sources. Async settlement belongs to the core window owner.
 * Offset-only, limit-only and combined moves have separate receiving campaigns.
 * Their speculative proposals may differ, but only committed windows are public.
 */
import { Suspense, startTransition, useLayoutEffect, useState } from 'react'
import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  BTreeIndex,
  createCollection,
  localOnlyCollectionOptions,
} from '@tanstack/db'
import { useLiveQuery } from '../src/useLiveQuery'
import { makeInfiniteOnDemandSource } from '../../db/tests/conformance/infinite-on-demand'
import { ScenarioLifetime } from '../../db/tests/conformance/scenario-lifetime'
import {
  checkWindowObservation,
  windowRows,
} from '../../db/tests/conformance/window-history-oracle'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  atOracleCheckpoint,
  createOracleFailureFidelity,
} from '../../db/tests/oracle-failure-fidelity'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import type { InitialQueryBuilder } from '@tanstack/db'
import type {
  WindowInput,
  WindowRow,
} from '../../db/tests/conformance/window-history-oracle'

const renderHistoryArbitrary = fc.record({
  abandoned: fc.integer({ min: 1, max: 4 }),
  committed: fc.integer({ min: 5, max: 8 }),
  limit: fc.integer({ min: 1, max: 3 }),
  abandonedLimit: fc.integer({ min: 4, max: 6 }),
  committedLimit: fc.integer({ min: 7, max: 9 }),
})
const examples = [
  [
    {
      abandoned: 2,
      committed: 5,
      limit: 2,
      abandonedLimit: 4,
      committedLimit: 7,
    },
  ],
] as const
const states = [`suspended move`, `cancelled move`, `committed move`] as const
type RenderHistory = {
  abandoned: number
  committed: number
  limit: number
  abandonedLimit: number
  committedLimit: number
}
type PageWindow = { offset: number; limit: number }
type Move = `offset` | `limit` | `both`

async function checkRenderHistory(
  history: RenderHistory,
  remote: boolean,
  keyed: boolean,
  move: Move,
  reach: ReturnType<typeof createOracleReach<(typeof states)[number]>>,
) {
  const lifetime = new ScenarioLifetime()
  let unmount: (() => void) | undefined
  lifetime.defer(() => unmount?.())
  await lifetime.run(async () => {
    const rows: Array<WindowRow> = Array.from({ length: 24 }, (_, id) => ({
      id: String(id).padStart(2, `0`),
      rank: id,
    }))
    const provider = remote
      ? makeInfiniteOnDemandSource({ createCollection, BTreeIndex }, rows)
      : undefined
    const source =
      provider?.collection ??
      createCollection(
        localOnlyCollectionOptions({
          getKey: (row: WindowRow) => row.id,
          initialData: rows,
          autoIndex: `eager`,
          defaultIndexType: BTreeIndex,
        }),
      )
    lifetime.defer(() => source.cleanup({ dependents: true }))
    const initial = { offset: 0, limit: history.limit }
    const abandoned = {
      offset: move === `limit` ? 0 : history.abandoned,
      limit: move === `offset` ? history.limit : history.abandonedLimit,
    }
    const accepted = {
      offset: move === `limit` ? 0 : history.committed,
      limit: move === `offset` ? history.limit : history.committedLimit,
    }
    const input = (window: PageWindow): WindowInput => ({
      ...window,
      minimum: -1,
      nestedLimit: rows.length,
      descending: true,
    })
    const never = new Promise<void>(() => {})
    let setPage: (value: PageWindow & { suspend: boolean }) => void = () => {
      throw new Error(`Not mounted`)
    }
    let suspended = 0
    let committed: { rows: unknown; collection: unknown } | undefined
    let readCollection: () => unknown = () => undefined
    function Page() {
      const [page, update] = useState({ ...initial, suspend: false })
      setPage = update
      const query = (q: InitialQueryBuilder) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank, `desc`)
          .limit(page.limit)
          .offset(page.offset)
          .select(({ row }) => ({ id: row.id, rank: row.rank }))
      const result = useLiveQuery({
        query,
        ...(keyed
          ? { queryKey: [`window-render`, page.offset, page.limit] }
          : {}),
      })
      useLayoutEffect(() => {
        committed = { rows: result.data, collection: result.collection }
        readCollection = () => result.collection.toArray
      })
      if (page.suspend) {
        suspended++
        throw never
      }
      return null
    }
    const view = render(
      <Suspense fallback={null}>
        <Page />
      </Suspense>,
    )
    unmount = () => view.unmount()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const initialCollection = committed!.collection
    const loads = provider?.calls.length ?? 0
    const failures: Array<unknown> = []
    const capture = (check: () => void) => {
      try {
        check()
      } catch (error) {
        failures.push(error)
      }
    }
    const compare = (window: PageWindow, cut: string, actual = committed!) =>
      checkWindowObservation(
        actual,
        {
          rows: windowRows(rows, input(window), false),
          previousCollection: initialCollection,
          retain: true,
        },
        cut,
      )
    let interruption: { error: unknown } | undefined
    try {
      compare(initial, `initial`)
      await act(async () =>
        startTransition(() => setPage({ ...abandoned, suspend: true })),
      )
      atOracleCheckpoint(`render attempted`, `suspended`, () =>
        expect(
          suspended,
          `React attempted the suspended render`,
        ).toBeGreaterThan(0),
      )
      reach.reach(`suspended move`)
      capture(() =>
        compare(initial, `suspended`, {
          rows: readCollection(),
          collection: initialCollection,
        }),
      )
      capture(() =>
        atOracleCheckpoint(`speculative acquisition`, `suspended`, () =>
          expect(
            provider?.calls.length ?? 0,
            `abandoned render acquires nothing`,
          ).toBe(loads),
        ),
      )
      // Rival design: apply only the proposed width before commit. Supplying
      // its rows to the same comparison must fail at this held render cut.
      if (move !== `offset`)
        expect(() =>
          compare(initial, `suspended width calibration`, {
            rows: windowRows(
              rows,
              input({ ...initial, limit: abandoned.limit }),
              false,
            ),
            collection: initialCollection,
          }),
        ).toThrow()
      await act(async () => setPage({ ...initial, suspend: false }))
      reach.reach(`cancelled move`)
      capture(() => compare(initial, `cancelled`))
      await act(async () => setPage({ ...accepted, suspend: false }))
      reach.reach(`committed move`)
      capture(() => compare(accepted, `committed`))
    } catch (error) {
      interruption = { error }
    }
    if (interruption) failures.push(interruption.error)
    if (failures.length)
      throw new AggregateError(failures, `React window commit mismatches`, {
        cause: failures[0],
      })
  })
}

describe(`window changes at React commit`, () => {
  for (const remote of [false, true])
    for (const keyed of [false, true]) {
      for (const move of [`offset`, `limit`, `both`] as const)
        for (const campaign of [`fixed`, `fresh`] as const) {
          const property = `react.window-render`
          const test =
            campaign === `fixed`
              ? oracleReplayTest(it)
              : oracleReplayTest(it, property)
          test(`${remote ? `on-demand` : `eager`}/${keyed ? `keyed` : `derived`}/${move}/${campaign}`, async () => {
            const reach = createOracleReach(
              `${property}/${remote}/${keyed}/${move}/${campaign}`,
              states,
              { fixedHistories: examples.length },
            )
            let index = 0
            const fidelity = createOracleFailureFidelity<RenderHistory>()
            const propertyUnderTest = fc.asyncProperty(
              renderHistoryArbitrary,
              async (history) => {
                reach.beginHistory({ fixed: index++ < examples.length })
                await fidelity.run(history, () =>
                  checkRenderHistory(history, remote, keyed, move, reach),
                )
              },
            )
            try {
              await fidelity.assert(() =>
                fc.assert(
                  propertyUnderTest,
                  campaign === `fixed`
                    ? {
                        numRuns: oracleRuns(6) + examples.length,
                        seed: 2291,
                        examples: [...examples].map(([value]) => [value]),
                      }
                    : oraclePropertyOptions(6, property, {
                        examples: [...examples].map(([value]) => [value]),
                      }),
                ),
              )
            } finally {
              console.info(
                `render reach ${remote}/${keyed}/${move}/${campaign}`,
                Object.fromEntries(reach.counts()),
              )
            }
            reach.assertReached()
            console.info(
              `window render reach ${remote}/${keyed}/${move}/${campaign}`,
              Object.fromEntries(reach.counts()),
            )
          })
        }
    }
})
declareOracle({
  grammar: [renderHistoryArbitrary],
  check: [checkRenderHistory],
})
