// @vitest-environment node
/**
 * Independent receiving histories own independent browser contexts. A completed
 * history leaves no SDK worker alive in its browser. Closing the SDK database
 * alone need not terminate a SharedWorker while its document remains alive.
 * This fixture law bounds resources without changing the default SDK path or
 * any within-history cleanup, restart, or storage-reopen observation.
 */
import { fc } from '@fast-check/vitest'
import { afterAll, beforeAll } from 'vitest'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { nativeDecodeViolations } from '../../powersync-db-collection/tests/batch-decode-oracle'
import { startAdapterChromium } from './adapter-chromium-host'
import type { Observation } from '../../db/tests/oracle-property'
import type { NativeDecodeHistory } from '../../powersync-db-collection/tests/batch-decode-oracle'

let host: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  host = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/native-powersync-receiving.opfs.html`,
    ready: `runNativePowerSyncBatchDecode`,
  })
}, 120_000)
afterAll(async () => host?.close(), 120_000)
let sequence = 0
const states = [`native-history`, `repeated-history`]

const constructed = Array.from({ length: 5 }, (_, index) => ({
  name: `independent native contexts ${index + 1}`,
  enters: states,
  build: (h: {
    histories: number
    rows: number
    batchSize: number
    coordinate: number
  }) => ({ ...h, coordinate: ((h.coordinate + index - 1) % 20) + 1 }),
}))

oracleProperty({
  id: `adapter-browser.native-context`,
  owns: [`tests/adapter-chromium-host.ts#startAdapterChromium`],
  law: {
    statement: `A complete native receiving history preserves its product observation and releases its context's SDK workers before the next independent history.`,
    authority: `The receiving fixture owns context teardown. Its histories use distinct databases and claim no cross-history persistence; oracle-rubric ORC-010 requires resource release without loss of the primary observation.`,
    limits: `Default browser SDK and completed native decode histories with one to six rows and batch sizes one to three, two or three independent histories per input. No inference about the cause of a GitHub runner shutdown or SDK-level worker-close policy.`,
  },
  histories: {
    arbitrary: fc.record({
      histories: fc.integer({ min: 2, max: 3 }),
      rows: fc.integer({ min: 1, max: 6 }),
      batchSize: fc.integer({ min: 1, max: 3 }),
      coordinate: fc.integer({ min: 1, max: 20 }),
    }),
    runs: 4,
    fixedSeeds: [2377],
    states,
    constructed,
  },
  // The resource model knows only history boundaries. It does not implement
  // SDK close or browser worker ownership: no context survives its own history.
  model: (h) => Array.from({ length: h.histories }, () => 0),
  driver: async (h, observe) => {
    const active = host
    if (!active) throw new Error(`Native context receiving host did not start`)
    const browser = active.page.context().browser()!
    const cdp = await browser.newBrowserCDPSession()
    const closed = await retainOracleCleanupObservation(async () => {
      for (let index = 0; index < h.histories; index++) {
        const input: NativeDecodeHistory = {
          mode: `eager`,
          phase: `initial`,
          outcome: `valid`,
          count: h.rows,
          batchSize: h.batchSize,
          refusalIndex: 0,
          transformKeys: true,
          overlap: false,
          coordinate: h.coordinate,
          epoch: 3000,
        }
        const result = await active.captureFreshHistory((page) =>
          page.evaluate(
            ({ input: history, id }) =>
              window.runNativePowerSyncBatchDecode(history, id),
            { input, id: `context-resource-${sequence++}` },
          ),
        )
        const { targetInfos } = await cdp.send(`Target.getTargets`)
        const remaining = targetInfos.filter((target) =>
          [`worker`, `shared_worker`].includes(target.type),
        ).length
        const productErrors = nativeDecodeViolations(input, result)
        observe(`history`, {
          remaining,
          productErrors,
          cleanupErrors: result.cleanupErrors ?? [],
          browserErrors: result.browserErrors,
        })
        // Actual SQLite page delivery supplies reach; an SDK update that closes
        // its own worker is allowed and does not invalidate this fixture law.
        if (result.sourceBatches.some((batch) => batch.length > 0)) {
          observe(`reach`, `native-history`)
          if (index > 0) observe(`reach`, `repeated-history`)
        }
      }
      return { cleanupErrors: [] as ReadonlyArray<string> }
    }, [() => cdp.detach()])
    observe(`driver cleanup`, closed.cleanupErrors)
  },
  check: (_h, trace, expected) => {
    const completed = trace
      .filter((entry) => entry.checkpoint === `history`)
      .map((entry) => entry.value) as Array<{
      remaining: number
      productErrors: Array<string>
      cleanupErrors: Array<string>
      browserErrors: Array<string>
    }>
    const driverCleanup = (trace.find(
      (entry) => entry.checkpoint === `driver cleanup`,
    )?.value ?? []) as ReadonlyArray<string>
    if (
      completed.length !== expected.length ||
      completed.some(
        (entry, index) =>
          entry.remaining !== expected[index] ||
          entry.productErrors.length ||
          entry.cleanupErrors.length ||
          entry.browserErrors.length,
      )
    )
      return violation(
        `after history`,
        `native history retained resources or failed`,
        `history resources`,
        {
          actual: { completed, driverCleanup },
          expected,
        },
      )
    if (driverCleanup.length)
      return violation(
        `driver cleanup`,
        driverCleanup.join(`; `),
        `history resources`,
      )
    for (const state of states)
      if (
        !trace.some(
          (entry) => entry.checkpoint === `reach` && entry.value === state,
        )
      )
        return violation(`reach`, `missing ${state}`, `history reach`)
    return pass
  },
  calibrations: constructed.flatMap((builder) =>
    states.map((state) => ({
      name: `${builder.name} cannot omit ${state}`,
      law: `history reach`,
      history: { constructed: builder.name },
      corrupt: (trace: ReadonlyArray<Observation>) =>
        trace.filter(
          (entry) => entry.checkpoint !== `reach` || entry.value !== state,
        ),
    })),
  ),
})
