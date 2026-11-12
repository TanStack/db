import { expect } from 'vitest'
import { pass, violation } from './oracle-config'
import {
  checkMutationConfirmation,
  expectedMutationConfirmation,
  mutationConfirmationRows,
} from './mutation-confirmation-oracle'
import type { Observation, Verdict } from './oracle-config'
import type {
  MutationConfirmationCut,
  MutationConfirmationHistory,
  MutationConfirmationInputs,
  MutationConfirmationObservation,
  MutationOperation,
} from './mutation-confirmation-oracle'

/**
 * Recommended mutation handlers must confirm successful server writes before
 * settlement. Before/WRONG examples deliberately omit that obligation. Their
 * old return values have no coordinating effect (the approved RC contract).
 *
 * This grammar receives the existing mutation-confirmation judgment; it owns
 * no second outcome model. A declared strategy is independent of execution:
 * an API may commit and reject before the handler can request confirmation.
 * Such a rejection drops the optimistic state onto the old base. A later
 * explicit read/stream delivery reveals the committed server row.
 *
 * Scope: exact handler ASTs, one mutation, one edited key and an optional peer.
 * Complete ordinary fields, including Dates and own undefined, are observed.
 * Transport rejection and resolved HTTP 503 responses are separate grammars for
 * the fetch handler, with server-write fact varied independently. The HTTP
 * branch owes an Error with its declared message and exact error propagation.
 * Full schema/factory/query/component execution, awaitMatch, timeout guidance,
 * multiple mutations, persistence wrappers and live providers are not claimed.
 */
export type DocumentedRow = Record<string, unknown> & { id: string | number }
export type DocumentedApi =
  `bulk-todos` | `todos` | `products` | `profile` | `single-todo` | `fetch`
export type DocumentedPayload =
  | `modified`
  | `changes`
  | `id-changes`
  | `where-data`
  | `key`
  | `rows`
  | `updates`
  | `keys`
export type DocumentedHandler = {
  id: string
  file: string
  heading: string
  fence: number
  selection?: `after` | `before` | `correct` | `wrong`
  operation: MutationOperation
  adapter: `query` | `electric`
  confirmation: MutationConfirmationHistory[`confirmation`]
  api: DocumentedApi
  payload: DocumentedPayload
  shape: `todo` | `dated-todo` | `product` | `profile`
  numeric?: boolean
  legacy?: boolean
}

const queryGuide = `docs/collections/query-collection.md`
const electricGuide = `docs/collections/electric-collection.md`
const mutations = `docs/guides/mutations.md`
const migration = `docs/guides/migrate-to-1-0-rc.md`
const skillRoot = `packages/db/skills/db-core/`
type Fence = Omit<DocumentedHandler, `id` | `operation` | `payload`> & {
  id: string
  handlers: Array<[MutationOperation, DocumentedPayload]>
}

