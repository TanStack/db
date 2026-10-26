/**
 * Ordinary LiveQueryObserver status tests: a stale ready notification after
 * disposal is rejected on the granular and wholesale status paths. The
 * eligibility ledger and delivery law are owned by
 * live-query-observer-history-oracle.property.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { finishHistory } from './observer-history-cleanup.js'
import type { ChangeMessage } from '../src/types.js'

type Row = { id: string; version: number }
type Mode = `granular` | `wholesale`

let collectionId = 0

async function runStaleReadyHistory(
  mode: Mode,
  injectStaleReady: boolean,
): Promise<void> {
  let markReady!: () => void
  const source = createCollection<Row, string>({
    id: `observer-stale-ready-${collectionId++}`,
    getKey: ({ id }) => id,
    startSync: false,
    sync: {
      sync: (operations) => {
        markReady = operations.markReady
      },
    },
  })
  source.startSyncImmediate()
  const observer = createLiveQueryObserver(source, { mode })
  let readyNotifications = 0
  const readyListener = (
    changes: Array<ChangeMessage<Row, string>> | undefined,
  ): void => {
    if (changes === undefined) readyNotifications++
  }

  let failure: { error: unknown } | undefined
  try {
    observer.subscribe(readyListener)
    observer.dispose()
    markReady()
    if (injectStaleReady) readyListener(undefined)
    expect(readyNotifications).toBe(0)
  } catch (error) {
    failure = { error }
  }
  await finishHistory(
    [() => observer.dispose(), () => source.cleanup()],
    failure,
  )
}

describe(`LiveQueryObserver generated histories`, () => {
  it.each([`granular`, `wholesale`] as const)(
    `rejects a stale ready notification after disposal through the %s status path`,
    async (mode) => {
      await runStaleReadyHistory(mode, false)
      await expect(runStaleReadyHistory(mode, true)).rejects.toMatchObject({
        name: `AssertionError`,
      })
    },
  )
})
