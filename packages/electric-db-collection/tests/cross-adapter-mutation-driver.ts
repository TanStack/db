/**
 * The installed ShapeStream parses actual HTTP messages and supplies txid
 * evidence. Holds separate backend write, explicit confirmation and handler
 * settlement. This module records public facts and computes no expected rows.
 * Inputs are authored independently of Collection values. Error identity is
 * preserved as a relation before a browser trace crosses JSON.
 */
import { createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import { electricCollectionOptions } from '../src/electric'
import { electricApplicationRows } from './cross-adapter-rows'
import {
  CrossAdapterElectricHTTP,
  electricTurn,
  untilElectric,
} from './cross-adapter-http'
import type {
  MutationConfirmationCut,
  MutationConfirmationHistory,
  MutationConfirmationObservation,
  MutationConfirmationRow,
} from '../../db/tests/mutation-confirmation-oracle'

export const electricMutationInputs = {
  peer: { id: 2, name: `peer`, stable: `stable-2` },
  before: { id: 1, name: `before`, stable: `stable-1` },
  optimistic: { id: 1, name: `optimistic`, stable: `stable-1` },
  confirmed: { id: 1, name: `confirmed`, stable: `server-1` },
}
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
export type ElectricMutationTrace = {
  failure: Error
  cuts: Array<{
    cut: MutationConfirmationCut
    observation: MutationConfirmationObservation
  }>
  reached: Array<string>
  receivingErrors?: ReadonlyArray<string>
  cleanupErrors?: ReadonlyArray<string>
}
export async function observeElectricMutation(
  h: MutationConfirmationHistory,
  fault?: `cleanup-only` | `mismatch-and-cleanup`,
): Promise<ElectricMutationTrace> {
  const service = new CrossAdapterElectricHTTP()
  service.schema = {
    id: { type: `int4`, pk_index: 0 },
    name: { type: `text` },
    stable: { type: `text` },
  }
  const inputs = electricMutationInputs
  const enter = deferred(),
    written = deferred(),
    request = deferred(),
    accepted = deferred(),
    settle = deferred(),
    entered = deferred()
  const failure = new Error(`Electric mutation ${h.outcome}`)
  let writes = 0,
    confirmationCalls = 0
  let providerRequests = 0
  // Record actual SDK refresh/snapshot calls while delegating every argument
  // and return value. Ordinary shape-log polls are not confirmation requests.
  const refresh = ShapeStream.prototype.forceDisconnectAndRefresh
  const requestSnapshot = ShapeStream.prototype.requestSnapshot
  const fetchSnapshot = ShapeStream.prototype.fetchSnapshot
  let confirmationStatus: MutationConfirmationObservation[`confirmationStatus`] = `not-requested`
  let settlement: MutationConfirmationObservation[`settlement`] = `pending`
  let error: unknown
  const handler = async () => {
    entered.resolve()
    await enter.promise
    if (h.outcome === `reject-before-write`) throw failure
    writes++
    written.resolve()
    await request.promise
    if (h.confirmation === `txid`) {
      confirmationCalls++
      confirmationStatus = `pending`
      await collection.utils.awaitTxId(55)
      confirmationStatus = `accepted`
    }
    accepted.resolve()
    await settle.promise
    if (h.outcome === `reject-after-write`) throw failure
    if (h.returned === `legacy-txid`) return { txid: 55 }
    return undefined
  }
  // Legacy returns are deliberately supplied through JavaScript's runtime
  // boundary; the public TypeScript API now accepts Promise<void> only.
  const runtimeHandler = handler as () => Promise<void>
  const collection = createCollection(
    electricCollectionOptions<MutationConfirmationRow>({
      id: `electric-mutation-${crypto.randomUUID()}`,
      getKey: (row) => row.id,
      shapeOptions: {
        url: `http://electric/mutation-${crypto.randomUUID()}`,
        params: { table: `rows` },
        fetchClient: service.fetchClient,
        onError: () => undefined,
      },
      onInsert: runtimeHandler,
      onUpdate: runtimeHandler,
      onDelete: runtimeHandler,
    }),
  )
  const trace: ElectricMutationTrace = { failure, cuts: [], reached: [] }
  // Install only after construction succeeds. Every later operation is inside
  // withOracleCleanup, which restores all three methods on success or failure.
  ShapeStream.prototype.forceDisconnectAndRefresh = function () {
    providerRequests++
    return refresh.call(this)
  }
  ShapeStream.prototype.requestSnapshot = function (params) {
    providerRequests++
    return requestSnapshot.call(this, params)
  }
  ShapeStream.prototype.fetchSnapshot = function (params) {
    providerRequests++
    return fetchSnapshot.call(this, params)
  }
  let transaction: ReturnType<typeof collection.insert>
  const observation = (): MutationConfirmationObservation => ({
    rows: electricApplicationRows(collection.values()),
    handlerWrites: writes,
    confirmationCalls,
    confirmationStatus,
    fetches: 0,
    providerRequests,
    state: transaction.state,
    settlement,
    error,
  })
  const cut = (name: MutationConfirmationCut) =>
    trace.cuts.push({ cut: name, observation: observation() })
  const deliver = async () => {
    const next = await service.take()
    service.respond(next, [
      {
        key: `1`,
        value: Object.fromEntries(
          Object.entries(inputs.confirmed).map(([key, value]) => [
            key,
            String(value),
          ]),
        ),
        headers: { operation: h.operation, txids: [55] },
      },
    ])
    await service.settle()
  }
  return retainOracleCleanupObservation(async () => {
    const ready = collection.preload()
    service.stage(
      [
        ...(h.operation === `insert` ? [] : [inputs.before]),
        ...(h.peer ? [inputs.peer] : []),
      ].map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, String(value)]),
        ),
      ),
    )
    await ready
    transaction =
      h.operation === `insert`
        ? collection.insert({ ...inputs.optimistic })
        : h.operation === `delete`
          ? collection.delete(1)
          : collection.update(1, (draft) => {
              draft.name = inputs.optimistic.name
            })
    const waiter = transaction.when(`settled`).then(
      () => {
        settlement = `fulfilled`
        return observation()
      },
      (cause: unknown) => {
        settlement = `rejected`
        error = cause
        return observation()
      },
    )
    await entered.promise
    trace.reached.push(`operation:${h.operation}`, `outcome:${h.outcome}`)
    cut(`entered`)
    enter.resolve()
    if (h.outcome !== `reject-before-write`) {
      await written.promise
      cut(`server-written`)
      request.resolve()
      if (h.confirmation === `txid`) {
        await untilElectric(
          () => confirmationCalls === 1,
          `explicit awaitTxId registration`,
        )
        cut(`confirmation-requested`)
        await deliver()
        await accepted.promise
        trace.reached.push(`txid-confirmation`)
        cut(`confirmation-accepted`)
      } else await accepted.promise
      settle.resolve()
    }
    trace.cuts.push({ cut: `settled`, observation: await waiter })
    cut(`settled`)
    if (h.confirmation === `none` && h.outcome !== `reject-before-write`) {
      await deliver()
      await electricTurn()
      cut(`late-confirmed`)
      trace.reached.push(`late-confirmation`)
    }
    if (fault === `mismatch-and-cleanup`) trace.cuts[0]!.observation.rows = []
    return trace
  }, [
    () => {
      enter.resolve()
      request.resolve()
      settle.resolve()
    },
    async () => {
      await collection.cleanup()
      if (fault) throw new Error(`injected mutation cleanup failure`)
    },
    () => {
      ShapeStream.prototype.forceDisconnectAndRefresh = refresh
      ShapeStream.prototype.requestSnapshot = requestSnapshot
      ShapeStream.prototype.fetchSnapshot = fetchSnapshot
    },
  ])
}

