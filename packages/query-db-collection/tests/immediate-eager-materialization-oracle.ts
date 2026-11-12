/**
 * Shared Node and Chromium receiving judgment.
 * Receiving extension of the primary Query cache-to-Collection projection law.
 *
 * Query guide Initial Data says nonpersisted eager initialData is immediately
 * materialized. Existing exact-key cache takes precedence over an initializer.
 * The ordinary cached-query receiver already checks rows and ready status when
 * createCollection({startSync:true}) returns. This judgment protects that
 * synchronous publication cut, rather than introducing preload promise timing.
 *
 * The primary ownership oracle owns acquisition and cache projection. This
 * small input projection adds the previously missing first-startup observation:
 * authored source rows determine rows, existing cache suppresses initialization,
 * and a fresh disabled Query starts no request. It does not duplicate observer
 * scheduling or invent another subsystem state machine.
 *
 * Histories cross initialData/cache, raw/derived response documents,
 * literal/function initialization, and empty/nonempty unique numeric rows.
 * No persistence, mutations, stale data, fetching, or promise timing is claimed.
 */
import fc from 'fast-check'
import type {
  ConstructedHistory,
  Observation,
  OraclePropertyOptions,
  Verdict,
} from '../../db/tests/oracle-property'

export type MaterializedRow = { id: string; value: number }
export type MaterializationResponse =
  Array<MaterializedRow> | { edges: Array<{ node: MaterializedRow }> }
export type ImmediateMaterializationHistory = {
  origin: 'initialData' | 'cache'
  shape: 'raw' | 'derived'
  initializer: 'literal' | 'function'
  rows: Array<MaterializedRow>
}
export type ImmediateMaterializationTrace = Array<Observation>
export const immediateMaterializationHistoryArb = fc.record({
  origin: fc.constantFrom('initialData' as const, 'cache' as const),
  shape: fc.constantFrom('raw' as const, 'derived' as const),
  initializer: fc.constantFrom('literal' as const, 'function' as const),
  rows: fc.uniqueArray(
    fc.record({
      id: fc.constantFrom('1', '2', '3', '4'),
      value: fc.integer({ min: -10, max: 10 }),
    }),
    { selector: (row) => row.id, maxLength: 4 },
  ),
})
export const immediateMaterializationStates = [
  'initialData',
  'cache',
  'raw',
  'derived',
  'empty',
  'nonempty',
  'function-initializer',
  'cache-precedence',
] as const
export const immediateMaterializationHistories: Array<ImmediateMaterializationHistory> =
  (['initialData', 'cache'] as const).flatMap((origin) =>
    (['raw', 'derived'] as const).flatMap((shape) =>
      (['literal', 'function'] as const).flatMap((initializer) =>
        [false, true].map((nonempty) => ({
          origin,
          shape,
          initializer,
          rows: nonempty
            ? [
                { id: '1', value: 7 },
                { id: '2', value: -3 },
              ]
            : [],
        })),
      ),
    ),
  )
const ordered = (rows: Array<MaterializedRow>) =>
  rows
    .map(({ id, value }) => ({ id, value }))
    .sort((a, b) => a.id.localeCompare(b.id))
// Inputs supply normalized authored rows. The response envelope affects the
// production extraction path, but must not change this projection's answer.
export const expectedImmediateMaterialization = (
  h: ImmediateMaterializationHistory,
) => ({
  rows: ordered(h.rows),
  status: 'ready',
  sourceCalls: 0,
  initializerCalls:
    h.origin === 'initialData' && h.initializer === 'function' ? 1 : 0,
})
export type ImmediateMaterializationExpected = ReturnType<
  typeof expectedImmediateMaterialization
>
export function checkImmediateMaterialization(
  h: ImmediateMaterializationHistory,
  trace: ReadonlyArray<Observation>,
  expected = expectedImmediateMaterialization(h),
): Verdict {
  for (const o of trace)
    if (
      o.checkpoint === 'creation-return' &&
      JSON.stringify(o.value) !== JSON.stringify(expected)
    )
      return {
        kind: 'violation',
        checkpoint: o.checkpoint,
        law: 'immediate eager materialization',
        difference:
          'expected ' +
          JSON.stringify(expected) +
          ', observed ' +
          JSON.stringify(o.value),
      }
  if (!trace.some((o) => o.checkpoint === 'completed'))
    return {
      kind: 'violation',
      checkpoint: 'completed',
      law: 'receiving completion',
      difference:
        'receiving driver returned without completing its observations',
    }
  if (!trace.some((o) => o.checkpoint === 'creation-return'))
    return {
      kind: 'violation',
      checkpoint: 'creation-return',
      law: 'immediate receiving observation',
      difference: 'the synchronous creation-return observation is missing',
    }
  return { kind: 'pass' }
}
export type ImmediateMaterializationReceiver = (
  h: ImmediateMaterializationHistory,
  id: string,
  observe: (checkpoint: string, value: unknown) => void,
) => Promise<void>

export function immediateEagerMaterializationOptions(
  receive: ImmediateMaterializationReceiver,
  receiver: string,
): OraclePropertyOptions<
  ImmediateMaterializationHistory,
  ImmediateMaterializationExpected
