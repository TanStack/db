// @vitest-environment node
/**
 * Whole-table replacement receives the existing startup owner's exact judgment
 * on actual Chromium worker/OPFS. Each finite history is checked at first source
 * readiness/applied receipts, before refresh, inside refresh fulfillment, after
 * its durable read and after local-only reopen. Network-first histories also
 * compare the saved public/durable fallback while the source remains held.
 *
 * Limits are the shared owner's three-key eager startup language. The browser
 * enumerates its shared fixed histories; the two Node hosts retain the owner's
 * generated campaigns. This is no remote PowerSync-server or concurrent-tab
 * witness. Detached browser errors and leftover fixture files fail separately.
 */
import { afterAll, beforeAll } from 'vitest'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  persistedStartupHistories,
  persistedStartupViolations,
  startupRequiredStates,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import { deliverQueryHistory } from './query-ownership-browser-support'
import type { PersistedStartupObservation } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.html`,
    ready: `runDirectPersistedStartup`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

let sequence = 0
oracleProperty({
  id: `adapter.powersync-direct.persisted-startup.chromium-opfs`,
  owns: [
    `../powersync-direct-db-collection/src/index.ts#powerSyncCollectionOptions`,
  ],
  law: {
    statement: `A complete eager source result replaces its persisted baseline and is durable before refresh; network-first fallback preserves the saved snapshot.`,
    authority: `Shared persisted-startup-oracle.ts, READY-3/PUB-7 and durable acceptance; docs/guides/sqlite-persistence.md, Use with a sync adapter.`,
    limits: `Three numeric string-keyed rows, eager startup, one source and actual Chromium worker/OPFS; no concurrent writers, failed I/O or remote PowerSync server.`,
  },
  histories: {
    enumerated: persistedStartupHistories,
    states: startupRequiredStates(`collection`),
  },
  model: () => undefined,
  driver: async (history, observe) => {
    const active = browser
    if (!active) throw new Error(`Chromium receiving host did not start`)
    const result = await captureBrowserHistory(active, () =>
      active.page.evaluate(
        ({ history: input, id }) => window.runDirectPersistedStartup(input, id),
        { history, id: `direct-startup-browser-${sequence++}` },
      ),
    )
    deliverQueryHistory(result, observe)
  },
  check: (history, trace) => {
    const early = trace.find(({ checkpoint }) => checkpoint === `cut failure`)
    if (early)
      return violation(
        `first source result`,
        (early.value as Array<string>).join(`\n`),
        `persisted startup`,
      )
    const completed = trace.find(({ checkpoint }) => checkpoint === `completed`)
    if (!completed)
      return violation(
        `completed`,
        `Missing browser startup observation`,
        `persisted startup`,
      )
    const differences = persistedStartupViolations(
      history,
      `collection`,
      completed.value as PersistedStartupObservation,
    )
    if (differences.length)
      return violation(`completed`, differences.join(`\n`), `persisted startup`)
    const artifacts = trace.find(({ checkpoint }) => checkpoint === `artifacts`)
    if (!artifacts || (artifacts.value as Array<string>).length)
      return violation(
        `cleanup`,
        `OPFS fixture files remain`,
        `receiving cleanup`,
      )
    const errors = trace.find(
      ({ checkpoint }) => checkpoint === `browserErrors`,
    )
    return !errors || (errors.value as Array<string>).length
      ? violation(
          `browser errors`,
          JSON.stringify(errors?.value),
          `detached browser errors`,
        )
      : pass
  },
  timeout: 120_000,
})
