/**
 * Reusable local declarations must be checked at every public admission path,
 * before a result is returned and before a rejected caller retains resources.
 * The shared declaration model judges two attempts, then a compatible original
 * caller and a later source update. Transport replacement must preserve local
 * claims. It cannot serialize or invent server function references.
 *
 * The finite grammar crosses independent reference/presence pairs, query keys,
 * held/settled first delivery, first registration by explicit preload, observer
 * preload or server read, and preload, observer preload, subscribe, SSR read,
 * and hydration replacement. The held driver withholds writes, not just a
 * returned Promise; request start and unresolved preload are checked explicitly.
 * Public admission, dehydration rows, observer delivery, and subscriber ownership
 * are the observation cuts. React supplies client/server receiving paths using
 * the same judgment. Failure/consumption retirement is a separate lifecycle lane.
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
  checkCacheOptionAdmission,
  checkCacheOptionPromise,
  checkCacheOptionPublications,
  checkCacheOptionRows,
  conflictingCacheOptions,
} from './live-query-cache-options-oracle'
import type { CacheRow } from './live-query-cache-options-oracle'

const claimants = [`preload`, `observer-preload`, `server-read`] as const
const paths = [
  `preload`,
  `observer-preload`,
  `subscribe`,
  `server-read`,
  `hydrate-preload`,
] as const
const reaches = Object.fromEntries(
  claimants.flatMap((claimant) =>
    paths.map((path) => [
      `${claimant}/${path}`,
      createOracleReach(`cache options ${claimant}/${path}`, [
        `first-registration`,
        `admission`,
        `retry`,
        `original-reuse`,
        `source-update`,
        `held-delivery`,
        ...cacheOptionReachStates,
      ]),
    ]),
  ),
)
const executedRoutes = new Set<string>()
afterAll(() => {
  // A calibration-only selector runs no history grammar. Every selected route
  // still owes all of its declared states, including those it failed to reach.
  for (const [route, reach] of Object.entries(reaches))
    if (executedRoutes.has(route)) reach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `cache option reach`,
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
    checkCacheOptionAdmission,
    checkCacheOptionPromise,
    checkCacheOptionRows,
    checkCacheOptionPublications,
  ],
  model: [conflictingCacheOptions],
  grammar: [cacheOptionHistories],
})

test.each(
  cacheOptionHistories.flatMap((history) =>
    [false, true].flatMap((held) =>
      claimants.flatMap((claimant) =>
        paths.map((path) => ({ history, held, path, claimant })),
      ),
    ),
  ),
)(`cache admission history %j`, async ({ history, held, path, claimant }) => {
  const route = `${claimant}/${path}`
  executedRoutes.add(route)
  const reach = reaches[route]!
  reach.beginHistory()
  const client = new DbClient()
  let starts = 0
  let delivered = false
  let publish: ((rows: Array<CacheRow>) => void) | undefined
  let deliver = () => {}
  const initialRows = [
    { id: `one`, label: `before` },
    { id: `two`, label: `peer` },
  ]
  const source = client.collection(
    collectionOptions(`cache-option-source`, () => ({
      getKey: (row: CacheRow) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          starts++
          publish = (rows) => {
            begin()
            for (const value of rows)
              write({
                type: source.has(value.id) ? `update` : `insert`,
                value: { ...value },
              })
            commit()
          }
          deliver = () => {
            if (delivered) return
            delivered = true
            publish!(initialRows)
            markReady()
          }
          if (!held) deliver()
        },
      },
    })),
  )
  const query = new Query().from({ row: source })
  const [firstOptions, secondOptions] = cacheOptionDeclarations(history)
  // Schema refs test the JavaScript configuration boundary. Public schema
  // declarations are checked separately; this identity schema claims no transform.
  const first = {
    query,
    getKey: firstOptions!.getKey,
    queryKey: firstOptions!.queryKey,
  }
  const second = {
    query,
    getKey: secondOptions!.getKey,
    queryKey: secondOptions!.queryKey,
  }
  Object.assign(first, { schema: firstOptions!.schema })
  Object.assign(second, { schema: secondOptions!.schema })

  const views: Array<NonNullable<ReturnType<typeof resolveLiveQueryValue>>> = []
  const observers: Array<ReturnType<typeof createLiveQueryObserver>> = []
  const subscriptions: Array<() => void> = []
  const pending: Array<Promise<void>> = []
  const accepted: Array<Promise<void>> = []
  const track = (promise: Promise<void>, compatible = true) => {
    pending.push(promise)
    if (compatible) accepted.push(promise)
    void promise.catch(() => {})
    return promise
  }
  const stream = () =>
    client
      .dehydrate({ shouldDehydrateLiveQuery: () => true })
      .liveQueries!.find(
        (entry) => entry.queryHash === getLiveQueryHash(first, first.queryKey),
      )!
  await withOracleCleanup(async () => {
    expect(
      client.dehydrate().liveQueries ?? [],
      `no prior query result`,
    ).toEqual([])
    let settled = false
    let initial: Promise<void>
    if (claimant === `preload`) initial = track(client.preloadLiveQuery(first))
    else {
      // Source-only preload supplies SSR's permitted local rows/readiness,
      // without registering a reusable live-query result. No transport seed
      // or explicit query preload is allowed to make the claim for this path.
      if (claimant === `server-read`) {
        const sourceLoad = track(source.preload())
        if (!held) await sourceLoad
      } else client._setSsrStreamingEnabled(true)
      const view = resolveLiveQueryValue(first)!
      views.push(view)
      const firstObserver = createLiveQueryObserver(view, {
        client,
        queryHash: getLiveQueryHash(first, first.queryKey),
      })
      observers.push(firstObserver)
      if (claimant === `server-read`) {
        vi.stubGlobal(`window`, undefined)
        const snapshot = firstObserver.getServerSnapshot()
        checkCacheOptionRows(
          Array.from(snapshot.state ?? [], ([key, value]) => ({ key, value })),
          held ? [] : initialRows,
          history.getKey[0],
        )
        vi.unstubAllGlobals()
        initial = track(view.preload())
      } else initial = track(firstObserver.preload())
    }
    expect(
      stream(),
      `first caller registered without borrowed transport`,
    ).toBeDefined()
    reach.reach(`first-registration`)
    void initial.then(() => {
      settled = true
    })
    expect(starts).toBe(1)
    if (held) {
      await Promise.resolve()
      expect(delivered).toBe(false)
      expect(settled).toBe(false)
      reach.reach(`held-delivery`)
    } else await initial
    if (path === `hydrate-preload`) {
      const prior = stream()
      client.hydrate({
        collections: [],
        liveQueries: [{ ...prior, dehydratedAt: prior.dehydratedAt + 1 }],
      })
      expect(stream().dehydratedAt).toBe(prior.dehydratedAt + 1)
    }
    const subscriberCount = source.subscriberCount
    let observer: ReturnType<typeof createLiveQueryObserver> | undefined
    if (path !== `preload` && path !== `hydrate-preload`) {
      const view = resolveLiveQueryValue(second)!
      views.push(view)
      observer = createLiveQueryObserver(view, {
        client,
        queryHash: getLiveQueryHash(second, second.queryKey),
      })
      observers.push(observer)
    }
    let rejectedCallbacks = 0
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const state of cacheOptionReach(history)) reach.reach(state)
      if (path === `observer-preload`) {
        const result = track(
          observer!.preload(),
          !conflictingCacheOptions(history),
        )
        if (conflictingCacheOptions(history))
          await checkCacheOptionPromise(result, history, { deliveryHeld: held })
      } else {
        checkCacheOptionAdmission(() => {
          if (path === `preload` || path === `hydrate-preload`)
            track(client.preloadLiveQuery(second))
          else if (path === `subscribe`)
            subscriptions.push(
              observer!.subscribe(() => {
                if (conflictingCacheOptions(history)) rejectedCallbacks++
              }),
            )
          else {
            vi.stubGlobal(`window`, undefined)
            const snapshot = observer!.getServerSnapshot()
            // SSR captures its initial view. Held writes are absent at this
            // read; later delivery must not rewrite the captured server view.
            if (!conflictingCacheOptions(history))
              checkCacheOptionRows(
                Array.from(snapshot.state ?? [], ([key, value]) => ({
                  key,
                  value,
                })),
                held ? [] : initialRows,
                history.getKey[1],
              )
          }
        }, history)
      }
      reach.reach(attempt === 0 ? `admission` : `retry`)
    }
    if (conflictingCacheOptions(history))
      expect(source.subscriberCount).toBe(subscriberCount)
    track(client.preloadLiveQuery(first))
    reach.reach(`original-reuse`)
    deliver()
    await initial
    for (const promise of accepted) await promise
    if (!conflictingCacheOptions(history) && path !== `server-read`) {
      if (observer) {
        await observer.preload()
        // SSR's earlier loading capture remains this observer's initial view
        // until attachment (SSR guide: Prepare every server snapshot). The row
        // comparison is a live-handoff cut, so commit that receiving demand.
        subscriptions.push(observer.subscribe(() => {}))
        await Promise.resolve() // committed hydration handoff
        checkCacheOptionRows(
          Array.from(observer.getSnapshot().state!, ([key, value]) => ({
            key,
            value,
          })),
          initialRows,
          history.getKey[1],
        )
      } else {
        const result = client
          .dehydrate()
          .liveQueries!.find(
            (entry) =>
              entry.queryHash === getLiveQueryHash(second, second.queryKey),
          )!
        checkCacheOptionRows(
          result.snapshot!.rows,
          initialRows,
          history.getKey[1],
        )
      }
    }
    // A compatible observer reads the original declaration after rejection.
    // Compare its next public delivery as well as a later synchronous read.
    vi.unstubAllGlobals()
    const originalView = resolveLiveQueryValue(first)!
    views.push(originalView)
    const originalObserver = createLiveQueryObserver(originalView, {
      client,
      queryHash: getLiveQueryHash(first, first.queryKey),
    })
    observers.push(originalObserver)
    const deliveries: Array<Array<{ key: unknown; value: unknown }>> = []
    subscriptions.push(
      originalObserver.subscribe(() => {
        deliveries.push(
          Array.from(originalObserver.getSnapshot().state!, ([key, value]) => ({
            key,
            value,
          })),
        )
      }),
    )
    await originalObserver.preload()
    checkCacheOptionRows(
      Array.from(originalObserver.getSnapshot().state!, ([key, value]) => ({
        key,
        value,
      })),
      initialRows,
      history.getKey[0],
    )
    const updated = [{ id: `one`, label: `after` }, initialRows[1]!]
    deliveries.length = 0
    publish!(updated)
    const snapshot = originalObserver.getSnapshot()
    checkCacheOptionRows(
      Array.from(snapshot.state!, ([key, value]) => ({ key, value })),
      updated,
      history.getKey[0],
    )
    checkCacheOptionPublications(deliveries, updated, history.getKey[0])
    expect(rejectedCallbacks, `refused listeners receive no publication`).toBe(
      0,
    )
    reach.reach(`source-update`)
  }, [
    () => {
      vi.unstubAllGlobals()
      deliver()
    },
    () => Promise.allSettled(pending),
    () =>
      withOracleCleanup(() => {}, [
        ...subscriptions.map((unsubscribe) => () => unsubscribe()),
        ...observers.map((observer) => () => observer.dispose()),
        ...views.map((view) => () => view.cleanup({ dependents: true })),
        () => client.cleanup(),
      ]),
  ])
})

// Deliberately wrong observations use the same judgment as every driver. The
// all-options-differ policy and claim-overwrite policy would accept these
// conflicts; checking both attempts is what distinguishes claim corruption.
test.each(
  cacheOptionHistories.filter((history) => conflictingCacheOptions(history)),
)(`cache admission rejects hostile acceptance %j`, (history) => {
  for (let attempt = 0; attempt < 2; attempt++)
    expect(() => checkCacheOptionAdmission(() => {}, history)).toThrow()
})
test.each([`first`, `other`] as const)(
  `cache rows reject hostile keys and leading publication for %s`,
  (key) => {
    const rows = [{ id: `one`, label: `authored` }]
    const correct = [{ key: `${key}-one`, value: rows[0] }]
    const wrong = [{ key: `borrowed`, value: rows[0] }]
    checkCacheOptionRows(correct, rows, key)
    expect(() => checkCacheOptionRows(wrong, rows, key)).toThrow()
    expect(() =>
      checkCacheOptionPublications([wrong, correct], rows, key),
    ).toThrow()
  },
)

// Admission calibration includes a promise that never settles. The check must
// reject it at the pre-delivery cut, allowing its driver's cleanup to proceed.
test.each([`pending`, `fulfilled`, `unrelated-error`, `conflict`] as const)(
  `rejects wrong pre-delivery admission outcome: %s`,
  async (outcome) => {
    const history = cacheOptionHistories.find(conflictingCacheOptions)!
    const result =
      outcome === `pending`
        ? new Promise<void>(() => {})
        : outcome === `fulfilled`
          ? Promise.resolve()
          : Promise.reject(
              new Error(
                outcome === `conflict`
                  ? `getKey/schema conflict`
                  : `unrelated failure`,
              ),
            )
    const check = checkCacheOptionPromise(result, history, {
      deliveryHeld: true,
    })
    if (outcome === `conflict`) await check
    else await expect(check).rejects.toThrow()
  },
)
