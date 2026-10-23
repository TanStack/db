import { render } from 'svelte/server'
import { BTreeIndex, DbClient, Query, collectionOptions } from '@tanstack/db'
import SsrDbApp from './SsrDbApp.svelte'
import { peopleQuery } from './ssr-test-utils'
import type { SsrSnapshotHistory } from '../../db/tests/ssr-snapshot-admission-oracle'

// Server-only production driver. The browser owner loads this through Vite's
// SSR compilation, then transfers only serialized HTML and dehydration data.
// It supplies no expected rows, readiness rule or comparison.
export async function renderSsrSnapshotHistory(history: SsrSnapshotHistory) {
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
      html = render(SsrDbApp, { props: { client, descriptor } }).body
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
