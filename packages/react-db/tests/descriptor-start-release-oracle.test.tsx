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
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  differs,
  oracleProperty,
  oracleRoute,
  pass,
  violation,
} from '../../db/tests/oracle-config'
import { descriptorStartFixture } from '../../db/tests/descriptor-start-release-support'
import { withOracleCleanup } from '../../db/tests/utils'
import type { Observation, Verdict } from '../../db/tests/oracle-config'
import type { DescriptorStartHistory } from '../../db/tests/descriptor-start-release-oracle'

const hooks = [`live`, `infinite`, `suspense`] as const
const descriptorProperties = {
  live: `react.descriptor-start-release.live`,
  infinite: `react.descriptor-start-release.infinite`,
  suspense: `react.descriptor-start-release.suspense`,
} as const
async function recordHistory(
  history: DescriptorStartHistory,
  hook: (typeof hooks)[number],
  record: (checkpoint: string, value: unknown) => void,
) {
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
    record(`preparation error`, rejection === failure)
    record(`acquired factories`, [...factories])
    fixture.retain()
    record(`failed factory visited`, fixture.failures() > 0)
    record(`rejected`, observe())
    for (const [index, row] of fixture.collections().entries()) {
      try {
        row.startSyncImmediate()
      } catch (error) {
        record(`start error`, error === startErrors[index])
      }
    }
    record(`read`, observe())
    cleanup()
    await client.cleanup()
    record(`cleaned`, observe())
  }, [() => cleanup(), () => client.cleanup()])
}

// This receiving model keeps the shared resource law at the same three cuts.
// Error identity is recorded as a relation because generated traces contain no
// runtime resource references. Every old comparison is judged before completeness.
const cuts = [`rejected`, `read`, `cleaned`] as const
function checkRecordedHistory(
  history: DescriptorStartHistory,
  trace: ReadonlyArray<Observation>,
): Verdict {
  for (const { checkpoint, value } of trace) {
    if (cuts.includes(checkpoint as (typeof cuts)[number])) {
      try {
        checkDescriptorStart(
          value as ReturnType<typeof expectedDescriptorStart>,
          history,
          checkpoint as (typeof cuts)[number],
        )
      } catch (error) {
        return violation(
          checkpoint,
          String(error),
          `descriptor resource release`,
        )
      }
    } else {
      const wrong = differs(
        checkpoint,
        `descriptor preparation`,
        value,
        checkpoint === `acquired factories`
          ? expectedDescriptorStart(history, `rejected`).factories
          : true,
      )
      if (wrong) return wrong
    }
  }
  for (const checkpoint of [
    `preparation error`,
    `acquired factories`,
    `failed factory visited`,
    ...cuts,
  ]) {
    if (trace.filter((entry) => entry.checkpoint === checkpoint).length !== 1)
      return violation(
        checkpoint,
        `expected one observation`,
        `descriptor preparation`,
      )
  }
  return pass
}

for (const hook of hooks) {
  oracleProperty({
    id: descriptorProperties[hook],
    law: {
      statement: `Failed descriptor preparation preserves its error and releases each acquired source independently; demand starts lazy sources and cleanup releases each healthy resource once.`,
      authority: `docs/guides/ssr.md descriptor cleanup contract; packages/db/tests/descriptor-start-release-oracle.ts`,
      owner: `packages/db/tests/descriptor-start-release-oracle.ts`,
      limits: `The unchanged finite zero-through-three-source factory and sync-failure grammar, received through real React live, infinite and Suspense hooks; no provider shutdown or concurrent scheduler claim.`,
    },
    histories: descriptorStartHistories,
    model: (history) =>
      cuts.map((cut) => expectedDescriptorStart(history, cut)),
    driver: (history, record) => recordHistory(history, hook, record),
    check: checkRecordedHistory,
  })
}

it.each([
  `blocked-peer`,
  `duplicate-start`,
  `leaked-resource`,
  `wrong-row`,
] as const)(`rejects wrong multi-source release observation: %s`, (fault) => {
  oracleRoute(`calibration`)
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
  owns: [
    `src/useLiveQuery.ts#useLiveQuery`,
    `src/useLiveInfiniteQuery.ts#useLiveInfiniteQuery`,
    `src/useLiveSuspenseQuery.ts#useLiveSuspenseQuery`,
  ],
  check: [checkDescriptorStart, checkRecordedHistory],
  model: [expectedDescriptorStart],
  grammar: [descriptorStartHistories],
})
