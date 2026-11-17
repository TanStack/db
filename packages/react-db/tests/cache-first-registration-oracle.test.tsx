/**
 * Local option claims must begin when an actual server reader first establishes
 * a reusable result, without explicit query preload or transported hydration.
 * Authority: the shared cache-declaration law and SSR guide's rendered-view law.
 * An ordinary server hook captures its loading/ready view. A streaming Suspense
 * hook registers its preload while its source is still held. Independent callers
 * owe the same admission rule in both cases; readiness cannot defer rejection.
 *
 * Histories cross the shared independent declarations, first ordinary/Suspense
 * reader, held/ready source delivery and second preload/server-render admission.
 * After two attempts, original reuse and a public observer receive complete
 * rows and a later source update. React supplies the server host; the core observer supplies the later read;
 * source delivery and streaming enablement are controlled. No Router transport,
 * hydration serialization, deployed server, or other framework is claimed.
 */
import { Writable } from 'node:stream'
import {
  DbClient,
  Query,
  collectionOptions,
  createLiveQueryObserver,
  getLiveQueryHash,
  resolveLiveQueryValue,
} from '@tanstack/db'
import { Suspense } from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { expect, vi } from 'vitest'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import {
  cacheOptionDeclarations,
  cacheOptionHistories,
  checkCacheOptionAdmission,
  checkCacheOptionPromise,
  checkCacheOptionRows,
  conflictingCacheOptions,
} from '../../db/tests/live-query-cache-options-oracle'
import { oracleProperty } from '../../db/tests/oracle-config'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { withOracleCleanup } from '../../db/tests/utils'
import type { CacheRow } from '../../db/tests/live-query-cache-options-oracle'

