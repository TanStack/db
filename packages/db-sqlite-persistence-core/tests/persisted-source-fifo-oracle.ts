/**
 * Source sync transactions keep commit order across persistence reads. Storage
 * supplies an older baseline, including fields an on-demand Collection has not
 * read yet. A failed request-local read cannot discard a committed partial
 * update or its unseen fields. An independent aborted source transaction keeps
 * the Collection usable. README Source replay ordering and the glossary's
 * accepted/deferred sync transaction laws supply these promises.
 *
 * The same driver, source-log model, history grammar and comparison run over
 * the recording adapter and real Node SQLite. Direct's real Chromium/OPFS
 * on-demand receiver separately supplies the provider/storage crossing. These
 * histories compare held publication, receipt outcomes, final public/durable
 * rows, partial-update metadata, and the durable order of changing disjoint
 * writes. Cancellation also crosses the baseline snapshot's awaited return,
 * before acceptance. Unrelated durable rows vary independently; their read
 * cardinality is recorded as work evidence, without imposing a work budget.
 * They do not judge optimistic holds, dependent aborts, truncation,
 * multi-tab coordination or native mobile hosts.
 */
import { expect } from 'vitest'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { createRecordingAdapter } from './persisted-support'
import {
  generatedPersistenceFixedSeeds,
  sourceFifoOrderingAxes,
  sourceFifoOrderingHistory,
} from './persisted-durability-model-oracle'
import { runSourceFifoHistory } from './persisted-source-fifo-driver'
import type { SourceFifoOrderingHistory } from './persisted-durability-model-oracle'
import type {
  OpenSourceFifoStore,
  SourceFifoRunResult,
} from './persisted-source-fifo-driver'
import type { Todo } from './persisted-support'
import type { Observation } from '../../db/tests/oracle-property'

export type {
  OpenSourceFifoStore,
  SourceFifoStore,
  SourceFifoRunResult,
} from './persisted-source-fifo-driver'

const openRecordingStore: OpenSourceFifoStore = (_id, rows, metadata) => {
  const adapter = createRecordingAdapter(rows)
  if (metadata !== undefined) adapter.rowMetadata.set(`shared`, metadata)
  return Promise.resolve({
    adapter,
    read: () =>
      Promise.resolve({
        rows: [...adapter.rows.values()],
        metadata: adapter.rowMetadata.get(`shared`),
      }),
    close: () => {},
  })
}

// This map is the source log folded in commit order. Persistence reads add no
// source write. A partial update retains baseline fields, even when its read
// failed; restoring an equal value after deletion still writes the key.
function expectedSourceFifoOrderingRows(
  relation: SourceFifoOrderingHistory['relations'][number],
  olderTitle: string,
  newerTitle: string,
): Map<string, Todo> {
  const restores =
    relation === `delete-reinsert` || relation === `hydration-delete-reinsert`
  const baselineAbort = relation === `hydration-baseline-read-abort`
  const loadedPartial = relation === `hydration-loaded-partial`
  const multiKey = relation === `failed-hydration-multi-key-partial`
  const failedRead = relation.startsWith(`failed-hydration-`) || baselineAbort
  const aborted = relation === `hydration-independent-abort` || baselineAbort
  const olderKey =
    relation === `disjoint` || failedRead || aborted || loadedPartial
      ? `older`
      : `shared`
  const newerKey = relation === `disjoint` ? `newer` : `shared`
  const expected = new Map<string, Todo>([
    [`gate`, { id: `gate`, title: `holds adapter` }],
  ])
  expected.set(olderKey, { id: olderKey, title: olderTitle })
  if (baselineAbort) {
    expected.set(`after-abort`, { id: `after-abort`, title: newerTitle })
    return expected
  }
  expected.set(newerKey, {
    id: newerKey,
    title:
      restores || aborted
        ? olderTitle
        : failedRead || loadedPartial
          ? `${olderTitle}/${newerTitle}`
          : newerTitle,
    ...(restores || failedRead || aborted || loadedPartial
      ? { detail: `unseen durable field` }
      : {}),
  })
  if (multiKey)
    expected.set(`second`, {
      id: `second`,
      title: `${olderTitle}/${newerTitle}`,
      detail: `second unseen durable field`,
    })
  return expected
}

function sortedTodoRows(rows: Iterable<Todo>): Array<Todo> {
  return Array.from(rows).sort((left, right) => left.id.localeCompare(right.id))
}

