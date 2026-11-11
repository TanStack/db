// @vitest-environment jsdom
// Query's client runtime schedules the stale callback; the SQLite host stays real.
import { describe } from 'vitest'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  arbitrary,
  constructed,
  cutoffViolations,
  expected,
  obligations,
  observeCutoff,
  states,
} from './persisted-rejected-write-cutoff-oracle'
import type { History, Trace } from './persisted-rejected-write-cutoff-oracle'


for (const host of ['controlled', 'node-sqlite'] as const)
  describe(host, () => {
    let sequence = 0
    oracleProperty({
      id: 'query.persisted-rejected-write-cutoff',
      law: {
        statement:
          'A rejected direct write and stale observer callback leave a fetched cache authoritative for an Infinity-stale peer acquisition.',
        authority:
          'Query guide Understanding the Data Stores item 1, Direct Writes and Query Sync; Query Core staleTime and refetchOnMount; primary ownership direct-write-order judgment.',
        limits:
          'Empty eager persisted startup, one successful fetched row, rejected missing-key update/delete, raw or direct wrapped array; no accepted mutation, invalidation, failed I/O or concurrent writer.',
      },
      owns: ['src/query.ts#queryCollectionOptions'],
      histories: {
        arbitrary,
        runs: 20,
        fixedSeeds: [1794],
        states,
        constructed,
      },
      model: expected,
      driver: async (h, observe) => {
        const storage = createStartupHost(host)
        await withOracleCleanup(
          () =>
            observeCutoff(
              storage.persistence,
              h,
              'cutoff-' + host + '-' + sequence++,
              observe,
            ),
          [() => storage.close()],
        )
      },
      check: (h, trace) => {
        const bad = cutoffViolations(h, trace)[0]
        return bad
          ? violation(bad.checkpoint, bad.difference, 'fetched cache authority')
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
              ? trace.filter(
                  (o) => o.checkpoint !== 'reach' || o.value !== state,
                )
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
            trace.map((o) =>
              o.checkpoint === 'peer' ? { ...o, value: [] } : o,
            ),
        },
      ],
    })
  })
