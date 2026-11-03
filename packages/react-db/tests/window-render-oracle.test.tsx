/**
 * A mounted window moves at commit. React can abandon a render after the hook
 * returns, so that render cannot mutate the committed Collection or acquire
 * provider rows. This receives the shared window law at React's pre-commit cut.
 * It uses the shared recomputation and comparison, with synchronous eager and
 * finite on-demand sources. Async settlement belongs to the core window owner.
 * Offset-only, limit-only and combined moves have separate receiving campaigns.
 * Client scopes cover provider, explicit client, and descriptor sources.
 * Their speculative proposals may differ, but only committed windows are public.
 */
import { Suspense, startTransition, useLayoutEffect, useState } from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  BTreeIndex,
  DbClient,
  collectionOptions,
  createCollection,
  localOnlyCollectionOptions,
} from '@tanstack/db'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { DbProvider } from '../src/DbProvider'
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
type ClientScope = `none` | `provider` | `explicit` | `descriptor`

async function checkRenderHistory(
  history: RenderHistory,
  remote: boolean,
  keyed: boolean,
  move: Move,
  scope: ClientScope,
  suspense: boolean,
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
    const client = scope === `none` ? undefined : new DbClient()
    if (client) lifetime.defer(() => client.cleanup())
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
    const descriptor =
      scope === `descriptor`
        ? collectionOptions(source.id, () => ({
            ...source.config,
            schema: undefined,
            getKey: (row: WindowRow) => row.id,
          }))
        : undefined
    // The same provider fixture supplies its sync configuration to the client.
    // Only the descriptor is authored into this hook's query.
    if (descriptor)
      lifetime.defer(() =>
        client!.collection(descriptor).cleanup({ dependents: true }),
      )
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
      const query = (q: InitialQueryBuilder) => {
        const from = descriptor
          ? q.from({ row: descriptor })
          : q.from({ row: source })
        return from
          .orderBy(({ row }) => row.rank, `desc`)
          .limit(page.limit)
          .offset(page.offset)
          .select(({ row }) => ({ id: row.id, rank: row.rank }))
      }
      const usePage = suspense ? useLiveSuspenseQuery : useLiveQuery
      const result = usePage({
        query,
        ...(scope === `explicit` ? { client } : {}),
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
        {client && scope !== `explicit` ? (
          <DbProvider client={client}>
            <Page />
          </DbProvider>
        ) : (
          <Page />
        )}
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
      await act(() =>
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
      await act(() => setPage({ ...initial, suspend: false }))
      reach.reach(`cancelled move`)
      capture(() => compare(initial, `cancelled`))
      await act(() => setPage({ ...accepted, suspend: false }))
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
  for (const suspense of [false, true])
    for (const scope of [`none`, `provider`, `explicit`, `descriptor`] as const)
      for (const remote of [false, true])
        for (const keyed of [false, true]) {
          for (const move of [`offset`, `limit`, `both`] as const)
            for (const campaign of [`fixed`, `fresh`] as const) {
              const property = `react.window-render`
              const test =
                campaign === `fixed`
                  ? oracleReplayTest(it)
                  : oracleReplayTest(it, property)
              test(`${suspense ? `Suspense` : `ordinary`}/${scope}/${remote ? `on-demand` : `eager`}/${keyed ? `keyed` : `derived`}/${move}/${campaign}`, async () => {
                const reach = createOracleReach(
                  `${property}/${suspense}/${scope}/${remote}/${keyed}/${move}/${campaign}`,
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
                      checkRenderHistory(
                        history,
                        remote,
                        keyed,
                        move,
                        scope,
                        suspense,
                        reach,
                      ),
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
                    `render reach ${scope}/${remote}/${keyed}/${move}/${campaign}`,
                    Object.fromEntries(reach.counts()),
                  )
                }
                reach.assertReached()
              })
            }
        }
})
declareOracle({
  grammar: [renderHistoryArbitrary],
  check: [checkRenderHistory],
})

/** A mounted binding can suspend on a replacement while another hook finishes
 * that same preload first. React preserves the mounted binding's refs in this
 * case. On resumption it still owes its own output, not the peer's mutable page.
 * The before-hook hold forces that ordering instead of assuming React's retry
 * order. Expected rows and identity use the shared page comparison above.
 */
const retryStates = [
  `replacement suspended`,
  `peer ready`,
  `replacement resumed`,
  `page isolated`,
  `borrower moves after compiler retries`,
] as const
async function checkRetryOwnershipHistory(
  history: RenderHistory,
  withClient: boolean,
  keyed: boolean,
  simultaneous: boolean,
  reach: ReturnType<typeof createOracleReach<(typeof retryStates)[number]>>,
) {
  const lifetime = new ScenarioLifetime()
  const rows = Array.from({ length: 24 }, (_, rank) => ({
    id: String(rank),
    rank,
  }))
  const client = withClient ? new DbClient() : undefined
  if (client) lifetime.defer(() => client.cleanup())
  const firstSource = createCollection(
    localOnlyCollectionOptions({
      getKey: (row: WindowRow) => row.id,
      initialData: rows,
    }),
  )
  let release: (() => void) | undefined
  const replacement = createCollection({
    getKey: (row: WindowRow) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const value of rows) write({ type: `insert`, value: { ...value } })
        commit()
        release = markReady
      },
    },
  })
  lifetime.defer(() => firstSource.cleanup({ dependents: true }))
  lifetime.defer(() => replacement.cleanup({ dependents: true }))
  const props = { replace: false, block: false, offset: 0 }
  const query = (replace: boolean, offset: number) => ({
    client,
    ...(keyed ? { queryKey: [`retry-output`, replace, offset] } : {}),
    query: (q: InitialQueryBuilder) =>
      q
        .from({ row: replace ? replacement : firstSource })
        .orderBy(({ row }) => row.rank)
        .limit(history.limit)
        .offset(offset)
        .select(({ row }) => ({ id: row.id, rank: row.rank })),
  })
  const blocked = new Promise<void>(() => {})
  const hook = renderHook(
    ({ replace, block, offset }) => {
      if (block) throw blocked
      return useLiveSuspenseQuery(query(replace, offset))
    },
    {
      initialProps: props,
      wrapper: ({ children }) => (
        <Suspense fallback={<div data-testid="retry-primary" />}>
          {children}
        </Suspense>
      ),
    },
  )
  lifetime.defer(() => hook.unmount())
  await lifetime.run(async () => {
    await act(async () => {
      await Promise.resolve()
    })
    expect(hook.result.current.data).toHaveLength(history.limit)
    await act(() => hook.rerender({ ...props, replace: true }))
    expect(screen.getByTestId(`retry-primary`)).toBeTruthy()
    expect(release, `replacement source was requested`).toBeDefined()
    reach.reach(`replacement suspended`)
    await act(() => hook.rerender({ ...props, replace: true, block: true }))
    let peerOffset = 0
    const peer = renderHook(
      () => useLiveSuspenseQuery(query(true, peerOffset)),
      {
        wrapper: ({ children }) => (
          <Suspense fallback={<div data-testid="retry-peer" />}>
            {children}
          </Suspense>
        ),
      },
    )
    lifetime.defer(() => peer.unmount())
    expect(
      replacement.subscriberCount,
      `both pending bindings adopted one preload`,
    ).toBe(1)
    await act(() => {
      if (simultaneous) hook.rerender({ ...props, replace: true })
      release!()
    })
    expect(peer.result.current.data).toHaveLength(history.limit)
    if (!simultaneous) expect(screen.getByTestId(`retry-primary`)).toBeTruthy()
    reach.reach(`peer ready`)
    const peerCollection = peer.result.current.collection
    await act(() => hook.rerender({ ...props, replace: true }))
    const expected = (offset: number) =>
      windowRows(
        rows,
        {
          offset,
          limit: history.limit,
          minimum: -1,
          descending: false,
          nestedLimit: rows.length,
        },
        false,
      )
    checkWindowObservation(
      {
        rows: hook.result.current.data,
        collection: hook.result.current.collection,
      },
      { rows: expected(0), previousCollection: peerCollection, retain: false },
      `resumed binding owns its output`,
    )
    reach.reach(`replacement resumed`)
    // The borrower adopted pending work compiled by the original binding.
    // Its next use must retain its own Collection even after that compiler retries.
    peerOffset = history.abandoned
    await act(() => peer.rerender())
    checkWindowObservation(
      {
        rows: peer.result.current.data,
        collection: peer.result.current.collection,
      },
      {
        rows: expected(peerOffset),
        previousCollection: peerCollection,
        retain: true,
      },
      `borrower page after original compiler retries`,
    )
    reach.reach(`borrower moves after compiler retries`)
    const collection = hook.result.current.collection
    await act(() =>
      hook.rerender({ ...props, replace: true, offset: history.committed }),
    )
    checkWindowObservation(
      {
        rows: hook.result.current.data,
        collection: hook.result.current.collection,
      },
      {
        rows: expected(history.committed),
        previousCollection: collection,
        retain: true,
      },
      `resumed binding page move`,
    )
    checkWindowObservation(
      {
        rows: peer.result.current.data,
        collection: peer.result.current.collection,
      },
      {
        rows: expected(peerOffset),
        previousCollection: peerCollection,
        retain: true,
      },
      `peer after resumed binding page move`,
    )
    reach.reach(`page isolated`)
  })
}
for (const client of [false, true])
  for (const keyed of [false, true])
    for (const simultaneous of [false, true])
      for (const campaign of [`fixed`, `fresh`] as const) {
        const property = `react.window-retry-ownership`
        const test =
          campaign === `fixed`
            ? oracleReplayTest(it)
            : oracleReplayTest(it, property)
        test(`retry ownership/${client ? `client` : `unscoped`}/${keyed ? `keyed` : `derived`}/${simultaneous ? `co-ready` : `borrower-first`}/${campaign}`, async () => {
          const reach = createOracleReach(
            `${property}/${client}/${keyed}/${simultaneous}/${campaign}`,
            retryStates,
            { fixedHistories: examples.length },
          )
          let index = 0
          const fidelity = createOracleFailureFidelity<RenderHistory>()
          try {
            await fidelity.assert(() =>
              fc.assert(
                fc.asyncProperty(renderHistoryArbitrary, async (history) => {
                  reach.beginHistory({ fixed: index++ < examples.length })
                  await fidelity.run(history, () =>
                    checkRetryOwnershipHistory(
                      history,
                      client,
                      keyed,
                      simultaneous,
                      reach,
                    ),
                  )
                }),
                campaign === `fixed`
                  ? {
                      numRuns: oracleRuns(6) + examples.length,
                      seed: 2345,
                      examples: [...examples].map(([value]) => [value]),
                    }
                  : oraclePropertyOptions(6, property, {
                      examples: [...examples].map(([value]) => [value]),
                    }),
              ),
            )
          } finally {
            console.info(
              `retry reach ${client}/${keyed}/${simultaneous}/${campaign}`,
              Object.fromEntries(reach.counts()),
            )
          }
          reach.assertReached()
        })
      }
declareOracle({
  grammar: [renderHistoryArbitrary],
  check: [checkRetryOwnershipHistory],
})
