import { declareOracle } from '../../db/tests/oracle-declaration.js'
/**
 * # Does an OPFS connection answer requests in order and close after them?
 *
 * An OPFS connection owns one SQLite connection in its worker. Requests settle
 * in the order the connection accepted them, each with the result a
 * sequential connection would produce. Close is one more request in that
 * order: it settles after every earlier request, and requests made after close
 * starts are refused at once. Answered writes survive a reopen. This holds
 * when an earlier request waits for the OPFS access handle.
 *
 * That wait is the worker's only task-level suspension point. OPFSCoopSyncVFS
 * hands its access handle to another connection on request. Its next lock then
 * queues a Web Lock and handle acquisition on wa-sqlite's `retryOps` and
 * returns SQLITE_BUSY, and wa-sqlite's `retry()` awaits that work. A worker
 * that handles messages during the wait lets close run while the statement is
 * unfinalized. SQLite then refuses to close, and close settles first.
 *
 * The model is a sequential replay over the list of inserted values. A history
 * chooses one to three inserts and selects, which execute meets a taken
 * handle, whether the handle returns before or after close is submitted, and
 * one execute after close. Where the handle wait starts and when it ends are
 * driver choices: the model's prediction does not depend on them.
 *
 * Two drivers run the same examples through the public connection and the real
 * worker module. The Node driver uses the real wa-sqlite WASM build over an
 * in-memory VFS with OPFSCoopSyncVFS's lock protocol. The Chromium driver uses
 * real OPFS and takes the handle through the VFS's own BroadcastChannel and
 * Web Lock handoff. Both compare settlement values, settlement order, and the
 * rows a fresh connection reads after close.
 *
 * Neither driver proves other browsers, frozen tabs, a crash between a write
 * and close, or contention among more than one other handle holder.
 */
import type { BrowserWASQLiteDatabase } from '../src/wa-sqlite-driver'

export type ExecuteKind = `insert` | `select`

export type RequestOrderHistory = {
  executes: Array<ExecuteKind>
  handleTakenBefore: number | undefined
  handleReturns: `before-close` | `after-close`
  executeAfterClose: boolean
}

export type RequestSettlement =
  | { label: string; status: `fulfilled`; value: unknown }
  | { label: string; status: `rejected`; name: string; message: string }

export type RequestOrderObservation = {
  handleWaitReached: boolean
  settlements: Array<RequestSettlement>
  reopenedRows: unknown
}

// How a driver takes the access handle from the connection under test, waits
// until a request is blocked on it, lets a submitted message reach the worker,
// and gives the handle back.
export type AccessHandleControl = {
  take: () => Promise<void>
  untilWaiting: () => Promise<boolean>
  untilDelivered: () => Promise<void>
  give: () => Promise<void>
}

export type OpenDatabase = (
  databaseName: string,
) => Promise<BrowserWASQLiteDatabase>

const closedConnection = {
  name: `SQLiteConnectionClosedError`,
  message: `Browser OPFS worker connection is closed`,
}

function sqlFor(kind: ExecuteKind, index: number): string {
  return kind === `insert`
    ? `INSERT INTO t VALUES (${index})`
    : `SELECT x FROM t ORDER BY x`
}

// Sequential reference: replay the history over a list of inserted values.
export function expectedRequestOrder(history: RequestOrderHistory): {
  settlements: Array<RequestSettlement>
  reopenedRows: Array<{ x: number }>
} {
  const values: Array<number> = []
  const settlements: Array<RequestSettlement> = history.executes.map(
    (kind, index): RequestSettlement => {
      if (kind === `insert`) {
        values.push(index)
        return { label: `execute-${index}`, status: `fulfilled`, value: [] }
      }
      return {
        label: `execute-${index}`,
        status: `fulfilled`,
        value: values.map((x) => ({ x })),
      }
    },
  )
  settlements.push({ label: `close`, status: `fulfilled`, value: undefined })
  if (history.executeAfterClose) {
    settlements.push({
      label: `execute-after-close`,
      status: `rejected`,
      ...closedConnection,
    })
  }
  return { settlements, reopenedRows: values.map((x) => ({ x })) }
}