> {
  const obligations = new WeakMap<
    ImmediateMaterializationHistory,
    ReadonlyArray<string>
  >()
  // These are authored input premises, not production classifications. Fixed
  // replays owe their observed reaches too; all generated builders below keep
  // their separate fresh-output obligations.
  for (const h of immediateMaterializationHistories)
    obligations.set(h, [
      h.origin,
      h.shape,
      h.rows.length ? 'nonempty' : 'empty',
      ...(h.initializer === 'function' ? ['function-initializer'] : []),
      ...(h.origin === 'cache' ? ['cache-precedence'] : []),
    ])
  const constructed: Array<
    ConstructedHistory<ImmediateMaterializationHistory>
  > = immediateMaterializationStates.map((state) => ({
    name: state,
    enters: [state],
    build(h) {
      const built = { ...h, rows: h.rows.map((row) => ({ ...row })) }
      if (state === 'initialData' || state === 'cache') built.origin = state
      if (state === 'raw' || state === 'derived') built.shape = state
      if (state === 'empty') built.rows = []
      if (state === 'nonempty' && built.rows.length === 0)
        built.rows = [{ id: '1', value: 0 }]
      if (state === 'function-initializer') built.initializer = 'function'
      if (state === 'cache-precedence') built.origin = 'cache'
      obligations.set(built, [state])
      return built
    },
  }))
  let sequence = 0
  return {
    id: 'query.immediate-eager-materialization',
    law: {
      statement:
        'Fresh nonpersisted eager initialData and existing exact-key cache materialize rows and readiness when synchronous startup returns.',
      authority:
        'docs/collections/query-collection.md Initial Data; query.test.ts cached-query immediate-read receiver.',
      limits:
        'Fresh disabled eager Query, no persistence or mutations, raw/derived response, at most four unique string-keyed numeric rows. Creation-return cut; no preload promise timing claim.',
    },
    histories: {
      arbitrary: immediateMaterializationHistoryArb,
      runs: 40,
      fixedSeeds: [1468],
      states: immediateMaterializationStates,
      constructed,
      fixed: immediateMaterializationHistories.map((history) => ({
        name: [
          history.origin,
          history.shape,
          history.initializer,
          history.rows.length ? 'nonempty' : 'empty',
        ].join('-'),
        history,
      })),
    },
    model: expectedImmediateMaterialization,
    driver: (h, observe) =>
      receive(h, 'immediate-' + receiver + '-' + sequence++, observe),
    check: (h, trace, expected) => {
      const product = checkImmediateMaterialization(h, trace, expected)
      const errors = trace
        .filter((o) => o.checkpoint === 'browserErrors')
        .flatMap((o) => o.value as ReadonlyArray<string>)
      if (product.kind === 'violation')
        return errors.length
          ? {
              ...product,
              difference:
                String(product.difference) +
                '; secondary browser diagnostics: ' +
                errors.join('; '),
            }
          : product
      const reached = new Set(
        trace.filter((o) => o.checkpoint === 'reach').map((o) => o.value),
      )
      const missing = (obligations.get(h) ?? []).filter(
        (state) => !reached.has(state),
      )
      if (missing.length)
        return {
          kind: 'violation',
          checkpoint: 'constructed states',
          law: 'constructed reach',
          difference:
            missing.join(', ') +
            (errors.length
              ? '; secondary browser diagnostics: ' + errors.join('; ')
              : ''),
        }
      return errors.length
        ? {
            kind: 'violation',
            checkpoint: 'browser diagnostics',
            law: 'detached-browser-error',
            difference: errors.join('; '),
          }
        : { kind: 'pass' }
    },
    calibrations: [
      {
        name: 'rejects an empty normal return',
        law: 'receiving completion',
        corrupt: () => [],
      },
      {
        name: 'rejects a truncated normal return',
        law: 'receiving completion',
        corrupt: (trace) => trace.filter((o) => o.checkpoint !== 'completed'),
      },
      ...immediateMaterializationStates.map((state) => ({
        name: 'omits constructed ' + state,
        law: 'constructed reach',
        corrupt: (
          trace: ReadonlyArray<Observation>,
          h: ImmediateMaterializationHistory,
        ) =>
          obligations.get(h)?.includes(state)
            ? trace.filter((o) => o.checkpoint !== 'reach' || o.value !== state)
            : undefined,
      })),
      {
        name: 'delays immediate rows',
        law: 'immediate eager materialization',
        corrupt: (trace, h) =>
          h.rows.length
            ? trace.map((o) =>
                o.checkpoint === 'creation-return'
                  ? { ...o, value: { ...(o.value as object), rows: [] } }
                  : o,
              )
            : undefined,
      },
      {
        name: 'delays ready status',
        law: 'immediate eager materialization',
        corrupt: (trace) =>
          trace.map((o) =>
            o.checkpoint === 'creation-return'
              ? { ...o, value: { ...(o.value as object), status: 'loading' } }
              : o,
          ),
      },
      {
        name: 'reports detached browser error',
        law: 'detached-browser-error',
        corrupt: (trace) => [
          ...trace,
          { checkpoint: 'browserErrors', value: ['detached browser failure'] },
        ],
      },
      {
        name: 'preserves product failure before browser diagnostics',
        law: 'immediate eager materialization',
        corrupt: (trace) => [
          ...trace.map((o) =>
            o.checkpoint === 'creation-return'
              ? { ...o, value: { ...(o.value as object), status: 'loading' } }
              : o,
          ),
          {
            checkpoint: 'browserErrors',
            value: ['secondary detached failure'],
          },
        ],
      },
    ],
  }
}