// These declarations specify the published recommendations and collaborators.
// They do not inspect the extracted handler to choose its required outcome.
const fences: Array<Fence> = [
  {
    id: `error-post`,
    file: `docs/guides/error-handling.md`,
    heading: `## Transaction Error Handling`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `fetch`,
    shape: `todo`,
    handlers: [[`insert`, `modified`]],
  },
  {
    id: `query-handlers`,
    file: queryGuide,
    heading: `## Persistence Handlers`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `bulk-todos`,
    shape: `todo`,
    handlers: [
      [`insert`, `rows`],
      [`update`, `updates`],
      [`delete`, `keys`],
    ],
  },
  {
    id: `query-upsert`,
    file: queryGuide,
    heading: `#### Applying a Server Response Without Refetching`,
    fence: 0,
    adapter: `query`,
    confirmation: `write`,
    api: `bulk-todos`,
    shape: `todo`,
    handlers: [[`insert`, `rows`]],
  },
  {
    id: `query-incremental`,
    file: queryGuide,
    heading: `### Example: Incremental Updates`,
    fence: 0,
    adapter: `query`,
    confirmation: `write`,
    api: `bulk-todos`,
    shape: `todo`,
    handlers: [
      [`insert`, `rows`],
      [`update`, `updates`],
    ],
  },
  {
    id: `mutations-after`,
    file: mutations,
    heading: `### Simplified Mutations vs Traditional Approaches`,
    fence: 1,
    adapter: `query`,
    confirmation: `refetch`,
    api: `todos`,
    shape: `todo`,
    handlers: [[`insert`, `modified`]],
  },
  {
    id: `mutations-query`,
    file: mutations,
    heading: `### Collection-Specific Handler Patterns`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `todos`,
    shape: `todo`,
    handlers: [[`update`, `id-changes`]],
  },
  {
    id: `mutations-electric`,
    file: mutations,
    heading: `### Collection-Specific Handler Patterns`,
    fence: 1,
    adapter: `electric`,
    confirmation: `txid`,
    api: `todos`,
    shape: `todo`,
    handlers: [[`update`, `id-changes`]],
  },
  {
    id: `mutations-profile`,
    file: mutations,
    heading: `#### Combining Local and Server Collections`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `profile`,
    shape: `profile`,
    handlers: [[`update`, `modified`]],
  },
  {
    id: `migration-electric`,
    file: migration,
    heading: `## Await synchronization inside mutation handlers`,
    fence: 1,
    selection: `after`,
    adapter: `electric`,
    confirmation: `txid`,
    api: `todos`,
    shape: `todo`,
    handlers: [[`update`, `changes`]],
  },
  {
    id: `migration-query`,
    file: migration,
    heading: `### Query Collection handlers no longer refetch`,
    fence: 0,
    selection: `after`,
    adapter: `query`,
    confirmation: `refetch`,
    api: `todos`,
    shape: `todo`,
    handlers: [[`update`, `changes`]],
  },
  {
    id: `skill-query`,
    file: `${skillRoot}mutations-optimistic/SKILL.md`,
    heading: `### 4. Mutation handlers with explicit refetch (QueryCollection pattern)`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `todos`,
    shape: `todo`,
    handlers: [
      [`insert`, `modified`],
      [`update`, `id-changes`],
      [`delete`, `key`],
    ],
  },
  {
    id: `skill-electric`,
    file: `${skillRoot}mutations-optimistic/SKILL.md`,
    heading: `### 4. Mutation handlers with explicit refetch (QueryCollection pattern)`,
    fence: 1,
    adapter: `electric`,
    confirmation: `txid`,
    api: `todos`,
    shape: `todo`,
    handlers: [[`update`, `id-changes`]],
  },
  {
    id: `skill-correct`,
    file: `${skillRoot}mutations-optimistic/SKILL.md`,
    heading: `### HIGH: Returning before Query Collection has confirmed data`,
    fence: 0,
    selection: `correct`,
    adapter: `query`,
    confirmation: `refetch`,
    api: `single-todo`,
    shape: `todo`,
    handlers: [[`insert`, `modified`]],
  },
  {
    id: `skill-products`,
    file: `${skillRoot}collection-setup/references/query-adapter.md`,
    heading: `## Complete Example`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `products`,
    shape: `product`,
    handlers: [
      [`insert`, `rows`],
      [`update`, `updates`],
      [`delete`, `keys`],
    ],
  },
  {
    id: `skill-electric-complete`,
    file: `${skillRoot}collection-setup/references/electric-adapter.md`,
    heading: `## Complete Example`,
    fence: 0,
    adapter: `electric`,
    confirmation: `txid`,
    api: `todos`,
    shape: `dated-todo`,
    handlers: [
      [`insert`, `modified`],
      [`update`, `where-data`],
      [`delete`, `key`],
    ],
  },
  {
    id: `skill-setup-query`,
    file: `${skillRoot}collection-setup/SKILL.md`,
    heading: `## Setup`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `todos`,
    shape: `dated-todo`,
    numeric: true,
    handlers: [
      [`insert`, `modified`],
      [`update`, `id-changes`],
      [`delete`, `key`],
    ],
  },
  {
    id: `skill-setup-electric`,
    file: `${skillRoot}collection-setup/SKILL.md`,
    heading: `### ElectricSQL with txid tracking`,
    fence: 0,
    adapter: `electric`,
    confirmation: `txid`,
    api: `todos`,
    shape: `dated-todo`,
    handlers: [[`insert`, `modified`]],
  },
  {
    id: `electric-handlers`,
    file: electricGuide,
    heading: `### 1. Using Txid (Recommended)`,
    fence: 0,
    adapter: `electric`,
    confirmation: `txid`,
    api: `todos`,
    shape: `todo`,
    handlers: [
      [`insert`, `modified`],
      [`update`, `where-data`],
    ],
  },
]

