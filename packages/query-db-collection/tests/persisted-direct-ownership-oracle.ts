/**
 * Persisted receiving extension of the primary Query ownership oracle.
 *
 * The Query guide's Direct Writes and Query Sync law orders direct writes and
 * physical fetches per key. A later complete fetch can claim or remove a direct
 * row; a pre-write result preserves the row without inventing source ownership.
 * Understanding the Data Stores also requires an acquired Collection to project
 * the successful fetched response. With no mutation, refetch owes application.
 *
 * The primary owner's direct-row lifetime judgment owns these claims. This
 * extension adds exact public/durable ownership at the first eager result and
 * crosses saved retention with same-run ownerless writes. Its value judgment
 * reuses that owner's independent mergeDirectWritesOverFetch model. The small
 * ownership projection adds the receiving metadata boundary; it copies no
 * production ownership classifier. It creates no competing primary owner.
 *
 * One first eager response and one inserted/upserted direct key are modeled.
 * Raw/derived responses, retained/unretained saved baselines, both authored
 * fetch/write orders, inclusion/omission and independent saved/direct/source numeric values vary. Saved and direct keys may overlap; overlapping histories use legal upserts.
 * No failed I/O, arbitrary mutations, peers, or eager subset unload is claimed.
 * At every Query adapter write invocation, the declared operation must satisfy
 * SyncConfig.write's ChangeMessageOrDeleteKeyMessage contract: insert, update,
 * or delete. This boundary law constrains neither write counts nor ordering.
 */
import fc from 'fast-check'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { mergeDirectWritesOverFetch } from './direct-write-precedence-oracle'
import type {
  ConstructedHistory,
  Observation,
  OraclePropertyOptions,
  Verdict,
} from '../../db/tests/oracle-property'

export type DirectOwnershipRow = { id: string; value: number }
export type DirectOwnershipResponse =
  Array<DirectOwnershipRow> | { edges: Array<{ node: DirectOwnershipRow }> }
export type DirectOwnershipHistory = {
  shape: 'raw' | 'derived'
  retained: boolean
  write: 'before-fetch' | 'after-fetch-start'
  operation: 'insert' | 'upsert'
  includesDirect: boolean
  keepsSaved: boolean
  directValue: number
  sourceValue: number
  savedValue: number
  overlapsSaved: boolean
}
export type OwnedDirectRow = DirectOwnershipRow & { owners: Array<string> }
export type DirectOwnershipTrace = Array<Observation>
export const directOwnershipHistoryArb = fc
  .record({
    shape: fc.constantFrom('raw' as const, 'derived' as const),
    retained: fc.boolean(),
    write: fc.constantFrom(
      'before-fetch' as const,
      'after-fetch-start' as const,
    ),
    operation: fc.constantFrom('insert' as const, 'upsert' as const),
    includesDirect: fc.boolean(),
    keepsSaved: fc.boolean(),
    directValue: fc.integer({ min: -10, max: 10 }),
    sourceValue: fc.integer({ min: -10, max: 10 }),
    savedValue: fc.integer({ min: -10, max: 10 }),
    overlapsSaved: fc.boolean(),
  })
  .filter((h) => !h.overlapsSaved || h.operation === 'upsert')
export const directOwnershipStates = [
  'raw',
  'derived',
  'retained',
  'no-retention',
  'before-fetch',
  'after-fetch-start',
  'source-includes-direct',
  'source-omits-direct',
  'no-retention-direct-after-fetch',
  'retained-direct-before-returned-key',
  'fetched-row-write',
  'overlapping-saved-direct-key',
  'distinct-saved-direct-key',
  'returned-value-equals-saved-after-direct-change',
] as const

