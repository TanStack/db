import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
import { expect } from 'vitest'
import { createDeferred } from '../src/deferred'
import { mutationConfirmationRows } from './mutation-confirmation-oracle'
import {
  checkDocumentedMutation,
  documentedMutationInputs,
} from './documented-mutations-oracle'
import { atMutationCheckpoint } from './mutation-confirmation-support'
import { withOracleCleanup } from './utils'
import { createOracleReach } from './oracle-reach'
import type {
  DocumentedHandler,
  DocumentedMutationHistory,
  DocumentedMutationObservation,
  DocumentedRow,
} from './documented-mutations-oracle'
import type { MutationConfirmationObservation } from './mutation-confirmation-oracle'
import type { Collection, MutationFnParams } from '../src/index'

// Finite replay selects one explicit history. A shared random seed is irrelevant
// and cannot disable reach. Unrelated path replays stand aside at registration.
// A named test subset without this selector keeps the full reach obligation.
export function selectDocumentedHistories(
  histories: Array<DocumentedMutationHistory>,
) {
  const requested = process.env.TANSTACK_DB_DOCUMENTED_MUTATION_CASE
  if (!requested) return histories
  const selected = histories.filter((history) => history.id === requested)
  if (selected.length !== 1)
    throw new Error(`Unknown documented mutation case: ${requested}`)
  return selected
}

export function createDocumentedReach(
  adapter: string,
  histories: Array<DocumentedMutationHistory>,
) {
  const states = histories.flatMap((h) => [
    `${h.id}:entered`,
    `${h.id}:api-request`,
    `${h.id}:settlement-waiter`,
    ...(h.apiOutcome === `reject-before-write`
      ? []
      : [`${h.id}:server-written`]),
    ...(h.apiOutcome === `success` && h.handler.confirmation !== `none`
      ? [
          `${h.id}:confirmation-accepted`,
          ...(h.handler.confirmation === `write`
            ? []
            : [`${h.id}:confirmation-held`]),
        ]
      : []),
    ...(h.apiOutcome === `reject-after-write` ||
    h.handler.confirmation === `none`
      ? [`${h.id}:late-confirmed`]
      : []),
    ...[
      `entered`,
      `settled`,
      ...(h.apiOutcome === `reject-before-write` ? [] : [`server-written`]),
      ...(h.apiOutcome === `success` && h.handler.confirmation !== `none`
        ? [
            ...(h.handler.confirmation === `write`
              ? []
              : [`confirmation-requested`, `confirmation-accepted`]),
          ]
        : []),
      ...(h.apiOutcome === `reject-after-write` ||
      h.handler.confirmation === `none`
        ? [`late-confirmed`]
        : []),
    ].map((cut) => `${h.id}:comparison:${cut}`),
  ])
  const counter = createOracleReach(`documented-${adapter}`, states, {
    replaying: false,
  })
  let current = ``,
    entered = 0
  const cuts = new Map<string, number>()
  return {
    begin: (id: string) => {
      current = id
      entered++
      counter.beginHistory()
    },
    reach: (state: string) => {
      if (state.startsWith(`comparison:`)) {
        const key = `${current}:${state}`
        cuts.set(key, (cuts.get(key) ?? 0) + 1)
      }
      counter.reach(`${current}:${state}`)
    },
    finish: () => {
      if (entered === 0) return
      console.info(
        `documented-${adapter} reach`,
        Object.fromEntries(counter.counts()),
        `comparisons`,
        Object.fromEntries(cuts),
      )
      counter.assertReached()
    },
  }
}

export type DocumentedRuntimeHandler = (
  params: MutationFnParams<DocumentedRow>,
) => Promise<unknown>
export type DocumentedReceiver = {
  collection: Collection<DocumentedRow, string | number>
  start: () => Promise<unknown>
  deliver: () => Promise<unknown>
  late: () => Promise<unknown>
  sourceRequested: Promise<unknown>
  fetches: () => number
  providerRequests: () => number
  cleanup: () => Promise<unknown>
}
export type DocumentedReceiverControls = {
  history: DocumentedMutationHistory
  initial: Array<DocumentedRow>
  server: () => Array<DocumentedRow>
  handler: DocumentedRuntimeHandler
  confirmation: <T>(work: () => Promise<T>) => Promise<T>
}