export const documentedHandlers: Array<DocumentedHandler> = fences.flatMap(
  ({ handlers, ...fence }) =>
    handlers.map(([operation, payload]) => ({
      ...fence,
      operation,
      payload,
      id: `${fence.id}/${operation}`,
      confirmation:
        fence.id === `skill-products` && operation === `insert`
          ? `write`
          : fence.confirmation,
    })),
)
export const negativeDocumentedHandlers: Array<DocumentedHandler> = [
  {
    ...documentedHandlers.find((h) => h.id === `migration-electric/update`)!,
    id: `migration-electric-before/update`,
    selection: `before`,
    confirmation: `none`,
    legacy: true,
  },
  {
    ...documentedHandlers.find((h) => h.id === `migration-query/update`)!,
    id: `migration-query-before/update`,
    selection: `before`,
    confirmation: `none`,
  },
  {
    ...documentedHandlers.find((h) => h.id === `skill-correct/insert`)!,
    id: `skill-wrong/insert`,
    selection: `wrong`,
    confirmation: `none`,
  },
]

export type DocumentedMutationHistory = {
  id: string
  handler: DocumentedHandler
  apiOutcome: `success` | `reject-before-write` | `reject-after-write`
  // This splits an unsuccessful mutation attempt from its transport result:
  // fetch may resolve to a non-OK HTTP response, with either ledger-write fact.
  failureResponse?: `http-status`
  mutation: MutationConfirmationHistory
}

export type DocumentedMutationObservation =
  MutationConfirmationObservation<DocumentedRow> & {
    handlerOutcome: `pending` | `fulfilled` | `rejected`
    handlerError: unknown
  }

// The authored handler's own Promise is observed independently of transaction
// settlement. At a held source cut it must still be pending; no fixture gate
// may supply a missing await. This uses the existing outcome model's result,
// not another account of optimistic settlement. Already accepted direct writes
// have no held-source cut and impose no requirement about await spelling.
export function checkDocumentedMutation(
  history: DocumentedMutationHistory,
  cut: MutationConfirmationCut,
  observed: DocumentedMutationObservation,
  failure: Error,
  inputs: MutationConfirmationInputs<DocumentedRow>,
): void {
  const { handlerOutcome, handlerError, ...transaction } = observed
  const settled = cut === `settled` || cut === `late-confirmed`
  let expectedFailure = failure
  if (history.failureResponse === `http-status` && settled) {
    // Kind/message are independently declared for the actual guide's HTTP
    // branch. Only after that judgment does its captured error become the
    // identity token that adapter settlement must preserve.
    expect(handlerOutcome, `${cut}: HTTP status must reject the handler`).toBe(
      `rejected`,
    )
    expect(handlerError, `${cut}: HTTP error kind`).toBeInstanceOf(Error)
    if (!(handlerError instanceof Error)) throw new Error(`Missing HTTP Error`)
    expect(handlerError.message, `${cut}: HTTP error message`).toBe(
      `HTTP Error: 503`,
    )
    expectedFailure = handlerError
  }
  const expected = expectedMutationConfirmation(
    history.mutation,
    cut,
    expectedFailure,
    inputs,
  )
  expect(handlerOutcome, `${cut}: actual documented handler Promise`).toBe(
    expected.settlement,
  )
  expect(handlerError, `${cut}: actual documented handler rejection`).toBe(
    expected.error,
  )
  checkMutationConfirmation(
    history.mutation,
    cut,
    transaction,
    expectedFailure,
    inputs,
  )
}

// API failure is upstream of the handler's acknowledgement. It commits no
// source transaction. The existing default rejection-after-ack stays unchanged.
export function documentedMutationHistories(
  adapter: `query` | `electric`,
): Array<DocumentedMutationHistory> {
  const histories: Array<DocumentedMutationHistory> = [
    ...documentedHandlers,
    ...negativeDocumentedHandlers,
  ]
    .filter((h) => h.adapter === adapter)
    .flatMap((handler) =>
      (handler.confirmation === `none`
        ? ([`success`] as const)
        : ([`success`, `reject-before-write`, `reject-after-write`] as const)
      ).flatMap((apiOutcome) =>
        [false, true].map((peer) => ({
          id: `${handler.id}/${apiOutcome}/peer:${peer}`,
          handler,
          apiOutcome,
          mutation: {
            adapter,
            operation: handler.operation,
            peer,
            confirmation: handler.confirmation,
            confirmationEntry:
              apiOutcome === `success` ? `reached` : `unreachable`,
            ...(apiOutcome === `success`
              ? {
                  outcome: `fulfilled` as const,
                  returned: handler.legacy
                    ? (`legacy-txid` as const)
                    : (`void` as const),
                }
              : { outcome: apiOutcome, returned: `void` as const }),
          },
        })),
      ),
    )
  return histories.flatMap((history) =>
    history.handler.api === `fetch` && history.apiOutcome !== `success`
      ? [
          history,
          {
            ...history,
            id: `${history.id}/http:503`,
            failureResponse: `http-status` as const,
          },
        ]
      : [history],
  )
}

