/**
 * Each initially mounted Suspense binding receives its declared output indexing
 * settings, even when a peer already reads the same source and query. The
 * shared handoff owner's explicit-output law applies to each binding; cache
 * reuse cannot replace one binding's declaration with its peer's declaration.
 * Equal declarations still produce independent output Collections
 * (maintainer decision, 2026-11-03). Mounted bindings retain their first options until query identity changes, as
 * required by the approved first-options rule.
 *
 * The shared grammar exhausts both configurations and three identity relations:
 * derived identity, the same explicit queryKey, and different explicit keys.
 * Each declaration is judged at admission and, when valid, after real React
 * Suspense commits its rows. Rechecking the first binding after the second
 * rejects a cache repair that overwrites a retained Collection's settings.
 * Both unscoped and DbProvider-scoped caches receive the same histories. A
 * same-name grammar uses distinct constructor references with the same class name;
 * names cannot replace the declared constructor reference. A presence grammar
 * compares omitted fields with explicit undefined in both orders.
 * A focused pending grammar holds source writes while two separate boundaries
 * show fallbacks, then checks the same output law after delivery. It crosses
 * mode/constructor equality and both cache scopes, without multiplying the
 * entire ready matrix. This driver judges no hydration, abandoned render,
 * rejection while pending, or server render.
 */