export type ElectricMutationTransport = Omit<
  ElectricMutationTrace,
  `failure` | `cuts`
> & {
  failure: { name: string; message: string }
  cuts: Array<{
    cut: MutationConfirmationCut
    observation: Omit<MutationConfirmationObservation, `error`> & {
      error: `none` | `handler` | { name: string; message: string }
    }
  }>
}
export function transportElectricMutation(
  trace: ElectricMutationTrace,
): ElectricMutationTransport {
  return {
    ...trace,
    failure: { name: trace.failure.name, message: trace.failure.message },
    cuts: trace.cuts.map(({ cut, observation: o }) => ({
      cut,
      observation: {
        ...o,
        error:
          o.error === undefined
            ? `none`
            : o.error === trace.failure
              ? `handler`
              : {
                  name:
                    o.error instanceof Error ? o.error.name : typeof o.error,
                  message: String(o.error),
                },
      },
    })),
  }
}
export function receiveElectricMutation(
  trace: ElectricMutationTransport,
): ElectricMutationTrace {
  const failure = Object.assign(new Error(trace.failure.message), {
    name: trace.failure.name,
  })
  return {
    ...trace,
    failure,
    cuts: trace.cuts.map(({ cut, observation: o }) => ({
      cut,
      observation: {
        ...o,
        error:
          o.error === `none`
            ? undefined
            : o.error === `handler`
              ? failure
              : Object.assign(new Error(o.error.message), {
                  name: o.error.name,
                }),
      },
    })),
  }
}
