/**
 * Svelte receiving driver for the shared transported-page/window laws.
 * It supplies real runes and flushSync, JSON server preloads, held browser
 * readiness and fresh old-page readers. The independent sort/slice judgment
 * and history grammar are shared with React; this does not claim hydrate().
 */
import { isDeepStrictEqual } from 'node:util'
import {
  BTreeIndex,
  DbClient,
  collectionOptions,
  createCollection,
} from '@tanstack/db'
import { flushSync } from 'svelte'
import fc from 'fast-check'
import { describe, expect, vi } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery.svelte'
import {
  checkWindowObservation,
  checkWindowState,
  windowRows,
} from '../../db/tests/conformance/window-history-oracle'
import {
  clientWindowArbitrary,
  clientWindowStates,
  clientWindowExamples as examples,
} from '../../db/tests/conformance/client-window-history-oracle'
import { ScenarioLifetime } from '../../db/tests/conformance/scenario-lifetime'
import { OracleCheckpointFailure } from '../../db/tests/oracle-failure-fidelity'
import { selectedRow } from '../../db/tests/conformance/result-laws'
import {
  declareOracle,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-config'
import type { Observation, Verdict } from '../../db/tests/oracle-config'
import type {
  InitialQueryBuilder,
  LiveQueryCollectionUtils,
} from '@tanstack/db'
import type { WindowRow } from '../../db/tests/conformance/window-history-oracle'
import type { ClientWindowHistory as History } from '../../db/tests/conformance/client-window-history-oracle'
// Client switching has its own React scope driver; this receiver measures only
// the states it actually supplies. Every keyed/derived campaign has its own reach.
const states = clientWindowStates.filter(
  (state) => state !== `client scope switch`,
)
async function recordClientWindowHistory(
  history: History,
  keyed: boolean,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const lifetime = new ScenarioLifetime()
  const unmounts: Array<() => void> = []
  lifetime.defer(() => unmounts.forEach((unmount) => unmount()))
  const server = new DbClient()
  const browser = new DbClient()
  lifetime.defer(() => server.cleanup())
  lifetime.defer(() => browser.cleanup())
  await lifetime.run(async () => {
    const serverRows: Array<WindowRow> = Array.from(
      { length: history.count },
      (_, id) => ({ id: `s${id}`, rank: id }),
    )
    const browserRows = serverRows.map((row) => ({
      ...row,
      id: `b${row.rank}`,
    }))
    let ready: (() => void) | undefined
    const descriptor = collectionOptions(`client-window-source`, (owner) => ({
      getKey: (row: WindowRow) => row.id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const value of owner === server ? serverRows : browserRows)
            write({ type: `insert`, value: { ...value } })
          commit()
          if (owner === server) markReady()
          else ready = markReady
        },
      },
    }))
    const first = { offset: history.offset, limit: history.width }
    const next = { offset: first.offset + history.jump, limit: first.limit + 1 }
    const build = (q: InitialQueryBuilder, page: typeof first) =>
      q
        .from({ row: descriptor })
        .orderBy(({ row }) => row.rank)
        .limit(page.limit)
        .offset(page.offset)
        .select(({ row }) => ({ id: row.id, rank: row.rank }))
    const config = (page: typeof first) => ({
      query: (q: InitialQueryBuilder) => build(q, page),
      ...(keyed
        ? { queryKey: [`client-window`, page.offset, page.limit] }
        : {}),
    })
    for (const page of [first, next])
      await server.preloadLiveQuery(config(page))
    const transport = JSON.parse(JSON.stringify(server.dehydrate()))
    browser.hydrate(transport)
    const expected = (rows: Array<WindowRow>, page: typeof first) =>
      windowRows(
        rows,
        { ...page, minimum: -1, descending: false, nestedLimit: rows.length },
        false,
      )
    // The first view is captured during rune construction, before effects.
    // Page updates are observed at Svelte's native flushSync cut.
    const mountPage = (initial: typeof first) => {
      let page = $state(initial)
      let current!: () => {
        data: unknown
        collection: unknown
        state: ReadonlyMap<unknown, unknown>
      }
      let initialView!: { data: unknown; collection: unknown }
      const dispose = $effect.root(() => {
        const result = useLiveQuery({
          query: (q) => build(q, page),
          queryKey: () =>
            keyed ? [`client-window`, page.offset, page.limit] : [],
          client: browser,
        })
        current = () => result
        initialView = { data: [...result.data], collection: result.collection }
      })
      unmounts.push(dispose)
      return {
        current,
        initialView,
        move(requested: typeof first) {
          page = requested
          flushSync()
        },
      }
    }
    const hook = mountPage(first)
    const firstRender = hook.initialView
    flushSync()
    let polling = false
    observe(
      `first preloaded page render`,
      recordWindow(firstRender.data, firstRender.collection),
    )
    observe(`reach`, `first seed`)
    const collection = hook.current().collection
    const compare = (
      rows: Array<WindowRow>,
      page: typeof first,
      checkpoint: string,
      retain = true,
    ) => {
      const current = hook.current()
      if (polling) {
        checkWindowObservation(
          { rows: current.data, collection: current.collection },
          {
            rows: expected(rows, page),
            previousCollection: collection,
            retain,
          },
          checkpoint,
        )
        checkWindowState(current.state, expected(rows, page), checkpoint)
      } else
        observe(
          checkpoint,
          recordWindow(
            current.data,
            current.collection,
            collection,
            current.state,
          ),
        )
    }
    const peer = mountPage(first)
    flushSync()
    // Judge the existing peer's keyed view as well as its rows while the
    // transported seed is held and when the local snapshot takes over.
    const comparePeer = (rows: Array<WindowRow>, cut: string) => {
      const current = peer.current()
      if (polling) {
        checkWindowObservation(
          { rows: current.data, collection: current.collection },
          {
            rows: expected(rows, first),
            previousCollection: collection,
            retain: false,
          },
          cut,
        )
        checkWindowState(current.state, expected(rows, first), cut)
      } else
        observe(
          cut,
          recordWindow(
            current.data,
            current.collection,
            collection,
            current.state,
          ),
        )
    }
    comparePeer(serverRows, `peer before move`)
    // Independent query inputs own distinct Collections. Moving one hook leaves
    // the other hook on its original page.
    hook.move(next)
    compare(
      serverRows,
      next,
      `moved preloaded page before local readiness`,
      true,
    )
    observe(`reach`, `moved seed`)
    comparePeer(serverRows, `peer while local readiness is held`)
    observe(`reach`, `held peer keyed state`)
    for (let index = 0; index < history.latePeers; index++) {
      const late = mountPage(first)
      flushSync()
      const current = late.current()
      observe(
        `fresh old-page lookup after move before local readiness`,
        recordWindow(
          current.data,
          current.collection,
          collection,
          current.state,
        ),
      )
      observe(
        `fresh peer identity`,
        current.collection !== peer.current().collection,
      )
    }
    observe(`reach`, `fresh old-page lookup`)
    observe(`browser sync started`, ready !== undefined)
    ready!()
    flushSync()
    // Native flush does not settle the observer's queued readiness handoff.
    // Require the public local result within the bounded receiving cut.
    polling = true
    try {
      await vi.waitFor(() => {
        flushSync()
        compare(browserRows, next, `local handoff`)
        comparePeer(browserRows, `peer after handoff`)
      })
    } finally {
      polling = false
      compare(browserRows, next, `local handoff`)
      comparePeer(browserRows, `peer after handoff`)
    }
    observe(`reach`, `local handoff`)
    comparePeer(browserRows, `peer after handoff`)
    observe(`reach`, `peer isolation`)
    observe(`reach`, `local peer keyed state`)
    hook.move(first)
    polling = true
    try {
      await vi.waitFor(() => {
        flushSync()
        compare(browserRows, first, `return to first page`)
      })
    } finally {
      polling = false
      compare(browserRows, first, `return to first page`)
    }
    observe(`reach`, `returned page`)
    // Ordinary moves do not rewrite the server's immutable page records.
    observe(
      `server transport unchanged`,
      isDeepStrictEqual(
        JSON.parse(JSON.stringify(server.dehydrate())),
        transport,
      ),
    )
  })
}