import {
  act,
  cleanup,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { Suspense } from 'react'
import {
  BTreeIndex,
  BasicIndex,
  DbClient,
  createCollection,
} from '@tanstack/db'
import { afterAll, expect, vi } from 'vitest'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { DbProvider } from '../src/DbProvider'
import {
  expectIndependentIndexingOutputs,
  expectIndexingAdmission,
  expectIndexingConfiguration,
  expectedIndexing,
  indexConfigurationPairs,
  indexConfigurations,
  indexOptionAbsencePairs,
} from '../../db/tests/conformance/indexing-config-oracle'
import { expectUnorderedRows } from '../../db/tests/conformance/result-laws'
import { oracleProperty } from '../../db/tests/oracle-config'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { withOracleCleanup } from '../../db/tests/utils'
import type { InitialQueryBuilder } from '@tanstack/db'
import type { ReactNode } from 'react'
import type { IndexSettings } from '../../db/tests/conformance/indexing-config-oracle'
import type { Row } from '../../db/tests/conformance/contract'

function createSameNameIndex() {
  return class SameNameIndex extends BasicIndex {}
}
const firstNamedIndex = createSameNameIndex()
const secondNamedIndex = createSameNameIndex()
const configurations = indexConfigurations({
  indexTypes: { basic: BasicIndex, btree: BTreeIndex },
})
const namedConfigurations = ([`off`, `eager`] as const).flatMap((autoIndex) =>
  [firstNamedIndex, secondNamedIndex].map((defaultIndexType) => ({
    autoIndex,
    defaultIndexType,
  })),
)
const pairs = [
  ...indexOptionAbsencePairs().map((history) => ({
    ...history,
    kind: `presence`,
  })),
  ...indexConfigurationPairs(configurations).map((history) => ({
    ...history,
    kind: `built-in`,
  })),
  ...indexConfigurationPairs(namedConfigurations)
    .filter(
      ({ first, second }) => first.defaultIndexType !== second.defaultIndexType,
    )
    .map((history) => ({ ...history, kind: `same-name` })),
]
const histories = pairs.flatMap((history, cell) =>
  (history.first.autoIndex === `off` &&
  history.first.defaultIndexType === BasicIndex &&
  (history.second.autoIndex === `off` ||
    history.second.autoIndex === `eager`) &&
  (history.second.defaultIndexType === BasicIndex ||
    history.second.defaultIndexType === BTreeIndex)
    ? ([`ready`, `pending`] as const)
    : ([`ready`] as const)
  ).flatMap((phase) =>
    ([`unscoped`, `client`] as const).map((scope) => ({
      ...history,
      cell,
      scope,
      phase,
    })),
  ),
)
type ObservedOutput = {
  config: IndexSettings
  cleanup: (options?: { dependents?: boolean }) => Promise<void>
}
// These receiving paths owe pending peers even if a later grammar edit drops
// every pending case. A per-history conditional tag alone would miss that loss.
const pendingStates = [
  `both-suspended`,
  `equal-options`,
  `different-options`,
  `mode-change`,
  `constructor-change`,
] as const
const pendingCounts = Object.fromEntries(
  ([`unscoped`, `client`] as const).map((scope) => [
    scope,
    new Map<string, number>(pendingStates.map((state) => [state, 0])),
  ]),
)
afterAll(() => {
  for (const counts of Object.values(pendingCounts))
    oracleAssertion(`required pending indexing states`, () =>
      oracleAssertion(
        'expect([...counts.values()].every((count) => count > 0)).toBe(true)',
        () =>
          expect([...counts.values()].every((count) => count > 0)).toBe(true),
      ),
    )
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `Suspense indexing pending reach`,
      Object.fromEntries(
        Object.entries(pendingCounts).map(([scope, counts]) => [
          scope,
          Object.fromEntries(counts),
        ]),
      ),
    )
})
type IndexingHistory = (typeof histories)[number]
// Constructor references remain in the resolved authored plan, while the finite
// case index is replayable data. The original native judgment stays complete.
async function checkSuspenseIndexingHistory(
  { first, second, identity, cell, scope, kind, phase }: IndexingHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const requiredStates = [
    `first-admission`,
    `second-admission`,
    `retained-first`,
    ...(phase === `pending` ? [`both-suspended`] : []),
    ...(!expectedIndexing(first).rejects ? [`retained-options`] : []),
    ...(!expectedIndexing(first).rejects && !expectedIndexing(second).rejects
      ? [`rebound-options`]
      : []),
  ]
  const reached = new Set<string>()
  const markReach = (state: string) => {
    reached.add(state)
    observe(`reach`, state)
  }
  const pendingEntered = new Set<string>()
  const markPending = (state: string) => {
    if (phase !== `pending` || pendingEntered.has(state)) return
    oracleAssertion(`known pending indexing state`, () =>
      oracleAssertion('expect(pendingStates).toContain(state)', () =>
        expect(pendingStates).toContain(state),
      ),
    )
    pendingEntered.add(state)
    const counts = pendingCounts[scope]!
    counts.set(state, counts.get(state)! + 1)
    observe(`reach`, `pending/${scope}/${state}`)
  }
  if (kind === `same-name`) {
    oracleAssertion(
      'expect(first.defaultIndexType).not.toBe(second.defaultIndexType)',
      () => expect(first.defaultIndexType).not.toBe(second.defaultIndexType),
    )
    oracleAssertion(
      'expect(first.defaultIndexType?.name).toBe(second.defaultIndexType?.name)',
      () =>
        expect(first.defaultIndexType?.name).toBe(
          second.defaultIndexType?.name,
        ),
    )
  }
  const rows: Array<Row> = [
    { id: `1`, name: `Alice`, age: 30, team: `a` },
    { id: `2`, name: `Bob`, age: 25, team: `b` },
  ]
  let starts = 0
  let deliver = () => {}
  const source = createCollection<Row>({
    id: `suspense-indexing-${scope}-${cell}`,
    getKey: (row) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        starts++
        let delivered = false
        deliver = () => {
          if (delivered) return
          delivered = true
          begin()
          for (const row of rows) write({ type: `insert`, value: { ...row } })
          commit()
          markReady()
        }
        if (phase === `ready`) deliver()
      },
    },
  })
  const client = scope === `client` ? new DbClient() : undefined
  function Wrapper({
    children,
    binding,
  }: {
    children: ReactNode
    binding: number
  }) {
    const suspense = (
      <Suspense
        fallback={<div data-testid={`pending-${binding}`}>Loading</div>}
      >
        {children}
      </Suspense>
    )
    return client ? (
      <DbProvider client={client}>{suspense}</DbProvider>
    ) : (
      suspense
    )
  }
  const query = (q: InitialQueryBuilder) => q.from({ row: source })
  const outputs = new Set<ObservedOutput>()
  let reconfigureFirst:
    ((settings: IndexSettings, rebind: boolean) => Promise<void>) | undefined
  // React reports an expected rejected render to console.error as well as
  // throwing it from renderHook. The admission observation keeps the error.
  const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
  const mount = (settings: IndexSettings, binding: 0 | 1) => {
    const queryKey =
      identity === `derived`
        ? undefined
        : [`suspense-indexing-${cell}`, identity === `same-key` ? 0 : binding]
    const admission: {
      rejected: boolean
      error?: unknown
    } = {
      rejected: false,
    }
    let read:
      | (() => {
          data: Array<Row>
          collection: ObservedOutput
        })
      | undefined
    let initialOutput: ObservedOutput | undefined
    try {
      const rendered = renderHook(
        ({ declaration, rebind }) =>
          useLiveSuspenseQuery({
            query,
            queryKey: rebind ? [`rebound-indexing`, cell] : queryKey,
            ...declaration,
          }),
        {
          wrapper: ({ children }) => (
            <Wrapper binding={binding}>{children}</Wrapper>
          ),
          initialProps: { declaration: settings, rebind: false },
        },
      )
      read = () => rendered.result.current
      if (binding === 0)
        reconfigureFirst = async (declaration, rebind) => {
          rendered.rerender({ declaration, rebind })
          await waitFor(() =>
            oracleAssertion(
              'expect(rendered.result.current.data).toHaveLength(rows.length)',
              () =>
                expect(rendered.result.current.data).toHaveLength(rows.length),
            ),
          )
          const output = rendered.result.current.collection
          outputs.add(output)
          oracleAssertion('expectIndexingConfiguration', () =>
            expectIndexingConfiguration(
              output,
              rebind ? declaration : settings,
            ),
          )
          if (!rebind)
            oracleAssertion('expect(output).toBe(initialOutput)', () =>
              expect(output).toBe(initialOutput),
            )
        }
    } catch (error) {
      admission.rejected = true
      admission.error = error
    }
    oracleAssertion('expectIndexingAdmission', () =>
      expectIndexingAdmission(admission, settings),
    )
    if (expectedIndexing(settings).rejects) return undefined
    return async () => {
      await waitFor(() =>
        oracleAssertion('expect(read!().data).toHaveLength(rows.length)', () =>
          expect(read!().data).toHaveLength(rows.length),
        ),
      )
      const result = read!()
      outputs.add(result.collection)
      initialOutput = result.collection
      oracleAssertion('expectUnorderedRows', () =>
        expectUnorderedRows(result.data, rows),
      )
      oracleAssertion('expectIndexingConfiguration', () =>
        expectIndexingConfiguration(result.collection, settings),
      )
      return result.collection
    }
  }
  await withOracleCleanup(async () => {
    if (phase === `ready`) await source.preload()
    const readFirst = mount(first, 0)
    const readyFirst = phase === `ready` ? await readFirst?.() : undefined
    markReach(`first-admission`)
    const readSecond = mount(second, 1)
    markReach(`second-admission`)
    if (phase === `pending`) {
      await waitFor(() =>
        oracleAssertion('expect(starts).toBe(1)', () => expect(starts).toBe(1)),
      )
      oracleAssertion(
        'expect(screen.getByTestId(`pending-0`)).toBeTruthy()',
        () => expect(screen.getByTestId(`pending-0`)).toBeTruthy(),
      )
      oracleAssertion(
        'expect(screen.getByTestId(`pending-1`)).toBeTruthy()',
        () => expect(screen.getByTestId(`pending-1`)).toBeTruthy(),
      )
      oracleAssertion('expect(source.status).toBe(`loading`)', () =>
        expect(source.status).toBe(`loading`),
      )
      markReach(`both-suspended`)
      markPending(`both-suspended`)
      if (first.autoIndex !== second.autoIndex) markPending(`mode-change`)
      if (first.defaultIndexType !== second.defaultIndexType)
        markPending(`constructor-change`)
      await act(() => deliver())
    }
    const firstOutput = readyFirst ?? (await readFirst?.())
    const secondOutput = await readSecond?.()
    if (firstOutput)
      oracleAssertion('expectIndexingConfiguration', () =>
        expectIndexingConfiguration(firstOutput, first),
      )
    oracleAssertion('expectIndependentIndexingOutputs', () =>
      expectIndependentIndexingOutputs(
        firstOutput,
        secondOutput,
        first,
        second,
      ),
    )
    markPending(
      first.autoIndex === second.autoIndex &&
        first.defaultIndexType === second.defaultIndexType
        ? `equal-options`
        : `different-options`,
    )
    markReach(`retained-first`)
    if (firstOutput) {
      await reconfigureFirst!(second, false)
      markReach(`retained-options`)
      if (!expectedIndexing(second).rejects) {
        await reconfigureFirst!(second, true)
        markReach(`rebound-options`)
      }
    }
    oracleAssertion(`required indexing states`, () =>
      oracleAssertion(
        'expect(requiredStates.filter((state) => !reached.has(state))).toEqual([])',
        () =>
          expect(requiredStates.filter((state) => !reached.has(state))).toEqual(
            [],
          ),
      ),
    )
  }, [
    () => deliver(),
    () => cleanup(),
    () =>
      withOracleCleanup(
        () => {},
        [...outputs].map(
          (output) => () => output.cleanup({ dependents: true }),
        ),
      ),
    () => client?.cleanup(),
    () => source.cleanup({ dependents: true }),
    () => errors.mockRestore(),
  ])
}
oracleProperty({
  id: `react.suspense-indexing-config`,
  law: {
    statement: `Each independent Suspense binding receives its declared indexing settings, keeps them through ordinary renders, and changes them only with query identity.`,
    authority: `packages/db/tests/conformance/indexing-config-oracle.ts explicit-output law; maintainer independent-output decision 2026-11-03 and first-options rule.`,
    limits: `The unchanged finite built-in, same-name constructor, presence, identity and two-cache-scope matrix plus focused pending delivery; no hydration, abandoned render, pending rejection or server render claim.`,
  },
  owns: [
    `src/useLiveSuspenseQuery.ts#useLiveSuspenseQuery`,
    `src/DbProvider.tsx#DbProvider`,
  ],
  histories: histories.map((_, index) => ({ index })),
  resolve: ({ index }) => ({ history: histories[index]! }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `Suspense indexing declarations`,
      plan,
      observe,
      () => checkSuspenseIndexingHistory(plan.history, observe),
    ),
  check: forwardAssertionJudgment,
})
