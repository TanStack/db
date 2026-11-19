/** Registration and campaigns for the unwrapped eager-reload receiving law. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  eagerGateHistoryArb,
  eagerGateModel,
  eagerGateViolations,
  eagerReloadHistories,
  eagerReloadHistoryArb,
  eagerReloadModel,
  eagerReloadReached,
  eagerReloadStates,
  eagerReloadViolations,
} from './eager-reload-oracle'
import {
  observeEagerGateFailure,
  observeEagerReload,
} from './eager-reload-driver'
import type { Observation, Verdict } from '../../db/tests/oracle-property'
import type {
  EagerGateAdapter,
  EagerReloadAdapter,
} from './eager-reload-driver'
import type {
  EagerGateHistory,
  EagerGateObservation,
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
  return failures.length || raw.cleanupErrors?.length
    ? { failures, raw }
    : { failures }
}

export function registerEagerReloadConformance(
  property: string,
  adapter: EagerReloadAdapter,
  /** The receiving adapter's production entry, forwarded to oracleProperty. */
  {
    owns,
    replacement = `snapshot`,
    receive,
  }: {
    owns?: ReadonlyArray<string>
    replacement?: `snapshot` | `truncate` | `sweep` | `snapshot-and-sweep`
    receive?: (
      history: EagerReloadHistory,
      id: string,
      mutateReplacement: boolean,
    ) => Promise<EagerReloadObservation>
  } = {},
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
      const id = `${property}-${sequence++}`
      const reached = () => {
        for (const state of eagerReloadReached(h)) observe(`reach`, state)
      }
      const observed = receive
        ? await receive(h, id, invertSnapshot)
        : await observeEagerReload(
            adapter,
            h,
            id,
            reached,
            invertSnapshot && replacement === `snapshot`,
            invertSnapshot && replacement === `truncate`,
          )
      // Browser receivers return the same raw acceptance observations. Their
      // source-entry reach is credited only after an actual complete submission
      // and every receipt's acceptance, as in the local production driver.
      if (
        receive &&
        (observed.submittedCommits > 0 ||
          (observed.sourceReadyCalls ?? 0) > 0) &&
        observed.acceptedCommits === observed.submittedCommits
      )
        reached()
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
      if (projection.raw?.cleanupErrors?.length)
        return violation(
          `receiving cleanup`,
          projection.raw.cleanupErrors.join(`; `),
          `receiving cleanup`,
          { actual: projection.raw, expected },
        )
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
        history: {
          fixed: JSON.stringify({
            start: `reload`,
            previous: 1,
            next: 0,
            mutation: false,
          }),
        },
        name:
          replacement === `snapshot`
            ? `inverted snapshot declaration on retained rows`
            : replacement === `truncate`
              ? `omitted truncate replacement on retained rows`
              : replacement === `sweep`
                ? `omitted sweep deletions on retained rows`
                : `omitted snapshot and sweep replacement on retained rows`,
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
              sourceReadyCalls: 0,
              acceptedCommits: 0,
            }),
          },
          {
            name: `pending after complete application`,
            corrupt: (_h, raw) => ({ ...raw, settledAfterSource: false }),
          },
          {
            name: `cleanup diagnostic`,
            corrupt: (_h, raw) => ({
              ...raw,
              cleanupErrors: [`injected receiving teardown failure`],
            }),
          },
          {
            name: `wrong rows with cleanup diagnostic`,
            corrupt: (_h, raw) => ({
              ...raw,
              final: [...raw.final, { id: `unexpected`, value: -1 }],
              cleanupErrors: [`secondary receiving teardown failure`],
            }),
          },
        ] satisfies Array<{ name: string; corrupt: CorruptReload }>
      ).map(({ name, corrupt }) => ({
        name: `raw judgment rejects ${name}`,
        history: {
          fixed: JSON.stringify({
            start: `fresh`,
            previous: 0,
            next: 2,
            mutation: name === `lost pending optimistic overlay`,
          }),
        },
        law:
          name === `cleanup diagnostic`
            ? `receiving cleanup`
            : `complete eager result`,
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

/**
 * Terminal gate rejection shares one law across receivers. Each source/entry
 * pair has a randomized construction and an independently enforced generated
 * reach obligation. Successful new sync runs are a neighboring verdict.
 */
export function registerEagerGateFailureConformance(
  property: string,
  adapter: EagerGateAdapter,
  {
    owns,
    receive,
    entries = [`fresh`, `reload`, `shared`],
  }: {
    owns?: ReadonlyArray<string>
    // A shared entry means this new request receives the provider's current
    // terminal failure. Independent providers and cached errors that await a
    // fresh verdict do not satisfy that premise; their owners judge those paths.
    entries?: ReadonlyArray<EagerGateHistory[`entry`]>
    receive?: (
      history: EagerGateHistory,
      id: string,
    ) => Promise<EagerGateObservation>
  } = {},
) {
  type History = EagerGateHistory
  type Raw = EagerGateObservation
  const states = adapter.sources.flatMap((source) =>
    entries.flatMap((entry) => [
      `${source}:${entry}`,
      `${source}:${entry}:recovery`,
    ]),
  )
  const required = new WeakMap<History, string>()
  const constructed = adapter.sources.flatMap((source) =>
    entries.flatMap((entry) =>
      [false, true].map((retry) => ({
        name: `${source} ${entry} ${retry ? `recovered gate` : `terminal gate`}`,
        enters: [retry ? `${source}:${entry}:recovery` : `${source}:${entry}`],
        build: (generated: History): History => {
          const history = {
            ...generated,
            source,
            entry,
            retry,
            previous: entry === `fresh` ? 0 : generated.previous,
          }
          required.set(
            history,
            retry ? `${source}:${entry}:recovery` : `${source}:${entry}`,
          )
          return history
        },
      })),
    ),
  )
  let sequence = 0
  const driver = async (
    h: History,
    observe: (checkpoint: string, value: unknown) => void,
  ) => {
    const id = `${property}-${sequence++}`
    const raw = receive
      ? await receive(h, id)
      : await observeEagerGateFailure(adapter, h, id)
    if (
      raw.failureReached &&
      (h.entry !== `shared` || raw.sharedFailureBeforeTarget)
    )
      observe(`reach`, `${h.source}:${h.entry}`)
    if (
      raw.retryRunStarted &&
      raw.retry?.outcome === `fulfilled` &&
      raw.retry.status === `ready` &&
      !raw.retry.hasErrors
    )
      observe(`reach`, `${h.source}:${h.entry}:recovery`)
    observe(`terminal verdict`, raw)
  }
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `A terminal eager initial-gate failure rejects preload or reload, keeps reload's retained rows/status, and permits a successful new sync run; sharing a failed provider does not erase a fresh Collection's verdict.`,
      authority: `Collection.reload API; glossary initial gate, loading error, reload and cleanup; eager-source readiness contract.`,
      limits: `Three source keys, numeric values, one terminal eager failure, optional one new-run recovery, and each receiver's declared controlled provider boundary. No on-demand failure, real service authorization, arbitrary concurrent writes, or durability claim.`,
    },
    histories: {
      arbitrary: eagerGateHistoryArb(adapter.sources, entries),
      states,
      constructed,
      runs: 30,
      fixedSeeds: [2377],
      fixed: adapter.sources.flatMap((source) =>
        entries.map((entry) => ({
          name: `${source} ${entry} failed initial gate`,
          history: {
            source,
            entry,
            previous: entry === `fresh` ? 0 : 3,
            next: 2,
            failure: 1,
            retry: false,
          },
        })),
      ),
    },
    model: eagerGateModel,
    driver,
    check: (h, trace, expected) => {
      const raw = trace.find((item) => item.checkpoint === `terminal verdict`)
        ?.value as Raw | undefined
      if (!raw)
        return violation(
          `terminal verdict`,
          `Missing public gate verdict`,
          `terminal eager gate`,
        )
      const failures = eagerGateViolations(h, raw, expected)
      if (failures.length)
        return violation(
          `terminal verdict`,
          failures.join(`; `),
          `terminal eager gate`,
          { actual: raw, expected },
        )
      if (raw.cleanupErrors?.length)
        return violation(
          `receiving cleanup`,
          raw.cleanupErrors.join(`; `),
          `receiving cleanup`,
          { actual: raw, expected },
        )
      const needed = required.get(h)
      if (
        needed &&
        !trace.some(
          (item) => item.checkpoint === `reach` && item.value === needed,
        )
      )
        return violation(
          `reach`,
          `Missing generated state ${needed}`,
          `constructed builder reach`,
        )
      return pass
    },
    calibrations: [
      ...([`pending`, `fulfilled`] as const).map((outcome) => ({
        name: `terminal gate incorrectly ${outcome}`,
        history: { fixed: `${adapter.sources[0]} fresh failed initial gate` },
        law: `terminal eager gate`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint === `terminal verdict`
              ? {
                  ...item,
                  value: {
                    ...(item.value as Raw),
                    failure: { ...(item.value as Raw).failure, outcome },
                  },
                }
              : item,
          ),
      })),
      ...states.map((state) => ({
        name: `missing generated gate state ${state}`,
        history: {
          constructed: state.endsWith(`:recovery`)
            ? `${state.slice(0, -9).replace(`:`, ` `)} recovered gate`
            : `${state.replace(`:`, ` `)} terminal gate`,
        },
        law: `constructed builder reach`,
        corrupt: (trace: ReadonlyArray<Observation>, h: History) =>
          required.get(h) === state
            ? trace.filter(
                (item) =>
                  !(item.checkpoint === `reach` && item.value === state),
              )
            : undefined,
      })),
    ],
    timeout: 120_000,
  })
}
