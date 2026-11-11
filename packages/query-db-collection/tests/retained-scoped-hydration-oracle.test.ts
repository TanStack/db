/**
 * The scope and cached-first-claim laws receive controlled storage and real
 * SQLite through their unchanged shared drivers and judgments. Randomized
 * constructions enforce required states without crediting fixed histories.
 */
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
import {
  observeCachedPeerClaim,
  observeRetainedScopedHydration,
  requestedRetainedScope,
} from './retained-scoped-hydration-driver'
import {
  cachedPeerClaimHistories,
  cachedPeerClaimHistoryArb,
  cachedPeerClaimReached,
  cachedPeerClaimStates,
  cachedPeerClaimViolations,
  expectedCachedPeerClaim,
  expectedScopedHydration,
  scopedHydrationHistories,
  scopedHydrationHistoryArb,
  scopedHydrationReached,
  scopedHydrationStates,
  scopedHydrationViolations,
} from './retained-scoped-hydration-oracle'
import type {
  CachedPeerClaimHistory,
  CachedPeerClaimObservation,
  ScopedHydrationHistory,
  ScopedHydrationObservation,
} from './retained-scoped-hydration-oracle'
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import type {
  ConstructedHistory,
  Observation,
  Verdict,
} from '../../db/tests/oracle-property'

const scopedConstructedStates = new WeakMap<
  ScopedHydrationHistory,
  ReadonlyArray<string>
>()
const cachedConstructedStates = new WeakMap<
  CachedPeerClaimHistory,
  ReadonlyArray<string>
>()
function constructScope(
  h: ScopedHydrationHistory,
  state: string,
): ScopedHydrationHistory {
  const built = { ...h }
  if (state === 'first-a') built.first = 'a'
  else if (state === 'first-b') built.first = 'b'
  else if (state === 'empty-result') built.next = 0
  else if (state === 'nonempty-result') built.next ||= 1
  else if (state === 'unrequested-saved-rows') built.otherPrevious ||= 1
  else if (state === 'omitted-owned-row') {
    built.previous = 3
    built.next &= ~1
  } else if (state === 'ownerless-first') built.ownerless = 'first'
  else if (state === 'ownerless-other') built.ownerless = 'other'
  else if (state === 'no-ownerless') built.ownerless = 'none'
  else if (state === 'unbounded') built.window = 'all'
  else if (state === 'limited') built.window = 'one'
  else if (state === 'limited-ownerless-restored') {
    built.window = 'one'
    built.ownerless = 'first'
  } else throw new Error('Unknown scope construction state: ' + state)
  return built
}
const scopeConstructions: Array<ConstructedHistory<ScopedHydrationHistory>> =
  scopedHydrationStates.map((state) => ({
    name: state,
    enters: [state],
    build: (h) => {
      const built = constructScope(h, state)
      scopedConstructedStates.set(built, [state])
      return built
    },
  }))
const differentValue = (value: number) => (value === 10 ? -10 : value + 1)
const cacheConstructions: Array<ConstructedHistory<CachedPeerClaimHistory>> =
  cachedPeerClaimStates.map((state) => ({
    name: state,
    enters: [state],
    build: (h) => {
      const built = { ...h }
      if (state === 'manual' || state === 'older-fetch') built.cache = state
      else if (
        state === 'different-cached-value' &&
        built.cached === built.current
      )
        built.cached = differentValue(built.current)
      else if (state === 'later-value-change' && built.later === built.current)
        built.later = differentValue(built.current)
      // Each invocation returns a fresh identity. The local ledger enforces
      // generated outputs too, which the pinned framework does not associate.
      cachedConstructedStates.set(built, [state])
      return built
    },
  }))

/** Compare captured prefixes before completeness, preserving earlier failures. */
function checkReceivingTrace(
  trace: ReadonlyArray<Observation>,
  expected: Record<string, unknown>,
  completedCheck: (actual: unknown) => Array<string>,
  required: ReadonlyArray<string>,
  law: string,
): Verdict {
  for (const { checkpoint, value } of trace) {
    if (!(checkpoint in expected)) continue
    const mismatch = differs(checkpoint, law, value, expected[checkpoint])
    if (mismatch) return mismatch
  }
  const completed = trace.find((o) => o.checkpoint === 'completed')
  if (!completed)
    return violation('completed', 'the receiving history did not complete', law)
  const failures = completedCheck(completed.value)
  if (failures.length) return violation('completed', failures.join('; '), law)
  const reached = new Set(
    trace.filter((o) => o.checkpoint === 'reach').map((o) => o.value),
  )
  const missing = required.filter((state) => !reached.has(state))
  return missing.length
    ? violation(
        'constructed states',
        'Missing generated construction states: ' + missing.join(', '),
        'constructed reach',
      )
    : pass
}
function omitConstructedState(
  trace: ReadonlyArray<Observation>,
  required: ReadonlyArray<string>,
): ReadonlyArray<Observation> | undefined {
  const [state] = required
  return state === undefined
    ? undefined
    : trace.filter((o) => o.checkpoint !== 'reach' || o.value !== state)
}

