import fc from 'fast-check'
import { createCollection } from '@tanstack/db'
import { vi } from 'vitest'
import { startOfflineExecutor } from '../src/OfflineExecutor'
import { differs, oracleProperty, pass } from '../../db/tests/oracle-property'
import { FakeStorageAdapter, gate, turn } from './harness'
import { cleanupOfflineOracle } from './oracle-lifecycle'
import type { Transaction } from '@tanstack/db'
import type { Observation } from '../../db/tests/oracle-property'
import type { OfflineMutationFnParams, OnlineDetector } from '../src/types'

/**
 * Executor entry points preserve the authored mutation and submission options.
 * The leader uses durable admission; a follower uses core's direct mutation path.
 * Both keep optimism while the provider is held and settle with its answer.
 * Unknown mutation names fail when the transaction or action is created.
 * Authority: README Basic Usage, Manual Transaction Control, OfflineExecutor,
 * and Tracking Submission Status; public CreateOfflineTransactionOptions.
 * A name absent from the configured functions contradicts configuration.
 * AGENTS.md, Separate Valid Edge Cases from Contract Contradictions, requires
 * rejection at that boundary before mutation or false success.
 * Action variables belong to onMutate (CreateOfflineActionOptions); the named
 * mutation function's public input is OfflineMutationFnParams.
 *
 * This companion extends the settlement owner's missing public API boundaries.
 * Its model uses authored intent and boundary acknowledgements, never executor
 * queues. Controls separately judge durable membership and public count values.
 * Limits: controlled storage/provider, one runtime, disjoint inserts, no retries,
 * synchronous onMutate, and nonempty custom idempotency keys. Manual removal
 * supplies no invented cancellation or queued-caller settlement promise.
 */

class ApiDetector implements OnlineDetector {
  online = true
  private listeners = new Set<() => void>()
  isOnline() {
    return this.online
  }
  subscribe(callback: () => void) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  notifyOnline() {
    for (const callback of this.listeners) callback()
  }
  dispose() {
    this.listeners.clear()
  }
}
const drain = async () => {
  for (let i = 0; i < 12; i++) await turn()
}
type Row = { id: string; value: string }
type Outcome = `pending` | `fulfilled` | `rejected`
function receipt(promise: Promise<unknown>) {
  const result: { outcome: Outcome; error?: unknown } = { outcome: `pending` }
  void promise.then(
    () => {
      result.outcome = `fulfilled`
    },
    (error: unknown) => {
      result.outcome = `rejected`
      result.error = error
    },
  )
  return result
}
function fixture(
  leader: boolean,
  detector: ApiDetector,
  storage: FakeStorageAdapter,
  mutationFn: (params: OfflineMutationFnParams) => Promise<unknown>,
) {
  const rows = createCollection<Row, string>({
    id: `api-rows`,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: ({ markReady }) => {
        markReady()
      },
    },
  })
  const executor = startOfflineExecutor({
    collections: { rows },
    storage,
    onlineDetector: detector,
    leaderElection: {
      requestLeadership: () => Promise.resolve(leader),
      releaseLeadership() {},
      isLeader: () => leader,
      onLeadershipChange: () => () => {},
    },
    mutationFns: { apply: mutationFn },
  })
  return { executor, rows }
}