// The locator is an exact heading plus fence ordinal. AST extraction accepts a
// complete factory or an object-property fragment. It refuses missing/duplicate
// headings, markers and handlers; no copied handler body stands in for a fence.
export function extractDocumentedHandler(
  handler: DocumentedHandler,
  root: string,
): string {
  const text = readFileSync(resolve(root, handler.file), `utf8`)
  const headings = [...text.matchAll(/^#{1,6} .+$/gm)]
  const matching = headings.filter((m) => m[0] === handler.heading)
  if (matching.length !== 1)
    throw new Error(`${handler.id}: heading count ${matching.length}`)
  const start = matching[0]!
  const level = start[0].indexOf(` `)
  const end =
    headings.find((m) => m.index > start.index && m[0].indexOf(` `) <= level)
      ?.index ?? text.length
  const section = text.slice(start.index, end)
  const fences = [
    ...section.matchAll(
      /^(`{3,})(?:ts|typescript|tsx)[ \t]*\n([\s\S]*?)^\1[ \t]*$/gm,
    ),
  ]
  let code = fences[handler.fence]?.[2]
  if (code === undefined)
    throw new Error(`${handler.id}: missing fence ${handler.fence}`)
  if (handler.selection) {
    const labels = {
      after: `After`,
      before: `Before`,
      correct: `CORRECT`,
      wrong: `WRONG`,
    }
    const markers = [
      ...code.matchAll(/^\/\/ (After|Before|CORRECT|WRONG)\b[^\n]*$/gm),
    ]
    const selected = markers.filter((m) => m[1] === labels[handler.selection!])
    if (selected.length !== 1)
      throw new Error(`${handler.id}: marker count ${selected.length}`)
    const marker = selected[0]!
    const next =
      markers.find((m) => m.index > marker.index)?.index ?? code.length
    code = code.slice(marker.index + marker[0].length, next)
  }
  const find = (source: ts.SourceFile) => {
    const found: Array<ts.PropertyAssignment> = []
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(source) ===
          `on${handler.operation[0]!.toUpperCase()}${handler.operation.slice(1)}` &&
        (ts.isArrowFunction(node.initializer) ||
          ts.isFunctionExpression(node.initializer))
      )
        found.push(node)
      ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  }
  let source = ts.createSourceFile(
    `guidance.ts`,
    code,
    ts.ScriptTarget.Latest,
    true,
  )
  let found = find(source)
  if (found.length === 0) {
    source = ts.createSourceFile(
      `guidance.ts`,
      `const fragment = ({\n${code}\n})`,
      ts.ScriptTarget.Latest,
      true,
    )
    found = find(source)
  }
  if (found.length !== 1)
    throw new Error(`${handler.id}: handler count ${found.length}`)
  return found[0]!.initializer.getText(source)
}

export function compileDocumentedHandler(
  source: string,
  api: object,
  fetch: (...args: Array<unknown>) => Promise<unknown>,
): DocumentedRuntimeHandler {
  const compiled = ts.transpileModule(`const handler = ${source}\n`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
  })
  if (compiled.diagnostics?.length)
    throw new Error(`Documented handler does not transpile`)
  const result: unknown = new Function(
    `api`,
    `fetch`,
    `${compiled.outputText}\nreturn handler`,
  )(api, fetch)
  if (typeof result !== `function`)
    throw new Error(`Documented handler is not callable`)
  return result as DocumentedRuntimeHandler
}

// Only public virtual metadata is outside this row-value law. Object rest keeps
// every ordinary own field; structuredClone preserves Dates and own undefined.
export function documentedRows(
  collection: Collection<DocumentedRow, string | number>,
  editedKey: string | number,
): Array<DocumentedRow> {
  return collection.toArray
    .map((row) => {
      const {
        $key: _key,
        $collectionId: _id,
        $origin: _origin,
        $hasPendingWrites: _pending,
        ...data
      } = row
      return structuredClone(data)
    })
    .sort((a, b) => Number(b.id === editedKey) - Number(a.id === editedKey))
}

function expectedArguments(
  history: DocumentedMutationHistory,
  before: DocumentedRow,
  optimistic: DocumentedRow,
): Array<unknown> {
  const changes = Object.fromEntries(
    Object.entries(optimistic).filter(
      ([key, value]) => !Object.is(value, before[key]) && key !== `id`,
    ),
  )
  // Dates are unchanged in these payloads. Compare them by value rather than
  // inventing a change because model/driver inputs use independent copies.
  for (const [key, value] of Object.entries(changes))
    if (
      value instanceof Date &&
      before[key] instanceof Date &&
      value.getTime() === before[key].getTime()
    )
      delete changes[key]
  switch (history.handler.payload) {
    case `modified`:
      return [optimistic]
    case `changes`:
      return [changes]
    case `id-changes`:
      return [before.id, changes]
    case `where-data`:
      return [{ where: { id: before.id }, data: changes }]
    case `key`:
      return [before.id]
    case `rows`:
      return [[optimistic]]
    case `updates`:
      return [[{ id: before.id, changes }]]
    case `keys`:
      return [[before.id]]
  }
}

// Request checking is shared with hostile collaborator calibrations. It returns
// the actual submitted data, never the independent expected payload.
export function checkDocumentedRequest(
  history: DocumentedMutationHistory,
  before: DocumentedRow,
  optimistic: DocumentedRow,
  raw: Array<unknown>,
): Array<unknown> {
  const args =
    history.handler.api === `fetch`
      ? [JSON.parse((raw[1] as { body: string }).body) as unknown]
      : raw
  expect(args, `${history.id}: actual documented request`).toStrictEqual(
    expectedArguments(history, before, optimistic),
  )
  if (history.handler.api === `fetch`) {
    expect(raw[0]).toBe(`/api/todos`)
    expect((raw[1] as { method: string }).method).toBe(`POST`)
  }
  return args
}

function committedRow(
  history: DocumentedMutationHistory,
  args: Array<unknown>,
  before: DocumentedRow,
): DocumentedRow {
  const first = args[0]
  let request: DocumentedRow
  switch (history.handler.payload) {
    case `modified`:
      request = first as DocumentedRow
      break
    case `rows`:
      request = (first as Array<DocumentedRow>)[0]!
      break
    case `changes`:
      request = { ...before, ...(first as object) }
      break
    case `id-changes`:
      request = { ...before, ...(args[1] as object) }
      break
    case `where-data`:
      request = { ...before, ...(first as { data: object }).data }
      break
    case `updates`:
      request = {
        ...before,
        ...(first as Array<{ changes: object }>)[0]!.changes,
      }
      break
    default:
      request = before
  }
  // The controlled server canonicalizes display text and completion, keeping
  // every other submitted field. This premise never repairs a missing payload:
  // exact actual request arguments were compared before this function ran.
  return history.handler.shape === `product` ||
    history.handler.shape === `profile`
    ? {
        ...structuredClone(request),
        name: `confirmed`,
        server_value: undefined,
      }
    : { ...structuredClone(request), text: `confirmed`, completed: true }
}

/**
 * One production loop receives Query and Electric through their real adapters.
 * API commit, API response, source delivery and handler-Promise settlement are
 * separately held. The fake backend uses the extracted handler's actual request.
 * No missing refetch is supplied by the fixture. Settlement races utility entry,
 * so a missing acknowledgement fails at the promised settlement comparison.
 */
export async function runDocumentedMutation(
  history: DocumentedMutationHistory,
  root: string,
  createReceiver: (controls: DocumentedReceiverControls) => DocumentedReceiver,
  reach: (state: string) => void,
): Promise<void> {
  const inputs = documentedMutationInputs(history.handler)
  const initial = mutationConfirmationRows(
    history.mutation.operation,
    `initial`,
    history.mutation.peer,
    inputs,
  )
  const confirmed = mutationConfirmationRows(
    history.mutation.operation,
    `confirmed`,
    history.mutation.peer,
    inputs,
  )
  let server = structuredClone(initial)
  const entryGate = createDeferred<void>(),
    responseGate = createDeferred<void>(),
    acceptedCutGate = createDeferred<void>()
  const entered = createDeferred<void>(),
    called = createDeferred<void>(),
    returned = createDeferred<void>()
  const confirmationRequested = createDeferred<void>(),
    confirmationAccepted = createDeferred<void>()
  const failure = new Error(`documented API ${history.apiOutcome}`)
  let handlerWrites = 0,
    calls = 0,
    confirmationCalls = 0
  let confirmationStatus: MutationConfirmationObservation[`confirmationStatus`] = `not-requested`
  let settlement: MutationConfirmationObservation[`settlement`] = `pending`
  let handlerOutcome: DocumentedMutationObservation[`handlerOutcome`] = `pending`
  let handlerError: unknown
  let error: unknown,
    requestFailure: unknown,
    receiver: DocumentedReceiver | undefined
  let verdict: Promise<DocumentedMutationObservation> | undefined
  let inConfirmation = false,
    handlerActive = true
  const invoke = async (...raw: Array<unknown>) => {
    calls++
    try {
      const args = checkDocumentedRequest(
        history,
        inputs.before,
        inputs.optimistic,
        raw,
      )
      if (history.apiOutcome !== `reject-before-write`) {
        handlerWrites++
        const row = committedRow(history, args, inputs.before)
        server = history.mutation.peer ? [structuredClone(inputs.peer)] : []
        if (history.mutation.operation !== `delete`) server.unshift(row)
      }
    } catch (requestError) {
      requestFailure = requestError
      throw requestError
    } finally {
      called.resolve()
    }
    await responseGate.promise
    if (history.failureResponse === `http-status`)
      return { ok: false, status: 503 }
    if (history.apiOutcome !== `success`) throw failure
    return history.handler.adapter === `electric`
      ? { txid: 55 }
      : history.handler.api === `fetch`
        ? { ok: true, status: 200 }
        : structuredClone(
            server.filter((row) => row.id === inputs.optimistic.id),
          )
  }
  const method =
    history.mutation.operation === `insert`
      ? `create`
      : history.mutation.operation
  const api =
    history.handler.api === `todos`
      ? { todos: { [method]: invoke } }
      : history.handler.api === `profile`
        ? { profile: { update: invoke } }
        : history.handler.api === `single-todo`
          ? { createTodo: invoke }
          : history.handler.api === `products`
            ? { [`${method}Products`]: invoke }
            : history.handler.api === `bulk-todos`
              ? { [`${method}Todos`]: invoke }
              : {}
  const actual = compileDocumentedHandler(
    extractDocumentedHandler(history.handler, root),
    api,
    invoke,
  )
  await withOracleCleanup(async () => {
    receiver = createReceiver({
      history,
      initial: structuredClone(initial),
      server: () => structuredClone(server),
      handler: async (params) => {
        entered.resolve()
        await entryGate.promise
        try {
          const value = await actual(params)
          handlerOutcome = `fulfilled`
          return value
        } catch (reason) {
          handlerOutcome = `rejected`
          handlerError = reason
          throw reason
        } finally {
          returned.resolve()
          handlerActive = false
        }
      },
      confirmation: async (work) => {
        if (!handlerActive || inConfirmation) return work()
        inConfirmation = true
        confirmationCalls++
        confirmationStatus = `pending`
        try {
          const pending = work()
          confirmationRequested.resolve()
          const result = await pending
          confirmationStatus = `accepted`
          confirmationAccepted.resolve()
          if (history.handler.confirmation !== `write`)
            await acceptedCutGate.promise
          return result
        } finally {
          inConfirmation = false
        }
      },
    })
    await atMutationCheckpoint(receiver.start(), `documented initial source`)
    const collection = receiver.collection
    const transaction =
      history.mutation.operation === `insert`
        ? collection.insert(structuredClone(inputs.optimistic))
        : history.mutation.operation === `delete`
          ? collection.delete(inputs.before.id)
          : collection.update(inputs.before.id, (draft) => {
              Object.assign(draft, structuredClone(inputs.optimistic))
            })
    const observe = (): DocumentedMutationObservation => ({
      rows: documentedRows(collection, inputs.optimistic.id),
      handlerWrites,
      confirmationCalls,
      confirmationStatus,
      fetches: receiver!.fetches(),
      providerRequests: receiver!.providerRequests(),
      state: transaction.state,
      settlement,
      error,
      handlerOutcome,
      handlerError,
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
    const compare = (
      cut: Parameters<typeof checkDocumentedMutation>[1],
      observation = observe(),
    ) => {
      reach(`comparison:${cut}`)
      checkDocumentedMutation(history, cut, observation, failure, inputs)
    }
    await atMutationCheckpoint(entered.promise, `documented handler entry`)
    reach(`entered`)
    compare(`entered`)
    entryGate.resolve()
    await atMutationCheckpoint(called.promise, `actual documented API request`)
    reach(`api-request`)
    if (requestFailure !== undefined) throw requestFailure
    expect(calls).toBe(1)
    expect(server, `actual server ledger`).toStrictEqual(
      history.apiOutcome === `reject-before-write` ? initial : confirmed,
    )
    if (history.apiOutcome !== `reject-before-write`) {
      reach(`server-written`)
      compare(`server-written`)
    }
    responseGate.resolve()
    if (
      history.apiOutcome === `success` &&
      history.handler.confirmation !== `none`
    ) {
      const next = await atMutationCheckpoint(
        Promise.race([
          confirmationRequested.promise.then(() => `confirmation` as const),
          returned.promise.then(() => `returned` as const),
        ]),
        `confirmation request or actual handler return`,
      )
      if (next === `confirmation`) {
        if (history.handler.confirmation !== `write`) {
          await atMutationCheckpoint(
            receiver.sourceRequested,
            `real source request held`,
          )
          reach(`confirmation-held`)
          // Drain runnable Promise continuations while the real source remains
          // unavailable. An unawaited utility lets the actual handler return;
          // a handler that awaits confirmation cannot return at this cut.
          await setImmediate()
          compare(`confirmation-requested`)
          await atMutationCheckpoint(
            receiver.deliver(),
            `documented source delivery`,
          )
        }
        await atMutationCheckpoint(
          confirmationAccepted.promise,
          `real utility accepted`,
        )
        reach(`confirmation-accepted`)
        if (history.handler.confirmation !== `write`)
          compare(`confirmation-accepted`)
        acceptedCutGate.resolve()
      }
    }
    await atMutationCheckpoint(
      returned.promise,
      `actual documented handler return`,
    )
    const atWaiter = await atMutationCheckpoint(
      verdict,
      `documented transaction settlement`,
    )
    reach(`settlement-waiter`)
    compare(`settled`, atWaiter)
    compare(`settled`)
    if (
      history.apiOutcome !== `reject-before-write` &&
      (history.apiOutcome !== `success` ||
        history.handler.confirmation === `none`)
    ) {
      await atMutationCheckpoint(
        receiver.late(),
        `later explicit source confirmation`,
      )
      reach(`late-confirmed`)
      compare(`late-confirmed`)
      compare(`settled`, atWaiter)
    }
  }, [
    () => {
      entryGate.resolve()
      responseGate.resolve()
      acceptedCutGate.resolve()
    },
    () => receiver?.deliver(),
    () =>
      verdict && atMutationCheckpoint(verdict, `documented cleanup settlement`),
    () => receiver?.cleanup(),
  ])
}
