/**
 * React receives the shared cache declaration law through mounted ordinary and
 * Suspense hooks and real server rendering. A warm DbClient result admits only
 * reference-compatible getKey/schema declarations at one query identity; a
 * distinct queryKey permits different declarations. Rejected retries preserve
 * the original cached rows and keys. Authority and declaration abstraction are
 * in the shared cache-options owner below.
 *
 * Each path retains all 144 finite declaration pairs and both admission attempts.
 * Admission stays synchronous. Mounted rows are read at render return and after
 * native act; server rows and HTML are read during real renderToString without
 * subscribing. Controlled sources establish no hydrateRoot, provider, initial
 * suspension or concurrent-render law. Mounted inline option retention remains
 * owned by source-id-reuse-oracle.test.tsx.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { Suspense } from 'react'
import { DbClient, Query, collectionOptions } from '@tanstack/db'
import { vi } from 'vitest'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import {
  cacheOptionDeclarations,
  cacheOptionHistories,
  cacheOptionReach,
  checkCacheOptionAdmission,
  checkCacheOptionRows,
  conflictingCacheOptions,
} from '../../db/tests/live-query-cache-options-oracle'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-config'
import { withOracleCleanup } from '../../db/tests/utils'
import type { Observation, Verdict } from '../../db/tests/oracle-config'
import type { CacheRow } from '../../db/tests/live-query-cache-options-oracle'

const paths = [`client-render`, `suspense-render`, `server-render`] as const
type Path = (typeof paths)[number]
const histories = cacheOptionHistories.map((history) => ({
  ...history,
  sourceRows: [
    { id: `one`, label: `first` },
    { id: `two`, label: `peer` },
  ],
}))
type History = (typeof histories)[number]

// The existing independent declaration model owns admission. Authored source
// values own row expectations and HTML text; production config supplies none.
function modelCacheOptions(history: History, path: Path) {
  const conflict = conflictingCacheOptions(history)
  const reads = [...(!conflict ? [`second 0`, `second 1`] : []), `original`]
  return {
    conflict,
    reads,
    checkpoints: [
      ...reads.flatMap((name) => [
        `rows ${name} immediate`,
        ...(path === `server-render` ? [`html ${name}`] : []),
      ]),
      `admission 0`,
      `admission 1`,
      ...(path !== `server-render`
        ? reads.map((name) => `rows ${name} settled`)
        : []),
    ],
    reaches: [
      ...cacheOptionReach(history),
      `admission`,
      ...cacheOptionReach(history),
      `retry`,
      `original-reuse`,
      ...(path !== `server-render` ? [`settled-client-rows`] : []),
    ],
    htmlText: history.sourceRows.map((row) => row.label).join(`,`),
  }
}

// Preserve native scheduling and cleanup from the receiving driver. Capture
// reference-free row copies at the old check boundaries, including server reads
// inside Consumer. An admission exception is observed synchronously; no promise
// or extra act can postpone its comparison to a later state.
async function driveCacheOptions(
  history: History,
  path: Path,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const client = new DbClient()
  const rows = history.sourceRows.map((row) => ({ ...row }))
  const source = client.collection(
    collectionOptions(`react-cache-options`, () => ({
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
    })),
  )
  const query = new Query().from({ row: source })
  const [firstOptions, secondOptions] = cacheOptionDeclarations(history)
  // Runtime schema declaration identity is intentional here; this driver makes
  // no claim about public hook schema typing or schema transformation.
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

  const unmounts: Array<() => void> = []
  const settledReads: Array<() => void> = []
  const render = (options: typeof first, declaration: 0 | 1, name: string) => {
    if (path === `server-render`) {
      vi.stubGlobal(`window`, undefined)
      function Consumer() {
        const result = useLiveQuery(options)
        if (declaration === 0 || !conflictingCacheOptions(history))
          observe(
            `rows ${name} immediate`,
            Array.from(result.state, ([key, value]) => ({
              key,
              value: { ...value },
            })),
          )
        return <span>{result.data.map((row) => row.label).join(`,`)}</span>
      }
      const html = renderToString(
        <DbProvider client={client}>
          <Consumer />
        </DbProvider>,
      )
      observe(`html ${name}`, html)
    } else {
      const useQuery = path.startsWith(`suspense`)
        ? useLiveSuspenseQuery
        : useLiveQuery
      const result = renderHook(() => useQuery(options), {
        wrapper: ({ children }) => (
          <DbProvider client={client}>
            <Suspense fallback={null}>{children}</Suspense>
          </DbProvider>
        ),
      })
      unmounts.push(result.unmount)
      if (declaration === 0 || !conflictingCacheOptions(history)) {
        const readRows = (cut: string) =>
          observe(
            `rows ${name} ${cut}`,
            Array.from(result.result.current.state, ([key, value]) => ({
              key,
              value: { ...value },
            })),
          )
        readRows(`immediate`)
        settledReads.push(() => readRows(`settled`))
      }
    }
  }
  await withOracleCleanup(async () => {
    await client.preloadLiveQuery(first)
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const state of cacheOptionReach(history)) observe(`reach`, state)
      let failure: unknown
      let threw = false
      try {
        render(second, 1, `second ${attempt}`)
      } catch (error) {
        threw = true
        failure = error
      }
      observe(`admission ${attempt}`, {
        threw,
        message: threw
          ? failure instanceof Error
            ? failure.message
            : String(failure)
          : undefined,
      })
      observe(`reach`, attempt === 0 ? `admission` : `retry`)
    }
    render(first, 0, `original`)
    observe(`reach`, `original-reuse`)
    if (path !== `server-render`) {
      // Admission stays synchronous. The receiving row law also applies after
      // React commits the cached seed-to-live handoff in its native scheduler.
      await act(async () => {})
      for (const checkRows of settledReads) checkRows()
      observe(`reach`, `settled-client-rows`)
    }
  }, [
    () => vi.unstubAllGlobals(),
    () =>
      act(async () => {
        await withOracleCleanup(() => {}, [
          ...unmounts.map((unmount) => () => unmount()),
          // Testing Library also owns roots whose initial render threw before
          // renderHook could return an unmount handle.
          () => cleanup(),
          () => client.cleanup(),
        ])
      }),
  ])
}

// Judge recorded facts before completeness. A later driver/cleanup failure
// cannot replace an already observed admission or row violation. The synthetic
// action reuses the shared admission check without consulting production.
function checkCacheOptions(
  history: History,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelCacheOptions>,
): Verdict {
  for (const { checkpoint, value } of trace) {
    if (checkpoint.startsWith(`admission `)) {
      const actual = value as { threw: boolean; message?: string }
      try {
        checkCacheOptionAdmission(() => {
          if (actual.threw) throw new Error(actual.message)
        }, history)
      } catch (error) {
        return violation(checkpoint, String(error), `cache option admission`)
      }
    } else if (checkpoint.startsWith(`rows `)) {
      try {
        checkCacheOptionRows(
          value as Parameters<typeof checkCacheOptionRows>[0],
          history.sourceRows,
          checkpoint.startsWith(`rows original `)
            ? history.getKey[0]
            : history.getKey[1],
        )
      } catch (error) {
        return violation(checkpoint, String(error), `cache option rows`)
      }
    } else if (checkpoint.startsWith(`html `)) {
      const wrong = differs(
        checkpoint,
        `cache option HTML`,
        typeof value === `string` && value.includes(expected.htmlText),
        true,
      )
      if (wrong) return wrong
    } else if (checkpoint === `reach`) {
      if (!expected.reaches.includes(value as string))
        return violation(checkpoint, `unknown state`, `cache option reach`)
    } else
      return violation(
        checkpoint,
        `unknown observation`,
        `cache option history`,
      )
  }
  for (const checkpoint of expected.checkpoints) {
    const count = trace.filter(
      (entry) => entry.checkpoint === checkpoint,
    ).length
    const wrong = differs(checkpoint, `cache option history`, count, 1)
    if (wrong) return wrong
  }
  const wrong = differs(
    `reach`,
    `cache option reach`,
    trace
      .filter(({ checkpoint }) => checkpoint === `reach`)
      .map(({ value }) => value),
    expected.reaches,
  )
  return wrong ?? pass
}

for (const path of paths) {
  oracleProperty({
    id:
      path === `client-render`
        ? `react.cache-options.client-render`
        : path === `suspense-render`
          ? `react.cache-options.suspense-render`
          : `react.cache-options.server-render`,
    law: {
      statement: `Warm DbClient results reject incompatible getKey/schema declarations synchronously, admit compatible or distinct-key declarations, and preserve original keys, rows and server text through retries.`,
      authority: `packages/db/tests/live-query-cache-options-oracle.ts; maintainer same-identity conflict decision.`,
      limits: `144 finite declaration pairs per native ordinary/Suspense or real server path; warm synchronous controlled source, no hydrateRoot, provider, pending-source or concurrent-render claim.`,
    },
    owns: [
      `src/DbProvider.tsx#DbProvider`,
      `src/useLiveQuery.ts#useLiveQuery`,
      `src/useLiveSuspenseQuery.ts#useLiveSuspenseQuery`,
    ],
    histories,
    label: (history) =>
      `${history.getKey.join(`/`)}/${history.schema.join(`/`)}/${history.keyed}/${history.distinctKey}`,
    model: (history) => modelCacheOptions(history, path),
    driver: (history, observe) => driveCacheOptions(history, path, observe),
    check: checkCacheOptions,
    calibrations: [
      {
        name: `conflict admitted`,
        law: `cache option admission`,
        corrupt: (trace, history: History) =>
          !conflictingCacheOptions(history)
            ? undefined
            : trace.map((entry) =>
                entry.checkpoint === `admission 0`
                  ? { ...entry, value: { threw: false } }
                  : entry,
              ),
      },
      {
        name: `compatible declaration rejected`,
        law: `cache option admission`,
        corrupt: (trace, history: History) =>
          conflictingCacheOptions(history)
            ? undefined
            : trace.map((entry) =>
                entry.checkpoint === `admission 0`
                  ? {
                      ...entry,
                      value: { threw: true, message: `getKey mismatch` },
                    }
                  : entry,
              ),
      },
      {
        name: `original key changed`,
        law: `cache option rows`,
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint === `rows original immediate`
              ? {
                  ...entry,
                  value: (
                    entry.value as Array<{ key: unknown; value: unknown }>
                  ).map((row) => ({ ...row, key: `wrong-key` })),
                }
              : entry,
          ),
      },
      {
        name: `missing original row cut`,
        law: `cache option history`,
        corrupt: (trace) =>
          trace.filter(
            ({ checkpoint }) => checkpoint !== `rows original immediate`,
          ),
      },
      {
        name: `earlier wrong row before driver failure`,
        law: `cache option rows`,
        driver: (history, observe) =>
          driveCacheOptions(history, path, (checkpoint, value) => {
            if (checkpoint === `rows original immediate`) {
              observe(checkpoint, [])
              throw new Error(`later native driver failure`)
            }
            observe(checkpoint, value)
          }),
      },
      ...(path === `server-render`
        ? [
            {
              name: `wrong server text`,
              law: `cache option HTML`,
              corrupt: (trace: ReadonlyArray<Observation>) =>
                trace.map((entry) =>
                  entry.checkpoint === `html original`
                    ? { ...entry, value: `<span>wrong</span>` }
                    : entry,
                ),
            },
          ]
        : [
            {
              name: `missing settled rows`,
              law: `cache option history`,
              corrupt: (trace: ReadonlyArray<Observation>) =>
                trace.filter(
                  ({ checkpoint }) => checkpoint !== `rows original settled`,
                ),
            },
          ]),
    ],
  })
}
