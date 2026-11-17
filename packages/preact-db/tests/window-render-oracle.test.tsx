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
import {
  OracleCheckpointFailure,
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-config'
import { selectedRowKeys } from '../../db/tests/conformance/result-laws'
import { settle } from './render-probe'
import type { Observation, Verdict } from '../../db/tests/oracle-config'
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

async function driveRenderHistory(
  history: RenderHistory,
  remote: boolean,
  keyed: boolean,
  move: Move,
  observe: (checkpoint: string, value: unknown) => void,
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
    commit(initial)
    await settle()
    const collection = committed!.collection
    // The public Collection can have another real consumer after the hook's
    // error boundary unmounts it. Keeping that consumer makes a queued illegal
    // move observable; teardown cannot mask it by removing the last subscriber.
    const retainedConsumer = collection.subscribeChanges(() => {})
    releaseRetainedConsumer = () => retainedConsumer.unsubscribe()
    const record = (cut: string, actual = committed!) =>
      observe(cut, {
        ...captureWindow(actual.rows, actual.collection, collection),
        ...(cut === `aborted`
          ? {
              attempts: aborted,
              receivedRejection: boundaryError === rejection,
              loadsBefore: loads,
              loadsAfter: provider?.calls.length ?? 0,
            }
          : {}),
      })
    record(`initial`)
    commit(accepted)
    await settle()
    observe(`reach`, `committed move`)
    record(`committed`)
    const loads = provider?.calls.length ?? 0
    commit(abortedWindow, true)
    await settle()
    record(`aborted`, { rows: collection.toArray, collection })
    if (aborted > 0 && boundaryError === rejection)
      observe(`reach`, `aborted move`)
  })
}

// Identity relations are captured at the public cut, rather than recording a
// Collection's mutable internals or its generated ID. Selected row snapshots
// preserve every key the shared checker judges, including unexpected fields.
function captureWindow(rows: unknown, collection: unknown, previous: unknown) {
  return {
    rows: Array.isArray(rows)
      ? rows.map((row: unknown) =>
          row !== null && typeof row === `object`
            ? Object.fromEntries(
                selectedRowKeys(row).map((key) => [key, Reflect.get(row, key)]),
              )
            : row,
        )
      : rows,
    enabled: collection !== null,
    retained: collection === previous,
  }
}
type WindowObservation = ReturnType<typeof captureWindow> & {
  attempts?: number
  receivedRejection?: boolean
  loadsBefore?: number
  loadsAfter?: number
}

function expectedRows(window: PageWindow) {
  return windowRows(
    Array.from({ length: 24 }, (_, id) => ({
      id: String(id).padStart(2, `0`),
      rank: id,
    })),
    { ...window, minimum: -1, nestedLimit: 24, descending: true },
    false,
  )
}

// The last committed page remains authoritative when an error boundary rejects
// the next render. The reference retains only that page and recomputes its rows
// with the shared sort/filter/slice model; it has no framework state.
function expectedRender(history: RenderHistory, move: Move) {
  const accepted = {
    offset: move === `limit` ? 0 : history.committed,
    limit: move === `offset` ? history.limit : history.committedLimit,
  }
  return {
    initial: expectedRows({ offset: 0, limit: history.limit }),
    committed: expectedRows(accepted),
    aborted: expectedRows(accepted),
    reach: states,
  }
}

// Reconstruct only the identity relation for the existing shared checker: the
// sentinel represents the previously committed Collection, never a production
// object. This keeps its exact selected-row and retention judgment unchanged.
function checkRender(
  _history: RenderHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof expectedRender>,
): Verdict {
  for (const { checkpoint, value } of trace) {
    if (
      checkpoint !== `initial` &&
      checkpoint !== `committed` &&
      checkpoint !== `aborted`
    )
      continue
    const actual = value as WindowObservation
    const previous = {}
    try {
      checkWindowObservation(
        {
          rows: actual.rows,
          collection: actual.enabled ? (actual.retained ? previous : {}) : null,
        },
        {
          rows: expected[checkpoint],
          previousCollection: previous,
          retain: true,
        },
        checkpoint,
      )
    } catch (error) {
      if (!(error instanceof OracleCheckpointFailure)) throw error
      return violation(checkpoint, String(error.cause), error.law)
    }
    if (checkpoint === `aborted`) {
      const wrongRender = differs(
        checkpoint,
        `render attempted`,
        (actual.attempts ?? 0) > 0 && actual.receivedRejection === true,
        true,
      )
      if (wrongRender) return wrongRender
      const wrongAcquisition = differs(
        checkpoint,
        `speculative acquisition`,
        actual.loadsAfter,
        actual.loadsBefore,
      )
      if (wrongAcquisition) return wrongAcquisition
    }
  }
  // Judge any recorded semantic failure first, then require the whole promised
  // initial/commit/rejection observation sequence and both actual transitions.
  const cuts = trace
    .filter(({ checkpoint }) => checkpoint !== `reach`)
    .map(({ checkpoint }) => checkpoint)
  const missing = differs(`render completed`, `window observation`, cuts, [
    `initial`,
    `committed`,
    `aborted`,
  ])
  if (missing) return missing
  const reached = new Set(
    trace
      .filter(({ checkpoint }) => checkpoint === `reach`)
      .map(({ value }) => value),
  )
  for (const state of expected.reach)
    if (!reached.has(state))
      return violation(
        `render completed`,
        `the history did not enter ${state}`,
        `window render reach`,
      )
  return pass
}