/** Authored causal order predicts values; only a later result may claim x. */
export function expectedDirectOwnership(
  h: DirectOwnershipHistory,
): Array<OwnedDirectRow> {
  const fetched = [
    ...(!h.overlapsSaved && h.keepsSaved
      ? [{ id: 'saved', value: h.sourceValue }]
      : []),
    ...(h.includesDirect ? [{ id: 'x', value: h.sourceValue }] : []),
  ]
  const values = mergeDirectWritesOverFetch(
    fetched,
    h.write === 'after-fetch-start' ? [{ id: 'x', value: h.directValue }] : [],
  )
  // Primary direct-row lifetime law: an accepted update/upsert preserves the
  // row's existing owners. The guide assigns no inferred owner only to a new
  // direct insert. Thus an older fetch cannot claim a new key, while an
  // updated saved key retains its already established source owner.
  return Object.entries(values)
    .map(([id, value]) => ({
      id,
      value,
      owners:
        id === 'x' && h.write === 'after-fetch-start' && !h.overlapsSaved
          ? []
          : ['source'],
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export const directOwnershipHistories: Array<DirectOwnershipHistory> = (
  ['raw', 'derived'] as const
)
  .flatMap((shape) =>
    [false, true].flatMap((retained) =>
      (['before-fetch', 'after-fetch-start'] as const).flatMap((write) =>
        (['insert', 'upsert'] as const).flatMap((operation) =>
          [false, true].flatMap((includesDirect) =>
            [false, true].map((keepsSaved) => ({
              shape,
              retained,
              write,
              operation,
              includesDirect,
              keepsSaved,
              directValue: 0,
              sourceValue: 1,
              savedValue: 1,
              overlapsSaved: false,
            })),
          ),
        ),
      ),
    ),
  )
  .flatMap((h) => [
    h,
    ...(h.operation === 'upsert' ? [{ ...h, overlapsSaved: true }] : []),
  ])

// Compare captured prefixes before asking for completion. A later driver or
// cleanup error must not erase an earlier wrong public/durable observation.
export function checkDirectOwnership(
  h: DirectOwnershipHistory,
  trace: ReadonlyArray<Observation>,
  expected = expectedDirectOwnership(h),
): Verdict {
  for (const o of trace) {
    // The public sync input type requires an operation even when a receiving
    // implementation could produce the right rows without that discriminant.
    // Judge the raw boundary value; do not infer an operation from row state.
    if (
      o.checkpoint === 'sync-write' &&
      o.value !== 'insert' &&
      o.value !== 'update' &&
      o.value !== 'delete'
    )
      return {
        kind: 'violation',
        checkpoint: o.checkpoint,
        law: 'declared sync-write operation',
        difference:
          'SyncConfig.write requires insert, update, or delete; observed ' +
          JSON.stringify(o.value),
      }
    if (o.checkpoint !== 'first' && o.checkpoint !== 'firstDurable') continue
    const actual = o.value as Array<OwnedDirectRow>
    const projectOwners = (rows: Array<OwnedDirectRow>) =>
      rows.map(({ id, owners }) => ({ id, owners }))
    if (
      JSON.stringify(projectOwners(actual)) !==
      JSON.stringify(projectOwners(expected))
    )
      return {
        kind: 'violation',
        checkpoint: o.checkpoint,
        law: 'direct row ownership',
        difference:
          'expected ' +
          JSON.stringify(projectOwners(expected)) +
          ', observed ' +
          JSON.stringify(projectOwners(actual)),
      }
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      return {
        kind: 'violation',
        checkpoint: o.checkpoint,
        law: 'direct row value',
        difference:
          'expected ' +
          JSON.stringify(expected) +
          ', observed ' +
          JSON.stringify(actual),
      }
  }
  if (!trace.some((o) => o.checkpoint === 'completed'))
    return {
      kind: 'violation',
      checkpoint: 'completed',
      law: 'receiving completion',
      difference:
        'receiving driver returned without completing its observations',
    }
  for (const cut of ['first', 'firstDurable'])
    if (!trace.some((o) => o.checkpoint === cut))
      return {
        kind: 'violation',
        checkpoint: cut,
        law: 'direct row observation',
        difference: 'required receiving observation is missing',
      }
  return { kind: 'pass' }
}

export type DirectOwnershipReceiver = (
  h: DirectOwnershipHistory,
  id: string,
  observe: (checkpoint: string, value: unknown) => void,
) => Promise<void>

/** Each receiving path gets fresh constructions and its own obligation ledger. */
export function persistedDirectOwnershipOptions(
  receive: DirectOwnershipReceiver,
  receiver: string,
): OraclePropertyOptions<DirectOwnershipHistory, Array<OwnedDirectRow>> {
  const obligations = new WeakMap<
    DirectOwnershipHistory,
    ReadonlyArray<string>
  >()
  // Fixed inputs also owe the states authored in their histories. This checks
  // their real receipt-cut observations and lets checker calibrations use an
  // early eligible fixed input instead of replaying every fixed input first.
  for (const h of directOwnershipHistories)
    obligations.set(h, [
      h.shape,
      h.retained ? 'retained' : 'no-retention',
      h.write,
      h.includesDirect ? 'source-includes-direct' : 'source-omits-direct',
      h.overlapsSaved
        ? 'overlapping-saved-direct-key'
        : 'distinct-saved-direct-key',
      ...(!h.retained && h.write === 'after-fetch-start'
        ? ['no-retention-direct-after-fetch']
        : []),
      ...(h.retained &&
      !h.overlapsSaved &&
      h.write === 'before-fetch' &&
      h.includesDirect &&
      h.directValue !== h.sourceValue
        ? ['retained-direct-before-returned-key', 'fetched-row-write']
        : []),
      ...(h.overlapsSaved &&
      h.retained &&
      h.write === 'before-fetch' &&
      h.includesDirect &&
      h.sourceValue === h.savedValue &&
      h.directValue !== h.savedValue
        ? ['returned-value-equals-saved-after-direct-change']
        : []),
    ])
  const constructed: Array<ConstructedHistory<DirectOwnershipHistory>> =
    directOwnershipStates
      .filter(
        (state) =>
          state !== 'retained-direct-before-returned-key' &&
          state !== 'fetched-row-write',
      )
      .map((state) => ({
        name: state,
        enters:
          state === 'retained'
            ? [
                state,
                'retained-direct-before-returned-key',
                'fetched-row-write',
              ]
            : [state],
        build(h) {
          const built = { ...h }
          if (state === 'raw' || state === 'derived') built.shape = state
          if (state === 'retained' || state === 'no-retention')
            built.retained = state === 'retained'
          if (state === 'before-fetch' || state === 'after-fetch-start')
            built.write = state
          if (
            state === 'source-includes-direct' ||
            state === 'source-omits-direct'
          )
            built.includesDirect = state === 'source-includes-direct'
          if (state === 'no-retention-direct-after-fetch') {
            built.retained = false
            built.write = 'after-fetch-start'
          }
          if (state === 'retained') {
            built.overlapsSaved = false
            built.write = 'before-fetch'
            built.includesDirect = true
            if (built.directValue === built.sourceValue)
              built.sourceValue =
                built.directValue === 10 ? 9 : built.directValue + 1
          }
          if (
            state === 'overlapping-saved-direct-key' ||
            state === 'distinct-saved-direct-key'
          )
            built.overlapsSaved = state === 'overlapping-saved-direct-key'
          if (state === 'returned-value-equals-saved-after-direct-change') {
            built.overlapsSaved = true
            built.retained = true
            built.write = 'before-fetch'
            built.includesDirect = true
            built.sourceValue = built.savedValue
            if (built.directValue === built.savedValue)
              built.directValue =
                built.savedValue === 10 ? 9 : built.savedValue + 1
          }
          // Inserting an existing key is illegal; overlap exercises upsert.
          if (built.overlapsSaved) built.operation = 'upsert'
          // The pinned framework associates seeded constructions only. This ledger
          // also enforces every generated output; builders always return new objects.
          obligations.set(
            built,
            state === 'retained'
              ? [
                  state,
                  'retained-direct-before-returned-key',
                  'fetched-row-write',
                ]
              : [state],
          )
          return built
        },
      }))
  let sequence = 0
  return {
    id: 'query.persisted-direct-ownership',
    law: {
      statement:
        'A later complete physical fetch replaces and claims a direct row; an older result preserves it without claiming source ownership. Query adapter sync writes declare an insert, update, or delete operation.',
      authority:
        'docs/collections/query-collection.md: Understanding the Data Stores item1 and Direct Writes and Query Sync; primary ownership direct-order/direct-row-lifetime laws; docs/reference/interfaces/SyncConfig.md and ChangeMessage.md, ChangeMessageOrDeleteKeyMessage and OperationType API types.',
      limits:
        'First eager result, one saved row and one same-run insert/upsert, numeric values, successful I/O. Public/durable cuts follow applied receipts; cleanup is diagnostic. No arbitrary mutations, peers, concurrent writers or eager unload claim.',
    },
    histories: {
      arbitrary: directOwnershipHistoryArb,
      runs: 40,
      fixedSeeds: [563],
      states: directOwnershipStates,
      constructed,
      fixed: directOwnershipHistories.map((history, index) => ({
        name: 'direct ownership structural history ' + index,
        history,
      })),
    },
    model: expectedDirectOwnership,
    driver: (h, observe) =>
      receive(h, 'direct-ownership-' + receiver + '-' + sequence++, observe),
    check: (h, trace, expected) => {
      const product = checkDirectOwnership(h, trace, expected)
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
        name: 'omits the declared sync-write operation',
        law: 'declared sync-write operation',
        corrupt: (trace) => {
          const first = trace.findIndex((o) => o.checkpoint === 'sync-write')
          return first < 0
            ? undefined
            : trace.map((o, index) =>
                index === first ? { ...o, value: undefined } : o,
              )
        },
      },
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
      ...directOwnershipStates.map((state) => ({
        name: 'omits constructed state ' + state,
        law: 'constructed reach',
        corrupt: (
          trace: ReadonlyArray<Observation>,
          h: DirectOwnershipHistory,
        ) =>
          obligations.get(h)?.includes(state)
            ? trace.filter((o) => o.checkpoint !== 'reach' || o.value !== state)
            : undefined,
      })),
      ...(['first', 'firstDurable'] as const).map((cut) => ({
        name: 'claims direct row from older result at ' + cut,
        law: 'direct row ownership',
        corrupt: (
          trace: ReadonlyArray<Observation>,
          h: DirectOwnershipHistory,
        ) =>
          h.write !== 'after-fetch-start' || h.overlapsSaved
            ? undefined
            : trace.map((o) =>
                o.checkpoint === cut
                  ? {
                      ...o,
                      value: (o.value as Array<OwnedDirectRow>).map((row) =>
                        row.id === 'x' ? { ...row, owners: ['source'] } : row,
                      ),
                    }
                  : o,
              ),
      })),
      ...(['first', 'firstDurable'] as const).map((cut) => ({
        name: 'keeps direct value after later returned result at ' + cut,
        law: 'direct row value',
        corrupt: (
          trace: ReadonlyArray<Observation>,
          h: DirectOwnershipHistory,
        ) =>
          h.write !== 'before-fetch' ||
          !h.includesDirect ||
          h.sourceValue === h.directValue
            ? undefined
            : trace.map((o) =>
                o.checkpoint === cut
                  ? {
                      ...o,
                      value: (o.value as Array<OwnedDirectRow>).map((row) =>
                        row.id === 'x' ? { ...row, value: h.directValue } : row,
                      ),
                    }
                  : o,
              ),
      })),
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
        law: 'direct row ownership',
        corrupt: (trace, h) =>
          h.write !== 'after-fetch-start' || h.overlapsSaved
            ? undefined
            : [
                ...trace.map((o) =>
                  o.checkpoint === 'first'
                    ? {
                        ...o,
                        value: (o.value as Array<OwnedDirectRow>).map((row) =>
                          row.id === 'x' ? { ...row, owners: ['source'] } : row,
                        ),
                      }
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
declareOracle({
  model: [expectedDirectOwnership],
  grammar: [directOwnershipHistoryArb, directOwnershipHistories],
  check: [checkDirectOwnership],
})