export function documentedMutationInputs(
  handler: DocumentedHandler,
): MutationConfirmationInputs<DocumentedRow> {
  const id = handler.numeric ? 1 : `1`
  const peerId = handler.numeric ? 2 : `2`
  if (handler.shape === `profile` || handler.shape === `product`)
    return {
      before: { id, name: `before` },
      optimistic: { id, name: `optimistic` },
      confirmed: { id, name: `confirmed`, server_value: undefined },
      peer: { id: peerId, name: `peer` },
    }
  const dated = handler.shape === `dated-todo`
  const extra = dated ? { created_at: new Date(`2026-10-01T00:00:00Z`) } : {}
  return {
    before: { id, text: `before`, completed: false, ...extra },
    optimistic: { id, text: `optimistic`, completed: false, ...extra },
    confirmed: { id, text: `confirmed`, completed: true, ...extra },
    peer: { id: peerId, text: `peer`, completed: false, ...extra },
  }
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

/**
 * The native property's parts. Each documented handler history is one
 * enumerated `oracleProperty` history; the Query and Electric receivers supply
 * the production driver (documented-mutations-support.ts) and name what they
 * own. The driver records public observations at each held cut. The model
 * below owes, from the history alone, the server ledger and the set of cuts
 * that the history must reach; the check applies the comparisons above to
 * every recorded cut and judges reach last.
 *
 * Observations must be data, so the driver encodes two things that are not:
 * a Date becomes a marked number, and an error becomes a token that keeps
 * its identity relation (the API's own failure, the handler's own rejection,
 * or another value). The check decodes them into fresh values with the same
 * relations, so `checkMutationConfirmation`'s exact-identity comparison of a
 * rejection still rejects a wrapped or replaced error.
 */
const dateMarker = `$oracleDate`
const unsupportedMarker = `$oracleUnsupported`

/** A copy of a value as observation data: Dates are marked numbers. */
export function toDocumentedData(value: unknown): unknown {
  if (value instanceof Date) return { [dateMarker]: value.getTime() }
  if (Array.isArray(value)) return value.map(toDocumentedData)
  if (typeof value === `function`) return { [unsupportedMarker]: `function` }
  if (typeof value !== `object` || value === null) return value
  const prototype = Object.getPrototypeOf(value) as object | null
  // A class instance is never a documented payload; its tag keeps it unequal
  // to every authored value, as the strict comparison would.
  if (prototype !== null && prototype !== Object.prototype)
    return { [unsupportedMarker]: Object.prototype.toString.call(value) }
  const copy = Object.create(prototype) as Record<string, unknown>
  for (const [key, field] of Object.entries(value))
    copy[key] = toDocumentedData(field)
  return copy
}

function fromDocumentedData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromDocumentedData)
  if (typeof value !== `object` || value === null) return value
  const fields = Object.entries(value)
  if (
    fields.length === 1 &&
    fields[0]![0] === dateMarker &&
    typeof fields[0]![1] === `number`
  )
    return new Date(fields[0]![1])
  const copy = Object.create(Object.getPrototypeOf(value) as object | null)
  for (const [key, field] of fields) copy[key] = fromDocumentedData(field)
  return copy
}

/** The error the controlled API rejects with, which settlement must keep. */
export function documentedApiFailure(history: DocumentedMutationHistory) {
  return new Error(`documented API ${history.apiOutcome}`)
}

export type DocumentedErrorToken =
  | { kind: `none` }
  | { kind: `api-failure` }
  | { kind: `handler-rejection` }
  | { kind: `error`; name: string; message: string }
  | { kind: `value`; text: string }

/** An error's identity relation to the API failure and handler rejection. */
export function documentedErrorToken(
  value: unknown,
  failure: Error,
  handlerError?: unknown,
): DocumentedErrorToken {
  if (value === undefined) return { kind: `none` }
  if (value === failure) return { kind: `api-failure` }
  if (handlerError !== undefined && value === handlerError)
    return { kind: `handler-rejection` }
  if (value instanceof Error)
    return { kind: `error`, name: value.name, message: value.message }
  return { kind: `value`, text: String(value) }
}

