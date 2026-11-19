// This subprocess supplies a real matched React/server-renderer runtime to the
// shared SSR preparation judgment. It records raw diagnostics and public hook
// results; the oracle in ssr-effects-oracle.test.ts owns every expectation.
import { createElement, version as reactVersion } from 'react'
import { renderToString, version as rendererVersion } from 'react-dom/server'
import {
  DbClient,
  Query,
  collectionOptions,
  createCollection,
  localOnlyCollectionOptions,
} from '@tanstack/db'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import type { SsrSnapshotHistory } from '../../db/tests/ssr-snapshot-admission-oracle'

async function observe({
  history,
  path,
}: {
  history: SsrSnapshotHistory
  path: string
}) {
  const diagnostics: Array<string> = []
  const cleanupFailures: Array<string> = []
  const originalError = console.error
  console.error = (...args: Array<unknown>) => {
    diagnostics.push(args.map(String).join(` `))
  }
  const client = new DbClient()
  client._setSsrServerCleanupEnabled(true)
  const descriptor = collectionOptions(`ssr-effects`, () => ({
    id: `ssr-effects`,
    getKey: (row: { id: string; name: string }) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of history.rows)
          write({ type: `insert`, value: { ...row } })
        commit()
        if (history.sourceState === `ready`) markReady()
      },
    },
  }))
  const query = new Query()
    .from({ person: descriptor })
    .orderBy(({ person }) => person.id)
    .select(({ person }) => ({ id: person.id, name: person.name }))
  const concrete =
    path === `standalone` || path === `supplied`
      ? createCollection(
          localOnlyCollectionOptions({
            id: `ssr-concrete`,
            getKey: (row: { id: string; name: string }) => row.id,
            initialData: history.rows.map((row) => ({ ...row })),
          }),
        )
      : undefined
  let calls = 0
  let view: { rows: unknown; status?: string } | undefined
  let failure: string | undefined
  try {
    if (!concrete && history.sourceState !== `idle`) {
      const warming = client.preloadLiveQuery({
        query: new Query().from({ person: descriptor }),
      })
      if (history.sourceState === `ready`) await warming
      else void warming.catch(() => {})
    }
    if (!concrete && history.preparation === `source`)
      client.collection(descriptor)
    if (
      !concrete &&
      (history.preparation === `query` ||
        history.preparation === `pending-query`)
    ) {
      const preload = client.preloadLiveQuery({ query })
      if (history.preparation === `query`) await preload
      else void preload.catch(() => {})
    }
    function Consumer() {
      calls++
      const config = { query, ...(path.endsWith(`explicit`) ? { client } : {}) }
      const result =
        path === `disabled`
          ? useLiveQuery(() => null)
          : path.startsWith(`suspense`)
            ? useLiveSuspenseQuery(config)
            : concrete
              ? path === `supplied`
                ? useLiveQuery(concrete)
                : useLiveQuery((q) => q.from({ person: concrete }))
              : useLiveQuery(config)
      view = {
        // The shared admission model observes authored id/name fields. Public
        // virtual metadata is outside that judgment; malformed fields still fail.
        rows: result.data?.map((row: unknown) => {
          if (
            typeof row !== `object` ||
            row === null ||
            !(`id` in row) ||
            typeof row.id !== `string` ||
            !(`name` in row) ||
            typeof row.name !== `string`
          ) {
            throw new Error(`SSR fixture received malformed selected fields`)
          }
          return { id: row.id, name: row.name }
        }),
        ...(`status` in result ? { status: result.status } : {}),
      }
      return createElement(`output`, null, JSON.stringify(view))
    }
    try {
      const consumer = createElement(Consumer)
      renderToString(
        path.endsWith(`provider`)
          ? createElement(DbProvider, { client }, consumer)
          : consumer,
      )
    } catch (error) {
      failure = String(error)
    }
    return {
      reactVersion,
      rendererVersion,
      calls,
      view,
      failure,
      diagnostics,
      cleanupFailures,
    }
  } finally {
    console.error = originalError
    try {
      await client.cleanup()
      if (concrete) await concrete.cleanup({ dependents: true })
    } catch (error) {
      cleanupFailures.push(String(error))
    }
  }
}

observe(JSON.parse(process.argv[2]!)).then(
  // SSR can leave intentional cache/GC timers. Cleanup has completed; ending
  // this isolated process releases those timers before the next history.
  (observation) =>
    process.stdout.write(JSON.stringify(observation), () => process.exit(0)),
  (error: unknown) => {
    console.error(error)
    process.exitCode = 1
  },
)