// Literal IDs let the replay manifest discover every receiving cell directly.
// The tuples retain the complete source × identity × window-move grammar.
const renderProperties = [
  [`preact.window-render.eager-derived-offset`, false, false, `offset`],
  [`preact.window-render.eager-derived-limit`, false, false, `limit`],
  [`preact.window-render.eager-derived-both`, false, false, `both`],
  [`preact.window-render.eager-keyed-offset`, false, true, `offset`],
  [`preact.window-render.eager-keyed-limit`, false, true, `limit`],
  [`preact.window-render.eager-keyed-both`, false, true, `both`],
  [`preact.window-render.on-demand-derived-offset`, true, false, `offset`],
  [`preact.window-render.on-demand-derived-limit`, true, false, `limit`],
  [`preact.window-render.on-demand-derived-both`, true, false, `both`],
  [`preact.window-render.on-demand-keyed-offset`, true, true, `offset`],
  [`preact.window-render.on-demand-keyed-limit`, true, true, `limit`],
  [`preact.window-render.on-demand-keyed-both`, true, true, `both`],
] as const
for (const [id, remote, keyed, move] of renderProperties) {
  oracleProperty({
    id,
    law: {
      statement: `A Preact window moves only after its render commits. A rejected render cannot move the committed Collection or acquire rows.`,
      authority: `packages/db/tests/conformance/contract.ts query-identity and window-commit laws; maintainer decision 2026-10-30 (#2291).`,
      limits: `Real Preact error-boundary rendering, eager or finite synchronous on-demand sources, derived or explicit keys, and finite offset/limit moves; no Suspense, concurrent scheduling, or asynchronous provider settlement.`,
    },
    owns: [`src/useLiveQuery.ts#useLiveQuery`],
    histories: {
      arbitrary: renderHistoryArbitrary,
      runs: 6,
      fixedSeeds: [2291],
      states,
      // Every legal history already performs both transitions. Keep all
      // generated offsets and widths: required reach needs no literal page.
      constructed: [
        {
          name: `commits one page and rejects the next`,
          enters: states,
          build: (history) => ({ ...history }),
        },
      ],
      fixed: [
        {
          name: `retains the committed page after rejection`,
          history: {
            aborted: 2,
            committed: 5,
            limit: 2,
            abortedLimit: 4,
            committedLimit: 7,
          },
        },
      ],
    },
    model: (history) => expectedRender(history, move),
    driver: (history, observe) =>
      driveRenderHistory(history, remote, keyed, move, observe),
    check: checkRender,
    calibrations: [
      {
        name: `missing render reach`,
        law: `window render reach`,
        corrupt: (trace) =>
          trace.filter(({ checkpoint }) => checkpoint !== `reach`),
      },
      {
        name: `missing render observations`,
        law: `window observation`,
        corrupt: () => [],
      },
      ...(move === `offset`
        ? []
        : [
            {
              name: `aborted render changes the committed width`,
              law: `ordered window rows`,
              corrupt: (
                trace: ReadonlyArray<Observation>,
                history: RenderHistory,
              ) =>
                trace.map((entry) =>
                  entry.checkpoint === `aborted`
                    ? {
                        ...entry,
                        value: {
                          ...(entry.value as WindowObservation),
                          rows: expectedRows({
                            offset: move === `limit` ? 0 : history.committed,
                            limit: history.abortedLimit,
                          }),
                        },
                      }
                    : entry,
                ),
            },
          ]),
    ],
  })
}
