import { afterAll, beforeAll, describe } from 'vitest'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import {
  arbitrary,
  constructed,
  cutoffViolations,
  expected,
  obligations,
  states,
} from '../../query-db-collection/tests/persisted-rejected-write-cutoff-oracle'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { deliverQueryHistory } from './query-ownership-browser-support'
import type { QueryReceivingResult } from './query-ownership-browser-support'
import type {
  History,
  Trace,
} from '../../query-db-collection/tests/persisted-rejected-write-cutoff-oracle'

describe('chromium-opfs', () => {
  let sequence = 0
  let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
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
  oracleProperty({
    id: 'query.persisted-rejected-write-cutoff.chromium-opfs',
    law: {
      statement:
        'A rejected direct write and stale observer callback leave a fetched cache authoritative for an Infinity-stale peer acquisition.',
      authority:
        'Query guide Understanding the Data Stores item 1, Direct Writes and Query Sync; Query Core staleTime and refetchOnMount; primary ownership direct-write-order judgment.',
      limits:
        'Empty eager persisted startup, one successful fetched row, rejected missing-key update/delete, raw or direct wrapped array; no accepted mutation, invalidation, failed I/O or concurrent writer.',
    },
    histories: { arbitrary, runs: 20, fixedSeeds: [1794], states, constructed },
    model: expected,
    driver: async (h, observe) => {
      if (!browser) throw new Error('Chromium receiver did not start')
      const host = browser
      const captured = await captureBrowserHistory(host, async () =>
        host.page.evaluate(
          async ({ history, id }) =>
            (
              window as unknown as {
                runCutoffCandidate: (
                  h: History,
                  id: string,
                ) => Promise<QueryReceivingResult>
              }
            ).runCutoffCandidate(history, id),
          { history: h, id: 'cutoff-opfs-' + sequence++ },
        ),
      )
      observe('browserReceiver', true)
      deliverQueryHistory(captured, observe)
    },
    check: (h, trace) => {
      const bad = cutoffViolations(h, trace)[0]
      return bad
        ? violation(
            bad.checkpoint,
            bad.difference,
            bad.law ?? 'fetched cache authority',
          )
        : pass
    },
    calibrations: [
      {
        name: 'keeps an earlier count mismatch on a truncated trace',
        law: 'fetched cache authority',
        corrupt: (trace: ReadonlyArray<Trace[number]>) => {
          const at = trace.findIndex((o) => o.checkpoint === 'firstFetches')
          return at < 0
            ? undefined
            : trace
                .slice(0, at + 1)
                .map((o) =>
                  o.checkpoint === 'firstFetches' ? { ...o, value: 2 } : o,
                )
        },
      },
      ...states.map((state) => ({
        name: 'omits constructed state ' + state,
        law: 'fetched cache authority',
        corrupt: (trace: ReadonlyArray<Trace[number]>, h: History) =>
          obligations.get(h)?.includes(state)
            ? trace.filter((o) => o.checkpoint !== 'reach' || o.value !== state)
            : undefined,
      })),
      {
        name: 'adds a request for a fetched cache',
        law: 'fetched cache authority',
        corrupt: (trace: ReadonlyArray<Trace[number]>) =>
          trace.map((o) =>
            o.checkpoint === 'peerFetches' ? { ...o, value: 2 } : o,
          ),
      },
      {
        name: 'changes peer value without a fetch',
        law: 'fetched cache authority',
        corrupt: (trace: ReadonlyArray<Trace[number]>) =>
          trace.map((o) => (o.checkpoint === 'peer' ? { ...o, value: [] } : o)),
      },
    ],
  })
})
