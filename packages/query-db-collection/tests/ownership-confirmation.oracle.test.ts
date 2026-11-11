import fc from 'fast-check'
import { createCollection } from '@tanstack/db'
import { afterEach, vi } from 'vitest'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'
import { declareOracle } from '../../db/tests/oracle-declaration.js'

import { withOracleCleanup } from '../../db/tests/utils.js'
import { atMutationCheckpoint } from '../../db/tests/mutation-confirmation-support.js'
import {
  checkMutationConfirmation,
  expectedMutationConfirmation,
  mutationConfirmationHistories,
  mutationConfirmationInputs,
  mutationConfirmationRows,
} from '../../db/tests/mutation-confirmation-oracle.js'
import { createDeferred } from '../../db/src/deferred.js'
import { queryCollectionOptions } from '../src/query.js'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import {
  createOwnershipStorage,
  createQueryClient,
  runCleanups,
} from './ownership-lifecycle-support.js'
import {
  checkPostHandlerRefetch,
  createRefetchCallSettlementModel,
  reduceRefetchCallSettlement,
} from './ownership-model-oracle'
import type { Item } from './ownership-lifecycle-support.js'
import type {
  QueryCollectionConfig,
  QueryCollectionUtils,
} from '../src/query.js'
import type {
  MutationConfirmationCut,
  MutationConfirmationHistory,
  MutationConfirmationObservation,
  MutationConfirmationRow,
} from '../../db/tests/mutation-confirmation-oracle.js'
import type {
  ConstructedHistory,
  Observation,
  Verdict,
} from '../../db/tests/oracle-property.js'
import type {
  RefetchApplicationOutcome,
  observeRefetchCallSettlement,
} from './ownership-model-oracle'