type ApiHistory = {
  leader: boolean
  path: `manual` | `auto` | `default` | `action`
  known: boolean
  customKey: boolean
  metadata: boolean
  value: string
}
const apiHistory = fc.record({
  leader: fc.boolean(),
  path: fc.constantFrom(`manual`, `auto`, `default`, `action`),
  known: fc.boolean(),
  customKey: fc.boolean(),
  metadata: fc.boolean(),
  value: fc.string({ minLength: 1, maxLength: 12 }),
})
type ApiCut = {
  creation: `ok` | `rejected`
  problem?: string
  calls: Array<{
    rows: Array<Row>
    metadata: unknown
    key: unknown
  }>
  variables: Array<unknown>
  rows: Array<Row>
  outcome: Outcome
  durable: number
}
// Only caller-authored values determine the expected payload. The key law
// permits any generated nonempty string; it does not assume UUID formatting.
function apiModel(plan: ApiHistory) {
  const row = { id: `row`, value: plan.value }
  return (checkpoint: string) => {
    const calls =
      !plan.known || (checkpoint === `edited` && plan.path === `manual`) ? 0 : 1
    return {
      creation: plan.known ? `ok` : `rejected`,
      calls,
      variables:
        plan.known && plan.path === `action` ? [{ value: plan.value }] : [],
      rows: plan.known && checkpoint !== `settled` ? [row] : [],
      outcome: checkpoint === `settled` ? `fulfilled` : `pending`,
      durable: plan.leader && checkpoint !== `settled` ? calls : 0,
      payload: [row],
      metadata:
        plan.path !== `action` && plan.metadata ? { label: plan.value } : {},
    }
  }
}
async function driveApi(
  plan: ApiHistory,
  observe: (cut: string, value: unknown) => void,
) {
  const held = gate()
  const detector = new ApiDetector()
  const storage = new FakeStorageAdapter()
  const calls: ApiCut[`calls`] = []
  const variables: Array<unknown> = []
  const { executor, rows } = fixture(
    plan.leader,
    detector,
    storage,
    async (params) => {
      calls.push({
        rows: params.transaction.mutations.map(
          (mutation) => mutation.modified as Row,
        ),
        metadata: params.transaction.metadata,
        key:
          plan.path !== `action` && plan.customKey
            ? params.idempotencyKey
            : typeof params.idempotencyKey === `string` &&
              params.idempotencyKey.length > 0,
      })
      await held.promise
    },
  )
  let tx: Transaction | undefined
  let creation: ApiCut[`creation`] = `ok`
  let problem: string | undefined
  let result = { outcome: `pending` as Outcome }
  let primaryFailure = false
  const snapshot = (checkpoint: string) =>
    observe(checkpoint, {
      creation,
      problem,
      calls: [...calls],
      variables: [...variables],
      rows: [...rows.values()].map(({ id, value }) => ({ id, value })),
      outcome: result.outcome,
      durable: Object.keys(storage.snapshot()).filter((key) =>
        key.startsWith(`tx:`),
      ).length,
    } satisfies ApiCut)
  try {
    await executor.waitForInit()
    const name = plan.known ? `apply` : `missing`
    try {
      if (plan.path === `action`) {
        const action = executor.createOfflineAction<{ value: string }>({
          mutationFnName: name,
          onMutate: (input) => {
            variables.push(input)
            rows.insert({ id: `row`, value: input.value })
          },
        })
        if (plan.known) tx = action({ value: plan.value })
      } else {
        const submission = executor.createOfflineTransaction({
          mutationFnName: name,
          ...(plan.path === `default`
            ? {}
            : { autoCommit: plan.path === `auto` }),
          ...(plan.customKey ? { idempotencyKey: `key ${plan.value}` } : {}),
          ...(plan.metadata ? { metadata: { label: plan.value } } : {}),
        })
        if (plan.known)
          tx = submission.mutate(() =>
            rows.insert({ id: `row`, value: plan.value }),
          )
        else submission.rollback()
      }
    } catch (error) {
      creation = `rejected`
      if (plan.known) problem = String(error)
    }
    if (!plan.known) {
      snapshot(`created`)
      return
    }
    if (tx) result = receipt(tx.when(`settled`))
    await drain()
    snapshot(`edited`)
    if (plan.path === `manual` && tx) receipt(tx.commit())
    await drain()
    snapshot(`held`)
    held.resolve()
    await drain()
    snapshot(`settled`)
  } catch (error) {
    primaryFailure = true
    throw error
  } finally {
    held.resolve()
    executor.dispose()
    await drain()
    if (tx && (tx.state === `pending` || tx.state === `persisting`))
      tx.rollback({ isSecondaryRollback: true })
    await cleanupOfflineOracle([() => rows.cleanup()], primaryFailure)
  }
}
function checkApi(
  plan: ApiHistory,
  trace: ReadonlyArray<Observation>,
  model: ReturnType<typeof apiModel>,
) {
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    const cut = value as ApiCut
    const expected = model(checkpoint)
    const error =
      differs(checkpoint, `name validation`, cut.creation, expected.creation) ??
      differs(checkpoint, `entry point`, cut.problem, undefined) ??
      differs(
        checkpoint,
        `provider invocation`,
        cut.calls.length,
        expected.calls,
      ) ??
      differs(
        checkpoint,
        `action variables`,
        cut.variables,
        expected.variables,
      ) ??
      differs(checkpoint, `optimistic lifetime`, cut.rows, expected.rows) ??
      differs(checkpoint, `caller settlement`, cut.outcome, expected.outcome) ??
      differs(checkpoint, `durable routing`, cut.durable, expected.durable)
    if (error) return error
    for (const call of cut.calls) {
      const payloadError =
        differs(checkpoint, `mutation payload`, call.rows, expected.payload) ??
        differs(
          checkpoint,
          `transaction metadata`,
          call.metadata,
          expected.metadata,
        ) ??
        differs(
          checkpoint,
          `idempotency key`,
          call.key,
          plan.path !== `action` && plan.customKey ? `key ${plan.value}` : true,
        )
      if (payloadError) return payloadError
    }
  }
  return pass
}
const apiStates = [
  `leader`,
  `follower`,
  `unknown transaction`,
  `unknown action`,
  `manual`,
  `auto`,
  `default`,
  `action`,
  `custom key`,
  `generated key`,
  `metadata`,
  ...[`leader`, `follower`].flatMap((role) =>
    [`manual`, `auto`, `default`, `action`].map((path) => `${role} ${path}`),
  ),
]
oracleProperty<ApiHistory, ReturnType<typeof apiModel>>({
  id: `offline.executor-api`,
  law: {
    statement: `Known mutation APIs preserve intent and options, use durable admission only for leaders, and retain optimism until provider settlement; unknown names reject at creation.`,
    authority: `offline-transactions README Basic Usage, Manual Transaction Control, OfflineExecutor, Tracking Submission Status; public transaction/action option types; AGENTS.md Separate Valid Edge Cases from Contract Contradictions (immediate rejection at a contradictory configuration boundary).`,
    limits: `Controlled provider/storage; disjoint inserts, synchronous action, nonempty custom keys, leader or follower after initialization.`,
  },
  owns: [
    `src/OfflineExecutor.ts#OfflineExecutor.createOfflineTransaction`,
    `src/OfflineExecutor.ts#OfflineExecutor.createOfflineAction`,
    `src/OfflineExecutor.ts#mutationFn`,
    `src/OfflineExecutor.ts#OfflineExecutor.persistTransaction`,
    `src/OfflineExecutor.ts#OfflineExecutor.removeFromOutbox`,
    `src/OfflineExecutor.ts#OfflineExecutor.peekOutbox`,
    `src/OfflineExecutor.ts#OfflineExecutor.clearOutbox`,
    `src/OfflineExecutor.ts#OfflineExecutor.getPendingCount`,
    `src/OfflineExecutor.ts#OfflineExecutor.getRunningCount`,
  ],
  histories: {
    arbitrary: apiHistory,
    runs: 32,
    fixedSeeds: [20261110],
    states: apiStates,
    constructed: apiStates.map((state) => ({
      name: state,
      enters: [state],
      build: (generated) => ({
        ...generated,
        known: !state.startsWith(`unknown`),
        leader:
          !state.startsWith(`follower`) &&
          state !== `generated key` &&
          state !== `metadata`,
        path:
          state === `unknown action` ||
          state === `action` ||
          state.endsWith(` action`)
            ? `action`
            : state === `manual` || state.endsWith(` manual`)
              ? `manual`
              : state === `auto` || state.endsWith(` auto`)
                ? `auto`
                : `default`,
        customKey: state !== `generated key`,
        metadata: true,
      }),
    })),
  },
  model: apiModel,
  driver: async (plan, observe) => {
    const trace: Array<Observation> = []
    await driveApi(plan, (checkpoint, value) => {
      trace.push({ checkpoint, value })
      observe(checkpoint, value)
    })
    const reached = trace.at(-1)?.value as ApiCut | undefined
    if (reached?.creation === `rejected` && !plan.known)
      observe(
        `reach`,
        plan.path === `action` ? `unknown action` : `unknown transaction`,
      )
    if (reached?.calls.length) {
      observe(`reach`, plan.leader ? `leader` : `follower`)
      observe(`reach`, plan.path)
      observe(`reach`, `${plan.leader ? `leader` : `follower`} ${plan.path}`)
      observe(
        `reach`,
        plan.customKey && plan.path !== `action`
          ? `custom key`
          : `generated key`,
      )
      if (plan.metadata && plan.path !== `action`) observe(`reach`, `metadata`)
    }
  },
  check: checkApi,
  calibrations: [
    {
      name: `provider omission`,
      law: `provider invocation`,
      corrupt: (trace) =>
        trace.some(
          (entry) =>
            entry.checkpoint !== `reach` &&
            (entry.value as ApiCut).calls.length,
        )
          ? trace.map((entry) =>
              entry.checkpoint === `reach`
                ? entry
                : {
                    ...entry,
                    value: { ...(entry.value as ApiCut), calls: [] },
                  },
            )
          : undefined,
    },
  ],
})