// The refinement check. Values compare as a set keyed by label; order compares
// the accepted requests, which must settle in submission order with close
// last. A refused request settles before close because admission rejects it
// at once.
export function findRequestOrderViolation(
  history: RequestOrderHistory,
  observation: RequestOrderObservation,
): string | undefined {
  if (history.handleTakenBefore !== undefined && !observation.handleWaitReached)
    return `premise not reached: no request waited for the access handle`
  const expected = expectedRequestOrder(history)
  const byLabel = (settlements: ReadonlyArray<RequestSettlement>) =>
    JSON.stringify(
      [...settlements].sort((a, b) => a.label.localeCompare(b.label)),
    )
  if (byLabel(observation.settlements) !== byLabel(expected.settlements)) {
    return `settlements differ: expected ${byLabel(expected.settlements)}, got ${byLabel(observation.settlements)}`
  }
  const order = observation.settlements.map(({ label }) => label)
  const accepted = order.filter((label) => label !== `execute-after-close`)
  const expectedAccepted = [
    ...history.executes.map((_, index) => `execute-${index}`),
    `close`,
  ]
  if (JSON.stringify(accepted) !== JSON.stringify(expectedAccepted)) {
    return `accepted requests settled as ${accepted.join(`,`)}, expected ${expectedAccepted.join(`,`)}`
  }
  if (
    history.executeAfterClose &&
    order.indexOf(`execute-after-close`) > order.indexOf(`close`)
  ) {
    return `the refused request settled after close`
  }
  if (
    JSON.stringify(observation.reopenedRows) !==
    JSON.stringify(expected.reopenedRows)
  ) {
    return `reopened rows ${JSON.stringify(observation.reopenedRows)}, expected ${JSON.stringify(expected.reopenedRows)}`
  }
  return undefined
}

function errorFields(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: `NonError`, message: String(error) }
}

// The shared production driver: public open, execute, and close, with the
// access handle taken and returned at the history's points.
export async function observeRequestOrder(
  open: OpenDatabase,
  handle: AccessHandleControl,
  history: RequestOrderHistory,
  databaseName: string,
): Promise<RequestOrderObservation> {
  const database = await open(databaseName)
  await database.execute(`CREATE TABLE t(x INTEGER)`)

  const settlements: Array<RequestSettlement> = []
  const pending: Array<Promise<void>> = []
  const track = (label: string, promise: Promise<unknown>) => {
    pending.push(
      promise.then(
        (value) => {
          settlements.push({ label, status: `fulfilled`, value })
        },
        (error: unknown) => {
          settlements.push({ label, status: `rejected`, ...errorFields(error) })
        },
      ),
    )
  }

  for (const [index, kind] of history.executes.entries()) {
    if (index === history.handleTakenBefore) await handle.take()
    track(`execute-${index}`, database.execute(sqlFor(kind, index)))
  }
  const handleWaitReached =
    history.handleTakenBefore === undefined || (await handle.untilWaiting())
  if (history.handleReturns === `before-close`) await handle.give()
  track(`close`, Promise.resolve(database.close!()))
  if (history.executeAfterClose) {
    track(`execute-after-close`, database.execute(`SELECT 1`))
  }
  if (history.handleReturns === `after-close`) {
    // Close must reach the worker while the earlier request still waits.
    await handle.untilDelivered()
    await handle.give()
  }
  await Promise.all(pending)

  const reopened = await open(databaseName)
  try {
    return {
      handleWaitReached,
      settlements,
      reopenedRows: await reopened.execute(`SELECT x FROM t ORDER BY x`),
    }
  } finally {
    await reopened.close!()
  }
}

// Every handle placement over one- and two-execute shapes, both return points,
// and with or without a refused request.
export const requestOrderExamples: Array<RequestOrderHistory> = (
  [[`insert`], [`insert`, `select`], [`select`, `insert`]] as const
).flatMap((executes) =>
  [undefined, ...executes.keys()].flatMap((handleTakenBefore) =>
    ([`before-close`, `after-close`] as const).flatMap((handleReturns) =>
      [false, true].map((executeAfterClose): RequestOrderHistory => ({
        executes: [...executes],
        handleTakenBefore,
        handleReturns,
        executeAfterClose,
      })),
    ),
  ),
)

declareOracle({
  check: [findRequestOrderViolation],
  model: [expectedRequestOrder],
})