type WindowFact = {
  rows: unknown
  collectionIsNull: boolean
  sameCollection?: boolean
  state?: Array<unknown>
  hasState: boolean
}
// Copy exactly the selected-value surface the shared comparison reads. Preserve
// collection identity as a relation instead of recording a non-data Collection.
function recordWindow(
  rows: unknown,
  collection: unknown,
  previous?: unknown,
  state?: ReadonlyMap<unknown, unknown>,
): WindowFact {
  return {
    rows: Array.isArray(rows) ? rows.map(selectedRow) : rows,
    collectionIsNull: collection === null,
    sameCollection:
      previous === undefined ? undefined : collection === previous,
    hasState: state !== undefined,
    state:
      state === undefined ? undefined : [...state.values()].map(selectedRow),
  }
}
function assertionFailure(checkpoint: string, error: unknown): Verdict {
  const cause = error instanceof OracleCheckpointFailure ? error.cause : error
  if (!(cause instanceof Error) || cause.name !== `AssertionError`) throw error
  return {
    kind: `violation`,
    checkpoint,
    law: error instanceof OracleCheckpointFailure ? error.law : `client window`,
    difference: cause.message,
    cause: error,
  }
}
function judgeWindow(
  checkpoint: string,
  value: unknown,
  expected: Array<WindowRow>,
  retain: boolean,
  first = false,
): Verdict {
  const fact = value as WindowFact
  const previous = {}
  const collection = fact.collectionIsNull
    ? null
    : fact.sameCollection
      ? previous
      : {}
  try {
    checkWindowObservation(
      { rows: fact.rows, collection },
      {
        rows: expected,
        retain,
        ...(first ? {} : { previousCollection: previous }),
      },
      checkpoint,
    )
    if (!first)
      checkWindowState(
        fact.hasState
          ? new Map(fact.state!.map((row, index) => [index, row]))
          : undefined,
        expected,
        checkpoint,
      )
    return pass
  } catch (error) {
    return assertionFailure(checkpoint, error)
  }
}
function modelClientWindow(history: History) {
  const first = { offset: history.offset, limit: history.width }
  const next = {
    offset: history.offset + history.jump,
    limit: history.width + 1,
  }
  const rows = (local: boolean, page: typeof first) =>
    windowRows(
      Array.from({ length: history.count }, (_, rank) => ({
        id: `${local ? `b` : `s`}${rank}`,
        rank,
      })),
      { ...page, minimum: -1, descending: false, nestedLimit: history.count },
      false,
    ) as Array<WindowRow>
  return {
    [`first preloaded page render`]: {
      rows: rows(false, first),
      retain: true,
      count: 1,
    },
    [`peer before move`]: { rows: rows(false, first), retain: false, count: 1 },
    [`moved preloaded page before local readiness`]: {
      rows: rows(false, next),
      retain: true,
      count: 1,
    },
    [`peer while local readiness is held`]: {
      rows: rows(false, first),
      retain: false,
      count: 1,
    },
    [`fresh old-page lookup after move before local readiness`]: {
      rows: rows(false, first),
      retain: false,
      count: history.latePeers,
    },
    [`local handoff`]: { rows: rows(true, next), retain: true, count: 1 },
    [`peer after handoff`]: {
      rows: rows(true, first),
      retain: false,
      count: 2,
    },
    [`return to first page`]: {
      rows: rows(true, first),
      retain: true,
      count: 1,
    },
  }
}
function checkClientWindowHistory(
  history: History,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelClientWindow>,
): Verdict {
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    if (checkpoint in expected) {
      const target = expected[checkpoint as keyof typeof expected]
      const wrong = judgeWindow(
        checkpoint,
        value,
        target.rows,
        target.retain,
        checkpoint === `first preloaded page render`,
      )
      if (wrong.kind === `violation`) return wrong
    } else if (
      [
        `fresh peer identity`,
        `browser sync started`,
        `server transport unchanged`,
      ].includes(checkpoint)
    ) {
      if (value !== true)
        return violation(
          checkpoint,
          `expected the original identity/start/transport relation`,
          `client window`,
        )
    } else
      return violation(checkpoint, `unexpected observation`, `client window`)
  }
  for (const [checkpoint, target] of Object.entries(expected))
    if (
      trace.filter((entry) => entry.checkpoint === checkpoint).length !==
      target.count
    )
      return violation(
        checkpoint,
        `expected every original comparison cut`,
        `client window`,
      )
  for (const [checkpoint, count] of [
    [`fresh peer identity`, history.latePeers],
    [`browser sync started`, 1],
    [`server transport unchanged`, 1],
  ] as const)
    if (
      trace.filter((entry) => entry.checkpoint === checkpoint).length !== count
    )
      return violation(
        checkpoint,
        `expected every original relation`,
        `client window`,
      )
  return pass
}
describe(`Svelte client page identity`, () => {
  for (const keyed of [false, true])
    describe(keyed ? `keyed` : `derived`, () =>
      oracleProperty({
        id: `svelte.client-window`,
        law: {
          statement: `Transported page seeds survive an outer window move until local readiness, independent peers retain their page, and returning to the first page follows local rows.`,
          authority: `packages/db/tests/conformance/window-history-oracle.ts outer window contract and docs/guides/ssr.md transported page contract`,
          limits: `Existing keyed/derived Svelte client-page grammar and native flushSync cuts; no client scope switch or hydrate() claim.`,
        },
        owns: [`src/useLiveQuery.svelte.ts#useLiveQuery`],
        histories: {
          arbitrary: clientWindowArbitrary,
          runs: 6,
          fixedSeeds: [2345],
          states,
          constructed: [
            {
              name: `complete page handoff`,
              enters: states,
              build: (history) => ({ ...history }),
            },
          ],
          fixed: examples.map(([history], index) => ({
            name: `client page ${index}`,
            history,
          })),
        },
        model: modelClientWindow,
        driver: (history, observe) =>
          recordClientWindowHistory(history, keyed, observe),
        check: checkClientWindowHistory,
        timeout: 30_000,
      }),
    )
})
declareOracle({
  model: [modelClientWindow],
  check: [checkClientWindowHistory],
})

