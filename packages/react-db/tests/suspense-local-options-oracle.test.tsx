/**
 * The shared independent-caller law receives real React Suspense mounts in
 * unscoped and DbClient scopes. Each option varies alone over absent/equal/
 * different declarations, including explicit undefined, with derived, same
 * and different explicit keys.
 * Public output identity and supplied config references are checked after
 * each committed mount and the first is checked again after its peer mounts.
 * These mounts create no reusable DbClient preload record. Cached-result
 * getKey/schema conflicts are judged by cache-options-oracle's warm driver.
 * A focused pending grammar keeps delivery held until two separate boundaries
 * show their fallbacks. Equal/different callback and scalar declarations then
 * use the same committed-output comparison as the ready grammar. It checks no
 * abandoned render, rejection or cleanup race.
 * This receiver makes no server-render or hydration scheduling claim.
 */
import {
  act,
  cleanup,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { Suspense } from 'react'
import { DbClient, createCollection } from '@tanstack/db'
import { afterAll, expect } from 'vitest'
import { DbProvider } from '../src/DbProvider'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import {
  checkLocalOutputOwnership,
  equalLocalDeclarations,
  localOptionPairs,
} from '../../db/tests/live-query-cache-options-oracle'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { oracleProperty } from '../../db/tests/oracle-config'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { withOracleCleanup } from '../../db/tests/utils'
import type { Collection, Context, InitialQueryBuilder } from '@tanstack/db'
import type { UseLiveQueryConfig } from '../src/useLiveQuery'
import type { ReactNode } from 'react'

declareOracle({
  owns: [
    `src/DbProvider.tsx#DbProvider`,
    `src/useLiveSuspenseQuery.ts#useLiveSuspenseQuery`,
  ],
  grammar: [localOptionPairs],
  check: [checkLocalOutputOwnership],
})
const histories = localOptionPairs.flatMap((history, cell) =>
  // Callback/reference and scalar equality are distinct premises. Keep the
  // full ready matrix; cross only these representatives with held delivery.
  (history.declarations[0] === `first` &&
  (history.declarations[1] === `first` ||
    history.declarations[1] === `other`) &&
  (history.option === `onUpdate` || history.option === `gcTime`)
    ? ([`ready`, `pending`] as const)
    : ([`ready`] as const)
  ).flatMap((phase) =>
    ([`unscoped`, `client`] as const).map((scope) => ({
      ...history,
      scope,
      cell,
      phase,
    })),
  ),
)
// Require pending admission in each cache scope independently of which
// histories the grammar happens to produce.
const pendingStates = [
  `both-suspended`,
  `equal-options`,
  `different-options`,
  `callback-options`,
  `scalar-options`,
] as const
const pendingCounts = Object.fromEntries(
  ([`unscoped`, `client`] as const).map((scope) => [
    scope,
    new Map<string, number>(pendingStates.map((state) => [state, 0])),
  ]),
)
afterAll(() => {
  for (const counts of Object.values(pendingCounts))
    oracleAssertion(`required pending option states`, () =>
      oracleAssertion(
        'expect([...counts.values()].every((count) => count > 0)).toBe(true)',
        () =>
          expect([...counts.values()].every((count) => count > 0)).toBe(true),
      ),
    )
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `Suspense local options pending reach`,
      Object.fromEntries(
        Object.entries(pendingCounts).map(([scope, counts]) => [
          scope,
          Object.fromEntries(counts),
        ]),
      ),
    )
})
type LocalHistory = (typeof histories)[number]
// Keep the complete native assertion helper and its existing independent
// ownership judgment. The adapter changes registration and error transport only.
async function checkSuspenseLocalHistory(
  history: LocalHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const requiredStates = [
    `first-output`,
    `second-output`,
    `retained-first`,
    ...(history.phase === `pending` ? [`both-suspended`] : []),
  ]
  const reached = new Set<string>()
  const markReach = (state: string) => {
    reached.add(state)
    observe(`reach`, state)
  }
  const pendingEntered = new Set<string>()
  const markPending = (state: string) => {
    if (history.phase !== `pending` || pendingEntered.has(state)) return
    oracleAssertion(`known pending option state`, () =>
      oracleAssertion('expect(pendingStates).toContain(state)', () =>
        expect(pendingStates).toContain(state),
      ),
    )
    pendingEntered.add(state)
    const counts = pendingCounts[history.scope]!
    counts.set(state, counts.get(state)! + 1)
    observe(`reach`, `pending/${history.scope}/${state}`)
  }
  const client = history.scope === `client` ? new DbClient() : undefined
  type Row = {
    id: string
  }
  let starts = 0
  let deliver = () => {}
  const source = createCollection<Row>({
    id: `local-options-${history.scope}-${history.cell}`,
    getKey: (row) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        starts++
        let delivered = false
        deliver = () => {
          if (delivered) return
          delivered = true
          begin()
          write({ type: `insert`, value: { id: `one` } })
          commit()
          markReady()
        }
        if (history.phase === `ready`) deliver()
      },
    },
  })
  const query = (q: InitialQueryBuilder) => q.from({ row: source })
  const schema = () => ({
    '~standard': {
      version: 1,
      vendor: `local-options`,
      validate: (value: unknown) => ({ value }),
    },
  })
  const fixtures = {
    getKey: [(row: Row) => `first-${row.id}`, (row: Row) => `other-${row.id}`],
    schema: [schema(), schema()],
    onInsert: [async () => {}, async () => {}],
    onUpdate: [async () => {}, async () => {}],
    onDelete: [async () => {}, async () => {}],
    id: [`first`, `other`],
    startSync: [false, true],
    gcTime: [0, 10000],
    singleResult: [true],
    defaultStringCollation: [
      { stringSort: `lexical` },
      { stringSort: `lexical` },
    ],
  } satisfies Record<
    Exclude<
      keyof UseLiveQueryConfig<Context>,
      | `query`
      | `queryKey`
      | `client`
      | `pool`
      | `autoIndex`
      | `defaultIndexType`
    >,
    ReadonlyArray<unknown>
  >
  const values = {
    absent: undefined,
    undefined: undefined,
    first: fixtures[history.option][0],
    other: fixtures[history.option][1],
  }
  function Wrapper({
    children,
    binding,
  }: {
    children: ReactNode
    binding: number
  }) {
    const content = (
      <Suspense fallback={<div data-testid={`pending-${binding}`} />}>
        {children}
      </Suspense>
    )
    return client ? <DbProvider client={client}>{content}</DbProvider> : content
  }
  const outputs = new Set<Pick<Collection, `cleanup`>>()
  const mount = (binding: 0 | 1) => {
    const declaration = history.declarations[binding]
    const value = values[declaration]
    const result = renderHook(
      () =>
        useLiveSuspenseQuery({
          query,
          queryKey:
            history.identity === `derived`
              ? undefined
              : [
                  `local-options`,
                  history.cell,
                  history.identity === `same-key` ? 0 : binding,
                ],
          ...(declaration === `absent` ? {} : { [history.option]: value }),
        }),
      {
        wrapper: ({ children }) => (
          <Wrapper binding={binding}>{children}</Wrapper>
        ),
      },
    )
    // This authored query is a list. The builder's findOne action owns
    // result shape; this receiver judges local option identity only.
    return async () => {
      await waitFor(() =>
        oracleAssertion(
          'expect(result.result.current.data).toHaveLength(1)',
          () => expect(result.result.current.data).toHaveLength(1),
        ),
      )
      const output = result.result.current.collection
      const option = history.option
      outputs.add(output)
      if (
        declaration !== `absent` &&
        declaration !== `undefined` &&
        option !== `singleResult`
      )
        oracleAssertion('expect(output.config[option]).toBe(value)', () =>
          expect(output.config[option]).toBe(value),
        )
      return output
    }
  }
  await withOracleCleanup(async () => {
    if (history.phase === `ready`) await source.preload()
    const readFirst = mount(0)
    const readyFirst = history.phase === `ready` ? await readFirst() : undefined
    const firstOptions = readyFirst ? { ...readyFirst.config } : undefined
    const readSecond = mount(1)
    if (history.phase === `pending`) {
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
      markPending(
        history.option === `onUpdate` ? `callback-options` : `scalar-options`,
      )
      await act(() => deliver())
    }
    const first = readyFirst ?? (await readFirst())
    const retainedOptions = firstOptions ?? { ...first.config }
    markReach(`first-output`)
    const second = await readSecond()
    markReach(`second-output`)
    oracleAssertion('checkLocalOutputOwnership', () =>
      checkLocalOutputOwnership(first, second, history),
    )
    markPending(
      equalLocalDeclarations(history) ? `equal-options` : `different-options`,
    )
    oracleAssertion('expect(first.config).toEqual(retainedOptions)', () =>
      expect(first.config).toEqual(retainedOptions),
    )
    markReach(`retained-first`)
    oracleAssertion(`required local option states`, () =>
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
  ])
}
oracleProperty({
  id: `react.suspense-local-options`,
  law: {
    statement: `Independent Suspense bindings keep their declared local output options and retain the first output after a peer mounts.`,
    authority: `packages/db/tests/live-query-cache-options-oracle.ts maintainer independent-caller law and existing React pending receiving histories.`,
    limits: `The unchanged finite option/reference/identity matrix and focused pending callback/scalar histories in unscoped and DbClient scopes; no server render, hydration or abandoned-render claim.`,
  },
  histories,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `Suspense local output options`,
      plan,
      observe,
      () => checkSuspenseLocalHistory(plan.history, observe),
    ),
  check: forwardAssertionJudgment,
})
