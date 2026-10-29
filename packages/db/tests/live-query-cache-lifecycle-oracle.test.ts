/**
 * Local row-option claims live exactly as long as their reusable result.
 * Authority: the maintainer's cache-conflict decision and the source-claim
 * lifecycle documented by db-client-preload-identity.test.ts. Portable hydration
 * carries data, not server function references. The first local admission owns
 * those references; newer data preserves them, failure/consumption retires them.
 *
 * The model retains only whether the original local claim still applies. Each
 * finite history claims a real JSON-round-tripped server result through preload,
 * observer preload or a server read, then keeps/replaces/fails/consumes it before
 * the next declaration. Hydration can be pending or settled. Rejection and exact
 * local keys/ordinary values after live handoff are public comparison cuts.
 * No arbitrary transport serializer, hydrateRoot, or schema transform is claimed.
 */
import { afterAll, expect, test, vi } from 'vitest'
import {
  DbClient,
  Query,
  collectionOptions,
  createLiveQueryObserver,
  getLiveQueryHash,
  resolveLiveQueryValue,
} from '../src'
import { declareOracle } from './oracle-declaration'
import { createOracleReach } from './oracle-reach'
import { withOracleCleanup } from './utils'
import {
  cacheOptionDeclarations,
  cacheOptionHistories,
  cacheOptionReach,
  cacheOptionReachStates,
  checkCacheOptionRows,
  conflictingCacheOptions,
} from './live-query-cache-options-oracle'
import type {
  CacheOptionHistory,
  CacheRow,
} from './live-query-cache-options-oracle'
import type { DehydratedLiveQueryResult } from '../src/client'

type Phase = `active` | `replaced` | `failed` | `consumed`
// A portable result has no local claim. Admission claims it, transport updates
// do not end reuse, and terminal failure or live consumption ends reuse.
function claimSurvives(phase: Phase): boolean {
  return phase === `active` || phase === `replaced`
}
function checkLifecycleAdmission(
  action: () => unknown,
  history: CacheOptionHistory,
  phase: Phase,
) {
  if (claimSurvives(phase) && conflictingCacheOptions(history))
    expect(action, `active local claim survives ${phase}`).toThrow(
      /getKey|schema/,
    )
  else expect(action, `retired or compatible claim at ${phase}`).not.toThrow()
}
// Raw transport is checked before JSON can silently erase a leaked function.
function checkPortableCacheState(
  value: unknown,
  seen = new Set<unknown>(),
): void {
  expect(typeof value, `portable hydration has no function reference`).not.toBe(
    `function`,
  )
  if (!value || typeof value !== `object` || seen.has(value)) return
  seen.add(value)
  for (const child of Object.values(value)) checkPortableCacheState(child, seen)
}
const claimants = [`preload`, `observer-preload`, `server-read`] as const
const phases: ReadonlyArray<Phase> = [
  `active`,
  `replaced`,
  `failed`,
  `consumed`,
]
const reaches = Object.fromEntries(
  claimants.map((claimant) => [
    claimant,
    createOracleReach(`cache claim lifecycle ${claimant}`, [
      `portable`,
      `pending`,
      `claimed`,
      `pending-conflict`,
      `pending-compatible`,
      `replaced-while-pending`,
      `obsolete-transport-settled`,
      `replaced-pending-conflict`,
      `replaced-pending-compatible`,
      `failed-while-pending`,
      `failed-pending-conflict`,
      `failed-pending-compatible`,
      ...phases.flatMap((phase) => [
        `${phase}-conflict`,
        `${phase}-compatible`,
      ]),
      ...phases,
      ...cacheOptionReachStates.filter((state) => state !== `distinct-key`),
    ]),
  ]),
)
afterAll(() => {
  for (const reach of Object.values(reaches)) reach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `cache lifecycle reach`,
      Object.fromEntries(
        Object.entries(reaches).map(([path, reach]) => [
          path,
          Object.fromEntries(reach.counts()),
        ]),
      ),
    )
})
declareOracle({
  check: [
    checkLifecycleAdmission,
    checkCacheOptionRows,
    checkPortableCacheState,
  ],
  model: [claimSurvives, conflictingCacheOptions],
  grammar: [cacheOptionHistories],
})