// Public rows are the source log plus successful hydration, while untouched
// cached rows remain durable after a failed demand. This distinction follows
// on-demand demand admission; it is unrelated to the baseline reader's design.
function expectedSourceFifoResult(
  history: SourceFifoOrderingHistory,
  relation: SourceFifoOrderingHistory[`relations`][number],
): Omit<SourceFifoRunResult, `work`> {
  const [olderTitle, newerTitle] = history.titles
  if (relation === `failed-hydration-appended-partial`) {
    const publicRows = [
      {
        id: `shared`,
        title: `${olderTitle}/${newerTitle}`,
        detail: `unseen durable field`,
      },
      {
        id: `second`,
        title: `${newerTitle}/${olderTitle}`,
        detail: `second unseen durable field`,
      },
    ]
    return {
      relation,
      events: [
        {
          checkpoint: `source appended during baseline read`,
          value: { baselinePending: true, firstReceipt: `pending` },
        },
        {
          checkpoint: `source FIFO subset settlement`,
          value: { status: `rejected`, sameFailure: true },
        },
      ],
      reached: true,
      receiptOutcomes: Array.from({ length: 2 }, () => ({
        status: `fulfilled` as const,
        name: null,
        abortErrorInstance: false,
      })),
      cleanupErrors: [],
      browserErrors: [],
      final: {
        publicRows: sortedTodoRows(publicRows),
        durableRows: sortedTodoRows([
          ...publicRows,
          ...Array.from({ length: history.unrelatedRowCount }, (_, i) => ({
            id: `unrelated-${i}`,
            title: `unrelated durable row ${i}`,
          })),
        ]),
        publicMetadata: { cached: true },
        durableMetadata: { cached: true },
        status: `ready`,
        pendingMarkers: 0,
        durableOrder: [[`shared`], [`second`]],
      },
    }
  }
  const crossing =
    relation.startsWith(`hydration-`) ||
    relation.startsWith(`failed-hydration-`)
  const baselineAbort = relation === `hydration-baseline-read-abort`
  const loadedPartial = relation === `hydration-loaded-partial`
  const ordinaryPartial = relation === `failed-hydration-ordinary-partial`
  const multiKey = relation === `failed-hydration-multi-key-partial`
  const failedRead = relation.startsWith(`failed-hydration-`) || baselineAbort
  const aborted = relation === `hydration-independent-abort` || baselineAbort
  const restores =
    relation === `delete-reinsert` || relation === `hydration-delete-reinsert`
  const disjoint =
    relation === `disjoint` || failedRead || aborted || loadedPartial
  const olderKey = disjoint ? `older` : `shared`
  const newerKey = relation === `disjoint` ? `newer` : `shared`
  const baseline = {
    id: `shared`,
    title: olderTitle,
    detail: `unseen durable field`,
  }
  const unrelatedRows =
    failedRead || loadedPartial
      ? Array.from({ length: history.unrelatedRowCount }, (_, index) => ({
          id: `unrelated-${index}`,
          title: `unrelated durable row ${index}`,
        }))
      : []
  const publicRows = expectedSourceFifoOrderingRows(
    relation,
    olderTitle,
    newerTitle,
  )
  if (loadedPartial)
    for (const row of unrelatedRows) publicRows.set(row.id, row)
  const durableRows = new Map(publicRows)
  if (baselineAbort) durableRows.set(`shared`, baseline)
  for (const row of unrelatedRows) durableRows.set(row.id, row)
  const events = crossing
    ? [
        {
          checkpoint: `queued predecessor at subset read`,
          value: {
            status: `pending`,
            writes: [...(ordinaryPartial ? [[`shared`]] : []), [`gate`]],
          },
        },
        {
          checkpoint: `newer source commit during held read`,
          value: { readOpen: true, olderStatus: `pending` },
        },
        {
          checkpoint: `source FIFO subset settlement`,
          value: failedRead
            ? { status: `rejected`, sameFailure: true }
            : { status: `fulfilled` },
        },
      ]
    : [
        {
          checkpoint: `source FIFO held public baseline`,
          value: sortedTodoRows([
            { id: `gate`, title: `holds adapter` },
            ...(restores ? [baseline] : []),
          ]),
        },
      ]
  return {
    relation,
    events,
    reached: true,
    cleanupErrors: [],
    browserErrors: [],
    receiptOutcomes: [
      ...(ordinaryPartial
        ? [
            {
              status: `fulfilled` as const,
              name: null,
              abortErrorInstance: false,
            },
          ]
        : []),
      { status: `fulfilled`, name: null, abortErrorInstance: false },
      { status: `fulfilled`, name: null, abortErrorInstance: false },
      {
        status: aborted ? `rejected` : `fulfilled`,
        name: aborted ? `AbortError` : null,
        abortErrorInstance: aborted,
      },
      ...(baselineAbort
        ? [
            {
              status: `fulfilled` as const,
              name: null,
              abortErrorInstance: false,
            },
          ]
        : []),
    ],
    final: {
      publicRows: sortedTodoRows(publicRows.values()),
      durableRows: sortedTodoRows(durableRows.values()),
      status: `ready`,
      pendingMarkers: 0,
      ...(disjoint
        ? {
            durableOrder: [
              ...(ordinaryPartial ? [[`shared`]] : []),
              [`gate`],
              [olderKey],
              ...(aborted ? [] : [[newerKey, ...(multiKey ? [`second`] : [])]]),
              ...(baselineAbort ? [[`after-abort`]] : []),
            ],
          }
        : {}),
      ...(failedRead || loadedPartial
        ? {
            publicMetadata: baselineAbort ? undefined : { cached: true },
            durableMetadata: { cached: true },
          }
        : {}),
    },
  }
}

