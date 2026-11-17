/**
 * Each client-backed hook owns its live-query Collection. Changing only
 * its outer page retains that Collection; another reader and the client's
 * transported page snapshots keep their own pages. Authority: issue #2345's
 * requested extension of contract.ts, the maintainer's 2026-11-03 independent
 * Suspense-output decision, and the SSR guide's preload/hydration identity law.
 *
 * This receiver reuses the window owner's independent sort/slice judgment.
 * Server preload snapshots cross JSON into a real React hook while the browser
 * source's readiness is held. A speculative offset/limit move suspends after
 * the hook returns, then is cancelled. Its seed cannot replace the committed
 * page, including on the next original-page render. Provider and explicit
 * clients receive the same histories. Committed moves before source readiness
 * must show the matching server page. After readiness, rows follow
 * the browser source. A peer remains on its original page. No Electric SDK or
 * arbitrary concurrent scheduler behavior is claimed by this finite host model.
 */
import { act, renderHook } from '@testing-library/react'
import { Suspense, startTransition } from 'react'
import {
  BTreeIndex,
  DbClient,
  collectionOptions,
  createCollection,
} from '@tanstack/db'
import { describe, expect } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { DbProvider } from '../src/DbProvider'
import {
  checkWindowObservation,
  checkWindowState,
  windowRows,
} from '../../db/tests/conformance/window-history-oracle'
import { ScenarioLifetime } from '../../db/tests/conformance/scenario-lifetime'
import { oracleProperty } from '../../db/tests/oracle-config'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import {
  clientWindowArbitrary,
  clientWindowExamples as examples,
  clientWindowStates as states,
} from '../../db/tests/conformance/client-window-history-oracle'
import type { ReactNode } from 'react'
import type { InitialQueryBuilder } from '@tanstack/db'
import type { WindowRow } from '../../db/tests/conformance/window-history-oracle'
import type { ClientWindowHistory as History } from '../../db/tests/conformance/client-window-history-oracle'
// An abandoned render cannot change the committed page's transported view.
// These host cuts supplement the shared settled-page states: local rows remain
// held, so a wrong page hash cannot hide behind an already-ready Collection.
const reactStates = [...states, `suspended seed`, `cancelled seed`] as const
type ClientMode = `provider` | `explicit`
type Move = `offset` | `limit` | `both`
async function checkClientWindowHistory(
  history: History,
  keyed: boolean,
  suspense: boolean,
  clientMode: ClientMode,
  move: Move,
  reach: {
    reach: (state: (typeof reactStates)[number]) => void
  },
) {
  const lifetime = new ScenarioLifetime()
  const unmounts: Array<() => void> = []
  lifetime.defer(() => unmounts.forEach((unmount) => unmount()))
  const server = new DbClient()
  const browser = new DbClient()
  lifetime.defer(() => server.cleanup())
  lifetime.defer(() => browser.cleanup())
  await lifetime.run(async () => {
    const serverRows: Array<WindowRow> = Array.from(
      { length: history.count },
      (_, id) => ({ id: `s${id}`, rank: id }),
    )
    const browserRows = serverRows.map((row) => ({
      ...row,
      id: `b${row.rank}`,
    }))
    let ready: (() => void) | undefined
    const descriptor = collectionOptions(`client-window-source`, (owner) => ({
      getKey: (row: WindowRow) => row.id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const value of owner === server ? serverRows : browserRows)
            write({ type: `insert`, value: { ...value } })
          commit()
          if (owner === server) markReady()
          else ready = markReady
        },
      },
    }))
    const first = { offset: history.offset, limit: history.width }
    const next = { offset: first.offset + history.jump, limit: first.limit + 1 }
    const abandoned = {
      offset: move === `limit` ? first.offset : next.offset,
      limit: move === `offset` ? first.limit : next.limit,
    }
    const build = (q: InitialQueryBuilder, page: typeof first) =>
      q
        .from({ row: descriptor })
        .orderBy(({ row }) => row.rank)
        .limit(page.limit)
        .offset(page.offset)
        .select(({ row }) => ({ id: row.id, rank: row.rank }))
    const config = (page: typeof first) => ({
      query: (q: InitialQueryBuilder) => build(q, page),
      ...(keyed
        ? { queryKey: [`client-window`, page.offset, page.limit] }
        : {}),
    })
    const hookConfig = (page: typeof first) => ({
      ...config(page),
      ...(clientMode === `explicit` ? { client: browser } : {}),
    })
    for (const page of [first, next, abandoned])
      await server.preloadLiveQuery(config(page))
    const transport = JSON.parse(JSON.stringify(server.dehydrate()))
    browser.hydrate(transport)
    const expected = (rows: Array<WindowRow>, page: typeof first) =>
      windowRows(
        rows,
        { ...page, minimum: -1, descending: false, nestedLimit: rows.length },
        false,
      )
    let firstRender:
      | {
          data: unknown
          collection: unknown
        }
      | undefined
    const never = new Promise<void>(() => {})
    let suspended = 0
    const usePage = suspense ? useLiveSuspenseQuery : useLiveQuery
    const hook = renderHook(
      ({ page, suspend }) => {
        const result = usePage(hookConfig(page))
        firstRender ??= result
        if (suspend) {
          suspended++
          throw never
        }
        return result
      },
      {
        initialProps: { page: first, suspend: false },
        wrapper: ({ children }: { children: ReactNode }) => {
          const boundary = <Suspense fallback={null}>{children}</Suspense>
          return clientMode === `provider` ? (
            <DbProvider client={browser}>{boundary}</DbProvider>
          ) : (
            boundary
          )
        },
      },
    )
    unmounts.push(() => hook.unmount())
    oracleAssertion('checkWindowObservation', () =>
      checkWindowObservation(
        { rows: firstRender?.data, collection: firstRender?.collection },
        { rows: expected(serverRows, first), retain: true },
        `first preloaded page render`,
      ),
    )
    reach.reach(`first seed`)
    const collection = hook.result.current.collection
    const compare = (
      rows: Array<WindowRow>,
      page: typeof first,
      checkpoint: string,
      retain = true,
    ) => {
      oracleAssertion('checkWindowObservation', () =>
        checkWindowObservation(
          {
            rows: hook.result.current.data,
            collection: hook.result.current.collection,
          },
          {
            rows: expected(rows, page),
            previousCollection: collection,
            retain,
          },
          checkpoint,
        ),
      )
      oracleAssertion('checkWindowState', () =>
        checkWindowState(
          hook.result.current.state,
          expected(rows, page),
          checkpoint,
        ),
      )
    }
    const peer = renderHook(() => usePage(hookConfig(first)), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <DbProvider client={browser}>{children}</DbProvider>
      ),
    })
    unmounts.push(() => peer.unmount())
    // A correct data array cannot establish that the peer's keyed view stayed
    // on the same transported page. Judge both at every existing peer cut.
    const comparePeer = (rows: Array<WindowRow>, cut: string) => {
      oracleAssertion('checkWindowObservation', () =>
        checkWindowObservation(
          {
            rows: peer.result.current.data,
            collection: peer.result.current.collection,
          },
          {
            rows: expected(rows, first),
            previousCollection: collection,
            retain: false,
          },
          cut,
        ),
      )
      oracleAssertion('checkWindowState', () =>
        checkWindowState(peer.result.current.state, expected(rows, first), cut),
      )
    }
    comparePeer(serverRows, `peer before move`)
    await act(() =>
      startTransition(() => hook.rerender({ page: abandoned, suspend: true })),
    )
    oracleAssertion(
      'expect(suspended, `React attempted the abandoned page`).toBeGreaterThan(0)',
      () =>
        expect(suspended, `React attempted the abandoned page`).toBeGreaterThan(
          0,
        ),
    )
    compare(serverRows, first, `committed seed during suspended page`)
    reach.reach(`suspended seed`)
    await act(() => hook.rerender({ page: first, suspend: false }))
    compare(serverRows, first, `matching seed after cancelled page`)
    reach.reach(`cancelled seed`)
    // Both hook kinds own independent Collections. Moving one hook leaves
    // the other hook on its original page.
    await act(() => {
      hook.rerender({ page: next, suspend: false })
    })
    compare(
      serverRows,
      next,
      `moved preloaded page before local readiness`,
      true,
    )
    reach.reach(`moved seed`)
    comparePeer(serverRows, `peer while local readiness is held`)
    reach.reach(`held peer keyed state`)
    for (let index = 0; index < history.latePeers; index++) {
      const late = renderHook(() => usePage(hookConfig(first)), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <DbProvider client={browser}>{children}</DbProvider>
        ),
      })
      unmounts.push(() => late.unmount())
      oracleAssertion('checkWindowObservation', () =>
        checkWindowObservation(
          {
            rows: late.result.current.data,
            collection: late.result.current.collection,
          },
          {
            rows: expected(serverRows, first),
            previousCollection: collection,
            retain: false,
          },
          `fresh old-page lookup after move before local readiness`,
        ),
      )
      oracleAssertion('checkWindowState', () =>
        checkWindowState(
          late.result.current.state,
          expected(serverRows, first),
          `fresh old-page keyed view`,
        ),
      )
      oracleAssertion('expect(late.result.current.collection).not.toBe(', () =>
        expect(late.result.current.collection).not.toBe(
          peer.result.current.collection,
        ),
      )
    }
    reach.reach(`fresh old-page lookup`)
    oracleAssertion(
      'expect(ready, `browser sync started at commit`).toBeDefined()',
      () => expect(ready, `browser sync started at commit`).toBeDefined(),
    )
    await act(() => {
      ready!()
    })
    compare(browserRows, next, `local handoff`)
    reach.reach(`local handoff`)
    comparePeer(browserRows, `peer after handoff`)
    reach.reach(`peer isolation`)
    reach.reach(`local peer keyed state`)
    await act(() => {
      hook.rerender({ page: first, suspend: false })
    })
    compare(browserRows, first, `return to first page`)
    reach.reach(`returned page`)
    // Ordinary moves do not rewrite the server's immutable page records.
    oracleAssertion(
      'expect(JSON.parse(JSON.stringify(server.dehydrate()))).toEqual(transport)',
      () =>
        expect(JSON.parse(JSON.stringify(server.dehydrate()))).toEqual(
          transport,
        ),
    )
  })
}
// An explicit client switch must replace the binding even when both clients read
// exactly the same concrete source object and authored query identity.
async function checkClientSwitch(
  history: History,
  keyed: boolean,
  suspense: boolean,
  reach: {
    reach: (state: (typeof reactStates)[number]) => void
  },
) {
  const lifetime = new ScenarioLifetime()
  let unmount: (() => void) | undefined
  lifetime.defer(() => unmount?.())
  await lifetime.run(async () => {
    const source = createCollection({
      getKey: (row: WindowRow) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (let rank = 0; rank < history.count; rank++)
            write({ type: `insert`, value: { id: String(rank), rank } })
          commit()
          markReady()
        },
      },
    })
    lifetime.defer(() => source.cleanup({ dependents: true }))
    const first = new DbClient()
    const second = new DbClient()
    lifetime.defer(() => first.cleanup())
    lifetime.defer(() => second.cleanup())
    const usePage = suspense ? useLiveSuspenseQuery : useLiveQuery
    const hook = renderHook(
      ({ client, offset }) =>
        usePage({
          ...(keyed ? { queryKey: [`scope-switch`, offset] } : {}),
          client,
          query: (q) =>
            q
              .from({ row: source })
              .orderBy(({ row }) => row.rank)
              .limit(history.width)
              .offset(offset)
              .select(({ row }) => ({ id: row.id, rank: row.rank })),
        }),
      { initialProps: { client: first, offset: history.offset } },
    )
    unmount = () => hook.unmount()
    for (const [client, offset] of [
      [second, history.offset],
      [first, history.offset + history.jump],
    ] as const) {
      const previous = hook.result.current.collection
      await act(() => {
        hook.rerender({ client, offset })
      })
      oracleAssertion('checkWindowObservation', () =>
        checkWindowObservation(
          {
            rows: hook.result.current.data,
            collection: hook.result.current.collection,
          },
          {
            rows: windowRows(
              Array.from({ length: history.count }, (_, rank) => ({
                id: String(rank),
                rank,
              })),
              {
                offset: offset,
                limit: history.width,
                minimum: -1,
                descending: false,
                nestedLimit: history.count,
              },
              false,
            ),
            previousCollection: previous,
            retain: false,
          },
          `client scope switch`,
        ),
      )
    }
    reach.reach(`client scope switch`)
  })
}
describe(`client page identity`, () => {
  for (const keyed of [false, true])
    for (const suspense of [false, true])
      for (const clientMode of [`provider`, `explicit`] as const)
        for (const move of [`offset`, `limit`, `both`] as const)
          describe(`${keyed ? `keyed` : `derived`}/${suspense ? `suspense` : `ordinary`}/${clientMode}/${move}`, () => {
            oracleProperty({
              id: `react.client-window`,
              law: {
                statement: `Client-backed windows retain independent committed pages and transported views; an abandoned move cannot replace the committed seed.`,
                authority: `packages/db/tests/conformance/window-history-oracle.ts and client-window-history-oracle.ts; SSR guide preload/hydration identity law and maintainer independent-output decision 2026-11-03.`,
                limits: `The unchanged provider/explicit, ordinary/Suspense, derived/keyed and offset/limit/both paths; controlled source readiness and finite native schedules, no Electric SDK or arbitrary concurrent scheduler claim.`,
              },
              owns: [
                `src/DbProvider.tsx#DbProvider`,
                `src/useLiveQuery.ts#useLiveQuery`,
                `src/useLiveSuspenseQuery.ts#useLiveSuspenseQuery`,
              ],
              histories: {
                arbitrary: clientWindowArbitrary,
                runs: 6,
                fixedSeeds: [2345],
                states: reactStates,
                constructed: [
                  {
                    name: `complete held and live page history`,
                    enters: reactStates,
                    build: (history) => ({ ...history }),
                  },
                ],
                fixed: examples.map(([history], index) => ({
                  name: `client page ${index}`,
                  history,
                })),
              },
              resolve: (history) => ({ history }),
              model: recordedAssertionJudgment,
              driver: (plan, observe) =>
                recordAssertionJudgment(
                  `client page identity`,
                  plan,
                  observe,
                  async () => {
                    const reach = {
                      reach: (state: (typeof reactStates)[number]) =>
                        observe(`reach`, state),
                    }
                    await checkClientWindowHistory(
                      plan.history,
                      keyed,
                      suspense,
                      clientMode,
                      move,
                      reach,
                    )
                    await checkClientSwitch(
                      plan.history,
                      keyed,
                      suspense,
                      reach,
                    )
                  },
                ),
              check: forwardAssertionJudgment,
            })
          })
})
