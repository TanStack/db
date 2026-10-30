/**
 * Svelte receiving driver for descriptor-start-release-oracle. The hook rejects
 * during descriptor binding inside a native effect root. It must expose the exact factory
 * failure and release each earlier acquisition, independently of failed starts.
 * Direct demand then starts lazy sources. Disposal and client cleanup release
 * every acquired healthy adapter resource. React's render retries do not supply
 * evidence for this Svelte setup/effect boundary.
 */
import { expect, it } from 'vitest'
import { flushSync } from 'svelte'
import { useLiveQuery } from '../src/useLiveQuery.svelte.js'
import {
  checkDescriptorStart,
  descriptorStartHistories,
  expectedDescriptorStart,
} from '../../db/tests/descriptor-start-release-oracle'
import { descriptorStartFixture } from '../../db/tests/descriptor-start-release-support'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { withOracleCleanup } from '../../db/tests/utils'
import type { DescriptorStartHistory } from '../../db/tests/descriptor-start-release-oracle'

async function checkHistory(history: DescriptorStartHistory) {
  const reach = createOracleReach(`Svelte descriptor starts`, [
    `rejected`,
    `read`,
    `cleaned`,
  ])
  reach.beginHistory()
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
    expect(rejection).toBe(failure)
    expect(fixture.failures()).toBeGreaterThan(0)
    expect(factories).toEqual(
      expectedDescriptorStart(history, `rejected`).factories,
    )
    fixture.retain()
    checkDescriptorStart(observe(), history, `rejected`)
    reach.reach(`rejected`)
    for (const [index, row] of fixture.collections().entries()) {
      try {
        row.startSyncImmediate()
      } catch (error) {
        expect(error).toBe(startErrors[index])
      }
    }
    flushSync()
    checkDescriptorStart(observe(), history, `read`)
    reach.reach(`read`)
    dispose()
    dispose = undefined
    await client.cleanup()
    checkDescriptorStart(observe(), history, `cleaned`)
    reach.reach(`cleaned`)
    reach.assertReached()
  }, [() => dispose?.(), () => client.cleanup()])
}

it.each(descriptorStartHistories)(
  `releases independent descriptor starts in Svelte: %j`,
  checkHistory,
)

declareOracle({
  check: [checkDescriptorStart],
  model: [expectedDescriptorStart],
  grammar: [descriptorStartHistories],
})
