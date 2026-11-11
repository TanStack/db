/**
 * Real Query and both Node storage hosts receive the ownership oracle's same
 * independent fetch/write judgment. Framework constructions keep random values
 * and neighboring actions while ensuring every required order is exercised.
 * Fixed regressions remain in the generated language and supply no reach.
 */
import fc from 'fast-check'
import { describe } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { observePersistedPrecedence } from './persisted-precedence-driver'
import {
  expectedPersistedPrecedence,
  precedenceHistories,
  precedenceReached,
  precedenceStates,
  precedenceValues,
  precedenceViolations,
} from './persisted-precedence-oracle'
import type {
  PrecedenceHistory,
  PrecedenceObservation,
} from './persisted-precedence-oracle'
import type {
  ConstructedHistory,
  Observation,
} from '../../db/tests/oracle-property'
import type { MergeRow } from './direct-write-precedence-oracle'

const writable = {
  shape: fc.constantFrom('raw' as const, 'derived' as const),
  op: fc.constantFrom(
    'insert' as const,
    'update' as const,
    'delete' as const,
    'upsert' as const,
  ),
  laterFetch: fc.boolean(),
  value: fc.integer({ min: -10, max: 10 }),
}
// Records preserve the previous union and branch weights, while accepting
// fixed/constructed objects without a fast-check map's private shrink context.
const historyArb: fc.Arbitrary<PrecedenceHistory> = fc.oneof(
  fc.oneof(
    fc.record({ ...writable, phase: fc.constant('before-result' as const) }),
    fc.record({ ...writable, phase: fc.constant('before-fetch' as const) }),
    fc.record({
      ...writable,
      phase: fc.constant('during-baseline' as const),
      scanCut: fc.constantFrom('before-read' as const, 'after-read' as const),
    }),
  ),
  fc.record({
    ...writable,
    phase: fc.constant('before-restore' as const),
    op: fc.constantFrom('insert' as const, 'upsert' as const),
  }),
  fc.record({
    ...writable,
    origin: fc.constant('cache' as const),
    phase: fc.constant('during-baseline' as const),
    scanCut: fc.constantFrom('before-read' as const, 'after-read' as const),
  }),
)
const constructedStates = new WeakMap<
  PrecedenceHistory,
  ReadonlyArray<string>
>()
const base = (h: PrecedenceHistory) => ({
  shape: h.shape,
  op: h.op,
  laterFetch: h.laterFetch,
  value: h.value,
})
function constructState(
  h: PrecedenceHistory,
  state: string,
): PrecedenceHistory {
  if (state === 'raw' || state === 'derived') return { ...h, shape: state }
  if (state === 'fetched-result') {
    const { origin: _origin, ...fetched } = h
    return fetched
  }
  if (state === 'cached-result')
    return {
      ...base(h),
      origin: 'cache',
      phase: 'during-baseline',
      scanCut: 'before-read',
    }
  if (state === 'before-result' || state === 'before-fetch')
    return { ...base(h), phase: state }
  if (state === 'before-restore')
    return {
      ...base(h),
      phase: state,
      op: h.op === 'upsert' ? 'upsert' : 'insert',
    }
  if (
    state === 'during-baseline' ||
    state === 'before-read' ||
    state === 'after-read'
  )
    return {
      ...base(h),
      ...(h.origin === 'cache' ? { origin: 'cache' as const } : {}),
      phase: 'during-baseline',
      scanCut: state === 'after-read' ? 'after-read' : 'before-read',
    }
  if (state === 'later-fetch') return { ...h, laterFetch: true }
  if (
    state === 'insert' ||
    state === 'update' ||
    state === 'delete' ||
    state === 'upsert'
  )
    return h.phase === 'before-restore' &&
      (state === 'update' || state === 'delete')
      ? { ...base(h), phase: 'before-result', op: state }
      : ({ ...h, op: state } as PrecedenceHistory)
  throw new Error('Unknown precedence construction state: ' + state)
}
const constructed: Array<ConstructedHistory<PrecedenceHistory>> =
  precedenceStates.map((state) => ({
    name: state,
    enters: [state],
    build: (h) => {
      const built = constructState(h, state)
      // A fresh identity per invocation avoids the pinned framework's builder
      // map collision; this ledger also guards its generated constructions.
      constructedStates.set(built, [state])
      return built
    },
  }))