afterEach(runCleanups)
type Emit = (checkpoint: string, value: unknown) => void
// Error references are compared at the production boundary. The framework
// snapshots each observation, so transporting the Error itself would lose the
// exact identity relationship that the original law checks.
function emitMutationObservation(
  checkpoint: string,
  cut: MutationConfirmationCut,
  observation: MutationConfirmationObservation,
  failure: Error,
  emit: Emit,
) {
  emit(checkpoint, {
    cut,
    observation: { ...observation, error: undefined },
    errorRelation: {
      sameFailure: observation.error === failure,
      absent: observation.error === undefined,
    },
  })
}
async function delayTurns(turns: number) {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}
async function recordBoundary<T>(
  checkpoint: string,
  read: () => T,
  arrived: (value: T) => boolean,
  emit: Emit,
): Promise<boolean> {
  for (let turn = 0; turn < 200; turn++) {
    if (arrived(read())) {
      emit(checkpoint, read())
      return true
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  emit(checkpoint, read())
  return false
}

/** Confirmation and handler exit are independent boundaries. The existing
 * shared mutation model predicts rows and work at each held cut. A second call
 * ledger predicts post-handler receipt settlement without inferring it from
 * visible rows. Generated payload text changes real source and confirmed rows;
 * generated microtask delays perturb the held handler window. */
type MutationHistory = MutationConfirmationHistory & {
  suffix: string
  phaseDelay: number
}
type MutationPlan = {
  history: MutationHistory
  failure: Error
  inputs: ReturnType<typeof confirmationInputs>
}
type PostHistory = {
  operation: 'insert' | 'update' | 'delete'
  reject: boolean
  suffix: string
  phaseDelay: number
}
type PostPlan = { history: PostHistory; failure: Error }
function confirmationInputs(h: MutationHistory) {
  const change = (row: MutationConfirmationRow) => ({
    ...row,
    name: row.name + h.suffix,
    stable: row.stable + h.suffix,
  })
  return {
    peer: change(mutationConfirmationInputs.peer),
    before: change(mutationConfirmationInputs.before),
    optimistic: change(mutationConfirmationInputs.optimistic),
    confirmed: change(mutationConfirmationInputs.confirmed),
  }
}
const mutationFixed: Array<MutationHistory> = mutationConfirmationHistories(
  'query',
).map((h) => ({ ...h, suffix: '', phaseDelay: 0 }))
const mutationState = (h: MutationHistory) =>
  `${h.operation}/${h.outcome}/${h.confirmation}/${h.returned}/peer:${h.peer}`
const mutationStates = mutationFixed.map(mutationState)
const mutationObligations = new WeakMap<
  MutationHistory,
  ReadonlyArray<string>
>()
const mutationArbitrary = fc
  .tuple(
    fc.constantFrom(...mutationFixed),
    fc.string({ maxLength: 8 }),
    fc.integer({ min: 0, max: 3 }),
  )
  .map(
    ([base, suffix, phaseDelay]) => ({ ...base, suffix, phaseDelay }),
    (raw) => {
      const h = raw as MutationHistory
      const base = mutationFixed.find(
        (v) => mutationState(v) === mutationState(h),
      )
      if (!base) throw Error('Illegal confirmation history')
      return [base, h.suffix, h.phaseDelay] as const
    },
  )
const mutationConstructed: Array<ConstructedHistory<MutationHistory>> =
  mutationFixed.map((witness) => ({
    name: mutationState(witness),
    enters: [mutationState(witness)],
    build(generated) {
      const h = {
        ...witness,
        suffix: generated.suffix,
        phaseDelay: generated.phaseDelay,
      }
      mutationObligations.set(h, [mutationState(witness)])
      return h
    },
  }))
function mutationCuts(
  h: MutationHistory,
): Array<{ checkpoint: string; cut: MutationConfirmationCut }> {
  const cuts: Array<{ checkpoint: string; cut: MutationConfirmationCut }> = [
    { checkpoint: 'entered', cut: 'entered' },
  ]
  if (h.outcome !== 'reject-before-write') {
    cuts.push({ checkpoint: 'server-written', cut: 'server-written' })
    if (h.confirmation === 'refetch')
      cuts.push({
        checkpoint: 'confirmation-requested',
        cut: 'confirmation-requested',
      })
    if (h.confirmation !== 'none')
      cuts.push({
        checkpoint: 'confirmation-accepted',
        cut: 'confirmation-accepted',
      })
  }
  cuts.push(
    { checkpoint: 'settlement-waiter', cut: 'settled' },
    { checkpoint: 'settled', cut: 'settled' },
  )
  if (h.confirmation === 'none' && h.outcome !== 'reject-before-write')
    cuts.push(
      { checkpoint: 'late-confirmed', cut: 'late-confirmed' },
      { checkpoint: 'frozen-waiter', cut: 'settled' },
    )
  return cuts
}
function mutationModel(plan: MutationPlan) {
  return {
    cuts: mutationCuts(plan.history),
    requiredStates: mutationObligations.get(plan.history) ?? [
      mutationState(plan.history),
    ],
  }
}
function checkMutation(
  plan: MutationPlan,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof mutationModel>,
): Verdict {
  const facts = trace.filter((o) => o.checkpoint !== 'reach')
  for (let index = 0; index < expected.cuts.length; index++) {
    const cut = expected.cuts[index]!,
      fact = facts[index]
    if (fact?.checkpoint !== cut.checkpoint)
      return violation(
        cut.checkpoint,
        'the mutation observation cut did not arrive',
        'handler confirmation',
      )
    const value = fact.value as {
      cut: MutationConfirmationCut
      observation: MutationConfirmationObservation
      errorRelation: { sameFailure: boolean; absent: boolean }
    }
    if (value.cut !== cut.cut)
      return violation(
        cut.checkpoint,
        'the observation used a different model cut',
        'handler confirmation',
      )
    const expectedError = expectedMutationConfirmation(
      plan.history,
      cut.cut,
      plan.failure,
      plan.inputs,
    ).error
    const identity = differs(
      cut.checkpoint,
      'handler confirmation',
      value.errorRelation,
      {
        sameFailure: expectedError === plan.failure,
        absent: expectedError === undefined,
      },
    )
    if (identity) return identity
    try {
      checkMutationConfirmation(
        plan.history,
        cut.cut,
        {
          ...value.observation,
          error: value.errorRelation.sameFailure ? plan.failure : undefined,
        },
        plan.failure,
        plan.inputs,
      )
    } catch (error) {
      return violation(
        cut.checkpoint,
        error instanceof Error ? error.message : String(error),
        'handler confirmation',
      )
    }
  }
  const length = differs(
    'mutation-cut-count',
    'handler confirmation',
    facts.length,
    expected.cuts.length,
  )
  if (length) return length
  return checkReach(trace, expected.requiredStates)
}
function checkReach(
  trace: ReadonlyArray<Observation>,
  required: ReadonlyArray<string>,
): Verdict {
  const reached = new Set(
    trace.filter((o) => o.checkpoint === 'reach').map((o) => o.value),
  )
  const missing = required.filter((state) => !reached.has(state))
  return missing.length
    ? violation(
        'constructed states',
        'missing ' + missing.join(', '),
        'constructed reach',
      )
    : pass
}

const postFixed: Array<PostHistory> = (
  ['insert', 'update', 'delete'] as const
).flatMap((operation) =>
  [false, true].map((reject) => ({
    operation,
    reject,
    suffix: '',
    phaseDelay: 0,
  })),
)
const postState = (
  h: PostHistory,
  cut: 'application-held' | 'applied-waiter',
) => `${h.operation}/${h.reject}/${cut}`
const postStates = postFixed.flatMap((h) => [
  postState(h, 'application-held'),
  postState(h, 'applied-waiter'),
])
const postObligations = new WeakMap<PostHistory, ReadonlyArray<string>>()
const postArbitrary = fc
  .tuple(
    fc.constantFrom(...postFixed),
    fc.string({ maxLength: 8 }),
    fc.integer({ min: 0, max: 3 }),
  )
  .map(
    ([base, suffix, phaseDelay]) => ({ ...base, suffix, phaseDelay }),
    (raw) => {
      const h = raw as PostHistory
      const base = postFixed.find(
        (v) => v.operation === h.operation && v.reject === h.reject,
      )
      if (!base) throw Error('Illegal post-handler history')
      return [base, h.suffix, h.phaseDelay] as const
    },
  )
const postConstructed: Array<ConstructedHistory<PostHistory>> = postStates.map(
  (state) => {
    const witness = postFixed.find(
      (h) =>
        postState(h, 'application-held') === state ||
        postState(h, 'applied-waiter') === state,
    )!
    return {
      name: state,
      enters: [state],
      build(generated) {
        const h = {
          ...witness,
          suffix: generated.suffix,
          phaseDelay: generated.phaseDelay,
        }
        postObligations.set(h, [state])
        return h
      },
    }
  },
)
const encodeRows = (values: ReadonlyArray<Item>) =>
  JSON.stringify(
    [...values]
      .map(({ id, category, name }) => ({ id, category, name }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  )
function postRows(h: PostHistory) {
  const initial: Array<Item> = [
    { id: 'peer', category: 'peer', name: 'Peer' },
    ...(h.operation === 'insert'
      ? []
      : [{ id: 'a', category: 'edited', name: 'Before' }]),
  ]
  const confirmed: Array<Item> = [
    { id: 'peer', category: 'peer', name: 'New peer' },
    { id: 'a', category: 'edited', name: 'New source row' },
  ]
  const change = (rows: Array<Item>) =>
    rows.map((row) => ({ ...row, name: row.name + h.suffix }))
  return {
    initial: encodeRows(change(initial)),
    confirmed: encodeRows(change(confirmed)),
  }
}
function postModel(plan: PostPlan) {
  const h = plan.history
  let model = createRefetchCallSettlementModel(['query'], true)
  model = reduceRefetchCallSettlement(model, {
    type: 'accept-application',
    queryId: 'query',
    applicationId: 'later-result',
  })
  model = reduceRefetchCallSettlement(model, {
    type: 'settle-fetch',
    queryId: 'query',
    outcome: 'fulfilled',
  })
  const held = model
  model = reduceRefetchCallSettlement(model, {
    type: 'settle-application',
    applicationId: 'later-result',
    outcome: 'fulfilled',
  })
  return {
    ...postRows(h),
    held,
    applied: model,
    requiredStates: postObligations.get(h) ?? [
      postState(h, 'application-held'),
      postState(h, 'applied-waiter'),
    ],
  }
}
function checkPost(
  plan: PostPlan,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof postModel>,
): Verdict {
  const find = (checkpoint: string) =>
    trace.find((o) => o.checkpoint === checkpoint)
  const handlerError = find('handler-error')
  if (!handlerError)
    return violation(
      'handler-error',
      'the handler outcome observation is missing',
      'post-handler application',
    )
  const identity = differs(
    'handler-error',
    'post-handler application',
    handlerError.value,
    { sameFailure: plan.history.reject, absent: !plan.history.reject },
  )
  if (identity) return identity
  const first =
    differs(
      'handler-state',
      'post-handler application',
      find('handler-state')?.value,
      plan.history.reject ? 'failed' : 'completed',
    ) ??
    differs(
      'handler-rows',
      'post-handler application',
      find('handler-rows')?.value,
      expected.initial,
    ) ??
    differs(
      'fetch-complete',
      'post-handler application',
      find('fetch-complete')?.value,
      { fetches: 2, fetching: 0 },
    )
  if (first) return first
  for (const [checkpoint, model] of [
    ['application-held', expected.held],
    ['applied-waiter', expected.applied],
  ] as const) {
    const fact = find(checkpoint)
    if (!fact)
      return violation(
        checkpoint,
        'the post-handler receipt cut did not arrive',
        'post-handler application',
      )
    try {
      checkPostHandlerRefetch(
        model,
        fact.value as {
          refetch: ReturnType<typeof observeRefetchCallSettlement>
          rows: string
          waiterRows: string | undefined
        },
        expected.initial,
        expected.confirmed,
      )
    } catch (error) {
      return violation(
        checkpoint,
        error instanceof Error ? error.message : String(error),
        'post-handler application',
      )
    }
  }
  return checkReach(trace, expected.requiredStates)
}

async function observeMutation(plan: MutationPlan, emit: Emit): Promise<void> {
  const history = plan.history
  try {
    const { operation, confirmation, outcome, returned } = history

    const queryClient = createQueryClient()
    const enterRelease = createDeferred<void>()
    const confirmationRelease = createDeferred<void>()
    const settleRelease = createDeferred<void>()
    const entered = createDeferred<void>()
    const serverWritten = createDeferred<void>()
    const confirmationAccepted = createDeferred<void>()
    const refetchRequested = createDeferred<void>()
    const refetchResponse = createDeferred<void>()
    const failure = plan.failure
    const initial = mutationConfirmationRows(
      operation,
      `initial`,
      history.peer,
      plan.inputs,
    )
    const confirmed = mutationConfirmationRows(
      operation,
      `confirmed`,
      history.peer,
      plan.inputs,
    )
    let server = structuredClone(initial)
    let handlerWrites = 0
    let confirmationCalls = 0
    let confirmationStatus: MutationConfirmationObservation[`confirmationStatus`] = `not-requested`
    let settlement: MutationConfirmationObservation[`settlement`] = `pending`
    let error: unknown
    let holdRefetch = confirmation === `refetch`
    const queryFn = vi.fn(async () => {
      if (confirmationCalls > 0 && holdRefetch) {
        refetchRequested.resolve()
        await refetchResponse.promise
      }
      return structuredClone(server)
    })
    let releaseCollection: (() => Promise<void>) | undefined
    let verdict: Promise<MutationConfirmationObservation> | undefined
    await withOracleCleanup(async () => {
      const handler = async ({
        collection: target,
      }: Pick<
        Parameters<
          NonNullable<
            QueryCollectionConfig<MutationConfirmationRow>[`onInsert`]
          >
        >[0],
        `collection`
      >) => {
        entered.resolve()
        await enterRelease.promise
        if (outcome === `reject-before-write`) throw failure
        server = structuredClone(confirmed)
        handlerWrites++
        serverWritten.resolve()
        await confirmationRelease.promise
        if (confirmation !== `none`) {
          confirmationCalls++
          confirmationStatus = `pending`
        }
        if (confirmation === `refetch`) await target.utils.refetch()
        if (confirmation === `write`) {
          if (operation === `delete`) await target.utils.writeDelete(1)
          else
            await target.utils.writeUpsert({
              ...plan.inputs.confirmed,
            })
        }
        if (confirmation !== `none`) confirmationStatus = `accepted`
        confirmationAccepted.resolve()
        await settleRelease.promise
        if (outcome === `reject-after-write`) throw failure
        return returned === `legacy-disable`
          ? { refetch: false }
          : returned === `legacy-enable`
            ? { refetch: true }
            : undefined
      }
      const collection = createCollection(
        queryCollectionOptions<MutationConfirmationRow>({
          queryKey: [`explicit-handler-refresh`, history],
          queryClient,
          queryFn,
          getKey: (row) => row.id,
          // JS callers may return coordination objects that TS now rejects.
          onInsert: handler as unknown as NonNullable<
            QueryCollectionConfig<MutationConfirmationRow>[`onInsert`]
          >,
          onUpdate: handler as unknown as NonNullable<
            QueryCollectionConfig<MutationConfirmationRow>[`onUpdate`]
          >,
          onDelete: handler as unknown as NonNullable<
            QueryCollectionConfig<MutationConfirmationRow>[`onDelete`]
          >,
        }),
      )
      releaseCollection = () => collection.cleanup()
      await atMutationCheckpoint(collection.preload(), `initial Query preload`)
      const transaction =
        operation === `insert`
          ? collection.insert({ ...plan.inputs.optimistic })
          : operation === `delete`
            ? collection.delete(1)
            : collection.update(1, (draft) => {
                draft.name = plan.inputs.optimistic.name
              })
      const observe = (): MutationConfirmationObservation => ({
        rows: collection.toArray
          .map(({ id, name, stable }) => ({ id, name, stable }))
          .sort((a, b) => a.id - b.id),
        handlerWrites,
        confirmationCalls,
        fetches: queryFn.mock.calls.length,
        providerRequests: 0,
        confirmationStatus,
        state: transaction.state,
        settlement,
        error,
      })
      verdict = transaction.when(`settled`).then(
        () => {
          settlement = `fulfilled`
          return observe()
        },
        (reason: unknown) => {
          settlement = `rejected`
          error = reason
          return observe()
        },
      )
      await atMutationCheckpoint(entered.promise, `Query handler entry`)
      emitMutationObservation('entered', `entered`, observe(), failure, emit)

      await delayTurns(history.phaseDelay)
      enterRelease.resolve()
      if (outcome !== `reject-before-write`) {
        await atMutationCheckpoint(serverWritten.promise, `Query server write`)
        emitMutationObservation(
          'server-written',
          `server-written`,
          observe(),
          failure,
          emit,
        )

        confirmationRelease.resolve()
        if (confirmation === `refetch`) {
          await atMutationCheckpoint(
            refetchRequested.promise,
            `held Query refetch response`,
          )
          emitMutationObservation(
            'confirmation-requested',
            `confirmation-requested`,
            observe(),
            failure,
            emit,
          )

          holdRefetch = false
          refetchResponse.resolve()
        }
        await atMutationCheckpoint(
          confirmationAccepted.promise,
          `Query confirmation acceptance`,
        )
        if (confirmation !== `none`) {
          emitMutationObservation(
            'confirmation-accepted',
            `confirmation-accepted`,
            observe(),
            failure,
            emit,
          )
        }
        settleRelease.resolve()
      }
      const atWaiter = await atMutationCheckpoint(
        verdict,
        `Query handler settlement`,
      )
      emitMutationObservation(
        'settlement-waiter',
        `settled`,
        atWaiter,
        failure,
        emit,
      )

      emitMutationObservation('settled', `settled`, observe(), failure, emit)

      if (confirmation === `none` && outcome !== `reject-before-write`) {
        // Backend success alone supplied no source confirmation. A later
        // explicit reader may refetch; the frozen settlement cut stays old.
        await atMutationCheckpoint(
          collection.utils.refetch(),
          `later explicit Query refetch`,
        )
        emitMutationObservation(
          'late-confirmed',
          `late-confirmed`,
          observe(),
          failure,
          emit,
        )

        emitMutationObservation(
          'frozen-waiter',
          `settled`,
          atWaiter,
          failure,
          emit,
        )
      }

      emit('reach', mutationState(history))
    }, [
      () => {
        enterRelease.resolve()
        confirmationRelease.resolve()
        settleRelease.resolve()
        refetchResponse.resolve()
      },
      () =>
        verdict && atMutationCheckpoint(verdict, `Query cleanup settlement`),
      () => releaseCollection?.(),
      () => queryClient.clear(),
    ])
  } finally {
    await runCleanups()
  }
}
async function observePostHandler(plan: PostPlan, emit: Emit): Promise<void> {
  const history = plan.history
  const { operation, reject } = history
  try {
    const initial: Array<Item> = [
      { id: `peer`, category: `peer`, name: `Peer` },
      ...(operation === `insert`
        ? []
        : [{ id: `a`, category: `edited`, name: `Before` }]),
    ]
    const authoritative: Array<Item> = [
      { id: `peer`, category: `peer`, name: `New peer` },
      { id: `a`, category: `edited`, name: `New source row` },
    ]
    const encode = (values: ReadonlyArray<Item>) =>
      JSON.stringify(
        [...values]
          .map(({ id, category, name }) => ({ id, category, name }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      )
    initial.forEach((row) => {
      row.name += history.suffix
    })
    authoritative.forEach((row) => {
      row.name += history.suffix
    })
    let server = structuredClone(initial)
    const handlerFailure = plan.failure
    const handler = async () => {
      await Promise.resolve()
      if (reject) throw handlerFailure
    }
    const storage = createOwnershipStorage()
    const entered = createDeferred<void>()
    const release = createDeferred<void>()
    let hold = false
    const apply = storage.adapter.applyCommittedTx.bind(storage.adapter)
    storage.adapter.applyCommittedTx = async (...args) => {
      if (hold && args[1].mutations.length > 0) {
        hold = false
        entered.resolve()
        await release.promise
      }
      return apply(...args)
    }
    const queryClient = createQueryClient()
    const queryFn = vi.fn(() => Promise.resolve(structuredClone(server)))
    let releaseCollection: (() => Promise<void>) | undefined
    let external: Promise<unknown> | undefined
    await withOracleCleanup(async () => {
      const collection = createCollection(
        persistedCollectionOptions<
          Item,
          string | number,
          never,
          QueryCollectionUtils<Item>
        >({
          ...queryCollectionOptions<Item>({
            id: `post-handler-${operation}-${reject}`,
            queryKey: [`post-handler`, operation, reject],
            queryClient,
            queryFn,
            getKey: (row) => row.id,
            onInsert: handler,
            onUpdate: handler,
            onDelete: handler,
          }),
          persistence: { adapter: storage.adapter },
        }),
      )
      releaseCollection = () => collection.cleanup()
      await atMutationCheckpoint(
        collection.preload(),
        `post-handler initial preload`,
      )
      const transaction =
        operation === `insert`
          ? collection.insert({
              id: `a`,
              category: `edited`,
              name: `Optimistic`,
            })
          : operation === `delete`
            ? collection.delete(`a`)
            : collection.update(`a`, (draft) => {
                draft.name = `Optimistic`
              })
      const firstError = await transaction.when(`settled`).then(
        () => undefined,
        (error: unknown) => error,
      )
      emit('handler-error', {
        sameFailure: firstError === handlerFailure,
        absent: firstError === undefined,
      })
      emit('handler-state', transaction.state)
      emit('handler-rows', encode(collection.toArray))
      await delayTurns(history.phaseDelay)
      hold = true
      server = structuredClone(authoritative)
      let outcome: RefetchApplicationOutcome = `pending`
      let resultOrder: Array<string> | undefined
      let waiterRows: string | undefined
      const observe = () => ({
        rows: encode(collection.toArray),
        waiterRows,
        refetch: {
          refetch: outcome,
          ...(outcome === `resolved` ? { resultOrder } : {}),
        },
      })

      external = collection.utils.refetch({ throwOnError: true }).then(
        (results) => {
          outcome = `resolved`
          resultOrder = results.map(() => `query`)
          waiterRows = encode(collection.toArray)
        },
        (error: unknown) => {
          outcome = `rejected`
          throw error
        },
      )
      void external.catch(() => {})
      await atMutationCheckpoint(
        entered.promise,
        `post-handler durable application held`,
      )
      if (
        !(await recordBoundary(
          'fetch-complete',
          () => ({
            fetches: queryFn.mock.calls.length,
            fetching: queryClient.isFetching(),
          }),
          (v) => v.fetches === 2 && v.fetching === 0,
          emit,
        ))
      )
        return
      // Query's flags clear before the utility's queued Promise chain
      // finishes. Keep the receipt held through a task boundary so every
      // already-queued microtask can process that completed fetch. The
      // leaked-count transform is the calibration for this timing premise.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      emit('application-held', observe())
      emit('reach', postState(history, 'application-held'))
      release.resolve()
      await atMutationCheckpoint(
        external,
        `post-handler external refetch settlement`,
      )

      emit('applied-waiter', observe())
      emit('reach', postState(history, 'applied-waiter'))
    }, [
      () => release.resolve(),
      () =>
        external &&
        atMutationCheckpoint(external, `post-handler cleanup refetch`),
      () => releaseCollection?.(),
      () => queryClient.clear(),
    ])
  } finally {
    await runCleanups()
  }
}

/** Every original history remains a fixed replay. Builders preserve genuinely
 * generated row text and held-window timing while entering each old tuple/cut.
 * The independent check enforces the construction ledger on all fresh outputs,
 * including generated and shrunk constructions that the pinned API omits from
 * its own identity association. Missing-state controls calibrate every builder. */
oracleProperty({
  id: 'query-db.ownership.mutation-confirmation',
  law: {
    statement:
      'Handler settlement starts no implicit request; accepted confirmation decides source rows independently of handler fulfillment or rejection.',
    authority:
      'docs/collections/query-collection.md#controlling-refetch-behavior; optimistic-history acceptance and settlement law; first-RC explicit confirmation decision.',
    limits:
      'One handler, edited row and optional untouched peer; legal no/refetch/write confirmation and discarded legacy returns. No provider framing or concurrent handlers.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: {
    arbitrary: mutationArbitrary,
    runs: 40,
    fixedSeeds: [2367],
    states: mutationStates,
    constructed: mutationConstructed,
    fixed: mutationFixed.map((history) => ({
      name:
        'refreshes only when the handler requests it: ' +
        JSON.stringify(history),
      history,
    })),
  },
  resolve: (history) => ({
    history,
    failure: new Error('handler ' + history.outcome),
    inputs: confirmationInputs(history),
  }),
  model: mutationModel,
  driver: observeMutation,
  check: checkMutation,
  calibrations: [
    {
      name: 'rejects a different handler error object',
      law: 'handler confirmation',
      corrupt: (trace: ReadonlyArray<Observation>, plan: MutationPlan) =>
        plan.history.outcome === 'fulfilled'
          ? undefined
          : trace.map((o) =>
              o.checkpoint === 'settlement-waiter'
                ? {
                    ...o,
                    value: {
                      ...(o.value as Record<string, unknown>),
                      errorRelation: { sameFailure: false, absent: false },
                    },
                  }
                : o,
            ),
    },
    ...mutationStates.map((state) => ({
      name: 'omits constructed ' + state,
      law: 'constructed reach',
      corrupt: (trace: ReadonlyArray<Observation>, plan: MutationPlan) =>
        mutationObligations.get(plan.history)?.includes(state)
          ? trace.filter((o) => o.checkpoint !== 'reach' || o.value !== state)
          : undefined,
    })),
    {
      name: 'omits reach from a fresh generated construction',
      law: 'constructed reach',
      driver: async (plan, emit) => {
        const builder = mutationConstructed.find((c) =>
          c.enters.includes(mutationState(plan.history)),
        )!
        const history = builder.build({
          ...plan.history,
          phaseDelay: (plan.history.phaseDelay + 1) % 4,
        })
        await observeMutation(
          {
            history,
            failure: plan.failure,
            inputs: confirmationInputs(history),
          },
          (cut, value) => {
            if (cut !== 'reach') emit(cut, value)
          },
        )
      },
    },
  ],
})
oracleProperty({
  id: 'query-db.ownership.post-handler',
  law: {
    statement:
      'Handler exit restores the normal public-refetch application barrier after either fulfillment or rejection; the later waiter observes the complete confirmed snapshot.',
    authority:
      'docs/collections/query-collection.md#explicit-refetch-inside-a-handler and core applied-receipt law.',
    limits:
      'One CRUD handler and one later local persisted refetch, with durable application held after the Query fetch; no native SQLite fault or concurrent handler.',
    owner: 'Query DB ownership lifecycle',
  },
  histories: {
    arbitrary: postArbitrary,
    runs: 24,
    fixedSeeds: [2367],
    states: postStates,
    constructed: postConstructed,
    fixed: postFixed.map((history) => ({
      name: `waits for later application after handler ${history.operation} rejection:${history.reject}`,
      history,
    })),
  },
  resolve: (history) => ({ history, failure: new Error('handler rejected') }),
  model: postModel,
  driver: observePostHandler,
  check: checkPost,
  calibrations: [
    {
      name: 'rejects a different post-handler error object',
      law: 'post-handler application',
      corrupt: (trace: ReadonlyArray<Observation>, plan: PostPlan) =>
        !plan.history.reject
          ? undefined
          : trace.map((o) =>
              o.checkpoint === 'handler-error'
                ? { ...o, value: { sameFailure: false, absent: false } }
                : o,
            ),
    },
    ...postStates.map((state) => ({
      name: 'omits constructed ' + state,
      law: 'constructed reach',
      corrupt: (trace: ReadonlyArray<Observation>, plan: PostPlan) =>
        postObligations.get(plan.history)?.includes(state)
          ? trace.filter((o) => o.checkpoint !== 'reach' || o.value !== state)
          : undefined,
    })),
    {
      name: 'omits reach from a fresh generated construction',
      law: 'constructed reach',
      driver: async (plan, emit) => {
        const builder = postConstructed.find((c) =>
          c.enters.includes(postState(plan.history, 'application-held')),
        )!
        const history = builder.build({
          ...plan.history,
          phaseDelay: (plan.history.phaseDelay + 1) % 4,
        })
        await observePostHandler(
          { history, failure: plan.failure },
          (cut, value) => {
            if (cut !== 'reach') emit(cut, value)
          },
        )
      },
    },
    ...(['early-receipt', 'partial-rows', 'stale-waiter'] as const).map(
      (fault) => ({
        name: 'rejects post-handler wrong observation: ' + fault,
        law: 'post-handler application',
        corrupt: (trace: ReadonlyArray<Observation>, plan: PostPlan) =>
          trace.map((o) => {
            const target =
              fault === 'stale-waiter' ? 'applied-waiter' : 'application-held'
            if (o.checkpoint !== target) return o
            const raw = o.value as {
              refetch: unknown
              rows: string
              waiterRows: string | undefined
            }
            return {
              ...o,
              value: {
                ...raw,
                ...(fault === 'early-receipt'
                  ? { refetch: { refetch: 'resolved', resultOrder: ['query'] } }
                  : fault === 'partial-rows'
                    ? { rows: 'partial' }
                    : { waiterRows: postRows(plan.history).initial }),
              },
            }
          }),
      }),
    ),
  ],
})

declareOracle({
  owns: ['src/query.ts#queryCollectionOptions'],
  model: [mutationModel, postModel],
  check: [checkMutation, checkPost],
  grammar: [mutationArbitrary, postArbitrary],
})
