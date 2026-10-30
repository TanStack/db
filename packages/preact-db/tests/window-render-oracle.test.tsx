/**
 * A Preact window moves only after its render commits (the shared framework
 * contract). An error boundary can reject a render after the hook returned.
 * That render cannot move the previously committed Collection or acquire rows.
 * This receives the shared window model/checker through real Preact rendering,
 * with eager and finite synchronous on-demand sources. It does not establish
 * Suspense, concurrent scheduling, or asynchronous provider settlement.
 * Separate offset-only, limit-only and combined campaigns receive each kind
 * of window move; a fixed width would miss speculative resizing.
 */
import { Component, h, render } from 'preact'
import { useLayoutEffect } from 'preact/hooks'
import { act } from 'preact/test-utils'
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
import { settle } from './render-probe'
import type { InitialQueryBuilder } from '@tanstack/db'
import type { ComponentChildren } from 'preact'
import type { WindowRow } from '../../db/tests/conformance/window-history-oracle'

const renderHistoryArbitrary = fc.record({
  aborted: fc.integer({ min: 1, max: 4 }),
  committed: fc.integer({ min: 5, max: 8 }),
  limit: fc.integer({ min: 1, max: 3 }),
  abortedLimit: fc.integer({ min: 4, max: 6 }),
  committedLimit: fc.integer({ min: 7, max: 9 }),
})
const examples = [
  [{ aborted: 2, committed: 5, limit: 2, abortedLimit: 4, committedLimit: 7 }],
] as const
const states = [`committed move`, `aborted move`] as const
type RenderHistory = {
  aborted: number
  committed: number
  limit: number
  abortedLimit: number
  committedLimit: number
}
type PageWindow = { offset: number; limit: number }
type Move = `offset` | `limit` | `both`

class RejectionBoundary extends Component<{
  onError: (error: unknown) => void
  children?: ComponentChildren
}> {
  state = { failed: false }
  componentDidCatch(error: unknown) {
    this.props.onError(error)
    this.setState({ failed: true })
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

async function checkRenderHistory(
  history: RenderHistory,
  remote: boolean,
  keyed: boolean,
  move: Move,
  reach: ReturnType<typeof createOracleReach<(typeof states)[number]>>,
) {
  const lifetime = new ScenarioLifetime()
  const container = document.createElement(`div`)
  lifetime.defer(() => act(() => render(null, container)))
  let releaseRetainedConsumer: (() => void) | undefined
  lifetime.defer(() => releaseRetainedConsumer?.())
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
    let committed:
      | {
          rows: unknown
          collection: {
            toArray: unknown
            subscribeChanges: (listener: () => void) => {
              unsubscribe: () => void
            }
          }
        }
      | undefined
    let aborted = 0
    const rejection = new Error(`Abort the render after useLiveQuery`)
    let boundaryError: unknown
    const initial = { offset: 0, limit: history.limit }
    const abortedWindow = {
      offset: move === `limit` ? 0 : history.aborted,
      limit: move === `offset` ? history.limit : history.abortedLimit,
    }
    const accepted = {
      offset: move === `limit` ? 0 : history.committed,
      limit: move === `offset` ? history.limit : history.committedLimit,
    }
    function Page({ offset, limit, fail }: PageWindow & { fail: boolean }) {
      const query = (q: InitialQueryBuilder) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank, `desc`)
          .limit(limit)
          .offset(offset)
          .select(({ row }) => ({ id: row.id, rank: row.rank }))
      const result = useLiveQuery({
        query,
        ...(keyed ? { queryKey: [`window-render`, offset, limit] } : {}),
      })
      useLayoutEffect(() => {
        committed = { rows: result.data, collection: result.collection }
      })
      if (fail) {
        aborted++
        throw rejection
      }
      return null
    }
    const commit = (window: PageWindow, fail = false) =>
      act(() =>
        render(
          h(
            RejectionBoundary,
            { onError: (error) => (boundaryError = error) },
            h(Page, { ...window, fail }),
          ),
          container,
        ),
      )
    const expected = (window: PageWindow) =>
      windowRows(
        rows,
        {
          ...window,
          minimum: -1,
          nestedLimit: rows.length,
          descending: true,
        },
        false,
      )
    commit(initial)
    await settle()
    const collection = committed!.collection
    // The public Collection can have another real consumer after the hook's
    // error boundary unmounts it. Keeping that consumer makes a queued illegal
    // move observable; teardown cannot mask it by removing the last subscriber.
    const retainedConsumer = collection.subscribeChanges(() => {})
    releaseRetainedConsumer = () => retainedConsumer.unsubscribe()
    const compare = (window: PageWindow, cut: string, actual = committed!) =>
      checkWindowObservation(
        actual,
        {
          rows: expected(window),
          previousCollection: collection,
          retain: true,
        },
        cut,
      )
    compare(initial, `initial`)
    commit(accepted)
    await settle()
    reach.reach(`committed move`)
    compare(accepted, `committed`)
    const loads = provider?.calls.length ?? 0
    commit(abortedWindow, true)
    await settle()
    atOracleCheckpoint(`render attempted`, `aborted`, () => {
      expect(aborted, `Preact attempted the rejected render`).toBeGreaterThan(0)
      expect(
        boundaryError,
        `error boundary received the render rejection`,
      ).toBe(rejection)
    })
    reach.reach(`aborted move`)
    compare(accepted, `aborted`, { rows: collection.toArray, collection })
    atOracleCheckpoint(`speculative acquisition`, `aborted`, () =>
      expect(
        provider?.calls.length ?? 0,
        `aborted render acquires nothing`,
      ).toBe(loads),
    )
    // A width-only render-time move would resize the retained Collection even
    // if offset mutation waited for commit. The shared checker rejects it.
    if (move !== `offset`)
      expect(() =>
        compare(accepted, `aborted width calibration`, {
          rows: expected({ ...accepted, limit: abortedWindow.limit }),
          collection,
        }),
      ).toThrow()
  })
}

describe(`window changes at Preact commit`, () => {
  for (const remote of [false, true])
    for (const keyed of [false, true])
      for (const move of [`offset`, `limit`, `both`] as const)
        for (const campaign of [`fixed`, `fresh`] as const) {
          const property = `preact.window-render`
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
                `preact render reach ${remote}/${keyed}/${move}/${campaign}`,
                Object.fromEntries(reach.counts()),
              )
            }
            reach.assertReached()
          })
        }
})

declareOracle({
  grammar: [renderHistoryArbitrary],
  check: [checkRenderHistory],
})