const firstReaders = [`ordinary`, `suspense`] as const
const secondReaders = [`preload`, `server-render`] as const
const histories = cacheOptionHistories.flatMap((history) =>
  firstReaders.flatMap((firstReader) =>
    secondReaders.flatMap((secondReader) =>
      [false, true].map((held) => ({
        history,
        firstReader,
        secondReader,
        held,
      })),
    ),
  ),
)
type RegistrationHistory = (typeof histories)[number]
// This is the complete existing independent assertion helper. The native
// adapter forwards its judgment without replacing admission or row comparisons.
async function checkFirstRegistrationHistory(
  { history, firstReader, secondReader, held }: RegistrationHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const requiredStates = [
    `first-registration`,
    `admission`,
    `retry`,
    `original-reuse`,
    `live-observer`,
    `source-update`,
    ...(held ? [`held-delivery`] : []),
  ]
  const reached = new Set<string>()
  const markReach = (state: string) => {
    oracleAssertion(`known registration state`, () =>
      oracleAssertion('expect(requiredStates).toContain(state)', () =>
        expect(requiredStates).toContain(state),
      ),
    )
    reached.add(state)
    observe(`reach`, state)
  }
  const client = new DbClient({ runtime: `server` })
  const rows = [
    { id: `one`, label: `before` },
    { id: `two`, label: `peer` },
  ]
  let starts = 0
  let delivered = false
  let publish: (rows: Array<CacheRow>) => void = () => {
    throw new Error(`source not started`)
  }
  let deliver = () => {}
  const source = client.collection(
    collectionOptions(`react-first-registration`, () => ({
      getKey: (row: CacheRow) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          starts++
          publish = (values) => {
            begin()
            for (const value of values)
              write({
                type: source.has(value.id) ? `update` : `insert`,
                value: { ...value },
              })
            commit()
          }
          deliver = () => {
            if (delivered) return
            delivered = true
            publish(rows)
            markReady()
          }
          if (!held) deliver()
        },
      },
    })),
  )
  const query = new Query().from({ row: source })
  const declarations = cacheOptionDeclarations(history)
  const configs = declarations.map((given) => {
    const config = { query, getKey: given.getKey, queryKey: given.queryKey }
    Object.assign(config, { schema: given.schema })
    return config
  })
  const first = configs[0]!
  const second = configs[1]!
  const pending: Array<Promise<void>> = []
  const track = (promise: Promise<void>) => {
    pending.push(promise)
    void promise.catch(() => {})
    return promise
  }
  const cleanupAbort = new Error(`oracle stream cleanup`)
  const renders: Array<{
    abort: (reason: unknown) => void
    shell: Promise<void>
    done: Promise<void>
    errors: Array<unknown>
    errorAccounted: boolean
  }> = []
  const beginServerRender = (node: React.ReactNode) => {
    const errors: Array<unknown> = []
    let shellReady!: () => void
    let shellFailed!: (error: unknown) => void
    const shell = new Promise<void>((resolve, reject) => {
      shellReady = resolve
      shellFailed = reject
    })
    let finished!: () => void
    let failed!: (error: unknown) => void
    const done = new Promise<void>((resolve, reject) => {
      finished = resolve
      failed = reject
    })
    void shell.catch(() => {})
    void done.catch(() => {})
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    })
    output.on(`finish`, () => (errors.length ? failed(errors[0]) : finished()))
    const stream = renderToPipeableStream(node, {
      onShellReady: shellReady,
      onShellError: (error) => {
        shellFailed(error)
        failed(error)
      },
      onError: (error) => {
        errors.push(error)
      },
    })
    stream.pipe(output)
    const rendering = {
      abort: (reason: unknown) => stream.abort(reason),
      shell,
      done,
      errors,
      errorAccounted: false,
    }
    renders.push(rendering)
    return rendering
  }
  let firstReads = 0
  const resolvedQueryCollections: Array<
    NonNullable<ReturnType<typeof resolveLiveQueryValue>>
  > = []
  const observers: Array<ReturnType<typeof createLiveQueryObserver>> = []
  const subscriptions: Array<() => void> = []
  let readObserver: (() => ReadonlyMap<string | number, unknown>) | undefined
  function First() {
    const result =
      firstReader === `suspense`
        ? useLiveSuspenseQuery(first)
        : useLiveQuery(first)
    oracleAssertion('checkCacheOptionRows', () =>
      checkCacheOptionRows(
        Array.from(result.state, ([key, value]) => ({ key, value })),
        firstReader === `ordinary` && held ? [] : rows,
        history.getKey[0],
      ),
    )
    firstReads++
    return <span>{result.data.map((row) => row.label).join(`,`)}</span>
  }
  function Second() {
    const result = useLiveQuery(second)
    if (!conflictingCacheOptions(history))
      oracleAssertion('checkCacheOptionRows', () =>
        checkCacheOptionRows(
          Array.from(result.state, ([key, value]) => ({ key, value })),
          held ? [] : rows,
          history.getKey[1],
        ),
      )
    return <span>{result.data.length}</span>
  }
  const wrap = (child: React.ReactNode) => (
    <DbProvider client={client}>{child}</DbProvider>
  )
  const checkObserver = (expected: Array<CacheRow>) =>
    oracleAssertion('checkCacheOptionRows', () =>
      checkCacheOptionRows(
        Array.from(readObserver!(), ([key, value]) => ({
          key,
          value,
        })),
        expected,
        history.getKey[0],
      ),
    )
  await withOracleCleanup(async () => {
    oracleAssertion('expect(', () =>
      expect(
        client.dehydrate().liveQueries ?? [],
        `no prior live-query result`,
      ).toEqual([]),
    )
    const sourceLoad = track(source.preload())
    if (!held) await sourceLoad
    vi.stubGlobal(`window`, undefined)
    if (firstReader === `suspense`) {
      // The Router enables this same policy. No cache entry or hydration
      // input is supplied: the real Suspense hook must register its preload.
      client._setSsrStreamingEnabled(true)
    }
    const firstRender = beginServerRender(
      wrap(
        firstReader === `suspense` ? (
          <Suspense fallback={<span>pending</span>}>
            <First />
          </Suspense>
        ) : (
          <First />
        ),
      ),
    )
    await firstRender.shell
    if (firstReader === `ordinary` || !held) await firstRender.done
    oracleAssertion('expect(starts).toBe(1)', () => expect(starts).toBe(1))
    const registered = client
      .dehydrate({ shouldDehydrateLiveQuery: () => true })
      .liveQueries!.filter(
        (entry) => entry.queryHash === getLiveQueryHash(first, first.queryKey),
      )
    oracleAssertion('expect(registered).toHaveLength(1)', () =>
      expect(registered).toHaveLength(1),
    )
    markReach(`first-registration`)
    if (held) {
      oracleAssertion('expect(delivered).toBe(false)', () =>
        expect(delivered).toBe(false),
      )
      if (firstReader === `suspense`)
        oracleAssertion('expect(firstReads).toBe(0)', () =>
          expect(firstReads).toBe(0),
        )
      else
        oracleAssertion('expect(firstReads).toBeGreaterThan(0)', () =>
          expect(firstReads).toBeGreaterThan(0),
        )
      markReach(`held-delivery`)
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (secondReader === `preload`) {
        oracleAssertion('checkCacheOptionAdmission', () =>
          checkCacheOptionAdmission(
            () => track(client.preloadLiveQuery(second)),
            history,
          ),
        )
      } else {
        const rendering = beginServerRender(wrap(<Second />))
        await oracleAssertion('checkCacheOptionPromise', () =>
          checkCacheOptionPromise(rendering.done, history),
        )
        // The completion promise preserves the first error. Check every raw
        // renderer error as well; an expected conflict cannot hide another
        // failure from the same server attempt.
        if (conflictingCacheOptions(history)) {
          oracleAssertion(
            'expect(rendering.errors.length).toBeGreaterThan(0)',
            () => expect(rendering.errors.length).toBeGreaterThan(0),
          )
          for (const error of rendering.errors)
            await oracleAssertion('checkCacheOptionPromise', () =>
              checkCacheOptionPromise(Promise.reject(error), history),
            )
        } else
          oracleAssertion('expect(rendering.errors).toEqual([])', () =>
            expect(rendering.errors).toEqual([]),
          )
        rendering.errorAccounted = true
      }
      markReach(attempt === 0 ? `admission` : `retry`)
    }
    track(client.preloadLiveQuery(first))
    markReach(`original-reuse`)
    deliver()
    await Promise.all(pending)
    await firstRender.done
    oracleAssertion('expect(firstRender.errors).toEqual([])', () =>
      expect(firstRender.errors).toEqual([]),
    )
    firstRender.errorAccounted = true
    oracleAssertion('expect(firstReads).toBeGreaterThan(0)', () =>
      expect(firstReads).toBeGreaterThan(0),
    )
    vi.unstubAllGlobals()
    const view = resolveLiveQueryValue(first)!
    resolvedQueryCollections.push(view)
    const observer = createLiveQueryObserver(view, {
      client,
      queryHash: getLiveQueryHash(first, first.queryKey),
    })
    observers.push(observer)
    subscriptions.push(observer.subscribe(() => {}))
    readObserver = () => observer.getSnapshot().state!
    await observer.preload()
    await Promise.resolve() // committed initial-view handoff
    checkObserver(rows)
    markReach(`live-observer`)
    const updated = [{ id: `one`, label: `after` }, rows[1]!]
    publish(updated)
    checkObserver(updated)
    markReach(`source-update`)
    oracleAssertion(`required registration states`, () =>
      oracleAssertion(
        'expect(requiredStates.filter((state) => !reached.has(state))).toEqual([])',
        () =>
          expect(requiredStates.filter((state) => !reached.has(state))).toEqual(
            [],
          ),
      ),
    )
  }, [
    () => deliver(),
    () => {
      for (const rendering of renders) rendering.abort(cleanupAbort)
    },
    () => Promise.allSettled(renders.map((rendering) => rendering.done)),
    () => {
      const unexpected = renders
        .filter((rendering) => !rendering.errorAccounted)
        .flatMap((rendering) =>
          rendering.errors.filter((error) => error !== cleanupAbort),
        )
      if (unexpected.length)
        throw new AggregateError(unexpected, `Server rendering failed`)
    },
    () => vi.unstubAllGlobals(),
    () =>
      withOracleCleanup(() => {}, [
        ...subscriptions.map((release) => () => release()),
        ...observers.map((observer) => () => observer.dispose()),
        ...resolvedQueryCollections.map(
          (view) => () => view.cleanup({ dependents: true }),
        ),
      ]),
    () => client.cleanup(),
  ])
}
oracleProperty({
  id: `react.cache-first-registration`,
  law: {
    statement: `An actual first server reader establishes local option claims; independent retries preserve admission and original rows through later observation and source publication.`,
    authority: `packages/db/tests/live-query-cache-options-oracle.ts independent cache declaration law and docs/guides/ssr.md rendered-view law.`,
    limits: `The unchanged finite 1152 ordinary/Suspense first-reader, preload/server second-reader and held/ready source histories; controlled server streaming, no Router transport or hydration claim.`,
  },
  owns: [
    `src/DbProvider.tsx#DbProvider`,
    `src/useLiveQuery.ts#useLiveQuery`,
    `src/useLiveSuspenseQuery.ts#useLiveSuspenseQuery`,
  ],
  histories,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`SSR cache registration`, plan, observe, () =>
      checkFirstRegistrationHistory(plan.history, observe),
    ),
  check: forwardAssertionJudgment,
})
