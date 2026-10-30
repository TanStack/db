/**
 * React receiving driver for descriptor-start-release-oracle. Binding fails
 * after zero through three source acquisitions. Native React retries may call
 * the failing factory again; successful sources must still be constructed once.
 * The exact preparation error crosses React's failed mount. A direct reader then
 * starts lazy sources, and client cleanup releases every healthy resource once.
 * No graph from the rejected input may start a lazy source on its own.
 */
import { cleanup, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import {
  checkDescriptorStart,
  descriptorStartHistories,
  expectedDescriptorStart,
} from '../../db/tests/descriptor-start-release-oracle'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { descriptorStartFixture } from '../../db/tests/descriptor-start-release-support'
import { withOracleCleanup } from '../../db/tests/utils'
import type { DescriptorStartHistory } from '../../db/tests/descriptor-start-release-oracle'

const hooks = [`live`, `infinite`, `suspense`] as const
async function checkHistory(
  history: DescriptorStartHistory,
  hook: (typeof hooks)[number],
) {
  const reach = createOracleReach(`React descriptor starts ${hook}`, [
    `rejected`,
    `read`,
    `cleaned`,
  ])
  reach.beginHistory()
  const fixture = descriptorStartFixture(history, `React`)
  const { client, query, id, failure, startErrors, factories, observe } =
    fixture
  // Native root cleanup is registered before renderHook can acquire a root
  // and fail without returning its unmount handle.
  await withOracleCleanup(async () => {
    let rejection: unknown
    try {
      renderHook(() => {
        const config = { client, query, queryKey: [id] }
        if (hook === `suspense`) return useLiveSuspenseQuery(config)
        if (hook === `infinite`)
          return useLiveInfiniteQuery(() => query, {
            client,
            queryKey: [id],
            pageSize: 1,
          })
        return useLiveQuery(config)
      })
    } catch (error) {
      rejection = error
    }
    expect(rejection).toBe(failure)
    expect(factories).toEqual(
      expectedDescriptorStart(history, `rejected`).factories,
    )
    fixture.retain()
    expect(fixture.failures()).toBeGreaterThan(0)
    checkDescriptorStart(observe(), history, `rejected`)
    reach.reach(`rejected`)
    for (const [index, row] of fixture.collections().entries()) {
      try {
        row.startSyncImmediate()
      } catch (error) {
        expect(error).toBe(startErrors[index])
      }
    }
    checkDescriptorStart(observe(), history, `read`)
    reach.reach(`read`)
    cleanup()
    await client.cleanup()
    checkDescriptorStart(observe(), history, `cleaned`)
    reach.reach(`cleaned`)
    reach.assertReached()
  }, [() => cleanup(), () => client.cleanup()])
}

it.each(
  descriptorStartHistories.flatMap((history) =>
    hooks.map((hook) => ({ history, hook })),
  ),
)(`releases independent descriptor starts in React: %j`, ({ history, hook }) =>
  checkHistory(history, hook),
)

it.each([
  `blocked-peer`,
  `duplicate-start`,
  `leaked-resource`,
  `wrong-row`,
] as const)(`rejects wrong multi-source release observation: %s`, (fault) => {
  const history = { acquired: 3, failedStarts: 3, eagerStarts: 7 }
  const actual = expectedDescriptorStart(history, `cleaned`)
  checkDescriptorStart(actual, history, `cleaned`)
  if (fault === `blocked-peer`) actual.starts[2] = 0
  if (fault === `duplicate-start`) actual.starts[2] = actual.starts[2]! + 1
  if (fault === `leaked-resource`) actual.cleanups[2] = 0
  if (fault === `wrong-row`) actual.rows[2] = [{ id: `bad`, value: `bad` }]
  expect(() => checkDescriptorStart(actual, history, `cleaned`)).toThrow()
})

declareOracle({
  check: [checkDescriptorStart],
  model: [expectedDescriptorStart],
  grammar: [descriptorStartHistories],
})