function fromErrorToken(
  token: DocumentedErrorToken,
  failure: Error,
  handlerError?: unknown,
): unknown {
  switch (token.kind) {
    case `none`:
      return undefined
    case `api-failure`:
      return failure
    case `handler-rejection`:
      return handlerError
    case `error`:
      return Object.assign(new Error(token.message), { name: token.name })
    case `value`:
      return token.text
  }
}

/** A recorded observation: rows and errors in their data encodings. */
export type DocumentedObservationData = Omit<
  DocumentedMutationObservation,
  `rows` | `error` | `handlerError`
> & {
  rows: unknown
  error: DocumentedErrorToken
  handlerError: DocumentedErrorToken
}

function fromObservationData(
  observed: DocumentedObservationData,
  failure: Error,
): DocumentedMutationObservation {
  const handlerError = fromErrorToken(observed.handlerError, failure)
  return {
    ...observed,
    rows: fromDocumentedData(observed.rows) as Array<DocumentedRow>,
    handlerError,
    error: fromErrorToken(observed.error, failure, handlerError),
  }
}

/**
 * The cuts a history owes, from its declared strategy and API outcome alone.
 * Every history enters its handler, reaches the API request and the
 * settlement waiter. A write that commits reaches `server-written`. A
 * successful history with confirmation reaches its acceptance, and, unless
 * the confirmation is a direct write, holds the real source first. A history
 * that rejects after writing, or that never confirms, reaches the later
 * explicit confirmation. A `comparison:<cut>` entry names a cut at which the
 * mutation comparison must run.
 */
export function owedDocumentedCuts(
  history: DocumentedMutationHistory,
): Array<string> {
  const written = history.apiOutcome !== `reject-before-write`
  const confirmed =
    history.apiOutcome === `success` && history.handler.confirmation !== `none`
  const held = confirmed && history.handler.confirmation !== `write`
  const late =
    history.apiOutcome === `reject-after-write` ||
    history.handler.confirmation === `none`
  return [
    `entered`,
    `api-request`,
    `settlement-waiter`,
    ...(written ? [`server-written`] : []),
    ...(confirmed ? [`confirmation-accepted`] : []),
    ...(held ? [`confirmation-held`] : []),
    ...(late ? [`late-confirmed`] : []),
    ...[
      `entered`,
      `settled`,
      ...(written ? [`server-written`] : []),
      ...(held ? [`confirmation-requested`, `confirmation-accepted`] : []),
      ...(late ? [`late-confirmed`] : []),
    ].map((cut) => `comparison:${cut}`),
  ].sort()
}

export type DocumentedMutationExpected = {
  /** The cuts the history must reach, sorted. */
  owed: Array<string>
  /** The controlled server ledger after the API request. */
  server: Array<DocumentedRow>
}

export function modelDocumentedMutation(
  history: DocumentedMutationHistory,
): DocumentedMutationExpected {
  return {
    owed: owedDocumentedCuts(history),
    server: mutationConfirmationRows(
      history.mutation.operation,
      history.apiOutcome === `reject-before-write` ? `initial` : `confirmed`,
      history.mutation.peer,
      documentedMutationInputs(history.handler),
    ),
  }
}

function assertionValues(error: unknown) {
  return typeof error === `object` &&
    error !== null &&
    `actual` in error &&
    `expected` in error
    ? { actual: error.actual, expected: error.expected }
    : undefined
}

/**
 * The comparison of a recorded trace. A `request` is one call the handler
 * made to its API, judged against the documented payload. `api-request` is
 * the cut after the call: exactly one call, and the controlled server ledger.
 * A `comparison` is the mutation judgment at a held cut. Reach is judged last,
 * at a checkpoint the driver never records, so a driver error that cut the
 * trace short stays the failure.
 */
