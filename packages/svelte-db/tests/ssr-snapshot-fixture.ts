import { render } from 'svelte/server'
import { BTreeIndex, DbClient, Query, collectionOptions } from '@tanstack/db'
import SsrDbApp from './SsrDbApp.svelte'
import { peopleQuery } from './ssr-test-utils'
import type {
  SsrRuntimeErrorHistory,
  SsrSnapshotHistory,
} from '../../db/tests/ssr-snapshot-admission-oracle'
import type { SsrHookFlags } from './ssr-test-utils'

// Server-only production driver. The browser owner loads this through Vite's
// SSR compilation, then transfers only serialized HTML and dehydration data.
// It supplies no expected rows, readiness rule or comparison.
export async function renderSsrSnapshotHistory(
  history: SsrSnapshotHistory,
  providerNesting?: `none` | `inherit` | `marked`,
) {
  let publish = () => {}
  const descriptor = collectionOptions(`svelte-ssr-people`, () => ({
    id: `svelte-ssr-people`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    getKey: (row: { id: string; name: string; sourcePayload: string }) =>
      row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of history.rows)
          write({
            type: `insert`,
            value: { ...row, sourcePayload: `source-only` },
          })
        commit()
        publish = () => {
          begin()
          write({
            type: `insert`,
            value: {
              id: `late`,
              name: `late server`,
              sourcePayload: `source-only`,
            },
          })
          commit()
        }
        if (history.sourceState === `ready`) markReady()
      },
    },
  }))
  const client = new DbClient()
  client._setSsrServerCleanupEnabled(true)
  try {
    if (history.sourceState !== `idle`) {
      const warming = client.preloadLiveQuery({
        query: new Query()
          .from({ person: descriptor })
          .select(({ person }) => ({ id: person.id })),
      })
      if (history.sourceState === `ready`) await warming
      else void warming.catch(() => {})
    }
    // Register the warmed source for normalized dehydration. This lane models
    // explicit source registration, not another awaited preload operation.
    if (history.preparation === `source`) client.collection(descriptor)
    if (
      history.preparation === `query` ||
      history.preparation === `pending-query`
    ) {
      const preload = client.preloadLiveQuery(peopleQuery(descriptor))
      if (history.preparation === `query`) await preload
      else void preload.catch(() => {})
    }
    let html: string | undefined, error: string | undefined
    try {
      html = render(SsrDbApp, {
        props: { client, descriptor, providerNesting },
      }).body
    } catch (failure) {
      error = String(failure)
    }
    if (history.serverWrite && history.sourceState !== `idle`) publish()
    return JSON.parse(
      JSON.stringify({ html, error, state: client.dehydrate() }),
    ) as {
      html?: string
      error?: string
      state: ReturnType<DbClient[`dehydrate`]>
    }
  } finally {
    await client.cleanup()
  }
}

// A second server driver for the same public hook exposes ordinary runtime
// failures without deciding the expected outcome. Only HTML, a public hook
// observation and dehydrated state cross the JSON boundary.
export async function renderSsrRuntimeErrorHistory(
  history: SsrRuntimeErrorHistory,
) {
  const client = new DbClient()
  client._setSsrServerCleanupEnabled(true)
  const descriptor = collectionOptions(`svelte-ssr-people`, () => ({
    id: `svelte-ssr-people`,
    getKey: (row: { id: string; name: string; sourcePayload: string }) =>
      row.id,
    sync: {
      sync: ({ markReady, markError }) => {
        if (history.serverOutcome === `error`)
          markError(
            history.definedError
              ? new Error(`provider unavailable`)
              : undefined,
          )
        else markReady()
      },
    },
  }))
  type View = SsrHookFlags & { rows: Array<string>; status: string }
  const reads: Array<View> = []
  try {
    await client
      .collection(descriptor)
      .preload()
      .catch(() => {})
    const html = render(SsrDbApp, {
      props: {
        client,
        descriptor,
        onInitial: (
          rows: Array<{ id: string; name: string }>,
          status: string,
          flags: SsrHookFlags,
        ) => reads.push({ rows: rows.map((row) => row.id), status, ...flags }),
      },
    }).body
    return JSON.parse(
      JSON.stringify({ html, view: reads[0], state: client.dehydrate() }),
    ) as {
      html: string
      view: View
      state: ReturnType<DbClient[`dehydrate`]>
    }
  } finally {
    await client.cleanup()
  }
}