declareOracle({ owns: ['src/query.ts#queryCollectionOptions'] })
for (const host of ['controlled', 'node-sqlite'] as const)
  describe('retained scoped hydration through ' + host, () => {
    let sequence = 0
    oracleProperty({
      id: 'query.retained-scoped-hydration',
      law: {
        statement:
          'An on-demand persisted Collection restores only acquired demand; limited results cannot prove ownerless-row omission or retire a retained broader owner.',
        authority:
          'SQLite persistence guide: Persist a collection; Query guide: QueryFn and Predicate Push-Down, Direct Writes and Query Sync.',
        owner:
          'Query ownership lifecycle; retained scoped hydration receiving path',
        limits:
          'Two disjoint scopes, one cold reopen, all/one-row demands, numeric values and successful I/O; no peer writer or rotation.',
      },
      histories: {
        arbitrary: scopedHydrationHistoryArb,
        runs: 60,
        fixedSeeds: [1481],
        states: scopedHydrationStates,
        constructed: scopeConstructions,
        fixed: scopedHydrationHistories.map((history, i) => ({
          name: String(i),
          history,
        })),
      },
      model: expectedScopedHydration,
      driver: async (h, observe) => {
        const storage = createStartupHost(host)
        if (host === 'controlled') {
          // The fake host supplies only demand evaluation over stored facts;
          // real SQLite evaluates the same predicate and limit itself.
          const adapter: PersistenceAdapter = storage.persistence.adapter
          const loadSubset = adapter.loadSubset
          adapter.loadSubset = async (target, options, context) => {
            const entries = await loadSubset(target, options, context)
            if (!options.where) return entries
            const scope = requestedRetainedScope(options)
            const matching = entries.filter((row) => row.value.scope === scope)
            if (options.limit === undefined) return matching
            return matching
              .sort((a, b) => String(b.key).localeCompare(String(a.key)))
              .slice(0, options.limit)
          }
        }
        await withOracleCleanup(async () => {
          await observeRetainedScopedHydration(
            storage.persistence,
            h,
            'scoped-' + host + '-' + sequence++,
            undefined,
            observe,
          )
          for (const state of scopedHydrationReached(h)) observe('reach', state)
        }, [() => storage.close()])
      },
      check: (h, trace, expected) =>
        checkReceivingTrace(
          trace,
          expected,
          (actual) =>
            scopedHydrationViolations(h, actual as ScopedHydrationObservation),
          scopedConstructedStates.get(h) ?? [],
          'scope restoration',
        ),
      calibrations: [
        {
          name: 'publishes unrequested saved rows from a full-store restore',
          law: 'scope restoration',
          corrupt: (trace) => {
            const first = trace.find((o) => o.checkpoint === 'first')
            const durable = trace.find((o) => o.checkpoint === 'firstDurable')
            if (
              !first ||
              !durable ||
              JSON.stringify(first.value) === JSON.stringify(durable.value)
            )
              return undefined
            return trace.map((o) =>
              o.checkpoint === 'first' ? { ...o, value: durable.value } : o,
            )
          },
        },
        ...scopedHydrationStates.map((state) => ({
          name: 'omits constructed state ' + state,
          law: 'constructed reach',
          corrupt: (
            trace: ReadonlyArray<Observation>,
            h: ScopedHydrationHistory,
          ) =>
            scopedConstructedStates.get(h)?.includes(state)
              ? omitConstructedState(trace, [state])
              : undefined,
        })),
        {
          name: 'loses durable rows while public rows remain correct',
          law: 'scope restoration',
          corrupt: (trace) => {
            const durable = trace.find((o) => o.checkpoint === 'firstDurable')
            if (!Array.isArray(durable?.value) || durable.value.length === 0)
              return undefined
            return trace.map((o) =>
              o.checkpoint === 'firstDurable' ? { ...o, value: [] } : o,
            )
          },
        },
      ],
    })
    oracleProperty({
      id: 'query.cached-peer-claim',
      law: {
        statement:
          'A cached Query first claim cannot replace a continuously owned later-fetched value; a later physical refetch can.',
        authority:
          'Query collection guide: Direct Writes and Query Sync, per-key fetch order and cache patches without successful-fetch authority.',
        owner:
          'Query ownership lifecycle; persisted cached peer claim receiving path',
        limits:
          'One overlapping key and QueryClient, manual/older fetched cache, later refetch, numeric values and successful I/O.',
      },
      histories: {
        arbitrary: cachedPeerClaimHistoryArb,
        runs: 60,
        fixedSeeds: [1376],
        states: cachedPeerClaimStates,
        constructed: cacheConstructions,
        fixed: cachedPeerClaimHistories.map((history, i) => ({
          name: String(i),
          history,
        })),
      },
      model: expectedCachedPeerClaim,
      driver: async (h, observe) => {
        const storage = createStartupHost(host)
        await withOracleCleanup(async () => {
          await observeCachedPeerClaim(
            storage.persistence,
            h,
            'cached-claim-' + host + '-' + sequence++,
            undefined,
            observe,
          )
          for (const state of cachedPeerClaimReached(h)) observe('reach', state)
        }, [() => storage.close()])
      },
      check: (h, trace, expected) =>
        checkReceivingTrace(
          trace,
          expected,
          (actual) =>
            cachedPeerClaimViolations(h, actual as CachedPeerClaimObservation),
          cachedConstructedStates.get(h) ?? [],
          'cached claim authority',
        ),
      calibrations: [
        ...(['claimed', 'claimedDurable'] as const).map((cut) => ({
          name:
            'overwrites a continuously owned value from stale cache at ' + cut,
          law: 'cached claim authority',
          corrupt: (
            trace: ReadonlyArray<Observation>,
            h: CachedPeerClaimHistory,
          ) =>
            h.cached === h.current
              ? undefined
              : trace.map((o) =>
                  o.checkpoint === cut ? { ...o, value: h.cached } : o,
                ),
        })),
        ...cachedPeerClaimStates.map((state) => ({
          name: 'omits constructed state ' + state,
          law: 'constructed reach',
          corrupt: (
            trace: ReadonlyArray<Observation>,
            h: CachedPeerClaimHistory,
          ) =>
            cachedConstructedStates.get(h)?.includes(state)
              ? omitConstructedState(trace, [state])
              : undefined,
        })),
      ],
    })
  })
