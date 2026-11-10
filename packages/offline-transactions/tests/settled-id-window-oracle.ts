import fc from 'fast-check'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { differs, oracleProperty, pass } from '../../db/tests/oracle-property'
import { createTestOfflineEnvironment, turn } from './harness'
import { cleanupOfflineOracle } from './oracle-lifecycle'
import type { Transaction } from '@tanstack/db'
import type { Observation } from '../../db/tests/oracle-property'

/**
 * A late waiter rejects for one of the executor's last 1,000 settled IDs.
 * An older settled ID is unknown again and its waiter remains pending.
 * Authority: README OfflineExecutor.waitForTransactionCompletion explicitly
 * states this horizon and the treatment of unknown IDs from other tabs.
 *
 * This grammar crosses both sides of that public boundary through real empty
 * transactions. Empty transactions settle without durable or provider work,
 * so the production driver can reach the horizon without copying the cache
 * implementation or calling its private bookkeeping. The API path varies.
 * The model computes a suffix of the authored settlement order. It never reads
 * the executor's Set, its capacity constant, or its membership classifier.
 *
 * Limits: unique transaction IDs, one executor, and fulfillment of empty
 * transactions. Other settlement outcomes are exercised by the settlement and
 * handoff owners. This property does not transport promises between tabs.
 */
type Path = `manual` | `auto` | `default` | `action`
type History = { count: number; path: Path }
const paths: Array<Path> = [`manual`, `auto`, `default`, `action`]
const history: fc.Arbitrary<History> = fc.record({
  count: fc.integer({ min: 998, max: 1003 }),
  path: fc.constantFrom(...paths),
})
type Result = `pending` | `fulfilled` | `rejected`
type Cut = {
  settled: number
  probes: Array<{ index: number | null; result: Result }>
  providerCalls: number
  outbox: number
}

// Position is the authored settlement order, not a production cache index.
function settledWindowModel({ count }: History) {
  return (index: number | null): Result =>
    index !== null && index >= Math.max(0, count - 1000)
      ? `rejected`
      : `pending`
}

async function driveSettledWindow(
  plan: History,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const env = createTestOfflineEnvironment()
  const ids: Array<string> = []
  const pendingProbes: Array<string> = []
  let primaryFailure = false
  try {
    await env.waitForLeader()
    for (let index = 0; index < plan.count; index++) {
      let transaction: Transaction
      if (plan.path === `action`) {
        transaction = env.executor.createOfflineAction({
          mutationFnName: env.mutationFnName,
          onMutate: () => {},
        })(undefined)
      } else {
        const offline = env.executor.createOfflineTransaction({
          mutationFnName: env.mutationFnName,
          ...(plan.path === `default`
            ? {}
            : { autoCommit: plan.path !== `manual` }),
        })
        transaction = offline.mutate(() => {})
        if (plan.path === `manual`) await offline.commit()
      }
      await transaction.when(`settled`)
      ids.push(transaction.id)
    }
    await turn()
    // The adjacent expired/recent positions distinguish > from >= at capacity,
    // while the first/last positions detect no eviction and wrong ordering.
    const positions = [
      ...new Set([0, plan.count - 1001, plan.count - 1000, plan.count - 1]),
    ].filter((index) => index >= 0)
    const probes = [...positions, null].map((index) => {
      const id = index === null ? `never-settled` : ids[index]!
      const probe = { index, result: `pending` as Result }
      pendingProbes.push(id)
      void env.executor.waitForTransactionCompletion(id).then(
        () => {
          probe.result = `fulfilled`
        },
        () => {
          probe.result = `rejected`
        },
      )
      return probe
    })
    await turn()
    observe(`settled ID window`, {
      settled: ids.length,
      probes,
      providerCalls: env.mutationCalls.length,
      outbox: Object.keys(env.storage.snapshot()).length,
    } satisfies Cut)
    observe(`reach`, `path ${plan.path}`)
    observe(
      `reach`,
      plan.count < 1000
        ? `below horizon`
        : plan.count === 1000
          ? `at horizon`
          : `beyond horizon`,
    )
  } catch (error) {
    primaryFailure = true
    throw error
  } finally {
    // Unknown/expired waiters intentionally remain pending at the comparison.
    // End only those test-created obligations after recording their results.
    for (const id of pendingProbes)
      env.executor.resolveTransaction(id, undefined)
    await cleanupOfflineOracle(
      [() => env.executor.dispose(), () => env.collection.cleanup()],
      primaryFailure,
    )
  }
}

function checkSettledWindow(
  plan: History,
  trace: ReadonlyArray<Observation>,
  model: ReturnType<typeof settledWindowModel>,
) {
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    const cut = value as Cut
    const difference =
      differs(checkpoint, `empty settlement`, cut.settled, plan.count) ??
      differs(checkpoint, `empty settlement`, cut.providerCalls, 0) ??
      differs(checkpoint, `empty settlement`, cut.outbox, 0)
    if (difference) return difference
    for (const { index, result } of cut.probes) {
      const mismatch = differs(
        checkpoint,
        `settled ID horizon`,
        result,
        model(index),
      )
      if (mismatch) return mismatch
    }
  }
  return pass
}

declareOracle({
  grammar: [history],
  model: [settledWindowModel],
  check: [checkSettledWindow],
})
const states = [
  ...paths.map((path) => `path ${path}`),
  `below horizon`,
  `at horizon`,
  `beyond horizon`,
]
oracleProperty<History, ReturnType<typeof settledWindowModel>>({
  id: `offline.settled-id-window`,
  law: {
    statement: `A late waiter rejects for one of the last 1,000 settled IDs and remains pending for an older or unknown ID.`,
    authority: `offline-transactions README, OfflineExecutor.waitForTransactionCompletion`,
    limits: `998–1003 unique fulfilled empty transactions, four public commit paths, one executor and runtime.`,
    owner: `Offline execution`,
  },
  histories: {
    arbitrary: history,
    runs: 12,
    fixedSeeds: [20261110],
    states,
    constructed: states.map((state) => ({
      name: state,
      enters: [state],
      build: (plan) => ({
        ...plan,
        ...(state.startsWith(`path `) ? { path: state.slice(5) as Path } : {}),
        ...(state === `below horizon` ? { count: 999 } : {}),
        ...(state === `at horizon` ? { count: 1000 } : {}),
        ...(state === `beyond horizon` ? { count: 1001 } : {}),
      }),
    })),
  },
  model: settledWindowModel,
  driver: driveSettledWindow,
  check: checkSettledWindow,
  calibrations: [
    {
      name: `an expired ID remains remembered`,
      law: `settled ID horizon`,
      corrupt: (trace, plan) =>
        plan.count <= 1000
          ? undefined
          : trace.map((entry) =>
              entry.checkpoint === `settled ID window`
                ? {
                    ...entry,
                    value: {
                      ...(entry.value as Cut),
                      probes: (entry.value as Cut).probes.map((probe) =>
                        probe.index === 0
                          ? { ...probe, result: `rejected` }
                          : probe,
                      ),
                    },
                  }
                : entry,
            ),
    },
  ],
})