const reportedBaselineWork = new Set<string>()
export function registerSourceFifoOrderingOracle({
  property,
  owns,
  receivingPath,
  open = openRecordingStore,
  run,
  constructTogether = false,
}: {
  property: string
  owns: ReadonlyArray<string>
  receivingPath: string
  open?: OpenSourceFifoStore
  constructTogether?: boolean
  run?: (
    history: SourceFifoOrderingHistory,
  ) => Promise<Array<SourceFifoRunResult>>
}): void {
  const required = new WeakMap<
    SourceFifoOrderingHistory,
    ReadonlyArray<string>
  >()
  // Every history already carries all axes. A new expensive receiving path
  // can therefore construct them together while preserving five fresh
  // builders per state. Existing hosts retain their per-axis constructions.
  const constructionStates = constructTogether
    ? [sourceFifoOrderingAxes]
    : sourceFifoOrderingAxes.map((state) => [state])
  const constructed = constructionStates.flatMap((states) =>
    Array.from({ length: 5 }, (_, i) => ({
      name: `${constructTogether ? `all FIFO states` : states[0]} construction ${i + 1}`,
      enters: [...states],
      build: (h: SourceFifoOrderingHistory): SourceFifoOrderingHistory => {
        const built = {
          ...h,
          relations: constructTogether
            ? [...h.relations]
            : [
                states[0],
                ...h.relations.filter((relation) => relation !== states[0]),
              ],
        }
        required.set(built, states)
        return built
      },
    })),
  )
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `Committed source transactions apply in commit order. Failed request-local reads preserve the durable baseline needed by a partial source update. Cancellation before acceptance rejects the receipt and leaves the Collection usable, including after the baseline snapshot's awaited return.`,
      authority: `README.md#source-replay-ordering; glossary accepted/deferred sync transaction; SyncAppliedReceipt; Sync metadata session maintainer decisions 2026-10-22 and 2026-10-23.`,
      limits: `${receivingPath} Held/public/durable rows, receipts and measured baseline row materialization; no universal performance budget. No optimistic hold, dependent abort, multi-tab coordinator, or truncate in this grammar.`,
    },
    histories: {
      arbitrary: sourceFifoOrderingHistory,
      runs: 4,
      fixedSeeds: [generatedPersistenceFixedSeeds.sourceFifoOrdering],
      states: sourceFifoOrderingAxes,
      constructed,
    },
    resolve: (history) => ({ history }),
    model: (plan) =>
      plan.history.relations.map((relation) =>
        expectedSourceFifoResult(plan.history, relation),
      ),
    driver: async (plan, observe) => {
      const results = await (run
        ? run(plan.history)
        : runSourceFifoHistory(plan.history, open))
      for (const result of results) {
        observe(`source FIFO result`, result)
        if (result.reached) observe(`reach`, result.relation)
        if (result.work) {
          const report = JSON.stringify({
            property,
            relation: result.relation,
            ...result.work,
          })
          if (
            process.env.TANSTACK_DB_PERSISTENCE_BASELINE_WORK === `1` &&
            !reportedBaselineWork.has(report)
          ) {
            reportedBaselineWork.add(report)
            process.stderr.write(`source FIFO baseline work ${report}\n`)
          }
        }
      }
    },
    check: (plan, trace, expected) => {
      const results = trace
        .filter((entry) => entry.checkpoint === `source FIFO result`)
        .map((entry) => entry.value as SourceFifoRunResult)
      // Work is a measured diagnostic. The accepted source/publication law
      // imposes every other field; changing the read strategy may change work.
      const executionErrors = results.flatMap(
        (result) => result.executionErrors ?? [],
      )
      const secondary =
        executionErrors.length === 0
          ? ``
          : `\nSecondary execution diagnostics: ${JSON.stringify(executionErrors)}`
      for (const [index, result] of results.entries()) {
        const {
          work: _work,
          executionErrors: _executionErrors,
          ...observation
        } = result
        try {
          expect({
            ...observation,
            browserErrors: result.browserErrors ?? [],
          }).toEqual(expected[index])
        } catch (error) {
          if (!(error instanceof Error) || error.name !== `AssertionError`)
            throw error
          return {
            ...violation(
              `source FIFO ${result.relation}`,
              `${error.message}\nCompleted observation: ${JSON.stringify(observation)}${secondary}`,
              `source FIFO`,
              { actual: observation, expected: expected[index] },
            ),
            cause: executionErrors.length
              ? new AggregateError(
                  executionErrors.map((failure) => new Error(failure.message)),
                  `Later source FIFO execution failed`,
                  { cause: error },
                )
              : error,
          }
        }
      }
      if (executionErrors.length)
        throw new AggregateError(
          executionErrors.map((failure) => new Error(failure.message)),
          `Source FIFO execution failed after completed observations`,
        )
      if (results.length !== expected.length)
        return violation(
          `source FIFO history`,
          `received ${results.length} relation results; expected ${expected.length}`,
          `source FIFO`,
        )
      for (const state of required.get(plan.history) ?? []) {
        if (
          !trace.some(
            (entry) => entry.checkpoint === `reach` && entry.value === state,
          )
        )
          return violation(
            `reach`,
            `missing ${state}`,
            `constructed history reach`,
          )
      }
      return pass
    },
    calibrations: [
      ...constructed.flatMap((builder) =>
        builder.enters.map((state) => ({
          name: `${builder.name} cannot omit ${state}`,
          history: { constructed: builder.name },
          law: `constructed history reach`,
          corrupt: (trace: ReadonlyArray<Observation>) =>
            trace.filter(
              (entry) => entry.checkpoint !== `reach` || entry.value !== state,
            ),
        })),
      ),
      {
        name: `preserves a completed row mismatch before later execution fails`,
        history: {
          constructed: `${constructTogether ? `all FIFO states` : `same-key`} construction 1`,
        },
        law: `source FIFO`,
        difference:
          /(?=[\s\S]*calibrated completed row corruption)(?=[\s\S]*calibrated later FIFO execution failure)/,
        driver: async (plan, observe) => {
          let opened = 0
          const results = await runSourceFifoHistory(
            plan.history,
            async (...args) => {
              if (opened++ === 1)
                throw new Error(`calibrated later FIFO execution failure`)
              const store = await openRecordingStore(...args)
              const read = store.read
              store.read = async () => {
                const observed = await read()
                return {
                  ...observed,
                  rows: observed.rows.map((row) =>
                    row.id === `gate`
                      ? { ...row, title: `calibrated completed row corruption` }
                      : row,
                  ),
                }
              }
              return store
            },
          )
          for (const result of results) {
            observe(`source FIFO result`, result)
            if (result.reached) observe(`reach`, result.relation)
          }
        },
      },
      {
        name: `rejects successful receipt after baseline-read cancellation`,
        history: {
          constructed: constructTogether
            ? `all FIFO states construction 1`
            : `hydration-baseline-read-abort construction 1`,
        },
        law: `source FIFO`,
        corrupt: (trace) =>
          trace.map((entry) => {
            if (entry.checkpoint !== `source FIFO result`) return entry
            const result = entry.value as SourceFifoRunResult
            return result.relation === `hydration-baseline-read-abort`
              ? {
                  ...entry,
                  value: {
                    ...result,
                    receiptOutcomes: result.receiptOutcomes.map(
                      (outcome, index) =>
                        index === 2
                          ? {
                              status: `fulfilled`,
                              name: null,
                              abortErrorInstance: false,
                            }
                          : outcome,
                    ),
                  },
                }
              : entry
          }),
      },
    ],
  })
}
