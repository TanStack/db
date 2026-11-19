// Actual Chromium calibrations for the receiving transport, not product laws.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { deliverQueryHistory } from '../e2e/query-ownership-browser-support'
import {
  cutoffViolations,
  obligations,
} from '../../query-db-collection/tests/persisted-rejected-write-cutoff-oracle'
import { untilStartup } from '../../db-adapter-conformance/tests/persisted-startup-driver'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from './adapter-chromium-host'
import type {
  History,
  Trace,
} from '../../query-db-collection/tests/persisted-rejected-write-cutoff-oracle'
import type { ReceiverFault } from '../e2e/query-rejected-write-cutoff.opfs'
import type { QueryReceivingResult } from '../e2e/query-ownership-browser-support'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
let sequence = 0
const history: History = {
  shape: 'raw',
  write: 'during-update',
  firstValue: 1,
  nextValue: 2,
  staleMs: 10,
}
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry:
      '/packages/browser-db-sqlite-persistence/e2e/query-rejected-write-cutoff.opfs.html',
    ready: 'runCutoffCandidate',
  })
}, 120000)
afterAll(async () => {
  await browser?.close()
}, 120000)
async function receive(fault?: ReceiverFault) {
  if (!browser) throw new Error('Missing Chromium receiver')
  const host = browser
  const result = await captureBrowserHistory(host, () =>
    host.page.evaluate(
      ({ h, id, kind }) =>
        (
          window as unknown as {
            runCutoffCandidate: (
              h: History,
              id: string,
              fault?: ReceiverFault,
            ) => Promise<QueryReceivingResult>
          }
        ).runCutoffCandidate(h, id, kind),
      { h: history, id: 'cutoff-fidelity-' + sequence++, kind: fault },
    ),
  )
  const trace: Trace = [{ checkpoint: 'browserReceiver', value: true }]
  let error: unknown
  try {
    deliverQueryHistory(result, (checkpoint, value) =>
      trace.push({ checkpoint, value }),
    )
  } catch (thrown) {
    error = thrown
  }
  return { result, trace, error, failures: cutoffViolations(history, trace) }
}
async function detached(message: string) {
  if (!browser) throw new Error('Missing Chromium receiver')
  const host = browser
  const before = host.errors.length
  await host.page.evaluate((text) => {
    setTimeout(() => {
      throw new Error(text)
    }, 0)
  }, message)
  await untilStartup(() => host.errors.length > before)
}
it('rejects a bootstrap page error even when the entry becomes ready', async () => {
  await expect(
    startAdapterChromium({
      entry:
        '/packages/browser-db-sqlite-persistence/e2e/query-rejected-write-cutoff-bootstrap-error.html',
      ready: 'runCutoffCandidate',
    }),
  ).rejects.toThrow('Browser startup failed')
}, 120000)
it('keeps a recorded product mismatch before a cleanup failure', async () => {
  const captured = await receive('mismatch-cleanup')
  expect(captured.failures[0]?.checkpoint).toBe('peerFetches')
  expect(captured.error).toBeInstanceOf(Error)
  expect((captured.error as Error).message).toBe('cutoff cleanup fault')
  expect(captured.result.trace.some((o) => o.checkpoint === 'completed')).toBe(
    true,
  )
}, 120000)
it('keeps the cleanup failure when the product trace passes', async () => {
  const captured = await receive('cleanup')
  expect(captured.failures).toEqual([])
  expect(captured.error).toBeInstanceOf(Error)
  expect((captured.error as Error).message).toBe('cutoff cleanup fault')
}, 120000)
it('keeps a product mismatch before a detached browser error', async () => {
  await detached('detached-product-neighbor')
  const captured = await receive('mismatch-only')
  expect(captured.failures[0]?.checkpoint).toBe('peerFetches')
  expect(captured.error).toBeUndefined()
  expect(captured.failures[0]?.difference).toContain(
    'detached-product-neighbor',
  )
  expect(captured.result.browserErrors).toContain('detached-product-neighbor')
}, 120000)
it('reports a detached browser error against a clean product trace', async () => {
  await detached('detached-clean-neighbor')
  const captured = await receive()
  expect(captured.failures[0]?.checkpoint).toBe('browserErrors')
  expect(captured.failures[0]?.law).toBe('browser receiving fidelity')
}, 120000)
it('consumes between-history browser errors once', async () => {
  await detached('between-history-error')
  const first = await receive()
  expect(first.result.browserErrors).toContain('between-history-error')
  const second = await receive()
  expect(second.result.browserErrors).toEqual([])
  expect(second.failures).toEqual([])
}, 120000)

it('keeps an earlier recorded count mismatch when later facts never arrive', async () => {
  const captured = await receive('prefix-cleanup')
  expect(captured.failures[0]?.checkpoint).toBe('firstFetches')
  expect(captured.result.trace.some((o) => o.checkpoint === 'afterStale')).toBe(
    false,
  )
  expect(captured.error).toBeInstanceOf(Error)
}, 120000)
it('retries a transient busy cleanup and records it', async () => {
  const captured = await receive('transient-busy')
  expect(captured.error).toBeUndefined()
  expect(captured.failures).toEqual([])
  expect(
    captured.result.trace.filter((o) => o.checkpoint === 'opfsCleanupRetry'),
  ).toHaveLength(1)
}, 120000)
it('preserves a permanent busy cleanup failure', async () => {
  const captured = await receive('permanent-busy')
  expect(captured.failures).toEqual([])
  expect(captured.error).toBeInstanceOf(Error)
  expect((captured.error as Error).name).toBe('NoModificationAllowedError')
  expect(
    captured.result.trace.filter((o) => o.checkpoint === 'opfsCleanupRetry'),
  ).toHaveLength(3)
}, 120000)
it('keeps the product mismatch when busy cleanup never succeeds', async () => {
  const captured = await receive('mismatch-permanent-busy')
  expect(captured.failures[0]?.checkpoint).toBe('peerFetches')
  expect((captured.error as Error).name).toBe('NoModificationAllowedError')
  expect(
    captured.result.trace.filter((o) => o.checkpoint === 'opfsCleanupRetry'),
  ).toHaveLength(3)
}, 120000)

it('retains browser diagnostics beside a missing constructed state', async () => {
  await detached('detached-constructed-neighbor')
  const captured = await receive()
  const built = { ...history }
  obligations.set(built, ['stale-callback-delivered'])
  const trace = captured.trace.filter(
    (o) => o.checkpoint !== 'reach' || o.value !== 'stale-callback-delivered',
  )
  const failures = cutoffViolations(built, trace)
  expect(failures[0]?.checkpoint).toBe('constructed states')
  expect(failures[0]?.difference).toContain('detached-constructed-neighbor')
}, 120000)
