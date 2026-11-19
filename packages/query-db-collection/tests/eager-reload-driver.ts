/**
 * Query receives the complete-result reload law through its real cache and
 * QueryObserver. A cached result is a legal first complete result even when no
 * fetch is needed. The shared driver retires the old run and holds entry to the
 * new one; replacing the public cache there makes omission authoritative before
 * the new observer exists. This does not require backend freshness on reload.
 */
import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '../src/query'
import { observeEagerReload } from '../../db-adapter-conformance/tests/eager-reload-driver'
import type {
  EagerGateAdapter,
  EagerReloadAdapter,
} from '../../db-adapter-conformance/tests/eager-reload-driver'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type { EagerReloadHistory } from '../../db-adapter-conformance/tests/eager-reload-oracle'

export const queryEagerReloadAdapter: EagerReloadAdapter = {
  open: (initial, id) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      },
    })
    const key = [`complete-result-reload`, id]
    let source = initial
    const copy = (rows: Array<StartupRow>) => rows.map((row) => ({ ...row }))
    return Promise.resolve({
      options: queryCollectionOptions({
        id,
        queryClient: client,
        queryKey: key,
        queryFn: () => Promise.resolve(copy(source)),
        getKey: (row: StartupRow) => row.id,
      }),
      replace: (rows) => {
        source = rows
        client.setQueryData(key, copy(rows))
        return Promise.resolve()
      },
      propagate: () => {
        // replace() installed the complete cache result before target entry.
        // Query's sync processes observer.getCurrentResult() synchronously in
        // subscribeToQuery and again after subscribeToQueries. Thus source
        // delivery has returned before this barrier, including when a mutant
        // omits commit or markReady; no Collection outcome supplies the cut.
        return Promise.resolve()
      },
      dispose: () => {
        client.clear()
        return Promise.resolve()
      },
    })
  },
}

/**
 * Query replaces a complete result through both its snapshot declaration and
 * omission deletes. Removing just one is equivalent for a retained-row to
 * empty-result history. This receiving mutant disables both at the new run's
 * public sync boundary; the shared model and every observation stay unchanged.
 */
export function observeQueryEagerReload(
  history: EagerReloadHistory,
  id: string,
  omitReplacement = false,
) {
  const adapter: EagerReloadAdapter = {
    async open(initial, collectionId) {
      const sdk = await queryEagerReloadAdapter.open(initial, collectionId)
      if (!omitReplacement) return sdk
      const source = sdk.options.sync.sync
      const targetRun = history.start === `fresh` ? 1 : 2
      let run = 0
      return {
        ...sdk,
        options: {
          ...sdk.options,
          sync: {
            ...sdk.options.sync,
            sync: (params) => {
              run++
              return source(
                run === targetRun
                  ? {
                      ...params,
                      begin: (options) =>
                        params.begin(
                          options?.snapshot
                            ? { ...options, snapshot: false }
                            : options,
                        ),
                      write: (message) => {
                        if (message.type !== `delete`) params.write(message)
                      },
                    }
                  : params,
              )
            },
          },
        },
      }
    },
  }
  return observeEagerReload(adapter, history, id)
}

/**
 * An uncached Query's failed first result ends that sync run's initial gate.
 * Fresh and reload receivers have no cached success in the new run. A shared
 * cached-success entry has a different legal verdict and is registered nowhere
 * in this terminal family. Query promises, rather than health polling, supply
 * the source-settlement cut before the shared checker judges public status.
 */
export const queryEagerGateAdapter: EagerGateAdapter = {
  sources: [`queryFn`],
  open: () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    type Answer = { rows: Array<StartupRow> } | { error: Error } | undefined
    let answer: Answer
    let failures = 0
    const waiters = new Set<{
      resolve: (rows: Array<StartupRow>) => void
      reject: (error: Error) => void
    }>()
    const settle = (next: Exclude<Answer, undefined>) => {
      answer = next
      for (const waiter of waiters) {
        if (`rows` in next) waiter.resolve(next.rows.map((row) => ({ ...row })))
        else waiter.reject(next.error)
      }
      waiters.clear()
      return Promise.resolve()
    }
    return Promise.resolve({
      options: (id: string) =>
        queryCollectionOptions({
          id,
          queryClient: client,
          queryKey: [`initial-query-gate`],
          getKey: (row: StartupRow) => row.id,
          queryFn: async () => {
            try {
              if (answer) {
                if (`rows` in answer)
                  return answer.rows.map((row) => ({ ...row }))
                throw answer.error
              }
              return await new Promise<Array<StartupRow>>((resolve, reject) => {
                waiters.add({ resolve, reject })
              })
            } catch (error) {
              failures++
              throw error
            }
          },
        }),
      hold: () => {
        answer = undefined
      },
      deliver: (rows: Array<StartupRow>) => settle({ rows }),
      reject: (message: string) => settle({ error: new Error(message) }),
      propagate: async () => {
        // A new sync run can start in a microtask after reload's retirement.
        await Promise.resolve()
        await Promise.allSettled(
          client
            .getQueryCache()
            .findAll()
            .map((query) => query.promise),
        )
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      },
      terminalEntries: () => failures,
      prepareRecovery: (rows: Array<StartupRow>) => settle({ rows }),
      matchesFailure: (error: unknown, message: string) =>
        error instanceof Error && error.message === message,
      dispose: () => {
        client.clear()
        return Promise.resolve()
      },
    })
  },
}