declareOracle({ owns: ['src/query.ts#queryCollectionOptions'] })
for (const host of ['controlled', 'node-sqlite'] as const)
  describe('persisted precedence through ' + host, () => {
    let sequence = 0
    oracleProperty({
      id: 'query.persisted-write-precedence',
      law: {
        statement:
          'An older source result preserves accepted newer direct writes while removing omitted saved rows; a later fetch can replace them.',
        authority:
          'Query collection guide: Direct Writes and Query Sync; Individual Write Operations.',
        owner: 'Query ownership lifecycle; persisted precedence receiving path',
        limits:
          'One eager run, three saved keys, one direct write, raw/derived response, optional later fetch; no peer writer or failed I/O.',
      },
      histories: {
        arbitrary: historyArb,
        runs: 80,
        fixedSeeds: [2394],
        states: precedenceStates,
        constructed,
        fixed: precedenceHistories.map((history, i) => ({
          name: String(i),
          history,
        })),
      },
      model: expectedPersistedPrecedence,
      driver: async (h, observe) => {
        const storage = createStartupHost(host)
        await withOracleCleanup(async () => {
          await observePersistedPrecedence(
            storage.persistence,
            h,
            'precedence-' + host + '-' + sequence++,
            undefined,
            observe,
          )
          for (const state of precedenceReached(h)) observe('reach', state)
        }, [() => storage.close()])
      },
      check: (h, trace, expected) => {
        // Judge recorded cuts first. A later driver/cleanup failure cannot hide
        // an already recorded wrong public, durable or cache observation.
        for (const observation of trace) {
          if (!(observation.checkpoint in expected)) continue
          const cut = observation.checkpoint as keyof typeof expected
          const owed = expected[cut]
          if (owed === undefined) continue
          const mismatch = differs(
            cut,
            'write precedence',
            precedenceValues(observation.value as Array<MergeRow<number>>),
            owed,
          )
          if (mismatch) return mismatch
        }
        const completed = trace.find((o) => o.checkpoint === 'completed')
        if (!completed)
          return violation(
            'completed',
            'the receiving history did not complete',
            'write precedence',
          )
        const failures = precedenceViolations(
          h,
          completed.value as PrecedenceObservation,
        )
        if (failures.length)
          return violation('completed', failures.join('; '), 'write precedence')
        const reached = new Set(
          trace.filter((o) => o.checkpoint === 'reach').map((o) => o.value),
        )
        const missing = (constructedStates.get(h) ?? []).filter(
          (state) => !reached.has(state),
        )
        return missing.length
          ? violation(
              'constructed states',
              'Missing generated construction states: ' + missing.join(', '),
              'constructed reach',
            )
          : pass
      },
      calibrations: [
        ...(['first', 'firstDurable'] as const).map((cut) => ({
          name: 'loses a newer inserted row at ' + cut,
          law: 'write precedence',
          corrupt: (
            trace: ReadonlyArray<Observation>,
            h: PrecedenceHistory,
          ) => {
            if (h.op !== 'insert' || h.phase === 'before-fetch')
              return undefined
            return trace.map((o) =>
              o.checkpoint === cut
                ? {
                    ...o,
                    value: (o.value as Array<MergeRow<number>>).filter(
                      (row) => row.id !== 'new',
                    ),
                  }
                : o,
            )
          },
        })),
        ...precedenceStates.map((state) => ({
          name: 'omits constructed state ' + state,
          law: 'constructed reach',
          corrupt: (trace: ReadonlyArray<Observation>, h: PrecedenceHistory) =>
            constructedStates.get(h)?.includes(state)
              ? trace.filter(
                  (o) => o.checkpoint !== 'reach' || o.value !== state,
                )
              : undefined,
        })),
      ],
      timeout: 60_000,
    })
  })