test.each(
  cacheOptionHistories
    .filter((history) => !history.distinctKey)
    .flatMap((history) =>
      claimants.flatMap((claimant) =>
        phases.flatMap((phase) =>
          [false, true].flatMap((pending) =>
            ((phase === `replaced` || phase === `failed`) && pending
              ? [false, true]
              : [false]
            ).map((replaceBeforeRelease) => ({
              history,
              claimant,
              phase,
              pending,
              replaceBeforeRelease,
            })),
          ),
        ),
      ),
    ),
)(
  `cache claim lifetime %j`,
  async ({ history, claimant, phase, pending, replaceBeforeRelease }) => {
    const reach = reaches[claimant]!
    reach.beginHistory()
    const server = new DbClient()
    const browser = new DbClient()
    const rows: Array<CacheRow> = [
      { id: `one`, label: `authored` },
      { id: `two`, label: `peer` },
    ]
    const descriptor = collectionOptions(`portable-cache-source`, () => ({
      getKey: (row: CacheRow) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const value of rows)
            write({ type: `insert`, value: { ...value } })
          commit()
          markReady()
        },
      },
    }))
    const serverSource = server.collection(descriptor)
    const source = browser.collection(descriptor)
    const query = new Query().from({ row: source })
    const [a, b] = cacheOptionDeclarations(history)
    const first = { query, getKey: a!.getKey, queryKey: a!.queryKey }
    const second = { query, getKey: b!.getKey, queryKey: b!.queryKey }
    Object.assign(first, { schema: a!.schema })
    Object.assign(second, { schema: b!.schema })
    const queryHash = getLiveQueryHash(first, first.queryKey)
    const views: Array<NonNullable<ReturnType<typeof resolveLiveQueryValue>>> =
      []
    const observers: Array<ReturnType<typeof createLiveQueryObserver>> = []
    const releases: Array<() => void> = []
    const promises: Array<Promise<unknown>> = []
    let releaseTransport: (() => void) | undefined
    let rejectTransport: ((error: Error) => void) | undefined
    const observerFor = (config: typeof first) => {
      const view = resolveLiveQueryValue(config)!
      views.push(view)
      const observer = createLiveQueryObserver(view, {
        client: browser,
        queryHash,
      })
      observers.push(observer)
      return observer
    }
    await withOracleCleanup(async () => {
      const serverConfig = {
        query: new Query().from({ row: serverSource }),
        queryKey: first.queryKey,
        getKey:
          history.getKey[0] === `absent`
            ? undefined
            : (row: CacheRow) => `${history.getKey[0]}-${row.id}`,
      }
      if (history.schema[0] !== `absent`)
        Object.assign(serverConfig, {
          schema: {
            '~standard': {
              version: 1,
              vendor: `server-cache-schema`,
              validate: (value: unknown) => ({ value }),
            },
          },
        })
      await server.preloadLiveQuery(serverConfig)
      const raw = server.dehydrate()
      checkPortableCacheState(raw)
      const portable = JSON.parse(JSON.stringify(raw)) as ReturnType<
        DbClient[`dehydrate`]
      >
      const record = portable.liveQueries![0]!
      expect(record.queryHash).toBe(queryHash)
      const snapshot = record.snapshot!
      const result = new Promise<DehydratedLiveQueryResult>(
        (resolve, reject) => {
          releaseTransport = () => resolve(snapshot)
          rejectTransport = reject
        },
      )
      void result.catch(() => {})
      const pendingReuses: Array<Promise<void>> = []
      const acceptedCandidates: Array<Promise<void>> = []
      browser.hydrate({
        ...portable,
        liveQueries: [
          {
            ...record,
            ...(pending ? { snapshot: undefined, promise: result } : {}),
          },
        ],
      })
      reach.reach(`portable`)
      if (pending) reach.reach(`pending`)
      let claim: Promise<void> | undefined
      if (claimant === `preload`) claim = browser.preloadLiveQuery(first)
      else {
        const observer = observerFor(first)
        if (claimant === `observer-preload`) claim = observer.preload()
        else {
          // Server reads can return a loading snapshot before the transport settles.
          vi.stubGlobal(`window`, undefined)
          observer.getServerSnapshot()
          vi.unstubAllGlobals()
        }
      }
      if (claim) {
        promises.push(claim)
        void claim.catch(() => {})
      }
      if (pending) {
        expect(
          browser.dehydrate({ shouldDehydrateLiveQuery: () => true })
            .liveQueries?.[0]?.promise,
        ).toBeInstanceOf(Promise)
        reach.reach(
          conflictingCacheOptions(history)
            ? `pending-conflict`
            : `pending-compatible`,
        )
        for (let attempt = 0; attempt < 2; attempt++) {
          let candidateSettled = false
          checkLifecycleAdmission(
            () => {
              const candidate = browser.preloadLiveQuery(second)
              promises.push(candidate)
              pendingReuses.push(candidate)
              void candidate.then(
                () => {
                  candidateSettled = true
                },
                () => {
                  candidateSettled = true
                },
              )
            },
            history,
            `active`,
          )
          if (!conflictingCacheOptions(history)) {
            await Promise.resolve()
            expect(
              candidateSettled,
              `compatible pending reuse still awaits transport`,
            ).toBe(false)
          }
        }
      }
      const newerAt =
        browser.dehydrate({ shouldDehydrateLiveQuery: () => true })
          .liveQueries![0]!.dehydratedAt + 1
      const newerSnapshot: DehydratedLiveQueryResult = {
        ...snapshot,
        rows: snapshot.rows.map((entry) => ({
          ...entry,
          value: {
            ...(entry.value as CacheRow),
            label: `newer-${(entry.value as CacheRow).id}`,
          },
        })),
      }
      const replace = () => {
        browser.hydrate({
          collections: [],
          liveQueries: [
            { ...record, snapshot: newerSnapshot, dehydratedAt: newerAt },
          ],
        })
        expect(browser.dehydrate().liveQueries?.[0]?.dehydratedAt).toBe(newerAt)
        expect(browser.dehydrate().liveQueries?.[0]?.snapshot?.rows).toEqual(
          newerSnapshot.rows,
        )
      }
      if (replaceBeforeRelease && phase === `replaced`) {
        replace()
        reach.reach(`replaced-while-pending`)
        reach.reach(
          conflictingCacheOptions(history)
            ? `replaced-pending-conflict`
            : `replaced-pending-compatible`,
        )
        for (let attempt = 0; attempt < 2; attempt++)
          checkLifecycleAdmission(
            () => {
              const candidate = browser.preloadLiveQuery(second)
              promises.push(candidate)
              void candidate.catch(() => {})
            },
            history,
            `replaced`,
          )
      }
      if (replaceBeforeRelease && phase === `failed`) {
        const error = new Error(`initial transport failed`)
        rejectTransport!(error)
        if (claim) await expect(claim).rejects.toBe(error)
        await expect(result).rejects.toBe(error)
        for (const reuse of pendingReuses)
          await expect(reuse).rejects.toBe(error)
        expect(browser.dehydrate().liveQueries).toBeUndefined()
        reach.reach(`failed-while-pending`)
        reach.reach(
          conflictingCacheOptions(history)
            ? `failed-pending-conflict`
            : `failed-pending-compatible`,
        )
      } else {
        releaseTransport!()
        if (claim) await claim
        await result
        // An active transported result is observable before the next local caller.
        expect(browser.dehydrate().liveQueries?.[0]?.snapshot?.rows).toEqual(
          replaceBeforeRelease && phase === `replaced`
            ? newerSnapshot.rows
            : snapshot.rows,
        )
        if (replaceBeforeRelease && phase === `replaced`)
          reach.reach(`obsolete-transport-settled`)
        reach.reach(`claimed`)
        if (phase === `replaced`) {
          if (!replaceBeforeRelease) replace()
        } else if (phase === `failed`) {
          const error = new Error(`transport failed`)
          let reject!: (error: unknown) => void
          const failure = new Promise<DehydratedLiveQueryResult>((_, fail) => {
            reject = fail
          })
          browser.hydrate({
            collections: [],
            liveQueries: [
              {
                queryHash,
                dehydratedAt: newerAt,
                promise: failure,
              },
            ],
          })
          reject(error)
          await expect(failure).rejects.toBe(error)
          // A failed result is not a reusable dehydrated success.
          expect(browser.dehydrate().liveQueries).toBeUndefined()
        } else if (phase === `consumed`) {
          const consumer = observerFor(first)
          releases.push(consumer.subscribe(() => {}))
          await consumer.preload()
          await vi.waitFor(() =>
            expect(browser.dehydrate().liveQueries).toBeUndefined(),
          )
          checkCacheOptionRows(
            Array.from(consumer.getSnapshot().state!, ([key, value]) => ({
              key,
              value,
            })),
            rows,
            history.getKey[0],
          )
        }
        await Promise.all(pendingReuses)
      }
      reach.reach(phase)
      reach.reach(
        `${phase}-${conflictingCacheOptions(history) ? `conflict` : `compatible`}`,
      )
      for (const state of cacheOptionReach(history))
        if (state !== `distinct-key`) reach.reach(state)
      for (let attempt = 0; attempt < 2; attempt++)
        checkLifecycleAdmission(
          () => {
            const next = browser.preloadLiveQuery(second)
            promises.push(next)
            acceptedCandidates.push(next)
            void next.catch(() => {})
          },
          history,
          phase,
        )
      if (!claimSurvives(phase) || !conflictingCacheOptions(history)) {
        await Promise.all(acceptedCandidates)
        const consumer = observerFor(second)
        releases.push(consumer.subscribe(() => {}))
        await consumer.preload()
        await vi.waitFor(() =>
          checkCacheOptionRows(
            Array.from(consumer.getSnapshot().state!, ([key, value]) => ({
              key,
              value,
            })),
            rows,
            history.getKey[1],
          ),
        )
      }
    }, [
      () => {
        vi.unstubAllGlobals()
        releaseTransport?.()
      },
      () => Promise.allSettled(promises),
      () =>
        withOracleCleanup(() => {}, [
          ...releases.map((release) => () => release()),
          ...observers.map((observer) => () => observer.dispose()),
          ...views.map((view) => () => view.cleanup({ dependents: true })),
          () => browser.cleanup(),
          () => server.cleanup(),
        ]),
    ])
  },
)

// Transport must not inherit a local claim merely because a serializer would
// discard it. Deliberately leaking either kind of callable fails this judgment.
test.each([`getKey`, `schema`] as const)(
  `portable cache rejects a leaked %s function`,
  (option) => {
    expect(() => checkPortableCacheState({ [option]: () => {} })).toThrow()
  },
)

// A wrong forever-claim policy rejects retired results; a no-claim policy
// accepts active conflicts. Both are judged by the same lifecycle comparison.
test.each(phases)(
  `lifecycle checker rejects the opposite claim policy at %s`,
  (phase) => {
    const history = cacheOptionHistories.find(conflictingCacheOptions)!
    const wrong = () => {
      if (!claimSurvives(phase)) throw new Error(`getKey conflict`)
    }
    expect(() => checkLifecycleAdmission(wrong, history, phase)).toThrow()
  },
)