export function checkDocumentedMutationTrace(
  history: DocumentedMutationHistory,
  trace: ReadonlyArray<Observation>,
  expected: DocumentedMutationExpected,
): Verdict {
  const inputs = documentedMutationInputs(history.handler)
  const failure = documentedApiFailure(history)
  const reached = new Set<string>()
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) {
      reached.add(String(value))
      continue
    }
    try {
      if (checkpoint === `request`) {
        const { raw } = value as { raw: unknown }
        checkDocumentedRequest(
          history,
          inputs.before,
          inputs.optimistic,
          fromDocumentedData(raw) as Array<unknown>,
        )
      } else if (checkpoint === `api-request`) {
        const { calls, server } = value as { calls: number; server: unknown }
        expect(calls, `one actual documented API request`).toBe(1)
        expect(
          fromDocumentedData(server),
          `actual server ledger`,
        ).toStrictEqual(expected.server)
      } else if (checkpoint === `comparison`) {
        const { cut, observation } = value as {
          cut: MutationConfirmationCut
          observation: DocumentedObservationData
        }
        reached.add(`comparison:${cut}`)
        checkDocumentedMutation(
          history,
          cut,
          fromObservationData(observation, failure),
          failure,
          inputs,
        )
      } else
        return violation(
          checkpoint,
          `an undeclared checkpoint`,
          `documented reach`,
        )
    } catch (error) {
      return violation(
        checkpoint,
        String(error),
        checkpoint === `comparison`
          ? `documented mutation`
          : checkpoint === `request`
            ? `documented request`
            : `documented api request`,
        assertionValues(error),
      )
    }
  }
  const actual = [...reached].sort()
  return actual.length === expected.owed.length &&
    actual.every((cut, index) => cut === expected.owed[index])
    ? pass
    : violation(
        `owed cuts`,
        `the history did not reach exactly the cuts its strategy and API outcome owe`,
        `documented reach`,
        { actual, expected: expected.owed },
      )
}

function replaceObservation(
  trace: ReadonlyArray<Observation>,
  at: number,
  change: (observation: DocumentedObservationData) => DocumentedObservationData,
): ReadonlyArray<Observation> {
  return trace.map((entry, index) => {
    if (index !== at) return entry
    const value = entry.value as { observation: DocumentedObservationData }
    return {
      ...entry,
      value: { ...value, observation: change(value.observation) },
    }
  })
}

/**
 * Wrong answers the check must reject (ORC-006). Each alters a clean trace:
 * a lost reach cut, a lost comparison cut, a cut that the history does not
 * owe, a second API call, a wrong mutation observation, and a rejection that
 * equals the API failure in name and message but is a different error.
 */
export const documentedMutationCalibrations: Array<{
  name: string
  law: string
  corrupt: (
    trace: ReadonlyArray<Observation>,
    history: DocumentedMutationHistory,
  ) => ReadonlyArray<Observation> | undefined
}> = [
  {
    name: `a lost reach cut`,
    law: `documented reach`,
    corrupt: (trace) => {
      const at = trace.findIndex(({ checkpoint }) => checkpoint === `reach`)
      return at < 0 ? undefined : trace.filter((_, index) => index !== at)
    },
  },
  {
    name: `a lost comparison cut`,
    law: `documented reach`,
    corrupt: (trace) => {
      const kept = trace.filter(
        ({ checkpoint, value }) =>
          checkpoint !== `comparison` ||
          (value as { cut: string }).cut !== `entered`,
      )
      return kept.length === trace.length ? undefined : kept
    },
  },
  {
    name: `a cut the history does not owe`,
    law: `documented reach`,
    corrupt: (trace) =>
      trace.some(
        ({ checkpoint, value }) =>
          checkpoint === `reach` && value === `late-confirmed`,
      )
        ? undefined
        : [...trace, { checkpoint: `reach`, value: `late-confirmed` }],
  },
  {
    name: `a second API call`,
    law: `documented api request`,
    corrupt: (trace) =>
      trace.map((entry) =>
        entry.checkpoint === `api-request`
          ? {
              ...entry,
              value: { ...(entry.value as object), calls: 2 },
            }
          : entry,
      ),
  },
  {
    name: `a duplicated handler write`,
    law: `documented mutation`,
    corrupt: (trace) => {
      const at = trace.findIndex(
        ({ checkpoint }) => checkpoint === `comparison`,
      )
      return at < 0
        ? undefined
        : replaceObservation(trace, at, (observation) => ({
            ...observation,
            handlerWrites: observation.handlerWrites + 1,
          }))
    },
  },
  {
    name: `a replaced rejection with the failure's name and message`,
    law: `documented mutation`,
    corrupt: (trace, history) => {
      const at = trace.findIndex(
        ({ checkpoint, value }) =>
          checkpoint === `comparison` &&
          (value as { observation: DocumentedObservationData }).observation
            .error.kind === `api-failure`,
      )
      const failure = documentedApiFailure(history)
      return at < 0
        ? undefined
        : replaceObservation(trace, at, (observation) => ({
            ...observation,
            error: {
              kind: `error`,
              name: failure.name,
              message: failure.message,
            },
          }))
    },
  },
]
