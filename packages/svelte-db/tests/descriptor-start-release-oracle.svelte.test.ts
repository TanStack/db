/**
 * Svelte receiving driver for descriptor-start-release-oracle. The hook rejects
 * during descriptor binding inside a native effect root. It must expose the exact factory
 * failure and release each earlier acquisition, independently of failed starts.
 * Direct demand then starts lazy sources. Disposal and client cleanup release
 * every acquired healthy adapter resource. React's render retries do not supply
 * evidence for this Svelte setup/effect boundary.
 */
import { flushSync } from 'svelte'
import { useLiveQuery } from '../src/useLiveQuery.svelte.js'
import {
  descriptorStartHistories,
  expectedDescriptorStart,
} from '../../db/tests/descriptor-start-release-oracle'
import { descriptorStartFixture } from '../../db/tests/descriptor-start-release-support'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-config'
import { withOracleCleanup } from '../../db/tests/utils'
import type { Observation, Verdict } from '../../db/tests/oracle-config'
import type { DescriptorStartHistory } from '../../db/tests/descriptor-start-release-oracle'

async function recordHistory(
  history: DescriptorStartHistory,
  observeFact: (checkpoint: string, value: unknown) => void,
) {
  const fixture = descriptorStartFixture(history, `Svelte`)
  const { client, query, failure, factories, startErrors, observe } = fixture
  let dispose: (() => void) | undefined
  await withOracleCleanup(async () => {
    let rejection: unknown
    // Acquire the root before the hook can throw, so native disposal remains
    // available even when setup does not return its normal result.
    dispose = $effect.root(() => {
      try {
        useLiveQuery({ client, query, queryKey: [fixture.id] })
      } catch (error) {
        rejection = error
      }
    })
    observeFact(`factory failure identity`, rejection === failure)
    observeFact(`factory rejected`, fixture.failures() > 0)
    observeFact(`factories`, [...factories])
    fixture.retain()
    observeFact(`rejected`, observe())
    for (const [index, row] of fixture.collections().entries()) {
      try {
        row.startSyncImmediate()
      } catch (error) {
        observeFact(`start failure identity`, error === startErrors[index])
      }
    }
    flushSync()
    observeFact(`read`, observe())
    dispose()
    dispose = undefined
    await client.cleanup()
    observeFact(`cleaned`, observe())
  }, [() => dispose?.(), () => client.cleanup()])
}

// The shared independent model predicts every original comparison cut. Identity
// checks are recorded as relations because native failures are not portable data.
function modelHistory(history: DescriptorStartHistory) {
  return {
    rejected: expectedDescriptorStart(history, `rejected`),
    read: expectedDescriptorStart(history, `read`),
    cleaned: expectedDescriptorStart(history, `cleaned`),
  }
}
function checkHistory(
  _history: DescriptorStartHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelHistory>,
): Verdict {
  for (const { checkpoint, value } of trace) {
    const target =
      checkpoint === `factories`
        ? expected.rejected.factories
        : checkpoint in expected
          ? expected[checkpoint as keyof typeof expected]
          : true
    const wrong = differs(checkpoint, `descriptor start release`, value, target)
    if (wrong) return wrong
  }
  for (const checkpoint of [
    `factory failure identity`,
    `factory rejected`,
    `factories`,
    `rejected`,
    `read`,
    `cleaned`,
  ])
    if (trace.filter((entry) => entry.checkpoint === checkpoint).length !== 1)
      return violation(
        checkpoint,
        `expected one observation`,
        `descriptor start release`,
      )
  return pass
}
oracleProperty({
  id: `svelte.descriptor-start-release`,
  law: {
    statement: `A rejected descriptor binding preserves its factory failure and releases every acquired source independently; later demand and cleanup honor each source's start policy.`,
    authority: `docs/guides/ssr.md descriptor cleanup contract and packages/db/tests/descriptor-start-release-oracle.ts`,
    limits: `The existing 85 finite synchronous factory/start histories at Svelte setup, demand and cleanup cuts; no provider shutdown or concurrent scheduling claim.`,
  },
  owns: [`src/useLiveQuery.svelte.ts#useLiveQuery`],
  histories: descriptorStartHistories,
  model: modelHistory,
  driver: recordHistory,
  check: checkHistory,
})