/** An unchanged explicit client key retains the authored input, including after
 * a rejected key read. Recovery must not replay a prior declarative move over
 * an imperative window change. The shared page model judges that retained view.
 * Changing the key instead admits the proposed query. Body/deps proposals
 * behind an equal key intentionally retain the authored plan.
 */
const recoveryArbitrary = fc.record({
  width: fc.integer({ min: 1, max: 3 }),
  offset: fc.integer({ min: 1, max: 3 }),
  imperative: fc.integer({ min: 4, max: 6 }),
})
type RecoveryHistory = {
  width: number
  offset: number
  imperative: number
  changeKey: boolean
  proposal: `body` | `deps`
}
// Cross both proposal paths with key equality in every generated family.
// Separate marginal reaches could otherwise miss same-key dependency recovery.
function recoveryHistories(
  values: Omit<RecoveryHistory, `changeKey` | `proposal`>,
): Array<RecoveryHistory> {
  return ([`body`, `deps`] as const).flatMap((proposal) =>
    [false, true].map((changeKey) => ({ ...values, proposal, changeKey })),
  )
}
const recoveryStates = [
  `committed move`,
  `imperative move`,
  `rejected read`,
  `same-key recovery`,
  `changed-key recovery`,
  `body`,
  `deps`,
  `same-key body`,
  `same-key deps`,
  `changed-key body`,
  `changed-key deps`,
] as const
async function recordRecovery(
  history: RecoveryHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const lifetime = new ScenarioLifetime()
  let dispose: (() => void) | undefined
  lifetime.defer(() => dispose?.())
  const client = new DbClient()
  lifetime.defer(() => client.cleanup())
  await lifetime.run(async () => {
    const rows: Array<WindowRow> = Array.from({ length: 12 }, (_, rank) => ({
      id: String(rank),
      rank,
    }))
    const source = createCollection({
      getKey: (row: WindowRow) => row.id,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const value of rows)
            write({ type: `insert`, value: { ...value } })
          commit()
          markReady()
        },
      },
    })
    lifetime.defer(() => source.cleanup({ dependents: true }))
    let offset = $state(0)
    let key = $state(0)
    let failed = $state(false)
    let dep = $state(0)
    const failure = new Error(`key read rejected`)
    let result!: {
      data: unknown
      state: ReadonlyMap<unknown, unknown>
      collection: { utils: object }
    }
    dispose = $effect.root(() => {
      result = useLiveQuery(
        {
          client,
          queryKey: () => {
            if (failed) throw failure
            return [`recovery`, key]
          },
          query: (q) =>
            q
              .from({ row: source })
              .orderBy(({ row }) => row.rank)
              .limit(history.width)
              .offset(offset + dep)
              .select(({ row }) => ({ id: row.id, rank: row.rank })),
        },
        [() => dep],
      )
    })
    const settle = async () => {
      await Promise.resolve()
      flushSync()
      await new Promise((resolve) => setTimeout(resolve, 0))
      flushSync()
    }
    flushSync()
    await settle()
    const first = result.collection
    offset = history.offset
    key = 1
    flushSync()
    await settle()
    const compare = (_page: number, cut: string) => {
      observe(
        cut,
        recordWindow(result.data, result.collection, first, result.state),
      )
    }
    compare(history.offset, `Svelte committed declarative move`)
    observe(`reach`, `committed move`)
    await (result.collection.utils as LiveQueryCollectionUtils).setWindow({
      offset: history.imperative,
      limit: history.width,
    })
    await settle()
    compare(history.imperative, `imperative window before rejected input`)
    observe(`reach`, `imperative move`)
    failed = true
    // Read the rejected lazy value twice, then run the throwing native effect.
    for (const [checkpoint, read] of [
      [`rejected data`, () => result.data],
      [`rejected collection`, () => result.collection],
      [`rejected flush`, () => flushSync()],
    ] as const) {
      let rejection: { error: unknown } | undefined
      try {
        read()
      } catch (error) {
        rejection = { error }
      }
      observe(checkpoint, {
        rejection,
        expectedError: new Error(failure.message),
      })
    }
    observe(`reach`, `rejected read`)
    failed = false
    if (history.proposal === `body`) offset = 9
    else dep = 9 - history.offset
    if (history.changeKey) key = 2
    flushSync()
    await settle()
    compare(history.changeKey ? 9 : history.imperative, `recovered client key`)
    observe(
      `reach`,
      history.changeKey ? `changed-key recovery` : `same-key recovery`,
    )
    observe(`reach`, history.proposal)
    observe(
      `reach`,
      `${history.changeKey ? `changed-key` : `same-key`} ${history.proposal}`,
    )
  })
}