type ControlHistory = {
  operation: `remove` | `clear` | `fatal`
  count: number
  running: boolean
  value: string
}
const controlHistory = fc.record({
  operation: fc.constantFrom(`remove`, `clear`, `fatal`),
  count: fc.integer({ min: 1, max: 3 }),
  running: fc.boolean(),
  value: fc.string({ minLength: 1, maxLength: 10 }),
})
type ControlCut = {
  ids: Array<number> | `invalid`
  pending: unknown
  running: unknown
  problem?: string
  outcomes: Array<Outcome>
  calls: Array<number>
}
// Durable membership follows acknowledged public removal, independently of
// scheduler representation. Count checks apply only to known queued/running
// premises and an idle clear; removal does not define caller cancellation.
function controlsModel(plan: ControlHistory) {
  return (checkpoint: string) => {
    const submitted = Array.from({ length: plan.count }, (_, index) => index)
    if (checkpoint === `empty`) return { ids: [], pending: 0, running: 0 }
    if (checkpoint === `queued`)
      return { ids: submitted, pending: plan.count, running: 0 }
    if (checkpoint === `running`)
      return { ids: submitted, pending: plan.count, running: 1 }
    if (checkpoint === `removed`)
      return {
        ids: plan.operation === `clear` ? [] : submitted.slice(1),
        ...(plan.operation === `clear` && !plan.running
          ? { pending: 0, running: 0 }
          : {}),
      }
    return { ids: [0], secondOutcome: `rejected` }
  }
}
async function driveControls(
  plan: ControlHistory,
  observe: (cut: string, value: unknown) => void,
) {
  const detector = new ApiDetector()
  detector.online = false
  const held = gate()
  let failDelete = false
  const storage = new (class extends FakeStorageAdapter {
    override async delete(key: string) {
      if (failDelete) throw new Error(`storage fault`)
      return super.delete(key)
    }
  })()
  const ids: Array<string> = []
  const calls: Array<number> = []
  const outcomes: Array<ReturnType<typeof receipt>> = []
  const transactions: Array<Transaction> = []
  const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const errorLog = vi.spyOn(console, `error`).mockImplementation(() => {})
  const { executor, rows } = fixture(
    true,
    detector,
    storage,
    async (params) => {
      calls.push(ids.indexOf(params.transaction.id))
      await held.promise
    },
  )
  const snapshot = async (checkpoint: string, problem?: string) => {
    let durable: ControlCut[`ids`] = `invalid`
    try {
      const entries = await executor.peekOutbox()
      if (Array.isArray(entries))
        durable = entries.map((entry) => ids.indexOf(entry.id)).sort()
    } catch (error) {
      problem ??= String(error)
    }
    let pending: unknown, running: unknown
    try {
      pending = executor.getPendingCount()
    } catch (error) {
      problem ??= String(error)
    }
    try {
      running = executor.getRunningCount()
    } catch (error) {
      problem ??= String(error)
    }
    const cut: ControlCut = {
      ids: durable,
      pending,
      running,
      problem,
      outcomes: outcomes.map((result) => result.outcome),
      calls: [...calls],
    }
    observe(checkpoint, cut)
    return cut
  }
  const submit = (index: number) => {
    const submission = executor.createOfflineTransaction({
      mutationFnName: `apply`,
      autoCommit: false,
    })
    ids.push(submission.id)
    const transaction = submission.mutate(() =>
      rows.insert({ id: `row ${index}`, value: plan.value }),
    )
    transactions.push(transaction)
    outcomes.push(receipt(transaction.when(`settled`)))
    receipt(submission.commit())
  }
  try {
    // These calls begin in the constructor's initial synchronous turn. The
    // collaborators are absent even though their async initialization may finish
    // before all acknowledgements are observed.
    let initialProblem: string | undefined
    let initialPending: unknown, initialRunning: unknown
    try {
      initialPending = executor.getPendingCount()
    } catch (error) {
      initialProblem = String(error)
    }
    try {
      initialRunning = executor.getRunningCount()
    } catch (error) {
      initialProblem ??= String(error)
    }
    const emptyPeek = executor.peekOutbox().then(
      (entries) => Array.isArray(entries) && entries.length === 0,
      (error: unknown) => {
        initialProblem ??= String(error)
        return false
      },
    )
    const initialRemove = executor
      .removeFromOutbox(`absent`)
      .catch((error: unknown) => {
        initialProblem ??= String(error)
      })
    const initialClear = executor.clearOutbox().catch((error: unknown) => {
      initialProblem ??= String(error)
    })
    const empty = await emptyPeek
    await initialRemove
    await initialClear
    observe(`empty`, {
      ids: empty ? [] : `invalid`,
      pending: initialPending,
      running: initialRunning,
      problem: initialProblem,
      outcomes: [],
      calls: [],
    } satisfies ControlCut)
    if (
      empty &&
      initialPending === 0 &&
      initialRunning === 0 &&
      !initialProblem
    )
      observe(`reach`, `empty before initialization`)
    await executor.waitForInit()
    const count = plan.operation === `fatal` ? 1 : plan.count
    for (let index = 0; index < count; index++) submit(index)
    await drain()
    if (plan.operation !== `fatal`) {
      const queued = await snapshot(`queued`)
      if (
        Array.isArray(queued.ids) &&
        queued.ids.length === count &&
        queued.pending === count &&
        queued.running === 0 &&
        calls.length === 0 &&
        outcomes.every((result) => result.outcome === `pending`)
      )
        observe(`reach`, `queued provider`)
    }
    if (plan.running || plan.operation === `fatal`) {
      detector.online = true
      detector.notifyOnline()
      await drain()
      if (plan.operation !== `fatal`) {
        const running = await snapshot(`running`)
        if (
          running.running === 1 &&
          calls.length === 1 &&
          outcomes[0]?.outcome === `pending`
        )
          observe(`reach`, `held provider`)
      }
    }
    if (plan.operation === `fatal`) {
      failDelete = true
      held.resolve()
      await drain()
      submit(1)
      await drain()
      await snapshot(`fault refusal`)
      if (
        outcomes[0]?.outcome === `rejected` &&
        outcomes[0].error instanceof Error &&
        outcomes[0].error.message === `storage fault` &&
        ids.length === 2 &&
        calls.length === 1
      )
        observe(`reach`, `fatal second admission`)
    } else {
      let problem: string | undefined
      try {
        if (plan.operation === `remove`)
          await executor.removeFromOutbox(ids[0]!)
        else await executor.clearOutbox()
      } catch (error) {
        problem = String(error)
      }
      await drain()
      const removed = await snapshot(`removed`, problem)
      if (
        !removed.problem &&
        Array.isArray(removed.ids) &&
        removed.ids.length === (plan.operation === `clear` ? 0 : count - 1)
      )
        observe(`reach`, plan.operation)
    }
  } catch (error) {
    // A public operation throwing is a rejected observation, not a fixture
    // crash. This lets source mutants receive a named-law judgment.
    await snapshot(`unexpected public error`, String(error))
  } finally {
    try {
      executor.dispose()
      held.resolve()
      await drain()
      for (const tx of transactions)
        if (tx.state === `pending` || tx.state === `persisting`)
          tx.rollback({ isSecondaryRollback: true })
      await cleanupOfflineOracle([() => rows.cleanup()], false)
    } finally {
      warn.mockRestore()
      errorLog.mockRestore()
    }
  }
}
function checkControls(
  _plan: ControlHistory,
  trace: ReadonlyArray<Observation>,
  model: ReturnType<typeof controlsModel>,
) {
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    const cut = value as ControlCut
    const expected = model(checkpoint)
    const error =
      differs(checkpoint, `public controls`, cut.problem, undefined) ??
      differs(checkpoint, `durable membership`, cut.ids, expected.ids) ??
      (`pending` in expected
        ? differs(checkpoint, `pending count`, cut.pending, expected.pending)
        : undefined) ??
      (`running` in expected
        ? differs(checkpoint, `running count`, cut.running, expected.running)
        : undefined) ??
      (`secondOutcome` in expected
        ? differs(
            checkpoint,
            `fatal admission`,
            cut.outcomes[1],
            expected.secondOutcome,
          )
        : undefined)
    if (error) return error
  }
  return pass
}
const controlStates = [
  `empty before initialization`,
  `remove`,
  `clear`,
  `held provider`,
  `queued provider`,
  `fatal second admission`,
]
oracleProperty<ControlHistory, ReturnType<typeof controlsModel>>({
  id: `offline.executor-controls`,
  law: {
    statement: `Outbox controls expose durable membership, scheduler counts reflect queued and running work, and a fatal storage failure refuses new durable admission.`,
    authority: `offline-transactions README OfflineExecutor, Tracking Submission Status, and scheduled-entry count examples.`,
    limits: `Controlled storage/provider; one to three disjoint inserts; counts before initialization, queued, held provider and idle clear; no removal cancellation semantics.`,
  },
  owns: [
    `src/OfflineExecutor.ts#OfflineExecutor.createOfflineTransaction`,
    `src/OfflineExecutor.ts#OfflineExecutor.createOfflineAction`,
    `src/OfflineExecutor.ts#mutationFn`,
    `src/OfflineExecutor.ts#OfflineExecutor.persistTransaction`,
    `src/OfflineExecutor.ts#OfflineExecutor.removeFromOutbox`,
    `src/OfflineExecutor.ts#OfflineExecutor.peekOutbox`,
    `src/OfflineExecutor.ts#OfflineExecutor.clearOutbox`,
    `src/OfflineExecutor.ts#OfflineExecutor.getPendingCount`,
    `src/OfflineExecutor.ts#OfflineExecutor.getRunningCount`,
  ],
  histories: {
    arbitrary: controlHistory,
    runs: 24,
    fixedSeeds: [20261110],
    states: controlStates,
    constructed: controlStates.map((state) => ({
      name: state,
      enters: [state],
      build: (generated) => ({
        ...generated,
        operation:
          state === `fatal second admission`
            ? `fatal`
            : state === `remove`
              ? `remove`
              : `clear`,
        running: state === `held provider`,
      }),
    })),
  },
  model: controlsModel,
  driver: driveControls,
  check: checkControls,
  calibrations: [
    {
      name: `missing queued entry`,
      law: `durable membership`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `queued`
            ? { ...entry, value: { ...(entry.value as ControlCut), ids: [] } }
            : entry,
        ),
    },
  ],
})
