/** Registration and campaigns for the unwrapped eager-reload receiving law. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  eagerReloadHistories,
  eagerReloadHistoryArb,
  eagerReloadModel,
  eagerReloadReached,
  eagerReloadStates,
  eagerReloadViolations,
} from './eager-reload-oracle'
import { observeEagerReload } from './eager-reload-driver'
import type { Observation, Verdict } from '../../db/tests/oracle-property'
import type { EagerReloadAdapter } from './eager-reload-driver'
import type {
  EagerReloadHistory,
  EagerReloadObservation,
} from './eager-reload-oracle'

type ReloadState = (typeof eagerReloadStates)[number]
type CheckedReloadResult = {
  failures: Array<string>
  raw?: EagerReloadObservation
}
type CorruptReload = (
  h: EagerReloadHistory,
  raw: EagerReloadObservation,
) => EagerReloadObservation

// SDK completion and optimistic settlement can race legally. Judge the actual
// fulfillment rows and flags with the unchanged raw checker before projecting
// that scheduling freedom to one successful record. Every failed judgment
// keeps its complete raw observation and is judged again by the framework
// check. No SDK observation cut or browser comparison changes. Calibrations
// below inject wrong raw rows before this projection, rather than corrupting a
// summary after the relevant information has already been discarded.
function checkedReloadResult(
  h: EagerReloadHistory,
  raw: EagerReloadObservation,
): CheckedReloadResult {
  const failures = eagerReloadViolations(h, raw)
  return failures.length ? { failures, raw } : { failures }
}

export function registerEagerReloadConformance(
  property: string,
  adapter: EagerReloadAdapter,
  /** The receiving adapter's production entry, forwarded to oracleProperty. */
  { owns }: { owns?: ReadonlyArray<string> } = {},
) {
  let sequence = 0
  // Each construction keeps the generated coordinates that its premise does
  // not constrain. Even a fresh-held construction varies the next source set.
  // Fresh identities prevent the pinned framework's builder map collisions.
  const retained = (h: EagerReloadHistory) => h.previous || (h.next % 7) + 1
  const key = (h: EagerReloadHistory) => {
    const previous = retained(h)
    return previous & -previous
  }
  const builds: Array<{
    state: ReloadState
    build: (h: EagerReloadHistory) => EagerReloadHistory
  }> = [
    { state: `fresh`, build: (h) => ({ ...h, start: `fresh`, previous: 0 }) },
    {
      state: `reload-empty`,
      build: (h) => ({ ...h, start: `reload`, previous: 0 }),
    },
    {
      state: `reload-retained`,
      build: (h) => ({ ...h, start: `reload`, previous: retained(h) }),
    },
    { state: `empty-result`, build: (h) => ({ ...h, next: 0 }) },
    {
      state: `omitted-row`,
      build: (h) => ({
        ...h,
        start: `reload`,
        previous: retained(h),
        next: h.next & ~key(h),
      }),
    },
    {
      state: `changed-overlap`,
      build: (h) => ({
        ...h,
        start: `reload`,
        previous: retained(h),
        next: h.next | key(h),
      }),
    },
    { state: `persisting-mutation`, build: (h) => ({ ...h, mutation: true }) },
    { state: `no-mutation`, build: (h) => ({ ...h, mutation: false }) },
    {
      state: `fresh-held`,
      build: (h) => ({ ...h, start: `fresh`, previous: 0, mutation: true }),
    },
    {
      state: `reload-empty-held`,
      build: (h) => ({ ...h, start: `reload`, previous: 0, mutation: true }),
    },
    {
      state: `reload-retained-held`,
      build: (h) => ({
        ...h,
        start: `reload`,
        previous: retained(h),
        mutation: true,
      }),
    },
  ]
  // The pinned framework checks named example constructions, but its generated
  // map branch does not retain their enters obligations. Attach each fresh
  // built history's obligation locally, so the same check enforces it when the
  // builder runs in either path. This map carries test metadata, not row truth.
  const required = new WeakMap<EagerReloadHistory, ReadonlyArray<ReloadState>>()
  const constructed = builds.map(({ state, build }) => ({
    name: `generated ${state}`,
    enters: [state],
    build: (generated: EagerReloadHistory) => {
      const history = { ...build(generated) }
      required.set(history, [state])
      return history
    },
  }))
  const drive =
    (invertSnapshot = false, corrupt: CorruptReload = (_h, raw) => raw) =>
    async (
      h: EagerReloadHistory,
      observe: (checkpoint: string, value: unknown) => void,
    ) => {
      const observed = await observeEagerReload(
        adapter,
        h,
        `${property}-${sequence++}`,
        () => {
          for (const state of eagerReloadReached(h)) observe(`reach`, state)
        },
        invertSnapshot,
      )
      observe(`result`, checkedReloadResult(h, corrupt(h, observed)))
    }
  const check = (
    h: EagerReloadHistory,
    trace: ReadonlyArray<Observation>,
    expected: ReturnType<typeof eagerReloadModel>,
  ): Verdict => {
    const result = trace.find((entry) => entry.checkpoint === `result`)
    if (result) {
      const projection = result.value as CheckedReloadResult
      if (projection.failures.length) {
        const failures = projection.raw
          ? eagerReloadViolations(h, projection.raw, expected)
          : projection.failures
        return violation(
          `result`,
          failures.join(`; `),
          `complete eager result`,
          { actual: projection.raw ?? projection, expected },
        )
      }
    }
    const reached = new Set(
      trace
        .filter((entry) => entry.checkpoint === `reach`)
        .map((entry) => entry.value),
    )
    const missing = (required.get(h) ?? []).filter(
      (state) => !reached.has(state),
    )
    if (missing.length)
      return violation(
        `reach`,
        `generated construction omitted ${missing.join(`, `)}`,
        `constructed builder reach`,
      )
    return result
      ? pass
      : violation(
          `result`,
          `source result was not observed`,
          `complete eager result`,
        )
  }
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `A complete eager source result replaces retained source membership and values; before source entry the previous public rows remain, and a persisting optimistic overlay follows the accepted-versus-applied sync contract until settlement.`,
      authority: `Glossary reload, snapshot transaction and accepted sync transaction; eager-source READY-3/PUB-7; optimistic-history-oracle.ts.`,
      limits: `Three string keys and numeric values, one fresh load or eager reload, one disjoint optimistic insert, real local SDK storage. No remote replication, persisted durability, arbitrary mutations, on-demand reload, or every intermediate publication.`,
    },
    histories: {
      arbitrary: eagerReloadHistoryArb,
      states: eagerReloadStates,
      runs: 80,
      fixedSeeds: [2367],
      constructed,
      fixed: eagerReloadHistories.map((history) => ({
        name: JSON.stringify(history),
        history,
      })),
    },
    model: eagerReloadModel,
    driver: drive(),
    check,
    calibrations: [
      {
        name: `inverted snapshot declaration on retained rows`,
        law: `complete eager result`,
        driver: drive(true),
      },
      ...(
        [
          {
            name: `wrong before-source rows`,
            corrupt: (_h, raw) => ({
              ...raw,
              before: [...raw.before, { id: `unexpected`, value: -1 }],
            }),
          },
          {
            name: `wrong fulfillment rows`,
            corrupt: (_h, raw) => ({
              ...raw,
              atFulfillment: [
                ...raw.atFulfillment,
                { id: `unexpected`, value: -1 },
              ],
            }),
          },
          {
            name: `wrong final rows`,
            corrupt: (_h, raw) => ({
              ...raw,
              final: [...raw.final, { id: `unexpected`, value: -1 }],
            }),
          },
          {
            name: `lost pending optimistic overlay`,
            corrupt: (h, raw) =>
              h.mutation
                ? {
                    ...raw,
                    mutationReleasedBeforeFulfillment: false,
                    mutationSettledBeforeFulfillment: false,
                    atFulfillment: raw.atFulfillment.filter(
                      (row) => row.id !== `optimistic`,
                    ),
                  }
                : raw,
          },
          {
            name: `missing source acceptance`,
            corrupt: (_h, raw) => ({
              ...raw,
              submittedCommits: 0,
              acceptedCommits: 0,
            }),
          },
        ] satisfies Array<{ name: string; corrupt: CorruptReload }>
      ).map(({ name, corrupt }) => ({
        name: `raw judgment rejects ${name}`,
        law: `complete eager result`,
        driver: drive(false, corrupt),
      })),
      ...builds.map(({ state }) => ({
        name: `missing generated builder state ${state}`,
        law: `constructed builder reach`,
        corrupt: (trace: ReadonlyArray<Observation>, h: EagerReloadHistory) =>
          required.get(h)?.includes(state)
            ? trace.filter(
                (entry) =>
                  !(entry.checkpoint === `reach` && entry.value === state),
              )
            : undefined,
      })),
    ],
    timeout: 120_000,
  })
}