function modelRecovery(
  history: Omit<RecoveryHistory, `changeKey` | `proposal`>,
) {
  const rows: Array<WindowRow> = Array.from({ length: 12 }, (_, rank) => ({
    id: String(rank),
    rank,
  }))
  const at = (offset: number) =>
    windowRows(
      rows,
      {
        offset,
        limit: history.width,
        minimum: -1,
        descending: false,
        nestedLimit: rows.length,
      },
      false,
    ) as Array<WindowRow>
  return {
    committed: at(history.offset),
    imperative: at(history.imperative),
    changed: at(9),
  }
}
function checkRecovery(
  history: Omit<RecoveryHistory, `changeKey` | `proposal`>,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelRecovery>,
): Verdict {
  for (const member of recoveryHistories(history)) {
    const prefix = `${member.proposal}/${member.changeKey}/`
    const cuts = trace
      .filter(({ checkpoint }) => checkpoint.startsWith(prefix))
      .map(({ checkpoint, value }) => ({
        checkpoint: checkpoint.slice(prefix.length),
        value,
      }))
    const targets: Record<string, Array<WindowRow>> = {
      [`Svelte committed declarative move`]: expected.committed,
      [`imperative window before rejected input`]: expected.imperative,
      [`recovered client key`]: member.changeKey
        ? expected.changed
        : expected.imperative,
    }
    for (const { checkpoint, value } of cuts) {
      if (checkpoint in targets) {
        const wrong = judgeWindow(checkpoint, value, targets[checkpoint]!, true)
        if (wrong.kind === `violation`) return wrong
      } else {
        try {
          // Svelte appends its host frame to the authored Error's message.
          // The old assertion compared with that same input Error after the
          // read; retain its contemporaneous message rather than inventing a
          // fresh unmodified expectation at the later native check.
          const fact = value as {
            rejection: { error: unknown } | undefined
            expectedError: Error
          }
          expect(() => {
            if (fact.rejection) throw fact.rejection.error
          }).toThrow(fact.expectedError)
        } catch (error) {
          return assertionFailure(checkpoint, error)
        }
      }
    }
    for (const checkpoint of [
      ...Object.keys(targets),
      `rejected data`,
      `rejected collection`,
      `rejected flush`,
    ])
      if (cuts.filter((entry) => entry.checkpoint === checkpoint).length !== 1)
        return violation(
          checkpoint,
          `expected every recovery family and cut`,
          `client window recovery`,
        )
  }
  return pass
}
oracleProperty({
  id: `svelte.client-window-recovery`,
  law: {
    statement: `An unchanged explicit client key retains its authored input through rejected key reads and imperative window changes; a changed key admits the proposed query.`,
    authority: `packages/db/tests/conformance/contract.ts query identity law and packages/db/tests/conformance/window-history-oracle.ts`,
    limits: `Existing four body/dependency and same/changed-key recovery members per generated tuple at native Svelte flush/settlement cuts.`,
  },
  owns: [`src/useLiveQuery.svelte.ts#useLiveQuery`],
  histories: {
    arbitrary: recoveryArbitrary,
    runs: 24,
    fixedSeeds: [2348],
    states: recoveryStates,
    constructed: [
      {
        name: `complete recovery family`,
        enters: recoveryStates,
        build: (history) => ({ ...history }),
      },
    ],
  },
  model: modelRecovery,
  driver: async (history, observe) => {
    for (const member of recoveryHistories(history))
      await recordRecovery(member, (checkpoint, value) =>
        observe(
          checkpoint === `reach`
            ? checkpoint
            : `${member.proposal}/${member.changeKey}/${checkpoint}`,
          value,
        ),
      )
  },
  check: checkRecovery,
})
declareOracle({
  grammar: [recoveryArbitrary, recoveryHistories],
  model: [modelRecovery],
  check: [checkRecovery],
})
